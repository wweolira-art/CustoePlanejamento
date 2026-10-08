import { SafraSelect } from "./SafraSelect";
import { useApp } from "../store";
import type { ExternalSiteGroup } from "../api";
import { isSidebarSiteGroup } from "../api";
import { APP_PRODUCT_NAME, IS_CUSTO_APP } from "../lib/appFlavor";
import {
  canAccess,
  canAccessCostTab,
  canAccessSiteGroup,
  canManageUsers,
  hasAnyCostPlanningAccess,
  PAGE_PERMISSIONS,
} from "../lib/permissions";

export function VerifiedMark({ title = "Planejamento verificado pela diretoria" }: { title?: string }) {
  return (
    <span className="verified-mark" title={title} aria-label={title}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="8" cy="8" r="7.25" fill="currentColor" opacity="0.2" />
        <path
          d="M4.6 8.2 7 10.6 11.5 5.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function Sidebar() {
  const { page, go, safra, siteGroups, authUser } = useApp();
  const permissions = authUser?.permissions ?? [];

  const orcadoActive =
    (page.kind === "costPlanning" && page.view.tab === "orcadoRealizado") ||
    (page.kind === "siteGroup" && page.costView?.tab === "orcadoRealizado");

  const renderSiteGroupBtn = (group: ExternalSiteGroup) => {
    const isCostPlanning = group.nativeKey === "cost-planning";
    const canSee = isCostPlanning
      ? canAccessSiteGroup(permissions, group.id) || hasAnyCostPlanningAccess(permissions)
      : canAccessSiteGroup(permissions, group.id);
    if (!canSee) return null;
    const onThisGroup = page.kind === "siteGroup" && page.groupId === group.id;
    return (
      <button
        key={group.id}
        className={`nav-btn ${onThisGroup && !(isCostPlanning && orcadoActive) ? "active" : ""}`}
        onClick={() =>
          isCostPlanning
            ? go({ kind: "costPlanning", view: { tab: "dash" } })
            : go({ kind: "siteGroup", groupId: group.id })
        }
      >
        {group.label}
      </button>
    );
  };

  const visibleSiteGroups = siteGroups.filter((group) => {
    if (!isSidebarSiteGroup(group)) return false;
    if (group.nativeKey === "cost-planning") {
      return canAccessSiteGroup(permissions, group.id) || hasAnyCostPlanningAccess(permissions);
    }
    return canAccessSiteGroup(permissions, group.id);
  });
  const cadastroPages = PAGE_PERMISSIONS.filter(
    (row) =>
      row.pageKind !== "users" &&
      row.pageKind !== "externalSites" &&
      row.pageKind !== "manage" &&
      canAccess(permissions, row.key),
  );
  const systemPages = PAGE_PERMISSIONS.filter(
    (row) =>
      (row.pageKind === "externalSites" || row.pageKind === "manage" || row.pageKind === "users") &&
      (row.pageKind === "users" ? canManageUsers(permissions) : canAccess(permissions, row.key)),
  );

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo-wrap">
          <img
            src="/elejota-agro-logo.png"
            alt="Elejota Agro"
            className="brand-logo"
          />
        </div>
        <h1>{APP_PRODUCT_NAME}</h1>
        <small>{safra?.label ?? "Safra"}</small>
        <SafraSelect variant="side" />
      </div>

      {visibleSiteGroups.length ? <div className="nav-sec">Planejamento, sites e colheita</div> : null}
      {visibleSiteGroups.map(renderSiteGroupBtn)}
      {canAccessCostTab(permissions, "orcadoRealizado") ? (
        <button
          type="button"
          className={`nav-btn ${orcadoActive ? "active" : ""}`}
          onClick={() => go({ kind: "costPlanning", view: { tab: "orcadoRealizado" } })}
        >
          Orçado x realizado
        </button>
      ) : null}
      {cadastroPages.length ? <div className="nav-sec">Cadastros</div> : null}
      {cadastroPages.map((row) => (
        <button
          key={row.key}
          className={`nav-btn ${page.kind === row.pageKind ? "active" : ""}`}
          onClick={() => go({ kind: row.pageKind })}
        >
          {row.label}
        </button>
      ))}

      {systemPages.length ? <div className="nav-sec">Sistema</div> : null}
      {systemPages.map((row) => (
        <button
          key={row.key}
          className={`nav-btn ghost ${page.kind === row.pageKind ? "active" : ""}`}
          onClick={() => go({ kind: row.pageKind })}
        >
          {row.label}
        </button>
      ))}
    </aside>
  );
}
