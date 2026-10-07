import { db } from "./db.js";
import { currentSafraId, ensureSafras, previousSafra, resolveSafraId, safraStartYear } from "./safras.js";
import { ensureLineSafraPrices } from "./line-prices.js";
import { subprocessMonthValues, listCustomSubprocesses, premiseDaysByMonth } from "./premissas-dist.js";

import { equipmentCodesFromLine, syncEquipmentHourCostSplit } from "./equipment-obc-split.js";

export const AUTO_CALC_FORMULA = "=AUTOCALC";
export const DAYS_PREMISE = "dias";

export function isMaintenanceCategory(name?: string | null) {
  return /manuten/i.test(name ?? "");
}

export function isFuelLubricantCategory(name?: string | null) {
  const n = (name ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return /combustivel/.test(n) && /lubrific/.test(n);
}

const SAFRA_CALENDAR_MONTHS = [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7];
const WEEKDAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export const PREMISE_DRIVERS = [
  { key: "plantio_verao", label: "Plantio de verão" },
  { key: "plantio_inverno", label: "Plantio de inverno" },
  { key: "plantio_total", label: "Plantio total (verão + inverno)" },
  { key: "tratos_planta", label: "Tratos de cana planta" },
  { key: "tratos_soca", label: "Tratos de cana soca" },
  { key: "moagem", label: "Moagem (t)" },
  { key: "tonsManual", label: "Colheita manual (t)" },
] as const;

export function listPremiseDrivers(safraId?: number | null) {
  const custom = listCustomSubprocesses(safraId);
  const subprocess = custom
    .filter((row) => row.kind !== "producao_propria")
    .map((row) => ({ key: row.key, label: row.name }));
  const production = custom
    .filter((row) => row.kind === "producao_propria")
    .map((row) => ({ key: row.key, label: row.name }));
  return [...PREMISE_DRIVERS, ...subprocess, ...production];
}

function isValidPremise(premise: string, safraId?: number | null) {
  if (premise === DAYS_PREMISE) return true;
  return listPremiseDrivers(safraId).some((row) => row.key === premise);
}

export function parseExcludeWeekdays(raw: unknown): number[] {
  let values: unknown[] = [];
  if (Array.isArray(raw)) values = raw;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) values = parsed;
    } catch {
      values = [];
    }
  }
  return [...new Set(values.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort(
    (a, b) => a - b,
  );
}

export function storeExcludeWeekdays(days: number[]) {
  const unique = parseExcludeWeekdays(days);
  return unique.length ? JSON.stringify(unique) : null;
}

function exceptWeekdaysLabel(days: number[]) {
  if (!days.length) return "todos os dias do mês";
  const names = days.map((d) => WEEKDAY_NAMES[d]);
  if (names.length === 1) return `exceto ${names[0]}`;
  if (names.length === 2) return `exceto ${names[0]} e ${names[1]}`;
  return `exceto ${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

function workingDaysInMonth(year: number, month0: number, exclude: number[]) {
  const skip = new Set(exclude);
  const last = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= last; day += 1) {
    const weekday = new Date(Date.UTC(year, month0, day)).getUTCDay();
    if (!skip.has(weekday)) count += 1;
  }
  return count;
}

function workingDaysBySafraMonth(startYear: number, exclude: number[]) {
  return SAFRA_CALENDAR_MONTHS.map((month) => {
    const year = month >= 8 ? startYear : startYear + 1;
    return workingDaysInMonth(year, month, exclude);
  });
}

function harvestStartYear(safraId: number) {
  const row = db.prepare("SELECT code FROM safras WHERE id = ?").get(safraId) as { code: string } | undefined;
  return row ? safraStartYear(row.code) : safraStartYear("26/27");
}

function isDaysRule(premise: string) {
  return premise === DAYS_PREMISE;
}

function ruleCalcMode(row: { calc_mode?: unknown; premise?: string | null }): "area" | "days" | "hours" {
  if (row.calc_mode === "hours") return "hours";
  if (row.calc_mode === "days" || isDaysRule(String(row.premise ?? ""))) return "days";
  return "area";
}

function isHoursRule(row: { calc_mode?: unknown; premise?: string | null }) {
  return ruleCalcMode(row) === "hours";
}

function hoursQuantity(rateHa: number | null | undefined) {
  const n = Number(rateHa);
  return n > 0 ? n : 1;
}

function storedCalcMode(hoursMode: boolean, daysMode: boolean): "area" | "days" | "hours" {
  if (hoursMode) return "hours";
  if (daysMode) return "days";
  return "area";
}

function driverLabel(premise: string, safraId?: number | null) {
  return listPremiseDrivers(safraId).find((d) => d.key === premise)?.label ?? premise;
}

function resolveAreaPremise(raw: string | null | undefined, harvestId: number) {
  const key = (raw ?? "").trim();
  if (!key || key === DAYS_PREMISE) return null;
  if (!listPremiseDrivers(harvestId).some((row) => row.key === key)) {
    throw new Error("Subprocesso inválido.");
  }
  return key;
}

function gateMonthsByArea(months: number[], areaPremise: string | null) {
  if (!areaPremise) return months;
  const ha = premiseMonthSeries(areaPremise);
  return months.map((value, i) => ((ha[i] ?? 0) > 0 ? value : 0));
}

function monthInPeriod(index: number, start: number, end: number) {
  if (start <= end) return index >= start && index <= end;
  return index >= start || index <= end;
}

export function gateMonthsByPeriod(months: number[], start: number | null, end: number | null) {
  if (start == null || end == null) return months.map(() => 0);
  return months.map((value, i) => (monthInPeriod(i, start, end) ? value : 0));
}

export function clampMonth(value: unknown) {
  const month = Number(value);
  if (!Number.isInteger(month) || month < 0 || month > 11) return null;
  return month;
}

export function resolveFillPeriod(useActivityAuto: boolean, startMonth: unknown, endMonth: unknown) {
  if (useActivityAuto) return { useActivityAuto: true, startMonth: null as number | null, endMonth: null as number | null };
  const start = clampMonth(startMonth) ?? 0;
  const end = clampMonth(endMonth) ?? 11;
  return { useActivityAuto: false, startMonth: start, endMonth: end };
}

export function parseCalcMonths(raw: unknown): number[] | null {
  let values: unknown[] = [];
  if (Array.isArray(raw)) values = raw;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) values = parsed;
    } catch {
      return null;
    }
  } else {
    return null;
  }
  const months = [...new Set(values.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 11))].sort(
    (a, b) => a - b,
  );
  if (!months.length || months.length === 12) return null;
  return months;
}

export function storeCalcMonths(raw: unknown): string | null {
  const months = parseCalcMonths(raw);
  return months ? JSON.stringify(months) : null;
}

export type StoredCalcPlan = {
  mode: "area" | "days" | "fixed";
  months: number[] | null;
  dose: number | null;
  price: number | null;
  areaPct: number | null;
  excludeWeekdays: number[] | null;
  followArea: boolean;
};

function parsePlanMonths(raw: unknown): number[] | null | undefined {
  if (raw == null) return null;
  let values: unknown[] = [];
  if (Array.isArray(raw)) values = raw;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return null;
      values = parsed;
    } catch {
      return null;
    }
  } else {
    return null;
  }
  const months = [...new Set(values.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 11))].sort(
    (a, b) => a - b,
  );
  if (!months.length) return [];
  if (months.length === 12) return null;
  return months;
}

export function parseCalcPlans(raw: unknown): StoredCalcPlan[] {
  let items: unknown[] = [];
  if (Array.isArray(raw)) items = raw;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      return [];
    }
  }
  const plans: StoredCalcPlan[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const mode = row.mode === "days" || row.mode === "fixed" ? row.mode : "area";
    const months = parsePlanMonths(row.months);
    if (months && !months.length) continue;
    const dose = Number(row.dose);
    const price = Number(row.price);
    const areaPct = Number(row.areaPct);
    plans.push({
      mode,
      months: months === undefined ? null : months,
      dose: Number.isFinite(dose) && dose > 0 ? dose : null,
      price: Number.isFinite(price) && price > 0 ? price : null,
      areaPct: Number.isFinite(areaPct) && areaPct > 0 ? areaPct : 100,
      excludeWeekdays: parseExcludeWeekdays(row.excludeWeekdays),
      followArea: Boolean(row.followArea),
    });
  }
  return plans;
}

export function storeCalcPlans(raw: unknown): string | null {
  const plans = parseCalcPlans(raw);
  return plans.length ? JSON.stringify(plans) : null;
}

function overlaySelected(base: number[], extra: number[], selected: number[] | null) {
  const allow = selected?.length ? new Set(selected) : null;
  return base.map((value, i) => (allow == null || allow.has(i) ? extra[i] ?? 0 : value));
}

function gateMonthsByAnyArea(months: number[], keys: string[]) {
  if (!keys.length) return months;
  const flags = Array.from({ length: 12 }, () => false);
  for (const key of keys) {
    const ha = premiseMonthSeries(key);
    for (let i = 0; i < 12; i++) if ((ha[i] ?? 0) > 0) flags[i] = true;
  }
  return months.map((value, i) => (flags[i] ? value : 0));
}

function periodFromPlanMonths(months: number[] | null): { startMonth: number; endMonth: number } {
  if (!months?.length) return { startMonth: 0, endMonth: 11 };
  return { startMonth: Math.min(...months), endMonth: Math.max(...months) };
}

export function gateMonthsBySelection(months: number[], selected: number[] | null) {
  if (!selected?.length) return months;
  const allow = new Set(selected);
  return months.map((value, i) => (allow.has(i) ? value : 0));
}

export interface LineCalcInput {
  useActivityAuto?: boolean;
  activityId?: number | null;
  costObjectId?: number | null;
  startMonth?: number | null;
  endMonth?: number | null;
  calcMonths?: number[] | string | null;
  calcPlans?: unknown;
  calcMode?: "area" | "days";
  calcPremise?: string | null;
  calcDose?: number | null;
  calcPrice?: number | null;
  calcExcludeWeekdays?: number[] | null;
  calcAreaPremise?: string | null;
  calcAreaPct?: number | null;
}

function emptyLineCalc(useActivityAuto: boolean, period: { startMonth: number | null; endMonth: number | null }, calcPlans: string | null) {
  return {
    useActivityAuto,
    startMonth: period.startMonth,
    endMonth: period.endMonth,
    calcMonths: null as string | null,
    calcPlans,
    calcPremise: null as string | null,
    calcDose: null as number | null,
    calcPrice: null as number | null,
    calcExcludeWeekdays: null as string | null,
    calcAreaPremise: null as string | null,
    calcAreaPct: null as number | null,
  };
}

export function resolveLineCalc(input: LineCalcInput, harvestId?: number | null) {
  const plans = parseCalcPlans(input.calcPlans);
  const calcPlans = storeCalcPlans(plans);
  const firstFormula = plans.find((plan) => plan.mode === "area" || plan.mode === "days");
  if (input.useActivityAuto !== false) {
    return {
      useActivityAuto: true,
      startMonth: null as number | null,
      endMonth: null as number | null,
      calcMonths: storeCalcMonths(input.calcMonths),
      calcPlans,
      calcPremise: null as string | null,
      calcDose: null as number | null,
      calcPrice: null as number | null,
      calcExcludeWeekdays: null as string | null,
      calcAreaPremise: null as string | null,
      calcAreaPct: null as number | null,
    };
  }
  const harvest = resolveSafraId(harvestId);
  const formulaInput = firstFormula
    ? {
        calcMode: firstFormula.mode as "area" | "days",
        calcPremise: firstFormula.mode === "days" ? DAYS_PREMISE : (input.calcPremise ?? input.calcAreaPremise ?? null),
        calcDose: firstFormula.dose,
        calcPrice: firstFormula.price,
        calcExcludeWeekdays: firstFormula.excludeWeekdays,
        followArea: firstFormula.followArea,
        calcAreaPremise: firstFormula.mode === "days"
          ? (firstFormula.followArea ? (input.calcAreaPremise ?? input.calcPremise ?? null) : null)
          : (input.calcPremise ?? input.calcAreaPremise ?? null),
        calcAreaPct: firstFormula.areaPct,
        startMonth: periodFromPlanMonths(firstFormula.months).startMonth,
        endMonth: periodFromPlanMonths(firstFormula.months).endMonth,
      }
    : {
        calcMode: input.calcMode,
        calcPremise: input.calcPremise,
        calcDose: input.calcDose,
        calcPrice: input.calcPrice,
        calcExcludeWeekdays: input.calcExcludeWeekdays,
        followArea: Boolean(input.calcAreaPremise),
        calcAreaPremise: input.calcAreaPremise,
        calcAreaPct: input.calcAreaPct,
        startMonth: input.startMonth,
        endMonth: input.endMonth,
      };
  const period = resolveFillPeriod(false, formulaInput.startMonth, formulaInput.endMonth);
  const daysMode = formulaInput.calcMode === "days" || formulaInput.calcPremise === DAYS_PREMISE;
  const hasRate =
    Number(formulaInput.calcPrice) > 0 && (Number(formulaInput.calcDose) > 0 || daysMode);
  if (!hasRate) {
    return emptyLineCalc(false, period, calcPlans);
  }
  const autoPremise = lookupActivityAutoAreaPremise(input.activityId, input.costObjectId, harvest);
  const premise = daysMode ? DAYS_PREMISE : (autoPremise ?? (formulaInput.calcPremise ?? "").trim());
  if (!premise) {
    throw new Error(
      daysMode
        ? "Informe se o cálculo é por área ou por dia."
        : input.activityId
          ? "Esta atividade não tem premissa de área no cálculo automático."
          : "Selecione a premissa da área.",
    );
  }
  if (!isValidPremise(premise, harvest)) throw new Error("Premissa inválida.");
  const dose = Number(formulaInput.calcDose) > 0 ? Number(formulaInput.calcDose) : daysMode ? 1 : NaN;
  if (!(dose > 0)) throw new Error("Informe a quantidade.");
  const price = Number(formulaInput.calcPrice);
  if (!(price > 0)) throw new Error("Informe o preço.");
  const areaPctRaw = Number(formulaInput.calcAreaPct);
  const calcAreaPct = Number.isFinite(areaPctRaw) && areaPctRaw > 0 ? areaPctRaw : 100;
  if (!(calcAreaPct > 0) || calcAreaPct > 100) throw new Error("Informe o percentual da área (maior que 0 até 100).");
  return {
    useActivityAuto: false,
    startMonth: period.startMonth,
    endMonth: period.endMonth,
    calcMonths: null as string | null,
    calcPlans,
    calcPremise: premise,
    calcDose: dose,
    calcPrice: price,
    calcExcludeWeekdays: daysMode ? storeExcludeWeekdays(formulaInput.calcExcludeWeekdays ?? []) : null,
    calcAreaPremise: daysMode && formulaInput.followArea
      ? resolveAreaPremise(autoPremise ?? formulaInput.calcAreaPremise, harvest)
      : null,
    calcAreaPct,
  };
}

function computeCalcWeights(opts: {
  premise: string | null;
  excludeWeekdays: string | null;
  areaPremise: string | null;
  startYear: number;
  startMonth?: number | null;
  endMonth?: number | null;
  usePeriod?: boolean;
}) {
  if (!opts.premise) return null;
  let weights: number[];
  if (isDaysRule(opts.premise)) {
    weights = workingDaysBySafraMonth(opts.startYear, parseExcludeWeekdays(opts.excludeWeekdays));
    weights = gateMonthsByArea(weights, opts.areaPremise);
  } else {
    weights = premiseMonthSeries(opts.premise).map((qty) => roundPremiseQty(qty));
  }
  if (opts.usePeriod) {
    weights = gateMonthsByPeriod(weights, clampMonth(opts.startMonth), clampMonth(opts.endMonth));
  }
  return weights;
}

function computeCalcMonths(opts: {
  premise: string | null;
  dose: number | null;
  price: number | null;
  excludeWeekdays: string | null;
  areaPremise: string | null;
  startYear: number;
  areaPct?: number | null;
}) {
  const weights = computeCalcWeights({
    premise: opts.premise,
    excludeWeekdays: opts.excludeWeekdays,
    areaPremise: opts.areaPremise,
    startYear: opts.startYear,
  });
  if (!weights) return null;
  const qty = Number(opts.dose) > 0 ? Number(opts.dose) : opts.premise && isDaysRule(opts.premise) ? 1 : NaN;
  const price = Number(opts.price);
  if (!(qty > 0) || !(price > 0)) return null;
  const factor = isDaysRule(opts.premise) ? 1 : areaPctFactor(opts.areaPct);
  return weights.map((weight) => weight * qty * price * factor);
}

function planAreaKeys(
  line: {
    activity_id?: number | null;
    cost_object_id?: number | null;
    description?: string | null;
    calc_premise?: string | null;
    calc_area_premise?: string | null;
  },
) {
  const fromRules = lookupActivityAutoAreaPremises(line.activity_id, line.cost_object_id, null, line.description);
  if (fromRules.length) return fromRules;
  const fallback = [line.calc_area_premise, line.calc_premise]
    .map((key) => canonicalPremiseKey(key))
    .filter((key) => key && key !== "none" && !isDaysRule(key));
  return [...new Set(fallback)];
}

function computeActivityPlanMonths(
  plan: StoredCalcPlan,
  line: {
    activity_id?: number | null;
    cost_object_id?: number | null;
    description?: string | null;
    calc_premise?: string | null;
    calc_area_premise?: string | null;
  },
  startYear: number,
): number[] | null {
  if (plan.mode === "fixed") {
    const qty = Number(plan.dose) > 0 ? Number(plan.dose) : 1;
    const price = Number(plan.price);
    if (!(price > 0)) return null;
    const monthly = qty * price;
    return Array.from({ length: 12 }, () => monthly);
  }
  const areaKeys = planAreaKeys(line);
  if (plan.mode === "days") {
    const computed = computeCalcMonths({
      premise: DAYS_PREMISE,
      dose: plan.dose,
      price: plan.price,
      excludeWeekdays: storeExcludeWeekdays(plan.excludeWeekdays ?? []),
      areaPremise: null,
      startYear,
    });
    if (!computed) return null;
    return plan.followArea ? gateMonthsByAnyArea(computed, areaKeys) : computed;
  }
  if (!areaKeys.length) return null;
  const months = Array.from({ length: 12 }, () => 0);
  let wrote = false;
  for (const key of areaKeys) {
    const part = computeCalcMonths({
      premise: key,
      dose: plan.dose,
      price: plan.price,
      excludeWeekdays: null,
      areaPremise: null,
      startYear,
      areaPct: plan.areaPct,
    });
    if (!part) continue;
    addMonths(months, part);
    wrote = true;
  }
  return wrote ? months : null;
}

function overlayActivityPlans(
  base: number[],
  plans: StoredCalcPlan[],
  line: {
    activity_id?: number | null;
    cost_object_id?: number | null;
    description?: string | null;
    calc_premise?: string | null;
    calc_area_premise?: string | null;
  },
  startYear: number,
) {
  let months = [...base];
  let wrote = false;
  for (const plan of plans) {
    const extra = computeActivityPlanMonths(plan, line, startYear);
    if (!extra) continue;
    months = overlaySelected(months, extra, plan.months);
    wrote = true;
  }
  return { months, wrote };
}

function areaPctFactor(pct: number | null | undefined) {
  const n = Number(pct);
  if (!(n > 0)) return 1;
  return n / 100;
}

/** Fração restante após redução (ex.: 10% → 0,9). 0 ou vazio = sem redução. */
export function reducePctFactor(pct: number | null | undefined) {
  const n = Number(pct);
  if (!(n > 0)) return 1;
  if (n >= 100) return 0;
  return 1 - n / 100;
}

export function applyReducePct(months: number[], pct: number | null | undefined) {
  const factor = reducePctFactor(pct);
  if (factor === 1) return months;
  return months.map((value) => value * factor);
}

export function resolveReducePct(raw: unknown) {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error("Informe a redução em percentual (0 a 100).");
  }
  return n > 0 ? n : null;
}

function areaScale(weights: number[], areaPct?: number | null, areaHa?: number | null) {
  const ha = Number(areaHa);
  if (ha > 0) {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (!(total > 0)) return null;
    return ha / total;
  }
  return areaPctFactor(areaPct);
}

export function applicationsFactor(raw: unknown) {
  const n = Number(raw);
  return n > 0 ? n : 1;
}

export function resolveApplications(raw: unknown) {
  if (raw == null || raw === "") return 1;
  const text = String(raw).replace(",", ".").replace(/x$/i, "").trim();
  if (!text) return 1;
  const n = Number(text);
  if (!(n > 0)) throw new Error("Informe a quantidade de aplicações.");
  return n;
}

function scaleWeights(
  weights: number[],
  dose: number | null,
  price: number | null,
  areaPct?: number | null,
  areaHa?: number | null,
  applications?: number | null,
) {
  const qty = Number(dose);
  const unit = Number(price);
  if (!(qty > 0) || !(unit > 0)) return null;
  const factor = areaScale(weights, areaPct, areaHa);
  if (factor == null) return null;
  const apps = applicationsFactor(applications);
  return weights.map((weight) => weight * factor * qty * unit * apps);
}

type ActivityAreaRef = {
  id?: number | null;
  activity_id?: number | null;
  description?: string | null;
  parent_id?: number | null;
  category_name?: string | null;
  use_activity_auto?: number | null;
  start_month?: number | null;
  end_month?: number | null;
  calc_months?: string | null;
  calc_plans?: string | null;
  calc_premise?: string | null;
  calc_exclude_weekdays?: string | null;
  calc_area_premise?: string | null;
  calc_area_pct?: number | null;
  calc_area_ha?: number | null;
  cost_object_id?: number | null;
};

export function linkedActivityAreaRef<T extends ActivityAreaRef>(line: T): T {
  if (!line.activity_id || !line.parent_id) return line;
  const parent = db
    .prepare("SELECT ref_kind, center_sheet_id FROM lines WHERE id = ?")
    .get(line.parent_id) as { ref_kind: string | null; center_sheet_id: number | null } | undefined;
  if (parent?.ref_kind !== "cost_center" || !parent.center_sheet_id) return line;
  const source = db
    .prepare(
      `SELECT use_activity_auto, start_month, end_month, calc_months, calc_plans, calc_premise, calc_exclude_weekdays,
              calc_area_premise, calc_area_pct, calc_area_ha, cost_object_id, description
         FROM lines
        WHERE sheet_id = ? AND activity_id = ? AND ref_kind = 'activity' AND parent_id IS NULL
        ORDER BY id
        LIMIT 1`,
    )
    .get(parent.center_sheet_id, line.activity_id) as
    | {
        use_activity_auto: number | null;
        start_month: number | null;
        end_month: number | null;
        calc_months: string | null;
        calc_plans: string | null;
        calc_premise: string | null;
        calc_exclude_weekdays: string | null;
        calc_area_premise: string | null;
        calc_area_pct: number | null;
        calc_area_ha: number | null;
        cost_object_id: number | null;
        description: string;
      }
    | undefined;
  if (!source) return line;
  return {
    ...line,
    use_activity_auto: source.use_activity_auto,
    start_month: source.start_month,
    end_month: source.end_month,
    calc_months: source.calc_months,
    calc_plans: source.calc_plans,
    calc_premise: source.calc_premise,
    calc_exclude_weekdays: source.calc_exclude_weekdays,
    calc_area_premise: source.calc_area_premise,
    calc_area_pct: source.calc_area_pct,
    calc_area_ha: source.calc_area_ha,
    cost_object_id: line.cost_object_id ?? source.cost_object_id,
  };
}

type ActivityAreaPlan = {
  full: number[];
  active: number[];
  total: number;
};

function foldActivityName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

function editDistance(a: string, b: string) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const next = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + cost);
      diag = next;
    }
  }
  return prev[n];
}

function matchActivityIdFromList(
  activities: { id: number; description: string }[],
  description: string | null | undefined,
) {
  const raw = (description ?? "").trim().toUpperCase();
  if (!raw) return null;
  const exact = activities.find((row) => row.description.trim().toUpperCase() === raw);
  if (exact) return exact.id;
  const folded = foldActivityName(raw);
  if (!folded) return null;
  const sameFold = activities.filter((row) => foldActivityName(row.description) === folded);
  if (sameFold.length === 1) return sameFold[0].id;
  const scored = activities
    .map((row) => ({ id: row.id, dist: editDistance(folded, foldActivityName(row.description)) }))
    .filter((row) => row.dist > 0 && row.dist <= 2);
  scored.sort((a, b) => a.dist - b.dist);
  if (!scored.length) return null;
  const best = scored[0].dist;
  const ties = scored.filter((row) => row.dist === best);
  return ties.length === 1 ? ties[0].id : null;
}

function relinkActivityHeads() {
  const activities = db.prepare("SELECT id, description FROM activities").all() as { id: number; description: string }[];
  const heads = db
    .prepare(
      `SELECT id, description FROM lines
        WHERE parent_id IS NULL AND activity_id IS NULL
          AND (ref_kind = 'activity' OR ref_kind IS NULL OR TRIM(COALESCE(ref_kind, '')) = '')
          AND (
            is_group = 1
            OR id IN (SELECT DISTINCT parent_id FROM lines WHERE parent_id IS NOT NULL)
          )`,
    )
    .all() as { id: number; description: string }[];
  const upd = db.prepare("UPDATE lines SET activity_id = ?, ref_kind = 'activity' WHERE id = ?");
  for (const head of heads) {
    const matched = matchActivityIdFromList(activities, head.description);
    if (matched) upd.run(matched, head.id);
  }
}

const PREMISE_ALIASES: Record<string, string> = {
  haVerao: "plantio_verao",
  haInverno: "plantio_inverno",
  haPlanta: "tratos_planta",
  haSoca: "tratos_soca",
  tons: "moagem",
};

export function canonicalPremiseKey(raw?: string | null) {
  const key = (raw ?? "").trim();
  if (!key) return "none";
  return PREMISE_ALIASES[key] ?? key;
}

export function listReportSubprocesses(safraId?: number | null) {
  const seen = new Set<string>();
  const out: { key: string; label: string }[] = [];
  const add = (key: string, label: string) => {
    const canon = canonicalPremiseKey(key);
    if (seen.has(canon)) return;
    seen.add(canon);
    out.push({ key: canon, label });
  };
  for (const spec of [
    { key: "plantio_verao", label: "Plantio de verão" },
    { key: "plantio_inverno", label: "Plantio de inverno" },
    { key: "plantio_total", label: "Plantio total (verão + inverno)" },
    { key: "tratos_planta", label: "Tratos de cana planta" },
    { key: "tratos_soca", label: "Tratos de cana soca" },
    { key: "moagem", label: "Colheita mecanizada" },
    { key: "tonsManual", label: "Colheita manual" },
  ]) {
    add(spec.key, spec.label);
  }
  for (const row of listPremiseDrivers(safraId)) add(row.key, row.label);
  add("dias", "Por dia");
  add("none", "Sem subprocesso");
  return out;
}

function matchingActivityAreaRules(
  activityId?: number | null,
  costObjectId?: number | null,
  harvestId?: number | null,
  description?: string | null,
) {
  ensureCalcParams();
  const harvest = resolveSafraId(harvestId);
  let resolvedId = activityId ? Number(activityId) : 0;
  if (!resolvedId && description) {
    const activities = db.prepare("SELECT id, description FROM activities").all() as { id: number; description: string }[];
    resolvedId = matchActivityIdFromList(activities, description) ?? 0;
  }
  if (!resolvedId) return [] as { id: number; premise: string; area_premise: string | null; calc_mode?: string | null }[];
  const rules = db
    .prepare(
      `SELECT id, premise, area_premise, calc_mode
         FROM calc_params
        WHERE safra_id = ? AND kind = 'activity' AND activity_id = ?
        ORDER BY from_materials DESC, id DESC`,
    )
    .all(harvest, resolvedId) as { id: number; premise: string; area_premise: string | null; calc_mode?: string | null }[];
  const links = loadRuleCostObjectMap();
  const matching = rules.filter((row) => {
    const ids = links.get(row.id) ?? [];
    if (!ids.length) return true;
    return costObjectId != null && ids.includes(costObjectId);
  });
  const specific = matching.filter((row) => (links.get(row.id) ?? []).length > 0);
  return specific.length ? specific : matching.filter((row) => !(links.get(row.id) ?? []).length);
}

function areaPremiseFromRule(row: { premise: string; area_premise: string | null; calc_mode?: string | null }) {
  if (isHoursRule(row)) return null;
  if (!isDaysRule(row.premise)) {
    const key = canonicalPremiseKey(row.premise);
    return !key || key === "none" || isDaysRule(key) ? null : key;
  }
  const area = canonicalPremiseKey(row.area_premise);
  return !area || area === "none" || isDaysRule(area) ? null : area;
}

function dedupAreaPremises(keys: string[]) {
  const set = new Set(keys.filter(Boolean));
  if (set.has("plantio_verao") && set.has("plantio_inverno")) set.delete("plantio_total");
  else if (set.has("plantio_total")) {
    set.delete("plantio_verao");
    set.delete("plantio_inverno");
  }
  return [...set];
}

export function lookupActivityAutoAreaPremises(
  activityId?: number | null,
  costObjectId?: number | null,
  harvestId?: number | null,
  description?: string | null,
): string[] {
  const keys = matchingActivityAreaRules(activityId, costObjectId, harvestId, description)
    .map(areaPremiseFromRule)
    .filter((key): key is string => Boolean(key));
  return dedupAreaPremises(keys);
}

export function lookupActivityAutoAreaPremise(
  activityId?: number | null,
  costObjectId?: number | null,
  harvestId?: number | null,
  description?: string | null,
): string | null {
  return lookupActivityAutoAreaPremises(activityId, costObjectId, harvestId, description)[0] ?? null;
}

export function lookupActivityHoursRule(
  activityId?: number | null,
  costObjectId?: number | null,
  harvestId?: number | null,
  description?: string | null,
): { premise: string; tonPerHour: number; quantity: number } | null {
  ensureCalcParams();
  const harvest = resolveSafraId(harvestId);
  let resolvedId = activityId ? Number(activityId) : 0;
  if (!resolvedId && description) {
    const activities = db.prepare("SELECT id, description FROM activities").all() as { id: number; description: string }[];
    resolvedId = matchActivityIdFromList(activities, description) ?? 0;
  }
  if (!resolvedId) return null;
  const rules = db
    .prepare(
      `SELECT id, premise, dose, rate_ha, calc_mode
         FROM calc_params
        WHERE safra_id = ? AND kind = 'activity' AND activity_id = ?
        ORDER BY id DESC`,
    )
    .all(harvest, resolvedId) as {
      id: number;
      premise: string;
      dose: number | null;
      rate_ha: number | null;
      calc_mode?: string | null;
    }[];
  const links = loadRuleCostObjectMap();
  const matching = rules.filter((row) => {
    if (!isHoursRule(row)) return false;
    const ids = links.get(row.id) ?? [];
    if (!ids.length) return true;
    return costObjectId != null && ids.includes(costObjectId);
  });
  const specific = matching.filter((row) => (links.get(row.id) ?? []).length > 0);
  const pool = specific.length ? specific : matching.filter((row) => !(links.get(row.id) ?? []).length);
  const rule = pool[0];
  const tonPerHour = Number(rule?.dose);
  if (!rule || !(tonPerHour > 0)) return null;
  return { premise: rule.premise, tonPerHour, quantity: hoursQuantity(rule.rate_ha) };
}

export function computeActivityHoursMonths(parent: ActivityAreaRef | null | undefined): number[] | null {
  if (!parent) return null;
  const ref = linkedActivityAreaRef(parent);
  const rule = lookupActivityHoursRule(ref.activity_id, ref.cost_object_id, null, ref.description);
  if (!rule) return null;
  const tons = premiseMonthSeries(rule.premise);
  return tons.map((qty) => {
    const tonsMonth = Number(qty) || 0;
    return tonsMonth > 0 ? (tonsMonth / rule.tonPerHour) * rule.quantity : 0;
  });
}

function resolveActivityPremiseKey(parent: ActivityAreaRef): { key: string | null; usePeriod: boolean; startMonth: number | null; endMonth: number | null } {
  const autoKey = lookupActivityAutoAreaPremise(parent.activity_id, parent.cost_object_id, null, parent.description);
  let areaKey = autoKey;
  let usePeriod = false;
  let startMonth: number | null = null;
  let endMonth: number | null = null;

  if (parent.use_activity_auto === 0) {
    if (!areaKey) {
      if (parent.calc_premise && !isDaysRule(parent.calc_premise)) areaKey = parent.calc_premise;
      else if (parent.calc_area_premise && !isDaysRule(parent.calc_area_premise)) areaKey = parent.calc_area_premise;
    }
    const start = clampMonth(parent.start_month);
    const end = clampMonth(parent.end_month);
    if (start != null && end != null) {
      usePeriod = true;
      startMonth = start;
      endMonth = end;
    }
  }

  return { key: areaKey, usePeriod, startMonth, endMonth };
}

export function activityPremiseKey(parent: ActivityAreaRef) {
  return canonicalPremiseKey(resolveActivityPremiseKey(parent).key ?? "none");
}

function resolveActivityAreaPlan(parent: ActivityAreaRef): ActivityAreaPlan | null {
  const resolved = resolveActivityPremiseKey(parent);
  let areaKey = resolved.key;
  const usePeriod = resolved.usePeriod;
  const startMonth = resolved.startMonth;
  const endMonth = resolved.endMonth;

  if (!areaKey || isDaysRule(areaKey)) areaKey = "plantio_total";
  const full = premiseMonthSeries(areaKey).map((qty) => roundPremiseQty(qty * areaPctFactor(parent.calc_area_pct)));
  const total = full.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  const active = usePeriod ? gateMonthsByPeriod([...full], startMonth, endMonth) : full;
  return { full, active, total };
}

function activityAreaWeights(parent: ActivityAreaRef) {
  return resolveActivityAreaPlan(linkedActivityAreaRef(parent))?.active ?? null;
}

export function activityPremiseArea(parent: ActivityAreaRef) {
  const ref = linkedActivityAreaRef(parent);
  const keys = lookupActivityAutoAreaPremises(ref.activity_id, ref.cost_object_id, null, ref.description);
  const resolved = resolveActivityPremiseKey(ref);
  let areaKeys = keys.length ? keys : resolved.key && !isDaysRule(resolved.key) ? [resolved.key] : [];
  areaKeys = dedupAreaPremises(areaKeys);
  if (!areaKeys.length) areaKeys = ["plantio_total"];
  const factor = areaPctFactor(ref.calc_area_pct);
  const full = Array.from({ length: 12 }, () => 0);
  for (const key of areaKeys) {
    if (isDaysRule(key)) continue;
    addMonths(
      full,
      premiseMonthSeries(key).map((qty) => roundPremiseQty(qty * factor)),
    );
  }
  const total = full.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  return {
    total: Math.round(total * 10) / 10,
    months: full.map((value) => Math.round(value * 10) / 10),
  };
}

export function materialOwnPremiseKey(line: { calc_area_premise?: string | null }) {
  const key = canonicalPremiseKey(line.calc_area_premise);
  if (!key || key === "none" || isDaysRule(key)) return null;
  return key;
}

function planFromPremiseKey(key: string): ActivityAreaPlan | null {
  const full = premiseMonthSeries(key).map((qty) => roundPremiseQty(qty));
  const total = full.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  return { full, active: full, total };
}

function materialAreaPlan(
  parent: ActivityAreaRef | null | undefined,
  line?: { calc_area_premise?: string | null },
) {
  const ownKey = materialOwnPremiseKey(line ?? {});
  if (ownKey) return planFromPremiseKey(ownKey);
  if (!parent) return null;
  return resolveActivityAreaPlan(linkedActivityAreaRef(parent));
}

function scaleInformedArea(
  plan: ActivityAreaPlan,
  dose: number | null,
  price: number | null,
  areaHa: number | null,
  applications?: number | null,
) {
  const qty = Number(dose);
  const unit = Number(price);
  const informed = Number(areaHa);
  if (!(qty > 0) || !(unit > 0) || !(informed > 0) || !(plan.total > 0)) return null;
  const factor = informed / plan.total;
  const apps = applicationsFactor(applications);
  return plan.full.map((monthHa) => factor * monthHa * qty * unit * apps);
}

export function isTripsMaterial(line: {
  calc_kind?: string | null;
  calc_trips?: number | null;
  calc_machine_qty?: number | null;
}) {
  if (line.calc_kind === "trips") return true;
  return Number(line.calc_trips) > 0 && Number(line.calc_machine_qty) > 0;
}

/** Material/equipamento: horas/dia × R$/h × dias úteis do mês (exceto dias da semana). */
export function isDaysHoursMaterial(line: { calc_kind?: string | null }) {
  return line.calc_kind === "days";
}

function computeDaysHoursMonths(
  line: {
    calc_dose?: number | null;
    calc_price?: number | null;
    calc_months?: string | number[] | null;
    calc_exclude_weekdays?: string | number[] | null;
    calc_applications?: number | null;
  },
  startYear: number,
) {
  const hoursDay = Number(line.calc_dose);
  const price = Number(line.calc_price);
  if (!(hoursDay > 0) || !(price > 0)) return null;
  const exclude = parseExcludeWeekdays(line.calc_exclude_weekdays);
  const apps = applicationsFactor(line.calc_applications);
  const days = workingDaysBySafraMonth(startYear, exclude);
  return gateMonthsBySelection(
    days.map((dayCount) => dayCount * hoursDay * price * apps),
    parseCalcMonths(line.calc_months),
  );
}

/** Divisor das horas do cálculo automático; se ausente, 1 (compatível com linhas antigas). */
export function hourIntervalOrOne(raw: number | null | undefined) {
  const n = Number(raw);
  return n > 0 ? n : 1;
}

/** (horas / intervalo) × quantidade × preço */
export function scaleHoursByInterval(
  hours: number[],
  interval: number | null | undefined,
  qty: number | null | undefined,
  price: number | null | undefined,
  applications?: number | null,
) {
  const unit = Number(price);
  const dose = Number(qty) > 0 ? Number(qty) : 1;
  const step = hourIntervalOrOne(interval);
  if (!(unit > 0) || !(step > 0)) return null;
  const apps = applicationsFactor(applications);
  return hours.map((value) => (value / step) * dose * unit * apps);
}

function computeTripsMonths(line: {
  calc_dose?: number | null;
  calc_price?: number | null;
  calc_trips?: number | null;
  calc_machine_qty?: number | null;
  calc_months?: string | number[] | null;
  calc_area_premise?: string | null;
}) {
  const tons = Number(line.calc_dose);
  const trips = Number(line.calc_trips);
  const machines = Number(line.calc_machine_qty);
  const price = Number(line.calc_price);
  const key = materialOwnPremiseKey(line);
  if (!(tons > 0) || !(trips > 0) || !(machines > 0) || !(price > 0) || !key) return null;
  const factor = tons * trips * machines * price;
  const days = premiseDaysByMonth(key);
  if (!days.some((n) => n > 0)) return null;
  return gateMonthsBySelection(
    days.map((dayCount) => dayCount * factor),
    parseCalcMonths(line.calc_months),
  );
}

export function computeMaterialAutoMonths(
  parent: ActivityAreaRef | null | undefined,
  line: {
    calc_dose?: number | null;
    calc_price?: number | null;
    calc_area_pct?: number | null;
    calc_area_ha?: number | null;
    calc_applications?: number | null;
    calc_months?: string | number[] | null;
    calc_area_premise?: string | null;
    calc_kind?: string | null;
    calc_trips?: number | null;
    calc_machine_qty?: number | null;
    calc_hour_interval?: number | null;
    calc_exclude_weekdays?: string | number[] | null;
    ref_kind?: string | null;
  },
  startYear?: number,
) {
  if (isTripsMaterial(line)) return computeTripsMonths(line);
  if (isDaysHoursMaterial(line)) {
    const year = startYear ?? harvestStartYear(currentSafraId());
    return computeDaysHoursMonths(line, year);
  }
  // Horas da atividade só quando não há premissa própria (custo/hora × área da premissa).
  if (
    (line.ref_kind === "cost_object" || line.calc_kind === "hours") &&
    parent &&
    !materialOwnPremiseKey(line)
  ) {
    const hours = computeActivityHoursMonths(parent);
    if (hours) {
      const scaled = scaleHoursByInterval(
        hours,
        line.calc_hour_interval,
        line.calc_dose,
        line.calc_price,
        line.calc_applications,
      );
      if (scaled) return gateMonthsBySelection(scaled, parseCalcMonths(line.calc_months));
    }
  }
  const dose = Number(line.calc_dose);
  const price = Number(line.calc_price);
  if (!(dose > 0) || !(price > 0)) return null;
  const plan = materialAreaPlan(parent, line);
  const selected = parseCalcMonths(line.calc_months);
  if (Number(line.calc_area_ha) > 0) {
    const scaled = plan ? scaleInformedArea(plan, dose, price, line.calc_area_ha, line.calc_applications) : null;
    return scaled ? gateMonthsBySelection(scaled, selected) : null;
  }
  const ownKey = materialOwnPremiseKey(line);
  const weights = plan?.active ?? (ownKey || !parent ? null : activityAreaWeights(parent));
  if (!weights) return null;
  const scaled = scaleWeights(weights, dose, price, line.calc_area_pct, null, line.calc_applications);
  return scaled ? gateMonthsBySelection(scaled, selected) : null;
}

export function materialAreaHa(
  parent: ActivityAreaRef,
  areaPct?: number | null,
  areaHa?: number | null,
  areaPremise?: string | null,
) {
  const plan = materialAreaPlan(parent, { calc_area_premise: areaPremise });
  if (!plan) return null;
  const informed = Number(areaHa);
  if (informed > 0) {
    if (!(plan.total > 0)) return null;
    const factor = informed / plan.total;
    const months = plan.full.map((monthHa) => Math.round(monthHa * factor * 10) / 10);
    return {
      months,
      total: Math.round(months.reduce((sum, value) => sum + value, 0) * 10) / 10,
    };
  }
  const factor = areaPctFactor(areaPct);
  const months = plan.active.map((weight) => Math.round(weight * factor * 10) / 10);
  return {
    months,
    total: Math.round(months.reduce((sum, value) => sum + value, 0) * 10) / 10,
  };
}

const SAFRA_MONTH_LABELS = ["Setembro", "Outubro", "Novembro", "Dezembro", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto"];

function periodLabel(startMonth: number | null, endMonth: number | null) {
  if (startMonth == null || endMonth == null) return "";
  return ` de ${SAFRA_MONTH_LABELS[startMonth]} a ${SAFRA_MONTH_LABELS[endMonth]}`;
}

export interface CalcRuleInput {
  kind: "material" | "activity";
  materialId?: number | null;
  activityId?: number | null;
  premise?: string;
  mode?: "area" | "days" | "hours";
  dose?: number | null;
  rateHa?: number | null;
  price?: number | null;
  excludeWeekdays?: number[] | null;
  areaPremise?: string | null;
  useActivityAuto?: boolean;
  startMonth?: number | null;
  endMonth?: number | null;
  fromMaterials?: boolean;
  costObjectIds?: number[] | null;
  safraId?: number | null;
}

function formulaText(
  kind: "material" | "activity",
  premise: string,
  dose: number | null,
  rateHa: number | null,
  price: number | null,
  excludeWeekdays: number[] = [],
  areaPremise: string | null = null,
  useActivityAuto = true,
  startMonth: number | null = null,
  endMonth: number | null = null,
  fromMaterials = false,
  costObjectCodes: string[] = [],
  mode: "area" | "days" | "hours" = "area",
) {
  const qty = Number(dose);
  const unitPrice = Number(price);
  const period = useActivityAuto ? "" : periodLabel(startMonth, endMonth);
  const objects = costObjectCodes.length ? ` nos objetos ${costObjectCodes.join(", ")}` : "";
  if (mode === "hours") {
    const driver = driverLabel(premise);
    const th = qty > 0 ? `${dose} t/h` : "(t/h)";
    return `horas = (${driver} / ${th}) × ${hoursQuantity(rateHa)}${period}${objects}`;
  }
  if (isDaysRule(premise)) {
    const except = exceptWeekdaysLabel(excludeWeekdays);
    const area = areaPremise ? ` só nos meses com ${driverLabel(areaPremise)}` : "";
    if (fromMaterials) return `materiais × dias do mês (${except})${area}${period}${objects}`;
    if (qty > 0 && unitPrice > 0) return `(${dose} × ${price}) × dias do mês (${except})${area}${period}${objects}`;
    if (unitPrice > 0) return `${price} × dias do mês (${except})${area}${period}${objects}`;
    return `dias do mês (${except}) × preço${area}${period}${objects}`;
  }
  const driver = driverLabel(premise);
  if (fromMaterials) return `materiais × ${driver}${period}${objects}`;
  if (qty > 0 && unitPrice > 0) {
    return `(${dose} × ${price}) × ${driver}${period}${objects}`;
  }
  if (kind === "material" && qty > 0) {
    return `(${dose} × preço) × ${driver}${period}${objects}`;
  }
  if (kind === "activity" && Number(rateHa) > 0) {
    return `${rateHa} R$/ha × ${driver}${period}${objects}`;
  }
  return `(qtd/ha × preço) × ${driver}${period}${objects}`;
}

function catalogPrice(materialId: number | null | undefined) {
  if (!materialId) return null;
  const row = db.prepare("SELECT valor FROM materials WHERE id = ?").get(materialId) as { valor: number | null } | undefined;
  const value = Number(row?.valor);
  return value > 0 ? value : null;
}

function resolvedPrice(kind: "material" | "activity", materialId: number | null | undefined, price: number | null | undefined) {
  const explicit = Number(price);
  if (explicit > 0) return explicit;
  if (kind === "material") return catalogPrice(materialId);
  return null;
}

function unitPerHa(rule: {
  kind: "material" | "activity";
  dose: number | null;
  rate_ha: number | null;
  price?: number | null;
  material_price?: number | null;
}) {
  const qty = Number(rule.dose);
  const price = Number(rule.price) > 0 ? Number(rule.price) : Number(rule.material_price) || 0;
  if (qty > 0 && price > 0) return qty * price;
  if (rule.kind === "activity" && Number(rule.rate_ha) > 0) return Number(rule.rate_ha);
  return 0;
}

function ruleScore(rule: {
  dose: number | null;
  rate_ha?: number | null;
  price?: number | null;
  material_price?: number | null;
  from_materials?: number | boolean | null;
  calc_mode?: unknown;
  premise?: string | null;
}) {
  if (isHoursRule(rule)) return 1;
  if (rule.from_materials === 1 || rule.from_materials === true) return 1;
  const qty = Number(rule.dose);
  const price = Number(rule.price) > 0 ? Number(rule.price) : Number(rule.material_price) || 0;
  if (qty > 0 && price > 0) return 2;
  if (Number(rule.rate_ha) > 0) return 1;
  return 0;
}

function costObjectKey(ids: number[]) {
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b).join(",");
}

function normalizeCostObjectIds(ids?: number[] | null) {
  return [...new Set((ids ?? []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))].sort(
    (a, b) => a - b,
  );
}

function loadRuleCostObjectMap() {
  const rows = db
    .prepare("SELECT calc_param_id, cost_object_id FROM calc_param_cost_objects")
    .all() as { calc_param_id: number; cost_object_id: number }[];
  const map = new Map<number, number[]>();
  for (const row of rows) {
    const list = map.get(row.calc_param_id) ?? [];
    list.push(row.cost_object_id);
    map.set(row.calc_param_id, list);
  }
  return map;
}

function saveRuleCostObjects(ruleId: number, ids: number[]) {
  db.prepare("DELETE FROM calc_param_cost_objects WHERE calc_param_id = ?").run(ruleId);
  const ins = db.prepare("INSERT INTO calc_param_cost_objects (calc_param_id, cost_object_id) VALUES (?, ?)");
  for (const id of normalizeCostObjectIds(ids)) ins.run(ruleId, id);
}

function costObjectCodes(ids: number[]) {
  if (!ids.length) return [] as string[];
  const rows = db
    .prepare(
      `SELECT code FROM cost_objects WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY code COLLATE NOCASE`,
    )
    .all(...ids) as { code: string }[];
  return rows.map((row) => row.code);
}

function findCalcRuleId(
  harvestId: number,
  kind: string,
  activityId: number | null | undefined,
  materialId: number | null | undefined,
  premise: string,
  exceptId?: number,
  costObjectIds?: number[] | null,
  calcMode?: string | null,
) {
  const rows = db
    .prepare(
      `SELECT id, calc_mode, premise FROM calc_params
       WHERE safra_id = ? AND kind = ? AND premise = ?
         AND ifnull(activity_id, 0) = ifnull(?, 0)
         AND ifnull(material_id, 0) = ifnull(?, 0)
         AND id != ifnull(?, 0)`,
    )
    .all(harvestId, kind, premise, activityId ?? 0, materialId ?? 0, exceptId ?? 0) as {
      id: number;
      calc_mode?: string | null;
      premise: string;
    }[];
  const wantedMode = calcMode || "area";
  const byMode = rows.filter((row) => ruleCalcMode(row) === wantedMode);
  const pool = byMode.length ? byMode : wantedMode === "area" ? rows.filter((row) => ruleCalcMode(row) !== "hours") : [];
  if (!pool.length) return null;
  if (kind !== "activity") return pool[0]?.id ?? null;
  const wanted = costObjectKey(normalizeCostObjectIds(costObjectIds));
  const links = loadRuleCostObjectMap();
  const match = pool.find((row) => costObjectKey(links.get(row.id) ?? []) === wanted);
  return match?.id ?? null;
}

function dedupeCalcParams() {
  const rows = db
    .prepare(
      `SELECT id, kind, activity_id, material_id, premise, dose, rate_ha, price, safra_id, calc_mode
       FROM calc_params`,
    )
    .all() as {
      id: number;
      kind: string;
      activity_id: number | null;
      material_id: number | null;
      premise: string;
      dose: number | null;
      rate_ha: number | null;
      price: number | null;
      safra_id: number | null;
      calc_mode?: string | null;
    }[];
  const links = loadRuleCostObjectMap();
  const best = new Map<string, { id: number; score: number }>();
  const drop: number[] = [];
  for (const row of rows) {
    const key = [
      row.safra_id ?? "",
      row.kind,
      row.activity_id ?? 0,
      row.material_id ?? 0,
      row.premise,
      ruleCalcMode(row),
      row.kind === "activity" ? costObjectKey(links.get(row.id) ?? []) : "",
    ].join(":");
    const score = ruleScore(row);
    const current = best.get(key);
    if (!current) {
      best.set(key, { id: row.id, score });
      continue;
    }
    if (score > current.score || (score === current.score && row.id > current.id)) {
      drop.push(current.id);
      best.set(key, { id: row.id, score });
    } else {
      drop.push(row.id);
    }
  }
  if (drop.length) {
    const del = db.prepare("DELETE FROM calc_params WHERE id = ?");
    const delLinks = db.prepare("DELETE FROM calc_param_cost_objects WHERE calc_param_id = ?");
    db.transaction(() => {
      for (const id of drop) {
        delLinks.run(id);
        del.run(id);
      }
    })();
  }
}

function ensureCalcParams() {
  ensureSafras();
  db.exec(`
    CREATE TABLE IF NOT EXISTS calc_params (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('material', 'activity')),
      material_id INTEGER REFERENCES materials(id) ON DELETE CASCADE,
      activity_id INTEGER REFERENCES activities(id) ON DELETE CASCADE,
      premise TEXT NOT NULL,
      dose REAL,
      rate_ha REAL,
      price REAL,
      safra_id INTEGER REFERENCES safras(id)
    );
  `);
  try {
    db.exec("ALTER TABLE calc_params ADD COLUMN rate_ha REAL");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE calc_params ADD COLUMN safra_id INTEGER REFERENCES safras(id)");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE calc_params ADD COLUMN price REAL");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE calc_params ADD COLUMN exclude_weekdays TEXT");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE calc_params ADD COLUMN area_premise TEXT");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE calc_params ADD COLUMN use_activity_auto INTEGER NOT NULL DEFAULT 1");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE calc_params ADD COLUMN start_month INTEGER");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE calc_params ADD COLUMN end_month INTEGER");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN use_activity_auto INTEGER NOT NULL DEFAULT 1");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN start_month INTEGER");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN end_month INTEGER");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN calc_premise TEXT");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN calc_dose REAL");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN calc_price REAL");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN calc_exclude_weekdays TEXT");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN calc_area_premise TEXT");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN calc_area_pct REAL");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN calc_area_ha REAL");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN calc_months TEXT");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN calc_plans TEXT");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN calc_applications REAL");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN calc_direct INTEGER NOT NULL DEFAULT 0");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN calc_kind TEXT");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN calc_trips REAL");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN calc_machine_qty REAL");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE lines ADD COLUMN calc_hour_interval REAL");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE calc_params ADD COLUMN from_materials INTEGER NOT NULL DEFAULT 0");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE calc_params ADD COLUMN calc_mode TEXT NOT NULL DEFAULT 'area'");
  } catch {
    /* coluna já existe */
  }
  db.prepare("UPDATE calc_params SET safra_id = ? WHERE safra_id IS NULL").run(currentSafraId());
  db.exec(`
    CREATE TABLE IF NOT EXISTS calc_param_cost_objects (
      calc_param_id INTEGER NOT NULL REFERENCES calc_params(id) ON DELETE CASCADE,
      cost_object_id INTEGER NOT NULL REFERENCES cost_objects(id) ON DELETE CASCADE,
      PRIMARY KEY (calc_param_id, cost_object_id)
    );
  `);
  try {
    db.exec("DROP INDEX IF EXISTS calc_params_unique");
  } catch {
    /* índice antigo */
  }
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS calc_params_material_unique
      ON calc_params (safra_id, kind, ifnull(material_id, 0), premise)
      WHERE kind = 'material'
    `);
  } catch {
    /* índice já existe */
  }
  dedupeCalcParams();
}

