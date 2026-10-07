import { getConnection } from '../config/db.js';
import { normalizeNegocios } from './filtros.js';

const QUERY_CACHE_MS = 90_000;
const QUERY_CACHE_MAX = 40;
const queryCache = new Map();
const queryInflight = new Map();

function queryCacheKey(sql, binds) {
  const stable = {};
  for (const key of Object.keys(binds).sort()) {
    const value = binds[key];
    stable[key] = value instanceof Date ? value.toISOString() : value;
  }
  return `${sql}\n${JSON.stringify(stable)}`;
}

function rememberQuery(key, value) {
  queryCache.set(key, { value, expires: Date.now() + QUERY_CACHE_MS });
  while (queryCache.size > QUERY_CACHE_MAX) {
    const oldest = queryCache.keys().next().value;
    queryCache.delete(oldest);
  }
}

function isRecoverableOracleError(err) {
  const msg = String(err?.message || '');
  const code = String(err?.code || '');
  return (
    err?.isRecoverable === true ||
    code === 'NJS-003' ||
    code === 'NJS-500' ||
    msg.includes('NJS-003') ||
    msg.includes('NJS-500') ||
    msg.includes('DPI-1010') ||
    msg.includes('DPI-1080') ||
    msg.includes('ORA-03113') ||
    msg.includes('ORA-03135') ||
    msg.includes('ORA-12569') ||
    msg.includes('ORA-12537') ||
    msg.includes('ORA-12547') ||
    msg.includes('packet checksum') ||
    msg.includes('not connected') ||
    msg.includes('invalid or closed connection')
  );
}

async function closeQuietly(connection) {
  if (!connection) return;
  try {
    await connection.close();
  } catch {
    // conexão já pode estar quebrada
  }
}

/**
 * Obtém uma conexão do pool, executa o callback e devolve a conexão.
 * Se a sessão estiver morta (NJS-003 / DPI-1010), tenta de novo.
 */
export async function withConnection(fn, options = {}) {
  const { maxAttempts = 2 } = options;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let connection;
    try {
      connection = await getConnection();
      return await fn(connection);
    } catch (err) {
      lastError = err;
      await closeQuietly(connection);
      connection = null;
      if (!isRecoverableOracleError(err) || attempt === maxAttempts) {
        throw err;
      }
      console.warn(
        `Oracle recuperável (tentativa ${attempt}/${maxAttempts}): ${err.message}`
      );
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    } finally {
      await closeQuietly(connection);
    }
  }

  throw lastError;
}

/**
 * Executa SQL com uma conexão do pool e tenta de novo se a sessão cair.
 */
async function executeQueryNow(sql, binds, options) {
  const {
    callTimeout = Number(process.env.DB_CALL_TIMEOUT_MS || 300000),
  } = options;

  return withConnection(
    (connection) =>
      connection.execute(sql, binds, {
        callTimeout,
      }),
    options
  );
}

export async function executeQuery(sql, binds = {}, options = {}) {
  const key = queryCacheKey(sql, binds);
  const cached = queryCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const pending = queryInflight.get(key);
  if (pending) return pending;

  const run = executeQueryNow(sql, binds, options)
    .then((value) => {
      rememberQuery(key, value);
      queryInflight.delete(key);
      return value;
    })
    .catch((err) => {
      queryInflight.delete(key);
      throw err;
    });
  queryInflight.set(key, run);
  return run;
}

function anomesParaDataInicio(anomes) {
  return new Date(
    Number(anomes.slice(0, 4)),
    Number(anomes.slice(4, 6)) - 1,
    1
  );
}

/** Primeiro dia do mês seguinte (limite exclusivo). */
function anomesParaDataFimExclusiva(anomes) {
  return new Date(Number(anomes.slice(0, 4)), Number(anomes.slice(4, 6)), 1);
}

/**
 * Converte anomesInicio/anomesFim em intervalo de datas [inicio, fim).
 * Também expõe binds de anomes para filtros YYYYMM.
 */
export function bindsPeriodo(filtros = {}) {
  const anomesInicio = filtros.anomesInicio || filtros.anomes || null;
  const anomesFim = filtros.anomesFim || filtros.anomes || null;

  let dataInicio = null;
  let dataFim = null;

  if (anomesInicio) dataInicio = anomesParaDataInicio(anomesInicio);
  if (anomesFim) dataFim = anomesParaDataFimExclusiva(anomesFim);

  const negocios = normalizeNegocios(filtros);

  return {
    anomes: filtros.anomes || anomesInicio || anomesFim || null,
    anomesInicio,
    anomesFim,
    equipamento: filtros.equipamento || null,
    dataInicio,
    dataFim,
    negociosCsv: negocios?.length ? negocios.join(',') : null,
    processo: filtros.processo ?? null,
    subprocesso: filtros.subprocesso ?? null,
    atividade: filtros.atividade ?? null,
    objetoCusto: filtros.objetoCusto ?? null,
  };
}

/** Binds com intervalo de data + equipamento + objeto de custo (sem anomes*). */
export function bindsPeriodoData(filtros = {}) {
  const b = bindsPeriodo(filtros);
  return {
    equipamento: b.equipamento,
    dataInicio: b.dataInicio,
    dataFim: b.dataFim,
    negociosCsv: b.negociosCsv,
    processo: b.processo,
    subprocesso: b.subprocesso,
    atividade: b.atividade,
    objetoCusto: b.objetoCusto,
  };
}

/** Binds padrão para queries que usam anomesInicio/anomesFim (sem data). */
export function bindsAnomes(filtros = {}) {
  const b = bindsPeriodo(filtros);
  return {
    anomesInicio: b.anomesInicio,
    anomesFim: b.anomesFim,
    equipamento: b.equipamento,
    negociosCsv: b.negociosCsv,
    processo: b.processo,
    subprocesso: b.subprocesso,
    atividade: b.atividade,
    objetoCusto: b.objetoCusto,
  };
}
