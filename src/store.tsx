import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, api, authStorage, type AuthUser, type ExternalSiteGroup, type Safra, type SheetInfo } from "./api";
import { currentPathname, pageFromPath, pathFromPage, syncBrowserUrl } from "./lib/appRoutes";
import { canAccessPage, firstAllowedPage } from "./lib/permissions";

export type CostPlanningView =
  | { tab: "dash" }
  | { tab: "premissas" }
  | { tab: "autoCalc" }
  | { tab: "orcadoRealizado" }
  | { tab: "resumo" }
  | { tab: "activityLinks" }
  | { tab: "external"; itemId: number }
  | { tab: "sheet"; sheetId: number };

type Page =
  | { kind: "costPlanning"; view: CostPlanningView }
  | { kind: "manage" }
  | { kind: "activities" }
  | { kind: "empenhos" }
  | { kind: "fazendas" }
  | { kind: "materials" }
  | { kind: "costObjects" }
  | { kind: "categories" }
  | { kind: "safras" }
  | { kind: "seedRadiusTariffs" }
  | { kind: "seedTransportReport" }
  | { kind: "contractControl" }
  | { kind: "harvestAreas" }
  | { kind: "siteGroup"; groupId: number; itemId?: number; tabKey?: string; costView?: CostPlanningView }
  | { kind: "externalSites" }
  | { kind: "users" };

export function findCostPlanningGroupId(siteGroups: ExternalSiteGroup[]) {
  return siteGroups.find((group) => group.nativeKey === "cost-planning")?.id ?? null;
}

export function normalizePage(page: Page, siteGroups: ExternalSiteGroup[]): Page {
  if (page.kind !== "costPlanning") return page;
  const groupId = findCostPlanningGroupId(siteGroups);
  if (!groupId) return page;
  return { kind: "siteGroup", groupId, costView: page.view };
}

export function costPlanningSheet(sheetId: number): Page {
  return { kind: "costPlanning", view: { tab: "sheet", sheetId } };
}

export function costPlanningTab(
  tab: Exclude<CostPlanningView["tab"], "sheet" | "external">,
): Page {
  return { kind: "costPlanning", view: { tab } };
}

export function costPlanningExternal(itemId: number): Page {
  return { kind: "costPlanning", view: { tab: "external", itemId } };
}

export type { Page };

