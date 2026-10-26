import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import {
  lubrificacaoSituacaoLabel,
  type LubrificacaoDashboardData,
  type LubrificacaoMensal,
  type LubrificacaoPonto,
  type LubrificacaoPorTipo,
  type LubrificacaoResumoFrota,
} from "../../lib/lubrificacao";
import { ConsultaProgressBar } from "../ConsultaProgressBar";
import { useReportAutoRefresh } from "./useReportAutoRefresh";
import "./lubrificacao.css";

type View = "controle" | "eficiencia";

const fmt = (n: number | null | undefined, digits = 2) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

const MESES = [
  { value: "", label: "Todos" },
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Março" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
];

const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

function SituacaoCell({ ponto }: { ponto: LubrificacaoPonto }) {
  const label = lubrificacaoSituacaoLabel(ponto.situacao);
  if (ponto.situacao === "vencido") {
    return <span className="lub-situacao-vencido">{label}</span>;
  }
  return <>{label}</>;
}

function DonutChart({ value, title = "Eficiência Lubrificação" }: { value: number | null; title?: string }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const rest = 100 - pct;
  return (
    <div className="lub-donut-wrap">
      <h4>{title}</h4>
      <div
        className="lub-donut"
        role="img"
        aria-label={`Eficiência ${fmt(pct, 0)}%`}
        style={{
          background: `conic-gradient(#e6b800 0 ${pct}%, #4eb5e8 ${pct}% ${pct + rest * 0.85}%, #053768 ${pct + rest * 0.85}% 100%)`,
        }}
      >
        <div>
          <strong>{value == null ? "—" : `${fmt(pct, 0)}%`}</strong>
        </div>
      </div>
    </div>
  );
}

