import { db } from "./db.js";
import { oracleNumber, oracleText, runLimited, withOracle } from "./oracle.js";
import type { Connection } from "oracledb";
import { currentSafraStartYear, resolveSafraId, safraStartYear } from "./safras.js";

export const UN_REALIZADO_KINDS = ["apontamento_terceiro", "apontamento_maquinas", "irrigacao"] as const;
export type UnRealizadoKind = (typeof UN_REALIZADO_KINDS)[number];

export const UN_REALIZADO_METRICS = ["area", "quantity"] as const;
export type UnRealizadoMetric = (typeof UN_REALIZADO_METRICS)[number];

const KIND_LABEL: Record<UnRealizadoKind, string> = {
  apontamento_terceiro: "Apontamento de terceiro",
  apontamento_maquinas: "Apontamento de máquinas",
  irrigacao: "Irrigação",
};

export interface UnRealizadoOperation {
  code: string;
  label: string;
}

export interface UnRealizadoSource {
  id: number;
  sheetId: number;
  sheetName: string;
  sheetTitle: string;
  sourceKind: UnRealizadoKind;
  sourceLabel: string;
  metric: UnRealizadoMetric;
  metricLabel: string;
  operations: UnRealizadoOperation[];
  units: number | null;
  fromDate: string;
  toDate: string;
}

export interface UnRealizadoUnitsRow {
  sheetId: number;
  units: number;
}

function isKind(value: unknown): value is UnRealizadoKind {
  return UN_REALIZADO_KINDS.includes(value as UnRealizadoKind);
}

function isMetric(value: unknown): value is UnRealizadoMetric {
  return UN_REALIZADO_METRICS.includes(value as UnRealizadoMetric);
}

function metricLabel(metric: UnRealizadoMetric) {
  return metric === "quantity" ? "Quantidade" : "Área";
}

function safraDateRange(startYear: number) {
  return {
    fromDate: `${startYear}-09-01`,
    toDate: `${startYear + 1}-08-31`,
  };
}

function codeKey(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const n = Number(raw.replace(",", "."));
  if (Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return raw.toUpperCase();
}

function inBinds(prefix: string, codes: string[]) {
  const binds: Record<string, string | number> = {};
  const names = codes.map((code, i) => {
    const key = `${prefix}${i}`;
    const n = Number(code);
    binds[key] = Number.isFinite(n) && String(Math.round(n)) === code ? n : code;
    return `:${key}`;
  });
  return { sql: names.join(", "), binds };
}

function isMissingColumn(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /ORA-00904/i.test(message);
}

function money(n: number) {
  return Math.round((n || 0) * 100) / 100;
}

export function ensureUnRealizadoSources() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS un_realizado_sources (
      id INTEGER PRIMARY KEY,
      sheet_id INTEGER NOT NULL UNIQUE REFERENCES sheets(id) ON DELETE CASCADE,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('apontamento_terceiro', 'apontamento_maquinas', 'irrigacao')),
      metric TEXT NOT NULL DEFAULT 'area' CHECK (metric IN ('area', 'quantity'))
    );

    CREATE TABLE IF NOT EXISTS un_realizado_operations (
      id INTEGER PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES un_realizado_sources(id) ON DELETE CASCADE,
      cod_operacaoagricola TEXT NOT NULL,
      label TEXT,
      UNIQUE (source_id, cod_operacaoagricola)
    );
  `);
}

function listRows() {
  ensureUnRealizadoSources();
  return db
    .prepare(
      `SELECT s.id, s.sheet_id, s.source_kind, s.metric,
              sh.name AS sheet_name, sh.title AS sheet_title
         FROM un_realizado_sources s
         JOIN sheets sh ON sh.id = s.sheet_id
        ORDER BY sh.sort_order, sh.title`,
    )
    .all() as {
      id: number;
      sheet_id: number;
      source_kind: UnRealizadoKind;
      metric: UnRealizadoMetric;
      sheet_name: string;
      sheet_title: string;
    }[];
}

function operationsFor(sourceId: number): UnRealizadoOperation[] {
  return (
    db
      .prepare(
        `SELECT cod_operacaoagricola AS code, COALESCE(label, cod_operacaoagricola) AS label
           FROM un_realizado_operations
          WHERE source_id = ?
          ORDER BY CAST(cod_operacaoagricola AS INTEGER), cod_operacaoagricola`,
      )
      .all(sourceId) as { code: string; label: string }[]
  ).map((row) => ({ code: codeKey(row.code), label: row.label || row.code }));
}

async function usingConn<T>(conn: Connection | undefined, fn: (current: Connection) => Promise<T>) {
  if (conn) return fn(conn);
  return withOracle(fn);
}

async function sumTerceiro(codes: string[], metric: UnRealizadoMetric, fromDate: string, toDate: string) {
  if (!codes.length) return 0;
  const { sql, binds } = inBinds("op", codes);
  const expr = metric === "quantity" ? "NVL(i.quantidade, 0)" : "NVL(i.area_cultivada, 0)";
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT SUM(${expr}) AS units
         FROM automotivo.itens_apontamentoterceiro i
         JOIN automotivo.apontamentoterceiro a
           ON a.ano_apontamento = i.ano_apontamento
          AND a.numero_apontamento = i.numero_apontamento
          AND a.cod_grupoempresa = i.cod_grupoempresa
          AND a.cod_empresa = i.cod_empresa
          AND a.cod_filial = i.cod_filial
        WHERE i.cod_operacaoagricola IN (${sql})
          AND TRUNC(a.dt_apontamento) BETWEEN TO_DATE(:fromDate, 'YYYY-MM-DD') AND TO_DATE(:toDate, 'YYYY-MM-DD')`,
      { ...binds, fromDate, toDate },
    );
    const raw = ((result.rows ?? []) as Record<string, unknown>[])[0];
    return money(oracleNumber(raw, "units") ?? 0);
  });
}

