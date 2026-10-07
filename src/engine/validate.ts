import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Workbook } from "./workbook";
import type { SheetIndexItem, SheetJson } from "./types";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../public/data");
const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8")) as SheetIndexItem[];
const sheets = index.map((item) => JSON.parse(readFileSync(join(root, item.file), "utf8")) as SheetJson);
const wb = new Workbook(sheets);

const targets = ["PREMISSAS", "PLANTIO", "P.SOLO", "CORTE SEMENTE", "T.C.P.", "RESUMO"];
let checked = 0;
let mismatch = 0;

for (const name of targets) {
  const sheet = sheets.find((s) => s.name === name);
  if (!sheet) continue;
  for (const row of sheet.rows) {
    row.c.forEach((raw, idx) => {
      if (!raw || typeof raw !== "object" || !("f" in raw) || !("v" in raw)) return;
      const cached = raw.v;
      if (typeof cached !== "number") return;
      const got = wb.display(name, row.r, idx + 1);
      if (typeof got !== "number") return;
      checked++;
      if (Math.abs(got - cached) > 0.6) {
        mismatch++;
        if (mismatch <= 40) {
          const col = idx + 1;
          const letters = col <= 26 ? String.fromCharCode(64 + col) : `C${col}`;
          console.log(`${name}!${letters}${row.r} got=${got.toFixed(2)} excel=${cached.toFixed(2)} d=${(got - cached).toFixed(2)} ${String(raw.f).slice(0, 80)}`);
        }
      }
    });
  }
}

console.log(`checked=${checked} mismatch=${mismatch}`);
