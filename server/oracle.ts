import "./uv-threadpool.js";
import { existsSync } from "node:fs";
import { loadEnvFile } from "./env.js";
export { loadEnvFile } from "./env.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import oracledb from "oracledb";

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];

const ORACLE_NET_DIR = join(dirname(fileURLToPath(import.meta.url)), "oracle-net");

let thickReady = false;
type OracleRole = "consulta" | "gravacao";
const pools: Partial<Record<OracleRole, oracledb.Pool>> = {};
const poolPromises: Partial<Record<OracleRole, Promise<oracledb.Pool>>> = {};
let resetPromise: Promise<void> | null = null;

function resolveClientLibDir() {
  const configured = (process.env.ORACLE_CLIENT_LIB_DIR ?? "").trim();
  const candidates = [
    configured,
    String.raw`C:\instantclient-basic-windows.x64-23.26.1.0.0\instantclient_23_0`,
    String.raw`C:\instantclient-basic-windows.x64-23.26.0.0.0\instantclient_23_0`,
  ].filter(Boolean);
  for (const dir of [...new Set(candidates)]) {
    if (existsSync(join(dir, "oci.dll"))) return dir;
  }
  return configured;
}

function initThickMode() {
  if (thickReady) return;
  loadEnvFile();
  const libDir = resolveClientLibDir();
  if (libDir) {
    const pathEnv = process.env.PATH ?? "";
    if (!pathEnv.toLowerCase().includes(libDir.toLowerCase())) {
      process.env.PATH = `${libDir};${pathEnv}`;
    }
  }
  if (existsSync(join(ORACLE_NET_DIR, "sqlnet.ora"))) {
    process.env.TNS_ADMIN = ORACLE_NET_DIR;
  }
  try {
    const clientOpts: oracledb.InitOracleClientOptions = {};
    if (libDir) clientOpts.libDir = libDir;
    if (process.env.TNS_ADMIN) clientOpts.configDir = process.env.TNS_ADMIN;
    if (clientOpts.libDir || clientOpts.configDir) oracledb.initOracleClient(clientOpts);
    else oracledb.initOracleClient();
    thickReady = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("NJS-075") || message.toLowerCase().includes("already been initialized")) {
      thickReady = true;
      return;
    }
    throw new Error(
      `Não foi possível iniciar o Oracle Instant Client${libDir ? ` em ${libDir}` : ""}. ${message}`,
    );
  }
}

function oracleErrorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function isStaleSessionError(err: unknown) {
  return /DPI-1010|DPI-1080|NJS-003|NJS-500|not connected|invalid or closed connection/i.test(oracleErrorText(err));
}

function isOracleCancel(err: unknown) {
  if (err && typeof err === "object" && "errorNum" in err && (err as { errorNum?: number }).errorNum === 1013) return true;
  return /ORA-01013|Consulta cancelada/i.test(oracleErrorText(err));
}

function isTunnelChecksumError(err: unknown) {
  return /ORA-12569|ORA-12537|ORA-12547|ORA-12570|packet checksum/i.test(oracleErrorText(err));
}

function isQueueTimeoutError(err: unknown) {
  return /NJS-040|NJS-076|queueTimeout|queueMax/i.test(oracleErrorText(err));
}

const TUNNEL_COOLDOWN_MS = 20_000;
const POOL_MAX = Math.max(4, Number(process.env.ORACLE_POOL_MAX || 12) || 12);
/** Conexões em uso no app: abaixo do poolMax para o túnel nunca enfileirar getConnection. */
const CHECKOUT_MAX = Math.max(1, Math.min(Number(process.env.ORACLE_CHECKOUT_MAX || 3) || 3, POOL_MAX));
let tunnelDownUntil = 0;
let lastTunnelLog = 0;
let checkoutChain: Promise<unknown> = Promise.resolve();

