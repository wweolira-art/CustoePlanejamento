const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

export const toExcelSerial = (d: Date): number =>
  (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - EXCEL_EPOCH_MS) / 86400000;

export const fromExcelSerial = (n: number): Date => {
  const ms = EXCEL_EPOCH_MS + Math.round(n) * 86400000;
  return new Date(ms);
};

export const parseIsoDate = (iso: string): Date => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export const excelDate = (year: number, month: number, day: number): Date => {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d;
};

export const eomonth = (start: Date, months: number): Date => {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + months + 1;
  return new Date(Date.UTC(y, m, 0));
};

const PT_MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export const formatExcelText = (value: Date | number, pattern: string): string => {
  const d = value instanceof Date ? value : fromExcelSerial(value);
  const p = pattern.replace(/"/g, "").toLowerCase();
  if (p === "mmmm") return PT_MONTHS[d.getUTCMonth()] ?? "";
  if (p === "mmm") return (PT_MONTHS[d.getUTCMonth()] ?? "").slice(0, 3);
  if (p === "mm") return String(d.getUTCMonth() + 1).padStart(2, "0");
  if (p === "yyyy") return String(d.getUTCFullYear());
  if (p === "dd") return String(d.getUTCDate()).padStart(2, "0");
  return d.toISOString().slice(0, 10);
};

export const asDate = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v === "number" && Number.isFinite(v) && v > 20000 && v < 80000) {
    return fromExcelSerial(v);
  }
  return null;
};
