import { db } from "./db.js";
import { MONTHS } from "./catalog.js";
import { currentSafraId, currentSafraStartYear, previousSafra, resolveSafraId, safraStartYear } from "./safras.js";
import { workbookFromDb } from "./workbook-from-db.js";
import { fromExcelSerial } from "../src/engine/excelDate.ts";

export const SUBPROCESSES = [
  { key: "tons", name: "Colheita mecanizada", suffix: "t", qty: [8, 3], start: [4, 4], end: [4, 5], monthRow: 11, monthCol: 6 },
  { key: "tonsManual", name: "Colheita manual", suffix: "t", qty: [15, 3], start: [13, 4], end: [13, 5], monthRow: 16, monthCol: 6 },
  { key: "haVerao", name: "Plantio de verão", suffix: "ha", qty: [25, 2], start: [27, 4], end: [28, 4], monthRow: 26, monthCol: 5 },
  { key: "haInverno", name: "Plantio de inverno", suffix: "ha", qty: [32, 2], start: [34, 4], end: [35, 4], monthRow: 33, monthCol: 5 },
  { key: "haPlanta", name: "Tratos cana planta", suffix: "ha", qty: [40, 2], start: [42, 4], end: [42, 5], monthRow: 41, monthCol: 5 },
  { key: "haSoca", name: "Tratos cana soca", suffix: "ha", qty: [45, 2], start: [48, 4], end: [48, 5], monthRow: 45, monthCol: 5 },
] as const;

export type SubprocessKey = (typeof SUBPROCESSES)[number]["key"];
export type CopyScope = "current" | "previous";

export interface PremissaCopyRule {
  id: number;
  destKey: string;
  sourceKey: string;
  sourceScope: CopyScope;
  startMonth: number;
  endMonth: number;
}

export interface CustomSubprocess {
  key: string;
  name: string;
  suffix: string;
  kind: "subprocess" | "producao_propria";
}

export type PremissaItemKind = CustomSubprocess["kind"];

const DAY_MS = 24 * 60 * 60 * 1000;
const SAFRA_MONTHS = [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7];

export function parseDay(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(+value)) {
    return new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 80000) {
    const day = fromExcelSerial(value);
    return new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  }
  if (typeof value === "object" && value && "t" in value && (value as { t?: string }).t === "date") {
    return parseDay((value as { v?: string }).v ?? null);
  }
  if (typeof value === "string") {
    const raw = value.trim();
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  }
  return null;
}

export function toIsoDay(value: string): string | null {
  const day = parseDay(value.trim());
  if (!day) return null;
  return formatDay(day);
}

