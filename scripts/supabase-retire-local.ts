import Database from "better-sqlite3";
import { existsSync, mkdirSync, renameSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { loadEnvFile } from "../server/env.js";
import { BUDGET_LOCAL_TABLES, readCloudBudget, stateHash } from "../server/budget-cloud.js";

loadEnvFile();
try {
  if (process.env.BUDGET_STORAGE !== "supabase") throw new Error("Ative e confira o Supabase antes de retirar os dados locais.");
  const remote = await readCloudBudget();
  if (!remote) throw new Error("Estado remoto não encontrado. Nenhum dado local foi retirado.");
  for (const table of BUDGET_LOCAL_TABLES) {
    if (!Array.isArray(remote.estado.tables[table])) throw new Error(`Tabela ${table} não está preservada no Supabase.`);
  }
  const dataDir = resolve("data");
  const archive = resolve("data/migrations", `retired-local-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(archive, { recursive: true });
  writeFileSync(join(archive, "cloud-state.json"), JSON.stringify(remote));
  const target = join(dataDir, "local-settings.db");
  const candidates = [target, join(dataDir, "supabase-calculation-cache.db"), join(dataDir, "planejamento.db")];
  const source = candidates.find((path) => existsSync(path));
  if (!source) throw new Error("Nenhuma base local para preservar as configurações não migradas.");
  const temporary = join(archive, "local-settings.prepared.db");
  const legacy = new Database(source, { readonly: true, fileMustExist: true });
  try { await legacy.backup(temporary); } finally { legacy.close(); }
  const settings = new Database(temporary);
  const budget = new Set<string>(BUDGET_LOCAL_TABLES);
  const remaining: Record<string, any[]> = {};
  try {
    const tables = settings.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    for (const { name } of tables.filter((r) => !budget.has(r.name))) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error("Nome de tabela local inesperado.");
      const refs = settings.prepare(`PRAGMA foreign_key_list("${name}")`).all() as { table: string }[];
      if (refs.some((r) => budget.has(r.table))) throw new Error(`A tabela não migrada ${name} ainda depende das tabelas de orçamento.`);
      remaining[name] = settings.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
    }
    settings.pragma("foreign_keys = OFF");
    settings.transaction(() => {
      for (const table of BUDGET_LOCAL_TABLES) settings.exec(`DROP TABLE IF EXISTS "${table}"`);
    })();
    settings.pragma("journal_mode = DELETE");
    settings.exec("VACUUM");
    const restored = Object.fromEntries(Object.keys(remaining).map((name) => [name, settings.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
    if (stateHash(remaining) !== stateHash(restored)) throw new Error("A conferência das configurações não passou.");
    const names = settings.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    if (names.some((r) => budget.has(r.name))) throw new Error("Ainda há tabelas migradas na nova base local.");
  } finally { settings.close(); }

  // Arquivar os arquivos antigos, sem apagá-los. A API deve estar parada.
  for (const sourcePath of candidates) {
    if (!existsSync(sourcePath)) continue;
    const saved = new Database(sourcePath, { readonly: true, fileMustExist: true });
    try { await saved.backup(join(archive, `${sourcePath.split(/[\\/]/).at(-1)}.snapshot.db`)); } finally { saved.close(); }
    for (const suffix of ["", "-wal", "-shm"]) {
      const original = `${sourcePath}${suffix}`;
      const destination = join(archive, original.split(/[\\/]/).at(-1)!);
      if (dirname(original) !== dataDir || dirname(destination) !== archive) throw new Error("Caminho fora da área de limpeza.");
      if (existsSync(original)) renameSync(original, destination);
    }
  }
  renameSync(temporary, target);
  const migratedSheets = new Set(remote.estado.tables.sheets.map((s) => s.name));
  let archivedJson = 0;
  for (const folder of [resolve("data"), resolve("public/data")]) {
    const indexFile = join(folder, "index.json");
    if (!existsSync(indexFile)) continue;
    const entries = JSON.parse(readFileSync(indexFile, "utf8")) as { name: string; file: string }[];
    const moved = entries.filter((e) => migratedSheets.has(e.name));
    if (!moved.length) continue;
    const backupDir = join(archive, "legacy-json", folder === dataDir ? "data" : "public-data");
    mkdirSync(backupDir, { recursive: true });
    copyFileSync(indexFile, join(backupDir, "index.json"));
    for (const entry of moved) {
      const original = resolve(folder, entry.file);
      const destination = resolve(backupDir, entry.file);
      if (dirname(original) !== folder || dirname(destination) !== backupDir || !entry.file.endsWith(".json")) throw new Error("Caminho inesperado no índice JSON.");
      if (existsSync(original)) { renameSync(original, destination); archivedJson++; }
    }
    writeFileSync(indexFile, JSON.stringify(entries.filter((e) => !migratedSheets.has(e.name)), null, 2) + "\n");
  }
  writeFileSync(join(archive, "retirement-result.json"), JSON.stringify({ revision: remote.revisao, budgetTablesRemovedFromDisk: BUDGET_LOCAL_TABLES.length, archivedJson, remainingTables: Object.fromEntries(Object.entries(remaining).map(([name, rows]) => [name, rows.length])) }, null, 2));
  console.log(JSON.stringify({ removedBudgetTables: BUDGET_LOCAL_TABLES.length, archivedJson, localSettings: target, remainingTables: Object.keys(remaining), backup: archive }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Falha ao retirar os dados locais.");
  process.exitCode = 1;
}
