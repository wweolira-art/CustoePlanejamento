import type { CostPlanningView, Page } from "../store";
import type { ExternalSiteGroup, SheetInfo } from "../api";
import { isSidebarSiteGroup } from "../api";
import { nativeTabsForGroup } from "./nativeEmbedTabs";
import { IS_CUSTO_APP } from "./appFlavor";

export const PERMISSION_ADMIN = "admin";
export const PERMISSION_USERS_ADMIN = "admin:users";

export const PAGE_PERMISSIONS = [
  { key: "page:activities", label: "Atividades", pageKind: "activities" as const },
  { key: "page:fazendas", label: "Fazendas", pageKind: "fazendas" as const },
  { key: "page:materials", label: "Materiais", pageKind: "materials" as const },
  { key: "page:costObjects", label: "Objetos de custo", pageKind: "costObjects" as const },
  { key: "page:categories", label: "Categorias", pageKind: "categories" as const },
  { key: "page:harvestAreas", label: "Áreas", pageKind: "harvestAreas" as const },
  { key: "page:seedRadiusTariffs", label: "Raio transporte de semente", pageKind: "seedRadiusTariffs" as const },
  { key: "page:seedTransportReport", label: "Relatório transporte semente", pageKind: "seedTransportReport" as const },
  { key: "page:contractControl", label: "Controle de contrato", pageKind: "contractControl" as const },
  { key: "page:safras", label: "Safras", pageKind: "safras" as const },
  { key: "page:externalSites", label: "Sites incorporados", pageKind: "externalSites" as const },
  { key: "page:manage", label: "Gerenciar abas", pageKind: "manage" as const },
  { key: PERMISSION_USERS_ADMIN, label: "Usuários e permissões", pageKind: "users" as const },
] as const;

/** Cadastros que saem com o app de Custo e Planejamento. */
export const COST_CADASTRO_PAGE_KINDS = new Set<(typeof PAGE_PERMISSIONS)[number]["pageKind"]>([
  "activities",
  "materials",
  "costObjects",
  "categories",
  "harvestAreas",
  "seedRadiusTariffs",
  "seedTransportReport",
  "contractControl",
]);

export const COST_PLANNING_TABS = [
  { key: "tab:dash", tab: "dash" as const, label: "Visão geral" },
  { key: "tab:premissas", tab: "premissas" as const, label: "Premissas" },
  { key: "tab:autoCalc", tab: "autoCalc" as const, label: "Cálculo automático" },
  { key: "tab:orcadoRealizado", tab: "orcadoRealizado" as const, label: "Orçado x realizado" },
  { key: "tab:resumo", tab: "resumo" as const, label: "Relatório consolidado" },
  { key: "tab:activityLinks", tab: "activityLinks" as const, label: "Associar realizado" },
] as const;

export function editPermissionKey(baseKey: string) {
  return `${baseKey}:edit`;
}

export function sheetPermissionKey(sheetId: number) {
  return `sheet:${sheetId}`;
}

export function siteGroupPermissionKey(groupId: number) {
  return `siteGroup:${groupId}`;
}

export function nativeTabPermissionKey(nativeKey: string, tabId: string) {
  return `nativeTab:${nativeKey}:${tabId}`;
}

export function siteItemPermissionKey(itemId: number) {
  return `siteItem:${itemId}`;
}

function isEditKey(key: string) {
  return key.endsWith(":edit");
}

export function groupInnerScreens(group: ExternalSiteGroup): Array<{ key: string; label: string }> {
  if (group.nativeKey === "cost-planning") {
    return (group.items ?? [])
      .filter((item) => item.visible)
      .map((item) => ({ key: siteItemPermissionKey(item.id), label: item.label }));
  }
  const nativeKey = group.nativeKey;
  const native = nativeTabsForGroup(nativeKey).map((tab) => ({
    key: nativeTabPermissionKey(nativeKey!, tab.id),
    label: tab.label,
  }));
  const nativeLabels = new Set(
    native.map((row) =>
      row.label
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase(),
    ),
  );
  const extras = (group.items ?? [])
    .filter((item) => item.visible)
    .filter((item) => {
      const label = item.label
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
      return !nativeLabels.has(label);
    })
    .map((item) => ({ key: siteItemPermissionKey(item.id), label: item.label }));
  return [...native, ...extras];
}