export function formatDay(value: unknown): string {
  const day = parseDay(value);
  if (!day) return "";
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, "0");
  const d = String(day.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function overlapDays(start: Date, end: Date, monthStart: Date, monthEnd: Date): number {
  const from = start > monthStart ? start : monthStart;
  const to = end < monthEnd ? end : monthEnd;
  if (from > to) return 0;
  return Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
}

export function safraMonthWindows(sepYear = currentSafraStartYear()): { start: Date; end: Date; year: number }[] {
  return SAFRA_MONTHS.map((month) => {
    const year = month >= 8 ? sepYear : sepYear + 1;
    return {
      start: new Date(year, month, 1),
      end: new Date(year, month + 1, 0),
      year,
    };
  });
}

export function distributeByDays(
  qty: number,
  start: Date,
  end: Date,
  windows: { start: Date; end: Date }[],
): number[] {
  const periodStart = start <= end ? start : end;
  const periodEnd = start <= end ? end : start;
  const days = windows.map((window) => overlapDays(periodStart, periodEnd, window.start, window.end));
  const totalDays = days.reduce((sum, n) => sum + n, 0);
  if (!(qty > 0) || totalDays <= 0) return windows.map(() => 0);
  return days.map((dayCount) => (qty / totalDays) * dayCount);
}

export function multiplyByDays(
  qtyPerDay: number,
  start: Date,
  end: Date,
  windows: { start: Date; end: Date }[],
): number[] {
  const periodStart = start <= end ? start : end;
  const periodEnd = start <= end ? end : start;
  if (!(qtyPerDay > 0)) return windows.map(() => 0);
  return windows.map((window) => qtyPerDay * overlapDays(periodStart, periodEnd, window.start, window.end));
}

const DRIVER_SUBPROCESS_KEYS: Record<string, string[]> = {
  plantio_verao: ["haVerao"],
  plantio_inverno: ["haInverno"],
  plantio_total: ["haVerao", "haInverno"],
  tratos_planta: ["haPlanta"],
  tratos_soca: ["haSoca"],
  moagem: ["tons"],
  tonsManual: ["tonsManual"],
};

function startYearOf(safraId: number) {
  const row = db.prepare("SELECT code FROM safras WHERE id = ?").get(safraId) as { code: string } | undefined;
  return row ? safraStartYear(row.code) : currentSafraStartYear();
}

function daysFromPeriod(start: Date | null, end: Date | null, windows: { start: Date; end: Date }[]): number[] {
  if (!start || !end) return windows.map(() => 0);
  const periodStart = start <= end ? start : end;
  const periodEnd = start <= end ? end : start;
  return windows.map((window) => overlapDays(periodStart, periodEnd, window.start, window.end));
}

function subprocessDaysByMonth(key: string, safraId: number, windows: { start: Date; end: Date }[]): number[] {
  const stored = listStoredPremissaValues(safraId).get(key);
  const fromStored = daysFromPeriod(parseDay(stored?.startDay ?? null), parseDay(stored?.endDay ?? null), windows);
  if (fromStored.some((n) => n > 0)) return fromStored;
  const spec = builtinByKey(key);
  if (spec) {
    const wb = workbookFromDb();
    const fromSheet = daysFromPeriod(
      parseDay(wb.display("PREMISSAS", spec.start[0], spec.start[1])),
      parseDay(wb.display("PREMISSAS", spec.end[0], spec.end[1])),
      windows,
    );
    if (fromSheet.some((n) => n > 0)) return fromSheet;
  }
  const qty = subprocessMonthValues()[key] ?? zeros();
  return windows.map((window, i) => ((qty[i] ?? 0) > 0 ? overlapDays(window.start, window.end, window.start, window.end) : 0));
}

export function premiseDaysByMonth(driverKey: string, safraId?: number | null): number[] {
  const harvestId = resolveSafraId(safraId);
  const windows = safraMonthWindows(startYearOf(harvestId));
  const keys = DRIVER_SUBPROCESS_KEYS[driverKey] ?? [driverKey];
  const series = keys.map((key) => subprocessDaysByMonth(key, harvestId, windows));
  return windows.map((_, i) => Math.max(0, ...series.map((row) => row[i] ?? 0)));
}

function monthsFromDailyQty(
  qtyPerDay: number,
  startDay: string | null | undefined,
  endDay: string | null | undefined,
  windows = safraMonthWindows(),
): number[] {
  const start = parseDay(startDay ?? null);
  const end = parseDay(endDay ?? null);
  if (!start || !end) return zeros();
  return multiplyByDays(qtyPerDay, start, end, windows);
}

export function listStoredPremissaValues(safraId: number) {
  ensurePremissaCopyTables();
  const rows = db
    .prepare("SELECT subprocess_key, qty, start_day, end_day FROM premissa_values WHERE safra_id = ?")
    .all(safraId) as { subprocess_key: string; qty: number | null; start_day: string | null; end_day: string | null }[];
  return new Map(
    rows.map((row) => [
      row.subprocess_key,
      { qty: asNumber(row.qty), startDay: row.start_day, endDay: row.end_day },
    ]),
  );
}

function asNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && !v.startsWith("#")) {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function zeros(): number[] {
  return Array.from({ length: 12 }, () => 0);
}

function parseMonthsJson(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr) || arr.length !== 12) return null;
    return arr.map((n) => (Number(n) > 0 ? Number(n) : 0));
  } catch {
    return null;
  }
}

function clampMonth(value: number) {
  return Math.max(0, Math.min(11, Math.trunc(value)));
}

export function copyMonthsFrom(source: number[], startMonth: number, endMonth = 11): number[] {
  const dest = zeros();
  const from = clampMonth(startMonth);
  const to = Math.max(from, clampMonth(endMonth));
  const first = source.findIndex((value) => Number(value) > 0);
  if (first < 0) return dest;
  for (let i = 0; i < 12; i++) {
    const destIndex = from + i;
    const sourceIndex = first + i;
    if (destIndex > to || destIndex >= 12 || sourceIndex >= 12) break;
    dest[destIndex] = Number(source[sourceIndex]) || 0;
  }
  return dest;
}

export function occupiedDestMonths(source: number[], startMonth: number, endMonth = 11): number[] {
  return copyMonthsFrom(source, startMonth, endMonth)
    .map((value, index) => (value > 0 ? index : -1))
    .filter((index) => index >= 0);
}

function mergeCopiedMonths(target: number[], extra: number[]) {
  for (let i = 0; i < 12; i++) {
    if ((extra[i] ?? 0) > 0) target[i] = extra[i];
  }
}

function ensurePremissaCopyTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS premissa_cells (
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      row INTEGER NOT NULL,
      col INTEGER NOT NULL,
      formula TEXT,
      value TEXT,
      PRIMARY KEY (safra_id, row, col)
    );
    CREATE TABLE IF NOT EXISTS premissa_values (
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      subprocess_key TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 0,
      start_day TEXT,
      end_day TEXT,
      months TEXT,
      PRIMARY KEY (safra_id, subprocess_key)
    );
    CREATE TABLE IF NOT EXISTS premissa_copies (
      id INTEGER PRIMARY KEY,
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      dest_key TEXT NOT NULL,
      source_key TEXT NOT NULL,
      source_scope TEXT NOT NULL CHECK (source_scope IN ('current', 'previous')),
      start_month INTEGER NOT NULL CHECK (start_month >= 0 AND start_month <= 11),
      end_month INTEGER NOT NULL DEFAULT 11 CHECK (end_month >= 0 AND end_month <= 11)
    );
    CREATE TABLE IF NOT EXISTS premissa_subprocesses (
      id INTEGER PRIMARY KEY,
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      suffix TEXT NOT NULL DEFAULT 'ha',
      kind TEXT NOT NULL DEFAULT 'subprocess',
      UNIQUE (safra_id, key)
    );
  `);
  try {
    db.exec("ALTER TABLE premissa_subprocesses ADD COLUMN kind TEXT NOT NULL DEFAULT 'subprocess'");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE premissa_values ADD COLUMN months TEXT");
  } catch {
    /* coluna já existe */
  }
  try {
    db.exec("ALTER TABLE premissa_values ADD COLUMN manual_months INTEGER NOT NULL DEFAULT 0");
  } catch {
    /* coluna já existe */
  }
  migrateCopyRulesToAllowMany();
  try {
    db.exec("ALTER TABLE premissa_copies ADD COLUMN end_month INTEGER NOT NULL DEFAULT 11");
  } catch {
    /* coluna já existe */
  }
}

function migrateCopyRulesToAllowMany() {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'premissa_copies'").get() as
    | { sql: string }
    | undefined;
  if (!table?.sql?.includes("UNIQUE (safra_id, dest_key)")) return;
  db.exec(`
    CREATE TABLE premissa_copies_v2 (
      id INTEGER PRIMARY KEY,
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      dest_key TEXT NOT NULL,
      source_key TEXT NOT NULL,
      source_scope TEXT NOT NULL CHECK (source_scope IN ('current', 'previous')),
      start_month INTEGER NOT NULL CHECK (start_month >= 0 AND start_month <= 11)
    );
    INSERT INTO premissa_copies_v2 (id, safra_id, dest_key, source_key, source_scope, start_month)
    SELECT id, safra_id, dest_key, source_key, source_scope, start_month FROM premissa_copies;
    DROP TABLE premissa_copies;
    ALTER TABLE premissa_copies_v2 RENAME TO premissa_copies;
  `);
}

function builtinByKey(key: string) {
  return SUBPROCESSES.find((row) => row.key === key);
}

export function slugSubprocessKey(name: string) {
  const base =
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || "subprocesso";
  return base;
}

export function listCustomSubprocesses(safraId?: number | null): CustomSubprocess[] {
  ensurePremissaCopyTables();
  const harvestId = resolveSafraId(safraId);
  return (
    db
      .prepare("SELECT key, name, suffix, kind FROM premissa_subprocesses WHERE safra_id = ? ORDER BY id")
      .all(harvestId) as { key: string; name: string; suffix: string; kind?: string | null }[]
  ).map((row) => ({
    key: row.key,
    name: row.name,
    suffix: row.suffix,
    kind: row.kind === "producao_propria" ? "producao_propria" : "subprocess",
  }));
}

export function listCopyRules(safraId?: number | null): PremissaCopyRule[] {
  ensurePremissaCopyTables();
  const harvestId = resolveSafraId(safraId);
  return (
    db
      .prepare(
        "SELECT id, dest_key, source_key, source_scope, start_month, COALESCE(end_month, 11) AS end_month FROM premissa_copies WHERE safra_id = ? ORDER BY id",
      )
      .all(harvestId) as {
        id: number;
        dest_key: string;
        source_key: string;
        source_scope: CopyScope;
        start_month: number;
        end_month: number;
      }[]
  ).map((row) => ({
    id: row.id,
    destKey: row.dest_key,
    sourceKey: row.source_key,
    sourceScope: row.source_scope === "previous" ? "previous" : "current",
    startMonth: row.start_month,
    endMonth: row.end_month < row.start_month ? 11 : row.end_month,
  }));
}

export function subprocessLabel(key: string, safraId?: number | null) {
  const builtin = builtinByKey(key);
  if (builtin) return builtin.name;
  const custom = listCustomSubprocesses(safraId).find((row) => row.key === key);
  return custom?.name ?? key;
}

function naturalMonthValues(): Record<string, number[]> {
  const wb = workbookFromDb();
  const n = (row: number, col: number) => asNumber(wb.display("PREMISSAS", row, col));
  const d = (row: number, col: number) => parseDay(wb.display("PREMISSAS", row, col));
  const windows = safraMonthWindows();
  const stored = listStoredPremissaValues(currentSafraId());
  const out: Record<string, number[]> = {};
  for (const spec of SUBPROCESSES) {
    const qty = n(spec.qty[0], spec.qty[1]);
    const start = d(spec.start[0], spec.start[1]);
    const end = d(spec.end[0], spec.end[1]);
    out[spec.key] = start && end ? distributeByDays(qty, start, end, windows) : windows.map(() => 0);
  }
  for (const custom of listCustomSubprocesses()) {
    if (custom.kind === "producao_propria") {
      const row = stored.get(custom.key);
      out[custom.key] = monthsFromDailyQty(row?.qty ?? 0, row?.startDay, row?.endDay, windows);
    } else {
      const row = stored.get(custom.key);
      const start = parseDay(row?.startDay ?? null);
      const end = parseDay(row?.endDay ?? null);
      const qty = row?.qty ?? 0;
      if (start && end && qty > 0) {
        out[custom.key] = distributeByDays(qty, start, end, windows);
      } else if (!out[custom.key]) {
        out[custom.key] = zeros();
      }
    }
  }
  return out;
}

export function storedPremissaMonths(safraId: number, key: string): number[] {
  ensurePremissaCopyTables();
  const row = db
    .prepare("SELECT months FROM premissa_values WHERE safra_id = ? AND subprocess_key = ?")
    .get(safraId, key) as { months: string | null } | undefined;
  return parseMonthsJson(row?.months) ?? zeros();
}

export function previousSubprocessMonths(): { key: string; name: string; suffix: string; months: number[]; kind?: "subprocess" | "producao_propria" }[] {
  const prev = previousSafra();
  if (!prev) return [];
  ensurePremissaCopyTables();
  const rows = db
    .prepare("SELECT subprocess_key, months FROM premissa_values WHERE safra_id = ?")
    .all(prev.id) as { subprocess_key: string; months: string | null }[];
  const byKey = new Map(rows.map((row) => [row.subprocess_key, parseMonthsJson(row.months) ?? zeros()]));
  const out: { key: string; name: string; suffix: string; months: number[]; kind?: "subprocess" | "producao_propria" }[] = [];
  for (const spec of SUBPROCESSES) {
    out.push({ key: spec.key, name: spec.name, suffix: spec.suffix, months: byKey.get(spec.key) ?? zeros(), kind: "subprocess" });
  }
  for (const custom of listCustomSubprocesses(prev.id)) {
    out.push({
      key: custom.key,
      name: custom.name,
      suffix: custom.suffix,
      months: byKey.get(custom.key) ?? zeros(),
      kind: custom.kind,
    });
  }
  return out;
}

function listManualMonthMap(safraId?: number | null): Map<string, number[]> {
  ensurePremissaCopyTables();
  const harvestId = resolveSafraId(safraId);
  const rows = db
    .prepare(
      "SELECT subprocess_key, months FROM premissa_values WHERE safra_id = ? AND COALESCE(manual_months, 0) = 1",
    )
    .all(harvestId) as { subprocess_key: string; months: string | null }[];
  return new Map(
    rows
      .map((row) => [row.subprocess_key, parseMonthsJson(row.months)] as const)
      .filter((entry): entry is readonly [string, number[]] => entry[1] != null),
  );
}

export function listManualMonthKeys(safraId?: number | null): string[] {
  return [...listManualMonthMap(safraId).keys()];
}

export function setPremissaMonthValue(key: string, monthIndex: number, raw: unknown, safraId?: number | null) {
  ensurePremissaCopyTables();
  const harvestId = resolveSafraId(safraId);
  const month = clampMonth(Number(monthIndex));
  if (!Number.isInteger(Number(monthIndex)) || Number(monthIndex) !== month) {
    throw new Error("Informe o mês da safra.");
  }
  const known = new Set([
    ...SUBPROCESSES.map((row) => row.key),
    ...listCustomSubprocesses(harvestId).map((row) => row.key),
  ]);
  if (!known.has(key)) throw new Error("Subprocesso não encontrado.");
  const value = asNumber(raw);
  if (!(value >= 0) || !Number.isFinite(value)) throw new Error("Informe um valor válido.");
  const current = subprocessMonthValues()[key] ?? zeros();
  current[month] = value;
  const qty = current.reduce((sum, n) => sum + (Number(n) || 0), 0);
  const production = listCustomSubprocesses(harvestId).find((row) => row.key === key)?.kind === "producao_propria";
  if (production) {
    db.prepare(
      `INSERT INTO premissa_values (safra_id, subprocess_key, qty, start_day, end_day, months, manual_months)
       VALUES (?, ?, 0, NULL, NULL, ?, 1)
       ON CONFLICT(safra_id, subprocess_key) DO UPDATE SET
         months = excluded.months,
         manual_months = 1`,
    ).run(harvestId, key, JSON.stringify(current.map((n) => Number(n.toFixed(6)))));
    return;
  }
  db.prepare(
    `INSERT INTO premissa_values (safra_id, subprocess_key, qty, start_day, end_day, months, manual_months)
     VALUES (?, ?, ?, NULL, NULL, ?, 1)
     ON CONFLICT(safra_id, subprocess_key) DO UPDATE SET
       months = excluded.months,
       qty = excluded.qty,
       manual_months = 1`,
  ).run(harvestId, key, qty, JSON.stringify(current.map((n) => Number(n.toFixed(6)))));
}

export function clearPremissaManualMonths(key: string, safraId?: number | null) {
  ensurePremissaCopyTables();
  const harvestId = resolveSafraId(safraId);
  db.prepare("UPDATE premissa_values SET manual_months = 0 WHERE safra_id = ? AND subprocess_key = ?").run(
    harvestId,
    key,
  );
}

export function subprocessMonthValues() {
  const out = naturalMonthValues();
  const manuals = listManualMonthMap();
  for (const [key, months] of manuals) out[key] = months;
  const rules = listCopyRules().filter((rule) => !manuals.has(rule.destKey));
  if (!rules.length) return out;
  const prev = previousSafra();
  const destKeys = [...new Set(rules.map((rule) => rule.destKey))];
  const natural = { ...out };
  for (const destKey of destKeys) out[destKey] = zeros();

  const sourceOf = (rule: PremissaCopyRule) => {
    if (rule.sourceScope === "previous") {
      return prev ? storedPremissaMonths(prev.id, rule.sourceKey) : zeros();
    }
    if (destKeys.includes(rule.sourceKey)) return out[rule.sourceKey] ?? zeros();
    return natural[rule.sourceKey] ?? zeros();
  };

  const apply = () => {
    for (const rule of rules) {
      if (rule.sourceScope === "current" && rule.destKey === rule.sourceKey) continue;
      mergeCopiedMonths(
        out[rule.destKey] ?? (out[rule.destKey] = zeros()),
        copyMonthsFrom(sourceOf(rule), rule.startMonth, rule.endMonth),
      );
    }
  };
  apply();
  apply();
  return out;
}

export function copyPremissaData(sourceId: number, targetId: number) {
  ensurePremissaCopyTables();
  if (!sourceId || !targetId || sourceId === targetId) return;
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM premissa_cells WHERE safra_id = ?").run(targetId);
    db.prepare("DELETE FROM premissa_values WHERE safra_id = ?").run(targetId);
    db.prepare("DELETE FROM premissa_copies WHERE safra_id = ?").run(targetId);
    db.prepare("DELETE FROM premissa_subprocesses WHERE safra_id = ?").run(targetId);
    db.prepare(
      `INSERT INTO premissa_cells (safra_id, row, col, formula, value)
       SELECT ?, row, col, formula, value FROM premissa_cells WHERE safra_id = ?`,
    ).run(targetId, sourceId);
    db.prepare(
      `INSERT INTO premissa_values (safra_id, subprocess_key, qty, start_day, end_day, months, manual_months)
       SELECT ?, subprocess_key, qty, start_day, end_day, months, COALESCE(manual_months, 0) FROM premissa_values WHERE safra_id = ?`,
    ).run(targetId, sourceId);
    db.prepare(
      `INSERT INTO premissa_subprocesses (safra_id, key, name, suffix, kind)
       SELECT ?, key, name, suffix, COALESCE(kind, 'subprocess') FROM premissa_subprocesses WHERE safra_id = ?`,
    ).run(targetId, sourceId);
    db.prepare(
      `INSERT INTO premissa_copies (safra_id, dest_key, source_key, source_scope, start_month, end_month)
       SELECT ?, dest_key, source_key, source_scope, start_month, end_month FROM premissa_copies WHERE safra_id = ?`,
    ).run(targetId, sourceId);
  });
  tx();
}

export function snapshotPremissaSheet(safraId?: number | null) {
  ensurePremissaCopyTables();
  const harvestId = resolveSafraId(safraId);
  const sheet = db.prepare("SELECT id FROM sheets WHERE name = 'PREMISSAS'").get() as { id: number } | undefined;
  if (!sheet) return;
  const cells = db
    .prepare("SELECT row, col, formula, value FROM cells WHERE sheet_id = ?")
    .all(sheet.id) as { row: number; col: number; formula: string | null; value: string | null }[];
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM premissa_cells WHERE safra_id = ?").run(harvestId);
    const ins = db.prepare(
      "INSERT INTO premissa_cells (safra_id, row, col, formula, value) VALUES (?, ?, ?, ?, ?)",
    );
    for (const cell of cells) ins.run(harvestId, cell.row, cell.col, cell.formula, cell.value);
  });
  tx();
}

export function restorePremissaSheet(safraId?: number | null) {
  ensurePremissaCopyTables();
  const harvestId = resolveSafraId(safraId);
  const sheet = db.prepare("SELECT id FROM sheets WHERE name = 'PREMISSAS'").get() as { id: number } | undefined;
  if (!sheet) return false;
  const cells = db
    .prepare("SELECT row, col, formula, value FROM premissa_cells WHERE safra_id = ?")
    .all(harvestId) as { row: number; col: number; formula: string | null; value: string | null }[];
  if (!cells.length) return false;
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM cells WHERE sheet_id = ?").run(sheet.id);
    const ins = db.prepare("INSERT INTO cells (sheet_id, row, col, formula, value) VALUES (?, ?, ?, ?, ?)");
    for (const cell of cells) ins.run(sheet.id, cell.row, cell.col, cell.formula, cell.value);
  });
  tx();
  return true;
}

export function snapshotPremissaValues(safraId?: number | null) {
  ensurePremissaCopyTables();
  const harvestId = resolveSafraId(safraId);
  if (harvestId !== currentSafraId()) return;
  const series = subprocessMonthValues();
  const productionKeys = new Set(
    listCustomSubprocesses(harvestId)
      .filter((row) => row.kind === "producao_propria")
      .map((row) => row.key),
  );
  const upsert = db.prepare(
    `INSERT INTO premissa_values (safra_id, subprocess_key, qty, start_day, end_day, months)
     VALUES (?, ?, ?, NULL, NULL, ?)
     ON CONFLICT(safra_id, subprocess_key) DO UPDATE SET months = excluded.months, qty = excluded.qty`,
  );
  const upsertProductionMonths = db.prepare(
    `INSERT INTO premissa_values (safra_id, subprocess_key, qty, start_day, end_day, months, manual_months)
     VALUES (?, ?, 0, NULL, NULL, ?, 0)
     ON CONFLICT(safra_id, subprocess_key) DO UPDATE SET months = excluded.months`,
  );
  const tx = db.transaction(() => {
    for (const [key, months] of Object.entries(series)) {
      const packed = JSON.stringify(months.map((n) => Number(n.toFixed(6))));
      if (productionKeys.has(key)) {
        upsertProductionMonths.run(harvestId, key, packed);
        continue;
      }
      const qty = months.reduce((sum, n) => sum + (Number(n) || 0), 0);
      upsert.run(harvestId, key, qty, packed);
    }
    const prev = previousSafra(harvestId);
    if (prev) {
      const count = db.prepare("SELECT COUNT(*) AS n FROM premissa_values WHERE safra_id = ?").get(prev.id) as { n: number };
      if (!count.n) {
        for (const [key, months] of Object.entries(series)) {
          if (productionKeys.has(key)) continue;
          const qty = months.reduce((sum, n) => sum + (Number(n) || 0), 0);
          upsert.run(prev.id, key, qty, JSON.stringify(months.map((n) => Number(n.toFixed(6)))));
        }
      }
    }
  });
  tx();
  snapshotPremissaSheet(harvestId);
}

function unusedCustomKey(safraId: number, name: string) {
  const taken = new Set<string>([
    ...SUBPROCESSES.map((row) => row.key),
    ...listCustomSubprocesses(safraId).map((row) => row.key),
    "plantio_verao",
    "plantio_inverno",
    "plantio_total",
    "tratos_planta",
    "tratos_soca",
    "moagem",
    "dias",
  ]);
  const base = slugSubprocessKey(name);
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

export function createCustomSubprocess(
  name: string,
  suffix = "ha",
  safraId?: number | null,
  kind: PremissaItemKind = "subprocess",
  seed?: {
    qty?: unknown;
    qtyPerDay?: unknown;
    startDay?: string | null;
    endDay?: string | null;
  },
) {
  ensurePremissaCopyTables();
  const harvestId = resolveSafraId(safraId);
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error(kind === "producao_propria" ? "Informe o nome da produção própria." : "Informe o nome do subprocesso.");
  }
  const key = unusedCustomKey(harvestId, trimmed);
  const unit = suffix.trim() || (kind === "producao_propria" ? "t" : "ha");
  const storedKind: PremissaItemKind = kind === "producao_propria" ? "producao_propria" : "subprocess";
  db.prepare("INSERT INTO premissa_subprocesses (safra_id, key, name, suffix, kind) VALUES (?, ?, ?, ?, ?)").run(
    harvestId,
    key,
    trimmed,
    unit,
    storedKind,
  );
  if (storedKind === "producao_propria") {
    db.prepare(
      `INSERT INTO premissa_values (safra_id, subprocess_key, qty, start_day, end_day, months, manual_months)
       VALUES (?, ?, 0, NULL, NULL, ?, 0)`,
    ).run(harvestId, key, JSON.stringify(zeros()));
    if (
      seed &&
      ((seed.qtyPerDay != null && String(seed.qtyPerDay).trim() !== "") ||
        seed.startDay ||
        seed.endDay)
    ) {
      saveProductionOwn(key, {
        qtyPerDay: seed.qtyPerDay,
        startDay: seed.startDay,
        endDay: seed.endDay,
      }, harvestId);
    }
  } else {
    db.prepare(
      `INSERT INTO premissa_values (safra_id, subprocess_key, qty, start_day, end_day, months, manual_months)
       VALUES (?, ?, 0, NULL, NULL, ?, 0)`,
    ).run(harvestId, key, JSON.stringify(zeros()));
    if (
      seed &&
      ((seed.qty != null && String(seed.qty).trim() !== "") ||
        (seed.qtyPerDay != null && String(seed.qtyPerDay).trim() !== "") ||
        seed.startDay ||
        seed.endDay)
    ) {
      saveCustomSubprocess(
        key,
        {
          qty: seed.qty ?? seed.qtyPerDay,
          startDay: seed.startDay,
          endDay: seed.endDay,
        },
        harvestId,
      );
    }
  }
  return { key, name: trimmed, suffix: unit, kind: storedKind };
}

export function saveCustomSubprocess(
  key: string,
  input: { qty?: unknown; startDay?: string | null; endDay?: string | null },
  safraId?: number | null,
) {
  ensurePremissaCopyTables();
  const harvestId = resolveSafraId(safraId);
  const item = listCustomSubprocesses(harvestId).find((row) => row.key === key);
  if (!item || item.kind !== "subprocess") throw new Error("Subprocesso não encontrado.");

  const current = db
    .prepare(
      "SELECT qty, start_day, end_day FROM premissa_values WHERE safra_id = ? AND subprocess_key = ?",
    )
    .get(harvestId, key) as
    | { qty: number | null; start_day: string | null; end_day: string | null }
    | undefined;

  let qty = asNumber(current?.qty);
  if (input.qty !== undefined) {
    const raw = String(input.qty ?? "").trim();
    qty = raw === "" ? 0 : asNumber(raw);
    if (!(qty >= 0) || !Number.isFinite(qty)) throw new Error("Informe a quantidade total.");
  }

  let startDay = current?.start_day ?? null;
  if (input.startDay !== undefined) {
    const raw = String(input.startDay ?? "").trim();
    startDay = raw ? toIsoDay(raw) : null;
    if (raw && !startDay) throw new Error("Informe a data inicial.");
  }

  let endDay = current?.end_day ?? null;
  if (input.endDay !== undefined) {
    const raw = String(input.endDay ?? "").trim();
    endDay = raw ? toIsoDay(raw) : null;
    if (raw && !endDay) throw new Error("Informe a data final.");
  }

  const start = parseDay(startDay);
  const end = parseDay(endDay);
  if (start && end && start > end) throw new Error("A data inicial precisa ser antes da data final.");

  const windows = safraMonthWindows();
  const months = start && end && qty > 0 ? distributeByDays(qty, start, end, windows) : zeros();

  db.prepare(
    `INSERT INTO premissa_values (safra_id, subprocess_key, qty, start_day, end_day, months, manual_months)
     VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(safra_id, subprocess_key) DO UPDATE SET
       qty = excluded.qty,
       start_day = excluded.start_day,
       end_day = excluded.end_day,
       months = excluded.months,
       manual_months = 0`,
  ).run(
    harvestId,
    key,
    qty,
    startDay,
    endDay,
    JSON.stringify(months.map((n) => Number(n.toFixed(6)))),
  );
}

export function saveProductionOwn(
  key: string,
  input: { qtyPerDay?: unknown; startDay?: string | null; endDay?: string | null },
  safraId?: number | null,
) {
  ensurePremissaCopyTables();
  const harvestId = resolveSafraId(safraId);
  const item = listCustomSubprocesses(harvestId).find((row) => row.key === key);
  if (!item || item.kind !== "producao_propria") throw new Error("Item de produção própria não encontrado.");

  const current = db
    .prepare(
      "SELECT qty, start_day, end_day, COALESCE(manual_months, 0) AS manual_months FROM premissa_values WHERE safra_id = ? AND subprocess_key = ?",
    )
    .get(harvestId, key) as
    | { qty: number | null; start_day: string | null; end_day: string | null; manual_months: number }
    | undefined;

  let qty = asNumber(current?.qty);
  if (input.qtyPerDay !== undefined) {
    const raw = String(input.qtyPerDay ?? "").trim();
    qty = raw === "" ? 0 : asNumber(raw);
    if (!(qty >= 0) || !Number.isFinite(qty)) throw new Error("Informe a quantidade por dia.");
  } else if (!current?.start_day && !current?.end_day && current?.manual_months === 1) {
    qty = 0;
  }

  let startDay = current?.start_day ?? null;
  if (input.startDay !== undefined) {
    const raw = String(input.startDay ?? "").trim();
    startDay = raw ? toIsoDay(raw) : null;
    if (raw && !startDay) throw new Error("Informe a data inicial.");
  }

  let endDay = current?.end_day ?? null;
  if (input.endDay !== undefined) {
    const raw = String(input.endDay ?? "").trim();
    endDay = raw ? toIsoDay(raw) : null;
    if (raw && !endDay) throw new Error("Informe a data final.");
  }

  if (startDay && endDay) {
    const start = parseDay(startDay);
    const end = parseDay(endDay);
    if (start && end && start > end) throw new Error("O fim precisa ser no mesmo dia ou depois do início.");
  }

  const months = monthsFromDailyQty(qty, startDay, endDay);
  db.prepare(
    `INSERT INTO premissa_values (safra_id, subprocess_key, qty, start_day, end_day, months, manual_months)
     VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(safra_id, subprocess_key) DO UPDATE SET
       qty = excluded.qty,
       start_day = excluded.start_day,
       end_day = excluded.end_day,
       months = excluded.months,
       manual_months = 0`,
  ).run(harvestId, key, qty, startDay, endDay, JSON.stringify(months.map((n) => Number(n.toFixed(6)))));
}

export function deleteCustomSubprocess(key: string, safraId?: number | null) {
  ensurePremissaCopyTables();
  const harvestId = resolveSafraId(safraId);
  if (builtinByKey(key)) throw new Error("Este subprocesso faz parte das premissas e não pode ser excluído.");
  db.prepare("DELETE FROM premissa_copies WHERE safra_id = ? AND dest_key = ?").run(harvestId, key);
  db.prepare("DELETE FROM premissa_values WHERE safra_id = ? AND subprocess_key = ?").run(harvestId, key);
  const result = db.prepare("DELETE FROM premissa_subprocesses WHERE safra_id = ? AND key = ?").run(harvestId, key);
  if (!result.changes) throw new Error("Subprocesso não encontrado.");
}

export function savePremissaCopy(
  input: {
    destKey?: string | null;
    destName?: string | null;
    destSuffix?: string | null;
    sourceKey: string;
    sourceScope: CopyScope;
    startMonth: number;
    endMonth?: number;
  },
  safraId?: number | null,
) {
  ensurePremissaCopyTables();
  const harvestId = resolveSafraId(safraId);
  const startMonth = clampMonth(Number(input.startMonth));
  const endMonth = Math.max(startMonth, clampMonth(input.endMonth == null ? 11 : Number(input.endMonth)));
  if (Number.isNaN(Number(input.startMonth))) throw new Error("Escolha o mês a partir do qual a cópia começa.");
  if (endMonth < startMonth) throw new Error("O mês final precisa ser igual ou depois do mês inicial.");
  const sourceScope: CopyScope = input.sourceScope === "previous" ? "previous" : "current";
  if (sourceScope === "previous" && !previousSafra(harvestId)) {
    throw new Error("Não há safra anterior para copiar.");
  }
  const knownCurrent = new Set([
    ...SUBPROCESSES.map((row) => row.key),
    ...listCustomSubprocesses(harvestId).map((row) => row.key),
  ]);
  const knownSource =
    sourceScope === "previous"
      ? new Set(previousSubprocessMonths().map((row) => row.key))
      : knownCurrent;
  if (!knownSource.has(input.sourceKey)) throw new Error("Subprocesso de origem não encontrado.");

  let destKey = input.destKey?.trim() || "";
  if (!destKey) {
    const created = createCustomSubprocess(String(input.destName ?? ""), input.destSuffix ?? "ha", harvestId);
    destKey = created.key;
  } else if (!knownCurrent.has(destKey) && !builtinByKey(destKey)) {
    throw new Error("Subprocesso de destino não encontrado.");
  }
  if (sourceScope === "current" && destKey === input.sourceKey) {
    throw new Error("Escolha outro subprocesso para receber a cópia.");
  }

  const liveMonths = subprocessMonthValues();
  const monthsOf = (sourceKey: string, scope: CopyScope) => {
    if (scope === "previous") {
      const prev = previousSafra(harvestId);
      return prev ? storedPremissaMonths(prev.id, sourceKey) : zeros();
    }
    return liveMonths[sourceKey] ?? zeros();
  };

  const incoming = occupiedDestMonths(monthsOf(input.sourceKey, sourceScope), startMonth, endMonth);
  if (!incoming.length) throw new Error("O subprocesso de origem ainda não tem valores mensais para copiar.");

  const existing = listCopyRules(harvestId).filter((rule) => rule.destKey === destKey);
  for (const rule of existing) {
    const taken = occupiedDestMonths(monthsOf(rule.sourceKey, rule.sourceScope), rule.startMonth, rule.endMonth);
    const clash = incoming.find((month) => taken.includes(month));
    if (clash != null) {
      throw new Error(
        `O mês ${MONTHS[clash]} já recebe a cópia de ${subprocessLabel(rule.sourceKey, rule.sourceScope === "previous" ? previousSafra(harvestId)?.id : harvestId)}. Escolha outro mês.`,
      );
    }
  }

  const duplicate = existing.find(
    (rule) =>
      rule.sourceKey === input.sourceKey &&
      rule.sourceScope === sourceScope &&
      rule.startMonth === startMonth &&
      rule.endMonth === endMonth,
  );
  if (duplicate) throw new Error("Essa cópia já está aplicada neste subprocesso.");

  db.prepare(
    `INSERT INTO premissa_copies (safra_id, dest_key, source_key, source_scope, start_month, end_month)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(harvestId, destKey, input.sourceKey, sourceScope, startMonth, endMonth);
  clearPremissaManualMonths(destKey, harvestId);
  return destKey;
}

