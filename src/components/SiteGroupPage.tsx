import { useEffect, useMemo, useState } from "react";
import { api, type ExternalSiteGroup } from "../api";
import { canAccessCostTab, canAccessGroupItem, canAccessNativeTab, canAccessSheet, COST_PLANNING_TABS } from "../lib/permissions";
import type { SiteGroupNav } from "../lib/appRoutes";
import { externalFrameTitle, mergeTabsByLabel } from "../lib/mergeTabsByLabel";
import { type CostPlanningView, useApp } from "../store";
import { CostPlanningHub } from "./CostPlanningHub";
import { ExternalSiteFrame } from "./ExternalSiteFrame";
import { GestaoColheitaNativePanel, GESTAO_COLHEITA_TABS, type GestaoColheitaTab } from "./GestaoColheita";
import { IndicadoresPage } from "./Indicadores";
import { MergedTabPicker, useMergedTabSelection } from "./MergedTabPicker";

type TabItem =
  | { kind: "native"; id: string; label: string }
  | { kind: "external"; id: string; label: string; url: string };

function SiteGroupMergedContent({
  items,
  initialExternalId,
  initialNativeId,
  onNavigate,
}: {
  items: TabItem[];
  initialExternalId?: number;
  initialNativeId?: string;
  onNavigate?: (next: SiteGroupNav) => void;
}) {
  const pickerItems = useMemo(
    () =>
      items.map((tab) => ({
        key: tab.kind === "native" ? `native:${tab.id}` : `external:${tab.id}`,
        label:
          tab.kind === "external" && items.length > 1
            ? externalFrameTitle(tab.label, tab.url, true)
            : tab.label,
      })),
    [items],
  );

  const initialKey = initialNativeId
    ? `native:${initialNativeId}`
    : initialExternalId
      ? `external:${initialExternalId}`
      : undefined;
  const { activeKey, setActiveKey } = useMergedTabSelection(pickerItems, initialKey);
  const activeTab = items.find((tab) =>
    tab.kind === "native" ? activeKey === `native:${tab.id}` : activeKey === `external:${tab.id}`,
  );

  const pick = (key: string) => {
    setActiveKey(key);
    const tab = items.find((item) =>
      item.kind === "native" ? key === `native:${item.id}` : key === `external:${item.id}`,
    );
    if (tab?.kind === "native") onNavigate?.({ tabKey: tab.id });
    else if (tab?.kind === "external") onNavigate?.({ itemId: Number(tab.id) });
  };

  return (
    <>
      <MergedTabPicker items={pickerItems} activeKey={activeKey} onChange={pick} />
      {activeTab?.kind === "native" ? (
        <GestaoColheitaNativePanel tab={activeTab.id as GestaoColheitaTab} />
      ) : activeTab?.kind === "external" ? (
        <ExternalSiteFrame
          url={activeTab.url}
          title={externalFrameTitle(activeTab.label, activeTab.url, items.length > 1)}
        />
      ) : null}
    </>
  );
}

function defaultCostPlanningView(
  permissions: string[],
  sheets: { id: number; visible: boolean; kind: string }[],
): CostPlanningView {
  const tab = COST_PLANNING_TABS.find((row) => canAccessCostTab(permissions, row.tab));
  if (tab) return { tab: tab.tab };
  const center = sheets.find(
    (sheet) => sheet.visible && sheet.kind === "cost_center" && canAccessSheet(permissions, sheet.id),
  );
  if (center) return { tab: "sheet", sheetId: center.id };
  return { tab: "dash" };
}

function CostPlanningSiteGroup({
  group,
  initialView,
  onView,
}: {
  group: ExternalSiteGroup;
  initialView?: CostPlanningView;
  onView: (next: CostPlanningView) => void;
}) {
  const { authUser, sheets } = useApp();
  const permissions = authUser?.permissions ?? [];
  const [view, setView] = useState<CostPlanningView>(
    () => initialView ?? defaultCostPlanningView(permissions, sheets),
  );

  useEffect(() => {
    if (initialView) setView(initialView);
  }, [initialView]);

  const handleView = (next: CostPlanningView) => {
    setView(next);
    onView(next);
  };

  return <CostPlanningHub view={view} onView={handleView} sheets={sheets} embedGroup={group} />;
}

