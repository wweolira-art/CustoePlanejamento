import { getOracleConnection } from "../server/oracle.ts";

const tables = ["DISTRIBUICAOGASTO", "UTILIZACAO", "SEQUENCIARATEIO", "OBJETOCUSTO"];

async function q(sql, binds = {}) {
  const conn = await getOracleConnection();
  try {
    return await conn.execute(sql, binds);
  } finally {
    await conn.close();
  }
}

for (const t of tables) {
  try {
    const cols = await q(
      `
      SELECT column_name, data_type, nullable
      FROM all_tab_columns
      WHERE owner = 'CUSTO' AND table_name = :t
      ORDER BY column_id`,
      { t },
    );
    console.log(`\n=== CUSTO.${t} columns ===`);
    for (const r of cols.rows || []) {
      console.log(`  ${r.COLUMN_NAME} ${r.DATA_TYPE} ${r.NULLABLE}`);
    }
    const cnt = await q(`SELECT COUNT(*) AS c FROM custo.${t.toLowerCase()}`);
    console.log("count:", cnt.rows?.[0]?.C ?? cnt.rows?.[0]?.c);
  } catch (e) {
    console.log("ERR", t, e.message);
  }
}

for (const t of ["DISTRIBUICAOGASTO", "UTILIZACAO", "SEQUENCIARATEIO"]) {
  try {
    const sample = await q(`SELECT * FROM custo.${t.toLowerCase()} WHERE ROWNUM <= 8`);
    console.log(`\n=== sample ${t} ===`);
    console.log(JSON.stringify(sample.rows, null, 2));
  } catch (e) {
    console.log("sample ERR", t, e.message);
  }
}

const total = await q(`
  SELECT SUM(valor) AS total
  FROM custo.lancamento_custo c
  LEFT JOIN custo.objetocusto a ON c.cod_objetocusto = a.cod_objetocusto
  LEFT JOIN custo.empenho e ON c.cod_empenho = e.cod_empenho
  WHERE a.negocio IN (1,3,5)
    AND NOT EXISTS (
      SELECT 1 FROM custo.objetocusto b
      WHERE b.negocio = 5 AND b.processo IN (3,4)
        AND a.cod_objetocusto = b.cod_objetocusto)
    AND c.anomes BETWEEN 202509 AND 202608
    AND c.tipo = 'R'
    AND e.cod_tipoempenho IN (1,2)
`);
console.log("\n=== baseline total ===", total.rows?.[0]);
