import { useEffect, useMemo, useState } from "react";
import { api, type ParadasColheitaData } from "../../api";

function fmt2(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmt0(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
}

function fmtHorasClock(h: number | null | undefined) {
  if (h == null || !Number.isFinite(h) || h <= 0) return "0:00";
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = String(Math.abs(totalMin % 60)).padStart(2, "0");
  return `${hh}:${mm}`;
}

function fmtDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  dataInicio: string;
  dataFim: string;
  consultarToken: number;
  onLoadingChange?: (loading: boolean) => void;
};

export function ParadasColheitaSection({ dataInicio, dataFim, consultarToken, onLoadingChange }: Props) {
  const [data, setData] = useState<ParadasColheitaData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [consultado, setConsultado] = useState(false);
  const [motivoFiltro, setMotivoFiltro] = useState("");

  useEffect(() => {
    if (!consultarToken) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        onLoadingChange?.(true);
        setErr(null);
        const result = await api.indicadoresParadasColheita({ dataInicio, dataFim });
        if (cancelled) return;
        setData(result);
        setConsultado(true);
        setMotivoFiltro("");
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
    // Consulta só ao clicar em Consultar (token).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataInicio/dataFim deliberadamente fora
  }, [consultarToken, onLoadingChange]);

  const eventos = useMemo(() => {
    const rows = data?.eventos ?? [];
    if (!motivoFiltro) return rows;
    return rows.filter((row) => row.motivo === motivoFiltro);
  }, [data, motivoFiltro]);

  const horasFiltradas = useMemo(() => eventos.reduce((acc, row) => acc + row.horas, 0), [eventos]);
  const maxHoras = Math.max(...(data?.motivos.map((row) => row.horas) ?? [0]), 0.01);
  const horasTotal = data?.resumo.horasTotal ?? 0;

  if (!consultado && !loading) {
    return <p className="lead">Consulte o período para ver as paradas da colheita.</p>;
  }

  return (
    <>
      {err ? (
        <p className="lead" style={{ color: "var(--danger)" }}>
          {err}
        </p>
      ) : null}

      <div className="kpis">
        <div className="kpi">
          <span>Paradas</span>
          <strong>{fmt0(motivoFiltro ? eventos.length : data?.resumo.qtd)}</strong>
        </div>
        <div className="kpi">
          <span>Motivos</span>
          <strong>{fmt0(data?.resumo.qtdMotivos)}</strong>
        </div>
        <div className="kpi">
          <span>Horas paradas</span>
          <strong>{fmtHorasClock(motivoFiltro ? horasFiltradas : horasTotal)}</strong>
        </div>
      </div>

      <section className="panel indicadores-tabela-panel relatorio-diario-parada-panel">
        <h3 className="indicadores-tabela-title">MOTIVOS DE PARADAS</h3>
        {data?.motivos.length ? (
          <div className="relatorio-diario-parada-bars">
            {data.motivos.map((row) => (
              <div
                key={row.motivo}
                className="relatorio-diario-parada-row"
                title={`${row.motivo}: ${fmtHorasClock(row.horas)} · ${row.qtd} paradas`}
              >
                <span>{row.motivo}</span>
                <div>
                  <i style={{ width: `${(row.horas / maxHoras) * 100}%` }} />
                  <b>
                    {fmtHorasClock(row.horas)}
                    <small>{horasTotal > 0 ? ` ${fmt2((row.horas / horasTotal) * 100)}%` : ""}</small>
                  </b>
                </div>
              </div>
            ))}
            <p className="relatorio-diario-parada-total">Horas totais: {fmtHorasClock(horasTotal)}</p>
          </div>
        ) : (
          <p className="lead">Sem paradas no período.</p>
        )}
      </section>

      <section className="panel indicadores-tabela-panel">
        <h3 className="indicadores-tabela-title">REGISTROS</h3>
        <div className="horas-motor-filter no-print" style={{ padding: "10px 12px 0" }}>
          <label>
            Motivo
            <select value={motivoFiltro} disabled={loading || !data?.motivos.length} onChange={(e) => setMotivoFiltro(e.target.value)}>
              <option value="">Todos</option>
              {(data?.motivos ?? []).map((row) => (
                <option key={row.motivo} value={row.motivo}>
                  {row.motivo}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrap">
          {eventos.length ? (
            <table className="data indicadores-producao-table">
              <thead>
                <tr>
                  <th>Motivo</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th className="num">Horas</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((row, index) => (
                  <tr key={`${row.id ?? row.inicio}-${index}`}>
                    <td>{row.motivo}</td>
                    <td>{fmtDateTime(row.inicio)}</td>
                    <td>{fmtDateTime(row.fim)}</td>
                    <td className="num">{fmtHorasClock(row.horas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="lead">Nenhum registro no período.</p>
          )}
        </div>
      </section>
    </>
  );
}
