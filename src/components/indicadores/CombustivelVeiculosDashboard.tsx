import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ChartConfiguration,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import type {
  CombustivelDashboard,
  CombustivelEquipamento,
  CombustivelFrotaGrupo,
  CombustivelTipoEquipamento,
  IndicadoresCombustivelLinha,
} from "../../api";
import { formatBRL } from "../../lib/format";

ChartJS.register(CategoryScale, LinearScale, BarElement, BarController, Tooltip, Legend, ChartDataLabels);

const COR_HEADER = "#1e3a5f";
const COR_AZUL = "#2563eb";
const COR_VERDE = "#16a34a";
const COR_LARANJA = "#f59e0b";

function round3(n: number) {
  return Math.round(Number(n) * 1000) / 1000;
}

function money2(n: number) {
  return Math.round(Number(n) * 100) / 100;
}

function fmtNum(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

function labelEquipamento(row: CombustivelEquipamento) {
  return row.label || String(row.codEquipamento ?? "—");
}

function agregaPorTipoEquipamento(dados: IndicadoresCombustivelLinha[]): CombustivelTipoEquipamento[] {
  const map = new Map<
    string,
    {
      codTipoEquipamento: number | null;
      tipoEquipamento: string;
      qtdeLitros: number;
      valorTotal: number;
      kmRodados: number;
      horasTrabalho: number;
      litrosKm: number;
      litrosHora: number;
      equipamentos: Set<string>;
    }
  >();

  for (const row of dados) {
    const tipo = row.tipoEquipamento?.trim() || row.frota || "Sem tipo";
    const key =
      row.codTipoEquipamento != null ? `t:${row.codTipoEquipamento}` : `n:${tipo.toLowerCase()}`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        codTipoEquipamento: row.codTipoEquipamento ?? null,
        tipoEquipamento: tipo,
        qtdeLitros: 0,
        valorTotal: 0,
        kmRodados: 0,
        horasTrabalho: 0,
        litrosKm: 0,
        litrosHora: 0,
        equipamentos: new Set(),
      };
      map.set(key, bucket);
    }
    const km = row.kmRodados ?? (row.tipoHorimetro === "K" ? row.kmhsRodados : 0);
    const horas =
      row.horasTrabalho ??
      (row.funcionaPorHora || row.tipoHorimetro === "H"
        ? row.horasApontamento > 0
          ? row.horasApontamento
          : row.kmhsRodados
        : row.horasApontamento);
    bucket.qtdeLitros += row.qtdeLitros;
    bucket.valorTotal += row.valorTotal;
    bucket.kmRodados += km;
    if (row.funcionaPorHora || row.tipoHorimetro === "H") {
      bucket.horasTrabalho += horas;
      bucket.litrosHora += row.qtdeLitros;
    } else if (row.tipoHorimetro === "K") {
      bucket.litrosKm += row.qtdeLitros;
    } else {
      bucket.horasTrabalho += horas;
    }
    if (row.codEquipamento != null) bucket.equipamentos.add(String(row.codEquipamento));
  }

  return [...map.values()]
    .map((bucket) => ({
      codTipoEquipamento: bucket.codTipoEquipamento,
      tipoEquipamento: bucket.tipoEquipamento,
      qtdEquipamentos: bucket.equipamentos.size,
      qtdeLitros: round3(bucket.qtdeLitros),
      valorTotal: money2(bucket.valorTotal),
      kmRodados: round3(bucket.kmRodados),
      horasTrabalho: round3(bucket.horasTrabalho),
      kmPorLitro:
        bucket.litrosKm > 0 && bucket.kmRodados > 0
          ? round3(bucket.kmRodados / bucket.litrosKm)
          : null,
      litrosPorHora:
        bucket.horasTrabalho > 0 && bucket.litrosHora > 0
          ? round3(bucket.litrosHora / bucket.horasTrabalho)
          : null,
    }))
    .sort((a, b) => a.tipoEquipamento.localeCompare(b.tipoEquipamento, "pt-BR"));
}