export function deletePremissaCopy(id: number, safraId?: number | null) {
  ensurePremissaCopyTables();
  const harvestId = resolveSafraId(safraId);
  const row = db
    .prepare("SELECT dest_key FROM premissa_copies WHERE id = ? AND safra_id = ?")
    .get(id, harvestId) as { dest_key: string } | undefined;
  if (!row) throw new Error("Esta cópia automática não existe.");
  db.prepare("DELETE FROM premissa_copies WHERE id = ?").run(id);
  const leftover = db
    .prepare("SELECT COUNT(*) AS n FROM premissa_copies WHERE safra_id = ? AND dest_key = ?")
    .get(harvestId, row.dest_key) as { n: number };
  if (!leftover.n && !builtinByKey(row.dest_key)) {
    const dest = listCustomSubprocesses(harvestId).find((item) => item.key === row.dest_key);
    if (dest?.kind !== "producao_propria") {
      db.prepare("DELETE FROM premissa_subprocesses WHERE safra_id = ? AND key = ?").run(harvestId, row.dest_key);
      db.prepare("DELETE FROM premissa_values WHERE safra_id = ? AND subprocess_key = ?").run(harvestId, row.dest_key);
    }
  }
}

function writeNumber(sheetId: number, row: number, col: number, value: number) {
  db.prepare("DELETE FROM cells WHERE sheet_id = ? AND row = ? AND col = ?").run(sheetId, row, col);
  db.prepare("INSERT INTO cells (sheet_id, row, col, formula, value) VALUES (?, ?, ?, NULL, ?)").run(
    sheetId,
    row,
    col,
    JSON.stringify(Number(value.toFixed(6))),
  );
}

export function applyPremissaDistribution(sheetId: number) {
  const series = subprocessMonthValues();
  for (const spec of SUBPROCESSES) {
    const values = series[spec.key] ?? [];
    for (let i = 0; i < 12; i++) {
      const col = spec.monthCol + i;
      if (spec.monthRow === spec.qty[0] && col === spec.qty[1]) continue;
      writeNumber(sheetId, spec.monthRow, col, values[i] ?? 0);
    }
  }
  snapshotPremissaValues();
}
