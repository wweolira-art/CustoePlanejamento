import { useReportAutoRefresh } from "./useReportAutoRefresh";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConsultaProgressBar } from "../ConsultaProgressBar";
import { api } from "../../api";

const STORAGE_META_SEMANA = "indicadores-produtividade-meta-ton-semana";
const STORAGE_PREVISAO = "indicadores-produtividade-previsao-safra";
const STORAGE_SEMANA_FROM = "indicadores-produtividade-semana-from";
const STORAGE_SEMANA_TO = "indicadores-produtividade-semana-to";
const DEFAULT_META_SEMANA = 14_000;
const DEFAULT_PREVISAO = 300_000;
const META_PRODUTIVIDADE_DIA = 2_000;

function fmt0(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
}

function fmt2(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${fmt2(n)}%`;
}

function fmtPeriodShort(from: string | null | undefined, to: string | null | undefined) {
  if (!from || !to) return "—";
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${from} a ${to}`;
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit" };
  return `${a.toLocaleDateString("pt-BR", opts)}–${b.toLocaleDateString("pt-BR", opts)}`;
}

function fmtDayLabel(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function toIsoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function defaultWeekRange(end?: string | null) {
  const toDate = end ? new Date(`${end}T12:00:00`) : new Date();
  if (Number.isNaN(toDate.getTime())) {
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { from: toIsoDate(from), to: toIsoDate(today) };
  }
  const from = new Date(toDate);
  from.setDate(from.getDate() - 6);
  return { from: toIsoDate(from), to: toIsoDate(toDate) };
}

function readStoredNumber(key: string, fallback: number) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

function readStoredDate(key: string, fallback: string) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fallback;
    return raw;
  } catch {
    return fallback;
  }
}

