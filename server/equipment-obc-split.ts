import { MONTHS } from "./catalog.js";
import { db } from "./db.js";
import { ensureLineSafraPrices } from "./line-prices.js";
import { oracleNumber, oracleText, withOracle } from "./oracle.js";

const AUTO_CALC_FORMULA = "=AUTOCALC";

const VIGENTE_OBC_SQL = `
  SELECT h.cod_equipamento,
         h.cod_objetocusto
    FROM automotivo.historicoequipamentoobcusto h
   WHERE h.data_final IS NULL
     AND h.cod_empresa = 1
     AND h.cod_filial = 1
     AND h.cod_equipamento IS NOT NULL
     AND h.cod_objetocusto IS NOT NULL
`;

export function costObjectsForEquipmentCode(code: string, map: Map<string, number[]>) {
  return map.get(equipmentKey(code)) ?? [];
}

export function parseEquipmentCodes(raw?: string | null): string[] {
  return [...new Set(String(raw ?? "").split(/[,;]+/).map((item) => item.trim()).filter(Boolean))];
}

export function equipmentCodesFromLine(line: { product_code?: string | null; description?: string | null }) {
  const fromProduct = parseEquipmentCodes(line.product_code);
  if (fromProduct.length) return fromProduct;
  const desc = String(line.description ?? "").trim();
  const single = desc.match(/^(\d+)\s*[—–-]/);
  if (single?.[1]) return [single[1]];
  const multi = desc.match(/\(([^)]+)\)\s*$/);
  if (multi?.[1]) {
    const parsed = parseEquipmentCodes(multi[1]);
    if (parsed.length) return parsed;
  }
  return [];
}

