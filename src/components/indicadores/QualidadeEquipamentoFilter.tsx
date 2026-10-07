import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type QualidadeEquipamentoOpcao = {
  codEquipamento: number;
  label: string;
};

type PanelPos = { top: number; left: number; width: number };

export function QualidadeEquipamentoFilter({
  opcoes,
  selected,
  onChange,
  disabled,
}: {
  opcoes: QualidadeEquipamentoOpcao[];
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return opcoes;
    return opcoes.filter(
      (eq) => String(eq.codEquipamento).includes(q) || eq.label.toLowerCase().includes(q),
    );
  }, [busca, opcoes]);

  const todosSelecionados = !selected.size || selected.size === opcoes.length;
  const filtroAtivo = selected.size > 0 && selected.size < opcoes.length;
  const resumo = !opcoes.length
    ? "Consulte o período"
    : todosSelecionados
      ? "Todos os equipamentos"
      : selected.size === 1
        ? opcoes.find((eq) => selected.has(eq.codEquipamento))?.label ?? "1 equipamento"
        : `${selected.size} de ${opcoes.length} selecionados`;

  function updatePanelPos() {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 16);
    let left = rect.left;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    if (left < 8) left = 8;
    setPanelPos({
      top: rect.bottom + 6,
      left,
      width,
    });
  }

  useLayoutEffect(() => {
    if (!open) return;
    updatePanelPos();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onReposition() {
      updatePanelPos();
    }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  function isIncluded(cod: number) {
    return !selected.size || selected.has(cod);
  }

  function selectOnly(cod: number) {
    onChange(new Set([cod]));
  }

  function toggle(cod: number, checked: boolean) {
    if (checked) {
      if (!selected.size) return;
      const next = new Set(selected);
      next.add(cod);
      onChange(next.size === opcoes.length ? new Set() : next);
      return;
    }
    if (!selected.size) {
      onChange(new Set(opcoes.filter((eq) => eq.codEquipamento !== cod).map((eq) => eq.codEquipamento)));
      return;
    }
    const next = new Set(selected);
    next.delete(cod);
    onChange(next);
  }

  const panel =
    open && panelPos ? (
      <div
        ref={panelRef}
        className="indicadores-kpi-filter qualidade-equip-filter-panel qualidade-equip-filter-panel--portal"
        role="dialog"
        aria-label="Filtrar equipamentos"
        style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
      >
        <div className="indicadores-kpi-filter-head">
          <strong>Equipamentos</strong>
          <span className="indicadores-kpi-filter-count">{resumo}</span>
        </div>
        <input
          type="search"
          className="indicadores-kpi-filter-search"
          placeholder="Buscar código ou tag…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          autoFocus
        />
        <div className="indicadores-kpi-filter-actions">
          <button type="button" className="btn" onClick={() => onChange(new Set())}>
            Todos os equipamentos
          </button>
        </div>
        <ul className="indicadores-kpi-filter-list">
          {filtrados.map((eq) => (
            <li key={eq.codEquipamento}>
              <label className="indicadores-kpi-filter-item">
                <input
                  type="checkbox"
                  checked={isIncluded(eq.codEquipamento)}
                  onChange={(e) => toggle(eq.codEquipamento, e.target.checked)}
                />
                <span className="indicadores-kpi-filter-item-text">
                  <strong>{eq.codEquipamento}</strong>
                  <span>{eq.label}</span>
                </span>
              </label>
              <button
                type="button"
                className="qualidade-equip-filter-only-btn"
                onClick={() => selectOnly(eq.codEquipamento)}
                title={`Filtrar apenas ${eq.label}`}
              >
                Somente este
              </button>
            </li>
          ))}
          {!filtrados.length ? <li className="indicadores-kpi-filter-empty">Nenhum equipamento encontrado.</li> : null}
        </ul>
      </div>
    ) : null;

  return (
    <div className="qualidade-equip-filter-wrap" ref={wrapRef}>
      <label className="qualidade-equip-filter-label">
        Equipamento
        <button
          ref={btnRef}
          type="button"
          className={`btn qualidade-equip-filter-btn${filtroAtivo ? " is-active" : ""}`}
          onClick={() => setOpen((v) => !v)}
          disabled={disabled || !opcoes.length}
          aria-expanded={open}
        >
          {resumo}
        </button>
      </label>
      {panel ? createPortal(panel, document.body) : null}
    </div>
  );
}