function listedInnerKeys(permissions: string[], innerKeys: string[]) {
  return innerKeys.filter((key) => permissions.includes(key));
}

export function canAccessGroupInner(
  permissions: string[] | undefined,
  group: ExternalSiteGroup,
  innerKey: string,
) {
  const list = permissions ?? [];
  if (!list.length || list.includes(PERMISSION_ADMIN)) return true;
  if (!canAccessSiteGroup(list, group.id)) return false;
  const innerKeys = groupInnerScreens(group).map((row) => row.key);
  if (!innerKeys.length) return true;
  const listed = listedInnerKeys(list, innerKeys);
  if (!listed.length) return true;
  return listed.includes(innerKey);
}

export function canAccessNativeTab(
  permissions: string[] | undefined,
  group: ExternalSiteGroup | undefined,
  tabId: string,
) {
  if (!group?.nativeKey) return true;
  return canAccessGroupInner(permissions, group, nativeTabPermissionKey(group.nativeKey, tabId));
}

export function canAccessGroupItem(
  permissions: string[] | undefined,
  group: ExternalSiteGroup,
  itemId: number,
) {
  return canAccessGroupInner(permissions, group, siteItemPermissionKey(itemId));
}

export function isGroupInnerChecked(
  selected: string[],
  group: ExternalSiteGroup,
  innerKey: string,
) {
  if (selected.includes(PERMISSION_ADMIN)) return true;
  if (!selected.length) return false;
  if (!selected.includes(siteGroupPermissionKey(group.id))) return false;
  const innerKeys = groupInnerScreens(group).map((row) => row.key);
  const listed = listedInnerKeys(selected, innerKeys);
  if (!listed.length) return true;
  return listed.includes(innerKey);
}

export function isGroupInnerEditChecked(
  selected: string[],
  group: ExternalSiteGroup,
  innerKey: string,
) {
  if (selected.includes(PERMISSION_ADMIN)) return true;
  if (!selected.length) return false;
  if (!isGroupInnerChecked(selected, group, innerKey)) return false;
  const innerKeys = groupInnerScreens(group).map((row) => row.key);
  const listed = listedInnerKeys(selected, innerKeys);
  if (!listed.length) return selected.includes(editPermissionKey(siteGroupPermissionKey(group.id)));
  return selected.includes(editPermissionKey(innerKey));
}

export function setGroupInnerView(
  selected: string[],
  group: ExternalSiteGroup,
  innerKey: string,
  enabled: boolean,
) {
  const parentKey = siteGroupPermissionKey(group.id);
  const innerKeys = groupInnerScreens(group).map((row) => row.key);
  if (enabled) {
    let next = setViewPermission(selected, parentKey, true);
    const listed = listedInnerKeys(next, innerKeys);
    if (!listed.length) {
      if (selected.includes(parentKey) || selected.includes(PERMISSION_ADMIN)) return next;
      return setViewPermission(next, innerKey, true);
    }
    return setViewPermission(next, innerKey, true);
  }
  const listed = listedInnerKeys(selected, innerKeys);
  let next = selected;
  if (!listed.length) {
    next = setViewPermission(next, parentKey, true);
    for (const key of innerKeys) {
      next = setViewPermission(next, key, key !== innerKey);
    }
  } else {
    next = setViewPermission(next, innerKey, false);
  }
  const remaining = listedInnerKeys(next, innerKeys);
  if (!remaining.length) next = setViewPermission(next, parentKey, false);
  return next;
}

export function setGroupInnerEdit(
  selected: string[],
  group: ExternalSiteGroup,
  innerKey: string,
  enabled: boolean,
) {
  const parentKey = siteGroupPermissionKey(group.id);
  const innerKeys = groupInnerScreens(group).map((row) => row.key);
  const listed = listedInnerKeys(selected, innerKeys);
  if (!listed.length) {
    return setEditPermission(selected, parentKey, enabled);
  }
  return setEditPermission(selected, innerKey, enabled);
}

