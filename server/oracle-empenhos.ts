import { db } from "./db.js";
import { oracleText, withOracle } from "./oracle.js";

export interface Empenho {
  id: number;
  code: string;
  description: string;
}

export interface OracleEmpenho {
  code: string;
  description: string;
  imported: boolean;
}

function mapEmpenho(row: unknown): Empenho {
  const r = row as Record<string, unknown>;
  return {
    id: Number(r.id),
    code: String(r.code ?? ""),
    description: String(r.description ?? ""),
  };
}

function existingCodes() {
  const rows = db.prepare("SELECT code FROM empenhos").all() as { code: string }[];
  return new Set(rows.map((row) => row.code.trim().toUpperCase()));
}

export function listEmpenhos(): Empenho[] {
  return db
    .prepare("SELECT id, code, description FROM empenhos ORDER BY code COLLATE NOCASE, description")
    .all()
    .map(mapEmpenho);
}

export async function listOracleEmpenhos(): Promise<OracleEmpenho[]> {
  const known = existingCodes();
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT cod_empenho, descricao
         FROM custo.empenho
        ORDER BY cod_empenho`,
    );
    const items: OracleEmpenho[] = [];
    const seen = new Set<string>();
    for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
      const code = oracleText(raw, "cod_empenho");
      const description = oracleText(raw, "descricao");
      if (!code || !description) continue;
      const key = code.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ code, description, imported: known.has(key) });
    }
    return items;
  });
}

export async function importOracleEmpenhos(codes?: string[] | null) {
  const wanted = new Set((codes ?? []).map((code) => code.trim().toUpperCase()).filter(Boolean));
  const items = await listOracleEmpenhos();
  const pick = wanted.size ? items.filter((row) => wanted.has(row.code.toUpperCase())) : items;
  if (!pick.length) {
    throw new Error(wanted.size ? "Nenhum dos empenhos selecionados foi encontrado no Oracle." : "Não há empenhos para importar.");
  }

  const upsert = db.prepare(
    `INSERT INTO empenhos (code, description)
     VALUES (?, ?)
     ON CONFLICT(code) DO UPDATE SET description = excluded.description`,
  );
  const tx = db.transaction(() => {
    let imported = 0;
    let updated = 0;
    for (const row of pick) {
      const existed = row.imported;
      upsert.run(row.code, row.description);
      if (existed) updated += 1;
      else imported += 1;
    }
    return { imported, updated };
  });
  return { ...tx(), empenhos: listEmpenhos() };
}