export function SiteGroupPage({
  group,
  initialItemId,
  initialTabKey,
  initialCostView,
  onCostView,
  onNavigate,
}: {
  group: ExternalSiteGroup;
  initialItemId?: number;
  initialTabKey?: string;
  initialCostView?: CostPlanningView;
  onCostView?: (next: CostPlanningView) => void;
  onNavigate?: (next: SiteGroupNav) => void;
}) {
  const hiddenNativeTabs = group.hiddenNativeTabs ?? [];
  const { authUser } = useApp();
  const permissions = authUser?.permissions;
  const externalItems = group.items
    .filter((item) => item.visible)
    .filter((item) => canAccessGroupItem(permissions, group, item.id));
  const isGestao = group.nativeKey === "gestao-colheita";
  const isIndicadores = group.nativeKey === "indicadores";
  const isCostPlanning = group.nativeKey === "cost-planning";

  const tabGroups = useMemo(() => {
    if (isCostPlanning || isIndicadores) return [];
    const rawTabs: TabItem[] = isGestao
      ? [
          ...GESTAO_COLHEITA_TABS.filter(
            (tab) => !hiddenNativeTabs.includes(tab.id) && canAccessNativeTab(permissions, group, tab.id),
          ).map((tab) => ({
            kind: "native" as const,
            id: tab.id,
            label: tab.label,
          })),
          ...externalItems.map((item) => ({
            kind: "external" as const,
            id: String(item.id),
            label: item.label,
            url: item.url,
          })),
        ]
      : externalItems.map((item) => ({
          kind: "external" as const,
          id: String(item.id),
          label: item.label,
          url: item.url,
        }));
    return mergeTabsByLabel(rawTabs);
  }, [externalItems, isGestao, isCostPlanning, isIndicadores, hiddenNativeTabs, permissions, group]);

  const [activeKey, setActiveKey] = useState(() => {
    if (initialTabKey) {
      const hit = tabGroups.find((groupTab) =>
        groupTab.items.some((tab) => tab.kind === "native" && tab.id === initialTabKey),
      );
      if (hit) return hit.key;
    }
    if (initialItemId) {
      const hit = tabGroups.find((groupTab) =>
        groupTab.items.some((tab) => tab.kind === "external" && tab.id === String(initialItemId)),
      );
      if (hit) return hit.key;
    }
    return tabGroups[0]?.key ?? "";
  });

  useEffect(() => {
    if (initialTabKey) {
      const hit = tabGroups.find((groupTab) =>
        groupTab.items.some((tab) => tab.kind === "native" && tab.id === initialTabKey),
      );
      if (hit) {
        setActiveKey(hit.key);
        return;
      }
    }
    if (initialItemId) {
      const hit = tabGroups.find((groupTab) =>
        groupTab.items.some((tab) => tab.kind === "external" && tab.id === String(initialItemId)),
      );
      if (hit) setActiveKey(hit.key);
    }
  }, [initialTabKey, initialItemId, tabGroups]);

  useEffect(() => {
    if (!tabGroups.some((groupTab) => groupTab.key === activeKey)) {
      setActiveKey(tabGroups[0]?.key ?? "");
    }
  }, [tabGroups, activeKey]);

  const currentGroup = tabGroups.find((groupTab) => groupTab.key === activeKey);

  if (isCostPlanning) {
    return (
      <CostPlanningSiteGroup
        group={group}
        initialView={initialCostView}
        onView={(next) => onCostView?.(next)}
      />
    );
  }

  if (isIndicadores) {
    return (
      <IndicadoresPage
        group={group}
        initialItemId={initialItemId}
        initialTabKey={initialTabKey}
        onNavigate={onNavigate}
      />
    );
  }

  if (!tabGroups.length) {
    const hasConfigured =
      (isGestao && GESTAO_COLHEITA_TABS.some((tab) => !hiddenNativeTabs.includes(tab.id))) ||
      group.items.some((item) => item.visible);
    return (
      <div className="page">
        <p className="lead">
          {hasConfigured
            ? `Nenhuma tela de ${group.label} liberada para este usuário.`
            : `Nenhuma subaba configurada para ${group.label}.`}
        </p>
        {hasConfigured ? null : (
          <p className="lead">Cadastre sites em Sistema → Sites incorporados.</p>
        )}
      </div>
    );
  }

  return (
    <div className="page external-site-page">
      <div className="kind-toggle external-site-tabs" style={{ paddingBottom: 4, flexWrap: "wrap" }}>
        {tabGroups.map((groupTab) => (
          <button
            key={groupTab.key}
            type="button"
            className={`btn ${activeKey === groupTab.key ? "primary" : ""}`}
            onClick={() => {
              setActiveKey(groupTab.key);
              const native = groupTab.items.find((tab) => tab.kind === "native");
              const external = groupTab.items.find((tab) => tab.kind === "external");
              if (native?.kind === "native") onNavigate?.({ tabKey: native.id });
              else if (external?.kind === "external") onNavigate?.({ itemId: Number(external.id) });
            }}
          >
            {groupTab.label}
          </button>
        ))}
      </div>
      {currentGroup ? (
        <SiteGroupMergedContent
          key={currentGroup.key}
          items={currentGroup.items}
          initialExternalId={
            initialItemId &&
            currentGroup.items.some((tab) => tab.kind === "external" && tab.id === String(initialItemId))
              ? initialItemId
              : undefined
          }
          initialNativeId={
            initialTabKey && currentGroup.items.some((tab) => tab.kind === "native" && tab.id === initialTabKey)
              ? initialTabKey
              : undefined
          }
          onNavigate={onNavigate}
        />
      ) : null}    </div>
  );
}

export function SiteGroupLoader({
  groupId,
  itemId,
  tabKey,
  costView,
  onCostView,
  onNavigate,
}: {
  groupId: number;
  itemId?: number;
  tabKey?: string;
  costView?: CostPlanningView;
  onCostView?: (next: CostPlanningView) => void;
  onNavigate?: (next: SiteGroupNav) => void;
}) {
  const [group, setGroup] = useState<ExternalSiteGroup | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    api
      .externalSiteGroup(groupId)
      .then((data) => {
        if (!cancelled) setGroup(data);
      })
      .catch((e: Error) => {
        if (!cancelled) setErr(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  if (err) {
    return (
      <div className="page">
        <p className="lead" style={{ color: "var(--danger)" }}>
          {err}
        </p>
      </div>
    );
  }
  if (!group) {
    return (
      <div className="page">
        <p className="lead">Carregando…</p>
      </div>
    );
  }
  return (
    <SiteGroupPage
      group={group}
      initialItemId={itemId}
      initialTabKey={tabKey}
      initialCostView={costView}
      onCostView={onCostView}
      onNavigate={onNavigate}
    />
  );
}
