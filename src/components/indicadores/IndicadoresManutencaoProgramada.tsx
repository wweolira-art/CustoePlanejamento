import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type ManutencaoComponenteItem,
  type ManutencaoEquipamentoItem,
  type ManutencaoPlanoPrevencaoItem,
  type ManutencaoProgramadaComponentesData,
  type ManutencaoProgramadaQuadroData,
  type ManutencaoStatus,
} from "../../api";
import { canAccess, PERMISSION_ADMIN } from "../../lib/permissions";
import { useApp } from "../../store";
import { ExternalSiteFrame } from "../ExternalSiteFrame";
import { ReportExpand } from "./ReportExpand";

type ViewMode = "sistema" | "quadro" | "componentes";
const MP_IGNORED_COMPONENTS_KEY = "manutencaoProgramada.componentesIgnorados.v1";
const MP_CATEGORY_TRACKING_KEY = "manutencaoProgramada.categoryTracking.v1";
const MP_CATEGORY_PLAN_IDS_KEY = "manutencaoProgramada.categoryPlanIds.v1";
const MP_CATEGORY_PLAN_DEPS_KEY = "manutencaoProgramada.categoryPlanDependencias.v1";
type CategoryTrackingMode = "padrao" | "dias" | "componentes" | "plano_horas";
const ALERTA_PCT = 0.9;

type ManutencaoUiConfig = {
  ignoredComponents: string[];
  categoryTracking: Record<string, CategoryTrackingMode>;
  categoryPlanIds: Record<string, number>;
  categoryPlanDependencias: Record<string, number[]>;
};

function emptyManutencaoUiConfig(): ManutencaoUiConfig {
  return {
    ignoredComponents: [],
    categoryTracking: {},
    categoryPlanIds: {},
    categoryPlanDependencias: {},
  };
}

function fmtNum(n: number | null | undefined, digits = 0) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString("pt-BR");
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return iso;
}

function statusLabel(status: ManutencaoStatus) {
  switch (status) {
    case "em_dia":
      return "Em dia";
    case "a_vencer":
      return "A vencer";
    case "vencido":
      return "Vencido";
    case "em_execucao":
      return "Em execução";
    default:
      return "Sem histórico";
  }
}

function StatusChip({ status }: { status: ManutencaoStatus }) {
  return <span className={`mp-status-chip mp-status-${status}`}>{statusLabel(status)}</span>;
}

function planoLabel(cod: number | null | undefined, descricao: string | null | undefined) {
  if (cod == null && !descricao) return "—";
  if (cod != null && descricao) return `${cod} — ${descricao}`;
  if (cod != null) return String(cod);
  return descricao || "—";
}

function limiteComponente(row: Pick<ManutencaoComponenteItem, "limiteKmRodado" | "limiteHsTrabalhada">) {
  if (row.limiteKmRodado != null && row.limiteKmRodado > 0) {
    return { valor: row.limiteKmRodado, tipo: "KM" };
  }
  if (row.limiteHsTrabalhada != null && row.limiteHsTrabalhada > 0) {
    return { valor: row.limiteHsTrabalhada, tipo: "HS" };
  }
  return { valor: null, tipo: "—" };
}

function componenteKey(row: Pick<ManutencaoComponenteItem, "codSistema" | "codComponente">) {
  return `${row.codSistema}:${row.codComponente}`;
}

function priorityStatus(statuses: ManutencaoStatus[], fallback: ManutencaoStatus): ManutencaoStatus {
  if (statuses.includes("vencido")) return "vencido";
  if (statuses.includes("a_vencer")) return "a_vencer";
  if (statuses.includes("em_execucao")) return "em_execucao";
  if (statuses.includes("em_dia")) return "em_dia";
  if (statuses.includes("sem_plano")) return "sem_plano";
  return fallback;
}

function countStatus(items: ManutencaoEquipamentoItem[]) {
  return {
    emDia: items.filter((item) => item.status === "em_dia").length,
    aVencer: items.filter((item) => item.status === "a_vencer").length,
    vencido: items.filter((item) => item.status === "vencido").length,
    emExecucao: items.filter((item) => item.status === "em_execucao").length,
    semPlano: items.filter((item) => item.status === "sem_plano").length,
  };
}

function statusPorDias(item: ManutencaoEquipamentoItem): ManutencaoStatus {
  if (item.osAberta) return "em_execucao";
  if (!item.dataUltimaPrev || item.periodoPlano == null || !(item.periodoPlano > 0)) return "sem_plano";
  const last = new Date(`${item.dataUltimaPrev}T12:00:00`);
  if (!Number.isFinite(last.getTime())) return "sem_plano";
  const elapsed = Math.max(0, Math.floor((Date.now() - last.getTime()) / 86_400_000));
  if (elapsed >= item.periodoPlano) return "vencido";
  if (elapsed >= item.periodoPlano * ALERTA_PCT) return "a_vencer";
  return "em_dia";
}

