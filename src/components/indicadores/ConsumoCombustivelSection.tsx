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
  type ChartDataset,
  type ChartOptions,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { useEffect, useMemo, useRef } from "react";
import type { IndicadoresColheitaProducaoData, IndicadoresProducaoLinha } from "../../api";

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

const META = {
  colhedoraLtTon: 1.1,
  tratorLtTon: 0.5,
  tratorLtHr: 8,
  caminhaoLtTon: 1.3,
} as const;

const COR_AZUL = "#3b82f6";
const COR_VERDE = "#22c55e";
const COR_LARANJA = "#f59e0b";
const COR_VERMELHA = "#ef4444";

function fmt2(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmt0(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
}

function fmtMeta(n: number) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
}

function labelEquipamento(row: IndicadoresProducaoLinha) {
  if (row.codEquipamento != null && Number.isFinite(row.codEquipamento) && row.codEquipamento > 0) {
    return String(row.codEquipamento);
  }
  return row.equipTag?.trim() || "—";
}

function tonMaquinaDia(linhas: IndicadoresProducaoLinha[], totais: IndicadoresProducaoLinha | null, dias: number) {
  const ativos = linhas.filter((row) => (row.toneladaColhida ?? 0) > 0);
  const n = ativos.length || linhas.length;
  const ton = totais?.toneladaColhida ?? 0;
  if (!(n > 0) || !(dias > 0) || !(ton > 0)) return null;
  return Math.round((ton / dias / n) * 100) / 100;
}

type GrupoKind = "colhedora" | "trator" | "caminhao";

type ChartSpec = {
  labels: string[];
  datasets: ChartDataset<"bar" | "line", (number | null)[]>[];
  yTitle: string;
  y1Title?: string;
};

function chartSpec(kind: GrupoKind, linhas: IndicadoresProducaoLinha[]): ChartSpec {
  const labels = linhas.map((row) => labelEquipamento(row));
  const fill = (value: number) => labels.map(() => value);
  const hideLineLabels = { datalabels: { display: false } };

  if (kind === "caminhao") {
    return {
      labels,
      yTitle: "Km / Lt",
      y1Title: "Lt / ton",
      datasets: [
        {
          type: "bar",
          label: "Km/ Lt",
          data: linhas.map((row) => row.kmLt),
          backgroundColor: COR_AZUL,
          borderRadius: 3,
          yAxisID: "y",
          order: 2,
        },
        {
          type: "bar",
          label: "Lt/Ton — Caminhão",
          data: linhas.map((row) => row.ltTon),
          backgroundColor: COR_VERDE,
          borderRadius: 3,
          yAxisID: "y1",
          order: 2,
        },
        {
          type: "line",
          label: `Meta Lt/ton: ${fmtMeta(META.caminhaoLtTon)}`,
          data: fill(META.caminhaoLtTon),
          borderColor: COR_LARANJA,
          backgroundColor: COR_LARANJA,
          borderWidth: 2,
          pointRadius: 0,
          yAxisID: "y1",
          order: 1,
          ...hideLineLabels,
        },
      ],
    };
  }

  if (kind === "trator") {
    return {
      labels,
      yTitle: "Lt / ton",
      y1Title: "Lt / hrs",
      datasets: [
        {
          type: "bar",
          label: "Lt/hrs",
          data: linhas.map((row) => row.ltHr),
          backgroundColor: COR_AZUL,
          borderRadius: 3,
          yAxisID: "y1",
          order: 2,
        },
        {
          type: "bar",
          label: "Lt/ton",
          data: linhas.map((row) => row.ltTon),
          backgroundColor: COR_VERDE,
          borderRadius: 3,
          yAxisID: "y",
          order: 2,
        },
        {
          type: "line",
          label: `Meta Lt/hrs: ${fmtMeta(META.tratorLtHr)}`,
          data: fill(META.tratorLtHr),
          borderColor: COR_LARANJA,
          backgroundColor: COR_LARANJA,
          borderWidth: 2,
          pointRadius: 0,
          yAxisID: "y1",
          order: 1,
          ...hideLineLabels,
        },
        {
          type: "line",
          label: `Meta Lt/ton: ${fmtMeta(META.tratorLtTon)}`,
          data: fill(META.tratorLtTon),
          borderColor: COR_VERMELHA,
          backgroundColor: COR_VERMELHA,
          borderWidth: 2,
          pointRadius: 0,
          yAxisID: "y",
          order: 1,
          ...hideLineLabels,
        },
      ],
    };
  }

  return {
    labels,
    yTitle: "Lt / ton",
    y1Title: "Lt / hrs",
    datasets: [
      {
        type: "bar",
        label: "Litros / hrs",
        data: linhas.map((row) => row.ltHr),
        backgroundColor: COR_AZUL,
        borderRadius: 3,
        yAxisID: "y1",
        order: 2,
      },
      {
        type: "bar",
        label: "Lt/Ton",
        data: linhas.map((row) => row.ltTon),
        backgroundColor: COR_VERDE,
        borderRadius: 3,
        yAxisID: "y",
        order: 2,
      },
      {
        type: "line",
        label: `Meta Lt/ton: ${fmtMeta(META.colhedoraLtTon)}`,
        data: fill(META.colhedoraLtTon),
        borderColor: COR_VERMELHA,
        backgroundColor: COR_VERMELHA,
        borderWidth: 2,
        pointRadius: 0,
        yAxisID: "y",
        order: 1,
        ...hideLineLabels,
      },
    ],
  };
}