/** Evita enfileirar getConnection além do pool (NJS-040). */
class OracleSlotGate {
  generation = 0;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire() {
    while (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
  }
  release(generation?: number) {
    if (generation != null && generation !== this.generation) return;
    this.active = Math.max(0, this.active - 1);
    this.waiters.shift()?.();
  }
  reset() {
    this.generation += 1;
    this.active = 0;
    const pending = this.waiters.splice(0);
    queueMicrotask(() => {
      for (const waiter of pending) waiter();
    });
  }
}

const oracleSlots = new OracleSlotGate(CHECKOUT_MAX);

function enqueueCheckout<T>(fn: () => Promise<T>): Promise<T> {
  const run = checkoutChain.then(fn, fn);
  checkoutChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Evita Promise.all de N consultas Oracle simultâneas (NJS-040). */
export async function runLimited<T>(tasks: Array<() => Promise<T>>, limit = 1): Promise<T[]> {
  if (!tasks.length) return [];
  const out: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), tasks.length) }, async () => {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= tasks.length) return;
      out[idx] = await tasks[idx]!();
    }
  });
  await Promise.all(workers);
  return out;
}

function attachSlotRelease(conn: oracledb.Connection) {
  const originalClose = conn.close.bind(conn);
  const generation = oracleSlots.generation;
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    oracleSlots.release(generation);
  };
  conn.close = (async (...args: never[]) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      return await Promise.race([
        originalClose(...args),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error("Timeout ao fechar conexão Oracle."));
          }, 8000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      releaseOnce();
      if (timedOut) void resetPool();
    }
  }) as typeof conn.close;
  return conn;
}

function noteTunnelFailure() {
  tunnelDownUntil = Date.now() + TUNNEL_COOLDOWN_MS;
  if (Date.now() - lastTunnelLog < TUNNEL_COOLDOWN_MS) return;
  lastTunnelLog = Date.now();
  console.warn(
    "Oracle indisponível (ORA-12569): o túnel TNS/ngrok entregou um pacote corrompido. Reinicie o ngrok, atualize ORACLE_CONNECT_STRING se a porta mudou e recarregue a tela. Nova tentativa automática em 20s.",
  );
}

function throwIfTunnelDown() {
  const waitMs = tunnelDownUntil - Date.now();
  if (waitMs <= 0) return;
  const seconds = Math.ceil(waitMs / 1000);
  throw new Error(
    `ORA-12569: TNS:packet checksum failure. Túnel Oracle indisponível; nova tentativa em ${seconds}s.`,
  );
}

async function closeQuietly(conn: oracledb.Connection | undefined, drop = false) {
  if (!conn) return;
  try {
    await conn.close(drop ? { drop: true } : undefined);
  } catch {
    /* sessão já pode estar morta */
  }
}

async function resetPool() {
  if (resetPromise) return resetPromise;
  resetPromise = (async () => {
    oracleSlots.reset();
    const current = [pools.consulta, pools.gravacao].filter((item): item is oracledb.Pool => Boolean(item));
    delete pools.consulta;
    delete pools.gravacao;
    delete poolPromises.consulta;
    delete poolPromises.gravacao;
    await Promise.all(
      current.map(async (item) => {
        try {
          await item.close(0);
        } catch {
          /* pool já pode ter caído com o túnel */
        }
      }),
    );
  })().finally(() => {
    resetPromise = null;
  });
  return resetPromise;
}

function oracleCredentials(role: OracleRole) {
  loadEnvFile();
  const connectString =
    process.env.ORACLE_CONNECT_STRING || process.env.ORACLE_DSN || process.env.DB_CONNECT_STRING;
  if (role === "consulta") {
    const user = (process.env.ORACLE_USER_CONSULTA || "").trim();
    const password = process.env.ORACLE_PASSWORD_CONSULTA || "";
    if (user) {
      if (!password || !connectString) {
        throw new Error(
          "Configure ORACLE_USER_CONSULTA, ORACLE_PASSWORD_CONSULTA e ORACLE_CONNECT_STRING no arquivo .env.",
        );
      }
      return { user, password, connectString };
    }
  }
  const user = process.env.ORACLE_USER || process.env.DB_USER;
  const password = process.env.ORACLE_PASSWORD || process.env.DB_PASSWORD;
  if (!user || !password || !connectString) {
    throw new Error("Configure ORACLE_USER, ORACLE_PASSWORD e ORACLE_CONNECT_STRING no arquivo .env.");
  }
  return { user, password, connectString };
}