function agregaPorEquipamento(dados: IndicadoresCombustivelLinha[]): CombustivelEquipamento[] {
  const map = new Map<
    string,
    {
      codEquipamento: number | null;
      label: string;
      descricao: string | null;
      tipoHorimetro: string | null;
      funcionaPorHora: boolean;
      qtdeLitros: number;
      valorTotal: number;
      kmRodados: number;
      horasTrabalho: number;
      litrosKm: number;
      litrosHora: number;
    }
  >();

  for (const row of dados) {
    if (row.codEquipamento == null) continue;
    const key = String(row.codEquipamento);
    const desc =
      row.equipamentoDescricao?.trim() ||
      row.modeloEquipamento?.trim() ||
      `Equipamento ${row.codEquipamento}`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        codEquipamento: row.codEquipamento,
        label: String(row.codEquipamento),
        descricao: desc,
        tipoHorimetro: row.tipoHorimetro ?? null,
        funcionaPorHora: Boolean(row.funcionaPorHora || row.tipoHorimetro === "H"),
        qtdeLitros: 0,
        valorTotal: 0,
        kmRodados: 0,
        horasTrabalho: 0,
        litrosKm: 0,
        litrosHora: 0,
      };
      map.set(key, bucket);
    }
    const km = row.kmRodados ?? (row.tipoHorimetro === "K" ? row.kmhsRodados : 0);
    const horas =
      row.horasTrabalho ??
      (row.funcionaPorHora || row.tipoHorimetro === "H"
        ? row.horasApontamento > 0
          ? row.horasApontamento
          : row.kmhsRodados
        : row.horasApontamento);
    bucket.qtdeLitros += row.qtdeLitros;
    bucket.valorTotal += row.valorTotal;
    bucket.kmRodados += km;
    if (row.funcionaPorHora || row.tipoHorimetro === "H") {
      bucket.horasTrabalho += horas;
      bucket.litrosHora += row.qtdeLitros;
      bucket.funcionaPorHora = true;
    } else if (row.tipoHorimetro === "K") {
      bucket.litrosKm += row.qtdeLitros;
    } else {
      bucket.horasTrabalho += horas;
    }
  }

  return [...map.values()]
    .map((bucket) => ({
      codEquipamento: bucket.codEquipamento,
      label: bucket.label,
      descricao: bucket.descricao,
      tipoHorimetro: bucket.tipoHorimetro,
      funcionaPorHora: bucket.funcionaPorHora,
      qtdeLitros: round3(bucket.qtdeLitros),
      valorTotal: money2(bucket.valorTotal),
      kmRodados: round3(bucket.kmRodados),
      horasTrabalho: round3(bucket.horasTrabalho),
      kmPorLitro:
        bucket.litrosKm > 0 && bucket.kmRodados > 0
          ? round3(bucket.kmRodados / bucket.litrosKm)
          : null,
      litrosPorHora:
        bucket.horasTrabalho > 0 && bucket.litrosHora > 0
          ? round3(bucket.litrosHora / bucket.horasTrabalho)
          : null,
    }))
    .sort((a, b) => (a.codEquipamento ?? 0) - (b.codEquipamento ?? 0));
}

