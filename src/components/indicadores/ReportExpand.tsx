import { useContext, useEffect, useState, type ReactNode } from "react";
import { ReportExpandedContext, useReportAutoRefresh } from "./useReportAutoRefresh";

export function ReportExpand({
  title,
  children,
  className,
  onRefresh,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  onRefresh?: () => void | Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  const parentExpanded = useContext(ReportExpandedContext);
  useReportAutoRefresh(() => onRefresh?.(), expanded);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [expanded]);

  return (
    <ReportExpandedContext.Provider value={expanded || parentExpanded}>
    <div className={`indicadores-report-expand${expanded ? " is-expanded" : ""}${className ? ` ${className}` : ""}`}>
      <div className="indicadores-report-expand-toolbar no-print">
        <button
          type="button"
          className={`btn${expanded ? "" : " primary"}`}
          onClick={() => setExpanded((current) => !current)}
          title={expanded ? "Sair da tela ampliada (Esc)" : "Ampliar relatório em tela cheia"}
        >
          {expanded ? "Fechar ampliação" : "Ampliar relatório"}
        </button>
        {expanded ? <span>Atualização automática a cada 30 min</span> : null}
      </div>
      {expanded ? (
        <header className="indicadores-report-expand-brand">
          <img src="/elejota-agro-logo.png" alt="Elejota Agro" className="liberacao-colheita-logo" />
          <h2>{title}</h2>
        </header>
      ) : null}
      <div className="indicadores-report-expand-body">{children}</div>
    </div>
    </ReportExpandedContext.Provider>
  );
}
