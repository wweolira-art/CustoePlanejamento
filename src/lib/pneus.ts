export type PneuItem = {
  id: number; numero: string; medida: string; tipo: string; categoria: string; marca: string;
  descarte: string | null; motivo: string; causa: string; equipamento: string; tipoEquipamento: string;
  colocado: string | null; montado: boolean; emReforma: boolean; vida: number; sulco: number | null;
  rodado: number | null; aquisicao: number | null; custo: number | null;
  posicao: string; eixo: string; posicaoDescricao: string; medicao: string | null;
};
export type PneuConserto = {
  pneuId: number; inicio: string | null; fim: string | null; reforma: boolean;
  recusado: boolean; valor: number; fornecedor: string; tipo: string;
};
export type PneusData = { pneus: PneuItem[]; consertos: PneuConserto[]; atualizadoEm: string };

export const pneusSum = (values: (number | null)[]) => values.reduce<number>((sum, n) => sum + (n ?? 0), 0);
export function pneusAverage(values: (number | null)[]) {
  const valid = values.filter((n): n is number => n != null && Number.isFinite(n));
  return valid.length ? pneusSum(valid) / valid.length : null;
}
// Do not turn a missing estimated price into a zero-cost tire.
export function pneusCost(items: PneuItem[]) {
  const valid = items.map((p) => p.custo).filter((n): n is number => n != null && Number.isFinite(n));
  return valid.length ? pneusSum(valid) : null;
}
export function pneusAverageCost(items: PneuItem[]) {
  return pneusAverage(items.map((p) => p.custo));
}
export function pneusCostPerDistance(items: PneuItem[]) {
  const valid = items.filter((p) => p.custo != null && p.rodado != null);
  const cost = pneusCost(valid);
  const distance = pneusSum(valid.map((p) => p.rodado));
  return cost != null && distance > 0 ? cost / distance : null;
}

/**
 * Custo de reposição do pneu (mesmo critério do descarte: família 32 por medida).
 * Fallback para valor de aquisição quando o custo estimado não existe.
 */
export function pneusCustoReposicao(p: Pick<PneuItem, "custo" | "aquisicao"> | null | undefined): number | null {
  if (!p) return null;
  if (p.custo != null && Number.isFinite(p.custo)) return p.custo;
  if (p.aquisicao != null && Number.isFinite(p.aquisicao)) return p.aquisicao;
  return null;
}

/**
 * Economia de reformar em vez de comprar: Σ custo reposição − Σ valor reforma.
 * Retorna null se faltar custo de reposição em algum pneu do conjunto.
 */
export function pneusEconomiaReforma(
  items: { custoReposicao: number | null; valorReforma: number }[],
): { compra: number | null; reforma: number; economia: number | null } {
  const reforma = pneusSum(items.map((i) => i.valorReforma));
  if (!items.length) return { compra: null, reforma: 0, economia: null };
  const costs = items.map((i) => i.custoReposicao);
  if (costs.some((c) => c == null)) return { compra: null, reforma, economia: null };
  const compra = pneusSum(costs);
  return { compra, reforma, economia: compra - reforma };
}

/** Durabilidade de um pneu = km/hrs rodado ÷ quantidade de vidas. */
export function pneusDurabilidade(p: Pick<PneuItem, "rodado" | "vida">): number | null {
  if (p.rodado == null || !Number.isFinite(p.rodado) || !(p.vida > 0)) return null;
  return p.rodado / p.vida;
}

/**
 * Durabilidade agregada = Σ km_rodado / Σ vidas (ponderada).
 * Omite pneus sem rodado ou com vida ≤ 0.
 */
export function pneusDurabilidadeMedia(items: Pick<PneuItem, "rodado" | "vida">[]): number | null {
  const valid = items.filter((p) => p.rodado != null && Number.isFinite(p.rodado) && p.vida > 0);
  if (!valid.length) return null;
  const km = pneusSum(valid.map((p) => p.rodado));
  const vidas = pneusSum(valid.map((p) => p.vida));
  return vidas > 0 ? km / vidas : null;
}

export function pneusInPeriod(date: string | null, from: string, to: string) {
  return Boolean(date && (!from || date >= from) && (!to || date <= to));
}
/** Dias entre envio e retorno do conserto (inclusive). */
export function pneusDeliveryDays(inicio: string | null, fim: string | null) {
  if (!inicio || !fim) return null;
  const start = new Date(`${inicio}T12:00:00`);
  const end = new Date(`${fim}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return days >= 0 ? days : null;
}
