import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  DoughnutController,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { useEffect, useMemo, useRef } from "react";
import type { IndicadoresColheitaQualidadeData } from "../../api";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  ArcElement,
  DoughnutController,
  Tooltip,
  Legend,
  ChartDataLabels,
);

const PERDA_BAR = "rgba(43, 125, 216, 0.88)";
const IMPUREZA_BAR = "rgba(43, 125, 216, 0.88)";
const DONUT_COLORS = ["#1a5f2a", "#c9a227", "#3b82f6", "#1e3a5f", "#22c55e", "#ef4444", "#a855f7", "#f59e0b"];

const legendGap = {
  id: "qualidadeLegendGap",
  beforeInit(chart: ChartJS) {
    const legend = chart.legend;
    if (!legend) return;
    const fit = legend.fit;
    legend.fit = function fitWithGap() {
      fit.bind(this)();
      if (this.options?.position === "right" || this.options?.position === "left") {
        this.width += 28;
      } else {
        this.height += 36;
      }
    };
  },
};

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}%`;
}

function fmtNum(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function firstTwoNames(raw: string) {
  const cleaned = raw.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const parts = cleaned.split(" ").filter(Boolean);
  if (!parts.length) return "Operador";
  return parts.slice(0, 2).join(" ");
}

function HorizontalBarChart({
  title,
  labels,
  values,
  suffix = "%",
  barColor = PERDA_BAR,
}: {
  title: string;
  labels: string[];
  values: number[];
  suffix?: string;
  barColor?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hasAnyValue = values.some((v) => Number.isFinite(v) && v > 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !labels.length || !hasAnyValue) return;
    ChartJS.getChart(canvas)?.destroy();
    const chart = new ChartJS(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: barColor, borderRadius: 3 }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: "end",
            align: "end",
            color: "#1a241c",
            font: { weight: "bold", size: 10 },
            formatter: (v: number) => `${fmtNum(v)}${suffix}`,
          },
        },
        scales: {
          x: { ticks: { color: "#5a6b7d" }, grid: { color: "rgba(0,0,0,0.06)" } },
          y: { ticks: { color: "#1a241c", font: { size: 11 } }, grid: { display: false } },
        },
      },
    });
    return () => chart.destroy();
  }, [labels, values, suffix, barColor, hasAnyValue]);

  return (
    <div className="qualidade-dash-card">
      <h4>{title}</h4>
      <div className="qualidade-dash-canvas" style={{ height: Math.max(220, labels.length * 32) }}>
        {labels.length && hasAnyValue ? (
          <canvas ref={canvasRef} />
        ) : (
          <p className="qualidade-dash-empty">Sem dados no período.</p>
        )}
      </div>
    </div>
  );
}

function VerticalBarChart({ title, labels, values }: { title: string; labels: string[]; values: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hasAnyValue = values.some((v) => Number.isFinite(v) && v > 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !labels.length || !hasAnyValue) return;
    ChartJS.getChart(canvas)?.destroy();
    const chart = new ChartJS(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: PERDA_BAR, borderRadius: 3 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: "end",
            align: "end",
            color: "#1a241c",
            font: { weight: "bold", size: 10 },
            formatter: (v: number) => fmtPct(v),
          },
        },
        scales: {
          x: { ticks: { color: "#1a241c", maxRotation: 45, minRotation: 45 }, grid: { display: false } },
          y: { ticks: { color: "#5a6b7d" }, grid: { color: "rgba(0,0,0,0.06)" } },
        },
      },
    });
    return () => chart.destroy();
  }, [labels, values, hasAnyValue]);

  return (
    <div className="qualidade-dash-card">
      <h4>{title}</h4>
      <div className="qualidade-dash-canvas qualidade-dash-canvas--tall">
        {labels.length && hasAnyValue ? (
          <canvas ref={canvasRef} />
        ) : (
          <p className="qualidade-dash-empty">Sem dados no período.</p>
        )}
      </div>
    </div>
  );
}

function TipoPerdaDonut({ items }: { items: IndicadoresColheitaQualidadeData["porTipoPerda"] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labels = items.map((row) => row.label);
  const values = items.map((row) => row.pctPerda ?? 0);
  const hasAnyValue = values.some((v) => Number.isFinite(v) && v > 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !labels.length || !hasAnyValue) return;
    ChartJS.getChart(canvas)?.destroy();
    const chart = new ChartJS(canvas, {
      type: "doughnut",
      plugins: [legendGap],
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: labels.map((_, i) => DONUT_COLORS[i % DONUT_COLORS.length]),
            borderWidth: 1,
            borderColor: "#fff",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "52%",
        plugins: {
          legend: {
            position: "right",
            labels: { color: "#1a241c", boxWidth: 12, font: { size: 11 }, padding: 14 },
          },
          datalabels: {
            color: "#fff",
            font: { weight: "bold", size: 10 },
            formatter: (v: number) => (v >= 4 ? `${fmtNum(v)}%` : ""),
          },
        },
      },
    });
    return () => chart.destroy();
  }, [labels, values, hasAnyValue]);

  return (
    <div className="qualidade-dash-card">
      <h4>Tipo de perda</h4>
      <div className="qualidade-dash-canvas qualidade-dash-canvas--donut">
        {labels.length && hasAnyValue ? (
          <canvas ref={canvasRef} />
        ) : (
          <p className="qualidade-dash-empty">Sem dados no período.</p>
        )}
      </div>
    </div>
  );
}

function FazendaTable({ rows, totais }: { rows: IndicadoresColheitaQualidadeData["porFazenda"]; totais: IndicadoresColheitaQualidadeData["resumo"] }) {
  return (
    <div className="qualidade-dash-card qualidade-dash-card--table">
      <h4>Perda na colheita — fazenda</h4>
      <div className="table-wrap">
        <table className="data qualidade-fazenda-table">
          <thead>
            <tr>
              <th>Descrição</th>
              <th className="num">Perdas/Amostra (Ton/ha)</th>
              <th className="num">% Perdas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="num">{fmtNum(row.tonHaPerda)}</td>
                <td className="num">{fmtPct(row.pctPerda)}</td>
              </tr>
            ))}
            {rows.length ? (
              <tr className="qualidade-fazenda-total">
                <td>
                  <strong>Total</strong>
                </td>
                <td className="num">
                  <strong>{fmtNum(totais.tonHaPerda)}</strong>
                </td>
                <td className="num">
                  <strong>{fmtPct(totais.pctPerda)}</strong>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {!rows.length ? <p className="qualidade-dash-empty">Sem dados no período.</p> : null}
      </div>
    </div>
  );
}

export function QualidadeColheitaSection({ data }: { data: IndicadoresColheitaQualidadeData }) {
  const timeline = useMemo(
    () => ({
      labels: data.linhaTempo.map((row) => row.label),
      values: data.linhaTempo.map((row) => row.pctPerda ?? 0),
    }),
    [data.linhaTempo],
  );

  const equipamento = useMemo(
    () => ({
      labels: data.porEquipamento.map((row) => row.label),
      values: data.porEquipamento.map((row) => row.pctPerda ?? 0),
    }),
    [data.porEquipamento],
  );

  const operador = useMemo(
    () => ({
      labels: data.porOperador.map((row) => firstTwoNames(row.label || "")),
      values: data.porOperador.map((row) => row.pctPerda ?? 0),
    }),
    [data.porOperador],
  );

  const impureza = useMemo(
    () => ({
      labels: (data.impurezaPorEquipamento ?? []).map((row) => row.label),
      values: (data.impurezaPorEquipamento ?? []).map((row) => row.impurezaMineral ?? 0),
    }),
    [data.impurezaPorEquipamento],
  );

  return (
    <section className="qualidade-dashboard">
      <header className="qualidade-dashboard-header">
        <h3>Qualidade da colheita mecanizada</h3>
      </header>

      <div className="qualidade-dashboard-grid qualidade-dashboard-grid--top">
        <VerticalBarChart title="Perda na colheita — linha do tempo" labels={timeline.labels} values={timeline.values} />
        <HorizontalBarChart
          title="Perda na colheita — equipamento"
          labels={equipamento.labels}
          values={equipamento.values}
        />
        <TipoPerdaDonut items={data.porTipoPerda} />
      </div>

      <div className="qualidade-dashboard-grid qualidade-dashboard-grid--bottom">
        <HorizontalBarChart title="Perdas por operador" labels={operador.labels} values={operador.values} />
        <HorizontalBarChart
          title="Impureza mineral — equipamento"
          labels={impureza.labels}
          values={impureza.values}
          barColor={IMPUREZA_BAR}
        />
        <div className="qualidade-dashboard-side">
          <div className="qualidade-kpi-stack">
            <div className="qualidade-kpi-card">
              <span>Impureza mineral</span>
              <strong>{fmtPct(data.resumo.impurezaMineral)}</strong>
            </div>
            <div className="qualidade-kpi-card">
              <span>% Perda</span>
              <strong>{fmtPct(data.resumo.pctPerda)}</strong>
            </div>
          </div>
          <FazendaTable rows={data.porFazenda} totais={data.resumo} />
        </div>
      </div>
    </section>
  );
}
