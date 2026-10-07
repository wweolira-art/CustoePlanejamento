import { db } from "./db.js";
import { previousSafra, resolveSafraId } from "./safras.js";

export interface HarvestArea {
  id: number;
  safraId: number;
  description: string;
  area: number;
}

function ensureHarvestAreas() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS harvest_areas (
      id INTEGER PRIMARY KEY,
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      area REAL NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS harvest_areas_safra_description
      ON harvest_areas (safra_id, description COLLATE NOCASE);
  `);
}

export function seedHarvestAreas() {
  ensureHarvestAreas();
}

function asNumber(raw: unknown, label: string) {
  const value = typeof raw === "string" ? Number(raw.replace(",", ".")) : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Informe um ${label} válido.`);
  return value;
}

function cleanDescription(raw: unknown) {
  const description = String(raw ?? "").trim();
  if (!description) throw new Error("Informe a descrição da área.");
  return description;
}

function mapRow(row: { id: number; safra_id: number; description: string; area: number }): HarvestArea {
  return {
    id: row.id,
    safraId: row.safra_id,
    description: row.description,
    area: row.area,
  };
}

function listRows(harvestId: number) {
  ensureHarvestAreas();
  const rows = db
    .prepare(
      `SELECT id, safra_id, description, area
         FROM harvest_areas
        WHERE safra_id = ?
        ORDER BY sort_order, description COLLATE NOCASE, id`,
    )
    .all(harvestId) as { id: number; safra_id: number; description: string; area: number }[];
  const prev = previousSafra(harvestId);
  const previousCount = prev
    ? (db.prepare("SELECT COUNT(*) AS n FROM harvest_areas WHERE safra_id = ?").get(prev.id) as { n: number }).n
    : 0;
  return {
    safraId: harvestId,
    previousSafra: prev,
    previousCount,
    areas: rows.map(mapRow),
    total: rows.reduce((sum, row) => sum + (Number(row.area) || 0), 0),
  };
}

function assertUnique(harvestId: number, description: string, exceptId?: number) {
  const existing = db
    .prepare(
      `SELECT id FROM harvest_areas
        WHERE safra_id = ? AND description = ? COLLATE NOCASE AND id != ifnull(?, 0)`,
    )
    .get(harvestId, description, exceptId ?? 0) as { id: number } | undefined;
  if (existing) throw new Error(`Já existe a área “${description}” nesta safra.`);
}

function nextSort(harvestId: number) {
  const row = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS n FROM harvest_areas WHERE safra_id = ?").get(harvestId) as {
    n: number;
  };
  return row.n + 1;
}

export function listHarvestAreas(safraId?: number | null) {
  return listRows(resolveSafraId(safraId));
}

export function createHarvestArea(input: { description?: string; area?: unknown; safraId?: number | null }) {
  ensureHarvestAreas();
  const harvestId = resolveSafraId(input.safraId);
  const description = cleanDescription(input.description);
  const area = asNumber(input.area, "hectare");
  if (!(area > 0)) throw new Error("Informe a área em hectares.");
  assertUnique(harvestId, description);
  db.prepare("INSERT INTO harvest_areas (safra_id, description, area, sort_order) VALUES (?, ?, ?, ?)").run(
    harvestId,
    description,
    area,
    nextSort(harvestId),
  );
  return listRows(harvestId);
}

export function updateHarvestArea(
  id: number,
  input: Partial<{ description: string; area: unknown; safraId: number | null }>,
) {
  ensureHarvestAreas();
  const current = db
    .prepare("SELECT id, safra_id, description, area FROM harvest_areas WHERE id = ?")
    .get(id) as { id: number; safra_id: number; description: string; area: number } | undefined;
  if (!current) throw new Error("Área não encontrada.");
  const harvestId = resolveSafraId(input.safraId ?? current.safra_id);
  const description = input.description !== undefined ? cleanDescription(input.description) : current.description;
  const area = input.area !== undefined ? asNumber(input.area, "hectare") : current.area;
  if (!(area > 0)) throw new Error("Informe a área em hectares.");
  assertUnique(harvestId, description, id);
  db.prepare("UPDATE harvest_areas SET safra_id = ?, description = ?, area = ? WHERE id = ?").run(
    harvestId,
    description,
    area,
    id,
  );
  return listRows(harvestId);
}

export function deleteHarvestArea(id: number) {
  ensureHarvestAreas();
  const row = db.prepare("SELECT safra_id FROM harvest_areas WHERE id = ?").get(id) as { safra_id: number } | undefined;
  if (!row) throw new Error("Área não encontrada.");
  db.prepare("DELETE FROM harvest_areas WHERE id = ?").run(id);
  return listRows(row.safra_id);
}

export function copyHarvestAreasBetween(sourceId: number, targetId: number) {
  ensureHarvestAreas();
  if (!sourceId || !targetId || sourceId === targetId) return listRows(targetId);
  const source = db
    .prepare(
      `SELECT description, area, sort_order
         FROM harvest_areas
        WHERE safra_id = ?
        ORDER BY sort_order, description COLLATE NOCASE, id`,
    )
    .all(sourceId) as { description: string; area: number; sort_order: number }[];
  if (!source.length) return listRows(targetId);
  const ins = db.prepare(
    "INSERT INTO harvest_areas (safra_id, description, area, sort_order) VALUES (?, ?, ?, ?)",
  );
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM harvest_areas WHERE safra_id = ?").run(targetId);
    for (const row of source) ins.run(targetId, row.description, row.area, row.sort_order);
  });
  tx();
  return listRows(targetId);
}

export function copyHarvestAreasFromPrevious(safraId?: number | null) {
  ensureHarvestAreas();
  const harvestId = resolveSafraId(safraId);
  const prev = previousSafra(harvestId);
  if (!prev) throw new Error("Não há safra anterior cadastrada.");
  const count = db.prepare("SELECT COUNT(*) AS n FROM harvest_areas WHERE safra_id = ?").get(prev.id) as { n: number };
  if (!count.n) throw new Error(`A ${prev.label} não tem áreas para copiar.`);
  return copyHarvestAreasBetween(prev.id, harvestId);
}
