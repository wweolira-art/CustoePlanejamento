import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { isCategoryLabel, isTotalLabel, sheetKind, SHEET_TITLES } from "./catalog.js";
import type { RawCell, SheetIndexItem, SheetJson } from "../src/engine/types.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "public", "data");

const encodeValue = (raw: RawCell): { formula: string | null; value: string | null } => {
  if (raw == null) return { formula: null, value: null };
  if (typeof raw === "object" && "f" in raw) {
    return { formula: raw.f, value: JSON.stringify(raw.v ?? null) };
  }
  if (typeof raw === "object" && "t" in raw) {
    return { formula: null, value: JSON.stringify(raw) };
  }
  if (typeof raw === "object" && "v" in raw) {
    return { formula: null, value: JSON.stringify(raw.v ?? null) };
  }
  return { formula: null, value: JSON.stringify(raw) };
};

const cellText = (raw: RawCell): string => {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return "";
};

const monthPayload = (raw: RawCell): { formula: string | null; value: string | null } | null => {
  if (raw == null) return null;
  const enc = encodeValue(raw);
  if (!enc.formula && (enc.value == null || enc.value === "null" || enc.value === "0")) return null;
  return enc;
};

export function importFromJson(force = false) {
  const already = db.prepare("SELECT value FROM meta WHERE key = 'imported'").get() as { value: string } | undefined;
  if (already && !force) return { imported: false };

  const index = JSON.parse(fs.readFileSync(path.join(dataDir, "index.json"), "utf8")) as SheetIndexItem[];

  const tx = db.transaction(() => {
    db.exec("DELETE FROM line_months; DELETE FROM lines; DELETE FROM categories; DELETE FROM cells; DELETE FROM sheets;");

    const insertSheet = db.prepare(
      "INSERT INTO sheets (name, title, kind, sort_order, visible) VALUES (?, ?, ?, ?, 1)",
    );
    const insertCell = db.prepare(
      "INSERT INTO cells (sheet_id, row, col, formula, value) VALUES (?, ?, ?, ?, ?)",
    );
    const insertCat = db.prepare("INSERT INTO categories (sheet_id, name, sort_order) VALUES (?, ?, ?)");
    const insertLine = db.prepare(
      `INSERT INTO lines (sheet_id, category_id, object_code, product_code, item_type, description, is_group, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertMonth = db.prepare(
      "INSERT INTO line_months (line_id, month_index, formula, value) VALUES (?, ?, ?, ?)",
    );

    index.forEach((item, order) => {
      const json = JSON.parse(fs.readFileSync(path.join(dataDir, item.file), "utf8")) as SheetJson;
      const kind = sheetKind(item.name);
      const info = insertSheet.run(
        item.name,
        SHEET_TITLES[item.name] ?? item.name,
        kind,
        order,
      );
      const sheetId = Number(info.lastInsertRowid);

      const byRow = new Map<number, RawCell[]>();
      let maxRow = 0;
      for (const row of json.rows) {
        byRow.set(row.r, row.c);
        maxRow = Math.max(maxRow, row.r);
        row.c.forEach((raw, idx) => {
          if (raw == null) return;
          const enc = encodeValue(raw);
          insertCell.run(sheetId, row.r, idx + 1, enc.formula, enc.value);
        });
      }

      if (kind !== "cost_center") return;

      let categoryId: number | null = null;
      let catOrder = 0;
      let lineOrder = 0;

      for (let r = 1; r <= maxRow; r++) {
        const cols = byRow.get(r) ?? [];
        const label = cellText(cols[3] ?? cols[0]);
        if (isTotalLabel(label)) break;
        if (isCategoryLabel(label)) {
          const created = insertCat.run(sheetId, label.trim(), catOrder++);
          categoryId = Number(created.lastInsertRowid);
          lineOrder = 0;
          continue;
        }
        if (!categoryId || !label.trim()) continue;

        const obj = cellText(cols[0]);
        const prod = cellText(cols[1]);
        const typ = cellText(cols[2]);
        const months = Array.from({ length: 12 }, (_, i) => monthPayload(cols[4 + i] ?? null));
        const hasMonth = months.some(Boolean);
        const isGroup = !obj && !prod && !hasMonth;
        if (isGroup && label.length < 3) continue;

        const line = insertLine.run(
          sheetId,
          categoryId,
          obj || null,
          prod || null,
          typ || null,
          label.trim(),
          isGroup ? 1 : 0,
          lineOrder++,
        );
        const lineId = Number(line.lastInsertRowid);
        months.forEach((m, i) => {
          if (!m) return;
          insertMonth.run(lineId, i, m.formula, m.value);
        });
      }
    });

    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('imported', ?)").run(new Date().toISOString());
  });

  tx();
  return { imported: true, sheets: index.length };
}
