import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type CustoDashboardData, type CustoDimensoesData } from "../../api";
import {
  colunasAbastecimentos,
  colunasAbastecimentosPorModelo,
  colunasFuncionarios,
  colunasInsumos,
  colunasServicosTerceiro,
  formatConsultaValue,
} from "../../lib/consultaRateioColumns";
import { formatBRL } from "../../lib/format";
import { DataTable } from "./DataTable";
import {
  DiagnosticoPanel,
  MaterialFluxoPanel,
  ReconciliacaoPanel,
} from "./ConsultaRateioPanels";
import { ConsultaProgressBar } from "../ConsultaProgressBar";
import { PrintButton } from "../PrintButton";

type Props = {
  anomesFrom: number;
  anomesTo: number;
  safraLabel: string;
};

type AbastecimentoResumo = {
  totalLinhas?: number;
  totalLitros?: number;
  totalValor?: number;
  totalHoras?: number;
  totalAreaHa?: number;
  mediaLitrosPorHora?: number | null;
  mediaLitrosPorHa?: number | null;
  qtdModelos?: number;
};

type SubTab =
  | "consolidado"
  | "diagnostico"
  | "oficina"
  | "transporte"
  | "mecanizacao"
  | "combustivel"
  | "material"
  | "insumo"
  | "servico-terceiro"
  | "funcionario";

const SUBTABS: { id: SubTab; label: string }[] = [
  { id: "consolidado", label: "Consolidado" },
  { id: "diagnostico", label: "Diagnóstico" },
  { id: "oficina", label: "Oficina" },
  { id: "transporte", label: "Transporte" },
  { id: "mecanizacao", label: "Mecanização" },
  { id: "combustivel", label: "Combustível" },
  { id: "material", label: "Material" },
  { id: "insumo", label: "Insumo" },
  { id: "servico-terceiro", label: "Serviços 3º" },
  { id: "funcionario", label: "Funcionário" },
];

type Filtros = {
  anomesInicio: string;
  anomesFim: string;
  equipamento: string;
  negocios: number[];
  processo: string;
  subprocesso: string;
  atividade: string;
  objetoCusto: string;
};

function anomesToInput(n: number) {
  return String(n).padStart(6, "0");
}

function buildFiltroParams(f: Filtros, extra: Record<string, string | number> = {}) {
  const params: Record<string, string | number> = {
    anomesInicio: f.anomesInicio,
    anomesFim: f.anomesFim,
    ...extra,
  };
  if (f.equipamento.trim()) params.equipamento = f.equipamento.trim();
  if (f.negocios.length) params.negocio = f.negocios.join(",");
  if (f.processo) params.processo = f.processo;
  if (f.subprocesso) {
    const [, sub] = f.subprocesso.split("|");
    if (sub) params.subprocesso = sub;
  }
  if (f.atividade) params.atividade = f.atividade;
  if (f.objetoCusto) params.objetoCusto = f.objetoCusto;
  return params;
}

function buildPeriodoOnlyParams(f: Filtros) {
  const params: Record<string, string | number> = {
    anomesInicio: f.anomesInicio,
    anomesFim: f.anomesFim,
  };
  if (f.equipamento.trim()) params.equipamento = f.equipamento.trim();
  return params;
}