export function buildDashboardFromLinhas(dados: IndicadoresCombustivelLinha[]): CombustivelDashboard {
  const map = new Map<
    string,
    {
      frota: string;
      grupo: string;
      qtdeLitros: number;
      valorTotal: number;
      kmRodados: number;
      horasTrabalho: number;
      litrosKm: number;
      litrosHora: number;
      equipamentos: Set<string>;
    }
  >();

  for (const row of dados) {
    const frota = row.frota || row.tipoEquipamento || "Sem frota";
    const grupo = row.grupo || row.modeloEquipamento || "Sem grupo";
    const key = `${frota}||${grupo}`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        frota,
        grupo,
        qtdeLitros: 0,
        valorTotal: 0,
        kmRodados: 0,
        horasTrabalho: 0,
        litrosKm: 0,
        litrosHora: 0,
        equipamentos: new Set(),
      };
      map.set(key, bucket);
    }
    const km = row.kmRodados ?? (row.tipoHorimetro === "K" ? row.kmhsRodados : 0);
    const horas =
      row.horasTrabalho ??
      (row.funcionaPorHora || row.tipoHorimetro === "H"
        ? row.horasApontamento > 0
          ? row.horasApontamento
          : row.kmhsRodados
        : row.horasApontamento);
    bucket.qtdeLitros += row.qtdeLitros;
    bucket.valorTotal += row.valorTotal;
    bucket.kmRodados += km;
    if (row.funcionaPorHora || row.tipoHorimetro === "H") {
      bucket.horasTrabalho += horas;
      bucket.litrosHora += row.qtdeLitros;
    } else if (row.tipoHorimetro === "K") {
      bucket.litrosKm += row.qtdeLitros;
    } else {
      bucket.horasTrabalho += horas;
    }
    if (row.codEquipamento != null) bucket.equipamentos.add(String(row.codEquipamento));
  }

  const porFrotaGrupo: CombustivelFrotaGrupo[] = [...map.values()]
    .map((bucket) => ({
      frota: bucket.frota,
      grupo: bucket.grupo,
      qtdEquipamentos: bucket.equipamentos.size,
      qtdeLitros: round3(bucket.qtdeLitros),
      valorTotal: money2(bucket.valorTotal),
      kmRodados: round3(bucket.kmRodados),
      horasTrabalho: round3(bucket.horasTrabalho),
      kmPorLitro:
        bucket.litrosKm > 0 && bucket.kmRodados > 0
          ? round3(bucket.kmRodados / bucket.litrosKm)
          : null,
      litrosPorHora:
        bucket.horasTrabalho > 0 && bucket.litrosHora > 0
          ? round3(bucket.litrosHora / bucket.horasTrabalho)
          : null,
    }))
    .sort(
      (a, b) =>
        a.frota.localeCompare(b.frota, "pt-BR") || a.grupo.localeCompare(b.grupo, "pt-BR"),
    );

  const porEquipamento = agregaPorEquipamento(dados);
  const porTipoEquipamento = agregaPorTipoEquipamento(dados);
  const equipamentos = new Set(
    dados.filter((r) => r.codEquipamento != null).map((r) => String(r.codEquipamento)),
  );
  const litrosTotal = round3(dados.reduce((acc, r) => acc + r.qtdeLitros, 0));
  const kmTotal = round3(
    dados.reduce(
      (acc, r) => acc + (r.kmRodados ?? (r.tipoHorimetro === "K" ? r.kmhsRodados : 0)),
      0,
    ),
  );
  const horasTotal = round3(
    dados.reduce((acc, r) => {
      if (r.horasTrabalho != null) return acc + r.horasTrabalho;
      if (r.funcionaPorHora || r.tipoHorimetro === "H") {
        return acc + (r.horasApontamento > 0 ? r.horasApontamento : r.kmhsRodados);
      }
      return acc + r.horasApontamento;
    }, 0),
  );
  const custoTotal = money2(dados.reduce((acc, r) => acc + r.valorTotal, 0));
  const comKmL = dados.filter((r) => (r.kmPorLitro ?? 0) > 0);
  const comLh = dados.filter(
    (r) => (r.funcionaPorHora || r.tipoHorimetro === "H") && (r.litrosPorHora ?? 0) > 0,
  );

  return {
    kpis: {
      custoTotal,
      litrosTotal,
      kmTotal,
      horasTotal,
      mediaKmPorLitro: comKmL.length
        ? round3(comKmL.reduce((acc, r) => acc + (r.kmPorLitro || 0), 0) / comKmL.length)
        : kmTotal > 0 && litrosTotal > 0
          ? round3(kmTotal / litrosTotal)
          : null,
      mediaLitrosPorHora: comLh.length
        ? round3(comLh.reduce((acc, r) => acc + (r.litrosPorHora || 0), 0) / comLh.length)
        : horasTotal > 0 && litrosTotal > 0
          ? round3(litrosTotal / horasTotal)
          : null,
      qtdEquipamentos: equipamentos.size,
      qtdAbastecimentos: dados.length,
    },
    porFrotaGrupo,
    porEquipamento,
    porTipoEquipamento,
  };
}

function labelFrotaGrupo(row: CombustivelFrotaGrupo) {
  if (row.grupo && row.grupo !== row.frota) return `${row.frota} · ${row.grupo}`;
  return row.frota;
}

function useBarChart(canvasRef: RefObject<HTMLCanvasElement | null>, config: ChartConfiguration | null) {
  const chartRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !config) {
      chartRef.current?.destroy();
      chartRef.current = null;
      return;
    }
    chartRef.current?.destroy();
    chartRef.current = new ChartJS(canvasRef.current, config);
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [canvasRef, config]);
}

type Props = {
  dashboard: CombustivelDashboard;
  codTipoEquipamento?: string;
  titulo?: string;
  subtitulo?: string;
  filtersSlot?: ReactNode;
};

type KmSerie = {
  label: string;
  tooltip: string;
  kmPorLitro: number | null;
  litrosPorHora: number | null;
  kmRodados: number;
  horasTrabalho: number;
};

