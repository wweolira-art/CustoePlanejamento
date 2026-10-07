import { db } from "./db.js";
import { resolveSafraId } from "./safras.js";

const SEEDED_KEY = "line_safra_prices_seeded";

export function ensureLineSafraPrices() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS line_safra_prices (
      line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      calc_price REAL NOT NULL,
      PRIMARY KEY (line_id, safra_id)
    );
  `);
  seedLineSafraPrices();
}

function seedLineSafraPrices() {
  const done = db.prepare("SELECT value FROM meta WHERE key = ?").get(SEEDED_KEY) as { value: string } | undefined;
  if (done?.value === "1") return;
  db.exec(`
    INSERT OR IGNORE INTO line_safra_prices (line_id, safra_id, calc_price)
    SELECT l.id, s.id, l.calc_price
      FROM lines l
      CROSS JOIN safras s
     WHERE l.ref_kind = 'material'
       AND l.calc_price IS NOT NULL
       AND l.calc_price > 0
  `);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')").run(SEEDED_KEY);
}

export function lineSafraPriceMap(safraId?: number | null) {
  ensureLineSafraPrices();
  const harvestId = resolveSafraId(safraId);
  const rows = db
    .prepare("SELECT line_id, calc_price FROM line_safra_prices WHERE safra_id = ?")
    .all(harvestId) as { line_id: number; calc_price: number }[];
  return new Map(rows.map((row) => [row.line_id, row.calc_price]));
}

export function overlayMaterialPrice<T extends {
  id: number;
  ref_kind?: string | null;
  material_id?: number | null;
  calc_price?: number | null;
}>(line: T, prices: Map<number, number>): T {
  if (line.ref_kind !== "material" && line.ref_kind !== "cost_object" && !line.material_id) return line;
  const price = prices.get(line.id);
  return { ...line, calc_price: price != null && Number(price) > 0 ? Number(price) : null };
}

export function setLineSafraPrice(lineId: number, price: number | null, safraId?: number | null) {
  ensureLineSafraPrices();
  const harvestId = resolveSafraId(safraId);
  if (!(Number(price) > 0)) {
    db.prepare("DELETE FROM line_safra_prices WHERE line_id = ? AND safra_id = ?").run(lineId, harvestId);
    return;
  }
  db.prepare(
    `INSERT INTO line_safra_prices (line_id, safra_id, calc_price)
     VALUES (?, ?, ?)
     ON CONFLICT(line_id, safra_id) DO UPDATE SET calc_price = excluded.calc_price`,
  ).run(lineId, harvestId, Number(price));
}

export function copyLineSafraPricesBetween(sourceId: number, targetId: number) {
  ensureLineSafraPrices();
  if (!sourceId || !targetId || sourceId === targetId) return;
  const ins = db.prepare(
    `INSERT INTO line_safra_prices (line_id, safra_id, calc_price)
     SELECT line_id, ?, calc_price FROM line_safra_prices WHERE safra_id = ?`,
  );
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM line_safra_prices WHERE safra_id = ?").run(targetId);
    ins.run(targetId, sourceId);
  });
  tx();
}
