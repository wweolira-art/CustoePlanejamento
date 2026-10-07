import type { IndicadoresColheitaProducaoData } from "../../api";

export type DispModo = "dia" | "mes" | "safra";

export type DispPoint = IndicadoresColheitaProducaoData["disponibilidadeDiaria"][number];

/** YYYY-MM → primeiro e último dia do mês (YYYY-MM-DD). */
export function monthRange(ym: string): { from: string; to: string } {
  const [ys, ms] = ym.split("-");
  const y = Number(ys);
  const m = Number(ms);
  if (!y || !m) return { from: ym, to: ym };
  const from = `${ys}-${ms}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${ys}-${ms}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

function aggBucket(days: Array<{ total: number; parado: number; rodando: number }>): DispPoint["colhedora"] {
  let total = 0;
  let parado = 0;
  for (const d of days) {
    total += d.total;
    parado += d.parado;
  }
  const rodando = total - parado;
  const disponibilidade = total ? Math.round(((rodando / total) * 100 + Number.EPSILON) * 100) / 100 : null;
  return { total, parado, rodando, disponibilidade };
}

function aggregateByMonth(series: DispPoint[]): DispPoint[] {
  const buckets = new Map<string, DispPoint[]>();
  for (const row of series) {
    const key = row.data.slice(0, 7);
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ym, rows]) => ({
      data: ym,
      colhedora: aggBucket(rows.map((r) => r.colhedora)),
      transbordo: aggBucket(rows.map((r) => r.transbordo)),
      toneladaColhida: rows.reduce((acc, r) => acc + (r.toneladaColhida ?? 0), 0),
    }));
}

export function aggregateDisponibilidade(
  series: DispPoint[],
  modo: DispModo,
  options: { safraLabel?: string; mesRef?: string } = {},
): DispPoint[] {
  if (!series.length) return [];

  if (modo === "dia") return series;

  if (modo === "mes") {
    const prefix = options.mesRef?.slice(0, 7);
    if (prefix) {
      return series.filter((row) => row.data.startsWith(prefix));
    }
    return aggregateByMonth(series);
  }

  if (modo === "safra") {
    const safraLabel = options.safraLabel ?? "Safra";
    return [
      {
        data: safraLabel,
        colhedora: aggBucket(series.map((r) => r.colhedora)),
        transbordo: aggBucket(series.map((r) => r.transbordo)),
        toneladaColhida: series.reduce((acc, r) => acc + (r.toneladaColhida ?? 0), 0),
      },
    ];
  }

  return series;
}

export function formatDispLabel(data: string, modo: DispModo) {
  if (modo === "safra") return data;
  if (modo === "mes" && /^\d{4}-\d{2}$/.test(data)) {
    const [y, m] = data.split("-");
    return `${m}/${y.slice(2)}`;
  }
  const d = new Date(`${data}T12:00:00`);
  if (Number.isNaN(d.getTime())) return data;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
