import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Workbook } from "./workbook";
import type { SheetIndexItem, SheetJson } from "./types";
import { num, sheetTotal } from "../lib/calc";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../public/data");
const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8")) as SheetIndexItem[];
const sheets = index.map((item) => JSON.parse(readFileSync(join(root, item.file), "utf8")) as SheetJson);
const wb = new Workbook(sheets);

const beforeHa = num(wb, "PREMISSAS", 26, 6);
const beforePlantio = sheetTotal(wb, "PLANTIO");
const beforeInsumo = num(wb, "PLANTIO", 52, 6);

wb.setCell("PREMISSAS", 25, 2, "1666");

const afterHa = num(wb, "PREMISSAS", 26, 6);
const afterPlantio = sheetTotal(wb, "PLANTIO");
const afterInsumo = num(wb, "PLANTIO", 52, 6);

console.log({
  haOutubro: { before: beforeHa, after: afterHa },
  altacorOutubro: { before: beforeInsumo, after: afterInsumo },
  totalPlantio: { before: beforePlantio, after: afterPlantio },
  haDobrou: Math.abs(afterHa / beforeHa - 2) < 0.05,
  insumoDobrou: Math.abs(afterInsumo / beforeInsumo - 2) < 0.05,
});
