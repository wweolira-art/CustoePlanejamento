import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import { atividadeSubstituidaPorMateriaisE } from "../lib/import-materials";
import { QUANTITY_UNITS, quantityUnit, type QuantityUnit } from "../../shared/quantity-unit";
import { atividadeDaImportacao, empenhoDaImportacao } from "../lib/import-empenho";
import { api, type Activity, type ApontamentoEquipmentData, type ApontamentoEquipmentItem, type ApontamentoEquipmentRate, type CalcRule, type CatalogCategory, type CostObject, type CostObjectHourCost, type CostObjectHourCostData, type DashboardData, type Empenho, type EquipmentCatalogItem, type EquipmentHourCost, type EquipmentHourCostData, type LineItem, type Material, type MaterialLastPrice, type SheetDetail, type SheetInfo, type ValueDistribution } from "../api";
import { formatBRL, formatQty, parseMoneyInput } from "../lib/format";
import { useApp } from "../store";
import { ReadOnlyFieldset } from "../lib/editAccess";
import {
  FuncionarioApiCalcPanel,
  isFuncionarioHeadLine,
  isFolhaAvulsaLine,
  parseFuncionarioApiConfig,
  type FuncionarioApiCalcMode,
} from "./FuncionarioApiCalc";
import {
  ArrendamentoCalcFields,
  emptyArrendamentoCalc,
  isArrendamentoSheet,
  type ArrendamentoCalcResult,
  type ArrendamentoCalcValue,
} from "./ArrendamentoCalc";
import type { FuncionarioApiConfig } from "../api";
import { useSafraLoaded } from "./SafraLoadProgress";

