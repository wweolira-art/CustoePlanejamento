import type { PremiseOption } from "../api";

export function ReportFilter({
  caption,
  options,
  selected,
  onChange,
}: {
  caption: string;
  options: PremiseOption[];
  selected: string[];
  onChange: (keys: string[]) => void;
}) {
  if (!options.length) return null;
  const all = selected.length === 0;

  return (
    <div className="kind-toggle filter-toggle">
      <span className="toggle-caption">{caption}</span>
      <button
        type="button"
        className={`btn ${all ? "primary" : ""}`}
        aria-pressed={all}
        onClick={() => onChange([])}
      >
        Todos
      </button>
      {options.map((item) => {
        const on = selected.includes(item.key);
        return (
          <button
            key={item.key}
            type="button"
            className={`btn ${on ? "primary" : ""}`}
            aria-pressed={on}
            onClick={() => {
              if (all) {
                onChange([item.key]);
                return;
              }
              if (on) {
                onChange(selected.filter((key) => key !== item.key));
                return;
              }
              onChange([...selected, item.key]);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