export function listCalcRules(safraId?: number | null) {
  ensureCalcParams();
  const harvestId = resolveSafraId(safraId);
  const rows = db
    .prepare(
      `SELECT r.*,
              m.code AS material_code, m.description AS material_name, m.valor AS material_price,
              a.code AS activity_code, a.description AS activity_name
       FROM calc_params r
       LEFT JOIN materials m ON m.id = r.material_id
       LEFT JOIN activities a ON a.id = r.activity_id
       WHERE r.safra_id = ?
       ORDER BY r.id DESC`,
    )
    .all(harvestId) as Record<string, unknown>[];

  const prev = previousSafra(harvestId);
  const previousCount = prev
    ? ((db.prepare("SELECT COUNT(*) AS n FROM calc_params WHERE safra_id = ?").get(prev.id) as { n: number }).n)
    : 0;
  const costLinks = loadRuleCostObjectMap();

  return {
    safraId: harvestId,
    previousSafra: prev,
    previousRuleCount: previousCount,
    drivers: listPremiseDrivers(harvestId),
    rules: rows.map((row) => {
      const kind = row.kind === "activity" ? "activity" : "material";
      const premise = String(row.premise);
      const dose = (row.dose as number | null) ?? null;
      const rateHa = (row.rate_ha as number | null) ?? null;
      const storedPrice = (row.price as number | null) ?? null;
      const materialPrice = (row.material_price as number | null) ?? null;
      const price = storedPrice ?? (kind === "material" ? materialPrice : null);
      const excludeWeekdays = parseExcludeWeekdays(row.exclude_weekdays);
      const hoursMode = isHoursRule(row);
      const daysMode = !hoursMode && isDaysRule(premise);
      const mode = hoursMode ? "hours" : daysMode ? "days" : "area";
      const useActivityAuto = row.use_activity_auto !== 0 && row.use_activity_auto !== false;
      const startMonth = useActivityAuto ? null : clampMonth(row.start_month);
      const endMonth = useActivityAuto ? null : clampMonth(row.end_month);
      const areaPremise =
        useActivityAuto && daysMode && typeof row.area_premise === "string" && row.area_premise.trim()
          ? String(row.area_premise)
          : null;
      const fromMaterials = kind === "activity" && !hoursMode && (row.from_materials === 1 || row.from_materials === true);
      const costObjectIds = kind === "activity" ? normalizeCostObjectIds(costLinks.get(Number(row.id)) ?? []) : [];
      const objectCodes = costObjectCodes(costObjectIds);
      return {
        id: row.id,
        kind,
        mode,
        materialId: row.material_id,
        activityId: row.activity_id,
        materialCode: row.material_code,
        materialName: row.material_name,
        activityCode: row.activity_code,
        activityName: row.activity_name,
        premise,
        dose: fromMaterials ? null : dose,
        rateHa: fromMaterials ? null : hoursMode ? hoursQuantity(rateHa) : rateHa,
        price: fromMaterials || hoursMode ? null : price,
        excludeWeekdays,
        areaPremise,
        useActivityAuto,
        startMonth,
        endMonth,
        fromMaterials,
        costObjectIds,
        costObjectCodes: objectCodes,
        safraId: row.safra_id,
        formula: formulaText(
          kind,
          premise,
          dose,
          rateHa,
          price,
          excludeWeekdays,
          areaPremise,
          useActivityAuto,
          startMonth,
          endMonth,
          fromMaterials,
          objectCodes,
          mode,
        ),
      };
    }),
  };
}