const AUTO_CALC_FORMULA = "=AUTOCALC";
const MONTHS = ["Set", "Out", "Nov", "Dez", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago"];
const IMPORT_FIXED_COLUMNS = [
  "COD_GRUPOEMPRESA",
  "COD_EMPRESA",
  "COD_FILIAL",
  "OBJETOCUSTO",
  "ITEMCUSTO",
  "EMPENHO",
  "SUBEMPENHO",
  "OBSERVACAO",
  "ANOMESINI",
  "ANOMESFIM",
  "INDICE",
] as const;
const MAINTENANCE_EQUIPMENT_EMPENHOS = [
  { code: 26, percentage: 1.14 },
  { code: 190, percentage: 72.88 },
  { code: 192, percentage: 0.33 },
  { code: 254, percentage: 15.08 },
  { code: 332, percentage: 7.92 },
  { code: 428, percentage: 0.09 },
  { code: 466, percentage: 2.49 },
  { code: 472, percentage: 0.08 },
] as const;
const MONTH_NAMES = [
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
];

const WEEKDAYS = [
  { id: 0, short: "Dom", name: "domingo" },
  { id: 1, short: "Seg", name: "segunda" },
  { id: 2, short: "Ter", name: "terça" },
  { id: 3, short: "Qua", name: "quarta" },
  { id: 4, short: "Qui", name: "quinta" },
  { id: 5, short: "Sex", name: "sexta" },
  { id: 6, short: "Sáb", name: "sábado" },
];

const FALLBACK_DRIVERS = [
  { key: "plantio_verao", label: "Plantio de verão" },
  { key: "plantio_inverno", label: "Plantio de inverno" },
  { key: "plantio_total", label: "Plantio total (verão + inverno)" },
  { key: "tratos_planta", label: "Tratos de cana planta" },
  { key: "tratos_soca", label: "Tratos de cana soca" },
  { key: "moagem", label: "Moagem (t)" },
  { key: "tonsManual", label: "Colheita manual (t)" },
];

type CalcDriver = { key: string; label: string };

function autoAreaPremiseFromRules(
  rules: CalcRule[],
  activityId?: number | null,
  costObjectId?: number | null,
): string | null {
  const pool = activityRulePool(rules, activityId, costObjectId);
  const areaRule = pool.find((rule) => rule.mode !== "days" && rule.mode !== "hours" && rule.premise !== "dias");
  if (areaRule) return areaRule.premise;
  const daysRule = pool.find((rule) => rule.mode === "days" || rule.premise === "dias");
  if (daysRule?.areaPremise && daysRule.areaPremise !== "dias") return daysRule.areaPremise;
  return null;
}

function activityRulePool(
  rules: CalcRule[],
  activityId?: number | null,
  costObjectId?: number | null,
): CalcRule[] {
  if (!activityId) return [];
  const matching = rules.filter((rule) => {
    if (rule.kind !== "activity" || rule.activityId !== activityId) return false;
    const ids = rule.costObjectIds ?? [];
    if (!ids.length) return true;
    return costObjectId != null && ids.includes(costObjectId);
  });
  const specific = matching.filter((rule) => (rule.costObjectIds?.length ?? 0) > 0);
  return specific.length ? specific : matching.filter((rule) => !(rule.costObjectIds?.length));
}

function hoursRuleFromRules(
  rules: CalcRule[],
  activityId?: number | null,
  costObjectId?: number | null,
): CalcRule | null {
  return activityRulePool(rules, activityId, costObjectId).find((rule) => rule.mode === "hours") ?? null;
}

function hoursRuleLabel(rule: CalcRule | null, drivers: CalcDriver[]) {
  if (!rule) return "";
  const driver = premiseLabel(rule.premise, drivers) ?? rule.premise;
  const tonHour = rule.dose != null ? String(rule.dose).replace(".", ",") : "t/h";
  const qty = Number(rule.rateHa) > 0 ? rule.rateHa : 1;
  return `horas = (${driver} / ${tonHour} t/h) × ${qty}`;
}

function activityHasAutoValue(
  rules: CalcRule[],
  activityId?: number | null,
  costObjectId?: number | null,
) {
  return activityRulePool(rules, activityId, costObjectId).length > 0;
}

type AutoRuleFn = "area" | "days" | "hours" | "materials";

type AutoRuleDraft = {
  ruleId: number | null;
  mode: AutoRuleFn;
  premise: string;
  dose: string;
  hoursQty: string;
  price: string;
  excludeWeekdays: number[];
  followArea: boolean;
  areaPremise: string;
  costObjectIds: number[];
};

function emptyAutoRuleDraft(): AutoRuleDraft {
  return {
    ruleId: null,
    mode: "area",
    premise: "plantio_verao",
    dose: "",
    hoursQty: "1",
    price: "",
    excludeWeekdays: [],
    followArea: false,
    areaPremise: "plantio_total",
    costObjectIds: [],
  };
}

function autoRuleDraftFromRules(
  rules: CalcRule[],
  activityId?: number | null,
  costObjectId?: number | null,
): AutoRuleDraft {
  const pool = activityRulePool(rules, activityId, costObjectId);
  const valueRule = pool.find((rule) => rule.mode !== "hours") ?? null;
  const hoursRule = pool.find((rule) => rule.mode === "hours") ?? null;
  const rule = valueRule ?? hoursRule;
  if (!rule) return emptyAutoRuleDraft();
  const hoursMode = rule.mode === "hours";
  const daysMode = !hoursMode && (rule.mode === "days" || rule.premise === "dias");
  const materials = Boolean(rule.fromMaterials);
  return {
    ruleId: rule.id,
    mode: hoursMode ? "hours" : materials ? "materials" : daysMode ? "days" : "area",
    premise: hoursMode || !daysMode ? rule.premise : rule.areaPremise || "plantio_verao",
    dose: rule.dose != null ? String(rule.dose).replace(".", ",") : "",
    hoursQty: hoursMode && Number(rule.rateHa) > 0 ? String(rule.rateHa).replace(".", ",") : "1",
    price: rule.price != null ? String(rule.price).replace(".", ",") : "",
    excludeWeekdays: rule.excludeWeekdays ?? [],
    followArea: Boolean(rule.areaPremise),
    areaPremise: rule.areaPremise && rule.areaPremise !== "dias" ? rule.areaPremise : "plantio_total",
    costObjectIds: rule.costObjectIds ?? [],
  };
}

function validateAutoRuleDraft(draft: AutoRuleDraft) {
  if (draft.mode === "materials") {
    if (!draft.premise) return "Selecione a premissa do cálculo automático.";
    return null;
  }
  if (draft.mode === "hours") {
    if (!(parseInputNum(draft.dose) > 0)) return "Informe as toneladas por hora do cálculo automático.";
    if (!(parseInputNum(draft.hoursQty) > 0)) return "Informe a quantidade do cálculo automático por tonelada.";
    if (!draft.premise) return "Selecione a premissa do cálculo automático.";
    return null;
  }
  if (draft.mode === "area" && !draft.premise) return "Selecione a premissa do cálculo automático.";
  if (draft.mode === "area" && !(parseInputNum(draft.dose) > 0)) {
    return "Informe a quantidade por hectare do cálculo automático.";
  }
  if (!(parseInputNum(draft.price) > 0)) return "Informe o preço do cálculo automático.";
  return null;
}

async function saveAutoRuleDraft(
  draft: AutoRuleDraft,
  activityId: number,
  safraId?: number | null,
) {
  const hoursMode = draft.mode === "hours";
  const daysMode = draft.mode === "days";
  const fromMaterials = draft.mode === "materials";
  const body = {
    kind: "activity" as const,
    activityId,
    mode: (hoursMode ? "hours" : daysMode ? "days" : "area") as "area" | "days" | "hours",
    premise: daysMode ? "dias" : draft.premise,
    dose: fromMaterials
      ? null
      : parseInputNum(draft.dose) || (daysMode ? 1 : null),
    rateHa: hoursMode ? parseInputNum(draft.hoursQty) || 1 : null,
    price: fromMaterials || hoursMode ? null : parseInputNum(draft.price),
    excludeWeekdays: daysMode ? draft.excludeWeekdays : [],
    areaPremise: daysMode && draft.followArea ? draft.areaPremise : null,
    fromMaterials,
    costObjectIds: draft.costObjectIds,
    safraId: safraId ?? undefined,
  };
  if (draft.ruleId) return api.updateCalcRule(draft.ruleId, body);
  return api.addCalcRule(body);
}

function emptyMonthValues() {
  return MONTHS.map(() => "");
}

function safraImportMonths(code?: string | null) {
  const match = String(code ?? "").match(/(\d{2})\s*\/\s*(\d{2})/);
  const startYear = match ? 2000 + Number(match[1]) : new Date().getFullYear();
  return [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8].map((month, index) => {
    const year = index < 4 ? startYear : startYear + 1;
    return year * 100 + month;
  });
}

function numberOrTextCode(value: string | number | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

function foldImportText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isFuncionarioImportCategory(name: string | null | undefined) {
  const text = foldImportText(name);
  return text.includes("despesa") && text.includes("funcionario");
}

function isMaintenanceImportCategory(name: string | null | undefined) {
  const text = foldImportText(name).replace(/[^a-z0-9]+/g, " ").trim();
  return text === "despesa c manutencao" || text === "despesas com manutencao";
}

function activityImportCode(activities: Activity[], line: LineItem) {
  return numberOrTextCode(empenhoDaImportacao(activities, line));
}

function subempenhoImportCode(activities: Activity[], line: LineItem) {
  const product = String(line.product_code ?? "").trim();
  if (line.item_type === "E" && product) return `E${product}`;

  const activityCode = atividadeDaImportacao(activities, line)?.code?.trim();
  if (activityCode) return `G${activityCode.replace(/^G(?=\d)/i, "")}`;

  if (!product) return "";
  const type = line.item_type === "E" || line.item_type === "G" ? line.item_type : "";
  return `${type}${product}`;
}

function lineHasImportValue(line: LineItem) {
  return line.months.some((month) => Number(month.value) !== 0);
}

function lineCanExport(line: LineItem, parentIds: Set<number>) {
  if (line.ref_kind === "cost_center") return false;
  if (line.is_group && parentIds.has(line.id)) return false;
  return lineHasImportValue(line);
}

function buildImportRows(data: SheetDetail, activities: Activity[], monthKeys: number[]) {
  const rows: Array<Record<string, string | number | null>> = [];
  const atividadesComMateriais = atividadeSubstituidaPorMateriaisE(data.categories.flatMap((category) => category.lines), data.name);
  for (const category of data.categories) {
    if (isFuncionarioImportCategory(category.name)) continue;
    const parentIds = new Set(
      category.lines
        .map((line) => line.parent_id)
        .filter((id): id is number => typeof id === "number" && id > 0),
    );
    const maintenanceByObject = new Map<string, { source: LineItem; monthlyCents: number[] }>();
    for (const line of category.lines) {
      if (atividadesComMateriais.has(line.id)) continue;
      if (!lineCanExport(line, parentIds)) continue;
      const isLinkedMaintenanceEquipment =
        isMaintenanceImportCategory(category.name) &&
        !(line.ref_kind === "material" && line.item_type === "E") &&
        (line.item_type === "E" || line.ref_kind === "cost_object") &&
        line.activity_id != null &&
        activities.some((activity) => activity.id === line.activity_id);

      if (isLinkedMaintenanceEquipment) {
        const objectCode = String(line.object_code ?? data.name).trim();
        const current = maintenanceByObject.get(objectCode) ?? {
          source: line,
          monthlyCents: monthKeys.map(() => 0),
        };
        line.months.forEach((month, index) => {
          current.monthlyCents[index] += Math.round((Number(month.value) || 0) * 100);
        });
        maintenanceByObject.set(objectCode, current);
        continue;
      }

      const row: Record<string, string | number | null> = {
        COD_GRUPOEMPRESA: 1,
        COD_EMPRESA: 1,
        COD_FILIAL: 1,
        OBJETOCUSTO: numberOrTextCode(line.object_code ?? data.name),
        ITEMCUSTO: "",
        EMPENHO: activityImportCode(activities, line),
        SUBEMPENHO: subempenhoImportCode(activities, line),
        OBSERVACAO: line.observation?.trim() || line.description,
        ANOMESINI: monthKeys[0],
        ANOMESFIM: "",
        INDICE: 1,
      };
      line.months.forEach((month, index) => {
        row[String(monthKeys[index])] = Math.round((Number(month.value) || 0) * 100) / 100;
      });
      rows.push(row);
    }

    // Soma todas as atividades/equipamentos do mesmo objeto antes de aplicar
    // os percentuais de empenho (os percentuais informados somam 100,01%).
    const totalPercentage = MAINTENANCE_EQUIPMENT_EMPENHOS.reduce(
      (total, item) => total + item.percentage,
      0,
    );
    for (const [objectCode, group] of maintenanceByObject) {
      const baseRow: Record<string, string | number | null> = {
        COD_GRUPOEMPRESA: 1,
        COD_EMPRESA: 1,
        COD_FILIAL: 1,
        OBJETOCUSTO: numberOrTextCode(objectCode),
        ITEMCUSTO: "",
        EMPENHO: 0,
        SUBEMPENHO: "G28",
        OBSERVACAO: group.source.observation?.trim() || group.source.description,
        ANOMESINI: monthKeys[0],
        ANOMESFIM: "",
        INDICE: 1,
      };
      MAINTENANCE_EQUIPMENT_EMPENHOS.forEach((empenho, empenhoIndex) => {
        const distributedRow = { ...baseRow, EMPENHO: Number(empenho.code) };
        monthKeys.forEach((monthKey, monthIndex) => {
          const totalCents = group.monthlyCents[monthIndex] ?? 0;
          const roundedShare = Math.round(totalCents * (empenho.percentage / totalPercentage));
          const isLast = empenhoIndex === MAINTENANCE_EQUIPMENT_EMPENHOS.length - 1;
          const centsBeforeLast = isLast
            ? MAINTENANCE_EQUIPMENT_EMPENHOS.slice(0, -1).reduce(
                (sum, previous) => sum + Math.round(totalCents * (previous.percentage / totalPercentage)),
                0,
              )
            : 0;
          distributedRow[String(monthKey)] =
            (isLast ? totalCents - centsBeforeLast : roundedShare) / 100;
        });
        rows.push(distributedRow);
      });
    }
  }
  return rows;
}

function writeImportWorkbook(rows: Array<Record<string, string | number | null>>, headers: string[], fileName: string) {
  if (!rows.length) throw new Error("Não há linhas com valor mensal para exportar.");

  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  XLSX.utils.sheet_add_aoa(worksheet, [headers], { origin: "A1" });
  worksheet["!cols"] = headers.map((header) => ({
    wch: Math.max(10, Math.min(28, header.length + 2)),
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Import");
  XLSX.writeFile(workbook, fileName);
}

function exportImportWorkbook(data: SheetDetail, activities: Activity[], safraCode?: string | null) {
  const monthKeys = safraImportMonths(safraCode);
  const headers = [...IMPORT_FIXED_COLUMNS, ...monthKeys.map(String)];
  const rows = buildImportRows(data, activities, monthKeys);
  const safeSheet = data.name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "orcamento";
  const safeSafra = String(safraCode ?? "safra").replace(/[\\/:*?"<>|]+/g, "-").trim();
  writeImportWorkbook(rows, headers, `Importacao_Planejamento_Tecnica_${safeSheet}_${safeSafra}.xlsx`);
  return rows.length;
}

function exportAllImportWorkbook(details: SheetDetail[], activities: Activity[], safraCode?: string | null) {
  const monthKeys = safraImportMonths(safraCode);
  const headers = [...IMPORT_FIXED_COLUMNS, ...monthKeys.map(String)];
  const rows = details.flatMap((detail) => buildImportRows(detail, activities, monthKeys));
  const safeSafra = String(safraCode ?? "safra").replace(/[\\/:*?"<>|]+/g, "-").trim();
  writeImportWorkbook(rows, headers, `Importacao_Planejamento_Tecnica_Todos_Centros_${safeSafra}.xlsx`);
  return rows.length;
}

function monthValuesFromAmounts(amounts?: number[] | null) {
  return MONTHS.map((_, i) => {
    const n = amounts?.[i] ?? 0;
    if (!(n > 0)) return "";
    return String(Math.round(n * 100) / 100).replace(".", ",");
  });
}

function monthValuesPayload(values: string[]) {
  return values
    .map((raw, month) => ({ month, value: parseInputNum(raw) }))
    .filter((row) => Number.isFinite(row.value) && row.value > 0);
}

function uniformFixedMonths(amounts?: number[] | null) {
  const picked = (amounts ?? [])
    .map((value, month) => ({ month, value: Number(value) || 0 }))
    .filter((row) => row.value > 0);
  if (!picked.length) return null;
  const value = picked[0].value;
  if (!picked.every((row) => Math.abs(row.value - value) < 0.01)) return null;
  return { value, months: picked.map((row) => row.month) };
}

function quantityOrOne(raw: string) {
  const n = parseInputNum(raw);
  return n > 0 ? n : 1;
}

function fixedMonthlyAmount(value: string, qty: string) {
  const unit = parseInputNum(value);
  return unit > 0 ? unit * quantityOrOne(qty) : 0;
}

function FixedMonthValueFields({
  value,
  qty,
  months,
  onValue,
  onQty,
  onMonths,
}: {
  value: string;
  qty: string;
  months: number[];
  onValue: (next: string) => void;
  onQty: (next: string) => void;
  onMonths: (next: number[]) => void;
}) {
  const unit = parseInputNum(value);
  const factor = quantityOrOne(qty);
  const monthly = fixedMonthlyAmount(value, qty);
  const total = monthly > 0 && months.length ? monthly * months.length : 0;
  return (
    <>
      <label>
        Quantidade
        <small>Quantidade × preço unitário em cada mês escolhido, sem usar área ou dias.</small>
        <input value={qty} onChange={(e) => onQty(e.target.value)} placeholder="Ex.: 1" />
      </label>
      <label>
        Preço unitário (R$)
        <input value={value} onChange={(e) => onValue(e.target.value)} placeholder="Ex.: 1500" />
      </label>
      <label className="span-2">
        Meses
        <small>
          {months.length
            ? `${months.length} escolhido${months.length === 1 ? "" : "s"}`
            : "Escolha os meses que recebem o valor"}
        </small>
        <div className="choice-picks">
          <button
            type="button"
            className={months.length === 12 ? "on" : ""}
            onClick={() => onMonths(months.length === 12 ? [] : ALL_MONTHS)}
          >
            {months.length === 12 ? "Limpar" : "Todos"}
          </button>
          {MONTHS.map((label, month) => (
            <button
              key={label}
              type="button"
              className={months.includes(month) ? "on" : ""}
              onClick={() =>
                onMonths(
                  months.includes(month)
                    ? months.filter((item) => item !== month)
                    : [...months, month].sort((a, b) => a - b),
                )
              }
            >
              {label}
            </button>
          ))}
        </div>
      </label>
      {monthly > 0 && months.length ? (
        <div className="formula-box" style={{ margin: "0 0 8px" }}>
          {factor !== 1 && unit > 0
            ? `${String(qty).replace(".", ",")} × ${formatBRL(unit)} = ${formatBRL(monthly)} em cada mês (${distributionMonthsLabel(months)}) · total ${formatBRL(total)}`
            : `${formatBRL(monthly)} em cada mês (${distributionMonthsLabel(months)}) · total ${formatBRL(total)}`}
        </div>
      ) : null}
    </>
  );
}

function VariableMonthValueFields({
  values,
  qty,
  months,
  onValues,
  onQty,
  onMonths,
}: {
  values: string[];
  qty: string;
  months: number[];
  onValues: (next: string[]) => void;
  onQty: (next: string) => void;
  onMonths: (next: number[]) => void;
}) {
  const factor = quantityOrOne(qty);
  const total = months.reduce((sum, month) => sum + fixedMonthlyAmount(values[month] ?? "", qty), 0);
  return (
    <>
      <label>
        Quantidade
        <small>Multiplica o valor informado em cada mês.</small>
        <input value={qty} onChange={(e) => onQty(e.target.value)} placeholder="Ex.: 1" />
      </label>
      <label className="span-2">
        Meses e valores
        <small>Selecione os meses e informe um valor para cada um.</small>
        <div className="choice-picks">
          <button
            type="button"
            className={months.length === 12 ? "on" : ""}
            onClick={() => onMonths(months.length === 12 ? [] : ALL_MONTHS)}
          >
            {months.length === 12 ? "Limpar" : "Todos"}
          </button>
          {MONTHS.map((label, month) => (
            <button
              key={label}
              type="button"
              className={months.includes(month) ? "on" : ""}
              onClick={() =>
                onMonths(
                  months.includes(month)
                    ? months.filter((item) => item !== month)
                    : [...months, month].sort((a, b) => a - b),
                )
              }
            >
              {label}
            </button>
          ))}
        </div>
      </label>
      {months.length ? (
        <div className="month-values-grid span-2">
          {months.map((month) => (
            <label key={month}>
              {MONTHS[month]}
              <input
                inputMode="decimal"
                value={values[month] ?? ""}
                onChange={(e) => {
                  const next = [...values];
                  next[month] = e.target.value;
                  onValues(next);
                }}
                placeholder="0,00"
              />
              {factor !== 1 && parseInputNum(values[month]) > 0 ? (
                <small>{formatBRL(fixedMonthlyAmount(values[month], qty))} no mês</small>
              ) : null}
            </label>
          ))}
        </div>
      ) : null}
      {total > 0 ? <div className="formula-box span-2" style={{ margin: "0 0 8px" }}>Total selecionado: {formatBRL(total)}</div> : null}
    </>
  );
}

function FixedActivityValueFields({
  mode,
  onMode,
  fixedValue,
  onFixedValue,
  values,
  qty,
  months,
  onValues,
  onQty,
  onMonths,
}: {
  mode: "same" | "individual";
  onMode: (mode: "same" | "individual") => void;
  fixedValue: string;
  onFixedValue: (value: string) => void;
  values: string[];
  qty: string;
  months: number[];
  onValues: (next: string[]) => void;
  onQty: (next: string) => void;
  onMonths: (next: number[]) => void;
}) {
  return (
    <div className="span-2">
      <div className="kind-toggle" style={{ padding: "0 0 8px" }}>
        <button type="button" className={`btn ${mode === "same" ? "primary" : ""}`} onClick={() => onMode("same")}>
          Mesmo valor nos meses
        </button>
        <button
          type="button"
          className={`btn ${mode === "individual" ? "primary" : ""}`}
          onClick={() => onMode("individual")}
        >
          Valor diferente por mês
        </button>
      </div>
      {mode === "same" ? (
        <FixedMonthValueFields
          value={fixedValue}
          qty={qty}
          months={months}
          onValue={onFixedValue}
          onQty={onQty}
          onMonths={onMonths}
        />
      ) : (
        <VariableMonthValueFields
          values={values}
          qty={qty}
          months={months}
          onValues={onValues}
          onQty={onQty}
          onMonths={onMonths}
        />
      )}
    </div>
  );
}

function MonthValuesFields({
  values,
  onChange,
  description = "Esta atividade não tem cálculo automático. Informe o valor de cada mês. Depois dá para alterar nesta mesma tela ou nas células da atividade.",
}: {
  values: string[];
  onChange: (next: string[]) => void;
  description?: string;
}) {
  const total = values.reduce((sum, raw) => sum + (parseInputNum(raw) > 0 ? parseInputNum(raw) : 0), 0);
  return (
    <div className="month-values">
      <p className="lead" style={{ margin: "0 0 8px", padding: 0 }}>
        {description}
      </p>
      <div className="month-values-grid">
        {MONTHS.map((label, i) => (
          <label key={label}>
            {label}
            <input
              value={values[i]}
              onChange={(e) => {
                const next = [...values];
                next[i] = e.target.value;
                onChange(next);
              }}
              placeholder="0"
            />
          </label>
        ))}
      </div>
      {total > 0 ? (
        <div className="formula-box" style={{ margin: "8px 0 0" }}>
          Total {formatBRL(total)}
        </div>
      ) : null}
    </div>
  );
}

function premiseLabel(key: string | null | undefined, drivers: CalcDriver[]) {
  if (!key) return null;
  return drivers.find((d) => d.key === key)?.label ?? key;
}

function areaMonthsFor(key: string, kpis: DashboardData["kpis"] | null) {
  if (!key || !kpis) return null;
  if (key === "plantio_verao") return kpis.months.map((m) => m.haVerao);
  if (key === "plantio_inverno") return kpis.months.map((m) => m.haInverno);
  if (key === "plantio_total") return kpis.months.map((m) => m.haVerao + m.haInverno);
  if (key === "tratos_planta") return kpis.months.map((m) => m.haPlanta);
  if (key === "tratos_soca") return kpis.months.map((m) => m.haSoca);
  if (key === "moagem") return kpis.months.map((m) => m.tons);
  if (key === "tonsManual") return kpis.months.map((m) => m.tonsManual);
  return kpis.subprocesses?.find((row) => row.key === key)?.months ?? null;
}

const SAFRA_CALENDAR_MONTHS = [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7];

function parseIsoDay(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  return null;
}

function overlapDayCount(start: Date, end: Date, monthStart: Date, monthEnd: Date) {
  const from = start > monthStart ? start : monthStart;
  const to = end < monthEnd ? end : monthEnd;
  if (from > to) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
}

function daysFromRange(start: string | null | undefined, end: string | null | undefined, kpis: DashboardData["kpis"]) {
  const a = parseIsoDay(start);
  const b = parseIsoDay(end);
  if (!a || !b) return kpis.months.map(() => 0);
  const from = a <= b ? a : b;
  const to = a <= b ? b : a;
  return kpis.months.map((month, i) => {
    const cal = SAFRA_CALENDAR_MONTHS[i] ?? 0;
    const monthStart = new Date(month.year, cal, 1);
    const monthEnd = new Date(month.year, cal + 1, 0);
    return overlapDayCount(from, to, monthStart, monthEnd);
  });
}

function maxMonthSeries(left: number[], right: number[]) {
  return left.map((value, i) => Math.max(value ?? 0, right[i] ?? 0));
}

function calendarDaysWhere(qty: number[] | null | undefined, kpis: DashboardData["kpis"]) {
  return kpis.months.map((month, i) => {
    if (!((qty?.[i] ?? 0) > 0)) return 0;
    const cal = SAFRA_CALENDAR_MONTHS[i] ?? 0;
    return new Date(month.year, cal + 1, 0).getDate();
  });
}

function premiseDaysFor(key: string, kpis: DashboardData["kpis"] | null) {
  if (!key || !kpis) return null;
  const subprocessDays = (subKey: string, start?: string | null, end?: string | null) => {
    const fromDates = daysFromRange(start, end, kpis);
    if (fromDates.some((n) => n > 0)) return fromDates;
    const row = kpis.subprocesses?.find((item) => item.key === subKey);
    const fromRow = daysFromRange(row?.start?.value, row?.end?.value, kpis);
    if (fromRow.some((n) => n > 0)) return fromRow;
    return calendarDaysWhere(row?.months ?? areaMonthsFor(subKey === "tons" ? "moagem" : subKey === "haVerao" ? "plantio_verao" : subKey, kpis), kpis);
  };
  if (key === "moagem") return subprocessDays("tons", kpis.inicioColheita, kpis.fimColheita);
  if (key === "tonsManual") return subprocessDays("tonsManual", kpis.inicioManual, kpis.fimManual);
  if (key === "plantio_verao") return subprocessDays("haVerao", kpis.inicioVerao, kpis.fimVerao);
  if (key === "plantio_inverno") return subprocessDays("haInverno", kpis.inicioInverno, kpis.fimInverno);
  if (key === "plantio_total") {
    return maxMonthSeries(
      subprocessDays("haVerao", kpis.inicioVerao, kpis.fimVerao),
      subprocessDays("haInverno", kpis.inicioInverno, kpis.fimInverno),
    );
  }
  if (key === "tratos_planta") return subprocessDays("haPlanta", kpis.inicioPlanta, kpis.fimPlanta);
  if (key === "tratos_soca") return subprocessDays("haSoca", kpis.inicioSoca, kpis.fimSoca);
  return subprocessDays(key);
}

function isTripsLine(line?: { calc_kind?: string | null; calc_trips?: number | null; calc_machine_qty?: number | null } | null) {
  if (!line) return false;
  if (line.calc_kind === "trips") return true;
  return Number(line.calc_trips) > 0 && Number(line.calc_machine_qty) > 0;
}

function premiseUnit(key: string) {
  if (key === "moagem" || key === "tonsManual") return "t";
  return "ha";
}

function usePremissaKpis() {
  const [kpis, setKpis] = useState<DashboardData["kpis"] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .premissas()
      .then((next) => {
        if (!cancelled) setKpis(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return kpis;
}

function MaterialPremiseFields({
  drivers,
  value,
  onChange,
  autoPremise,
}: {
  drivers: CalcDriver[];
  value: string;
  onChange: (key: string) => void;
  autoPremise?: string | null;
}) {
  const autoName = premiseLabel(autoPremise, drivers);
  return (
    <label className="span-2">
      Premissa
      <small>
        {autoName
          ? `Série mensal da premissa (ha ou t). A atividade sugere ${autoName}.`
          : "Série mensal da premissa (hectares ou toneladas), sem depender do cálculo da atividade."}
      </small>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Selecione a premissa</option>
        {drivers.map((d) => (
          <option key={d.key} value={d.key}>
            {d.label}
          </option>
        ))}
      </select>
    </label>
  );
}

type ActivityCalcPlan = {
  quantityUnit?: QuantityUnit;
  useApplications?: boolean;
  applications?: string;
  id: string;
  mode: "area" | "days" | "fixed";
  months: number[];
  dose: string;
  price: string;
  excludeWeekdays: number[];
  followArea: boolean;
  areaPct: string;
  fixedValue: string;
  fixedQty: string;
};

type ActivityCalcState = {
  useActivityAuto: boolean;
  startMonth: number;
  endMonth: number;
  mode: "area" | "days" | "fixed";
  premise: string;
  dose: string;
  price: string;
  excludeWeekdays: number[];
  followArea: boolean;
  areaPremise: string;
  areaPct: string;
  reducePct: string;
  fixedValue: string;
  fixedQty: string;
  fixedMonths: number[];
  plans: ActivityCalcPlan[];
};

const ALL_MONTHS = MONTHS.map((_, i) => i);

let calcPlanSeq = 0;
function newCalcPlanId() {
  calcPlanSeq += 1;
  return `p-${Date.now()}-${calcPlanSeq}`;
}

function emptyCalcPlan(mode: "area" | "days" | "fixed" = "fixed"): ActivityCalcPlan {
  return {
    quantityUnit: "un",
    id: newCalcPlanId(),
    mode,
    months: [...ALL_MONTHS],
    dose: "",
    price: "",
    excludeWeekdays: [],
    followArea: false,
    areaPct: "100",
    fixedValue: "",
    fixedQty: "1",
  };
}

function monthInPeriod(index: number, start: number, end: number) {
  if (start <= end) return index >= start && index <= end;
  return index >= start || index <= end;
}

function monthsFromPeriod(start: number, end: number) {
  return ALL_MONTHS.filter((i) => monthInPeriod(i, start, end));
}

const EMPTY_CALC: ActivityCalcState = {
  useActivityAuto: true,
  startMonth: 0,
  endMonth: 11,
  mode: "area",
  premise: "plantio_verao",
  dose: "",
  price: "",
  excludeWeekdays: [],
  followArea: false,
  areaPremise: "plantio_total",
  areaPct: "100",
  reducePct: "",
  fixedValue: "",
  fixedQty: "1",
  fixedMonths: [],
  plans: [],
};

function emptyEquipmentCalc(): ActivityCalcState {
  return {
    ...EMPTY_CALC,
    useActivityAuto: false,
    premise: "",
    areaPremise: "",
    plans: [emptyCalcPlan("fixed")],
  };
}

function parseWeekdays(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  } catch {
    return [];
  }
}

function parseSelectedMonths(raw: string | number[] | null | undefined): number[] | null {
  const values = Array.isArray(raw)
    ? raw
    : (() => {
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw) as unknown;
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      })();
  if (!values) return null;
  const months = [...new Set(values.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 11))].sort(
    (a, b) => a - b,
  );
  if (!months.length || months.length === 12) return null;
  return months;
}

function toggleWeekday(current: number[], id: number) {
  return current.includes(id) ? current.filter((d) => d !== id) : [...current, id].sort((a, b) => a - b);
}

function exceptLabel(days: number[]) {
  if (!days.length) return "todos os dias do mês";
  const names = days.map((id) => WEEKDAYS.find((d) => d.id === id)?.name ?? String(id));
  if (names.length === 1) return `exceto ${names[0]}`;
  if (names.length === 2) return `exceto ${names[0]} e ${names[1]}`;
  return `exceto ${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

function monthCellText(formula: string | null | undefined, value: number) {
  const raw = (formula ?? "").trim();
  if (raw && raw !== AUTO_CALC_FORMULA) return raw;
  if (!Number.isFinite(value) || value === 0) return "";
  return formatBRL(value);
}

function moneyInputChanged(raw: string, shown: string) {
  if (raw.trim() === shown.trim()) return false;
  const parsed = parseMoneyInput(raw);
  const shownParsed = parseMoneyInput(shown);
  if (Number.isFinite(parsed) && Number.isFinite(shownParsed) && parsed === shownParsed) return false;
  return raw.replace(",", ".") !== shown.replace(",", ".");
}

function formatPct(n: number) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10).replace(".", ",");
}

function formatHaInput(n: number) {
  const value = Math.round(n * 10) / 10;
  if (!Number.isFinite(value) || !(value > 0)) return "";
  return String(value).replace(".", ",");
}

function parseInputNum(raw: string) {
  const n = Number(raw.replace(",", ".").trim());
  return Number.isFinite(n) ? n : NaN;
}

function applicationsLabel(line: LineItem) {
  const n = Number(line.calc_applications);
  if (!(n > 0) || n === 1) return null;
  return `${formatQty(n)}x`;
}

function areaPctLabel(line: LineItem) {
  const fixedHa = Number(line.calc_area_ha);
  if (fixedHa > 0) {
    const ha = line.area_ha != null && line.area_ha > 0 ? line.area_ha : fixedHa;
    return `${formatQty(ha)} ha`;
  }
  const n = Number(line.calc_area_pct);
  if (!(n > 0) || n === 100) return null;
  return `${formatPct(n)}%`;
}

function reducePctLabel(line: LineItem) {
  const n = Number(line.calc_reduce_pct);
  if (!(n > 0)) return null;
  return `−${formatPct(n)}%`;
}

function initialMaterialArea(line: LineItem) {
  const fixedHa = Number(line.calc_area_ha);
  if (fixedHa > 0) {
    return {
      mode: "ha" as const,
      areaHa: formatHaInput(fixedHa) || String(fixedHa).replace(".", ","),
      areaPct: "100",
    };
  }
  const pct = Number(line.calc_area_pct) > 0 ? Number(line.calc_area_pct) : 100;
  return {
    mode: "pct" as const,
    areaPct: String(pct).replace(".", ","),
    areaHa: "",
  };
}

function materialAreaPayload(usesArea: boolean, mode: "pct" | "ha", areaPct: string, areaHa: string) {
  if (!usesArea) return { calcAreaPct: null as number | null, calcAreaHa: null as number | null };
  if (mode === "ha") {
    const ha = parseInputNum(areaHa);
    if (!(ha > 0)) return { error: "Informe a área em hectares." };
    return { calcAreaHa: ha, calcAreaPct: null as number | null };
  }
  const pct = parseInputNum(areaPct);
  if (!(pct > 0) || pct > 100) return { error: "Informe o percentual da área (maior que 0 até 100)." };
  return { calcAreaPct: pct, calcAreaHa: null as number | null };
}

function formatFactor(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseApplicationsInput(raw: string) {
  const n = Number(raw.replace(",", ".").replace(/x$/i, "").trim());
  return n > 0 ? n : NaN;
}

function applicationsSuffix(apps: number) {
  if (!(apps > 0) || apps === 1) return "";
  return ` × ${String(apps).replace(".", ",")}x`;
}

function materialAreaFormula(
  usesArea: boolean,
  mode: "pct" | "ha",
  areaPct: string,
  areaHa: string,
  price: string,
  qty: string,
  parentShape: string,
  applications = "1",
  premiseName?: string | null,
) {
  const apps = parseApplicationsInput(applications);
  const times = applicationsSuffix(apps);
  const base = premiseName ? `premissa (${premiseName})` : "área";
  if (!usesArea || mode === "ha") return `${base} × ${qty} × ${price}${times}`;
  const pct = parseInputNum(areaPct);
  if (pct > 0 && pct !== 100) return `(${base} × ${areaPct}%) × ${qty} × ${price}${times}`;
  return premiseName ? `${base} × ${qty} × ${price}${times}` : `${base} × ${qty} × ${price}${times} (${parentShape})`;
}

function InformedAreaPreview({
  parent,
  areaHa,
  price,
  qty,
  applications = "1",
  months: monthsOverride,
  total: totalOverride,
  unit = "ha",
  premiseName,
}: {
  parent?: LineItem | null;
  areaHa: string;
  price: string;
  qty: string;
  applications?: string;
  months?: number[] | null;
  total?: number;
  unit?: string;
  premiseName?: string | null;
}) {
  const informed = parseInputNum(areaHa);
  const months = monthsOverride ?? parent?.premise_ha_months ?? parent?.area_ha_months;
  const total =
    totalOverride != null && totalOverride > 0
      ? totalOverride
      : Number(parent?.premise_ha) > 0
        ? Number(parent?.premise_ha)
        : Number(parent?.area_ha);
  if (!(informed > 0)) return null;
  if (!(total > 0) || !months?.length) {
    return (
      <div className="formula-box" style={{ margin: "0 0 8px" }}>
        {formatQty(informed)} {unit} — {premiseName ? `esta premissa (${premiseName})` : "esta atividade"} não tem valores para ratear nos meses.
      </div>
    );
  }
  const factor = informed / total;
  const unitPrice = parseInputNum(price);
  const quantity = parseInputNum(qty);
  const apps = parseApplicationsInput(applications);
  const canValue = unitPrice > 0 && quantity > 0 && apps > 0;
  return (
    <>
      <div className="formula-box" style={{ margin: "0 0 8px" }}>
        {formatQty(informed)} ha × {qty} × {price}
        {applicationsSuffix(apps)}
        {canValue ? ` = ${formatBRL(informed * quantity * unitPrice * apps)}` : ""}
      </div>
      <div className="days-preview">
        {MONTHS.map((label, i) => {
          const ha = months[i] ?? 0;
          const value = canValue ? factor * ha * unitPrice * quantity * apps : 0;
          return (
            <span key={label} className={ha > 0 ? "" : "off"}>
              <em>{label}</em> {ha > 0 ? `${formatQty(ha)} ${unit}` : `sem ${unit}`}
              {ha > 0 && canValue ? ` = ${formatBRL(value)}` : ""}
            </span>
          );
        })}
      </div>
    </>
  );
}

function DirectCostPreview({
  parent,
  price,
  months: monthsOverride,
  total: totalOverride,
  unit = "ha",
  premiseName,
}: {
  parent?: LineItem | null;
  price: string;
  months?: number[] | null;
  total?: number;
  unit?: string;
  premiseName?: string | null;
}) {
  const unitPrice = parseInputNum(price);
  const months = monthsOverride ?? parent?.premise_ha_months ?? parent?.area_ha_months;
  const total =
    totalOverride != null && totalOverride > 0
      ? totalOverride
      : Number(parent?.premise_ha) > 0
        ? Number(parent?.premise_ha)
        : Number(parent?.area_ha);
  const label = premiseName ? `premissa (${premiseName})` : "área da atividade";
  if (!(unitPrice > 0)) {
    return (
      <div className="formula-box" style={{ margin: "0 0 8px" }}>
        {label} × preço
      </div>
    );
  }
  return (
    <>
      <div className="formula-box" style={{ margin: "0 0 8px" }}>
        {label} × {price}
        {total > 0 ? ` = ${formatBRL(total * unitPrice)}` : ""}
      </div>
      {months?.length ? (
        <div className="days-preview">
          {MONTHS.map((labelMonth, i) => {
            const ha = months[i] ?? 0;
            return (
              <span key={labelMonth} className={ha > 0 ? "" : "off"}>
                <em>{labelMonth}</em> {ha > 0 ? `${formatQty(ha)} ${unit}` : `sem ${unit}`}
                {ha > 0 ? ` = ${formatBRL(ha * unitPrice)}` : ""}
              </span>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

function TripsCalcPreview({
  tons,
  trips,
  machines,
  price,
  days,
  premiseName,
}: {
  tons: string;
  trips: string;
  machines: string;
  price: string;
  days: number[] | null;
  premiseName?: string | null;
}) {
  const t = parseInputNum(tons);
  const v = parseInputNum(trips);
  const m = parseInputNum(machines);
  const p = parseInputNum(price);
  const factor = t > 0 && v > 0 && m > 0 && p > 0 ? t * v * m * p : 0;
  const totalDays = days?.reduce((sum, n) => sum + (n ?? 0), 0) ?? 0;
  const label = premiseName ? `dias (${premiseName})` : "dias da premissa";
  return (
    <>
      <div className="formula-box" style={{ margin: "0 0 8px" }}>
        {tons || "t"} t × {trips || "viagens"} × {machines || "máq."} × {price || "preço"} × {label}
        {factor > 0 && totalDays > 0 ? ` = ${formatBRL(factor * totalDays)}` : ""}
      </div>
      {days?.length ? (
        <div className="days-preview">
          {MONTHS.map((labelMonth, i) => {
            const dayCount = days[i] ?? 0;
            return (
              <span key={labelMonth} className={dayCount > 0 ? "" : "off"}>
                <em>{labelMonth}</em> {dayCount > 0 ? `${formatQty(dayCount)} d` : "sem dias"}
                {factor > 0 && dayCount > 0 ? ` = ${formatBRL(factor * dayCount)}` : ""}
              </span>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

function MaterialAreaFields({
  mode,
  onMode,
  areaPct,
  areaHa,
  onPctChange,
  onHaChange,
}: {
  mode: "pct" | "ha";
  onMode: (mode: "pct" | "ha") => void;
  areaPct: string;
  areaHa: string;
  onPctChange: (raw: string) => void;
  onHaChange: (raw: string) => void;
}) {
  return (
    <label className="span-2">
      Área do material
      <small>Fração da premissa (hectares ou toneladas) aplicada em cada mês.</small>
      <div className="kind-toggle" style={{ padding: "6px 0 8px" }}>
        <button type="button" className={`btn ${mode === "pct" ? "primary" : ""}`} onClick={() => onMode("pct")}>
          Percentual
        </button>
        <button type="button" className={`btn ${mode === "ha" ? "primary" : ""}`} onClick={() => onMode("ha")}>
          Hectares
        </button>
      </div>
      {mode === "pct" ? (
        <input value={areaPct} onChange={(e) => onPctChange(e.target.value)} placeholder="Ex.: 30" />
      ) : (
        <input value={areaHa} onChange={(e) => onHaChange(e.target.value)} placeholder="Ex.: 245,3" />
      )}
    </label>
  );
}

function AutoCalcMonthsFields({
  scope,
  months,
  onScope,
  onMonths,
}: {
  scope: "all" | "selected";
  months: number[];
  onScope: (scope: "all" | "selected") => void;
  onMonths: (months: number[]) => void;
}) {
  return (
    <label className="span-2">
      Meses do cálculo automático
      <small>
        {scope === "all"
          ? "O valor entra em todos os meses do cálculo automático da atividade."
          : months.length
            ? `${months.length} escolhido${months.length === 1 ? "" : "s"}`
            : "Escolha os meses que recebem o cálculo automático"}
      </small>
      <div className="kind-toggle" style={{ padding: "6px 0 8px" }}>
        <button type="button" className={`btn ${scope === "all" ? "primary" : ""}`} onClick={() => onScope("all")}>
          Todos os meses
        </button>
        <button
          type="button"
          className={`btn ${scope === "selected" ? "primary" : ""}`}
          onClick={() => {
            onScope("selected");
            if (!months.length) onMonths(ALL_MONTHS);
          }}
        >
          Meses selecionados
        </button>
      </div>
      {scope === "selected" ? (
        <div className="choice-picks">
          <button
            type="button"
            className={months.length === 12 ? "on" : ""}
            onClick={() => onMonths(months.length === 12 ? [] : ALL_MONTHS)}
          >
            {months.length === 12 ? "Limpar" : "Todos"}
          </button>
          {MONTHS.map((label, month) => (
            <button
              key={label}
              type="button"
              className={months.includes(month) ? "on" : ""}
              onClick={() =>
                onMonths(
                  months.includes(month)
                    ? months.filter((item) => item !== month)
                    : [...months, month].sort((a, b) => a - b),
                )
              }
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </label>
  );
}

function materialCalcMonths(scope: "all" | "selected", months: number[]) {
  if (scope !== "selected") return null;
  return months;
}

function qtyPerHa(line?: LineItem | null) {
  const n = Number(line?.calc_dose);
  return n > 0 ? n : null;
}

function activityLinkedAreaHa(activity?: LineItem | null) {
  const premise = Number(activity?.premise_ha);
  if (premise > 0) return premise;
  const area = Number(activity?.area_ha);
  return area > 0 ? area : null;
}

function lineRatePerHa(line?: LineItem | null, parent?: LineItem | null, siblings?: LineItem[] | null) {
  if (parent && line && isHourCostLine(line)) {
    const ha = activityLinkedAreaHa(parent);
    const total = Number(line.total);
    if (total > 0 && ha != null && ha > 0) return total / ha;
    const count = (siblings ?? []).filter(isHourCostLine).length;
    const qty = Number(line.calc_dose);
    const price = Number(line.calc_price);
    const apps = Number(line.calc_applications) > 0 ? Number(line.calc_applications) : 1;
    if (qty > 0 && price > 0) {
      const rate = qty * price * apps;
      return count > 1 ? rate / count : rate;
    }
  }
  const qty = Number(line?.calc_dose);
  const price = Number(line?.calc_price);
  const apps = Number(line?.calc_applications) > 0 ? Number(line?.calc_applications) : 1;
  if (qty > 0 && price > 0) return qty * price * apps;
  return null;
}

function activityRatePerHa(activity?: LineItem | null) {
  const total = Number(activity?.total);
  const ha = activityLinkedAreaHa(activity);
  if (total > 0 && ha != null && ha > 0) return total / ha;
  return null;
}

function qtyPerHaLabel(line?: LineItem | null) {
  if (line?.calc_direct === 1 || isTripsLine(line)) return "—";
  const n = qtyPerHa(line);
  return n != null ? formatQty(n) : "—";
}

function ratePerHaLabel(line?: LineItem | null, materials?: LineItem[] | null, parent?: LineItem | null) {
  const n = parent ? lineRatePerHa(line, parent, materials) : materials ? activityRatePerHa(line) : lineRatePerHa(line);
  return n != null ? formatBRL(n) : "—";
}

function parseStoredCalcPlans(raw: string | null | undefined): ActivityCalcPlan[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item, i) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const mode = row.mode === "days" || row.mode === "fixed" ? row.mode : "area";
      const monthsRaw = Array.isArray(row.months)
        ? [...new Set(row.months.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 11))].sort(
            (a, b) => a - b,
          )
        : [...ALL_MONTHS];
      const dose = row.dose != null && Number(row.dose) > 0 ? String(row.dose).replace(".", ",") : "";
      const price = row.price != null && Number(row.price) > 0 ? String(row.price).replace(".", ",") : "";
      const areaPct = row.areaPct != null && Number(row.areaPct) > 0 ? String(row.areaPct).replace(".", ",") : "100";
      const exclude = Array.isArray(row.excludeWeekdays)
        ? row.excludeWeekdays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
        : [];
      return [
        {
          id: `stored-${i}`,
          mode,
          months: monthsRaw.length ? monthsRaw : [...ALL_MONTHS],
          dose: mode === "fixed" ? "" : dose,
          price: mode === "fixed" ? "" : price,
          excludeWeekdays: exclude,
          followArea: Boolean(row.followArea),
          areaPct,
          fixedValue: mode === "fixed" && Number(row.price) > 0 ? formatCalcInput(Number(row.price)) : "",
          fixedQty: mode === "fixed" && Number(row.dose) > 0 ? String(row.dose).replace(".", ",") : "1",
          quantityUnit: quantityUnit(row.quantityUnit),
          useApplications: mode === "fixed" && row.applications != null,
          applications: row.applications != null && Number(row.applications) > 0 ? formatCalcInput(Number(row.applications)) : "1",
        },
      ];
    });
  } catch {
    return [];
  }
}

function serializeCalcPlans(plans: ActivityCalcPlan[]) {
  return plans.map((plan) => ({
    mode: plan.mode,
    ...(plan.mode === "fixed" ? { quantityUnit: quantityUnit(plan.quantityUnit) } : {}),
    ...(plan.mode === "fixed" && plan.useApplications ? { applications: parseInputNum(plan.applications ?? "") } : {}),
    months: plan.months.length === 12 ? null : [...plan.months].sort((a, b) => a - b),
    dose:
      plan.mode === "fixed"
        ? quantityOrOne(plan.fixedQty)
        : parseInputNum(plan.dose) || (plan.mode === "days" ? 1 : null),
    price: plan.mode === "fixed" ? parseInputNum(plan.fixedValue) : parseInputNum(plan.price),
    areaPct: parseInputNum(plan.areaPct) || 100,
    excludeWeekdays: plan.mode === "days" ? plan.excludeWeekdays : [],
    followArea: plan.mode === "days" && plan.followArea,
  }));
}

function validateActivityPlans(plans: ActivityCalcPlan[], useAuto: boolean, autoPremise: string | null) {
  if (!useAuto && !plans.length) return "Adicione um cálculo ou volte ao automático.";
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const n = i + 1;
    if (!plan.months.length) return `Escolha os meses do cálculo ${n}.`;
    if (plan.mode === "fixed") {
      if (!(parseInputNum(plan.fixedValue) > 0)) return `Informe o preço unitário do cálculo ${n}.`;
      if (!(quantityOrOne(plan.fixedQty) > 0)) return `Informe a quantidade do cálculo ${n}.`;
      if (plan.useApplications && (!Number.isFinite(parseInputNum(plan.applications ?? "")) || !(parseInputNum(plan.applications ?? "") > 0))) return `Informe a quantidade de aplicações do cálculo ${n}.`;
    } else {
      if (plan.mode === "area") {
        if (!(parseInputNum(plan.dose) > 0)) return `Informe a quantidade por hectare do cálculo ${n}.`;
        if (!autoPremise) return "Selecione a premissa da área.";
      }
      if (!(parseInputNum(plan.price) > 0)) return `Informe o preço do cálculo ${n}.`;
      const pct = parseInputNum(plan.areaPct);
      if (!(pct > 0) || pct > 100) return `Informe o percentual da área do cálculo ${n} (maior que 0 até 100).`;
    }
  }
  return null;
}

function planFormula(plan: ActivityCalcPlan, drivers: CalcDriver[], autoPremise?: string | null) {
  const monthBit = plan.months.length === 12 ? "em todos os meses" : `em ${distributionMonthsLabel(plan.months)}`;
  if (plan.mode === "fixed") {
    const monthly = fixedMonthlyAmount(plan.fixedValue, plan.fixedQty) * (plan.useApplications ? parseInputNum(plan.applications ?? "") : 1);
    if (!(monthly > 0) || !plan.months.length) return `Quantidade × preço ${monthBit}`;
    const factor = quantityOrOne(plan.fixedQty);
    const unit = parseInputNum(plan.fixedValue);
    const medida = quantityUnit(plan.quantityUnit);
    const aplicacoes = plan.useApplications ? ` × ${plan.applications || "0"} aplicação(ões)` : "";
    return `${String(factor).replace(".", ",")} ${medida} × ${formatBRL(unit)}/${medida}${aplicacoes} = ${formatBRL(monthly)} ${monthBit}`;
  }
  const areaName = premiseLabel(autoPremise, drivers) ?? "área da premissa do cálculo automático";
  if (plan.mode === "days") {
    const area = plan.followArea ? ` só nos meses com ${areaName}` : "";
    return `(${plan.dose || "1"} × ${plan.price || "preço"}) × dias do mês (${exceptLabel(plan.excludeWeekdays)})${area} ${monthBit}`;
  }
  const pct = parseInputNum(plan.areaPct);
  const areaShare = pct > 0 && pct !== 100 ? ` × ${String(plan.areaPct).replace(".", ",")}% da área` : "";
  return `(${plan.dose || "qtd/ha"} × ${plan.price || "preço"}) × ${areaName}${areaShare} ${monthBit}`;
}

function calcStateFromLine(line: LineItem): ActivityCalcState {
  const days = line.calc_premise === "dias";
  const auto = line.use_activity_auto !== 0;
  const hasFormula = Number(line.calc_dose) > 0 && Number(line.calc_price) > 0;
  const uniform = !hasFormula ? uniformFixedMonths(line.own_months) : null;
  const stored = parseStoredCalcPlans(line.calc_plans);
  const legacyPlan: ActivityCalcPlan | null = hasFormula
    ? {
        id: "legacy",
        mode: days ? "days" : "area",
        months: monthsFromPeriod(line.start_month ?? 0, line.end_month ?? 11),
        dose: line.calc_dose != null ? String(line.calc_dose).replace(".", ",") : "",
        price: line.calc_price != null ? String(line.calc_price).replace(".", ",") : "",
        excludeWeekdays: parseWeekdays(line.calc_exclude_weekdays),
        followArea: Boolean(line.calc_area_premise),
        areaPct:
          line.calc_area_pct != null && Number(line.calc_area_pct) > 0
            ? String(line.calc_area_pct).replace(".", ",")
            : "100",
        fixedValue: "",
        fixedQty: "1",
      }
    : uniform
      ? {
          id: "legacy-fixed",
          mode: "fixed" as const,
          months: uniform.months,
          dose: "",
          price: "",
          excludeWeekdays: [],
          followArea: false,
          areaPct: "100",
          fixedValue: formatCalcInput(uniform.value),
          fixedQty: "1",
        }
      : null;
  const plans = stored.length ? stored : auto ? [] : legacyPlan ? [legacyPlan] : [];
  return {
    useActivityAuto: auto,
    startMonth: line.start_month ?? 0,
    endMonth: line.end_month ?? 11,
    mode: plans[0]?.mode ?? (days ? "days" : !auto && uniform ? "fixed" : "area"),
    premise: days || !line.calc_premise ? "plantio_verao" : line.calc_premise,
    dose: line.calc_dose != null ? String(line.calc_dose) : "",
    price: line.calc_price != null ? String(line.calc_price) : "",
    excludeWeekdays: parseWeekdays(line.calc_exclude_weekdays),
    followArea: Boolean(line.calc_area_premise),
    areaPremise: line.calc_area_premise || "plantio_total",
    areaPct: line.calc_area_pct != null && Number(line.calc_area_pct) > 0 ? String(line.calc_area_pct).replace(".", ",") : "100",
    reducePct:
      line.calc_reduce_pct != null && Number(line.calc_reduce_pct) > 0
        ? String(line.calc_reduce_pct).replace(".", ",")
        : "",
    fixedValue: uniform ? formatCalcInput(uniform.value) : "",
    fixedQty: "1",
    fixedMonths: uniform?.months ?? [],
    plans,
  };
}

function calcPayload(state: ActivityCalcState, autoPremise?: string | null) {
  const plans = state.plans ?? [];
  const calcPlans = plans.length ? serializeCalcPlans(plans) : null;
  const reduceRaw = state.reducePct.trim();
  const reduceN = reduceRaw ? parseInputNum(state.reducePct) : 0;
  const calcReducePct = reduceN > 0 ? reduceN : null;
  if (state.useActivityAuto) {
    return { useActivityAuto: true, calcPlans, calcReducePct };
  }
  const firstFormula = plans.find((plan) => plan.mode !== "fixed");
  if (firstFormula) {
    const months = firstFormula.months.length ? firstFormula.months : ALL_MONTHS;
    return {
      useActivityAuto: false,
      startMonth: months[0] ?? 0,
      endMonth: months[months.length - 1] ?? 11,
      calcMode: firstFormula.mode === "days" ? "days" : "area",
      calcPremise: firstFormula.mode === "days" ? "dias" : autoPremise || null,
      calcDose: firstFormula.mode === "days" ? parseInputNum(firstFormula.dose) || 1 : parseInputNum(firstFormula.dose),
      calcPrice: parseInputNum(firstFormula.price),
      calcExcludeWeekdays: firstFormula.mode === "days" ? firstFormula.excludeWeekdays : [],
      calcAreaPremise: firstFormula.mode === "days" && firstFormula.followArea ? autoPremise || null : null,
      calcAreaPct: parseInputNum(firstFormula.areaPct),
      calcPlans,
      calcReducePct,
    };
  }
  if (plans.length) {
    const byMonth = new Map<number, number>();
    for (const plan of plans) {
      if (plan.mode !== "fixed") continue;
      const monthly = fixedMonthlyAmount(plan.fixedValue, plan.fixedQty) * (plan.useApplications ? parseInputNum(plan.applications ?? "") : 1);
      if (!(monthly > 0)) continue;
      for (const month of plan.months) byMonth.set(month, monthly);
    }
    return {
      useActivityAuto: false,
      calcPlans,
      calcReducePct,
      ...(byMonth.size ? { months: [...byMonth.entries()].map(([month, value]) => ({ month, value })) } : {}),
    };
  }
  const areaKey = autoPremise || state.areaPremise || state.premise;
  const fixed = state.mode === "fixed";
  return {
    useActivityAuto: false,
    startMonth: fixed ? null : state.startMonth,
    endMonth: fixed ? null : state.endMonth,
    calcMode: fixed ? undefined : state.mode,
    calcPremise: fixed ? null : state.mode === "days" ? "dias" : null,
    calcDose: fixed ? null : Number(state.dose.replace(",", ".")),
    calcPrice: fixed ? null : Number(state.price.replace(",", ".")),
    calcExcludeWeekdays: fixed || state.mode !== "days" ? [] : state.excludeWeekdays,
    calcAreaPremise: fixed || state.mode !== "days" || !state.followArea ? null : areaKey,
    calcAreaPct: fixed ? null : parseInputNum(state.areaPct),
    calcPlans: null,
    calcReducePct,
    ...(fixed
      ? {
          months: state.fixedMonths.map((month) => ({
            month,
            value: fixedMonthlyAmount(state.fixedValue, state.fixedQty),
          })),
        }
      : {}),
  };
}

function calcFormula(state: ActivityCalcState, drivers: CalcDriver[], autoPremise?: string | null) {
  const reduce = parseInputNum(state.reducePct);
  const reduceBit = reduce > 0 ? `, com redução de ${String(state.reducePct).replace(".", ",")}%` : "";
  if (state.useActivityAuto && !state.plans.length) return `Cálculo automático das atividades${reduceBit}`;
  if (state.useActivityAuto && state.plans.length) {
    return `Cálculo automático das atividades, com ${state.plans.length} cálculo${state.plans.length === 1 ? "" : "s"} extra${state.plans.length === 1 ? "" : "s"} nos meses escolhidos${reduceBit}`;
  }
  if (state.plans.length) {
    const base = state.plans.map((plan, i) => `${i + 1}. ${planFormula(plan, drivers, autoPremise)}`).join(" · ");
    return `${base}${reduceBit}`;
  }
  if (state.mode === "fixed") {
    const monthly = fixedMonthlyAmount(state.fixedValue, state.fixedQty);
    if (!(monthly > 0) || !state.fixedMonths.length) return `Valor fixo em cada mês escolhido${reduceBit}`;
    const factor = quantityOrOne(state.fixedQty);
    const unit = parseInputNum(state.fixedValue);
    const monthBit = `${formatBRL(monthly)} em cada mês (${distributionMonthsLabel(state.fixedMonths)})`;
    const label =
      factor !== 1 && unit > 0 ? `${String(state.fixedQty).replace(".", ",")} × ${formatBRL(unit)} = ${monthBit}` : monthBit;
    return `${label}${reduceBit}`;
  }
  const period = ` de ${MONTH_NAMES[state.startMonth]} a ${MONTH_NAMES[state.endMonth]}`;
  const areaName = premiseLabel(autoPremise, drivers) ?? "área da premissa do cálculo automático";
  if (state.mode === "days") {
    const area = state.followArea ? ` só nos meses com ${areaName}` : "";
    return `(${state.dose || "1"} × ${state.price || "preço"}) × dias do mês (${exceptLabel(state.excludeWeekdays)})${area}${period}${reduceBit}`;
  }
  const pct = parseInputNum(state.areaPct);
  const areaShare = pct > 0 && pct !== 100 ? ` × ${String(state.areaPct).replace(".", ",")}% da área` : "";
  return `(${state.dose || "qtd/ha"} × ${state.price || "preço"}) × ${areaName}${areaShare}${period}${reduceBit}`;
}

function calcShapeLabel(state: ActivityCalcState, drivers: CalcDriver[], autoPremise?: string | null) {
  if (state.useActivityAuto && !state.plans.length) return "cálculo automático das atividades";
  if (state.useActivityAuto && state.plans.length) {
    return `cálculo automático com ${state.plans.length} extra${state.plans.length === 1 ? "" : "s"}`;
  }
  if (state.plans.length === 1) return planFormula(state.plans[0], drivers, autoPremise);
  if (state.plans.length > 1) return `${state.plans.length} cálculos em meses diferentes`;
  if (state.mode === "fixed") {
    const monthly = fixedMonthlyAmount(state.fixedValue, state.fixedQty);
    if (!(monthly > 0) || !state.fixedMonths.length) return "valor fixo por mês";
    return `${formatBRL(monthly)} por mês`;
  }
  const period = ` de ${MONTH_NAMES[state.startMonth]} a ${MONTH_NAMES[state.endMonth]}`;
  const areaName = premiseLabel(autoPremise ?? (state.mode === "days" ? state.areaPremise : state.premise), drivers) ?? "premissa do cálculo automático";
  if (state.mode === "days") {
    const area = state.followArea ? ` só nos meses com ${areaName}` : "";
    return `dias do mês (${exceptLabel(state.excludeWeekdays)})${area}${period}`;
  }
  const pct = parseInputNum(state.areaPct);
  const areaShare = pct > 0 && pct !== 100 ? ` (${String(state.areaPct).replace(".", ",")}% da área)` : "";
  return `${areaName}${areaShare}${period}`;
}

export function CostCenter({ sheetId }: { sheetId: number }) {
  const { safraId, safra, sheets } = useApp();
  const [data, setData] = useState<SheetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [empenhos, setEmpenhos] = useState<Empenho[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [costObjects, setCostObjects] = useState<CostObject[]>([]);
  const [equipments, setEquipments] = useState<EquipmentCatalogItem[]>([]);
  const [catalogCategories, setCatalogCategories] = useState<CatalogCategory[]>([]);
  const [openCat, setOpenCat] = useState(false);
  const [addActivityIn, setAddActivityIn] = useState<{ categoryId: number; centerSheetId?: number | null } | null>(null);
  const [addCenterIn, setAddCenterIn] = useState<number | null>(null);
  const [addMaterialIn, setAddMaterialIn] = useState<LineItem | null>(null);
  const [addEquipmentUnder, setAddEquipmentUnder] = useState<LineItem | null>(null);
  const [distributeIn, setDistributeIn] = useState<{ activityId?: number; categoryId?: number } | null>(null);
  const [editCalc, setEditCalc] = useState<LineItem | null>(null);
  const [editMaterialCalc, setEditMaterialCalc] = useState<{ line: LineItem; parent: LineItem | null } | null>(null);
  const [drivers, setDrivers] = useState<CalcDriver[]>(FALLBACK_DRIVERS);
  const [calcRules, setCalcRules] = useState<CalcRule[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [hiddenMaterials, setHiddenMaterials] = useState<Record<number, boolean>>({});
  const [groupingCatId, setGroupingCatId] = useState<number | null>(null);
  const [copyIntoCategoryId, setCopyIntoCategoryId] = useState<number | null>(null);
  const [reconcileObcBusy, setReconcileObcBusy] = useState(false);
  const [reconcileObcErr, setReconcileObcErr] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportAllBusy, setExportAllBusy] = useState(false);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    setData(null);
    setHiddenMaterials(loadHiddenMaterials(sheetId));
    setAddMaterialIn(null);
    setAddEquipmentUnder(null);
    setEditMaterialCalc(null);
    setEditCalc(null);
    setExportMessage(null);
    void Promise.all([
      api.sheet(sheetId).then(setData),
      api.activities().then(setActivities),
      api.empenhos().then(setEmpenhos).catch(() => setEmpenhos([])),
      api.materials().then(setMaterials),
      api.costObjects().then(setCostObjects),
      api.equipments().then(setEquipments).catch(() => setEquipments([])),
      api.catalogCategories().then(setCatalogCategories),
      api
        .calcRules(safraId)
        .then((d) => {
          if (d.drivers?.length) setDrivers(d.drivers);
          setCalcRules(d.rules ?? []);
        })
        .catch(() => undefined),
    ])
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [sheetId, safraId]);

  useSafraLoaded(!loading);

  const sheetLineCount = data?.categories?.reduce((sum, cat) => sum + cat.lines.length, 0) ?? 0;
  useEffect(() => {
    if (!sheetLineCount) return;
    void api.costObjects().then(setCostObjects);
  }, [sheetLineCount]);

  if (err) return <div className="page cost-center-page"><p>{err}</p></div>;
  if (!data) return <div className="page cost-center-page"><p>Carregando centro de custo…</p></div>;

  const materialActivityIds = activityIdsWithMaterials(data);
  const someMaterialsVisible = materialActivityIds.some((id) => !hiddenMaterials[id]);

  return (
    <div className="page cost-center-page">
      <ReadOnlyFieldset>

      <section className="panel">
        <h3>
          Totais do processo
          <small>{formatBRL(data.total)}</small>
        </h3>
        <table className="data cost-center">
          <thead>
            <tr>
              {MONTHS.map((m) => (
                <th key={m}>{m}</th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="total">
              {(data.monthTotals ?? Array(12).fill(0)).map((v, i) => (
                <td key={i} className="cell-money">{formatBRL(v)}</td>
              ))}
              <td className="cell-money">{formatBRL(data.total)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <div className="actions" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => setOpenCat(true)}>
          Nova categoria
        </button>
        <button className="btn primary" onClick={() => setDistributeIn({})}>
          Distribuir valor
        </button>
        <button
          className="btn"
          disabled={reconcileObcBusy}
          title="Consulta o Oracle e reparte linhas de custo/hora entre os objetos de custo vigentes de cada equipamento"
          onClick={async () => {
            setReconcileObcBusy(true);
            setReconcileObcErr(null);
            try {
              setData(await api.reconcileEquipmentObc(sheetId));
            } catch (e) {
              setReconcileObcErr(e instanceof Error ? e.message : "Não foi possível repartir os equipamentos.");
            } finally {
              setReconcileObcBusy(false);
            }
          }}
        >
          {reconcileObcBusy ? "Repartindo…" : "Repartir equipamentos por OBC"}
        </button>
        <button
          className="btn primary"
          disabled={exportAllBusy}
          title="Baixar um Excel no layout de importação do Planejamento Técnico com todos os centros de custo"
          onClick={async () => {
            setExportMessage(null);
            setExportAllBusy(true);
            try {
              const centers = sheets.filter((sheet) => sheet.kind === "cost_center" && sheet.visible);
              const details = await Promise.all(
                centers.map((sheet) => (sheet.id === data.id ? Promise.resolve(data) : api.sheet(sheet.id))),
              );
              const count = exportAllImportWorkbook(details, activities, safra?.code);
              setExportMessage(
                `${count} linha${count === 1 ? "" : "s"} exportada${count === 1 ? "" : "s"} de ${details.length} centro${details.length === 1 ? "" : "s"} de custo.`,
              );
            } catch (e) {
              setExportMessage(e instanceof Error ? e.message : "Não foi possível gerar o Excel.");
            } finally {
              setExportAllBusy(false);
            }
          }}
        >
          {exportAllBusy ? "Gerando Excel…" : "Gerar Excel de importação"}
        </button>
        {materialActivityIds.length ? (
          <button
            className="btn"
            onClick={() => {
              const hideAll = someMaterialsVisible;
              setHiddenMaterials(saveHiddenMaterials(sheetId, Object.fromEntries(materialActivityIds.map((id) => [id, hideAll]))));
            }}
          >
            {someMaterialsVisible ? "Ocultar materiais" : "Mostrar materiais"}
          </button>
        ) : null}
      </div>
      {reconcileObcErr ? <p style={{ color: "var(--danger, #c0392b)", margin: "0 0 14px" }}>{reconcileObcErr}</p> : null}
      {exportMessage ? <p className="lead" style={{ margin: "0 0 14px" }}>{exportMessage}</p> : null}

      {!data.categories.length ? (
        <p className="lead">Crie uma categoria primeiro. A atividade entra dentro dela.</p>
      ) : null}

      {data.categories.map((cat) => {
        const sections = nestCategoryLines(cat.lines);
        const hasRows = sections.some((section) => section.center || section.activities.length);
        return (
          <section className="panel" key={cat.id}>
            <h3>
              <span>
                <span className="level-label">Categoria</span>
                {cat.name}
              </span>
              <span>
                <small>{formatBRL(cat.total)}</small>
                <button
                  className="icon-btn add-btn"
                  title="Incluir atividade"
                  aria-label="Incluir atividade"
                  onClick={() => setAddActivityIn({ categoryId: cat.id })}
                >
                  +
                </button>
                {sheets.some((s) => s.kind === "cost_center" && s.id !== data.id && s.visible) ? (
                  <button
                    className="btn"
                    title="Criar um grupo de centro de custo nesta categoria para separar as atividades"
                    onClick={() => setAddCenterIn(cat.id)}
                  >
                    Incluir centro
                  </button>
                ) : null}
                {cat.lines.some((line) => line.ref_kind === "activity" && !line.parent_id) ? (
                  <button
                    className="btn"
                    disabled={groupingCatId === cat.id}
                    title="Separa as atividades em grupos pelo centro de custo onde a mesma atividade já existe"
                    onClick={async () => {
                      setGroupingCatId(cat.id);
                      setErr(null);
                      try {
                        setData(await api.groupCategoryByCenter(cat.id));
                      } catch (e) {
                        setErr(e instanceof Error ? e.message : "Não foi possível agrupar por centro.");
                      } finally {
                        setGroupingCatId(null);
                      }
                    }}
                  >
                    {groupingCatId === cat.id ? "Agrupando…" : "Separar por centro"}
                  </button>
                ) : null}
                {data.categories.some((other) => other.id !== cat.id) ? (
                  <button
                    className="btn"
                    title="Copiar atividade, centro de custo ou equipamento já informado em outra categoria"
                    onClick={() => setCopyIntoCategoryId(cat.id)}
                  >
                    Copiar de outra categoria
                  </button>
                ) : null}
                <button
                  className="icon-btn"
                  title="Remover categoria"
                  onClick={async () => {
                    if (!confirm(`Remover a categoria “${cat.name}” e tudo que está nela?`)) return;
                    setData(await api.deleteCategory(cat.id));
                  }}
                >
                  ✕
                </button>
              </span>
            </h3>

            {!hasRows ? (
              <p className="activity-empty">Nenhuma atividade nesta categoria.</p>
            ) : (
              <div className="table-wrap">
                <table className="data cost-center">
                  <thead>
                    <tr>
                      <th className="col-tipo">Tipo</th>
                      <th>Atividade / material</th>
                      <th className="col-cost-object">Objeto de custo</th>
                      <th className="col-qty-ha">Qtd/ha</th>
                      <th className="col-rate-ha">R$/ha</th>
                      {MONTHS.map((m) => (
                        <th key={m}>{m}</th>
                      ))}
                      <th>Total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sections.map((section, sectionIdx) => (
                      <Fragment key={section.center?.id ?? `sec-${sectionIdx}`}>
                        {section.center ? (
                          <tr className="center-group">
                            <td className="left col-tipo">Centro</td>
                            <td className="left">
                              <div className="activity-name-row">
                                <strong>{section.center.description}</strong>
                                <button
                                  type="button"
                                  className="icon-btn add-btn"
                                  title="Incluir atividade neste centro"
                                  onClick={() =>
                                    setAddActivityIn({
                                      categoryId: cat.id,
                                      centerSheetId: section.center!.center_sheet_id,
                                    })
                                  }
                                >
                                  +
                                </button>
                              </div>
                            </td>
                            <td className="left col-cost-object">—</td>
                            <td className="col-qty-ha">—</td>
                            <td className="col-rate-ha cell-money">—</td>
                            {section.center.months.map((m, i) => (
                              <td key={i} className="cell-money">{formatBRL(m.value)}</td>
                            ))}
                            <td className="cell-money">{formatBRL(section.center.total)}</td>
                            <td>
                              <button
                                className="icon-btn"
                                title="Remover grupo"
                                onClick={async () => {
                                  if (!confirm(`Remover o grupo “${section.center?.description}” e as atividades dele?`)) return;
                                  setData(await api.deleteLine(section.center!.id));
                                }}
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        ) : null}
                    {section.activities.map((block, idx) => {
                      const totals = block.activity
                        ? { months: block.activity.months.map((m) => m.value), total: block.activity.total }
                        : blockTotals(block.materials);
                      const isExcel = Boolean(
                        block.activity &&
                          block.activity.is_group &&
                          block.activity.ref_kind !== "activity" &&
                          !isEquipmentHead(block.activity),
                      );
                      const equipmentHead = Boolean(block.activity && isEquipmentHead(block.activity));
                      const fixedCostHead = Boolean(block.activity && isFixedCostObjectHead(block.activity));
                      const equipmentCode = block.activity ? equipmentCodeFromLine(block.activity) : "";
                      return (
                        <Fragment key={block.activity?.id ?? `loose-${sectionIdx}-${idx}`}>
                          <tr className={`group${section.center ? " nested-activity" : ""}`}>
                            <td className="left col-tipo">
                              {equipmentHead ? (
                                <select
                                  className="cell-select tipo"
                                  value={block.activity?.item_type === "E" || block.activity?.item_type === "G" ? block.activity.item_type : ""}
                                  onChange={async (e) => {
                                    const itemType = e.target.value === "E" || e.target.value === "G" ? e.target.value : null;
                                    setData(
                                      await api.updateLine(block.activity!.id, {
                                        itemType,
                                        refKind: "cost_object",
                                        productCode: equipmentCodeFromLine(block.activity!) || block.activity!.product_code,
                                        activityId: block.activity!.activity_id,
                                        materialId: block.activity!.material_id,
                                        costObjectId: block.activity!.cost_object_id,
                                      }),
                                    );
                                  }}
                                >
                                  <option value="">—</option>
                                  <option value="E">E</option>
                                  <option value="G">G</option>
                                </select>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="left">
                              <div className="activity-name-cell">
                                {block.activity && block.materials.length ? (
                                  <button
                                    type="button"
                                    className="icon-btn fold-btn"
                                    title={hiddenMaterials[block.activity.id] ? "Mostrar materiais" : "Ocultar materiais"}
                                    onClick={() =>
                                      setHiddenMaterials((current) =>
                                        saveHiddenMaterials(sheetId, {
                                          ...current,
                                          [block.activity!.id]: !current[block.activity!.id],
                                        }),
                                      )
                                    }
                                  >
                                    {hiddenMaterials[block.activity.id] ? "▸" : "▾"}
                                  </button>
                                ) : null}
                                <div className="activity-name-stack">
                                  <div className="activity-name-row">
                                    {block.activity && equipmentHead ? (
                                      <>
                                        <CatalogSearch
                                          options={equipmentSearchOptions({ catalog: equipments })}
                                          selectedKey={equipmentCode ? `eq-${equipmentCode}` : ""}
                                          selectedLabel={block.activity.description || ""}
                                          placeholder="Digite o código ou o nome do equipamento"
                                          onPick={async (opt) => {
                                            if (!opt || !block.activity) return;
                                            setData(
                                              await api.updateLine(block.activity.id, {
                                                refKind: "cost_object",
                                                productCode: opt.code,
                                                activityId: block.activity.activity_id,
                                                materialId: block.activity.material_id,
                                                itemType: block.activity.item_type,
                                                costObjectId: block.activity.cost_object_id,
                                                description: `${opt.code} — ${opt.description}`,
                                              }),
                                            );
                                          }}
                                        />
                                        <CatalogSearch
                                          compact
                                          options={activityOptions(activities)}
                                          selectedKey={block.activity.activity_id ? `a-${block.activity.activity_id}` : ""}
                                          selectedLabel={activityCodeOf(activities, block.activity)}
                                          placeholder="Ativ."
                                          allowEmpty
                                          emptyLabel="Sem atividade"
                                          title={
                                            block.activity.activity_id
                                              ? activityLabel(activities, block.activity)
                                              : "Número da atividade"
                                          }
                                          onPick={async (opt) => {
                                            if (!block.activity) return;
                                            setData(
                                              await api.updateLine(block.activity.id, {
                                                refKind: "cost_object",
                                                productCode: equipmentCode || block.activity.product_code,
                                                activityId: opt?.id ?? null,
                                                materialId: block.activity.material_id,
                                                itemType: block.activity.item_type,
                                                costObjectId: block.activity.cost_object_id,
                                              }),
                                            );
                                          }}
                                        />
                                      </>
                                    ) : block.activity && fixedCostHead ? (
                                      <>
                                        <strong title={block.activity.description}>{block.activity.description}</strong>
                                        <CatalogSearch
                                          compact
                                          options={activityOptions(activities)}
                                          selectedKey={block.activity.activity_id ? `a-${block.activity.activity_id}` : ""}
                                          selectedLabel={activityCodeOf(activities, block.activity)}
                                          placeholder="Ativ."
                                          allowEmpty
                                          emptyLabel="Sem atividade"
                                          title={
                                            block.activity.activity_id
                                              ? activityLabel(activities, block.activity)
                                              : "Informar atividade depois"
                                          }
                                          onPick={async (opt) => {
                                            if (!block.activity) return;
                                            setData(
                                              await api.updateLine(block.activity.id, {
                                                refKind: "cost_object",
                                                activityId: opt?.id ?? null,
                                                materialId: null,
                                                costObjectId: block.activity.cost_object_id,
                                                description: block.activity.description,
                                              }),
                                            );
                                          }}
                                        />
                                      </>
                                    ) : block.activity && (!isExcel || !block.activity.activity_id) ? (
                                      <CatalogSearch
                                        options={activityOptions(activities)}
                                        selectedKey={block.activity.activity_id ? `a-${block.activity.activity_id}` : ""}
                                        selectedLabel={activityLabel(activities, block.activity)}
                                        placeholder="Digite a atividade"
                                        onPick={async (opt) => {
                                          if (!opt || !block.activity) return;
                                          setData(
                                            await api.updateLine(block.activity.id, {
                                              refKind: "activity",
                                              activityId: opt.id,
                                              materialId: null,
                                              description: opt.description,
                                            }),
                                          );
                                        }}
                                      />
                                    ) : (
                                      <strong>{block.activity?.description ?? "Itens sem atividade"}</strong>
                                    )}
                                    {block.activity && hiddenMaterials[block.activity.id] && block.materials.length ? (
                                      <small className="hidden-mats">
                                        {block.materials.length} material{block.materials.length === 1 ? "" : "is"}
                                      </small>
                                    ) : null}
                                  </div>
                                  {block.activity?.empenho_override ? (
                                    <small className="activity-empenho-override">Empenho {block.activity.empenho_override}</small>
                                  ) : null}
                                  {block.activity && block.activity.activity_id != null ? (
                                    <input
                                      className="activity-observation-input"
                                      aria-label={`Observação da atividade ${block.activity.description}`}
                                      placeholder="Observação (opcional)"
                                      defaultValue={block.activity.observation ?? ""}
                                      key={`${block.activity.id}-${block.activity.observation ?? ""}`}
                                      onBlur={async (event) => {
                                        const observation = event.currentTarget.value.trim();
                                        if (observation === (block.activity?.observation ?? "")) return;
                                        setData(await api.updateLine(block.activity!.id, { observation }));
                                      }}
                                    />
                                  ) : null}
                                </div>
                              </div>
                            </td>
                            <td className="left col-cost-object">
                              {block.activity ? (
                                <div className="cost-object-cell">
                                  <CostObjectSearch
                                    costObjects={costObjects}
                                    line={block.activity}
                                    onChange={async (id) => {
                                      setData(
                                        await api.updateLine(
                                          block.activity!.id,
                                          equipmentHead
                                            ? {
                                                costObjectId: id,
                                                refKind: "cost_object",
                                                productCode: equipmentCodeFromLine(block.activity!) || block.activity!.product_code,
                                                activityId: block.activity!.activity_id,
                                                materialId: block.activity!.material_id,
                                                itemType: block.activity!.item_type,
                                              }
                                            : { costObjectId: id },
                                        ),
                                      );
                                    }}
                                  />
                                  {reducePctLabel(block.activity) ? (
                                    <span className="area-pct">{reducePctLabel(block.activity)}</span>
                                  ) : null}
                                  <button
                                    type="button"
                                    className={`icon-btn calc-icon ${block.activity.use_activity_auto === 0 ? "on" : ""}`}
                                    title="Como calcular"
                                    onClick={() => setEditCalc(block.activity)}
                                  >
                                    <CalculatorIcon />
                                  </button>
                                </div>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="col-qty-ha">{qtyPerHaLabel(block.activity)}</td>
                            <td className="col-rate-ha cell-money">{ratePerHaLabel(block.activity, block.materials)}</td>
                            {totals.months.map((v, i) => {
                              const activity = block.activity;
                              const skipAutoCat = isFuelLubricantCategory(cat.name);
                              const equipmentAuto = Boolean(activity && isEquipmentHead(activity) && activity.calc_plans);
                              const manual =
                                activity != null &&
                                !block.materials.length &&
                                !equipmentAuto &&
                                (skipAutoCat ||
                                  activity.use_activity_auto === 0 ||
                                  !activityHasAutoValue(
                                    calcRules,
                                    activity.activity_id,
                                    activity.cost_object_id,
                                  ));
                              const own = block.activity?.own_months?.[i] ?? v;
                              const shown = monthCellText(null, own);
                              return (
                                <td key={i} className="cell-money">
                                  {manual && block.activity ? (
                                    <input
                                      className="cell cell-money"
                                      key={`${block.activity.id}-${i}-${own}`}
                                      defaultValue={shown}
                                      onBlur={async (e) => {
                                        const raw = e.target.value.trim();
                                        if (!moneyInputChanged(raw, shown)) return;
                                        if (raw === "") {
                                          setData(await api.setMonth(block.activity!.id, i, { value: null }));
                                          return;
                                        }
                                        const n = parseMoneyInput(raw);
                                        if (!Number.isFinite(n)) return;
                                        setData(await api.setMonth(block.activity!.id, i, { formula: `=${n}` }));
                                      }}
                                    />
                                  ) : (
                                    formatBRL(v)
                                  )}
                                </td>
                              );
                            })}
                            <td className="cell-money">{formatBRL(totals.total)}</td>
                            <td>
                              {block.activity ? (
                                <span className="row-actions">
                                  {fixedCostHead ? (
                                    <button
                                      className="btn"
                                      onClick={() => setAddEquipmentUnder(block.activity)}
                                    >
                                      Incluir equipamento
                                    </button>
                                  ) : null}
                                  <button
                                    className="btn"
                                    onClick={() => setAddMaterialIn(block.activity)}
                                  >
                                    Incluir material
                                  </button>
                                  <button
                                    className="icon-btn"
                                    title={
                                      equipmentHead
                                        ? "Remover equipamento"
                                        : fixedCostHead
                                          ? "Remover objeto de custo"
                                          : "Remover atividade"
                                    }
                                    onClick={async () => {
                                      const label = equipmentHead
                                        ? "o equipamento"
                                        : fixedCostHead
                                          ? "o objeto de custo"
                                          : "a atividade";
                                      if (!confirm(`Remover ${label} “${block.activity?.description}” e os itens dele?`)) return;
                                      setData(await api.deleteLine(block.activity!.id));
                                    }}
                                  >
                                    ✕
                                  </button>
                                </span>
                              ) : null}
                            </td>
                          </tr>
                          {block.activity && hiddenMaterials[block.activity.id]
                            ? null
                            : block.materials.map((line) => (
                            <tr key={line.id} className={`child${section.center ? " nested-child" : ""}`}>
                              <td className="left col-tipo">
                                {isHourCostLine(line) ? (
                                  <span className="tipo-hour">h</span>
                                ) : (
                                <select
                                  className="cell-select tipo"
                                  value={line.item_type === "E" || line.item_type === "G" ? line.item_type : ""}
                                  onChange={async (e) => {
                                    const itemType = e.target.value === "E" || e.target.value === "G" ? e.target.value : null;
                                    setData(
                                      await api.updateLine(line.id, {
                                        itemType,
                                        materialId: line.material_id,
                                        activityId: line.activity_id,
                                        refKind: line.ref_kind,
                                      }),
                                    );
                                  }}
                                >
                                  <option value="">—</option>
                                  <option value="E">E</option>
                                  <option value="G">G</option>
                                </select>
                                )}
                              </td>
                              <td className="left">
                                <ItemSelect line={line} materials={materials} costObjects={costObjects} equipments={equipments} onSaved={setData} />
                              </td>
                              <td className="left col-cost-object">
                                <div className="cost-object-cell">
                                  {isHourCostLine(line) ? (
                                    <CostObjectSearch
                                      costObjects={costObjects}
                                      line={line}
                                      onChange={async (id) => {
                                        setData(
                                          await api.updateLine(line.id, {
                                            costObjectId: id,
                                            refKind: "cost_object",
                                            productCode: line.product_code,
                                            activityId: line.activity_id,
                                            materialId: null,
                                            itemType: line.item_type,
                                          }),
                                        );
                                      }}
                                    />
                                  ) : null}
                                  {areaPctLabel(line) ? <span className="area-pct">{areaPctLabel(line)}</span> : null}
                                  {reducePctLabel(line) ? <span className="area-pct">{reducePctLabel(line)}</span> : null}
                                  {applicationsLabel(line) ? <span className="area-pct">{applicationsLabel(line)}</span> : null}
                                  <button
                                    type="button"
                                    className={`icon-btn calc-icon ${
                                      isEquipmentHead(line)
                                        ? line.use_activity_auto === 0
                                          ? "on"
                                          : ""
                                        : line.calc_dose != null && line.calc_price != null
                                          ? "on"
                                          : ""
                                    }`}
                                    title="Como calcular"
                                    onClick={() =>
                                      isEquipmentHead(line)
                                        ? setEditCalc(line)
                                        : setEditMaterialCalc({ line, parent: block.activity })
                                    }
                                  >
                                    <CalculatorIcon />
                                  </button>
                                </div>
                              </td>
                              <td className="col-qty-ha">{qtyPerHaLabel(line)}</td>
                              <td className="col-rate-ha cell-money">{ratePerHaLabel(line, block.materials, block.activity)}</td>
                              {line.months.map((m) => {
                                const shown = monthCellText(m.formula, m.value);
                                const auto = (m.formula ?? "").trim() === AUTO_CALC_FORMULA;
                                return (
                                <td key={m.month} className="cell-money">
                                  <input
                                    className="cell cell-money"
                                    key={`${line.id}-${m.month}-${m.value}-${m.formula}`}
                                    defaultValue={shown}
                                    title={auto ? "Cálculo automático" : m.formula ?? ""}
                                    onBlur={async (e) => {
                                      const raw = e.target.value.trim();
                                      if (!moneyInputChanged(raw, shown)) return;
                                      if (raw.startsWith("=") && raw !== AUTO_CALC_FORMULA) {
                                        setData(await api.setMonth(line.id, m.month, { formula: raw }));
                                      } else if (raw === "") setData(await api.setMonth(line.id, m.month, { value: null }));
                                      else {
                                        const n = parseMoneyInput(raw);
                                        if (!Number.isFinite(n)) return;
                                        setData(await api.setMonth(line.id, m.month, { value: n }));
                                      }
                                    }}
                                  />
                                </td>
                                );
                              })}
                              <td className="cell-money">{formatBRL(line.total)}</td>
                              <td>
                                <button
                                  className="icon-btn"
                                  title={
                                    isHourCostLine(line)
                                      ? "Remover objeto de custo"
                                      : isEquipmentHead(line)
                                        ? "Remover equipamento"
                                        : "Remover material"
                                  }
                                  onClick={async () => {
                                    if (confirm(`Remover “${line.description}”?`)) setData(await api.deleteLine(line.id));
                                  }}
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {copyIntoCategoryId != null ? (
        <CopyFromCategory
          data={data}
          targetCategoryId={copyIntoCategoryId}
          activities={activities}
          onClose={() => setCopyIntoCategoryId(null)}
          onSaved={setData}
        />
      ) : null}
      {addCenterIn != null ? (
        <AddCostCenterGroup
          data={data}
          categoryId={addCenterIn}
          sheets={sheets}
          onClose={() => setAddCenterIn(null)}
          onSaved={setData}
        />
      ) : null}
      {addActivityIn != null ? (
        <AddActivity
          data={data}
          categoryId={addActivityIn.categoryId}
          initialCenterSheetId={addActivityIn.centerSheetId ?? null}
          sheets={sheets}
          activities={activities}
          empenhos={empenhos}
          materials={materials}
          costObjects={costObjects}
          equipments={equipments}
          catalogCategories={catalogCategories}
          drivers={drivers}
          calcRules={calcRules}
          onClose={() => setAddActivityIn(null)}
          onSaved={setData}
        />
      ) : null}
      {addMaterialIn ? (
        <AddMaterial
          data={data}
          parent={addMaterialIn}
          materials={materials}
          costObjects={costObjects}
          equipments={equipments}
          drivers={drivers}
          calcRules={calcRules}
          onClose={() => setAddMaterialIn(null)}
          onSaved={setData}
        />
      ) : null}
      {addEquipmentUnder ? (
        <AddEquipmentUnderCostObject
          data={data}
          parent={addEquipmentUnder}
          equipments={equipments}
          costObjects={costObjects}
          drivers={drivers}
          calcRules={calcRules}
          onClose={() => setAddEquipmentUnder(null)}
          onSaved={setData}
        />
      ) : null}
      {distributeIn ? (
        <DistributeValue
          data={data}
          sheets={sheets}
          activities={activities}
          costObjects={costObjects}
          catalogCategories={catalogCategories}
          initialActivityId={distributeIn.activityId ?? 0}
          initialCategoryId={distributeIn.categoryId ?? data.categories[0]?.id ?? 0}
          onClose={() => setDistributeIn(null)}
          onSaved={(next) => {
            setData(next);
            setDistributeIn(null);
          }}
        />
      ) : null}
      {editCalc ? (
        <EditActivityCalc
          line={editCalc}
          sheetId={data.id}
          sheetName={data.name}
          activities={activities}
          costObjects={costObjects}
          categoryName={data.categories.find((cat) => cat.id === editCalc.category_id)?.name ?? null}
          skipAuto={isFuelLubricantCategory(
            data.categories.find((cat) => cat.id === editCalc.category_id)?.name,
          )}
          distributions={(data.distributions ?? []).filter((item) => item.activityId === editCalc.activity_id)}
          drivers={drivers}
          calcRules={calcRules}
          onClose={() => setEditCalc(null)}
          onDistribute={() => {
            setDistributeIn({
              activityId: editCalc.activity_id ?? undefined,
              categoryId: editCalc.category_id,
            });
            setEditCalc(null);
          }}
          onSaved={(next) => {
            setData(next);
            setEditCalc(null);
          }}
          onUndone={(next) => {
            setData(next);
            const stillThere = next.categories.some((cat) => cat.lines.some((row) => row.id === editCalc.id));
            if (!stillThere) setEditCalc(null);
          }}
          onCalcRulesChange={(rules) => setCalcRules(rules)}
        />
      ) : null}
      {editMaterialCalc ? (
        <EditMaterialCalc
          sheetId={sheetId}
          line={editMaterialCalc.line}
          parent={editMaterialCalc.parent}
          costObjects={costObjects}
          equipments={equipments}
          drivers={drivers}
          calcRules={calcRules}
          onClose={() => setEditMaterialCalc(null)}
          onSaved={(next) => {
            setData(next);
            setEditMaterialCalc(null);
          }}
        />
      ) : null}
      {openCat ? (
        <AddCategory
          options={catalogCategories}
          onClose={() => setOpenCat(false)}
          onSaved={async (catalogId) => {
            setData(await api.addCategory(data.id, { catalogId }));
            setOpenCat(false);
          }}
        />
      ) : null}
      </ReadOnlyFieldset>
    </div>
  );
}

function isHourCostLine(line: LineItem) {
  return line.ref_kind === "cost_object" && !isEquipmentHead(line) && !Boolean(line.is_group);
}

function isCostCenterGroup(line: LineItem) {
  return line.ref_kind === "cost_center";
}

function isEquipmentHead(line: LineItem) {
  if (line.ref_kind === "activity" || isCostCenterGroup(line)) return false;
  const product = equipmentCodeFromLine(line);
  if (line.ref_kind === "cost_object" && product && Boolean(line.is_group)) return true;
  return Boolean(
    line.is_group &&
      !line.parent_id &&
      !line.material_id &&
      (line.item_type === "E" || line.item_type === "G") &&
      product,
  );
}

function isFixedCostObjectHead(line: LineItem) {
  return line.ref_kind === "cost_object" && Boolean(line.is_group) && !isEquipmentHead(line);
}

function equipmentCodeFromLine(line: LineItem) {
  const code = String(line.product_code ?? "").trim();
  if (code) return code;
  const match = String(line.description ?? "").match(/^\s*(\d+)\s+[—–-]\s+/);
  return match?.[1] ?? "";
}

function isMaintenanceCategory(name?: string | null) {
  return /manuten/i.test(name ?? "");
}

function isFuelLubricantCategory(name?: string | null) {
  const n = (name ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return /combustivel/.test(n) && /lubrific/.test(n);
}

function isActivityHead(line: LineItem, childrenOf?: Map<number, LineItem[]>, byId?: Map<number, LineItem>) {
  if (isCostCenterGroup(line)) return false;
  if (line.ref_kind === "activity") return true;
  if (isEquipmentHead(line) || isFixedCostObjectHead(line)) {
    if (!line.parent_id) return true;
    const parent = byId?.get(line.parent_id);
    return !parent || parent.ref_kind === "cost_center";
  }
  if (line.parent_id) return false;
  if (Boolean(line.is_group) && line.activity_id) return true;
  return Boolean(childrenOf?.get(line.id)?.length);
}

function hiddenMaterialsKey(sheetId: number) {
  return `pa-hide-materials-${sheetId}`;
}

function loadHiddenMaterials(sheetId: number): Record<number, boolean> {
  try {
    const raw = localStorage.getItem(hiddenMaterialsKey(sheetId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return Object.fromEntries(Object.entries(parsed).map(([id, hidden]) => [Number(id), Boolean(hidden)]));
  } catch {
    return {};
  }
}

function saveHiddenMaterials(sheetId: number, next: Record<number, boolean>) {
  localStorage.setItem(hiddenMaterialsKey(sheetId), JSON.stringify(next));
  return next;
}

function activityIdsWithMaterials(data: SheetDetail) {
  return data.categories.flatMap((cat) =>
    nestCategoryLines(cat.lines).flatMap((section) =>
      section.activities
        .filter((block) => block.activity && block.materials.length)
        .map((block) => block.activity!.id),
    ),
  );
}

type ActivityBlock = { activity: LineItem | null; materials: LineItem[] };
type CategorySection = { center: LineItem | null; activities: ActivityBlock[] };

function nestCategoryLines(lines: LineItem[]): CategorySection[] {
  const used = new Set<number>();
  const byId = new Map(lines.map((line) => [line.id, line]));
  const childrenOf = new Map<number, LineItem[]>();
  for (const line of lines) {
    if (!line.parent_id) continue;
    const list = childrenOf.get(line.parent_id) ?? [];
    list.push(line);
    childrenOf.set(line.parent_id, list);
  }

  const activityBlock = (activity: LineItem): ActivityBlock => {
    const materials: LineItem[] = [];
    for (const child of childrenOf.get(activity.id) ?? []) {
      if (child.ref_kind === "activity" || child.ref_kind === "cost_center") continue;
      materials.push(child);
      for (const grand of childrenOf.get(child.id) ?? []) {
        if (isEquipmentHead(grand)) materials.push(grand);
      }
    }
    used.add(activity.id);
    for (const material of materials) used.add(material.id);
    return { activity, materials };
  };

  const sections: CategorySection[] = [];
  for (const line of lines) {
    if (used.has(line.id) || !isCostCenterGroup(line) || line.parent_id) continue;
    used.add(line.id);
    const kids = childrenOf.get(line.id) ?? [];
    sections.push({
      center: line,
      activities: kids.filter((kid) => kid.ref_kind === "activity" || isActivityHead(kid, childrenOf, byId)).map(activityBlock),
    });
  }

  for (const line of lines) {
    if (used.has(line.id) || line.parent_id || !isActivityHead(line, childrenOf, byId)) continue;
    if (line.ref_kind === "activity" || isEquipmentHead(line) || isFixedCostObjectHead(line)) {
      sections.push({ center: null, activities: [activityBlock(line)] });
      continue;
    }
    const nested = childrenOf.get(line.id) ?? [];
    const materials: LineItem[] = [...nested.filter((child) => child.ref_kind !== "activity" && child.ref_kind !== "cost_center")];
    const idx = lines.indexOf(line);
    for (let i = idx + 1; i < lines.length; i++) {
      const next = lines[i];
      if (isActivityHead(next, childrenOf, byId) || isCostCenterGroup(next)) break;
      if (used.has(next.id) || next.parent_id) continue;
      materials.push(next);
    }
    used.add(line.id);
    for (const material of materials) used.add(material.id);
    sections.push({ center: null, activities: [{ activity: line, materials }] });
  }

  const leftovers = lines.filter((line) => !used.has(line.id) && !line.parent_id);
  if (leftovers.length) sections.push({ center: null, activities: [{ activity: null, materials: leftovers }] });
  return sections;
}

function blockTotals(materials: LineItem[]) {
  const months = MONTHS.map((_, i) => materials.reduce((sum, line) => sum + (line.months[i]?.value ?? 0), 0));
  return { months, total: months.reduce((a, b) => a + b, 0) };
}

function activityLabel(activities: Activity[], line: LineItem) {
  const act = activities.find((item) => item.id === line.activity_id);
  if (act) return `${act.code} — ${act.description}`;
  return line.description || "";
}

function activityCodeOf(activities: Activity[], line: LineItem) {
  return activities.find((item) => item.id === line.activity_id)?.code ?? "";
}

type CatalogOption = {
  key: string;
  kind: "material" | "activity" | "costObject" | "category";
  id: number;
  code: string;
  description: string;
  group: string;
  tipo?: "E" | "G";
};

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function materialOptions(materials: Material[], tipo?: string | null): CatalogOption[] {
  const list = tipo === "E" || tipo === "G" ? materials.filter((m) => m.tipo === tipo) : materials;
  return list.map((item) => ({
    key: `m-${item.id}`,
    kind: "material" as const,
    id: item.id,
    code: item.code,
    description: item.description,
    group: "Materiais",
    tipo: item.tipo,
  }));
}

function activityOptions(activities: Activity[]): CatalogOption[] {
  return activities.map((item) => ({
    key: `a-${item.id}`,
    kind: "activity" as const,
    id: item.id,
    code: item.code,
    description: item.description,
    group: "Atividades",
  }));
}

function categorySheetLines(data: SheetDetail, categoryId: number) {
  return data.categories.find((cat) => cat.id === categoryId)?.lines ?? [];
}

function sheetActivityLinkOptions(data: SheetDetail, categoryId: number, activities: Activity[]): CatalogOption[] {
  const inCategory = new Set(
    categorySheetLines(data, categoryId)
      .filter((line) => line.ref_kind === "activity" && line.activity_id)
      .map((line) => line.activity_id as number),
  );
  const inOther = new Set(
    data.categories
      .filter((cat) => cat.id !== categoryId)
      .flatMap((cat) => cat.lines)
      .filter((line) => line.activity_id)
      .map((line) => line.activity_id as number),
  );
  return activityOptions(activities).map((opt) =>
    inCategory.has(opt.id)
      ? { ...opt, group: "Nesta categoria" }
      : inOther.has(opt.id)
        ? { ...opt, group: "Em outras categorias" }
        : opt,
  );
}

function sheetMaterialLinkOptions(data: SheetDetail, categoryId: number, materials: Material[]): CatalogOption[] {
  const lines = categorySheetLines(data, categoryId);
  const byId = new Map(lines.map((line) => [line.id, line]));
  return lines
    .filter((line) => line.ref_kind === "material")
    .map((line) => {
      const mat = materials.find((item) => item.id === line.material_id);
      const parent = line.parent_id ? byId.get(line.parent_id) : undefined;
      const where = parent?.description ? ` → ${parent.description}` : "";
      const tipo = line.item_type === "E" || line.item_type === "G" ? line.item_type : mat?.tipo;
      return {
        key: `line-${line.id}`,
        kind: "material" as const,
        id: line.id,
        code: mat?.code ?? "",
        description: `${mat ? mat.description : line.description}${where}`,
        group: "Materiais desta categoria",
        tipo,
      };
    });
}

function categoryOptions(categories: CatalogCategory[]): CatalogOption[] {
  return categories.map((item) => ({
    key: `cat-${item.id}`,
    kind: "category" as const,
    id: item.id,
    code: "",
    description: item.name,
    group: "Categorias",
  }));
}

function costObjectOptions(costObjects: CostObject[]): CatalogOption[] {
  return costObjects.map((item) => ({
    key: `c-${item.id}`,
    kind: "costObject" as const,
    id: item.id,
    code: item.code,
    description: item.description,
    group: "Objetos de custo",
  }));
}

function costObjectOptionsForLine(costObjects: CostObject[], line: LineItem): CatalogOption[] {
  const opts = costObjectOptions(costObjects);
  const { code, description } = costObjectRef(costObjects, line);
  if (code && !opts.some((item) => item.code === code)) {
    opts.unshift({
      key: line.cost_object_id ? `c-${line.cost_object_id}` : `c-ob-${code}`,
      kind: "costObject",
      id: line.cost_object_id ?? 0,
      code,
      description: description || `Objeto ${code}`,
      group: "Objetos de custo",
    });
  }
  return opts;
}

function costObjectLabel(costObjects: CostObject[], line: LineItem) {
  const { code, description } = costObjectRef(costObjects, line);
  if (!code) return "";
  return description ? `${code} — ${description}` : code;
}

function costObjectRef(costObjects: CostObject[], line: LineItem) {
  const obj = costObjects.find((item) => item.id === line.cost_object_id);
  return {
    code: obj?.code || line.object_code || "",
    description: obj?.description || "",
  };
}

function CostObjectSearch({
  costObjects,
  line,
  onChange,
}: {
  costObjects: CostObject[];
  line: LineItem;
  onChange: (id: number | null) => void;
}) {
  const label = costObjectLabel(costObjects, line);
  return (
    <div className="cost-object-pick">
      <CatalogSearch
        compact
        options={costObjectOptionsForLine(costObjects, line)}
        selectedKey={line.cost_object_id ? `c-${line.cost_object_id}` : line.object_code ? `c-ob-${line.object_code}` : ""}
        selectedLabel={label}
        placeholder="Obj."
        onPick={(opt) => onChange(opt?.id ?? null)}
      />
    </div>
  );
}

function CalculatorIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="5" y="3" width="14" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="8" y="6" width="8" height="3.2" rx="0.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="13.2" r="1" fill="currentColor" />
      <circle cx="12" cy="13.2" r="1" fill="currentColor" />
      <circle cx="15" cy="13.2" r="1" fill="currentColor" />
      <circle cx="9" cy="16.8" r="1" fill="currentColor" />
      <circle cx="12" cy="16.8" r="1" fill="currentColor" />
      <circle cx="15" cy="16.8" r="1" fill="currentColor" />
    </svg>
  );
}

function PlanMonthPicks({
  months,
  onChange,
}: {
  months: number[];
  onChange: (next: number[]) => void;
}) {
  return (
    <div className="choice-picks">
      <button
        type="button"
        className={months.length === 12 ? "on" : ""}
        onClick={() => onChange(months.length === 12 ? [] : ALL_MONTHS)}
      >
        {months.length === 12 ? "Limpar" : "Todos"}
      </button>
      {MONTHS.map((label, month) => (
        <button
          key={label}
          type="button"
          className={months.includes(month) ? "on" : ""}
          onClick={() =>
            onChange(
              months.includes(month)
                ? months.filter((item) => item !== month)
                : [...months, month].sort((a, b) => a - b),
            )
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ActivityPlanCard({
  plan,
  index,
  total,
  extra,
  activityId,
  autoLabel,
  autoPremise,
  drivers,
  equipmentMode = false,
  onChange,
  onRemove,
}: {
  plan: ActivityCalcPlan;
  index: number;
  total: number;
  extra?: boolean;
  activityId?: number | null;
  autoLabel: string | null;
  autoPremise: string | null;
  drivers: CalcDriver[];
  equipmentMode?: boolean;
  onChange: (next: ActivityCalcPlan) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<ActivityCalcPlan>) => onChange({ ...plan, ...patch });
  return (
    <div className="calc-plan-card">
      <div className="calc-plan-head">
        <strong>
          {extra ? `Cálculo extra ${index + 1}` : `Cálculo ${index + 1}`}
        </strong>
        {total > 1 || extra ? (
          <button type="button" className="btn" onClick={onRemove}>
            Remover
          </button>
        ) : null}
      </div>
      <div className="kind-toggle" style={{ padding: 0 }}>
        <button type="button" className={`btn ${plan.mode === "fixed" ? "primary" : ""}`} onClick={() => set({ mode: "fixed", fixedQty: plan.mode !== "fixed" ? plan.dose || "1" : plan.fixedQty, fixedValue: plan.mode !== "fixed" ? plan.price || plan.fixedValue : plan.fixedValue })}>
          Quantidade
        </button>
      </div>
      <div className="form-grid" style={{ padding: "8px 0 0" }}>
        {plan.mode === "fixed" ? (
          <>
            <label>
              Quantidade
              <small>Quantidade × preço unitário em cada mês escolhido, sem usar área ou dias.</small>
              <input value={plan.fixedQty} onChange={(e) => set({ fixedQty: e.target.value })} placeholder="Ex.: 1" />
            </label>
            <label>
              Unidade da quantidade
              <select value={quantityUnit(plan.quantityUnit)} onChange={(e) => set({ quantityUnit: quantityUnit(e.target.value) })}>
                {QUANTITY_UNITS.map((unidade) => <option key={unidade.value} value={unidade.value}>{unidade.label}</option>)}
              </select>
            </label>
            <label>
              Preço por {quantityUnit(plan.quantityUnit)} (R$)
              <input value={plan.fixedValue} onChange={(e) => set({ fixedValue: e.target.value })} placeholder="Ex.: 1500" />
            </label>
            <label className="span-2 check-label">
              <span className="check-row">
                <input type="checkbox" checked={Boolean(plan.useApplications)} onChange={(e) => set({ useApplications: e.target.checked, applications: plan.applications || "1" })} />
                Definir quantidade de aplicações
              </span>
            </label>
            {plan.useApplications ? <label>
              Quantidade de aplicações
              <small>Multiplica quantidade × preço em cada mês escolhido.</small>
              <input value={plan.applications ?? "1"} onChange={(e) => set({ applications: e.target.value })} inputMode="decimal" placeholder="Ex.: 2" />
            </label> : null}
          </>
        ) : (
          <>
            <label>
              {plan.mode === "days" ? "Quantidade" : equipmentMode ? "Horas/ha" : "Quantidade por ha"}
              <input value={plan.dose} onChange={(e) => set({ dose: e.target.value })} placeholder="Ex.: 1" />
            </label>
            <label>
              {equipmentMode ? "Custo/hora" : "Preço"}
              <input value={plan.price} onChange={(e) => set({ price: e.target.value })} placeholder={equipmentMode ? "Ex.: 60" : "Ex.: 850"} />
            </label>
            {equipmentMode ? null : (
            <label className="span-2">
              Premissa
              <small>Área associada a esta atividade no cálculo automático — não é escolhida aqui.</small>
              <input
                readOnly
                value={
                  !activityId
                    ? "Selecione a atividade para ver a premissa associada."
                    : autoLabel ?? "Não há premissa de área no cálculo automático para esta atividade e objeto de custo."
                }
              />
            </label>
            )}
            {plan.mode === "days" ? (
              <>
                <label className="span-2">
                  Desconsiderar no mês
                  <small>Marque os dias da semana que não entram no cálculo, por exemplo domingo.</small>
                  <WeekdayPicks value={plan.excludeWeekdays} onChange={(excludeWeekdays) => set({ excludeWeekdays })} />
                </label>
                <label className="span-2 check-label">
                  <span className="check-row">
                    <input
                      type="checkbox"
                      checked={plan.followArea}
                      onChange={(e) => set({ followArea: e.target.checked })}
                    />
                    Só nos meses com área
                  </span>
                  <small>
                    {equipmentMode
                      ? "Se a premissa escolhida não tiver hectare no mês, o valor fica zerado."
                      : "Se a premissa do cálculo automático não tiver hectare no mês, o valor fica zerado. A área não multiplica o preço — só liga ou desliga o mês."}
                  </small>
                </label>
              </>
            ) : null}
            <label className="span-2">
              Percentual da área
              <small>
                {plan.mode === "days"
                  ? "Fração da área da premissa associada a esta atividade (materiais e custo direto)."
                  : equipmentMode
                    ? "Usa esta fração da área da premissa escolhida."
                    : "Usa esta fração da área da premissa do cálculo automático."}
              </small>
              <input value={plan.areaPct} onChange={(e) => set({ areaPct: e.target.value })} placeholder="Ex.: 30" />
            </label>
          </>
        )}
        <label className="span-2">
          Meses
          <small>
            {plan.months.length
              ? `${plan.months.length} escolhido${plan.months.length === 1 ? "" : "s"}`
              : "Escolha os meses deste cálculo"}
          </small>
          <PlanMonthPicks months={plan.months} onChange={(months) => set({ months })} />
        </label>
      </div>
      <div className="formula-box" style={{ margin: "8px 0 0" }}>
        {planFormula(plan, drivers, autoPremise)}
      </div>
    </div>
  );
}

function AutoRuleEditor({
  draft,
  onChange,
  drivers,
}: {
  draft: AutoRuleDraft;
  onChange: (next: AutoRuleDraft) => void;
  drivers: CalcDriver[];
}) {
  const set = (patch: Partial<AutoRuleDraft>) => onChange({ ...draft, ...patch });
  const areaDrivers = drivers.filter((d) => d.key !== "dias");
  return (
    <div className="auto-rule-editor" style={{ marginTop: 8 }}>
      <p className="lead" style={{ margin: "0 0 6px", padding: 0 }}>
        Função do cálculo automático
      </p>
      <small>
        Altera o parâmetro desta atividade na safra. Vale para todos os centros que usam o cálculo
        automático nesta atividade
        {draft.costObjectIds.length ? " e nestes objetos de custo" : ""}.
      </small>
      <div className="kind-toggle" style={{ padding: "8px 0 0" }}>
        <button type="button" className={`btn ${draft.mode === "area" ? "primary" : ""}`} onClick={() => set({ mode: "area" })}>
          Por área
        </button>
        <button type="button" className={`btn ${draft.mode === "days" ? "primary" : ""}`} onClick={() => set({ mode: "days" })}>
          Por dia × preço
        </button>
        <button
          type="button"
          className={`btn ${draft.mode === "hours" ? "primary" : ""}`}
          onClick={() => set({ mode: "hours", premise: draft.premise === "dias" ? "moagem" : draft.premise })}
        >
          Por tonelada (horas)
        </button>
        <button type="button" className={`btn ${draft.mode === "materials" ? "primary" : ""}`} onClick={() => set({ mode: "materials" })}>
          Só materiais
        </button>
      </div>
      <div className="form-grid" style={{ padding: "8px 0 0" }}>
        {draft.mode === "materials" ? (
          <label className="span-2">
            Premissa da área
            <small>Usada pelos materiais e pelo custo/hora ligados a esta atividade.</small>
            <select value={draft.premise} onChange={(e) => set({ premise: e.target.value })}>
              {areaDrivers.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        ) : draft.mode === "hours" ? (
          <>
            <label>
              Tonelada / hora
              <input value={draft.dose} onChange={(e) => set({ dose: e.target.value })} placeholder="Ex.: 60" />
            </label>
            <label>
              Quantidade
              <input value={draft.hoursQty} onChange={(e) => set({ hoursQty: e.target.value })} placeholder="Ex.: 1" />
            </label>
            <label className="span-2">
              Premissa (t)
              <select value={draft.premise} onChange={(e) => set({ premise: e.target.value })}>
                {areaDrivers.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <label>
              {draft.mode === "days" ? "Quantidade" : "Quantidade por ha"}
              <input value={draft.dose} onChange={(e) => set({ dose: e.target.value })} placeholder={draft.mode === "days" ? "Ex.: 1" : "Ex.: 1,2"} />
            </label>
            <label>
              Preço
              <input value={draft.price} onChange={(e) => set({ price: e.target.value })} placeholder="Ex.: 850" />
            </label>
            {draft.mode === "area" ? (
              <label className="span-2">
                Premissa
                <select value={draft.premise} onChange={(e) => set({ premise: e.target.value })}>
                  {areaDrivers.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label className="span-2">
                  Desconsiderar no mês
                  <small>Marque os dias da semana que não entram no cálculo.</small>
                  <WeekdayPicks value={draft.excludeWeekdays} onChange={(excludeWeekdays) => set({ excludeWeekdays })} />
                </label>
                <label className="span-2 check-label">
                  <span className="check-row">
                    <input
                      type="checkbox"
                      checked={draft.followArea}
                      onChange={(e) => set({ followArea: e.target.checked })}
                    />
                    Só nos meses com área
                  </span>
                  <small>Se a premissa não tiver hectare no mês, o valor fica zerado.</small>
                </label>
                {draft.followArea ? (
                  <label className="span-2">
                    Premissa da área
                    <select value={draft.areaPremise} onChange={(e) => set({ areaPremise: e.target.value })}>
                      {areaDrivers.map((d) => (
                        <option key={d.key} value={d.key}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
      <div className="formula-box" style={{ margin: "8px 0 0" }}>
        {draft.mode === "materials"
          ? `Valor da atividade pelos materiais · premissa ${premiseLabel(draft.premise, drivers) ?? draft.premise}`
          : draft.mode === "hours"
            ? `horas = (${premiseLabel(draft.premise, drivers) ?? draft.premise} / ${draft.dose || "t/h"} t/h) × ${draft.hoursQty || "1"}`
            : draft.mode === "days"
              ? `(${draft.dose || "1"} × ${draft.price || "preço"}) × dias do mês (${exceptLabel(draft.excludeWeekdays)})${
                  draft.followArea ? ` só nos meses com ${premiseLabel(draft.areaPremise, drivers) ?? draft.areaPremise}` : ""
                }`
              : `(${draft.dose || "qtd/ha"} × ${draft.price || "preço"}) × ${premiseLabel(draft.premise, drivers) ?? draft.premise}`}
      </div>
    </div>
  );
}

function ActivityCalcForm({
  value,
  onChange,
  drivers,
  activityId,
  costObjectId,
  calcRules,
  allowAuto = true,
  allowFormula = true,
  equipmentMode = false,
  autoDraft,
  onAutoDraftChange,
}: {
  value: ActivityCalcState;
  onChange: (next: ActivityCalcState) => void;
  drivers: CalcDriver[];
  activityId?: number | null;
  costObjectId?: number | null;
  calcRules: CalcRule[];
  allowAuto?: boolean;
  allowFormula?: boolean;
  equipmentMode?: boolean;
  autoDraft?: AutoRuleDraft | null;
  onAutoDraftChange?: (next: AutoRuleDraft) => void;
}) {
  const set = (patch: Partial<ActivityCalcState>) => onChange({ ...value, ...patch });
  const autoPremise = equipmentMode
    ? (value.premise || null)
    : autoDraft && (autoDraft.mode === "area" || autoDraft.mode === "materials")
      ? autoDraft.premise
      : autoDraft && autoDraft.mode === "days" && autoDraft.followArea
        ? autoDraft.areaPremise
        : autoAreaPremiseFromRules(calcRules, activityId, costObjectId);
  const autoLabel = premiseLabel(autoPremise, drivers);
  const showAuto = allowAuto && value.useActivityAuto;
  const setPlan = (id: string, next: ActivityCalcPlan) =>
    set({ plans: value.plans.map((plan) => (plan.id === id ? next : plan)) });
  const removePlan = (id: string) => set({ plans: value.plans.filter((plan) => plan.id !== id) });
  const addPlan = () =>
    set({
      plans: [...value.plans, { ...emptyCalcPlan(), months: showAuto ? [] : [...ALL_MONTHS] }],
    });
  const planList = (
    <>
      {equipmentMode && !showAuto && value.plans.some((plan) => plan.mode !== "fixed") ? (
        <div className="form-grid" style={{ padding: "8px 0 0" }}>
          <MaterialPremiseFields
            drivers={drivers}
            value={value.premise}
            onChange={(premise) => set({ premise, areaPremise: premise })}
          />
        </div>
      ) : null}
      <div className="calc-plan-list">
        {value.plans.map((plan, index) => (
          <ActivityPlanCard
            key={plan.id}
            plan={plan}
            index={index}
            total={value.plans.length}
            extra={showAuto}
            activityId={activityId}
            autoLabel={autoLabel}
            autoPremise={autoPremise}
            drivers={drivers}
            equipmentMode={equipmentMode}
            onChange={(next) => setPlan(plan.id, next)}
            onRemove={() => removePlan(plan.id)}
          />
        ))}
      </div>
      <button type="button" className="btn" style={{ marginTop: 8 }} onClick={addPlan}>
        Adicionar cálculo
      </button>
      {value.plans.length > 1 ? (
        <p className="calc-plan-note">Se o mesmo mês estiver em dois cálculos, vale o de baixo.</p>
      ) : null}
    </>
  );
  return (
    <div className="activity-calc-form">
      {allowAuto ? (
        <>
          <span className="activity-fill-label">Usar o cálculo automático das atividades</span>
          <div className="kind-toggle" style={{ padding: 0 }}>
            <button type="button" className={`btn ${value.useActivityAuto ? "primary" : ""}`} onClick={() => set({ useActivityAuto: true })}>
              Sim
            </button>
            <button
              type="button"
              className={`btn ${!value.useActivityAuto ? "primary" : ""}`}
              onClick={() =>
                set({
                  useActivityAuto: false,
                  mode: "fixed",
                  plans: value.plans.length ? value.plans : [emptyCalcPlan("fixed")],
                })
              }
            >
              Não
            </button>
          </div>
        </>
      ) : null}
      {showAuto ? (
        <>
          <small>
            O sistema preenche pelos parâmetros de cálculo automático desta safra. Ajuste a função abaixo
            ou acrescente outro cálculo só em alguns meses.
          </small>
          {autoDraft && onAutoDraftChange ? (
            <AutoRuleEditor draft={autoDraft} onChange={onAutoDraftChange} drivers={drivers} />
          ) : null}
          {planList}
        </>
      ) : allowFormula ? (
        <>
          <p className="lead" style={{ margin: "4px 0 0", padding: 0 }}>
            {equipmentMode ? "Como você quer calcular neste equipamento?" : "Como você quer calcular nesta atividade?"}
          </p>
          <small>Informe a quantidade, a unidade e o preço para os meses escolhidos. Aplicações são opcionais.</small>
          {planList}
        </>
      ) : (
        <>
          <p className="lead" style={{ margin: "4px 0 0", padding: 0 }}>
            {equipmentMode ? "Como você quer calcular neste equipamento?" : "Como você quer calcular nesta atividade?"}
          </p>
          <div className="kind-toggle" style={{ padding: 0 }}>
            <button
              type="button"
              className={`btn ${value.mode === "fixed" ? "primary" : ""}`}
              onClick={() => set({ useActivityAuto: false, mode: "fixed" })}
            >
              Quantidade × preço
            </button>
          </div>
          {value.mode === "fixed" ? (
            <div className="form-grid" style={{ padding: "8px 0 0" }}>
              <FixedMonthValueFields
                value={value.fixedValue}
                qty={value.fixedQty}
                months={value.fixedMonths}
                onValue={(fixedValue) => set({ fixedValue })}
                onQty={(fixedQty) => set({ fixedQty })}
                onMonths={(fixedMonths) => set({ fixedMonths })}
              />
            </div>
          ) : null}
        </>
      )}
      {!equipmentMode ? (
        <div className="form-grid" style={{ padding: "12px 0 0" }}>
          <label className="span-2">
            <span className="calc-plan-head" style={{ margin: 0 }}>
              <span>Redução do valor calculado (%)</span>
              {value.reducePct.trim() ? (
                <button type="button" className="btn" onClick={() => set({ reducePct: "" })}>
                  Retirar
                </button>
              ) : null}
            </span>
            <small>
              Abate este percentual do valor da atividade depois do cálculo, inclusive materiais e custo/hora já
              repartidos nos equipamentos. Ex.: 10 reduz 10% do total. Use Retirar ou deixe vazio e salve para voltar
              ao valor integral.
            </small>
            <input
              value={value.reducePct}
              onChange={(e) => set({ reducePct: e.target.value })}
              placeholder="Ex.: 10"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function WeekdayPicks({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  return (
    <div className="weekday-picks">
      {WEEKDAYS.map((day) => {
        const on = value.includes(day.id);
        return (
          <button
            key={day.id}
            type="button"
            className={on ? "on" : ""}
            title={on ? `Voltar a contar ${day.name}` : `Desconsiderar ${day.name}`}
            onClick={() => onChange(toggleWeekday(value, day.id))}
          >
            {day.short}
          </button>
        );
      })}
    </div>
  );
}

function EditActivityCalc({
  line,
  sheetId,
  sheetName,
  activities,
  costObjects,
  categoryName,
  skipAuto = false,
  distributions,
  drivers,
  calcRules,
  onClose,
  onDistribute,
  onSaved,
  onUndone,
  onCalcRulesChange,
}: {
  line: LineItem;
  sheetId: number;
  sheetName: string;
  activities: Activity[];
  costObjects: CostObject[];
  categoryName?: string | null;
  skipAuto?: boolean;
  distributions: ValueDistribution[];
  drivers: CalcDriver[];
  calcRules: CalcRule[];
  onClose: () => void;
  onDistribute: () => void;
  onSaved: (d: SheetDetail) => void;
  onUndone: (d: SheetDetail) => void;
  onCalcRulesChange?: (rules: CalcRule[]) => void;
}) {
  const { safraId } = useApp();
  const funcionarioLine = isFuncionarioHeadLine(line, activities);
  const folhaAvulsaLine =
    !funcionarioLine &&
    isFolhaAvulsaLine(line, activities, { categoryName, costObjects });
  const funcionarioApiMode: FuncionarioApiCalcMode | null = funcionarioLine
    ? "full"
    : folhaAvulsaLine
      ? "folhaAvulsaOnly"
      : null;
  const [funcionarioConfig, setFuncionarioConfig] = useState<FuncionarioApiConfig>(() => {
    const stored = parseFuncionarioApiConfig(line.funcionario_api_config);
    return stored ?? { enabled: true, externalSafraId: 4, subprocessIds: [], folhaAvulsaSubprocessIds: [] };
  });
  const equipmentMode = isEquipmentHead(line);
  const canUseAuto = !skipAuto && !equipmentMode && Boolean(line.activity_id);
  const hasAuto = canUseAuto && activityHasAutoValue(calcRules, line.activity_id, line.cost_object_id);
  const [value, setValue] = useState<ActivityCalcState>(() => {
    const base = calcStateFromLine(line);
    if (equipmentMode) {
      if (!base.plans.length && base.mode !== "fixed") {
        return { ...base, useActivityAuto: false, plans: [emptyCalcPlan(base.mode)] };
      }
      return { ...base, useActivityAuto: false };
    }
    if (!hasAuto && base.mode !== "fixed") return { ...base, useActivityAuto: false, mode: "fixed" };
    if (hasAuto && !base.useActivityAuto && !base.plans.length) {
      return { ...base, plans: [emptyCalcPlan(base.mode === "fixed" ? "fixed" : base.mode)] };
    }
    return base;
  });
  const [autoDraft, setAutoDraft] = useState<AutoRuleDraft>(() =>
    autoRuleDraftFromRules(calcRules, line.activity_id, line.cost_object_id),
  );
  const [monthValues, setMonthValues] = useState(() => monthValuesFromAmounts(line.own_months));
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const autoPremise = equipmentMode
    ? (value.premise || null)
    : autoDraft.mode === "area" || autoDraft.mode === "materials"
      ? autoDraft.premise
      : autoDraft.mode === "days" && autoDraft.followArea
        ? autoDraft.areaPremise
        : autoAreaPremiseFromRules(calcRules, line.activity_id, line.cost_object_id);

  return (
    <div className="modal-back" onClick={onClose}>
      <div
        className={`modal ${value.useActivityAuto && canUseAuto ? "wide" : ""}${funcionarioApiMode ? " wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Como calcular {line.description}</h3>
        {funcionarioApiMode ? (
          <FuncionarioApiCalcPanel
            sheetName={sheetName}
            value={funcionarioConfig}
            onChange={setFuncionarioConfig}
            mode={funcionarioApiMode}
          />
        ) : (
        <ActivityCalcForm
          value={value}
          onChange={setValue}
          drivers={drivers}
          activityId={line.activity_id}
          costObjectId={line.cost_object_id}
          calcRules={calcRules}
          allowAuto={canUseAuto}
          allowFormula={canUseAuto || equipmentMode}
          equipmentMode={equipmentMode}
          autoDraft={canUseAuto ? autoDraft : null}
          onAutoDraftChange={canUseAuto ? setAutoDraft : undefined}
        />
        )}
        {funcionarioApiMode === "full" && !equipmentMode ? (
          <div className="form-grid" style={{ padding: "12px 0 0" }}>
            <label className="span-2">
              <span className="calc-plan-head" style={{ margin: 0 }}>
                <span>Redução do valor calculado (%)</span>
                {value.reducePct.trim() ? (
                  <button type="button" className="btn" onClick={() => setValue((prev) => ({ ...prev, reducePct: "" }))}>
                    Retirar
                  </button>
                ) : null}
              </span>
              <small>
                Abate este percentual do valor da atividade depois do cálculo. Use Retirar ou deixe vazio e salve para
                voltar ao valor integral.
              </small>
              <input
                value={value.reducePct}
                onChange={(e) => setValue((prev) => ({ ...prev, reducePct: e.target.value }))}
                placeholder="Ex.: 10"
              />
            </label>
          </div>
        ) : null}
        {!funcionarioApiMode && !hasAuto && !equipmentMode && !value.useActivityAuto && value.mode !== "fixed" ? (
          <MonthValuesFields values={monthValues} onChange={setMonthValues} />
        ) : null}
        {equipmentMode ? null : funcionarioApiMode ? null : (
        <div className="distribute-from-calc">
          <p className="lead" style={{ margin: 0, padding: 0 }}>
            Ou rateie um valor total desta atividade em vários centros de custo e meses.
          </p>
          <button type="button" className="btn" onClick={onDistribute}>
            Distribuir valor
          </button>
          {distributions.length ? (
            <>
              <p className="lead" style={{ margin: "8px 0 0", padding: 0 }}>
                Desfazer tira o valor rateado desta atividade.
              </p>
              <DistributionList
                items={distributions}
                onUndo={async (id) => {
                  onUndone(await api.undoDistribution(sheetId, id));
                }}
              />
            </>
          ) : null}
        </div>
        )}
        {saveErr ? <p className="lead" style={{ color: "#9b2c2c" }}>{saveErr}</p> : null}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            disabled={saving}
            onClick={async () => {
              if (funcionarioApiMode) {
                if (
                  funcionarioApiMode === "full" &&
                  !funcionarioConfig.subprocessIds.length
                ) {
                  setSaveErr("Selecione ao menos um subprocesso para despesa com funcionários.");
                  return;
                }
                if (
                  funcionarioApiMode === "folhaAvulsaOnly" &&
                  !funcionarioConfig.folhaAvulsaSubprocessIds.length
                ) {
                  setSaveErr("Selecione ao menos um subprocesso para folha avulsa.");
                  return;
                }
                if (funcionarioApiMode === "full" && value.reducePct.trim()) {
                  const reduce = parseInputNum(value.reducePct);
                  if (!(reduce >= 0) || reduce > 100) {
                    setSaveErr("Informe a redução em percentual (0 a 100).");
                    return;
                  }
                }
                setSaving(true);
                setSaveErr(null);
                try {
                  onSaved(
                    await api.updateLine(line.id, {
                      funcionarioApiConfig: { ...funcionarioConfig, enabled: true },
                      calcReducePct: value.reducePct.trim() ? parseInputNum(value.reducePct) : null,
                    }),
                  );
                  onClose();
                } catch (e) {
                  setSaveErr(e instanceof Error ? e.message : "Não foi possível salvar a fonte da API.");
                } finally {
                  setSaving(false);
                }
                return;
              }
              const typedMonths = monthValuesPayload(monthValues);
              const usingFixed = !canUseAuto && !equipmentMode && !value.useActivityAuto && value.mode === "fixed";
              const plans = value.plans ?? [];
              const fixedFilled =
                parseInputNum(value.fixedValue) > 0 && quantityOrOne(value.fixedQty) > 0 && value.fixedMonths.length > 0;
              // Só redução (Retirar / zerar %): mantém o cálculo já gravado, sem exigir valor fixo de novo.
              const keepExistingCalc =
                !equipmentMode &&
                !value.useActivityAuto &&
                !typedMonths.length &&
                (!plans.length || (usingFixed && !fixedFilled));
              // Só alteração de redução (ex.: Retirar): não exige remontar valor fixo / planos.
              if (!keepExistingCalc) {
                if (value.useActivityAuto && canUseAuto) {
                  const ruleErr = validateAutoRuleDraft(autoDraft);
                  if (ruleErr) {
                    setSaveErr(ruleErr);
                    return;
                  }
                }
                if (canUseAuto || equipmentMode) {
                  const err = validateActivityPlans(plans, value.useActivityAuto, autoPremise);
                  if (err) {
                    setSaveErr(err);
                    return;
                  }
                } else if (usingFixed) {
                  if (!(parseInputNum(value.fixedValue) > 0)) {
                    setSaveErr("Informe o valor fixo.");
                    return;
                  }
                  if (!(quantityOrOne(value.fixedQty) > 0)) {
                    setSaveErr("Informe a quantidade.");
                    return;
                  }
                  if (!value.fixedMonths.length) {
                    setSaveErr("Escolha pelo menos um mês.");
                    return;
                  }
                }
              }
              if (!equipmentMode && value.reducePct.trim()) {
                const reduce = parseInputNum(value.reducePct);
                if (!(reduce >= 0) || reduce > 100) {
                  setSaveErr("Informe a redução em percentual (0 a 100).");
                  return;
                }
              }
              setSaving(true);
              setSaveErr(null);
              try {
                if (value.useActivityAuto && canUseAuto && line.activity_id) {
                  const rulesData = await saveAutoRuleDraft(autoDraft, line.activity_id, safraId);
                  onCalcRulesChange?.(rulesData.rules ?? []);
                }
                onSaved(
                  await api.updateLine(
                    line.id,
                    keepExistingCalc
                      ? { calcReducePct: value.reducePct.trim() ? parseInputNum(value.reducePct) : null }
                      : usingFixed
                        ? calcPayload(value, autoPremise)
                        : !canUseAuto && !equipmentMode && typedMonths.length
                          ? {
                              useActivityAuto: false,
                              months: typedMonths,
                              calcReducePct: value.reducePct.trim() ? parseInputNum(value.reducePct) : null,
                            }
                          : calcPayload(value, autoPremise),
                  ),
                );
                onClose();
              } catch (e) {
                setSaveErr(e instanceof Error ? e.message : "Não foi possível salvar o cálculo.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Salvando…" : funcionarioLine ? "Salvar e aplicar da API" : "Salvar cálculo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditMaterialCalc({
  sheetId,
  line,
  parent,
  costObjects,
  equipments,
  drivers,
  calcRules,
  onClose,
  onSaved,
}: {
  sheetId: number;
  line: LineItem;
  parent: LineItem | null;
  costObjects: CostObject[];
  equipments: EquipmentCatalogItem[];
  drivers: CalcDriver[];
  calcRules: CalcRule[];
  onClose: () => void;
  onSaved: (d: SheetDetail) => void;
}) {
  const hourCost = isHourCostLine(line);
  const initialArea = initialMaterialArea(line);
  const [calcMode, setCalcMode] = useState<"qty" | "quantity" | "direct" | "trips" | "hours" | "liters" | "days">(
    line.calc_kind === "quantity" ? "quantity" : isTripsLine(line)
      ? "trips"
      : hourCost
        ? "qty"
        : line.calc_kind === "hours"
          ? "hours"
          : line.calc_kind === "liters"
            ? "liters"
            : line.calc_kind === "days"
              ? "days"
            : line.calc_direct === 1
              ? "direct"
              : "qty",
  );
  const pureQuantity = calcMode === "quantity";
  const [materialUnit, setMaterialUnit] = useState(() => quantityUnit(parseStoredCalcPlans(line.calc_plans)[0]?.quantityUnit));
  const [useQuantityApplications, setUseQuantityApplications] = useState((line.calc_applications ?? 1) !== 1);
  const [price, setPrice] = useState(line.calc_price != null ? String(line.calc_price).replace(".", ",") : "");
  const [qty, setQty] = useState(line.calc_dose != null ? String(line.calc_dose).replace(".", ",") : "");
  const [trips, setTrips] = useState(line.calc_trips != null ? String(line.calc_trips).replace(".", ",") : "");
  const [machineQty, setMachineQty] = useState(
    line.calc_machine_qty != null ? String(line.calc_machine_qty).replace(".", ",") : "",
  );
  const [hourInterval, setHourInterval] = useState(
    line.calc_hour_interval != null ? String(line.calc_hour_interval).replace(".", ",") : "",
  );
  const [excludeWeekdays, setExcludeWeekdays] = useState(() => parseWeekdays(line.calc_exclude_weekdays));
  const [applications, setApplications] = useState(
    line.calc_applications != null && Number(line.calc_applications) > 0
      ? String(line.calc_applications).replace(".", ",")
      : "1",
  );
  const [areaPct, setAreaPct] = useState(initialArea.areaPct);
  const [areaHa, setAreaHa] = useState(initialArea.areaHa);
  const [areaMode, setAreaMode] = useState<"pct" | "ha">(initialArea.mode);
  const initialMonths = parseSelectedMonths(line.calc_months);
  const [monthScope, setMonthScope] = useState<"all" | "selected">(initialMonths ? "selected" : "all");
  const [autoMonths, setAutoMonths] = useState<number[]>(initialMonths ?? ALL_MONTHS);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [lastPrice, setLastPrice] = useState<MaterialLastPrice | null>(null);
  const [hourData, setHourData] = useState<CostObjectHourCostData | null>(null);
  const [hourLoading, setHourLoading] = useState(false);
  const [hourErr, setHourErr] = useState<string | null>(null);
  const [equipData, setEquipData] = useState<EquipmentHourCostData | null>(null);
  const [equipLoading, setEquipLoading] = useState(false);
  const [equipErr, setEquipErr] = useState<string | null>(null);
  const [equipmentCodes, setEquipmentCodes] = useState(() =>
    hourCost ? parseEquipmentCodes(line.product_code) : [],
  );
  const [equipObcMap, setEquipObcMap] = useState<{ code: string; costObjectCodes: number[] }[]>([]);
  const [equipObcLoading, setEquipObcLoading] = useState(false);
  const [equipObcErr, setEquipObcErr] = useState<string | null>(null);
  const [apontamento, setApontamento] = useState<ApontamentoEquipmentData | null>(null);
  const [apontamentoLoading, setApontamentoLoading] = useState(false);
  const [apontamentoErr, setApontamentoErr] = useState<string | null>(null);
  const [premise, setPremise] = useState(
    () => line.calc_area_premise || autoAreaPremiseFromRules(calcRules, parent?.activity_id, parent?.cost_object_id) || "",
  );
  const { safra } = useApp();
  const kpis = usePremissaKpis();
  const parentCalc = parent ? calcStateFromLine(parent) : EMPTY_CALC;
  const parentAutoPremise = parent
    ? autoAreaPremiseFromRules(calcRules, parent.activity_id, parent.cost_object_id)
    : null;
  const parentShape = parent ? calcShapeLabel(parentCalc, drivers, parentAutoPremise) : "cálculo da atividade";
  const usesParentArea = !parent || parentCalc.useActivityAuto || parentCalc.mode === "area";
  const usesArea = Boolean(premise) || usesParentArea;
  const premiseName = premiseLabel(premise, drivers);
  const premiseMonths = premise ? areaMonthsFor(premise, kpis) : parent?.premise_ha_months ?? parent?.area_ha_months ?? null;
  const premiseDays = premise ? premiseDaysFor(premise, kpis) : null;
  const premiseTotal = premiseMonths?.reduce((sum, value) => sum + (value ?? 0), 0) ?? 0;
  const unitPrice = Number(price.replace(",", "."));
  const quantity = Number(qty.replace(",", "."));
  const hourStep = Number(hourInterval.replace(",", "."));
  const totalValue = unitPrice > 0 && quantity > 0 ? unitPrice * quantity : 0;
  const activityId = parent?.activity_id ?? line.activity_id;
  const showHourUi = hourCost ? calcMode !== "trips" : calcMode === "hours";
  const showLiterUi = !hourCost && calcMode === "liters";
  const showDaysUi = !hourCost && calcMode === "days";
  const showEquipUi = showHourUi || showLiterUi || showDaysUi;
  const hoursFromTons = showHourUi
    ? hoursRuleFromRules(calcRules, activityId, parent?.cost_object_id)
    : null;
  const hoursFromTonsLabel = hoursRuleLabel(hoursFromTons, drivers);
  const hourItem = hourData?.items.find((item) => item.costObjectId === line.cost_object_id)
    ?? hourData?.items.find((item) => item.code === (costObjects.find((o) => o.id === line.cost_object_id)?.code ?? ""));
  const selectedEquipItems = resolveSelectedEquipment(equipmentCodes, apontamento, equipData, equipments);
  const equipment = averagedEquipmentHourCost(selectedEquipItems, apontamento?.safras ?? equipData?.safras ?? hourData?.safras ?? []);
  const equipmentFuel = averagedEquipmentFuelCost(
    apontamento?.items ?? [],
    equipmentCodes,
    apontamento?.safras ?? [],
  );
  const hourCostObjectId = line.cost_object_id || parent?.cost_object_id || 0;

  useEffect(() => {
    if (!showHourUi && !showDaysUi) return;
    let cancelled = false;
    setHourLoading(true);
    setHourErr(null);
    api
      .costObjectHourCost()
      .then((next) => {
        if (!cancelled) setHourData(next);
      })
      .catch((e: Error) => {
        if (!cancelled) setHourErr(e.message);
      })
      .finally(() => {
        if (!cancelled) setHourLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showHourUi, showDaysUi]);

  useEffect(() => {
    if ((!showHourUi && !showDaysUi) || !hourCostObjectId) {
      setEquipData(null);
      setEquipErr(null);
      return;
    }
    let cancelled = false;
    setEquipLoading(true);
    setEquipErr(null);
    api
      .equipmentHourCost(hourCostObjectId)
      .then((next) => {
        if (!cancelled) setEquipData(next);
      })
      .catch((e: Error) => {
        if (!cancelled) setEquipErr(e.message);
      })
      .finally(() => {
        if (!cancelled) setEquipLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showHourUi, showDaysUi, hourCostObjectId]);

  useEffect(() => {
    if (!showEquipUi || !activityId) {
      if (!showEquipUi) {
        setApontamento(null);
        setApontamentoErr(null);
      }
      return;
    }
    let cancelled = false;
    setApontamentoLoading(true);
    setApontamentoErr(null);
    api
      .activityApontamentoEquipment(activityId)
      .then((next) => {
        if (cancelled) return;
        setApontamento(next);
        if (showLiterUi && !equipmentCodes.length) {
          const codes = next.items
            .filter((item) => item.rates.some((row) => row.litrosPorHa > 0))
            .map((item) => item.code);
          if (codes.length) {
            setEquipmentCodes(codes);
            const litersHa = tractorAverageLitrosHa(next.items, codes);
            if (litersHa != null && !(Number(line.calc_dose) > 0)) setQty(formatCalcInput(litersHa));
            const cost = tractorAverageCostPerLiter(next.items, codes, safra?.id);
            if (cost != null && !(Number(line.calc_price) > 0)) setPrice(formatCalcInput(cost));
          }
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setApontamentoErr(e.message);
      })
      .finally(() => {
        if (!cancelled) setApontamentoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showEquipUi, showLiterUi, activityId, safra?.id]);

  useEffect(() => {
    if (!hourCost || !equipmentCodes.length) {
      setEquipObcMap([]);
      setEquipObcErr(null);
      return;
    }
    let cancelled = false;
    setEquipObcLoading(true);
    setEquipObcErr(null);
    api
      .equipmentCostObjects(equipmentCodes)
      .then((next) => {
        if (!cancelled) setEquipObcMap(next.items);
      })
      .catch((e: Error) => {
        if (!cancelled) setEquipObcErr(e.message);
      })
      .finally(() => {
        if (!cancelled) setEquipObcLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hourCost, equipmentCodes.join(",")]);

  const applyTractors = (codes: string[]) => {
    setEquipmentCodes(codes);
    if (showLiterUi) {
      const litersHa = tractorAverageLitrosHa(apontamento?.items ?? [], codes);
      if (litersHa != null) setQty(formatCalcInput(litersHa));
      const cost = tractorAverageCostPerLiter(apontamento?.items ?? [], codes, safra?.id);
      if (cost != null) setPrice(formatCalcInput(cost));
      return;
    }
    if (showDaysUi) {
      const cost = tractorAverageCostPerHour(apontamento?.items ?? [], codes, hourItem, safra?.id, equipData?.items);
      if (cost != null) setPrice(formatCalcInput(cost));
      return;
    }
    if (!hoursFromTons) {
      const hoursHa = tractorAverageHoursHa(apontamento?.items ?? [], codes);
      if (hoursHa != null) setQty(formatCalcInput(hoursHa));
    }
    const cost = tractorAverageCostPerHour(apontamento?.items ?? [], codes, hourItem, safra?.id, equipData?.items);
    if (cost != null) setPrice(formatCalcInput(cost));
  };

  const applyTractorRate = (code: string, rate: ApontamentoEquipmentRate) => {
    const next = equipmentCodes.includes(code) ? equipmentCodes : [...equipmentCodes, code];
    setEquipmentCodes(next);
    if (showLiterUi) {
      if (rate.litrosPorHa > 0) setQty(formatCalcInput(rate.litrosPorHa));
      if (rate.costPerLiter != null) setPrice(formatCalcInput(rate.costPerLiter));
      return;
    }
    if (showDaysUi) {
      if (rate.costPerHour != null) setPrice(formatCalcInput(rate.costPerHour));
      return;
    }
    if (!hoursFromTons && rate.hoursHa > 0) setQty(formatCalcInput(rate.hoursHa));
    if (rate.costPerHour != null) setPrice(formatCalcInput(rate.costPerHour));
  };

  const lookupLastPrice = async () => {
    if (!line.material_id) return;
    setLooking(true);
    setSaveErr(null);
    try {
      const found = await api.materialLastPrice(line.material_id);
      setLastPrice(found);
      setPrice(String(found.price).replace(".", ","));
    } catch (e) {
      setLastPrice(null);
      setSaveErr(e instanceof Error ? e.message : "Não foi possível calcular a média dos últimos preços.");
    } finally {
      setLooking(false);
    }
  };

  const distinctEquipObcs = [...new Set(equipObcMap.flatMap((item) => item.costObjectCodes))];
  const canRepartirObc = hourCost && showHourUi && equipmentCodes.length > 0;

  const performSave = async (repartirObc: boolean) => {
    const direct = !hourCost && calcMode === "direct";
    const tripsMode = calcMode === "trips";
    const tripCount = parseInputNum(trips);
    const machines = parseInputNum(machineQty);
    if (direct && !(unitPrice > 0)) {
      setSaveErr("Informe o preço do custo direto.");
      return;
    }
    if (!pureQuantity && !showHourUi && !showLiterUi && !showDaysUi && !hourCost && !premise && !usesParentArea) {
      setSaveErr("Selecione a premissa.");
      return;
    }
    if (tripsMode) {
      if (!premise) {
        setSaveErr("Selecione a premissa.");
        return;
      }
      if (!(quantity > 0 && tripCount > 0 && machines > 0 && unitPrice > 0)) {
        setSaveErr("Informe tonelada, viagens, quantidade de máquina e preço.");
        return;
      }
    } else if (showDaysUi) {
      if (!(quantity > 0 && unitPrice > 0)) {
        setSaveErr("Informe as horas por dia e o custo por hora.");
        return;
      }
    } else if (hoursFromTons && !hourCost) {
      if (!(hourStep > 0)) {
        setSaveErr("Informe o intervalo de horas.");
        return;
      }
      if (!(quantity > 0)) {
        setSaveErr("Informe a quantidade.");
        return;
      }
      if (!(unitPrice > 0)) {
        setSaveErr("Informe o custo por hora.");
        return;
      }
    } else if (hoursFromTons) {
      if (!(unitPrice > 0)) {
        setSaveErr("Informe o custo por hora.");
        return;
      }
    } else if (hourCost && !tripsMode && !premise) {
      setSaveErr("Selecione a premissa.");
      return;
    } else if (!direct && !(totalValue > 0)) {
      setSaveErr(
        showLiterUi
          ? "Informe os litros por hectare e o preço por litro."
          : showHourUi
            ? "Informe o custo por hora e a quantidade por hectare."
            : "Informe o preço e a quantidade.",
      );
      return;
    }
    const area = pureQuantity || hoursFromTons || direct || tripsMode || showDaysUi
      ? { calcAreaPct: tripsMode || showDaysUi ? null : 100, calcAreaHa: null as number | null }
      : materialAreaPayload(usesArea, areaMode, areaPct, areaHa);
    if ("error" in area) {
      setSaveErr(area.error ?? "Informe a área.");
      return;
    }
    if (monthScope === "selected" && !autoMonths.length) {
      setSaveErr("Escolha pelo menos um mês do cálculo automático.");
      return;
    }
    const apps = pureQuantity && !useQuantityApplications ? 1 : hourCost || showHourUi || showLiterUi || showDaysUi || direct || tripsMode ? 1 : parseApplicationsInput(applications);
    if (!direct && !hourCost && !showHourUi && !showLiterUi && !showDaysUi && !tripsMode && !(apps > 0)) {
      setSaveErr("Informe a quantidade de aplicações.");
      return;
    }
    if (repartirObc && canRepartirObc && !distinctEquipObcs.length && !equipObcLoading) {
      setSaveErr("Nenhum objeto de custo vigente encontrado para repartir.");
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      let detail = await api.updateLine(
        line.id,
        hourCost
          ? tripsMode
            ? {
                costObjectId: line.cost_object_id,
                activityId: line.activity_id,
                materialId: null,
                productCode: null,
                description: costObjects.find((o) => o.id === line.cost_object_id)?.description ?? line.description,
                refKind: "cost_object",
                calcDose: quantity,
                calcPrice: unitPrice,
                calcAreaPremise: premise || null,
                calcAreaPct: null,
                calcAreaHa: null,
                calcMonths: materialCalcMonths(monthScope, autoMonths),
                calcApplications: 1,
                calcDirect: false,
                calcKind: "trips",
                calcTrips: tripCount,
                calcMachineQty: machines,
              }
            : {
                costObjectId: line.cost_object_id,
                activityId: line.activity_id,
                materialId: null,
                productCode: equipmentCodes.join(",") || null,
                description: tractorLineDescription(
                  equipmentCodes,
                  apontamento?.items ?? [],
                  equipData?.items ?? [],
                  costObjects.find((o) => o.id === line.cost_object_id)?.description,
                  equipments,
                ),
                refKind: "cost_object",
                calcDose: hoursFromTons ? 1 : quantity,
                calcPrice: unitPrice,
                calcAreaPremise: hoursFromTons ? null : premise || null,
                calcAreaPct: area.calcAreaPct,
                calcAreaHa: area.calcAreaHa,
                calcMonths: materialCalcMonths(monthScope, autoMonths),
                calcApplications: 1,
                calcDirect: false,
                calcKind: "qty",
                calcTrips: null,
                calcMachineQty: null,
              }
          : {
              materialId: line.material_id,
              activityId: line.activity_id,
              refKind: "material",
              calcDose: direct ? 1 : quantity,
              calcPrice: unitPrice,
              calcAreaPremise: pureQuantity || showHourUi || showLiterUi || showDaysUi ? null : premise || null,
              calcAreaPct: area.calcAreaPct,
              calcAreaHa: pureQuantity || direct || tripsMode || showDaysUi ? null : area.calcAreaHa,
              calcMonths: materialCalcMonths(monthScope, autoMonths),
              calcApplications: apps,
              calcDirect: direct,
              ...(pureQuantity ? { calcPlans: [{ mode: "fixed", dose: quantity, price: unitPrice, quantityUnit: materialUnit, ...(useQuantityApplications ? { applications: apps } : {}), months: materialCalcMonths(monthScope, autoMonths) }] } : {}),
              calcKind: pureQuantity ? "quantity" : tripsMode
                ? "trips"
                : calcMode === "hours"
                  ? "hours"
                  : calcMode === "liters"
                    ? "liters"
                    : calcMode === "days"
                      ? "days"
                    : calcMode === "direct"
                      ? "direct"
                      : "qty",
              calcTrips: tripsMode ? tripCount : null,
              calcMachineQty: tripsMode ? machines : null,
              calcHourInterval: hoursFromTons ? hourStep : null,
              calcExcludeWeekdays: showDaysUi ? excludeWeekdays : null,
            },
      );
      if (repartirObc && canRepartirObc) {
        detail = await api.reconcileEquipmentObc(sheetId);
      }
      onSaved(detail);
      onClose();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Não foi possível salvar o cálculo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal ${hourCost || showHourUi || showLiterUi || showDaysUi ? "wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <h3>Como calcular {line.description}</h3>
        <p className="lead" style={{ margin: "0 0 8px" }}>
          {pureQuantity ? "Quantidade × preço × aplicações opcionais nos meses escolhidos." : hourCost || calcMode === "hours"
            ? calcMode === "trips"
              ? "Tonelada × viagens × quantidade de máquina × preço × dias da premissa."
              : hoursFromTons && !hourCost
              ? `Fórmula: (${hoursFromTonsLabel} ÷ intervalo de horas) × quantidade × preço.`
              : hoursFromTons
              ? `Custo/hora × ${hoursFromTonsLabel}. As horas vêm da premissa, não das horas/ha.`
              : premise
                ? `Custo/hora × quantidade/ha × área da premissa (${premiseName}).`
                : `Custo/hora × quantidade/ha × área da atividade (${parentShape}).`
            : calcMode === "days"
              ? `Horas/dia × R$/h × dias do mês (${exceptLabel(excludeWeekdays)}) nos meses escolhidos.`
            : calcMode === "liters"
              ? `L/ha × R$/L × área da atividade (${parentShape}).`
            : "O material pode usar a premissa direto (hectares ou toneladas × quantidade × preço), sem depender do valor da atividade."}
        </p>
        <div className="form-grid" style={{ padding: "12px 0" }}>
          {hourCost ? (
          <label className="span-2">
            Como calcular
            <small>
              {calcMode === "trips"
                ? "Tonelada × viagens × quantidade de máquina × preço × dias da premissa."
                : hoursFromTons
                  ? `Custo/hora × ${hoursFromTonsLabel}. As horas vêm da premissa, não das horas/ha.`
                  : premise
                    ? `Custo/hora × quantidade/ha × área da premissa (${premiseName}).`
                    : `Custo/hora × quantidade/ha × área da atividade (${parentShape}).`}
            </small>
            <div className="kind-toggle" style={{ padding: "6px 0 0" }}>
              <button type="button" className={`btn ${calcMode === "trips" ? "primary" : ""}`} onClick={() => setCalcMode("trips")}>
                Viagens
              </button>
            </div>
          </label>
          ) : (
          <label className="span-2">
            Como calcular
            <small>
              {pureQuantity ? "Quantidade × preço nos meses escolhidos, sem área ou dias." : calcMode === "direct"
                ? "Custo direto: premissa × preço."
                : calcMode === "trips"
                  ? "Tonelada × viagens × quantidade de máquina × preço × dias da premissa."
                  : calcMode === "hours"
                    ? hoursFromTons
                      ? `(${hoursFromTonsLabel} ÷ intervalo) × quantidade × preço.`
                      : `Custo/hora × quantidade/ha × área da atividade (${parentShape}).`
                  : calcMode === "days"
                    ? `Horas/dia × R$/h × dias do mês (${exceptLabel(excludeWeekdays)}).`
                  : calcMode === "liters"
                    ? `L/ha × R$/L × área da atividade (${parentShape}).`
                  : "Quantidade: premissa × quantidade × preço × aplicações."}
            </small>
            <div className="kind-toggle" style={{ padding: "6px 0 0" }}>
              <button type="button" className={`btn ${pureQuantity ? "primary" : ""}`} onClick={() => setCalcMode("quantity")}>Quantidade</button>
            </div>
          </label>
          )}
          {pureQuantity ? <div className="formula-box">{qty || "0"} {materialUnit} × {price || "0"} R$/{materialUnit}{useQuantityApplications ? ` × ${applications || "1"} aplicação(ões)` : ""} = {formatBRL(totalValue * (useQuantityApplications ? parseApplicationsInput(applications) : 1))} por mês escolhido</div> : showDaysUi ? (
            <>
            <label className="span-2">
              Equipamentos da atividade
              <small>Opcional. Selecione para preencher o custo/hora.</small>
              <TractorHoursPicker
                data={apontamento}
                loading={apontamentoLoading}
                error={apontamentoErr}
                selected={equipmentCodes}
                currentSafraId={safra?.id}
                onChange={applyTractors}
                onUseRate={applyTractorRate}
              />
            </label>
            <EquipmentSearchField
              catalog={equipments}
              apontamento={apontamento?.items}
              costObjectItems={equipData?.items}
              equipmentCodes={equipmentCodes}
              onPick={applyTractors}
            />
            <label className="span-2">
              Custo/hora das safras
              <HourCostRates
                item={equipment ?? hourItem}
                safras={(equipment ? apontamento?.safras : hourData?.safras) ?? []}
                loading={equipmentCodes.length ? apontamentoLoading : hourLoading}
                error={equipmentCodes.length ? apontamentoErr : hourErr}
                caption={equipmentCodes.length > 1 ? "Média dos equipamentos" : equipment ? "Equipamento" : "Objeto de custo"}
                empty="Selecione um equipamento ou informe o custo/hora manualmente."
                onUse={(value) => setPrice(formatCalcInput(value))}
              />
            </label>
            </>
          ) : null}
          {showLiterUi ? (
            <>
            <label className="span-2">
              Equipamentos da atividade
              <small>
                Equipamentos das operações em Associar realizado. Litros, área, L/ha e R$/L por safra.
              </small>
              <TractorHoursPicker
                data={apontamento}
                loading={apontamentoLoading}
                error={apontamentoErr}
                selected={equipmentCodes}
                currentSafraId={safra?.id}
                metric="liters"
                onChange={applyTractors}
                onUseRate={applyTractorRate}
              />
            </label>
            <EquipmentSearchField
              catalog={equipments}
              apontamento={apontamento?.items}
              costObjectItems={equipData?.items}
              equipmentCodes={equipmentCodes}
              onPick={applyTractors}
            />
            <label className="span-2">
              R$/L das safras
              <small>
                {equipmentCodes.length > 1
                  ? "Média do preço por litro dos equipamentos selecionados."
                  : "Custo de combustível ÷ litros no período de cada safra."}
              </small>
              <FuelCostRates
                item={equipmentFuel}
                safras={apontamento?.safras ?? []}
                loading={apontamentoLoading}
                error={apontamentoErr}
                caption={equipmentCodes.length > 1 ? "Média dos equipamentos" : "Equipamento"}
                empty="Selecione os equipamentos para preencher o R$/L."
                onUse={(value) => setPrice(formatCalcInput(value))}
              />
            </label>
            </>
          ) : null}
          {showHourUi ? (
            <>
            <label className="span-2">
              Tratores da atividade
              <small>
                Equipamentos que rodaram nas operações associadas em Associar realizado, sem filtro de
                objeto de custo. Horas, área, horas/ha e custo/hora aparecem por safra.
              </small>
              <TractorHoursPicker
                data={apontamento}
                loading={apontamentoLoading}
                error={apontamentoErr}
                selected={equipmentCodes}
                currentSafraId={safra?.id}
                onChange={applyTractors}
                onUseRate={applyTractorRate}
              />
            </label>
            <EquipmentSearchField
              catalog={equipments}
              apontamento={apontamento?.items}
              costObjectItems={equipData?.items}
              equipmentCodes={equipmentCodes}
              onPick={applyTractors}
            />
            {equipmentCodes.length ? (
              <div className="lead" style={{ margin: 0, gridColumn: "1 / -1" }}>
                <p style={{ margin: 0 }}>
                  Use <strong>Salvar e repartir por OBC</strong> para dividir o valor entre os objetos de custo vigentes
                  de cada equipamento (<code>automotivo.historicoequipamentoobcusto</code>, <code>data_final</code> nulo).
                </p>
                {equipObcLoading ? <small>Consultando objetos de custo dos equipamentos…</small> : null}
                {equipObcErr ? <small style={{ color: "var(--danger, #c0392b)" }}>{equipObcErr}</small> : null}
                {equipObcMap.length ? (
                  <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
                    {equipObcMap.map((item) => (
                      <li key={item.code}>
                        Equipamento <strong>{item.code}</strong>:{" "}
                        {item.costObjectCodes.length
                          ? formatEquipmentObcList(costObjects, item.costObjectCodes)
                          : "sem objeto de custo vigente"}
                      </li>
                    ))}
                  </ul>
                ) : !equipObcLoading && !equipObcErr ? (
                  <small>Nenhum objeto de custo vigente encontrado para os equipamentos selecionados.</small>
                ) : null}
                {canRepartirObc && distinctEquipObcs.length > 1 ? (
                  <small style={{ display: "block", marginTop: "0.5rem" }}>
                    {distinctEquipObcs.length} objetos de custo distintos — a repartição criará uma linha para cada um.
                  </small>
                ) : null}
                {canRepartirObc ? (
                  <div style={{ marginTop: "0.75rem" }}>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={saving || equipObcLoading}
                      onClick={() => void performSave(true)}
                    >
                      {saving ? "Salvando…" : "Salvar e repartir por OBC"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <label className="span-2">
              Custo/hora das safras
              <small>
                {equipmentCodes.length
                  ? equipmentCodes.length > 1
                    ? "Média do custo/hora dos tratores selecionados (requisição de material ÷ horas)."
                    : "Requisição de material do equipamento ÷ horas no período."
                  : "Custo de manutenção (empenho grupo 20) e horas dos equipamentos no período de cada safra."}
              </small>
              <HourCostRates
                item={equipment ?? hourItem}
                safras={(equipment ? apontamento?.safras : hourData?.safras) ?? []}
                loading={equipmentCodes.length ? apontamentoLoading : hourLoading}
                error={equipmentCodes.length ? apontamentoErr : hourErr}
                caption={equipmentCodes.length > 1 ? "Média dos tratores" : equipment ? "Equipamento" : "Objeto de custo"}
                onUse={(value) => setPrice(String(value).replace(".", ","))}
              />
            </label>
            </>
          ) : line.material_id && !showLiterUi && !showDaysUi ? (
            <label className="span-2">
              Média dos últimos preços
              <small>Consulta as 3 últimas entradas e usa a média do preço unitário.</small>
              <div className="last-price-row">
                <button type="button" className="btn" disabled={looking} onClick={() => void lookupLastPrice()}>
                  {looking ? "Calculando…" : "Média dos últimos 3 preços"}
                </button>
                {lastPrice ? (
                  <span className="last-price-found">
                    {formatUnitPrice(lastPrice.price)}
                    {lastPrice.count
                      ? ` · média de ${lastPrice.count} entrada${lastPrice.count === 1 ? "" : "s"}`
                      : ""}
                  </span>
                ) : null}
              </div>
            </label>
          ) : null}
          {pureQuantity ? null : showHourUi || showLiterUi || showDaysUi ? (
            showHourUi && !hoursFromTons && calcMode !== "trips" ? (
            <MaterialPremiseFields
              drivers={drivers}
              value={premise}
              onChange={setPremise}
              autoPremise={parentAutoPremise}
            />
            ) : null
          ) : (
            <MaterialPremiseFields
              drivers={drivers}
              value={premise}
              onChange={setPremise}
              autoPremise={parentAutoPremise}
            />
          )}
          <label>
            {pureQuantity ? `Preço por ${materialUnit} (R$)` : showHourUi || showDaysUi ? "Custo/hora" : showLiterUi ? "Preço/litro" : "Preço"}
            <small>
              {showHourUi || showDaysUi
                ? "R$ por hora. Cada safra tem o seu custo/hora."
                : showLiterUi
                ? "R$ por litro. Cada safra tem o seu R$/L."
                : `Desta ${safra?.label ?? "safra"}. Cada safra tem o seu preço.`}
            </small>
            <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder={showHourUi || showDaysUi ? "Ex.: 60" : showLiterUi ? "Ex.: 5,80" : "Ex.: 21,51"} />
          </label>
          {calcMode === "trips" ? (
            <>
              <label>
                Tonelada
                <small>Quantidade em toneladas que multiplica o cálculo.</small>
                <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Ex.: 32" />
              </label>
              <label>
                Viagens
                <small>Número de viagens.</small>
                <input value={trips} onChange={(e) => setTrips(e.target.value)} placeholder="Ex.: 4" />
              </label>
              <label>
                Quantidade de máquina
                <small>Quantidade de máquinas no cálculo.</small>
                <input value={machineQty} onChange={(e) => setMachineQty(e.target.value)} placeholder="Ex.: 10" />
              </label>
            </>
          ) : pureQuantity || hourCost || calcMode === "qty" || calcMode === "hours" || calcMode === "liters" || calcMode === "days" ? (
            <>
              {hoursFromTons && !hourCost ? (
                <label>
                  Intervalo de horas
                  <small>Divide as horas do cálculo automático da atividade.</small>
                  <input
                    value={hourInterval}
                    onChange={(e) => setHourInterval(e.target.value)}
                    placeholder="Ex.: 8"
                  />
                </label>
              ) : null}
              {hoursFromTons && hourCost ? null : (
              <label>
                {showDaysUi ? "Horas por dia" : "Quantidade"}
                <small>
                  {pureQuantity ? "Quantidade em cada mês escolhido" : hoursFromTons
                    ? "multiplica depois da divisão pelas horas"
                    : showDaysUi
                    ? "horas por dia"
                    : showLiterUi
                    ? "litros por hectare"
                    : showHourUi
                    ? "horas por hectare"
                    : premise
                    ? premiseUnit(premise) === "t"
                      ? "por tonelada da premissa"
                      : "por hectare da premissa"
                    : parentCalc.useActivityAuto
                    ? "por hectare ou por dia, conforme a atividade"
                    : parentCalc.mode === "days"
                      ? "por dia"
                      : "por hectare"}
                </small>
                <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder={showDaysUi ? "Ex.: 8" : showLiterUi ? "Ex.: 12,5" : "Ex.: 1"} />
              </label>
              )}
              {showDaysUi ? (
                <label className="span-2">
                  Retirar dia da semana
                  <small>Marque os dias que o equipamento não roda (ex.: domingo).</small>
                  <WeekdayPicks value={excludeWeekdays} onChange={setExcludeWeekdays} />
                </label>
              ) : null}
              {showHourUi || showLiterUi || showDaysUi || (pureQuantity && !useQuantityApplications) ? null : (
              <label>
                Quantidade de aplicações
                <small>Multiplica quantidade × preço em cada mês escolhido</small>
                <input value={applications} onChange={(e) => setApplications(e.target.value)} placeholder="Ex.: 2" />
              </label>
              )}
              {pureQuantity || hoursFromTons || showDaysUi ? null : usesArea ? (
                <MaterialAreaFields
                  mode={areaMode}
                  onMode={setAreaMode}
                  areaPct={areaPct}
                  areaHa={areaHa}
                  onPctChange={setAreaPct}
                  onHaChange={setAreaHa}
                />
              ) : null}
            </>
          ) : null}
          {pureQuantity ? <>
            <label>Unidade da quantidade<select value={materialUnit} onChange={(e) => setMaterialUnit(quantityUnit(e.target.value))}>{QUANTITY_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></label>
            <label className="span-2 check-label"><span className="check-row"><input type="checkbox" checked={useQuantityApplications} onChange={(e) => setUseQuantityApplications(e.target.checked)} />Definir quantidade de aplicações</span></label>
          </> : null}
          <AutoCalcMonthsFields
            scope={monthScope}
            months={autoMonths}
            onScope={setMonthScope}
            onMonths={setAutoMonths}
          />
        </div>
        {hoursFromTons && !hourCost && unitPrice > 0 && hourStep > 0 && quantity > 0 ? (
          <div className="formula-box" style={{ margin: "0 0 8px" }}>
            ({hoursFromTonsLabel} ÷ {hourInterval}) × {qty} × {price}
          </div>
        ) : hoursFromTons && unitPrice > 0 ? (
          <div className="formula-box" style={{ margin: "0 0 8px" }}>
            {hoursFromTonsLabel} × {price} R$/h
          </div>
        ) : calcMode === "trips" ? (
          <TripsCalcPreview
            tons={qty}
            trips={trips}
            machines={machineQty}
            price={price}
            days={premiseDays}
            premiseName={premiseName}
          />
        ) : !hourCost && calcMode === "direct" ? (
          <DirectCostPreview
            parent={parent}
            price={price}
            months={premiseMonths}
            total={premiseTotal}
            unit={premise ? premiseUnit(premise) : "ha"}
            premiseName={premiseName}
          />
        ) : calcMode === "days" && totalValue > 0 ? (
          <div className="formula-box" style={{ margin: "0 0 8px" }}>
            {qty} h/dia × {price} R$/h × dias do mês ({exceptLabel(excludeWeekdays)})
            {monthScope === "selected" ? ` · ${autoMonths.length} mês(es)` : ""}
          </div>
        ) : usesArea && areaMode === "ha" ? (
          <InformedAreaPreview
            parent={parent}
            areaHa={areaHa}
            price={price}
            qty={qty}
            applications={showHourUi || showLiterUi || showDaysUi ? "1" : applications}
            months={premiseMonths}
            total={premiseTotal}
            unit={premise ? premiseUnit(premise) : "ha"}
            premiseName={premiseName}
          />
        ) : totalValue > 0 ? (
          <div className="formula-box" style={{ margin: "0 0 8px" }}>
            {materialAreaFormula(usesArea, areaMode, areaPct, areaHa, price, qty, parentShape, showHourUi || showLiterUi || showDaysUi ? "1" : applications, premiseName)}
          </div>
        ) : null}
        {saveErr ? <p className="lead" style={{ color: "#9b2c2c" }}>{saveErr}</p> : null}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          {canRepartirObc ? (
            <button className="btn" disabled={saving} onClick={() => void performSave(false)}>
              {saving ? "Salvando…" : "Salvar sem repartir"}
            </button>
          ) : null}
          <button
            className="btn primary"
            disabled={saving || (canRepartirObc && equipObcLoading)}
            onClick={() => void performSave(canRepartirObc)}
          >
            {saving
              ? "Salvando…"
              : canRepartirObc
                ? "Salvar e repartir por OBC"
                : "Salvar cálculo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CatalogSearch({
  options,
  selectedKey,
  selectedLabel,
  onPick,
  placeholder = "Digite o código ou o nome",
  compact = false,
  allowEmpty = false,
  emptyLabel = "Nenhum",
  title,
}: {
  options: CatalogOption[];
  selectedKey: string;
  selectedLabel: string;
  onPick: (opt: CatalogOption | null) => void;
  placeholder?: string;
  compact?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  title?: string;
}) {
  const [query, setQuery] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQuery(selectedLabel);
  }, [selectedLabel]);

  const filtered = useMemo(() => {
    const raw = fold(query.trim());
    const searching = raw && fold(selectedLabel) !== raw;
    const pool = searching
      ? options.filter((o) => {
          const hay = fold(`${o.code} ${o.description}`);
          const tokens = raw.split(/\s+/).filter(Boolean);
          const used = tokens.filter((t) => t.length >= 3);
          const keys = used.length ? used : tokens;
          return keys.every((t) => hay.includes(t));
        })
      : options;
    return pool.slice(0, searching ? 120 : 50);
  }, [options, query, selectedLabel]);

  const place = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setBox({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 280) });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
      setQuery(selectedLabel);
    };
    const onScroll = (e: Event) => {
      if (listRef.current && e.target instanceof Node && listRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onScroll);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open, selectedLabel]);

  const choose = (opt: CatalogOption | null) => {
    setOpen(false);
    onPick(opt);
  };

  return (
    <div className={`combo ${compact ? "compact" : ""}`} ref={wrapRef}>
      <input
        ref={inputRef}
        className="combo-input"
        value={query}
        placeholder={placeholder}
        title={title}
        onFocus={() => {
          setOpen(true);
          setHi(0);
          place();
          requestAnimationFrame(() => inputRef.current?.select());
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHi(0);
          place();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHi((n) => Math.min(n + 1, Math.max(filtered.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((n) => Math.max(n - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (filtered[hi]) choose(filtered[hi]);
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery(selectedLabel);
          } else if (e.key === "Backspace" && !query && selectedKey) {
            choose(null);
          }
        }}
      />
      {open && box
        ? createPortal(
            <div
              ref={listRef}
              className="combo-list"
              style={{ top: box.top, left: box.left, width: box.width }}
            >
              {!filtered.length && !allowEmpty ? <div className="combo-empty">Nenhum resultado</div> : null}
              {allowEmpty ? (
                <button
                  type="button"
                  className={`combo-item ${!selectedKey ? "selected" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(null)}
                >
                  <span>{emptyLabel}</span>
                </button>
              ) : null}
              {filtered.map((opt, i) => (
                <button
                  type="button"
                  key={opt.key}
                  className={`combo-item ${i === hi ? "active" : ""} ${opt.key === selectedKey ? "selected" : ""}`}
                  onMouseEnter={() => setHi(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(opt)}
                >
                  <small>{opt.group}</small>
                  {opt.kind === "costObject" ? (
                    <>
                      <span className="combo-code">{opt.code}</span>
                      <span className="combo-desc">{opt.description}</span>
                    </>
                  ) : (
                    <span>
                      {opt.code ? `${opt.code} — ${opt.description}` : opt.description}
                    </span>
                  )}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function ItemSelect({
  line,
  materials,
  costObjects,
  equipments,
  onSaved,
}: {
  line: LineItem;
  materials: Material[];
  costObjects: CostObject[];
  equipments: EquipmentCatalogItem[];
  onSaved: (d: SheetDetail) => void;
}) {
  if (isEquipmentHead(line)) {
    const options = equipmentSearchOptions({ catalog: equipments });
    const code = String(line.product_code ?? "").trim();
    if (code && !options.some((opt) => opt.code === code)) {
      options.unshift({
        key: `eq-${code}`,
        kind: "costObject",
        id: Number(code) || 0,
        code,
        description: line.description.replace(`${code} — `, ""),
        group: "Equipamentos",
      });
    }
    const selected = options.find((opt) => opt.code === code);
    return (
      <CatalogSearch
        options={options}
        selectedKey={code ? `eq-${code}` : ""}
        selectedLabel={selected ? `${selected.code} — ${selected.description}` : line.description}
        placeholder="Digite o código ou o nome do equipamento"
        onPick={async (opt) => {
          if (!opt) return;
          onSaved(
            await api.updateLine(line.id, {
              refKind: "cost_object",
              productCode: opt.code,
              activityId: line.activity_id,
              materialId: line.material_id,
              itemType: line.item_type,
              costObjectId: line.cost_object_id,
              description: `${opt.code} — ${opt.description}`,
            }),
          );
        }}
      />
    );
  }
  if (isHourCostLine(line) && line.product_code) {
    const codes = parseEquipmentCodes(line.product_code);
    const options = equipmentSearchOptions({ catalog: equipments });
    for (const code of codes) {
      if (!options.some((opt) => opt.code === code)) {
        options.unshift({
          key: `eq-${code}`,
          kind: "costObject",
          id: Number(code) || 0,
          code,
          description: codes.length === 1 ? line.description.replace(`${code} — `, "") : line.description,
          group: "Equipamentos",
        });
      }
    }
    const code = codes.length === 1 ? codes[0] : "";
    const selected = options.find((opt) => opt.code === code);
    return (
      <CatalogSearch
        options={options}
        selectedKey={code ? `eq-${code}` : ""}
        selectedLabel={
          codes.length === 1
            ? selected
              ? `${selected.code} — ${selected.description}`
              : line.description
            : line.description
        }
        placeholder="Digite o código ou o nome do equipamento"
        onPick={async (opt) => {
          if (!opt) return;
          onSaved(
            await api.updateLine(line.id, {
              refKind: "cost_object",
              costObjectId: line.cost_object_id,
              materialId: null,
              productCode: opt.code,
              activityId: line.activity_id,
              description: `${opt.code} — ${opt.description}`,
            }),
          );
        }}
      />
    );
  }
  if (isHourCostLine(line)) {
    const objs = costObjectOptions(costObjects);
    const selected = objs.find((o) => o.id === line.cost_object_id);
    return (
      <CatalogSearch
        options={objs}
        selectedKey={selected?.key ?? ""}
        selectedLabel={
          line.product_code
            ? line.description
            : selected
              ? `${selected.code} — ${selected.description}`
              : line.description
        }
        placeholder="Digite o objeto de custo"
        onPick={async (opt) => {
          if (!opt) return;
          onSaved(
            await api.updateLine(line.id, {
              refKind: "cost_object",
              costObjectId: opt.id,
              materialId: null,
              productCode: null,
              activityId: line.activity_id,
              description: opt.description,
            }),
          );
        }}
      />
    );
  }
  const mats = materialOptions(materials);
  if (line.material_id && !mats.some((m) => m.id === line.material_id)) {
    const current = materials.find((m) => m.id === line.material_id);
    if (current) mats.unshift(...materialOptions([current]));
  }
  const selected = mats.find((o) => o.key === `m-${line.material_id}`);

  return (
    <CatalogSearch
      options={mats}
      selectedKey={selected?.key ?? ""}
      selectedLabel={selected ? `${selected.code} — ${selected.description}` : line.description}
      placeholder="Digite o material"
      onPick={async (opt) => {
        if (!opt) return;
        onSaved(
          await api.updateLine(line.id, {
            refKind: "material",
            materialId: opt.id,
            activityId: line.activity_id,
            itemType: opt.tipo ?? line.item_type,
            description: opt.description,
          }),
        );
      }}
    />
  );
}

function AddCategory({
  options,
  onClose,
  onSaved,
}: {
  options: CatalogCategory[];
  onClose: () => void;
  onSaved: (catalogId: number) => void;
}) {
  const [catalogId, setCatalogId] = useState(0);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const selected = options.find((item) => item.id === catalogId);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Incluir categoria</h3>
        <p className="lead" style={{ margin: "0 0 8px" }}>
          Escolha uma categoria do cadastro. Para criar um nome novo, use a aba Categorias.
        </p>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr", padding: "12px 0" }}>
          <label>
            Categoria
            <CatalogSearch
              placeholder="Digite o nome da categoria"
              options={categoryOptions(options)}
              selectedKey={catalogId ? `cat-${catalogId}` : ""}
              selectedLabel={selected?.name ?? ""}
              onPick={(opt) => setCatalogId(opt?.id ?? 0)}
            />
          </label>
        </div>
        {saveErr ? <p className="lead" style={{ color: "#9b2c2c" }}>{saveErr}</p> : null}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            onClick={() => {
              if (!catalogId) {
                setSaveErr("Selecione uma categoria cadastrada.");
                return;
              }
              onSaved(catalogId);
            }}
          >
            Incluir categoria
          </button>
        </div>
      </div>
    </div>
  );
}

function toggleId(list: number[], id: number) {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

function distributionMonthsLabel(months: number[]) {
  return months.map((month) => MONTHS[month]).filter(Boolean).join(", ");
}

function DistributionList({
  items,
  onUndo,
}: {
  items: ValueDistribution[];
  onUndo: (id: number) => Promise<void>;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!items.length) return null;
  return (
    <div className="copy-list" style={{ margin: "8px 0 0" }}>
      {items.map((item) => (
        <div className="copy-list-item" key={item.id}>
          <span>
            {item.activityName} · {formatBRL(item.totalValue)}
            {item.centers.length ? ` · ${item.centers.join(", ")}` : ""}
            {item.months.length ? ` · ${distributionMonthsLabel(item.months)}` : ""}
          </span>
          <button
            className="btn"
            type="button"
            disabled={busy != null}
            onClick={async () => {
              if (!confirm(`Desfazer a distribuição de “${item.activityName}”? Os valores voltam como estavam.`)) return;
              setBusy(item.id);
              setErr(null);
              try {
                await onUndo(item.id);
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Não foi possível desfazer a distribuição.");
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === item.id ? "Desfazendo…" : "Desfazer"}
          </button>
        </div>
      ))}
      {err ? <p className="lead" style={{ color: "#9b2c2c", margin: 0 }}>{err}</p> : null}
    </div>
  );
}

function DistributeValue({
  data,
  sheets,
  activities,
  costObjects,
  catalogCategories,
  initialActivityId,
  initialCategoryId,
  embedded = false,
  lockCategory = false,
  onClose,
  onSaved,
}: {
  data: SheetDetail;
  sheets: SheetInfo[];
  activities: Activity[];
  costObjects: CostObject[];
  catalogCategories: CatalogCategory[];
  initialActivityId: number;
  initialCategoryId: number;
  embedded?: boolean;
  lockCategory?: boolean;
  onClose: () => void;
  onSaved: (d: SheetDetail) => void;
}) {
  const centers = sheets.filter((s) => s.kind === "cost_center" && s.visible);
  const [activityId, setActivityId] = useState(initialActivityId);
  const [categoryName, setCategoryName] = useState(() => {
    const current = data.categories.find((c) => c.id === initialCategoryId) ?? data.categories[0];
    return current?.name ?? "";
  });
  const [catalogCategoryId, setCatalogCategoryId] = useState(() => {
    const current = data.categories.find((c) => c.id === initialCategoryId) ?? data.categories[0];
    return catalogCategories.find((c) => c.name === current?.name)?.id ?? 0;
  });
  const [total, setTotal] = useState("");
  const [sheetIds, setSheetIds] = useState<number[]>([data.id]);
  const [costObjectBySheet, setCostObjectBySheet] = useState<Record<number, number>>({});
  const [months, setMonths] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const extraCats = data.categories
    .filter((c) => !catalogCategories.some((cat) => cat.name.trim().toUpperCase() === c.name.trim().toUpperCase()))
    .map((c) => ({
      key: `sheet-cat-${c.id}`,
      kind: "category" as const,
      id: 0,
      code: "",
      description: c.name,
      group: "Nesta aba",
    }));
  const categoryOpts = [...categoryOptions(catalogCategories), ...extraCats];
  const act = activities.find((a) => a.id === activityId);
  const selectedCenters = centers.filter((sheet) => sheetIds.includes(sheet.id));
  const totalValue = Number(total.replace(",", "."));
  const perCenter = sheetIds.length && totalValue > 0 ? totalValue / sheetIds.length : 0;
  const perMonth = months.length && perCenter > 0 ? perCenter / months.length : 0;

  const form = (
    <>
        {!embedded ? <h3>Distribuir valor da atividade</h3> : null}
        <p className="lead" style={{ margin: "0 0 8px" }}>
          O valor total é dividido pelos centros de custo escolhidos e, em cada um, pelos meses
          selecionados. Exemplo: 62.500 em 5 centros e 4 meses vira 12.500 por centro e 3.125 por mês.
        </p>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr", padding: "12px 0" }}>
          <label>
            Atividade
            <CatalogSearch
              placeholder="Digite o código ou o nome da atividade"
              options={activityOptions(activities)}
              selectedKey={activityId ? `a-${activityId}` : ""}
              selectedLabel={act ? `${act.code} — ${act.description}` : ""}
              onPick={(opt) => setActivityId(opt?.id ?? 0)}
            />
          </label>
          <label>
            Valor total
            <input value={total} onChange={(e) => setTotal(e.target.value)} placeholder="Ex.: 62500" />
          </label>
          {lockCategory ? null : (
            <label>
              Categoria
              <small>A mesma categoria é criada nos outros centros se ainda não existir</small>
              <CatalogSearch
                placeholder="Digite a categoria"
                options={categoryOpts}
                selectedKey={catalogCategoryId ? `cat-${catalogCategoryId}` : categoryName ? `sheet-${categoryName}` : ""}
                selectedLabel={categoryName}
                onPick={(opt) => {
                  setCatalogCategoryId(opt?.id ?? 0);
                  setCategoryName(opt?.description ?? "");
                }}
              />
            </label>
          )}
          <label>
            Centros de custo
            <small>
              {sheetIds.length
                ? `${sheetIds.length} escolhido${sheetIds.length === 1 ? "" : "s"}`
                : "Escolha quem recebe o valor"}
            </small>
            <div className="choice-picks">
              {centers.map((sheet) => (
                <button
                  key={sheet.id}
                  type="button"
                  className={sheetIds.includes(sheet.id) ? "on" : ""}
                  onClick={() => setSheetIds(toggleId(sheetIds, sheet.id))}
                >
                  {sheet.title}
                </button>
              ))}
            </div>
          </label>
          {selectedCenters.length ? (
            <label>
              Objeto de custo de cada centro
              <small>O objeto entra na linha da atividade naquele subprocesso</small>
              <div className="distribute-targets">
                {selectedCenters.map((sheet) => {
                  const costObjectId = costObjectBySheet[sheet.id] ?? 0;
                  const costObj = costObjects.find((item) => item.id === costObjectId);
                  return (
                    <div key={sheet.id} className="distribute-target">
                      <strong>{sheet.title}</strong>
                      <CatalogSearch
                        placeholder="Objeto de custo deste centro"
                        options={costObjectOptions(costObjects)}
                        selectedKey={costObjectId ? `c-${costObjectId}` : ""}
                        selectedLabel={costObj ? `${costObj.code} — ${costObj.description}` : ""}
                        onPick={(opt) =>
                          setCostObjectBySheet((current) => ({ ...current, [sheet.id]: opt?.id ?? 0 }))
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </label>
          ) : null}
          <label>
            Meses
            <small>{months.length ? `${months.length} escolhido${months.length === 1 ? "" : "s"}` : "Escolha os meses da distribuição"}</small>
            <div className="choice-picks">
              {MONTHS.map((label, month) => (
                <button
                  key={label}
                  type="button"
                  className={months.includes(month) ? "on" : ""}
                  onClick={() => setMonths(toggleId(months, month).sort((a, b) => a - b))}
                >
                  {label}
                </button>
              ))}
            </div>
          </label>
        </div>
        {totalValue > 0 && sheetIds.length ? (
          <div className="formula-box" style={{ margin: "0 0 8px" }}>
            {formatBRL(totalValue)} / {sheetIds.length} = {formatBRL(perCenter)} por centro
            {months.length ? ` · ${formatBRL(perMonth)} em cada mês` : ""}
          </div>
        ) : null}
        {saveErr ? <p className="lead" style={{ color: "#9b2c2c" }}>{saveErr}</p> : null}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            disabled={saving}
            onClick={async () => {
              if (!activityId) {
                setSaveErr("Selecione a atividade.");
                return;
              }
              if (!(totalValue > 0)) {
                setSaveErr("Informe o valor total.");
                return;
              }
              if (!categoryName.trim()) {
                setSaveErr("Informe a categoria.");
                return;
              }
              if (!sheetIds.length) {
                setSaveErr("Escolha pelo menos um centro de custo.");
                return;
              }
              if (!months.length) {
                setSaveErr("Escolha pelo menos um mês.");
                return;
              }
              setSaving(true);
              setSaveErr(null);
              try {
                onSaved(
                  await api.distributeActivity(data.id, {
                    activityId,
                    totalValue,
                    months,
                    categoryName: categoryName.trim(),
                    catalogCategoryId: catalogCategoryId || null,
                    targets: sheetIds.map((id) => ({
                      sheetId: id,
                      costObjectId: costObjectBySheet[id] || null,
                    })),
                  }),
                );
              } catch (e) {
                setSaveErr(e instanceof Error ? e.message : "Não foi possível distribuir o valor.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Distribuindo…" : "Distribuir valor"}
          </button>
        </div>
    </>
  );

  if (embedded) return form;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {form}
      </div>
    </div>
  );
}

type CopyTreeNode = {
  id: number;
  parentId: number | null;
  childIds: number[];
  kindLabel: string;
  label: string;
  depth: number;
};

function copyTreeFromCategory(
  cat: SheetDetail["categories"][number],
  activities: Activity[],
): CopyTreeNode[] {
  const nodes: CopyTreeNode[] = [];
  const push = (
    line: LineItem,
    kindLabel: string,
    label: string,
    depth: number,
    parentId: number | null,
  ) => {
    nodes.push({ id: line.id, parentId, childIds: [], kindLabel, label, depth });
    if (parentId != null) {
      const parent = nodes.find((node) => node.id === parentId);
      if (parent && !parent.childIds.includes(line.id)) parent.childIds.push(line.id);
    }
  };
  for (const section of nestCategoryLines(cat.lines)) {
    const centerId = section.center?.id ?? null;
    if (section.center) {
      push(section.center, "Centro de custo", section.center.description || "Centro de custo", 0, null);
    }
    for (const block of section.activities) {
      if (!block.activity) continue;
      const equipmentHead = isEquipmentHead(block.activity);
      const activityLabelText = equipmentHead
        ? block.activity.description
        : activityLabel(activities, block.activity) || block.activity.description;
      push(
        block.activity,
        equipmentHead ? "Equipamento" : "Atividade",
        activityLabelText,
        centerId ? 1 : 0,
        centerId,
      );
      for (const child of block.materials) {
        if (!isEquipmentHead(child)) continue;
        push(child, "Equipamento", child.description || "Equipamento", centerId ? 2 : 1, block.activity.id);
      }
    }
  }
  return nodes;
}

function toggleCopyTreeSelection(nodes: CopyTreeNode[], selected: number[], id: number) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const descendants = (itemId: number): number[] => {
    const node = byId.get(itemId);
    if (!node) return [];
    return node.childIds.flatMap((childId) => [childId, ...descendants(childId)]);
  };
  const ancestors = (itemId: number): number[] => {
    const node = byId.get(itemId);
    if (!node?.parentId) return [];
    return [node.parentId, ...ancestors(node.parentId)];
  };
  if (selected.includes(id)) {
    const remove = new Set([id, ...descendants(id)]);
    return selected.filter((item) => !remove.has(item));
  }
  return [...new Set([...selected, id, ...descendants(id), ...ancestors(id)])];
}

function AddCostCenterGroup({
  data,
  categoryId,
  sheets,
  onClose,
  onSaved,
}: {
  data: SheetDetail;
  categoryId: number;
  sheets: SheetInfo[];
  onClose: () => void;
  onSaved: (d: SheetDetail) => void;
}) {
  const category = data.categories.find((c) => c.id === categoryId);
  const centers = sheets.filter((s) => s.kind === "cost_center" && s.id !== data.id && s.visible);
  const existing = new Set(
    (category?.lines ?? [])
      .filter((line) => line.ref_kind === "cost_center" && line.center_sheet_id)
      .map((line) => line.center_sheet_id as number),
  );
  const available = centers.filter((s) => !existing.has(s.id));
  const [centerSheetId, setCenterSheetId] = useState(available[0]?.id ?? 0);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Incluir centro em {category?.name ?? data.title}</h3>
        <p className="lead" style={{ margin: "0 0 8px" }}>
          Cria um grupo nesta categoria para separar as atividades (ex.: Tratos cana soca, Preparo de solo,
          Plantio). Depois use + no grupo para incluir atividades.
        </p>
        {!available.length ? (
          <p className="lead">Todos os centros de custo já estão nesta categoria.</p>
        ) : (
          <div className="form-grid" style={{ padding: "12px 0" }}>
            <label className="span-2">
              Centro de custo
              <select
                value={centerSheetId || ""}
                onChange={(e) => setCenterSheetId(Number(e.target.value) || 0)}
              >
                {available.map((sheet) => (
                  <option key={sheet.id} value={sheet.id}>
                    {sheet.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {saveErr ? <p className="lead" style={{ color: "#9b2c2c" }}>{saveErr}</p> : null}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            disabled={saving || !centerSheetId || !available.length}
            onClick={async () => {
              if (!centerSheetId) return;
              setSaving(true);
              setSaveErr(null);
              try {
                onSaved(
                  await api.addLine(data.id, {
                    categoryId,
                    refKind: "cost_center",
                    centerSheetId,
                  }),
                );
                onClose();
              } catch (e) {
                setSaveErr(e instanceof Error ? e.message : "Não foi possível incluir o centro.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Salvando…" : "Incluir centro"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CopyFromCategory({
  data,
  targetCategoryId,
  activities,
  onClose,
  onSaved,
}: {
  data: SheetDetail;
  targetCategoryId: number;
  activities: Activity[];
  onClose: () => void;
  onSaved: (d: SheetDetail) => void;
}) {
  const target = data.categories.find((cat) => cat.id === targetCategoryId);
  const sources = data.categories
    .filter((cat) => cat.id !== targetCategoryId)
    .slice()
    .sort((a, b) => {
      const rank = (name: string) => (isMaintenanceCategory(name) ? 0 : isFuelLubricantCategory(name) ? 2 : 1);
      return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, "pt-BR");
    });
  const preferredSource =
    sources.find((cat) => isMaintenanceCategory(cat.name)) ?? sources[0];
  const [sourceId, setSourceId] = useState(preferredSource?.id ?? 0);
  const [selected, setSelected] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const source = sources.find((cat) => cat.id === sourceId) ?? preferredSource;
  const nodes = useMemo(
    () => (source ? copyTreeFromCategory(source, activities) : []),
    [source, activities],
  );

  useEffect(() => {
    setSelected([]);
    setSaveErr(null);
  }, [sourceId]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Copiar para {target?.name ?? "categoria"}</h3>
        <p className="lead" style={{ margin: "0 0 8px" }}>
          Traga atividade, centro de custo e equipamento já informados em outra categoria deste centro.
          Materiais não entram — só a estrutura (ex.: de Despesas com manutenção para Combustíveis e
          lubrificantes).
        </p>
        {!sources.length ? (
          <p className="lead">Não há outra categoria neste centro de custo.</p>
        ) : (
          <>
            <label>
              Categoria de origem
              <select
                value={sourceId || ""}
                onChange={(e) => setSourceId(Number(e.target.value) || 0)}
              >
                {sources.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </label>
            {nodes.length ? (
              <>
                <div className="kind-toggle" style={{ padding: "10px 0 6px" }}>
                  <button type="button" className="btn" onClick={() => setSelected(nodes.map((node) => node.id))}>
                    Selecionar todos
                  </button>
                  <button type="button" className="btn" onClick={() => setSelected([])}>
                    Limpar
                  </button>
                </div>
                <div className="table-wrap" style={{ maxHeight: 360, overflow: "auto" }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: 36 }} />
                        <th>Tipo</th>
                        <th>Item</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nodes.map((node) => (
                        <tr key={node.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selected.includes(node.id)}
                              onChange={() => setSelected((current) => toggleCopyTreeSelection(nodes, current, node.id))}
                              aria-label={`Copiar ${node.label}`}
                            />
                          </td>
                          <td>{node.kindLabel}</td>
                          <td className="left" style={{ paddingLeft: 12 + node.depth * 18 }}>
                            {node.label}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="lead">Essa categoria ainda não tem atividade, centro de custo ou equipamento para copiar.</p>
            )}
          </>
        )}
        {saveErr ? <p className="lead" style={{ color: "#9b2c2c" }}>{saveErr}</p> : null}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            disabled={saving || !sourceId || !selected.length}
            onClick={async () => {
              setSaving(true);
              setSaveErr(null);
              try {
                onSaved(
                  await api.copyCategoryItems(targetCategoryId, {
                    sourceCategoryId: sourceId,
                    lineIds: selected,
                  }),
                );
                onClose();
              } catch (e) {
                setSaveErr(e instanceof Error ? e.message : "Não foi possível copiar os itens.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Copiando…" : "Copiar selecionados"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddActivity({
  data,
  categoryId,
  initialCenterSheetId = null,
  sheets,
  activities,
  empenhos,
  materials = [],
  costObjects,
  equipments,
  catalogCategories,
  drivers,
  calcRules,
  onClose,
  onSaved,
}: {
  data: SheetDetail;
  categoryId: number;
  initialCenterSheetId?: number | null;
  sheets: SheetInfo[];
  activities: Activity[];
  empenhos: Empenho[];
  materials?: Material[];
  costObjects: CostObject[];
  equipments: EquipmentCatalogItem[];
  catalogCategories: CatalogCategory[];
  drivers: CalcDriver[];
  calcRules: CalcRule[];
  onClose: () => void;
  onSaved: (d: SheetDetail) => void;
}) {
  const category = data.categories.find((c) => c.id === categoryId);
  const maintenance = isMaintenanceCategory(category?.name);
  const skipAuto = isFuelLubricantCategory(category?.name);
  const serviceCategory = /servi[cç]os de terceiros/i.test(category?.name ?? "");
  const arrendamentoSheet = isArrendamentoSheet(data.name);
  const centers = sheets.filter((s) => s.kind === "cost_center" && s.id !== data.id);
  const { safra, safraId } = useApp();
  const [kind, setKind] = useState<"activity" | "equipment" | "object">("activity");
  const [mode, setMode] = useState<"line" | "fixed" | "distribute" | "arrendamento" | "group">(
    arrendamentoSheet ? "arrendamento" : serviceCategory ? "distribute" : "line",
  );
  const [centerSheetId, setCenterSheetId] = useState(initialCenterSheetId ?? 0);
  const [centerHeads, setCenterHeads] = useState<{ activityId: number; code: string; description: string }[]>([]);
  const [activityId, setActivityId] = useState(0);
  const [empenhoOverride, setEmpenhoOverride] = useState("");
  const [equipmentCode, setEquipmentCode] = useState("");
  const [linkKind, setLinkKind] = useState<"none" | "activity" | "material">("none");
  const [linkLineId, setLinkLineId] = useState(0);
  const [itemType, setItemType] = useState<"" | "E" | "G">("");
  const [costObjectId, setCostObjectId] = useState(0);
  const [calc, setCalc] = useState<ActivityCalcState>(EMPTY_CALC);
  const [monthValues, setMonthValues] = useState(emptyMonthValues);
  const [fixedValue, setFixedValue] = useState("");
  const [fixedMonthValues, setFixedMonthValues] = useState(emptyMonthValues);
  const [fixedEntryMode, setFixedEntryMode] = useState<"same" | "individual">("individual");
  const [fixedQty, setFixedQty] = useState("1");
  const [fixedMonths, setFixedMonths] = useState<number[]>([]);
  const [arrendamentoCalc, setArrendamentoCalc] = useState<ArrendamentoCalcValue>(() =>
    emptyArrendamentoCalc(safraId),
  );
  const [arrendamentoResult, setArrendamentoResult] = useState<ArrendamentoCalcResult | null>(null);
  const [objectCalcMode, setObjectCalcMode] = useState<"qty" | "trips">("qty");
  const [objectPrice, setObjectPrice] = useState("");
  const [objectQty, setObjectQty] = useState("");
  const [objectTrips, setObjectTrips] = useState("");
  const [objectMachines, setObjectMachines] = useState("");
  const [objectPremise, setObjectPremise] = useState("");
  const [objectAreaPct, setObjectAreaPct] = useState("100");
  const [objectAreaHa, setObjectAreaHa] = useState("");
  const [objectAreaMode, setObjectAreaMode] = useState<"pct" | "ha">("pct");
  const [objectMonthScope, setObjectMonthScope] = useState<"all" | "selected">("all");
  const [objectAutoMonths, setObjectAutoMonths] = useState<number[]>(ALL_MONTHS);
  const [hourData, setHourData] = useState<CostObjectHourCostData | null>(null);
  const [hourLoading, setHourLoading] = useState(false);
  const [hourErr, setHourErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const equipmentMode = kind === "equipment";
  const objectMode = kind === "object";
  const kpis = usePremissaKpis();
  const act = activities.find((a) => a.id === activityId);
  const equipmentOpts = equipmentSearchOptions({ catalog: equipments });
  const pickedEquipment = equipmentOpts.find((opt) => opt.code === equipmentCode);
  const costObj = costObjects.find((item) => item.id === costObjectId);
  const activityLinkOpts = sheetActivityLinkOptions(data, categoryId, activities);
  const materialLinkOpts = sheetMaterialLinkOptions(data, categoryId, materials);
  const linkOpts = linkKind === "material" ? materialLinkOpts : activityLinkOpts;
  const pickedLink = linkOpts.find((opt) => opt.id === linkLineId);
  const autoPremise = equipmentMode
    ? (calc.premise || null)
    : autoAreaPremiseFromRules(calcRules, activityId || null, costObjectId || null);
  const hasAuto = !equipmentMode && !objectMode && activityHasAutoValue(calcRules, activityId || null, costObjectId || null);
  const monthlyValue = fixedMonthlyAmount(fixedValue, fixedQty);
  const selectedCenter = centers.find((s) => s.id === centerSheetId);
  const hoursFromTons = objectMode
    ? hoursRuleFromRules(calcRules, activityId || null, costObjectId || null)
    : null;
  const hoursFromTonsLabel = hoursRuleLabel(hoursFromTons, drivers);
  const objectPremiseName = premiseLabel(objectPremise || autoPremise, drivers);
  const objectPremiseMonths = objectPremise
    ? areaMonthsFor(objectPremise, kpis)
    : autoPremise
      ? areaMonthsFor(autoPremise, kpis)
      : null;
  const objectPremiseDays = objectPremise ? premiseDaysFor(objectPremise, kpis) : autoPremise ? premiseDaysFor(autoPremise, kpis) : null;
  const objectPremiseTotal = objectPremiseMonths?.reduce((sum, value) => sum + (value ?? 0), 0) ?? 0;
  const objectUnitPrice = parseInputNum(objectPrice);
  const objectQuantity = parseInputNum(objectQty);
  const hourItem =
    hourData?.items.find((item) => item.costObjectId === costObjectId) ??
    hourData?.items.find((item) => item.code === (costObj?.code ?? ""));

  const setKindMode = (next: "activity" | "equipment" | "object") => {
    setKind(next);
    setSaveErr(null);
    if (next === "equipment") {
      setMode((current) =>
        current === "distribute" || current === "arrendamento" || current === "group" ? "line" : current,
      );
      setActivityId(0);
      setCostObjectId(0);
      setCalc(emptyEquipmentCalc());
    } else if (next === "object") {
      setMode("group");
      setFixedMonths((current) => (current.length ? current : [...ALL_MONTHS]));
      setFixedQty((current) => (current.trim() ? current : "1"));
      setEquipmentCode("");
      setLinkKind("none");
      setLinkLineId(0);
      setItemType("");
      setCalc(EMPTY_CALC);
      setObjectPremise(autoAreaPremiseFromRules(calcRules, activityId || null, costObjectId || null) || "");
    } else {
      setEquipmentCode("");
      setLinkKind("none");
      setLinkLineId(0);
      setItemType("");
      setCalc(EMPTY_CALC);
      if (arrendamentoSheet) setMode("arrendamento");
      else setMode((current) => (current === "group" ? "line" : current));
    }
  };

  const setLinkMode = (next: "none" | "activity" | "material") => {
    setLinkKind(next);
    setLinkLineId(0);
    setSaveErr(null);
  };

  useEffect(() => {
    if (!centerSheetId) {
      setCenterHeads([]);
      return;
    }
    let cancelled = false;
    void api
      .sheetActivityHeads(centerSheetId)
      .then((rows) => {
        if (!cancelled) setCenterHeads(rows);
      })
      .catch(() => {
        if (!cancelled) setCenterHeads([]);
      });
    return () => {
      cancelled = true;
    };
  }, [centerSheetId]);

  useEffect(() => {
    if (!objectMode) return;
    let cancelled = false;
    setHourLoading(true);
    setHourErr(null);
    api
      .costObjectHourCost()
      .then((next) => {
        if (!cancelled) setHourData(next);
      })
      .catch((e: Error) => {
        if (!cancelled) setHourErr(e.message);
      })
      .finally(() => {
        if (!cancelled) setHourLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [objectMode]);

  useEffect(() => {
    if (!objectMode || !costObjectId || objectPrice) return;
    const next = hourData?.items.find((item) => item.costObjectId === costObjectId);
    const rate = preferredHourRate(next, safra?.id);
    if (rate != null) setObjectPrice(String(rate).replace(".", ","));
  }, [objectMode, costObjectId, hourData, objectPrice, safra?.id]);

  useEffect(() => {
    if (!objectMode || objectPremise) return;
    const next = autoAreaPremiseFromRules(calcRules, activityId || null, costObjectId || null);
    if (next) setObjectPremise(next);
  }, [objectMode, activityId, costObjectId, calcRules, objectPremise]);

  const activityOpts = useMemo(() => {
    const all = activityOptions(activities);
    const inOther = new Set(
      data.categories
        .filter((cat) => cat.id !== categoryId)
        .flatMap((cat) => cat.lines)
        .filter((line) => line.activity_id)
        .map((line) => line.activity_id as number),
    );
    const headIds = new Set(centerHeads.map((head) => head.activityId));
    const preferred: CatalogOption[] = [];
    const fromOther: CatalogOption[] = [];
    const rest: CatalogOption[] = [];
    for (const opt of all) {
      if (centerSheetId && headIds.has(opt.id)) {
        preferred.push({ ...opt, group: selectedCenter?.title ?? "Neste centro" });
      } else if (inOther.has(opt.id)) {
        fromOther.push({ ...opt, group: "Em outras categorias" });
      } else {
        rest.push(opt);
      }
    }
    return [...preferred, ...fromOther, ...rest];
  }, [centerSheetId, centerHeads, activities, selectedCenter?.title, data.categories, categoryId]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal ${objectMode ? "wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <h3>
          {equipmentMode
            ? "Incluir equipamento em"
            : objectMode
              ? "Incluir objeto de custo em"
              : "Incluir atividade em"}{" "}
          {category?.name ?? data.title}
        </h3>
        <div className="kind-toggle" style={{ padding: "0 0 10px" }}>
          <button
            type="button"
            className={`btn ${kind === "activity" ? "primary" : ""}`}
            onClick={() => setKindMode("activity")}
          >
            Atividade
          </button>
          <button
            type="button"
            className={`btn ${equipmentMode ? "primary" : ""}`}
            onClick={() => setKindMode("equipment")}
          >
            Equipamento
          </button>
          <button
            type="button"
            className={`btn ${objectMode ? "primary" : ""}`}
            onClick={() => setKindMode("object")}
          >
            Objeto de custo
          </button>
        </div>
        <div className="kind-toggle" style={{ padding: "0 0 10px" }}>
          {objectMode ? (
            <>
              <button
                type="button"
                className={`btn ${mode === "group" ? "primary" : ""}`}
                onClick={() => setMode("group")}
              >
                Só o objeto
              </button>
              <button
                type="button"
                className={`btn ${mode === "fixed" ? "primary" : ""}`}
                onClick={() => {
                  setMode("fixed");
                  setFixedMonths((current) => (current.length ? current : [...ALL_MONTHS]));
                }}
              >
                Quantidade × preço
              </button>
              <button
                type="button"
                className={`btn ${mode === "line" ? "primary" : ""}`}
                onClick={() => setMode("line")}
              >
                Cálculo automático
              </button>
            </>
          ) : (
            <>
          <button
            type="button"
            className={`btn ${mode === "line" ? "primary" : ""}`}
            onClick={() => setMode("line")}
          >
            Só nesta aba
          </button>
          <button
            type="button"
            className={`btn ${mode === "fixed" ? "primary" : ""}`}
            onClick={() => setMode("fixed")}
          >
            Quantidade × preço
          </button>
          {arrendamentoSheet && !equipmentMode ? (
            <button
              type="button"
              className={`btn ${mode === "arrendamento" ? "primary" : ""}`}
              onClick={() => setMode("arrendamento")}
            >
              Arrendamento (ATR)
            </button>
          ) : null}
          {equipmentMode ? null : (
          <button
            type="button"
            className={`btn ${mode === "distribute" ? "primary" : ""}`}
            onClick={() => setMode("distribute")}
          >
            Distribuir valor
          </button>
          )}
            </>
          )}
        </div>
        {mode === "distribute" && !equipmentMode && !objectMode ? (
          <DistributeValue
            data={data}
            sheets={sheets}
            activities={activities}
            costObjects={costObjects}
            catalogCategories={catalogCategories}
            initialActivityId={0}
            initialCategoryId={categoryId}
            embedded
            lockCategory
            onClose={onClose}
            onSaved={(next) => {
              onSaved(next);
              onClose();
            }}
          />
        ) : (
          <>
        <p className="lead" style={{ margin: "0 0 8px" }}>
          {mode === "arrendamento"
            ? "Escolha a atividade e informe kg ATR, preço e a redução do TCH. Área e TCH vêm do cadastro e da visão geral. O total entra rateado nos 12 meses."
            : mode === "group" && objectMode
              ? "Informe só o objeto de custo. Depois use Incluir equipamento para colocar os equipamentos embaixo dele. A atividade é opcional."
            : mode === "fixed"
            ? objectMode
              ? "Informe o objeto de custo e o valor fixo. A quantidade × o valor entra em cada mês escolhido. A atividade é opcional."
              : "A quantidade × o valor fixo entra em cada mês escolhido. Os demais meses ficam zerados."
            : equipmentMode
              ? "Escolha o equipamento e, se quiser, vincule a qualquer atividade do cadastro ou a um material já nesta categoria para marcar o tipo (E ou G) e para onde o custo vai. Sem vínculo, ele entra como linha da categoria."
            : objectMode
              ? objectCalcMode === "trips"
                ? "Informe o código da atividade e do objeto de custo. O valor entra como tonelada × viagens × máquinas × preço × dias da premissa."
                : hoursFromTons
                  ? `Informe o código da atividade e do objeto de custo. O valor entra como custo/hora × ${hoursFromTonsLabel}.`
                  : "Informe atividade, objeto de custo, premissa, quantidade/ha e custo/hora. O valor = quantidade × preço × hectares (ou t) da premissa."
            : maintenance
              ? "O centro de custo é opcional: se informar, a atividade entra no grupo; senão fica solta na categoria. O valor entra só pelos materiais e pelo custo/hora."
              : skipAuto
                ? "O centro de custo é opcional: se informar, a atividade fica sob esse grupo. Nesta categoria o cálculo automático não entra — use meses, valor fixo ou materiais."
                : "O centro de custo é opcional: se informar, a atividade fica agrupada (ex.: Preparo de solo, Plantio). O objeto de custo é desta linha — a mesma atividade pode entrar de novo com outro objeto."}
        </p>
        <div
          className="form-grid"
          style={{
            gridTemplateColumns: objectMode ? undefined : "1fr",
            padding: "12px 0",
          }}
        >
          {centers.length ? (
            <label className={objectMode ? "span-2" : undefined}>
              Centro de custo
              <small>Opcional — separa a atividade sob o nome do centro (ex.: Tratos cana soca, Preparo de solo, Plantio)</small>
              <select
                value={centerSheetId || ""}
                onChange={(e) => {
                  setCenterSheetId(Number(e.target.value) || 0);
                }}
              >
                <option value="">Sem centro de custo</option>
                {centers.map((sheet) => (
                  <option key={sheet.id} value={sheet.id}>
                    {sheet.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {equipmentMode ? (
            <>
            <label>
              Equipamento
              <CatalogSearch
                placeholder="Digite o código ou o nome do equipamento"
                options={equipmentOpts}
                selectedKey={equipmentCode ? `eq-${equipmentCode}` : ""}
                selectedLabel={pickedEquipment ? `${pickedEquipment.code} — ${pickedEquipment.description}` : ""}
                onPick={(opt) => {
                  setEquipmentCode(opt?.code ?? "");
                  setSaveErr(null);
                }}
              />
            </label>
            <div>
              <span>Vincular a</span>
              <small>Opcional — identifica o tipo e para onde o custo vai</small>
              <div className="kind-toggle" style={{ padding: "6px 0 0" }}>
                <button
                  type="button"
                  className={`btn ${linkKind === "none" ? "primary" : ""}`}
                  onClick={() => setLinkMode("none")}
                >
                  Sem vínculo
                </button>
                <button
                  type="button"
                  className={`btn ${linkKind === "activity" ? "primary" : ""}`}
                  onClick={() => setLinkMode("activity")}
                >
                  Atividade
                </button>
                <button
                  type="button"
                  className={`btn ${linkKind === "material" ? "primary" : ""}`}
                  onClick={() => setLinkMode("material")}
                >
                  Material
                </button>
              </div>
            </div>
            {linkKind === "none" ? null : (
              <label>
                {linkKind === "material" ? "Material nesta categoria" : "Atividade"}
                {linkOpts.length ? (
                  <CatalogSearch
                    placeholder={
                      linkKind === "material"
                        ? "Digite o material já incluído nesta categoria"
                        : "Digite o código ou o nome da atividade"
                    }
                    options={linkOpts}
                    selectedKey={
                      linkLineId
                        ? linkKind === "material"
                          ? `line-${linkLineId}`
                          : `a-${linkLineId}`
                        : ""
                    }
                    selectedLabel={
                      pickedLink
                        ? pickedLink.code
                          ? `${pickedLink.code} — ${pickedLink.description}`
                          : pickedLink.description
                        : ""
                    }
                    onPick={(opt) => {
                      setLinkLineId(opt?.id ?? 0);
                      if (opt?.tipo === "E" || opt?.tipo === "G") setItemType(opt.tipo);
                      setSaveErr(null);
                    }}
                  />
                ) : (
                  <small style={{ display: "block", marginTop: 6 }}>
                    {linkKind === "material"
                      ? "Não há material nesta categoria. Inclua o material na atividade antes."
                      : "Não há atividades no cadastro."}
                  </small>
                )}
              </label>
            )}
            <label>
              Tipo
              <small>E ou G — para identificar o custo</small>
              <select
                value={itemType}
                onChange={(e) => setItemType(e.target.value === "E" || e.target.value === "G" ? e.target.value : "")}
              >
                <option value="">—</option>
                <option value="E">E</option>
                <option value="G">G</option>
              </select>
            </label>
            <label>
              Objeto de custo
              <small>Opcional</small>
              <CatalogSearch
                placeholder="Opcional — deixe em branco se não quiser objeto"
                options={costObjectOptions(costObjects)}
                selectedKey={costObjectId ? `c-${costObjectId}` : ""}
                selectedLabel={costObj ? `${costObj.code} — ${costObj.description}` : ""}
                allowEmpty
                emptyLabel="Sem objeto de custo"
                onPick={(opt) => setCostObjectId(opt?.id ?? 0)}
              />
            </label>
            </>
          ) : objectMode ? (
            <>
              <label>
                Código da atividade
                <small>{mode === "fixed" || mode === "group" ? "Opcional — pode informar depois" : null}</small>
                <CatalogSearch
                  placeholder={
                    mode === "fixed" || mode === "group"
                      ? "Opcional — deixe em branco para informar depois"
                      : "Digite o código ou o nome da atividade"
                  }
                  options={activityOpts}
                  selectedKey={activityId ? `a-${activityId}` : ""}
                  selectedLabel={act ? `${act.code} — ${act.description}` : ""}
                  allowEmpty={mode === "fixed" || mode === "group"}
                  emptyLabel="Sem atividade"
                  onPick={(opt) => {
                    setActivityId(opt?.id ?? 0);
                    setSaveErr(null);
                  }}
                />
              </label>
              <label>
                Código do objeto de custo
                <CatalogSearch
                  placeholder="Digite o código ou o nome do objeto"
                  options={costObjectOptions(costObjects)}
                  selectedKey={costObjectId ? `c-${costObjectId}` : ""}
                  selectedLabel={costObj ? `${costObj.code} — ${costObj.description}` : ""}
                  onPick={(opt) => {
                    setCostObjectId(opt?.id ?? 0);
                    setObjectPrice("");
                    setSaveErr(null);
                  }}
                />
              </label>
              {mode === "group" ? (
                <p className="lead span-2" style={{ margin: 0 }}>
                  O objeto entra como cabeçalho. Em seguida use <strong>Incluir equipamento</strong> na linha para
                  colocar os equipamentos embaixo.
                </p>
              ) : mode === "fixed" ? (
                <FixedMonthValueFields
                  value={fixedValue}
                  qty={fixedQty}
                  months={fixedMonths}
                  onValue={setFixedValue}
                  onQty={setFixedQty}
                  onMonths={setFixedMonths}
                />
              ) : (
                <>
              <label className="span-2">
                Como calcular
                <small>
                  {objectCalcMode === "trips"
                    ? "Tonelada × viagens × quantidade de máquina × preço × dias da premissa."
                    : hoursFromTons
                      ? `Custo/hora × ${hoursFromTonsLabel}. As horas vêm da premissa, não das horas/ha.`
                      : "Custo/hora × quantidade/ha × hectares (ou toneladas) da premissa escolhida."}
                </small>
                <div className="kind-toggle" style={{ padding: "6px 0 0" }}>
                  <button
                    type="button"
                    className={`btn ${objectCalcMode !== "trips" ? "primary" : ""}`}
                    onClick={() => setObjectCalcMode("qty")}
                  >
                    Custo/hora
                  </button>
                  <button
                    type="button"
                    className={`btn ${objectCalcMode === "trips" ? "primary" : ""}`}
                    onClick={() => setObjectCalcMode("trips")}
                  >
                    Viagens
                  </button>
                </div>
              </label>
              {objectCalcMode !== "trips" ? (
                <label className="span-2">
                  Custo/hora das safras
                  <small>Custo de manutenção (empenho grupo 20) e horas dos equipamentos no período de cada safra.</small>
                  <HourCostRates
                    item={hourItem}
                    safras={hourData?.safras ?? []}
                    loading={hourLoading}
                    error={hourErr}
                    caption="Objeto de custo"
                    onUse={(value) => setObjectPrice(String(value).replace(".", ","))}
                  />
                </label>
              ) : null}
              <MaterialPremiseFields
                drivers={drivers}
                value={objectPremise || autoPremise || ""}
                onChange={setObjectPremise}
                autoPremise={autoPremise}
              />
              {objectCalcMode === "trips" ? (
                <>
                  <label>
                    Tonelada
                    <input value={objectQty} onChange={(e) => setObjectQty(e.target.value)} placeholder="Ex.: 28" />
                  </label>
                  <label>
                    Viagens
                    <input value={objectTrips} onChange={(e) => setObjectTrips(e.target.value)} placeholder="Ex.: 2" />
                  </label>
                  <label>
                    Quantidade de máquina
                    <input value={objectMachines} onChange={(e) => setObjectMachines(e.target.value)} placeholder="Ex.: 1" />
                  </label>
                  <label>
                    Preço
                    <input value={objectPrice} onChange={(e) => setObjectPrice(e.target.value)} placeholder="Ex.: 150" />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Custo/hora
                    <small>Preço unitário (R$/h)</small>
                    <input value={objectPrice} onChange={(e) => setObjectPrice(e.target.value)} placeholder="Ex.: 60" />
                  </label>
                  {hoursFromTons ? null : (
                    <label>
                      Quantidade/ha
                      <small>Multiplica a premissa × preço</small>
                      <input value={objectQty} onChange={(e) => setObjectQty(e.target.value)} placeholder="Ex.: 1,2" />
                    </label>
                  )}
                  {hoursFromTons ? null : (
                    <MaterialAreaFields
                      mode={objectAreaMode}
                      onMode={setObjectAreaMode}
                      areaPct={objectAreaPct}
                      areaHa={objectAreaHa}
                      onPctChange={setObjectAreaPct}
                      onHaChange={setObjectAreaHa}
                    />
                  )}
                </>
              )}
              <AutoCalcMonthsFields
                scope={objectMonthScope}
                months={objectAutoMonths}
                onScope={setObjectMonthScope}
                onMonths={setObjectAutoMonths}
              />
                </>
              )}
            </>
          ) : (
          <>
          <label>
            Atividade
            <CatalogSearch
              placeholder="Digite o código ou o nome da atividade"
              options={activityOpts}
              selectedKey={activityId ? `a-${activityId}` : ""}
              selectedLabel={act ? `${act.code} — ${act.description}` : ""}
              onPick={(opt) => {
                setActivityId(opt?.id ?? 0);
                setEmpenhoOverride("");
                setMonthValues(emptyMonthValues());
              }}
            />
          </label>
          {activityId ? (
            <label>
              Empenho desta linha
              <small>Opcional — permite incluir a atividade novamente vinculada a outro empenho.</small>
              <select value={empenhoOverride || act?.empenho || ""} onChange={(e) => setEmpenhoOverride(e.target.value)}>
                {!act?.empenho ? <option value="">Selecione o empenho</option> : null}
                {act?.empenho ? <option value={act.empenho}>{act.empenho} — padrão da atividade</option> : null}
                {empenhos
                  .filter((empenho) => empenho.code !== act?.empenho)
                  .map((empenho) => (
                    <option key={empenho.id} value={empenho.code}>
                      {empenho.code} — {empenho.description}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
          <label>
            Objeto de custo
            <CatalogSearch
              placeholder="Digite o objeto de custo desta linha"
              options={costObjectOptions(costObjects)}
              selectedKey={costObjectId ? `c-${costObjectId}` : ""}
              selectedLabel={costObj ? `${costObj.code} — ${costObj.description}` : ""}
              onPick={(opt) => setCostObjectId(opt?.id ?? 0)}
            />
          </label>
          </>
          )}
          {mode === "fixed" && !objectMode ? (
            <FixedActivityValueFields
                mode={fixedEntryMode}
                onMode={setFixedEntryMode}
                fixedValue={fixedValue}
                onFixedValue={setFixedValue}
                values={fixedMonthValues}
                qty={fixedQty}
                months={fixedMonths}
                onValues={setFixedMonthValues}
                onQty={setFixedQty}
                onMonths={setFixedMonths}
              />
          ) : null}
        </div>
        {mode === "arrendamento" && !equipmentMode && !objectMode ? (
          <ArrendamentoCalcFields
            value={arrendamentoCalc}
            onChange={setArrendamentoCalc}
            onResult={setArrendamentoResult}
          />
        ) : objectMode && mode !== "fixed" && mode !== "group" && objectCalcMode === "trips" ? (
          <TripsCalcPreview
            tons={objectQty}
            trips={objectTrips}
            machines={objectMachines}
            price={objectPrice}
            days={objectPremiseDays}
            premiseName={objectPremiseName}
          />
        ) : objectMode && mode !== "fixed" && mode !== "group" && hoursFromTons && objectUnitPrice > 0 ? (
          <div className="formula-box" style={{ margin: "0 0 8px" }}>
            {hoursFromTonsLabel} × {objectPrice} R$/h
          </div>
        ) : objectMode && mode !== "fixed" && mode !== "group" && objectUnitPrice > 0 && objectQuantity > 0 && (objectPremise || autoPremise) ? (
          objectAreaMode === "ha" ? (
          <InformedAreaPreview
            areaHa={objectAreaHa}
            price={objectPrice}
            qty={objectQty}
            months={objectPremiseMonths}
            total={objectPremiseTotal}
            unit={objectPremise || autoPremise ? premiseUnit(objectPremise || autoPremise || "") : "ha"}
            premiseName={objectPremiseName}
          />
          ) : (
          <div className="formula-box" style={{ margin: "0 0 8px" }}>
            {objectQty} × {objectPrice} R$/h × {objectPremiseName || "premissa"}
            {objectAreaPct && Number(objectAreaPct.replace(",", ".")) !== 100
              ? ` × ${objectAreaPct}%`
              : ""}
          </div>
          )
        ) : null}
        {mode === "arrendamento" || mode === "fixed" || objectMode ? null : maintenance ? (
          <>
            <p className="lead" style={{ margin: "0 0 8px" }}>
              Nesta categoria o cálculo automático da atividade não entra. Depois inclua os materiais ou o custo/hora.
              A redução abate o total desses itens.
            </p>
            {!equipmentMode ? (
              <div className="form-grid" style={{ padding: "0 0 8px" }}>
                <label className="span-2">
                  <span className="calc-plan-head" style={{ margin: 0 }}>
                    <span>Redução do valor calculado (%)</span>
                    {calc.reducePct.trim() ? (
                      <button type="button" className="btn" onClick={() => setCalc((prev) => ({ ...prev, reducePct: "" }))}>
                        Retirar
                      </button>
                    ) : null}
                  </span>
                  <small>Ex.: 10 reduz 10% do total da atividade (materiais e equipamentos).</small>
                  <input
                    value={calc.reducePct}
                    onChange={(e) => setCalc((prev) => ({ ...prev, reducePct: e.target.value }))}
                    placeholder="Ex.: 10"
                  />
                </label>
              </div>
            ) : null}
          </>
        ) : skipAuto || (!equipmentMode && activityId && !hasAuto) ? (
          <MonthValuesFields values={monthValues} onChange={setMonthValues} />
        ) : (
          <ActivityCalcForm
            value={calc}
            onChange={setCalc}
            drivers={drivers}
            activityId={activityId || null}
            costObjectId={costObjectId || null}
            calcRules={calcRules}
            allowAuto={!equipmentMode}
            allowFormula
            equipmentMode={equipmentMode}
          />
        )}
        {saveErr ? <p className="lead" style={{ color: "#9b2c2c" }}>{saveErr}</p> : null}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            disabled={saving}
            onClick={async () => {
              if (equipmentMode) {
                if (!equipmentCode) {
                  setSaveErr("Selecione o equipamento.");
                  return;
                }
                if (linkKind !== "none" && !linkLineId) {
                  setSaveErr(
                    linkKind === "material"
                      ? "Selecione o material para onde o equipamento vai."
                      : "Selecione a atividade para onde o equipamento vai.",
                  );
                  return;
                }
              } else if (objectMode) {
                if (mode !== "fixed" && mode !== "group" && !activityId) {
                  setSaveErr("Selecione a atividade.");
                  return;
                }
                if (!costObjectId) {
                  setSaveErr("Selecione o objeto de custo.");
                  return;
                }
                if (mode === "group") {
                  setSaving(true);
                  setSaveErr(null);
                  try {
                    onSaved(
                      await api.addLine(data.id, {
                        categoryId,
                        ...(activityId ? { activityId } : {}),
                        costObjectId,
                        refKind: "cost_object",
                        description: costObj?.description ?? "Objeto de custo",
                        ...(centerSheetId ? { centerSheetId } : {}),
                      }),
                    );
                    onClose();
                  } catch (e) {
                    setSaveErr(e instanceof Error ? e.message : "Não foi possível incluir o objeto de custo.");
                  } finally {
                    setSaving(false);
                  }
                  return;
                }
                if (mode === "fixed") {
                  const unit = parseInputNum(fixedValue);
                  const qty = quantityOrOne(fixedQty);
                  const monthly = fixedMonthlyAmount(fixedValue, fixedQty);
                  if (!(unit > 0)) {
                    setSaveErr("Informe o valor fixo.");
                    return;
                  }
                  if (!(qty > 0)) {
                    setSaveErr("Informe a quantidade.");
                    return;
                  }
                  if (!fixedMonths.length) {
                    setSaveErr("Escolha pelo menos um mês.");
                    return;
                  }
                  if (!(monthly > 0)) {
                    setSaveErr("Informe quantidade e valor fixo.");
                    return;
                  }
                  setSaving(true);
                  setSaveErr(null);
                  try {
                    onSaved(
                      await api.addLine(data.id, {
                        categoryId,
                        ...(activityId ? { activityId } : {}),
                        costObjectId,
                        refKind: "cost_object",
                        description: costObj?.description ?? "Objeto de custo",
                        ...(centerSheetId ? { centerSheetId } : {}),
                        months: fixedMonths.map((month) => ({ month, value: monthly })),
                      }),
                    );
                    onClose();
                  } catch (e) {
                    setSaveErr(e instanceof Error ? e.message : "Não foi possível incluir o objeto de custo.");
                  } finally {
                    setSaving(false);
                  }
                  return;
                }
                const tripsMode = objectCalcMode === "trips";
                const tripCount = parseInputNum(objectTrips);
                const machines = parseInputNum(objectMachines);
                if (tripsMode) {
                  if (!(objectPremise || autoPremise)) {
                    setSaveErr("Selecione a premissa.");
                    return;
                  }
                  if (!(objectQuantity > 0 && tripCount > 0 && machines > 0 && objectUnitPrice > 0)) {
                    setSaveErr("Informe tonelada, viagens, quantidade de máquina e preço.");
                    return;
                  }
                } else if (hoursFromTons) {
                  if (!(objectUnitPrice > 0)) {
                    setSaveErr("Informe o custo por hora.");
                    return;
                  }
                } else {
                  if (!(objectPremise || autoPremise)) {
                    setSaveErr("Selecione a premissa.");
                    return;
                  }
                  if (!(objectUnitPrice > 0 && objectQuantity > 0)) {
                    setSaveErr("Informe o custo por hora e a quantidade por hectare.");
                    return;
                  }
                }
                const area = hoursFromTons || tripsMode
                  ? { calcAreaPct: tripsMode ? null : 100, calcAreaHa: null as number | null }
                  : materialAreaPayload(true, objectAreaMode, objectAreaPct, objectAreaHa);
                if ("error" in area) {
                  setSaveErr(area.error ?? "Informe a área.");
                  return;
                }
                if (objectMonthScope === "selected" && !objectAutoMonths.length) {
                  setSaveErr("Escolha pelo menos um mês do cálculo automático.");
                  return;
                }
                setSaving(true);
                setSaveErr(null);
                try {
                  const months = Array.from({ length: 12 }, (_, month) => ({ month }));
                  const premiseKey = objectPremise || autoPremise || null;
                  onSaved(
                    await api.addLine(data.id, {
                      categoryId,
                      activityId,
                      costObjectId,
                      refKind: "cost_object",
                      description: costObj?.description ?? "Custo/hora",
                      ...(centerSheetId ? { centerSheetId } : {}),
                      ...(tripsMode
                        ? {
                            calcDose: objectQuantity,
                            calcPrice: objectUnitPrice,
                            calcAreaPremise: premiseKey,
                            calcAreaPct: null,
                            calcAreaHa: null,
                            calcMonths: materialCalcMonths(objectMonthScope, objectAutoMonths),
                            calcApplications: 1,
                            calcDirect: false,
                            calcKind: "trips",
                            calcTrips: tripCount,
                            calcMachineQty: machines,
                            months,
                          }
                        : {
                            calcDose: hoursFromTons ? 1 : objectQuantity,
                            calcPrice: objectUnitPrice,
                            calcAreaPremise: hoursFromTons ? null : premiseKey,
                            calcAreaPct: area.calcAreaPct,
                            calcAreaHa: area.calcAreaHa,
                            calcMonths: materialCalcMonths(objectMonthScope, objectAutoMonths),
                            calcApplications: 1,
                            calcDirect: false,
                            calcKind: "qty",
                            calcTrips: null,
                            calcMachineQty: null,
                            months,
                          }),
                    }),
                  );
                  onClose();
                } catch (e) {
                  setSaveErr(e instanceof Error ? e.message : "Não foi possível incluir o objeto de custo.");
                } finally {
                  setSaving(false);
                }
                return;
              } else if (!activityId) {
                setSaveErr("Selecione a atividade.");
                return;
              }
              if (mode === "arrendamento") {
                const monthly = arrendamentoResult?.monthly ?? 0;
                if (!(arrendamentoResult?.ready && monthly > 0)) {
                  setSaveErr("Informe kg ATR e preço do kg de ATR. Área e TCH precisam estar preenchidos.");
                  return;
                }
                setSaving(true);
                setSaveErr(null);
                try {
                  onSaved(
                    await api.addLine(data.id, {
                      categoryId,
                      activityId,
                      costObjectId: costObjectId || null,
                      description: act?.description ?? "Atividade",
                      ...(centerSheetId ? { centerSheetId } : {}),
                      useActivityAuto: false,
                      months: Array.from({ length: 12 }, (_, month) => ({ month, value: monthly })),
                    }),
                  );
                  onClose();
                } catch (e) {
                  setSaveErr(e instanceof Error ? e.message : "Não foi possível incluir a atividade.");
                } finally {
                  setSaving(false);
                }
                return;
              }
              if (mode === "fixed") {
                const months = fixedMonths;
                const qty = quantityOrOne(fixedQty);
                if (!(qty > 0)) {
                  setSaveErr("Informe a quantidade.");
                  return;
                }
                if (!months.length) {
                  setSaveErr("Escolha pelo menos um mês.");
                  return;
                }
                const hasValue = fixedEntryMode === "same"
                  ? parseInputNum(fixedValue) > 0
                  : months.some((month) => parseInputNum(fixedMonthValues[month] ?? "") > 0);
                if (!hasValue) {
                  setSaveErr(
                    fixedEntryMode === "same"
                      ? "Informe o valor fixo."
                      : "Informe um valor para pelo menos um dos meses selecionados.",
                  );
                  return;
                }
              } else if (equipmentMode && !maintenance && !skipAuto) {
                const err = validateActivityPlans(calc.plans, false, autoPremise);
                if (err) {
                  setSaveErr(err);
                  return;
                }
              } else if (!equipmentMode && !maintenance && !skipAuto && hasAuto) {
                const err = validateActivityPlans(calc.plans, calc.useActivityAuto, autoPremise);
                if (err) {
                  setSaveErr(err);
                  return;
                }
              }
              if (!equipmentMode && calc.reducePct.trim()) {
                const reduce = parseInputNum(calc.reducePct);
                if (!(reduce >= 0) || reduce > 100) {
                  setSaveErr("Informe a redução em percentual (0 a 100).");
                  return;
                }
              }
              setSaving(true);
              setSaveErr(null);
              try {
                const reducePct = !equipmentMode && calc.reducePct.trim() ? parseInputNum(calc.reducePct) : null;
                const calcBody =
                  mode === "fixed"
                    ? {
                        useActivityAuto: false,
                        months: fixedMonths
                          .map((month) => ({
                            month,
                            value: fixedMonthlyAmount(
                              fixedEntryMode === "same" ? fixedValue : fixedMonthValues[month] ?? "",
                              fixedQty,
                            ),
                          }))
                          .filter((row) => row.value > 0),
                        calcReducePct: reducePct,
                      }
                    : maintenance
                      ? { useActivityAuto: equipmentMode ? false : true, calcReducePct: reducePct }
                    : skipAuto || (!equipmentMode && !hasAuto)
                      ? {
                          useActivityAuto: false,
                          months: monthValuesPayload(monthValues),
                          calcReducePct: reducePct,
                        }
                      : calcPayload(calc, autoPremise);
                onSaved(
                  await api.addLine(
                    data.id,
                    equipmentMode
                      ? {
                          categoryId,
                          refKind: "cost_object",
                          productCode: equipmentCode,
                          costObjectId: costObjectId || null,
                          itemType: itemType || null,
                          description: pickedEquipment
                            ? `${pickedEquipment.code} — ${pickedEquipment.description}`
                            : equipmentCode,
                          ...(linkKind === "activity" && linkLineId
                            ? { activityId: linkLineId }
                            : linkKind === "material" && linkLineId
                              ? { parentLineId: linkLineId }
                              : centerSheetId
                                ? { centerSheetId }
                                : {}),
                          ...calcBody,
                        }
                      : {
                          categoryId,
                          activityId,
                          empenhoOverride: empenhoOverride || null,
                          costObjectId: costObjectId || null,
                          description: act?.description ?? "Atividade",
                          ...(centerSheetId ? { centerSheetId } : {}),
                          ...calcBody,
                        },
                  ),
                );
                onClose();
              } catch (e) {
                setSaveErr(
                  e instanceof Error
                    ? e.message
                    : equipmentMode
                      ? "Não foi possível incluir o equipamento."
                      : "Não foi possível incluir a atividade.",
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving
              ? "Salvando…"
              : equipmentMode
                ? "Incluir equipamento"
                : objectMode
                  ? "Incluir objeto de custo"
                  : "Incluir atividade"}
          </button>
        </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatUnitPrice(n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 4 }).format(n);
}

function formatHaQty(n: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(n);
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

function formatCalcInput(n: number) {
  return String(round4(n)).replace(".", ",");
}

function parseEquipmentCodes(raw?: string | null): string[] {
  return [...new Set(String(raw ?? "").split(/[,;]+/).map((item) => item.trim()).filter(Boolean))];
}

function formatEquipmentObcList(costObjects: CostObject[], codes: number[]) {
  return codes
    .map((code) => {
      const key = String(code);
      const obj = costObjects.find((item) => objectCodeKey(item.code) === objectCodeKey(key));
      return obj ? `${obj.code} — ${obj.description}` : key;
    })
    .join("; ");
}

function objectCodeKey(code: string | number) {
  const raw = String(code ?? "").trim();
  const n = Number(raw.replace(",", "."));
  if (Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return raw.toUpperCase();
}

function averageNumbers(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function preferredTractorRate(item: ApontamentoEquipmentItem | undefined, safraId?: number | null) {
  if (!item?.rates.length) return null;
  const current = safraId != null ? item.rates.find((row) => row.safraId === safraId) : null;
  if (current && (current.hoursHa > 0 || current.costPerHour != null || current.litrosPorHa > 0 || current.costPerLiter != null)) {
    return current;
  }
  return (
    [...item.rates]
      .reverse()
      .find((row) => row.hoursHa > 0 || row.costPerHour != null || row.litrosPorHa > 0 || row.costPerLiter != null) ??
    item.rates[item.rates.length - 1]
  );
}

function tractorSafraAverageHoursHa(item: ApontamentoEquipmentItem | undefined) {
  return averageNumbers((item?.rates ?? []).map((row) => row.hoursHa).filter((value) => value > 0));
}

function tractorSafraAverageLitrosHa(item: ApontamentoEquipmentItem | undefined) {
  return averageNumbers((item?.rates ?? []).map((row) => row.litrosPorHa).filter((value) => value > 0));
}

function tractorAverageHoursHa(items: ApontamentoEquipmentItem[], codes: string[]) {
  return averageNumbers(
    codes
      .map((code) => tractorSafraAverageHoursHa(items.find((item) => item.code === code)))
      .filter((value): value is number => value != null),
  );
}

function tractorAverageLitrosHa(items: ApontamentoEquipmentItem[], codes: string[]) {
  return averageNumbers(
    codes
      .map((code) => tractorSafraAverageLitrosHa(items.find((item) => item.code === code)))
      .filter((value): value is number => value != null),
  );
}

function tractorAverageCostPerLiter(items: ApontamentoEquipmentItem[], codes: string[], safraId?: number | null) {
  const rates = codes
    .map((code) => preferredTractorRate(items.find((item) => item.code === code), safraId)?.costPerLiter)
    .filter((value): value is number => value != null);
  return averageNumbers(rates);
}

function tractorAverageRate(item: ApontamentoEquipmentItem, safraId?: number | null): ApontamentoEquipmentRate | null {
  const hoursHa = tractorSafraAverageHoursHa(item) ?? 0;
  const litrosPorHa = tractorSafraAverageLitrosHa(item) ?? 0;
  const preferred = preferredTractorRate(item, safraId);
  const costPerHour = preferred?.costPerHour ?? null;
  const costPerLiter = preferred?.costPerLiter ?? null;
  if (!(hoursHa > 0) && costPerHour == null && !(litrosPorHa > 0) && costPerLiter == null) return null;
  return {
    safraId: 0,
    safraLabel: "Média das safras",
    hours: 0,
    area: 0,
    hoursHa,
    apontamentos: 0,
    cost: 0,
    runHours: 0,
    costPerHour,
    litros: 0,
    litrosPorHa,
    fuelCost: 0,
    costPerLiter,
  };
}

function tractorAverageCostPerHour(
  items: ApontamentoEquipmentItem[],
  codes: string[],
  hourItem: CostObjectHourCost | undefined,
  safraId?: number | null,
  equipItems?: EquipmentHourCost[],
) {
  const rates = codes
    .map((code) => preferredTractorRate(items.find((item) => item.code === code), safraId)?.costPerHour)
    .filter((value): value is number => value != null);
  if (rates.length) return averageNumbers(rates);
  const fromEquip = codes
    .map((code) => preferredHourRate(equipItems?.find((item) => item.code === code), safraId))
    .filter((value): value is number => value != null);
  if (fromEquip.length) return averageNumbers(fromEquip);
  return preferredHourRate(hourItem, safraId);
}

function equipmentDividedHourPrice(
  items: ApontamentoEquipmentItem[],
  codes: string[],
  hourItem: CostObjectHourCost | undefined,
  safraId?: number | null,
  equipItems?: EquipmentHourCost[],
) {
  if (!codes.length) return null;
  const average = tractorAverageCostPerHour(items, codes, hourItem, safraId, equipItems);
  if (average == null) return null;
  return codes.length > 1 ? average / codes.length : average;
}

function tractorLineDescription(
  codes: string[],
  apontamento: ApontamentoEquipmentItem[],
  equipItems: EquipmentHourCost[],
  fallback?: string,
  catalog?: EquipmentCatalogItem[],
) {
  if (!codes.length) return fallback ?? "Objeto de custo";
  if (codes.length === 1) {
    const code = codes[0];
    const eq = equipItems.find((item) => item.code === code);
    const ap = apontamento.find((item) => item.code === code);
    const cat = catalog?.find((item) => item.code === code);
    if (eq) return `${eq.code} — ${eq.description}`;
    if (ap) return `${ap.code} — ${ap.description}`;
    if (cat) return `${cat.code} — ${cat.description}`;
    return code;
  }
  return `Média ${codes.join(", ")}`;
}

function apontamentoHourCost(item: ApontamentoEquipmentItem): EquipmentHourCost {
  return {
    code: item.code,
    description: item.description,
    rates: item.rates.map((row) => ({
      safraId: row.safraId,
      safraLabel: row.safraLabel,
      cost: row.cost,
      hours: row.runHours,
      costPerHour: row.costPerHour,
    })),
  };
}

function averagedEquipmentHourCost(
  items: EquipmentHourCost[],
  safras: { id: number; label: string }[],
): EquipmentHourCost | undefined {
  if (!items.length) return undefined;
  if (items.length === 1) return items[0];
  return {
    code: items.map((item) => item.code).join(", "),
    description: `Média de ${items.length} tratores`,
    rates: safras.map((safra) => {
      const rates = items
        .map((item) => item.rates.find((row) => row.safraId === safra.id))
        .filter((row): row is NonNullable<typeof row> => row != null);
      const costPerHours = rates.map((row) => row.costPerHour).filter((value): value is number => value != null);
      return {
        safraId: safra.id,
        safraLabel: safra.label,
        cost: rates.reduce((sum, row) => sum + row.cost, 0),
        hours: rates.reduce((sum, row) => sum + row.hours, 0),
        costPerHour: costPerHours.length ? round4(costPerHours.reduce((sum, value) => sum + value, 0) / costPerHours.length) : null,
      };
    }),
  };
}

function TractorHoursPicker({
  data,
  loading,
  error,
  selected,
  currentSafraId,
  onChange,
  onUseRate,
  metric = "hours",
}: {
  data: ApontamentoEquipmentData | null;
  loading: boolean;
  error: string | null;
  selected: string[];
  currentSafraId?: number | null;
  onChange: (codes: string[]) => void;
  onUseRate?: (code: string, rate: ApontamentoEquipmentRate) => void;
  metric?: "hours" | "liters";
}) {
  const litersMode = metric === "liters";
  const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const [query, setQuery] = useState("");
  const selectedSet = new Set(selected);
  const safras = data?.safras ?? [];
  const filtered = useMemo(() => {
    const tokens = fold(query.trim()).split(/\s+/).filter(Boolean);
    const items = data?.items ?? [];
    if (!tokens.length) return items;
    return items.filter((item) => {
      const hay = fold(`${item.code} ${item.description}`);
      return tokens.every((token) => hay.includes(token));
    });
  }, [data, query]);
  const selectedItems = (data?.items ?? []).filter((item) => selectedSet.has(item.code));
  const avgHoursHa = tractorAverageHoursHa(data?.items ?? [], selected);
  const avgLitrosHa = tractorAverageLitrosHa(data?.items ?? [], selected);
  const operationLabel = (data?.operations ?? [])
    .map((row) => (row.label && row.label !== row.code ? `${row.code} — ${row.label}` : row.code))
    .join(", ");

  if (loading) {
    return (
      <p className="lead" style={{ margin: 0 }}>
        {litersMode
          ? "Consultando combustível e apontamentos da atividade…"
          : "Consultando tratores nos apontamentos da atividade…"}
      </p>
    );
  }
  if (error) {
    return <p className="lead" style={{ color: "#9b2c2c", margin: 0 }}>{error}</p>;
  }
  if (!data?.operations.length) {
    return (
      <p className="lead" style={{ margin: 0 }}>
        Associe esta atividade a um código de operação em Associar realizado para trazer{" "}
        {litersMode ? "os litros/ha" : "as horas/ha"} dos equipamentos.
      </p>
    );
  }
  if (!data.items.length) {
    return (
      <p className="lead" style={{ margin: 0 }}>
        Nenhum equipamento encontrado nos apontamentos das operações {operationLabel || "associadas"}.
      </p>
    );
  }

  const toggle = (code: string) => {
    onChange(selected.includes(code) ? selected.filter((item) => item !== code) : [...selected, code]);
  };

  const emptyRate = (safra: { id: number; label: string }): ApontamentoEquipmentRate => ({
    safraId: safra.id,
    safraLabel: safra.label,
    hours: 0,
    area: 0,
    hoursHa: 0,
    apontamentos: 0,
    cost: 0,
    runHours: 0,
    costPerHour: null,
    litros: 0,
    litrosPorHa: 0,
    fuelCost: 0,
    costPerLiter: null,
  });

  return (
    <div className="tractor-hours">
      <small>
        Operações associadas: {operationLabel}. Equipamentos da atividade, com área,{" "}
        {litersMode ? "litros, L/ha e R$/L" : "horas, horas/ha e custo/hora"} por safra. Marque um ou mais; a
        quantidade usa a média {litersMode ? "dos L/ha" : "das horas/ha"} das safras com dados.
      </small>
      <div className="tractor-hours-toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrar equipamento"
        />
        {selected.length ? (
          <button type="button" className="btn" onClick={() => onChange([])}>
            Limpar
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          onClick={() => {
            const codes = (data?.items ?? [])
              .filter((item) =>
                item.rates.some((row) => (litersMode ? row.litrosPorHa > 0 : row.hoursHa > 0)),
              )
              .map((item) => item.code);
            onChange(codes);
          }}
        >
          Selecionar todos
        </button>
      </div>
      <div className="tractor-hours-table-wrap">
        <table className="hour-cost-table">
          <thead>
            <tr>
              <th></th>
              <th>Equipamento</th>
              <th>Safra</th>
              {litersMode ? (
                <>
                  <th className="num">Litros</th>
                  <th className="num">Área</th>
                  <th className="num">L/ha</th>
                  <th className="num">R$/L</th>
                </>
              ) : (
                <>
                  <th className="num">Horas</th>
                  <th className="num">Área</th>
                  <th className="num">Horas/ha</th>
                  <th className="num">Custo/hora</th>
                </>
              )}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const rates = safras.length
                ? safras.map((safra) => item.rates.find((row) => row.safraId === safra.id) ?? emptyRate(safra))
                : item.rates;
              const averageRate = tractorAverageRate(item, currentSafraId);
              const rowCount = rates.length + (averageRate ? 1 : 0);
              return (
                <Fragment key={item.code}>
                  {rates.map((rate, index) => (
                <tr
                  key={`${item.code}-${rate.safraId}`}
                  className={`${selectedSet.has(item.code) ? "selected" : ""}${rate.safraId === currentSafraId ? " current-safra" : ""}`}
                >
                  {index === 0 ? (
                    <>
                      <td rowSpan={rowCount}>
                        <input
                          type="checkbox"
                          checked={selectedSet.has(item.code)}
                          onChange={() => toggle(item.code)}
                        />
                      </td>
                      <td rowSpan={rowCount}>
                        {item.code} — {item.description}
                      </td>
                    </>
                  ) : null}
                  <td>{rate.safraLabel}</td>
                  {litersMode ? (
                    <>
                      <td className="num">{rate.litros > 0 ? formatHaQty(rate.litros) : "—"}</td>
                      <td className="num">{rate.area > 0 ? formatQty(rate.area) : "—"}</td>
                      <td className="num">{rate.litrosPorHa > 0 ? formatHaQty(rate.litrosPorHa) : "—"}</td>
                      <td className="num">{rate.costPerLiter != null ? `${formatUnitPrice(rate.costPerLiter)}/L` : "—"}</td>
                      <td>
                        {rate.litrosPorHa > 0 || rate.costPerLiter != null ? (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => onUseRate?.(item.code, rate)}
                          >
                            Usar
                          </button>
                        ) : null}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="num">{rate.hours > 0 ? formatHaQty(rate.hours) : "—"}</td>
                      <td className="num">{rate.area > 0 ? formatQty(rate.area) : "—"}</td>
                      <td className="num">{rate.hoursHa > 0 ? formatHaQty(rate.hoursHa) : "—"}</td>
                      <td className="num">{rate.costPerHour != null ? `${formatUnitPrice(rate.costPerHour)}/h` : "—"}</td>
                      <td>
                        {rate.hoursHa > 0 || rate.costPerHour != null ? (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => onUseRate?.(item.code, rate)}
                          >
                            Usar
                          </button>
                        ) : null}
                      </td>
                    </>
                  )}
                </tr>
                  ))}
                  {averageRate ? (
                    <tr
                      className={`safra-avg${selectedSet.has(item.code) ? " selected" : ""}`}
                    >
                      <td>Média das safras</td>
                      <td className="num">—</td>
                      <td className="num">—</td>
                      {litersMode ? (
                        <>
                          <td className="num">{averageRate.litrosPorHa > 0 ? formatHaQty(averageRate.litrosPorHa) : "—"}</td>
                          <td className="num">{averageRate.costPerLiter != null ? `${formatUnitPrice(averageRate.costPerLiter)}/L` : "—"}</td>
                        </>
                      ) : (
                        <>
                          <td className="num">{averageRate.hoursHa > 0 ? formatHaQty(averageRate.hoursHa) : "—"}</td>
                          <td className="num">{averageRate.costPerHour != null ? `${formatUnitPrice(averageRate.costPerHour)}/h` : "—"}</td>
                        </>
                      )}
                      <td>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => onUseRate?.(item.code, averageRate)}
                        >
                          Usar
                        </button>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {selectedItems.length ? (
        <p className="tractor-hours-summary">
          {litersMode
            ? selectedItems.length === 1
              ? `${selectedItems[0].code} · média das safras ${avgLitrosHa != null ? `${formatHaQty(avgLitrosHa)} L/ha` : "sem L/ha"}`
              : `${selectedItems.length} equipamentos · média das safras ${avgLitrosHa != null ? formatHaQty(avgLitrosHa) : "—"} L/ha`
            : selectedItems.length === 1
              ? `${selectedItems[0].code} · média das safras ${avgHoursHa != null ? `${formatHaQty(avgHoursHa)} h/ha` : "sem horas/ha"}`
              : `${selectedItems.length} tratores · média das safras ${avgHoursHa != null ? formatHaQty(avgHoursHa) : "—"} h/ha`}
        </p>
      ) : (
        <p className="lead" style={{ margin: 0 }}>
          {litersMode
            ? "Selecione os equipamentos para preencher os L/ha e o preço R$/L."
            : "Selecione os tratores para preencher as horas/ha e o custo/hora."}
        </p>
      )}
    </div>
  );
}

function preferredHourRate(item: { rates: { safraId: number; costPerHour: number | null }[] } | undefined, currentSafraId?: number | null) {
  if (!item?.rates.length) return null;
  const current = currentSafraId != null ? item.rates.find((row) => row.safraId === currentSafraId) : null;
  if (current?.costPerHour != null) return current.costPerHour;
  return [...item.rates].reverse().find((row) => row.costPerHour != null)?.costPerHour ?? null;
}

function HourCostRates({
  item,
  safras,
  loading,
  error,
  caption = "Objeto de custo",
  empty = "Sem custo/hora nas safras.",
  hint,
  onUse,
}: {
  item?: {
    code: string;
    description: string;
    rates: { safraId: number; safraLabel: string; cost: number; hours: number; costPerHour: number | null }[];
  };
  safras: { id: number; label: string }[];
  loading: boolean;
  error: string | null;
  caption?: string;
  empty?: string;
  hint?: string;
  onUse: (price: number) => void;
}) {
  if (loading) {
    return <p className="lead" style={{ margin: 0 }}>Consultando custo/hora no Oracle…</p>;
  }
  if (error) {
    return <p className="lead" style={{ color: "#9b2c2c", margin: 0 }}>{error}</p>;
  }
  if (!item) {
    return (
      <p className="lead" style={{ margin: 0 }}>
        {empty}
      </p>
    );
  }
  const rows = (safras.length ? safras : item.rates.map((row) => ({ id: row.safraId, label: row.safraLabel }))).map((safra) => ({
    safra,
    rate: item.rates.find((row) => row.safraId === safra.id),
  }));
  return (
    <div className="hour-cost-list">
      {hint ? <p className="lead" style={{ margin: 0 }}>{hint}</p> : null}
      {rows.map(({ safra, rate }) => (
        <div className="hour-cost-card" key={safra.id}>
          <div>
            <strong>{safra.label}</strong>
            <div className="hour-cost-meta">
              {caption}: {item.code} — {item.description}
              {rate && (rate.hours > 0 || rate.cost > 0)
                ? ` · ${formatQty(rate.hours)} h · ${formatBRL(rate.cost)}`
                : ""}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="hour-cost-rate">
              {rate?.costPerHour != null ? `${formatUnitPrice(rate.costPerHour)}/h` : "Sem horas no período"}
            </span>
            {rate?.costPerHour != null ? (
              <button type="button" className="btn" onClick={() => onUse(rate.costPerHour!)}>
                Usar
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function averagedEquipmentFuelCost(
  items: ApontamentoEquipmentItem[],
  codes: string[],
  safras: { id: number; label: string }[],
) {
  const selected = codes
    .map((code) => items.find((item) => item.code === code))
    .filter((item): item is ApontamentoEquipmentItem => item != null);
  if (!selected.length) return undefined;
  if (selected.length === 1) {
    return {
      code: selected[0].code,
      description: selected[0].description,
      rates: selected[0].rates.map((row) => ({
        safraId: row.safraId,
        safraLabel: row.safraLabel,
        litros: row.litros,
        fuelCost: row.fuelCost,
        costPerLiter: row.costPerLiter,
      })),
    };
  }
  return {
    code: selected.map((item) => item.code).join(", "),
    description: `Média de ${selected.length} equipamentos`,
    rates: safras.map((safra) => {
      const rates = selected
        .map((item) => item.rates.find((row) => row.safraId === safra.id))
        .filter((row): row is ApontamentoEquipmentRate => row != null);
      const costPerLiters = rates.map((row) => row.costPerLiter).filter((value): value is number => value != null);
      return {
        safraId: safra.id,
        safraLabel: safra.label,
        litros: rates.reduce((sum, row) => sum + row.litros, 0),
        fuelCost: rates.reduce((sum, row) => sum + row.fuelCost, 0),
        costPerLiter: costPerLiters.length
          ? round4(costPerLiters.reduce((sum, value) => sum + value, 0) / costPerLiters.length)
          : null,
      };
    }),
  };
}

function FuelCostRates({
  item,
  safras,
  loading,
  error,
  caption = "Equipamento",
  empty = "Selecione os equipamentos para ver o R$/L por safra.",
  onUse,
}: {
  item?: {
    code: string;
    description: string;
    rates: { safraId: number; safraLabel: string; litros: number; fuelCost: number; costPerLiter: number | null }[];
  };
  safras: { id: number; label: string }[];
  loading: boolean;
  error: string | null;
  caption?: string;
  empty?: string;
  onUse: (price: number) => void;
}) {
  if (loading) {
    return <p className="lead" style={{ margin: 0 }}>Consultando combustível no Oracle…</p>;
  }
  if (error) {
    return <p className="lead" style={{ color: "#9b2c2c", margin: 0 }}>{error}</p>;
  }
  if (!item) {
    return (
      <p className="lead" style={{ margin: 0 }}>
        {empty}
      </p>
    );
  }
  const rows = (safras.length ? safras : item.rates.map((row) => ({ id: row.safraId, label: row.safraLabel }))).map((safra) => ({
    safra,
    rate: item.rates.find((row) => row.safraId === safra.id),
  }));
  return (
    <div className="hour-cost-list">
      {rows.map(({ safra, rate }) => (
        <div className="hour-cost-card" key={safra.id}>
          <div>
            <strong>{safra.label}</strong>
            <div className="hour-cost-meta">
              {caption}: {item.code} — {item.description}
              {rate && (rate.litros > 0 || rate.fuelCost > 0)
                ? ` · ${formatHaQty(rate.litros)} L · ${formatBRL(rate.fuelCost)}`
                : ""}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="hour-cost-rate">
              {rate?.costPerLiter != null ? `${formatUnitPrice(rate.costPerLiter)}/L` : "Sem litros no período"}
            </span>
            {rate?.costPerLiter != null ? (
              <button type="button" className="btn" onClick={() => onUse(rate.costPerLiter!)}>
                Usar
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function equipmentSearchOptions(opts: {
  apontamento?: ApontamentoEquipmentItem[];
  costObjectItems?: EquipmentHourCost[];
  catalog?: EquipmentCatalogItem[];
}): CatalogOption[] {
  const seen = new Set<string>();
  const out: CatalogOption[] = [];
  const add = (code: string, description: string, group: string) => {
    const key = code.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      key: `eq-${key}`,
      kind: "costObject",
      id: Number(key) || 0,
      code: key,
      description,
      group,
    });
  };
  for (const item of opts.apontamento ?? []) add(item.code, item.description, "Tratores da atividade");
  for (const item of opts.costObjectItems ?? []) add(item.code, item.description, "Do objeto de custo");
  for (const item of opts.catalog ?? []) add(item.code, item.description, "Equipamentos");
  return out;
}

function resolveSelectedEquipment(
  codes: string[],
  apontamento: ApontamentoEquipmentData | null,
  equipData: EquipmentHourCostData | null,
  catalog: EquipmentCatalogItem[],
): EquipmentHourCost[] {
  return codes.map((code) => {
    const ap = apontamento?.items.find((item) => item.code === code);
    if (ap) return apontamentoHourCost(ap);
    const eq = equipData?.items.find((item) => item.code === code);
    if (eq) return eq;
    const cat = catalog.find((item) => item.code === code);
    return { code, description: cat?.description ?? code, rates: [] };
  });
}

function EquipmentSearchField({
  catalog,
  apontamento,
  costObjectItems,
  equipmentCodes,
  required = false,
  onPick,
}: {
  catalog: EquipmentCatalogItem[];
  apontamento?: ApontamentoEquipmentItem[];
  costObjectItems?: EquipmentHourCost[];
  equipmentCodes: string[];
  required?: boolean;
  onPick: (codes: string[]) => void;
}) {
  const options = equipmentSearchOptions({ apontamento, costObjectItems, catalog });
  const code = equipmentCodes.length === 1 ? equipmentCodes[0] : "";
  const selected = options.find((opt) => opt.code === code);
  const selectedLabel =
    equipmentCodes.length === 1
      ? selected
        ? `${selected.code} — ${selected.description}`
        : code
      : equipmentCodes.length > 1
        ? `Média ${equipmentCodes.join(", ")}`
        : "";
  return (
    <label className="span-2">
      Equipamento
      <small>
        {required
          ? "Digite o código ou o nome, como na atividade. Também pode marcar os tratores da atividade abaixo."
          : "Digite o código ou o nome, como na atividade. Opcional se você já marcou os tratores da atividade."}
      </small>
      <CatalogSearch
        placeholder="Digite o código ou o nome do equipamento"
        options={options}
        selectedKey={code ? `eq-${code}` : ""}
        selectedLabel={selectedLabel}
        allowEmpty
        emptyLabel="Nenhum equipamento"
        onPick={(opt) => onPick(opt?.code ? [opt.code] : [])}
      />
    </label>
  );
}

function AddEquipmentUnderCostObject({
  data,
  parent,
  equipments,
  costObjects,
  drivers,
  calcRules,
  onClose,
  onSaved,
}: {
  data: SheetDetail;
  parent: LineItem;
  equipments: EquipmentCatalogItem[];
  costObjects: CostObject[];
  drivers: CalcDriver[];
  calcRules: CalcRule[];
  onClose: () => void;
  onSaved: (d: SheetDetail) => void;
}) {
  const [equipmentCode, setEquipmentCode] = useState("");
  const [itemType, setItemType] = useState<"" | "E" | "G">("");
  const [mode, setMode] = useState<"line" | "fixed">("line");
  const [calc, setCalc] = useState<ActivityCalcState>(() => emptyEquipmentCalc());
  const [fixedValue, setFixedValue] = useState("");
  const [fixedQty, setFixedQty] = useState("1");
  const [fixedMonths, setFixedMonths] = useState<number[]>([...ALL_MONTHS]);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const equipmentOpts = equipmentSearchOptions({ catalog: equipments });
  const pickedEquipment = equipmentOpts.find((opt) => opt.code === equipmentCode);
  const costObjectId = parent.cost_object_id ?? 0;
  const costObj = costObjects.find((item) => item.id === costObjectId);
  const autoPremise = calc.premise || null;
  const monthlyValue = fixedMonthlyAmount(fixedValue, fixedQty);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Incluir equipamento em {parent.description}</h3>
        <p className="lead" style={{ margin: "0 0 8px" }}>
          O equipamento fica embaixo do objeto de custo
          {costObj ? ` ${costObj.code} — ${costObj.description}` : ""}.
        </p>
        <div className="kind-toggle" style={{ padding: "0 0 10px" }}>
          <button
            type="button"
            className={`btn ${mode === "line" ? "primary" : ""}`}
            onClick={() => setMode("line")}
          >
            Cálculo
          </button>
          <button
            type="button"
            className={`btn ${mode === "fixed" ? "primary" : ""}`}
            onClick={() => {
              setMode("fixed");
              setFixedMonths((current) => (current.length ? current : [...ALL_MONTHS]));
            }}
          >
            Quantidade × preço
          </button>
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr", padding: "12px 0" }}>
          <label>
            Equipamento
            <CatalogSearch
              placeholder="Digite o código ou o nome do equipamento"
              options={equipmentOpts}
              selectedKey={equipmentCode ? `eq-${equipmentCode}` : ""}
              selectedLabel={pickedEquipment ? `${pickedEquipment.code} — ${pickedEquipment.description}` : ""}
              onPick={(opt) => {
                setEquipmentCode(opt?.code ?? "");
                setSaveErr(null);
              }}
            />
          </label>
          <label>
            Tipo
            <small>E ou G — opcional</small>
            <select
              value={itemType}
              onChange={(e) => setItemType(e.target.value === "E" || e.target.value === "G" ? e.target.value : "")}
            >
              <option value="">—</option>
              <option value="E">E</option>
              <option value="G">G</option>
            </select>
          </label>
          {mode === "fixed" ? (
            <FixedMonthValueFields
              value={fixedValue}
              qty={fixedQty}
              months={fixedMonths}
              onValue={setFixedValue}
              onQty={setFixedQty}
              onMonths={setFixedMonths}
            />
          ) : (
            <ActivityCalcForm
              value={calc}
              onChange={setCalc}
              drivers={drivers}
              activityId={parent.activity_id}
              costObjectId={costObjectId || null}
              calcRules={calcRules}
              allowAuto={false}
              allowFormula
              equipmentMode
            />
          )}
        </div>
        {saveErr ? <p className="lead" style={{ color: "#9b2c2c" }}>{saveErr}</p> : null}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            disabled={saving}
            onClick={async () => {
              if (!equipmentCode) {
                setSaveErr("Selecione o equipamento.");
                return;
              }
              if (mode === "fixed") {
                const unit = parseInputNum(fixedValue);
                const qty = quantityOrOne(fixedQty);
                const monthly = fixedMonthlyAmount(fixedValue, fixedQty);
                if (!(unit > 0) || !(qty > 0) || !fixedMonths.length || !(monthly > 0)) {
                  setSaveErr("Informe quantidade, valor fixo e pelo menos um mês.");
                  return;
                }
              } else {
                const err = validateActivityPlans(calc.plans, false, autoPremise);
                if (err) {
                  setSaveErr(err);
                  return;
                }
              }
              setSaving(true);
              setSaveErr(null);
              try {
                const calcBody =
                  mode === "fixed"
                    ? {
                        useActivityAuto: false,
                        months: fixedMonths.map((month) => ({ month, value: monthlyValue })),
                      }
                    : calcPayload(calc, autoPremise);
                onSaved(
                  await api.addLine(data.id, {
                    categoryId: parent.category_id,
                    parentLineId: parent.id,
                    refKind: "cost_object",
                    productCode: equipmentCode,
                    costObjectId: costObjectId || null,
                    activityId: parent.activity_id,
                    itemType: itemType || null,
                    description: pickedEquipment
                      ? `${pickedEquipment.code} — ${pickedEquipment.description}`
                      : equipmentCode,
                    ...calcBody,
                  }),
                );
                onClose();
              } catch (e) {
                setSaveErr(e instanceof Error ? e.message : "Não foi possível incluir o equipamento.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Salvando…" : "Incluir equipamento"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddMaterial({
  data,
  parent,
  materials,
  costObjects,
  equipments,
  drivers,
  calcRules,
  onClose,
  onSaved,
}: {
  data: SheetDetail;
  parent: LineItem;
  materials: Material[];
  costObjects: CostObject[];
  equipments: EquipmentCatalogItem[];
  drivers: CalcDriver[];
  calcRules: CalcRule[];
  onClose: () => void;
  onSaved: (d: SheetDetail) => void;
}) {
  const [kind, setKind] = useState<"material" | "object">("material");
  const [materialId, setMaterialId] = useState(0);
  const [costObjectId, setCostObjectId] = useState(0);
  const [itemType, setItemType] = useState<"" | "E" | "G">("");
  const [calcMode, setCalcMode] = useState<"qty" | "direct" | "typed" | "trips" | "hours" | "liters" | "days">(() =>
    isFuelLubricantCategory(data.categories.find((cat) => cat.id === parent.category_id)?.name) ? "liters" : "typed",
  );
  const [premise, setPremise] = useState(
    () => autoAreaPremiseFromRules(calcRules, parent.activity_id, parent.cost_object_id) ?? "",
  );
  const [allMonths, setAllMonths] = useState("");
  const [monthlyValues, setMonthlyValues] = useState<string[]>(emptyMonthValues);
  const [monthlyEntryMode, setMonthlyEntryMode] = useState<"values" | "formula">("values");
  const [formula, setFormula] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const [trips, setTrips] = useState("");
  const [machineQty, setMachineQty] = useState("");
  const [hourInterval, setHourInterval] = useState("");
  const [excludeWeekdays, setExcludeWeekdays] = useState<number[]>([]);
  const [applications, setApplications] = useState("1");
  const [areaPct, setAreaPct] = useState("100");
  const [areaHa, setAreaHa] = useState("");
  const [areaMode, setAreaMode] = useState<"pct" | "ha">("pct");
  const [monthScope, setMonthScope] = useState<"all" | "selected">("all");
  const [autoMonths, setAutoMonths] = useState<number[]>(ALL_MONTHS);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [lastPrice, setLastPrice] = useState<MaterialLastPrice | null>(null);
  const [hourData, setHourData] = useState<CostObjectHourCostData | null>(null);
  const [hourLoading, setHourLoading] = useState(false);
  const [hourErr, setHourErr] = useState<string | null>(null);
  const [equipData, setEquipData] = useState<EquipmentHourCostData | null>(null);
  const [equipLoading, setEquipLoading] = useState(false);
  const [equipErr, setEquipErr] = useState<string | null>(null);
  const [equipmentCodes, setEquipmentCodes] = useState<string[]>([]);
  const [apontamento, setApontamento] = useState<ApontamentoEquipmentData | null>(null);
  const [apontamentoLoading, setApontamentoLoading] = useState(false);
  const [apontamentoErr, setApontamentoErr] = useState<string | null>(null);
  const { safra } = useApp();
  const kpis = usePremissaKpis();
  const objectMode = kind === "object";
  const showHourUi = objectMode ? calcMode !== "trips" : calcMode === "hours";
  const showLiterUi = !objectMode && calcMode === "liters";
  const showDaysUi = !objectMode && calcMode === "days";
  const showEquipUi = showHourUi || showLiterUi || showDaysUi;
  const mat = materials.find((m) => m.id === materialId);
  const obj = costObjects.find((item) => item.id === costObjectId);
  const hourCostObjectId = costObjectId || parent.cost_object_id || 0;
  const hourItem = hourData?.items.find((item) => item.costObjectId === hourCostObjectId)
    ?? hourData?.items.find((item) => item.code === (costObjects.find((o) => o.id === hourCostObjectId)?.code ?? ""));
  const selectedEquipItems = resolveSelectedEquipment(equipmentCodes, apontamento, equipData, equipments);
  const equipment = averagedEquipmentHourCost(selectedEquipItems, apontamento?.safras ?? equipData?.safras ?? hourData?.safras ?? []);
  const equipmentFuel = averagedEquipmentFuelCost(
    apontamento?.items ?? [],
    equipmentCodes,
    apontamento?.safras ?? [],
  );
  const equipmentAvgCostPerHour = equipmentCodes.length
    ? tractorAverageCostPerHour(
        apontamento?.items ?? [],
        equipmentCodes,
        hourItem,
        safra?.id,
        equipData?.items,
      )
    : null;
  const equipHourSplit = showHourUi && equipmentCodes.length > 1;
  const tipoE = !objectMode && itemType === "E";
  const usesAutoQty = objectMode || calcMode !== "typed";
  const unitPrice = Number(price.replace(",", "."));
  const quantity = Number(qty.replace(",", "."));
  const hourStep = Number(hourInterval.replace(",", "."));
  const totalValue = unitPrice > 0 && quantity > 0 ? unitPrice * quantity : 0;
  const parentCalc = calcStateFromLine(parent);
  const parentAutoPremise = autoAreaPremiseFromRules(calcRules, parent.activity_id, parent.cost_object_id);
  const parentShape = calcShapeLabel(parentCalc, drivers, parentAutoPremise);
  const usesParentArea = parentCalc.useActivityAuto || parentCalc.mode === "area";
  const usesArea = Boolean(premise) || usesParentArea;
  const premiseName = premiseLabel(premise, drivers);
  const premiseMonths = premise ? areaMonthsFor(premise, kpis) : parent.premise_ha_months ?? parent.area_ha_months ?? null;
  const premiseDays = premise ? premiseDaysFor(premise, kpis) : null;
  const premiseTotal = premiseMonths?.reduce((sum, value) => sum + (value ?? 0), 0) ?? 0;
  const hoursFromTons = showHourUi
    ? hoursRuleFromRules(calcRules, parent.activity_id, parent.cost_object_id)
    : null;
  const hoursFromTonsLabel = hoursRuleLabel(hoursFromTons, drivers);
  const qtyHint = hoursFromTons
    ? "multiplica depois da divisão pelas horas"
    : showDaysUi
    ? "horas por dia"
    : showLiterUi
    ? "litros por hectare"
    : showHourUi
    ? "horas por hectare"
    : premise
      ? premiseUnit(premise) === "t"
        ? "por tonelada da premissa"
        : "por hectare da premissa"
    : parentCalc.useActivityAuto
      ? "por hectare ou por dia, conforme a atividade"
      : parentCalc.mode === "days"
        ? "por dia"
        : "por hectare";

  useEffect(() => {
    if (!showHourUi && !showDaysUi) return;
    let cancelled = false;
    setHourLoading(true);
    setHourErr(null);
    api
      .costObjectHourCost()
      .then((next) => {
        if (!cancelled) setHourData(next);
      })
      .catch((e: Error) => {
        if (!cancelled) setHourErr(e.message);
      })
      .finally(() => {
        if (!cancelled) setHourLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showHourUi, showDaysUi]);

  useEffect(() => {
    if ((!showHourUi && !showDaysUi) || !hourCostObjectId) {
      setEquipData(null);
      setEquipErr(null);
      return;
    }
    let cancelled = false;
    setEquipLoading(true);
    setEquipErr(null);
    api
      .equipmentHourCost(hourCostObjectId)
      .then((next) => {
        if (!cancelled) setEquipData(next);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setEquipData(null);
          setEquipErr(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) setEquipLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showHourUi, showDaysUi, hourCostObjectId]);

  useEffect(() => {
    if (!showEquipUi || !parent.activity_id) {
      setApontamento(null);
      setApontamentoErr(null);
      return;
    }
    let cancelled = false;
    setApontamentoLoading(true);
    setApontamentoErr(null);
    api
      .activityApontamentoEquipment(parent.activity_id)
      .then((next) => {
        if (cancelled) return;
        setApontamento(next);
        if (showLiterUi) {
          const codes = next.items
            .filter((item) => item.rates.some((row) => row.litrosPorHa > 0))
            .map((item) => item.code);
          if (codes.length) {
            setEquipmentCodes(codes);
            const litersHa = tractorAverageLitrosHa(next.items, codes);
            if (litersHa != null) setQty(formatCalcInput(litersHa));
            const cost = tractorAverageCostPerLiter(next.items, codes, safra?.id);
            if (cost != null) setPrice(formatCalcInput(cost));
          }
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setApontamento(null);
          setApontamentoErr(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) setApontamentoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showEquipUi, showLiterUi, parent.activity_id, safra?.id]);

  useEffect(() => {
    if ((!showHourUi && !showDaysUi) || !costObjectId || price || equipmentCodes.length) return;
    const next = hourData?.items.find((item) => item.costObjectId === costObjectId);
    const rate = preferredHourRate(next, safra?.id);
    if (rate != null) setPrice(String(rate).replace(".", ","));
  }, [showHourUi, showDaysUi, costObjectId, hourData, price, safra?.id, equipmentCodes.length]);

  const applyTractors = (codes: string[]) => {
    setEquipmentCodes(codes);
    if (showLiterUi) {
      const litersHa = tractorAverageLitrosHa(apontamento?.items ?? [], codes);
      if (litersHa != null) setQty(formatCalcInput(litersHa));
      const cost = tractorAverageCostPerLiter(apontamento?.items ?? [], codes, safra?.id);
      if (cost != null) setPrice(formatCalcInput(cost));
      return;
    }
    if (showDaysUi) {
      const cost = equipmentDividedHourPrice(
        apontamento?.items ?? [],
        codes,
        hourItem,
        safra?.id,
        equipData?.items,
      );
      if (cost != null) setPrice(formatCalcInput(cost));
      return;
    }
    if (!hoursFromTons) {
      const hoursHa = tractorAverageHoursHa(apontamento?.items ?? [], codes);
      if (hoursHa != null) setQty(formatCalcInput(hoursHa));
    }
    const cost = equipmentDividedHourPrice(
      apontamento?.items ?? [],
      codes,
      hourItem,
      safra?.id,
      equipData?.items,
    );
    if (cost != null) setPrice(formatCalcInput(cost));
  };

  const applyTractorRate = (code: string, rate: ApontamentoEquipmentRate) => {
    const next = equipmentCodes.includes(code) ? equipmentCodes : [...equipmentCodes, code];
    setEquipmentCodes(next);
    if (showLiterUi) {
      if (rate.litrosPorHa > 0) setQty(formatCalcInput(rate.litrosPorHa));
      if (rate.costPerLiter != null) setPrice(formatCalcInput(rate.costPerLiter));
      return;
    }
    if (showDaysUi) {
      if (rate.costPerHour != null) setPrice(formatCalcInput(rate.costPerHour));
      return;
    }
    if (!hoursFromTons && rate.hoursHa > 0) setQty(formatCalcInput(rate.hoursHa));
    if (rate.costPerHour != null) {
      const share = next.length > 1 ? rate.costPerHour / next.length : rate.costPerHour;
      setPrice(formatCalcInput(share));
    }
  };

  const buildEquipHourLinePayload = (code: string, months: { month: number; value?: number; formula?: string }[]) => {
    const lineArea = hoursFromTons
      ? { calcAreaPct: 100, calcAreaHa: null as number | null }
      : materialAreaPayload(usesArea, areaMode, areaPct, areaHa);
    return {
      categoryId: parent.category_id,
      parentLineId: parent.id,
      activityId: parent.activity_id,
      costObjectId: costObjectId || null,
      refKind: "cost_object" as const,
      productCode: code,
      description: tractorLineDescription(
        [code],
        apontamento?.items ?? [],
        equipData?.items ?? [],
        obj?.description ?? mat?.description ?? "Custo/hora",
        equipments,
      ),
      calcDose: hoursFromTons ? 1 : quantity,
      calcPrice: unitPrice,
      calcAreaPct: usesArea && !("error" in lineArea) ? lineArea.calcAreaPct : null,
      calcAreaHa: usesArea && !("error" in lineArea) ? lineArea.calcAreaHa : null,
      calcMonths: materialCalcMonths(monthScope, autoMonths),
      calcApplications: 1,
      calcDirect: false,
      calcKind: "qty",
      calcTrips: null,
      calcMachineQty: null,
      months,
    };
  };

  const performAdd = async () => {
    const equipHourMode = showHourUi && equipmentCodes.length > 0;
    if (!usesAutoQty) {
      if (monthlyEntryMode === "formula") {
        if (!formula.trim().startsWith("=")) {
          setSaveErr("Informe uma fórmula começando com =.");
          return;
        }
      } else {
        const invalidMonth = monthlyValues.findIndex((raw) => raw.trim() !== "" && !Number.isFinite(parseInputNum(raw)));
        if (invalidMonth !== -1) {
          setSaveErr(`Informe um valor válido para ${MONTH_NAMES[invalidMonth]}.`);
          return;
        }
      }
    }
    if (!objectMode && !materialId && !equipHourMode) {
      setSaveErr("Selecione o material.");
      return;
    }
    const direct = !objectMode && usesAutoQty && calcMode === "direct";
    const tripsMode = calcMode === "trips";
    const tripCount = parseInputNum(trips);
    const machines = parseInputNum(machineQty);
    if (direct && !(unitPrice > 0)) {
      setSaveErr("Informe o preço do custo direto.");
      return;
    }
    if (
      !showHourUi &&
      !showLiterUi &&
      !showDaysUi &&
      !objectMode &&
      usesAutoQty &&
      !premise &&
      !usesParentArea
    ) {
      setSaveErr("Selecione a premissa.");
      return;
    }
    if (objectMode && !tripsMode && !hoursFromTons && !premise) {
      setSaveErr("Selecione a premissa.");
      return;
    }
    if (tripsMode) {
      if (!premise) {
        setSaveErr("Selecione a premissa.");
        return;
      }
      if (!(quantity > 0 && tripCount > 0 && machines > 0 && unitPrice > 0)) {
        setSaveErr("Informe tonelada, viagens, quantidade de máquina e preço.");
        return;
      }
    } else if (showDaysUi) {
      if (!(quantity > 0 && unitPrice > 0)) {
        setSaveErr("Informe as horas por dia e o custo por hora.");
        return;
      }
    } else if (hoursFromTons && !objectMode && !equipHourMode) {
      if (!(hourStep > 0)) {
        setSaveErr("Informe o intervalo de horas.");
        return;
      }
      if (!(quantity > 0)) {
        setSaveErr("Informe a quantidade.");
        return;
      }
      if (!(unitPrice > 0)) {
        setSaveErr("Informe o custo por hora.");
        return;
      }
    } else if (hoursFromTons) {
      if (!(unitPrice > 0)) {
        setSaveErr("Informe o custo por hora.");
        return;
      }
    } else if (usesAutoQty && !direct && !(totalValue > 0)) {
      setSaveErr(
        showLiterUi
          ? "Informe os litros por hectare e o preço por litro."
          : showHourUi
            ? "Informe o custo por hora e a quantidade por hectare."
            : "Informe o preço e a quantidade.",
      );
      return;
    }
    const area = hoursFromTons || direct || tripsMode || showDaysUi
      ? { calcAreaPct: tripsMode || showDaysUi ? null : 100, calcAreaHa: null as number | null }
      : usesAutoQty
        ? materialAreaPayload(usesArea, areaMode, areaPct, areaHa)
        : { calcAreaPct: null, calcAreaHa: null };
    if ("error" in area) {
      setSaveErr(area.error ?? "Informe a área.");
      return;
    }
    if (usesAutoQty && monthScope === "selected" && !autoMonths.length) {
      setSaveErr("Escolha pelo menos um mês do cálculo automático.");
      return;
    }
    const apps = objectMode || showHourUi || showLiterUi || showDaysUi || direct || tripsMode ? 1 : usesAutoQty ? parseApplicationsInput(applications) : 1;
    if (usesAutoQty && !direct && !objectMode && !showHourUi && !showLiterUi && !showDaysUi && !tripsMode && !(apps > 0)) {
      setSaveErr("Informe a quantidade de aplicações.");
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      const months = Array.from({ length: 12 }, (_, month) => {
        if (usesAutoQty) return { month };
        if (monthlyEntryMode === "formula") return { month, formula: formula.trim() };
        if (monthlyValues[month].trim() !== "") return { month, value: parseInputNum(monthlyValues[month]) };
        return { month };
      });
      if (equipHourMode && !tripsMode) {
        let detail: SheetDetail | null = null;
        for (const code of equipmentCodes) {
          detail = await api.addLine(data.id, buildEquipHourLinePayload(code, months));
        }
        if (detail) onSaved(detail);
        onClose();
        return;
      }
      onSaved(
        await api.addLine(
          data.id,
          objectMode
            ? tripsMode
              ? {
                  categoryId: parent.category_id,
                  parentLineId: parent.id,
                  activityId: parent.activity_id,
                  costObjectId: costObjectId || null,
                  refKind: "cost_object",
                  description: obj?.description ?? "Viagens",
                  calcDose: quantity,
                  calcPrice: unitPrice,
                  calcAreaPremise: premise || null,
                  calcAreaPct: null,
                  calcAreaHa: null,
                  calcMonths: materialCalcMonths(monthScope, autoMonths),
                  calcApplications: 1,
                  calcDirect: false,
                  calcKind: "trips",
                  calcTrips: tripCount,
                  calcMachineQty: machines,
                  months,
                }
              : {
                  categoryId: parent.category_id,
                  parentLineId: parent.id,
                  activityId: parent.activity_id,
                  costObjectId: costObjectId || null,
                  refKind: "cost_object",
                  productCode: equipmentCodes.join(",") || null,
                  description: tractorLineDescription(
                    equipmentCodes,
                    apontamento?.items ?? [],
                    equipData?.items ?? [],
                    obj?.description ?? "Custo/hora",
                    equipments,
                  ),
                  calcDose: hoursFromTons ? 1 : quantity,
                  calcPrice: unitPrice,
                  calcAreaPremise: hoursFromTons ? null : premise || null,
                  calcAreaPct: usesArea ? area.calcAreaPct : null,
                  calcAreaHa: usesArea ? area.calcAreaHa : null,
                  calcMonths: materialCalcMonths(monthScope, autoMonths),
                  calcApplications: 1,
                  calcDirect: false,
                  calcKind: "qty",
                  calcTrips: null,
                  calcMachineQty: null,
                  months,
                }
            : {
                categoryId: parent.category_id,
                parentLineId: parent.id,
                activityId: parent.activity_id,
                materialId,
                itemType: itemType || null,
                description: mat?.description ?? "Material",
                calcDose: direct ? 1 : hoursFromTons ? quantity : usesAutoQty ? quantity : null,
                calcPrice: usesAutoQty ? unitPrice : null,
                calcAreaPremise: showHourUi || showLiterUi || showDaysUi ? null : usesAutoQty ? premise || null : null,
                calcAreaPct: tripsMode || showDaysUi ? null : direct || showHourUi || showLiterUi || (usesAutoQty && usesArea) ? area.calcAreaPct : null,
                calcAreaHa: direct || tripsMode || showDaysUi ? null : usesAutoQty && usesArea ? area.calcAreaHa : null,
                calcMonths: usesAutoQty ? materialCalcMonths(monthScope, autoMonths) : null,
                calcApplications: usesAutoQty ? apps : null,
                calcDirect: direct,
                calcKind: tripsMode
                  ? "trips"
                  : calcMode === "hours"
                    ? "hours"
                    : calcMode === "liters"
                      ? "liters"
                      : calcMode === "days"
                        ? "days"
                      : usesAutoQty
                        ? direct
                          ? "direct"
                          : "qty"
                        : null,
                calcTrips: tripsMode ? tripCount : null,
                calcMachineQty: tripsMode ? machines : null,
                calcHourInterval: hoursFromTons ? hourStep : null,
                calcExcludeWeekdays: showDaysUi ? excludeWeekdays : null,
                months,
              },
        ),
      );
      onClose();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : objectMode ? "Não foi possível incluir o objeto de custo." : "Não foi possível incluir o material.");
    } finally {
      setSaving(false);
    }
  };

  const lookupLastPrice = async (id: number) => {
    setLooking(true);
    setSaveErr(null);
    try {
      const found = await api.materialLastPrice(id);
      setLastPrice(found);
      setPrice(String(found.price).replace(".", ","));
    } catch (e) {
      setLastPrice(null);
      setSaveErr(e instanceof Error ? e.message : "Não foi possível calcular a média dos últimos preços.");
    } finally {
      setLooking(false);
    }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal ${objectMode || showHourUi || showLiterUi || showDaysUi ? "wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <h3>
          {objectMode ? "Incluir objeto de custo em" : "Incluir material em"} {parent.description}
        </h3>
        <p className="lead" style={{ margin: "0 0 8px" }}>
          {objectMode || calcMode === "hours"
            ? calcMode === "trips"
              ? "Tonelada × viagens × quantidade de máquina × preço × dias da premissa."
              : hoursFromTons && !objectMode
              ? `Fórmula: (${hoursFromTonsLabel} ÷ intervalo de horas) × quantidade × preço.`
              : hoursFromTons
              ? `O custo entra como custo/hora × ${hoursFromTonsLabel}. As horas vêm da premissa, não das horas/ha.`
              : objectMode
              ? "Custo/hora × quantidade/ha × hectares (ou toneladas) da premissa escolhida."
              : `O custo entra como custo/hora × quantidade/ha × área da atividade (${parentShape}).`
            : calcMode === "days"
              ? `Horas/dia × R$/h × dias do mês (${exceptLabel(excludeWeekdays)}) nos meses escolhidos.`
            : calcMode === "liters"
              ? `O custo entra como L/ha × R$/L × área da atividade (${parentShape}).`
            : "O material pode usar a premissa direto (hectares ou toneladas × quantidade × preço), sem depender do valor da atividade."}
        </p>
        <div className="kind-toggle" style={{ padding: "0 0 8px" }}>
            <button type="button" className={`btn ${kind === "material" ? "primary" : ""}`} onClick={() => setKind("material")}>
              Material
            </button>
            <button type="button" className={`btn ${objectMode ? "primary" : ""}`} onClick={() => { setKind("object"); setCalcMode("qty"); }}>
              Objeto de custo
            </button>
          </div>
        <div className="form-grid" style={{ padding: "12px 0" }}>
          {objectMode ? (
            <label className="span-2">
              Objeto de custo
              <small>
                {calcMode === "trips"
                  ? "Opcional. O cálculo usa tonelada, viagens, máquinas e o preço × dias da premissa."
                  : hoursFromTons
                  ? "Opcional. As horas vêm do cálculo automático (tonelada ÷ t/h)."
                  : "Opcional. O cálculo usa o custo/hora e as horas/ha dos tratores da atividade."}
              </small>
              <CatalogSearch
                placeholder="Opcional — deixe em branco se não quiser objeto"
                options={costObjectOptions(costObjects)}
                selectedKey={costObjectId ? `c-${costObjectId}` : ""}
                selectedLabel={obj ? `${obj.code} — ${obj.description}` : ""}
                allowEmpty
                emptyLabel="Sem objeto de custo"
                onPick={(opt) => {
                  setCostObjectId(opt?.id ?? 0);
                  setSaveErr(null);
                }}
              />
            </label>
          ) : (
          <label>
            Material
            <CatalogSearch
              placeholder="Digite o material"
              options={materialOptions(materials)}
              selectedKey={materialId ? `m-${materialId}` : ""}
              selectedLabel={mat ? `${mat.code} — ${mat.description}` : ""}
              onPick={(opt) => {
                setMaterialId(opt?.id ?? 0);
                setLastPrice(null);
                setSaveErr(null);
                if (opt?.tipo) {
                  setItemType(opt.tipo);
                }
                const next = materials.find((m) => m.id === opt?.id);
                if (calcMode !== "hours" && calcMode !== "liters" && calcMode !== "days") {
                  setPrice(next?.valor != null ? String(next.valor).replace(".", ",") : "");
                }
              }}
            />
          </label>
          )}
          {objectMode ? (
            <label className="span-2">
              Como calcular
              <small>
                {calcMode === "trips"
                  ? "Tonelada × viagens × quantidade de máquina × preço × dias da premissa."
                  : hoursFromTons
                    ? `Custo/hora × ${hoursFromTonsLabel}. As horas vêm da premissa, não das horas/ha.`
                    : "Custo/hora × quantidade/ha × hectares (ou toneladas) da premissa escolhida."}
              </small>
              <div className="kind-toggle" style={{ padding: "6px 0 0" }}>
                <button type="button" className={`btn ${calcMode === "trips" ? "primary" : ""}`} onClick={() => setCalcMode("trips")}>
                  Viagens
                </button>
              </div>
            </label>
          ) : null}
          {objectMode ? null : (
          <label>
            Tipo
            <select
              value={itemType}
              onChange={(e) => {
                const next = e.target.value as "" | "E" | "G";
                setItemType(next);
              }}
            >
              <option value="">Selecione</option>
              <option value="E">E</option>
              <option value="G">G</option>
            </select>
          </label>
          )}
          {tipoE && materialId && !showHourUi && !showLiterUi && !showDaysUi ? (
            <label className="span-2">
              Média dos últimos preços
              <small>Consulta as 3 últimas entradas em material.itensentrada e usa a média do preço unitário.</small>
              <div className="last-price-row">
                <button
                  type="button"
                  className="btn"
                  disabled={looking}
                  onClick={() => void lookupLastPrice(materialId)}
                >
                  {looking ? "Calculando…" : "Média dos últimos 3 preços"}
                </button>
                {lastPrice ? (
                  <span className="last-price-found">
                    {formatUnitPrice(lastPrice.price)}
                    {lastPrice.count
                      ? ` · média de ${lastPrice.count} entrada${lastPrice.count === 1 ? "" : "s"}`
                      : ""}
                    {lastPrice.prices?.length
                      ? ` (${lastPrice.prices.map((n) => formatUnitPrice(n)).join(" · ")})`
                      : ""}
                  </span>
                ) : null}
              </div>
            </label>
          ) : null}
          {objectMode ? null : (
              <label className="span-2">
                Como calcular
                <small>
                  {calcMode === "direct"
                    ? "Custo direto: premissa × preço."
                    : calcMode === "typed"
                      ? "Informe o valor de cada mês ou uma fórmula."
                      : calcMode === "trips"
                        ? "Tonelada × viagens × quantidade de máquina × preço × dias da premissa."
                        : calcMode === "hours"
                          ? hoursFromTons
                            ? `(${hoursFromTonsLabel} ÷ intervalo) × quantidade × preço.`
                            : `Custo/hora × quantidade/ha × área da atividade (${parentShape}).`
                        : calcMode === "days"
                          ? `Horas/dia × R$/h × dias do mês (${exceptLabel(excludeWeekdays)}).`
                        : calcMode === "liters"
                          ? `L/ha × R$/L × área da atividade (${parentShape}).`
                        : "Quantidade: premissa × quantidade × preço × aplicações."}
                </small>
                <div className="kind-toggle" style={{ padding: "6px 0 0" }}>
                  <button type="button" className={`btn ${calcMode === "qty" ? "primary" : ""}`} onClick={() => setCalcMode("qty")}>
                    Quantidade
                  </button>
                  <button type="button" className={`btn ${calcMode === "days" ? "primary" : ""}`} onClick={() => setCalcMode("days")}>
                    Horas/dia
                  </button>
                  <button type="button" className={`btn ${calcMode === "liters" ? "primary" : ""}`} onClick={() => setCalcMode("liters")}>
                    L/ha
                  </button>
                  <button type="button" className={`btn ${calcMode === "direct" ? "primary" : ""}`} onClick={() => setCalcMode("direct")}>
                    Custo direto
                  </button>
                  <button type="button" className={`btn ${calcMode === "trips" ? "primary" : ""}`} onClick={() => setCalcMode("trips")}>
                    Viagens
                  </button>
                  <button type="button" className={`btn ${calcMode === "typed" ? "primary" : ""}`} onClick={() => setCalcMode("typed")}>
                    Valor mensal
                  </button>
                </div>
              </label>
              )}
          {showDaysUi ? (
            <>
            <label className="span-2">
              Equipamentos da atividade
              <small>
                Opcional. Selecione para preencher o custo/hora. O valor mensal usa horas/dia × R$/h × dias
                do mês.
              </small>
              <TractorHoursPicker
                data={apontamento}
                loading={apontamentoLoading}
                error={apontamentoErr}
                selected={equipmentCodes}
                currentSafraId={safra?.id}
                onChange={applyTractors}
                onUseRate={applyTractorRate}
              />
            </label>
            <EquipmentSearchField
              catalog={equipments}
              apontamento={apontamento?.items}
              costObjectItems={equipData?.items}
              equipmentCodes={equipmentCodes}
              onPick={(codes) => {
                applyTractors(codes);
                setSaveErr(null);
              }}
            />
            <label className="span-2">
              Custo/hora das safras
              <small>R$ por hora do equipamento. Use o valor da safra atual ou informe abaixo.</small>
              <HourCostRates
                item={equipment ?? hourItem}
                safras={(equipment ? apontamento?.safras : hourData?.safras) ?? []}
                loading={equipmentCodes.length ? apontamentoLoading : hourLoading}
                error={equipmentCodes.length ? apontamentoErr : hourErr}
                caption={equipmentCodes.length > 1 ? "Média dos equipamentos" : equipment ? "Equipamento" : "Objeto de custo"}
                empty="Selecione um equipamento ou informe o custo/hora manualmente."
                onUse={(value) => setPrice(formatCalcInput(value))}
              />
            </label>
            </>
          ) : null}
          {showLiterUi ? (
            <>
            <label className="span-2">
              Equipamentos da atividade
              <small>
                Equipamentos das operações em Associar realizado. Litros, área, L/ha e R$/L por safra
                (mesma base do indicador Combustível). A quantidade usa a média dos L/ha.
              </small>
              <TractorHoursPicker
                data={apontamento}
                loading={apontamentoLoading}
                error={apontamentoErr}
                selected={equipmentCodes}
                currentSafraId={safra?.id}
                metric="liters"
                onChange={applyTractors}
                onUseRate={applyTractorRate}
              />
            </label>
            <EquipmentSearchField
              catalog={equipments}
              apontamento={apontamento?.items}
              costObjectItems={equipData?.items}
              equipmentCodes={equipmentCodes}
              onPick={(codes) => {
                applyTractors(codes);
                setSaveErr(null);
              }}
            />
            <label className="span-2">
              R$/L das safras
              <small>
                {equipmentCodes.length > 1
                  ? "Média do preço por litro dos equipamentos selecionados."
                  : "Custo de combustível ÷ litros no período de cada safra."}
              </small>
              <FuelCostRates
                item={equipmentFuel}
                safras={apontamento?.safras ?? []}
                loading={apontamentoLoading}
                error={apontamentoErr}
                caption={equipmentCodes.length > 1 ? "Média dos equipamentos" : "Equipamento"}
                empty="Selecione os equipamentos para preencher o R$/L."
                onUse={(value) => setPrice(formatCalcInput(value))}
              />
            </label>
            </>
          ) : null}
          {showHourUi ? (
            <>
            <label className="span-2">
              Tratores da atividade
              <small>
                Equipamentos que rodaram nas operações associadas em Associar realizado, sem filtro de
                objeto de custo. Horas, área, horas/ha e custo/hora aparecem por safra.
              </small>
              <TractorHoursPicker
                data={apontamento}
                loading={apontamentoLoading}
                error={apontamentoErr}
                selected={equipmentCodes}
                currentSafraId={safra?.id}
                onChange={applyTractors}
                onUseRate={applyTractorRate}
              />
            </label>
            <EquipmentSearchField
              catalog={equipments}
              apontamento={apontamento?.items}
              costObjectItems={equipData?.items}
              equipmentCodes={equipmentCodes}
              onPick={(codes) => {
                applyTractors(codes);
                setSaveErr(null);
              }}
            />
            <label className="span-2">
              Custo/hora das safras
              <small>
                {equipmentCodes.length
                  ? equipmentCodes.length > 1
                    ? "Média do custo/hora dos tratores. Ao incluir, a média é dividida pelo número de equipamentos — cada linha usa a fração."
                    : "Requisição de material do equipamento ÷ horas no período."
                  : "Custo de manutenção (empenho grupo 20) e horas dos equipamentos no período de cada safra."}
              </small>
              <HourCostRates
                item={equipment ?? hourItem}
                safras={(equipment ? apontamento?.safras : hourData?.safras) ?? []}
                loading={equipmentCodes.length ? apontamentoLoading : hourLoading}
                error={equipmentCodes.length ? apontamentoErr : hourErr}
                caption={equipmentCodes.length > 1 ? "Média dos tratores" : equipment ? "Equipamento" : "Objeto de custo"}
                empty={
                  equipmentCodes.length
                    ? "Consultando o equipamento…"
                    : "Sem objeto de custo o valor sai dos tratores. Você pode escolher um objeto se quiser."
                }
                onUse={(value) =>
                  setPrice(
                    formatCalcInput(equipmentCodes.length > 1 ? value / equipmentCodes.length : value),
                  )
                }
              />
            </label>
            {equipHourSplit && equipmentAvgCostPerHour != null ? (
              <div className="formula-box span-2" style={{ margin: 0 }}>
                Média: {formatUnitPrice(equipmentAvgCostPerHour)}/h ÷ {equipmentCodes.length} equipamentos ={" "}
                {formatUnitPrice(equipmentAvgCostPerHour / equipmentCodes.length)}/h por linha.
                Serão criadas {equipmentCodes.length} linhas (uma por equipamento).
              </div>
            ) : null}
            </>
          ) : null}
          {usesAutoQty ? (
            <>
              {(objectMode && !hoursFromTons) || (!showHourUi && !showLiterUi && !showDaysUi) ? (
                <MaterialPremiseFields
                  drivers={drivers}
                  value={premise}
                  onChange={setPremise}
                  autoPremise={parentAutoPremise}
                />
              ) : null}
              <label>
                {showHourUi || showDaysUi ? "Custo/hora" : showLiterUi ? "Preço/litro" : "Preço"}
                <small>
                  {showHourUi && equipHourSplit
                    ? "Custo/hora por linha (média ÷ quantidade de equipamentos)."
                    : showHourUi || showDaysUi
                    ? "R$ por hora. Cada safra tem o seu custo/hora."
                    : showLiterUi
                    ? "R$ por litro. Cada safra tem o seu R$/L."
                    : `Desta ${safra?.label ?? "safra"}. Cada safra tem o seu preço.`}
                </small>
                <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder={showHourUi || showDaysUi ? "Ex.: 60" : showLiterUi ? "Ex.: 5,80" : "Ex.: 21,51"} />
              </label>
              {calcMode === "trips" ? (
                <>
                  <label>
                    Tonelada
                    <small>Quantidade em toneladas que multiplica o cálculo.</small>
                    <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Ex.: 32" />
                  </label>
                  <label>
                    Viagens
                    <small>Número de viagens.</small>
                    <input value={trips} onChange={(e) => setTrips(e.target.value)} placeholder="Ex.: 4" />
                  </label>
                  <label>
                    Quantidade de máquina
                    <small>Quantidade de máquinas no cálculo.</small>
                    <input value={machineQty} onChange={(e) => setMachineQty(e.target.value)} placeholder="Ex.: 10" />
                  </label>
                </>
              ) : objectMode || calcMode === "qty" || calcMode === "hours" || calcMode === "liters" || calcMode === "days" ? (
                <>
                  {hoursFromTons && !objectMode ? (
                    <label>
                      Intervalo de horas
                      <small>Divide as horas do cálculo automático da atividade.</small>
                      <input
                        value={hourInterval}
                        onChange={(e) => setHourInterval(e.target.value)}
                        placeholder="Ex.: 8"
                      />
                    </label>
                  ) : null}
                  {hoursFromTons && objectMode ? null : (
                  <label>
                    {showDaysUi ? "Horas por dia" : "Quantidade"}
                    <small>{qtyHint}</small>
                    <input
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      placeholder={showDaysUi ? "Ex.: 8" : showLiterUi ? "Ex.: 12,5" : "Ex.: 1"}
                    />
                  </label>
                  )}
                  {showDaysUi ? (
                    <label className="span-2">
                      Retirar dia da semana
                      <small>Marque os dias que o equipamento não roda (ex.: domingo).</small>
                      <WeekdayPicks value={excludeWeekdays} onChange={setExcludeWeekdays} />
                    </label>
                  ) : null}
                  {showHourUi || showLiterUi || showDaysUi ? null : (
                  <label>
                    Quantidade de aplicações
                    <small>Multiplica o cálculo: premissa × quantidade × preço × aplicações</small>
                    <input value={applications} onChange={(e) => setApplications(e.target.value)} placeholder="Ex.: 2" />
                  </label>
                  )}
                  {hoursFromTons || showDaysUi ? null : usesArea ? (
                    <MaterialAreaFields
                      mode={areaMode}
                      onMode={setAreaMode}
                      areaPct={areaPct}
                      areaHa={areaHa}
                      onPctChange={setAreaPct}
                      onHaChange={setAreaHa}
                    />
                  ) : null}
                </>
              ) : null}
              <AutoCalcMonthsFields
                scope={monthScope}
                months={autoMonths}
                onScope={setMonthScope}
                onMonths={setAutoMonths}
              />
            </>
          ) : (
            <>
              <div className="kind-toggle span-2">
                <button type="button" className={`btn ${monthlyEntryMode === "values" ? "primary" : ""}`} onClick={() => setMonthlyEntryMode("values")}>
                  Valores por mês
                </button>
                <button type="button" className={`btn ${monthlyEntryMode === "formula" ? "primary" : ""}`} onClick={() => setMonthlyEntryMode("formula")}>
                  Fórmula
                </button>
              </div>
              {monthlyEntryMode === "values" ? (
                <>
                  <label>
                    Valor para preencher todos os meses
                    <input inputMode="decimal" value={allMonths} onChange={(e) => setAllMonths(e.target.value)} placeholder="Ex.: 1250,50" />
                  </label>
                  <div>
                    <button type="button" className="btn" disabled={!allMonths.trim() || !Number.isFinite(parseInputNum(allMonths))} onClick={() => setMonthlyValues(MONTHS.map(() => allMonths))}>
                      Preencher todos os meses
                    </button>
                  </div>
                  <div className="span-2">
                    <MonthValuesFields
                      values={monthlyValues}
                      onChange={setMonthlyValues}
                      description="Informe o valor do material em cada mês da safra, de setembro a agosto. Meses em branco ficam sem valor."
                    />
                  </div>
                </>
              ) : (
                <label className="span-2">
                  Fórmula para todos os meses
                  <input value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="=PREMISSAS!F26*342" />
                </label>
              )}
            </>
          )}
        </div>
        {hoursFromTons && !objectMode && unitPrice > 0 && hourStep > 0 && quantity > 0 ? (
          <div className="formula-box" style={{ margin: "0 0 8px" }}>
            ({hoursFromTonsLabel} ÷ {hourInterval}) × {qty} × {price}
          </div>
        ) : hoursFromTons && unitPrice > 0 ? (
          <div className="formula-box" style={{ margin: "0 0 8px" }}>
            {hoursFromTonsLabel} × {price} R$/h
          </div>
        ) : usesAutoQty && calcMode === "trips" ? (
          <TripsCalcPreview
            tons={qty}
            trips={trips}
            machines={machineQty}
            price={price}
            days={premiseDays}
            premiseName={premiseName}
          />
        ) : usesAutoQty && !objectMode && calcMode === "direct" ? (
          <DirectCostPreview
            parent={parent}
            price={price}
            months={premiseMonths}
            total={premiseTotal}
            unit={premise ? premiseUnit(premise) : "ha"}
            premiseName={premiseName}
          />
        ) : usesAutoQty && showDaysUi && totalValue > 0 ? (
          <div className="formula-box" style={{ margin: "0 0 8px" }}>
            {qty} h/dia × {price} R$/h × dias do mês ({exceptLabel(excludeWeekdays)})
            {monthScope === "selected" ? ` · ${autoMonths.length} mês(es)` : ""}
          </div>
        ) : usesAutoQty && usesArea && areaMode === "ha" ? (
          <InformedAreaPreview
            parent={parent}
            areaHa={areaHa}
            price={price}
            qty={qty}
            applications={showHourUi || showLiterUi || showDaysUi ? "1" : applications}
            months={premiseMonths}
            total={premiseTotal}
            unit={premise ? premiseUnit(premise) : "ha"}
            premiseName={premiseName}
          />
        ) : usesAutoQty && totalValue > 0 ? (
          <div className="formula-box" style={{ margin: "0 0 8px" }}>
            {materialAreaFormula(usesArea, areaMode, areaPct, areaHa, price, qty, parentShape, showHourUi || showLiterUi || showDaysUi ? "1" : applications, premiseName)}
          </div>
        ) : null}
        {saveErr ? <p className="lead" style={{ color: "#9b2c2c" }}>{saveErr}</p> : null}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            disabled={saving}
            onClick={() => void performAdd()}
          >
            {saving
              ? "Salvando…"
              : equipHourSplit
                ? `Incluir ${equipmentCodes.length} equipamentos`
                : objectMode
                  ? "Incluir objeto de custo"
                  : "Incluir material"}
          </button>
        </div>
      </div>
    </div>
  );
}
