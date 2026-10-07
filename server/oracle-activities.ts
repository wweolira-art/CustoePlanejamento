import { db } from "./db.js";
import { oracleText, withOracle } from "./oracle.js";

export interface OracleActivity {
  code: string;
  description: string;
  unit: string;
  imported: boolean;
}

function existingCodes() {
  const rows = db.prepare("SELECT code FROM activities").all() as { code: string }[];
  return new Set(rows.map((row) => row.code.trim().toUpperCase()));
}

export async function listOracleActivities(): Promise<OracleActivity[]> {
  const known = existingCodes();
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT cod_subempenho, descricao, cod_unidade
         FROM planejamento.subempgenerico
        ORDER BY cod_subempenho`,
    );
    const items: OracleActivity[] = [];
    const seen = new Set<string>();
    for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
      const code = oracleText(raw, "cod_subempenho");
      const description = oracleText(raw, "descricao");
      if (!code || !description) continue;
      const key = code.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        code,
        description,
        unit: oracleText(raw, "cod_unidade"),
        imported: known.has(key),
      });
    }
    return items;
  });
}

export async function importOracleActivities(codes?: string[] | null) {
  const wanted = new Set(
    (codes ?? []).map((code) => code.trim().toUpperCase()).filter(Boolean),
  );
  const items = await listOracleActivities();
  const pick = wanted.size ? items.filter((row) => wanted.has(row.code.toUpperCase())) : items.filter((row) => !row.imported);
  if (!pick.length) {
    throw new Error(wanted.size ? "Nenhuma das atividades selecionadas foi encontrada no Oracle." : "Não há atividades novas para importar.");
  }

  const ins = db.prepare("INSERT OR IGNORE INTO activities (code, description, empenho) VALUES (?, ?, NULL)");
  const tx = db.transaction(() => {
    let imported = 0;
    let skipped = 0;
    for (const row of pick) {
      const result = ins.run(row.code, row.description);
      if (result.changes) imported += 1;
      else skipped += 1;
    }
    return { imported, skipped };
  });
  const summary = tx();
  const activities = db.prepare("SELECT * FROM activities ORDER BY code COLLATE NOCASE, description").all();
  return { ...summary, activities };
}
