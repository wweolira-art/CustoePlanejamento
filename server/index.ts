import "./uv-threadpool.js";
import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { db, seedCatalogs } from "./db.js";
import { importFromJson } from "./import.js";
  import { applyAutoCalc, applyAutoCalcFull, copyCalcRulesBetween, copyCalcRulesFromPrevious, createCalcRule, deleteCalcRule, isTripsMaterial, listCalcRules, listReportSubprocesses, lookupActivityHoursRule, materialOwnPremiseKey, parseCalcPlans, parseExcludeWeekdays, resolveApplications, resolveLineCalc, resolveReducePct, storeCalcMonths, storeExcludeWeekdays, updateCalcRule } from "./auto-calc.js";
import { parseEquipmentCodes, loadEquipmentVigenteObcMap, costObjectsForEquipmentCode } from "./equipment-obc-split.js";
import { listSeedRadius, listSeedRadiusTrips } from "./seed-radius.js";
import { lastMaterialEntryPrice } from "./material-price.js";
import { costObjectHourCosts, equipmentHourCosts, listEquipments } from "./cost-object-hours.js";
import { activityApontamentoEquipment } from "./apontamento-equipment.js";
import { copyLineSafraPricesBetween, ensureLineSafraPrices, setLineSafraPrice } from "./line-prices.js";
import { importOracleActivities, listOracleActivities } from "./oracle-activities.js";
import { importOracleEmpenhos, listEmpenhos, listOracleEmpenhos } from "./oracle-empenhos.js";
import { importOracleFazendas, listOracleFazendas } from "./oracle-fazendas.js";
import { importOracleMaterials, listMaterialGroups, listOracleMaterials, syncMaterialGroups } from "./oracle-materials.js";
import { relatorioMaterialEntradaSaida } from "./materials-entrada-saida.js";
import {
  createActivityLink,
  deleteActivityLink,
  ensureActivityLinks,
  listActivityLinks,
  listActivitySourceOptions,
} from "./activity-links.js";
import {
  deleteUnRealizadoSource,
  ensureUnRealizadoSources,
  listUnRealizadoOperations,
  listUnRealizadoSources,
  unRealizadoKindOptions,
  upsertUnRealizadoSource,
} from "./un-realizado.js";
import {
  copySeedRadiusTariffsBetween,
  copySeedRadiusTariffsFromPrevious,
  createSeedRadiusTariff,
  deleteSeedRadiusTariff,
  listSeedRadiusTariffs,
  seedDefaultSeedRadiusTariffs,
  updateSeedRadiusTariff,
} from "./seed-radius-tariffs.js";
import { createSafra, currentSafraId, deleteSafra, ensureSafras, previousSafra, safrasState, setCurrentSafra, suggestedSafraCode, updateSafra } from "./safras.js";
import { saveSafraKpis } from "./safra-kpis.js";
import { dashboard, listSheets, listValueDistributions, persistAllValues, persistLineValues, premissasKpis, resumo, setSheetVerified, sheetDetail } from "./calc.js";
import { aggregateResumo } from "../src/lib/reportAggregate.ts";
import { invalidateWorkbook } from "./workbook-from-db.js";
import { orcadoRealizado, orcadoRealizadoGrupoGastoDetalhe } from "./orcado-realizado.js";
import { getOrcamentoExterno } from "./externo-orcamento.js";
import {
  importFuncionarioOrcamento,
  previewFuncionarioOrcamentoImport,
  refreshAllFuncionarioOrcamentoValues,
  listExternSubprocessos,
  applyFuncionarioApiToLine,
  parseFuncionarioApiConfig,
  serializeFuncionarioApiConfig,
} from "./funcionario-orcamento-import.js";
import { applyPremissaDistribution, copyPremissaData, createCustomSubprocess, deleteCustomSubprocess, deletePremissaCopy, restorePremissaSheet, saveCustomSubprocess, savePremissaCopy, saveProductionOwn, setPremissaMonthValue, snapshotPremissaValues, toIsoDay } from "./premissas-dist.js";
import {
  copyHarvestAreasBetween,
  copyHarvestAreasFromPrevious,
  createHarvestArea,
  deleteHarvestArea,
  listHarvestAreas,
  seedHarvestAreas,
  updateHarvestArea,
} from "./harvest-areas.js";
import { lerCustoColheita, salvarCustoColheitaLocal } from "./custo-colheita.js";
import { lerFichaEstagio, mesesDoPeriodo } from "./ficha-estagio.js";
import { extrairParametrosTecnicos, lerParametrosTecnicos, salvarParametrosTecnicos, listarPeriodosParametrosTecnicos } from "./parametros-tecnicos.js";
import { entradaCanaConfig, runEntradaCanaImport, type EntradaCanaFileInput, type EntradaCanaImportOptions } from "./entrada-cana.js";
import { loadEnvFile } from "./oracle.js";
import { registerColheitaRoutes } from "./colheita-routes.js";
import { registerIndicadoresRoutes } from "./indicadores-routes.js";
import { registerCustoRoutes } from "./custo-routes.js";
import { registerSeedTransportReportRoutes } from "./seed-transport-report.js";
import { registerContractControlRoutes } from "./contract-control.js";
import {
  createSessionToken,
  loginWithCredentials,
  readBearerToken,
  verifySessionToken,
} from "./auth.js";
import { registerUsersAdminRoutes } from "./users-admin.js";
import { registerAccessControl } from "./access-control.js";
import { BudgetCloudController, budgetBootState, budgetCloudEnabled, captureBudgetState } from "./budget-cloud.js";
import { budgetStorageStatus } from "./budget-storage-status.js";
import {
  createExternalSiteGroup,
  createExternalSiteItem,
  deleteExternalSiteGroup,
  deleteExternalSiteItem,
  getExternalSiteGroup,
  listExternalSiteGroups,
  listExternalSiteGroupsAdmin,
  parseEmbedNativeKey,
  registerExternalSite,
  getExternalSitesForEmbed,
  EXTERNAL_EMBED_TARGETS,
  seedExternalSites,
  setNativeTabHidden,
  updateExternalSiteGroup,
  updateExternalSiteItem,
} from "./external-sites.js";

importFromJson();
seedCatalogs();
ensureSafras();
seedDefaultSeedRadiusTariffs();
seedHarvestAreas();
ensureActivityLinks();
ensureUnRealizadoSources();
ensureLineSafraPrices();
seedExternalSites();
const premissasSheet = db.prepare("SELECT id FROM sheets WHERE name = 'PREMISSAS'").get() as { id: number } | undefined;
if (premissasSheet) {
  try {
    applyPremissaDistribution(premissasSheet.id);
    invalidateWorkbook();
  } catch {
    /* distribuição será recalculada na primeira edição */
  }
  try {
    applyAutoCalc();
  } catch {
    /* regras de cálculo serão aplicadas na primeira edição */
  }
}

function resolveLineCatalog(opts: {
  costObjectId?: number | null;
  materialId?: number | null;
  activityId?: number | null;
  refKind?: "material" | "activity" | "cost_object" | null;
  itemType?: string | null;
  productCode?: string | null;
}) {
  const costObjectId = opts.costObjectId ? Number(opts.costObjectId) : null;
  const materialId = opts.materialId ? Number(opts.materialId) : null;
  const activityId = opts.activityId ? Number(opts.activityId) : null;
  const refKind =
    opts.refKind === "material" || opts.refKind === "activity" || opts.refKind === "cost_object"
      ? opts.refKind
      : null;
  let item_type = opts.itemType === "E" || opts.itemType === "G" ? opts.itemType : null;

  let object_code: string | null = null;
  let product_code: string | null = null;

  if (costObjectId) {
    const co = db.prepare("SELECT code FROM cost_objects WHERE id = ?").get(costObjectId) as { code: string } | undefined;
    if (co) object_code = co.code;
  }

  if (refKind === "material" && materialId) {
    const m = db.prepare("SELECT code, tipo FROM materials WHERE id = ?").get(materialId) as
      | { code: string; tipo: string }
      | undefined;
    if (m) {
      product_code = m.code;
      if (!item_type) item_type = m.tipo === "G" ? "G" : "E";
    }
  }

  if (refKind === "cost_object") {
    const equipment = String(opts.productCode ?? "").trim();
    product_code = equipment || null;
  }

  return {
    object_code,
    product_code: refKind === "material" || refKind === "cost_object" ? product_code : null,
    item_type,
    cost_object_id: costObjectId,
    material_id: refKind === "material" || refKind === "cost_object" ? materialId : null,
    activity_id: refKind === "activity" || refKind === "cost_object" ? activityId : null,
    ref_kind: refKind,
  };
}

function nextLineSort(categoryId: number) {
  return (
    db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS n FROM lines WHERE category_id = ?").get(categoryId) as { n: number }
  ).n + 1;
}

function parseMaterialArea(body: { calcAreaPct?: number | null; calcAreaHa?: number | null }) {
  const ha = Number(body.calcAreaHa);
  if (ha > 0) {
    return { calcAreaHa: ha, calcAreaPct: null as number | null };
  }
  const pct = Number(body.calcAreaPct);
  return {
    calcAreaHa: null as number | null,
    calcAreaPct: pct > 0 && pct <= 100 ? pct : 100,
  };
}

function parsePositiveFactor(raw: unknown, label: string) {
  const n = Number(raw);
  if (!(n > 0)) throw new Error(`Informe ${label}.`);
  return n;
}

/** Intervalo de horas do material (só modo horas da premissa). Ausente → null. */
function parseHourInterval(raw: unknown, required: boolean) {
  if (raw == null || raw === "") {
    if (required) throw new Error("Informe o intervalo de horas.");
    return null as number | null;
  }
  return parsePositiveFactor(raw, "o intervalo de horas");
}

function parseTripsCalc(body: {
  calcKind?: string | null;
  calcTrips?: number | null;
  calcMachineQty?: number | null;
  calcDose?: number | null;
  calcPrice?: number | null;
  calcAreaPremise?: string | null;
}) {
  const kind = typeof body.calcKind === "string" ? body.calcKind.trim() : "";
  if (kind === "qty" || kind === "direct") {
    return { tripsMode: false as const, calcKind: null as string | null, calcTrips: null as number | null, calcMachineQty: null as number | null };
  }
  if (kind === "hours" || kind === "liters" || kind === "days") {
    return { tripsMode: false as const, calcKind: kind, calcTrips: null as number | null, calcMachineQty: null as number | null };
  }
  const tripsMode = kind === "trips" || isTripsMaterial({
    calc_kind: kind || null,
    calc_trips: body.calcTrips,
    calc_machine_qty: body.calcMachineQty,
  });
  if (!tripsMode) {
    return { tripsMode: false as const, calcKind: null as string | null, calcTrips: null as number | null, calcMachineQty: null as number | null };
  }
  const calcAreaPremise = materialOwnPremiseKey({
    calc_area_premise: typeof body.calcAreaPremise === "string" ? body.calcAreaPremise : null,
  });
  if (!calcAreaPremise) throw new Error("Selecione a premissa para usar os dias do período.");
  return {
    tripsMode: true as const,
    calcKind: "trips",
    calcDose: parsePositiveFactor(body.calcDose, "a tonelada"),
    calcTrips: parsePositiveFactor(body.calcTrips, "as viagens"),
    calcMachineQty: parsePositiveFactor(body.calcMachineQty, "a quantidade de máquina"),
    calcPrice: parsePositiveFactor(body.calcPrice, "o preço"),
    calcAreaPremise,
  };
}

function costObjectFields(costObjectId: number | null) {
  if (!costObjectId) return { cost_object_id: null as number | null, object_code: null as string | null };
  const co = db.prepare("SELECT id, code FROM cost_objects WHERE id = ?").get(costObjectId) as
    | { id: number; code: string }
    | undefined;
  return { cost_object_id: co?.id ?? null, object_code: co?.code ?? null };
}

function syncActivityCostObject(activityLineId: number, costObjectId: number | null) {
  const fields = costObjectFields(costObjectId);
  db.prepare(
    `UPDATE lines
        SET cost_object_id = ?, object_code = ?
      WHERE id = ?
         OR (parent_id = ? AND COALESCE(ref_kind, '') <> 'cost_object')`,
  ).run(fields.cost_object_id, fields.object_code, activityLineId, activityLineId);
}

function ensureCostObjectLine(sheetId: number, categoryId: number, costObjectId: number) {
  const existing = db
    .prepare(
      `SELECT id FROM lines
       WHERE category_id = ? AND cost_object_id = ? AND parent_id IS NULL
         AND material_id IS NULL AND ref_kind = 'activity'`,
    )
    .get(categoryId, costObjectId) as { id: number } | undefined;
  if (existing) return existing.id;
  const obj = db.prepare("SELECT code, description FROM cost_objects WHERE id = ?").get(costObjectId) as
    | { code: string; description: string }
    | undefined;
  if (!obj) return null;
  return Number(
    db.prepare(
      `INSERT INTO lines (
         sheet_id, category_id, object_code, product_code, item_type, description, is_group, sort_order,
         activity_id, material_id, cost_object_id, ref_kind, parent_id
       ) VALUES (?, ?, ?, NULL, NULL, ?, 1, ?, NULL, NULL, ?, 'activity', NULL)`,
    ).run(sheetId, categoryId, obj.code, obj.description, nextLineSort(categoryId), costObjectId).lastInsertRowid,
  );
}

