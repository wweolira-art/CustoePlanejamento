import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { useEffect, useMemo, useRef } from "react";
import type { IndicadoresColheitaProducaoData } from "../../api";
import {
  aggregateDisponibilidade,
  formatDispLabel,
  type DispModo,
} from "./disponibilidade-aggregate";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  BarElement,
  BarController,
  Tooltip,
  Legend,
  ChartDataLabels,
);

const DISP_CHART_TEXT = "#1a1a1a";
const DISP_CHART_GRID = "rgba(0, 0, 0, 0.12)";
const DISP_TON_COR = "#8a6d12";
const DISP_ALERTA_PCT = 85;
const DISP_ALERTA_COR = "#ef4444";

const whiteBackground = {
  id: "whiteBackground",
  beforeDraw(chart: ChartJS) {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};

/** Extra space between the top legend and the plot (datalabels sit at the top). */
const legendGap = {
  id: "legendGap",
  beforeInit(chart: ChartJS) {
    const legend = chart.legend;
    if (!legend) return;
    const fit = legend.fit;
    legend.fit = function fitWithGap() {
      fit.bind(this)();
      this.height += 44;
    };
  },
};

function fmtTon(n: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
}

type Props = {
  series: IndicadoresColheitaProducaoData["disponibilidadeDiaria"];
  modo: DispModo;
  safraLabel?: string;
  mesRef?: string;
};

export function DisponibilidadeDiariaChart({ series, modo, safraLabel = "Safra", mesRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const chartSeries = useMemo(
    () => aggregateDisponibilidade(series, modo, { safraLabel, mesRef }),
    [series, modo, safraLabel, mesRef],
  );

  const isMonthDrill = modo === "mes" && Boolean(mesRef);
  const isDaily = modo === "dia" || isMonthDrill;
  const isMonthlyBars = modo === "mes" && !mesRef;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !chartSeries.length) return;

    ChartJS.getChart(canvas)?.destroy();

    const labels = chartSeries.map((row) => formatDispLabel(row.data, modo));
    const isBar = modo === "safra" || isMonthlyBars;
    const pointRadius = isDaily && chartSeries.length <= 31 ? 3 : chartSeries.length > 60 ? 0 : 3;

    const chart = new ChartJS(canvas, {
      type: isBar ? "bar" : "line",
      plugins: [legendGap, whiteBackground],
      data: {
        labels,
        datasets: [
          {
            type: "bar",
            label: "Cana colhida (t)",
            data: chartSeries.map((row) => row.toneladaColhida ?? 0),
            yAxisID: "y1",
            order: 1,
            backgroundColor: "rgba(201, 162, 39, 0.55)",
            borderColor: "#c9a227",
            borderWidth: 1,
            borderRadius: 3,
            maxBarThickness: isDaily ? 28 : 64,
          },
          {
            type: isBar ? "bar" : "line",
            label: "Colhedora (tipo 81)",
            data: chartSeries.map((row) => row.colhedora.disponibilidade),
            yAxisID: "y",
            order: 2,
            borderColor: "#1a7f37",
            backgroundColor: isBar ? "rgba(26, 127, 55, 0.75)" : "rgba(26, 127, 55, 0.12)",
            tension: 0.25,
            spanGaps: true,
            pointRadius,
          },
          {
            type: isBar ? "bar" : "line",
            label: "Transbordo (tipos 90 + 93)",
            data: chartSeries.map((row) => row.transbordo.disponibilidade),
            yAxisID: "y",
            order: 2,
            borderColor: "#2563eb",
            backgroundColor: isBar ? "rgba(37, 99, 235, 0.75)" : "rgba(37, 99, 235, 0.12)",
            tension: 0.25,
            spanGaps: true,
            pointRadius,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        color: DISP_CHART_TEXT,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            labels: {
              color: DISP_CHART_TEXT,
              font: { color: DISP_CHART_TEXT },
              padding: 20,
              boxWidth: 14,
            },
          },
          datalabels: {
            color(ctx) {
              if (ctx.dataset.yAxisID === "y1") return DISP_TON_COR;
              const v = ctx.dataset.data[ctx.dataIndex];
              if (typeof v === "number" && v < DISP_ALERTA_PCT) return DISP_ALERTA_COR;
              return DISP_CHART_TEXT;
            },
            anchor: "end",
            align: "top",
            offset: 4,
            font: { weight: "bold" as const, size: 10 },
            formatter(value: number | null, ctx) {
              if (value == null) return "";
              if (ctx.dataset.yAxisID === "y1") return value > 0 ? fmtTon(value) : "";
              return `${value.toFixed(0)}%`;
            },
            display(ctx) {
              if (chartSeries.length > 31 && !isMonthlyBars) return false;
              const v = ctx.dataset.data[ctx.dataIndex];
              if (ctx.dataset.yAxisID === "y1") return typeof v === "number" && v > 0;
              return v != null;
            },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const v = ctx.parsed.y;
                if (ctx.dataset.yAxisID === "y1") {
                  return `${ctx.dataset.label}: ${v == null ? "—" : `${fmtTon(v)} t`}`;
                }
                const idx = ctx.dataIndex;
                const row = chartSeries[idx];
                const bucket = ctx.datasetIndex === 1 ? row?.colhedora : row?.transbordo;
                const base = v == null ? "—" : `${v.toFixed(1)}%`;
                if (!bucket) return `${ctx.dataset.label}: ${base}`;
                return `${ctx.dataset.label}: ${base} (${bucket.rodando} disp. / ${bucket.total} total)`;
              },
            },
          },
        },
        scales: {
          y: {
            type: "linear",
            position: "left",
            min: 0,
            max: 100,
            ticks: {
              color: DISP_CHART_TEXT,
              font: { color: DISP_CHART_TEXT },
              callback: (v) => `${v}%`,
            },
            title: {
              display: true,
              text: "Disponibilidade (%)",
              color: DISP_CHART_TEXT,
              font: { color: DISP_CHART_TEXT },
            },
            grid: { color: DISP_CHART_GRID },
            border: { color: DISP_CHART_GRID },
          },
          y1: {
            type: "linear",
            position: "right",
            beginAtZero: true,
            ticks: {
              color: DISP_TON_COR,
              font: { color: DISP_TON_COR },
              callback: (v) => fmtTon(Number(v)),
            },
            title: {
              display: true,
              text: "Cana colhida (t)",
              color: DISP_TON_COR,
              font: { color: DISP_TON_COR },
            },
            grid: { drawOnChartArea: false },
            border: { color: "rgba(201, 162, 39, 0.45)" },
          },
          x: {
            ticks: {
              color: DISP_CHART_TEXT,
              font: { color: DISP_CHART_TEXT },
              maxRotation: isDaily ? 45 : 0,
              minRotation: 0,
              autoSkip: true,
              maxTicksLimit: isDaily ? 31 : 18,
            },
            title: {
              display: isDaily,
              text: "Data",
              color: DISP_CHART_TEXT,
              font: { color: DISP_CHART_TEXT },
            },
            grid: { color: DISP_CHART_GRID },
            border: { color: DISP_CHART_GRID },
          },
        },
      },
    });

    return () => chart.destroy();
  }, [chartSeries, modo, mesRef, isMonthlyBars, isMonthDrill, isDaily]);

  if (!series.length) {
    return <p className="lead indicadores-disp-empty">Sem dados de disponibilidade para o período.</p>;
  }

  if (!chartSeries.length) {
    return <p className="lead indicadores-disp-empty">Sem dados para o agrupamento selecionado.</p>;
  }

  return (
    <div className="indicadores-disp-chart-wrap">
      <canvas ref={canvasRef} />
    </div>
  );
}
