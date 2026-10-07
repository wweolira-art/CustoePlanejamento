import { db } from "./db.js";

export interface Safra {
  id: number;
  code: string;
  label: string;
}

export function normalizeSafraCode(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/^safra\s+/i, "").replace(/\s+/g, "");
  const match = cleaned.match(/^(?:20)?(\d{2})\/(?:20)?(\d{2})$/);
  if (!match) throw new Error("Use o formato da safra, por exemplo 25/26.");
  const start = match[1];
  const end = match[2];
  if ((Number(start) + 1) % 100 !== Number(end)) {
    throw new Error("A safra precisa ser dois anos seguidos, como 25/26.");
  }
  return `${start}/${end}`;
}

export function safraLabel(code: string) {
  return `Safra ${code}`;
}

function readCurrentSafraId(): number | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'current_safra_id'").get() as { value: string } | undefined;
  const id = Number(row?.value);
  if (id && db.prepare("SELECT id FROM safras WHERE id = ?").get(id)) return id;
  return null;
}

export function ensureSafras() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS safras (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL
    );
  `);
  try {
    db.exec("ALTER TABLE calc_params ADD COLUMN safra_id INTEGER REFERENCES safras(id)");
  } catch {
    /* coluna já existe */
  }

  const count = db.prepare("SELECT COUNT(*) AS n FROM safras").get() as { n: number };
  if (count.n === 0) {
    const ins = db.prepare("INSERT INTO safras (code, label) VALUES (?, ?)");
    ins.run("25/26", safraLabel("25/26"));
    ins.run("26/27", safraLabel("26/27"));
  }

  let current = readCurrentSafraId();
  if (!current) {
    const preferred = db.prepare("SELECT id FROM safras WHERE code = '25/26'").get() as { id: number } | undefined;
    const first = preferred ?? (db.prepare("SELECT id FROM safras ORDER BY code").get() as { id: number });
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('current_safra_id', ?)").run(String(first.id));
    current = first.id;
  }

  try {
    db.prepare("UPDATE calc_params SET safra_id = ? WHERE safra_id IS NULL").run(current);
  } catch {
    /* tabela ainda não existe */
  }
}

export function listSafras(): Safra[] {
  ensureSafras();
  return db.prepare("SELECT id, code, label FROM safras ORDER BY code").all() as Safra[];
}

export function currentSafraId(): number {
  ensureSafras();
  return readCurrentSafraId() as number;
}

export function safraStartYear(code: string): number {
  const match = code.match(/^(\d{2})\//);
  if (!match) return new Date().getFullYear();
  const yy = Number(match[1]);
  return yy >= 90 ? 1900 + yy : 2000 + yy;
}

export function currentSafraStartYear(): number {
  const id = currentSafraId();
  const row = db.prepare("SELECT code FROM safras WHERE id = ?").get(id) as { code: string } | undefined;
  return row ? safraStartYear(row.code) : 2026;
}

export function safrasState() {
  return { safras: listSafras(), currentId: currentSafraId() };
}

export function resolveSafraId(id?: number | null) {
  ensureSafras();
  if (id && db.prepare("SELECT id FROM safras WHERE id = ?").get(id)) return id;
  return currentSafraId();
}

export function previousSafra(safraId?: number | null): Safra | null {
  const id = resolveSafraId(safraId);
  const current = db.prepare("SELECT id, code, label FROM safras WHERE id = ?").get(id) as Safra | undefined;
  if (!current) return null;
  const currentYear = safraStartYear(current.code);
  const earlier = listSafras()
    .filter((row) => safraStartYear(row.code) < currentYear)
    .sort((a, b) => safraStartYear(b.code) - safraStartYear(a.code));
  return earlier[0] ?? null;
}

export function setCurrentSafra(id: number) {
  ensureSafras();
  const row = db.prepare("SELECT id FROM safras WHERE id = ?").get(id);
  if (!row) throw new Error("Safra não encontrada.");
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('current_safra_id', ?)").run(String(id));
  return safrasState();
}

export function suggestedSafraCode() {
  const rows = listSafras();
  const years = rows.map((row) => safraStartYear(row.code));
  const start = (years.length ? Math.max(...years) : new Date().getFullYear()) + 1;
  const yy = start % 100;
  return `${String(yy).padStart(2, "0")}/${String((yy + 1) % 100).padStart(2, "0")}`;
}

export function createSafra(raw: string, label?: string | null) {
  ensureSafras();
  const code = normalizeSafraCode(raw.trim() ? raw : suggestedSafraCode());
  const existing = db.prepare("SELECT id FROM safras WHERE code = ?").get(code);
  if (existing) throw new Error("Já existe uma safra com esse período.");
  const name = label?.trim() || safraLabel(code);
  const id = Number(db.prepare("INSERT INTO safras (code, label) VALUES (?, ?)").run(code, name).lastInsertRowid);
  return { ...safrasState(), createdId: id };
}

export function updateSafra(id: number, input: { code?: string; label?: string }) {
  ensureSafras();
  const current = db.prepare("SELECT id, code, label FROM safras WHERE id = ?").get(id) as Safra | undefined;
  if (!current) throw new Error("Safra não encontrada.");
  const code = input.code != null && input.code.trim() ? normalizeSafraCode(input.code) : current.code;
  const label = input.label != null && input.label.trim() ? input.label.trim() : current.label;
  try {
    db.prepare("UPDATE safras SET code = ?, label = ? WHERE id = ?").run(code, label, id);
  } catch {
    throw new Error("Já existe uma safra com esse período.");
  }
  return safrasState();
}

export function deleteSafra(id: number) {
  ensureSafras();
  const rows = listSafras();
  if (rows.length <= 1) throw new Error("Precisa ficar pelo menos uma safra cadastrada.");
  const row = rows.find((item) => item.id === id);
  if (!row) throw new Error("Safra não encontrada.");
  const current = readCurrentSafraId();
  db.prepare("DELETE FROM calc_params WHERE safra_id = ?").run(id);
  try {
    db.prepare("DELETE FROM seed_radius_tariffs WHERE safra_id = ?").run(id);
  } catch {
    /* tabela ainda não existe */
  }
  try {
    db.prepare("DELETE FROM line_safra_prices WHERE safra_id = ?").run(id);
  } catch {
    /* tabela ainda não existe */
  }
  db.prepare("DELETE FROM safras WHERE id = ?").run(id);
  if (current === id) {
    const next = rows.find((item) => item.id !== id);
    if (next) {
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('current_safra_id', ?)").run(String(next.id));
    }
  }
  return safrasState();
}
