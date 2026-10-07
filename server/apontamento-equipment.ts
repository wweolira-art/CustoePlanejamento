import { ensureActivityLinks } from "./activity-links.js";
import { db } from "./db.js";
import { oracleNumber, oracleText, withOracle } from "./oracle.js";
import { listSafras, resolveSafraId, safraLabel, safraStartYear } from "./safras.js";

export interface ApontamentoEquipmentRate {
  safraId: number;
  safraLabel: string;
  hours: number;
  area: number;
  hoursHa: number;
  apontamentos: number;
  cost: number;
  runHours: number;
  costPerHour: number | null;
  litros: number;
  litrosPorHa: number;
  fuelCost: number;
  costPerLiter: number | null;
}

export interface ApontamentoEquipmentItem {
  code: string;
  description: string;
  rates: ApontamentoEquipmentRate[];
}

export interface ApontamentoEquipmentData {
  activityId: number;
  activityCode: string;
  activityName: string;
  operations: { code: string; label: string }[];
  safras: { id: number; label: string }[];
  fromDate: string;
  toDate: string;
  items: ApontamentoEquipmentItem[];
}

type HourSafra = {
  id: number;
  code: string;
  label: string;
  startYear: number;
};

type DateMode = {
  dateExpr: string | null;
  joinHeader: boolean;
  withDates: boolean;
};

const LOOKBACK_CODES = ["23/24", "24/25"];