export function canAccess(permissions: string[] | undefined, key: string) {
  const list = permissions ?? [];
  if (!list.length) return true;
  if (list.includes(PERMISSION_ADMIN)) return true;
  return list.includes(key);
}

export function canEdit(permissions: string[] | undefined, baseKey: string) {
  const list = permissions ?? [];
  if (!list.length) return true;
  if (list.includes(PERMISSION_ADMIN)) return true;
  if (baseKey === PERMISSION_ADMIN) return false;
  if (!canAccess(list, baseKey)) return false;
  return list.includes(editPermissionKey(baseKey));
}

export function canManageUsers(permissions: string[] | undefined) {
  return canAccess(permissions, PERMISSION_USERS_ADMIN);
}

export function canAccessCostTab(
  permissions: string[] | undefined,
  tab: Exclude<CostPlanningView["tab"], "sheet" | "external">,
) {
  return canAccess(permissions, `tab:${tab}`);
}

export function canEditCostTab(
  permissions: string[] | undefined,
  tab: Exclude<CostPlanningView["tab"], "sheet" | "external">,
) {
  return canEdit(permissions, `tab:${tab}`);
}

export function canAccessSheet(permissions: string[] | undefined, sheetId: number) {
  return canAccess(permissions, sheetPermissionKey(sheetId));
}

export function canEditSheet(permissions: string[] | undefined, sheetId: number) {
  return canEdit(permissions, sheetPermissionKey(sheetId));
}

export function canAccessSiteGroup(permissions: string[] | undefined, groupId: number) {
  return canAccess(permissions, siteGroupPermissionKey(groupId));
}

export function canEditSiteGroup(permissions: string[] | undefined, groupId: number) {
  return canEdit(permissions, siteGroupPermissionKey(groupId));
}

export function hasAnyCostPlanningAccess(permissions: string[] | undefined) {
  const list = permissions ?? [];
  if (!list.length || list.includes(PERMISSION_ADMIN)) return true;
  return (
    COST_PLANNING_TABS.some((tab) => list.includes(tab.key)) ||
    list.some((key) => key.startsWith("sheet:"))
  );
}

export function resolveEditKeyForPage(page: Page, siteGroups: ExternalSiteGroup[] = []): string | null {
  if (page.kind === "costPlanning") {
    if (page.view.tab === "sheet") return sheetPermissionKey(page.view.sheetId);
    if (page.view.tab === "external") return null;
    return `tab:${page.view.tab}`;
  }
  if (page.kind === "siteGroup") {
    const group = siteGroups.find((row) => row.id === page.groupId);
    if (group?.nativeKey === "cost-planning" && page.costView) {
      if (page.costView.tab === "sheet") return sheetPermissionKey(page.costView.sheetId);
      if (page.costView.tab === "external") {
        return page.costView.itemId ? siteItemPermissionKey(page.costView.itemId) : null;
      }
      return `tab:${page.costView.tab}`;
    }
    if (group && page.tabKey && group.nativeKey) {
      return nativeTabPermissionKey(group.nativeKey, page.tabKey);
    }
    if (group && page.itemId) return siteItemPermissionKey(page.itemId);
    return siteGroupPermissionKey(page.groupId);
  }
  const match = PAGE_PERMISSIONS.find((row) => row.pageKind === page.kind);
  return match?.key ?? null;
}

export function canEditPage(permissions: string[] | undefined, page: Page, siteGroups: ExternalSiteGroup[] = []) {
  const key = resolveEditKeyForPage(page, siteGroups);
  if (!key) return true;
  return canEdit(permissions, key);
}

function canAccessCostPlanningSiteGroup(
  permissions: string[] | undefined,
  groupId: number,
  siteGroups: ExternalSiteGroup[],
) {
  return canAccessSiteGroup(permissions, groupId) || hasAnyCostPlanningAccess(permissions);
}

function canAccessCostPlanningView(permissions: string[] | undefined, view: CostPlanningView) {
  if (view.tab === "sheet") return canAccessSheet(permissions, view.sheetId);
  if (view.tab === "external") return hasAnyCostPlanningAccess(permissions);
  return canAccessCostTab(permissions, view.tab);
}

