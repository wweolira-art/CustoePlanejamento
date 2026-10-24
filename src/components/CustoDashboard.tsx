import { FiltroSuspenso } from "./custo/FiltroSuspenso";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type CustoDashboardAtividade, type CustoDashboardData, type CustoDimensoesData, type CustoMatrizSubprocessoData } from "../api";
import { formatBRL } from "../lib/format";
import { CustoCharts } from "./custo/CustoCharts";
import { RateioMatrizRha } from "./custo/RateioMatrizRha";
import { ConsultaProgressBar } from "./ConsultaProgressBar";
import { PrintButton } from "./PrintButton";

type Props = {
  anomesFrom: number;
  anomesTo: number;
  safraLabel: string;
  safraId?: number;
};

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

function formatHours(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n);
}

function tipoLabel(tipo: string) {
  if (tipo === "oficina") return "Oficina";
  if (tipo === "transporte") return "Transporte";
  if (tipo === "mecanizacao") return "Mecanização";
  if (tipo === "combustivel") return "Combustível";
  if (tipo === "material") return "Material";
  if (tipo === "insumo") return "Insumo";
  if (tipo === "servico-terceiro" || tipo === "servico-terceiro-fixo") return "Serviços 3º";
  if (tipo === "funcionario") return "Funcionário";
  return tipo || "—";
}

