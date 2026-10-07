import { db } from "./db.js";
import { listSafras, previousSafra, resolveSafraId } from "./safras.js";

export interface SeedRadiusTariff {
  id: number;
  safraId: number;
  startKm: number;
  endKm: number;
  price: number;
}

export const DEFAULT_SEED_RADIUS_TARIFFS = [
  { startKm: 0, endKm: 5, price: 205 },
  { startKm: 5.01, endKm: 10, price: 244 },
  { startKm: 10.01, endKm: 15, price: 280.3 },
  { startKm: 15.01, endKm: 20, price: 322.91 },
  { startKm: 20.01, endKm: 25, price: 355.61 },
  { startKm: 25.01, endKm: 30, price: 393.77 },
  { startKm: 30.01, endKm: 35, price: 429.4 },
  { startKm: 35.01, endKm: 40, price: 466.62 },
  { startKm: 40.01, endKm: 45, price: 504.53 },
  { startKm: 45.01, endKm: 50, price: 541.78 },
  { startKm: 50.01, endKm: 55, price: 580.75 },
  { startKm: 55.01, endKm: 60, price: 616.22 },
  { startKm: 60.01, endKm: 65, price: 656.3 },
  { startKm: 65.01, endKm: 70, price: 689.97 },
] as const;

function ensureSeedRadiusTariffs() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS seed_radius_tariffs (
      id INTEGER PRIMARY KEY,
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      start_km REAL NOT NULL,
      end_km REAL NOT NULL,
      price REAL NOT NULL
    );
  `);
  seedDefaultSeedRadiusTariffs();
}

export function seedDefaultSeedRadiusTariffs() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS seed_radius_tariffs (
      id INTEGER PRIMARY KEY,
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      start_km REAL NOT NULL,
      end_km REAL NOT NULL,
      price REAL NOT NULL
    );
  `);
  const ins = db.prepare(
    "INSERT INTO seed_radius_tariffs (safra_id, start_km, end_km, price) VALUES (?, ?, ?, ?)",
  );
  const count = db.prepare("SELECT COUNT(*) AS n FROM seed_radius_tariffs WHERE safra_id = ?");
  const tx = db.transaction(() => {
    for (const safra of listSafras()) {
      if ((count.get(safra.id) as { n: number }).n) continue;
      for (const row of DEFAULT_SEED_RADIUS_TARIFFS) {
        ins.run(safra.id, row.startKm, row.endKm, row.price);
      }
    }
  });
  tx();
}

