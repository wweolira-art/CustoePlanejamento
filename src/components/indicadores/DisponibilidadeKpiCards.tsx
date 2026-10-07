import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IndicadoresColheitaProducaoData } from "../../api";

type KpiCard = IndicadoresColheitaProducaoData["resumo"]["kpiCards"][number];
type KpiEquip = KpiCard["equipamentos"][number];

const STORAGE_PREFIX = "indicadores-kpi-excluidos:";

function loadExcluded(cardId: string, equipamentos: KpiEquip[]) {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${cardId}`);
    if (!raw) return new Set<number>();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set<number>();
    const valid = new Set(equipamentos.map((e) => e.codEquipamento));
    return new Set(parsed.filter((v): v is number => typeof v === "number" && valid.has(v)));
  } catch {
    return new Set<number>();
  }
}

function saveExcluded(cardId: string, excluded: Set<number>) {
  localStorage.setItem(`${STORAGE_PREFIX}${cardId}`, JSON.stringify([...excluded]));
}

function computeStats(equipamentos: KpiEquip[], excluded: Set<number>) {
  const ativos = equipamentos.filter((e) => !excluded.has(e.codEquipamento));
  const parado = ativos.filter((e) => e.parado).length;
  const total = ativos.length;
  const rodando = total - parado;
  const disponibilidade = total ? Math.round(((rodando / total) * 100 + Number.EPSILON) * 100) / 100 : null;
  return { total, parado, rodando, disponibilidade };
}

function DonutGauge({ pct }: { pct: number | null }) {
  const value = pct ?? 0;
  const clamped = Math.max(0, Math.min(100, value));
  const baixa = pct != null && pct < 85;
  return (
    <div
      className="indicadores-kpi-donut"
      style={{
        background: `conic-gradient(${baixa ? "#c0392b" : "#1a7f37"} 0 ${clamped}%, #e5e7eb ${clamped}% 100%)`,
      }}
      role="img"
      aria-label={pct != null ? `Disponibilidade ${Math.round(pct)} por cento` : "Sem dados"}
    >
      <span className={`indicadores-kpi-donut-value${baixa ? " is-baixa" : ""}`}>
        {pct != null ? `${Math.round(pct)}%` : "—"}
      </span>
    </div>
  );
}

function StatusBar({ rodando, parado }: { rodando: number; parado: number }) {
  const total = rodando + parado;
  if (!total) {
    return (
      <div className="indicadores-kpi-bar indicadores-kpi-bar-empty">
        <span>0</span>
      </div>
    );
  }
  return (
    <div className="indicadores-kpi-bar">
      {rodando > 0 ? (
        <div className="indicadores-kpi-bar-rodando" style={{ flexGrow: rodando }}>
          <span>{rodando}</span>
        </div>
      ) : null}
      {parado > 0 ? (
        <div className="indicadores-kpi-bar-parado" style={{ flexGrow: parado }}>
          <span>{parado}</span>
        </div>
      ) : null}
    </div>
  );
}