async function sumMaquinas(
  codes: string[],
  metric: UnRealizadoMetric,
  fromDate: string,
  toDate: string,
  existing?: Connection,
) {
  if (!codes.length) return 0;
  const { sql, binds } = inBinds("op", codes);
  const expr = metric === "quantity" ? "NVL(i.quantidade, 0)" : "NVL(i.area, 0)";

  const run = async (opts: { dateExpr: string | null; joinHeader: boolean }) => {
    const header = opts.joinHeader
      ? ` JOIN automotivo.apontamento a
             ON a.ano_apontamento = i.ano_apontamento
            AND a.numero_apontamento = i.numero_apontamento
            AND a.cod_grupoempresa = i.cod_grupoempresa
            AND a.cod_empresa = i.cod_empresa
            AND a.cod_filial = i.cod_filial`
      : "";
    const dateClause = opts.dateExpr
      ? ` AND TRUNC(${opts.dateExpr}) BETWEEN TO_DATE(:fromDate, 'YYYY-MM-DD') AND TO_DATE(:toDate, 'YYYY-MM-DD')`
      : "";
    return usingConn(existing, async (conn) => {
      const result = await conn.execute(
        `SELECT SUM(${expr}) AS units
           FROM automotivo.itens_apontamento i
           ${header}
          WHERE i.cod_operacaoagricola IN (${sql})
            ${dateClause}`,
        opts.dateExpr ? { ...binds, fromDate, toDate } : binds,
      );
      const raw = ((result.rows ?? []) as Record<string, unknown>[])[0];
      return money(oracleNumber(raw, "units") ?? 0);
    });
  };

  try {
    return await run({ dateExpr: "i.dt_apontamento", joinHeader: false });
  } catch (err) {
    if (!isMissingColumn(err)) throw err;
  }
  try {
    return await run({ dateExpr: "a.dt_apontamento", joinHeader: true });
  } catch (err) {
    if (!isMissingColumn(err)) throw err;
  }
  return run({ dateExpr: null, joinHeader: false });
}

async function sumIrrigacao(fromDate: string, toDate: string, existing?: Connection) {
  return usingConn(existing, async (conn) => {
    const result = await conn.execute(
      `SELECT SUM(m.max_area) AS units
         FROM (
           SELECT v.cod_fazenda,
                  v.cod_talhao,
                  MAX(NVL(v.area_talhao, 0)) AS max_area
             FROM agricola.vw_apontamentoirrigacao v
            WHERE TRUNC(v.data) BETWEEN TO_DATE(:fromDate, 'YYYY-MM-DD') AND TO_DATE(:toDate, 'YYYY-MM-DD')
            GROUP BY v.cod_fazenda, v.cod_talhao
         ) m`,
      { fromDate, toDate },
    );
    const raw = ((result.rows ?? []) as Record<string, unknown>[])[0];
    return money(oracleNumber(raw, "units") ?? 0);
  });
}

const OPERACAO_PLANTA_HA = "41";
const OPERACOES_SOCA_HA = ["M13", "M56", "M80", "M342"] as const;

