import { getOracleConnection } from "../server/oracle.ts";

async function q(sql, binds = {}) {
  const conn = await getOracleConnection();
  try {
    return await conn.execute(sql, binds);
  } finally {
    await conn.close();
  }
}

const period = { ini: 202509, fim: 202608 };

const itemTables = await q(`
  SELECT table_name FROM all_tables
  WHERE owner='CUSTO' AND table_name LIKE '%ITEM%CUSTO%'
  ORDER BY 1`);
console.log("item tables:", itemTables.rows?.map((r) => r.TABLE_NAME));

const lcCols = await q(`
  SELECT column_name FROM all_tab_columns
  WHERE owner='CUSTO' AND table_name='LANCAMENTO_CUSTO'
  ORDER BY column_id`);
console.log("lancamento cols:", lcCols.rows?.map((r) => r.COLUMN_NAME).join(", "));

const joinItem = await q(`
  SELECT SUM(d.valor) dg, SUM(c.valor) lc, COUNT(DISTINCT d.cod_item_custo) items
  FROM custo.distribuicaogasto d
  JOIN custo.lancamento_custo c ON c.cod_item_custo = d.cod_item_custo
    AND c.anomes = d.anomes AND c.tipo = d.tipo
  JOIN custo.objetocusto cli ON cli.cod_objetocusto = d.cod_objetocustocliente
  WHERE d.anomes BETWEEN :ini AND :fim AND d.tipo='R' AND cli.negocio=1`, period);
console.log("\njoin cod_item_custo dest neg 1:", joinItem.rows?.[0]);

const perItem = await q(`
  SELECT d.cod_item_custo,
         SUM(d.valor) dg_sum,
         MAX(c.valor) lc_val,
         COUNT(*) dg_rows
  FROM custo.distribuicaogasto d
  JOIN custo.lancamento_custo c ON c.cod_item_custo = d.cod_item_custo
    AND c.anomes = d.anomes AND c.tipo = d.tipo
  JOIN custo.objetocusto cli ON cli.cod_objetocusto = d.cod_objetocustocliente
  WHERE d.anomes = 202509 AND d.tipo='R' AND cli.negocio=1
  GROUP BY d.cod_item_custo
  FETCH FIRST 10 ROWS ONLY`);
console.log("\nper item sample:", perItem.rows);

const ratioTest = await q(`
  WITH base AS (
    SELECT c.cod_item_custo, c.anomes, c.valor AS lc_val,
           SUM(CASE WHEN cli.negocio=1 THEN d.valor ELSE 0 END) AS dg_neg1,
           SUM(d.valor) AS dg_all
    FROM custo.lancamento_custo c
    LEFT JOIN custo.distribuicaogasto d
      ON d.cod_item_custo = c.cod_item_custo AND d.anomes = c.anomes AND d.tipo = c.tipo
    LEFT JOIN custo.objetocusto cli ON cli.cod_objetocusto = d.cod_objetocustocliente
    JOIN custo.objetocusto a ON a.cod_objetocusto = c.cod_objetocusto
    JOIN custo.empenho e ON e.cod_empenho = c.cod_empenho
    WHERE c.anomes BETWEEN :ini AND :fim AND c.tipo='R'
      AND e.cod_tipoempenho IN (1,2)
      AND a.negocio IN (1,3,5)
      AND NOT EXISTS (SELECT 1 FROM custo.objetocusto b
        WHERE b.negocio=5 AND b.processo IN (3,4) AND b.cod_objetocusto=a.cod_objetocusto)
    GROUP BY c.cod_item_custo, c.anomes, c.valor
  )
  SELECT SUM(lc_val) lc_total,
         SUM(CASE WHEN dg_all > 0 THEN lc_val * (dg_neg1/dg_all) ELSE 0 END) scaled_neg1,
         SUM(CASE WHEN dg_all IS NULL OR dg_all = 0 THEN lc_val ELSE 0 END) sem_dg
  FROM base`, period);
console.log("\nscaled by item ratio to neg1:", ratioTest.rows?.[0]);

const utilJoin = await q(`
  SELECT COUNT(*) n,
         SUM(u.quantidade) q
  FROM custo.utilizacao u
  WHERE u.anomes BETWEEN :ini AND :fim AND u.tipo='R'
    AND u.considera_rateio = 'S'`, period);
console.log("\nutilizacao period:", utilJoin.rows?.[0]);
