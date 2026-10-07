import { useMemo, useState } from "react";
import { ConsultaProgressBar } from "../ConsultaProgressBar";
import { useApp } from "../../store";
import { safraDefaultRange } from "./colheita-utils";

interface Props {
  dataInicio: string;
  dataFim: string;
  onChange: (next: { dataInicio: string; dataFim: string }) => void;
  busca?: string;
  onBuscaChange?: (v: string) => void;
  showBusca?: boolean;
  children?: React.ReactNode;
  onConsultar: () => void;
  loading?: boolean;
}

export function ColheitaFiltros({
  dataInicio,
  dataFim,
  onChange,
  busca,
  onBuscaChange,
  showBusca,
  children,
  onConsultar,
  loading,
}: Props) {
  const { safra } = useApp();
  const defaults = useMemo(() => safraDefaultRange(safra?.code), [safra?.code]);

  return (
    <section className="panel no-print">
      <h3>Filtros</h3>
      <div className="form-grid">
        <label>
          Data inicial
          <input type="date" value={dataInicio || defaults.from} onChange={(e) => onChange({ dataInicio: e.target.value, dataFim })} />
        </label>
        <label>
          Data final
          <input type="date" value={dataFim || defaults.to} onChange={(e) => onChange({ dataInicio, dataFim: e.target.value })} />
        </label>
        {showBusca ? (
          <label className="span-2">
            Busca
            <input value={busca ?? ""} onChange={(e) => onBuscaChange?.(e.target.value)} placeholder="Pesagem, guia, caminhão, fazenda…" />
          </label>
        ) : null}
        {children}
      </div>
      <div className="modal-actions" style={{ padding: "0 16px 16px" }}>
        <button className="btn primary" disabled={loading} onClick={onConsultar}>
          {loading ? "Consultando…" : "Consultar"}
        </button>
      </div>
      <ConsultaProgressBar active={!!loading} className="consulta-progress--compact" />
    </section>
  );
}

export function useColheitaPeriod() {
  const { safra } = useApp();
  const defaults = useMemo(() => safraDefaultRange(safra?.code), [safra?.code]);
  const [dataInicio, setDataInicio] = useState(defaults.from);
  const [dataFim, setDataFim] = useState(defaults.to);
  return { dataInicio, dataFim, setPeriod: (d: { dataInicio: string; dataFim: string }) => {
    setDataInicio(d.dataInicio);
    setDataFim(d.dataFim);
  } };
}
