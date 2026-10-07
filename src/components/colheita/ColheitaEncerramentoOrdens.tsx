import { useMemo, useState } from "react";
import { api, type ColheitaEncerramentoOrdensResult } from "../../api";
import { useApp } from "../../store";
import { ColheitaFiltros, useColheitaPeriod } from "./ColheitaFiltros";

export function ColheitaEncerramentoOrdens() {
  const { authUser } = useApp();
  const { dataInicio, dataFim, setPeriod } = useColheitaPeriod();
  const [dataEncerramento, setDataEncerramento] = useState(() => new Date().toISOString().slice(0, 10));
  const [obsEncerramento, setObsEncerramento] = useState("Encerrado");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ColheitaEncerramentoOrdensResult | null>(null);

  const usuarioSugerido = useMemo(() => {
    const base = (authUser?.nome || authUser?.email || "SISTEMA").toUpperCase().replace(/\s+/g, "");
    return base || "SISTEMA";
  }, [authUser?.email, authUser?.nome]);

  const encerrar = async () => {
    if (!dataInicio || !dataFim || !dataEncerramento) {
      setErr("Informe data inicial, data final e data de encerramento.");
      return;
    }
    const msg =
      `Encerrar ordens sem encerramento de ${dataInicio} até ${dataFim}?` +
      `\nData encerramento: ${dataEncerramento}` +
      `\nUsuário: ${usuarioSugerido}`;
    if (!window.confirm(msg)) return;
    try {
      setLoading(true);
      setErr(null);
      const next = await api.colheitaEncerrarOrdens({
        dataInicio,
        dataFim,
        dataEncerramento,
        obsEncerramento,
        usuarioEncerramento: usuarioSugerido,
      });
      setResult(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ColheitaFiltros dataInicio={dataInicio} dataFim={dataFim} onChange={setPeriod} loading={loading} onConsultar={() => void encerrar()}>
        <label>
          Data encerramento
          <input type="date" value={dataEncerramento} onChange={(e) => setDataEncerramento(e.target.value)} />
        </label>
        <label className="span-2">
          Observação
          <input value={obsEncerramento} onChange={(e) => setObsEncerramento(e.target.value)} maxLength={120} />
        </label>
      </ColheitaFiltros>

      {err ? <p className="lead" style={{ color: "var(--danger)" }}>{err}</p> : null}
      {result ? (
        <section className="panel">
          <h3>Resultado do encerramento</h3>
          <div className="kpis">
            <div className="kpi">
              <span>Linhas alteradas</span>
              <strong>{result.resumo.linhasAlteradas}</strong>
            </div>
            <div className="kpi">
              <span>Período data_ordem</span>
              <strong>{result.filtros.dataInicio} a {result.filtros.dataFim}</strong>
            </div>
            <div className="kpi">
              <span>Data encerramento</span>
              <strong>{result.filtros.dataEncerramento}</strong>
            </div>
            <div className="kpi">
              <span>Usuário</span>
              <strong>{result.filtros.usuarioEncerramento}</strong>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