function KpiEquipFilter({
  cardId,
  equipamentos,
  excluded,
  onChange,
  onClose,
}: {
  cardId: string;
  equipamentos: KpiEquip[];
  excluded: Set<number>;
  onChange: (next: Set<number>) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return equipamentos;
    return equipamentos.filter((e) => {
      const blob = `${e.codEquipamento} ${e.descricao ?? ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [busca, equipamentos]);

  const incluidos = equipamentos.length - excluded.size;

  function toggle(cod: number, checked: boolean) {
    const next = new Set(excluded);
    if (checked) next.delete(cod);
    else next.add(cod);
    onChange(next);
    saveExcluded(cardId, next);
  }

  function setAll(incluir: boolean) {
    const next = incluir ? new Set<number>() : new Set(equipamentos.map((e) => e.codEquipamento));
    onChange(next);
    saveExcluded(cardId, next);
  }

  return (
    <div className="indicadores-kpi-filter" ref={panelRef} role="dialog" aria-label="Filtrar equipamentos">
      <div className="indicadores-kpi-filter-head">
        <strong>Equipamentos na disponibilidade</strong>
        <span className="indicadores-kpi-filter-count">
          {incluidos}/{equipamentos.length} incluídos
        </span>
      </div>
      <input
        type="search"
        className="indicadores-kpi-filter-search"
        placeholder="Buscar código ou descrição…"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />
      <div className="indicadores-kpi-filter-actions">
        <button type="button" className="btn" onClick={() => setAll(true)}>
          Marcar todos
        </button>
        <button type="button" className="btn" onClick={() => setAll(false)}>
          Desmarcar todos
        </button>
      </div>
      <ul className="indicadores-kpi-filter-list">
        {filtrados.map((eq) => {
          const checked = !excluded.has(eq.codEquipamento);
          return (
            <li key={eq.codEquipamento}>
              <label className={`indicadores-kpi-filter-item${eq.parado ? " is-parado" : ""}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggle(eq.codEquipamento, e.target.checked)}
                />
                <span className="indicadores-kpi-filter-item-text">
                  <strong>{eq.codEquipamento}</strong>
                  <span>{eq.descricao?.trim() || "Sem descrição"}</span>
                  {eq.parado ? <em>OS aberta</em> : null}
                </span>
              </label>
            </li>
          );
        })}
        {!filtrados.length ? <li className="indicadores-kpi-filter-empty">Nenhum equipamento encontrado.</li> : null}
      </ul>
    </div>
  );
}

function KpiCardItem({ card }: { card: KpiCard }) {
  const equipamentos = card.equipamentos ?? [];
  const [filterOpen, setFilterOpen] = useState(false);
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    setExcluded(loadExcluded(card.id, equipamentos));
  }, [card.id, equipamentos]);

  const stats = useMemo(() => {
    if (!equipamentos.length) {
      return {
        total: card.total,
        parado: card.parado,
        rodando: card.rodando,
        disponibilidade: card.disponibilidade,
      };
    }
    return computeStats(equipamentos, excluded);
  }, [card, equipamentos, excluded]);
  const incluidos = equipamentos.length - excluded.size;
  const filtroAtivo = excluded.size > 0;

  const closeFilter = useCallback(() => setFilterOpen(false), []);

  return (
    <article className="indicadores-kpi-card">
      <header className="indicadores-kpi-header">
        <img
          className="indicadores-kpi-icon"
          src={`/indicadores/${card.icon}`}
          alt=""
          width={56}
          height={42}
        />
        <h4 className="indicadores-kpi-title">{card.label}</h4>
        {equipamentos.length ? (
          <div className="indicadores-kpi-filter-wrap">
            <button
              type="button"
              className={`btn indicadores-kpi-filter-btn${filtroAtivo ? " is-active" : ""}`}
              onClick={() => setFilterOpen((v) => !v)}
              title="Escolher equipamentos que entram no cálculo"
            >
              Filtrar{filtroAtivo ? ` (${incluidos}/${equipamentos.length})` : ""}
            </button>
            {filterOpen ? (
              <KpiEquipFilter
                cardId={card.id}
                equipamentos={equipamentos}
                excluded={excluded}
                onChange={setExcluded}
                onClose={closeFilter}
              />
            ) : null}
          </div>
        ) : null}
      </header>
      <div className="indicadores-kpi-body">
        <DonutGauge pct={stats.disponibilidade} />
      </div>
      <StatusBar rodando={stats.rodando} parado={stats.parado} />
    </article>
  );
}

export function DisponibilidadeKpiCards({ cards }: { cards: KpiCard[] }) {
  if (!cards.length) return null;
  return (
    <div className="indicadores-kpi-grid">
      {cards.map((card) => (
        <KpiCardItem key={card.id} card={card} />
      ))}
    </div>
  );
}
