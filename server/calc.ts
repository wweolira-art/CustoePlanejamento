import { db } from "./db.js";
import { COST_CENTERS, MONTHS } from "./catalog.js";
import {
  formatDay,
  listCopyRules,
  listCustomSubprocesses,
  listManualMonthKeys,
  listStoredPremissaValues,
  occupiedDestMonths,
  previousSubprocessMonths,
  safraMonthWindows,
  SUBPROCESSES,
  subprocessLabel,
  subprocessMonthValues,
} from "./premissas-dist.js";
import { listSafraBudgetCompare } from "./safra-kpis.js";
import { previousSafra, currentSafraId } from "./safras.js";
import { workbookFromDb } from "./workbook-from-db.js";
import { AUTO_CALC_FORMULA, activityPremiseArea, activityPremiseKey, computeMaterialAutoMonths, isFuelLubricantCategory, isMaintenanceCategory, listReportSubprocesses, materialAreaHa, materialOwnPremiseKey, reducePctFactor } from "./auto-calc.js";
import { lineSafraPriceMap, overlayMaterialPrice } from "./line-prices.js";
import type { BudgetContribution } from "../src/lib/reportAggregate.ts";
import { aggregateResumo } from "../src/lib/reportAggregate.ts";

const asNumber = (v: unknown): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && !v.startsWith("#")) {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const storedNumber = (value: string | null): number => {
  if (value == null) return 0;
  try {
    return asNumber(JSON.parse(value));
  } catch {
    return asNumber(value);
  }
};

const evalMonth = (
  wb: ReturnType<typeof workbookFromDb> | null,
  sheet: string,
  formula: string | null,
  value: string | null,
) => {
  const raw = (formula ?? "").trim();
  if (raw && raw !== AUTO_CALC_FORMULA) {
    const direct = raw.match(/^=\s*(-?\d+(?:[.,]\d+)?)\s*$/);
    if (direct) return asNumber(direct[1]);
    if (wb) return asNumber(wb.evaluateFormula(sheet, raw));
  }
  return storedNumber(value);
};

export function sheetVerified(sheetId: number, safraId = currentSafraId()) {
  const row = db
    .prepare("SELECT 1 AS ok FROM sheet_verifications WHERE sheet_id = ? AND safra_id = ?")
    .get(sheetId, safraId) as { ok: number } | undefined;
  return Boolean(row);
}

export function setSheetVerified(sheetId: number, verified: boolean, safraId = currentSafraId()) {
  if (verified) {
    db.prepare("INSERT OR IGNORE INTO sheet_verifications (sheet_id, safra_id) VALUES (?, ?)").run(sheetId, safraId);
  } else {
    db.prepare("DELETE FROM sheet_verifications WHERE sheet_id = ? AND safra_id = ?").run(sheetId, safraId);
  }
}

export function listSheets() {
  return db
    .prepare(
      `SELECT s.id, s.name, s.title, s.kind, s.sort_order, s.visible,
              CASE WHEN v.sheet_id IS NOT NULL THEN 1 ELSE 0 END AS verified
         FROM sheets s
         LEFT JOIN sheet_verifications v ON v.sheet_id = s.id AND v.safra_id = ?
        ORDER BY s.sort_order, s.id`,
    )
    .all(currentSafraId());
}

export function premissasKpis() {
  const wb = workbookFromDb();
  const n = (row: number, col: number) => asNumber(wb.display("PREMISSAS", row, col));
  const d = (row: number, col: number) => formatDay(wb.display("PREMISSAS", row, col));
  const monthsByKey = subprocessMonthValues();
  const storedValues = listStoredPremissaValues(currentSafraId());
  const manualKeys = new Set(listManualMonthKeys());
  const windows = safraMonthWindows();
  const copies = listCopyRules();
  const copiesByDest = new Map<string, typeof copies>();
  for (const rule of copies) {
    const list = copiesByDest.get(rule.destKey) ?? [];
    list.push(rule);
    copiesByDest.set(rule.destKey, list);
  }
  const prev = previousSafra();
  const previousMonths = previousSubprocessMonths();
  const monthSum = (key: string) => (monthsByKey[key] ?? []).reduce((sum, value) => sum + (value || 0), 0);
  const sourceMonths = (sourceKey: string, scope: "current" | "previous") => {
    if (scope === "previous") return previousMonths.find((row) => row.key === sourceKey)?.months ?? windows.map(() => 0);
    return monthsByKey[sourceKey] ?? windows.map(() => 0);
  };
  const describeCopies = (key: string) =>
    (copiesByDest.get(key) ?? []).map((rule) => ({
      id: rule.id,
      sourceKey: rule.sourceKey,
      sourceName: subprocessLabel(rule.sourceKey, rule.sourceScope === "previous" ? prev?.id : undefined),
      sourceScope: rule.sourceScope,
      sourceSafraLabel: rule.sourceScope === "previous" ? (prev?.label ?? "safra anterior") : "safra atual",
      startMonth: rule.startMonth,
      endMonth: rule.endMonth,
      occupied: occupiedDestMonths(sourceMonths(rule.sourceKey, rule.sourceScope), rule.startMonth, rule.endMonth),
    }));

  const subprocesses = [
    ...SUBPROCESSES.map((spec) => {
      const copyList = describeCopies(spec.key);
      const months = monthsByKey[spec.key] ?? windows.map(() => 0);
      return {
        key: spec.key,
        name: spec.name,
        suffix: spec.suffix,
        builtin: true,
        kind: "subprocess" as const,
        qty: {
          row: spec.qty[0],
          col: spec.qty[1],
          value: copyList.length || manualKeys.has(spec.key) ? monthSum(spec.key) : n(spec.qty[0], spec.qty[1]),
        },
        start: { row: spec.start[0], col: spec.start[1], value: d(spec.start[0], spec.start[1]) },
        end: { row: spec.end[0], col: spec.end[1], value: d(spec.end[0], spec.end[1]) },
        months,
        copies: copyList,
        manualMonths: manualKeys.has(spec.key),
      };
    }),
    ...listCustomSubprocesses().map((spec) => {
      const copyList = describeCopies(spec.key);
      const stored = storedValues.get(spec.key);
      const own = spec.kind === "producao_propria";
      const months = monthsByKey[spec.key] ?? windows.map(() => 0);
      return {
        key: spec.key,
        name: spec.name,
        suffix: spec.suffix,
        builtin: false,
        kind: spec.kind,
        qty: {
          row: 0,
          col: 0,
          value: own
            ? !stored?.startDay && !stored?.endDay && manualKeys.has(spec.key)
              ? 0
              : stored?.qty ?? 0
            : copyList.length || manualKeys.has(spec.key)
              ? monthSum(spec.key)
              : stored?.qty ?? monthSum(spec.key),
        },
        start: own
          ? { row: 0, col: 0, value: stored?.startDay ?? "" }
          : { row: 0, col: 0, value: stored?.startDay ?? "" },
        end: own
          ? { row: 0, col: 0, value: stored?.endDay ?? "" }
          : { row: 0, col: 0, value: stored?.endDay ?? "" },
        months,
        copies: copyList,
        manualMonths: manualKeys.has(spec.key),
      };
    }),
  ];

  return {
    moagem: n(8, 3),
    moagemManual: n(15, 3),
    tch: n(22, 4),
    areaVerao: n(25, 2),
    areaInverno: n(32, 2),
    areaSoca: n(45, 2),
    areaPlanta: n(40, 2),
    inicioColheita: d(4, 4),
    fimColheita: d(4, 5),
    inicioManual: d(13, 4),
    fimManual: d(13, 5),
    inicioVerao: d(27, 4),
    fimVerao: d(28, 4),
    inicioInverno: d(34, 4),
    fimInverno: d(35, 4),
    inicioPlanta: d(42, 4),
    fimPlanta: d(42, 5),
    inicioSoca: d(48, 4),
    fimSoca: d(48, 5),
    months: MONTHS.map((label, i) => ({
      label,
      year: windows[i].year,
      tons: monthsByKey.tons?.[i] ?? 0,
      tonsManual: monthsByKey.tonsManual?.[i] ?? 0,
      haVerao: monthsByKey.haVerao?.[i] ?? 0,
      haInverno: monthsByKey.haInverno?.[i] ?? 0,
      haSoca: monthsByKey.haSoca?.[i] ?? 0,
      haPlanta: monthsByKey.haPlanta?.[i] ?? 0,
    })),
    previousSafra: prev,
    previousSubprocesses: previousSubprocessMonths(),
    subprocesses,
  };
}

export function sheetDetail(sheetId: number, live = true) {
  const sheet = db.prepare("SELECT * FROM sheets WHERE id = ?").get(sheetId) as
    | { id: number; name: string; title: string; kind: string; visible: number }
    | undefined;
  if (!sheet) return null;

  const wb = live ? workbookFromDb() : null;
  const categories = db
    .prepare("SELECT * FROM categories WHERE sheet_id = ? ORDER BY sort_order, id")
    .all(sheetId) as { id: number; name: string }[];

  const lineStmt = db.prepare("SELECT * FROM lines WHERE category_id = ? ORDER BY sort_order, id");
  const monthStmt = db.prepare("SELECT * FROM line_months WHERE line_id = ?");
  const prices = lineSafraPriceMap();

  const out = categories.map((cat) => {
    const raw = (lineStmt.all(cat.id) as LineRow[]).map((line) => {
      const stored = monthStmt.all(line.id) as MonthRow[];
      const byMonth = new Map(stored.map((m) => [m.month_index, m]));
      const months = MONTHS.map((_, i) => {
        const m = byMonth.get(i);
        const value = evalMonth(wb, sheet.name, m?.formula ?? null, m?.value ?? null);
        return { month: i, value, formula: m?.formula ?? null };
      });
      const total = months.reduce((a, m) => a + m.value, 0);
      return { ...overlayMaterialPrice(line, prices), months, total };
    });

    const byId = new Map(raw.map((l) => [l.id, l]));
    const kids = new Map<number, typeof raw>();
    for (const line of raw) {
      if (!line.parent_id) continue;
      const list = kids.get(line.parent_id) ?? [];
      list.push(line);
      kids.set(line.parent_id, list);
    }
    const isCenterGroup = (line: (typeof raw)[number]) => line.ref_kind === "cost_center";
    const isEquipmentHead = (line: (typeof raw)[number]) => {
      if (line.ref_kind === "activity" || isCenterGroup(line)) return false;
      const product = String(line.product_code ?? "").trim();
      if (!product || !line.is_group) return false;
      if (line.ref_kind === "cost_object") return true;
      return !line.parent_id && !line.material_id && (line.item_type === "E" || line.item_type === "G");
    };
    const isFixedCostObjectHead = (line: (typeof raw)[number]) =>
      line.ref_kind === "cost_object" && Boolean(line.is_group) && !isEquipmentHead(line);
    const isActivityLine = (line: (typeof raw)[number]) =>
      line.ref_kind === "activity" ||
      isEquipmentHead(line) ||
      isFixedCostObjectHead(line) ||
      (Boolean(line.is_group) && Boolean(line.activity_id) && !isCenterGroup(line));
    const isHead = (line: (typeof raw)[number]) =>
      isCenterGroup(line) ||
      isActivityLine(line) ||
      (!line.parent_id && (Boolean(line.is_group) || kids.has(line.id)));

    const ownById = new Map<number, number[]>();
    const maintenanceCategory = isMaintenanceCategory(cat.name);
    const fuelCategory = isFuelLubricantCategory(cat.name);
    for (const line of raw) {
      if (!isActivityLine(line) && !(isHead(line) && !isCenterGroup(line))) continue;
      ownById.set(
        line.id,
        line.months.map((m) => {
          const formula = (m.formula ?? "").trim();
          // Manutenção: cabeças de atividade não usam auto — mas equipamento/objeto com cálculo próprio sim.
          if (
            maintenanceCategory &&
            (!formula || formula === AUTO_CALC_FORMULA) &&
            !isEquipmentHead(line) &&
            !isFixedCostObjectHead(line)
          )
            return 0;
          if (fuelCategory && formula === AUTO_CALC_FORMULA) return 0;
          if (formula) return m.value;
          return line.use_activity_auto === 0 ? m.value : 0;
        }),
      );
      const premise = activityPremiseArea(line);
      if (premise) {
        line.premise_ha = premise.total;
        line.premise_ha_months = premise.months;
      }
      const area = materialAreaHa(line, 100);
      if (area) {
        line.area_ha = area.total;
        line.area_ha_months = area.months;
      }
    }
    for (const line of raw) {
      if (!line.parent_id) continue;
      const parent = byId.get(line.parent_id);
      if (!parent) continue;
      if (isActivityLine(line) || isCenterGroup(line)) continue;
      if (line.ref_kind !== "cost_object") {
        line.cost_object_id = parent.cost_object_id;
        line.object_code = parent.object_code;
      }
      line.premise_ha = parent.premise_ha;
      line.premise_ha_months = parent.premise_ha_months;
      if (line.ref_kind === "material" || line.ref_kind === "cost_object") {
        const area = materialAreaHa(parent, line.calc_area_pct, line.calc_area_ha, line.calc_area_premise);
        if (area) {
          line.area_ha = area.total;
          line.area_ha_months = area.months;
        }
        const manual = line.months.some((m) => {
          const formula = (m.formula ?? "").trim();
          return Boolean(formula) && formula !== AUTO_CALC_FORMULA;
        });
        if (!manual) {
          const computed = fuelCategory && !materialOwnPremiseKey(line) ? null : computeMaterialAutoMonths(parent, line);
          if (computed) {
            line.months = computed.map((value, i) => ({
              month: i,
              value,
              formula: AUTO_CALC_FORMULA,
            }));
            line.total = computed.reduce((sum, value) => sum + value, 0);
          }
        }
      }
    }

    const rollupLines = raw
      .filter((line) => isActivityLine(line) || (isHead(line) && !isCenterGroup(line)))
      .map((line) => {
        let depth = 0;
        let cur: (typeof raw)[number] | undefined = line;
        while (cur?.parent_id) {
          depth += 1;
          cur = byId.get(cur.parent_id);
        }
        return { line, depth };
      })
      .sort((a, b) => b.depth - a.depth);
    for (const { line } of rollupLines) {
      const children = (kids.get(line.id) ?? []).filter((c) => {
        if (c.ref_kind === "activity" || c.ref_kind === "cost_center") return false;
        // Equipamento sob atividade/objeto de custo também entra no total do pai.
        if (isEquipmentHead(c)) return true;
        return !c.is_group;
      });
      const own = ownById.get(line.id) ?? MONTHS.map(() => 0);
      line.own_months = own;
      const reduceFactor = reducePctFactor(line.calc_reduce_pct);
      line.months = MONTHS.map((_, i) => {
        const childSum = children.reduce((s, c) => s + (c.months[i]?.value ?? 0), 0);
        return {
          month: i,
          value: ((own[i] ?? 0) + childSum) * reduceFactor,
          formula: null,
        };
      });
      line.total = line.months.reduce((a, m) => a + m.value, 0);
      line.is_group = 1;
      if (reduceFactor !== 1) {
        for (const child of children) {
          const hasFormula = child.months.some((m) => (m.formula ?? "").trim());
          if (!hasFormula) continue;
          child.months = child.months.map((m) => ({ ...m, value: m.value * reduceFactor }));
          child.total = child.months.reduce((sum, m) => sum + m.value, 0);
        }
      }
    }
    for (const line of raw) {
      if (!isCenterGroup(line)) continue;
      const childActs = kids.get(line.id) ?? [];
      line.own_months = MONTHS.map(() => 0);
      line.months = MONTHS.map((_, i) => ({
        month: i,
        value: childActs.reduce((s, c) => s + (c.months[i]?.value ?? 0), 0),
        formula: null,
      }));
      line.total = line.months.reduce((a, m) => a + m.value, 0);
      line.is_group = 1;
    }

    const roots = raw.filter((l) => !l.parent_id);
    const heads = roots.filter((l) => isCenterGroup(l) || isActivityLine(l) || Boolean(l.is_group));
    const others = roots.filter((l) => !heads.includes(l));
    const ordered: typeof raw = [];
    const pushTree = (head: (typeof raw)[number]) => {
      ordered.push(head);
      for (const child of kids.get(head.id) ?? []) {
        if (isActivityLine(child) || isCenterGroup(child)) pushTree(child);
        else ordered.push(child);
      }
    };
    for (const head of [...heads, ...others]) pushTree(head);
    const seen = new Set(ordered.map((l) => l.id));
    for (const line of raw) {
      if (!seen.has(line.id)) ordered.push(line);
    }

    const monthTotals = MONTHS.map((_, i) =>
      ordered.filter((l) => !l.parent_id).reduce((a, l) => a + (l.months[i]?.value ?? 0), 0),
    );
    const total = monthTotals.reduce((a, n) => a + n, 0);
    return { ...cat, lines: ordered, monthTotals, total };
  });

  const monthTotals = MONTHS.map((_, i) => out.reduce((a, c) => a + (c.monthTotals[i] ?? 0), 0));
  return {
    ...sheet,
    verified: sheetVerified(sheetId) ? 1 : 0,
    categories: out,
    monthTotals,
    total: monthTotals.reduce((a, n) => a + n, 0),
    distributions: listValueDistributions(sheetId),
  };
}

export function listValueDistributions(sheetId?: number) {
  const harvestId = currentSafraId();
  const rows = (
    sheetId
      ? db
          .prepare(
            `SELECT d.id, d.created_at, d.activity_id, d.activity_name, d.category_name, d.total_value, d.months
               FROM value_distributions d
              WHERE d.safra_id = ?
                AND EXISTS (
                  SELECT 1 FROM value_distribution_lines l
                   WHERE l.distribution_id = d.id AND l.sheet_id = ?
                )
              ORDER BY d.id DESC`,
          )
          .all(harvestId, sheetId)
      : db
          .prepare(
            `SELECT d.id, d.created_at, d.activity_id, d.activity_name, d.category_name, d.total_value, d.months
               FROM value_distributions d
              WHERE d.safra_id = ?
              ORDER BY d.id DESC`,
          )
          .all(harvestId)
  ) as {
    id: number;
    created_at: string;
    activity_id: number;
    activity_name: string;
    category_name: string;
    total_value: number;
    months: string;
  }[];
  const lineStmt = db.prepare(
    `SELECT l.sheet_id, s.title AS sheet_title
       FROM value_distribution_lines l
       JOIN sheets s ON s.id = l.sheet_id
      WHERE l.distribution_id = ?
      ORDER BY s.sort_order, s.id`,
  );
  return rows.map((row) => {
    let months: number[] = [];
    try {
      months = JSON.parse(row.months) as number[];
    } catch {
      months = [];
    }
    const centers = lineStmt.all(row.id) as { sheet_id: number; sheet_title: string }[];
    return {
      id: row.id,
      createdAt: row.created_at,
      activityId: row.activity_id,
      activityName: row.activity_name,
      categoryName: row.category_name,
      totalValue: row.total_value,
      months,
      centers: centers.map((c) => c.sheet_title),
    };
  });
}

function lineMetrics(
  line: {
    calc_dose?: number | null;
    calc_price?: number | null;
    calc_applications?: number | null;
    calc_area_ha?: number | null;
    calc_area_pct?: number | null;
    calc_direct?: number | null;
    calc_kind?: string | null;
    calc_trips?: number | null;
    calc_machine_qty?: number | null;
    area_ha?: number | null;
    premise_ha?: number | null;
  },
  parentHa?: number | null,
) {
  const direct = Number(line.calc_direct) === 1;
  const trips = line.calc_kind === "trips" || (Number(line.calc_trips) > 0 && Number(line.calc_machine_qty) > 0);
  const qtyHa = !direct && !trips && Number(line.calc_dose) > 0 ? Number(line.calc_dose) : null;
  const price = Number(line.calc_price) > 0 ? Number(line.calc_price) : null;
  const applications = Number(line.calc_applications) > 0 ? Number(line.calc_applications) : null;
  const apps = applications && applications > 0 ? applications : 1;
  const rateHa = qtyHa != null && price != null ? qtyHa * price * apps : null;
  const fixedHa = Number(line.calc_area_ha) > 0 ? Number(line.calc_area_ha) : null;
  const areaFromLine = Number(line.area_ha) > 0 ? Number(line.area_ha) : null;
  const premiseHa = Number(line.premise_ha) > 0 ? Number(line.premise_ha) : null;
  const areaHa = fixedHa ?? areaFromLine ?? premiseHa ?? null;
  const areaPct = fixedHa ? null : Number(line.calc_area_pct) > 0 ? Number(line.calc_area_pct) : null;
  let shareRateHa = rateHa;
  const base = parentHa ?? premiseHa ?? areaFromLine;
  if (rateHa != null && base != null && base > 0) {
    if (fixedHa != null) shareRateHa = rateHa * (fixedHa / base);
    else if (areaPct != null) shareRateHa = rateHa * (areaPct / 100);
  }
  return {
    qtyHa,
    rateHa,
    shareRateHa,
    areaHa,
    areaPct,
    applications: qtyHa != null ? applications ?? 1 : applications,
  };
}

export function collectBudgetContributions(): BudgetContribution[] {
  const sheets = db
    .prepare(
      "SELECT id, name, title FROM sheets WHERE kind = 'cost_center' AND visible = 1 ORDER BY sort_order",
    )
    .all() as { id: number; name: string; title: string }[];
  const activities = db.prepare("SELECT id, code, description FROM activities").all() as {
    id: number;
    code: string;
    description: string;
  }[];
  const materials = db.prepare("SELECT id, code, description, grupo FROM materials").all() as {
    id: number;
    code: string;
    description: string;
    grupo: string | null;
  }[];
  const materialById = new Map(materials.map((row) => [row.id, row]));
  const materialByCode = new Map(materials.map((row) => [String(row.code).trim().toUpperCase(), row]));
  const materialGrupo = (id?: number | null, code?: string | null) => {
    const fromId = id ? materialById.get(id) : undefined;
    if (fromId?.grupo?.trim()) return fromId.grupo.trim();
    const fromCode = code ? materialByCode.get(String(code).trim().toUpperCase()) : undefined;
    return fromCode?.grupo?.trim() || null;
  };
  const objects = db.prepare("SELECT code, description FROM cost_objects").all() as {
    code: string;
    description: string;
  }[];
  const activityLabel = (id: number | null, fallback: string) => {
    const act = id ? activities.find((row) => row.id === id) : undefined;
    return act ? `${act.code} — ${act.description}` : fallback;
  };
  const materialLabel = (
    id: number | null | undefined,
    fallback: string,
    code?: string | null,
  ) => {
    const mat = id ? materialById.get(id) : undefined;
    if (mat) return `${mat.code} — ${mat.description}`;
    const raw = String(code ?? "").trim();
    if (raw && fallback) return `${raw} — ${fallback}`;
    return fallback || raw || "Material";
  };
  const objectLabel = (code: string | null | undefined) => {
    const raw = String(code ?? "").trim();
    if (!raw) return "Sem objeto de custo";
    const found = objects.find((row) => row.code === raw);
    return found ? `${found.code} — ${found.description}` : raw;
  };
  const objectKeyOf = (code: string | null | undefined) => {
    const raw = String(code ?? "").trim();
    if (!raw) return "none";
    const n = Number(raw.replace(",", "."));
    if (Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return raw.toUpperCase();
  };

  const out: BudgetContribution[] = [];
  for (const sheet of sheets) {
    const detail = sheetDetail(sheet.id, false);
    for (const cat of detail?.categories ?? []) {
      const used = new Set<number>();
      const push = (
        months: number[],
        line: {
          id?: number;
          activity_id: number | null;
          material_id?: number | null;
          product_code?: string | null;
          description: string;
          object_code: string | null;
          use_activity_auto?: number | null;
          start_month?: number | null;
          end_month?: number | null;
          calc_premise?: string | null;
          calc_area_premise?: string | null;
          cost_object_id?: number | null;
          calc_dose?: number | null;
          calc_price?: number | null;
          calc_applications?: number | null;
          calc_area_ha?: number | null;
          calc_area_pct?: number | null;
          calc_direct?: number | null;
          area_ha?: number | null;
          premise_ha?: number | null;
        },
        premiseKey: string,
        extra: {
          kind: "activity" | "material" | "line";
          activityKey?: string;
          activityLabel?: string;
          materialKey?: string | null;
          materialLabel?: string | null;
          parentHa?: number | null;
        },
      ) => {
        if (!months.some((value) => value)) return;
        const actLabel = extra.activityLabel ?? activityLabel(line.activity_id, line.description || "Sem atividade");
        const activityKey =
          extra.activityKey ?? (line.activity_id ? `a-${line.activity_id}` : `d-${actLabel.toUpperCase()}`);
        const metrics = lineMetrics(line, extra.parentHa);
        if (extra.kind === "activity") {
          const linkedHa =
            Number(line.premise_ha) > 0 ? Number(line.premise_ha) : Number(line.area_ha) > 0 ? Number(line.area_ha) : metrics.areaHa;
          metrics.areaHa = linkedHa;
          metrics.rateHa = null;
          metrics.shareRateHa = null;
        }
        out.push({
          premiseKey,
          sheetId: sheet.id,
          sheetTitle: sheet.title,
          category: cat.name || "Sem categoria",
          activityKey,
          activityLabel: actLabel,
          objectKey: objectKeyOf(line.object_code),
          objectLabel: objectLabel(line.object_code),
          months,
          kind: extra.kind,
          materialKey: extra.materialKey ?? null,
          materialLabel: extra.materialLabel ?? null,
          grupo: extra.kind === "activity" ? null : materialGrupo(line.material_id, line.product_code),
          ...metrics,
        });
      };

      for (const line of cat.lines) {
        if (line.ref_kind === "cost_center") continue;
        const isEquipment =
          (line.ref_kind === "cost_object" ||
            (!line.parent_id && !line.material_id && (line.item_type === "E" || line.item_type === "G"))) &&
          Boolean(line.is_group) &&
          Boolean(String(line.product_code ?? "").trim()) &&
          line.ref_kind !== "activity" &&
          line.ref_kind !== "cost_center";
        const isFixedCostObject =
          line.ref_kind === "cost_object" && Boolean(line.is_group) && !Boolean(String(line.product_code ?? "").trim());
        const isActivity =
          line.ref_kind === "activity" ||
          isEquipment ||
          isFixedCostObject ||
          (Boolean(line.is_group) && Boolean(line.activity_id));
        const isHead =
          isActivity ||
          (!line.parent_id && (Boolean(line.is_group) || cat.lines.some((child) => child.parent_id === line.id)));
        if (!isHead) continue;
        // Equipamento/objeto aninhado sob outro cabeçalho já entra no total do pai.
        if (line.parent_id) {
          const parent = cat.lines.find((row) => row.id === line.parent_id);
          if (parent && parent.ref_kind !== "cost_center") continue;
        }
        used.add(line.id);
        const children = cat.lines.filter((child) => {
          if (child.parent_id !== line.id) return false;
          if (child.ref_kind === "activity" || child.ref_kind === "cost_center") return false;
          const childEquipment =
            child.ref_kind === "cost_object" &&
            Boolean(child.is_group) &&
            Boolean(String(child.product_code ?? "").trim());
          return !child.is_group || childEquipment;
        });
        for (const child of children) used.add(child.id);
        // sheetDetail já soma filhos em line.months; não somar de novo.
        const months = line.months.map((m) => m.value);
        const actLabel = activityLabel(line.activity_id, line.description || "Sem atividade");
        const activityKey = line.activity_id ? `a-${line.activity_id}` : `d-${actLabel.toUpperCase()}`;
        const parentHa = Number(line.premise_ha) > 0 ? Number(line.premise_ha) : Number(line.area_ha) > 0 ? Number(line.area_ha) : null;
        push(months, line, activityPremiseKey(line), { kind: "activity", activityKey, activityLabel: actLabel });
        for (const child of children) {
          push(
            MONTHS.map((_, i) => child.months[i]?.value ?? 0),
            child,
            activityPremiseKey(line),
            {
              kind: "material",
              activityKey,
              activityLabel: actLabel,
              materialKey: `m-${child.id}`,
              materialLabel: materialLabel(child.material_id, child.description, child.product_code),
              parentHa,
            },
          );
        }
      }

      for (const line of cat.lines) {
        if (used.has(line.id) || line.is_group || line.ref_kind === "activity") continue;
        push(
          MONTHS.map((_, i) => line.months[i]?.value ?? 0),
          line,
          "none",
          { kind: "line" },
        );
      }
    }
  }
  return out;
}

export function resumo() {
  const contributions = collectBudgetContributions();
  const summary = aggregateResumo(contributions);
  return {
    months: MONTHS,
    contributions,
    ...summary,
  };
}

export function persistLineValues(sheetId: number) {
  const detail = sheetDetail(sheetId, true);
  if (!detail) return;
  const upd = db.prepare("UPDATE line_months SET value = ? WHERE line_id = ? AND month_index = ?");
  const ins = db.prepare("INSERT OR IGNORE INTO line_months (line_id, month_index, formula, value) VALUES (?, ?, NULL, ?)");
  const tx = db.transaction(() => {
    db.prepare(
      `DELETE FROM line_months
        WHERE (formula IS NULL OR TRIM(formula) = '')
          AND line_id IN (
            SELECT id FROM lines
             WHERE sheet_id = ?
               AND (
                 ref_kind = 'activity' OR ref_kind = 'cost_center'
                 OR (parent_id IS NULL AND is_group = 1)
               )
          )`,
    ).run(sheetId);
    for (const cat of detail.categories) {
      for (const line of cat.lines) {
        if (line.ref_kind === "activity" || line.ref_kind === "cost_center" || Boolean(line.is_group)) continue;
        if (line.months.some((m) => (m.formula ?? "").trim())) continue;
        for (const m of line.months) {
          const changed = upd.run(JSON.stringify(m.value), line.id, m.month);
          if (!changed.changes) ins.run(line.id, m.month, JSON.stringify(m.value));
        }
      }
    }
  });
  tx();
}

export function persistAllValues() {
  const sheets = db.prepare("SELECT id FROM sheets WHERE kind = 'cost_center' AND visible = 1").all() as { id: number }[];
  for (const s of sheets) persistLineValues(s.id);
}

export function dashboard() {
  const kpis = premissasKpis();
  const summary = resumo();
  const moagemMecanizada =
    kpis.subprocesses?.find((row) => row.key === "tons")?.qty?.value ?? kpis.moagem;
  const moagemManual =
    kpis.subprocesses?.find((row) => row.key === "tonsManual")?.qty?.value ?? kpis.moagemManual;
  const moagem = Number(moagemMecanizada) + Number(moagemManual);
  const labels = listReportSubprocesses();
  const labeled = aggregateResumo(summary.contributions ?? [], labels);
  const snapshot = {
    safraId: currentSafraId(),
    orcamentoTotal: labeled.total,
    moagem,
    costCenters: labeled.views.costCenter.map((row) => ({
      key: row.key,
      label: row.label,
      total: row.total,
    })),
    category: labeled.views.category.map((row) => ({
      key: row.key,
      label: row.label,
      total: row.total,
    })),
  };
  const budgetCompareBySafra = listSafraBudgetCompare(snapshot);
  return {
    kpis,
    resumo: summary,
    reportSubprocesses: labels,
    costPerTonBySafra: budgetCompareBySafra.safras,
    budgetCompareBySafra,
    costCenters: summary.rows.map((r) => ({
      sheetId: r.sheetId,
      name: r.name,
      title: r.title,
      total: r.total,
    })),
    centers: COST_CENTERS,
  };
}

interface LineRow {
  id: number;
  sheet_id: number;
  category_id: number;
  object_code: string | null;
  product_code: string | null;
  item_type: string | null;
  description: string;
  is_group: number;
  sort_order: number;
  activity_id: number | null;
  material_id: number | null;
  cost_object_id: number | null;
  ref_kind: string | null;
  parent_id: number | null;
  center_sheet_id?: number | null;
  use_activity_auto?: number | null;
  start_month?: number | null;
  end_month?: number | null;
  calc_months?: string | null;
  calc_plans?: string | null;
  calc_premise?: string | null;
  calc_dose?: number | null;
  calc_price?: number | null;
  calc_exclude_weekdays?: string | null;
  calc_area_premise?: string | null;
  calc_area_pct?: number | null;
  calc_area_ha?: number | null;
  calc_reduce_pct?: number | null;
  calc_applications?: number | null;
  area_ha?: number | null;
  area_ha_months?: number[] | null;
  premise_ha?: number | null;
  premise_ha_months?: number[] | null;
}

interface MonthRow {
  line_id: number;
  month_index: number;
  formula: string | null;
  value: string | null;
}
