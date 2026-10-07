import { db } from "./db.js";
import { oracleDate, oracleNumber, withOracle } from "./oracle.js";

export interface MaterialLastPrice {
  code: string;
  price: number;
  count: number;
  prices: number[];
  dates: (string | null)[];
  costPrice: number | null;
  date: string | null;
  invoice: number | null;
  quantity: number | null;
}

export async function lastMaterialEntryPrice(materialId: number): Promise<MaterialLastPrice> {
  const material = db.prepare("SELECT id, code, tipo FROM materials WHERE id = ?").get(materialId) as
    | { id: number; code: string; tipo: string }
    | undefined;
  if (!material) throw new Error("Material não encontrado.");
  if (material.tipo !== "E") throw new Error("A média dos preços de entrada vale só para material tipo E.");
  const code = material.code.trim();
  const codeNumber = Number(code.replace(",", "."));
  if (!Number.isFinite(codeNumber)) {
    throw new Error("O código do material precisa ser numérico para consultar o Oracle.");
  }

  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT * FROM (
         SELECT i.cod_material,
                i.valorunitario,
                i.valorcustounitario,
                i.dataentrada_seq,
                i.nrnf,
                i.quantidade
           FROM material.itensentrada i
          WHERE i.cod_material = :cod
            AND i.valorunitario IS NOT NULL
            AND i.valorunitario > 0
          ORDER BY i.dataentrada_seq DESC NULLS LAST, i.sequencia_nf DESC NULLS LAST, i.item DESC
       )
       WHERE ROWNUM <= 3`,
      { cod: codeNumber },
    );
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    const prices: number[] = [];
    const dates: (string | null)[] = [];
    const costPrices: number[] = [];
    for (const row of rows) {
      const price = oracleNumber(row, "valorunitario");
      if (price == null || !(price > 0)) continue;
      prices.push(price);
      dates.push(oracleDate(row, "dataentrada_seq"));
      const cost = oracleNumber(row, "valorcustounitario");
      if (cost != null && cost > 0) costPrices.push(cost);
    }
    if (!prices.length) throw new Error("Não há entrada com preço para este material.");
    const avg = prices.reduce((sum, n) => sum + n, 0) / prices.length;
    const first = rows[0];
    return {
      code,
      price: avg,
      count: prices.length,
      prices,
      dates,
      costPrice: costPrices.length ? costPrices.reduce((sum, n) => sum + n, 0) / costPrices.length : null,
      date: dates[0] ?? null,
      invoice: first ? oracleNumber(first, "nrnf") : null,
      quantity: first ? oracleNumber(first, "quantidade") : null,
    };
  });
}
