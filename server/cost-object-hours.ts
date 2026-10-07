import { db } from "./db.js";
import { oracleNumber, oracleText, withOracle } from "./oracle.js";
import { listSafras, resolveSafraId, safraLabel, safraStartYear } from "./safras.js";

export interface CostObjectHourRate {
  safraId: number;
  safraLabel: string;
  cost: number;
  hours: number;
  costPerHour: number | null;
}

export interface CostObjectHourCost {
  code: string;
  costObjectId: number | null;
  description: string;
  rates: CostObjectHourRate[];
}

export interface CostObjectHourCostData {
  safras: { id: number; label: string }[];
  items: CostObjectHourCost[];
}

export interface EquipmentHourCost {
  code: string;
  description: string;
  rates: CostObjectHourRate[];
}

export interface EquipmentHourCostData {
  safras: { id: number; label: string }[];
  costObject: { id: number; code: string; description: string };
  items: EquipmentHourCost[];
}

type HourSafra = {
  id: number;
  code: string;
  label: string;
  startYear: number;
};

const LOOKBACK_CODES = ["23/24", "24/25"];

function costObjectKey(code: unknown): string {
  const raw = String(code ?? "").trim();
  if (!raw) return "none";
  const n = Number(raw.replace(",", "."));
  if (Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return raw.toUpperCase();
}

function anomesRange(startYear: number) {
  return { from: startYear * 100 + 9, to: (startYear + 1) * 100 + 8 };
}

function emptyRate(safra: HourSafra): CostObjectHourRate {
  return {
    safraId: safra.id,
    safraLabel: safra.label,
    cost: 0,
    hours: 0,
    costPerHour: null,
  };
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

const COST_SQL = `
  SELECT a.cod_objetocusto,
         SUM(NVL(a.valor, 0)) AS custo
    FROM custo.lancamento_custo a
   WHERE EXISTS (
           SELECT 1
             FROM custo.empenho c
            WHERE a.cod_empenho = c.cod_empenho
              AND c.cod_tipoempenho IN (1, 2)
              AND c.cod_grupoempenho = 20
         )
     AND a.anomes BETWEEN :anomesFrom AND :anomesTo
   GROUP BY a.cod_objetocusto
`;

const HOURS_SQL = `
  WITH histObjCusto AS (
      SELECT
          cod_grupoempresa,
          cod_empresa,
          cod_filial,
          cod_equipamento,
          cod_objetocusto,
          data_inicio,
          data_final
      FROM automotivo.historicoequipamentoobcusto
  ),
  abastecimentos AS (
      SELECT
          i.cod_objetocusto,
          a.dtabastecimento AS data_abastecimento,
          a.kmhs_rodados
      FROM automotivo.abastecimento a
      LEFT JOIN histObjCusto i
          ON a.cod_grupoempresa = i.cod_grupoempresa
         AND a.cod_empresa = i.cod_empresa
         AND a.cod_filial = i.cod_filial
         AND a.cod_equipamento = i.cod_equipamento
         AND TRUNC(a.dtabastecimento)
             BETWEEN TRUNC(i.data_inicio)
             AND TRUNC(NVL(i.data_final, SYSDATE))

      UNION ALL

      SELECT
          i.cod_objetocusto,
          a.data AS data_abastecimento,
          a.kmhs_rodados
      FROM posto.abastecimento a
      LEFT JOIN histObjCusto i
          ON a.cod_grupoempresa = i.cod_grupoempresa
         AND a.cod_empresa = i.cod_empresa
         AND a.cod_filial = i.cod_filial
         AND a.cod_equipamento = i.cod_equipamento
         AND TRUNC(a.data)
             BETWEEN TRUNC(i.data_inicio)
             AND TRUNC(NVL(i.data_final, SYSDATE))
  )
  SELECT a.cod_objetocusto,
         SUM(NVL(a.kmhs_rodados, 0)) AS horas
    FROM abastecimentos a
   WHERE a.cod_objetocusto IS NOT NULL
     AND a.data_abastecimento IS NOT NULL
     AND TRUNC(a.data_abastecimento) BETWEEN TO_DATE(:fromDate, 'YYYY-MM-DD') AND TO_DATE(:toDate, 'YYYY-MM-DD')
   GROUP BY a.cod_objetocusto
`;

export async function costObjectHourCosts(safraId?: number | null): Promise<CostObjectHourCostData> {
  const harvestId = resolveSafraId(safraId);
  const current = listSafras().find((row) => row.id === harvestId);
  if (!current) throw new Error("Safra não encontrada.");
  const safras = hourSafras(harvestId);

  const objects = db
    .prepare("SELECT id, code, description FROM cost_objects ORDER BY code COLLATE NOCASE, description")
    .all() as { id: number; code: string; description: string }[];

  const ratesByKey = new Map<string, CostObjectHourRate[]>();

  await withOracle(async (conn) => {
    for (const safra of safras) {
      const { from: anomesFrom, to: anomesTo } = anomesRange(safra.startYear);
      const fromDate = `${safra.startYear}-09-01`;
      const toDate = `${safra.startYear + 1}-08-31`;
      const costRes = await conn.execute(
        COST_SQL,
        { anomesFrom, anomesTo },
        { maxRows: 0, fetchArraySize: 500 },
      );
      const hourRes = await conn.execute(
        HOURS_SQL,
        { fromDate, toDate },
        { maxRows: 0, fetchArraySize: 500 },
      );

      const costMap = new Map<string, number>();
      for (const raw of (costRes.rows ?? []) as Record<string, unknown>[]) {
        const key = costObjectKey(oracleText(raw, "cod_objetocusto") || oracleNumber(raw, "cod_objetocusto"));
        if (key === "none") continue;
        costMap.set(key, (costMap.get(key) ?? 0) + (oracleNumber(raw, "custo") ?? 0));
      }

      const hourMap = new Map<string, number>();
      for (const raw of (hourRes.rows ?? []) as Record<string, unknown>[]) {
        const key = costObjectKey(oracleText(raw, "cod_objetocusto") || oracleNumber(raw, "cod_objetocusto"));
        if (key === "none") continue;
        hourMap.set(key, (hourMap.get(key) ?? 0) + (oracleNumber(raw, "horas") ?? 0));
      }

      const keys = new Set([...costMap.keys(), ...hourMap.keys()]);
      for (const key of keys) {
        const cost = costMap.get(key) ?? 0;
        const hours = hourMap.get(key) ?? 0;
        const costPerHour = hours > 0 ? Math.round((cost / hours) * 10000) / 10000 : null;
        const list = ratesByKey.get(key) ?? [];
        list.push({
          safraId: safra.id,
          safraLabel: safra.label,
          cost,
          hours,
          costPerHour,
        });
        ratesByKey.set(key, list);
      }
    }
  });

  return {
    safras: safras.map((row) => ({ id: row.id, label: row.label })),
    items: objects.map((obj) => {
      const found = ratesByKey.get(costObjectKey(obj.code)) ?? [];
      return {
        code: obj.code,
        costObjectId: obj.id,
        description: obj.description,
        rates: safras.map((safra) => found.find((row) => row.safraId === safra.id) ?? emptyRate(safra)),
      };
    }),
  };
}

const EQUIP_COST_SQL = `
  SELECT a.cod_equipamento,
         SUM(NVL(a.quantidade, 0) * NVL(a.vrcustounitario, 0)) AS custo
    FROM material.itensrequisicaomaterial a
   WHERE a.dataretirada IS NOT NULL
     AND a.cod_equipamento IS NOT NULL
     AND TRUNC(a.dataretirada) BETWEEN TO_DATE(:fromDate, 'YYYY-MM-DD') AND TO_DATE(:toDate, 'YYYY-MM-DD')
     AND EXISTS (
           SELECT 1
             FROM automotivo.historicoequipamentoobcusto h
            WHERE h.cod_equipamento = a.cod_equipamento
              AND h.cod_objetocusto = :obj
              AND TRUNC(a.dataretirada)
                  BETWEEN TRUNC(h.data_inicio)
                  AND TRUNC(NVL(h.data_final, SYSDATE))
         )
   GROUP BY a.cod_equipamento
`

const EQUIP_HOURS_SQL = `
  WITH histObjCusto AS (
      SELECT
          cod_grupoempresa,
          cod_empresa,
          cod_filial,
          cod_equipamento,
          cod_objetocusto,
          data_inicio,
          data_final
      FROM automotivo.historicoequipamentoobcusto
     WHERE cod_objetocusto = :obj
  ),
  abastecimentos AS (
      SELECT
          a.cod_equipamento,
          a.dtabastecimento AS data_abastecimento,
          a.kmhs_rodados
      FROM automotivo.abastecimento a
      JOIN histObjCusto i
          ON a.cod_grupoempresa = i.cod_grupoempresa
         AND a.cod_empresa = i.cod_empresa
         AND a.cod_filial = i.cod_filial
         AND a.cod_equipamento = i.cod_equipamento
         AND TRUNC(a.dtabastecimento)
             BETWEEN TRUNC(i.data_inicio)
             AND TRUNC(NVL(i.data_final, SYSDATE))

      UNION ALL

      SELECT
          a.cod_equipamento,
          a.data AS data_abastecimento,
          a.kmhs_rodados
      FROM posto.abastecimento a
      JOIN histObjCusto i
          ON a.cod_grupoempresa = i.cod_grupoempresa
         AND a.cod_empresa = i.cod_empresa
         AND a.cod_filial = i.cod_filial
         AND a.cod_equipamento = i.cod_equipamento
         AND TRUNC(a.data)
             BETWEEN TRUNC(i.data_inicio)
             AND TRUNC(NVL(i.data_final, SYSDATE))
  )
  SELECT a.cod_equipamento,
         SUM(NVL(a.kmhs_rodados, 0)) AS horas
    FROM abastecimentos a
   WHERE a.cod_equipamento IS NOT NULL
     AND a.data_abastecimento IS NOT NULL
     AND TRUNC(a.data_abastecimento) BETWEEN TO_DATE(:fromDate, 'YYYY-MM-DD') AND TO_DATE(:toDate, 'YYYY-MM-DD')
   GROUP BY a.cod_equipamento
`;

const EQUIP_LIST_SQL = `
  SELECT DISTINCT h.cod_equipamento,
         e.descricao,
         e.placa
    FROM automotivo.historicoequipamentoobcusto h
    LEFT JOIN automotivo.equipamento e
      ON e.cod_equipamento = h.cod_equipamento
   WHERE h.cod_objetocusto = :obj
   ORDER BY h.cod_equipamento
`;

export async function equipmentHourCosts(costObjectId: number, safraId?: number | null): Promise<EquipmentHourCostData> {
  const harvestId = resolveSafraId(safraId);
  const obj = db.prepare("SELECT id, code, description FROM cost_objects WHERE id = ?").get(costObjectId) as
    | { id: number; code: string; description: string }
    | undefined;
  if (!obj) throw new Error("Objeto de custo não encontrado.");
  const objCode = Number(obj.code.replace(",", "."));
  if (!Number.isFinite(objCode)) throw new Error("O código do objeto de custo precisa ser numérico.");
  const safras = hourSafras(harvestId);

  return withOracle(async (conn) => {
    const listRes = await conn.execute(EQUIP_LIST_SQL, { obj: objCode }, { maxRows: 0, fetchArraySize: 500 });
    const catalog = new Map<string, { code: string; description: string }>();
    for (const raw of (listRes.rows ?? []) as Record<string, unknown>[]) {
      const code = costObjectKey(oracleText(raw, "cod_equipamento") || oracleNumber(raw, "cod_equipamento"));
      if (code === "none") continue;
      const desc = oracleText(raw, "descricao") || `Equipamento ${code}`;
      const placa = oracleText(raw, "placa");
      catalog.set(code, { code, description: placa ? `${desc.trim()} (${placa})` : desc.trim() });
    }

    const ratesByKey = new Map<string, CostObjectHourRate[]>();
    for (const safra of safras) {
      const fromDate = `${safra.startYear}-09-01`;
      const toDate = `${safra.startYear + 1}-08-31`;
      const costRes = await conn.execute(
        EQUIP_COST_SQL,
        { obj: objCode, fromDate, toDate },
        { maxRows: 0, fetchArraySize: 500 },
      );
      const hourRes = await conn.execute(
        EQUIP_HOURS_SQL,
        { obj: objCode, fromDate, toDate },
        { maxRows: 0, fetchArraySize: 500 },
      );

      const costMap = new Map<string, number>();
      for (const raw of (costRes.rows ?? []) as Record<string, unknown>[]) {
        const key = costObjectKey(oracleText(raw, "cod_equipamento") || oracleNumber(raw, "cod_equipamento"));
        if (key === "none") continue;
        costMap.set(key, (costMap.get(key) ?? 0) + (oracleNumber(raw, "custo") ?? 0));
        if (!catalog.has(key)) catalog.set(key, { code: key, description: `Equipamento ${key}` });
      }

      const hourMap = new Map<string, number>();
      for (const raw of (hourRes.rows ?? []) as Record<string, unknown>[]) {
        const key = costObjectKey(oracleText(raw, "cod_equipamento") || oracleNumber(raw, "cod_equipamento"));
        if (key === "none") continue;
        hourMap.set(key, (hourMap.get(key) ?? 0) + (oracleNumber(raw, "horas") ?? 0));
        if (!catalog.has(key)) catalog.set(key, { code: key, description: `Equipamento ${key}` });
      }

      const keys = new Set([...costMap.keys(), ...hourMap.keys()]);
      for (const key of keys) {
        const cost = costMap.get(key) ?? 0;
        const hours = hourMap.get(key) ?? 0;
        const costPerHour = hours > 0 ? Math.round((cost / hours) * 10000) / 10000 : null;
        const list = ratesByKey.get(key) ?? [];
        list.push({
          safraId: safra.id,
          safraLabel: safra.label,
          cost,
          hours,
          costPerHour,
        });
        ratesByKey.set(key, list);
      }
    }

    const items = [...catalog.values()]
      .sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }))
      .map((eq) => {
        const found = ratesByKey.get(eq.code) ?? [];
        return {
          code: eq.code,
          description: eq.description,
          rates: safras.map((safra) => found.find((row) => row.safraId === safra.id) ?? emptyRate(safra)),
        };
      });

    return {
      safras: safras.map((row) => ({ id: row.id, label: row.label })),
      costObject: obj,
      items,
    };
  });
}

export interface EquipmentCatalogItem {
  code: string;
  description: string;
}

export async function listEquipments(): Promise<EquipmentCatalogItem[]> {
  return withOracle(async (conn) => {
    const res = await conn.execute(
      `SELECT e.cod_equipamento, e.descricao, e.placa
         FROM automotivo.equipamento e
        WHERE e.cod_equipamento IS NOT NULL
        ORDER BY e.cod_equipamento`,
      {},
      { maxRows: 0, fetchArraySize: 1000 },
    );
    const items: EquipmentCatalogItem[] = [];
    const seen = new Set<string>();
    for (const raw of (res.rows ?? []) as Record<string, unknown>[]) {
      const code = costObjectKey(oracleText(raw, "cod_equipamento") || oracleNumber(raw, "cod_equipamento"));
      if (code === "none" || seen.has(code)) continue;
      seen.add(code);
      const desc = oracleText(raw, "descricao") || `Equipamento ${code}`;
      const placa = oracleText(raw, "placa");
      items.push({ code, description: placa ? `${desc.trim()} (${placa})` : desc.trim() });
    }
    return items;
  });
}
