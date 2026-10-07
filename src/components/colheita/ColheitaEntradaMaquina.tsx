import { useState } from "react";
import { api, type ColheitaMaquinaRow } from "../../api";
import { formatQty } from "../../lib/format";
import { ColheitaFiltros, useColheitaPeriod } from "./ColheitaFiltros";
import { cell, formatOrdsDate } from "./colheita-utils";

export function ColheitaEntradaMaquina() {
  const { dataInicio, dataFim, setPeriod } = useColheitaPeriod();
  const [busca, setBusca] = useState("");
  const [rows, setRows] = useState<ColheitaMaquinaRow[]>([]);
  const [resumo, setResumo] = useState<{ totalLinhas?: number; pesoTotal?: number; truncado?: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setErr(null);
      const data = await api.colheitaEntradaMaquina({ dataInicio, dataFim, busca: busca.trim() || undefined });
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
      <p className="lead">Consulta entradas de cana por máquina gravadas na ORDS (ENTRADACANAMAQUINA).</p>
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
          <div className="kpi"><span>Peso total (t)</span><strong>{formatQty(resumo.pesoTotal ?? 0)}</strong></div>
        </div>
      ) : null}
      {resumo?.truncado ? <p className="lead" style={{ color: "var(--warn, #b8860b)" }}>Lista truncada pelo limite de registros.</p> : null}
      {rows.length ? (
        <section className="panel">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Máquina</th><th>Cód. equip.</th><th>Data colheita</th><th>Fazenda</th><th>Talhão</th>
                  <th>Tipo colheita</th><th>Tipo cana</th><th>Safra</th><th>Peso</th><th>Imp. mineral</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{cell(r.maquina)}</td><td>{cell(r.codEquipamento)}</td><td>{formatOrdsDate(r.dataColheita)}</td>
                    <td>{cell(r.fazenda)}</td><td>{cell(r.talhao)}</td><td>{cell(r.tipoColheita)}</td><td>{cell(r.tipoCana)}</td>
                    <td>{cell(r.safra)}</td><td>{cell(r.peso)}</td><td>{cell(r.impMineral)}</td>
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
