import { useMemo } from "react";
import { ActivityLinks } from "./ActivityLinks";
import { AutoCalc } from "./AutoCalc";
import { CostCenter } from "./CostCenter";
import { Dashboard } from "./Dashboard";
import { ExternalSiteFrame } from "./ExternalSiteFrame";
import { OrcadoRealizado } from "./OrcadoRealizado";
import { Premissas } from "./Premissas";
import { Resumo } from "./Resumo";
import { VerifiedMark } from "./Sidebar";
import type { CostPlanningView } from "../store";
import type { ExternalSiteGroup, ExternalSiteItem, SheetInfo } from "../api";
import { useApp } from "../store";
import {
  canAccessCostTab,
  canAccessSheet,
  COST_PLANNING_TABS,
} from "../lib/permissions";
import { externalFrameTitle, isFuncionarioExternalReport, mergeTabsByLabel } from "../lib/mergeTabsByLabel";
import { MergedTabPicker, useMergedTabSelection } from "./MergedTabPicker";
import { FuncionarioOrcamentoRefreshBar } from "./FuncionarioOrcamentoRefresh";
import { SafraLoadProvider } from "./SafraLoadProgress";

const COST_PLANNING_MAIN_TABS = COST_PLANNING_TABS.filter(
  (row) => row.tab !== "resumo" && row.tab !== "dash" && row.tab !== "orcadoRealizado",
);
const DASH_TAB = COST_PLANNING_TABS.find((row) => row.tab === "dash");
const RESUMO_TAB = COST_PLANNING_TABS.find((row) => row.tab === "resumo");

const MAIN_TABS = [
  ...COST_PLANNING_MAIN_TABS.map((row) => ({ id: row.tab, label: row.label, tab: row.tab })),
  { id: "centers" as const, label: "Orçamentos" },
] as const;

type MainTabId = (typeof MAIN_TABS)[number]["id"] | `external:${number}`;

type HubTabEntry =
  | { kind: "main"; mainId: MainTabId; label: string }
  | { kind: "external"; item: ExternalSiteItem; label: string };

function mainTabFromView(view: CostPlanningView): MainTabId {
  if (view.tab === "sheet" || view.tab === "resumo" || view.tab === "dash") return "centers";
  if (view.tab === "external") return `external:${view.itemId}`;
  return view.tab;
}

function costPlanningExternalItems(siteGroups: ExternalSiteGroup[]): ExternalSiteItem[] {
  const group = siteGroups.find((row) => row.nativeKey === "cost-planning");
  return group?.items.filter((item) => item.visible) ?? [];
}

export function costPlanningTitle(
  view: CostPlanningView,
  sheets: SheetInfo[],
  siteGroups: ExternalSiteGroup[] = [],
) {
  if (view.tab === "dash") return DASH_TAB?.label ?? "Visão geral";
  if (view.tab === "sheet") {
    return sheets.find((sheet) => sheet.id === view.sheetId)?.title ?? "Centro de custo";
  }
  if (view.tab === "resumo") {
    return RESUMO_TAB?.label ?? "Relatório consolidado";
  }
  if (view.tab === "external") {
    const item = costPlanningExternalItems(siteGroups).find((row) => row.id === view.itemId);
    return item?.label ?? "Site incorporado";
  }
  return (
    COST_PLANNING_TABS.find((tab) => tab.tab === view.tab)?.label ??
    MAIN_TABS.find((tab) => tab.id === view.tab)?.label ??
    "Custo e Planejamento"
  );
}

export function costPlanningSubtitle(view: CostPlanningView, safraLabel?: string | null) {
  switch (view.tab) {
    case "dash":
      return "Totais por processo, comparativo de safra e orçamento por subprocesso.";
    case "premissas":
      return "Parâmetros que alimentam todas as outras abas.";
    case "autoCalc":
      return `Parâmetros da ${safraLabel ?? "safra"}: quantidade por ha, preço, premissa e Un do realizado.`;
    case "orcadoRealizado":
      return "Orçado das premissas da safra contra o realizado no Oracle.";
    case "resumo":
      return "Abra o centro de custo para ver atividades e materiais, ou agrupe o consolidado.";
    case "activityLinks":
      return "Ligue a atividade ao contrato variável, contrato fixo ou insumo. Vale para todas as safras.";
    case "external":
      return "Site externo aberto dentro do planejamento.";
    case "sheet":
      return "Categoria, depois atividade, depois os materiais aplicados.";
    default:
      return "Planejamento e controle de custos da safra.";
  }
}