function createActivityLine(
  sheetId: number,
  categoryId: number,
  activityId: number,
  costObjectId?: number | null,
  fill?: Parameters<typeof resolveLineCalc>[0] & { calcReducePct?: number | null },
  parentId: number | null = null,
) {
  const act = db.prepare("SELECT description FROM activities WHERE id = ?").get(activityId) as { description: string } | undefined;
  if (!act) return null;
  const fields = costObjectFields(costObjectId ?? null);
  const calc = resolveLineCalc({
    ...(fill ?? { useActivityAuto: true }),
    activityId,
    costObjectId: costObjectId ?? null,
  });
  const calcReducePct = fill?.calcReducePct !== undefined ? resolveReducePct(fill.calcReducePct) : null;
  return Number(
    db.prepare(
      `INSERT INTO lines (
         sheet_id, category_id, object_code, product_code, item_type, description, is_group, sort_order,
         activity_id, material_id, cost_object_id, ref_kind, parent_id,
         use_activity_auto, start_month, end_month, calc_months, calc_premise, calc_dose, calc_price, calc_exclude_weekdays, calc_area_premise, calc_area_pct, calc_plans, calc_reduce_pct
       ) VALUES (?, ?, ?, NULL, NULL, ?, 1, ?, ?, NULL, ?, 'activity', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sheetId,
      categoryId,
      fields.object_code,
      act.description,
      nextLineSort(categoryId),
      activityId,
      fields.cost_object_id,
      parentId,
      calc.useActivityAuto ? 1 : 0,
      calc.startMonth,
      calc.endMonth,
      calc.calcMonths,
      calc.calcPremise,
      calc.calcDose,
      calc.calcPrice,
      calc.calcExcludeWeekdays,
      calc.calcAreaPremise,
      calc.calcAreaPct,
      calc.calcPlans,
      calcReducePct,
    ).lastInsertRowid,
  );
}

function isEquipmentHeadLine(line: {
  ref_kind?: string | null;
  product_code?: string | null;
  is_group?: number | null;
  item_type?: string | null;
  material_id?: number | null;
  description?: string | null;
  parent_id?: number | null;
}) {
  if (line.ref_kind === "activity" || line.ref_kind === "cost_center") return false;
  const product = String(line.product_code ?? "").trim() || equipmentCodeFromDescription(line.description);
  if (line.ref_kind === "cost_object" && product && Boolean(line.is_group)) return true;
  return Boolean(
    line.is_group &&
      !line.parent_id &&
      !line.material_id &&
      (line.item_type === "E" || line.item_type === "G") &&
      product,
  );
}

function equipmentCodeFromDescription(description?: string | null) {
  const match = String(description ?? "").match(/^\s*(\d+)\s+[—–-]\s+/);
  return match?.[1] ?? "";
}

function createEquipmentLine(
  sheetId: number,
  categoryId: number,
  productCode: string,
  description: string,
  costObjectId?: number | null,
  fill?: Parameters<typeof resolveLineCalc>[0],
  parentId: number | null = null,
  extra?: { activityId?: number | null; materialId?: number | null; itemType?: string | null },
) {
  const code = productCode.trim();
  if (!code) return null;
  const fields = costObjectFields(costObjectId ?? null);
  const itemType = extra?.itemType === "E" || extra?.itemType === "G" ? extra.itemType : null;
  const calc = resolveLineCalc({
    ...(fill ?? {}),
    useActivityAuto: false,
    activityId: extra?.activityId ?? null,
    costObjectId: costObjectId ?? null,
  });
  return Number(
    db.prepare(
      `INSERT INTO lines (
         sheet_id, category_id, object_code, product_code, item_type, description, is_group, sort_order,
         activity_id, material_id, cost_object_id, ref_kind, parent_id,
         use_activity_auto, start_month, end_month, calc_months, calc_premise, calc_dose, calc_price, calc_exclude_weekdays, calc_area_premise, calc_area_pct, calc_plans
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'cost_object', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sheetId,
      categoryId,
      fields.object_code,
      code,
      itemType,
      description.trim() || code,
      nextLineSort(categoryId),
      extra?.activityId ?? null,
      extra?.materialId ?? null,
      fields.cost_object_id,
      parentId,
      calc.useActivityAuto ? 1 : 0,
      calc.startMonth,
      calc.endMonth,
      calc.calcMonths,
      calc.calcPremise,
      calc.calcDose,
      calc.calcPrice,
      calc.calcExcludeWeekdays,
      calc.calcAreaPremise,
      calc.calcAreaPct,
      calc.calcPlans,
    ).lastInsertRowid,
  );
}

function findActivityLine(
  categoryId: number,
  activityId: number,
  costObjectId?: number | null,
  parentId: number | null = null,
) {
  return db
    .prepare(
      `SELECT id FROM lines
       WHERE category_id = ? AND activity_id = ? AND ref_kind = 'activity'
         AND (
           (? IS NULL AND parent_id IS NULL) OR parent_id = ?
         )
         AND (
           (? IS NULL AND cost_object_id IS NULL)
           OR cost_object_id = ?
         )`,
    )
    .get(
      categoryId,
      activityId,
      parentId,
      parentId,
      costObjectId ?? null,
      costObjectId ?? null,
    ) as { id: number } | undefined;
}

function ensureActivityLine(
  sheetId: number,
  categoryId: number,
  activityId: number,
  costObjectId?: number | null,
  parentId: number | null = null,
) {
  const existing = findActivityLine(categoryId, activityId, costObjectId, parentId);
  if (existing) return existing.id;
  return createActivityLine(sheetId, categoryId, activityId, costObjectId, undefined, parentId);
}

function ensureCostCenterGroup(sheetId: number, categoryId: number, centerSheetId: number) {
  const center = db.prepare("SELECT id, title FROM sheets WHERE id = ? AND kind = 'cost_center'").get(centerSheetId) as
    | { id: number; title: string }
    | undefined;
  if (!center) throw new Error("Centro de custo não encontrado.");
  const existing = db
    .prepare(
      `SELECT id FROM lines
        WHERE category_id = ? AND ref_kind = 'cost_center' AND center_sheet_id = ? AND parent_id IS NULL`,
    )
    .get(categoryId, center.id) as { id: number } | undefined;
  if (existing) return existing.id;
  return Number(
    db
      .prepare(
        `INSERT INTO lines (
           sheet_id, category_id, object_code, product_code, item_type, description, is_group, sort_order,
           activity_id, material_id, cost_object_id, ref_kind, parent_id, center_sheet_id
         ) VALUES (?, ?, NULL, NULL, NULL, ?, 1, ?, NULL, NULL, NULL, 'cost_center', NULL, ?)`,
      )
      .run(sheetId, categoryId, center.title, nextLineSort(categoryId), center.id).lastInsertRowid,
  );
}

function sourceActivityOnSheet(centerSheetId: number, activityId: number) {
  return db
    .prepare(
      `SELECT use_activity_auto, start_month, end_month, calc_months, calc_plans, calc_premise, calc_dose, calc_price,
              calc_exclude_weekdays, calc_area_premise, calc_area_pct, calc_reduce_pct, cost_object_id
         FROM lines
        WHERE sheet_id = ? AND activity_id = ? AND ref_kind = 'activity' AND parent_id IS NULL
        ORDER BY id
        LIMIT 1`,
    )
    .get(centerSheetId, activityId) as
    | {
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
        calc_reduce_pct: number | null;
        cost_object_id: number | null;
      }
    | undefined;
}

function fillFromSourceActivity(source: ReturnType<typeof sourceActivityOnSheet>) {
  if (!source) return { useActivityAuto: true } as Parameters<typeof resolveLineCalc>[0] & { calcReducePct?: number | null };
  return {
    useActivityAuto: source.use_activity_auto !== 0,
    startMonth: source.start_month,
    endMonth: source.end_month,
    calcMonths: source.calc_months,
    calcPlans: source.calc_plans,
    calcPremise: source.calc_premise,
    calcDose: source.calc_dose,
    calcPrice: source.calc_price,
    calcExcludeWeekdays: parseExcludeWeekdays(source.calc_exclude_weekdays),
    calcAreaPremise: source.calc_area_premise,
    calcAreaPct: source.calc_area_pct,
    calcReducePct: source.calc_reduce_pct,
  };
}

type CategoryCopyLine = {
  id: number;
  sheet_id: number;
  category_id: number;
  parent_id: number | null;
  center_sheet_id: number | null;
  activity_id: number | null;
  material_id: number | null;
  cost_object_id: number | null;
  ref_kind: string | null;
  product_code: string | null;
  item_type: string | null;
  description: string;
  is_group: number | null;
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
  calc_reduce_pct: number | null;
};

function categoryCopyKind(line: CategoryCopyLine): "center" | "activity" | "equipment" | null {
  if (line.ref_kind === "cost_center") return "center";
  if (line.ref_kind === "activity") return "activity";
  if (isEquipmentHeadLine(line)) return "equipment";
  return null;
}

function fillFromCopyLine(line: CategoryCopyLine) {
  return fillFromSourceActivity({
    use_activity_auto: line.use_activity_auto,
    start_month: line.start_month,
    end_month: line.end_month,
    calc_months: line.calc_months,
    calc_plans: line.calc_plans,
    calc_premise: line.calc_premise,
    calc_dose: line.calc_dose,
    calc_price: line.calc_price,
    calc_exclude_weekdays: line.calc_exclude_weekdays,
    calc_area_premise: line.calc_area_premise,
    calc_area_pct: line.calc_area_pct,
    calc_reduce_pct: line.calc_reduce_pct,
    cost_object_id: line.cost_object_id,
  });
}

function findEquipmentLine(categoryId: number, productCode: string, parentId: number | null) {
  const code = productCode.trim();
  if (!code) return undefined;
  return db
    .prepare(
      `SELECT id FROM lines
        WHERE category_id = ?
          AND ref_kind = 'cost_object'
          AND is_group = 1
          AND ifnull(product_code, '') = ?
          AND (
            (? IS NULL AND parent_id IS NULL) OR parent_id = ?
          )
        ORDER BY id
        LIMIT 1`,
    )
    .get(categoryId, code, parentId, parentId) as { id: number } | undefined;
}

function copyCategoryItems(targetCategoryId: number, sourceCategoryId: number, lineIds: number[]) {
  const target = db.prepare("SELECT id, sheet_id FROM categories WHERE id = ?").get(targetCategoryId) as
    | { id: number; sheet_id: number }
    | undefined;
  const source = db.prepare("SELECT id, sheet_id FROM categories WHERE id = ?").get(sourceCategoryId) as
    | { id: number; sheet_id: number }
    | undefined;
  if (!target || !source) throw new Error("Categoria não encontrada.");
  if (target.sheet_id !== source.sheet_id) {
    throw new Error("A categoria de origem precisa ser do mesmo centro de custo.");
  }
  if (target.id === source.id) throw new Error("Escolha outra categoria para copiar.");

  const rows = db
    .prepare(
      `SELECT id, sheet_id, category_id, parent_id, center_sheet_id, activity_id, material_id, cost_object_id,
              ref_kind, product_code, item_type, description, is_group,
              use_activity_auto, start_month, end_month, calc_months, calc_plans, calc_premise, calc_dose, calc_price,
              calc_exclude_weekdays, calc_area_premise, calc_area_pct, calc_reduce_pct
         FROM lines
        WHERE category_id = ?`,
    )
    .all(sourceCategoryId) as CategoryCopyLine[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const requested = [...new Set(lineIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!requested.length) throw new Error("Selecione pelo menos um item para copiar.");

  const copySet = new Set<number>();
  const addWithParents = (id: number) => {
    const line = byId.get(id);
    if (!line || copySet.has(id)) return;
    const kind = categoryCopyKind(line);
    if (line.parent_id) addWithParents(line.parent_id);
    if (!kind) return;
    copySet.add(id);
  };
  for (const id of requested) addWithParents(id);

  const ordered = [...copySet]
    .map((id) => byId.get(id)!)
    .filter((line) => categoryCopyKind(line))
    .sort((a, b) => {
      const rank = (line: CategoryCopyLine) => {
        const kind = categoryCopyKind(line);
        return kind === "center" ? 0 : kind === "activity" ? 1 : 2;
      };
      return rank(a) - rank(b);
    });

  const idMap = new Map<number, number>();
  let created = 0;
  let skipped = 0;
  const mappedParent = (sourceParentId: number | null): number | null => {
    let current = sourceParentId;
    while (current != null) {
      const mapped = idMap.get(current);
      if (mapped != null) return mapped;
      current = byId.get(current)?.parent_id ?? null;
    }
    return null;
  };

  for (const line of ordered) {
    const kind = categoryCopyKind(line);
    const parentId = mappedParent(line.parent_id);
    if (kind === "center") {
      if (!line.center_sheet_id) {
        skipped += 1;
        continue;
      }
      const existingCenter = db
        .prepare(
          `SELECT id FROM lines
            WHERE category_id = ? AND ref_kind = 'cost_center' AND center_sheet_id = ? AND parent_id IS NULL`,
        )
        .get(target.id, line.center_sheet_id) as { id: number } | undefined;
      const nextId = ensureCostCenterGroup(target.sheet_id, target.id, line.center_sheet_id);
      idMap.set(line.id, nextId);
      if (existingCenter) skipped += 1;
      else created += 1;
      continue;
    }
    if (kind === "activity") {
      if (!line.activity_id) {
        skipped += 1;
        continue;
      }
      const existing = findActivityLine(target.id, line.activity_id, line.cost_object_id, parentId);
      if (existing) {
        idMap.set(line.id, existing.id);
        skipped += 1;
        continue;
      }
      const createdId = createActivityLine(
        target.sheet_id,
        target.id,
        line.activity_id,
        line.cost_object_id,
        fillFromCopyLine(line),
        parentId,
      );
      if (!createdId) {
        skipped += 1;
        continue;
      }
      idMap.set(line.id, createdId);
      created += 1;
      continue;
    }
    const code = String(line.product_code ?? "").trim() || equipmentCodeFromDescription(line.description);
    if (!code) {
      skipped += 1;
      continue;
    }
    const existing = findEquipmentLine(target.id, code, parentId);
    if (existing) {
      idMap.set(line.id, existing.id);
      skipped += 1;
      continue;
    }
    const createdId = createEquipmentLine(
      target.sheet_id,
      target.id,
      code,
      line.description || code,
      line.cost_object_id,
      fillFromCopyLine(line),
      parentId,
      {
        activityId: line.activity_id,
        itemType: line.item_type === "E" || line.item_type === "G" ? line.item_type : null,
      },
    );
    if (!createdId) {
      skipped += 1;
      continue;
    }
    idMap.set(line.id, createdId);
    created += 1;
  }

  return { created, skipped, sheetId: target.sheet_id };
}

function deleteLineTree(id: number) {
  const children = db.prepare("SELECT id FROM lines WHERE parent_id = ?").all(id) as { id: number }[];
  for (const child of children) deleteLineTree(child.id);
  db.prepare("DELETE FROM line_months WHERE line_id = ?").run(id);
  db.prepare("DELETE FROM lines WHERE id = ?").run(id);
}

function snapshotLineMonths(lineId: number) {
  return db
    .prepare("SELECT month_index, formula, value FROM line_months WHERE line_id = ? ORDER BY month_index")
    .all(lineId) as { month_index: number; formula: string | null; value: string | null }[];
}

function restoreLineMonths(lineId: number, previous: { month_index: number; formula: string | null; value: string | null }[]) {
  db.prepare("DELETE FROM line_months WHERE line_id = ?").run(lineId);
  const ins = db.prepare("INSERT INTO line_months (line_id, month_index, formula, value) VALUES (?, ?, ?, ?)");
  for (const row of previous) ins.run(lineId, row.month_index, row.formula, row.value);
}

function undoValueDistribution(distId: number) {
  const dist = db.prepare("SELECT id FROM value_distributions WHERE id = ?").get(distId) as { id: number } | undefined;
  if (!dist) throw new Error("Distribuição não encontrada.");
  const lines = db
    .prepare(
      `SELECT sheet_id, line_id, created_line, previous_months
         FROM value_distribution_lines
        WHERE distribution_id = ?`,
    )
    .all(distId) as {
      sheet_id: number;
      line_id: number;
      created_line: number;
      previous_months: string | null;
    }[];
  const sheetIds = [...new Set(lines.map((row) => row.sheet_id))];
  const tx = db.transaction(() => {
    for (const row of lines) {
      const line = db.prepare("SELECT id FROM lines WHERE id = ?").get(row.line_id) as { id: number } | undefined;
      if (!line) continue;
      let previous: { month_index: number; formula: string | null; value: string | null }[] = [];
      try {
        previous = row.previous_months ? (JSON.parse(row.previous_months) as typeof previous) : [];
      } catch {
        previous = [];
      }
      const children = db.prepare("SELECT COUNT(*) AS n FROM lines WHERE parent_id = ?").get(row.line_id) as { n: number };
      if (row.created_line && children.n === 0) {
        db.prepare("DELETE FROM line_months WHERE line_id = ?").run(row.line_id);
        db.prepare("DELETE FROM lines WHERE id = ?").run(row.line_id);
      } else {
        restoreLineMonths(row.line_id, previous);
      }
    }
    db.prepare("DELETE FROM value_distribution_lines WHERE distribution_id = ?").run(distId);
    db.prepare("DELETE FROM value_distributions WHERE id = ?").run(distId);
  });
  tx();
  return sheetIds;
}

function ensureGroupLine(
  sheetId: number,
  categoryId: number,
  activityId: number | null,
  costObjectId: number | null,
) {
  if (activityId) return ensureActivityLine(sheetId, categoryId, activityId, costObjectId);
  if (costObjectId) return ensureCostObjectLine(sheetId, categoryId, costObjectId);
  return null;
}

function ensureCategoryOnSheet(sheetId: number, name: string, catalogId?: number | null) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Informe a categoria.");
  const existing = db
    .prepare("SELECT id FROM categories WHERE sheet_id = ? AND name = ? COLLATE NOCASE")
    .get(sheetId, trimmed) as { id: number } | undefined;
  if (existing) return existing.id;
  let catalog = catalogId
    ? (db.prepare("SELECT id, name FROM category_catalog WHERE id = ?").get(catalogId) as
        | { id: number; name: string }
        | undefined)
    : undefined;
  if (!catalog) {
    catalog = db.prepare("SELECT id, name FROM category_catalog WHERE name = ? COLLATE NOCASE").get(trimmed) as
      | { id: number; name: string }
      | undefined;
  }
  if (!catalog) {
    catalog = {
      id: Number(db.prepare("INSERT INTO category_catalog (name) VALUES (?)").run(trimmed).lastInsertRowid),
      name: trimmed,
    };
  }
  const max = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS n FROM categories WHERE sheet_id = ?").get(sheetId) as {
    n: number;
  };
  return Number(
    db
      .prepare("INSERT INTO categories (sheet_id, name, sort_order, catalog_id) VALUES (?, ?, ?, ?)")
      .run(sheetId, catalog.name, max.n + 1, catalog.id).lastInsertRowid,
  );
}

function splitAmount(total: number, parts: number) {
  if (!(parts > 0)) return [];
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / parts);
  const rem = cents - base * parts;
  return Array.from({ length: parts }, (_, i) => (base + (i >= parts - rem ? 1 : 0)) / 100);
}

function writeDistributedMonths(lineId: number, months: number[], values: number[]) {
  db.prepare("DELETE FROM line_months WHERE line_id = ?").run(lineId);
  const ins = db.prepare("INSERT INTO line_months (line_id, month_index, formula, value) VALUES (?, ?, ?, ?)");
  months.forEach((month, i) => {
    const value = values[i] ?? 0;
    if (!(value > 0)) return;
    const text = Number.isInteger(value) ? String(value) : String(value);
    ins.run(lineId, month, `=${text}`, JSON.stringify(value));
  });
}

function writeFixedActivityMonths(
  lineId: number,
  months?: { month: number; value?: number; formula?: string }[],
) {
  db.prepare("DELETE FROM line_months WHERE line_id = ?").run(lineId);
  const picked = (months ?? [])
    .map((row) => ({ month: Number(row.month), value: Number(row.value) }))
    .filter((row) => Number.isInteger(row.month) && row.month >= 0 && row.month <= 11 && row.value > 0);
  const ins = db.prepare("INSERT INTO line_months (line_id, month_index, formula, value) VALUES (?, ?, ?, ?)");
  for (const row of picked) {
    const text = Number.isInteger(row.value) ? String(row.value) : String(row.value);
    ins.run(lineId, row.month, `=${text}`, JSON.stringify(row.value));
  }
  db.prepare("UPDATE lines SET use_activity_auto = 0 WHERE id = ?").run(lineId);
  return picked.length > 0;
}