function buildFiltroParams(
  f: Filtros,
  extra: Record<string, string | number> = {},
  safraId?: number,
) {
  const params: Record<string, string | number> = {
    anomesInicio: f.anomesInicio,
    anomesFim: f.anomesFim,
    ...extra,
  };
  if (safraId != null) params.safraId = safraId;
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

export function AtividadeRow({ row, index }: { row: CustoDashboardAtividade; index: number }) {
  const [open, setOpen] = useState(false);
  const detalhes = row.detalhes ?? [];
  const hasDetail = detalhes.length > 0;

  return (
    <Fragment>
      <tr className={hasDetail ? "child" : undefined}>
        <td>
          {hasDetail ? (
            <button type="button" className="btn" style={{ padding: "2px 8px" }} onClick={() => setOpen((v) => !v)}>
              {open ? "▼" : "▶"}
            </button>
          ) : (
            " "
          )}
        </td>
        <td>{row.objetoCusto ?? "—"}</td>
        <td className="desc">{row.descricao ?? "—"}</td>
        <td className="num">{formatHours(row.horas)}</td>
        <td className="num">{row.custoPorHora != null ? formatBRL(row.custoPorHora) : "—"}</td>
        <td className="num">{formatHours(row.litrosPorHora)}</td>
        <td className="num">{formatHours(row.haPorHora)}</td>
        <td className="num">{formatBRL(row.custoOficina ?? 0)}</td>
        <td className="num">{formatBRL(row.custoTransporte ?? 0)}</td>
        <td className="num">{formatBRL(row.custoMecanizacao ?? 0)}</td>
        <td className="num">{formatBRL(row.custoCombustivel ?? 0)}</td>
        <td className="num">{formatBRL(row.custoMaterial ?? 0)}</td>
        <td className="num">{formatBRL(row.custoInsumo ?? 0)}</td>
        <td className="num">{formatBRL(row.custoServicoTerceiro ?? 0)}</td>
        <td className="num">{formatBRL(row.custoFuncionario ?? 0)}</td>
        <td className="num">{formatBRL(row.custoTotal ?? 0)}</td>
      </tr>
      {open
        ? detalhes.map((d, di) => (
            <tr key={`${index}-${di}`} className="nested-child">
              <td />
              <td colSpan={2}>
                {d.periodo ?? d.anomes ?? "—"} · op. {d.codOperacaoAgricola ?? "—"} · eq. {d.codEquipamento ?? "—"}
              </td>
              <td className="num">{formatHours(d.horas)}</td>
              <td className="num">{d.custoPorHora != null ? formatBRL(d.custoPorHora) : "—"}</td>
              <td className="num">{formatHours(d.litrosPorHora)}</td>
              <td className="num">{formatHours(d.haPorHora)}</td>
              <td className="num">{formatBRL(d.custoOficina ?? 0)}</td>
              <td className="num">{formatBRL(d.custoTransporte ?? 0)}</td>
              <td className="num">{formatBRL(d.custoMecanizacao ?? 0)}</td>
              <td className="num">{formatBRL(d.custoCombustivel ?? 0)}</td>
              <td className="num">{formatBRL(d.custoMaterial ?? 0)}</td>
              <td className="num">{formatBRL(d.custoInsumo ?? 0)}</td>
              <td className="num">{formatBRL(d.custoServicoTerceiro ?? 0)}</td>
              <td className="num">{formatBRL(d.custoFuncionario ?? 0)}</td>
              <td className="num">{formatBRL(d.custoTotal ?? 0)}</td>
            </tr>
          ))
        : null}
      {open
        ? detalhes.flatMap((d, di) =>
            (d.itens ?? []).map((item, ii) => (
              <tr key={`${index}-${di}-item-${ii}`} className="nested-activity">
                <td />
                <td colSpan={2} style={{ paddingLeft: 28 }}>
                  {tipoLabel(item.tipo)}
                  {item.codMaterial ? ` · mat. ${item.codMaterial}` : ""}
                  {item.descricaoMaterial ? ` — ${item.descricaoMaterial}` : ""}
                </td>
                <td className="num">{formatNum(item.quantidade ?? 0)}</td>
                <td />
                <td className="num">{formatHours(item.litros)}</td>
                <td />
                <td colSpan={8} />
                <td className="num">{formatBRL(item.custo ?? 0)}</td>
              </tr>
            )),
          )
        : null}
    </Fragment>
  );
}

export function CustoDashboard({ anomesFrom, anomesTo, safraLabel, safraId }: Props) {
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
  const [data, setData] = useState<CustoDashboardData | null>(null);
  const [matriz, setMatriz] = useState<CustoMatrizSubprocessoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [matrizLoading, setMatrizLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const consultSeq = useRef(0);

  useEffect(() => {
    setFiltros((prev) => ({
      ...prev,
      anomesInicio: anomesToInput(anomesFrom),
      anomesFim: anomesToInput(anomesTo),
    }));
  }, [anomesFrom, anomesTo]);

  const dimParams = useMemo(
    () =>
      buildFiltroParams(
        { ...filtros, equipamento: "", objetoCusto: "" },
        {
          anomesInicio: filtros.anomesInicio,
          anomesFim: filtros.anomesFim,
        },
        safraId,
      ),
    [
      filtros.anomesInicio,
      filtros.anomesFim,
      filtros.negocios,
      filtros.processo,
      filtros.subprocesso,
      filtros.atividade,
      safraId,
    ],
  );

  const reloadDimensoes = useCallback(async () => {
    if (!/^\d{6}$/.test(String(dimParams.anomesInicio)) || !/^\d{6}$/.test(String(dimParams.anomesFim))) {
      return;
    }
    try {
      const [dims, objs] = await Promise.all([
        api.custoDimensoes(dimParams),
        api.custoObjetosCusto(dimParams),
      ]);
      setDimensoes(dims);
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
    const timer = window.setTimeout(() => {
      void reloadDimensoes();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [reloadDimensoes]);

  const consultar = async () => {
    const seq = consultSeq.current + 1;
    consultSeq.current = seq;
    setLoading(true);
    setMatrizLoading(false);
    setErr(null);
    setData(null);
    setMatriz(null);
    const params = buildFiltroParams(filtros, {}, safraId);
    setMatrizLoading(true);
    try {
      // Dashboard e matriz são independentes e cada um consulta o Oracle.
      // Executar em paralelo evita somar o tempo das duas etapas na tela.
      const [dashboardResult, rateioResult] = await Promise.allSettled([
        api.custoDashboard(params).then((dashboard) => {
          if (seq === consultSeq.current) setData(dashboard);
          return dashboard;
        }),
        api.custoMatrizSubprocesso({ ...params, incluirEstagios: 0 }).then((rateio) => {
          if (seq === consultSeq.current) setMatriz(rateio);
          return rateio;
        }),
      ]);
      if (seq !== consultSeq.current) return;
      const failure = [dashboardResult, rateioResult].find(
        (result) => result.status === "rejected",
      );
      if (failure?.status === "rejected") {
        setErr(failure.reason instanceof Error ? failure.reason.message : String(failure.reason));
      }
    } catch (e) {
      if (seq !== consultSeq.current) return;
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === consultSeq.current) {
        setMatrizLoading(false);
        setLoading(false);
      }
    }
  };

  const resumo = data?.resumo;

  return (
    <div className="custo-tema-azul">

      <section className="panel no-print">
        <h3>Filtros</h3>
        <form
          className="form-grid custo-filtros-compactos"
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
          <FiltroSuspenso titulo="Equipamento" valor={filtros.equipamento || "Todos"}>
<label>
            Equipamento
            <input
              value={filtros.equipamento}
              onChange={(e) => setFiltros((f) => ({ ...f, equipamento: e.target.value }))}
              placeholder="Código ou parte"
            />
          </label>
</FiltroSuspenso>
          <FiltroSuspenso titulo="Negócio" valor={filtros.negocios.length ? filtros.negocios.join(", ") : "Todos"}>
<label>
            Negócio
            <select
              multiple
              size={4}
              value={filtros.negocios.map(String)}
              onChange={(e) => {
                const negocios = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
                setFiltros((f) => ({ ...f, negocios, processo: "", subprocesso: "", atividade: "", objetoCusto: "" }));
              }}
            >
              {(dimensoes?.negocios ?? []).map((n) => (
                <option key={n.codigo} value={n.codigo}>
                  {n.codigo} — {n.descricao}
                </option>
              ))}
            </select>
          </label>
</FiltroSuspenso>
          <FiltroSuspenso titulo="Processo" valor={filtros.processo || "Todos"}>
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
</FiltroSuspenso>
          <FiltroSuspenso titulo="Subprocesso" valor={filtros.subprocesso || "Todos"}>
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
</FiltroSuspenso>
          <FiltroSuspenso titulo="Atividade" valor={filtros.atividade || "Todas"}>
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
</FiltroSuspenso>
          <FiltroSuspenso titulo="Objeto de custo" valor={filtros.objetoCusto || "Todos"}>
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
</FiltroSuspenso>
          <div className="actions">
            <button type="submit" className="btn primary" disabled={loading}>
              {loading ? "Consultando…" : "Consultar"}
            </button>
          </div>
        </form>
        <ConsultaProgressBar
          active={loading}
          label={matrizLoading ? "Consultando rateio por subprocesso…" : "Consultando custo realizado…"}
          className="consulta-progress--compact"
        />
      </section>

      {err ? (
        <p className="lead" style={{ color: "var(--danger)" }}>
          {err}
        </p>
      ) : null}

      {resumo ? (
        <>
          <section className="panel print-report-intro">
            <h3>
              Custo realizado
              <span className="panel-h3-actions">
                <PrintButton />
              </span>
            </h3>
            <p className="print-only-meta">
              Custo realizado — {safraLabel} — período {filtros.anomesInicio} a {filtros.anomesFim}
            </p>
          </section>

          <div className="kpis" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            <article className="kpi">
              <span>Pool lancamento</span>
              <strong>{formatBRL(resumo.totalGeral)}</strong>
            </article>
            <article className="kpi">
              <span>Total rateado</span>
              <strong>{formatBRL(resumo.totalRateado ?? resumo.totalGeral)}</strong>
            </article>
            <article className="kpi">
              <span>Diferença</span>
              <strong>{formatBRL(resumo.diferenca ?? 0)}</strong>
            </article>
            <article className="kpi">
              <span>Destinos (negócio 1)</span>
              <strong>{resumo.qtdDestinos ?? resumo.qtdAtividades}</strong>
            </article>
            <article className="kpi">
              <span>Linhas de rateio</span>
              <strong>{resumo.qtdLinhas}</strong>
            </article>
          </div>

          {data?.composicao ? (
            <CustoCharts
              composicao={data.composicao}
              totalGeral={resumo.totalGeral}
            />
          ) : null}

          {matrizLoading ? (
            <p className="lead">Carregando rateio por subprocesso…</p>
          ) : null}
          {matriz?.linhas?.length ? (
            <RateioMatrizRha
              data={matriz}
              printMeta={`Rateio por subprocesso — ${safraLabel} — ${filtros.anomesInicio} a ${filtros.anomesFim}`}
            />
          ) : null}


        </>
      ) : !loading && !err ? (
        <p className="lead">Informe o período e clique em Consultar para carregar o relatório de custo.</p>
      ) : null}
    </div>
  );
}