function ConsumoChart({ kind, linhas }: { kind: GrupoKind; linhas: IndicadoresProducaoLinha[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spec = useMemo(() => chartSpec(kind, linhas), [kind, linhas]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !spec.labels.length) return;
    ChartJS.getChart(canvas)?.destroy();

    const options: ChartOptions<"bar"> = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 12,
            boxHeight: 12,
            font: { size: 11 },
            color: "#1a241c",
            padding: 12,
          },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const v = ctx.parsed.y;
              if (v == null || !Number.isFinite(v)) return `${ctx.dataset.label}: —`;
              return `${ctx.dataset.label}: ${fmt2(v)}`;
            },
          },
        },
        datalabels: {
          color: "#1a241c",
          font: { weight: "bold", size: 10 },
          anchor: "end",
          align: "end",
          formatter: (v: number | null) => (v == null || !Number.isFinite(v) ? "" : fmt2(v)),
          clip: false,
        },
      },
      scales: {
        x: {
          ticks: { color: "#1a241c", font: { size: 11, weight: 600 } },
          grid: { display: false },
        },
        y: {
          position: "left",
          title: { display: true, text: spec.yTitle, color: "#64748b", font: { size: 11 } },
          ticks: { color: "#5a6b7d" },
          grid: { color: "rgba(0,0,0,0.08)" },
          beginAtZero: true,
        },
        ...(spec.y1Title
          ? {
              y1: {
                position: "right" as const,
                title: { display: true, text: spec.y1Title, color: "#64748b", font: { size: 11 } },
                ticks: { color: "#5a6b7d" },
                grid: { drawOnChartArea: false },
                beginAtZero: true,
              },
            }
          : {}),
      },
    };

    const chart = new ChartJS(canvas, {
      type: "bar",
      data: { labels: spec.labels, datasets: spec.datasets },
      options,
    });
    return () => chart.destroy();
  }, [spec]);

  if (!linhas.length) {
    return <p className="consumo-chart-empty">Nenhum equipamento associado no período.</p>;
  }

  return (
    <div className="consumo-chart-wrap">
      <div className="consumo-chart-canvas" style={{ minWidth: Math.max(360, spec.labels.length * 72) }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

function ConsumoGrupo({
  title,
  kind,
  linhas,
  totais,
  dias,
}: {
  title: string;
  kind: GrupoKind;
  linhas: IndicadoresProducaoLinha[];
  totais: IndicadoresProducaoLinha | null;
  dias: number;
}) {
  const kpis = [
    { value: tonMaquinaDia(linhas, totais, dias), label: "Ton/ Máquina dia", integer: false },
    {
      value: kind === "caminhao" ? totais?.kmRodados ?? null : totais?.hrsMotor ?? null,
      label: kind === "caminhao" ? "Quilômetros rodados" : "Horas rodada",
      integer: true,
    },
    { value: totais?.ltTon ?? null, label: "Lt/ ton", integer: false },
    { value: totais?.rsTon ?? null, label: "R$/ ton", integer: false },
  ];

  return (
    <section className="consumo-grupo">
      <header className="consumo-grupo-head">
        <h4>{title}</h4>
      </header>
      <div className="consumo-grupo-body">
        <div className="consumo-kpi-grid">
          {kpis.map((kpi) => (
            <article key={kpi.label} className="consumo-kpi-card">
              <strong>{kpi.integer ? fmt0(kpi.value) : fmt2(kpi.value)}</strong>
              <span>{kpi.label}</span>
            </article>
          ))}
        </div>
        <ConsumoChart kind={kind} linhas={linhas} />
      </div>
    </section>
  );
}

export function ConsumoCombustivelSection({ data }: { data: IndicadoresColheitaProducaoData }) {
  const dias = Math.max(1, data.filtros.dias || 1);
  return (
    <div className="consumo-dash">
      <ConsumoGrupo
        title="COLHEDEIRA DE CANA"
        kind="colhedora"
        linhas={data.tabelas.colhedora.linhas}
        totais={data.tabelas.colhedora.totais}
        dias={dias}
      />
      <ConsumoGrupo
        title="TRATORES DE TRANSBORDOS"
        kind="trator"
        linhas={data.tabelas.trator.linhas}
        totais={data.tabelas.trator.totais}
        dias={dias}
      />
      <ConsumoGrupo
        title="CAMINHÕES CANAVIEIROS"
        kind="caminhao"
        linhas={data.tabelas.caminhao.linhas}
        totais={data.tabelas.caminhao.totais}
        dias={dias}
      />
    </div>
  );
}