function diasEntre(from: string, to: string) {
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 1;
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

function SemiGauge({
  pct,
  color,
}: {
  pct: number | null;
  color: string;
}) {
  const clamped = pct == null || !Number.isFinite(pct) ? 0 : Math.max(0, Math.min(100, pct));
  const r = 54;
  const c = 2 * Math.PI * r;
  const half = c / 2;
  const dash = (clamped / 100) * half;
  return (
    <svg className="prod-metas-gauge" viewBox="0 0 140 84" aria-hidden>
      <path
        d="M 16 70 A 54 54 0 0 1 124 70"
        fill="none"
        stroke="#dbe4f0"
        strokeWidth="14"
        strokeLinecap="round"
      />
      <path
        d="M 16 70 A 54 54 0 0 1 124 70"
        fill="none"
        stroke={color}
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${half}`}
      />
    </svg>
  );
}

export function ProdutividadeMetasCards({
  safraLabel,
  defaultWeekEnd,
  safraDataInicio,
  safraDataFim,
  maquinasColhedoras = 0,
}: {
  safraLabel?: string | null;
  defaultWeekEnd?: string | null;
  safraDataInicio?: string | null;
  safraDataFim?: string | null;
  maquinasColhedoras?: number;
}) {
  const initialWeek = useMemo(() => defaultWeekRange(defaultWeekEnd), [defaultWeekEnd]);
  const [semanaFrom, setSemanaFrom] = useState(() =>
    readStoredDate(STORAGE_SEMANA_FROM, initialWeek.from),
  );
  const [semanaTo, setSemanaTo] = useState(() => readStoredDate(STORAGE_SEMANA_TO, initialWeek.to));
  const [draftFrom, setDraftFrom] = useState(semanaFrom);
  const [draftTo, setDraftTo] = useState(semanaTo);
  const [filtroAberto, setFiltroAberto] = useState(false);
  const [metaSemana, setMetaSemana] = useState(() =>
    readStoredNumber(STORAGE_META_SEMANA, DEFAULT_META_SEMANA),
  );
  const [previsaoSafra, setPrevisaoSafra] = useState(() =>
    readStoredNumber(STORAGE_PREVISAO, DEFAULT_PREVISAO),
  );
  const [semanaToneladas, setSemanaToneladas] = useState<
    Array<{ data: string; toneladas: number; previsao: number | null }> | null
  >(null);
  const [safraToneladas, setSafraToneladas] = useState<
    Array<{ data: string; toneladas: number; previsao: number | null }> | null
  >(null);
  const [loadingSemana, setLoadingSemana] = useState(false);
  const [loadingSafra, setLoadingSafra] = useState(false);
  const [errSemana, setErrSemana] = useState<string | null>(null);
  const [errSafra, setErrSafra] = useState<string | null>(null);
  const filtroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_META_SEMANA, String(metaSemana));
  }, [metaSemana]);

  useEffect(() => {
    localStorage.setItem(STORAGE_PREVISAO, String(previsaoSafra));
  }, [previsaoSafra]);

  useEffect(() => {
    localStorage.setItem(STORAGE_SEMANA_FROM, semanaFrom);
  }, [semanaFrom]);

  useEffect(() => {
    localStorage.setItem(STORAGE_SEMANA_TO, semanaTo);
  }, [semanaTo]);

  useEffect(() => {
    if (!filtroAberto) return;
    const onDoc = (e: MouseEvent) => {
      if (!filtroRef.current?.contains(e.target as Node)) setFiltroAberto(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [filtroAberto]);

  const loadSemana = useCallback(async (fromRaw: string, toRaw: string) => {
    const from = fromRaw <= toRaw ? fromRaw : toRaw;
    const to = fromRaw <= toRaw ? toRaw : fromRaw;
    try {
      setLoadingSemana(true);
      setErrSemana(null);
      const result = await api.indicadoresColheitaDiaria({
        dataInicio: from,
        dataFim: to,
        fonte: "colheitadiaria",
      });
      setSemanaToneladas(result.dados);
    } catch (e) {
      setSemanaToneladas(null);
      setErrSemana(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSemana(false);
    }
  }, []);

  const loadSafra = useCallback(async (fromRaw: string, toRaw: string) => {
    const from = fromRaw <= toRaw ? fromRaw : toRaw;
    const to = fromRaw <= toRaw ? toRaw : fromRaw;
    try {
      setLoadingSafra(true);
      setErrSafra(null);
      const result = await api.indicadoresColheitaDiaria({
        dataInicio: from,
        dataFim: to,
        fonte: "colheitadiaria",
      });
      setSafraToneladas(result.dados);
    } catch (e) {
      setSafraToneladas(null);
      setErrSafra(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSafra(false);
    }
  }, []);

  useEffect(() => {
    void loadSemana(semanaFrom, semanaTo);
  }, [loadSemana, semanaFrom, semanaTo]);

  useEffect(() => {
    if (!safraDataInicio || !safraDataFim) {
      setSafraToneladas(null);
      return;
    }
    void loadSafra(safraDataInicio, safraDataFim);
  }, [loadSafra, safraDataInicio, safraDataFim]);

  useReportAutoRefresh(() => {
    if (!loadingSemana) void loadSemana(semanaFrom, semanaTo);
    if (!loadingSafra && safraDataInicio && safraDataFim) void loadSafra(safraDataInicio, safraDataFim);
  });

  const aplicarFiltroSemana = () => {
    const from = draftFrom <= draftTo ? draftFrom : draftTo;
    const to = draftFrom <= draftTo ? draftTo : draftFrom;
    setSemanaFrom(from);
    setSemanaTo(to);
    localStorage.setItem(STORAGE_SEMANA_FROM, from);
    localStorage.setItem(STORAGE_SEMANA_TO, to);
    setFiltroAberto(false);
  };

  const abrirFiltro = () => {
    setDraftFrom(semanaFrom);
    setDraftTo(semanaTo);
    setFiltroAberto((v) => !v);
  };

  const tonSemana = useMemo(
    () => (semanaToneladas ? semanaToneladas.reduce((total, row) => total + row.toneladas, 0) : null),
    [semanaToneladas],
  );
  const tonSafra = useMemo(
    () => (safraToneladas ? safraToneladas.reduce((total, row) => total + row.toneladas, 0) : null),
    [safraToneladas],
  );

  const diasSemana = diasEntre(
    semanaFrom <= semanaTo ? semanaFrom : semanaTo,
    semanaFrom <= semanaTo ? semanaTo : semanaFrom,
  );
  const atingimento = tonSemana != null && metaSemana > 0 ? (tonSemana / metaSemana) * 100 : null;
  const atingimentoSafra =
    tonSafra != null && previsaoSafra > 0 ? (tonSafra / previsaoSafra) * 100 : null;

  const tonMaqDia = useMemo(() => {
    if (tonSemana == null || !(maquinasColhedoras > 0) || !(diasSemana > 0)) return null;
    return tonSemana / diasSemana / maquinasColhedoras;
  }, [tonSemana, diasSemana, maquinasColhedoras]);

  const produtividadeDiaria = useMemo(
    () => semanaToneladas ?? [],
    [semanaToneladas],
  );
  const mediaProdutividadeDia = produtividadeDiaria.length
    ? produtividadeDiaria.reduce((total, row) => total + row.toneladas, 0) / produtividadeDiaria.length
    : null;
  const maiorProdutividadeDia = produtividadeDiaria.reduce(
    (maior, row) => Math.max(maior, row.toneladas),
    META_PRODUTIVIDADE_DIA,
  );
  const escalaProdutividadeDia = maiorProdutividadeDia * 1.12;

  const semanaLabel = fmtPeriodShort(
    semanaFrom <= semanaTo ? semanaFrom : semanaTo,
    semanaFrom <= semanaTo ? semanaTo : semanaFrom,
  );
  const safraTitulo = safraLabel?.replace(/^Safra\s+/i, "") || "safra";

  return (
    <section className="panel prod-metas-panel">
      <h3>Produtividade e metas (semana e safra)</h3>
      {errSemana ? (
        <p className="lead" style={{ color: "var(--danger)" }}>
          Semana: {errSemana}
        </p>
      ) : null}
      {errSafra ? (
        <p className="lead" style={{ color: "var(--danger)" }}>
          Acumulado safra: {errSafra}
        </p>
      ) : null}

      <div className="prod-metas-grid">
        <article className="prod-metas-card">
          <div className="prod-metas-card-head" ref={filtroRef}>
            <p className="prod-metas-card-title">Semana ({semanaLabel})</p>
            <button
              type="button"
              className={`prod-metas-filter-btn${filtroAberto ? " is-open" : ""}`}
              aria-label="Filtrar período da semana"
              title="Filtrar semana"
              aria-expanded={filtroAberto}
              onClick={abrirFiltro}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
                <path
                  fill="currentColor"
                  d="M3 5h18l-7 8v5l-4 2v-7L3 5z"
                />
              </svg>
            </button>
            {filtroAberto ? (
              <div className="prod-metas-filter-popover" role="dialog" aria-label="Período da semana">
                <label>
                  Início
                  <input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} />
                </label>
                <label>
                  Fim
                  <input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="btn primary"
                  disabled={loadingSemana || !draftFrom || !draftTo}
                  onClick={aplicarFiltroSemana}
                >
                  {loadingSemana ? "Consultando…" : "Aplicar e salvar"}
                </button>
                <ConsultaProgressBar active={loadingSemana} label="Consultando produção da semana…" className="consulta-progress--compact" />
              </div>
            ) : null}
          </div>
          <SemiGauge pct={atingimento} color="#3b82f6" />
          <strong className="prod-metas-value">
            {tonSemana == null ? (loadingSemana ? "…" : "—") : `${fmt0(tonSemana)} Toneladas`}
          </strong>
          <label className="prod-metas-meta-field">
            Meta da semana
            <input
              type="number"
              min={1}
              step={100}
              value={metaSemana}
              onChange={(e) => setMetaSemana(Number(e.target.value) || DEFAULT_META_SEMANA)}
            />
            <span>{fmt0(metaSemana)}t na semana ({diasSemana} dia{diasSemana === 1 ? "" : "s"})</span>
          </label>
          <p className="prod-metas-sub">Atingimento: {fmtPct(atingimento)}</p>
        </article>

        <article className="prod-metas-card">
          <SemiGauge pct={atingimentoSafra} color="#1e3a5f" />
          <p className="prod-metas-card-title">Acumulado safra {safraTitulo}</p>
          <strong className="prod-metas-value">
            {tonSafra == null ? (loadingSafra ? "…" : "—") : `${fmt0(tonSafra)} Toneladas`}
          </strong>
          <label className="prod-metas-meta-field">
            Previsão
            <input
              type="number"
              min={1}
              step={1000}
              value={previsaoSafra}
              onChange={(e) => setPrevisaoSafra(Number(e.target.value) || DEFAULT_PREVISAO)}
            />
            <span>t na safra</span>
          </label>
          <p className="prod-metas-sub">Atingimento: {fmtPct(atingimentoSafra)}</p>
        </article>

        <article className="prod-metas-card prod-metas-card-wide">
          <div className="prod-metas-maq">
            <span className="prod-metas-maq-icon" aria-hidden>
              <svg viewBox="0 0 64 40" width="56" height="36">
                <rect x="18" y="14" width="28" height="14" rx="3" fill="#1a7f37" />
                <rect x="8" y="18" width="12" height="8" rx="2" fill="#15803d" />
                <circle cx="22" cy="32" r="6" fill="#14532d" />
                <circle cx="44" cy="32" r="6" fill="#14532d" />
                <rect x="40" y="8" width="10" height="10" rx="2" fill="#84cc16" />
              </svg>
            </span>
            <div>
              <strong className="prod-metas-value">{fmt2(tonMaqDia)}</strong>
              <p className="prod-metas-sub">
                Toneladas por máquina/dia
                <br />
                <span>(média diária na semana)</span>
              </p>
            </div>
          </div>
        </article>

        <article className="prod-metas-card prod-metas-card-wide prod-metas-daily-card">
          <div className="prod-metas-daily-head">
            <div>
              <p className="prod-metas-card-title">Acompanhamento diário</p>
              <p className="prod-metas-sub">Produção por dia no período selecionado</p>
              <p className="prod-metas-daily-legend">
                <span className="prod-metas-daily-legend-item"><i className="is-realizado" /> Realizado</span>
                <span className="prod-metas-daily-legend-item"><i className="is-previsao" /> Previsão</span>
              </p>
            </div>
            <strong className="prod-metas-daily-target">Meta: {fmt0(META_PRODUTIVIDADE_DIA)} t/dia</strong>
          </div>
          {produtividadeDiaria.length ? (
            <div className="prod-metas-daily-chart-wrap">
              <svg
                className="prod-metas-daily-chart"
                viewBox="0 0 1600 230"
                role="img"
                aria-label={`Produção diária comparada à meta de ${fmt0(META_PRODUTIVIDADE_DIA)} toneladas`}
              >
                <line
                  className="prod-metas-daily-target-line"
                  x1="54"
                  x2="1546"
                  y1={190 - (META_PRODUTIVIDADE_DIA / escalaProdutividadeDia) * 160}
                  y2={190 - (META_PRODUTIVIDADE_DIA / escalaProdutividadeDia) * 160}
                />
                {produtividadeDiaria.map((row, index) => {
                  const slotWidth = 1492 / produtividadeDiaria.length;
                  const barWidth = Math.max(8, slotWidth * 0.62);
                  const barHeight = (row.toneladas / escalaProdutividadeDia) * 160;
                  const x = 54 + index * slotWidth + (slotWidth - barWidth) / 2;
                  const y = 190 - barHeight;
                  return (
                    <g key={row.data}>
                      <rect
                        className={`prod-metas-daily-bar${row.toneladas >= META_PRODUTIVIDADE_DIA ? " is-on-target" : ""}`}
                        x={x}
                        y={Math.max(30, y)}
                        width={barWidth}
                        height={Math.max(0, barHeight)}
                        rx="4"
                      />
                      <text className="prod-metas-daily-value" x={x + barWidth / 2} y={Math.max(24, y - 6)}>
                        {fmt0(row.toneladas)}
                      </text>
                      <text className="prod-metas-daily-label" x={x + barWidth / 2} y="212">
                        {fmtDayLabel(row.data)}
                      </text>
                    </g>
                  );
                })}
                <polyline
                  className="prod-metas-daily-forecast-line"
                  points={produtividadeDiaria
                    .map((row, index) => {
                      const slotWidth = 1492 / produtividadeDiaria.length;
                      const x = 54 + index * slotWidth + slotWidth / 2;
                      const value = row.previsao ?? 0;
                      const y = 190 - (value / escalaProdutividadeDia) * 160;
                      return `${x},${Math.max(30, y)}`;
                    })
                    .join(" ")}
                />
              </svg>
            </div>
          ) : (
            <p className="prod-metas-daily-empty">{loadingSemana ? "Carregando produção diária…" : "Sem produção registrada no período."}</p>
          )}
          <p className="prod-metas-sub prod-metas-daily-summary">
            Média diária: <strong>{fmt0(mediaProdutividadeDia)} t</strong>
            <span> • </span>
            Dias na meta: <strong>{produtividadeDiaria.filter((row) => row.toneladas >= META_PRODUTIVIDADE_DIA).length}/{produtividadeDiaria.length}</strong>
          </p>
        </article>
      </div>
    </section>
  );
}