function equipmentKey(code: unknown): string {
  const raw = String(code ?? "").trim();
  if (!raw) return "";
  const n = Number(raw.replace(",", "."));
  if (Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return raw.toUpperCase();
}

function objectKey(code: unknown): string {
  const raw = String(code ?? "").trim();
  if (!raw) return "";
  const n = Number(raw.replace(",", "."));
  if (Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return raw.toUpperCase();
}

export async function loadEquipmentVigenteObcMap(): Promise<Map<string, number[]>> {
  return withOracle(async (conn) => {
    const res = await conn.execute(VIGENTE_OBC_SQL, {}, { maxRows: 0, fetchArraySize: 1000 });
    const out = new Map<string, number[]>();
    for (const raw of (res.rows ?? []) as Record<string, unknown>[]) {
      const eq = equipmentKey(oracleText(raw, "cod_equipamento") || oracleNumber(raw, "cod_equipamento"));
      const obc = oracleNumber(raw, "cod_objetocusto");
      if (!eq || obc == null) continue;
      const list = out.get(eq) ?? [];
      if (!list.includes(obc)) list.push(obc);
      out.set(eq, list);
    }
    return out;
  });
}

function localCostObjectByOracleCode(oracleCode: number) {
  const key = objectKey(oracleCode);
  const rows = db.prepare("SELECT id, code FROM cost_objects").all() as { id: number; code: string }[];
  return rows.find((row) => objectKey(row.code) === key) ?? null;
}

function ensureLocalCostObject(oracleCode: number) {
  const existing = localCostObjectByOracleCode(oracleCode);
  if (existing) return existing;
  const code = String(Math.round(oracleCode));
  try {
    const id = Number(
      db.prepare("INSERT INTO cost_objects (code, description) VALUES (?, ?)").run(code, `Objeto de custo ${code}`)
        .lastInsertRowid,
    );
    return { id, code };
  } catch {
    return localCostObjectByOracleCode(oracleCode);
  }
}

function isHourCostEquipmentLine(line: {
  ref_kind: string | null;
  is_group: number | null;
  parent_id: number | null;
  product_code: string | null;
  description?: string | null;
}) {
  if (line.ref_kind !== "cost_object") return false;
  if (Boolean(line.is_group)) return false;
  if (!line.parent_id) return false;
  return equipmentCodesFromLine(line).length > 0;
}

function readLineMonths(lineId: number) {
  const rows = db
    .prepare("SELECT month_index, formula, value FROM line_months WHERE line_id = ? ORDER BY month_index")
    .all(lineId) as { month_index: number; formula: string | null; value: string | null }[];
  return MONTHS.map((_, i) => {
    const row = rows.find((r) => r.month_index === i);
    if (!row) return 0;
    const formula = (row.formula ?? "").trim();
    if (formula === AUTO_CALC_FORMULA) {
      try {
        const n = Number(row.value ? JSON.parse(row.value) : 0);
        return Number.isFinite(n) ? n : 0;
      } catch {
        return 0;
      }
    }
    if (formula.startsWith("=")) {
      const n = Number(formula.slice(1).replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
    try {
      const n = Number(row.value ? JSON.parse(row.value) : 0);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  });
}

function writeFixedMonths(lineId: number, months: number[]) {
  db.prepare("DELETE FROM line_months WHERE line_id = ?").run(lineId);
  const ins = db.prepare("INSERT INTO line_months (line_id, month_index, formula, value) VALUES (?, ?, ?, ?)");
  for (let i = 0; i < MONTHS.length; i++) {
    const value = Math.round((months[i] ?? 0) * 100) / 100;
    if (!(value > 0)) continue;
    const text = Number.isInteger(value) ? String(value) : String(value);
    ins.run(lineId, i, `=${text}`, JSON.stringify(value));
  }
}

function monthsClose(a: number[], b: number[]) {
  return MONTHS.every((_, i) => Math.abs((a[i] ?? 0) - (b[i] ?? 0)) < 0.02);
}

function sumMonthRows(rows: number[][]) {
  return MONTHS.map((_, i) => rows.reduce((sum, months) => sum + (months[i] ?? 0), 0));
}

function familySourceMonths(states: { months: number[]; auto: boolean }[]) {
  const autoOnes = states.filter((state) => state.auto && state.months.some((value) => value > 0));
  if (autoOnes.length) {
    const unique: number[][] = [];
    for (const state of autoOnes) {
      if (!unique.some((months) => monthsClose(months, state.months))) unique.push(state.months);
    }
    return sumMonthRows(unique);
  }
  return sumMonthRows(states.map((state) => state.months));
}

/** Divide `total` em fatias de centavos cuja soma é exatamente o total arredondado. */
function allocateByWeight(total: number, weights: number[]) {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const totalCents = Math.round(total * 100);
  if (!(weightSum > 0) || !weights.length) return weights.map(() => 0);
  const raw = weights.map((weight) => (totalCents * weight) / weightSum);
  const floors = raw.map((value) => Math.floor(value + 1e-9));
  let leftover = totalCents - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, i) => ({ i, frac: value - Math.floor(value + 1e-9) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floors];
  for (let k = 0; leftover > 0 && k < order.length; k++, leftover--) out[order[k].i] += 1;
  for (let k = order.length - 1; leftover < 0 && k >= 0; k--, leftover++) {
    if (out[order[k].i] > 0) out[order[k].i] -= 1;
  }
  return out.map((cents) => cents / 100);
}

function splitMonthsByWeights(months: number[], weights: number[]) {
  const parts = MONTHS.map((_, i) => allocateByWeight(months[i] ?? 0, weights));
  return weights.map((_, target) => parts.map((row) => row[target] ?? 0));
}

function lineHasAutoCalc(lineId: number) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM line_months
        WHERE line_id = ? AND formula IS NOT NULL AND TRIM(formula) = ?`,
    )
    .get(lineId, AUTO_CALC_FORMULA) as { n: number };
  return row.n > 0;
}

function copySafraPrices(fromId: number, toId: number) {
  if (!fromId || !toId || fromId === toId) return;
  ensureLineSafraPrices();
  db.prepare(
    `INSERT INTO line_safra_prices (line_id, safra_id, calc_price)
     SELECT ?, safra_id, calc_price FROM line_safra_prices WHERE line_id = ?
     ON CONFLICT(line_id, safra_id) DO UPDATE SET calc_price = excluded.calc_price`,
  ).run(toId, fromId);
}

function stampSplitGroup(lineIds: number[], group: string) {
  const upd = db.prepare("UPDATE lines SET obc_split_group = ? WHERE id = ?");
  for (const id of lineIds) upd.run(group, id);
}

function deleteHourCostLine(lineId: number) {
  db.prepare("DELETE FROM line_months WHERE line_id = ?").run(lineId);
  db.prepare("DELETE FROM lines WHERE id = ?").run(lineId);
}

function groupEquipmentByObc(codes: string[], obcMap: Map<string, number[]>) {
  const groups = new Map<number, { codes: string[]; weight: number }>();
  const unassigned: string[] = [];
  for (const code of codes) {
    const key = equipmentKey(code);
    const obcs = obcMap.get(key) ?? [];
    if (!obcs.length) {
      unassigned.push(code);
      continue;
    }
    const part = 1 / obcs.length;
    for (const obc of obcs) {
      const cur = groups.get(obc) ?? { codes: [], weight: 0 };
      if (!cur.codes.includes(code)) cur.codes.push(code);
      cur.weight += part;
      groups.set(obc, cur);
    }
  }
  return { groups, unassigned };
}

function findSiblingLine(parentId: number | null, productCode: string, costObjectId: number | null, excludeId?: number) {
  const row = db
    .prepare(
      `SELECT id FROM lines
        WHERE parent_id IS ?
          AND ref_kind = 'cost_object'
          AND COALESCE(is_group, 0) = 0
          AND product_code = ?
          AND (
            (? IS NULL AND cost_object_id IS NULL)
            OR cost_object_id = ?
          )
          AND (? IS NULL OR id <> ?)
        ORDER BY id
        LIMIT 1`,
    )
    .get(parentId, productCode, costObjectId, costObjectId, excludeId ?? null, excludeId ?? null) as { id: number } | undefined;
  return row?.id ?? null;
}

function upsertSplitLine(
  source: Parameters<typeof cloneLineForObc>[0],
  productCode: string,
  description: string,
  costObjectId: number | null,
  objectCode: string | null,
  months: number[],
  excludeId?: number,
  splitGroup?: string | null,
) {
  const existingId = findSiblingLine(source.parent_id, productCode, costObjectId, excludeId);
  if (existingId) {
    db.prepare("UPDATE lines SET description = ?, object_code = ?, obc_split_group = COALESCE(obc_split_group, ?) WHERE id = ?").run(
      description,
      objectCode,
      splitGroup ?? source.obc_split_group ?? null,
      existingId,
    );
    writeFixedMonths(existingId, months);
    if (source.id) copySafraPrices(source.id, existingId);
    return existingId;
  }
  const newId = cloneLineForObc(source, productCode, description, costObjectId, objectCode, splitGroup);
  writeFixedMonths(newId, months);
  return newId;
}

function cloneLineForObc(
  source: {
    id?: number;
    sheet_id: number;
    category_id: number;
    item_type: string | null;
    activity_id: number | null;
    material_id: number | null;
    parent_id: number | null;
    calc_dose: number | null;
    calc_price: number | null;
    calc_area_premise: string | null;
    calc_area_pct: number | null;
    calc_area_ha: number | null;
    calc_months: string | null;
    calc_applications: number | null;
    calc_kind: string | null;
    calc_trips: number | null;
    calc_machine_qty: number | null;
    calc_hour_interval: number | null;
    sort_order: number;
    obc_split_group?: string | null;
  },
  productCode: string,
  description: string,
  costObjectId: number | null,
  objectCode: string | null,
  splitGroup?: string | null,
) {
  const newId = Number(
    db
      .prepare(
        `INSERT INTO lines (
           sheet_id, category_id, object_code, product_code, item_type, description, is_group, sort_order,
           activity_id, material_id, cost_object_id, ref_kind, parent_id,
           calc_dose, calc_price, calc_area_premise, calc_area_pct, calc_area_ha, calc_months,
           calc_applications, calc_kind, calc_trips, calc_machine_qty, calc_hour_interval, use_activity_auto,
           obc_split_group
         ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'cost_object', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        source.sheet_id,
        source.category_id,
        objectCode,
        productCode,
        source.item_type,
        description,
        source.sort_order,
        source.activity_id,
        source.material_id,
        costObjectId,
        source.parent_id,
        source.calc_dose,
        source.calc_price,
        source.calc_area_premise,
        source.calc_area_pct,
        source.calc_area_ha,
        source.calc_months,
        source.calc_applications,
        source.calc_kind,
        source.calc_trips,
        source.calc_machine_qty,
        source.calc_hour_interval,
        splitGroup ?? source.obc_split_group ?? null,
      ).lastInsertRowid,
  );
  if (source.id) copySafraPrices(source.id, newId);
  return newId;
}

function equipmentDescription(codes: string[], fallback?: string | null) {
  if (!codes.length) return fallback?.trim() || "Equipamento";
  if (codes.length === 1) return fallback?.trim() || `Equipamento ${codes[0]}`;
  return `${codes.length} equipamentos (${codes.join(", ")})`;
}

type HourCostLine = {
  id: number;
  sheet_id: number;
  category_id: number;
  item_type: string | null;
  activity_id: number | null;
  material_id: number | null;
  parent_id: number | null;
  product_code: string | null;
  description: string;
  cost_object_id: number | null;
  object_code: string | null;
  calc_dose: number | null;
  calc_price: number | null;
  calc_area_premise: string | null;
  calc_area_pct: number | null;
  calc_area_ha: number | null;
  calc_months: string | null;
  calc_applications: number | null;
  calc_kind: string | null;
  calc_trips: number | null;
  calc_machine_qty: number | null;
  calc_hour_interval: number | null;
  sort_order: number;
  ref_kind: string | null;
  is_group: number | null;
  obc_split_group: string | null;
};

function buildSplitFamilies(lines: HourCostLine[]) {
  const n = lines.length;
  const parent = lines.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    const codesI = new Set(equipmentCodesFromLine(lines[i]).map(equipmentKey));
    for (let j = i + 1; j < n; j++) {
      if (lines[i].parent_id !== lines[j].parent_id) continue;
      const gi = lines[i].obc_split_group;
      const gj = lines[j].obc_split_group;
      if (gi && gj && gi === gj) {
        union(i, j);
        continue;
      }
      if ([...equipmentCodesFromLine(lines[j]).map(equipmentKey)].some((code) => codesI.has(code))) union(i, j);
    }
  }
  const buckets = new Map<number, HourCostLine[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = buckets.get(root) ?? [];
    list.push(lines[i]);
    buckets.set(root, list);
  }
  return [...buckets.values()];
}

function pickFamilyLine(
  available: HourCostLine[],
  costObjectId: number | null,
  codes: string[],
) {
  if (!available.length) return undefined;
  const codeKey = codes.map(equipmentKey).sort().join(",");
  const byObc = costObjectId != null ? available.find((line) => line.cost_object_id === costObjectId) : undefined;
  if (byObc) return byObc;
  const byCodes = available.find(
    (line) =>
      equipmentCodesFromLine(line)
        .map(equipmentKey)
        .sort()
        .join(",") === codeKey,
  );
  return byCodes ?? available[0];
}

/** Divide linhas de custo/hora com equipamentos entre os objetos de custo vigentes de cada um. */
export async function syncEquipmentHourCostSplit(opts?: { strict?: boolean }) {
  let obcMap: Map<string, number[]>;
  try {
    obcMap = await loadEquipmentVigenteObcMap();
  } catch (e) {
    if (opts?.strict) {
      throw e instanceof Error ? e : new Error("Não foi possível consultar os objetos de custo no Oracle.");
    }
    return;
  }
  if (!obcMap.size) {
    if (opts?.strict) {
      throw new Error("Nenhum vínculo vigente equipamento–objeto de custo encontrado no Oracle.");
    }
    return;
  }

  const lines = db
    .prepare(
      `SELECT id, sheet_id, category_id, item_type, activity_id, material_id, parent_id, product_code, description,
              cost_object_id, object_code, calc_dose, calc_price, calc_area_premise, calc_area_pct, calc_area_ha,
              calc_months, calc_applications, calc_kind, calc_trips, calc_machine_qty, calc_hour_interval,
              sort_order, ref_kind, is_group, obc_split_group
         FROM lines
        WHERE ref_kind = 'cost_object'
          AND COALESCE(is_group, 0) = 0
          AND parent_id IS NOT NULL
          AND (
            TRIM(COALESCE(product_code, '')) <> ''
            OR TRIM(COALESCE(description, '')) LIKE '%—%'
            OR TRIM(COALESCE(description, '')) LIKE '%-%'
          )`,
    )
    .all() as HourCostLine[];

  const candidates = lines.filter((line) => isHourCostEquipmentLine(line) && equipmentCodesFromLine(line).length);
  const families = buildSplitFamilies(candidates);

  const tx = db.transaction(() => {
    for (const family of families) {
      const sourceLine = family[0];
      const codes = [...new Set(family.flatMap((line) => equipmentCodesFromLine(line)))];
      if (!codes.length) continue;

      const { groups, unassigned } = groupEquipmentByObc(codes, obcMap);
      if (!groups.size) continue;

      const states = family.map((line) => ({
        months: readLineMonths(line.id),
        auto: lineHasAutoCalc(line.id),
      }));
      const sourceMonths = familySourceMonths(states);
      if (!sourceMonths.some((value) => value > 0)) continue;

      const entries = [...groups.entries()].sort((a, b) => a[0] - b[0]);
      const skipUnassigned = entries.length === 1 && unassigned.length > 0;
      type Target = {
        obcOracle: number | null;
        codes: string[];
        weight: number;
        costObjectId: number | null;
        objectCode: string | null;
      };
      const targets: Target[] = entries.map(([obcOracle, group]) => {
        const local = ensureLocalCostObject(obcOracle);
        return {
          obcOracle,
          codes: group.codes,
          weight: group.weight,
          costObjectId: local?.id ?? null,
          objectCode: local?.code ?? String(obcOracle),
        };
      });
      if (!skipUnassigned && unassigned.length) {
        targets.push({
          obcOracle: null,
          codes: unassigned,
          weight: unassigned.length,
          costObjectId: sourceLine.cost_object_id,
          objectCode: sourceLine.object_code,
        });
      }

      const totalWeight = targets.reduce((sum, target) => sum + target.weight, 0);
      if (!(totalWeight > 0)) continue;

      const groupKey =
        family.find((line) => line.obc_split_group)?.obc_split_group ?? String(Math.min(...family.map((line) => line.id)));
      const splitValues = targets.length > 1 ? splitMonthsByWeights(sourceMonths, targets.map((target) => target.weight)) : [sourceMonths];

      const available = [...family];
      const used = new Set<number>();
      let sortOrder = Math.max(...family.map((line) => line.sort_order));

      for (let t = 0; t < targets.length; t++) {
        const target = targets[t];
        const months = splitValues[t] ?? sourceMonths;
        const productCode = target.codes.join(",");
        const description = equipmentDescription(target.codes, sourceLine.description);
        const existing = pickFamilyLine(available, target.costObjectId, target.codes);
        if (existing) {
          available.splice(available.indexOf(existing), 1);
          db.prepare(
            "UPDATE lines SET product_code = ?, description = ?, cost_object_id = ?, object_code = ?, obc_split_group = ? WHERE id = ?",
          ).run(productCode, description, target.costObjectId, target.objectCode, groupKey, existing.id);
          writeFixedMonths(existing.id, months);
          if (existing.id !== sourceLine.id) copySafraPrices(sourceLine.id, existing.id);
          used.add(existing.id);
          continue;
        }
        sortOrder += 1;
        const newId = upsertSplitLine(
          { ...sourceLine, sort_order: sortOrder, obc_split_group: groupKey },
          productCode,
          description,
          target.costObjectId,
          target.objectCode,
          months,
          sourceLine.id,
          groupKey,
        );
        used.add(newId);
      }

      stampSplitGroup([...used], groupKey);
      for (const leftover of family) {
        if (!used.has(leftover.id)) deleteHourCostLine(leftover.id);
      }
    }
  });
  tx();
}
