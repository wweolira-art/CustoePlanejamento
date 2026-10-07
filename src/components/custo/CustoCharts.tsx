import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  DoughnutController,
  LinearScale,
  PieController,
  Tooltip,
  Legend,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  composicaoTotalOptions,
  coresComposicaoTotal,
  estagioProducaoOptions,
} from "../../lib/custoCharts";
import { formatBRL } from "../../lib/format";

ChartJS.register(
  CategoryScale,
  LinearScale,
  ArcElement,
  BarElement,
  BarController,
  DoughnutController,
  PieController,
  Tooltip,
  Legend,
  ChartDataLabels,
);

type Composicao = {
  operacaoVsInsumo: { chave: string; label: string; valor: number }[];
  operacaoDetalhe: { chave: string; label: string; valor: number }[];
  porEstagio?: { chave: string; label: string; valor: number }[];
};

type Props = {
  composicao: Composicao;
  totalGeral: number;
};

function destroyChartOnCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const existing = ChartJS.getChart(canvas);
  if (existing) existing.destroy();
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Não foi possível gerar a imagem."));
    }, "image/png");
  });
}

function composeComposicaoImage(source: HTMLCanvasElement, totalLabel: string) {
  const dpr = source.width / Math.max(source.clientWidth, 1);
  const pad = Math.round(16 * dpr);
  const titleH = Math.round(40 * dpr);
  const out = document.createElement("canvas");
  out.width = source.width + pad * 2;
  out.height = source.height + titleH + pad * 2;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Não foi possível copiar o gráfico.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.fillStyle = "#1a2744";
  ctx.font = `700 ${Math.round(16 * dpr)}px Calibri, Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("Composição do custo total", pad, pad + titleH / 2);
  ctx.drawImage(source, pad, pad + titleH);
  const cx = pad + source.width / 2;
  const cy = pad + titleH + source.height / 2;
  ctx.textAlign = "center";
  ctx.font = `700 ${Math.round(17 * dpr)}px Calibri, Arial, sans-serif`;
  ctx.fillText(totalLabel, cx, cy - 8 * dpr);
  ctx.font = `500 ${Math.round(12 * dpr)}px Calibri, Arial, sans-serif`;
  ctx.fillStyle = "#5a6b7d";
  ctx.fillText("Custo total", cx, cy + 14 * dpr);
  return out;
}

async function copyPngToClipboard(blob: Blob) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("A cópia de imagem não está disponível neste navegador.");
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

export function CustoCharts({ composicao, totalGeral }: Props) {
  const composicaoRef = useRef<HTMLCanvasElement>(null);
  const estagioRef = useRef<HTMLCanvasElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "err">("idle");

  const operacaoVsInsumo = useMemo(
    () => composicao.operacaoVsInsumo.filter((i) => (i.valor ?? 0) > 0),
    [composicao.operacaoVsInsumo],
  );
  const porEstagio = useMemo(
    () =>
      [...(composicao.porEstagio ?? [])]
        .filter((i) => (i.valor ?? 0) > 0)
        .sort((a, b) => b.valor - a.valor),
    [composicao.porEstagio],
  );

  useEffect(() => {
    const charts: ChartJS[] = [];

    destroyChartOnCanvas(composicaoRef.current);
    if (composicaoRef.current && operacaoVsInsumo.length) {
      charts.push(
        new ChartJS(composicaoRef.current, {
          type: "doughnut",
          data: {
            labels: operacaoVsInsumo.map((i) => i.label),
            datasets: [
              {
                data: operacaoVsInsumo.map((i) => i.valor),
                backgroundColor: coresComposicaoTotal(operacaoVsInsumo),
                borderColor: "#ffffff",
                borderWidth: 3,
                hoverBorderColor: "#ffffff",
              },
            ],
          },
          options: composicaoTotalOptions(operacaoVsInsumo),
        }),
      );
    }

    destroyChartOnCanvas(estagioRef.current);
    if (estagioRef.current && porEstagio.length) {
      charts.push(
        new ChartJS(estagioRef.current, {
          type: "bar",
          data: {
            labels: porEstagio.map((i) => i.label),
            datasets: [
              {
                data: porEstagio.map((i) => i.valor),
                backgroundColor: "#165a72",
                borderRadius: 4,
                borderSkipped: false,
                barPercentage: 0.72,
                categoryPercentage: 0.78,
              },
            ],
          },
          options: estagioProducaoOptions(porEstagio),
        }),
      );
    }

    return () => {
      for (const chart of charts) chart.destroy();
      destroyChartOnCanvas(composicaoRef.current);
      destroyChartOnCanvas(estagioRef.current);
    };
  }, [operacaoVsInsumo, porEstagio]);

  const copyComposicao = async () => {
    try {
      const source = composicaoRef.current;
      if (!source) throw new Error("Gráfico ainda não carregou.");
      const image = composeComposicaoImage(source, formatBRL(totalGeral));
      await copyPngToClipboard(await canvasToPngBlob(image));
      setCopyState("ok");
    } catch {
      setCopyState("err");
    }
    window.setTimeout(() => setCopyState("idle"), 2500);
  };

  return (
    <div className="dashboard-grid">
      <article className="chart-card chart-card-composicao no-print">
        <header className="chart-card-head">
          <h2>Composição do custo total</h2>
          <button
            type="button"
            className="btn no-print"
            onClick={() => void copyComposicao()}
            title="Copia o gráfico para colar no PowerPoint"
          >
            {copyState === "ok" ? "Copiado" : copyState === "err" ? "Falhou" : "Copiar gráfico"}
          </button>
        </header>
        <div className="chart-box chart-box-pie chart-box-composicao">
          <canvas ref={composicaoRef} />
          <div className="chart-donut-center" aria-hidden="true">
            <strong>{formatBRL(totalGeral)}</strong>
            <span>Custo total</span>
          </div>
        </div>
      </article>

      <article className="chart-card chart-card-estagio">
        <header>
          <h2>Por estágio de produção</h2>
        </header>
        <div className="chart-box chart-box-estagio">
          <canvas ref={estagioRef} />
        </div>
      </article>
    </div>
  );
}
