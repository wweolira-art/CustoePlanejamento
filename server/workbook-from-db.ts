import { db } from "./db.js";
import { Workbook } from "../src/engine/workbook.ts";
import type { RawCell, SheetJson } from "../src/engine/types.ts";

const parseValue = (value: string | null): RawCell => {
  if (value == null) return null;
  try {
    return JSON.parse(value) as RawCell;
  } catch {
    return value;
  }
};

let cached: Workbook | null = null;

export function invalidateWorkbook() {
  cached = null;
}

export function workbookFromDb(includeHidden = false): Workbook {
  if (!includeHidden && cached) return cached;
  const wb = loadWorkbook(includeHidden);
  if (!includeHidden) cached = wb;
  return wb;
}

function loadWorkbook(includeHidden = false): Workbook {
  const sheets = db
    .prepare(includeHidden ? "SELECT * FROM sheets" : "SELECT * FROM sheets WHERE visible = 1 OR kind = 'premissas'")
    .all() as { id: number; name: string }[];

  const cellStmt = db.prepare("SELECT row, col, formula, value FROM cells WHERE sheet_id = ? ORDER BY row, col");
  const data: SheetJson[] = sheets.map((sheet) => {
    const cells = cellStmt.all(sheet.id) as { row: number; col: number; formula: string | null; value: string | null }[];
    const byRow = new Map<number, RawCell[]>();
    let maxRow = 1;
    let maxCol = 1;
    for (const cell of cells) {
      maxRow = Math.max(maxRow, cell.row);
      maxCol = Math.max(maxCol, cell.col);
      const arr = byRow.get(cell.row) ?? [];
      while (arr.length < cell.col) arr.push(null);
      arr[cell.col - 1] = cell.formula
        ? { f: cell.formula, v: parseValue(cell.value) }
        : parseValue(cell.value);
      byRow.set(cell.row, arr);
    }
    const rows = [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([r, c]) => ({ r, c }));
    return { name: sheet.name, maxRow, maxCol, rows };
  });

  return new Workbook(data);
}
