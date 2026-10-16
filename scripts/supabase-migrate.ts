import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildMigration, migrationMoney, type MigrationPayload } from "../server/supabase-migration.js";
import { supabaseRequest, supabaseConfig, type BudgetTable } from "../server/supabase.js";
import { loadEnvFile } from "../server/env.js";

loadEnvFile();
supabaseConfig();
const { directory } = JSON.parse(readFileSync(resolve("data/migrations/latest.json"), "utf8"));
const snapshot = JSON.parse(readFileSync(join(directory, "snapshot.json"), "utf8"));
const existing: MigrationPayload = {};
async function allRows(table: BudgetTable, select = "*", filter?: Record<string, string>) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await supabaseRequest<any[]>(table, { query: new URLSearchParams({ select, order: table === "orcamento_item_meses" ? "item_id,competencia" : "id", limit: "500", offset: String(offset), ...filter }) });
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

try {
  for (const table of ["safras", "centros_custo", "categorias", "materiais", "atividades", "objetos_custo", "fazendas", "orcamentos"] as BudgetTable[]) {
    existing[table] = await allRows(table);
  }
  const migration = buildMigration(snapshot, existing);
  // Persistir o plano antes de qualquer escrita; contém o mapa entre IDs.
  writeFileSync(join(directory, "migration-plan.json"), JSON.stringify(migration, null, 2));
  console.log(`Plano: ${migration.payload.orcamento_itens!.length} itens, ${migration.payload.orcamento_item_meses!.length} competências, ${migration.payload.orcamento_item_planos!.length} planos.`);
  for (const warning of migration.warnings) console.log(`AVISO ${warning}`);
  if (!process.argv.includes("--apply")) {
    console.log("Diagnóstico concluído. Nenhum dado enviado. Use --apply para gravar.");
    process.exit(0);
  }

  const previousBudget = existing.orcamentos?.find((r) => r.id === migration.budgetId);
  if (previousBudget) {
    const metadata = JSON.parse(previousBudget.observacoes ?? "{}");
    if (metadata.migration !== snapshot.sourceSha256) throw new Error("Conflito de identidade da migração.");
    if (previousBudget.status !== "rascunho") throw new Error("A versão migrada já saiu de rascunho; não alterar.");
  }
  const order: BudgetTable[] = ["safras", "centros_custo", "categorias", "materiais", "atividades", "objetos_custo", "fazendas", "orcamentos", "orcamento_centros", "orcamento_categorias", "orcamento_premissas", "orcamento_itens", "orcamento_item_meses", "orcamento_item_planos", "orcamento_item_plano_meses"];
  for (const table of order) {
    const rows = migration.payload[table] ?? [];
    for (let i = 0; i < rows.length; i += 100) {
      await supabaseRequest(table, {
        method: "POST",
        query: new URLSearchParams({ on_conflict: table === "orcamento_item_meses" ? "item_id,competencia" : "id" }),
        prefer: "resolution=ignore-duplicates,return=minimal",
        body: rows.slice(i, i + 100),
      });
    }
    console.log(`Enviado ${table}: ${rows.length}`);
  }
  for (const parent of migration.parents) {
    const row = migration.payload.orcamento_itens!.find((r) => r.id === parent.id)!;
    // Não repetir UPDATE já aplicado; reduz eventos de auditoria em retomadas.
    const remote = await supabaseRequest<any[]>("orcamento_itens", { query: new URLSearchParams({ select: "item_pai_id", id: `eq.${parent.id}` }) });
    if (remote[0]?.item_pai_id !== parent.parent) {
      await supabaseRequest("orcamento_itens", { method: "PATCH", query: new URLSearchParams({ id: `eq.${parent.id}` }), body: { item_pai_id: parent.parent }, prefer: "return=minimal" });
    }
    row.item_pai_id = parent.parent;
  }
  console.log("Vínculos de hierarquia aplicados. Conferindo dados gravados...");

  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])])) : value;
  const remoteTables: MigrationPayload = {};
  for (const table of order) {
    const expected = migration.payload[table] ?? [];
    if (!expected.length) continue;
    const remote = await allRows(table);
    remoteTables[table] = remote;
    const key = (row: any) => table === "orcamento_item_meses" ? `${row.item_id}:${row.competencia}` : row.id;
    const lookup = new Map(remote.map((r) => [key(r), r]));
    for (const row of expected) {
      const stored = lookup.get(key(row));
      if (!stored) throw new Error(`Registro ausente na conferência de ${table}`);
      for (const [field, value] of Object.entries(row)) {
        if (table === "orcamentos" && field === "observacoes") continue;
        const actual = stored[field];
        const valid = typeof value === "number" ? Math.abs(Number(actual) - value) <= 0.000001 : JSON.stringify(canonical(actual)) === JSON.stringify(canonical(value));
        if (!valid) throw new Error(`Divergência em ${table}.${field}, registro ${key(row)}`);
      }
    }
    console.log(`Conferido ${table}: ${expected.length}`);
  }
  const monthly = remoteTables.orcamento_item_meses!;
  const reconciled = migration.expectedCenters.map((center) => {
    const rootSet = new Set(center.roots);
    const total = monthly.filter((m) => rootSet.has(m.item_id)).reduce((sum, m) => sum + Math.round(Number(m.valor_calculado) * 100), 0) / 100;
    // Cada competência foi comparada acima; esta diferença é só arredondamento.
    return { centro: center.sheet, original: migrationMoney(center.total), migrado: total, diferenca: migrationMoney(total - center.total) };
  });
  const report = { completedAt: new Date().toISOString(), budgetId: migration.budgetId, safra: migration.metadata.safra, centers: reconciled, items: migration.payload.orcamento_itens!.length, months: migration.payload.orcamento_item_meses!.length, plans: migration.payload.orcamento_item_planos!.length, warnings: migration.warnings, totalOriginal: migrationMoney(migration.expectedCenters.reduce((s, c) => s + c.total, 0)), totalMigrado: migrationMoney(reconciled.reduce((s, c) => s + c.migrado, 0)) };
  await supabaseRequest("orcamentos", { method: "PATCH", query: new URLSearchParams({ id: `eq.${migration.budgetId}` }), prefer: "return=minimal", body: { observacoes: JSON.stringify({ ...migration.metadata, state: "verified", report }) } });
  writeFileSync(join(directory, "migration-result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Erro na migração");
  console.error("O SQLite original foi preservado. Se houve escrita, a versão remota permanece em rascunho. O mesmo snapshot pode ser retomado sem duplicar registros.");
  process.exitCode = 1;
}
