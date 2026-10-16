import Database from "better-sqlite3";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

const dir = resolve("data/migrations", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(dir, { recursive: true });
const source = new Database(resolve("data/planejamento.db"), { readonly: true, fileMustExist: true });
const backup = join(dir, "original.db");
await source.backup(backup);
source.close();
const hash = createHash("sha256").update(readFileSync(backup)).digest("hex");
// Toda inicialização/migração auxiliar do motor ocorre exclusivamente na cópia.
const copy = new Database(backup, { readonly: true });
await copy.backup(join(dir, "calculation.db"));
copy.close();
process.env.PLANEJAMENTO_DB_PATH = join(dir, "calculation.db");
const { db } = await import("../server/db.js");
const { sheetDetail, premissasKpis } = await import("../server/calc.js");
const { currentSafraId } = await import("../server/safras.js");
const { parseCalcPlans } = await import("../server/auto-calc.js");
const { workbookFromDb } = await import("../server/workbook-from-db.js");
try {
  const tables: Record<string, any[]> = {};
  const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  for (const { name } of tableNames) tables[name] = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all();
  const current = currentSafraId();
  const sheets = tables.sheets.filter((s) => s.kind === "cost_center").map((s) => sheetDetail(s.id));
  const wb = workbookFromDb();
  const formulaErrors: { line: number; month: number; result: unknown }[] = [];
  for (const month of tables.line_months) {
    if (!month.formula || month.formula === "=AUTOCALC") continue;
    const line = tables.lines.find((l) => l.id === month.line_id);
    const sheet = tables.sheets.find((s) => s.id === line?.sheet_id);
    const result = wb.evaluateFormula(sheet.name, month.formula);
    if (typeof result === "string" && result.startsWith("#")) formulaErrors.push({ line: line.id, month: month.month_index, result });
  }
  const parsedPlans = Object.fromEntries(tables.lines.map((l) => [l.id, parseCalcPlans(l.calc_plans)]));
  const snapshot = { format: 1, sourceSha256: hash, createdAt: new Date().toISOString(), currentSafraId: current, tables, sheets, premises: premissasKpis(), parsedPlans, formulaErrors };
  writeFileSync(join(dir, "snapshot.json"), JSON.stringify(snapshot));
  writeFileSync(resolve("data/migrations/latest.json"), JSON.stringify({ directory: dir }, null, 2));
  console.log(JSON.stringify({ directory: dir, centers: sheets.length, items: sheets.reduce((s, c) => s + (c?.categories.reduce((n, cat) => n + cat.lines.length, 0) ?? 0), 0), total: sheets.reduce((s, c) => s + (c?.total ?? 0), 0), formulaErrors }, null, 2));
} finally { db.close(); }