/** Cor pelo plano do equipamento: acumulado vs limite. Com vários planos, o servidor já filtrou pelo plano da categoria. */
function statusPorPlanoHoras(
  item: ManutencaoEquipamentoItem,
  planoCategoria: number | undefined,
): ManutencaoStatus {
  if (item.osAberta) return "em_execucao";
  if ((item.qtdePlanos ?? 0) > 1 && planoCategoria == null) return "sem_plano";
  const limite = item.kmLimite;
  if (limite == null || !(limite > 0) || item.kmRodado == null) return "sem_plano";
  if (item.kmRodado >= limite) return "vencido";
  if (item.kmRodado >= limite * ALERTA_PCT) return "a_vencer";
  return "em_dia";
}

function limiteDoPlano(plano: Pick<ManutencaoPlanoPrevencaoItem, "kmLimite" | "periodo"> | null | undefined) {
  if (!plano) return null;
  if (plano.kmLimite != null && plano.kmLimite > 0) return plano.kmLimite;
  if (plano.periodo != null && plano.periodo > 0) return plano.periodo;
  return null;
}

function quadroComComponentesIgnorados(
  quadro: ManutencaoProgramadaQuadroData | null,
  componentes: ManutencaoComponenteItem[],
  ignoredKeys: Set<string>,
  categoryTracking: Record<string, CategoryTrackingMode>,
  categoryPlanIds: Record<string, number>,
) {
  const hasTracking = Object.values(categoryTracking).some((mode) => mode && mode !== "padrao");
  if (!quadro || (!ignoredKeys.size && !hasTracking)) return quadro;
  const byEquip = new Map<number, ManutencaoComponenteItem[]>();
  for (const row of componentes) {
    byEquip.set(row.codEquipamento, [...(byEquip.get(row.codEquipamento) ?? []), row]);
  }
  const equipamentos = quadro.equipamentos.map((item) => {
    const mode = categoryTracking[item.categoria] ?? "padrao";
    if (mode === "dias") {
      const status = statusPorDias(item);
      return status === item.status ? item : { ...item, status };
    }
    if (mode === "plano_horas") {
      const status = statusPorPlanoHoras(item, categoryPlanIds[item.categoria]);
      return status === item.status ? item : { ...item, status };
    }
    const considered = (byEquip.get(item.codEquipamento) ?? []).filter((row) => !ignoredKeys.has(componenteKey(row)));
    if (!considered.length) return mode === "componentes" ? { ...item, status: item.osAberta ? "em_execucao" : "sem_plano" } : item;
    const status = item.osAberta
      ? "em_execucao"
      : priorityStatus(considered.map((row) => row.status), mode === "componentes" ? "sem_plano" : item.status);
    return status === item.status ? item : { ...item, status };
  });
  const statusByEquip = new Map(equipamentos.map((item) => [item.codEquipamento, item.status]));
  const categorias = quadro.categorias.map((cat) => {
    const catEquipamentos = cat.equipamentos.map((item) => ({
      ...item,
      status: statusByEquip.get(item.codEquipamento) ?? item.status,
    }));
    const counts = countStatus(catEquipamentos);
    return {
      ...cat,
      equipamentos: catEquipamentos,
      emDia: counts.emDia,
      aVencer: counts.aVencer,
      vencido: counts.vencido,
      emExecucao: counts.emExecucao,
      semPlano: counts.semPlano,
    };
  });
  const counts = countStatus(equipamentos);
  return {
    ...quadro,
    equipamentos,
    categorias,
    totais: {
      ...quadro.totais,
      emDia: counts.emDia,
      aVencer: counts.aVencer,
      vencido: counts.vencido,
      emExecucao: counts.emExecucao,
      semPlano: counts.semPlano,
      total: equipamentos.length,
    },
  };
}