const app = express();
if (budgetCloudEnabled() && !budgetBootState()) {
  throw new Error("O modo Supabase não foi inicializado. Remova o override PLANEJAMENTO_DB_PATH ao iniciar a API.");
}
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "32mb" }));

if (budgetCloudEnabled() && budgetBootState()) {
  const cloud = new BudgetCloudController(db, budgetBootState()!, () => {
    const premises = premissasKpis();
    const sheets = (listSheets() as { id: number; kind: string }[])
      .filter((s) => s.kind === "cost_center").map((s) => sheetDetail(s.id));
    const tables = captureBudgetState(db);
    return { currentSafraId: currentSafraId(), createdAt: new Date().toISOString(),
      tables, sheets, premises, formulaErrors: [],
      parsedPlans: Object.fromEntries(tables.lines.map((l) => [l.id, parseCalcPlans(l.calc_plans)])) };
  }, invalidateWorkbook, (req) => verifySessionToken(readBearerToken(req.headers.authorization)));
  app.use(cloud.middleware);
}

registerAccessControl(app);

app.get("/api/health", (_req, res) => res.json({ ok: true, budgetStorage: budgetCloudEnabled() ? "supabase" : "sqlite" }));

app.get("/api/storage/status", async (req, res) => {
  const user = verifySessionToken(readBearerToken(req.headers.authorization));
  if (!user) return res.status(401).json({ error: "Sessão expirada ou inválida." });
  res.setHeader("Cache-Control", "no-store");
  res.json(await budgetStorageStatus(budgetCloudEnabled()));
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    const user = await loginWithCredentials(String(body.email ?? ""), String(body.password ?? ""));
    const token = createSessionToken(user);
    res.json({ token, user });
  } catch (e) {
    res.status(401).json({ error: e instanceof Error ? e.message : "Não foi possível entrar." });
  }
});

app.get("/api/auth/me", (req, res) => {
  const user = verifySessionToken(readBearerToken(req.headers.authorization));
  if (!user) return res.status(401).json({ error: "Sessão expirada ou inválida." });
  res.json({ user });
});

app.post("/api/auth/logout", (_req, res) => {
  res.json({ ok: true });
});

registerUsersAdminRoutes(app);

app.get("/api/external-sites", (_req, res) => {
  res.json(listExternalSiteGroups());
});

app.get("/api/external-sites/admin", (_req, res) => {
  res.json(listExternalSiteGroupsAdmin());
});

app.get("/api/external-sites/groups/:id", (req, res) => {
  const group = getExternalSiteGroup(Number(req.params.id));
  if (!group) return res.status(404).json({ error: "Aba não encontrada." });
  res.json(group);
});

app.post("/api/external-sites/register", (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      tabLabel?: string;
      subTabLabel?: string;
      url?: string;
      embedNativeKey?: string | null;
      groupId?: number | null;
    };
    res.json(
      registerExternalSite({
        tabLabel: body.tabLabel !== undefined ? String(body.tabLabel) : undefined,
        subTabLabel: String(body.subTabLabel ?? ""),
        url: String(body.url ?? ""),
        embedNativeKey: parseEmbedNativeKey(body.embedNativeKey),
        groupId: body.groupId ? Number(body.groupId) : null,
      }),
    );
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível cadastrar o site." });
  }
});

app.get("/api/external-sites/embed/:nativeKey", (req, res) => {
  const nativeKey = parseEmbedNativeKey(req.params.nativeKey);
  if (!nativeKey) {
    return res.status(404).json({ error: "Destino não encontrado." });
  }
  res.json(getExternalSitesForEmbed(nativeKey));
});

app.get("/api/external-sites/embed-targets", (_req, res) => {
  res.json(EXTERNAL_EMBED_TARGETS);
});

app.post("/api/external-sites/groups", (req, res) => {
  try {
    const body = (req.body ?? {}) as { label?: string; slug?: string; nativeKey?: string | null };
    res.json(createExternalSiteGroup({ label: String(body.label ?? ""), slug: body.slug, nativeKey: body.nativeKey }));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível criar a aba." });
  }
});

app.post("/api/external-sites/items", (req, res) => {
  try {
    const body = (req.body ?? {}) as { groupId?: number; label?: string; url?: string };
    res.json(
      createExternalSiteItem({
        groupId: Number(body.groupId),
        label: String(body.label ?? ""),
        url: String(body.url ?? ""),
      }),
    );
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível criar a subaba." });
  }
});

app.patch("/api/external-sites/groups/:id", (req, res) => {
  try {
    updateExternalSiteGroup(Number(req.params.id), req.body ?? {});
    res.json(getExternalSiteGroup(Number(req.params.id)));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível atualizar a aba." });
  }
});

app.patch("/api/external-sites/items/:id", (req, res) => {
  try {
    const item = updateExternalSiteItem(Number(req.params.id), req.body ?? {});
    res.json(item);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível atualizar a subaba." });
  }
});

app.delete("/api/external-sites/groups/:id", (req, res) => {
  try {
    deleteExternalSiteGroup(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível excluir a aba." });
  }
});

app.delete("/api/external-sites/items/:id", (req, res) => {
  try {
    deleteExternalSiteItem(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível excluir a subaba." });
  }
});

app.patch("/api/external-sites/native-tabs", (req, res) => {
  try {
    const body = (req.body ?? {}) as { nativeKey?: string; tabId?: string; hidden?: boolean };
    res.json(setNativeTabHidden(String(body.nativeKey ?? ""), String(body.tabId ?? ""), Boolean(body.hidden)));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível atualizar a subaba." });
  }
});

registerColheitaRoutes(app);
registerIndicadoresRoutes(app);
registerCustoRoutes(app);
registerSeedTransportReportRoutes(app);
registerContractControlRoutes(app);

app.get("/api/entrada-cana/config", (_req, res) => {
  res.json(entradaCanaConfig());
});

app.post("/api/entrada-cana/import", async (req, res) => {
  try {
    const body = req.body as { files?: EntradaCanaFileInput[]; options?: EntradaCanaImportOptions };
    const files = body.files ?? [];
    const options = body.options;
    if (!files.length) return res.status(400).json({ error: "Informe ao menos um arquivo (grid da planilha)." });
    if (!options?.importType) return res.status(400).json({ error: "Informe options.importType (maquina ou caminhao)." });
    const result = await runEntradaCanaImport(files, options);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/api/distributions", (_req, res) => res.json(listValueDistributions()));

app.delete("/api/distributions/:distId", (req, res) => {
  const distId = Number(req.params.distId);
  try {
    const sheetIds = undoValueDistribution(distId);
    invalidateWorkbook();
    applyAutoCalc();
    for (const sheetId of sheetIds) persistLineValues(sheetId);
    res.json({ distributions: listValueDistributions() });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Não foi possível desfazer a distribuição.";
    res.status(message === "Distribuição não encontrada." ? 404 : 400).json({ error: message });
  }
});
app.get("/api/sheets", (_req, res) => res.json(listSheets()));
app.get("/api/dashboard", (_req, res) => res.json(dashboard()));
app.get("/api/resumo", (_req, res) => res.json(resumo()));
app.get("/api/externo/orcamento", (req, res) => {
  try {
    const raw = req.query.safraId;
    const safraId = raw != null && String(raw).trim() !== "" ? Number(raw) : null;
    if (raw != null && String(raw).trim() !== "" && !Number.isFinite(safraId)) {
      return res.status(400).json({ error: "safraId inválido" });
    }
    res.json(getOrcamentoExterno(safraId));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível ler o orçamento." });
  }
});

app.get("/api/funcionario-orcamento/subprocessos", async (req, res) => {
  try {
    const externalSafraId = Number(req.query.safraId ?? req.query.externalSafraId);
    if (!Number.isFinite(externalSafraId)) {
      return res.status(400).json({ error: "Informe safraId (ID externo, ex.: 4)." });
    }
    res.json(await listExternSubprocessos(externalSafraId));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível listar subprocessos." });
  }
});

app.get("/api/funcionario-orcamento/preview", async (req, res) => {
  try {
    const externalSafraId = Number(req.query.safraId ?? req.query.externalSafraId);
    if (!Number.isFinite(externalSafraId)) {
      return res.status(400).json({ error: "Informe safraId (ID externo, ex.: 4)." });
    }
    const localSafraId =
      req.query.localSafraId != null && String(req.query.localSafraId).trim() !== ""
        ? Number(req.query.localSafraId)
        : null;
    res.json(await previewFuncionarioOrcamentoImport({ externalSafraId, localSafraId }));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível ler o orçamento externo." });
  }
});

async function finalizeFuncionarioOrcamentoRefresh(
  result: { configUpdated?: { lineId: number }[]; updated?: { lineId: number }[]; importUpdated?: { lineId: number }[] },
) {
  invalidateWorkbook();
  applyAutoCalc();
  const lineIds = [
    ...(result.configUpdated ?? []).map((row) => row.lineId),
    ...(result.updated ?? result.importUpdated ?? []).map((row) => row.lineId),
  ];
  const sheetIds = [
    ...new Set(
      lineIds
        .map((lineId) => {
          const line = db.prepare("SELECT sheet_id FROM lines WHERE id = ?").get(lineId) as
            | { sheet_id: number }
            | undefined;
          return line?.sheet_id;
        })
        .filter((id): id is number => Number.isFinite(id)),
    ),
  ];
  for (const sheetId of sheetIds) persistLineValues(sheetId);
  persistAllValues();
}

app.post("/api/funcionario-orcamento/import", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { safraId?: number; externalSafraId?: number; localSafraId?: number | null };
    const externalSafraId = Number(body.externalSafraId ?? body.safraId);
    if (!Number.isFinite(externalSafraId)) {
      return res.status(400).json({ error: "Informe safraId (ID externo, ex.: 4)." });
    }
    const result = await importFuncionarioOrcamento({
      externalSafraId,
      localSafraId: body.localSafraId ?? null,
      apply: true,
      createMissingLines: body.createMissingLines !== false,
    });
    await finalizeFuncionarioOrcamentoRefresh(result);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível importar o orçamento de funcionários." });
  }
});

app.post("/api/funcionario-orcamento/refresh-all", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { safraId?: number; externalSafraId?: number; localSafraId?: number | null };
    const externalSafraId = Number(body.externalSafraId ?? body.safraId);
    if (!Number.isFinite(externalSafraId)) {
      return res.status(400).json({ error: "Informe safraId (ID externo, ex.: 4)." });
    }
    const result = await refreshAllFuncionarioOrcamentoValues({
      externalSafraId,
      localSafraId: body.localSafraId ?? null,
    });
    await finalizeFuncionarioOrcamentoRefresh(result);
    res.json(result);
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Não foi possível atualizar os valores de funcionários.",
    });
  }
});
app.get("/api/orcado-realizado", async (req, res) => {
  try {
    const raw = req.query.safraId;
    const safraId = raw != null && String(raw).trim() !== "" ? Number(raw) : null;
    res.json(await orcadoRealizado({ safraId: Number.isFinite(safraId) ? safraId : null }));
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Não foi possível montar o orçado x realizado.",
    });
  }
});

app.get("/api/orcado-realizado/grupo-gasto-detalhes", async (req, res) => {
  try {
    const raw = req.query.safraId;
    const safraId = raw != null && String(raw).trim() !== "" ? Number(raw) : null;
    res.json({
      rows: await orcadoRealizadoGrupoGastoDetalhe({
        safraId: Number.isFinite(safraId) ? safraId : null,
        grupoKey: req.query.grupoKey,
        empenhoKey: req.query.empenhoKey,
        agricola: req.query.agricola,
      }),
    });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Não foi possível carregar o detalhe do grupo de gasto.",
    });
  }
});
function refreshPremissas() {
  const sheet = db.prepare("SELECT id FROM sheets WHERE name = 'PREMISSAS'").get() as { id: number } | undefined;
  if (sheet) applyPremissaDistribution(sheet.id);
  invalidateWorkbook();
  applyAutoCalc();
  persistAllValues();
  return premissasKpis();
}

app.get("/api/premissas", (_req, res) => res.json(premissasKpis()));

app.put("/api/premissas/copy", (req, res) => {
  try {
    const body = req.body as {
      destKey?: string;
      destName?: string;
      destSuffix?: string;
      sourceKey?: string;
      sourceScope?: "current" | "previous";
      startMonth?: number;
      endMonth?: number;
    };
    if (!body.sourceKey) return res.status(400).json({ error: "Escolha o subprocesso de origem." });
    savePremissaCopy({
      destKey: body.destKey,
      destName: body.destName,
      destSuffix: body.destSuffix,
      sourceKey: body.sourceKey,
      sourceScope: body.sourceScope === "previous" ? "previous" : "current",
      startMonth: Number(body.startMonth),
      endMonth: body.endMonth == null ? undefined : Number(body.endMonth),
    });
    res.json(refreshPremissas());
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível gerar a cópia." });
  }
});

app.put("/api/premissas/month", (req, res) => {
  try {
    const body = req.body as { key?: string; month?: number; value?: string | number };
    if (!body.key) return res.status(400).json({ error: "Informe o subprocesso." });
    setPremissaMonthValue(body.key, Number(body.month), body.value);
    res.json(refreshPremissas());
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível gravar o mês." });
  }
});

app.delete("/api/premissas/copy/:id", (req, res) => {
  try {
    deletePremissaCopy(Number(req.params.id));
    res.json(refreshPremissas());
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível remover a cópia." });
  }
});

app.post("/api/premissas/items", (req, res) => {
  try {
    const body = req.body as {
      name?: string;
      suffix?: string;
      kind?: "subprocess" | "producao_propria";
      qty?: number | string;
      qtyPerDay?: number | string;
      startDay?: string;
      endDay?: string;
    };
    const kind = body.kind === "producao_propria" ? "producao_propria" : "subprocess";
    createCustomSubprocess(
      String(body.name ?? ""),
      body.suffix ?? (kind === "producao_propria" ? "t" : "ha"),
      null,
      kind,
      kind === "producao_propria"
        ? { qtyPerDay: body.qtyPerDay, startDay: body.startDay ?? null, endDay: body.endDay ?? null }
        : { qty: body.qty, startDay: body.startDay ?? null, endDay: body.endDay ?? null },
    );
    res.json(refreshPremissas());
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível incluir o item." });
  }
});

app.put("/api/premissas/subprocess", (req, res) => {
  try {
    const body = req.body as {
      key?: string;
      qty?: number | string;
      startDay?: string | null;
      endDay?: string | null;
    };
    if (!body.key) return res.status(400).json({ error: "Informe o subprocesso." });
    const patch: { qty?: number | string; startDay?: string | null; endDay?: string | null } = {};
    if ("qty" in body) patch.qty = body.qty;
    if ("startDay" in body) patch.startDay = body.startDay;
    if ("endDay" in body) patch.endDay = body.endDay;
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: "Informe a quantidade total ou o período." });
    }
    saveCustomSubprocess(body.key, patch);
    res.json(refreshPremissas());
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível gravar o subprocesso." });
  }
});

app.put("/api/premissas/production", (req, res) => {
  try {
    const body = req.body as {
      key?: string;
      qtyPerDay?: number | string;
      startDay?: string | null;
      endDay?: string | null;
    };
    if (!body.key) return res.status(400).json({ error: "Informe o item de produção própria." });
    const patch: { qtyPerDay?: number | string; startDay?: string | null; endDay?: string | null } = {};
    if ("qtyPerDay" in body) patch.qtyPerDay = body.qtyPerDay;
    if ("startDay" in body) patch.startDay = body.startDay;
    if ("endDay" in body) patch.endDay = body.endDay;
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: "Informe a quantidade por dia ou o período." });
    }
    saveProductionOwn(body.key, patch);
    res.json(refreshPremissas());
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível gravar a produção própria." });
  }
});

app.delete("/api/premissas/items/:key", (req, res) => {
  try {
    deleteCustomSubprocess(String(req.params.key ?? ""));
    res.json(refreshPremissas());
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível excluir o item." });
  }
});

app.get("/api/safras", (_req, res) => {
  try {
    res.json({ ...safrasState(), suggestedCode: suggestedSafraCode() });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Não foi possível ler as safras." });
  }
});

app.post("/api/safras", (req, res) => {
  try {
    const body = req.body as { code?: string; label?: string; copyFrom?: boolean };
    snapshotPremissaValues();
    const before = safrasState();
    const state = createSafra(String(body.code ?? ""), body.label);
    const createdId = state.createdId;
    if (createdId && body.copyFrom !== false) {
      const source =
        previousSafra(createdId) ??
        before.safras.find((row) => row.id === before.currentId) ??
        before.safras[0];
      if (source) {
        copyPremissaData(source.id, createdId);
        const copied = db.prepare("SELECT COUNT(*) AS n FROM premissa_cells WHERE safra_id = ?").get(createdId) as { n: number };
        if (!copied.n && before.currentId && before.currentId !== source.id) {
          copyPremissaData(before.currentId, createdId);
        }
        copyCalcRulesBetween(source.id, createdId);
        copySeedRadiusTariffsBetween(source.id, createdId);
        copyHarvestAreasBetween(source.id, createdId);
        copyLineSafraPricesBetween(source.id, createdId);
      }
    }
    res.json({ ...state, suggestedCode: suggestedSafraCode() });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível criar a safra." });
  }
});