export function canAccessPage(
  permissions: string[] | undefined,
  page: Page,
  siteGroups: ExternalSiteGroup[] = [],
) {
  if (page.kind === "costPlanning") {
    if (!IS_CUSTO_APP) return false;
    if (!hasAnyCostPlanningAccess(permissions)) return false;
    return canAccessCostPlanningView(permissions, page.view);
  }
  if (page.kind === "siteGroup") {
    const group = siteGroups.find((row) => row.id === page.groupId);
    if (group?.nativeKey === "cost-planning") {
      if (!IS_CUSTO_APP) return false;
      if (!canAccessCostPlanningSiteGroup(permissions, page.groupId, siteGroups)) return false;
      if (page.costView) return canAccessCostPlanningView(permissions, page.costView);
      return true;
    }
    if (IS_CUSTO_APP) return false;
    if (!canAccessSiteGroup(permissions, page.groupId)) return false;
    if (page.tabKey) return canAccessNativeTab(permissions, group, page.tabKey);
    if (page.itemId && group) return canAccessGroupItem(permissions, group, page.itemId);
    return true;
  }
  const match = PAGE_PERMISSIONS.find((row) => row.pageKind === page.kind);
  if (!match) return true;
  if (!IS_CUSTO_APP && COST_CADASTRO_PAGE_KINDS.has(match.pageKind)) return false;
  return canAccess(permissions, match.key);
}

export function firstAllowedPage(
  permissions: string[] | undefined,
  sheets: SheetInfo[],
  siteGroups: ExternalSiteGroup[],
): Page {
  const custoApp = IS_CUSTO_APP;
  const costPlanningGroup = siteGroups.find((group) => group.nativeKey === "cost-planning");
  if (
    custoApp &&
    costPlanningGroup &&
    canAccessCostPlanningSiteGroup(permissions, costPlanningGroup.id, siteGroups)
  ) {
    const tab = COST_PLANNING_TABS.find((row) => canAccessCostTab(permissions, row.tab));
    if (tab) {
      return { kind: "siteGroup", groupId: costPlanningGroup.id, costView: { tab: tab.tab } };
    }
    const center = sheets.find(
      (sheet) => sheet.visible && sheet.kind === "cost_center" && canAccessSheet(permissions, sheet.id),
    );
    if (center) {
      return { kind: "siteGroup", groupId: costPlanningGroup.id, costView: { tab: "sheet", sheetId: center.id } };
    }
    return { kind: "siteGroup", groupId: costPlanningGroup.id };
  }
  const sidebarGroup = siteGroups.filter(isSidebarSiteGroup).find((item) => {
    if (custoApp) return item.nativeKey === "cost-planning" && canAccessSiteGroup(permissions, item.id);
    if (item.nativeKey === "cost-planning") return false;
    return canAccessSiteGroup(permissions, item.id);
  });
  if (!custoApp && sidebarGroup) return { kind: "siteGroup", groupId: sidebarGroup.id };
  for (const row of PAGE_PERMISSIONS) {
    if (!custoApp && COST_CADASTRO_PAGE_KINDS.has(row.pageKind)) continue;
    if (canAccess(permissions, row.key)) return { kind: row.pageKind };
  }
  if (sidebarGroup) return { kind: "siteGroup", groupId: sidebarGroup.id };
  if (custoApp && costPlanningGroup) return { kind: "siteGroup", groupId: costPlanningGroup.id };
  return { kind: custoApp ? "activities" : "safras" };
}

export function setViewPermission(selected: string[], viewKey: string, enabled: boolean) {
  const editKey = editPermissionKey(viewKey);
  if (enabled) return selected.includes(viewKey) ? selected : [...selected, viewKey];
  return selected.filter((key) => key !== viewKey && key !== editKey);
}

export function setEditPermission(selected: string[], viewKey: string, enabled: boolean) {
  const editKey = editPermissionKey(viewKey);
  if (enabled) {
    const next = setViewPermission(selected, viewKey, true);
    return next.includes(editKey) ? next : [...next, editKey];
  }
  return selected.filter((key) => key !== editKey);
}
