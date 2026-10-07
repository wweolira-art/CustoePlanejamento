import type { Connection } from "oracledb";
import { oracleNumber } from "../oracle.js";
import { normalizeSafraCode, safraStartYear } from "../safras.js";

function codEmpresa() {
  return Number(process.env.COD_EMPRESA || 1);
}

function codFilial() {
  return Number(process.env.COD_FILIAL || 1);
}

function safraOracleSearchTerms(safraCode: string) {
  let normalized = safraCode.trim().replace(/^safra\s+/i, "");
  try {
    normalized = normalizeSafraCode(normalized);
  } catch {
    normalized = normalized.replace(/\s+/g, "");
  }
  const startYear = safraStartYear(normalized);
  const endYear = startYear + 1;
  const short = normalized;
  const long = `${startYear}/${endYear}`;
  return [...new Set([short, long, `Safra ${long}`])];
}

export async function resolveOracleCodSafra(conn: Connection, safraCode: string) {
  const terms = safraOracleSearchTerms(safraCode);
  for (const term of terms) {
    const result = await conn.execute(
      `SELECT cod_safra
         FROM agricola.safra
        WHERE cod_empresa = :codEmpresa
          AND cod_filial = :codFilial
          AND UPPER(descricao) LIKE '%' || UPPER(:term) || '%'
        ORDER BY cod_safra DESC
        FETCH FIRST 1 ROWS ONLY`,
      { codEmpresa: codEmpresa(), codFilial: codFilial(), term },
    );
    const row = (result.rows ?? [])[0] as Record<string, unknown> | undefined;
    if (!row) continue;
    const cod = oracleNumber(row, "cod_safra", "COD_SAFRA");
    if (cod != null) return cod;
  }
  return null;
}
