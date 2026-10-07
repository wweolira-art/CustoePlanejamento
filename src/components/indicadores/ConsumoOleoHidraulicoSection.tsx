import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  DoughnutController,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import {
  META_OLEO_HIDRAULICO_LT_TON,
  type ConsumoOleoHidraulicoData,
  type ConsumoOleoMes,
} from "../../lib/consumo-oleo-hidraulico";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  LineElement,
  LineController,
  PointElement,
  ArcElement,
  DoughnutController,
  Tooltip,
  Legend,
  ChartDataLabels,
);

const SAFRA_COLORS = ["#9ca3af", "#f5c542", "#3b82f6"];
const MES_COLORS = ["#3b82f6", "#f97316", "#9ca3af", "#eab308", "#2563eb", "#22c55e", "#1d4ed8"];
const DONUT_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6"];

type OleoView = "dashboard" | "comparativo" | "mensal" | "sintetico";

function fmt1(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
}

function fmt2(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmt3(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n);
}

function fmt0(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
}

function MotivoCharts({ data }: { data: ConsumoOleoHidraulicoData }) {
  const barRef = useRef<HTMLCanvasElement>(null);
  const donutRef = useRef<HTMLCanvasElement>(null);
  const motivos = data.motivos;

  useEffect(() => {
    const canvas = barRef.current;
    if (!canvas) return;
    ChartJS.getChart(canvas)?.destroy();
    if (!motivos.length) return;
    const chart = new ChartJS(canvas, {
      type: "bar",
      data: {
        labels: motivos.map((row) => row.label),
        datasets: [
          {
            type: "bar",
            label: "Soma de Litros",
            data: motivos.map((row) => row.litros),
            backgroundColor: "#3b82f6",
            yAxisID: "y",
            order: 2,
          },
          {
            type: "line",
            label: "Qtde. Remontas",
            data: motivos.map((row) => row.qtdRemontas),
            borderColor: "#94a3b8",
            backgroundColor: "#94a3b8",
            yAxisID: "y1",
            pointRadius: 4,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
          datalabels: {
            color: "#1e293b",
            font: { weight: "bold", size: 11 },
            formatter: (v: number, ctx) => (ctx.datasetIndex === 0 ? fmt1(v) : fmt0(v)),
          },
        },
        scales: {
          y: { beginAtZero: true, title: { display: false }, grid: { color: "#e2e8f0" } },
          y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false } },
        },
      },
    });
    return () => chart.destroy();
  }, [motivos]);

  useEffect(() => {
    const canvas = donutRef.current;
    if (!canvas) return;
    ChartJS.getChart(canvas)?.destroy();
    if (!motivos.length) return;
    const total = motivos.reduce((a, r) => a + r.litros, 0) || 1;
    const chart = new ChartJS(canvas, {
      type: "doughnut",
      data: {
        labels: motivos.map((row) => row.label),
        datasets: [
          {
            data: motivos.map((row) => row.litros),
            backgroundColor: motivos.map((_, i) => DONUT_COLORS[i % DONUT_COLORS.length]),
            borderWidth: 2,
            borderColor: "#fff",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: { position: "right", labels: { boxWidth: 12, font: { size: 11 } } },
          datalabels: {
            color: "#fff",
            font: { weight: "bold", size: 11 },
            formatter: (v: number) => `${fmt0((v / total) * 100)}%`,
          },
        },
      },
    });
    return () => chart.destroy();
  }, [motivos]);

  if (!motivos.length) return <p className="lead">Sem consumo de óleo hidráulico no período.</p>;
  return (
    <div className="oleo-hid-charts">
      <div className="oleo-hid-chart">
        <canvas ref={barRef} />
      </div>
      <div className="oleo-hid-chart oleo-hid-chart-donut">
        <canvas ref={donutRef} />
      </div>
    </div>
  );
}

