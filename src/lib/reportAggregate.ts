export type PremiseOption = { key: string; label: string };

export type BudgetContribution = {
  premiseKey: string;
  sheetId: number;
  sheetTitle: string;
  category: string;
  activityKey: string;
  activityLabel: string;
  objectKey: string;
  objectLabel: string;
  months: number[];
  kind?: "activity" | "material" | "line";
  materialKey?: string | null;
  materialLabel?: string | null;
  grupo?: string | null;
  qtyHa?: number | null;
  rateHa?: number | null;
  shareRateHa?: number | null;
  areaHa?: number | null;
  areaPct?: number | null;
  applications?: number | null;
};

export type RealizadoObject = {
  sheetId: number | null;
  sheetTitle?: string;
  key: string;
  label: string;
  months: number[];
};

export type RealizadoActivitySource = {
  key: string;
  label: string;
  months: number[];
};

export type RealizadoActivity = {
  key: string;
  label: string;
  months: number[];
  sources?: RealizadoActivitySource[];
};

export type ResumoViewRow = {
  key: string;
  label: string;
  months: number[];
  total: number;
  sheetId?: number;
};

export type CompareViewRow = {
  key: string;
  label: string;
  sheetId?: number;
  origin?: boolean;
  orcadoAnnualOnly?: boolean;
  tons?: number;
  orcado: number[];
  realizado: number[];
  variacao: number[];
  orcadoTotal: number;
  realizadoTotal: number;
  variacaoTotal: number;
  sources?: CompareViewRow[];
};

const N = 12;

export function zeros(n = N) {
  return Array.from({ length: n }, () => 0);
}

function addMonths(target: number[], source: number[]) {
  for (let i = 0; i < N; i++) target[i] += source[i] ?? 0;
}

function sumMonths(months: number[]) {
  return months.reduce((acc, value) => acc + (value || 0), 0);
}

function money(n: number) {
  return Math.round((n || 0) * 100) / 100;
}

export function costCenterKey(sheetId: number) {
  return `cc-${sheetId}`;
}

export function categoryKey(name: string) {
  return name.trim().toUpperCase() || "SEM-CATEGORIA";
}

export const SEM_GRUPO_KEY = "SEM-GRUPO";

export function groupKey(name?: string | null) {
  const trimmed = (name ?? "").trim();
  return trimmed ? trimmed.toUpperCase() : SEM_GRUPO_KEY;
}

function activityId(row: BudgetContribution) {
  return `${row.sheetId}::${row.activityKey}`;
}

export function activityFilterKey(row: BudgetContribution) {
  return activityId(row);
}

export function rollupContributions(rows: BudgetContribution[]) {
  const covered = new Set(
    rows.filter((row) => row.kind === "activity").map((row) => activityId(row)),
  );
  return rows.filter((row) => row.kind !== "material" || !covered.has(activityId(row)));
}

export function filterContributions(
  rows: BudgetContribution[],
  selected: string[],
  selectedCategories: string[] = [],
  selectedGroups: string[] = [],
  selectedPremises: string[] = [],
  selectedActivities: string[] = [],
) {
  let out = rows;
  if (selected.length) {
    const wanted = new Set(selected);
    out = out.filter((row) => wanted.has(costCenterKey(row.sheetId)));
  }
  if (selectedCategories.length) {
    const wanted = new Set(selectedCategories);
    out = out.filter((row) => wanted.has(categoryKey(row.category)));
  }
  if (selectedGroups.length) {
    const wanted = new Set(selectedGroups);
    const withMaterials = new Set(out.filter((row) => row.kind === "material").map((row) => activityId(row)));
    out = out.filter((row) => {
      if (row.kind === "material" || row.kind === "line") return wanted.has(groupKey(row.grupo));
      if (row.kind === "activity" && wanted.has(SEM_GRUPO_KEY) && !withMaterials.has(activityId(row))) return true;
      return false;
    });
  }
  if (selectedActivities.length) {
    const wanted = new Set(selectedActivities);
    out = out.filter(
      (row) => wanted.has(row.activityKey) || wanted.has(activityId(row)),
    );
  }
  if (selectedPremises.length) {
    const wanted = new Set(selectedPremises);
    out = out.filter((row) => wanted.has(row.premiseKey || "none"));
  }
  return out;
}

