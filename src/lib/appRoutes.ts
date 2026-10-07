import type { ExternalSiteGroup, ExternalSiteItem, SheetInfo } from "../api";
import { COST_PLANNING_TABS, PAGE_PERMISSIONS } from "./permissions";
import { INDICADORES_REPORTS } from "./nativeEmbedTabs";
import type { CostPlanningView, Page } from "../store";

const GESTAO_COLHEITA_TABS = [
  { id: "entrada-caminhao", label: "Entrada cana caminhão" },
  { id: "entrada-maquina", label: "Entrada cana máquina" },
  { id: "associar-equipamento", label: "Associar equipamento" },
  { id: "horas-maquina", label: "Horas máquina" },
  { id: "associar-fazenda", label: "Associar fazenda" },
  { id: "encerramento-ordens", label: "Encerrar ordens colheita" },
  { id: "liberacao-colheita", label: "Liberação de colheita" },
  { id: "resumo-transporte", label: "Resumo transporte cana" },
  { id: "import", label: "Importar planilha" },
] as const;

export function foldKey(text: string): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Nome da tela na barra de endereço, com acentos (ex.: /orçamentos). */
export function displaySlug(text: string): string {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function sameSlug(a: string, b: string): boolean {
  return foldKey(a) === foldKey(b);
}

type StaticPageKind = (typeof PAGE_PERMISSIONS)[number]["pageKind"];

const STATIC_PAGE_PATHS: { kind: StaticPageKind; path: string }[] = PAGE_PERMISSIONS.map((row) => ({
  kind: row.pageKind,
  path: `/${displaySlug(row.label)}`,
}));

const COST_TAB_PATHS: { tab: Exclude<CostPlanningView["tab"], "sheet" | "external">; path: string }[] =
  COST_PLANNING_TABS.map((row) => ({
    tab: row.tab,
    path: `/${displaySlug(row.label)}`,
  }));

const ORCAMENTOS_PATH = `/${displaySlug("Orçamentos")}`;

function costCenters(sheets: SheetInfo[]) {
  return sheets.filter((sheet) => sheet.visible && sheet.kind === "cost_center");
}

function uniqueDisplaySlug(label: string, fallback: string, others: string[]): string {
  const base = displaySlug(label) || fallback;
  const clashes = others.filter((other) => sameSlug(other, base)).length;
  return clashes > 1 ? `${base}-${fallback}` : base;
}

export function sheetPathSlug(sheet: SheetInfo, sheets: SheetInfo[]): string {
  const labels = costCenters(sheets).map((row) => displaySlug(row.title) || displaySlug(row.name) || String(row.id));
  return uniqueDisplaySlug(sheet.title || sheet.name, String(sheet.id), labels);
}

function itemPathSlug(item: ExternalSiteItem, items: ExternalSiteItem[]): string {
  const labels = items.map((row) => displaySlug(row.label) || String(row.id));
  return uniqueDisplaySlug(item.label, String(item.id), labels);
}

function findSheetBySlug(slug: string, sheets: SheetInfo[]): SheetInfo | undefined {
  const centers = costCenters(sheets);
  const asId = Number(slug);
  if (Number.isInteger(asId) && asId > 0) {
    const byId = centers.find((sheet) => sheet.id === asId);
    if (byId) return byId;
  }
  return centers.find((sheet) => sameSlug(sheetPathSlug(sheet, sheets), slug) || sameSlug(sheet.title, slug) || sameSlug(sheet.name, slug));
}

function findItemBySlug(slug: string, items: ExternalSiteItem[]): ExternalSiteItem | undefined {
  const asId = Number(slug);
  if (Number.isInteger(asId) && asId > 0) {
    const byId = items.find((item) => item.id === asId);
    if (byId) return byId;
  }
  return items.find((item) => sameSlug(itemPathSlug(item, items), slug) || sameSlug(item.label, slug));
}

function findGroupBySlug(slug: string, siteGroups: ExternalSiteGroup[]): ExternalSiteGroup | undefined {
  return siteGroups.find(
    (group) =>
      sameSlug(group.slug, slug) ||
      sameSlug(group.label, slug) ||
      (group.nativeKey ? sameSlug(group.nativeKey, slug) : false),
  );
}

function pathFromCostView(view: CostPlanningView, sheets: SheetInfo[], siteGroups: ExternalSiteGroup[]): string {
  if (view.tab === "dash") return ORCAMENTOS_PATH;
  if (view.tab === "sheet") {
    const sheet = sheets.find((row) => row.id === view.sheetId);
    if (!sheet) return ORCAMENTOS_PATH;
    return `${ORCAMENTOS_PATH}/${sheetPathSlug(sheet, sheets)}`;
  }
  if (view.tab === "external") return costExternalPath(view, siteGroups);
  return COST_TAB_PATHS.find((row) => row.tab === view.tab)?.path ?? "/";
}

function costExternalPath(view: Extract<CostPlanningView, { tab: "external" }>, siteGroups: ExternalSiteGroup[]): string {
  const group = siteGroups.find((row) => row.nativeKey === "cost-planning");
  const item = group?.items.find((row) => row.id === view.itemId);
  if (item && group) return `/${itemPathSlug(item, group.items)}`;
  return `/${view.itemId}`;
}

export function pathFromPage(page: Page, sheets: SheetInfo[], siteGroups: ExternalSiteGroup[]): string {
  if (page.kind === "costPlanning") {
    if (page.view.tab === "external") return costExternalPath(page.view, siteGroups);
    return pathFromCostView(page.view, sheets, siteGroups);
  }
  if (page.kind === "siteGroup") {
    const group = siteGroups.find((row) => row.id === page.groupId);
    if (!group) return "/";
    if (group.nativeKey === "cost-planning") {
      if (page.costView) {
        if (page.costView.tab === "external") return costExternalPath(page.costView, siteGroups);
        return pathFromCostView(page.costView, sheets, siteGroups);
      }
      return COST_TAB_PATHS.find((row) => row.tab === "dash")?.path ?? "/";
    }
    const base = `/${group.slug || displaySlug(group.label)}`;
    if (page.tabKey) return `${base}/${page.tabKey}`;
    if (page.itemId) {
      const item = group.items.find((row) => row.id === page.itemId);
      return item ? `${base}/${itemPathSlug(item, group.items)}` : `${base}/${page.itemId}`;
    }
    return base;
  }
  return STATIC_PAGE_PATHS.find((row) => row.kind === page.kind)?.path ?? "/";
}

function costViewFromSlug(slug: string, sheets: SheetInfo[], siteGroups: ExternalSiteGroup[]): CostPlanningView | null {
  if (sameSlug(slug, "orçamentos") || sameSlug(slug, "orcamentos") || sameSlug(slug, "centros")) {
    return { tab: "dash" };
  }
  const tab =
    COST_TAB_PATHS.find((row) => sameSlug(row.path.replace(/^\//, ""), slug) || sameSlug(row.tab, slug)) ??
    COST_PLANNING_TABS.find((row) => sameSlug(row.label, slug) || sameSlug(displaySlug(row.label), slug));
  if (tab) return { tab: tab.tab };
  const group = siteGroups.find((row) => row.nativeKey === "cost-planning");
  if (group) {
    const item = findItemBySlug(slug, group.items);
    if (item) return { tab: "external", itemId: item.id };
  }
  return null;
}

export function pageFromPath(pathname: string, sheets: SheetInfo[], siteGroups: ExternalSiteGroup[]): Page | null {
  const parts = splitPath(pathname);
  if (!parts.length) return null;

  const [head, tail] = parts;
  const staticPage = STATIC_PAGE_PATHS.find((row) => sameSlug(row.path.replace(/^\//, ""), head));
  if (staticPage && !tail) return { kind: staticPage.kind };

  if (sameSlug(head, "orçamentos") || sameSlug(head, "orcamentos") || sameSlug(head, "centros")) {
    if (!tail) return { kind: "costPlanning", view: { tab: "dash" } };
    const dash = COST_TAB_PATHS.find((row) => row.tab === "dash");
    if (dash && sameSlug(dash.path.replace(/^\//, ""), tail)) {
      return { kind: "costPlanning", view: { tab: "dash" } };
    }
    const resumo = COST_TAB_PATHS.find((row) => row.tab === "resumo");
    if (resumo && sameSlug(resumo.path.replace(/^\//, ""), tail)) {
      return { kind: "costPlanning", view: { tab: "resumo" } };
    }
    const sheet = findSheetBySlug(tail, sheets);
    if (sheet) return { kind: "costPlanning", view: { tab: "sheet", sheetId: sheet.id } };
    return { kind: "costPlanning", view: { tab: "dash" } };
  }

  if (!tail) {
    const costView = costViewFromSlug(head, sheets, siteGroups);
    if (costView) return { kind: "costPlanning", view: costView };
  }

  const group = findGroupBySlug(head, siteGroups);
  if (group) {
    if (group.nativeKey === "cost-planning") {
      if (!tail) return { kind: "costPlanning", view: { tab: "dash" } };
      const nested = costViewFromSlug(tail, sheets, siteGroups);
      if (nested) return { kind: "costPlanning", view: nested };
      const sheet = findSheetBySlug(tail, sheets);
      if (sheet) return { kind: "costPlanning", view: { tab: "sheet", sheetId: sheet.id } };
      return { kind: "costPlanning", view: { tab: "dash" } };
    }
    if (!tail) return { kind: "siteGroup", groupId: group.id };
    if (group.nativeKey === "gestao-colheita") {
      const native = GESTAO_COLHEITA_TABS.find((tab) => sameSlug(tab.id, tail) || sameSlug(tab.label, tail));
      if (native) return { kind: "siteGroup", groupId: group.id, tabKey: native.id };
    }
    if (group.nativeKey === "indicadores") {
      const native = INDICADORES_REPORTS.find((tab) => sameSlug(tab.id, tail) || sameSlug(tab.label, tail));
      if (native) {
        const item = group.items.find((row) => sameSlug(row.label, native.label));
        return { kind: "siteGroup", groupId: group.id, tabKey: native.id, itemId: item?.id };
      }
    }
    const item = findItemBySlug(tail, group.items);
    if (item) return { kind: "siteGroup", groupId: group.id, itemId: item.id };
    return { kind: "siteGroup", groupId: group.id, tabKey: tail };
  }

  return null;
}

export function currentPathname(): string {
  try {
    return decodeURI(window.location.pathname || "/");
  } catch {
    return window.location.pathname || "/";
  }
}

export function splitPath(pathname: string): string[] {
  return pathname
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

export function syncBrowserUrl(path: string, mode: "push" | "replace") {
  const next = path.startsWith("/") ? path : `/${path}`;
  const current = currentPathname();
  if (current === next) return;
  if (mode === "push" && sameSlug(current.replace(/^\//, ""), next.replace(/^\//, "")) && splitPath(current).length === splitPath(next).length) {
    window.history.replaceState({ app: true }, "", next);
    return;
  }
  if (mode === "push") window.history.pushState({ app: true }, "", next);
  else window.history.replaceState({ app: true }, "", next);
}

export type SiteGroupNav = {
  tabKey?: string;
  itemId?: number;
};