function ComparativoChart({ data }: { data: ConsumoOleoHidraulicoData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { equipamentos, safras } = data.comparativo;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !equipamentos.length) return;
    ChartJS.getChart(canvas)?.destroy();
    const chart = new ChartJS(canvas, {
      type: "bar",
      data: {
        labels: equipamentos.map(String),
        datasets: safras.map((safra, i) => ({
          label: `${safra.label} ${safra.dias} dias ${fmt1(safra.litros)} Lts.`,
          data: safra.porEquipamento.map((row) => row.litros),
          backgroundColor: SAFRA_COLORS[i % SAFRA_COLORS.length],
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
          datalabels: {
            anchor: "end",
            align: "end",
            color: "#1e293b",
            font: { weight: "bold", size: 10 },
            formatter: (v: number) => (v > 0 ? fmt0(v) : ""),
          },
        },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: "Litros" }, grid: { color: "#e2e8f0" } },
        },
      },
    });
    return () => chart.destroy();
  }, [equipamentos, safras]);

  if (!equipamentos.length) return <p className="lead">Sem comparativo de safras no período.</p>;
  return (
    <>
      <div className="oleo-hid-chart oleo-hid-chart-wide">
        <h4>CONSUMO ÓLEO HIDRAULICO LT - COLHEDORAS</h4>
        <p>Comparativo safra</p>
        <canvas ref={canvasRef} />
      </div>
      <div className="oleo-hid-indices">
        <strong className="oleo-hid-indices-title">
          Consumo Indices: (Meta &lt;= {fmt3(data.filtros.metaLtTon)} l/t)
        </strong>
        {safras.map((safra, i) => (
          <p key={safra.codigo} style={{ color: SAFRA_COLORS[i % SAFRA_COLORS.length] }}>
            {safra.dias} dias {safra.label}: {fmt1(safra.litros)} Lts. {fmt2(safra.toneladas)}t.{" "}
            {fmt3(safra.ltTon)}l/t
          </p>
        ))}
      </div>
    </>
  );
}