export function CostPlanningHub({
  view,
  onView,
  sheets,
  embedGroup,
}: {
  view: CostPlanningView;
  onView: (next: CostPlanningView) => void;
  sheets: SheetInfo[];
  embedGroup?: ExternalSiteGroup;
}) {
  const { authUser, siteGroups } = useApp();
  const permissions = authUser?.permissions ?? [];
  const externalItems = embedGroup
    ? embedGroup.items.filter((item) => item.visible)
    : costPlanningExternalItems(siteGroups);
  const centers = sheets.filter(
    (sheet) => sheet.visible && sheet.kind === "cost_center" && canAccessSheet(permissions, sheet.id),
  );
  const canAccessDash = canAccessCostTab(permissions, "dash");
  const canAccessResumo = canAccessCostTab(permissions, "resumo");
  const visibleMainTabs = MAIN_TABS.filter((tab) => {
    if (tab.id === "centers") return centers.length > 0 || canAccessResumo || canAccessDash;
    return canAccessCostTab(permissions, tab.tab);
  });
  const hubTabGroups = useMemo(() => {
    const entries: HubTabEntry[] = [
      ...visibleMainTabs.map((tab) => ({ kind: "main" as const, mainId: tab.id, label: tab.label })),
      ...externalItems.map((item) => ({ kind: "external" as const, item, label: item.label })),
    ];
    return mergeTabsByLabel(entries);
  }, [visibleMainTabs, externalItems]);
  const activeMain = mainTabFromView(view);
  const activeSheetId = view.tab === "sheet" ? view.sheetId : null;
  const activeExternalGroup =
    view.tab === "external"
      ? hubTabGroups.find((group) => group.items.some((entry) => entry.kind === "external" && entry.item.id === view.itemId)) ??
        null
      : null;
  const activeHubGroup = useMemo(() => {
    if (view.tab === "external" && activeExternalGroup) return activeExternalGroup;
    if (view.tab === "sheet" || view.tab === "resumo" || view.tab === "dash") {
      return hubTabGroups.find((group) =>
        group.items.some((entry) => entry.kind === "main" && entry.mainId === "centers"),
      );
    }
    return hubTabGroups.find((group) =>
      group.items.some((entry) => entry.kind === "main" && entry.mainId === activeMain),
    );
  }, [view.tab, activeExternalGroup, hubTabGroups, activeMain]);

  const pickMain = (tab: MainTabId) => {
    if (tab === "centers") {
      if (canAccessDash) onView({ tab: "dash" });
      else if (centers[0]) onView({ tab: "sheet", sheetId: centers[0].id });
      else if (canAccessResumo) onView({ tab: "resumo" });
      return;
    }
    if (tab.startsWith("external:")) {
      onView({ tab: "external", itemId: Number(tab.slice("external:".length)) });
      return;
    }
    onView({ tab: tab as Exclude<CostPlanningView["tab"], "sheet" | "external"> });
  };

  const pickHubGroup = (groupKey: string) => {
    const group = hubTabGroups.find((entry) => entry.key === groupKey);
    if (!group) return;
    const main = group.items.find((entry) => entry.kind === "main");
    if (main?.kind === "main") {
      pickMain(main.mainId);
      return;
    }
    const external = group.items.find((entry) => entry.kind === "external");
    if (external?.kind === "external") {
      onView({ tab: "external", itemId: external.item.id });
    }
  };

  return (
    <div className="page cost-planning-hub">
      <div className="kind-toggle cost-planning-tabs" style={{ paddingBottom: 4, flexWrap: "wrap" }}>
        {hubTabGroups.map((group) => (
          <button
            key={group.key}
            type="button"
            className={`btn ${activeHubGroup?.key === group.key ? "primary" : ""}`}
            onClick={() => pickHubGroup(group.key)}
          >
            {group.label}
          </button>
        ))}
      </div>

      {activeMain === "centers" ? (
        <>
        <FuncionarioOrcamentoRefreshBar />
        <div className="kind-toggle cost-center-tabs" style={{ paddingBottom: 8, flexWrap: "wrap" }}>
          {canAccessDash ? (
            <button
              type="button"
              className={`btn ${view.tab === "dash" ? "primary" : ""}`}
              onClick={() => onView({ tab: "dash" })}
            >
              {DASH_TAB?.label ?? "Visão geral"}
            </button>
          ) : null}
          {canAccessResumo ? (
            <button
              type="button"
              className={`btn ${view.tab === "resumo" ? "primary" : ""}`}
              onClick={() => onView({ tab: "resumo" })}
            >
              {RESUMO_TAB?.label ?? "Relatório consolidado"}
            </button>
          ) : null}
          {centers.map((sheet) => (
            <button
              key={sheet.id}
              type="button"
              className={`btn ${activeSheetId === sheet.id ? "primary" : ""}`}
              onClick={() => onView({ tab: "sheet", sheetId: sheet.id })}
            >
              {sheet.verified ? <VerifiedMark /> : null}
              {sheet.title}
            </button>
          ))}
        </div>
        </>
      ) : null}

      <SafraLoadProvider active={activeMain === "centers"}>
        {view.tab === "dash" && canAccessCostTab(permissions, "dash") ? <Dashboard embedded /> : null}
        {view.tab === "resumo" && canAccessCostTab(permissions, "resumo") ? <Resumo embedded /> : null}
        {view.tab === "sheet" && canAccessSheet(permissions, view.sheetId) ? <CostCenter sheetId={view.sheetId} /> : null}
      </SafraLoadProvider>
      {view.tab === "premissas" && canAccessCostTab(permissions, "premissas") ? <Premissas /> : null}
      {view.tab === "autoCalc" && canAccessCostTab(permissions, "autoCalc") ? <AutoCalc /> : null}
      {view.tab === "orcadoRealizado" && canAccessCostTab(permissions, "orcadoRealizado") ? (
        <OrcadoRealizado embedded />
      ) : null}
      {view.tab === "activityLinks" && canAccessCostTab(permissions, "activityLinks") ? <ActivityLinks /> : null}
      {view.tab === "external" && activeExternalGroup ? (
        <CostPlanningExternalReports
          entries={activeExternalGroup.items.filter(
            (entry): entry is Extract<HubTabEntry, { kind: "external" }> => entry.kind === "external",
          )}
          selectedItemId={view.itemId}
          onSelect={(itemId) => onView({ tab: "external", itemId })}
        />
      ) : null}
    </div>
  );
}

function CostPlanningExternalReports({
  entries,
  selectedItemId,
  onSelect,
}: {
  entries: Extract<HubTabEntry, { kind: "external" }>[];
  selectedItemId: number;
  onSelect: (itemId: number) => void;
}) {
  const pickerItems = useMemo(
    () =>
      entries.map((entry) => ({
        key: String(entry.item.id),
        label: externalFrameTitle(entry.item.label, entry.item.url, entries.length > 1),
      })),
    [entries],
  );

  const { activeKey, setActiveKey } = useMergedTabSelection(
    pickerItems,
    String(selectedItemId),
  );

  const selected =
    entries.find((entry) => String(entry.item.id) === activeKey) ?? entries[0];

  const handleChange = (key: string) => {
    setActiveKey(key);
    onSelect(Number(key));
  };

  if (!selected) return null;

  return (
    <>
      <MergedTabPicker items={pickerItems} activeKey={activeKey} onChange={handleChange} />
      <ExternalSiteFrame
        url={selected.item.url}
        title={externalFrameTitle(selected.item.label, selected.item.url, entries.length > 1)}
      />
    </>
  );
}
