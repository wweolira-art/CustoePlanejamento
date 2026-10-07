export function normalizePeriodoColheita(dataInicio: string, dataFim: string) {
  const iniMatch = dataInicio.match(/^(\d{4})-09-01$/);
  const fimMatch = dataFim.match(/^(\d{4})-09-01$/);
  if (iniMatch && fimMatch && Number(fimMatch[1]) === Number(iniMatch[1]) + 1) {
    return { from: dataInicio, to: `${fimMatch[1]}-08-31` };
  }
  return { from: dataInicio, to: dataFim };
}

export function safraDefaultRange(code?: string) {
  const match = code?.match(/^(\d{2})\//);
  const startYear = match ? (Number(match[1]) >= 90 ? 1900 + Number(match[1]) : 2000 + Number(match[1])) : new Date().getFullYear();
  const from = `${startYear}-09-01`;
  const safraEnd = `${startYear + 1}-08-31`;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  let to = todayStr;
  if (todayStr < from) to = from;
  else if (todayStr > safraEnd) to = safraEnd;
  return { from, to };
}

export function formatOrdsDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("pt-BR");
}

export function formatPeriodoDias(inicio: string | null | undefined, fim: string | null | undefined) {
  if (!inicio && !fim) return "—";
  if (inicio && fim && inicio === fim) return formatOrdsDate(inicio);
  if (inicio && fim) return `${formatOrdsDate(inicio)} — ${formatOrdsDate(fim)}`;
  return formatOrdsDate(inicio ?? fim);
}

export function cell(v: unknown) {
  if (v == null || v === "") return "—";
  return String(v);
}
