import { useEffect, useMemo, useState } from "react";
import type { ExternalSiteGroup } from "../api";
import {
  INDICADORES_GROUPS,
  isNativeTabHidden,
  type IndicadoresReportId,
} from "../lib/nativeEmbedTabs";
import { canAccessNativeTab } from "../lib/permissions";
import { useApp } from "../store";
import { ExternalSiteFrame } from "./ExternalSiteFrame";
import { IndicadoresColheitaProducao } from "./indicadores/IndicadoresColheitaProducao";
import { IndicadoresCombustivel } from "./indicadores/IndicadoresCombustivel";
import { IndicadoresControleEstoque } from "./indicadores/IndicadoresControleEstoque";
import { IndicadoresDisponibilidadeEquipamentos } from "./indicadores/IndicadoresDisponibilidadeEquipamentos";
import { IndicadoresMapaFazendas } from "./indicadores/IndicadoresMapaFazendas";
import { IndicadoresManutencaoProgramada } from "./indicadores/IndicadoresManutencaoProgramada";
import { IndicadoresGestaoManutencao } from "./indicadores/IndicadoresGestaoManutencao";
import { IndicadoresLubrificacao } from "./indicadores/IndicadoresLubrificacao";
import { ReportExpand } from "./indicadores/ReportExpand";
import { IndicadoresPneus } from "./indicadores/IndicadoresPneus";
import { IndicadoresMateriais } from "./indicadores/IndicadoresMateriais";
import { IndicadoresIrrigacao } from "./indicadores/IndicadoresIrrigacao";

export type { IndicadoresReportId };
export { INDICADORES_GROUPS };

type ReportDef = (typeof INDICADORES_GROUPS)[number]["reports"][number];

type ReportTab = ReportDef & {
  groupTitle: string;
  externalUrl?: string;
  externalItemId?: number;
};

function normalizeLabel(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function buildTabs(group: ExternalSiteGroup, permissions: string[] | undefined): ReportTab[] {
  const hidden = group.hiddenNativeTabs ?? [];
  const externalItems = group.items.filter((item) => item.visible);
  return INDICADORES_GROUPS.flatMap((entry) =>
    entry.reports
      .filter((report) => !isNativeTabHidden(hidden, report.id))
      .filter((report) => canAccessNativeTab(permissions, group, report.id))
      .map((report) => {
        const external = externalItems.find(
          (item) => normalizeLabel(item.label) === normalizeLabel(report.label),
        );
        return {
          ...report,
          groupTitle: entry.title,
          externalUrl: report.id === "manutencao" ? undefined : external?.url,
          externalItemId: report.id === "manutencao" ? undefined : external?.id,
        };
      }),
  );
}

function reportBody(active: IndicadoresReportId, current: ReportTab | undefined) {
  const isNative = current?.native;
  if (isNative && active === "irrigacao") return <IndicadoresIrrigacao />;
  if (isNative && active === "pneus") return <IndicadoresPneus />;
  if (isNative && active === "colheita-producao") return <IndicadoresColheitaProducao />;
  if (isNative && active === "combustivel") return <IndicadoresCombustivel />;
  if (isNative && active === "controle-estoque") return <IndicadoresControleEstoque />;
  if (isNative && active === "disponibilidade-equipamentos") return <IndicadoresDisponibilidadeEquipamentos />;
  if (isNative && active === "mapa-fazendas") return <IndicadoresMapaFazendas />;
  if (isNative && active === "materiais") return <IndicadoresMateriais />;
  if (isNative && active === "manutencao") {
    return <IndicadoresManutencaoProgramada externalQuadroUrl={current?.externalUrl} />;
  }
  if (isNative && active === "gestao-manutencao") return <IndicadoresGestaoManutencao />;
  if (isNative && active === "lubrificacao") return <IndicadoresLubrificacao />;
  if (current?.externalUrl) {
    return <ExternalSiteFrame url={current.externalUrl} title={current.label} />;
  }
  return (
    <div className="panel">
      <p className="lead">{current?.label ?? "Relatório"}</p>
      <p className="lead">
        Cadastre a URL em Sistema → Sites incorporados, subaba &quot;{current?.label}&quot; na aba
        Indicadores.
      </p>
    </div>
  );
}

export function IndicadoresPage({
  group,
  initialItemId,
  initialTabKey,
  onNavigate,
}: {
  group: ExternalSiteGroup;
  initialItemId?: number;
  initialTabKey?: string;
  onNavigate?: (next: { tabKey?: string; itemId?: number }) => void;
}) {
  const { authUser } = useApp();
  const permissions = authUser?.permissions;
  const tabs = useMemo(() => buildTabs(group, permissions), [group, permissions]);
  const visibleGroups = useMemo(
    () =>
      INDICADORES_GROUPS.map((entry) => ({
        ...entry,
        reports: entry.reports.filter((report) => tabs.some((tab) => tab.id === report.id)),
      })).filter((entry) => entry.reports.length),
    [tabs],
  );

  const [active, setActive] = useState<IndicadoresReportId>(() => {
    if (initialTabKey && tabs.some((tab) => tab.id === initialTabKey)) {
      return initialTabKey as IndicadoresReportId;
    }
    if (initialItemId) {
      const hit = tabs.find((tab) => tab.externalItemId === initialItemId);
      if (hit) return hit.id;
    }
    return tabs[0]?.id ?? "irrigacao";
  });

  useEffect(() => {
    if (initialTabKey && tabs.some((tab) => tab.id === initialTabKey)) {
      setActive(initialTabKey as IndicadoresReportId);
      return;
    }
    if (initialItemId) {
      const hit = tabs.find((tab) => tab.externalItemId === initialItemId);
      if (hit) setActive(hit.id);
    }
  }, [initialTabKey, initialItemId, tabs]);

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === active)) {
      setActive(tabs[0]?.id ?? "irrigacao");
    }
  }, [tabs, active]);

  const current = tabs.find((tab) => tab.id === active);

  if (!tabs.length) {
    return (
      <div className="page external-site-page indicadores-page">
        <p className="lead">Nenhuma tela de Indicadores liberada para este usuário.</p>
      </div>
    );
  }

  return (
    <div className="page external-site-page indicadores-page">
      <div className="ia-admin-nav indicadores-nav no-print">
        {visibleGroups.map((entry) => (
          <div key={entry.title} className="ia-admin-nav-group indicadores-nav-group">
            <span className="ia-admin-nav-title indicadores-nav-title">{entry.title}</span>
            <div className="kind-toggle external-site-tabs indicadores-tabs">
              {entry.reports.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  className={`btn ${active === report.id ? "primary" : ""}`}
                  onClick={() => {
                    setActive(report.id);
                    const itemId = tabs.find((tab) => tab.id === report.id)?.externalItemId;
                    onNavigate?.({ tabKey: report.id, itemId });
                  }}
                >
                  {report.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <ReportExpand
        title={current?.label ?? "Relatório"}
        className={
          active === "colheita-producao"
            ? "report-expand-desempenho"
            : active === "irrigacao"
              ? "report-expand-irrigacao"
              : undefined
        }
      >
        {reportBody(active, current)}
      </ReportExpand>
    </div>
  );
}
