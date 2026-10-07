import { db } from "./db.js";

db.exec(`
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INTEGER NOT NULL,
  permission_key TEXT NOT NULL,
  PRIMARY KEY (user_id, permission_key)
);
`);

export function getUserPermissions(userId: number): string[] {
  return db
    .prepare("SELECT permission_key FROM user_permissions WHERE user_id = ? ORDER BY permission_key")
    .all(userId)
    .map((row) => String((row as { permission_key: string }).permission_key));
}

export function setUserPermissions(userId: number, keys: string[]) {
  const unique = [...new Set(keys.map((key) => key.trim()).filter(Boolean))].sort();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM user_permissions WHERE user_id = ?").run(userId);
    const insert = db.prepare("INSERT INTO user_permissions (user_id, permission_key) VALUES (?, ?)");
    for (const key of unique) insert.run(userId, key);
  });
  tx();
}

export function userHasPermissionRows(userId: number): boolean {
  const row = db.prepare("SELECT 1 AS ok FROM user_permissions WHERE user_id = ? LIMIT 1").get(userId) as
    | { ok: number }
    | undefined;
  return Boolean(row?.ok);
}