export function ConsultaRateio({ anomesFrom, anomesTo, safraLabel }: Props) {
  const [subTab, setSubTab] = useState<SubTab>("consolidado");
  const [filtros, setFiltros] = useState<Filtros>(() => ({
    anomesInicio: anomesToInput(anomesFrom),
    anomesFim: anomesToInput(anomesTo),
    equipamento: "",
    negocios: [],
    processo: "",
    subprocesso: "",
    atividade: "",
    objetoCusto: "",
  }));
  const [dimensoes, setDimensoes] = useState<CustoDimensoesData | null>(null);
  const [objetos, setObjetos] = useState<{ codObjetoCusto: number; descricao: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [consolidado, setConsolidado] = useState<CustoDashboardData | null>(null);
  const [rateioResumo, setRateioResumo] = useState<CustoDashboardData["resumo"] | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [listRows, setListRows] = useState<Record<string, unknown>[]>([]);
  const [abastecimentoResumo, setAbastecimentoResumo] = useState<AbastecimentoResumo | null>(null);
  const [porModeloRows, setPorModeloRows] = useState<Record<string, unknown>[]>([]);
  const [combustivelVista, setCombustivelVista] = useState<"modelo" | "detalhe">("modelo");

  useEffect(() => {
    setFiltros((prev) => ({
      ...prev,
      anomesInicio: anomesToInput(anomesFrom),
      anomesFim: anomesToInput(anomesTo),
    }));
  }, [anomesFrom, anomesTo]);

  const dimParams = useMemo(() => buildFiltroParams(filtros), [filtros]);

  const reloadDimensoes = useCallback(async () => {
    try {
      const dims = await api.custoDimensoes(dimParams);
      setDimensoes(dims);
      const objs = await api.custoObjetosCusto(dimParams);
      setObjetos(
        (objs.dados ?? []).map((row) => ({
          codObjetoCusto: row.codObjetoCusto,
          descricao: row.descricao,
        })),
      );
    } catch {
      setDimensoes(null);
      setObjetos([]);
    }
  }, [dimParams]);

  useEffect(() => {
    void reloadDimensoes();
  }, [reloadDimensoes]);

  const consultar = async () => {
    if (!filtros.anomesInicio && !filtros.anomesFim) {
      setErr("Informe o período (ano/mês inicial e/ou final).");
      return;
    }

    setLoading(true);
    setErr(null);
    setStatusMsg(null);
    setPayload(null);
    setListRows([]);
    setPorModeloRows([]);
    setAbastecimentoResumo(null);
    setConsolidado(null);
    setRateioResumo(null);

    try {
      if (subTab === "consolidado") {
        const params = buildFiltroParams(filtros);
        const dash = await api.custoDashboard(params);
        setConsolidado(dash);
        setRateioResumo(dash.resumo ?? null);
        const qtd = dash.atividades?.length ?? 0;
        const linhas = dash.resumo?.qtdLinhas ?? 0;
        setStatusMsg(
          `${qtd} destino(s) · ${linhas} linha(s) · pool ${formatBRL(dash.resumo?.totalGeral ?? 0)}`,
        );
      } else if (subTab === "diagnostico") {
        const data = await api.custoRateioDiagnostico(buildFiltroParams(filtros));
        setPayload(data);
        setStatusMsg("Diagnóstico gerado.");
      } else if (subTab === "oficina") {
        const data = await api.custoRateioOficinaReconciliacao(buildPeriodoOnlyParams(filtros));
        setPayload(data);
        setStatusMsg("Reconciliação de oficina concluída.");
      } else if (subTab === "transporte") {
        const data = await api.custoRateioTransporteReconciliacao(buildFiltroParams(filtros));
        setPayload(data);
        setStatusMsg("Reconciliação de transporte concluída.");
      } else if (subTab === "mecanizacao") {
        const data = await api.custoRateioMecanizacaoReconciliacao(buildFiltroParams(filtros));
        setPayload(data);
        setStatusMsg("Reconciliação de mecanização concluída.");
      } else if (subTab === "material") {
        const data = await api.custoMateriaisFluxo(buildFiltroParams(filtros));
        setPayload(data);
        setStatusMsg("Distribuição de materiais carregada.");
      } else if (subTab === "combustivel") {
        const data = await api.custoAbastecimentos(buildFiltroParams(filtros));
        setListRows(data.dados ?? []);
        setPorModeloRows(data.porModelo ?? []);
        setAbastecimentoResumo(data.resumo ?? null);
        setCombustivelVista("modelo");
        setStatusMsg(
          `${data.dados?.length ?? 0} abastecimento(s) · ${data.porModelo?.length ?? 0} modelo(s).`,
        );
      } else if (subTab === "insumo") {
        const data = await api.custoInsumos(buildFiltroParams(filtros));
        setListRows(data.dados ?? []);
        setStatusMsg(`${data.dados?.length ?? 0} linha(s) de insumo.`);
      } else if (subTab === "servico-terceiro") {
        const data = await api.custoServicosTerceiro(buildFiltroParams(filtros));
        setListRows(data.dados ?? []);
        setStatusMsg(`${data.dados?.length ?? 0} serviço(s) de terceiro.`);
      } else if (subTab === "funcionario") {
        const data = await api.custoFuncionariosConsulta(buildFiltroParams(filtros));
        setListRows(data.dados ?? []);
        setStatusMsg(`${data.dados?.length ?? 0} lançamento(s) de funcionário.`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const subtitulo = useMemo(() => {
    switch (subTab) {
      case "consolidado":
        return "Rateio ERP: pool lancamento_custo distribuído para objetos Cana (negócio 1) via distribuicaogasto e utilizacao.";
      case "diagnostico":
        return "Origem → via → objeto de destino, com recorte de transporte (3/1/2) e mecanização (3/1/3).";
      case "oficina":
        return "Reconciliação da oficina (3/1/1) com lancamento_custo — origem fixa, sem recorte de objeto.";
      case "transporte":
        return "Reconciliação do transporte (3/1/2) com lancamento_custo e fluxo para clientes.";
      case "mecanizacao":
        return "Reconciliação da mecanização (3/1/3) com lancamento_custo e fluxo para clientes.";
      case "material":
        return "Distribuição dos materiais de manutenção (apontamento vs objeto requisição).";
      case "combustivel":
        return "Relatório de combustível por modelo de equipamento (L/h e L/ha) e detalhe dos abastecimentos.";
      case "insumo":
        return "Insumos agrícolas por apontamento.";
      case "servico-terceiro":
        return "Contratos variáveis e fixos de serviços de terceiros.";
      case "funcionario":
        return "Lançamentos de funcionário (grupo empenho 10) por objeto de custo.";
      default:
        return "";
    }
  }, [subTab]);

  const ocultarFiltroObjeto = subTab === "oficina";

  const subTabLabel = SUBTABS.find((tab) => tab.id === subTab)?.label ?? subTab;
  const hasPrintableResults =
    (subTab === "consolidado" && (consolidado?.atividades?.length ?? 0) > 0) ||
    (subTab !== "consolidado" &&
      subTab !== "combustivel" &&
      subTab !== "insumo" &&
      subTab !== "servico-terceiro" &&
      subTab !== "funcionario" &&
      payload != null) ||
    listRows.length > 0;

  return (
    <>
      <p className="lead">
        Consulta rateio da {safraLabel}, período {filtros.anomesInicio} a {filtros.anomesFim}.{" "}
        {subtitulo}
      </p>

      <div className="kind-toggle no-print" style={{ paddingBottom: 8, flexWrap: "wrap" }}>
        {SUBTABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`btn ${subTab === tab.id ? "primary" : ""}`}
            onClick={() => setSubTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section className="panel no-print">
        <h3>Filtros</h3>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void consultar();
          }}
        >
          <label>
            Período inicial (YYYYMM)
            <input
              value={filtros.anomesInicio}
              onChange={(e) => setFiltros((f) => ({ ...f, anomesInicio: e.target.value }))}
              pattern="\d{6}"
              required
            />
          </label>
          <label>
            Período final (YYYYMM)
            <input
              value={filtros.anomesFim}
              onChange={(e) => setFiltros((f) => ({ ...f, anomesFim: e.target.value }))}
              pattern="\d{6}"
              required
            />
          </label>
          <label>
            Equipamento
            <input
              value={filtros.equipamento}
              onChange={(e) => setFiltros((f) => ({ ...f, equipamento: e.target.value }))}
              placeholder="Código ou parte"
            />
          </label>
          {!ocultarFiltroObjeto ? (
            <>
              <label>
                Negócio
                <select
                  multiple
                  size={4}
                  value={filtros.negocios.map(String)}
                  onChange={(e) => {
                    const negocios = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
                    setFiltros((f) => ({
                      ...f,
                      negocios,
                      processo: "",
                      subprocesso: "",
                      atividade: "",
                      objetoCusto: "",
                    }));
                  }}
                >
                  {(dimensoes?.negocios ?? []).map((n) => (
                    <option key={n.codigo} value={n.codigo}>
                      {n.codigo} — {n.descricao}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Processo
                <select
                  value={filtros.processo}
                  onChange={(e) =>
                    setFiltros((f) => ({
                      ...f,
                      processo: e.target.value,
                      subprocesso: "",
                      atividade: "",
                      objetoCusto: "",
                    }))
                  }
                >
                  <option value="">Todos</option>
                  {(dimensoes?.processos ?? []).map((p) => (
                    <option key={p.codigo} value={p.codigo}>
                      {p.codigo} — {p.descricao}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Subprocesso
                <select
                  value={filtros.subprocesso}
                  onChange={(e) =>
                    setFiltros((f) => ({ ...f, subprocesso: e.target.value, atividade: "", objetoCusto: "" }))
                  }
                >
                  <option value="">Todos</option>
                  {(dimensoes?.subprocessos ?? []).map((s) => (
                    <option key={s.valor ?? s.codigo} value={s.valor ?? String(s.codigo)}>
                      {s.rotulo ?? `${s.codigo} — ${s.descricao}`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Atividade
                <select
                  value={filtros.atividade}
                  onChange={(e) => setFiltros((f) => ({ ...f, atividade: e.target.value, objetoCusto: "" }))}
                >
                  <option value="">Todas</option>
                  {(dimensoes?.atividades ?? []).map((a) => (
                    <option key={a.codigo} value={a.codigo}>
                      {a.codigo} — {a.descricao}
                    </option>
                  ))}
                </select>
              </label>
              <label className="span-2">
                Objeto de custo
                <select
                  value={filtros.objetoCusto}
                  onChange={(e) => setFiltros((f) => ({ ...f, objetoCusto: e.target.value }))}
                >
                  <option value="">Todos</option>
                  {objetos.map((o) => (
                    <option key={o.codObjetoCusto} value={o.codObjetoCusto}>
                      {o.codObjetoCusto} — {o.descricao}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <p className="lead span-2" style={{ margin: 0 }}>
              Oficina usa origem fixa 3/1/1 — filtros de negócio/processo/objeto não se aplicam.
            </p>
          )}
          <div className="actions">
            <button type="submit" className="btn primary" disabled={loading}>
              {loading ? "Consultando…" : "Consultar"}
            </button>
          </div>
        </form>
        <ConsultaProgressBar active={loading} label="Consultando rateio…" className="consulta-progress--compact" />
      </section>

      {err ? (
        <p className="lead" style={{ color: "var(--danger)" }}>
          {err}
        </p>
      ) : null}
      {statusMsg && !err ? <p className="lead no-print">{statusMsg}</p> : null}

      {hasPrintableResults ? (
        <section className="panel print-report-intro">
          <h3>
            Consulta rateio — {subTabLabel}
            <span className="panel-h3-actions">
              <PrintButton />
            </span>
          </h3>
          <p className="print-only-meta">
            Consulta rateio — {subTabLabel} — {safraLabel} — período {filtros.anomesInicio} a{" "}
            {filtros.anomesFim}
          </p>
        </section>
      ) : null}

      {subTab === "consolidado" && consolidado?.atividades?.length ? (
        <>
          {rateioResumo ? (
            <div className="kpis" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
              <article className="kpi">
                <span>Pool lancamento</span>
                <strong>{formatBRL(rateioResumo.totalGeral ?? 0)}</strong>
              </article>
              <article className="kpi">
                <span>Total rateado</span>
                <strong>{formatBRL(rateioResumo.totalRateado ?? rateioResumo.totalGeral ?? 0)}</strong>
              </article>
              {(rateioResumo.porVia ?? []).slice(0, 4).map((row) => (
                <article className="kpi" key={row.via}>
                  <span>{row.via}</span>
                  <strong>{formatBRL(row.valor)}</strong>
                </article>
              ))}
            </div>
          ) : null}
          <section className="panel">
            <h3>Rateio consolidado ({consolidado.atividades.length} destinos)</h3>
            <div className="table-wrap">
              <table className="data cost-center">
                <thead>
                  <tr>
                    <th>Objeto</th>
                    <th>Descrição</th>
                    <th className="num">Total rateado</th>
                  </tr>
                </thead>
                <tbody>
                  {consolidado.atividades.map((row, index) => (
                    <tr key={row.chave || index}>
                      <td>{row.objetoCusto ?? "—"}</td>
                      <td className="desc">{row.descricao ?? "—"}</td>
                      <td className="num">{formatBRL(row.custoTotal ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {subTab === "diagnostico" && payload ? <DiagnosticoPanel payload={payload} /> : null}
      {subTab === "oficina" && payload ? <ReconciliacaoPanel payload={payload} titulo="oficina" /> : null}
      {subTab === "transporte" && payload ? <ReconciliacaoPanel payload={payload} titulo="transporte" /> : null}
      {subTab === "mecanizacao" && payload ? <ReconciliacaoPanel payload={payload} titulo="mecanização" /> : null}
      {subTab === "material" && payload ? <MaterialFluxoPanel payload={payload} /> : null}

      {subTab === "combustivel" && listRows.length ? (
        <section className="panel">
          <h3>
            Combustível
            <span className="panel-h3-actions">
              <div className="kind-toggle matriz-rha-toggle no-print">
                <button
                  type="button"
                  className={`btn ${combustivelVista === "modelo" ? "primary" : ""}`}
                  onClick={() => setCombustivelVista("modelo")}
                >
                  Por modelo
                </button>
                <button
                  type="button"
                  className={`btn ${combustivelVista === "detalhe" ? "primary" : ""}`}
                  onClick={() => setCombustivelVista("detalhe")}
                >
                  Detalhe
                </button>
              </div>
            </span>
          </h3>
          {abastecimentoResumo ? (
            <div className="kpis" style={{ marginBottom: 12 }}>
              <article className="kpi">
                <span>Modelos</span>
                <strong>{abastecimentoResumo.qtdModelos ?? porModeloRows.length}</strong>
              </article>
              <article className="kpi">
                <span>Litros</span>
                <strong>{formatConsultaValue(abastecimentoResumo.totalLitros ?? 0, "hours")}</strong>
              </article>
              <article className="kpi">
                <span>Horas apontadas</span>
                <strong>{formatConsultaValue(abastecimentoResumo.totalHoras ?? 0, "hours")}</strong>
              </article>
              <article className="kpi">
                <span>Área (ha)</span>
                <strong>{formatConsultaValue(abastecimentoResumo.totalAreaHa ?? 0, "hours")}</strong>
              </article>
              <article className="kpi">
                <span>Média L/h</span>
                <strong>{formatConsultaValue(abastecimentoResumo.mediaLitrosPorHora, "hours")}</strong>
              </article>
              <article className="kpi">
                <span>Média L/ha</span>
                <strong>{formatConsultaValue(abastecimentoResumo.mediaLitrosPorHa, "hours")}</strong>
              </article>
              <article className="kpi">
                <span>Custo</span>
                <strong>{formatBRL(abastecimentoResumo.totalValor ?? 0)}</strong>
              </article>
            </div>
          ) : null}
          {combustivelVista === "modelo" ? (
            <>
              <p className="lead" style={{ marginTop: 0 }}>
                Totais por modelo de equipamento (equipamento → modeloequipamento): L/h = litros ÷ horas;
                L/ha = litros ÷ área apontada.
              </p>
              <DataTable columns={colunasAbastecimentosPorModelo} rows={porModeloRows} />
            </>
          ) : (
            <DataTable columns={colunasAbastecimentos} rows={listRows} />
          )}
        </section>
      ) : null}
      {subTab === "insumo" && listRows.length ? (
        <section className="panel">
          <h3>Insumos ({listRows.length})</h3>
          <DataTable columns={colunasInsumos} rows={listRows} />
        </section>
      ) : null}
      {subTab === "servico-terceiro" && listRows.length ? (
        <section className="panel">
          <h3>Serviços de terceiro ({listRows.length})</h3>
          <DataTable columns={colunasServicosTerceiro} rows={listRows} />
        </section>
      ) : null}
      {subTab === "funcionario" && listRows.length ? (
        <section className="panel">
          <h3>Funcionários ({listRows.length})</h3>
          <DataTable columns={colunasFuncionarios} rows={listRows} />
        </section>
      ) : null}

      {!loading && !err && !statusMsg ? (
        <p className="lead">Selecione a aba, informe o período e clique em Consultar.</p>
      ) : null}
    </>
  );
}