app.patch("/api/safras/:id", (req, res) => {
  try {
    res.json(updateSafra(Number(req.params.id), req.body as { code?: string; label?: string }));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível atualizar a safra." });
  }
});

app.delete("/api/safras/:id", (req, res) => {
  try {
    res.json(deleteSafra(Number(req.params.id)));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível excluir a safra." });
  }
});

app.put("/api/safras/current", (req, res) => {
  try {
    snapshotPremissaValues();
    try {
      const summary = resumo();
      const kpis = premissasKpis();
      const moagemMecanizada =
        kpis.subprocesses?.find((row) => row.key === "tons")?.qty?.value ?? kpis.moagem;
      const moagemManual =
        kpis.subprocesses?.find((row) => row.key === "tonsManual")?.qty?.value ?? kpis.moagemManual;
      const labeled = aggregateResumo(summary.contributions ?? [], listReportSubprocesses());
      saveSafraKpis(currentSafraId(), labeled.total, Number(moagemMecanizada) + Number(moagemManual), {
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
      });
    } catch {
      /* mantém o último consolidado gravado se o cálculo falhar */
    }
    const state = setCurrentSafra(Number((req.body as { id?: number }).id));
    const sheet = db.prepare("SELECT id FROM sheets WHERE name = 'PREMISSAS'").get() as { id: number } | undefined;
    if (sheet) {
      restorePremissaSheet();
      invalidateWorkbook();
      applyPremissaDistribution(sheet.id);
      invalidateWorkbook();
      applyAutoCalc();
      persistAllValues();
    }
    res.json(state);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível trocar a safra." });
  }
});

app.get("/api/calc-rules", (req, res) => {
  try {
    const safraId = req.query.safraId ? Number(req.query.safraId) : null;
    res.json(listCalcRules(safraId));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Não foi possível ler os parâmetros." });
  }
});

app.post("/api/calc-rules/copy-previous", (req, res) => {
  try {
    const safraId = (req.body as { safraId?: number | null }).safraId ?? null;
    const data = copyCalcRulesFromPrevious(safraId);
    applyAutoCalc(safraId);
    invalidateWorkbook();
    persistAllValues();
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível copiar os parâmetros." });
  }
});

app.post("/api/calc-rules", (req, res) => {
  try {
    const body = req.body as {
      kind?: "material" | "activity";
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
    };
    if (body.kind !== "material" && body.kind !== "activity") {
      return res.status(400).json({ error: "Escolha o cálculo por material ou por atividade." });
    }
    const hoursMode = body.mode === "hours";
    const daysMode = body.mode === "days";
    if (!daysMode && !body.premise) {
      return res.status(400).json({ error: "Informe a premissa do cálculo." });
    }
    const data = createCalcRule({
        kind: body.kind,
        materialId: body.materialId ?? null,
        activityId: body.activityId ?? null,
        premise: daysMode ? "dias" : body.premise,
        mode: hoursMode ? "hours" : daysMode ? "days" : "area",
        dose: body.dose ?? null,
        rateHa: body.rateHa ?? null,
        price: body.price ?? null,
        excludeWeekdays: daysMode ? body.excludeWeekdays ?? [] : [],
        areaPremise: daysMode ? body.areaPremise ?? null : null,
        useActivityAuto: body.useActivityAuto !== false,
        startMonth: body.startMonth ?? null,
        endMonth: body.endMonth ?? null,
        fromMaterials: !hoursMode && body.fromMaterials === true,
        costObjectIds: body.kind === "activity" ? body.costObjectIds ?? [] : [],
        safraId: body.safraId ?? null,
      });
    applyAutoCalc(body.safraId ?? null);
    invalidateWorkbook();
    persistAllValues();
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível salvar a regra." });
  }
});

app.patch("/api/calc-rules/:id", (req, res) => {
  try {
    const data = updateCalcRule(Number(req.params.id), req.body as Parameters<typeof updateCalcRule>[1]);
    applyAutoCalc();
    invalidateWorkbook();
    persistAllValues();
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível atualizar a regra." });
  }
});

app.delete("/api/calc-rules/:id", (req, res) => {
  try {
    const data = deleteCalcRule(Number(req.params.id));
    applyAutoCalc();
    invalidateWorkbook();
    persistAllValues();
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível excluir a regra." });
  }
});

app.get("/api/seed-radius", async (req, res) => {
  try {
    const fromDate = typeof req.query.from === "string" ? req.query.from : null;
    const toDate = typeof req.query.to === "string" ? req.query.to : null;
    res.json(await listSeedRadius(fromDate, toDate));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Não foi possível consultar os raios no Oracle." });
  }
});

app.get("/api/seed-radius/:farmCode/trips", async (req, res) => {
  try {
    const fromDate = typeof req.query.from === "string" ? req.query.from : null;
    const toDate = typeof req.query.to === "string" ? req.query.to : null;
    res.json(await listSeedRadiusTrips(Number(req.params.farmCode), fromDate, toDate));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Não foi possível consultar os apontamentos da fazenda." });
  }
});

app.get("/api/seed-radius-tariffs", (req, res) => {
  try {
    const safraId = req.query.safraId ? Number(req.query.safraId) : null;
    res.json(listSeedRadiusTariffs(safraId));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Não foi possível ler as faixas de raio." });
  }
});

app.post("/api/seed-radius-tariffs/copy-previous", (req, res) => {
  try {
    const safraId = (req.body as { safraId?: number | null }).safraId ?? null;
    res.json(copySeedRadiusTariffsFromPrevious(safraId));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível copiar as faixas." });
  }
});

app.post("/api/seed-radius-tariffs", (req, res) => {
  try {
    const body = req.body as { startKm?: number; endKm?: number; price?: number; safraId?: number | null };
    res.json(
      createSeedRadiusTariff({
        startKm: body.startKm ?? NaN,
        endKm: body.endKm ?? NaN,
        price: body.price ?? NaN,
        safraId: body.safraId ?? null,
      }),
    );
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível salvar a faixa." });
  }
});

app.patch("/api/seed-radius-tariffs/:id", (req, res) => {
  try {
    res.json(updateSeedRadiusTariff(Number(req.params.id), req.body as Parameters<typeof updateSeedRadiusTariff>[1]));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível atualizar a faixa." });
  }
});

app.delete("/api/seed-radius-tariffs/:id", (req, res) => {
  try {
    res.json(deleteSeedRadiusTariff(Number(req.params.id)));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível excluir a faixa." });
  }
});

app.get("/api/areas", (req, res) => {
  try {
    const safraId = req.query.safraId ? Number(req.query.safraId) : null;
    res.json(listHarvestAreas(safraId));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Não foi possível ler as áreas." });
  }
});

app.get("/api/custo-colheita", async (req, res) => {
  try {
    const anomesInicio = String(req.query.anomesInicio ?? "");
    const anomesFim = String(req.query.anomesFim ?? "");
    const safraId = req.query.safraId ? Number(req.query.safraId) : null;
    if (!/^\d{6}$/.test(anomesInicio) || !/^\d{6}$/.test(anomesFim)) {
      res.status(400).json({ error: "Informe o anomes inicial e final no formato YYYYMM." });
      return;
    }
    const preferirLocal = String(req.query.preferirLocal ?? "") === "1";
    res.json(await lerCustoColheita(Number(anomesInicio), Number(anomesFim), safraId, { preferirLocal }));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Não foi possível ler o custo de colheita." });
  }
});

app.put("/api/custo-colheita", (req, res) => {
  try {
    const body = req.body as Parameters<typeof salvarCustoColheitaLocal>[1] & { safraId?: number | null };
    res.json(salvarCustoColheitaLocal(body.safraId ?? null, body));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível salvar o custo de colheita." });
  }
});

app.get("/api/ficha-estagio", (req, res) => {
  try {
    const anomesInicio = String(req.query.anomesInicio ?? "");
    const anomesFim = String(req.query.anomesFim ?? "");
    const anoSafra = Number(req.query.anoSafra);
    const filtrar = /^\d{6}$/.test(anomesInicio) && /^\d{6}$/.test(anomesFim) && Number.isFinite(anoSafra);
    res.json(lerFichaEstagio(filtrar ? mesesDoPeriodo(Number(anomesInicio), Number(anomesFim), anoSafra) : undefined));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Não foi possível ler a ficha." });
  }
});

app.get("/api/parametros-tecnicos/periodos", (_req, res) => {
  try { res.json({ periodos: listarPeriodosParametrosTecnicos() }); }
  catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : "Não foi possível listar os períodos." }); }
});

app.get("/api/parametros-tecnicos", (req, res) => {
  try {
    const safraId = req.query.safraId ? Number(req.query.safraId) : null;
    res.json(lerParametrosTecnicos(safraId, req.query.anomesInicio, req.query.anomesFim));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Não foi possível ler os parâmetros técnicos." });
  }
});

app.post("/api/parametros-tecnicos/extrair", async (req, res) => {
  try {
    const body = req.body as { safraId?: number | null; anomesInicio?: unknown; anomesFim?: unknown };
    res.json(await extrairParametrosTecnicos(body.safraId ?? null, body.anomesInicio, body.anomesFim));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível extrair as áreas." });
  }
});

app.put("/api/parametros-tecnicos", (req, res) => {
  try {
    const body = req.body as {
      safraId?: number | null;
      areaPlantio?: unknown;
      areaSoca?: unknown;
      areaIrrigacao?: unknown;
      areaArrendada?: unknown;
      moagemLj?: unknown;
      tonelagemManual?: unknown;
      atr?: unknown;
      produtividade?: unknown;
      precoAtrConsecana?: unknown;
      anomesInicio?: unknown;
      anomesFim?: unknown;
    };
    res.json(salvarParametrosTecnicos(body.safraId ?? null, body));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível armazenar os parâmetros técnicos." });
  }
});

app.post("/api/areas/copy-previous", (req, res) => {
  try {
    const safraId = (req.body as { safraId?: number | null }).safraId ?? null;
    res.json(copyHarvestAreasFromPrevious(safraId));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível copiar as áreas." });
  }
});

app.post("/api/areas", (req, res) => {
  try {
    const body = req.body as { description?: string; area?: number; safraId?: number | null };
    res.json(createHarvestArea({ description: body.description, area: body.area, safraId: body.safraId ?? null }));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível salvar a área." });
  }
});

app.patch("/api/areas/:id", (req, res) => {
  try {
    res.json(updateHarvestArea(Number(req.params.id), req.body as Parameters<typeof updateHarvestArea>[1]));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível atualizar a área." });
  }
});

app.delete("/api/areas/:id", (req, res) => {
  try {
    res.json(deleteHarvestArea(Number(req.params.id)));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível excluir a área." });
  }
});

app.get("/api/activities", (_req, res) => {
  res.json(db.prepare("SELECT * FROM activities ORDER BY code COLLATE NOCASE, description").all());
});

app.get("/api/activities/:activityId/apontamento-equipment", async (req, res) => {
  try {
    const safraId = req.query.safraId ? Number(req.query.safraId) : null;
    res.json(await activityApontamentoEquipment(Number(req.params.activityId), safraId));
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Não foi possível consultar as horas/ha dos tratores.",
    });
  }
});

app.get("/api/activity-links", (req, res) => {
  try {
    const safraId = req.query.safraId ? Number(req.query.safraId) : null;
    res.json(listActivityLinks(safraId));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível listar as associações." });
  }
});

app.get("/api/activity-links/sources", async (req, res) => {
  try {
    const source = String(req.query.source ?? "");
    const safraId = req.query.safraId ? Number(req.query.safraId) : null;
    const matchBy = req.query.matchBy ? String(req.query.matchBy) : null;
    res.json(await listActivitySourceOptions(source, safraId, matchBy));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível consultar os códigos no Oracle." });
  }
});

app.post("/api/activity-links", (req, res) => {
  try {
    const body = req.body as {
      activityId?: number;
      source?: string;
      sourceCode?: string;
      sourceCodes?: string[];
      sourceLabel?: string | null;
      matchBy?: string | null;
      safraId?: number | null;
    };
    res.json(createActivityLink(body));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível salvar a associação." });
  }
});

app.delete("/api/activity-links/:id", (req, res) => {
  try {
    const safraId = req.query.safraId ? Number(req.query.safraId) : null;
    res.json(deleteActivityLink(Number(req.params.id), safraId));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível excluir a associação." });
  }
});

app.get("/api/un-realizado-sources", async (req, res) => {
  try {
    const safraId = req.query.safraId != null ? Number(req.query.safraId) : undefined;
    res.json(await listUnRealizadoSources(safraId));
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Não foi possível listar as origens da Un realizado.",
    });
  }
});

app.get("/api/un-realizado-sources/kinds", (_req, res) => {
  res.json({ kinds: unRealizadoKindOptions() });
});

app.get("/api/un-realizado-sources/operations", async (_req, res) => {
  try {
    res.json(await listUnRealizadoOperations());
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Não foi possível listar as operações agrícolas.",
    });
  }
});

app.post("/api/un-realizado-sources", async (req, res) => {
  try {
    const body = req.body as {
      sheetId?: number;
      sourceKind?: string;
      metric?: string;
      operations?: { code: string; label?: string }[];
      safraId?: number | null;
    };
    if (!body.sheetId) return res.status(400).json({ error: "Escolha o centro de custo." });
    if (!body.sourceKind) return res.status(400).json({ error: "Escolha a origem da Un." });
    res.json(
      await upsertUnRealizadoSource({
        sheetId: Number(body.sheetId),
        sourceKind: body.sourceKind,
        metric: body.metric,
        operations: body.operations,
        safraId: body.safraId,
      }),
    );
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Não foi possível salvar a origem da Un realizado.",
    });
  }
});

app.delete("/api/un-realizado-sources/:id", async (req, res) => {
  try {
    const safraId = req.query.safraId != null ? Number(req.query.safraId) : undefined;
    res.json(await deleteUnRealizadoSource(Number(req.params.id), safraId));
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Não foi possível excluir a origem da Un realizado.",
    });
  }
});

app.get("/api/activities/oracle", async (_req, res) => {
  try {
    res.json({ items: await listOracleActivities() });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Não foi possível consultar as atividades no Oracle." });
  }
});

app.post("/api/activities/import-oracle", async (req, res) => {
  try {
    const codes = Array.isArray((req.body as { codes?: unknown })?.codes)
      ? ((req.body as { codes: unknown[] }).codes).map((code) => String(code))
      : null;
    res.json(await importOracleActivities(codes));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível importar as atividades." });
  }
});

app.get("/api/empenhos", (_req, res) => {
  res.json(listEmpenhos());
});

app.get("/api/empenhos/oracle", async (_req, res) => {
  try {
    res.json({ items: await listOracleEmpenhos() });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Não foi possível consultar os empenhos no Oracle." });
  }
});

app.post("/api/empenhos/import-oracle", async (req, res) => {
  try {
    const codes = Array.isArray((req.body as { codes?: unknown })?.codes)
      ? ((req.body as { codes: unknown[] }).codes).map((code) => String(code))
      : null;
    res.json(await importOracleEmpenhos(codes));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível importar os empenhos." });
  }
});

app.post("/api/activities", (req, res) => {
  const { code, description, empenho } = req.body as { code?: string; description?: string; empenho?: string };
  if (!code?.trim() || !description?.trim()) {
    return res.status(400).json({ error: "Informe código e descrição da atividade." });
  }
  try {
    const info = db
      .prepare("INSERT INTO activities (code, description, empenho) VALUES (?, ?, ?)")
      .run(code.trim(), description.trim(), empenho?.trim() || null);
    res.json(db.prepare("SELECT * FROM activities WHERE id = ?").get(info.lastInsertRowid));
  } catch {
    res.status(400).json({ error: "Já existe uma atividade com esse código." });
  }
});

app.patch("/api/activities/:id", (req, res) => {
  const id = Number(req.params.id);
  const { code, description, empenho } = req.body as {
    code?: string;
    description?: string;
    empenho?: string | null;
  };
  db.prepare(
    `UPDATE activities
     SET code = COALESCE(?, code),
         description = COALESCE(?, description),
         empenho = CASE WHEN ? = 1 THEN ? ELSE empenho END
     WHERE id = ?`,
  ).run(
    code?.trim() || null,
    description?.trim() || null,
    empenho !== undefined ? 1 : 0,
    typeof empenho === "string" ? empenho.trim() || null : empenho ?? null,
    id,
  );
  res.json(db.prepare("SELECT * FROM activities WHERE id = ?").get(id));
});

