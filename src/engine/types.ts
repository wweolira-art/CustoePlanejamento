export type CellValue = number | string | boolean | Date | null;

export type RawCell =
  | null
  | number
  | string
  | boolean
  | { t: "date"; v: string }
  | { f: string; v?: unknown }
  | { v: unknown };

export interface SheetJson {
  name: string;
  maxRow: number;
  maxCol: number;
  rows: { r: number; c: RawCell[] }[];
}

export interface SheetIndexItem {
  name: string;
  file: string;
  rows: number;
  cols: number;
  filled: number;
}

export interface CellData {
  formula?: string;
  value: CellValue;
  cached?: CellValue;
}

export type SheetGrid = Map<string, CellData>;

export const colLetter = (col: number): string => {
  let n = col;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

export const colIndex = (letters: string): number => {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
};

export const cellKey = (row: number, col: number): string => `${colLetter(col)}${row}`;