async function createPool(role: OracleRole) {
  initThickMode();
  const { user, password, connectString } = oracleCredentials(role);
  return oracledb.createPool({
    user,
    password,
    connectString,
    poolMin: 0,
    poolMax: POOL_MAX,
    poolIncrement: 1,
    poolTimeout: 300,
    // Ping no checkout trava o túnel e o queueTimeout abandona a conexão
    // ainda em abertura (NJS-040), deixando o pool cheio.
    poolPingInterval: 0,
    queueTimeout: 0,
    queueMax: 500,
  });
}

async function getPool(role: OracleRole) {
  const current = pools[role];
  if (current) return current;
  if (!poolPromises[role]) {
    poolPromises[role] = createPool(role)
      .then((created) => {
        pools[role] = created;
        return created;
      })
      .finally(() => {
        delete poolPromises[role];
      });
  }
  return poolPromises[role];
}

async function checkoutConnection(role: OracleRole) {
  const conn = await (await getPool(role)).getConnection();
  tunnelDownUntil = 0;
  return attachSlotRelease(conn);
}

async function getOracleConnectionFor(role: OracleRole) {
  throwIfTunnelDown();
  await oracleSlots.acquire();
  try {
    return await enqueueCheckout(() => checkoutConnection(role));
  } catch (err) {
    if (isTunnelChecksumError(err)) {
      oracleSlots.release();
      noteTunnelFailure();
      await resetPool();
      throw err;
    }
    if (isQueueTimeoutError(err)) {
      oracleSlots.release();
      throw new Error(
        "Oracle ocupado: as consultas em andamento ainda seguram as conexões do pool. Aguarde o rateio terminar e recarregue a tela.",
      );
    }
    oracleSlots.release();
    throw err;
  }
}

/** Consultas (SELECT) usam ORACLE_USER_CONSULTA. */
export async function getOracleConnection() {
  return getOracleConnectionFor("consulta");
}

/** Gravação (INSERT/UPDATE) usa ORACLE_USER. */
export async function getOracleWriteConnection() {
  return getOracleConnectionFor("gravacao");
}

async function withOracleRole<T>(
  role: OracleRole,
  fn: (conn: oracledb.Connection) => Promise<T>,
  signal?: AbortSignal,
) {
  throwIfTunnelDown();
  if (signal?.aborted) throw new Error("Consulta cancelada.");
  let conn: oracledb.Connection | undefined;
  const onAbort = () => {
    void conn?.break().catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort);
  try {
    conn = await getOracleConnectionFor(role);
    if (signal?.aborted) throw new Error("Consulta cancelada.");
    const result = await fn(conn);
    tunnelDownUntil = 0;
    await closeQuietly(conn);
    return result;
  } catch (err) {
    await closeQuietly(conn, true);
    if (isOracleCancel(err) || signal?.aborted) throw err;
    if (isStaleSessionError(err)) {
      await resetPool();
      const retry = await getOracleConnectionFor(role);
      conn = retry;
      try {
        const result = await fn(retry);
        tunnelDownUntil = 0;
        await closeQuietly(retry);
        return result;
      } catch (retryErr) {
        await closeQuietly(retry, true);
        if (isTunnelChecksumError(retryErr)) noteTunnelFailure();
        throw retryErr;
      }
    }
    if (isTunnelChecksumError(err)) {
      noteTunnelFailure();
      await resetPool();
    }
    throw err;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function withOracle<T>(
  fn: (conn: oracledb.Connection) => Promise<T>,
  signal?: AbortSignal,
) {
  return withOracleRole("consulta", fn, signal);
}

export async function withOracleWrite<T>(fn: (conn: oracledb.Connection) => Promise<T>) {
  return withOracleRole("gravacao", fn);
}

export function oracleValue(row: Record<string, unknown>, ...names: string[]) {
  const keys = Object.keys(row);
  for (const name of names) {
    const found = keys.find((key) => key.toLowerCase() === name.toLowerCase());
    if (found && row[found] != null) return row[found];
  }
  return null;
}

export function oracleNumber(row: Record<string, unknown>, ...names: string[]) {
  const value = Number(oracleValue(row, ...names));
  return Number.isFinite(value) ? value : null;
}

export function oracleText(row: Record<string, unknown>, ...names: string[]) {
  const value = oracleValue(row, ...names);
  if (value == null) return "";
  return String(value).trim();
}

export function oracleDate(row: Record<string, unknown>, ...names: string[]) {
  const value = oracleValue(row, ...names);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim()) return value;
  return null;
}