function MensalChart({ data }: { data: ConsumoOleoHidraulicoData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mensal = data.mensal;
  const media = useMemo(() => {
    const litros = mensal.reduce((a, r) => a + r.litros, 0);
    const tons = mensal.reduce((a, r) => a + r.toneladas, 0);
    return {
      chave: "media",
      label: "MÉDIA GERAL",
      litros,
      toneladas: tons,
      ltTon: data.resumo.ltTon,
    } satisfies ConsumoOleoMes;
  }, [data.resumo.ltTon, mensal]);
  const rows = useMemo(() => [...mensal, media], [media, mensal]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rows.length) return;
    ChartJS.getChart(canvas)?.destroy();
    const chart = new ChartJS(canvas, {
      type: "bar",
      data: {
        labels: rows.map((row) => row.label),
        datasets: [
          {
            label: "L/t",
            data: rows.map((row) => row.ltTon),
            backgroundColor: rows.map((_, i) => MES_COLORS[i % MES_COLORS.length]),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: "end",
            align: "end",
            color: "#1e293b",
            font: { weight: "bold", size: 11 },
            formatter: (v: number | null) => (v != null ? fmt3(v) : ""),
          },
        },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: "L/t" }, grid: { color: "#e2e8f0" } },
        },
      },
    });
    return () => chart.destroy();
  }, [rows]);

  if (!mensal.length) return <p className="lead">Sem consumo mensal no período.</p>;
  return (
    <div className="oleo-hid-mensal">
      <div className="oleo-hid-chart oleo-hid-chart-wide">
        <h4>CONSUMO ÓLEO HIDRAULICO L/ ton. COLHEDORAS</h4>
        <p>Mensal{data.filtros.safraCode ? ` - Safra ${data.filtros.safraCode}` : ""}</p>
        <canvas ref={canvasRef} />
      </div>
      <aside className="oleo-hid-meta-box">
        <strong>META: {fmt3(data.filtros.metaLtTon ?? META_OLEO_HIDRAULICO_LT_TON)} LTS/TON</strong>
        <ul>
          {mensal.map((row) => (
            <li key={row.chave}>
              {row.label} — {fmt1(row.litros)} litros
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function RelatorioSintetico({ data }: { data: ConsumoOleoHidraulicoData }) {
  const totais = data.equipamentos.reduce(
    (acc, row) => ({
      troca: acc.troca + row.troca,
      remonta: acc.remonta + row.remonta,
      total: acc.total + row.total,
    }),
    { troca: 0, remonta: 0, total: 0 },
  );
  return (
    <section className="panel oleo-hid-sintetico">
      <h3>Colhedoras — Relatório sintético</h3>
      <p className="lead">
        Consumo — Lubrificantes · Trocas/Remontas · {data.filtros.dataInicio} a {data.filtros.dataFim}
      </p>
      <div className="table-wrap">
        <table className="data indicadores-producao-table">
          <thead>
            <tr>
              <th>Equipamento</th>
              <th>Código Material</th>
              <th className="num">Troca</th>
              <th className="num">Remonta</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.equipamentos.map((row) => (
              <tr key={row.codEquipamento}>
                <td>
                  {row.codEquipamento} {row.descricao}
                </td>
                <td>
                  {row.codMaterial ?? "—"} {row.material}
                </td>
                <td className="num">{fmt2(row.troca)}</td>
                <td className="num">{fmt2(row.remonta)}</td>
                <td className="num">{fmt2(row.total)}</td>
              </tr>
            ))}
            {data.equipamentos.length ? (
              <tr className="indicadores-producao-total">
                <td colSpan={2}>
                  <strong>TOTAL GERAL</strong>
                </td>
                <td className="num">
                  <strong>{fmt2(totais.troca)}</strong>
                </td>
                <td className="num">
                  <strong>{fmt2(totais.remonta)}</strong>
                </td>
                <td className="num">
                  <strong>{fmt2(totais.total)}</strong>
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan={5}>Nenhum consumo de óleo hidráulico no período.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type Props = {
  dataInicio: string;
  dataFim: string;
  safraCode?: string | null;
  consultarToken: number;
  onLoadingChange?: (loading: boolean) => void;
};

export function ConsumoOleoHidraulicoSection({
  dataInicio,
  dataFim,
  safraCode,
  consultarToken,
  onLoadingChange,
}: Props) {
  const [view, setView] = useState<OleoView>("dashboard");
  const [data, setData] = useState<ConsumoOleoHidraulicoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [consultado, setConsultado] = useState(false);

  useEffect(() => {
    if (!consultarToken) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        onLoadingChange?.(true);
        setErr(null);
        const payload = await api.indicadoresColheitaOleoHidraulico({
          dataInicio,
          dataFim,
          safraCode: safraCode ?? undefined,
        });
        if (cancelled) return;
        setData(payload);
        setConsultado(true);
      } catch (e) {
        if (cancelled) return;
        setData(null);
        setErr(e instanceof Error ? e.message : String(e));
        setConsultado(true);
      } finally {
        if (!cancelled) {
          setLoading(false);
          onLoadingChange?.(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Consulta só ao clicar em Consultar.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataInicio/dataFim deliberadamente fora
  }, [consultarToken, onLoadingChange]);

  if (!consultado && !loading) {
    return <p className="lead">Consulte o período para ver o consumo de óleo hidráulico das colhedoras.</p>;
  }

  return (
    <div className="oleo-hid">
      <header className="oleo-hid-head">
        <div>
          <h3>Consumo de Óleo Hidráulico — Comparativo Mês (Safra Atual)</h3>
          <p>Colhedoras</p>
        </div>
      </header>

      <div className="kind-toggle qualidade-view-toggle no-print">
        <button type="button" className={`btn${view === "dashboard" ? " primary" : ""}`} onClick={() => setView("dashboard")}>
          Dashboard
        </button>
        <button type="button" className={`btn${view === "comparativo" ? " primary" : ""}`} onClick={() => setView("comparativo")}>
          Comparativo safra
        </button>
        <button type="button" className={`btn${view === "mensal" ? " primary" : ""}`} onClick={() => setView("mensal")}>
          Mensal L/t
        </button>
        <button type="button" className={`btn${view === "sintetico" ? " primary" : ""}`} onClick={() => setView("sintetico")}>
          Relatório sintético
        </button>
      </div>

      {err ? (
        <p className="lead" style={{ color: "var(--danger)" }}>
          {err}
        </p>
      ) : null}

      {loading && !data ? <p className="lead">Consultando consumo de óleo hidráulico…</p> : null}

      {data && view === "dashboard" ? (
        <>
          <div className="oleo-hid-kpis">
            <article>
              <span>LITROS REMONTA HID.</span>
              <strong>{fmt1(data.resumo.litrosTotal)}</strong>
            </article>
            <article>
              <span>QTDE. REMONTAS</span>
              <strong>{fmt0(data.resumo.qtdRemontas)}</strong>
            </article>
            <article>
              <span>ÍNDICE L/T</span>
              <strong>{fmt3(data.resumo.ltTon)}</strong>
            </article>
            <article>
              <span>TONELADAS</span>
              <strong>{fmt2(data.resumo.toneladas)}</strong>
            </article>
          </div>
          <MotivoCharts data={data} />
        </>
      ) : null}

      {data && view === "comparativo" ? <ComparativoChart data={data} /> : null}
      {data && view === "mensal" ? <MensalChart data={data} /> : null}
      {data && view === "sintetico" ? <RelatorioSintetico data={data} /> : null}
    </div>
  );
}