app.delete("/api/activities/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare(
    "UPDATE lines SET activity_id = NULL, ref_kind = CASE WHEN ref_kind = 'activity' THEN NULL ELSE ref_kind END WHERE activity_id = ?",
  ).run(id);
  db.prepare("DELETE FROM activities WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.get("/api/materials/oracle", async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    res.json(await listOracleMaterials(q));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Não foi possível consultar os materiais no Oracle." });
  }
});

app.get("/api/materials/relatorio-entrada-saida", async (req, res) => {
  try {
    const dataInicio = typeof req.query.dataInicio === "string" ? req.query.dataInicio : null;
    const dataFim = typeof req.query.dataFim === "string" ? req.query.dataFim : null;
    const tipo = typeof req.query.tipo === "string" ? req.query.tipo : null;
    const tipos = req.query.tipos;
    res.json(await relatorioMaterialEntradaSaida({ dataInicio, dataFim, tipo, tipos: tipos as string | string[] | undefined }));
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Não foi possível montar o relatório de entrada e saída.",
    });
  }
});

app.get("/api/materials/groups", async (_req, res) => {
  try {
    res.json(await listMaterialGroups());
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Não foi possível listar os grupos." });
  }
});

app.post("/api/materials/sync-groups", async (_req, res) => {
  try {
    res.json(await syncMaterialGroups());
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível buscar os grupos no Oracle." });
  }
});

app.post("/api/materials/import-oracle", async (req, res) => {
  try {
    const codes = Array.isArray((req.body as { codes?: unknown })?.codes)
      ? ((req.body as { codes: unknown[] }).codes).map((code) => String(code))
      : null;
    res.json(await importOracleMaterials(codes));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível importar os materiais." });
  }
});

app.get("/api/materials", (_req, res) => {
  res.json(db.prepare("SELECT * FROM materials ORDER BY code COLLATE NOCASE, description").all());
});

app.get("/api/materials/:id/last-price", async (req, res) => {
  try {
    res.json(await lastMaterialEntryPrice(Number(req.params.id)));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível calcular a média dos preços." });
  }
});

app.post("/api/materials", (req, res) => {
  const { code, description, tipo, empenho, valor, grupo } = req.body as {
    code?: string;
    description?: string;
    tipo?: string;
    empenho?: string;
    valor?: number | null;
    grupo?: string | null;
  };
  if (!code?.trim() || !description?.trim()) {
    return res.status(400).json({ error: "Informe código e descrição do material." });
  }
  const kind = tipo === "G" ? "G" : tipo === "E" ? "E" : null;
  if (!kind) return res.status(400).json({ error: "Tipo deve ser E ou G." });
  try {
    const info = db
      .prepare("INSERT INTO materials (code, description, tipo, empenho, valor, grupo) VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        code.trim(),
        description.trim(),
        kind,
        empenho?.trim() || null,
        valor ?? null,
        kind === "E" ? grupo?.trim() || null : null,
      );
    res.json(db.prepare("SELECT * FROM materials WHERE id = ?").get(info.lastInsertRowid));
  } catch {
    res.status(400).json({ error: "Já existe um material com esse código." });
  }
});

app.patch("/api/materials/:id", (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM materials WHERE id = ?").get(id) as
    | { tipo: string; grupo: string | null }
    | undefined;
  if (!current) return res.status(404).json({ error: "Material não encontrado." });
  const { code, description, tipo, empenho, valor, grupo } = req.body as {
    code?: string;
    description?: string;
    tipo?: string;
    empenho?: string | null;
    valor?: number | null;
    grupo?: string | null;
  };
  const kind = tipo === "G" || tipo === "E" ? tipo : current.tipo;
  const nextGrupo = kind === "G" ? null : grupo !== undefined ? grupo?.trim() || null : current.grupo;
  db.prepare(
    `UPDATE materials
     SET code = COALESCE(?, code),
         description = COALESCE(?, description),
         tipo = COALESCE(?, tipo),
         empenho = COALESCE(?, empenho),
         valor = COALESCE(?, valor),
         grupo = ?
     WHERE id = ?`,
  ).run(code?.trim() || null, description?.trim() || null, tipo === "G" || tipo === "E" ? tipo : null, empenho?.trim() || null, valor ?? null, nextGrupo, id);
  res.json(db.prepare("SELECT * FROM materials WHERE id = ?").get(id));
});

app.delete("/api/materials/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare(
    "UPDATE lines SET material_id = NULL, ref_kind = CASE WHEN ref_kind = 'material' THEN NULL ELSE ref_kind END WHERE material_id = ?",
  ).run(id);
  db.prepare("DELETE FROM materials WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.get("/api/cost-objects", (_req, res) => {
  res.json(db.prepare("SELECT * FROM cost_objects ORDER BY code COLLATE NOCASE, description").all());
});

app.get("/api/cost-objects/hour-cost", async (_req, res) => {
  try {
    res.json(await costObjectHourCosts());
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível consultar o custo por hora." });
  }
});

app.get("/api/cost-objects/:id/equipment-hour-cost", async (req, res) => {
  try {
    res.json(await equipmentHourCosts(Number(req.params.id)));
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Não foi possível consultar o custo do equipamento.",
    });
  }
});

app.get("/api/equipments", async (_req, res) => {
  try {
    res.json(await listEquipments());
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Não foi possível listar os equipamentos.",
    });
  }
});

app.get("/api/equipments/cost-objects", async (req, res) => {
  try {
    const codes = parseEquipmentCodes(String(req.query.codes ?? ""));
    const map = await loadEquipmentVigenteObcMap();
    res.json({
      items: codes.map((code) => ({
        code,
        costObjectCodes: costObjectsForEquipmentCode(code, map),
      })),
    });
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "Não foi possível consultar os objetos de custo dos equipamentos.",
    });
  }
});

app.post("/api/cost-objects", (req, res) => {
  const { code, description } = req.body as { code?: string; description?: string };
  if (!code?.trim() || !description?.trim()) {
    return res.status(400).json({ error: "Informe código e descrição do objeto de custo." });
  }
  try {
    const info = db
      .prepare("INSERT INTO cost_objects (code, description) VALUES (?, ?)")
      .run(code.trim(), description.trim());
    res.json(db.prepare("SELECT * FROM cost_objects WHERE id = ?").get(info.lastInsertRowid));
  } catch {
    res.status(400).json({ error: "Já existe um objeto de custo com esse código." });
  }
});

app.patch("/api/cost-objects/:id", (req, res) => {
  const id = Number(req.params.id);
  const { code, description } = req.body as { code?: string; description?: string };
  db.prepare("UPDATE cost_objects SET code = COALESCE(?, code), description = COALESCE(?, description) WHERE id = ?").run(
    code?.trim() || null,
    description?.trim() || null,
    id,
  );
  res.json(db.prepare("SELECT * FROM cost_objects WHERE id = ?").get(id));
});

app.delete("/api/cost-objects/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("UPDATE lines SET cost_object_id = NULL WHERE cost_object_id = ?").run(id);
  db.prepare("DELETE FROM cost_objects WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.get("/api/fazendas", (_req, res) => {
  res.json(db.prepare("SELECT * FROM fazendas ORDER BY code COLLATE NOCASE, description").all());
});

app.get("/api/fazendas/oracle", async (_req, res) => {
  try {
    res.json({ items: await listOracleFazendas() });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Não foi possível consultar as fazendas no Oracle." });
  }
});

app.post("/api/fazendas/import-oracle", async (req, res) => {
  try {
    const codes = Array.isArray((req.body as { codes?: unknown })?.codes)
      ? ((req.body as { codes: unknown[] }).codes).map((code) => String(code))
      : null;
    res.json(await importOracleFazendas(codes));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível importar as fazendas." });
  }
});

app.post("/api/fazendas", (req, res) => {
  const { code, description, distancia } = req.body as {
    code?: string;
    description?: string;
    distancia?: number | string | null;
  };
  if (!code?.trim() || !description?.trim()) {
    return res.status(400).json({ error: "Informe código e descrição da fazenda." });
  }
  const dist =
    distancia === null || distancia === undefined || distancia === ""
      ? null
      : Number(String(distancia).replace(",", "."));
  if (distancia !== null && distancia !== undefined && distancia !== "" && !Number.isFinite(dist)) {
    return res.status(400).json({ error: "Informe uma distância válida." });
  }
  try {
    const info = db
      .prepare("INSERT INTO fazendas (code, description, distancia) VALUES (?, ?, ?)")
      .run(code.trim(), description.trim(), dist);
    res.json(db.prepare("SELECT * FROM fazendas WHERE id = ?").get(info.lastInsertRowid));
  } catch {
    res.status(400).json({ error: "Já existe uma fazenda com esse código." });
  }
});

app.patch("/api/fazendas/:id", (req, res) => {
  const id = Number(req.params.id);
  const { code, description, distancia } = req.body as {
    code?: string;
    description?: string;
    distancia?: number | string | null;
  };
  let distFlag = 0;
  let distValue: number | null = null;
  if (distancia !== undefined) {
    distFlag = 1;
    if (distancia === null || distancia === "") distValue = null;
    else {
      distValue = Number(String(distancia).replace(",", "."));
      if (!Number.isFinite(distValue)) {
        return res.status(400).json({ error: "Informe uma distância válida." });
      }
    }
  }
  db.prepare(
    `UPDATE fazendas
     SET code = COALESCE(?, code),
         description = COALESCE(?, description),
         distancia = CASE WHEN ? = 1 THEN ? ELSE distancia END
     WHERE id = ?`,
  ).run(code?.trim() || null, description?.trim() || null, distFlag, distValue, id);
  res.json(db.prepare("SELECT * FROM fazendas WHERE id = ?").get(id));
});

app.delete("/api/fazendas/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM fazendas WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.get("/api/category-catalog", (_req, res) => {
  res.json(db.prepare("SELECT * FROM category_catalog ORDER BY name COLLATE NOCASE").all());
});

app.post("/api/category-catalog", (req, res) => {
  const name = String((req.body as { name?: string }).name ?? "").trim();
  if (!name) return res.status(400).json({ error: "Informe o nome da categoria." });
  try {
    const info = db.prepare("INSERT INTO category_catalog (name) VALUES (?)").run(name);
    res.json(db.prepare("SELECT * FROM category_catalog WHERE id = ?").get(info.lastInsertRowid));
  } catch {
    res.status(400).json({ error: "Já existe uma categoria com esse nome." });
  }
});

app.patch("/api/category-catalog/:id", (req, res) => {
  const id = Number(req.params.id);
  const name = String((req.body as { name?: string }).name ?? "").trim();
  if (!name) return res.status(400).json({ error: "Informe o nome da categoria." });
  try {
    db.prepare("UPDATE category_catalog SET name = ? WHERE id = ?").run(name, id);
    db.prepare("UPDATE categories SET name = ? WHERE catalog_id = ?").run(name, id);
    res.json(db.prepare("SELECT * FROM category_catalog WHERE id = ?").get(id));
  } catch {
    res.status(400).json({ error: "Já existe uma categoria com esse nome." });
  }
});

