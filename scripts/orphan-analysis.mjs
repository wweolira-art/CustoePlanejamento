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

const orphanNeg = await q(`
  SELECT a.negocio, SUM(c.valor) v, COUNT(*) n
  FROM custo.lancamento_custo c
  JOIN custo.objetocusto a ON a.cod_objetocusto = c.cod_objetocusto
  JOIN custo.empenho e ON e.cod_empenho = c.cod_empenho
  WHERE c.anomes BETWEEN :ini AND :fim AND c.tipo='R' AND e.cod_tipoempenho IN (1,2)
    AND a.negocio IN (3,5)
    AND NOT EXISTS (SELECT 1 FROM custo.distribuicaogasto d
      JOIN custo.objetocusto cli ON cli.cod_objetocusto = d.cod_objetocustocliente
      WHERE d.cod_objetocusto=c.cod_objetocusto AND d.anomes=c.anomes
        AND d.cod_item_custo=c.cod_item_custo AND d.tipo='R' AND cli.negocio=1)
    AND NOT EXISTS (SELECT 1 FROM custo.utilizacao u
      JOIN custo.objetocusto cli ON cli.cod_objetocusto = u.cod_objetocliente
      WHERE u.cod_objetoprestador=c.cod_objetocusto AND u.anomes=c.anomes
        AND u.tipo='R' AND cli.negocio=1 AND NVL(u.considera_rateio,'S')='S')
    AND NOT EXISTS (SELECT 1 FROM custo.objetocusto b
      WHERE b.negocio=5 AND b.processo IN (3,4) AND b.cod_objetocusto=a.cod_objetocusto)
  GROUP BY a.negocio`, period);
console.log("orphan by negocio:", orphanNeg.rows);

const dgObjLevel = await q(`
  WITH sem AS (
    SELECT c.cod_objetocusto, c.anomes, c.cod_item_custo, c.valor
    FROM custo.lancamento_custo c
    JOIN custo.objetocusto a ON a.cod_objetocusto = c.cod_objetocusto
    JOIN custo.empenho e ON e.cod_empenho = c.cod_empenho
    WHERE c.anomes BETWEEN :ini AND :fim AND c.tipo='R' AND e.cod_tipoempenho IN (1,2)
      AND a.negocio IN (3,5)
      AND NOT EXISTS (SELECT 1 FROM custo.distribuicaogasto d
        JOIN custo.objetocusto cli ON cli.cod_objetocusto = d.cod_objetocustocliente
        WHERE d.cod_objetocusto=c.cod_objetocusto AND d.anomes=c.anomes
          AND d.cod_item_custo=c.cod_item_custo AND d.tipo='R' AND cli.negocio=1)
      AND NOT EXISTS (SELECT 1 FROM custo.objetocusto b
        WHERE b.negocio=5 AND b.processo IN (3,4) AND b.cod_objetocusto=a.cod_objetocusto)
  ),
  dg0 AS (
    SELECT d.cod_objetocusto, d.anomes, d.cod_objetocustocliente, SUM(d.porcentagem) pct
    FROM custo.distribuicaogasto d
    JOIN custo.objetocusto cli ON cli.cod_objetocusto = d.cod_objetocustocliente
    WHERE d.anomes BETWEEN :ini AND :fim AND d.tipo='R' AND cli.negocio=1
    GROUP BY d.cod_objetocusto, d.anomes, d.cod_objetocustocliente
  ),
  dg0s AS (
    SELECT cod_objetocusto, anomes, SUM(pct) pct_total FROM dg0 GROUP BY cod_objetocusto, anomes
  )
  SELECT SUM(s.valor) sem_v,
         SUM(s.valor * dg0.pct / NULLIF(dg0s.pct_total,0)) aloc_obj_level
  FROM sem s
  LEFT JOIN dg0 ON dg0.cod_objetocusto=s.cod_objetocusto AND dg0.anomes=s.anomes
  LEFT JOIN dg0s ON dg0s.cod_objetocusto=s.cod_objetocusto AND dg0s.anomes=s.anomes`, period);
console.log("obj-level dg for sem item:", dgObjLevel.rows?.[0]);
