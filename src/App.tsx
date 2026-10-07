import { Component, useEffect, useMemo, type ReactNode } from "react";
import { Activities } from "./components/Activities";
import { Categories } from "./components/Categories";
import { CostObjects } from "./components/CostObjects";
import { Fazendas } from "./components/Fazendas";
import { HarvestAreas } from "./components/HarvestAreas";
import { ExternalSitesAdmin } from "./components/ExternalSitesAdmin";
import { SiteGroupLoader } from "./components/SiteGroupPage";
import { Materials } from "./components/Materials";
import { SheetManager } from "./components/SheetManager";
import { SeedRadiusTariffs } from "./components/SeedRadiusTariffs";
import { SeedTransportReport } from "./components/SeedTransportReport";
import { ContractControl } from "./components/ContractControl";
import { Safras } from "./components/Safras";
import { SafraSelect } from "./components/SafraSelect";
import { Sidebar, VerifiedMark } from "./components/Sidebar";
import { Login } from "./components/Login";
import { UsersAdmin } from "./components/UsersAdmin";
import { costPlanningSubtitle, costPlanningTitle } from "./components/CostPlanningHub";
import { EditAccessProvider, ReadOnlyBanner } from "./lib/editAccess";
import { APP_PRODUCT_NAME } from "./lib/appFlavor";
import { canEditPage } from "./lib/permissions";
import { useApp, type Page } from "./store";

