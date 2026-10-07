export const formatBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n || 0);

/** Interpreta valor digitado ou exibido com R$, pontos e vírgulas. */
export function parseMoneyInput(raw: string) {
  let s = raw.trim();
  if (!s) return NaN;
  s = s.replace(/\s/g, "").replace(/^R\$/i, "");
  if (/,\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/\./g, "").replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export const formatQty = (n: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(n || 0);

export const formatNum = (n: number) => {
  if (!n) return "—";
  if (Math.abs(n) >= 1000) return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n);
};
