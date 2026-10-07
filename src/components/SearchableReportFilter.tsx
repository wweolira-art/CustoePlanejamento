import { useEffect, useMemo, useRef, useState } from "react";
import type { PremiseOption } from "../api";

type Props = {
  caption: string;
  options: PremiseOption[];
  selected: string[];
  onChange: (keys: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
};

export function SearchableReportFilter({
  caption,
  options,
  selected,
  onChange,
  placeholder = "Buscar atividade…",
  emptyLabel = "Todas",
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.key.toLowerCase().includes(q),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!options.length) return null;

  const all = selected.length === 0;

  const toggle = (key: string) => {
    if (all) {
      onChange([key]);
      return;
    }
    if (selected.includes(key)) {
      onChange(selected.filter((item) => item !== key));
      return;
    }
    onChange([...selected, key]);
  };

  return (
    <div className="kind-toggle filter-toggle report-search-filter">
      <span className="toggle-caption">{caption}</span>
      <button
        type="button"
        className={`btn ${all ? "primary" : ""}`}
        aria-pressed={all}
        onClick={() => {
          onChange([]);
          setQuery("");
          setOpen(false);
        }}
      >
        {emptyLabel}
      </button>
      <div className="report-search-combo combo" ref={wrapRef}>
        <input
          type="search"
          className="combo-input report-search-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          aria-expanded={open}
          aria-label={`${caption} — buscar`}
        />
        {open ? (
          filtered.length ? (
            <div className="combo-list report-search-list" role="listbox" aria-label={caption}>
              {filtered.map((item) => {
                const on = selected.includes(item.key);
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={`combo-item ${on ? "selected" : ""}`}
                    onClick={() => toggle(item.key)}
                  >
                    <span>{on ? "✓ " : ""}{item.label}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="combo-empty report-search-empty">Nenhum resultado para &quot;{query}&quot;</div>
          )
        ) : null}
      </div>
      {!all ? (
        <span className="report-search-summary">
          {selected.length} selecionada(s)
        </span>
      ) : null}
    </div>
  );
}
