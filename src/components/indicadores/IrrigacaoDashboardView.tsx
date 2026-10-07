import { useMemo } from "react";
import type { IrrigacaoDashboardBloco, IrrigacaoDashboardData } from "../../api";

function fmtMm(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function fmtHa(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} há`;
}

function Gauge({ value }: { value: number | null }) {
  const pct = value != null && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  const r = 42;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <div className="irrig-dash-gauge">
      <svg viewBox="0 0 120 120" aria-hidden>
        <circle cx="60" cy="60" r={r} className="irrig-dash-gauge-track" />
        <circle
          cx="60"
          cy="60"
          r={r}
          className="irrig-dash-gauge-value"
          strokeDasharray={`${dash} ${c - dash}`}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="irrig-dash-gauge-label">
        <strong>{fmtPct(value)}</strong>
        <span>EFICIÊNCIA OPERACIONAL</span>
      </div>
    </div>
  );
}

function MmChart({ meses, compact }: { meses: IrrigacaoDashboardBloco["meses"]; compact?: boolean }) {
  const visible = meses.filter((m) => m.mmRealizado != null || m.mmProgramado != null);
  if (!visible.length) return <p className="irrig-empty">Sem dados mensais.</p>;
  const max = Math.max(
    ...visible.flatMap((m) => [m.mmRealizado ?? 0, m.mmProgramado ?? 0]),
    1,
  );
  return (
    <div className={`irrig-dash-chart${compact ? " is-compact" : ""}`}>
      {visible.map((m) => {
        const progH = ((m.mmProgramado ?? 0) / max) * 100;
        const realH = ((m.mmRealizado ?? 0) / max) * 100;
        const tone =
          m.atingiuMeta == null ? "" : m.atingiuMeta ? "is-ok" : "is-bad";
        return (
          <div key={m.key} className="irrig-dash-chart-col">
            <div className="irrig-dash-chart-bars">
              <div className="irrig-dash-bar is-prog" style={{ height: `${progH}%` }} title={`Programado ${fmtMm(m.mmProgramado)}`}>
                {m.mmProgramado != null ? <em>{fmtMm(m.mmProgramado)}</em> : null}
              </div>
              <div className={`irrig-dash-bar is-real ${tone}`} style={{ height: `${realH}%` }}>
                {m.mmRealizado != null ? <em>{fmtMm(m.mmRealizado)}</em> : null}
              </div>
            </div>
            <span>{m.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function BlocoTitulo({ titulo }: { titulo: string }) {
  const parts = titulo.match(/^(SISTEMA)\s+(.+)$/i);
  if (!parts) return <h3>{titulo}</h3>;
  return (
    <h3>
      {parts[1].toUpperCase()} <strong>{parts[2].toUpperCase()}</strong>
    </h3>
  );
}

function DispTable({ meses, total }: { meses: IrrigacaoDashboardBloco["meses"]; total: number | null }) {
  const withDisp = meses.filter((m) => m.disponibilidade != null);
  if (!withDisp.length && total == null) return null;
  return (
    <div className="irrig-dash-disp-table">
      <div className="irrig-dash-disp-title">EFICIÊNCIA OPERACIONAL</div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {meses.map((m) => (
                <th key={m.key} className="num">
                  {m.label}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {meses.map((m) => (
                <td key={m.key} className="num">
                  {fmtPct(m.disponibilidade)}
                </td>
              ))}
              <td className="num">
                <strong>{fmtPct(total)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Bloco({
  bloco,
  showGauge,
  systemLayout,
}: {
  bloco: IrrigacaoDashboardBloco;
  showGauge?: boolean;
  systemLayout?: boolean;
}) {
  return (
    <section className={`irrig-dash-bloco${systemLayout ? " is-system" : ""}`}>
      <header className="irrig-dash-bloco-head">
        <BlocoTitulo titulo={bloco.titulo} />
      </header>
      <div className={`irrig-dash-bloco-body${showGauge ? " has-gauge" : ""}${systemLayout ? " is-system" : ""}`}>
        {showGauge ? <Gauge value={bloco.eficienciaOperacional} /> : null}
        <div className="irrig-dash-metrics">
          <div className="irrig-dash-metric">
            <span>ACUMULADO SAFRA</span>
            <strong>
              {fmtMm(bloco.mmAcumuladoSafra)} <small>mm/há</small>
            </strong>
            <em>PROJETADO {fmtMm(bloco.mmProjetadoSafra)} mm/há</em>
          </div>
          <div className="irrig-dash-metric">
            <span>ACUMULADO MÊS</span>
            <strong>
              {fmtMm(bloco.mmAcumuladoMes)} <small>mm/há</small>
            </strong>
            <em>PROJETADO {fmtMm(bloco.mmProjetadoMes)} mm/há</em>
          </div>
        </div>
        <div className="irrig-dash-chart-wrap">
          <MmChart meses={bloco.meses} compact={!showGauge} />
        </div>
      </div>
      {!showGauge && bloco.areaHa != null ? (
        <div className="irrig-dash-area">{fmtHa(bloco.areaHa)}</div>
      ) : null}
      {showGauge ? <DispTable meses={bloco.meses} total={bloco.eficienciaOperacional} /> : null}
    </section>
  );
}

export function IrrigacaoDashboardView({
  data,
  sistemasSelecionados,
  onToggleSistema,
}: {
  data: IrrigacaoDashboardData;
  sistemasSelecionados: string[];
  onToggleSistema: (id: string) => void;
}) {
  const blocosSistema = data.sistemasBlocos ?? [];
  const legend = useMemo(
    () => (
      <div className="irrig-dash-legend">
        <span>
          <i className="is-prog" /> Programado
        </span>
        <span>
          <i className="is-ok" /> Atingiu Meta
        </span>
        <span>
          <i className="is-bad" /> Abaixo da Meta
        </span>
      </div>
    ),
    [],
  );

  return (
    <div className="irrig-dash">
      <div className="irrig-dash-toolbar no-print">
        <div className="irrig-dash-sistemas">
          {data.sistemas.map((s) => {
            const active = sistemasSelecionados.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                className={`irrig-dash-chip${active ? " is-active" : ""}`}
                onClick={() => onToggleSistema(s.id)}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        {legend}
      </div>

      <div className="irrig-dash-section">
        {blocosSistema.length ? <h4>Dashboard geral e por campo</h4> : null}
        <Bloco bloco={data.geral} showGauge />
        {data.campos.map((campo) => (
          <Bloco key={campo.id} bloco={campo} />
        ))}
      </div>

      {blocosSistema.length ? (
        <div className="irrig-dash-section">
          <h4>Dashboard por sistema</h4>
          {blocosSistema.map((bloco) => (
            <Bloco key={bloco.id} bloco={bloco} systemLayout />
          ))}
        </div>
      ) : null}
    </div>
  );
}
