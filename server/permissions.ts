export const PERMISSION_ADMIN = "admin";
export const PERMISSION_USERS_ADMIN = "admin:users";

export const PAGE_PERMISSIONS = [
  { key: "page:activities", label: "Atividades" },
  { key: "page:fazendas", label: "Fazendas" },
  { key: "page:materials", label: "Materiais" },
  { key: "page:costObjects", label: "Objetos de custo" },
  { key: "page:categories", label: "Categorias" },
  { key: "page:harvestAreas", label: "Áreas" },
  { key: "page:seedRadiusTariffs", label: "Raio transporte de semente" },
  { key: "page:contractControl", label: "Controle de contrato" },
  { key: "page:safras", label: "Safras" },
  { key: "page:externalSites", label: "Sites incorporados" },
  { key: "page:manage", label: "Gerenciar abas" },
  { key: PERMISSION_USERS_ADMIN, label: "Usuários e permissões" },
] as const;

export const COST_PLANNING_TABS = [
  { key: "tab:dash", label: "Visão geral" },
  { key: "tab:premissas", label: "Premissas" },
  { key: "tab:autoCalc", label: "Cálculo automático" },
  { key: "tab:orcadoRealizado", label: "Orçado x realizado" },
  { key: "tab:resumo", label: "Relatório consolidado" },
  { key: "tab:activityLinks", label: "Associar realizado" },
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

export function permissionCatalog() {
  return {
    admin: [{ key: PERMISSION_ADMIN, label: "Acesso total (administrador)" }],
    costPlanning: COST_PLANNING_TABS,
    pages: PAGE_PERMISSIONS,
    dynamic: {
      sheets: "Centros de custo individuais (sheet:{id})",
      siteGroups: "Sites e colheita (siteGroup:{id})",
      nativeTabs: "Subabas nativas (nativeTab:{nativeKey}:{tabId})",
      siteItems: "Subabas externas (siteItem:{id})",
    },
    editSuffix: ":edit",
  };
}

export function canAccessPermission(permissions: string[], key: string): boolean {
  if (!permissions.length) return true;
  if (permissions.includes(PERMISSION_ADMIN)) return true;
  return permissions.includes(key);
}

export function canEditPermission(permissions: string[], baseKey: string): boolean {
  if (!permissions.length) return true;
  if (permissions.includes(PERMISSION_ADMIN)) return true;
  if (baseKey === PERMISSION_ADMIN) return false;
  if (!canAccessPermission(permissions, baseKey)) return false;
  return permissions.includes(editPermissionKey(baseKey));
}

export function canManageUsers(permissions: string[]): boolean {
  if (!permissions.length) return true;
  if (permissions.includes(PERMISSION_ADMIN)) return true;
  return permissions.includes(PERMISSION_USERS_ADMIN);
}