function equipmentKey(code: unknown): string {
  const raw = String(code ?? "").trim();
  if (!raw) return "";
  const n = Number(raw.replace(",", "."));
  if (Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return raw.toUpperCase();
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

function isMissingColumn(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /ORA-00904/i.test(message);
}

function hourSafras(currentId: number): HourSafra[] {
  const registered = listSafras();
  const current = registered.find((row) => row.id === currentId);
  const seen = new Set<number>();
  const out: HourSafra[] = [];
  const add = (code: string, id?: number, label?: string) => {
    const startYear = safraStartYear(code);
    if (seen.has(startYear)) return;
    seen.add(startYear);
    const existing = registered.find((row) => safraStartYear(row.code) === startYear);
    out.push({
      id: existing?.id ?? id ?? -startYear,
      code: existing?.code ?? code,
      label: existing?.label ?? label ?? safraLabel(code),
      startYear,
    });
  };
  for (const code of LOOKBACK_CODES) add(code);
  for (const row of registered) add(row.code, row.id, row.label);
  if (current) add(current.code, current.id, current.label);
  return out.sort((a, b) => a.startYear - b.startYear);
}

function safraDates(safra: HourSafra) {
  return {
    fromDate: `${safra.startYear}-09-01`,
    toDate: `${safra.startYear + 1}-08-31`,
  };
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

function equipmentSql(opts: { operationsSql: string; dateExpr: string | null; joinHeader: boolean }) {
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
  return `SELECT i.cod_equipamento,
                 e.descricao,
                 e.placa,
                 SUM(i.km_final - i.km_inicial) AS horas,
                 SUM(i.area) AS area,
                 COUNT(*) AS apontamentos
            FROM automotivo.itens_apontamento i
            ${header}
            LEFT JOIN automotivo.equipamento e
              ON e.cod_equipamento = i.cod_equipamento
           WHERE i.cod_operacaoagricola IN (${opts.operationsSql})
             ${dateClause}
           GROUP BY i.cod_equipamento, e.descricao, e.placa
          HAVING SUM(i.area) > 0
           ORDER BY i.cod_equipamento`;
}

function costSql(equipSql: string) {
  return `SELECT a.cod_equipamento,
                 SUM(NVL(a.quantidade, 0) * NVL(a.vrcustounitario, 0)) AS custo
            FROM material.itensrequisicaomaterial a
           WHERE a.dataretirada IS NOT NULL
             AND a.cod_equipamento IN (${equipSql})
             AND TRUNC(a.dataretirada) BETWEEN TO_DATE(:fromDate, 'YYYY-MM-DD') AND TO_DATE(:toDate, 'YYYY-MM-DD')
           GROUP BY a.cod_equipamento`;
}

function runHoursSql(equipSql: string) {
  return `WITH abastecimentos AS (
      SELECT a.cod_equipamento, a.dtabastecimento AS data_abastecimento, a.kmhs_rodados
        FROM automotivo.abastecimento a
       WHERE a.cod_equipamento IN (${equipSql})
      UNION ALL
      SELECT a.cod_equipamento, a.data, a.kmhs_rodados
        FROM posto.abastecimento a
       WHERE a.cod_equipamento IN (${equipSql})
    )
    SELECT a.cod_equipamento,
           SUM(NVL(a.kmhs_rodados, 0)) AS horas
      FROM abastecimentos a
     WHERE a.data_abastecimento IS NOT NULL
       AND TRUNC(a.data_abastecimento) BETWEEN TO_DATE(:fromDate, 'YYYY-MM-DD') AND TO_DATE(:toDate, 'YYYY-MM-DD')
     GROUP BY a.cod_equipamento`;
}

/** Litros e custo de combustível (mesma lógica do indicador): automotivo com requisição + posto via itensrequisicao. */
function fuelSql(equipSql: string) {
  return `
SELECT cod_equipamento,
       SUM(qtde_litros) AS litros,
       SUM(valor_total) AS valor
  FROM (
    SELECT a.cod_equipamento,
           NVL(a.qtdelitros, 0) AS qtde_litros,
           NVL(a.qtdelitros, 0) * NVL(a.valor_unitario, 0) AS valor_total
      FROM automotivo.abastecimento a
     WHERE a.nrrequisicao IS NOT NULL
       AND a.cod_equipamento IN (${equipSql})
       AND TRUNC(a.dtabastecimento) BETWEEN TO_DATE(:fromDate, 'YYYY-MM-DD') AND TO_DATE(:toDate, 'YYYY-MM-DD')

    UNION ALL

    SELECT a.cod_equipamento,
           NVL(a.qtde_litros, 0) AS qtde_litros,
           NVL((
             SELECT SUM(NVL(c.quantidade, 0) * NVL(c.vrcustounitario, 0))
               FROM posto.abastecimento_itensrequisicao b
               JOIN material.itensrequisicaomaterial c
                 ON b.nrrequisicao = c.nrrequisicao
                AND b.item = c.item
              WHERE b.cod_abast = a.cod_abast
                AND b.cod_grupoempresa = a.cod_grupoempresa
                AND b.cod_empresa = a.cod_empresa
                AND b.cod_filial = a.cod_filial
           ), 0) AS valor_total
      FROM posto.abastecimento a
     WHERE a.cod_equipamento IN (${equipSql})
       AND TRUNC(a.data) BETWEEN TO_DATE(:fromDate, 'YYYY-MM-DD') AND TO_DATE(:toDate, 'YYYY-MM-DD')
  )
 GROUP BY cod_equipamento`;
}

function readNumberMap(rows: Record<string, unknown>[], valueKey: string) {
  const map = new Map<string, number>();
  for (const raw of rows) {
    const code = equipmentKey(oracleText(raw, "cod_equipamento") || oracleNumber(raw, "cod_equipamento"));
    if (!code) continue;
    map.set(code, (map.get(code) ?? 0) + (oracleNumber(raw, valueKey) ?? 0));
  }
  return map;
}

export async function activityApontamentoEquipment(
  activityId: number,
  safraId?: number | null,
): Promise<ApontamentoEquipmentData> {
  ensureActivityLinks();
  const id = Number(activityId);
  const activity = db.prepare("SELECT id, code, description FROM activities WHERE id = ?").get(id) as
    | { id: number; code: string; description: string }
    | undefined;
  if (!activity) throw new Error("Atividade não encontrada.");

  const harvestId = resolveSafraId(safraId);
  const safras = hourSafras(harvestId);
  const fromDate = safras.length ? safraDates(safras[0]).fromDate : "";
  const toDate = safras.length ? safraDates(safras[safras.length - 1]).toDate : "";
  const links = db
    .prepare(
      `SELECT source_code, source_label
         FROM activity_realizado_links
        WHERE activity_id = ? AND source = 'insumo'
        ORDER BY source_code COLLATE NOCASE`,
    )
    .all(id) as { source_code: string; source_label: string | null }[];
  const operations = links
    .map((row) => ({ code: equipmentKey(row.source_code), label: row.source_label?.trim() || row.source_code }))
    .filter((row) => row.code);

  const empty: ApontamentoEquipmentData = {
    activityId: activity.id,
    activityCode: activity.code,
    activityName: activity.description,
    operations,
    safras: safras.map((row) => ({ id: row.id, label: row.label })),
    fromDate,
    toDate,
    items: [],
  };
  if (!operations.length) return empty;

  const { sql: operationsSql, binds: opBinds } = inBinds("o", operations.map((row) => row.code));
  const variants: DateMode[] = [
    { dateExpr: "i.dt_apontamento", joinHeader: false, withDates: true },
    { dateExpr: "a.dt_apontamento", joinHeader: true, withDates: true },
    { dateExpr: null, joinHeader: false, withDates: false },
  ];

  return withOracle(async (conn) => {
    const runApontamento = async (mode: DateMode, from: string, to: string) => {
      const sql = equipmentSql({
        operationsSql,
        dateExpr: mode.dateExpr,
        joinHeader: mode.joinHeader,
      });
      const params = mode.withDates ? { ...opBinds, fromDate: from, toDate: to } : { ...opBinds };
      const result = await conn.execute(sql, params, { maxRows: 0, fetchArraySize: 500 });
      return (result.rows ?? []) as Record<string, unknown>[];
    };

    let mode: DateMode | null = null;
    let lastError: unknown;
    for (const variant of variants) {
      try {
        await runApontamento(variant, fromDate, toDate);
        mode = variant;
        break;
      } catch (err) {
        lastError = err;
        if (!isMissingColumn(err) && variant.dateExpr) throw err;
      }
    }
    if (!mode) {
      throw lastError instanceof Error ? lastError : new Error("Não foi possível consultar os apontamentos dos tratores.");
    }

    const catalog = new Map<string, { code: string; description: string }>();
    const work = new Map<string, Map<number, { hours: number; area: number; apontamentos: number }>>();

    const addRow = (raw: Record<string, unknown>, safra: HourSafra) => {
      const code = equipmentKey(oracleText(raw, "cod_equipamento") || oracleNumber(raw, "cod_equipamento"));
      if (!code) return;
      const hours = oracleNumber(raw, "horas") ?? 0;
      const area = oracleNumber(raw, "area") ?? 0;
      if (!(area > 0) || !(hours > 0)) return;
      const desc = oracleText(raw, "descricao") || `Equipamento ${code}`;
      const placa = oracleText(raw, "placa");
      if (!catalog.has(code)) {
        catalog.set(code, { code, description: placa ? `${desc.trim()} (${placa})` : desc.trim() });
      }
      const bySafra = work.get(code) ?? new Map();
      const prev = bySafra.get(safra.id) ?? { hours: 0, area: 0, apontamentos: 0 };
      bySafra.set(safra.id, {
        hours: prev.hours + hours,
        area: prev.area + area,
        apontamentos: prev.apontamentos + (oracleNumber(raw, "apontamentos") ?? 0),
      });
      work.set(code, bySafra);
    };

    if (mode.withDates) {
      for (const safra of safras) {
        const range = safraDates(safra);
        const rows = await runApontamento(mode, range.fromDate, range.toDate);
        for (const raw of rows) addRow(raw, safra);
      }
    } else {
      const rows = await runApontamento(mode, fromDate, toDate);
      const target = safras[safras.length - 1] ?? safras[0];
      if (target) {
        for (const raw of rows) addRow(raw, target);
      }
    }

    const codes = [...catalog.keys()];
    const costBySafra = new Map<number, Map<string, number>>();
    const runHoursBySafra = new Map<number, Map<string, number>>();
    const litrosBySafra = new Map<number, Map<string, number>>();
    const fuelCostBySafra = new Map<number, Map<string, number>>();
    if (codes.length) {
      const { sql: equipSql, binds: equipBinds } = inBinds("e", codes);
      for (const safra of safras) {
        const range = safraDates(safra);
        const params = { ...equipBinds, fromDate: range.fromDate, toDate: range.toDate };
        const costRes = await conn.execute(costSql(equipSql), params, { maxRows: 0, fetchArraySize: 500 });
        const hourRes = await conn.execute(runHoursSql(equipSql), params, { maxRows: 0, fetchArraySize: 500 });
        costBySafra.set(safra.id, readNumberMap((costRes.rows ?? []) as Record<string, unknown>[], "custo"));
        runHoursBySafra.set(safra.id, readNumberMap((hourRes.rows ?? []) as Record<string, unknown>[], "horas"));
        try {
          const fuelRes = await conn.execute(fuelSql(equipSql), params, { maxRows: 0, fetchArraySize: 500 });
          litrosBySafra.set(safra.id, readNumberMap((fuelRes.rows ?? []) as Record<string, unknown>[], "litros"));
          fuelCostBySafra.set(safra.id, readNumberMap((fuelRes.rows ?? []) as Record<string, unknown>[], "valor"));
        } catch {
          litrosBySafra.set(safra.id, new Map());
          fuelCostBySafra.set(safra.id, new Map());
        }
      }
    }

    const items = [...catalog.values()]
      .sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }))
      .map((eq) => {
        const bySafra = work.get(eq.code) ?? new Map();
        return {
          code: eq.code,
          description: eq.description,
          rates: safras.map((safra) => {
            const workRate = bySafra.get(safra.id);
            const hours = round4(workRate?.hours ?? 0);
            const area = round4(workRate?.area ?? 0);
            const cost = round4(costBySafra.get(safra.id)?.get(eq.code) ?? 0);
            const runHours = round4(runHoursBySafra.get(safra.id)?.get(eq.code) ?? 0);
            const litros = round4(litrosBySafra.get(safra.id)?.get(eq.code) ?? 0);
            const fuelCost = round4(fuelCostBySafra.get(safra.id)?.get(eq.code) ?? 0);
            return {
              safraId: safra.id,
              safraLabel: safra.label,
              hours,
              area,
              hoursHa: area > 0 ? round4(hours / area) : 0,
              apontamentos: workRate?.apontamentos ?? 0,
              cost,
              runHours,
              costPerHour: runHours > 0 ? round4(cost / runHours) : null,
              litros,
              litrosPorHa: area > 0 && litros > 0 ? round4(litros / area) : 0,
              fuelCost,
              costPerLiter: litros > 0 ? round4(fuelCost / litros) : null,
            };
          }),
        };
      });

    return { ...empty, items };
  });
}
