import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";

const schema = readFileSync(new URL("./budget-memory-schema.sql", import.meta.url), "utf8");
const budgetTables = new Set([...schema.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?([a-zA-Z_][a-zA-Z0-9_]*)/gi)].map((m) => m[1]));

function isBudgetTable(name: string) {
  return budgetTables.has(name) || [...budgetTables].some((t) => name.startsWith(`${t}_`));
}

/** Evita que os helpers legados recriem as tabelas migradas no disco. */
export function budgetDdlInMemory(sql: string) {
  return sql
    .replace(/\bCREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(["`]?)([a-zA-Z_][a-zA-Z0-9_]*)\2/gi,
      (match, guard, quote, name) => isBudgetTable(name) ? `CREATE TEMP TABLE ${guard ?? ""}${quote}${name}${quote}` : match)
    .replace(/\bCREATE\s+(UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?(["`]?)([a-zA-Z_][a-zA-Z0-9_]*)\3\s+ON\s+(["`]?)([a-zA-Z_][a-zA-Z0-9_]*)\5/gi,
      (match, unique, guard, quote, name, tableQuote, table) => isBudgetTable(table) ? `CREATE ${unique ?? ""}INDEX ${guard ?? ""}temp.${quote}${name}${quote} ON ${tableQuote}${table}${tableQuote}` : match);
}

export function initializeBudgetMemory(db: Database.Database) {
  db.pragma("temp_store = MEMORY");
  const original = db.exec.bind(db);
  db.exec = ((sql: string) => original(budgetDdlInMemory(sql))) as typeof db.exec;
  db.exec(schema);
  const unexpected = db.prepare("SELECT name FROM main.sqlite_master WHERE type='table'").all() as { name: string }[];
  if (unexpected.some((r) => budgetTables.has(r.name))) {
    throw new Error("A base de configurações contém tabelas de orçamento. Execute supabase:retire-local antes de iniciar.");
  }
}
