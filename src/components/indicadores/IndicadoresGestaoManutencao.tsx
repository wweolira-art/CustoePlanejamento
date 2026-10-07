import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
  type Plugin,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { api, type GestaoManutencaoData, type GestaoManutencaoFalha, type GestaoManutencaoOsDetalhe } from "../../api";
import { useApp } from "../../store";
import { canAccess, PERMISSION_ADMIN } from "../../lib/permissions";
import { ConsultaProgressBar } from "../ConsultaProgressBar";
import { MonitoramentoOsSection } from "./MonitoramentoOsSection";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  LineElement,
  LineController,
  PointElement,
  Tooltip,
  Legend,
  ChartDataLabels,
);

const COR_AZUL = "#5b9bd5";
const COR_AZUL_ESCURO = "#1e4e79";
const COR_META = "#c00000";
const COR_BORDA = "#2f5496";

type MetaPorTipo = { metaMttrHoras: number; metaMtbfHoras: number; metaDisponibilidade: number };

function fmtHoras(horas: number | null | undefined) {
  if (horas == null || !Number.isFinite(horas)) return "—";
  const totalMin = Math.round(Math.abs(horas) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)}%`;
}

function fmtMoney(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtQty(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(n);
}

function fmtDateBr(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function fmtDateTimeBr(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = fmtDateBr(iso);
  const time = iso.slice(11, 16);
  return time ? `${date} ${time}` : date;
}

function useChart(canvasRef: RefObject<HTMLCanvasElement | null>, config: ChartConfiguration | null) {
  const chartRef = useRef<ChartJS | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !config) {
      chartRef.current?.destroy();
      chartRef.current = null;
      return;
    }
    chartRef.current?.destroy();
    chartRef.current = new ChartJS(canvas, config);
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [canvasRef, config]);
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="gm-chart-card">
      <header>{title}</header>
      <div className="gm-chart-body">{children}</div>
    </section>
  );
}

const metaLabelPlugin = (meta: number | null, formatter: (v: number) => string): Plugin => ({
  id: "gmMetaLabel",
  afterDraw(chart) {
    if (meta == null || !Number.isFinite(meta)) return;
    const yScale = chart.scales.y;
    if (!yScale) return;
    const y = yScale.getPixelForValue(meta);
    const { ctx, chartArea } = chart;
    if (!chartArea || y < chartArea.top || y > chartArea.bottom) return;
    ctx.save();
    ctx.fillStyle = COR_META;
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(formatter(meta), chartArea.right + 4, y);
    ctx.restore();
  },
});

export function IndicadoresGestaoManutencao() {
  const { authUser } = useApp();
  const canEditMetas = canAccess(authUser?.permissions, PERMISSION_ADMIN);
  const [ano, setAno] = useState<number | null>(null);
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [codTipoEquipamento, setCodTipoEquipamento] = useState<number | null>(null);
  const [codEquipamento, setCodEquipamento] = useState<number | null>(null);
  const [tipoMaterialCusto, setTipoMaterialCusto] = useState<string | null>(null);
  const [codObjetoCusto, setCodObjetoCusto] = useState<number | null>(null);
  const [data, setData] = useState<GestaoManutencaoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showMetas, setShowMetas] = useState(false);
  const [subAba, setSubAba] = useState<"indicadores" | "custo" | "monitoramento">("indicadores");
  const [savingMetas, setSavingMetas] = useState(false);
  const [metaMttr, setMetaMttr] = useState(15);
  const [metaMtbf, setMetaMtbf] = useState(15);
  const [metaDisp, setMetaDisp] = useState(95);
  const [metaScopeTipo, setMetaScopeTipo] = useState<number | null>(null);
  const [osAberta, setOsAberta] = useState<GestaoManutencaoFalha | null>(null);
  const [osDetalhe, setOsDetalhe] = useState<GestaoManutencaoOsDetalhe | null>(null);
  const [osLoading, setOsLoading] = useState(false);
  const [osErr, setOsErr] = useState<string | null>(null);

  const load = useCallback(async (params?: {
    ano?: number | null;
    dataInicio?: string | null;
    dataFim?: string | null;
    categoria?: string | null;
    codTipoEquipamento?: number | null;
    codEquipamento?: number | null;
    tipoMaterial?: string | null;
    codObjetoCusto?: number | null;
    /** Quando true, não envia datas (backend usa bounds da safra). */
    resetPeriodoSafra?: boolean;
  }) => {
    setLoading(true);
    setErr(null);
    try {
      const nextAno = params?.ano === undefined ? ano : params.ano;
      const nextCategoria = params?.categoria === undefined ? categoria : params.categoria;
      const nextTipo =
        params?.codTipoEquipamento === undefined ? codTipoEquipamento : params.codTipoEquipamento;
      const nextEquip = params?.codEquipamento === undefined ? codEquipamento : params.codEquipamento;
      const nextTipoMaterial =
        params?.tipoMaterial === undefined ? tipoMaterialCusto : params.tipoMaterial;
      const nextObjetoCusto =
        params?.codObjetoCusto === undefined ? codObjetoCusto : params.codObjetoCusto;
      const nextInicio = params?.resetPeriodoSafra
        ? undefined
        : params?.dataInicio === undefined
          ? dataInicio || undefined
          : params.dataInicio || undefined;
      const nextFim = params?.resetPeriodoSafra
        ? undefined
        : params?.dataFim === undefined
          ? dataFim || undefined
          : params.dataFim || undefined;

      const result = await api.indicadoresGestaoManutencao({
        ano: nextAno ?? undefined,
        dataInicio: nextInicio,
        dataFim: nextFim,
        categoria: nextCategoria,
        codTipoEquipamento: nextTipo,
        codEquipamento: nextEquip,
        tipoMaterial: nextTipoMaterial || undefined,
        codObjetoCusto: nextObjetoCusto,
      });
      setData(result);
      setAno(result.ano);
      setDataInicio(result.dataInicio);
      setDataFim(result.dataFim);
      setCategoria(result.categoria);
      setCodTipoEquipamento(result.codTipoEquipamento);
      setCodEquipamento(result.codEquipamento);
      setTipoMaterialCusto(result.custo.tipoMaterial);
      setCodObjetoCusto(result.custo.codObjetoCusto);
      setMetaMttr(result.meta.mttrHoras);
      setMetaMtbf(result.meta.mtbfHoras);
      setMetaDisp(result.meta.disponibilidade);
      setMetaScopeTipo(result.meta.codTipoEquipamento);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : "Não foi possível carregar a gestão de manutenção.");
    } finally {
      setLoading(false);
    }
  }, [ano, dataInicio, dataFim, categoria, codTipoEquipamento, codEquipamento, tipoMaterialCusto, codObjetoCusto]);

  const closeOs = useCallback(() => {
    setOsAberta(null);
    setOsDetalhe(null);
    setOsErr(null);
    setOsLoading(false);
  }, []);

  const openOs = useCallback(async (row: GestaoManutencaoFalha) => {
    setOsAberta(row);
    setOsDetalhe(null);
    setOsErr(null);
    setOsLoading(true);
    try {
      const detalhe = await api.indicadoresGestaoManutencaoOs(row.anoOs, row.numeroOs);
      setOsDetalhe(detalhe);
    } catch (e) {
      setOsErr(e instanceof Error ? e.message : "Não foi possível abrir a O.S.");
    } finally {
      setOsLoading(false);
    }
  }, []);

  const saveMetas = useCallback(async () => {
    if (!canEditMetas) {
      setErr("Apenas administrador pode alterar as metas.");
      return;
    }
    setSavingMetas(true);
    setErr(null);
    try {
      const currentMetasPorTipo = data?.meta.metasPorTipo ?? {};
      const nextMetasPorTipo: Record<string, MetaPorTipo> =
        metaScopeTipo != null
          ? {
              ...currentMetasPorTipo,
              [String(metaScopeTipo)]: {
                metaMttrHoras: metaMttr,
                metaMtbfHoras: metaMtbf,
                metaDisponibilidade: metaDisp,
              },
            }
          : currentMetasPorTipo;
      const saved = await api.indicadoresGestaoManutencaoConfigSave(
        metaScopeTipo != null
          ? { metasPorTipo: nextMetasPorTipo }
          : {
              metaMttrHoras: metaMttr,
              metaMtbfHoras: metaMtbf,
              metaDisponibilidade: metaDisp,
              metasPorTipo: nextMetasPorTipo,
            },
      );
      const activeMeta = metaScopeTipo != null ? saved.metasPorTipo[String(metaScopeTipo)] : saved;
      setMetaMttr(activeMeta.metaMttrHoras);
      setMetaMtbf(activeMeta.metaMtbfHoras);
      setMetaDisp(activeMeta.metaDisponibilidade);
      setData((prev) =>
        prev
          ? {
              ...prev,
              meta: {
                mttrHoras: activeMeta.metaMttrHoras,
                mtbfHoras: activeMeta.metaMtbfHoras,
                disponibilidade: activeMeta.metaDisponibilidade,
                codTipoEquipamento: metaScopeTipo,
                metasPorTipo: saved.metasPorTipo,
              },
            }
          : prev,
      );
      setShowMetas(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível salvar as metas.");
    } finally {
      setSavingMetas(false);
    }
  }, [canEditMetas, data?.meta.metasPorTipo, metaDisp, metaMtbf, metaMttr, metaScopeTipo]);

  useEffect(() => {
    void load({
      ano: null,
      categoria: null,
      codTipoEquipamento: null,
      codEquipamento: null,
      resetPeriodoSafra: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carga inicial
  }, []);

  useEffect(() => {
    if (!osAberta) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOs();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeOs, osAberta]);

  const labels = useMemo(() => data?.meses.map((m) => m.label) ?? [], [data]);

  const falhasConfig = useMemo<ChartConfiguration | null>(() => {
    if (!data?.meses.length) return null;
    return {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: data.meses.map((m) => m.qtdFalhas),
            backgroundColor: COR_AZUL,
            borderRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: {
            color: "#1e293b",
            anchor: "end",
            align: "top",
            font: { size: 10, weight: "bold" },
            formatter: (v: number) => (v ? String(v) : ""),
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, grace: "18%", ticks: { precision: 0 } },
        },
      },
    };
  }, [data, labels]);

  const tempoConfig = useMemo<ChartConfiguration | null>(() => {
    if (!data?.meses.length) return null;
    return {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: data.meses.map((m) => m.tempoReparoHoras),
            backgroundColor: COR_AZUL,
            borderRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: {
            color: "#1e293b",
            anchor: "end",
            align: "top",
            font: { size: 9, weight: "bold" },
            formatter: (v: number) => (v ? fmtHoras(v) : ""),
          },
          tooltip: {
            callbacks: {
              label: (ctx) => fmtHoras(Number(ctx.raw)),
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: {
            beginAtZero: true,
            grace: "18%",
            ticks: { callback: (v) => fmtHoras(Number(v)) },
          },
        },
      },
    };
  }, [data, labels]);

  const mttrConfig = useMemo<ChartConfiguration | null>(() => {
    if (!data?.meses.length) return null;
    const meta = data.meta.mttrHoras;
    return {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: data.meses.map((m) => m.mttrHoras ?? 0),
            backgroundColor: data.meses.map((m) =>
              m.mttrHoras != null && m.mttrHoras > meta ? COR_AZUL_ESCURO : COR_AZUL,
            ),
            borderRadius: 2,
            order: 2,
          },
          {
            type: "line",
            data: data.meses.map(() => meta),
            borderColor: COR_META,
            borderWidth: 2,
            pointRadius: 0,
            order: 1,
            datalabels: { display: false },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 36 } },
        plugins: {
          legend: { display: false },
          datalabels: {
            color: "#1e293b",
            anchor: "end",
            align: "top",
            font: { size: 9, weight: "bold" },
            formatter: (v: number, ctx) => {
              if (ctx.datasetIndex !== 0) return "";
              const raw = data.meses[ctx.dataIndex]?.mttrHoras;
              return raw != null ? fmtHoras(raw) : "";
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => (ctx.datasetIndex === 0 ? `MTTR ${fmtHoras(Number(ctx.raw))}` : `Meta ${fmtHoras(meta)}`),
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: {
            beginAtZero: true,
            grace: "18%",
            ticks: { callback: (v) => fmtHoras(Number(v)) },
          },
        },
      },
      plugins: [metaLabelPlugin(meta, fmtHoras)],
    };
  }, [data, labels]);

  const mtbfConfig = useMemo<ChartConfiguration | null>(() => {
    if (!data?.meses.length) return null;
    const meta = data.meta.mtbfHoras;
    return {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: data.meses.map((m) => m.mtbfHoras ?? 0),
            backgroundColor: data.meses.map((m) =>
              m.mtbfHoras != null && m.mtbfHoras >= meta ? COR_AZUL_ESCURO : COR_AZUL,
            ),
            borderRadius: 2,
            order: 2,
          },
          {
            type: "line",
            data: data.meses.map(() => meta),
            borderColor: COR_META,
            borderWidth: 2,
            pointRadius: 0,
            order: 1,
            datalabels: { display: false },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 36 } },
        plugins: {
          legend: { display: false },
          datalabels: {
            color: "#1e293b",
            anchor: "end",
            align: "top",
            font: { size: 9, weight: "bold" },
            formatter: (v: number, ctx) => {
              if (ctx.datasetIndex !== 0) return "";
              const raw = data.meses[ctx.dataIndex]?.mtbfHoras;
              return raw != null ? fmtHoras(raw) : "";
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => (ctx.datasetIndex === 0 ? `MTBF ${fmtHoras(Number(ctx.raw))}` : `Meta ${fmtHoras(meta)}`),
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: {
            beginAtZero: true,
            grace: "18%",
            ticks: { callback: (v) => fmtHoras(Number(v)) },
          },
        },
      },
      plugins: [metaLabelPlugin(meta, fmtHoras)],
    };
  }, [data, labels]);

  const dispConfig = useMemo<ChartConfiguration | null>(() => {
    if (!data?.meses.length) return null;
    const meta = data.meta.disponibilidade;
    return {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: data.meses.map((m) => m.disponibilidade ?? 0),
            backgroundColor: COR_AZUL_ESCURO,
            borderRadius: 2,
            order: 2,
          },
          {
            type: "line",
            data: data.meses.map(() => meta),
            borderColor: COR_META,
            borderWidth: 2,
            pointRadius: 0,
            order: 1,
            datalabels: { display: false },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 36 } },
        plugins: {
          legend: { display: false },
          datalabels: {
            color: "#1e293b",
            anchor: "end",
            align: "top",
            rotation: -90,
            font: { size: 9, weight: "bold" },
            formatter: (v: number, ctx) => {
              if (ctx.datasetIndex !== 0) return "";
              const raw = data.meses[ctx.dataIndex]?.disponibilidade;
              return raw != null ? fmtPct(raw) : "";
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                ctx.datasetIndex === 0 ? fmtPct(Number(ctx.raw)) : `Meta ${fmtPct(meta)}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: {
            beginAtZero: true,
            max: 100,
            ticks: { callback: (v) => `${v}%` },
          },
        },
      },
      plugins: [metaLabelPlugin(meta, fmtPct)],
    };
  }, [data, labels]);

  const indispConfig = useMemo<ChartConfiguration | null>(() => {
    if (!data?.meses.length) return null;
    return {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: data.meses.map((m) => m.indisponibilidade ?? 0),
            backgroundColor: COR_AZUL_ESCURO,
            borderRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: {
            color: "#1e293b",
            anchor: "end",
            align: "top",
            rotation: -90,
            font: { size: 9, weight: "bold" },
            formatter: (v: number, ctx) => {
              const raw = data.meses[ctx.dataIndex]?.indisponibilidade;
              return raw != null ? fmtPct(raw) : "";
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => fmtPct(Number(ctx.raw)),
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: {
            beginAtZero: true,
            ticks: { callback: (v) => `${v}%` },
          },
        },
      },
    };
  }, [data, labels]);

  const falhasRef = useRef<HTMLCanvasElement | null>(null);
  const tempoRef = useRef<HTMLCanvasElement | null>(null);
  const mttrRef = useRef<HTMLCanvasElement | null>(null);
  const mtbfRef = useRef<HTMLCanvasElement | null>(null);
  const dispRef = useRef<HTMLCanvasElement | null>(null);
  const indispRef = useRef<HTMLCanvasElement | null>(null);

  useChart(falhasRef, falhasConfig);
  useChart(tempoRef, tempoConfig);
  useChart(mttrRef, mttrConfig);
  useChart(mtbfRef, mtbfConfig);
  useChart(dispRef, dispConfig);
  useChart(indispRef, indispConfig);

  const anos = data?.filtros.anos ?? [];
  const safras = data?.filtros.safras ?? anos.map((y) => ({
    ano: y,
    label: `${String(y).slice(-2)}/${String(y + 1).slice(-2)}`,
  }));
  const categorias = data?.filtros.categorias ?? [];
  const tipos = data?.filtros.tipos ?? [];
  const equipamentos = data?.filtros.equipamentos ?? [];
  const objetosCusto = data?.custo.objetosCusto ?? [];
  const custoMaxMes = Math.max(...(data?.custo.porMes.map((row) => row.valor) ?? [0]), 1);
  const custoMaxFrota = Math.max(...(data?.custo.porFrota.map((row) => row.valor) ?? [0]), 1);
  const custoMaxComponente = Math.max(...(data?.custo.porComponente.map((row) => row.valor) ?? [0]), 1);
  const custoMaxObjetoCusto = Math.max(...(data?.custo.porObjetoCusto.map((row) => row.valor) ?? [0]), 1);
  const applyMetaScope = (codTipo: number | null) => {
    setMetaScopeTipo(codTipo);
    if (!data) return;
    const selected = codTipo != null ? data.meta.metasPorTipo[String(codTipo)] : null;
    setMetaMttr(selected?.metaMttrHoras ?? (codTipo == null ? data.meta.mttrHoras : 15));
    setMetaMtbf(selected?.metaMtbfHoras ?? (codTipo == null ? data.meta.mtbfHoras : 15));
    setMetaDisp(selected?.metaDisponibilidade ?? (codTipo == null ? data.meta.disponibilidade : 95));
  };

  return (
    <div className="gm-root">
      <ConsultaProgressBar active={loading} label="Consultando gestão de manutenção…" />
      {err ? <p className="lead" style={{ color: "var(--danger)" }}>{err}</p> : null}

      <div className="gm-layout">
        <aside className="gm-filters">
          <label className="gm-filter-field">
            <span>Safra</span>
            <select
              value={ano ?? ""}
              onChange={(e) => {
                const next = e.target.value ? Number(e.target.value) : null;
                setAno(next);
              }}
            >
              {safras.map((s) => (
                <option key={s.ano} value={s.ano}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="gm-filter-field">
            <span>Data início</span>
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
            />
          </label>

          <label className="gm-filter-field">
            <span>Data fim</span>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
            />
          </label>

          <label className="gm-filter-field">
            <span>Categoria</span>
            <select
              value={categoria ?? ""}
              onChange={(e) => {
                const next = e.target.value || null;
                setCategoria(next);
                setCodTipoEquipamento(null);
                setCodEquipamento(null);
              }}
            >
              <option value="">Todas</option>
              {categorias.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </label>

          <label className="gm-filter-field gm-filter-field--wide">
            <span>Tipo de equipamento</span>
            <select
              value={codTipoEquipamento ?? ""}
              onChange={(e) => {
                const next = e.target.value ? Number(e.target.value) : null;
                setCodTipoEquipamento(next);
                setCodEquipamento(null);
              }}
            >
              <option value="">Todos</option>
              {tipos.map((tipo) => (
                <option key={tipo.codTipoEquipamento} value={tipo.codTipoEquipamento}>
                  {tipo.label}
                </option>
              ))}
            </select>
          </label>

          <label className="gm-filter-field">
            <span>Cód. Equip.</span>
            <select
              value={codEquipamento ?? ""}
              disabled={categoria == null && codTipoEquipamento == null}
              onChange={(e) => {
                const next = e.target.value ? Number(e.target.value) : null;
                setCodEquipamento(next);
              }}
            >
              <option value="">
                {categoria == null && codTipoEquipamento == null
                  ? "Selecione categoria ou tipo"
                  : "Todos"}
              </option>
              {equipamentos.map((eq) => (
                <option key={eq.codEquipamento} value={eq.codEquipamento}>
                  {eq.label}
                </option>
              ))}
            </select>
          </label>
          <div className="gm-filter-actions no-print">
            <button
              type="button"
              className="btn primary"
              disabled={loading}
              onClick={() =>
                void load({
                  ano,
                  dataInicio: dataInicio || undefined,
                  dataFim: dataFim || undefined,
                  categoria,
                  codTipoEquipamento,
                  codEquipamento,
                  tipoMaterial: tipoMaterialCusto,
                  codObjetoCusto,
                })
              }
            >
              {loading ? "Consultando…" : "Consultar"}
            </button>
          </div>
        </aside>

        <div className="gm-main">
          <header className="gm-header">
            <div className="gm-header-row">
              <div>
                <h2>Gestão de Manutenção{data?.safra ? ` · ${data.safra}` : ""}</h2>
                <p>
                  Defina o período (ou use a safra) · MTBF (horímetro) = horas rodadas ÷ falhas · MTTR =
                  reparo ÷ falhas · Disponibilidade = horas disponíveis − manutenção
                </p>
              </div>
              {canEditMetas ? (
                <button
                  type="button"
                  className={`btn gm-metas-btn${showMetas ? " active" : ""}`}
                  onClick={() => {
                    if (data) {
                      setMetaMttr(data.meta.mttrHoras);
                      setMetaMtbf(data.meta.mtbfHoras);
                      setMetaDisp(data.meta.disponibilidade);
                      setMetaScopeTipo(data.meta.codTipoEquipamento);
                    }
                    setShowMetas((open) => !open);
                  }}
                  aria-label="Configurar metas"
                  title="Configurar metas"
                >
                  ⚙ Metas
                </button>
              ) : null}
            </div>
          </header>

          {showMetas && canEditMetas ? (
            <section className="gm-metas-panel no-print">
              <div className="gm-metas-fields">
                <label>
                  <span>Aplicar metas para</span>
                  <select
                    value={metaScopeTipo ?? ""}
                    onChange={(e) => applyMetaScope(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Padrão geral</option>
                    {tipos.map((tipo) => (
                      <option key={tipo.codTipoEquipamento} value={tipo.codTipoEquipamento}>
                        {tipo.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Meta MTTR (horas)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={metaMttr}
                    onChange={(e) => setMetaMttr(Number(e.target.value))}
                  />
                </label>
                <label>
                  <span>Meta MTBF (horas)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={metaMtbf}
                    onChange={(e) => setMetaMtbf(Number(e.target.value))}
                  />
                </label>
                <label>
                  <span>Meta Disponibilidade (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={metaDisp}
                    onChange={(e) => setMetaDisp(Number(e.target.value))}
                  />
                </label>
              </div>
              <div className="gm-metas-actions">
                <button type="button" className="btn" disabled={savingMetas} onClick={() => void saveMetas()}>
                  {savingMetas ? "Salvando…" : "Salvar metas"}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={savingMetas}
                  onClick={() => {
                    if (data) {
                      setMetaMttr(data.meta.mttrHoras);
                      setMetaMtbf(data.meta.mtbfHoras);
                      setMetaDisp(data.meta.disponibilidade);
                      setMetaScopeTipo(data.meta.codTipoEquipamento);
                    }
                    setShowMetas(false);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </section>
          ) : null}

          <nav className="kind-toggle gm-subtabs no-print" aria-label="Subabas de gestão de manutenção">
            <button
              type="button"
              className={`btn ${subAba === "indicadores" ? "primary" : ""}`}
              onClick={() => setSubAba("indicadores")}
            >
              Indicadores
            </button>
            <button
              type="button"
              className={`btn ${subAba === "custo" ? "primary" : ""}`}
              onClick={() => setSubAba("custo")}
            >
              Relatório de Custo
            </button>
            <button
              type="button"
              className={`btn ${subAba === "monitoramento" ? "primary" : ""}`}
              onClick={() => setSubAba("monitoramento")}
            >
              Monitoramento de OS
            </button>
          </nav>

          {subAba === "indicadores" ? (
            <>
              <div className="gm-kpis">
                <div className="gm-kpi">
                  <span>MTTR</span>
                  <strong>{fmtHoras(data?.kpis.mttrHoras)}</strong>
                </div>
                <div className="gm-kpi">
                  <span>MTBF</span>
                  <strong>{fmtHoras(data?.kpis.mtbfHoras)}</strong>
                </div>
                <div className="gm-kpi">
                  <span>DISPONIBILIDADE</span>
                  <strong>{fmtPct(data?.kpis.disponibilidade)}</strong>
                </div>
                <div className="gm-kpi">
                  <span>INDISPONIBILIDADE</span>
                  <strong>{fmtPct(data?.kpis.indisponibilidade)}</strong>
                </div>
              </div>

              <div className="gm-charts-row">
                <ChartCard title="Qtd de Falhas por Mês">
                  <canvas ref={falhasRef} />
                </ChartCard>
                <ChartCard title="Tempo Total por Mês">
                  <canvas ref={tempoRef} />
                </ChartCard>
              </div>

              <div className="gm-charts-row">
                <ChartCard title="MTTR">
                  <canvas ref={mttrRef} />
                </ChartCard>
                <ChartCard title="MTBF">
                  <canvas ref={mtbfRef} />
                </ChartCard>
              </div>

              <div className="gm-charts-row">
                <ChartCard title="DISPONIBILIDADE">
                  <canvas ref={dispRef} />
                </ChartCard>
                <ChartCard title="INDISPONIBILIDADE">
                  <canvas ref={indispRef} />
                </ChartCard>
              </div>

              <section className="gm-cost-card gm-cost-card--wide gm-cost-analitico gm-falhas-mttr">
                <header className="gm-cost-analitico-head">
                  <h4>Falhas do MTTR</h4>
                  <span>
                    {(data?.falhasMttr ?? []).length}{" "}
                    {(data?.falhasMttr ?? []).length === 1 ? "falha" : "falhas"}
                    {data?.kpis.qtdFalhas ? ` · reparo ${fmtHoras(data.kpis.tempoReparoHoras)} · MTTR ${fmtHoras(data.kpis.mttrHoras)}` : ""}
                  </span>
                </header>
                <p className="gm-falhas-mttr-hint">
                  Clique na O.S. para ver as falhas. Somente corretivas (sem plano de prevenção) entram no MTTR.
                </p>
                <div className="gm-cost-analitico-wrap">
                  <table className="gm-cost-analitico-table">
                    <thead>
                      <tr>
                        <th>O.S.</th>
                        <th>Equipamento</th>
                        <th>Tipo</th>
                        <th>Categoria</th>
                        <th>Abertura</th>
                        <th>Encerramento</th>
                        <th className="num">Tempo de reparo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.falhasMttr ?? []).map((row) => (
                        <tr
                          key={`${row.anoOs}-${row.numeroOs}`}
                          className="gm-falha-row"
                          onClick={() => void openOs(row)}
                        >
                          <td>
                            <button
                              type="button"
                              className="gm-os-link"
                              onClick={(e) => {
                                e.stopPropagation();
                                void openOs(row);
                              }}
                            >
                              {row.ordemServico}
                            </button>
                          </td>
                          <td>{row.codEquipamento}</td>
                          <td title={row.tipoEquipamento}>{row.tipoEquipamento || "—"}</td>
                          <td>{row.categoria || "—"}</td>
                          <td>{fmtDateTimeBr(row.dataAbertura)}</td>
                          <td>{row.aberta ? "Em aberto" : fmtDateTimeBr(row.dataEncerramento)}</td>
                          <td className="num">{fmtHoras(row.tempoReparoHoras)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data && !(data.falhasMttr?.length) ? (
                    <p className="lead">Nenhuma falha corretiva no período filtrado.</p>
                  ) : null}
                </div>
              </section>
            </>
          ) : null}

          {subAba === "custo" ? (
          <section className="gm-cost-dashboard">
            <header className="gm-cost-title">
              <h3>Relatório de Custo</h3>
              <span>Total: {fmtMoney(data?.custo.total)}</span>
            </header>

            <div className="gm-cost-filters no-print">
              <label>
                <span>Tipo de equipamento</span>
                <select
                  value={codTipoEquipamento ?? ""}
                  onChange={(e) => {
                    const next = e.target.value ? Number(e.target.value) : null;
                    setCodTipoEquipamento(next);
                    setCodEquipamento(null);
                  }}
                >
                  <option value="">Todos</option>
                  {tipos.map((tipo) => (
                    <option key={tipo.codTipoEquipamento} value={tipo.codTipoEquipamento}>
                      {tipo.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Tipo de material</span>
                <select
                  value={tipoMaterialCusto ?? ""}
                  onChange={(e) => setTipoMaterialCusto(e.target.value || null)}
                >
                  <option value="">Todos</option>
                  {(data?.custo.tiposMaterial ?? []).map((tipo) => (
                    <option key={tipo} value={tipo}>
                      {tipo}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Objeto de custo</span>
                <select
                  value={codObjetoCusto ?? ""}
                  onChange={(e) => setCodObjetoCusto(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Todos</option>
                  {objetosCusto.map((objeto) => (
                    <option key={objeto.codObjetoCusto} value={objeto.codObjetoCusto}>
                      {objeto.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn primary"
                disabled={loading}
                onClick={() =>
                  void load({
                    ano,
                    dataInicio: dataInicio || undefined,
                    dataFim: dataFim || undefined,
                    categoria,
                    codTipoEquipamento,
                    codEquipamento,
                    tipoMaterial: tipoMaterialCusto,
                    codObjetoCusto,
                  })
                }
              >
                {loading ? "Consultando…" : "Consultar custo"}
              </button>
            </div>

            <div className="gm-cost-kpis">
              <div className="gm-cost-kpi">
                <span>Total Corretiva</span>
                <strong>{fmtMoney(data?.custo.porTipo.corretiva)}</strong>
              </div>
              <div className="gm-cost-kpi">
                <span>Total Preventiva</span>
                <strong>{fmtMoney(data?.custo.porTipo.preventiva)}</strong>
              </div>
              <div className="gm-cost-kpi">
                <span>Total Preditiva</span>
                <strong>{fmtMoney(data?.custo.porTipo.preditiva)}</strong>
              </div>
              <div className="gm-cost-kpi">
                <span>Total Melhoria</span>
                <strong>{fmtMoney(data?.custo.porTipo.melhoria)}</strong>
              </div>
            </div>

            <div className="gm-cost-grid">
              <section className="gm-cost-card gm-cost-card--wide gm-cost-card--mes">
                <h4>Total por Mês</h4>
                <div className="gm-cost-months">
                  {(data?.custo.porMes ?? []).map((row) => (
                    <div key={row.key} className="gm-cost-month">
                      <div className="gm-cost-vbar" style={{ height: `${Math.max(4, (row.valor / custoMaxMes) * 100)}%` }}>
                        <span>{fmtMoney(row.valor)}</span>
                      </div>
                      <small>{row.label}</small>
                    </div>
                  ))}
                </div>
              </section>

              <section className="gm-cost-card gm-cost-card--percentual">
                <h4>Percentual</h4>
                <div className="gm-cost-percent-list">
                  {(data?.custo.percentual ?? []).map((row) => (
                    <div key={row.tipo} className={`gm-cost-percent gm-cost-percent--${row.tipo}`}>
                      <span>{row.label}</span>
                      <div>
                        <i style={{ width: `${Math.min(100, row.percentual)}%` }} />
                      </div>
                      <strong>{fmtPct(row.percentual)}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="gm-cost-card gm-cost-card--componentes">
                <h4>Total por Componente</h4>
                <div className="gm-cost-component-list">
                  {(data?.custo.porComponente ?? []).map((row) => (
                    <div key={row.componente} className="gm-cost-component-row" title={row.componente}>
                      <span>{row.label}</span>
                      <div>
                        <i style={{ width: `${Math.max(2, (row.valor / custoMaxComponente) * 100)}%` }} />
                      </div>
                      <strong>{fmtMoney(row.valor)}</strong>
                    </div>
                  ))}
                  {data && !data.custo.porComponente.length ? (
                    <p className="lead">Sem componente no período filtrado.</p>
                  ) : null}
                </div>
              </section>

              <section className="gm-cost-card gm-cost-card--wide gm-cost-card--frota">
                <h4>Total por Número de Frota</h4>
                <div className="gm-cost-frota-bars">
                  {(data?.custo.porFrota ?? []).map((row) => (
                    <div key={row.codEquipamento} className="gm-cost-frota-row">
                      <span>{row.label}</span>
                      <div>
                        <i style={{ width: `${Math.max(2, (row.valor / custoMaxFrota) * 100)}%` }} />
                        <b>{fmtMoney(row.valor)}</b>
                      </div>
                    </div>
                  ))}
                  {data && !data.custo.porFrota.length ? <p className="lead">Sem custo no período filtrado.</p> : null}
                </div>
              </section>

              <section className="gm-cost-card gm-cost-card--wide gm-cost-card--objeto">
                <h4>Custo por Objeto de Custo</h4>
                <div className="gm-cost-frota-bars">
                  {(data?.custo.porObjetoCusto ?? []).map((row) => (
                    <div key={`${row.codObjetoCusto ?? "sem"}-${row.objetoCusto}`} className="gm-cost-frota-row" title={row.objetoCusto}>
                      <span>{row.label}</span>
                      <div>
                        <i style={{ width: `${Math.max(2, (row.valor / custoMaxObjetoCusto) * 100)}%` }} />
                        <b>{fmtMoney(row.valor)}</b>
                      </div>
                    </div>
                  ))}
                  {data && !data.custo.porObjetoCusto.length ? (
                    <p className="lead">Sem objeto de custo no período filtrado.</p>
                  ) : null}
                </div>
              </section>
            </div>

            <section className="gm-cost-card gm-cost-card--wide gm-cost-analitico">
              <header className="gm-cost-analitico-head">
                <h4>Relatório Analítico</h4>
                <span>
                  {(data?.custo.analitico ?? []).length}{" "}
                  {(data?.custo.analitico ?? []).length === 1 ? "lançamento" : "lançamentos"}
                </span>
              </header>
              <div className="gm-cost-analitico-wrap">
                <table className="gm-cost-analitico-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Equipamento</th>
                      <th>Objeto de custo</th>
                      <th>Material / Componente</th>
                      <th>O.S.</th>
                      <th>Tipo</th>
                      <th className="num">Qtde</th>
                      <th className="num">Valor unit.</th>
                      <th className="num">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.custo.analitico ?? []).map((row, idx) => (
                      <tr key={`${row.data}-${row.ordemServico ?? "s"}-${row.codEquipamento ?? "e"}-${row.componente}-${idx}`}>
                        <td>{fmtDateBr(row.data)}</td>
                        <td>{row.codEquipamento ?? "—"}</td>
                        <td title={row.objetoCusto}>{row.objetoCusto}</td>
                        <td title={row.componente}>
                          <span className="gm-cost-analitico-mat">{row.componente}</span>
                          {row.tipoMaterial && row.tipoMaterial !== "NA" ? (
                            <small>{row.tipoMaterial}</small>
                          ) : null}
                        </td>
                        <td>{row.ordemServico ?? "—"}</td>
                        <td>
                          <span className={`gm-cost-tipo gm-cost-tipo--${row.tipo}`}>{row.tipoLabel}</span>
                        </td>
                        <td className="num">{fmtQty(row.quantidade)}</td>
                        <td className="num">{fmtMoney(row.valorUnitario)}</td>
                        <td className="num">{fmtMoney(row.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data && !(data.custo.analitico?.length) ? (
                  <p className="lead">Sem lançamentos analíticos no período filtrado.</p>
                ) : null}
              </div>
            </section>
          </section>
          ) : null}

          {subAba === "monitoramento" ? <MonitoramentoOsSection /> : null}
        </div>
      </div>

      {osAberta ? (
        <div className="modal-back gm-os-modal-back" onClick={closeOs}>
          <div className="modal gm-os-modal" onClick={(e) => e.stopPropagation()}>
            <header className="gm-os-modal-head">
              <div>
                <h3>O.S. {osAberta.ordemServico}</h3>
                <p>
                  Equipamento {osAberta.codEquipamento}
                  {osAberta.tipoEquipamento ? ` · ${osAberta.tipoEquipamento}` : ""}
                  {osAberta.categoria ? ` · ${osAberta.categoria}` : ""}
                </p>
              </div>
              <button type="button" className="btn" onClick={closeOs}>
                Fechar
              </button>
            </header>
            <dl className="gm-os-modal-meta">
              <div>
                <dt>Abertura</dt>
                <dd>{fmtDateTimeBr(osDetalhe?.dataAbertura ?? osAberta.dataAbertura)}</dd>
              </div>
              <div>
                <dt>Encerramento</dt>
                <dd>
                  {(osDetalhe?.aberta ?? osAberta.aberta)
                    ? "Em aberto"
                    : fmtDateTimeBr(osDetalhe?.dataEncerramento ?? osAberta.dataEncerramento)}
                </dd>
              </div>
              <div>
                <dt>Tempo de reparo</dt>
                <dd>{fmtHoras(osAberta.tempoReparoHoras)}</dd>
              </div>
              {osDetalhe?.box ? (
                <div>
                  <dt>Box</dt>
                  <dd>{osDetalhe.box}</dd>
                </div>
              ) : null}
            </dl>
            {osLoading ? <p className="lead">Carregando falhas da O.S.…</p> : null}
            {osErr ? <p className="lead" style={{ color: "var(--danger)" }}>{osErr}</p> : null}
            {!osLoading && osDetalhe ? (
              <div className="gm-os-falhas-wrap">
                <table className="gm-cost-analitico-table gm-os-falhas-table">
                  <thead>
                    <tr>
                      {osDetalhe.colunas.map((col) => (
                        <th key={col.key} className={col.key === "DESCRICAO" || col.key === "OBSERVACAO" ? "gm-os-col-wide" : undefined}>
                          {col.label}
                        </th>
                      ))}
                      <th>MTTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {osDetalhe.falhas.map((falha) => (
                      <tr key={falha.sequencial} className={falha.contaNoMttr ? "gm-os-falha--mttr" : undefined}>
                        {osDetalhe.colunas.map((col) => (
                          <td
                            key={col.key}
                            className={col.key === "DESCRICAO" || col.key === "OBSERVACAO" ? "gm-os-col-wide" : undefined}
                            title={falha.values[col.key] || undefined}
                          >
                            {falha.values[col.key] || "—"}
                          </td>
                        ))}
                        <td>{falha.contaNoMttr ? "Sim" : "Não"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!osDetalhe.falhas.length ? (
                  <p className="lead">Nenhum registro em automotivo.itens_osdefeitos para esta O.S.</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