app.delete("/api/category-catalog/:id", (req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare("SELECT COUNT(*) AS n FROM categories WHERE catalog_id = ?").get(id) as { n: number };
  if (used.n) {
    return res.status(400).json({ error: "Essa categoria está em uso em um centro de custo." });
  }
  db.prepare("DELETE FROM category_catalog WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.post("/api/sheets/:id/categories", (req, res) => {
  const sheetId = Number(req.params.id);
  const body = req.body as { name?: string; catalogId?: number };
  const catalog = body.catalogId
    ? (db.prepare("SELECT id, name FROM category_catalog WHERE id = ?").get(Number(body.catalogId)) as
        | { id: number; name: string }
        | undefined)
    : body.name?.trim()
      ? (db.prepare("SELECT id, name FROM category_catalog WHERE name = ? COLLATE NOCASE").get(body.name.trim()) as
          | { id: number; name: string }
          | undefined)
      : undefined;
  if (!catalog) return res.status(400).json({ error: "Selecione uma categoria cadastrada." });
  const existing = db
    .prepare("SELECT id FROM categories WHERE sheet_id = ? AND (catalog_id = ? OR name = ?)")
    .get(sheetId, catalog.id, catalog.name) as { id: number } | undefined;
  if (existing) return res.status(400).json({ error: "Essa categoria já existe neste centro de custo." });
  const max = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS n FROM categories WHERE sheet_id = ?").get(sheetId) as { n: number };
  db.prepare("INSERT INTO categories (sheet_id, name, sort_order, catalog_id) VALUES (?, ?, ?, ?)").run(
    sheetId,
    catalog.name,
    max.n + 1,
    catalog.id,
  );
  res.json(sheetDetail(sheetId, false));
});

app.delete("/api/categories/:id", (req, res) => {
  const id = Number(req.params.id);
  const cat = db.prepare("SELECT sheet_id FROM categories WHERE id = ?").get(id) as { sheet_id: number } | undefined;
  if (!cat) return res.status(404).json({ error: "Categoria não encontrada" });
  db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  invalidateWorkbook();
  res.json(sheetDetail(cat.sheet_id, false));
});

app.post("/api/categories/:id/group-by-center", (req, res) => {
  const categoryId = Number(req.params.id);
  const cat = db.prepare("SELECT id, sheet_id FROM categories WHERE id = ?").get(categoryId) as
    | { id: number; sheet_id: number }
    | undefined;
  if (!cat) return res.status(404).json({ error: "Categoria não encontrada" });
  const roots = db
    .prepare(
      `SELECT id, activity_id FROM lines
        WHERE category_id = ? AND ref_kind = 'activity' AND parent_id IS NULL AND activity_id IS NOT NULL`,
    )
    .all(categoryId) as { id: number; activity_id: number }[];
  const homesStmt = db.prepare(
    `SELECT s.id
       FROM lines l
       JOIN sheets s ON s.id = l.sheet_id
      WHERE l.activity_id = ? AND l.ref_kind = 'activity' AND l.parent_id IS NULL
        AND s.id != ? AND s.kind = 'cost_center'
      GROUP BY s.id`,
  );
  const move = db.prepare("UPDATE lines SET parent_id = ? WHERE id = ?");
  for (const line of roots) {
    const homes = homesStmt.all(line.activity_id, cat.sheet_id) as { id: number }[];
    if (homes.length !== 1) continue;
    const groupId = ensureCostCenterGroup(cat.sheet_id, categoryId, homes[0].id);
    move.run(groupId, line.id);
  }
  invalidateWorkbook();
  applyAutoCalc();
  persistLineValues(cat.sheet_id);
  res.json(sheetDetail(cat.sheet_id, false));
});

app.post("/api/categories/:id/copy-from", (req, res) => {
  const targetCategoryId = Number(req.params.id);
  const body = (req.body ?? {}) as { sourceCategoryId?: number; lineIds?: number[] };
  try {
    const result = copyCategoryItems(targetCategoryId, Number(body.sourceCategoryId), body.lineIds ?? []);
    invalidateWorkbook();
    applyAutoCalc();
    persistLineValues(result.sheetId);
    res.json(sheetDetail(result.sheetId, false));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível copiar os itens." });
  }
});

app.get("/api/sheets/:id", (req, res) => {
  const detail = sheetDetail(Number(req.params.id));
  if (!detail) return res.status(404).json({ error: "Aba não encontrada" });
  res.json(detail);
});

app.get("/api/sheets/:id/activity-heads", (req, res) => {
  const sheetId = Number(req.params.id);
  const rows = db
    .prepare(
      `SELECT l.id, l.activity_id AS activityId, a.code, l.description
         FROM lines l
         JOIN activities a ON a.id = l.activity_id
        WHERE l.sheet_id = ? AND l.ref_kind = 'activity' AND l.parent_id IS NULL
        ORDER BY l.sort_order, l.id`,
    )
    .all(sheetId) as { id: number; activityId: number; code: string; description: string }[];
  res.json(rows);
});

app.patch("/api/sheets/:id", (req, res) => {
  const id = Number(req.params.id);
  const sheet = db.prepare("SELECT id, kind FROM sheets WHERE id = ?").get(id) as
    | { id: number; kind: string }
    | undefined;
  if (!sheet) return res.status(404).json({ error: "Aba não encontrada" });
  const { visible, title, verified } = req.body as { visible?: boolean; title?: string; verified?: boolean };
  if (visible !== undefined) {
    db.prepare("UPDATE sheets SET visible = ? WHERE id = ?").run(visible ? 1 : 0, id);
    invalidateWorkbook();
  }
  if (title) db.prepare("UPDATE sheets SET title = ? WHERE id = ?").run(title, id);
  if (verified !== undefined) {
    if (sheet.kind !== "cost_center") {
      return res.status(400).json({ error: "Só centros de custo podem ser marcados como verificados." });
    }
    setSheetVerified(id, Boolean(verified));
  }
  const row = (listSheets() as { id: number }[]).find((item) => item.id === id);
  res.json(row);
});

app.delete("/api/sheets/:id", (req, res) => {
  const id = Number(req.params.id);
  const sheet = db.prepare("SELECT kind, name FROM sheets WHERE id = ?").get(id) as
    | { kind: string; name: string }
    | undefined;
  if (!sheet) return res.status(404).json({ error: "Aba não encontrada" });
  if (sheet.kind === "premissas") {
    return res.status(400).json({ error: "As premissas não podem ser removidas." });
  }
  db.prepare("DELETE FROM sheets WHERE id = ?").run(id);
  invalidateWorkbook();
  res.json({ ok: true });
});

app.post("/api/sheets/:id/lines", async (req, res) => {
  const sheetId = Number(req.params.id);
  const body = req.body as {
    categoryId?: number;
    categoryName?: string;
    description: string;
    objectCode?: string;
    productCode?: string;
    itemType?: string;
    activityId?: number | null;
    materialId?: number | null;
    costObjectId?: number | null;
    parentLineId?: number | null;
    centerSheetId?: number | null;
    refKind?: "material" | "activity" | "cost_object" | "cost_center" | null;
    useActivityAuto?: boolean;
    startMonth?: number | null;
    endMonth?: number | null;
    calcMonths?: number[] | null;
    calcPlans?: unknown;
    calcMode?: "area" | "days";
    calcPremise?: string | null;
    calcDose?: number | null;
    calcPrice?: number | null;
    calcExcludeWeekdays?: number[] | null;
    calcAreaPremise?: string | null;
    calcAreaPct?: number | null;
    calcReducePct?: number | null;
    calcAreaHa?: number | null;
    calcApplications?: number | null;
    calcDirect?: boolean | number;
    calcKind?: string | null;
    calcTrips?: number | null;
    calcMachineQty?: number | null;
    calcHourInterval?: number | null;
    months?: { month: number; value?: number; formula?: string }[];
  };

  let categoryId = body.categoryId;
  if (!categoryId && body.categoryName) {
    const existing = db
      .prepare("SELECT id FROM categories WHERE sheet_id = ? AND name = ?")
      .get(sheetId, body.categoryName) as { id: number } | undefined;
    if (existing) categoryId = existing.id;
    else {
      const catalogName = body.categoryName.trim();
      let catalog = db.prepare("SELECT id FROM category_catalog WHERE name = ? COLLATE NOCASE").get(catalogName) as
        | { id: number }
        | undefined;
      if (!catalog) {
        catalog = { id: Number(db.prepare("INSERT INTO category_catalog (name) VALUES (?)").run(catalogName).lastInsertRowid) };
      }
      const max = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS n FROM categories WHERE sheet_id = ?").get(sheetId) as { n: number };
      categoryId = Number(
        db.prepare("INSERT INTO categories (sheet_id, name, sort_order, catalog_id) VALUES (?, ?, ?, ?)").run(
          sheetId,
          catalogName,
          max.n + 1,
          catalog.id,
        ).lastInsertRowid,
      );
    }
  }
  if (!categoryId) return res.status(400).json({ error: "Informe a categoria." });

  const centerSheetId = body.centerSheetId ? Number(body.centerSheetId) : null;
  if (body.refKind === "cost_center") {
    if (!centerSheetId) return res.status(400).json({ error: "Informe o centro de custo." });
    ensureCostCenterGroup(sheetId, categoryId, centerSheetId);
    invalidateWorkbook();
    persistLineValues(sheetId);
    return res.json(sheetDetail(sheetId, false));
  }

  let parentId = body.parentLineId ? Number(body.parentLineId) : null;
  let activityId = body.activityId ? Number(body.activityId) : null;
  const requestedCostObject = body.costObjectId ? Number(body.costObjectId) : null;
  if (centerSheetId && !parentId) {
    parentId = ensureCostCenterGroup(sheetId, categoryId, centerSheetId);
  }
  const parent = parentId
    ? (db
        .prepare(
          `SELECT id, category_id, activity_id, material_id, cost_object_id, ref_kind, center_sheet_id, parent_id,
                  is_group, product_code FROM lines WHERE id = ?`,
        )
        .get(parentId) as
        | {
            id: number;
            category_id: number;
            activity_id: number | null;
            material_id: number | null;
            cost_object_id: number | null;
            ref_kind: string | null;
            center_sheet_id: number | null;
            parent_id: number | null;
            is_group: number | null;
            product_code: string | null;
          }
        | undefined)
    : undefined;
  if (parentId && !parent) return res.status(400).json({ error: "Atividade da linha não encontrada." });
  const parentIsCenter = parent?.ref_kind === "cost_center";
  const parentIsActivity = parent?.ref_kind === "activity";
  const parentIsMaterial = parent?.ref_kind === "material";
  const parentIsCostObjectGroup =
    parent?.ref_kind === "cost_object" &&
    Boolean(parent.is_group) &&
    !String(parent.product_code ?? "").trim();
  if (parent) {
    categoryId = parent.category_id;
    if (!parentIsCenter && !parentIsCostObjectGroup) activityId = parent.activity_id ?? activityId;
    else if (parentIsCostObjectGroup) activityId = parent.activity_id ?? activityId;
  }

  const equipmentCode = String(body.productCode ?? "").trim();
  const createEquipmentRow =
    body.refKind === "cost_object" &&
    Boolean(equipmentCode) &&
    body.calcKind == null &&
    (!parentId || parentIsCenter || parentIsActivity || parentIsMaterial || parentIsCostObjectGroup);
  if (createEquipmentRow) {
    let groupId =
      parentIsCenter || parentIsActivity || parentIsMaterial || parentIsCostObjectGroup ? parentId : null;
    let linkedActivityId =
      parentIsCenter || parentIsCostObjectGroup ? parent?.activity_id ?? null : (parent?.activity_id ?? activityId);
    if (parentIsCostObjectGroup && activityId && !linkedActivityId) linkedActivityId = activityId;
    if (parentIsMaterial && !linkedActivityId && parent?.parent_id) {
      const up = db.prepare("SELECT activity_id FROM lines WHERE id = ?").get(parent.parent_id) as
        | { activity_id: number | null }
        | undefined;
      linkedActivityId = up?.activity_id ?? null;
    }
    if (!parentIsActivity && !parentIsMaterial && !parentIsCostObjectGroup && activityId) {
      const existing = db
        .prepare(
          `SELECT id FROM lines
            WHERE category_id = ? AND activity_id = ? AND ref_kind = 'activity'
            ORDER BY id
            LIMIT 1`,
        )
        .get(categoryId, activityId) as { id: number } | undefined;
      const activityLineId =
        existing?.id ??
        createActivityLine(sheetId, categoryId, activityId, null, undefined, parentIsCenter ? parentId : null);
      if (!activityLineId) return res.status(400).json({ error: "Atividade não encontrada." });
      groupId = activityLineId;
      linkedActivityId = activityId;
    }
    let created: number | null = null;
    try {
      created = createEquipmentLine(
        sheetId,
        categoryId,
        equipmentCode,
        body.description?.trim() || equipmentCode,
        requestedCostObject ?? (parentIsCostObjectGroup ? parent?.cost_object_id ?? null : null),
        {
          useActivityAuto: body.useActivityAuto,
          startMonth: body.startMonth,
          endMonth: body.endMonth,
          calcMonths: body.calcMonths,
          calcPlans: body.calcPlans,
          calcMode: body.calcMode,
          calcPremise: body.calcPremise,
          calcDose: body.calcDose,
          calcPrice: body.calcPrice,
          calcExcludeWeekdays: body.calcExcludeWeekdays,
          calcAreaPremise: body.calcAreaPremise,
          calcAreaPct: body.calcAreaPct,
        },
        groupId,
        {
          activityId: linkedActivityId,
          materialId: parentIsMaterial ? parent?.material_id ?? null : null,
          itemType: body.itemType === "E" || body.itemType === "G" ? body.itemType : null,
        },
      );
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível incluir o equipamento." });
    }
    if (!created) return res.status(400).json({ error: "Informe o equipamento." });
    if (Array.isArray(body.months) && !(Array.isArray(body.calcPlans) && body.calcPlans.length)) {
      writeFixedActivityMonths(created, body.months);
    }
    invalidateWorkbook();
    await applyAutoCalcFull(null);
    persistLineValues(sheetId);
    return res.json(sheetDetail(sheetId, false));
  }

  if (
    !body.materialId &&
    activityId &&
    body.refKind === "cost_object" &&
    !createEquipmentRow &&
    (!parentId || parentIsCenter)
  ) {
    const groupId = parentIsCenter ? parentId : null;
    const existing = db
      .prepare(
        `SELECT id FROM lines
          WHERE category_id = ? AND activity_id = ? AND ref_kind = 'activity'
            AND (
              (? IS NULL AND parent_id IS NULL) OR parent_id = ?
            )
          ORDER BY id
          LIMIT 1`,
      )
      .get(categoryId, activityId, groupId, groupId) as { id: number } | undefined;
    let created: number | null = existing?.id ?? null;
    if (!created) {
      try {
        created = createActivityLine(
          sheetId,
          categoryId,
          activityId,
          null,
          { useActivityAuto: true },
          groupId,
        );
      } catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível incluir a atividade." });
      }
    }
    if (!created) return res.status(400).json({ error: "Atividade não encontrada." });
    parentId = created;
  } else if (!body.materialId && activityId && body.refKind !== "cost_object" && (!parent || parentIsCenter)) {
    const groupId = parentIsCenter ? parentId : null;
    const source = groupId && parent?.center_sheet_id ? sourceActivityOnSheet(parent.center_sheet_id, activityId) : undefined;
    const existing = findActivityLine(categoryId, activityId, requestedCostObject, groupId);
    let created: number | null = existing?.id ?? null;
    if (!created) {
      try {
        created = createActivityLine(
          sheetId,
          categoryId,
          activityId,
          requestedCostObject ?? source?.cost_object_id ?? null,
          source
            ? fillFromSourceActivity(source)
            : {
                useActivityAuto: body.useActivityAuto,
                startMonth: body.startMonth,
                endMonth: body.endMonth,
                calcMonths: body.calcMonths,
                calcPlans: body.calcPlans,
                calcMode: body.calcMode,
                calcPremise: body.calcPremise,
                calcDose: body.calcDose,
                calcPrice: body.calcPrice,
                calcExcludeWeekdays: body.calcExcludeWeekdays,
                calcAreaPremise: body.calcAreaPremise,
                calcAreaPct: body.calcAreaPct,
                calcReducePct: body.calcReducePct,
              },
          groupId,
        );
      } catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível incluir a atividade." });
      }
    }
    if (!created) return res.status(400).json({ error: "Atividade não encontrada." });
    parentId = created;
    if (body.calcReducePct !== undefined && existing?.id) {
      try {
        db.prepare("UPDATE lines SET calc_reduce_pct = ? WHERE id = ?").run(resolveReducePct(body.calcReducePct), created);
      } catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : "Informe a redução em percentual (0 a 100)." });
      }
    }
  } else if (!parentId) {
    // Objeto de custo sozinho (grupo para equipamentos, com ou sem valor fixo): não cria linha de atividade.
    const looksCostObjectGroup =
      body.refKind === "cost_object" &&
      Boolean(requestedCostObject) &&
      !String(body.productCode ?? "").trim() &&
      body.calcKind == null &&
      !(Number(body.calcDose) > 0) &&
      !(Number(body.calcPrice) > 0);
    if (!looksCostObjectGroup) {
      parentId = ensureGroupLine(sheetId, categoryId, activityId, requestedCostObject);
    }
  }

  const materialId = body.materialId ? Number(body.materialId) : null;
  const fixedCostObjectWithoutActivity =
    body.refKind === "cost_object" &&
    Boolean(requestedCostObject) &&
    !String(body.productCode ?? "").trim() &&
    !activityId &&
    body.calcKind == null &&
    !(Number(body.calcDose) > 0) &&
    !(Number(body.calcPrice) > 0);
  if (!materialId && !activityId && !parentId && !fixedCostObjectWithoutActivity) {
    return res.status(400).json({ error: "Informe a atividade (ex.: Preparo Solo) ou o material." });
  }

  if (materialId) {
    const parent = parentId
      ? (db.prepare("SELECT cost_object_id FROM lines WHERE id = ?").get(parentId) as { cost_object_id: number | null } | undefined)
      : undefined;
    const catalog = resolveLineCatalog({
      costObjectId: parent?.cost_object_id ?? requestedCostObject,
      materialId,
      activityId: null,
      refKind: "material",
      itemType: body.itemType ?? null,
    });
    const mat = db.prepare("SELECT description FROM materials WHERE id = ?").get(materialId) as { description: string } | undefined;
    let trips;
    try {
      trips = parseTripsCalc(body);
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Informe tonelada, viagens, máquinas e preço." });
    }
    const hoursMode = trips.calcKind === "hours";
    const daysMode = trips.calcKind === "days";
    const hoursRule = hoursMode ? lookupActivityHoursRule(activityId, parent?.cost_object_id ?? requestedCostObject) : null;
    const calcPrice = trips.tripsMode ? trips.calcPrice : Number(body.calcPrice) > 0 ? Number(body.calcPrice) : null;
    let calcHourInterval: number | null = null;
    try {
      calcHourInterval = hoursRule ? parseHourInterval(body.calcHourInterval, true) : null;
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Informe o intervalo de horas." });
    }
    if (daysMode) {
      if (!(Number(body.calcDose) > 0) || calcPrice == null) {
        return res.status(400).json({ error: "Informe as horas por dia e o custo por hora." });
      }
    } else if (hoursMode) {
      if (hoursRule) {
        if (calcPrice == null) return res.status(400).json({ error: "Informe o custo por hora." });
        if (!(Number(body.calcDose) > 0)) {
          return res.status(400).json({ error: "Informe a quantidade." });
        }
      } else if (!(Number(body.calcDose) > 0) || calcPrice == null) {
        return res.status(400).json({ error: "Informe o custo por hora e a quantidade por hectare." });
      }
    }
    const calcDose = trips.tripsMode
      ? trips.calcDose
      : hoursRule
        ? Number(body.calcDose) > 0
          ? Number(body.calcDose)
          : 1
        : Number(body.calcDose) > 0
          ? Number(body.calcDose)
          : null;
    const calcAreaPremise = trips.tripsMode || daysMode
      ? trips.tripsMode
        ? trips.calcAreaPremise
        : null
      : materialOwnPremiseKey({
          calc_area_premise: typeof body.calcAreaPremise === "string" ? body.calcAreaPremise : null,
        });
    let calcApplications: number | null = null;
    try {
      calcApplications =
        trips.tripsMode || daysMode || hoursMode
          ? 1
          : calcDose != null && calcPrice != null
            ? resolveApplications(body.calcApplications)
            : null;
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Informe a quantidade de aplicações." });
    }
    const area =
      trips.tripsMode || daysMode
        ? { calcAreaPct: null as number | null, calcAreaHa: null as number | null }
        : parseMaterialArea(body);
    const excludeWeekdays = daysMode ? storeExcludeWeekdays(body.calcExcludeWeekdays ?? []) : null;
    const lineId = Number(
      db.prepare(
        `INSERT INTO lines (
           sheet_id, category_id, object_code, product_code, item_type, description, is_group, sort_order,
           activity_id, material_id, cost_object_id, ref_kind, parent_id, calc_dose, calc_price, calc_area_premise, calc_area_pct, calc_area_ha, calc_months, calc_applications, calc_direct, calc_kind, calc_trips, calc_machine_qty, calc_hour_interval, calc_exclude_weekdays
         ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'material', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        sheetId,
        categoryId,
        catalog.object_code ?? body.objectCode ?? null,
        catalog.product_code ?? body.productCode ?? null,
        catalog.item_type ?? body.itemType ?? null,
        (body.description?.trim() || mat?.description || "Material"),
        nextLineSort(categoryId),
        activityId,
        catalog.material_id,
        catalog.cost_object_id,
        parentId,
        calcDose,
        calcPrice,
        calcAreaPremise,
        area.calcAreaPct,
        area.calcAreaHa,
        storeCalcMonths(body.calcMonths),
        calcApplications,
        trips.tripsMode ? 0 : body.calcDirect === true || body.calcDirect === 1 ? 1 : 0,
        trips.calcKind,
        trips.calcTrips,
        trips.calcMachineQty,
        calcHourInterval,
        excludeWeekdays,
      ).lastInsertRowid,
    );
    if (calcPrice != null) setLineSafraPrice(lineId, calcPrice);
    const insertMonth = db.prepare("INSERT INTO line_months (line_id, month_index, formula, value) VALUES (?, ?, ?, ?)");
    const followActivity = calcDose != null && calcPrice != null;
    for (const m of body.months ?? []) {
      if (m.formula) insertMonth.run(lineId, m.month, m.formula, null);
      else if (!followActivity && m.value != null) insertMonth.run(lineId, m.month, null, JSON.stringify(m.value));
    }
  } else if (body.refKind === "cost_object") {
    const catalog = resolveLineCatalog({
      costObjectId: requestedCostObject,
      materialId: null,
      activityId: null,
      refKind: "cost_object",
      productCode: body.productCode ?? null,
    });
    const obj = requestedCostObject
      ? (db.prepare("SELECT description FROM cost_objects WHERE id = ?").get(requestedCostObject) as
          | { description: string }
          | undefined)
      : undefined;
    if (requestedCostObject && !obj) return res.status(400).json({ error: "Objeto de custo não encontrado." });
    let trips;
    try {
      trips = parseTripsCalc(body);
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Informe tonelada, viagens, máquinas e preço." });
    }
    const calcDose = trips.tripsMode ? trips.calcDose : Number(body.calcDose) > 0 ? Number(body.calcDose) : null;
    const calcPrice = trips.tripsMode ? trips.calcPrice : Number(body.calcPrice) > 0 ? Number(body.calcPrice) : null;
    const typedMonths = (body.months ?? [])
      .map((row) => ({ month: Number(row.month), value: Number(row.value), formula: row.formula }))
      .filter(
        (row) =>
          Number.isInteger(row.month) &&
          row.month >= 0 &&
          row.month <= 11 &&
          (Boolean(row.formula) || (Number.isFinite(row.value) && row.value > 0)),
      );
    const fixedOnly = !trips.tripsMode && calcDose == null && calcPrice == null && typedMonths.length > 0;
    const groupOnly =
      !trips.tripsMode &&
      calcDose == null &&
      calcPrice == null &&
      typedMonths.length === 0 &&
      Boolean(requestedCostObject) &&
      !String(body.productCode ?? "").trim();
    // Valor fixo ou só o objeto (grupo para equipamentos): linha própria; atividade pode ser ligada depois.
    const orphanFixed = (fixedOnly || groupOnly) && (!parentId || parentIsCenter);
    if (!parentId && !orphanFixed) {
      return res.status(400).json({ error: "Informe a atividade." });
    }
    const ownPremise =
      trips.tripsMode || fixedOnly || groupOnly
        ? null
        : materialOwnPremiseKey({
            calc_area_premise: typeof body.calcAreaPremise === "string" ? body.calcAreaPremise : null,
          });
    // Com premissa própria: custo/hora × qtd/ha × área da premissa (não horas da atividade).
    const hoursRule =
      trips.tripsMode || fixedOnly || groupOnly ? null : lookupActivityHoursRule(activityId, requestedCostObject);
    if (!fixedOnly && !groupOnly) {
      if (hoursRule) {
        if (calcPrice == null) {
          return res.status(400).json({ error: "Informe o custo por hora." });
        }
      } else if (calcDose == null || calcPrice == null) {
        return res.status(400).json({
          error: trips.tripsMode
            ? "Informe tonelada, viagens, máquinas e preço."
            : "Informe o custo por hora e a quantidade por hectare.",
        });
      }
    }
    let calcApplications: number | null = null;
    try {
      calcApplications = fixedOnly || groupOnly ? null : trips.tripsMode ? 1 : resolveApplications(body.calcApplications);
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Informe a quantidade de aplicações." });
    }
    const area = trips.tripsMode || fixedOnly || groupOnly
      ? { calcAreaPct: null as number | null, calcAreaHa: null as number | null }
      : parseMaterialArea(body);
    const calcAreaPremise = trips.tripsMode ? trips.calcAreaPremise : ownPremise;
    let calcHourInterval: number | null = null;
    try {
      calcHourInterval = hoursRule ? parseHourInterval(body.calcHourInterval, false) : null;
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Informe o intervalo de horas." });
    }
    if (orphanFixed && groupOnly && requestedCostObject) {
      const existingGroup = db
        .prepare(
          `SELECT id FROM lines
            WHERE category_id = ? AND cost_object_id = ? AND ref_kind = 'cost_object' AND is_group = 1
              AND (product_code IS NULL OR TRIM(product_code) = '')
              AND (
                (? IS NULL AND parent_id IS NULL) OR parent_id = ?
              )
            ORDER BY id
            LIMIT 1`,
        )
        .get(categoryId, requestedCostObject, parentId, parentId) as { id: number } | undefined;
      if (existingGroup) {
        invalidateWorkbook();
        await applyAutoCalcFull(null);
        persistLineValues(sheetId);
        return res.json(sheetDetail(sheetId, false));
      }
    }
    const lineId = Number(
      db.prepare(
        `INSERT INTO lines (
           sheet_id, category_id, object_code, product_code, item_type, description, is_group, sort_order,
           activity_id, material_id, cost_object_id, ref_kind, parent_id, calc_dose, calc_price, calc_area_premise, calc_area_pct, calc_area_ha, calc_months, calc_applications, calc_direct, calc_kind, calc_trips, calc_machine_qty, calc_hour_interval
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, 'cost_object', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      ).run(
        sheetId,
        categoryId,
        catalog.object_code ?? body.objectCode ?? null,
        catalog.product_code ?? body.productCode ?? null,
        body.description?.trim() || obj?.description || (fixedOnly || groupOnly ? "Objeto de custo" : trips.tripsMode ? "Viagens" : "Custo/hora"),
        orphanFixed ? 1 : 0,
        nextLineSort(categoryId),
        orphanFixed ? (activityId ?? null) : activityId,
        catalog.cost_object_id,
        parentId,
        fixedOnly || groupOnly ? null : hoursRule ? (calcDose ?? 1) : calcDose,
        fixedOnly || groupOnly ? null : calcPrice,
        calcAreaPremise,
        area.calcAreaPct,
        area.calcAreaHa,
        fixedOnly || groupOnly ? null : storeCalcMonths(body.calcMonths),
        calcApplications,
        fixedOnly || groupOnly ? null : trips.calcKind,
        fixedOnly || groupOnly ? null : trips.calcTrips,
        fixedOnly || groupOnly ? null : trips.calcMachineQty,
        fixedOnly || groupOnly ? null : calcHourInterval,
      ).lastInsertRowid,
    );
    if (!fixedOnly && !groupOnly && calcPrice != null) setLineSafraPrice(lineId, calcPrice);
    if (fixedOnly) {
      writeFixedActivityMonths(lineId, typedMonths);
    } else if (!groupOnly) {
      const insertHourMonth = db.prepare("INSERT INTO line_months (line_id, month_index, formula, value) VALUES (?, ?, ?, ?)");
      for (const m of typedMonths) {
        if (m.formula) {
          insertHourMonth.run(lineId, m.month, m.formula, null);
        }
      }
    }
  } else if (!body.parentLineId) {
    if (!parentId) return res.status(400).json({ error: "Atividade não encontrada." });
    let reducePct: number | null = null;
    try {
      reducePct =
        body.calcReducePct !== undefined
          ? resolveReducePct(body.calcReducePct)
          : ((
              db.prepare("SELECT calc_reduce_pct FROM lines WHERE id = ?").get(parentId) as
                | { calc_reduce_pct: number | null }
                | undefined
            )?.calc_reduce_pct ?? null);
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Informe a redução em percentual (0 a 100)." });
    }
    if (body.calcReducePct !== undefined) {
      db.prepare("UPDATE lines SET calc_reduce_pct = ? WHERE id = ?").run(reducePct, parentId);
    }
    if (Array.isArray(body.months) && !(Array.isArray(body.calcPlans) && body.calcPlans.length)) {
      writeFixedActivityMonths(parentId, body.months);
    }
  }

  invalidateWorkbook();
  await applyAutoCalcFull(null, {
    forceMaterials:
      Number(body.calcPrice) > 0 &&
      (Number(body.calcDose) > 0 || body.calcKind === "hours" || Boolean(lookupActivityHoursRule(activityId, requestedCostObject))),
    parentLineId: parentId,
  });
  persistLineValues(sheetId);
  res.json(sheetDetail(sheetId, false));
});

