import { useId, useRef, useState, type ReactNode } from "react";

export function FiltroSuspenso({ titulo, valor, children }: { titulo: string; valor: string; children: ReactNode }) {
  const id = useId();
  const popup = useRef<HTMLDivElement>(null);
  const [posicao, setPosicao] = useState({ top: 0, left: 0, width: 260 });
  return <div className="custo-filtro-individual">
    <button type="button" className="custo-filtro-botao" popoverTarget={id} onClick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 24);
      setPosicao({ top: Math.min(rect.bottom + 6, window.innerHeight - 260), left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), width });
    }}>
      <span><small>{titulo}</small><strong>{valor}</strong></span><span aria-hidden="true">▾</span>
    </button>
    <div id={id} ref={popup} popover="auto" className="custo-filtro-popup" style={posicao} onChange={(event) => {
      if (event.target instanceof HTMLSelectElement && !event.target.multiple) popup.current?.hidePopover();
    }}>
      {children}
      <button type="button" className="btn" onClick={() => popup.current?.hidePopover()}>Concluir</button>
    </div>
  </div>;
}
