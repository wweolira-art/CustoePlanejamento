import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ConsultaProgressBar } from "./ConsultaProgressBar";
import { useApp } from "../store";

const SafraLoadCtx = createContext<(() => void) | null>(null);

export function SafraLoadProvider({ active, children }: { active: boolean; children: ReactNode }) {
  const { safraSwitching, safraId } = useApp();
  const [viewLoading, setViewLoading] = useState(false);

  useEffect(() => {
    if (!active) {
      setViewLoading(false);
      return;
    }
    setViewLoading(true);
  }, [safraId, active]);

  const markSafraLoaded = useCallback(() => {
    setViewLoading(false);
  }, []);

  const showProgress = active && (safraSwitching || viewLoading);

  return (
    <SafraLoadCtx.Provider value={markSafraLoaded}>
      <ConsultaProgressBar
        active={showProgress}
        label="Carregando dados da safra…"
        className="consulta-progress--compact"
      />
      {children}
    </SafraLoadCtx.Provider>
  );
}

export function useSafraLoaded(ready: boolean) {
  const markSafraLoaded = useContext(SafraLoadCtx);
  useEffect(() => {
    if (ready) markSafraLoaded?.();
  }, [ready, markSafraLoaded]);
}