function EquipTile({
  item,
  selected,
  onSelect,
  componentes,
}: {
  item: ManutencaoEquipamentoItem;
  selected: boolean;
  onSelect: (item: ManutencaoEquipamentoItem) => void;
  componentes: ManutencaoComponenteItem[];
}) {
  const [hovered, setHovered] = useState(false);
  const rows = useMemo(
    () => componentes.filter((row) => row.codEquipamento === item.codEquipamento),
    [componentes, item.codEquipamento],
  );
  const ultimaOs =
    item.anoUltimaOs != null && item.numeroUltimaOs != null
      ? `${item.anoUltimaOs}/${item.numeroUltimaOs}`
      : item.numeroUltimaOs != null
        ? String(item.numeroUltimaOs)
        : null;
  const equipamentoAssociado =
    item.codEquipamentoAssociado != null
      ? `${item.codEquipamentoAssociado}${item.equipamentoAssociadoDescricao ? ` - ${item.equipamentoAssociadoDescricao}` : ""}`
      : null;
  return (
    <div className="mp-tile-wrap" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        type="button"
        className={`mp-tile mp-status-${item.status}${selected ? " is-selected" : ""}`}
        onClick={() => onSelect(item)}
      >
        {item.codEquipamento}
      </button>
      {hovered ? (
        <div className="mp-hover-card" role="tooltip">
          <div className="mp-hover-meta">
            <strong>Km/ Hr atual: {fmtNum(item.kmAtual)}</strong>
            {equipamentoAssociado ? <strong>Atrelado ao equipamento: {equipamentoAssociado}</strong> : null}
            <strong>
              Último plano realizado:{" "}
              {planoLabel(
                item.codPlanoUltimaRenovacao ?? item.codPlanoPrevencao,
                item.planoUltimaRenovacaoDescricao ?? item.planoDescricao,
              )}
              {" · "}Horímetro/km na OS: {fmtNum(item.kmUltimaPrev)}
            </strong>
            <strong>
              Plano limite: {planoLabel(item.codPlanoPrevencao, item.planoDescricao)}
              {" · "}Limite: {fmtNum(item.kmLimite)}
            </strong>
            <strong>
              Acumulado: {fmtNum(item.kmRodado)}
              {item.kmLimite != null ? ` / ${fmtNum(item.kmLimite)}` : ""}
              {item.kmRestante != null ? ` · Restante: ${fmtNum(item.kmRestante)}` : ""}
            </strong>
            <strong>O.S.: {ultimaOs ?? "—"} · Data: {fmtDate(item.dataUltimaPrev)}</strong>
          </div>
          {!rows.length ? <span>Sem componentes no quadro</span> : (
            <table>
              <thead><tr><th>Descrição</th><th>Km/hr<br />Limite</th><th>Acumulado</th><th>Últm<br />km/hr</th><th>Últm data<br />troca</th><th>Prox troca</th><th>Situação</th></tr></thead>
              <tbody>{rows.map((row) => {
                const limite = limiteComponente(row);
                return (
                  <tr key={`${row.codSistema}-${row.codComponente}`} className={`mp-hover-${row.status}`}>
                    <td>{row.componenteDescricao || `Componente ${row.codComponente}`}</td>
                    <td>{limite.valor != null ? `${fmtNum(limite.valor)} ${limite.tipo}` : "—"}</td>
                    <td>{fmtNum(row.kmRodado, 2)}</td>
                    <td>{fmtNum(row.kmNaUltimaTroca, 2)}</td>
                    <td>{fmtDate(row.dtUltimaTroca || row.dataAbertura)}</td>
                    <td>{row.kmNaUltimaTroca != null && limite.valor != null ? fmtNum(row.kmNaUltimaTroca + limite.valor) : "—"}</td>
                    <td>{statusLabel(row.status)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ComponentesTable({
  rows,
  loading,
}: {
  rows: ManutencaoComponenteItem[];
  loading: boolean;
}) {
  if (loading) return <p className="lead">Carregando componentes…</p>;
  if (!rows.length) return <p className="lead">Nenhum componente encontrado para o filtro.</p>;

  return (
    <div className="mp-table-wrap">
      <table className="data mp-comp-table">
        <thead>
          <tr>
            <th>Sistema</th>
            <th>Componente</th>
            <th>Status</th>
            <th>KM atual</th>
            <th>KM última troca</th>
            <th>KM rodado</th>
            <th>Limite</th>
            <th>Tipo limite</th>
            <th>Última troca</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const limite = limiteComponente(row);
            return (
              <tr key={`${row.codEquipamento}-${row.codSistema}-${row.codComponente}`} className={`mp-row-${row.status}`}>
                <td>
                  <div className="mp-cell-stack">
                    <strong>{row.codSistema}</strong>
                    <span>{row.sistemaDescricao || "—"}</span>
                  </div>
                </td>
                <td>
                  <div className="mp-cell-stack">
                    <strong>{row.codComponente}</strong>
                    <span>{row.componenteDescricao || "—"}</span>
                  </div>
                </td>
                <td>
                  <StatusChip status={row.status} />
                </td>
                <td>{fmtNum(row.kmAtualEquipamento)}</td>
                <td>{fmtNum(row.kmNaUltimaTroca)}</td>
                <td>{fmtNum(row.kmRodado)}</td>
                <td>{fmtNum(limite.valor)}</td>
                <td>{limite.tipo}</td>
                <td>{fmtDate(row.dtUltimaTroca || row.dataAbertura)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function QuadroNativo({
  quadro,
  loading,
  selectedCod,
  onSelect,
  componentes,
}: {
  quadro: ManutencaoProgramadaQuadroData | null;
  loading: boolean;
  selectedCod: number | null;
  onSelect: (item: ManutencaoEquipamentoItem) => void;
  componentes: ManutencaoComponenteItem[];
}) {
  if (loading && !quadro) return <p className="lead">Carregando quadro integrado…</p>;
  if (!quadro?.categorias.length) return <p className="lead">Nenhum equipamento encontrado no quadro.</p>;

  return (
    <div className="mp-board">
      <div className="mp-grid">
        {quadro.categorias.map((cat) => (
          <div key={`row-${cat.codTipoEquipamento}-${cat.categoria}`} className="mp-row">
            <div className="mp-row-label">
              <strong>{cat.categoria}</strong>
              <div className="mp-side-counts">
                <span className="mp-mini mp-status-em_dia">{cat.emDia} Em dia</span>
                <span className="mp-mini mp-status-a_vencer">{cat.aVencer} A vencer</span>
                <span className="mp-mini mp-status-vencido">{cat.vencido} Vencido</span>
              </div>
            </div>
            <div className="mp-tiles">
              {cat.equipamentos.map((eq) => (
                <EquipTile
                  key={eq.codEquipamento}
                  item={eq}
                  selected={selectedCod === eq.codEquipamento}
                  onSelect={onSelect}
                  componentes={componentes}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <footer className="mp-footer">
        <div className="mp-total mp-status-em_dia">{quadro.totais.emDia} Em dia</div>
        <div className="mp-total mp-status-a_vencer">{quadro.totais.aVencer} A vencer</div>
        <div className="mp-total mp-status-vencido">{quadro.totais.vencido} Vencido</div>
        <div className="mp-total mp-status-em_execucao">{quadro.totais.emExecucao} Em execução</div>
      </footer>
    </div>
  );
}

export function IndicadoresManutencaoProgramada({
  externalQuadroUrl,
}: {
  /** URL do quadro já existente (Sites incorporados). */
  externalQuadroUrl?: string | null;
}) {
  const { authUser } = useApp();
  const canEditMpConfig = canAccess(authUser?.permissions, PERMISSION_ADMIN);
  const hasSistema = Boolean(externalQuadroUrl?.trim());
  const [view, setView] = useState<ViewMode>(() => (hasSistema ? "sistema" : "quadro"));
  const [quadro, setQuadro] = useState<ManutencaoProgramadaQuadroData | null>(null);
  const [componentes, setComponentes] = useState<ManutencaoProgramadaComponentesData | null>(null);
  const [componentesQuadro, setComponentesQuadro] = useState<ManutencaoComponenteItem[]>([]);
  const [selected, setSelected] = useState<ManutencaoEquipamentoItem | null>(null);
  const [equipFilter, setEquipFilter] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [ignoredComponents, setIgnoredComponents] = useState<Set<string>>(new Set());
  const [categoryTracking, setCategoryTracking] = useState<Record<string, CategoryTrackingMode>>({});
  const [categoryPlanIds, setCategoryPlanIds] = useState<Record<string, number>>({});
  const [categoryPlanDependencias, setCategoryPlanDependencias] = useState<Record<string, number[]>>({});
  const [planos, setPlanos] = useState<ManutencaoPlanoPrevencaoItem[]>([]);
  const [loadingQuadro, setLoadingQuadro] = useState(false);
  const [loadingComp, setLoadingComp] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const configRef = useRef<ManutencaoUiConfig>(emptyManutencaoUiConfig());
  const persistChainRef = useRef(Promise.resolve());
  const loadQuadroRef = useRef<() => Promise<void>>(async () => undefined);

  const applyConfigToState = useCallback((config: ManutencaoUiConfig) => {
    configRef.current = {
      ignoredComponents: [...config.ignoredComponents].sort(),
      categoryTracking: { ...config.categoryTracking },
      categoryPlanIds: { ...config.categoryPlanIds },
      categoryPlanDependencias: Object.fromEntries(
        Object.entries(config.categoryPlanDependencias).map(([k, v]) => [k, [...v]]),
      ),
    };
    setIgnoredComponents(new Set(configRef.current.ignoredComponents));
    setCategoryTracking(configRef.current.categoryTracking);
    setCategoryPlanIds(configRef.current.categoryPlanIds);
    setCategoryPlanDependencias(configRef.current.categoryPlanDependencias);
    localStorage.setItem(MP_IGNORED_COMPONENTS_KEY, JSON.stringify(configRef.current.ignoredComponents));
    localStorage.setItem(MP_CATEGORY_TRACKING_KEY, JSON.stringify(configRef.current.categoryTracking));
    localStorage.setItem(MP_CATEGORY_PLAN_IDS_KEY, JSON.stringify(configRef.current.categoryPlanIds));
    localStorage.setItem(MP_CATEGORY_PLAN_DEPS_KEY, JSON.stringify(configRef.current.categoryPlanDependencias));
  }, []);

  const persistConfigMutation = useCallback(
    (
      mutate: (current: ManutencaoUiConfig) => ManutencaoUiConfig,
      options?: { reloadQuadro?: boolean },
    ) => {
      if (!canEditMpConfig) {
        setErr("Apenas administrador pode alterar essas configurações.");
        return Promise.resolve();
      }
      persistChainRef.current = persistChainRef.current
        .catch(() => undefined)
        .then(async () => {
          const next = mutate({
            ignoredComponents: [...configRef.current.ignoredComponents],
            categoryTracking: { ...configRef.current.categoryTracking },
            categoryPlanIds: { ...configRef.current.categoryPlanIds },
            categoryPlanDependencias: Object.fromEntries(
              Object.entries(configRef.current.categoryPlanDependencias).map(([k, v]) => [k, [...v]]),
            ),
          });
          applyConfigToState(next);
          const saved = await api.salvarIndicadoresManutencaoConfig({
            ignoredComponents: next.ignoredComponents,
            categoryTracking: next.categoryTracking,
            categoryPlanIds: next.categoryPlanIds,
            categoryPlanDependencias: next.categoryPlanDependencias,
          });
          applyConfigToState({
            ignoredComponents: saved.ignoredComponents ?? next.ignoredComponents,
            categoryTracking: (saved.categoryTracking ?? next.categoryTracking) as Record<string, CategoryTrackingMode>,
            categoryPlanIds: saved.categoryPlanIds ?? next.categoryPlanIds,
            categoryPlanDependencias: saved.categoryPlanDependencias ?? next.categoryPlanDependencias,
          });
          if (options?.reloadQuadro) await loadQuadroRef.current();
        })
        .catch((e) => {
          setErr(e instanceof Error ? e.message : "Não foi possível salvar a configuração.");
        });
      return persistChainRef.current;
    },
    [applyConfigToState, canEditMpConfig],
  );

  const loadQuadro = useCallback(async () => {
    setLoadingQuadro(true);
    setErr(null);
    try {
      const [quadroResult, componentesResult] = await Promise.all([
        api.indicadoresManutencaoProgramada(),
        api.indicadoresManutencaoComponentes({}),
      ]);
      setQuadro(quadroResult);
      setComponentesQuadro(componentesResult.componentes);
    } catch (e) {
      setQuadro(null);
      setComponentesQuadro([]);
      setErr(e instanceof Error ? e.message : "Não foi possível carregar o quadro integrado.");
    } finally {
      setLoadingQuadro(false);
    }
  }, []);
  loadQuadroRef.current = loadQuadro;

  const resolvedEquipCod = useMemo(() => {
    if (selected?.codEquipamento != null) return selected.codEquipamento;
    const raw = equipFilter.trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }, [selected, equipFilter]);

  const loadComponentes = useCallback(async (codEquipamento?: number | null) => {
    setLoadingComp(true);
    setErr(null);
    try {
      setComponentes(await api.indicadoresManutencaoComponentes({ codEquipamento }));
    } catch (e) {
      setComponentes(null);
      setErr(e instanceof Error ? e.message : "Não foi possível carregar os componentes.");
    } finally {
      setLoadingComp(false);
    }
  }, []);

  useEffect(() => {
    if (view === "quadro") void loadQuadro();
  }, [view, loadQuadro]);

  useEffect(() => {
    let cancelled = false;
    void api
      .indicadoresManutencaoConfig()
      .then((config) => {
        if (cancelled) return;
        applyConfigToState({
          ignoredComponents: config.ignoredComponents ?? [],
          categoryTracking: (config.categoryTracking ?? {}) as Record<string, CategoryTrackingMode>,
          categoryPlanIds: config.categoryPlanIds ?? {},
          categoryPlanDependencias: config.categoryPlanDependencias ?? {},
        });
      })
      .catch(() => {
        if (cancelled) return;
        const fallback = emptyManutencaoUiConfig();
        try {
          fallback.ignoredComponents = JSON.parse(localStorage.getItem(MP_IGNORED_COMPONENTS_KEY) || "[]") as string[];
        } catch {
          /* keep empty */
        }
        try {
          fallback.categoryTracking = JSON.parse(localStorage.getItem(MP_CATEGORY_TRACKING_KEY) || "{}") as Record<
            string,
            CategoryTrackingMode
          >;
        } catch {
          /* keep empty */
        }
        try {
          fallback.categoryPlanIds = JSON.parse(localStorage.getItem(MP_CATEGORY_PLAN_IDS_KEY) || "{}") as Record<
            string,
            number
          >;
        } catch {
          /* keep empty */
        }
        try {
          fallback.categoryPlanDependencias = JSON.parse(localStorage.getItem(MP_CATEGORY_PLAN_DEPS_KEY) || "{}") as Record<
            string,
            number[]
          >;
        } catch {
          /* keep empty */
        }
        applyConfigToState(fallback);
      });
    void api
      .indicadoresManutencaoPlanos()
      .then((result) => {
        if (!cancelled) setPlanos(result.planos);
      })
      .catch(() => {
        if (!cancelled) setPlanos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [applyConfigToState]);

  useEffect(() => {
    if (view === "componentes") void loadComponentes(resolvedEquipCod);
  }, [view, resolvedEquipCod, loadComponentes]);

  const selectedLabel = useMemo(() => {
    if (selected) {
      return `${selected.codEquipamento}${selected.descricao ? ` — ${selected.descricao}` : ""}`;
    }
    if (resolvedEquipCod != null) return String(resolvedEquipCod);
    return "Todos os equipamentos";
  }, [selected, resolvedEquipCod]);

  const planosById = useMemo(
    () => new Map(planos.map((plano) => [plano.codPlanoPrevencao, plano])),
    [planos],
  );

  const quadroAjustado = useMemo(
    () =>
      quadroComComponentesIgnorados(
        quadro,
        componentesQuadro,
        ignoredComponents,
        categoryTracking,
        categoryPlanIds,
      ),
    [quadro, componentesQuadro, ignoredComponents, categoryTracking, categoryPlanIds],
  );

  const categoryOptions = useMemo(
    () => (quadro?.categorias ?? []).map((cat) => cat.categoria).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [quadro?.categorias],
  );

  const componentOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string; sistema: string }>();
    for (const row of componentesQuadro.length ? componentesQuadro : componentes?.componentes ?? []) {
      const key = componenteKey(row);
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: row.componenteDescricao || `Componente ${row.codComponente}`,
          sistema: row.sistemaDescricao || `Sistema ${row.codSistema}`,
        });
      }
    }
    return [...map.values()].sort(
      (a, b) => a.sistema.localeCompare(b.sistema, "pt-BR") || a.label.localeCompare(b.label, "pt-BR"),
    );
  }, [componentes?.componentes, componentesQuadro]);

  const toggleIgnoredComponent = (key: string) => {
    void persistConfigMutation((current) => {
      const ignored = new Set(current.ignoredComponents);
      if (ignored.has(key)) ignored.delete(key);
      else ignored.add(key);
      return { ...current, ignoredComponents: [...ignored].sort() };
    });
  };

  const setCategoryTrackingMode = (categoria: string, mode: CategoryTrackingMode) => {
    void persistConfigMutation((current) => {
      const categoryTracking = { ...current.categoryTracking };
      const categoryPlanIds = { ...current.categoryPlanIds };
      const categoryPlanDependencias = { ...current.categoryPlanDependencias };
      if (mode === "padrao") delete categoryTracking[categoria];
      else categoryTracking[categoria] = mode;
      if (mode !== "plano_horas") {
        delete categoryPlanIds[categoria];
        delete categoryPlanDependencias[categoria];
      }
      return { ...current, categoryTracking, categoryPlanIds, categoryPlanDependencias };
    }, { reloadQuadro: true });
  };

  const setCategoryPlanId = (categoria: string, codPlano: number | null) => {
    void persistConfigMutation((current) => {
      const categoryPlanIds = { ...current.categoryPlanIds };
      const categoryPlanDependencias = { ...current.categoryPlanDependencias };
      if (codPlano == null || !(codPlano > 0)) {
        delete categoryPlanIds[categoria];
        delete categoryPlanDependencias[categoria];
      } else {
        categoryPlanIds[categoria] = codPlano;
        const deps = new Set(categoryPlanDependencias[categoria] ?? []);
        deps.add(codPlano);
        categoryPlanDependencias[categoria] = [...deps].sort((a, b) => a - b);
      }
      return { ...current, categoryPlanIds, categoryPlanDependencias };
    }, { reloadQuadro: true });
  };

  const toggleCategoryPlanDependencia = (categoria: string, codPlano: number, checked: boolean) => {
    const planoPrincipal = configRef.current.categoryPlanIds[categoria];
    if (planoPrincipal != null && codPlano === planoPrincipal && !checked) return;
    void persistConfigMutation((current) => {
      const categoryPlanDependencias = { ...current.categoryPlanDependencias };
      const set = new Set(categoryPlanDependencias[categoria] ?? []);
      const principal = current.categoryPlanIds[categoria];
      if (principal != null) set.add(principal);
      if (checked) set.add(codPlano);
      else set.delete(codPlano);
      if (!set.size) delete categoryPlanDependencias[categoria];
      else categoryPlanDependencias[categoria] = [...set].sort((a, b) => a - b);
      return { ...current, categoryPlanDependencias };
    }, { reloadQuadro: true });
  };

  const onSelectEquip = (item: ManutencaoEquipamentoItem) => {
    setSelected(item);
    setEquipFilter(String(item.codEquipamento));
    setView("componentes");
  };

  return (
    <ReportExpand title="Manutenção programada" onRefresh={() => {
      if (view === "quadro" && !loadingQuadro) return loadQuadro();
      if (view === "componentes" && !loadingComp) return loadComponentes(resolvedEquipCod);
    }}>
      <div className="mp-page">
        <header className="mp-header">
          <div className="mp-header-meta">
            {view === "sistema"
              ? "Quadro existente (incorporado)"
              : `Atualizado em: ${fmtDateTime(quadro?.atualizadoEm || componentes?.atualizadoEm)}`}
          </div>
          <h2 className="mp-title">Manutenção Programada</h2>
          <div className="mp-header-actions">
            <div className="kind-toggle mp-view-toggle">
              {hasSistema ? (
                <button
                  type="button"
                  className={view === "sistema" ? "active" : ""}
                  onClick={() => setView("sistema")}
                >
                  Quadro existente
                </button>
              ) : null}
              <button
                type="button"
                className={view === "quadro" ? "active" : ""}
                onClick={() => setView("quadro")}
              >
                Quadro integrado
              </button>
              <button
                type="button"
                className={view === "componentes" ? "active" : ""}
                onClick={() => setView("componentes")}
              >
                Componentes
              </button>
            </div>
            {view !== "sistema" ? (
              <button
                type="button"
                className="btn"
                disabled={loadingQuadro || loadingComp}
                onClick={() => {
                  if (view === "quadro") void loadQuadro();
                  if (view === "componentes") void loadComponentes(resolvedEquipCod);
                }}
              >
                Atualizar
              </button>
            ) : null}
          </div>
        </header>

        {err ? <p className="error">{err}</p> : null}

        {view !== "sistema" ? (
          <div className="mp-legend no-print">
            <span className="mp-mini mp-status-em_dia">Em dia</span>
            <span className="mp-mini mp-status-a_vencer">A vencer</span>
            <span className="mp-mini mp-status-vencido">Vencido</span>
            <span className="mp-mini mp-status-em_execucao">Em execução</span>
            <span className="mp-mini mp-status-sem_plano">Sem histórico</span>
            {canEditMpConfig ? (
              <button
                type="button"
                className={`btn mp-config-icon-btn${showConfig ? " active" : ""}`}
                onClick={() => setShowConfig((open) => !open)}
                aria-label="Configurar acompanhamento do quadro"
                title="Configurar acompanhamento do quadro"
              >
                ⚙
              </button>
            ) : null}
          </div>
        ) : null}

        {showConfig && canEditMpConfig && view !== "sistema" ? (
          <section className="panel mp-config-panel no-print">
            <div className="mp-config-head">
              <div>
                <h3>Componentes desconsiderados na cor do quadro</h3>
                <p className="lead">
                  Componentes marcados continuam aparecendo nos detalhes, mas não deixam o equipamento vermelho ou amarelo.
                </p>
              </div>
              {ignoredComponents.size ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void persistConfigMutation((current) => ({
                      ...current,
                      ignoredComponents: [],
                    }));
                  }}
                >
                  Limpar seleção
                </button>
              ) : null}
            </div>
            {categoryOptions.length ? (
              <div className="mp-config-section">
                <h4>Categorias acompanhadas por dias, componentes ou plano</h4>
                <p className="lead">
                  Em “Por hora/km do plano”: o <strong>plano</strong> define o limite; os <strong>planos de renovação</strong>{" "}
                  zeram o acumulado (ex.: plano 36 renova se a última OS for 33, 34 ou 36).
                </p>
                <div className="mp-table-wrap mp-config-table-wrap">
                  <table className="data mp-config-table">
                    <thead>
                      <tr>
                        <th>Categoria</th>
                        <th>Acompanhamento</th>
                        <th>Plano (limite) e renovação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryOptions.map((categoria) => {
                        const mode = categoryTracking[categoria] ?? "padrao";
                        const planoId = categoryPlanIds[categoria];
                        const plano = planoId != null ? planosById.get(planoId) : undefined;
                        const limite = limiteDoPlano(plano);
                        const deps = new Set(categoryPlanDependencias[categoria] ?? []);
                        if (planoId != null) deps.add(planoId);
                        return (
                          <tr key={categoria}>
                            <td>{categoria}</td>
                            <td>
                              <select
                                value={mode}
                                onChange={(e) =>
                                  setCategoryTrackingMode(categoria, e.target.value as CategoryTrackingMode)
                                }
                              >
                                <option value="padrao">Padrão</option>
                                <option value="dias">Por dias</option>
                                <option value="componentes">Por componentes</option>
                                <option value="plano_horas">Por hora/km do plano</option>
                              </select>
                            </td>
                            <td>
                              {mode === "plano_horas" ? (
                                <div className="mp-config-plan-cell">
                                  <select
                                    value={planoId != null ? String(planoId) : ""}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      setCategoryPlanId(categoria, raw ? Number(raw) : null);
                                    }}
                                  >
                                    <option value="">Selecione o plano (limite)…</option>
                                    {planoId != null && !planos.some((p) => p.codPlanoPrevencao === planoId) ? (
                                      <option value={planoId}>{planoId} (salvo)</option>
                                    ) : null}
                                    {planos.map((p) => {
                                      const lim = limiteDoPlano(p);
                                      return (
                                        <option key={p.codPlanoPrevencao} value={p.codPlanoPrevencao}>
                                          {p.codPlanoPrevencao}
                                          {p.descricao ? ` — ${p.descricao}` : ""}
                                          {lim != null ? ` (limite ${fmtNum(lim)})` : ""}
                                        </option>
                                      );
                                    })}
                                  </select>
                                  {limite != null ? (
                                    <span className="mp-config-plan-hint">Limite do plano: {fmtNum(limite)} km/h</span>
                                  ) : null}
                                  {planoId != null ? (
                                    <div className="mp-config-deps">
                                      <span className="mp-config-plan-hint">Renova o acumulado com OS destes planos:</span>
                                      <div className="mp-config-deps-list">
                                        {[
                                          ...planos,
                                          ...[...deps]
                                            .filter((id) => !planos.some((p) => p.codPlanoPrevencao === id))
                                            .map((id) => ({
                                              codPlanoPrevencao: id,
                                              descricao: "salvo",
                                              kmLimite: null as number | null,
                                              periodo: null as number | null,
                                            })),
                                        ].map((p) => {
                                          const checked = deps.has(p.codPlanoPrevencao);
                                          const isPrincipal = p.codPlanoPrevencao === planoId;
                                          return (
                                            <label key={p.codPlanoPrevencao} className="mp-config-deps-item">
                                              <input
                                                type="checkbox"
                                                checked={checked}
                                                disabled={isPrincipal}
                                                onChange={(e) =>
                                                  toggleCategoryPlanDependencia(
                                                    categoria,
                                                    p.codPlanoPrevencao,
                                                    e.target.checked,
                                                  )
                                                }
                                              />
                                              <span>
                                                {p.codPlanoPrevencao}
                                                {p.descricao ? ` — ${p.descricao}` : ""}
                                                {isPrincipal ? " (limite)" : ""}
                                              </span>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="mp-config-plan-hint">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            <div className="mp-config-section">
              <h4>Componentes desconsiderados</h4>
              {componentOptions.length ? (
                <div className="mp-table-wrap mp-config-table-wrap">
                  <table className="data mp-config-table">
                    <thead>
                      <tr>
                        <th>Desconsiderar</th>
                        <th>Componente</th>
                        <th>Sistema</th>
                      </tr>
                    </thead>
                    <tbody>
                      {componentOptions.map((item) => (
                        <tr key={item.key}>
                          <td className="mp-config-check">
                            <input
                              type="checkbox"
                              aria-label={`Desconsiderar ${item.label}`}
                              checked={ignoredComponents.has(item.key)}
                              onChange={() => toggleIgnoredComponent(item.key)}
                            />
                          </td>
                          <td>{item.label}</td>
                          <td>{item.sistema}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="lead">Atualize o quadro para carregar a lista de componentes configuráveis.</p>
              )}
            </div>
          </section>
        ) : null}

        {view === "sistema" && externalQuadroUrl ? (
          <div className="mp-sistema-wrap">
            <ExternalSiteFrame url={externalQuadroUrl} title="Manutenção programada" fill />
          </div>
        ) : null}

        {view === "quadro" ? (
          <QuadroNativo
            quadro={quadroAjustado}
            loading={loadingQuadro}
            selectedCod={selected?.codEquipamento ?? null}
            onSelect={onSelectEquip}
            componentes={componentesQuadro}
          />
        ) : null}

        {view === "componentes" ? (
          <section className="panel mp-comp-panel">
            <div className="mp-comp-toolbar">
              <div>
                <h3>Componentes</h3>
                <p className="lead">
                  Equipamento: <strong>{selectedLabel}</strong>
                  {selected?.kmAtual != null ? ` · KM/h atual ${fmtNum(selected.kmAtual)}` : ""}
                </p>
              </div>
              <div className="mp-comp-actions">
                <label className="mp-equip-filter">
                  <span>Cód. equipamento</span>
                  <input
                    value={equipFilter}
                    onChange={(e) => {
                      setEquipFilter(e.target.value);
                      setSelected(null);
                    }}
                    placeholder="Todos"
                    inputMode="numeric"
                  />
                </label>
                {(selected || equipFilter.trim()) && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setSelected(null);
                      setEquipFilter("");
                    }}
                  >
                    Ver todos
                  </button>
                )}
              </div>
            </div>

            <div className="mp-comp-totais">
              <span className="mp-mini mp-status-em_dia">{componentes?.totais.emDia ?? 0} Em dia</span>
              <span className="mp-mini mp-status-a_vencer">{componentes?.totais.aVencer ?? 0} A vencer</span>
              <span className="mp-mini mp-status-vencido">{componentes?.totais.vencido ?? 0} Vencido</span>
              <span className="mp-mini mp-status-sem_plano">{componentes?.totais.semPlano ?? 0} Sem histórico</span>
            </div>

            <ComponentesTable rows={componentes?.componentes ?? []} loading={loadingComp} />
          </section>
        ) : null}
      </div>
    </ReportExpand>
  );
}
