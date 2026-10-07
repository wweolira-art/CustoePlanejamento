import {
  ArcElement,
  DoughnutController,
  Chart as ChartJS,
  Legend,
  Tooltip,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { useEffect, useMemo, useRef } from "react";
import type {
  IndicadoresColheitaProducaoData,
  IndicadoresDisponibilidadePorTipoData,
} from "../../api";
import { aggregateDisponibilidade } from "./disponibilidade-aggregate";

ChartJS.register(ArcElement, DoughnutController, Tooltip, Legend, ChartDataLabels);

const META_DISP = 85;
const PERDA_COLORS = ["#1a5f2a", "#c9a227", "#3b82f6", "#64748b", "#22c55e", "#ef4444", "#a855f7"];

function fmt2(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmt0(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${fmt2(n)}%`;
}

function dispTone(value: number | null | undefined, meta = META_DISP) {
  if (value == null || !Number.isFinite(value)) return "muted";
  if (value >= meta) return "ok";
  if (value >= meta - 10) return "warn";
  return "bad";
}

function DispBar({
  label,
  value,
  meta = META_DISP,
}: {
  label: string;
  value: number | null;
  meta?: number;
}) {
  const tone = dispTone(value, meta);
  const width = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className={`relatorio-disp-bar tone-${tone}`}>
      <div className="relatorio-disp-bar-head">
        <strong>{label}</strong>
        <span>{fmtPct(value)}</span>
      </div>
      <div className="relatorio-disp-bar-track">
        <i style={{ width: `${width}%` }} />
        <em style={{ left: `${meta}%` }} title={`Meta ${meta}%`} />
      </div>
    </div>
  );
}

function PerdaDonut({
  labels,
  values,
}: {
  labels: string[];
  values: number[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !labels.length) return;
    ChartJS.getChart(canvas)?.destroy();
    const chart = new ChartJS(canvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: labels.map((_, i) => PERDA_COLORS[i % PERDA_COLORS.length]),
            borderWidth: 2,
            borderColor: "#fff",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "58%",
        plugins: {
          legend: {
            position: "right",
            labels: { boxWidth: 12, font: { size: 11 }, color: "#1a241c" },
          },
          datalabels: {
            color: "#fff",
            font: { weight: "bold", size: 10 },
            formatter: (v: number) => (v >= 8 ? `${fmt2(v)}%` : ""),
          },
        },
      },
    });
    return () => chart.destroy();
  }, [labels, values]);

  if (!labels.length) return <p className="lead">Sem tipos de perda no período.</p>;
  return (
    <div className="relatorio-donut">
      <canvas ref={canvasRef} />
    </div>
  );
}

function pickDisp(
  linhas: IndicadoresDisponibilidadePorTipoData["linhas"] | undefined,
  codTipos: number[],
) {
  if (!linhas?.length) return null;
  const matched = linhas.filter((row) => codTipos.includes(row.codTipo));
  if (!matched.length) return null;
  const values = matched.map((row) => row.safraAtual).filter((v): v is number => v != null && Number.isFinite(v));
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

export function RelatorioDesempenhoColheita({
  data,
  disponibilidade,
  safraLabel,
}: {
  data: IndicadoresColheitaProducaoData;
  disponibilidade?: IndicadoresDisponibilidadePorTipoData | null;
  safraLabel?: string | null;
}) {
  const dias = Math.max(1, data.filtros.dias || 1);
  const diasColheitaColhedora = Math.max(1, data.filtros.diasColheitaColhedora || dias);

  const tonPeriodo = useMemo(() => {
    const totalColhedora = data.tabelas.colhedora.totais?.toneladaColhida;
    if (totalColhedora != null && totalColhedora > 0) return totalColhedora;
    return data.tabelas.colhedora.linhas.reduce((acc, row) => acc + (row.toneladaColhida ?? 0), 0);
  }, [data]);

  const tonDiaMaquina = useMemo(() => {
    const qtdMaquinas81 =
      data.tabelas.colhedora.linhas.length ||
      data.resumo.kpiCards.find((card) => card.id === "colhedora")?.total ||
      data.resumo.categorias.find((row) => row.categoria === "colhedora")?.total ||
      0;
    if (!(qtdMaquinas81 > 0) || !(diasColheitaColhedora > 0)) return null;
    const mediaDia = tonPeriodo / diasColheitaColhedora;
    return Math.round((mediaDia / qtdMaquinas81) * 100) / 100;
  }, [data, tonPeriodo, diasColheitaColhedora]);

  const colhedoraTotais = data.tabelas.colhedora.totais;

  const dispPeriodo = useMemo(() => {
    const agg = aggregateDisponibilidade(data.disponibilidadeDiaria ?? [], "safra", {
      safraLabel: safraLabel ?? "Safra",
    })[0];
    const fromApiColhedora = pickDisp(disponibilidade?.linhas, [81]);
    const fromApiTrator = pickDisp(disponibilidade?.linhas, [93, 90]);
    const fromApiCaminhao = pickDisp(disponibilidade?.linhas, [30, 31]);
    const cat = (id: string) => data.resumo.categorias.find((row) => row.categoria === id)?.disponibilidade ?? null;
    return {
      colhedora: fromApiColhedora ?? agg?.colhedora.disponibilidade ?? cat("colhedora"),
      trator: fromApiTrator ?? agg?.transbordo.disponibilidade ?? cat("transbordo") ?? cat("trator"),
      caminhao: fromApiCaminhao ?? cat("caminhao"),
      meta: disponibilidade?.meta ?? META_DISP,
    };
  }, [data, disponibilidade, safraLabel]);

  const perdaTipos = useMemo(() => {
    const rows = (data.qualidade?.porTipoPerda ?? []).filter((row) => (row.pctPerda ?? 0) > 0);
    const total = rows.reduce((acc, row) => acc + (row.pctPerda ?? 0), 0);
    if (!(total > 0)) return { labels: [] as string[], values: [] as number[] };
    return {
      labels: rows.map((row) => row.label),
      values: rows.map((row) => Math.round((((row.pctPerda ?? 0) / total) * 100) * 100) / 100),
    };
  }, [data.qualidade]);

  const perdaGeral = data.qualidade?.resumo.pctPerda ?? null;
  const impureza = data.qualidade?.resumo.impurezaMineral ?? null;
  const colhedorasPorTon = useMemo(() => {
    const linhas = data.tabelas.colhedora.linhas.slice().sort((a, b) => (b.toneladaColhida ?? 0) - (a.toneladaColhida ?? 0));
    const maxTon = Math.max(...linhas.map((row) => row.toneladaColhida ?? 0), 1);
    return { linhas, maxTon };
  }, [data.tabelas.colhedora.linhas]);

  return (
    <section className="panel relatorio-desempenho">
      <h3 className="relatorio-desempenho-title">
        Relatório de Desempenho Operacional: Colheita de Cana-de-Açúcar
        {safraLabel ? ` (${safraLabel})` : ""}
      </h3>

      <div className="relatorio-grid">
        <article className="relatorio-card">
          <h4>Produtividade</h4>
          <div className="relatorio-kpi-big">
            <span>Toneladas no período</span>
            <strong>{fmt0(tonPeriodo)} t</strong>
            <small>{dias} dia{dias === 1 ? "" : "s"}</small>
          </div>
          <div className="relatorio-kpi-row">
            <div>
              <span>Ton / máquina / dia</span>
              <strong>{fmt2(tonDiaMaquina)}</strong>
              <small>{diasColheitaColhedora} dia{diasColheitaColhedora === 1 ? "" : "s"}</small>
            </div>
            <div>
              <span>Ton / h motor</span>
              <strong>{fmt2(colhedoraTotais?.tonHrMotor)}</strong>
            </div>
            <div>
              <span>Ton / h elevador</span>
              <strong>{fmt2(colhedoraTotais?.tonHrElevador)}</strong>
            </div>
          </div>
        </article>

        <article className="relatorio-card">
          <h4>Disponibilidade mecânica</h4>
          <p className="relatorio-meta">Meta &gt; {dispPeriodo.meta}%</p>
          <div className="relatorio-disp-scale">
            <span>Crítico</span>
            <span>Atenção</span>
            <span>Excelente</span>
          </div>
          <DispBar label="Colhedoras (tipo 81)" value={dispPeriodo.colhedora} meta={dispPeriodo.meta} />
          <DispBar label="Tratores / transbordo (93 · 90)" value={dispPeriodo.trator} meta={dispPeriodo.meta} />
          <DispBar label="Caminhões (30 · 31)" value={dispPeriodo.caminhao} meta={dispPeriodo.meta} />
        </article>

        <article className="relatorio-card">
          <h4>Tonelada colhida por equipamento</h4>
          <div className="relatorio-kpi-row">
            <div>
              <span>Perdas</span>
              <strong>{fmtPct(perdaGeral)}</strong>
            </div>
            <div>
              <span>Lt / ton</span>
              <strong>{fmt2(colhedoraTotais?.ltTon)}</strong>
            </div>
            <div>
              <span>Lt / hr</span>
              <strong>{fmt2(colhedoraTotais?.ltHr)}</strong>
            </div>
          </div>
          {colhedorasPorTon.linhas.length ? (
            <div className="relatorio-equip-list">
              {colhedorasPorTon.linhas.map((row) => {
                const width = Math.max(
                  0,
                  Math.min(100, ((row.toneladaColhida ?? 0) / colhedorasPorTon.maxTon) * 100),
                );
                return (
                  <div key={row.equipTag} className="relatorio-equip-row">
                    <div className="relatorio-equip-head">
                      <strong>{row.equipTag}</strong>
                      <span>{fmt0(row.toneladaColhida)} t</span>
                    </div>
                    <div className="relatorio-equip-track">
                      <i style={{ width: `${width}%` }} />
                    </div>
                    <p className="relatorio-equip-meta">
                      Lt/ton {fmt2(row.ltTon)} · Lt/hr {fmt2(row.ltHr)}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="lead">Nenhum equipamento associado no período.</p>
          )}
        </article>

        <article className="relatorio-card relatorio-card-wide">
          <h4>Qualidade e perdas na colheita</h4>
          <div className="relatorio-qualidade">
            <div className="relatorio-kpi-row">
              <div>
                <span>% perda geral</span>
                <strong>{fmtPct(perdaGeral)}</strong>
                <small>
                  md_%Perdas
                </small>
              </div>
              <div>
                <span>t/ha perda</span>
                <strong>{fmt2(data.qualidade?.resumo.tonHaPerda)}</strong>
              </div>
              <div>
                <span>Impureza mineral</span>
                <strong>{fmtPct(impureza)}</strong>
              </div>
              <div>
                <span>Amostras</span>
                <strong>{fmt0(data.qualidade?.resumo.amostras)}</strong>
              </div>
            </div>
            <PerdaDonut labels={perdaTipos.labels} values={perdaTipos.values} />
          </div>
        </article>
      </div>
    </section>
  );
}