function EstimadoRealizadoChart({
  rows,
  ano,
  mes,
  onAno,
  onMes,
  allMonths = false,
}: {
  rows: LubrificacaoMensal[];
  ano: number;
  mes: string;
  onAno: (v: number) => void;
  onMes: (v: string) => void;
  allMonths?: boolean;
}) {
  const visibleRows = allMonths ? rows : rows.filter((row) => {
    if (mes) return row.mes === `${ano}-${String(mes).padStart(2, "0")}`;
    return true;
  });
  const max = Math.max(1, ...visibleRows.flatMap((r) => [r.estimado, r.realizado]));
  const years = useMemo(() => {
    const set = new Set(rows.map((r) => Number(r.mes.slice(0, 4))));
    set.add(ano);
    return [...set].sort((a, b) => b - a);
  }, [rows, ano]);

  return (
    <div className="lub-panel">
      <div className="lub-chart-head">
        <div>
          <h4>Estimado x Realizado</h4>
          {allMonths ? <small className="lub-chart-sub">Dias estimados e realizados por mês</small> : null}
        </div>
        <div className="lub-chart-filters">
          <label>
            Ano
            <select value={String(ano)} onChange={(e) => onAno(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          {!allMonths ? (
            <label>
              Mês
              <select value={mes} onChange={(e) => onMes(e.target.value)}>
                {MESES.map((m) => (
                  <option key={m.value || "all"} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>
      <div className="lub-legend">
        <span>
          <i className="estimado" /> Estimado (dias)
        </span>
        <span>
          <i className="realizado" /> Realizado (dias)
        </span>
      </div>
      {visibleRows.length ? (
        <div className="lub-bars">
          {visibleRows.map((row) => (
            <div
              className="lub-bar-col"
              key={row.mes}
              title={`${row.label}: estimado ${fmt(row.estimado, 1)} dias, realizado ${fmt(row.realizado, 0)} dias em ${fmt(row.lancamentos, 0)} lançamentos`}
            >
              <div className="lub-bar-group">
                <div className="lub-bar estimado" style={{ height: `${Math.max(2, (row.estimado / max) * 100)}%` }}>
                  <strong>{fmt(row.estimado, 1)}</strong>
                </div>
                <div className="lub-bar realizado" style={{ height: `${Math.max(2, (row.realizado / max) * 100)}%` }}>
                  <strong>{fmt(row.realizado, 0)}</strong>
                </div>
              </div>
              <span>{row.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="lub-empty">Nenhum registro de lubrificação no período selecionado.</div>
      )}
    </div>
  );
}

function KpiCards({ estimado, realizado, lancamentos }: { estimado: number; realizado: number; lancamentos: number }) {
  return (
    <div className="lub-kpi-cards">
      <div className="lub-kpi-card">
        <strong>{fmt(estimado, 0)}</strong>
        <span>Dias estimados</span>
      </div>
      <div className="lub-kpi-card">
        <strong>{fmt(realizado, 0)}</strong>
        <span>Dias realizados</span>
        <small>{fmt(lancamentos, 0)} lançamentos realizados</small>
      </div>
    </div>
  );
}

function CalendarioLubrificacao({ ano, mes, dias }: { ano: number; mes: number; dias: LubrificacaoResumoFrota["calendario"] }) {
  const firstDay = new Date(ano, mes - 1, 1);
  const daysInMonth = new Date(ano, mes, 0).getDate();
  const startOffset = (firstDay.getDay() + 6) % 7;
  const byDay = useMemo(() => new Map(dias.map((d) => [d.dia, d.quantidade])), [dias]);
  const cells: Array<{ day: number | null; qty: number }> = [];
  for (let i = 0; i < startOffset; i++) cells.push({ day: null, qty: 0 });
  for (let day = 1; day <= daysInMonth; day++) cells.push({ day, qty: byDay.get(day) ?? 0 });

  return (
    <div className="lub-panel lub-calendar-panel">
      <div className="lub-chart-head">
        <h4>{MESES.find((m) => m.value === String(mes))?.label ?? `Mês ${mes}`} / {ano}</h4>
      </div>
      <div className="lub-calendar">
        <div className="lub-calendar-weekdays">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="lub-calendar-grid">
          {cells.map((cell, idx) => (
            <div
              key={idx}
              className={`lub-calendar-day${cell.qty > 0 ? " has-data" : ""}${cell.day == null ? " is-empty" : ""}`}
              title={cell.day ? `${cell.day}: ${cell.qty} lubrificação(ões)` : undefined}
            >
              {cell.day ?? ""}
              {cell.qty > 0 ? <em>{cell.qty}</em> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TipoEquipamentoChart({ rows }: { rows: LubrificacaoPorTipo[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.estimado, r.realizado]));
  if (!rows.length) return <div className="lub-empty">Sem dados por tipo de equipamento.</div>;

  return (
    <div className="lub-panel lub-tipo-panel">
      <div className="lub-chart-head">
        <div>
          <h4>Tipo equipamento</h4>
          <small className="lub-chart-sub">Estimado x Realizado</small>
        </div>
      </div>
      <div className="lub-legend">
        <span>
          <i className="estimado" /> dias estimados
        </span>
        <span>
          <i className="realizado" /> dias com lubrificação
        </span>
      </div>
      <div className="lub-tipo-bars">
        {rows.map((row) => (
          <div className="lub-tipo-row" key={row.tipo} title={`${row.tipo}: estimado ${fmt(row.estimado, 1)} dias, realizado ${fmt(row.realizado, 0)} dias`}>
            <span>{row.tipo}</span>
            <div>
              <div className="lub-tipo-track">
                <i className="estimado" style={{ width: `${Math.max(1, (row.estimado / max) * 100)}%` }} />
                <b>{fmt(row.estimado, 1)}</b>
              </div>
              <div className="lub-tipo-track">
                <i className="realizado" style={{ width: `${Math.max(1, (row.realizado / max) * 100)}%` }} />
                <b>{fmt(row.realizado, 0)}</b>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EficienciaDashboard({
  resumo,
  ano,
  mesCalendario,
  onAno,
}: {
  resumo: LubrificacaoResumoFrota;
  ano: number;
  mesCalendario: number;
  onAno: (v: number) => void;
}) {
  return (
    <div className="lub-efi-dashboard">
      <div className="lub-efi-top">
        <section className="lub-panel lub-efi-donut-panel">
          <DonutChart value={resumo.eficiencia} />
        </section>
        <KpiCards
          estimado={resumo.quantidadeEstimada}
          realizado={resumo.quantidadeRealizada}
          lancamentos={resumo.quantidadeLancamentos}
        />
        <CalendarioLubrificacao ano={ano} mes={mesCalendario} dias={resumo.calendario} />
      </div>
      <div className="lub-efi-bottom">
        <EstimadoRealizadoChart
          rows={resumo.mensal}
          ano={ano}
          mes=""
          onAno={onAno}
          onMes={() => undefined}
          allMonths
        />
        <TipoEquipamentoChart rows={resumo.porTipo} />
      </div>
    </div>
  );
}

export function IndicadoresLubrificacao() {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const [view, setView] = useState<View>("controle");
  const [codEquipamento, setCodEquipamento] = useState("");
  const [ano, setAno] = useState(currentYear);
  const [mes, setMes] = useState("");
  const [data, setData] = useState<LubrificacaoDashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mesCalendario = mes ? Number(mes) : currentMonth;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api.indicadoresLubrificacao({
        codEquipamento: codEquipamento || undefined,
        ano,
        mes: mesCalendario,
      });
      setData(payload);
      if (!codEquipamento && payload.codEquipamento != null) {
        setCodEquipamento(String(payload.codEquipamento));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [codEquipamento, ano, mesCalendario]);

  useEffect(() => {
    void load();
  }, [load]);

  useReportAutoRefresh(load);

  const equipOptions = data?.equipamentos ?? [];
  const pontosVisiveis = useMemo(
    () => (data?.pontos ?? []).filter((p) => p.dataUltmTroca),
    [data?.pontos],
  );
  const resumoFrota = data?.resumoFrota ?? {
    eficiencia: null,
    quantidadeEstimada: 0,
    quantidadeLancamentos: 0,
    quantidadeRealizada: 0,
    mensal: [],
    porTipo: [],
    calendario: [],
  };

  return (
    <div className="lub-root">
      <div className="lub-tabs no-print">
        <button type="button" className={view === "controle" ? "active" : ""} onClick={() => setView("controle")}>
          Controle por equipamento
        </button>
        <button type="button" className={view === "eficiencia" ? "active" : ""} onClick={() => setView("eficiencia")}>
          Eficiência lubrificação
        </button>
      </div>

      <div className="lub-toolbar no-print">
        <small>
          {data ? `Atualizado em ${new Date(data.atualizadoEm).toLocaleString("pt-BR")}` : "Consultando Oracle…"}
          <button type="button" className="ghost" disabled={loading} onClick={() => void load()}>
            {loading ? "Atualizando…" : "Atualizar"}
          </button>
        </small>
      </div>

      <ConsultaProgressBar active={loading} label="Consultando lubrificação…" className="consulta-progress--compact" />
      {error ? (
        <div role="alert" className="lub-alert-error">
          Não foi possível atualizar: {error}
          {data ? ". Os dados anteriores continuam exibidos." : ""}
        </div>
      ) : null}

      {view === "eficiencia" ? (
        <div className="lub-dashboard">
          <div className="lub-topbar">
            <div className="lub-filters">
              <label>
                Ano
                <select value={String(ano)} onChange={(e) => setAno(Number(e.target.value))}>
                  {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Mês calendário
                <select value={String(mesCalendario)} onChange={(e) => setMes(e.target.value)}>
                  {MESES.filter((m) => m.value).map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="lub-logo-wrap">
              <img src="/elejota-agro-logo.png" alt="Elejota Agro" className="lub-logo" />
            </div>
          </div>
          <EficienciaDashboard resumo={resumoFrota} ano={ano} mesCalendario={mesCalendario} onAno={setAno} />
        </div>
      ) : (
        <div className="lub-dashboard">
          <div className="lub-topbar">
            <div className="lub-filters">
              <label>
                Equipamento
                <select value={codEquipamento} onChange={(e) => setCodEquipamento(e.target.value)}>
                  {!equipOptions.length ? <option value="">Carregando…</option> : null}
                  {equipOptions.map((eq) => (
                    <option key={eq.codEquipamento} value={String(eq.codEquipamento)}>
                      {eq.codEquipamento}
                    </option>
                  ))}
                </select>
              </label>
              <div className="lub-km-atual">
                <span>Km Atual</span>
                <strong>{fmt(data?.kmAtual ?? null)}</strong>
              </div>
            </div>
            <div className="lub-logo-wrap">
              <img src="/elejota-agro-logo.png" alt="Elejota Agro" className="lub-logo" />
            </div>
          </div>

          <section className="lub-panel lub-panel-main">
            <div className="lub-table-scroll">
              <table className="lub-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Descrição</th>
                    <th className="num">Ultm Hrs/ Km Troca</th>
                    <th className="num">Limite Troca</th>
                    <th className="num">Hrs/km Rodada</th>
                    <th>Data ultm troca</th>
                    <th className="num">Tempo Médio (Dias)</th>
                    <th>Data Estimada</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {pontosVisiveis.map((p) => (
                    <tr key={p.codigo}>
                      <td>{p.codigo}</td>
                      <td>{p.descricao}</td>
                      <td className="num">{fmt(p.ultmKmHrTroca)}</td>
                      <td className="num">{fmt(p.limiteTroca)}</td>
                      <td className="num">{fmt(p.kmHrRodado)}</td>
                      <td>{fmtDate(p.dataUltmTroca)}</td>
                      <td className="num">{fmt(p.tempoMedioDias, 0)}</td>
                      <td>{fmtDate(p.dataEstimada)}</td>
                      <td>
                        <SituacaoCell ponto={p} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && !pontosVisiveis.length ? (
                <div className="lub-empty">Nenhum ponto de lubrificação com histórico para o equipamento.</div>
              ) : null}
            </div>
          </section>

          <div className="lub-grid-mid">
            <section className="lub-panel">
              <div className="lub-table-scroll tall">
                <table className="lub-table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Descrição</th>
                      <th>Descrição material</th>
                      <th className="num">Quantidade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.materiais ?? []).map((m, i) => (
                      <tr key={`${m.codigo}-${m.materialDescricao}-${i}`}>
                        <td>{m.codigo}</td>
                        <td>{m.descricao}</td>
                        <td>{m.materialDescricao}</td>
                        <td className="num">{fmt(m.quantidade)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!loading && !(data?.materiais.length ?? 0) ? <div className="lub-empty">Sem materiais vinculados.</div> : null}
              </div>
            </section>
            {data?.alerta ? <div className="lub-alerta">{data.alerta}</div> : null}
          </div>

          <div className="lub-charts">
            <section className="lub-panel">
              <DonutChart value={data?.eficiencia ?? null} />
            </section>
            <EstimadoRealizadoChart rows={data?.mensal ?? []} ano={ano} mes={mes} onAno={setAno} onMes={setMes} />
          </div>
        </div>
      )}
    </div>
  );
}