interface AppState {
  ready: boolean;
  error: string | null;
  authUser: AuthUser | null;
  authLoading: boolean;
  authOffline: boolean;
  sheets: SheetInfo[];
  siteGroups: ExternalSiteGroup[];
  safras: Safra[];
  safraId: number;
  safra: Safra | null;
  safraSwitching: boolean;
  page: Page;
  theme: "light" | "dark";
  go: (page: Page) => void;
  toggleTheme: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  selectSafra: (id: number) => Promise<void>;
  addSafra: (code: string, label?: string, copyFrom?: boolean) => Promise<number | undefined>;
  removeSafra: (id: number) => Promise<void>;
  reload: () => Promise<void>;
  reloadSiteGroups: () => Promise<void>;
  refreshAuthUser: () => Promise<void>;
  setSheetVerified: (id: number, verified: boolean) => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [siteGroups, setSiteGroups] = useState<ExternalSiteGroup[]>([]);
  const [safras, setSafras] = useState<Safra[]>([]);
  const [safraId, setSafraId] = useState(0);
  const [safraSwitching, setSafraSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authOffline, setAuthOffline] = useState(false);
  const [page, setPageState] = useState<Page>({ kind: "costPlanning", view: { tab: "dash" } });
  const [catalogReady, setCatalogReady] = useState(false);
  const appliedRoute = useRef(false);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    localStorage.getItem("theme") === "dark" ? "dark" : "light",
  );

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      localStorage.setItem("theme", next);
      document.documentElement.dataset.theme = next;
      return next;
    });
  }, []);

  const applySafras = (data: { safras: Safra[]; currentId: number }) => {
    setSafras(data.safras);
    setSafraId(data.currentId);
  };

  const reloadSiteGroups = useCallback(async () => {
    try {
      setSiteGroups(await api.externalSites());
    } catch {
      setSiteGroups([]);
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const [sheetRows, harvest, groups] = await Promise.all([api.sheets(), api.safras(), api.externalSites()]);
      setSheets(sheetRows);
      applySafras(harvest);
      setSiteGroups(groups);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar o banco");
    } finally {
      setCatalogReady(true);
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await api.login(email, password);
      authStorage.setToken(session.token);
      setAuthUser(session.user);
      setError(null);
      await reload();
    },
    [reload],
  );

  const logout = useCallback(() => {
    authStorage.clear();
    setAuthUser(null);
    setSheets([]);
    setSiteGroups([]);
    setSafras([]);
    setSafraId(0);
    setError(null);
    setCatalogReady(false);
    appliedRoute.current = false;
    void api.logout().catch(() => undefined);
  }, []);

  const selectSafra = useCallback(async (id: number) => {
    if (id === safraId) return;
    setSafraSwitching(true);
    try {
      applySafras(await api.setSafra(id));
      setSheets(await api.sheets());
    } finally {
      setSafraSwitching(false);
    }
  }, [safraId]);

  const addSafra = useCallback(async (code: string, label?: string, copyFrom = true) => {
    const data = await api.addSafra(code, label, copyFrom);
    applySafras(data);
    if (data.createdId && copyFrom) await selectSafra(data.createdId);
    return data.createdId;
  }, [selectSafra]);

  const removeSafra = useCallback(async (id: number) => {
    applySafras(await api.deleteSafra(id));
  }, []);

  const refreshAuthUser = useCallback(async () => {
    const data = await api.me();
    setAuthUser(data.user);
  }, []);

  const setSheetVerified = useCallback(async (id: number, verified: boolean) => {
    const row = await api.setVerified(id, verified);
    if (!row) return;
    setSheets((current) => current.map((sheet) => (sheet.id === id ? { ...sheet, ...row } : sheet)));
  }, []);

  const go = useCallback(
    (next: Page) => {
      const normalized = normalizePage(next, siteGroups);
      const target =
        authUser && !canAccessPage(authUser.permissions, normalized, siteGroups)
          ? firstAllowedPage(authUser.permissions, sheets, siteGroups)
          : normalized;
      setPageState(target);
      syncBrowserUrl(pathFromPage(target, sheets, siteGroups), "push");
    },
    [authUser, sheets, siteGroups],
  );

  useEffect(() => {
    if (!authUser) return;
    if (page.kind === "costPlanning") {
      setPageState(normalizePage(page, siteGroups));
      return;
    }
    if (!canAccessPage(authUser.permissions, page, siteGroups)) {
      const fallback = firstAllowedPage(authUser.permissions, sheets, siteGroups);
      setPageState(fallback);
      syncBrowserUrl(pathFromPage(fallback, sheets, siteGroups), "replace");
    }
  }, [authUser, page, sheets, siteGroups]);

  useEffect(() => {
    if (!authUser || !catalogReady || appliedRoute.current) return;
    appliedRoute.current = true;
    const parsed = pageFromPath(currentPathname(), sheets, siteGroups);
    const allowed =
      parsed && canAccessPage(authUser.permissions, parsed, siteGroups)
        ? normalizePage(parsed, siteGroups)
        : firstAllowedPage(authUser.permissions, sheets, siteGroups);
    setPageState(allowed);
    syncBrowserUrl(pathFromPage(allowed, sheets, siteGroups), "replace");
  }, [authUser, catalogReady, sheets, siteGroups]);

  useEffect(() => {
    const onPopState = () => {
      const parsed = pageFromPath(currentPathname(), sheets, siteGroups);
      if (parsed && (!authUser || canAccessPage(authUser.permissions, parsed, siteGroups))) {
        setPageState(normalizePage(parsed, siteGroups));
        return;
      }
      if (authUser) {
        const fallback = firstAllowedPage(authUser.permissions, sheets, siteGroups);
        setPageState(fallback);
        syncBrowserUrl(pathFromPage(fallback, sheets, siteGroups), "replace");
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [authUser, sheets, siteGroups]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    async function restoreSession() {
      const token = authStorage.getToken();
      if (!token) {
        if (cancelled) return;
        setAuthUser(null);
        setAuthOffline(false);
        setAuthLoading(false);
        return;
      }
      try {
        const data = await api.me();
        if (cancelled) return;
        setAuthUser(data.user);
        setAuthOffline(false);
        setAuthLoading(false);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          authStorage.clear();
          setAuthUser(null);
          setAuthOffline(false);
          setAuthLoading(false);
          return;
        }
        setAuthOffline(true);
        setAuthLoading(true);
        timer = window.setTimeout(() => {
          void restoreSession();
        }, 2000);
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!authUser) return;
    void reload();
  }, [authUser, reload]);

  const safra = safras.find((row) => row.id === safraId) ?? null;

  const value = useMemo<AppState>(
    () => ({
      ready: Boolean(authUser) && (sheets.length > 0 || Boolean(error)),
      error,
      authUser,
      authLoading,
      authOffline,
      sheets,
      siteGroups,
      safras,
      safraId,
      safra,
      safraSwitching,
      page,
      theme,
      go,
      toggleTheme,
      login,
      logout,
      selectSafra,
      addSafra,
      removeSafra,
      reload,
      reloadSiteGroups,
      refreshAuthUser,
      setSheetVerified,
    }),
    [authUser, authLoading, authOffline, sheets, siteGroups, error, safras, safraId, safra, safraSwitching, page, theme, toggleTheme, login, logout, selectSafra, addSafra, removeSafra, reload, reloadSiteGroups, refreshAuthUser, setSheetVerified, go],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp fora do provider");
  return ctx;
}
