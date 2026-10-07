import { db } from "./db.js";
import { oracleText, withOracle } from "./oracle.js";

export interface OracleMaterial {
  code: string;
  description: string;
  unit: string;
  grupo: string;
  imported: boolean;
}

const LIST_LIMIT = 400;
const GROUP_JOIN = `LEFT JOIN material.grupomaterial g
              ON m.cod_grupomaterial = g.cod_grupomaterial
             AND m.cod_familia = g.cod_familia`;

function codeKey(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const n = Number(raw.replace(",", "."));
  if (Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return raw.toUpperCase();
}

function existingCodes() {
  const rows = db
    .prepare("SELECT code FROM materials WHERE tipo = 'E'")
    .all() as { code: string }[];
  return new Set(rows.map((row) => codeKey(row.code)).filter(Boolean));
}

function likeTerm(query: string) {
  return `%${query.trim().toUpperCase().replace(/[%_]/g, "")}%`;
}

function inBinds(prefix: string, codes: string[]) {
  const binds: Record<string, string | number> = {};
  const names = codes.map((code, i) => {
    const key = `${prefix}${i}`;
    const n = Number(code);
    binds[key] = Number.isFinite(n) && String(Math.round(n)) === code ? n : code;
    return `:${key}`;
  });
  return { sql: names.join(", "), binds };
}

function mapRows(rows: Record<string, unknown>[] | undefined, known: Set<string>) {
  const items: OracleMaterial[] = [];
  const seen = new Set<string>();
  for (const raw of rows ?? []) {
    const code = codeKey(oracleText(raw, "cod_material"));
    const description = oracleText(raw, "descricao");
    if (!code || !description) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    items.push({
      code,
      description,
      unit: oracleText(raw, "cod_unidade"),
      grupo: oracleText(raw, "grupo"),
      imported: known.has(code),
    });
  }
  return items;
}

export async function listOracleMaterials(query?: string | null): Promise<{
  items: OracleMaterial[];
  truncated: boolean;
}> {
  const known = existingCodes();
  const term = query?.trim() ?? "";
  return withOracle(async (conn) => {
    const result = term
      ? await conn.execute(
          `SELECT m.cod_material,
                  m.descricao,
                  m.cod_unidade,
                  g.descricao AS grupo
             FROM material.material m
             ${GROUP_JOIN}
            WHERE m.cod_material IS NOT NULL
              AND m.descricao IS NOT NULL
              AND NVL(m.situacao, 'A') = 'A'
              AND (
                    TO_CHAR(m.cod_material) LIKE :q
                 OR UPPER(m.descricao) LIKE :q
              )
            ORDER BY m.cod_material
            FETCH FIRST ${LIST_LIMIT + 1} ROWS ONLY`,
          { q: likeTerm(term) },
        )
      : await conn.execute(
          `SELECT m.cod_material,
                  m.descricao,
                  m.cod_unidade,
                  g.descricao AS grupo
             FROM material.material m
             ${GROUP_JOIN}
            WHERE m.cod_material IS NOT NULL
              AND m.descricao IS NOT NULL
              AND NVL(m.situacao, 'A') = 'A'
            ORDER BY m.cod_material
            FETCH FIRST ${LIST_LIMIT + 1} ROWS ONLY`,
        );
    const mapped = mapRows((result.rows ?? []) as Record<string, unknown>[], known);
    return {
      items: mapped.slice(0, LIST_LIMIT),
      truncated: mapped.length > LIST_LIMIT,
    };
  });
}

export async function importOracleMaterials(codes?: string[] | null) {
  const wanted = [...new Set((codes ?? []).map((code) => codeKey(code)).filter(Boolean))];
  if (!wanted.length) throw new Error("Selecione os materiais para importar.");
  const known = existingCodes();
  const fresh = wanted.filter((code) => !known.has(code));
  if (!fresh.length) throw new Error("Nenhum dos materiais selecionados é novo no cadastro.");

  const { sql, binds } = inBinds("c", fresh);
  const items = await withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT m.cod_material,
              m.descricao,
              g.descricao AS grupo
         FROM material.material m
         ${GROUP_JOIN}
        WHERE m.cod_material IN (${sql})`,
      binds,
    );
    return mapRows((result.rows ?? []) as Record<string, unknown>[], known);
  });
  if (!items.length) throw new Error("Nenhum dos materiais selecionados foi encontrado no Oracle.");

  const upsert = db.prepare(`
    INSERT INTO materials (code, description, tipo, empenho, valor, grupo)
    VALUES (?, ?, 'E', NULL, NULL, ?)
    ON CONFLICT(code) DO UPDATE SET
      description = excluded.description,
      tipo = 'E',
      grupo = excluded.grupo
    WHERE materials.tipo = 'G'
  `);
  const tx = db.transaction(() => {
    let imported = 0;
    let skipped = 0;
    for (const row of items) {
      const result = upsert.run(row.code, row.description, row.grupo || null);
      if (result.changes) imported += 1;
      else skipped += 1;
    }
    return { imported, skipped };
  });
  const summary = tx();
  if (summary.imported === 0) {
    throw new Error(
      summary.skipped > 0
        ? "Nenhum material foi gravado. Os códigos selecionados já existem como tipo E."
        : "Nenhum material foi gravado.",
    );
  }
  const materials = db.prepare("SELECT * FROM materials ORDER BY code COLLATE NOCASE, description").all();
  return { ...summary, materials };
}

function localGroups() {
  const rows = db
    .prepare(
      "SELECT DISTINCT TRIM(grupo) AS grupo FROM materials WHERE grupo IS NOT NULL AND TRIM(grupo) != '' ORDER BY grupo COLLATE NOCASE",
    )
    .all() as { grupo: string }[];
  return rows.map((row) => row.grupo).filter(Boolean);
}

export async function listMaterialGroups(): Promise<{ groups: string[]; source: "oracle" | "local" }> {
  const fallback = localGroups();
  try {
    const groups = await withOracle(async (conn) => {
      const result = await conn.execute(
        `SELECT DISTINCT TRIM(g.descricao) AS grupo
           FROM material.material m
           JOIN material.grupomaterial g
             ON m.cod_grupomaterial = g.cod_grupomaterial
            AND m.cod_familia = g.cod_familia
          WHERE g.descricao IS NOT NULL
            AND TRIM(g.descricao) IS NOT NULL
            AND NVL(m.situacao, 'A') = 'A'
          ORDER BY grupo`,
      );
      const seen = new Set<string>();
      const items: string[] = [];
      for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
        const name = oracleText(raw, "grupo");
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        items.push(name);
      }
      return items;
    });
    const merged = [...groups];
    for (const name of fallback) {
      if (!merged.some((item) => item.toLowerCase() === name.toLowerCase())) merged.push(name);
    }
    merged.sort((a, b) => a.localeCompare(b, "pt-BR"));
    return { groups: merged, source: "oracle" };
  } catch {
    return { groups: fallback, source: "local" };
  }
}

export async function syncMaterialGroups() {
  const rows = db.prepare("SELECT id, code FROM materials WHERE tipo = 'E'").all() as { id: number; code: string }[];
  if (!rows.length) return { updated: 0, materials: db.prepare("SELECT * FROM materials ORDER BY code COLLATE NOCASE, description").all() };
  const { sql, binds } = inBinds("c", rows.map((row) => codeKey(row.code)).filter(Boolean));
  const items = await withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT m.cod_material,
              g.descricao AS grupo
         FROM material.material m
         JOIN material.grupomaterial g
           ON m.cod_grupomaterial = g.cod_grupomaterial
          AND m.cod_familia = g.cod_familia
        WHERE m.cod_material IN (${sql})`,
      binds,
    );
    return (result.rows ?? []) as Record<string, unknown>[];
  });
  const byCode = new Map<string, string>();
  for (const raw of items) {
    const code = codeKey(oracleText(raw, "cod_material"));
    const grupo = oracleText(raw, "grupo");
    if (code && grupo) byCode.set(code, grupo);
  }
  const upd = db.prepare("UPDATE materials SET grupo = ? WHERE id = ? AND (grupo IS NULL OR TRIM(grupo) = '')");
  const tx = db.transaction(() => {
    let updated = 0;
    for (const row of rows) {
      const grupo = byCode.get(codeKey(row.code));
      if (!grupo) continue;
      const result = upd.run(grupo, row.id);
      if (result.changes) updated += 1;
    }
    return updated;
  });
  return {
    updated: tx(),
    materials: db.prepare("SELECT * FROM materials ORDER BY code COLLATE NOCASE, description").all(),
  };
}
