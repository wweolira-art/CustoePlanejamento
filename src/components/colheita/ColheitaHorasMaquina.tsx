import { useState } from "react";
import { api, type ColheitaHorasRow } from "../../api";
import { ColheitaFiltros, useColheitaPeriod } from "./ColheitaFiltros";
import { cell, formatOrdsDate } from "./colheita-utils";

export function ColheitaHorasMaquina() {
  const { dataInicio, dataFim, setPeriod } = useColheitaPeriod();
  const [busca, setBusca] = useState("");
  const [rows, setRows] = useState<ColheitaHorasRow[]>([]);
  const [resumo, setResumo] = useState<{ totalLinhas?: number; qtdEquipamentos?: number; truncado?: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setErr(null);
      const data = await api.colheitaHorasMaquina({ dataInicio, dataFim, busca: busca.trim() || undefined });
      setRows(data.dados);
      setResumo(data.resumo);
    } catch (e) {
      setRows([]);
      setResumo(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <p className="lead">Consulta horas de motor e elevador por equipamento (ORDS HORASMOTORELEVADOR).</p>
      <ColheitaFiltros
        dataInicio={dataInicio}
        dataFim={dataFim}
        onChange={setPeriod}
        busca={busca}
        onBuscaChange={setBusca}
        showBusca
        loading={loading}
        onConsultar={() => void load()}
      />
      {err ? <p className="lead" style={{ color: "var(--danger)" }}>{err}</p> : null}
      {resumo ? (
        <div className="kpis">
          <div className="kpi"><span>Registros</span><strong>{resumo.totalLinhas ?? rows.length}</strong></div>
          <div className="kpi"><span>Equipamentos</span><strong>{resumo.qtdEquipamentos ?? 0}</strong></div>
        </div>
      ) : null}
      {rows.length ? (
        <section className="panel">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>ID</th><th>Data</th><th>Cód. equipamento</th><th>Turno</th><th>Hora motor</th><th>Horas elevador</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{cell(r.id)}</td><td>{formatOrdsDate(r.data)}</td><td>{cell(r.codEquipamento)}</td>
                    <td>{cell(r.turno)}</td><td>{cell(r.horaMotor)}</td><td>{cell(r.horasElevador)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