export function CombustivelVeiculosDashboard({
  dashboard,
  titulo = "Dashboard Veículos Leves",
  subtitulo = "Análise de Custo com Combustível",
  filtersSlot,
}: Props) {
  const { kpis, porFrotaGrupo, porEquipamento = [] } = dashboard;
  const custoRef = useRef<HTMLCanvasElement>(null);
  const eficienciaRef = useRef<HTMLCanvasElement>(null);
  const kmRef = useRef<HTMLCanvasElement>(null);

  const topCusto = useMemo(
    () =>
      [...porFrotaGrupo]
        .sort((a, b) => b.valorTotal - a.valorTotal)
        .slice(0, 12),
    [porFrotaGrupo],
  );

  const seriesKm = useMemo<KmSerie[]>(() => {
    return [...porEquipamento]
      .sort((a, b) => {
        const scoreA = Math.max(a.kmRodados, a.horasTrabalho, a.qtdeLitros, a.valorTotal);
        const scoreB = Math.max(b.kmRodados, b.horasTrabalho, b.qtdeLitros, b.valorTotal);
        return scoreB - scoreA;
      })
      .slice(0, 20)
      .map((row) => ({
        label: labelEquipamento(row),
        tooltip: row.descricao ? `${row.label} — ${row.descricao}` : String(row.label),
        kmPorLitro: row.kmPorLitro,
        litrosPorHora: row.litrosPorHora,
        kmRodados: row.kmRodados,
        horasTrabalho: row.horasTrabalho,
      }));
  }, [porEquipamento]);

  const custoConfig = useMemo<ChartConfiguration | null>(() => {
    if (!topCusto.length) return null;
    return {
      type: "bar",
      data: {
        labels: topCusto.map(labelFrotaGrupo),
        datasets: [
          {
            label: "Custo (R$)",
            data: topCusto.map((r) => r.valorTotal),
            backgroundColor: COR_AZUL,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: { top: 18 },
        },
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: "end",
            align: "top",
            offset: 2,
            clamp: true,
            color: "#334155",
            font: { size: 10, weight: "bold" },
            formatter: (v: number) =>
              v >= 1000 ? `${(v / 1000).toFixed(1)}k` : fmtNum(v, 0),
          },
        },
        scales: {
          x: { ticks: { maxRotation: 45, minRotation: 0, font: { size: 10 } } },
          y: {
            beginAtZero: true,
            grace: "15%",
            ticks: {
              callback: (v) => Number(v).toLocaleString("pt-BR"),
            },
          },
        },
      },
    };
  }, [topCusto]);

  const eficienciaConfig = useMemo<ChartConfiguration | null>(() => {
    if (!seriesKm.length) return null;
    return {
      type: "bar",
      data: {
        labels: seriesKm.map((r) => r.label),
        datasets: [
          {
            label: "Km/litros ou Litros/hora",
            data: seriesKm.map((r) => r.kmPorLitro ?? r.litrosPorHora),
            backgroundColor: COR_AZUL,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top" },
          datalabels: {
            anchor: "end",
            align: "top",
            color: "#334155",
            font: { size: 9, weight: "bold" },
            formatter: (v: number | null) => (v == null || !Number.isFinite(v) ? "" : fmtNum(v, 1)),
          },
          tooltip: {
            callbacks: {
              title: (items) => {
                const idx = items[0]?.dataIndex ?? -1;
                return seriesKm[idx]?.tooltip || "";
              },
              afterBody: () =>
                "Km/litros: TIPOHORIMETRO = K · Litros/hora: TIPOHORIMETRO = H",
            },
          },
        },
        scales: {
          x: { ticks: { maxRotation: 55, font: { size: 9 } } },
          y: { beginAtZero: true },
        },
      },
    };
  }, [seriesKm]);

  const kmConfig = useMemo<ChartConfiguration | null>(() => {
    if (!seriesKm.length) return null;
    return {
      type: "bar",
      data: {
        labels: seriesKm.map((r) => r.label),
        datasets: [
          {
            label: "Km total",
            data: seriesKm.map((r) => r.kmRodados),
            backgroundColor: COR_AZUL,
            borderRadius: 4,
            yAxisID: "y",
          },
          {
            label: "Horas total",
            data: seriesKm.map((r) => r.horasTrabalho),
            backgroundColor: COR_LARANJA,
            borderRadius: 4,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top" },
          datalabels: {
            color: "#334155",
            font: { size: 9, weight: "bold" },
            formatter: (v: number) => (v > 0 ? fmtNum(v, 0) : ""),
          },
          tooltip: {
            callbacks: {
              title: (items) => {
                const idx = items[0]?.dataIndex ?? -1;
                return seriesKm[idx]?.tooltip || "";
              },
            },
          },
        },
        scales: {
          x: { ticks: { maxRotation: 55, font: { size: 9 } } },
          y: {
            beginAtZero: true,
            position: "left",
            title: { display: true, text: "Km" },
          },
          y1: {
            beginAtZero: true,
            position: "right",
            grid: { drawOnChartArea: false },
            title: { display: true, text: "Horas" },
          },
        },
      },
    };
  }, [seriesKm]);

  useBarChart(custoRef, custoConfig);
  useBarChart(eficienciaRef, eficienciaConfig);
  useBarChart(kmRef, kmConfig);

  const eixoHint = "Por equipamento.";
  const mediaPrincipal =
    kpis.mediaKmPorLitro != null
      ? {
          icon: "km/L",
          label: "Média Km/litros",
          value: kpis.mediaKmPorLitro,
          secondary:
            kpis.mediaLitrosPorHora != null
              ? `Média L/h: ${fmtNum(kpis.mediaLitrosPorHora, 2)}`
              : null,
        }
      : {
          icon: "L/h",
          label: "Média L/h",
          value: kpis.mediaLitrosPorHora,
          secondary: null,
        };

  return (
    <div className="combustivel-dash">
      <header className="combustivel-dash-header">
        <div className="combustivel-dash-brand">
          <div className="combustivel-dash-logo" aria-hidden>
            EJ
          </div>
          <div>
            <h3>{titulo}</h3>
            <p>{subtitulo}</p>
          </div>
        </div>
        {filtersSlot ? <div className="combustivel-dash-filters no-print">{filtersSlot}</div> : null}
      </header>

      <div className="combustivel-dash-kpis">
        <article className="combustivel-dash-kpi">
          <span className="combustivel-dash-kpi-icon" aria-hidden>
            R$
          </span>
          <div>
            <span>Custo Total</span>
            <strong>{formatBRL(kpis.custoTotal)}</strong>
          </div>
        </article>
        <article className="combustivel-dash-kpi">
          <span className="combustivel-dash-kpi-icon combustivel-dash-kpi-icon--clock" aria-hidden>
            h
          </span>
          <div>
            <span>Horas Total</span>
            <strong>{fmtNum(kpis.horasTotal, 1)}</strong>
          </div>
        </article>
        <article className="combustivel-dash-kpi">
          <span className="combustivel-dash-kpi-icon combustivel-dash-kpi-icon--fuel" aria-hidden>
            L
          </span>
          <div>
            <span>Litros Total</span>
            <strong>{fmtNum(kpis.litrosTotal, 1)}</strong>
          </div>
        </article>
        <article className="combustivel-dash-kpi">
          <span className="combustivel-dash-kpi-icon combustivel-dash-kpi-icon--km" aria-hidden>
            km
          </span>
          <div>
            <span>Km Total</span>
            <strong>{fmtNum(kpis.kmTotal, 0)}</strong>
          </div>
        </article>
        <article className="combustivel-dash-kpi">
          <span className="combustivel-dash-kpi-icon combustivel-dash-kpi-icon--media" aria-hidden>
            {mediaPrincipal.icon}
          </span>
          <div>
            <span>{mediaPrincipal.label}</span>
            <strong>{fmtNum(mediaPrincipal.value, 2)}</strong>
            {mediaPrincipal.secondary ? <small>{mediaPrincipal.secondary}</small> : null}
          </div>
        </article>
      </div>

      <section className="combustivel-dash-card">
        <h4 style={{ background: COR_HEADER }}>Custo consumo de combustível por frota e grupo</h4>
        <div className="combustivel-dash-canvas">
          {topCusto.length ? (
            <canvas ref={custoRef} />
          ) : (
            <p className="lead">Sem dados de custo no filtro selecionado.</p>
          )}
        </div>
      </section>

      <section className="combustivel-dash-card">
        <h4 style={{ background: COR_HEADER }}>Km percorrido por litro combustível</h4>
        <p className="combustivel-dash-hint">
          {eixoHint} Km/litros (TIPOHORIMETRO = K) e Litros/hora (TIPOHORIMETRO = H).
        </p>
        <div className="combustivel-dash-canvas combustivel-dash-canvas--tall">
          {seriesKm.length ? (
            <canvas ref={eficienciaRef} />
          ) : (
            <p className="lead">Sem dados de eficiência no filtro selecionado.</p>
          )}
        </div>
      </section>

      <section className="combustivel-dash-card">
        <h4 style={{ background: COR_HEADER }}>Km percorrido por frota e grupo</h4>
        <p className="combustivel-dash-hint">
          {eixoHint} Soma de km rodado e de horas.
        </p>
        <div className="combustivel-dash-canvas combustivel-dash-canvas--tall">
          {seriesKm.length ? (
            <canvas ref={kmRef} />
          ) : (
            <p className="lead">Sem dados de km/horas no filtro selecionado.</p>
          )}
        </div>
      </section>
    </div>
  );
}