function anomesToIsoStart(anomes: string | number) {
  const s = String(anomes).padStart(6, "0");
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-01`;
}

function anomesToIsoEnd(anomes: string | number) {
  const s = String(anomes).padStart(6, "0");
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(4, 6));
  const last = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

async function sumAgricolaSocaArea(anomesInicio: number, anomesFim: number, existing?: Connection) {
  const { sql, binds } = inBinds("op", [...OPERACOES_SOCA_HA]);
  const anoIni = Math.floor(anomesInicio / 100);
  const anoFim = Math.floor(anomesFim / 100);
  return usingConn(existing, async (conn) => {
    const result = await conn.execute(
      `SELECT SUM(NVL(t.area, 0)) AS units
         FROM (
           SELECT TO_NUMBER(
                    a.ano_apontamento || TO_CHAR(MAX(b.data_apontamento), 'MM')
                  ) AS anomes,
                  a.tipo_operacao || a.cod_operacao AS operacao,
                  a.area AS area
             FROM agricola.apontamentoitem a
             LEFT JOIN agricola.apontamento b
               ON a.ano_apontamento = b.ano_apontamento
              AND a.nr_apontamento = b.nr_apontamento
             LEFT JOIN agricola.apontamentomaterial c
               ON a.ano_apontamento = c.ano_apontamento
              AND a.nr_apontamento = c.nr_apontamento
              AND a.item_apontamento = c.item_apontamento
            WHERE a.ano_apontamento BETWEEN :anoIni AND :anoFim
            GROUP BY a.ano_apontamento,
                     a.cod_funcionario,
                     a.cod_objetocusto,
                     a.cod_fazenda,
                     a.cod_talhao,
                     a.cod_operacao,
                     a.tipo_operacao,
                     a.area
         ) t
        WHERE t.operacao IN (${sql})
          AND t.anomes BETWEEN :anomesInicio AND :anomesFim`,
      { ...binds, anoIni, anoFim, anomesInicio, anomesFim },
    );
    const raw = ((result.rows ?? []) as Record<string, unknown>[])[0];
    return money(oracleNumber(raw, "units") ?? 0);
  });
}

export async function fetchMatrizRhaHectares(
  anomesInicio?: string | number | null,
  anomesFim?: string | number | null,
  existing?: Connection,
  comIrrigacao = false,
) {
  const inicio = anomesInicio != null && String(anomesInicio).trim() ? String(anomesInicio) : null;
  const fim = anomesFim != null && String(anomesFim).trim() ? String(anomesFim) : null;
  if (!inicio || !fim) {
    return { planta: 0, soca: 0, irrigacao: 0 };
  }
  const fromDate = anomesToIsoStart(inicio);
  const toDate = anomesToIsoEnd(fim);
  const load = async (conn: Connection) => {
    const planta = await sumMaquinas([OPERACAO_PLANTA_HA], "area", fromDate, toDate, conn).catch(() => 0);
    const soca = await sumAgricolaSocaArea(Number(inicio), Number(fim), conn).catch(() => 0);
    const irrigacao = comIrrigacao
      ? await sumIrrigacao(fromDate, toDate, conn).catch(() => 0)
      : 0;
    return { planta, soca, irrigacao };
  };
  if (existing) return load(existing);
  return withOracle(load);
}

async function computeUnits(
  kind: UnRealizadoKind,
  metric: UnRealizadoMetric,
  operations: UnRealizadoOperation[],
  fromDate: string,
  toDate: string,
) {
  if (kind === "irrigacao") return sumIrrigacao(fromDate, toDate);
  const codes = operations.map((row) => row.code).filter(Boolean);
  if (kind === "apontamento_terceiro") return sumTerceiro(codes, metric, fromDate, toDate);
  return sumMaquinas(codes, metric, fromDate, toDate);
}

export async function listUnRealizadoSources(safraId?: number | null) {
  resolveSafraId(safraId);
  const { fromDate, toDate } = safraDateRange(currentSafraStartYear());
  const rows = listRows();
  const computed = await runLimited(
    rows.map((row) => async () => {
      const operations = operationsFor(row.id);
      let units: number | null = null;
      try {
        units = await computeUnits(row.source_kind, row.metric, operations, fromDate, toDate);
      } catch {
        units = null;
      }
      return {
        id: row.id,
        sheetId: row.sheet_id,
        sheetName: row.sheet_name,
        sheetTitle: row.sheet_title,
        sourceKind: row.source_kind,
        sourceLabel: KIND_LABEL[row.source_kind],
        metric: row.metric,
        metricLabel: metricLabel(row.metric),
        operations,
        units,
        fromDate,
        toDate,
      } satisfies UnRealizadoSource;
    }),
    2,
  );
  return { fromDate, toDate, sources: computed };
}

export async function fetchUnRealizadoUnitsBySheet(safraId?: number | null): Promise<UnRealizadoUnitsRow[]> {
  const id = resolveSafraId(safraId);
  const safra = db.prepare("SELECT code FROM safras WHERE id = ?").get(id) as { code: string } | undefined;
  const startYear = safra ? safraStartYear(safra.code) : currentSafraStartYear();
  const { fromDate, toDate } = safraDateRange(startYear);
  const rows = listRows();
  const computed = await runLimited(
    rows.map((row) => async () => {
      const operations = operationsFor(row.id);
      try {
        const units = await computeUnits(row.source_kind, row.metric, operations, fromDate, toDate);
        return units > 0 ? ({ sheetId: row.sheet_id, units } satisfies UnRealizadoUnitsRow) : null;
      } catch {
        return null;
      }
    }),
    2,
  );
  return computed.filter((row): row is UnRealizadoUnitsRow => row != null);
}

export async function listUnRealizadoOperations() {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT op.cod_operacaoagricola AS codigo,
              op.descricao AS nome
         FROM rh.operacaoagricola op
        WHERE op.cod_operacaoagricola IS NOT NULL
        ORDER BY op.cod_operacaoagricola`,
      [],
      { maxRows: 0, fetchArraySize: 1000 },
    );
    const items: UnRealizadoOperation[] = [];
    for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
      const code = codeKey(oracleText(raw, "codigo") || oracleNumber(raw, "codigo"));
      if (!code) continue;
      items.push({ code, label: oracleText(raw, "nome") || code });
    }
    return { items };
  });
}

