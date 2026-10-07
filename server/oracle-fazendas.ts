import { db } from "./db.js";
import { oracleNumber, oracleText, withOracle } from "./oracle.js";

export interface OracleFazenda {
  code: string;
  description: string;
  distancia: number | null;
  imported: boolean;
}

function existingCodes() {
  const rows = db.prepare("SELECT code FROM fazendas").all() as { code: string }[];
  return new Set(rows.map((row) => row.code.trim().toUpperCase()));
}

export async function listOracleFazendas(): Promise<OracleFazenda[]> {
  const known = existingCodes();
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT f.cod_fazenda, f.descricao, f.distancia
         FROM agricola.fazenda f
        WHERE NVL(f.cod_fazenda, -1) <> 0
        ORDER BY f.descricao, f.cod_fazenda`,
    );
    const items: OracleFazenda[] = [];
    const seen = new Set<string>();
    for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
      const code = oracleText(raw, "cod_fazenda") || String(oracleNumber(raw, "cod_fazenda") ?? "");
      const description = oracleText(raw, "descricao");
      if (!code || !description) continue;
      const key = code.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        code,
        description,
        distancia: oracleNumber(raw, "distancia"),
        imported: known.has(key),
      });
    }
    return items;
  });
}

export async function importOracleFazendas(codes?: string[] | null) {
  const wanted = new Set(
    (codes ?? []).map((code) => code.trim().toUpperCase()).filter(Boolean),
  );
  const items = await listOracleFazendas();
  const pick = wanted.size
    ? items.filter((row) => wanted.has(row.code.toUpperCase()))
    : items.filter((row) => !row.imported);
  if (!pick.length) {
    throw new Error(
      wanted.size
        ? "Nenhuma das fazendas selecionadas foi encontrada no Oracle."
        : "Não há fazendas novas para importar.",
    );
  }

  const upsert = db.prepare(
    `INSERT INTO fazendas (code, description, distancia) VALUES (?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       description = excluded.description,
       distancia = excluded.distancia`,
  );
  const tx = db.transaction(() => {
    let imported = 0;
    let updated = 0;
    for (const row of pick) {
      const before = db.prepare("SELECT id FROM fazendas WHERE code = ? COLLATE NOCASE").get(row.code) as
        | { id: number }
        | undefined;
      upsert.run(row.code, row.description, row.distancia);
      if (before) updated += 1;
      else imported += 1;
    }
    return { imported, updated, skipped: 0 };
  });
  const summary = tx();
  const fazendas = db.prepare("SELECT * FROM fazendas ORDER BY code COLLATE NOCASE, description").all();
  return { ...summary, fazendas };
}