app.post("/api/sheets/:id/reconcile-equipment-obc", async (req, res) => {
  const sheetId = Number(req.params.id);
  const sheet = db.prepare("SELECT id FROM sheets WHERE id = ?").get(sheetId) as { id: number } | undefined;
  if (!sheet) return res.status(404).json({ error: "Aba não encontrada." });
  try {
    await applyAutoCalcFull(null, { strictObcSplit: true });
    persistLineValues(sheetId);
    res.json(sheetDetail(sheetId, false));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível repartir os equipamentos." });
  }
});

app.post("/api/sheets/:id/distribute-activity", (req, res) => {
  const currentSheetId = Number(req.params.id);
  const current = db.prepare("SELECT id FROM sheets WHERE id = ?").get(currentSheetId) as { id: number } | undefined;
  if (!current) return res.status(404).json({ error: "Aba não encontrada" });
  const body = req.body as {
    activityId?: number;
    totalValue?: number;
    sheetIds?: number[];
    months?: number[];
    categoryName?: string;
    catalogCategoryId?: number | null;
    costObjectId?: number | null;
    targets?: { sheetId?: number; costObjectId?: number | null }[];
  };
  const activityId = Number(body.activityId);
  const act = db.prepare("SELECT id, description FROM activities WHERE id = ?").get(activityId) as
    | { id: number; description: string }
    | undefined;
  if (!act) return res.status(400).json({ error: "Selecione a atividade." });
  const totalValue = Number(String(body.totalValue ?? "").toString().replace(",", "."));
  if (!(totalValue > 0)) return res.status(400).json({ error: "Informe o valor total." });
  const categoryName = (body.categoryName ?? "").trim();
  if (!categoryName) return res.status(400).json({ error: "Informe a categoria." });
  const targets = (body.targets?.length
    ? body.targets.map((row) => ({
        sheetId: Number(row.sheetId),
        costObjectId: row.costObjectId ? Number(row.costObjectId) : null,
      }))
    : (body.sheetIds ?? []).map((id) => ({
        sheetId: Number(id),
        costObjectId: body.costObjectId ? Number(body.costObjectId) : null,
      }))
  ).filter((row) => Number.isInteger(row.sheetId) && row.sheetId > 0);
  const seenSheets = new Set<number>();
  const uniqueTargets = targets.filter((row) => {
    if (seenSheets.has(row.sheetId)) return false;
    seenSheets.add(row.sheetId);
    return true;
  });
  if (!uniqueTargets.length) return res.status(400).json({ error: "Escolha pelo menos um centro de custo." });
  const months = [...new Set((body.months ?? []).map((m) => Number(m)).filter((m) => Number.isInteger(m) && m >= 0 && m <= 11))].sort(
    (a, b) => a - b,
  );
  if (!months.length) return res.status(400).json({ error: "Escolha pelo menos um mês." });
  const sheetIds = uniqueTargets.map((row) => row.sheetId);
  const centers = db
    .prepare(
      `SELECT id, title FROM sheets WHERE id IN (${sheetIds.map(() => "?").join(",")}) AND kind = 'cost_center'`,
    )
    .all(...sheetIds) as { id: number; title: string }[];
  if (centers.length !== sheetIds.length) {
    return res.status(400).json({ error: "Um dos centros de custo escolhidos não existe." });
  }
  const catalogCategoryId = body.catalogCategoryId ? Number(body.catalogCategoryId) : null;
  const perCenter = splitAmount(totalValue, uniqueTargets.length);
  try {
    const tx = db.transaction(() => {
      const distributionId = Number(
        db
          .prepare(
            `INSERT INTO value_distributions (
               created_at, safra_id, activity_id, activity_name, category_name, total_value, months
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            new Date().toISOString(),
            currentSafraId(),
            activityId,
            act.description,
            categoryName,
            totalValue,
            JSON.stringify(months),
          ).lastInsertRowid,
      );
      const insertLine = db.prepare(
        `INSERT INTO value_distribution_lines (distribution_id, sheet_id, line_id, created_line, previous_months)
         VALUES (?, ?, ?, ?, ?)`,
      );
      uniqueTargets.forEach((target, index) => {
        const categoryId = ensureCategoryOnSheet(target.sheetId, categoryName, catalogCategoryId);
        const existing = findActivityLine(categoryId, activityId, target.costObjectId);
        const lineId = existing?.id ?? createActivityLine(target.sheetId, categoryId, activityId, target.costObjectId);
        if (!lineId) throw new Error("Não foi possível incluir a atividade.");
        insertLine.run(
          distributionId,
          target.sheetId,
          lineId,
          existing ? 0 : 1,
          JSON.stringify(existing ? snapshotLineMonths(lineId) : []),
        );
        writeDistributedMonths(lineId, months, splitAmount(perCenter[index] ?? 0, months.length));
      });
    });
    tx();
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível distribuir o valor." });
  }
  invalidateWorkbook();
  applyAutoCalc();
  for (const sheetId of sheetIds) persistLineValues(sheetId);
  res.json(sheetDetail(currentSheetId, false));
});

app.delete("/api/sheets/:id/distributions/:distId", (req, res) => {
  const currentSheetId = Number(req.params.id);
  const distId = Number(req.params.distId);
  try {
    const sheetIds = undoValueDistribution(distId);
    invalidateWorkbook();
    applyAutoCalc();
    for (const sheetId of sheetIds) persistLineValues(sheetId);
    const detail = sheetDetail(currentSheetId, false);
    if (!detail) return res.status(404).json({ error: "Aba não encontrada" });
    res.json(detail);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Não foi possível desfazer a distribuição.";
    res.status(message === "Distribuição não encontrada." ? 404 : 400).json({ error: message });
  }
});

app.patch("/api/lines/:id", async (req, res) => {
  const id = Number(req.params.id);
  const line = db.prepare("SELECT * FROM lines WHERE id = ?").get(id) as
    | {
        sheet_id: number;
        description: string;
        object_code: string | null;
        product_code: string | null;
        item_type: string | null;
        activity_id: number | null;
        material_id: number | null;
        cost_object_id: number | null;
        ref_kind: string | null;
        parent_id: number | null;
        is_group: number;
        calc_months?: string | null;
        calc_applications?: number | null;
        calc_area_premise?: string | null;
        calc_kind?: string | null;
        calc_trips?: number | null;
        calc_machine_qty?: number | null;
        calc_hour_interval?: number | null;
      }
    | undefined;
  if (!line) return res.status(404).json({ error: "Linha não encontrada" });
  const body = req.body as {
    description?: string;
    objectCode?: string;
    productCode?: string;
    itemType?: string;
    activityId?: number | null;
    materialId?: number | null;
    costObjectId?: number | null;
    refKind?: "material" | "activity" | "cost_object" | null;
    useActivityAuto?: boolean;
    startMonth?: number | null;
    endMonth?: number | null;
    calcMonths?: number[] | null;
    calcPlans?: unknown;
    calcMode?: "area" | "days";
    calcPremise?: string | null;
    calcDose?: number | null;
    calcPrice?: number | null;
    calcExcludeWeekdays?: number[] | null;
    calcAreaPremise?: string | null;
    calcAreaPct?: number | null;
    calcReducePct?: number | null;
    calcAreaHa?: number | null;
    calcApplications?: number | null;
    calcDirect?: boolean | number;
    calcKind?: string | null;
    calcTrips?: number | null;
    calcMachineQty?: number | null;
    calcHourInterval?: number | null;
    months?: { month: number; value?: number; formula?: string }[];
    funcionarioApiConfig?: unknown;
  };

  const hasChildren = Boolean(db.prepare("SELECT 1 FROM lines WHERE parent_id = ? LIMIT 1").get(id));
  const isEquipmentHead = isEquipmentHeadLine(line);
  const isActivityHead =
    line.ref_kind === "activity" ||
    isEquipmentHead ||
    (!line.parent_id && (Boolean(line.is_group) && line.ref_kind !== "cost_center" || hasChildren));
  let nextRefKind = body.refKind !== undefined ? body.refKind : line.ref_kind;
  if (isEquipmentHead && nextRefKind !== "cost_object") nextRefKind = "cost_object";
  const nextProductCode = (() => {
    const requested = body.productCode !== undefined ? body.productCode : line.product_code;
    const code = String(requested ?? "").trim() || equipmentCodeFromDescription(line.description);
    return isEquipmentHead ? code || String(line.product_code ?? "").trim() : requested;
  })();
  const hourCostChild = Boolean(line.parent_id) && nextRefKind === "cost_object" && !isEquipmentHead;
  const inheritedCost = hourCostChild
    ? (body.costObjectId !== undefined ? body.costObjectId : line.cost_object_id)
    : line.parent_id
      ? ((db.prepare("SELECT cost_object_id FROM lines WHERE id = ?").get(line.parent_id) as { cost_object_id: number | null } | undefined)
          ?.cost_object_id ?? null)
      : isActivityHead
        ? (body.costObjectId !== undefined ? body.costObjectId : line.cost_object_id)
        : line.cost_object_id;

  const catalog = resolveLineCatalog({
    costObjectId: inheritedCost,
    materialId: body.materialId !== undefined ? body.materialId : line.material_id,
    activityId: body.activityId !== undefined ? body.activityId : line.activity_id,
    refKind: nextRefKind as "material" | "activity" | "cost_object" | null,
    itemType: body.itemType !== undefined ? body.itemType : line.item_type,
    productCode: nextProductCode,
  });

  db.prepare(
    `UPDATE lines SET
       description = COALESCE(?, description),
       object_code = ?,
       product_code = ?,
       item_type = ?,
       activity_id = ?,
       material_id = ?,
       cost_object_id = ?,
       ref_kind = ?
     WHERE id = ?`,
  ).run(
    isEquipmentHead && body.productCode === undefined ? null : body.description ?? null,
    catalog.object_code,
    catalog.product_code,
    catalog.item_type,
    catalog.activity_id,
    catalog.material_id,
    catalog.cost_object_id,
    catalog.ref_kind,
    id,
  );
  if (isActivityHead && body.costObjectId !== undefined) {
    syncActivityCostObject(id, catalog.cost_object_id);
  }
  if (isActivityHead && body.calcReducePct !== undefined) {
    try {
      db.prepare("UPDATE lines SET calc_reduce_pct = ? WHERE id = ?").run(resolveReducePct(body.calcReducePct), id);
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Informe a redução em percentual (0 a 100)." });
    }
  }
  if (
    isActivityHead &&
    (body.useActivityAuto !== undefined ||
      body.startMonth !== undefined ||
      body.endMonth !== undefined ||
      body.calcMonths !== undefined ||
      body.calcPlans !== undefined ||
      body.calcMode !== undefined ||
      body.calcPremise !== undefined ||
      body.calcDose !== undefined ||
      body.calcPrice !== undefined ||
      body.calcExcludeWeekdays !== undefined ||
      body.calcAreaPremise !== undefined ||
      body.calcAreaPct !== undefined ||
      body.months !== undefined)
  ) {
    let calcReducePct: number | null;
    try {
      calcReducePct =
        body.calcReducePct !== undefined
          ? resolveReducePct(body.calcReducePct)
          : ((
              db.prepare("SELECT calc_reduce_pct FROM lines WHERE id = ?").get(id) as
                | { calc_reduce_pct: number | null }
                | undefined
            )?.calc_reduce_pct ?? null);
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Informe a redução em percentual (0 a 100)." });
    }
    const current = db
      .prepare(
        `SELECT use_activity_auto, start_month, end_month, calc_months, calc_plans, calc_premise, calc_dose, calc_price, calc_exclude_weekdays, calc_area_premise, calc_area_pct
         FROM lines WHERE id = ?`,
      )
      .get(id) as {
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
    };
    const calc = resolveLineCalc({
      useActivityAuto: body.useActivityAuto !== undefined ? body.useActivityAuto !== false : current.use_activity_auto !== 0,
      activityId: line.activity_id,
      costObjectId: body.costObjectId !== undefined ? body.costObjectId : line.cost_object_id,
      startMonth: body.startMonth !== undefined ? body.startMonth : current.start_month,
      endMonth: body.endMonth !== undefined ? body.endMonth : current.end_month,
      calcMonths: body.calcMonths !== undefined ? body.calcMonths : current.calc_months,
      calcPlans: body.calcPlans !== undefined ? body.calcPlans : current.calc_plans,
      calcMode: body.calcMode,
      calcPremise: body.calcPremise !== undefined ? body.calcPremise : current.calc_premise,
      calcDose: body.calcDose !== undefined ? body.calcDose : current.calc_dose,
      calcPrice: body.calcPrice !== undefined ? body.calcPrice : current.calc_price,
      calcExcludeWeekdays:
        body.calcExcludeWeekdays !== undefined
          ? body.calcExcludeWeekdays
          : parseExcludeWeekdays(current.calc_exclude_weekdays),
      calcAreaPremise: body.calcAreaPremise !== undefined ? body.calcAreaPremise : current.calc_area_premise,
      calcAreaPct: body.calcAreaPct !== undefined ? body.calcAreaPct : current.calc_area_pct,
    });
    db.prepare(
      `UPDATE lines
       SET use_activity_auto = ?, start_month = ?, end_month = ?, calc_months = ?, calc_premise = ?, calc_dose = ?, calc_price = ?, calc_exclude_weekdays = ?, calc_area_premise = ?, calc_area_pct = ?, calc_plans = ?, calc_reduce_pct = ?
       WHERE id = ?`,
    ).run(
      calc.useActivityAuto ? 1 : 0,
      calc.startMonth,
      calc.endMonth,
      calc.calcMonths,
      calc.calcPremise,
      calc.calcDose,
      calc.calcPrice,
      calc.calcExcludeWeekdays,
      calc.calcAreaPremise,
      calc.calcAreaPct,
      calc.calcPlans,
      calcReducePct,
      id,
    );
    const savedPlans = parseCalcPlans(calc.calcPlans);
    const onlyFixedPlans = savedPlans.length > 0 && savedPlans.every((plan) => plan.mode === "fixed");
    if (Array.isArray(body.months) && (!calc.calcPlans || onlyFixedPlans)) {
      writeFixedActivityMonths(id, body.months);
    } else if (calc.calcPlans) {
      db.prepare("DELETE FROM line_months WHERE line_id = ?").run(id);
    }
  }
  const isMaterial =
    !isActivityHead &&
    (Boolean(line.parent_id) || line.ref_kind === "material" || line.ref_kind === "cost_object");
  if (
    isMaterial &&
    (body.calcDose !== undefined ||
      body.calcPrice !== undefined ||
      body.calcAreaPremise !== undefined ||
      body.calcAreaPct !== undefined ||
      body.calcAreaHa !== undefined ||
      body.calcMonths !== undefined ||
      body.calcApplications !== undefined ||
      body.calcDirect !== undefined ||
      body.calcKind !== undefined ||
      body.calcTrips !== undefined ||
      body.calcMachineQty !== undefined ||
      body.calcHourInterval !== undefined ||
      body.calcExcludeWeekdays !== undefined)
  ) {
    let trips;
    try {
      trips = parseTripsCalc({
        calcKind: body.calcKind !== undefined ? body.calcKind : line.calc_kind,
        calcTrips: body.calcTrips !== undefined ? body.calcTrips : line.calc_trips,
        calcMachineQty: body.calcMachineQty !== undefined ? body.calcMachineQty : line.calc_machine_qty,
        calcDose: body.calcDose,
        calcPrice: body.calcPrice,
        calcAreaPremise: body.calcAreaPremise !== undefined ? body.calcAreaPremise : line.calc_area_premise,
      });
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Informe tonelada, viagens, máquinas e preço." });
    }
    const dose = trips.tripsMode ? trips.calcDose : Number(body.calcDose) > 0 ? Number(body.calcDose) : null;
    const price = trips.tripsMode ? trips.calcPrice : Number(body.calcPrice) > 0 ? Number(body.calcPrice) : null;
    const daysMode = trips.calcKind === "days";
    const area =
      trips.tripsMode || daysMode
        ? { calcAreaPct: null as number | null, calcAreaHa: null as number | null }
        : parseMaterialArea(body);
    const calcAreaPremise = trips.tripsMode
      ? trips.calcAreaPremise
      : daysMode
        ? null
      : body.calcAreaPremise !== undefined
        ? materialOwnPremiseKey({
            calc_area_premise: typeof body.calcAreaPremise === "string" ? body.calcAreaPremise : null,
          })
        : line.calc_area_premise ?? null;
    const hoursMode = hourCostChild || trips.calcKind === "hours";
    const hoursRule =
      hoursMode && !trips.tripsMode && !materialOwnPremiseKey({ calc_area_premise: calcAreaPremise })
        ? lookupActivityHoursRule(line.activity_id, inheritedCost)
        : null;
    let calcHourInterval: number | null = null;
    try {
      if (hoursRule) {
        calcHourInterval =
          body.calcHourInterval !== undefined
            ? parseHourInterval(body.calcHourInterval, line.ref_kind === "material")
            : Number(line.calc_hour_interval) > 0
              ? Number(line.calc_hour_interval)
              : null;
      }
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Informe o intervalo de horas." });
    }
    if (daysMode) {
      if (!(dose != null && dose > 0) || price == null) {
        return res.status(400).json({ error: "Informe as horas por dia e o custo por hora." });
      }
    } else if (hoursRule) {
      if (price == null) {
        return res.status(400).json({ error: "Informe o custo por hora." });
      }
      if (
        line.ref_kind === "material" &&
        body.calcDose !== undefined &&
        !(dose != null && dose > 0)
      ) {
        return res.status(400).json({ error: "Informe a quantidade." });
      }
    } else if (!(dose != null && price != null)) {
      return res.status(400).json({
        error: body.calcDirect
          ? "Informe o preço do custo direto."
          : hoursMode
            ? "Informe o custo por hora e a quantidade por hectare."
            : "Informe o preço e a quantidade do material.",
      });
    }
    const excludeWeekdays = daysMode
      ? storeExcludeWeekdays(
          body.calcExcludeWeekdays !== undefined
            ? body.calcExcludeWeekdays
            : parseExcludeWeekdays(line.calc_exclude_weekdays),
        )
      : null;
    db.prepare(
      "UPDATE lines SET calc_dose = ?, calc_price = ?, calc_area_premise = ?, calc_area_pct = ?, calc_area_ha = ?, calc_months = ?, calc_applications = ?, calc_direct = ?, calc_kind = ?, calc_trips = ?, calc_machine_qty = ?, calc_hour_interval = ?, calc_exclude_weekdays = ? WHERE id = ?",
    ).run(
      hoursRule ? (dose ?? 1) : dose,
      price,
      calcAreaPremise,
      area.calcAreaPct,
      area.calcAreaHa,
      body.calcMonths !== undefined ? storeCalcMonths(body.calcMonths) : line.calc_months ?? null,
      trips.tripsMode || daysMode || hoursMode
        ? 1
        : body.calcApplications !== undefined
          ? resolveApplications(body.calcApplications)
          : line.calc_applications ?? 1,
      trips.tripsMode ? 0 : body.calcDirect === true || body.calcDirect === 1 ? 1 : 0,
      trips.calcKind,
      trips.calcTrips,
      trips.calcMachineQty,
      calcHourInterval,
      excludeWeekdays,
      id,
    );
    setLineSafraPrice(id, price);
  }
  if (body.funcionarioApiConfig !== undefined) {
    const config = parseFuncionarioApiConfig(body.funcionarioApiConfig);
    if (body.funcionarioApiConfig != null && !config) {
      return res.status(400).json({
        error: "Configuração da API inválida. Informe safra externa e ao menos um subprocesso selecionado.",
      });
    }
    db.prepare("UPDATE lines SET funcionario_api_config = ?, use_activity_auto = 0 WHERE id = ?").run(
      serializeFuncionarioApiConfig(config),
      id,
    );
    if (config?.enabled) {
      try {
        await applyFuncionarioApiToLine(id, config);
      } catch (e) {
        return res.status(400).json({
          error: e instanceof Error ? e.message : "Não foi possível aplicar os valores da API.",
        });
      }
    }
  }
  invalidateWorkbook();
  const reduceOnly =
    isActivityHead &&
    body.calcReducePct !== undefined &&
    Object.keys(body).every((key) => key === "calcReducePct" || body[key as keyof typeof body] === undefined);
  try {
    if (!reduceOnly) {
      await applyAutoCalcFull(null, {
        forceMaterials: isMaterial &&
          (body.calcDose !== undefined ||
            body.calcPrice !== undefined ||
            body.calcAreaPremise !== undefined ||
            body.calcAreaPct !== undefined ||
            body.calcAreaHa !== undefined ||
            body.calcMonths !== undefined ||
            body.calcApplications !== undefined ||
            body.calcDirect !== undefined ||
            body.calcKind !== undefined ||
            body.calcTrips !== undefined ||
            body.calcMachineQty !== undefined ||
            body.calcHourInterval !== undefined),
        parentLineId: line.parent_id,
      });
    }
    persistLineValues(line.sheet_id);
    res.json(sheetDetail(line.sheet_id, false));
  } catch (e) {
    return res.status(400).json({
      error: e instanceof Error ? e.message : "Não foi possível recalcular o orçamento.",
    });
  }
});

app.delete("/api/lines/:id", (req, res) => {
  const id = Number(req.params.id);
  const line = db.prepare("SELECT sheet_id FROM lines WHERE id = ?").get(id) as { sheet_id: number } | undefined;
  if (!line) return res.status(404).json({ error: "Linha não encontrada" });
  deleteLineTree(id);
  invalidateWorkbook();
  applyAutoCalc();
  persistLineValues(line.sheet_id);
  res.json(sheetDetail(line.sheet_id, false));
});

app.put("/api/lines/:id/months/:month", (req, res) => {
  const id = Number(req.params.id);
  const month = Number(req.params.month);
  const line = db.prepare("SELECT sheet_id, parent_id, ref_kind, is_group FROM lines WHERE id = ?").get(id) as
    | { sheet_id: number; parent_id: number | null; ref_kind: string | null; is_group: number }
    | undefined;
  if (!line) return res.status(404).json({ error: "Linha não encontrada" });
  let { value, formula } = req.body as { value?: number | null; formula?: string | null };
  const isHead = !line.parent_id && (line.ref_kind === "activity" || Boolean(line.is_group));
  if (isHead && !formula && value != null && value !== 0) formula = `=${value}`;
  db.prepare("DELETE FROM line_months WHERE line_id = ? AND month_index = ?").run(id, month);
  if (formula) {
    db.prepare("INSERT INTO line_months (line_id, month_index, formula, value) VALUES (?, ?, ?, ?)").run(
      id,
      month,
      formula,
      null,
    );
  } else if (value != null && value !== 0) {
    db.prepare("INSERT INTO line_months (line_id, month_index, formula, value) VALUES (?, ?, ?, ?)").run(
      id,
      month,
      null,
      JSON.stringify(value),
    );
  }
  if (isHead && formula && formula !== "=AUTOCALC") {
    db.prepare("UPDATE lines SET use_activity_auto = 0 WHERE id = ?").run(id);
  }
  invalidateWorkbook();
  persistLineValues(line.sheet_id);
  res.json(sheetDetail(line.sheet_id, false));
});

app.put("/api/premissas/cell", (req, res) => {
  const { row, col, input } = req.body as { row: number; col: number; input: string };
  const sheet = db.prepare("SELECT id FROM sheets WHERE name = 'PREMISSAS'").get() as { id: number };
  const trimmed = String(input ?? "").trim();
  db.prepare("DELETE FROM cells WHERE sheet_id = ? AND row = ? AND col = ?").run(sheet.id, row, col);
  if (trimmed !== "") {
    if (trimmed.startsWith("=")) {
      db.prepare("INSERT INTO cells (sheet_id, row, col, formula, value) VALUES (?, ?, ?, ?, ?)").run(
        sheet.id,
        row,
        col,
        trimmed,
        null,
      );
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
      const iso = toIsoDay(trimmed);
      if (!iso) return res.status(400).json({ error: "Data inválida. Use 01/07/2027 ou 2027-07-01." });
      db.prepare("INSERT INTO cells (sheet_id, row, col, formula, value) VALUES (?, ?, ?, ?, ?)").run(
        sheet.id,
        row,
        col,
        null,
        JSON.stringify({ t: "date", v: `${iso}T00:00:00` }),
      );
    } else if (/^-?\d+([.,]\d+)?$/.test(trimmed)) {
      db.prepare("INSERT INTO cells (sheet_id, row, col, formula, value) VALUES (?, ?, ?, ?, ?)").run(
        sheet.id,
        row,
        col,
        null,
        JSON.stringify(Number(trimmed.replace(",", "."))),
      );
    } else {
      db.prepare("INSERT INTO cells (sheet_id, row, col, formula, value) VALUES (?, ?, ?, ?, ?)").run(
        sheet.id,
        row,
        col,
        null,
        JSON.stringify(trimmed),
      );
    }
  }
  if (row === 8 && col === 3) {
    db.prepare("DELETE FROM cells WHERE sheet_id = ? AND row = 8 AND col = 2").run(sheet.id);
    db.prepare("INSERT INTO cells (sheet_id, row, col, formula, value) VALUES (?, 8, 2, NULL, ?)").run(
      sheet.id,
      JSON.stringify(Number(trimmed.replace(",", ".")) || 0),
    );
  }
  invalidateWorkbook();
  applyPremissaDistribution(sheet.id);
  invalidateWorkbook();
  applyAutoCalc();
  persistAllValues();
  res.json(premissasKpis());
});

app.post("/api/reset", (_req, res) => {
  if (budgetCloudEnabled()) {
    return res.status(409).json({ error: "O orçamento está no Supabase. A restauração de dados locais foi desativada." });
  }
  const result = importFromJson(true);
  seedCatalogs();
  invalidateWorkbook();
  res.json(result);
});

loadEnvFile();

const distDir = join(process.cwd(), "dist");
if (existsSync(join(distDir, "index.html"))) {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) return next();
    res.sendFile(join(distDir, "index.html"));
  });
}

// 8789 evita conflito com OpenIP (server.mjs em 127.0.0.1:8787) e com o Controle Agricola.
const port = Number(process.env.PLANEJAMENTO_API_PORT ?? process.env.PORT ?? 8789);
const host = process.env.HOST ?? "0.0.0.0";
app.listen(port, host, () => {
  const frontend = existsSync(join(distDir, "index.html"))
    ? ` | app em http://localhost:${port}`
    : "";
  console.log(`API ${budgetCloudEnabled() ? "Supabase (cálculo em memória)" : "SQLite"} em http://localhost:${port}${frontend}`);
});