class ScreenError extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message || "Erro ao abrir esta tela." };
  }

  render() {
    if (this.state.message) {
      return (
        <div className="page">
          <p className="lead" style={{ color: "var(--danger)" }}>
            Esta tela não carregou: {this.state.message}
          </p>
          <button className="btn" onClick={() => this.setState({ message: null })}>
            Tentar de novo
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function appScreenTitle(
  page: Page,
  sheets: ReturnType<typeof useApp>["sheets"],
  siteGroups: ReturnType<typeof useApp>["siteGroups"],
) {
  const siteGroup = page.kind === "siteGroup" ? siteGroups.find((group) => group.id === page.groupId) : null;
  const activeCostView =
    page.kind === "costPlanning"
      ? page.view
      : page.kind === "siteGroup" && siteGroup?.nativeKey === "cost-planning"
        ? page.costView
        : null;
  if (activeCostView) return costPlanningTitle(activeCostView, sheets, siteGroups);
  if (page.kind === "siteGroup") return siteGroup?.label ?? "Site incorporado";
  if (page.kind === "externalSites") return "Sites incorporados";
  if (page.kind === "users") return "Usuários e permissões";
  if (page.kind === "manage") return "Gerenciar abas";
  if (page.kind === "activities") return "Atividades";
  if (page.kind === "fazendas") return "Fazendas";
  if (page.kind === "materials") return "Materiais";
  if (page.kind === "costObjects") return "Objetos de custo";
  if (page.kind === "categories") return "Categorias";
  if (page.kind === "harvestAreas") return "Áreas";
  if (page.kind === "safras") return "Safras";
  if (page.kind === "seedRadiusTariffs") return "Raio transporte de semente";
  if (page.kind === "seedTransportReport") return "Relatório transporte semente";
  if (page.kind === "contractControl") return "Controle de contrato";
  return "Custo e Planejamento";
}

export function App() {
  const {
    ready,
    error,
    page,
    sheets,
    siteGroups,
    theme,
    toggleTheme,
    safra,
    setSheetVerified,
    authUser,
    authLoading,
    authOffline,
    login,
    logout,
    reloadSiteGroups,
    go,
  } = useApp();

  const screenKey =
    page.kind === "costPlanning"
      ? page.view.tab === "sheet"
        ? `costPlanning-sheet-${page.view.sheetId}`
        : page.view.tab === "external"
          ? `costPlanning-external-${page.view.itemId}`
          : `costPlanning-${page.view.tab}`
      : page.kind === "siteGroup"
        ? page.costView
          ? page.costView.tab === "sheet"
            ? `siteGroup-${page.groupId}-sheet-${page.costView.sheetId}`
            : page.costView.tab === "external"
              ? `siteGroup-${page.groupId}-external-${page.costView.itemId}`
              : `siteGroup-${page.groupId}-${page.costView.tab}`
          : `siteGroup-${page.groupId}-${page.tabKey ?? page.itemId ?? "root"}`
        : page.kind;

  const siteGroup = page.kind === "siteGroup" ? siteGroups.find((group) => group.id === page.groupId) : null;
  const canEditCurrent = useMemo(
    () => canEditPage(authUser?.permissions, page, siteGroups),
    [authUser?.permissions, page, siteGroups],
  );

  useEffect(() => {
    if (authUser) {
      document.documentElement.dataset.app = "authenticated";
    } else {
      delete document.documentElement.dataset.app;
    }
  }, [authUser]);

  const title = appScreenTitle(page, sheets, siteGroups);

  useEffect(() => {
    document.title = authUser ? `${title} · ${APP_PRODUCT_NAME}` : `Login · ${APP_PRODUCT_NAME}`;
  }, [authUser, title]);

  if (authLoading) {
    return (
      <div className="boot">
        <div>
          <h1>{authOffline ? "Servidor indisponível" : "Verificando sessão…"}</h1>
          <p>
            {authOffline
              ? "A conexão caiu. A sessão continua salva e a entrada será retomada assim que o servidor voltar."
              : "Aguarde um instante."}
          </p>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return <Login onLogin={login} />;
  }

  if (error && !sheets.length) {
    return (
      <div className="boot">
        <div>
          <h1>Banco de dados indisponível</h1>
          <p>Suba a API com npm run dev e recarregue. {error}</p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="boot">
        <div>
          <h1>Abrindo o orçamento…</h1>
          <p>Lendo o SQLite e as premissas da safra.</p>
        </div>
      </div>
    );
  }

  const activeCostView =
    page.kind === "costPlanning"
      ? page.view
      : page.kind === "siteGroup" && siteGroup?.nativeKey === "cost-planning"
        ? page.costView
        : null;
  const sheetId = activeCostView?.tab === "sheet" ? activeCostView.sheetId : null;
  const current = sheetId ? sheets.find((s) => s.id === sheetId) : null;
  const verified = Boolean(current?.verified);
  const subtitle =
    activeCostView
      ? costPlanningSubtitle(activeCostView, safra?.label)
      : page.kind === "siteGroup"
            ? siteGroup?.nativeKey === "gestao-colheita"
              ? "Ferramentas da colheita e sites externos configurados nesta aba."
              : siteGroup?.nativeKey === "cost-planning"
                ? "Orçamento, custos da safra e relatórios incorporados."
                : siteGroup?.nativeKey === "indicadores"
                  ? ""
                  : "Site externo aberto dentro do orçamento."
            : page.kind === "externalSites"
              ? "Cadastre URLs e escolha se o site entra em uma aba existente (como Custo e Planejamento) ou em uma nova aba no menu."
              : page.kind === "users"
                ? "Crie usuários, verifique senhas e defina quais abas cada pessoa pode acessar."
                : page.kind === "manage"
                  ? "Ocultar ou excluir abas gravadas no SQLite."
                  : page.kind === "activities"
                    ? "Cadastro de atividades com código, descrição e empenho."
                    : page.kind === "fazendas"
                      ? "Cadastro de fazendas com código, descrição e distância. Importe de agricola.fazenda no Oracle."
                      : page.kind === "materials"
                        ? "Cadastro de materiais com código, tipo, grupo, valor e empenho. Importe de material.material no Oracle."
                        : page.kind === "costObjects"
                          ? "Cadastro de objetos de custo usados nas linhas dos centros."
                          : page.kind === "categories"
                            ? "Cadastro das categorias usadas nos centros de custo."
                            : page.kind === "harvestAreas"
                              ? `Hectares da ${safra?.label ?? "safra"}: plantio, tratos e demais áreas. Copie da safra anterior e ajuste o que mudou.`
                              : page.kind === "safras"
                                ? "Cadastre os períodos do orçamento, como 25/26 e 26/27."
                                : page.kind === "seedRadiusTariffs"
                                  ? "Faixas de km inicial, km final e preço do transporte de semente."
                                  : page.kind === "seedTransportReport"
                                    ? "Lance os transportes de cana semente e imprima o relatório no modelo operacional."
                                    : page.kind === "contractControl"
                                      ? "Contas a pagar por prestador. As notas de combustível são lançadas na tela e ficam gravadas neste aplicativo."
                                  : "Planejamento e controle de custos da safra.";

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <header className="topbar">
          <div>
            <h2>
              {verified ? <VerifiedMark /> : null}
              {title}
            </h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className="topbar-actions">
            {current?.kind === "cost_center" && canEditCurrent ? (
              <label className="check-label verified-toggle">
                <span className="check-row">
                  <input
                    type="checkbox"
                    checked={verified}
                    onChange={(e) => void setSheetVerified(current.id, e.target.checked)}
                  />
                  Verificado pela diretoria
                </span>
              </label>
            ) : null}
            <SafraSelect variant="top" />
            <span className="login-user-chip" title={authUser.email}>
              {authUser.nome}
            </span>
            <button type="button" className="btn" onClick={logout}>
              Sair
            </button>
            <button className="btn theme-btn" onClick={toggleTheme}>
              {theme === "dark" ? "Versão clara" : "Versão escura"}
            </button>
          </div>
        </header>
        <ReadOnlyBanner />
        <EditAccessProvider canEdit={canEditCurrent}>
        <ScreenError key={screenKey}>
          {page.kind === "siteGroup" ? (
            <SiteGroupLoader
              groupId={page.groupId}
              itemId={page.itemId}
              tabKey={page.tabKey}
              costView={page.costView}
              onCostView={(costView) => go({ kind: "siteGroup", groupId: page.groupId, costView })}
              onNavigate={(next) => go({ kind: "siteGroup", groupId: page.groupId, ...next })}
            />
          ) : null}
          {page.kind === "externalSites" ? <ExternalSitesAdmin onChanged={() => void reloadSiteGroups()} /> : null}
          {page.kind === "users" ? <UsersAdmin /> : null}
          {page.kind === "manage" ? <SheetManager /> : null}
          {page.kind === "activities" ? <Activities /> : null}
          {page.kind === "fazendas" ? <Fazendas /> : null}
          {page.kind === "materials" ? <Materials /> : null}
          {page.kind === "costObjects" ? <CostObjects /> : null}
          {page.kind === "categories" ? <Categories /> : null}
          {page.kind === "harvestAreas" ? <HarvestAreas /> : null}
          {page.kind === "seedRadiusTariffs" ? <SeedRadiusTariffs /> : null}
          {page.kind === "seedTransportReport" ? <SeedTransportReport /> : null}
          {page.kind === "contractControl" ? <ContractControl /> : null}
          {page.kind === "safras" ? <Safras /> : null}
        </ScreenError>
        </EditAccessProvider>
      </main>
    </div>
  );
}
