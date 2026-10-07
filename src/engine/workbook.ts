import { FormulaEngine, FormulaError } from "./formulas";
import { parseIsoDate } from "./excelDate";
import {
  cellKey,
  colLetter,
  type CellData,
  type CellValue,
  type RawCell,
  type SheetGrid,
  type SheetJson,
} from "./types";

const decodeRaw = (raw: RawCell): CellData | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" || typeof raw === "boolean") {
    return { value: raw, cached: raw };
  }
  if (typeof raw === "string") {
    if (raw.startsWith("=")) return { formula: raw, value: null };
    return { value: raw, cached: raw };
  }
  if (typeof raw === "object") {
    if ("t" in raw && raw.t === "date") {
      const d = parseIsoDate(raw.v);
      return { value: d, cached: d };
    }
    if ("f" in raw && typeof raw.f === "string") {
      return { formula: raw.f, value: decodeCached(raw.v), cached: decodeCached(raw.v) };
    }
    if ("v" in raw) {
      const v = decodeCached(raw.v);
      return { value: v, cached: v };
    }
  }
  return { value: String(raw) };
};

const decodeCached = (v: unknown): CellValue => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "object" && v && "t" in v) {
    const obj = v as { t?: string; v?: string };
    if (obj.t === "date" && obj.v) return parseIsoDate(obj.v);
  }
  return null;
};

export class Workbook {
  sheets = new Map<string, SheetGrid>();
  meta = new Map<string, { maxRow: number; maxCol: number }>();
  private engine: FormulaEngine;
  private cache = new Map<string, unknown>();
  private visiting = new Set<string>();
  names: string[] = [];

  constructor(data: SheetJson[]) {
    for (const sheet of data) {
      const grid: SheetGrid = new Map();
      for (const row of sheet.rows) {
        row.c.forEach((raw, idx) => {
          const cell = decodeRaw(raw);
          if (cell) grid.set(cellKey(row.r, idx + 1), cell);
        });
      }
      this.sheets.set(sheet.name, grid);
      this.meta.set(sheet.name, { maxRow: sheet.maxRow, maxCol: sheet.maxCol });
      this.names.push(sheet.name);
    }
    this.engine = new FormulaEngine(this.names, (s, r, c) => this.get(s, r, c));
  }

  getSheet(name: string): SheetGrid {
    return this.sheets.get(name) ?? new Map();
  }

  get(sheet: string, row: number, col: number): unknown {
    const addr = `${sheet}!${cellKey(row, col)}`;
    if (this.cache.has(addr)) return this.cache.get(addr);
    if (this.visiting.has(addr)) return 0;

    const grid = this.sheets.get(sheet);
    const cell = grid?.get(cellKey(row, col));
    if (!cell) {
      this.cache.set(addr, null);
      return null;
    }

    if (!cell.formula) {
      this.cache.set(addr, cell.value);
      return cell.value;
    }

    this.visiting.add(addr);
    try {
      const result = this.engine.evaluate(cell.formula, sheet);
      this.cache.set(addr, result);
      return result;
    } catch (err) {
      // Só arquivos externos (outra planilha) usam o valor gravado no Excel.
      // O restante recalcula a partir das Premissas; erro vira 0, nunca valor velho.
      if (err instanceof FormulaError && err.code === "#EXTERNAL" && cell.cached != null) {
        const fallback = cell.cached;
        if (typeof fallback === "string" && fallback.startsWith("#")) {
          this.cache.set(addr, 0);
          return 0;
        }
        this.cache.set(addr, fallback);
        return fallback;
      }
      this.cache.set(addr, 0);
      return 0;
    } finally {
      this.visiting.delete(addr);
    }
  }

  display(sheet: string, row: number, col: number): CellValue {
    const v = this.get(sheet, row, col);
    if (v instanceof Date) return v;
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
    return v == null ? null : String(v);
  }

  formulaOf(sheet: string, row: number, col: number): string | undefined {
    return this.sheets.get(sheet)?.get(cellKey(row, col))?.formula;
  }

  rawInput(sheet: string, row: number, col: number): string {
    const cell = this.sheets.get(sheet)?.get(cellKey(row, col));
    if (!cell) return "";
    if (cell.formula) return cell.formula;
    if (cell.value instanceof Date) return cell.value.toISOString().slice(0, 10);
    if (cell.value == null) return "";
    return String(cell.value);
  }

  evaluateFormula(sheet: string, formula: string): unknown {
    try {
      return this.engine.evaluate(formula, sheet);
    } catch {
      return 0;
    }
  }

  setCell(sheet: string, row: number, col: number, input: string) {
    const grid = this.sheets.get(sheet);
    if (!grid) return;
    const key = cellKey(row, col);
    const trimmed = input.trim();
    if (trimmed === "") {
      grid.delete(key);
    } else if (trimmed.startsWith("=")) {
      grid.set(key, { formula: trimmed, value: null });
    } else if (/^-?\d+([.,]\d+)?$/.test(trimmed)) {
      const n = Number(trimmed.replace(",", "."));
      grid.set(key, { value: n, cached: n });
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const d = parseIsoDate(trimmed);
      grid.set(key, { value: d, cached: d });
    } else {
      grid.set(key, { value: trimmed, cached: trimmed });
    }
    this.cache.clear();
  }

  snapshot(): Record<string, Record<string, { f?: string; v?: CellValue }>> {
    const out: Record<string, Record<string, { f?: string; v?: CellValue }>> = {};
    for (const [name, grid] of this.sheets) {
      const cells: Record<string, { f?: string; v?: CellValue }> = {};
      for (const [addr, cell] of grid) {
        if (cell.formula) cells[addr] = { f: cell.formula };
        else if (cell.value instanceof Date) cells[addr] = { v: cell.value.toISOString() };
        else if (cell.value != null) cells[addr] = { v: cell.value };
      }
      out[name] = cells;
    }
    return out;
  }
}

export const a1 = (row: number, col: number) => `${colLetter(col)}${row}`;
