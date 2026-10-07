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
  type ChartConfiguration,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { api, type MonitoramentoOsData, type MonitoramentoOsStatus } from "../../api";
import { ConsultaProgressBar } from "../ConsultaProgressBar";

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

const COR_AZUL = "#2E75B6";
const COR_BARRA = "#0078D4";
const STATUS_COR: Record<MonitoramentoOsStatus, string> = {
  "DENTRO DO PRAZO": "#2E75B6",
  "EM ATRASO": "#C00000",
  "INFORMAR PREVISÃO": "#FFC000",
};

function fmtInt(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}%`;
}

function fmtHms(horas: number | null | undefined) {
  if (horas == null || !Number.isFinite(horas)) return "—";
  const totalSec = Math.max(0, Math.round(horas * 3600));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtDateBr(iso: string | null | undefined) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
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

export function MonitoramentoOsSection() {
  const [box, setBox] = useState<number | null>(null);
  const [codTipo, setCodTipo] = useState<number | null>(null);
  const [codEquipamento, setCodEquipamento] = useState<number | null>(null);
  const [data, setData] = useState<MonitoramentoOsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (params?: {
    box?: number | null;
    codTipoEquipamento?: number | null;
    codEquipamento?: number | null;
  }) => {
    setLoading(true);
    setErr(null);
    try {
      const nextBox = params?.box === undefined ? box : params.box;
      const nextTipo = params?.codTipoEquipamento === undefined ? codTipo : params.codTipoEquipamento;
      const nextEquip = params?.codEquipamento === undefined ? codEquipamento : params.codEquipamento;
      const result = await api.indicadoresMonitoramentoOs({
        box: nextBox,
        codTipoEquipamento: nextTipo,
        codEquipamento: nextEquip,
      });
      setData(result);
      setBox(result.filtros.box);
      setCodTipo(result.filtros.codTipoEquipamento);
      setCodEquipamento(result.filtros.codEquipamento);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : "Não foi possível carregar o monitoramento de OS.");
    } finally {
      setLoading(false);
    }
  }, [box, codTipo, codEquipamento]);

  useEffect(() => {
    void load({ box: null, codTipoEquipamento: null, codEquipamento: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carga inicial
  }, []);

  const prazoRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef<HTMLCanvasElement>(null);
  const totalRef = useRef<HTMLCanvasElement>(null);
  const semPrevRef = useRef<HTMLCanvasElement>(null);

  const prazoConfig = useMemo<ChartConfiguration | null>(() => {
    if (!data?.prazoMedioPorBox.length) return null;
    return {
      type: "line",
      data: {
        labels: data.prazoMedioPorBox.map((row) => row.label),
        datasets: [
          {
            data: data.prazoMedioPorBox.map((row) => row.prazoHoras),
            borderColor: COR_AZUL,
            backgroundColor: COR_AZUL,
            pointRadius: 4,
            tension: 0.15,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: {
            color: "#1e3a5f",
            align: "top",
            font: { size: 9, weight: "bold" },
            formatter: (v: number) => fmtHms(v),
          },
          tooltip: { callbacks: { label: (ctx) => fmtHms(Number(ctx.raw)) } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, grace: "22%", ticks: { callback: (v) => fmtHms(Number(v)) } },
        },
      },
    };
  }, [data]);

  const statusConfig = useMemo<ChartConfiguration | null>(() => {
    if (!data?.status.length) return null;
    const total = data.status.reduce((acc, row) => acc + row.qtd, 0) || 1;
    return {
      type: "doughnut",
      data: {
        labels: data.status.map((row) => row.status),
        datasets: [
          {
            data: data.status.map((row) => row.qtd),
            backgroundColor: data.status.map((row) => STATUS_COR[row.status]),
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
          legend: { position: "top", labels: { boxWidth: 12, font: { size: 10 } } },
          datalabels: {
            color: "#334155",
            anchor: "end",
            align: "end",
            offset: 6,
            font: { size: 10, weight: "bold" },
            formatter: (v: number) => fmtPct((v / total) * 100),
          },
        },
      },
    };
  }, [data]);

  const totalConfig = useMemo<ChartConfiguration | null>(() => {
    if (!data?.totalPorBox.length) return null;
    return {
      type: "bar",
      data: {
        labels: data.totalPorBox.map((row) => row.label),
        datasets: [
          {
            data: data.totalPorBox.map((row) => row.qtd),
            backgroundColor: COR_BARRA,
            borderRadius: 0,
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
            font: { size: 11, weight: "bold" },
            formatter: (v: number) => (v ? String(v) : ""),
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, grace: "18%", ticks: { precision: 0 } },
        },
      },
    };
  }, [data]);

  const semPrevConfig = useMemo<ChartConfiguration | null>(() => {
    if (!data?.semPrevisaoPorBox.length) return null;
    return {
      type: "line",
      data: {
        labels: data.semPrevisaoPorBox.map((row) => row.label),
        datasets: [
          {
            data: data.semPrevisaoPorBox.map((row) => row.qtd),
            borderColor: COR_AZUL,
            backgroundColor: COR_AZUL,
            pointRadius: 4,
            tension: 0.15,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: {
            color: "#1e3a5f",
            align: "top",
            font: { size: 11, weight: "bold" },
            formatter: (v: number) => (v ? String(v) : ""),
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, grace: "22%", ticks: { precision: 0 } },
        },
      },
    };
  }, [data]);

  useChart(prazoRef, prazoConfig);
  useChart(statusRef, statusConfig);
  useChart(totalRef, totalConfig);
  useChart(semPrevRef, semPrevConfig);

  const tipos = data?.filtros.tipos ?? [];
  const boxes = data?.filtros.boxes ?? [];
  const equipamentos = (data?.filtros.equipamentos ?? []).filter(
    (eq) => codTipo == null || eq.codTipoEquipamento === codTipo,
  );

  return (
    <section className="gm-os-monitor">
      <header className="gm-os-head">
        <h3>
          Monitoramento de OS
          {data?.atualizadoEm ? ` - Última Atualização: ${data.atualizadoEm}` : ""}
        </h3>
      </header>

      <div className="gm-os-toolbar">
        <label>
          <span>Box</span>
          <select
            value={box ?? ""}
            onChange={(e) => setBox(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Todos</option>
            {boxes.map((codigo) => (
              <option key={codigo} value={codigo}>
                {codigo}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Tipo Equipamento</span>
          <select
            value={codTipo ?? ""}
            onChange={(e) => {
              setCodTipo(e.target.value ? Number(e.target.value) : null);
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
          <span>Equipamento</span>
          <select
            value={codEquipamento ?? ""}
            onChange={(e) => setCodEquipamento(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Todos</option>
            {equipamentos.map((eq) => (
              <option key={eq.codEquipamento} value={eq.codEquipamento}>
                {eq.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn primary"
          disabled={loading}
          onClick={() => void load({ box, codTipoEquipamento: codTipo, codEquipamento })}
        >
          {loading ? "Consultando…" : "Consultar"}
        </button>
        <div className="gm-os-kpis">
          <div className="gm-os-kpi">
            <strong>{fmtInt(data?.kpis.emAtraso)}</strong>
            <span>Qtde de OS em Atraso</span>
          </div>
          <div className="gm-os-kpi">
            <strong>{fmtInt(data?.kpis.semPrevisao)}</strong>
            <span>Qtde de OS sem Previsão</span>
          </div>
          <div className="gm-os-kpi">
            <strong>{fmtInt(data?.kpis.totalAberta)}</strong>
            <span>Total de OS Aberta</span>
          </div>
        </div>
      </div>

      <ConsultaProgressBar active={loading} label="Consultando ordens de serviço abertas…" className="consulta-progress--compact" />
      {err ? (
        <p className="lead no-print" style={{ color: "var(--danger)" }}>
          {err}
        </p>
      ) : null}

      <div className="gm-charts-row">
        <section className="gm-chart-card">
          <header>Prazo Médio de Atendimento</header>
          <div className="gm-chart-body">{prazoConfig ? <canvas ref={prazoRef} /> : <p className="lead">Sem dados.</p>}</div>
        </section>
        <section className="gm-chart-card">
          <header>Status de Ordens de Serviço</header>
          <div className="gm-chart-body">{statusConfig ? <canvas ref={statusRef} /> : <p className="lead">Sem dados.</p>}</div>
        </section>
      </div>
      <div className="gm-charts-row">
        <section className="gm-chart-card">
          <header>Ordens de Serviço - Total</header>
          <div className="gm-chart-body">{totalConfig ? <canvas ref={totalRef} /> : <p className="lead">Sem dados.</p>}</div>
        </section>
        <section className="gm-chart-card">
          <header>Ordens de Serviço - Sem previsão</header>
          <div className="gm-chart-body">{semPrevConfig ? <canvas ref={semPrevRef} /> : <p className="lead">Sem dados.</p>}</div>
        </section>
      </div>

      <div className="gm-os-table-wrap">
        <table className="gm-os-table">
          <thead>
            <tr>
              <th>Ano</th>
              <th>OS</th>
              <th>Cód. Equip.</th>
              <th>Descrição Tipo Equipamento</th>
              <th>Box</th>
              <th>Data Abertura</th>
              <th>Hora Abertura</th>
              <th>Data Previsão</th>
              <th>Hora Previsão</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.itens ?? []).map((row) => (
              <tr key={`${row.ano}-${row.os}`}>
                <td>{row.ano}</td>
                <td>{row.os}</td>
                <td>{row.codEquipamento ?? "—"}</td>
                <td className="left">{row.tipoEquipamento}</td>
                <td>{row.box ?? "—"}</td>
                <td>{fmtDateBr(row.dataAbertura)}</td>
                <td>{row.horaAbertura || ""}</td>
                <td>{fmtDateBr(row.dataPrevisao)}</td>
                <td>{row.horaPrevisao || ""}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.itens.length ? <p className="lead">Nenhuma OS aberta para o filtro.</p> : null}
      </div>
    </section>
  );
}
