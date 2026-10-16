// Diagnóstico somente leitura. Não importa server/db.ts, que executa seeds/migrações.
import Database from "better-sqlite3";
import { resolve } from "node:path";

const database = new Database(resolve("data/planejamento.db"), { readonly: true, fileMustExist: true });
try {
  const tables = new Set((database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
  const counts: Record<string, number> = {};
  for (const table of ["safras", "sheets", "categories", "lines", "line_months", "materials", "activities", "cost_objects", "fazendas", "calc_params", "premissa_values", "line_safra_prices", "safra_kpis"]) {
    if (tables.has(table)) counts[table] = (database.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n;
  }
  const current = tables.has("meta")
    ? database.prepare("SELECT value FROM meta WHERE key = 'current_safra_id'").get() as { value: string } | undefined
    : undefined;
  const safra = current && tables.has("safras")
    ? database.prepare("SELECT id, code, label FROM safras WHERE id = ?").get(current.value)
    : null;
  const missingFormulaCache = tables.has("line_months")
    ? database.prepare("SELECT count(*) AS n FROM line_months WHERE trim(coalesce(formula, '')) <> '' AND (value IS NULL OR trim(value) = '')").get() as { n: number }
    : { n: 0 };
  console.log(JSON.stringify({
    mode: "somente leitura; nenhum dado foi enviado",
    currentSafra: safra,
    monthOrder: "setembro a agosto",
    counts,
    formulasWithoutCachedValue: missingFormulaCache.n,
    notes: [
      "lines e line_months não possuem safra_id: não copiar seus valores para todas as safras.",
      "Fórmulas e agrupamentos precisam ser conferidos com o motor de cálculo atual.",
      "As demais tabelas SQLite também devem ser mapeadas antes de desativar o armazenamento local.",
    ],
  }, null, 2));
} finally {
  database.close();
}