function asNumber(raw: unknown, label: string) {
  const value = typeof raw === "string" ? Number(raw.replace(",", ".")) : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Informe um ${label} válido.`);
  return value;
}

function mapRow(row: { id: number; safra_id: number; start_km: number; end_km: number; price: number }): SeedRadiusTariff {
  return {
    id: row.id,
    safraId: row.safra_id,
    startKm: row.start_km,
    endKm: row.end_km,
    price: row.price,
  };
}

function listRows(harvestId: number) {
  ensureSeedRadiusTariffs();
  const rows = db
    .prepare(
      `SELECT id, safra_id, start_km, end_km, price
         FROM seed_radius_tariffs
        WHERE safra_id = ?
        ORDER BY start_km, end_km, id`,
    )
    .all(harvestId) as { id: number; safra_id: number; start_km: number; end_km: number; price: number }[];
  const prev = previousSafra(harvestId);
  const previousCount = prev
    ? (db.prepare("SELECT COUNT(*) AS n FROM seed_radius_tariffs WHERE safra_id = ?").get(prev.id) as { n: number }).n
    : 0;
  return {
    safraId: harvestId,
    previousSafra: prev,
    previousCount,
    tariffs: rows.map(mapRow),
  };
}

function assertRange(startKm: number, endKm: number, price: number, harvestId: number, exceptId?: number) {
  if (startKm < 0 || endKm < 0) throw new Error("O raio não pode ser negativo.");
  if (!(endKm > startKm)) throw new Error("O valor final precisa ser maior que o valor inicial.");
  if (!(price > 0)) throw new Error("Informe o preço da faixa.");
  const overlap = db
    .prepare(
      `SELECT id, start_km, end_km
         FROM seed_radius_tariffs
        WHERE safra_id = ?
          AND id != ifnull(?, 0)
          AND start_km < ?
          AND end_km > ?`,
    )
    .get(harvestId, exceptId ?? 0, endKm, startKm) as { id: number; start_km: number; end_km: number } | undefined;
  if (overlap) {
    throw new Error(
      `Essa faixa cruza outra já cadastrada (${overlap.start_km} a ${overlap.end_km} km).`,
    );
  }
}

export function listSeedRadiusTariffs(safraId?: number | null) {
  const harvestId = resolveSafraId(safraId);
  return listRows(harvestId);
}

export function createSeedRadiusTariff(input: {
  startKm: number;
  endKm: number;
  price: number;
  safraId?: number | null;
}) {
  ensureSeedRadiusTariffs();
  const harvestId = resolveSafraId(input.safraId);
  const startKm = asNumber(input.startKm, "valor inicial");
  const endKm = asNumber(input.endKm, "valor final");
  const price = asNumber(input.price, "preço");
  assertRange(startKm, endKm, price, harvestId);
  db.prepare(
    "INSERT INTO seed_radius_tariffs (safra_id, start_km, end_km, price) VALUES (?, ?, ?, ?)",
  ).run(harvestId, startKm, endKm, price);
  return listRows(harvestId);
}

export function updateSeedRadiusTariff(
  id: number,
  input: Partial<{ startKm: number; endKm: number; price: number; safraId: number | null }>,
) {
  ensureSeedRadiusTariffs();
  const current = db
    .prepare("SELECT id, safra_id, start_km, end_km, price FROM seed_radius_tariffs WHERE id = ?")
    .get(id) as { id: number; safra_id: number; start_km: number; end_km: number; price: number } | undefined;
  if (!current) throw new Error("Faixa não encontrada.");
  const harvestId = resolveSafraId(input.safraId ?? current.safra_id);
  const startKm = input.startKm !== undefined ? asNumber(input.startKm, "valor inicial") : current.start_km;
  const endKm = input.endKm !== undefined ? asNumber(input.endKm, "valor final") : current.end_km;
  const price = input.price !== undefined ? asNumber(input.price, "preço") : current.price;
  assertRange(startKm, endKm, price, harvestId, id);
  db.prepare(
    "UPDATE seed_radius_tariffs SET safra_id = ?, start_km = ?, end_km = ?, price = ? WHERE id = ?",
  ).run(harvestId, startKm, endKm, price, id);
  return listRows(harvestId);
}

export function deleteSeedRadiusTariff(id: number) {
  ensureSeedRadiusTariffs();
  const row = db.prepare("SELECT safra_id FROM seed_radius_tariffs WHERE id = ?").get(id) as
    | { safra_id: number }
    | undefined;
  if (!row) throw new Error("Faixa não encontrada.");
  db.prepare("DELETE FROM seed_radius_tariffs WHERE id = ?").run(id);
  return listRows(row.safra_id);
}

export function copySeedRadiusTariffsBetween(sourceId: number, targetId: number) {
  ensureSeedRadiusTariffs();
  if (!sourceId || !targetId || sourceId === targetId) return listRows(targetId);
  const source = db
    .prepare("SELECT start_km, end_km, price FROM seed_radius_tariffs WHERE safra_id = ? ORDER BY start_km")
    .all(sourceId) as { start_km: number; end_km: number; price: number }[];
  if (!source.length) return listRows(targetId);
  const ins = db.prepare(
    "INSERT INTO seed_radius_tariffs (safra_id, start_km, end_km, price) VALUES (?, ?, ?, ?)",
  );
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM seed_radius_tariffs WHERE safra_id = ?").run(targetId);
    for (const row of source) ins.run(targetId, row.start_km, row.end_km, row.price);
  });
  tx();
  return listRows(targetId);
}

export function copySeedRadiusTariffsFromPrevious(safraId?: number | null) {
  ensureSeedRadiusTariffs();
  const harvestId = resolveSafraId(safraId);
  const prev = previousSafra(harvestId);
  if (!prev) throw new Error("Não há safra anterior cadastrada.");
  const count = db.prepare("SELECT COUNT(*) AS n FROM seed_radius_tariffs WHERE safra_id = ?").get(prev.id) as { n: number };
  if (!count.n) throw new Error(`A ${prev.label} não tem faixas de raio para copiar.`);
  return copySeedRadiusTariffsBetween(prev.id, harvestId);
}