export function createCalcRule(input: CalcRuleInput) {
  ensureCalcParams();
  const harvestId = resolveSafraId(input.safraId);
  const hoursMode = input.mode === "hours";
  if (hoursMode && input.kind !== "activity") {
    throw new Error("O cálculo por tonelada só vale para atividade.");
  }
  const daysMode = !hoursMode && (input.mode === "days" || input.premise === DAYS_PREMISE);
  const premise = daysMode ? DAYS_PREMISE : input.premise;
  if (!premise) throw new Error(daysMode ? "Informe o cálculo por dia." : "Informe a premissa do cálculo.");
  if (!isValidPremise(premise, harvestId)) throw new Error("Premissa inválida.");
  if (input.kind === "material" && !input.materialId) throw new Error("Selecione o material.");
  if (input.kind === "activity" && !input.activityId) throw new Error("Selecione a atividade.");
  const fromMaterials = input.kind === "activity" && !hoursMode && input.fromMaterials === true;
  const dose = fromMaterials ? null : Number(input.dose) > 0 ? Number(input.dose) : daysMode ? 1 : NaN;
  if (!fromMaterials && !(Number(dose) > 0)) {
    throw new Error(hoursMode ? "Informe as toneladas por hora." : "Informe a quantidade por hectare.");
  }
  const price = fromMaterials || hoursMode ? null : resolvedPrice(input.kind, input.materialId, input.price);
  const legacyRate = fromMaterials || hoursMode || input.kind !== "activity" ? 0 : Number(input.rateHa);
  if (!fromMaterials && !hoursMode && !(Number(price) > 0) && !(legacyRate > 0)) {
    throw new Error("Informe o preço para calcular o parâmetro.");
  }
  const hoursQty = hoursMode ? hoursQuantity(input.rateHa) : null;
  if (hoursMode && !(Number(hoursQty) > 0)) {
    throw new Error("Informe a quantidade.");
  }
  const rateHa = fromMaterials ? null : hoursMode ? hoursQty : Number(price) > 0 ? Number(dose) * Number(price) : legacyRate;
  const materialId = input.kind === "material" ? input.materialId : null;
  const activityId = input.kind === "activity" ? input.activityId : null;
  const period = resolveFillPeriod(input.useActivityAuto !== false, input.startMonth, input.endMonth);
  const excludeWeekdays = daysMode ? storeExcludeWeekdays(input.excludeWeekdays ?? []) : null;
  const areaPremise =
    period.useActivityAuto && daysMode ? resolveAreaPremise(input.areaPremise, harvestId) : null;
  const calcMode = storedCalcMode(hoursMode, daysMode);
  const existingId = findCalcRuleId(
    harvestId,
    input.kind,
    activityId,
    materialId,
    premise,
    undefined,
    input.costObjectIds,
    calcMode,
  );
  let ruleId = existingId;
  if (existingId) {
    db.prepare(
      "UPDATE calc_params SET dose = ?, rate_ha = ?, price = ?, exclude_weekdays = ?, area_premise = ?, use_activity_auto = ?, start_month = ?, end_month = ?, from_materials = ?, calc_mode = ? WHERE id = ?",
    ).run(
      dose,
      rateHa,
      price,
      excludeWeekdays,
      areaPremise,
      period.useActivityAuto ? 1 : 0,
      period.startMonth,
      period.endMonth,
      fromMaterials ? 1 : 0,
      calcMode,
      existingId,
    );
  } else {
    ruleId = Number(
      db.prepare(
        `INSERT INTO calc_params (kind, material_id, activity_id, premise, dose, rate_ha, price, safra_id, exclude_weekdays, area_premise, use_activity_auto, start_month, end_month, from_materials, calc_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.kind,
        materialId,
        activityId,
        premise,
        dose,
        rateHa,
        price,
        harvestId,
        excludeWeekdays,
        areaPremise,
        period.useActivityAuto ? 1 : 0,
        period.startMonth,
        period.endMonth,
        fromMaterials ? 1 : 0,
        calcMode,
      ).lastInsertRowid,
    );
  }
  if (input.kind === "activity" && ruleId) saveRuleCostObjects(ruleId, input.costObjectIds ?? []);
  return listCalcRules(harvestId);
}

export function updateCalcRule(id: number, input: Partial<CalcRuleInput>) {
  ensureCalcParams();
  const current = db.prepare("SELECT * FROM calc_params WHERE id = ?").get(id) as
    | {
        kind: "material" | "activity";
        material_id: number | null;
        activity_id: number | null;
        premise: string;
        dose: number | null;
        rate_ha: number | null;
        price: number | null;
        safra_id: number | null;
        exclude_weekdays: string | null;
        area_premise: string | null;
        use_activity_auto: number | null;
        start_month: number | null;
        end_month: number | null;
        from_materials: number | null;
        calc_mode?: string | null;
      }
    | undefined;
  if (!current) throw new Error("Parâmetro não encontrado.");
  const kind = input.kind ?? current.kind;
  const harvestId = resolveSafraId(input.safraId ?? current.safra_id);
  const hoursMode =
    input.mode === "hours" ||
    (input.mode !== "area" && input.mode !== "days" && isHoursRule(current));
  if (hoursMode && kind !== "activity") {
    throw new Error("O cálculo por tonelada só vale para atividade.");
  }
  const daysMode =
    !hoursMode &&
    (input.mode === "days" ||
      (input.mode !== "area" && (input.premise ?? current.premise) === DAYS_PREMISE));
  const premise = daysMode ? DAYS_PREMISE : (input.premise ?? current.premise);
  if (!isValidPremise(premise, harvestId)) throw new Error("Premissa inválida.");
  const materialId = kind === "material" ? (input.materialId ?? current.material_id) : null;
  const fromMaterials =
    kind === "activity" &&
    !hoursMode &&
    (input.fromMaterials !== undefined ? input.fromMaterials === true : current.from_materials === 1) &&
    !(Number(input.price) > 0);
  const dose = fromMaterials ? null : input.dose !== undefined ? input.dose : current.dose;
  const price = fromMaterials || hoursMode ? null : input.price !== undefined ? input.price : current.price;
  const resolved = fromMaterials || hoursMode ? null : resolvedPrice(kind, materialId, price);
  const qty = Number(dose);
  if (hoursMode && !(qty > 0)) throw new Error("Informe as toneladas por hora.");
  const computedRate = qty > 0 && Number(resolved) > 0 ? qty * Number(resolved) : null;
  const hoursQty =
    hoursMode
      ? hoursQuantity(input.rateHa !== undefined ? input.rateHa : current.rate_ha)
      : null;
  if (hoursMode && !(Number(hoursQty) > 0)) throw new Error("Informe a quantidade.");
  const rateHa = fromMaterials
    ? null
    : hoursMode
      ? hoursQty
      : input.rateHa !== undefined
        ? input.rateHa
        : computedRate ?? current.rate_ha;
  if (!fromMaterials && !hoursMode && !(Number(resolved) > 0) && !(Number(rateHa) > 0)) {
    throw new Error("Informe o preço para calcular o parâmetro.");
  }
  const activityId = kind === "activity" ? (input.activityId ?? current.activity_id) : null;
  const nextCostObjectIds =
    kind === "activity"
      ? input.costObjectIds !== undefined
        ? normalizeCostObjectIds(input.costObjectIds)
        : loadRuleCostObjectMap().get(id) ?? []
      : [];
  const period = resolveFillPeriod(
    input.useActivityAuto !== undefined ? input.useActivityAuto !== false : current.use_activity_auto !== 0,
    input.startMonth !== undefined ? input.startMonth : current.start_month,
    input.endMonth !== undefined ? input.endMonth : current.end_month,
  );
  const excludeWeekdays = daysMode
    ? storeExcludeWeekdays(input.excludeWeekdays ?? parseExcludeWeekdays(current.exclude_weekdays))
    : null;
  const areaPremise =
    period.useActivityAuto && daysMode
      ? resolveAreaPremise(input.areaPremise !== undefined ? input.areaPremise : current.area_premise, harvestId)
      : null;
  const calcMode = storedCalcMode(hoursMode, daysMode);
  if (findCalcRuleId(harvestId, kind, activityId, materialId, premise, id, nextCostObjectIds, calcMode)) {
    throw new Error("Já existe um parâmetro para este item, esta premissa e estes objetos de custo.");
  }
  db.prepare(
    `UPDATE calc_params
     SET kind = ?, material_id = ?, activity_id = ?, premise = ?, dose = ?, rate_ha = ?, price = ?, safra_id = ?, exclude_weekdays = ?, area_premise = ?, use_activity_auto = ?, start_month = ?, end_month = ?, from_materials = ?, calc_mode = ?
     WHERE id = ?`,
  ).run(
    kind,
    materialId,
    activityId,
    premise,
    dose,
    rateHa,
    resolved,
    harvestId,
    excludeWeekdays,
    areaPremise,
    period.useActivityAuto ? 1 : 0,
    period.startMonth,
    period.endMonth,
    fromMaterials ? 1 : 0,
    calcMode,
    id,
  );
  if (kind === "activity") saveRuleCostObjects(id, nextCostObjectIds);
  return listCalcRules(harvestId);
}

export function deleteCalcRule(id: number) {
  ensureCalcParams();
  const row = db.prepare("SELECT safra_id FROM calc_params WHERE id = ?").get(id) as { safra_id: number | null } | undefined;
  if (!row) throw new Error("Parâmetro não encontrado.");
  db.prepare("DELETE FROM calc_param_cost_objects WHERE calc_param_id = ?").run(id);
  db.prepare("DELETE FROM calc_params WHERE id = ?").run(id);
  return listCalcRules(row.safra_id);
}

export function copyCalcRulesBetween(sourceId: number, targetId: number) {
  ensureCalcParams();
  if (!sourceId || !targetId || sourceId === targetId) return listCalcRules(targetId);
  const source = db
    .prepare(
      `SELECT id, kind, material_id, activity_id, premise, dose, rate_ha, price, exclude_weekdays, area_premise, use_activity_auto, start_month, end_month, from_materials, calc_mode
       FROM calc_params WHERE safra_id = ?`,
    )
    .all(sourceId) as {
      id: number;
      kind: "material" | "activity";
      material_id: number | null;
      activity_id: number | null;
      premise: string;
      dose: number | null;
      rate_ha: number | null;
      price: number | null;
      exclude_weekdays: string | null;
      area_premise: string | null;
      use_activity_auto: number | null;
      start_month: number | null;
      end_month: number | null;
      from_materials: number | null;
      calc_mode?: string | null;
    }[];
  if (!source.length) return listCalcRules(targetId);
  const links = loadRuleCostObjectMap();

  const unique = new Map<string, (typeof source)[number]>();
  for (const row of source) {
    const key = `${row.kind}:${row.activity_id ?? 0}:${row.material_id ?? 0}:${row.premise}:${ruleCalcMode(row)}:${costObjectKey(links.get(row.id) ?? [])}`;
    const current = unique.get(key);
    if (!current || ruleScore(row) > ruleScore(current)) unique.set(key, row);
  }

  const ins = db.prepare(
    `INSERT INTO calc_params (kind, material_id, activity_id, premise, dose, rate_ha, price, safra_id, exclude_weekdays, area_premise, use_activity_auto, start_month, end_month, from_materials, calc_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM calc_params WHERE safra_id = ?").run(targetId);
    for (const row of unique.values()) {
      const newId = Number(
        ins.run(
          row.kind,
          row.material_id,
          row.activity_id,
          row.premise,
          row.dose,
          row.rate_ha,
          row.price,
          targetId,
          row.exclude_weekdays,
          row.area_premise,
          row.use_activity_auto === 0 ? 0 : 1,
          row.start_month,
          row.end_month,
          row.from_materials === 1 ? 1 : 0,
          ruleCalcMode(row),
        ).lastInsertRowid,
      );
      if (row.kind === "activity") saveRuleCostObjects(newId, links.get(row.id) ?? []);
    }
  });
  tx();
  return listCalcRules(targetId);
}

export function copyCalcRulesFromPrevious(safraId?: number | null) {
  ensureCalcParams();
  const harvestId = resolveSafraId(safraId);
  const prev = previousSafra(harvestId);
  if (!prev) throw new Error("Não há safra anterior cadastrada.");
  const count = db.prepare("SELECT COUNT(*) AS n FROM calc_params WHERE safra_id = ?").get(prev.id) as { n: number };
  if (!count.n) throw new Error(`A ${prev.label} não tem parâmetros para copiar.`);
  return copyCalcRulesBetween(prev.id, harvestId);
}

function premiseMonthSeries(premise: string): number[] {
  const series = subprocessMonthValues();
  const zeros = () => Array.from({ length: 12 }, () => 0);
  if (Array.isArray(series[premise])) return series[premise];
  if (premise === "plantio_verao") return series.haVerao ?? zeros();
  if (premise === "plantio_inverno") return series.haInverno ?? zeros();
  if (premise === "plantio_total") {
    const verao = series.haVerao ?? zeros();
    const inverno = series.haInverno ?? zeros();
    return verao.map((value, i) => value + (inverno[i] ?? 0));
  }
  if (premise === "tratos_planta") return series.haPlanta ?? zeros();
  if (premise === "tratos_soca") return series.haSoca ?? zeros();
  if (premise === "moagem") return series.tons ?? zeros();
  return zeros();
}

function addMonths(target: number[], extra: number[]) {
  for (let i = 0; i < 12; i++) target[i] = (target[i] ?? 0) + (extra[i] ?? 0);
}

function roundPremiseQty(qty: number) {
  return Math.round((Number(qty) || 0) * 10) / 10;
}

function hasManualFormula(lineId: number) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM line_months
       WHERE line_id = ? AND formula IS NOT NULL AND TRIM(formula) != '' AND formula != ?`,
    )
    .get(lineId, AUTO_CALC_FORMULA) as { n: number };
  return row.n > 0;
}

function writeAutoMonths(lineId: number, months: number[]) {
  db.prepare("DELETE FROM line_months WHERE line_id = ?").run(lineId);
  const ins = db.prepare("INSERT INTO line_months (line_id, month_index, formula, value) VALUES (?, ?, ?, ?)");
  for (let i = 0; i < 12; i++) {
    ins.run(lineId, i, AUTO_CALC_FORMULA, JSON.stringify(Number((months[i] ?? 0).toFixed(6))));
  }
}

export function applyAutoCalc(
  safraId?: number | null,
  opts?: { forceMaterials?: boolean; parentLineId?: number | null },
) {
  ensureCalcParams();
  ensureLineSafraPrices();
  const harvestId = resolveSafraId(safraId);
  const rules = db
    .prepare(
      `SELECT r.id, r.kind, r.material_id, r.activity_id, r.premise, r.dose, r.rate_ha, r.price, r.exclude_weekdays, r.area_premise, r.use_activity_auto, r.start_month, r.end_month, r.from_materials, r.calc_mode, m.valor AS material_price
       FROM calc_params r
       LEFT JOIN materials m ON m.id = r.material_id
       WHERE r.safra_id = ?`,
    )
    .all(harvestId) as {
      id: number;
      kind: "material" | "activity";
      material_id: number | null;
      activity_id: number | null;
      premise: string;
      dose: number | null;
      rate_ha: number | null;
      price: number | null;
      exclude_weekdays: string | null;
      area_premise: string | null;
      use_activity_auto: number | null;
      start_month: number | null;
      end_month: number | null;
      from_materials: number | null;
      calc_mode?: string | null;
      material_price: number | null;
    }[];
  const costLinks = loadRuleCostObjectMap();
  const enriched = rules.map((rule) => ({
    ...rule,
    costObjectIds: rule.kind === "activity" ? normalizeCostObjectIds(costLinks.get(rule.id) ?? []) : [],
    months: null as number[] | null,
  }));

  const byMaterial = new Map<number, number[]>();
  const used = new Set<string>();
  const ordered = [...enriched].sort((a, b) => ruleScore(b) - ruleScore(a));
  const startYear = harvestStartYear(harvestId);

  for (const rule of ordered) {
    const targetId = rule.kind === "activity" ? rule.activity_id : rule.material_id;
    const key =
      rule.kind === "activity"
        ? `${rule.kind}:${targetId ?? 0}:${rule.premise}:${ruleCalcMode(rule)}:${costObjectKey(rule.costObjectIds)}`
        : `${rule.kind}:${targetId ?? 0}:${rule.premise}`;
    if (used.has(key)) continue;
    used.add(key);
    if (rule.from_materials === 1 || isHoursRule(rule)) continue;
    let months: number[];
    if (isDaysRule(rule.premise)) {
      const price = Number(rule.price) > 0 ? Number(rule.price) : Number(rule.material_price) || 0;
      const qty = Number(rule.dose) > 0 ? Number(rule.dose) : 1;
      if (!(price > 0)) continue;
      const exclude = parseExcludeWeekdays(rule.exclude_weekdays);
      months = workingDaysBySafraMonth(startYear, exclude).map((days) => days * qty * price);
      months = gateMonthsByArea(months, rule.area_premise);
    } else {
      const unit = unitPerHa(rule);
      if (!(unit > 0)) continue;
      const ha = premiseMonthSeries(rule.premise);
      months = ha.map((qty) => roundPremiseQty(qty) * unit);
    }
    rule.months = months;
    if (rule.kind === "material" && rule.material_id) {
      const current = byMaterial.get(rule.material_id) ?? Array.from({ length: 12 }, () => 0);
      addMonths(current, months);
      byMaterial.set(rule.material_id, current);
    }
  }

  function matchingRulesForActivity(activityId: number, costObjectId: number | null) {
    const forActivity = ordered.filter((rule) => rule.kind === "activity" && rule.activity_id === activityId);
    const byPremise = new Map<string, typeof forActivity>();
    for (const rule of forActivity) {
      const groupKey = `${rule.premise}:${ruleCalcMode(rule)}`;
      const list = byPremise.get(groupKey) ?? [];
      list.push(rule);
      byPremise.set(groupKey, list);
    }
    const picked: typeof forActivity = [];
    for (const group of byPremise.values()) {
      const specific = group.filter(
        (rule) => rule.costObjectIds.length && costObjectId != null && rule.costObjectIds.includes(costObjectId),
      );
      const chosen = specific[0] ?? group.find((rule) => !rule.costObjectIds.length);
      if (chosen) picked.push(chosen);
    }
    return picked;
  }

  function pickActivityRule(activityId: number, costObjectId: number | null) {
    const matching = matchingRulesForActivity(activityId, costObjectId).filter((rule) => !isHoursRule(rule));
    if (!matching.length) return null;
    return [...matching].sort((a, b) => ruleScore(b) - ruleScore(a))[0];
  }

  const autoLines = db
    .prepare(
      `SELECT DISTINCT line_id FROM line_months WHERE formula = ?`,
    )
    .all(AUTO_CALC_FORMULA) as { line_id: number }[];

  const applied = new Set<number>();

  relinkActivityHeads();

  const activities = db.prepare("SELECT id, description FROM activities").all() as { id: number; description: string }[];

  const activityLines = db
    .prepare(
      `SELECT l.id, l.activity_id, l.description, l.cost_object_id, l.parent_id, l.use_activity_auto, l.start_month, l.end_month, l.calc_months,
              l.calc_plans, l.calc_premise, l.calc_dose, l.calc_price, l.calc_exclude_weekdays, l.calc_area_premise, l.calc_area_pct, l.calc_area_ha,
              l.calc_reduce_pct,
              c.name AS category_name
       FROM lines l
       JOIN categories c ON c.id = l.category_id
       WHERE l.ref_kind = 'activity'
          OR (
            COALESCE(l.is_group, 0) = 1
            AND TRIM(COALESCE(l.product_code, '')) <> ''
            AND l.material_id IS NULL
            AND COALESCE(l.ref_kind, '') <> 'activity'
            AND COALESCE(l.ref_kind, '') <> 'cost_center'
            AND (
              l.ref_kind = 'cost_object'
              OR (l.parent_id IS NULL AND (l.item_type = 'E' OR l.item_type = 'G'))
            )
          )
          OR (
            l.parent_id IS NULL AND (
              l.is_group = 1 OR l.id IN (SELECT DISTINCT parent_id FROM lines WHERE parent_id IS NOT NULL)
            ) AND COALESCE(l.ref_kind, '') <> 'cost_center'
          )`,
    )
    .all() as {
      id: number;
      activity_id: number | null;
      description: string;
      cost_object_id: number | null;
      parent_id: number | null;
      category_name: string | null;
      use_activity_auto: number | null;
      start_month: number | null;
      end_month: number | null;
      calc_months: string | null;
      calc_plans: string | null;
      calc_premise: string | null;
      calc_dose: number | null;
      calc_price: number | null;
      calc_exclude_weekdays: string | null;
      calc_area_premise: string | null;
      calc_area_pct: number | null;
      calc_area_ha: number | null;
      calc_reduce_pct: number | null;
    }[];
  for (const raw of activityLines) {
    const line = linkedActivityAreaRef(raw);
    if (isFuelLubricantCategory(line.category_name)) {
      db.prepare("UPDATE lines SET use_activity_auto = 0 WHERE id = ?").run(line.id);
      continue;
    }
    const plans = parseCalcPlans(line.calc_plans);
    if (isMaintenanceCategory(line.category_name)) {
      // Manutenção: valores vêm dos materiais — exceto equipamento/cabeça com cálculo próprio (ex.: valor fixo).
      if (hasManualFormula(line.id)) {
        db.prepare("UPDATE lines SET use_activity_auto = 0 WHERE id = ?").run(line.id);
        continue;
      }
      if (plans.length && line.use_activity_auto === 0) {
        const overlay = overlayActivityPlans(Array.from({ length: 12 }, () => 0), plans, line, startYear);
        if (overlay.wrote) {
          writeAutoMonths(line.id, overlay.months);
          applied.add(line.id);
        }
      } else {
        writeAutoMonths(line.id, Array.from({ length: 12 }, () => 0));
        applied.add(line.id);
      }
      continue;
    }
    if (hasManualFormula(line.id) && !plans.length) continue;
    if (line.use_activity_auto === 0) {
      const zeros = Array.from({ length: 12 }, () => 0);
      if (plans.length) {
        const overlay = overlayActivityPlans(zeros, plans, line, startYear);
        if (!overlay.wrote) continue;
        writeAutoMonths(line.id, overlay.months);
        applied.add(line.id);
        continue;
      }
      if (!(Number(line.calc_dose) > 0 && Number(line.calc_price) > 0)) continue;
      const autoPremise = lookupActivityAutoAreaPremise(line.activity_id, line.cost_object_id, null, line.description);
      const days = isDaysRule(line.calc_premise ?? "");
      const computed = computeCalcMonths({
        premise: days ? DAYS_PREMISE : (autoPremise ?? line.calc_premise),
        dose: line.calc_dose,
        price: line.calc_price,
        excludeWeekdays: line.calc_exclude_weekdays,
        areaPremise: days && line.calc_area_premise ? (autoPremise ?? line.calc_area_premise) : line.calc_area_premise,
        startYear,
        areaPct: line.calc_area_pct,
      });
      const months = computed
        ? gateMonthsByPeriod(computed, clampMonth(line.start_month), clampMonth(line.end_month))
        : zeros;
      writeAutoMonths(line.id, months);
      applied.add(line.id);
      continue;
    }
    const activityId = line.activity_id ?? matchActivityIdFromList(activities, line.description);
    if (!activityId && !plans.length) continue;
    const matching = activityId ? matchingRulesForActivity(activityId, line.cost_object_id) : [];
    const zeros = Array.from({ length: 12 }, () => 0);
    if (matching.some((rule) => rule.from_materials === 1 || isHoursRule(rule))) {
      const overlay = plans.length ? overlayActivityPlans(zeros, plans, line, startYear) : { months: zeros, wrote: true };
      writeAutoMonths(line.id, overlay.months);
      applied.add(line.id);
      continue;
    }
    const months = [...zeros];
    let wrote = false;
    for (const rule of matching) {
      if (!rule.months) continue;
      addMonths(months, rule.months);
      wrote = true;
    }
    const overlay = plans.length ? overlayActivityPlans(months, plans, line, startYear) : { months, wrote: false };
    if (!wrote && !overlay.wrote) continue;
    writeAutoMonths(line.id, overlay.months);
    applied.add(line.id);
  }

  const activityById = new Map(activityLines.map((row) => [row.id, linkedActivityAreaRef(row)]));

  function parentUsesDays(parent: (typeof activityLines)[number]) {
    if (parent.use_activity_auto === 0) return isDaysRule(parent.calc_premise ?? "");
    const activityId = parent.activity_id ?? matchActivityIdFromList(activities, parent.description);
    if (!activityId) return false;
    const rule = pickActivityRule(activityId, parent.cost_object_id);
    return rule ? isDaysRule(rule.premise) : false;
  }

  function weightsForActivity(parent: (typeof activityLines)[number]) {
    if (parent.use_activity_auto === 0) {
      const autoPremise = lookupActivityAutoAreaPremise(parent.activity_id, parent.cost_object_id, null, parent.description);
      const days = isDaysRule(parent.calc_premise ?? "");
      return computeCalcWeights({
        premise: days ? DAYS_PREMISE : (autoPremise ?? parent.calc_premise),
        excludeWeekdays: parent.calc_exclude_weekdays,
        areaPremise: days && parent.calc_area_premise ? (autoPremise ?? parent.calc_area_premise) : parent.calc_area_premise,
        startYear,
        startMonth: parent.start_month,
        endMonth: parent.end_month,
        usePeriod: true,
      });
    }
    const activityId = parent.activity_id ?? matchActivityIdFromList(activities, parent.description);
    if (!activityId) {
      return computeCalcWeights({
        premise: "plantio_total",
        excludeWeekdays: null,
        areaPremise: null,
        startYear,
      });
    }
    const rule = pickActivityRule(activityId, parent.cost_object_id);
    if (!rule) return null;
    return computeCalcWeights({
      premise: rule.premise,
      excludeWeekdays: rule.exclude_weekdays,
      areaPremise: rule.area_premise,
      startYear,
    });
  }

  const materialLines = db
    .prepare(
      `SELECT l.id, l.material_id, l.parent_id, l.ref_kind, l.product_code, l.description, l.calc_dose, p.calc_price, l.calc_area_pct, l.calc_area_ha, l.calc_applications, l.calc_months, l.calc_area_premise, l.calc_kind, l.calc_trips, l.calc_machine_qty, l.calc_hour_interval, l.calc_exclude_weekdays
         FROM lines l
         LEFT JOIN line_safra_prices p ON p.line_id = l.id AND p.safra_id = ?
        WHERE (l.ref_kind = 'material' AND l.material_id IS NOT NULL)
           OR (
             l.ref_kind = 'cost_object'
             AND NOT (
               COALESCE(l.is_group, 0) = 1
               AND TRIM(COALESCE(l.product_code, '')) <> ''
             )
           )`,
    )
    .all(harvestId) as {
      id: number;
      material_id: number | null;
      parent_id: number | null;
      ref_kind: string | null;
      product_code: string | null;
      description: string | null;
      calc_dose: number | null;
      calc_price: number | null;
      calc_area_pct: number | null;
      calc_area_ha: number | null;
      calc_applications: number | null;
      calc_months: string | null;
      calc_area_premise: string | null;
      calc_kind: string | null;
      calc_trips: number | null;
      calc_machine_qty: number | null;
      calc_hour_interval: number | null;
      calc_exclude_weekdays: string | null;
    }[];
  const forceMaterials = opts?.forceMaterials === true;
  const parentLineId = opts?.parentLineId != null ? Number(opts.parentLineId) : null;

  for (const line of materialLines) {
    if (!(Number(line.calc_price) > 0)) {
      if (!hasManualFormula(line.id) && (Number(line.calc_dose) > 0 || line.ref_kind === "cost_object")) {
        writeAutoMonths(line.id, Array.from({ length: 12 }, () => 0));
        applied.add(line.id);
      }
      continue;
    }
    const parent = line.parent_id ? activityById.get(line.parent_id) : undefined;
    const hours =
      (line.ref_kind === "cost_object" || line.calc_kind === "hours") &&
      parent &&
      !isTripsMaterial(line) &&
      !isDaysHoursMaterial(line) &&
      !materialOwnPremiseKey(line)
        ? computeActivityHoursMonths(parent)
        : null;
    const ownKey = materialOwnPremiseKey(line);
    const forceThis =
      forceMaterials &&
      Number(line.calc_price) > 0 &&
      (parentLineId == null || line.parent_id === parentLineId) &&
      (Number(line.calc_dose) > 0 || Boolean(hours) || isTripsMaterial(line) || isDaysHoursMaterial(line));
    if (isFuelLubricantCategory(parent?.category_name) && !forceThis && !ownKey) {
      applied.add(line.id);
      continue;
    }
    const equipmentHourCost =
      line.ref_kind === "cost_object" && equipmentCodesFromLine(line).length > 0;
    if (!forceThis && hasManualFormula(line.id) && !equipmentHourCost) continue;
    if (isDaysHoursMaterial(line)) {
      const daysMonths = computeMaterialAutoMonths(parent, line, startYear);
      if (daysMonths) {
        writeAutoMonths(line.id, daysMonths);
        applied.add(line.id);
      }
      continue;
    }
    if (hours) {
      const scaled = scaleHoursByInterval(
        hours,
        line.calc_hour_interval,
        line.calc_dose,
        line.calc_price,
        line.calc_applications,
      );
      if (scaled) {
        writeAutoMonths(line.id, gateMonthsBySelection(scaled, parseCalcMonths(line.calc_months)));
        applied.add(line.id);
      }
      continue;
    }
    if (isTripsMaterial(line)) {
      const tripsMonths = computeMaterialAutoMonths(parent, line);
      if (tripsMonths) {
        writeAutoMonths(line.id, tripsMonths);
        applied.add(line.id);
      }
      continue;
    }
    const days = !ownKey && parent ? parentUsesDays(parent) : false;
    const plan = materialAreaPlan(parent, line);
    const weights = days ? (parent ? weightsForActivity(parent) : null) : plan?.active ?? (ownKey || !parent ? null : weightsForActivity(parent));
    if (weights || plan) {
      const rawScaled =
        plan && Number(line.calc_area_ha) > 0
          ? scaleInformedArea(plan, line.calc_dose, line.calc_price, line.calc_area_ha, line.calc_applications)
          : weights
            ? scaleWeights(weights, line.calc_dose, line.calc_price, days ? null : line.calc_area_pct, null, line.calc_applications)
            : null;
      const scaled = rawScaled ? gateMonthsBySelection(rawScaled, parseCalcMonths(line.calc_months)) : null;
      if (scaled) {
        writeAutoMonths(line.id, scaled);
        applied.add(line.id);
        continue;
      }
      const current = db
        .prepare("SELECT month_index, value FROM line_months WHERE line_id = ?")
        .all(line.id) as { month_index: number; value: string | null }[];
      const monthly = current.reduce((max, row) => {
        const value = Number(row.value ? JSON.parse(row.value) : 0);
        return Number.isFinite(value) && value > max ? value : max;
      }, 0);
      if (monthly > 0 && weights) {
        writeAutoMonths(
          line.id,
          gateMonthsBySelection(
            weights.map((weight) => (weight > 0 ? monthly : 0)),
            parseCalcMonths(line.calc_months),
          ),
        );
        applied.add(line.id);
      }
      continue;
    }
    const months = line.material_id != null ? byMaterial.get(line.material_id) : undefined;
    if (!months) continue;
    writeAutoMonths(line.id, gateMonthsBySelection(months, parseCalcMonths(line.calc_months)));
    applied.add(line.id);
  }

  for (const row of autoLines) {
    if (applied.has(row.line_id)) continue;
    db.prepare("DELETE FROM line_months WHERE line_id = ? AND formula = ?").run(row.line_id, AUTO_CALC_FORMULA);
  }
}

export async function applyAutoCalcFull(
  safraId?: number | null,
  opts?: { forceMaterials?: boolean; parentLineId?: number | null; strictObcSplit?: boolean },
) {
  applyAutoCalc(safraId, opts);
  await syncEquipmentHourCostSplit({ strict: opts?.strictObcSplit });
}
