import { colIndex } from "./types";
import {
  asDate,
  eomonth,
  excelDate,
  formatExcelText,
  toExcelSerial,
} from "./excelDate";

export class FormulaError extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export type EvalFn = (sheet: string, row: number, col: number) => unknown;

const isEmpty = (v: unknown): boolean =>
  v === null || v === undefined || v === "" || v === false;

const toNumber = (v: unknown): number => {
  if (v instanceof FormulaError) throw v;
  if (v instanceof Date) return toExcelSerial(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new FormulaError("#DIV/0!");
    return v;
  }
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "string") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const toText = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v === null || v === undefined) return "";
  return String(v);
};

const flatten = (args: unknown[]): unknown[] => {
  const out: unknown[] = [];
  for (const a of args) {
    if (Array.isArray(a)) out.push(...flatten(a));
    else out.push(a);
  }
  return out;
};

export class FormulaEngine {
  constructor(
    private sheetNames: string[],
    private evaluateCell: EvalFn,
  ) {
    this.sheetNames = [...sheetNames].sort((a, b) => b.length - a.length);
  }

  evaluate(formula: string, currentSheet: string): unknown {
    const src = formula.startsWith("=") ? formula.slice(1) : formula;
    const parser = new Parser(src, currentSheet, this.sheetNames, this.evaluateCell);
    return parser.parse();
  }
}

class Parser {
  i = 0;
  constructor(
    private s: string,
    private currentSheet: string,
    private sheetNames: string[],
    private evaluateCell: EvalFn,
  ) {}

  parse(): unknown {
    const v = this.parseComparison();
    this.skip();
    return v;
  }

  private peek(): string {
    return this.s[this.i] ?? "";
  }

  private skip() {
    while (this.s[this.i] === " ") this.i++;
  }

  private parseComparison(): unknown {
    let left = this.parseConcat();
    this.skip();
    while (true) {
      const op = this.matchOp(["<>", "<=", ">=", "=", "<", ">"]);
      if (!op) break;
      const right = this.parseConcat();
      if (op === "=") left = this.eq(left, right);
      else if (op === "<>") left = !this.eq(left, right);
      else {
        const a = toNumber(left);
        const b = toNumber(right);
        if (op === "<") left = a < b;
        else if (op === ">") left = a > b;
        else if (op === "<=") left = a <= b;
        else left = a >= b;
      }
      this.skip();
    }
    return left;
  }

  private eq(a: unknown, b: unknown): boolean {
    if (isEmpty(a) && isEmpty(b)) return true;
    if (typeof a === "string" || typeof b === "string") {
      return toText(a).toLowerCase() === toText(b).toLowerCase();
    }
    if (a instanceof Date || b instanceof Date) return toNumber(a) === toNumber(b);
    return toNumber(a) === toNumber(b);
  }

  private parseConcat(): unknown {
    let left = this.parseAdd();
    this.skip();
    while (this.peek() === "&") {
      this.i++;
      const right = this.parseAdd();
      left = toText(left) + toText(right);
      this.skip();
    }
    return left;
  }

  private parseAdd(): unknown {
    let left = this.parseMul();
    this.skip();
    while (this.peek() === "+" || this.peek() === "-") {
      const op = this.peek();
      this.i++;
      const right = this.parseMul();
      left = op === "+" ? toNumber(left) + toNumber(right) : toNumber(left) - toNumber(right);
      this.skip();
    }
    return left;
  }

  private parseMul(): unknown {
    let left = this.parsePow();
    this.skip();
    while (this.peek() === "*" || this.peek() === "/") {
      const op = this.peek();
      this.i++;
      const right = this.parsePow();
      if (op === "*") left = toNumber(left) * toNumber(right);
      else {
        const d = toNumber(right);
        if (d === 0) throw new FormulaError("#DIV/0!");
        left = toNumber(left) / d;
      }
      this.skip();
    }
    return left;
  }

  private parsePow(): unknown {
    let left = this.parseUnary();
    this.skip();
    if (this.peek() === "^") {
      this.i++;
      const right = this.parsePow();
      left = Math.pow(toNumber(left), toNumber(right));
    }
    return left;
  }

  private parseUnary(): unknown {
    this.skip();
    if (this.peek() === "+") {
      this.i++;
      return this.parseUnary();
    }
    if (this.peek() === "-") {
      this.i++;
      return -toNumber(this.parseUnary());
    }
    return this.parsePrimary();
  }