export async function upsertUnRealizadoSource(input: {
  sheetId: number;
  sourceKind: string;
  metric?: string;
  operations?: { code: string; label?: string }[];
  safraId?: number | null;
}) {
  ensureUnRealizadoSources();
  resolveSafraId(input.safraId);
  if (!isKind(input.sourceKind)) throw new Error("Origem inválida.");
  const metric: UnRealizadoMetric =
    input.sourceKind === "irrigacao"
      ? "area"
      : isMetric(input.metric)
        ? input.metric
        : "area";

  const sheet = db
    .prepare("SELECT id FROM sheets WHERE id = ? AND kind = 'cost_center'")
    .get(input.sheetId) as { id: number } | undefined;
  if (!sheet) throw new Error("Centro de custo não encontrado.");

  const ops =
    input.sourceKind === "irrigacao"
      ? []
      : (input.operations ?? [])
          .map((row) => ({
            code: codeKey(row.code),
            label: (row.label ?? "").trim() || codeKey(row.code),
          }))
          .filter((row) => row.code);
  if (input.sourceKind !== "irrigacao" && !ops.length) {
    throw new Error("Escolha pelo menos um código de operação agrícola.");
  }

  const tx = db.transaction(() => {
    const existing = db
      .prepare("SELECT id FROM un_realizado_sources WHERE sheet_id = ?")
      .get(input.sheetId) as { id: number } | undefined;
    let sourceId = existing?.id ?? 0;
    if (existing) {
      db.prepare("UPDATE un_realizado_sources SET source_kind = ?, metric = ? WHERE id = ?").run(
        input.sourceKind,
        metric,
        existing.id,
      );
      db.prepare("DELETE FROM un_realizado_operations WHERE source_id = ?").run(existing.id);
    } else {
      const result = db
        .prepare("INSERT INTO un_realizado_sources (sheet_id, source_kind, metric) VALUES (?, ?, ?)")
        .run(input.sheetId, input.sourceKind, metric);
      sourceId = Number(result.lastInsertRowid);
    }
    const ins = db.prepare(
      `INSERT INTO un_realizado_operations (source_id, cod_operacaoagricola, label)
       VALUES (?, ?, ?)`,
    );
    for (const op of ops) ins.run(sourceId, op.code, op.label);
  });
  tx();
  return listUnRealizadoSources(input.safraId);
}

export async function deleteUnRealizadoSource(id: number, safraId?: number | null) {
  ensureUnRealizadoSources();
  resolveSafraId(safraId);
  const result = db.prepare("DELETE FROM un_realizado_sources WHERE id = ?").run(id);
  if (!result.changes) throw new Error("Configuração não encontrada.");
  return listUnRealizadoSources(safraId);
}

export function unRealizadoKindOptions() {
  return UN_REALIZADO_KINDS.map((id) => ({
    id,
    label: KIND_LABEL[id],
    needsOperations: id !== "irrigacao",
    metrics: id === "irrigacao" ? (["area"] as UnRealizadoMetric[]) : ([...UN_REALIZADO_METRICS] as UnRealizadoMetric[]),
  }));
}
