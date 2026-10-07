import { useState } from "react";
import { api, type ColheitaCaminhaoRow } from "../../api";
import { formatQty } from "../../lib/format";
import { ColheitaFiltros, useColheitaPeriod } from "./ColheitaFiltros";
import { cell, formatOrdsDate } from "./colheita-utils";

export function ColheitaEntradaCaminhao() {
  const { dataInicio, dataFim, setPeriod } = useColheitaPeriod();
  const [busca, setBusca] = useState("");
  const [rows, setRows] = useState<ColheitaCaminhaoRow[]>([]);
  const [resumo, setResumo] = useState<{ totalLinhas?: number; pesoLiquidoTotal?: number; truncado?: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setErr(null);
      const data = await api.colheitaEntradaCaminhao({ dataInicio, dataFim, busca: busca.trim() || undefined });
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
      <p className="lead">Consulta entradas de cana por caminhão gravadas na ORDS (ENTRADACANACAMINHAO).</p>
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
          <div className="kpi"><span>Peso líquido (t)</span><strong>{formatQty(resumo.pesoLiquidoTotal ?? 0)}</strong></div>
        </div>
      ) : null}
      {resumo?.truncado ? <p className="lead" style={{ color: "var(--warn, #b8860b)" }}>Lista truncada pelo limite de registros.</p> : null}
      {rows.length ? (
        <section className="panel">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Pesagem</th><th>Guia</th><th>Caminhão</th><th>Cód. equip.</th><th>Data</th><th>Fazenda</th>
                  <th>Talhão</th><th>Etapa</th><th>Tipo colheita</th><th>Safra</th><th>Bruto</th><th>Tara</th><th>Líquido</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{cell(r.pesagem)}</td><td>{cell(r.guia)}</td><td>{cell(r.caminhao)}</td><td>{cell(r.codEquipamento)}</td>
                    <td>{formatOrdsDate(r.data)}</td><td>{cell(r.fazenda)}</td><td>{cell(r.talhao)}</td><td>{cell(r.etapa)}</td>
                    <td>{cell(r.tipoColheita)}</td><td>{cell(r.safra)}</td><td>{cell(r.pesoBruto)}</td><td>{cell(r.pesoTara)}</td><td>{cell(r.pesoLiquido)}</td>
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