export function usedCostCenters(rows: BudgetContribution[], realizado: RealizadoObject[] = []): PremiseOption[] {
  const seen = new Map<string, PremiseOption>();
  for (const row of rows) {
    const key = costCenterKey(row.sheetId);
    if (!seen.has(key)) seen.set(key, { key, label: row.sheetTitle });
  }
  for (const row of realizado) {
    if (row.sheetId == null) continue;
    const key = costCenterKey(row.sheetId);
    if (!seen.has(key)) seen.set(key, { key, label: row.sheetTitle || `Centro ${row.sheetId}` });
  }
  return [...seen.values()];
}

export function usedCategories(rows: BudgetContribution[]): PremiseOption[] {
  const seen = new Map<string, PremiseOption>();
  for (const row of rows) {
    const key = categoryKey(row.category);
    if (!seen.has(key)) seen.set(key, { key, label: row.category.trim() || "Sem categoria" });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

/** Atividades do orçamento (centro + atividade) para filtro do relatório consolidado. */
export function usedActivities(rows: BudgetContribution[]): PremiseOption[] {
  const seen = new Map<string, PremiseOption>();
  for (const row of rows) {
    if (!row.activityKey) continue;
    const key = activityId(row);
    if (seen.has(key)) continue;
    const act = row.activityLabel?.trim() || row.activityKey;
    const center = row.sheetTitle?.trim();
    seen.set(key, { key, label: center ? `${act} — ${center}` : act });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

/** Atividades associadas ao realizado (para filtro do Orçado x realizado). */
export function usedAssociatedActivities(
  rows: BudgetContribution[],
  realizadoByActivity: RealizadoActivity[] = [],
): PremiseOption[] {
  const associated = new Map(realizadoByActivity.map((row) => [row.key, row.label]));
  const seen = new Map<string, PremiseOption>();
  for (const row of rows) {
    if (!associated.has(row.activityKey)) continue;
    if (!seen.has(row.activityKey)) {
      seen.set(row.activityKey, {
        key: row.activityKey,
        label: row.activityLabel || associated.get(row.activityKey) || row.activityKey,
      });
    }
  }
  for (const [key, label] of associated) {
    if (!seen.has(key)) {
      const hasRealizado = (realizadoByActivity.find((row) => row.key === key)?.months ?? []).some(Boolean);
      if (!hasRealizado) continue;
      seen.set(key, { key, label: label || key });
    }
  }
  return [...seen.values()]
    .filter((item) => {
      const hasRealizado = (realizadoByActivity.find((row) => row.key === item.key)?.months ?? []).some(Boolean);
      const hasOrcado = rows.some(
        (row) => row.activityKey === item.key && row.months.some((value) => Math.abs(value) > 0),
      );
      return hasRealizado || hasOrcado;
    })
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

export function usedSubprocesses(
  rows: BudgetContribution[],
  catalog: PremiseOption[] = [],
): PremiseOption[] {
  const labels = new Map(catalog.map((item) => [item.key, item.label]));
  const seen = new Map<string, PremiseOption>();
  for (const row of rows) {
    const key = row.premiseKey || "none";
    if (seen.has(key)) continue;
    seen.set(key, {
      key,
      label: labels.get(key) ?? (key === "none" ? "Sem subprocesso" : key),
    });
  }
  return [...seen.values()].sort((a, b) => {
    const rank = (key: string) => (key === "none" ? 1 : 0);
    const diff = rank(a.key) - rank(b.key);
    if (diff) return diff;
    return a.label.localeCompare(b.label, "pt-BR");
  });
}

export function usedGroups(rows: BudgetContribution[]): PremiseOption[] {
  const seen = new Map<string, PremiseOption>();
  const withMaterials = new Set(rows.filter((row) => row.kind === "material").map((row) => activityId(row)));
  for (const row of rows) {
    if (row.kind === "material" || row.kind === "line") {
      const key = groupKey(row.grupo);
      if (!seen.has(key)) seen.set(key, { key, label: row.grupo?.trim() || "Sem grupo" });
      continue;
    }
    if (row.kind === "activity" && !withMaterials.has(activityId(row))) {
      if (!seen.has(SEM_GRUPO_KEY)) seen.set(SEM_GRUPO_KEY, { key: SEM_GRUPO_KEY, label: "Sem grupo" });
    }
  }
  return [...seen.values()].sort((a, b) => {
    if (a.key === SEM_GRUPO_KEY) return 1;
    if (b.key === SEM_GRUPO_KEY) return -1;
    return a.label.localeCompare(b.label, "pt-BR");
  });
}

export type ResumoMetrics = {
  qtyHa: number | null;
  rateHa: number | null;
  areaHa: number | null;
  areaPct: number | null;
  applications: number | null;
};

export type ResumoMaterial = {
  key: string;
  label: string;
  grupo: string | null;
  months: number[];
  total: number;
} & ResumoMetrics;

export type ResumoActivityNode = {
  key: string;
  label: string;
  category: string;
  months: number[];
  total: number;
  materials: ResumoMaterial[];
} & ResumoMetrics;

export type ResumoCenterNode = {
  key: string;
  sheetId: number;
  label: string;
  months: number[];
  total: number;
  activities: ResumoActivityNode[];
};

export type ResumoActivityByCategoryNode = {
  key: string;
  label: string;
  months: number[];
  total: number;
  activities: Array<{
    key: string;
    label: string;
    months: number[];
    total: number;
  }>;
};

const emptyMetrics = (): ResumoMetrics => ({
  qtyHa: null,
  rateHa: null,
  areaHa: null,
  areaPct: null,
  applications: null,
});

export function buildResumoTree(rows: BudgetContribution[]): ResumoCenterNode[] {
  const centers = new Map<number, ResumoCenterNode>();
  const activities = new Map<string, ResumoActivityNode>();

  const centerOf = (row: BudgetContribution) => {
    const current = centers.get(row.sheetId) ?? {
      key: costCenterKey(row.sheetId),
      sheetId: row.sheetId,
      label: row.sheetTitle,
      months: zeros(),
      total: 0,
      activities: [],
    };
    centers.set(row.sheetId, current);
    return current;
  };

  const activityOf = (row: BudgetContribution) => {
    const id = `${row.sheetId}::${row.activityKey}`;
    const current = activities.get(id) ?? {
      key: id,
      label: row.activityLabel,
      category: row.category || "Sem categoria",
      months: zeros(),
      total: 0,
      materials: [],
      ...emptyMetrics(),
    };
    if (!activities.has(id)) centerOf(row).activities.push(current);
    activities.set(id, current);
    return current;
  };

  for (const row of rollupContributions(rows)) {
    const activity = activityOf(row);
    addMonths(activity.months, row.months);
    activity.label = row.activityLabel || activity.label;
    activity.category = row.category || activity.category;
    if (row.kind === "material") continue;
    if (row.qtyHa != null) activity.qtyHa = row.qtyHa;
    if (row.areaHa != null) activity.areaHa = row.areaHa;
    if (row.areaPct != null) activity.areaPct = row.areaPct;
    if (row.applications != null) activity.applications = row.applications;
  }

  for (const row of rows) {
    if (row.kind !== "material") continue;
    const months = row.months.some((value) => value) ? row.months : zeros();
    if (!months.some((value) => value)) continue;
    const activity = activityOf(row);
    activity.materials.push({
      key: row.materialKey || `${row.sheetId}::${row.activityKey}::${row.materialLabel ?? "mat"}`,
      label: row.materialLabel || "Material",
      grupo: row.grupo?.trim() || null,
      months: [...months],
      total: sumMonths(months),
      qtyHa: row.qtyHa ?? null,
      rateHa: row.rateHa ?? null,
      areaHa: row.areaHa ?? null,
      areaPct: row.areaPct ?? null,
      applications: row.applications ?? null,
    });
  }

  const tree = [...centers.values()].map((center) => {
    center.activities = center.activities
      .map((activity) => {
        activity.total = sumMonths(activity.months);
        activity.materials.sort((a, b) => b.total - a.total);
        const ha = Number(activity.areaHa);
        activity.rateHa = activity.total > 0 && ha > 0 ? activity.total / ha : null;
        return activity;
      })
      .filter((activity) => activity.total || activity.materials.length)
      .sort((a, b) => b.total - a.total);
    center.months = zeros();
    for (const activity of center.activities) addMonths(center.months, activity.months);
    center.total = sumMonths(center.months);
    return center;
  });

  return tree.filter((center) => center.total).sort((a, b) => b.total - a.total);
}

/** Agrupa atividades por categoria (mesma atividade sob a mesma categoria soma entre centros). */
export function buildResumoActivityByCategory(rows: BudgetContribution[]): ResumoActivityByCategoryNode[] {
  const categories = new Map<string, ResumoActivityByCategoryNode>();
  const activities = new Map<string, ResumoActivityByCategoryNode["activities"][number]>();

  for (const row of rollupContributions(rows)) {
    const catKey = categoryKey(row.category);
    const cat =
      categories.get(catKey) ??
      ({
        key: catKey,
        label: row.category.trim() || "Sem categoria",
        months: zeros(),
        total: 0,
        activities: [],
      } satisfies ResumoActivityByCategoryNode);
    if (!categories.has(catKey)) categories.set(catKey, cat);

    const actId = `${catKey}::${row.activityKey}`;
    let act = activities.get(actId);
    if (!act) {
      act = { key: actId, label: row.activityLabel, months: zeros(), total: 0 };
      activities.set(actId, act);
      cat.activities.push(act);
    }
    addMonths(act.months, row.months);
    act.label = row.activityLabel || act.label;
  }

  return [...categories.values()]
    .map((cat) => {
      cat.activities = cat.activities
        .map((act) => ({ ...act, total: sumMonths(act.months) }))
        .filter((act) => act.total)
        .sort((a, b) => b.total - a.total);
      cat.months = zeros();
      for (const act of cat.activities) addMonths(cat.months, act.months);
      cat.total = sumMonths(cat.months);
      return cat;
    })
    .filter((cat) => cat.total)
    .sort((a, b) => b.total - a.total);
}

function filterRealizado(rows: RealizadoObject[], selected: string[]) {
  if (!selected.length) return rows;
  const wanted = new Set(selected);
  return rows.filter((row) => row.sheetId != null && wanted.has(costCenterKey(row.sheetId)));
}

function finishResumo(
  map: Map<string, { key: string; label: string; months: number[]; sheetId?: number }>,
): ResumoViewRow[] {
  return [...map.values()]
    .map((row) => ({ ...row, total: sumMonths(row.months) }))
    .filter((row) => row.total)
    .sort((a, b) => b.total - a.total);
}

function addResumo(
  map: Map<string, { key: string; label: string; months: number[]; sheetId?: number }>,
  key: string,
  label: string,
  months: number[],
  sheetId?: number,
) {
  const row = map.get(key) ?? { key, label, months: zeros(), sheetId };
  addMonths(row.months, months);
  if (sheetId != null && row.sheetId == null) row.sheetId = sheetId;
  map.set(key, row);
}

export function aggregateResumo(contributions: BudgetContribution[], premiseLabels: PremiseOption[] = []) {
  const rows = rollupContributions(contributions);
  const byCostCenter = new Map<string, { key: string; label: string; months: number[]; sheetId?: number }>();
  const byCategory = new Map<string, { key: string; label: string; months: number[]; sheetId?: number }>();
  const byActivity = new Map<string, { key: string; label: string; months: number[]; sheetId?: number }>();
  const bySubprocess = new Map<string, { key: string; label: string; months: number[]; sheetId?: number }>();
  const labels = new Map(premiseLabels.map((item) => [item.key, item.label]));

  for (const row of rows) {
    addResumo(byCostCenter, `cc-${row.sheetId}`, row.sheetTitle, row.months, row.sheetId);
    addResumo(byCategory, categoryKey(row.category), row.category || "Sem categoria", row.months);
    addResumo(byActivity, row.activityKey, row.activityLabel, row.months);
    const premiseKey = row.premiseKey || "none";
    addResumo(
      bySubprocess,
      premiseKey,
      labels.get(premiseKey) ?? (premiseKey === "none" ? "Sem subprocesso" : premiseKey),
      row.months,
    );
  }

  const costCenter = finishResumo(byCostCenter);
  const totals = zeros();
  for (const row of costCenter) addMonths(totals, row.months);
  const total = sumMonths(totals);

  return {
    views: {
      costCenter,
      category: finishResumo(byCategory),
      activity: finishResumo(byActivity),
      subprocess: finishResumo(bySubprocess),
    },
    totals,
    total,
    rows: costCenter.map((row) => ({
      sheetId: row.sheetId ?? 0,
      name: row.key,
      title: row.label,
      months: row.months,
      total: row.total,
    })),
  };
}

type AmountRow = {
  key: string;
  label: string;
  sheetId?: number;
  orcado: number[];
  realizado: number[];
  sources?: Map<string, AmountRow>;
};

function addOrcado(map: Map<string, AmountRow>, key: string, label: string, months: number[], sheetId?: number) {
  const row = map.get(key) ?? { key, label, sheetId, orcado: zeros(), realizado: zeros() };
  addMonths(row.orcado, months);
  if (sheetId != null && row.sheetId == null) row.sheetId = sheetId;
  map.set(key, row);
}

function addRealizado(map: Map<string, AmountRow>, key: string, label: string, months: number[], sheetId?: number) {
  const row = map.get(key) ?? { key, label, sheetId, orcado: zeros(), realizado: zeros() };
  addMonths(row.realizado, months);
  if (sheetId != null && row.sheetId == null) row.sheetId = sheetId;
  map.set(key, row);
}

function finishCompare(map: Map<string, AmountRow>): CompareViewRow[] {
  return [...map.values()]
    .map((row) => {
      const orcado = row.orcado.map(money);
      const realizado = row.realizado.map(money);
      const variacao = orcado.map((value, i) => money((realizado[i] ?? 0) - value));
      const orcadoTotal = money(sumMonths(orcado));
      const realizadoTotal = money(sumMonths(realizado));
      return {
        ...row,
        orcado,
        realizado,
        variacao,
        orcadoTotal,
        realizadoTotal,
        variacaoTotal: money(realizadoTotal - orcadoTotal),
      };
    })
    .filter((row) => row.orcadoTotal || row.realizadoTotal)
    .sort((a, b) => {
      const rank = (key: string) => (key === "unallocated" ? 2 : key === "none" ? 1 : 0);
      const diff = rank(a.key) - rank(b.key);
      if (diff) return diff;
      return Math.abs(b.orcadoTotal) + Math.abs(b.realizadoTotal) - (Math.abs(a.orcadoTotal) + Math.abs(a.realizadoTotal));
    });
}

function shareId(sheetId: number, objectKey: string) {
  return `${sheetId}::${objectKey}`;
}

export function aggregateCompare(
  all: BudgetContribution[],
  realizadoByObject: RealizadoObject[],
  selected: string[],
  realizadoByActivity: RealizadoActivity[] = [],
) {
  const associatedKeys = new Set(realizadoByActivity.map((row) => row.key));
  const filtered = rollupContributions(filterContributions(all, selected));
  const filteredRealizado = filterRealizado(realizadoByObject, selected);
  const byCostCenter = new Map<string, AmountRow>();
  const byCategory = new Map<string, AmountRow>();
  const byActivity = new Map<string, AmountRow>();
  const byCostObject = new Map<string, AmountRow>();

  type Share = { key: string; label: string; sheetId?: number; weight: number };
  const byCategoryShares = new Map<string, Share[]>();

  const remember = (map: Map<string, Share[]>, id: string, share: Share) => {
    const list = map.get(id) ?? [];
    const existing = list.find((row) => row.key === share.key);
    if (existing) existing.weight += share.weight;
    else list.push({ ...share });
    map.set(id, list);
  };

  for (const row of filtered) {
    const objectKey = row.objectKey || "none";
    const categoryKey = row.category.trim().toUpperCase() || "SEM-CATEGORIA";
    addOrcado(byCostCenter, costCenterKey(row.sheetId), row.sheetTitle, row.months, row.sheetId);
    addOrcado(byCategory, categoryKey, row.category || "Sem categoria", row.months);
    if (associatedKeys.has(row.activityKey)) {
      addOrcado(byActivity, row.activityKey, row.activityLabel, row.months);
    }
    addOrcado(byCostObject, objectKey, row.objectLabel, row.months);
    const weight = Math.abs(sumMonths(row.months));
    const id = shareId(row.sheetId, objectKey);
    remember(byCategoryShares, id, { key: categoryKey, label: row.category || "Sem categoria", weight });
  }

  const split = (map: Map<string, AmountRow>, shares: Share[], months: number[]) => {
    const totalWeight = shares.reduce((sum, share) => sum + share.weight, 0);
    if (totalWeight > 0) {
      for (const share of shares) {
        addRealizado(
          map,
          share.key,
          share.label,
          months.map((value) => value * (share.weight / totalWeight)),
          share.sheetId,
        );
      }
      return;
    }
    addRealizado(map, "unallocated", "Não alocado", months);
  };

  for (const item of filteredRealizado) {
    const objectKey = item.key || "none";
    if (item.sheetId != null) {
      addRealizado(
        byCostCenter,
        costCenterKey(item.sheetId),
        item.sheetTitle || "Centro de custo",
        item.months,
        item.sheetId,
      );
      const id = shareId(item.sheetId, objectKey);
      split(byCategory, byCategoryShares.get(id) ?? [], item.months);
    } else {
      addRealizado(byCostCenter, "unallocated", "Não alocado", item.months);
      addRealizado(byCategory, "unallocated", "Não alocado", item.months);
    }
    addRealizado(byCostObject, objectKey, item.label, item.months);
  }

  for (const item of realizadoByActivity) {
    const row = byActivity.get(item.key) ?? {
      key: item.key,
      label: item.label,
      orcado: zeros(),
      realizado: zeros(),
    };
    row.label = item.label || row.label;
    row.realizado = zeros();
    addMonths(row.realizado, item.months);
    byActivity.set(item.key, row);
  }

  const totalsOrcado = zeros();
  const totalsRealizado = zeros();
  for (const row of byCostCenter.values()) {
    addMonths(totalsOrcado, row.orcado);
    addMonths(totalsRealizado, row.realizado);
  }
  const totalsOrcadoR = totalsOrcado.map(money);
  const totalsRealizadoR = totalsRealizado.map(money);
  const totalsVariacao = totalsOrcadoR.map((value, i) => money((totalsRealizadoR[i] ?? 0) - value));
  const totalOrcado = money(sumMonths(totalsOrcadoR));
  const totalRealizado = money(sumMonths(totalsRealizadoR));

  return {
    views: {
      costCenter: finishCompare(byCostCenter),
      category: finishCompare(byCategory),
      activity: finishCompare(byActivity),
      costObject: finishCompare(byCostObject),
    },
    totals: {
      orcado: totalsOrcadoR,
      realizado: totalsRealizadoR,
      variacao: totalsVariacao,
    },
    totalOrcado,
    totalRealizado,
    totalVariacao: money(totalRealizado - totalOrcado),
  };
}

export type CompareActivityCategoryNode = {
  key: string;
  label: string;
  orcado: number[];
  realizado: number[];
  variacao: number[];
  orcadoTotal: number;
  realizadoTotal: number;
  variacaoTotal: number;
  activities: CompareViewRow[];
};

export type CompareActivityCenterNode = {
  key: string;
  label: string;
  sheetId?: number;
  orcado: number[];
  realizado: number[];
  variacao: number[];
  orcadoTotal: number;
  realizadoTotal: number;
  variacaoTotal: number;
  categories: CompareActivityCategoryNode[];
};

/** @deprecated use CompareActivityCenterNode — mantido como alias do nó de categoria. */
export type CompareActivityByCategoryNode = CompareActivityCategoryNode;

function hasMonthlyAmount(months: number[] | undefined) {
  return (months ?? []).some((value) => Number.isFinite(value) && Math.abs(value) >= 0.005);
}

/** Valor que aparece como R$ 0 no resumo (moeda sem centavos) conta como vazio. */
export function hasCompareAmount(row: Pick<CompareViewRow, "orcadoTotal" | "realizadoTotal">) {
  const hasVisibleAmount = (value: number) => Number.isFinite(value) && Math.abs(value) >= 0.5;
  return hasVisibleAmount(row.orcadoTotal) || hasVisibleAmount(row.realizadoTotal);
}

/** Agrupa atividades associadas por centro → categoria (orçado x realizado). */
export function buildCompareActivityByCategory(
  all: BudgetContribution[],
  selected: string[],
  realizadoByActivity: RealizadoActivity[] = [],
  selectedActivities: string[] = [],
): CompareActivityCenterNode[] {
  const associated = new Map(realizadoByActivity.map((row) => [row.key, row]));
  const raw = filterContributions(all, selected, [], [], [], selectedActivities);
  const activityIdsWithOrcado = new Set(
    raw
      .filter((row) => row.kind === "activity" && hasMonthlyAmount(row.months))
      .map((row) => activityId(row)),
  );
  const filtered = raw.filter((row) => {
    if (!associated.has(row.activityKey)) return false;
    if (!hasMonthlyAmount(row.months)) return false;
    if (row.kind === "material") return !activityIdsWithOrcado.has(activityId(row));
    if (row.kind === "activity") return activityIdsWithOrcado.has(activityId(row));
    return true;
  });

  type CatBucket = {
    key: string;
    label: string;
    orcado: number[];
    realizado: number[];
    activities: Map<string, AmountRow>;
  };
  type CenterBucket = {
    key: string;
    label: string;
    sheetId?: number;
    orcado: number[];
    realizado: number[];
    categories: Map<string, CatBucket>;
  };

  const centers = new Map<string, CenterBucket>();
  /** Por activityKey: peso orçado em cada centro+categoria (para ratear o realizado). */
  const activityShares = new Map<
    string,
    Map<string, { centerKey: string; sheetId?: number; centerLabel: string; catKey: string; catLabel: string; actLabel: string; weight: number }>
  >();

  const ensureCenter = (centerKey: string, label: string, sheetId?: number): CenterBucket => {
    let center = centers.get(centerKey);
    if (!center) {
      center = {
        key: centerKey,
        label,
        sheetId,
        orcado: zeros(),
        realizado: zeros(),
        categories: new Map(),
      };
      centers.set(centerKey, center);
    }
    if (sheetId != null && center.sheetId == null) center.sheetId = sheetId;
    return center;
  };

  const ensureCategory = (center: CenterBucket, catKey: string, catLabel: string): CatBucket => {
    const id = `${center.key}::${catKey}`;
    let cat = center.categories.get(id);
    if (!cat) {
      cat = { key: id, label: catLabel, orcado: zeros(), realizado: zeros(), activities: new Map() };
      center.categories.set(id, cat);
    }
    return cat;
  };

  const ensureActivity = (cat: CatBucket, activityKey: string, label: string, sheetId?: number): AmountRow => {
    const actId = `${cat.key}::${activityKey}`;
    let act = cat.activities.get(actId);
    if (!act) {
      act = { key: actId, label, sheetId, orcado: zeros(), realizado: zeros(), sources: new Map() };
      cat.activities.set(actId, act);
    }
    if (!act.sources) act.sources = new Map();
    return act;
  };

  for (const row of filtered) {
    if (!associated.has(row.activityKey)) continue;
    const centerKey = costCenterKey(row.sheetId);
    const catKey = categoryKey(row.category);
    const catLabel = row.category.trim() || "Sem categoria";
    const center = ensureCenter(centerKey, row.sheetTitle, row.sheetId);
    const cat = ensureCategory(center, catKey, catLabel);
    const act = ensureActivity(cat, row.activityKey, row.activityLabel, row.sheetId);
    addMonths(act.orcado, row.months);
    addMonths(cat.orcado, row.months);
    addMonths(center.orcado, row.months);
    act.label = row.activityLabel || act.label;

    const shareKey = `${centerKey}::${catKey}`;
    let shares = activityShares.get(row.activityKey);
    if (!shares) {
      shares = new Map();
      activityShares.set(row.activityKey, shares);
    }
    const weight = Math.abs(sumMonths(row.months));
    const existing = shares.get(shareKey);
    if (existing) existing.weight += weight;
    else {
      shares.set(shareKey, {
        centerKey,
        sheetId: row.sheetId,
        centerLabel: row.sheetTitle,
        catKey,
        catLabel,
        actLabel: row.activityLabel,
        weight,
      });
    }
  }

  const addActivityRealizado = (act: AmountRow, item: RealizadoActivity, months: number[]) => {
    addMonths(act.realizado, months);
    if (!act.sources) act.sources = new Map();
    const ratio = (value: number, i: number) => {
      const total = item.months[i] ?? 0;
      if (!total) return 0;
      return value * ((months[i] ?? 0) / total);
    };
    for (const source of item.sources ?? []) {
      const srcMonths = source.months.map(ratio);
      const current = act.sources.get(source.key) ?? {
        key: `${act.key}::${source.key}`,
        label: source.label,
        orcado: zeros(),
        realizado: zeros(),
      };
      current.label = source.label || current.label;
      addMonths(current.realizado, srcMonths);
      act.sources.set(source.key, current);
    }
  };

  for (const item of realizadoByActivity) {
    if (
      !hasMonthlyAmount(item.months) &&
      !(item.sources ?? []).some((source) => hasMonthlyAmount(source.months))
    ) {
      continue;
    }
    const shares = activityShares.get(item.key);
    if (!shares?.size) {
      const center = ensureCenter("unallocated", "Não alocado");
      const cat = ensureCategory(center, "SEM-CATEGORIA", "Sem categoria");
      const act = ensureActivity(cat, item.key, item.label);
      act.label = item.label || act.label;
      addActivityRealizado(act, item, item.months);
      addMonths(cat.realizado, item.months);
      addMonths(center.realizado, item.months);
      continue;
    }

    const totalWeight = [...shares.values()].reduce((sum, share) => sum + share.weight, 0);
    const n = shares.size;
    for (const share of shares.values()) {
      const ratio = totalWeight > 0 ? share.weight / totalWeight : 1 / n;
      const months = item.months.map((value) => value * ratio);
      const center = ensureCenter(share.centerKey, share.centerLabel, share.sheetId);
      const cat = ensureCategory(center, share.catKey, share.catLabel);
      const act = ensureActivity(cat, item.key, share.actLabel || item.label, share.sheetId);
      act.label = item.label || act.label;
      addActivityRealizado(act, item, months);
      addMonths(cat.realizado, months);
      addMonths(center.realizado, months);
    }
  }

  const finishRow = (row: AmountRow, origin = false): CompareViewRow => {
    const orcado = row.orcado.map(money);
    const realizado = row.realizado.map(money);
    const orcadoTotal = money(sumMonths(orcado));
    const realizadoTotal = money(sumMonths(realizado));
    const sources = row.sources
      ? [...row.sources.values()]
          .map((source) => finishRow(source, true))
          .filter((source) => source.realizadoTotal > 0)
          .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))
      : undefined;
    return {
      key: row.key,
      label: row.label,
      sheetId: row.sheetId,
      origin,
      orcado,
      realizado,
      variacao: origin
        ? realizado.map((value) => money(value))
        : orcado.map((value, i) => money((realizado[i] ?? 0) - value)),
      orcadoTotal,
      realizadoTotal,
      variacaoTotal: origin ? realizadoTotal : money(realizadoTotal - orcadoTotal),
      sources,
    };
  };

  const byMagnitude = (a: CompareViewRow, b: CompareViewRow) =>
    Math.abs(b.orcadoTotal) +
    Math.abs(b.realizadoTotal) -
    (Math.abs(a.orcadoTotal) + Math.abs(a.realizadoTotal));

  return [...centers.values()]
    .map((center) => {
      const categories = [...center.categories.values()]
        .map((cat) => {
          const activities = [...cat.activities.values()]
            .map(finishRow)
            .filter(hasCompareAmount)
            .sort(byMagnitude);
          const parent = finishRow({
            key: cat.key,
            label: cat.label,
            orcado: cat.orcado,
            realizado: cat.realizado,
          });
          return hasCompareAmount(parent) && activities.length ? { ...parent, activities } : null;
        })
        .filter((cat): cat is CompareActivityCategoryNode => cat !== null)
        .sort(byMagnitude);
      const parent = finishRow({
        key: center.key,
        label: center.label,
        sheetId: center.sheetId,
        orcado: center.orcado,
        realizado: center.realizado,
      });
      return hasCompareAmount(parent) && categories.length ? { ...parent, categories } : null;
    })
    .filter((center): center is CompareActivityCenterNode => center !== null)
    .sort((a, b) => {
      if (a.key === "unallocated") return 1;
      if (b.key === "unallocated") return -1;
      return byMagnitude(a, b);
    });
}