  private parsePrimary(): unknown {
    this.skip();
    const ch = this.peek();
    if (ch === "(") {
      this.i++;
      const v = this.parseComparison();
      this.skip();
      if (this.peek() === ")") this.i++;
      return v;
    }
    if (ch === '"') return this.parseString();
    if (ch >= "0" && ch <= "9") return this.parseNumber();
    if (ch === "." && /\d/.test(this.s[this.i + 1] ?? "")) return this.parseNumber();
    if (ch === "#") return this.parseErrorLiteral();
    return this.parseNameOrRef();
  }

  private parseString(): string {
    this.i++;
    let out = "";
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === '"') {
        if (this.s[this.i] === '"') {
          out += '"';
          this.i++;
        } else break;
      } else out += c;
    }
    return out;
  }

  private parseNumber(): number {
    const start = this.i;
    while (/[0-9.]/.test(this.peek())) this.i++;
    if (this.peek() === "E" || this.peek() === "e") {
      this.i++;
      if (this.peek() === "+" || this.peek() === "-") this.i++;
      while (/[0-9]/.test(this.peek())) this.i++;
    }
    if (this.peek() === "%") {
      this.i++;
      return Number(this.s.slice(start, this.i - 1)) / 100;
    }
    return Number(this.s.slice(start, this.i));
  }

  private parseErrorLiteral(): unknown {
    const start = this.i;
    while (this.i < this.s.length && /[#A-Z0-9/!]/.test(this.s[this.i])) this.i++;
    throw new FormulaError(this.s.slice(start));
  }

  private parseNameOrRef(): unknown {
    this.skip();
    if (this.s.startsWith("[", this.i) || this.s.startsWith("'[", this.i)) {
      throw new FormulaError("#EXTERNAL");
    }

    let sheet = this.currentSheet;
    const quoted = this.tryQuotedSheet();
    if (quoted) sheet = quoted;
    else {
      const known = this.tryKnownSheet();
      if (known) sheet = known;
    }

    this.skip();
    if (this.s.startsWith("#REF!", this.i) || this.s.startsWith("#REF", this.i)) {
      throw new FormulaError("#REF!");
    }

    const ident = this.readIdent();
    this.skip();
    if (this.peek() === "(") {
      this.i++;
      const args = this.parseArgs();
      return this.callFn(ident, args);
    }

    if (ident && /^\$?[A-Z]+\$?\d+$/i.test(ident)) {
      return this.resolveRef(sheet, ident);
    }

    const ref = this.readCellRef();
    if (ref) return this.resolveRef(sheet, ref);

    if (/^(TRUE|FALSE)$/i.test(ident)) return ident.toUpperCase() === "TRUE";
    throw new FormulaError("#NAME?", ident);
  }

  private tryQuotedSheet(): string | null {
    if (this.peek() !== "'") return null;
    const end = this.s.indexOf("'!", this.i + 1);
    if (end < 0) return null;
    const name = this.s.slice(this.i + 1, end);
    this.i = end + 2;
    return name;
  }

  private tryKnownSheet(): string | null {
    const rest = this.s.slice(this.i);
    for (const name of this.sheetNames) {
      if (rest.startsWith(name + "!")) {
        this.i += name.length + 1;
        return name;
      }
    }
    return null;
  }

  private readIdent(): string {
    const start = this.i;
    if (/[A-Za-z_\u00C0-\u024F]/.test(this.peek()) || this.peek() === "$") {
      this.i++;
      while (/[A-Za-z0-9_\u00C0-\u024F.$]/.test(this.peek())) this.i++;
    }
    return this.s.slice(start, this.i);
  }

  private readCellRef(): string | null {
    const start = this.i;
    if (this.peek() === "$") this.i++;
    if (!/[A-Za-z]/.test(this.peek())) {
      this.i = start;
      return null;
    }
    while (/[A-Za-z]/.test(this.peek())) this.i++;
    if (this.peek() === "$") this.i++;
    if (!/[0-9]/.test(this.peek())) {
      this.i = start;
      return null;
    }
    while (/[0-9]/.test(this.peek())) this.i++;
    return this.s.slice(start, this.i);
  }

  private parseArgs(): unknown[] {
    const args: unknown[] = [];
    this.skip();
    if (this.peek() === ")") {
      this.i++;
      return args;
    }
    while (this.i < this.s.length) {
      try {
        args.push(this.parseArg());
      } catch (err) {
        args.push(err instanceof FormulaError ? err : new FormulaError("#VALUE!"));
      }
      this.skip();
      if (this.peek() === "," || this.peek() === ";") {
        this.i++;
        continue;
      }
      if (this.peek() === ")") {
        this.i++;
        break;
      }
      break;
    }
    return args;
  }

  private parseArg(): unknown {
    this.skip();
    const start = this.i;
    const sheetGuess = this.tryQuotedSheet() ?? this.tryKnownSheet();
    const a = this.readCellRef();
    this.skip();
    if (a && this.peek() === ":") {
      this.i++;
      this.skip();
      const b = this.readCellRef();
      if (b) {
        return this.resolveRange(sheetGuess ?? this.currentSheet, a, b);
      }
    }
    this.i = start;
    return this.parseComparison();
  }

  private parseRefParts(ref: string): { row: number; col: number } {
    const m = ref.replace(/\$/g, "").match(/^([A-Z]+)(\d+)$/i);
    if (!m) throw new FormulaError("#REF!", ref);
    return { col: colIndex(m[1]), row: Number(m[2]) };
  }

  private resolveRef(sheet: string, ref: string): unknown {
    const { row, col } = this.parseRefParts(ref);
    return this.evaluateCell(sheet, row, col);
  }

  private resolveRange(sheet: string, a: string, b: string): unknown[] {
    const p1 = this.parseRefParts(a);
    const p2 = this.parseRefParts(b);
    const r1 = Math.min(p1.row, p2.row);
    const r2 = Math.max(p1.row, p2.row);
    const c1 = Math.min(p1.col, p2.col);
    const c2 = Math.max(p1.col, p2.col);
    const out: unknown[] = [];
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        out.push(this.evaluateCell(sheet, r, c));
      }
    }
    return out;
  }

  private callFn(name: string, args: unknown[]): unknown {
    const fn = name.toUpperCase();
    const flat = flatten(args);
    switch (fn) {
      case "SUM":
        return flat.reduce<number>((acc, v) => {
          if (v instanceof FormulaError) return acc;
          if (typeof v === "string" && v.startsWith("#")) return acc;
          return acc + toNumber(v);
        }, 0);
      case "IF": {
        const cond = args[0];
        const truthy =
          cond === true ||
          (typeof cond === "number" && cond !== 0) ||
          (typeof cond === "string" && cond !== "" && cond.toLowerCase() !== "false");
        return truthy ? (args[1] ?? true) : (args[2] ?? false);
      }
      case "IFERROR":
        try {
          const v = args[0];
          if (v instanceof FormulaError) return args[1] ?? 0;
          if (typeof v === "string" && v.startsWith("#")) return args[1] ?? 0;
          return v;
        } catch {
          return args[1] ?? 0;
        }
      case "DATE":
        return excelDate(toNumber(args[0]), toNumber(args[1]), toNumber(args[2]));
      case "YEAR": {
        const d = asDate(args[0]) ?? fromNum(args[0]);
        return d.getUTCFullYear();
      }
      case "MONTH": {
        const d = asDate(args[0]) ?? fromNum(args[0]);
        return d.getUTCMonth() + 1;
      }
      case "DAY": {
        const d = asDate(args[0]) ?? fromNum(args[0]);
        return d.getUTCDate();
      }
      case "EOMONTH": {
        const d = asDate(args[0]) ?? fromNum(args[0]);
        return eomonth(d, toNumber(args[1] ?? 0));
      }
      case "TEXT":
        return formatExcelText(
          (asDate(args[0]) ?? args[0]) as Date | number,
          toText(args[1]),
        );
      case "UPPER":
        return toText(args[0]).toUpperCase();
      case "LOWER":
        return toText(args[0]).toLowerCase();
      case "ABS":
        return Math.abs(toNumber(args[0]));
      case "ROUND":
        return roundTo(toNumber(args[0]), toNumber(args[1] ?? 0));
      case "MAX":
        return Math.max(...flat.map(toNumber));
      case "MIN":
        return Math.min(...flat.map(toNumber));
      case "AVERAGE": {
        const nums = flat.filter((v) => !isEmpty(v)).map(toNumber);
        if (!nums.length) throw new FormulaError("#DIV/0!");
        return nums.reduce((a, b) => a + b, 0) / nums.length;
      }
      case "AND":
        return args.every((v) => Boolean(v) && v !== 0 && v !== "");
      case "OR":
        return args.some((v) => Boolean(v) && v !== 0 && v !== "");
      case "ISBLANK":
        return isEmpty(args[0]);
      case "ISERROR":
        return args[0] instanceof FormulaError || (typeof args[0] === "string" && args[0].startsWith("#"));
      case "N":
        return toNumber(args[0]);
      case "VALUE":
        return toNumber(args[0]);
      default:
        throw new FormulaError("#NAME?", fn);
    }
  }

  private matchOp(ops: string[]): string | null {
    for (const op of ops) {
      if (this.s.startsWith(op, this.i)) {
        this.i += op.length;
        return op;
      }
    }
    return null;
  }
}

function fromNum(v: unknown): Date {
  const n = toNumber(v);
  const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
  return new Date(EXCEL_EPOCH_MS + Math.round(n) * 86400000);
}

function roundTo(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
