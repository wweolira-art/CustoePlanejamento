import { db } from "./db.js";

export type ImportedActiveUser = { id: number; nome: string; email: string };

db.exec(`
CREATE TABLE IF NOT EXISTS imported_active_users (
  user_id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  imported_at TEXT NOT NULL
);
`);

export function replaceImportedActiveUsers(users: ImportedActiveUser[]) {
  const importedAt = new Date().toISOString();
  const tx = db.transaction(() => {
    db.exec("DELETE FROM imported_active_users");
    const insert = db.prepare(
      "INSERT INTO imported_active_users (user_id, nome, email, imported_at) VALUES (?, ?, ?, ?)",
    );
    for (const user of users) insert.run(user.id, user.nome || `Usuário ${user.id}`, user.email, importedAt);
  });
  tx();
  return { imported: users.length, importedAt };
}

export function importedActiveUsersStatus() {
  const row = db.prepare(
    "SELECT COUNT(*) AS imported, MAX(imported_at) AS importedAt FROM imported_active_users",
  ).get() as { imported: number; importedAt: string | null };
  return { imported: row.imported, importedAt: row.importedAt };
}

export function listImportedActiveUsers() {
  return db.prepare(
    "SELECT user_id AS id, nome, email FROM imported_active_users ORDER BY nome COLLATE NOCASE, user_id",
  ).all() as ImportedActiveUser[];
}
