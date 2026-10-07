import { useEffect, useState } from "react";

/** Progresso simulado (0–92%) enquanto a consulta está ativa; completa em 100% ao terminar. */
export function useConsultaProgress(active: boolean) {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) return;
    setVisible(true);
    setProgress(0);
    const start = Date.now();
    const tick = window.setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(92, 92 * (1 - Math.exp(-elapsed / 12000))));
    }, 80);
    return () => window.clearInterval(tick);
  }, [active]);

  useEffect(() => {
    if (active || !visible) return;
    setProgress(100);
    const hide = window.setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 420);
    return () => window.clearTimeout(hide);
  }, [active, visible]);

  const pct = Math.round(progress);
  return { progress: pct, visible: visible || active };
}

type Props = {
  active: boolean;
  label?: string;
  className?: string;
};

export function ConsultaProgressBar({ active, label = "Consultando dados…", className }: Props) {
  const { progress, visible } = useConsultaProgress(active);
  if (!visible) return null;

  const restante = Math.max(0, 100 - progress);

  return (
    <div
      className={`consulta-progress no-print${className ? ` ${className}` : ""}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress}
      aria-label={label}
    >
      <div className="consulta-progress-head">
        <span>{label}</span>
        <strong>{progress}%</strong>
      </div>
      <div className="consulta-progress-track">
        <i style={{ width: `${progress}%` }} />
      </div>
      <small className="consulta-progress-hint">
        {progress >= 92 ? "Finalizando…" : `Aproximadamente ${restante}% restante`}
      </small>
    </div>
  );
}
