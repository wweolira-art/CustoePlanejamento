import type { ChartOptions } from "chart.js";
import { formatBRL } from "./format";

export const chartColors = {
  operacao: "#60a5fa",
  insumo: "#22c55e",
  servico: "#f59e0b",
  arrendamento: "#eab308",
  outrosCustos: "#a855f7",
  funcionario: "#fb7185",
  oficina: "#3b82f6",
  transporte: "#818cf8",
  mecanizacao: "#c084fc",
  combustivel: "#7dd3fc",
  material: "#93c5fd",
  text: "#e8f1ff",
  muted: "#9db6d4",
  grid: "rgba(147, 197, 253, 0.12)",
};

export const chartThemeLight = {
  text: "#1a2b4a",
  muted: "#5a6b7d",
  grid: "rgba(26, 43, 74, 0.1)",
};

/** Cores fixas por fatia — não dependem da ordem/quantidade de segmentos. */
export const composicaoTotalPorChave: Record<string, string> = {
  operacao: "#161937",
  insumo: "#549D2F",
  arrendamento: "#F5F5EA",
  outrosCustos: "#009FDE",
};

export const operacaoDetalhePorChave: Record<string, string> = {
  oficina: chartColors.oficina,
  transporte: chartColors.transporte,
  mecanizacao: chartColors.mecanizacao,
  combustivel: chartColors.combustivel,
  material: chartColors.material,
  servicoTerceiro: chartColors.servico,
  funcionario: chartColors.funcionario,
};

type ComposicaoChaveItem = { chave: string; label: string; valor: number };

export function coresComposicaoTotal(items: ComposicaoChaveItem[]) {
  return items.map(
    (item) => composicaoTotalPorChave[item.chave] ?? "#64748b",
  );
}

export function coresOperacaoDetalhe(items: ComposicaoChaveItem[]) {
  return items.map(
    (item) => operacaoDetalhePorChave[item.chave] ?? "#94a3b8",
  );
}

const moneyFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

type ComposicaoItem = { chave?: string; label: string; valor: number };

export function composicaoTotalOptions(items: ComposicaoItem[]): ChartOptions<"doughnut"> {
  const labels = items.map((i) => i.label);
  const data = items.map((i) => Number(i.valor) || 0);
  const total = data.reduce((a, b) => a + b, 0) || 1;

  return {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "58%",
    layout: { padding: { top: 28, bottom: 28, left: 36, right: 36 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label(ctx) {
            const value = ctx.parsed || 0;
            const pct = (value / total) * 100;
            return `${ctx.label}: ${moneyFmt.format(value)} (${pct.toFixed(1)}%)`;
          },
        },
      },
      datalabels: {
        color: chartThemeLight.text,
        anchor: "end",
        align: "end",
        offset: 10,
        clamp: false,
        clip: false,
        font: { weight: "bold" as const, size: 12 },
        formatter(value: number, ctx) {
          if (!value) return "";
          const pct = (value / total) * 100;
          if (pct < 2.5) return "";
          const nome = labels[ctx.dataIndex] || "";
          return `${nome} ${pct.toFixed(0)}%`;
        },
      },
    },
  };
}

export function pieOptions(items: ComposicaoItem[], light = true): ChartOptions<"pie"> {
  const theme = light ? chartThemeLight : chartColors;
  const data = items.map((i) => Number(i.valor) || 0);
  const total = data.reduce((a, b) => a + b, 0) || 1;

  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: 8 },
    plugins: {
      legend: {
        position: "bottom",
        labels: { color: theme.text, boxWidth: 12, padding: 14 },
      },
      tooltip: {
        callbacks: {
          label(ctx) {
            const value = ctx.parsed || 0;
            const pct = (value / total) * 100;
            return `${ctx.label}: ${moneyFmt.format(value)} (${pct.toFixed(1)}%)`;
          },
        },
      },
      datalabels: {
        color: light ? theme.text : "#071525",
        font: { weight: "bold" as const, size: 11 },
        formatter(value: number) {
          if (!value) return "";
          const pct = (value / total) * 100;
          if (pct < 4) return "";
          return `${moneyFmt.format(value)}\n${pct.toFixed(0)}%`;
        },
        textAlign: "center",
      },
    },
  };
}

export function estagioProducaoOptions(items: ComposicaoItem[]): ChartOptions<"bar"> {
  const data = items.map((i) => Number(i.valor) || 0);
  const total = data.reduce((a, b) => a + b, 0) || 1;
  const max = Math.max(...data, 0);

  return {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 4, bottom: 4, left: 4, right: 48 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label(ctx) {
            const value = Number(ctx.parsed.x) || 0;
            const pct = (value / total) * 100;
            return `${moneyFmt.format(value)} (${pct.toFixed(1)}%)`;
          },
        },
      },
      datalabels: {
        anchor: "end",
        align: "right",
        offset: 6,
        clamp: true,
        clip: false,
        color: "#1a2744",
        font: { weight: "bold" as const, size: 13 },
        formatter(value: number) {
          if (!value) return "";
          return `${((value / total) * 100).toFixed(0)}%`;
        },
      },
    },
    scales: {
      x: {
        display: false,
        grid: { display: false },
        suggestedMax: max * 1.18,
        beginAtZero: true,
      },
      y: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: "#1a2744",
          font: { size: 13, weight: 600 },
          padding: 8,
        },
      },
    },
  };
}
