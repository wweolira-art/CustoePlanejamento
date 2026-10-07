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

const r = await q(`
  WITH filt AS (
    SELECT c.cod_objetocusto, c.anomes, c.cod_item_custo, c.valor, a.negocio
    FROM custo.lancamento_custo c
    JOIN custo.objetocusto a ON a.cod_objetocusto = c.cod_objetocusto
    JOIN custo.empenho e ON e.cod_empenho = c.cod_empenho
    WHERE c.anomes BETWEEN :ini AND :fim AND c.tipo = 'R'
      AND e.cod_tipoempenho IN (1,2)
      AND a.negocio IN (1,3,5)
      AND NOT EXISTS (
        SELECT 1 FROM custo.objetocusto b
        WHERE b.negocio = 5 AND b.processo IN (3,4)
          AND b.cod_objetocusto = a.cod_objetocusto)
  ),
  dg AS (
    SELECT d.cod_objetocusto, d.anomes, d.cod_item_custo,
           d.cod_objetocustocliente, d.porcentagem
    FROM custo.distribuicaogasto d
    JOIN custo.objetocusto cli ON cli.cod_objetocusto = d.cod_objetocustocliente
    WHERE d.anomes BETWEEN :ini AND :fim AND d.tipo = 'R' AND cli.negocio = 1
  ),
  dg_item AS (
    SELECT cod_objetocusto, anomes, cod_item_custo, cod_objetocustocliente,
           SUM(porcentagem) AS w FROM dg
    GROUP BY cod_objetocusto, anomes, cod_item_custo, cod_objetocustocliente
  ),
  dg_item_tot AS (
    SELECT cod_objetocusto, anomes, cod_item_custo, SUM(w) AS wtot
    FROM dg_item GROUP BY cod_objetocusto, anomes, cod_item_custo
  ),
  dg_obj AS (
    SELECT cod_objetocusto, anomes, cod_objetocustocliente, SUM(porcentagem) AS w
    FROM dg GROUP BY cod_objetocusto, anomes, cod_objetocustocliente
  ),
  dg_obj_tot AS (
    SELECT cod_objetocusto, anomes, SUM(w) AS wtot FROM dg_obj
    GROUP BY cod_objetocusto, anomes
  ),
  util AS (
    SELECT u.cod_objetoprestador, u.anomes, u.cod_objetocliente, u.quantidade AS w
    FROM custo.utilizacao u
    JOIN custo.objetocusto cli ON cli.cod_objetocusto = u.cod_objetocliente
    WHERE u.anomes BETWEEN :ini AND :fim AND u.tipo = 'R'
      AND NVL(u.considera_rateio, 'S') = 'S' AND cli.negocio = 1
  ),
  util_tot AS (
    SELECT cod_objetoprestador, anomes, SUM(w) AS wtot FROM util
    GROUP BY cod_objetoprestador, anomes
  ),
  util_global AS (
    SELECT anomes, cod_objetocliente, SUM(w) AS w
    FROM util GROUP BY anomes, cod_objetocliente
  ),
  util_global_tot AS (
    SELECT anomes, SUM(w) AS wtot FROM util_global GROUP BY anomes
  ),
  exp AS (
    SELECT f.valor,
           COALESCE(
             di.cod_objetocustocliente,
             do.cod_objetocustocliente,
             u.cod_objetocliente,
             ug.cod_objetocliente,
             CASE WHEN f.negocio = 1 THEN f.cod_objetocusto END
           ) AS dest,
           COALESCE(
             di.w / NULLIF(dit.wtot, 0),
             do.w / NULLIF(dot.wtot, 0),
             u.w / NULLIF(ut.wtot, 0),
             ug.w / NULLIF(ugt.wtot, 0),
             CASE WHEN f.negocio = 1 THEN 1 END
           ) AS frac
    FROM filt f
    LEFT JOIN dg_item di ON di.cod_objetocusto = f.cod_objetocusto
      AND di.anomes = f.anomes AND di.cod_item_custo = f.cod_item_custo
    LEFT JOIN dg_item_tot dit ON dit.cod_objetocusto = f.cod_objetocusto
      AND dit.anomes = f.anomes AND dit.cod_item_custo = f.cod_item_custo
    LEFT JOIN dg_obj do ON do.cod_objetocusto = f.cod_objetocusto
      AND do.anomes = f.anomes AND dit.wtot IS NULL
    LEFT JOIN dg_obj_tot dot ON dot.cod_objetocusto = f.cod_objetocusto
      AND dot.anomes = f.anomes AND dit.wtot IS NULL
    LEFT JOIN util u ON u.cod_objetoprestador = f.cod_objetocusto
      AND u.anomes = f.anomes AND dit.wtot IS NULL AND dot.wtot IS NULL
    LEFT JOIN util_tot ut ON ut.cod_objetoprestador = f.cod_objetocusto
      AND ut.anomes = f.anomes AND dit.wtot IS NULL AND dot.wtot IS NULL
    LEFT JOIN util_global ug ON ug.anomes = f.anomes
      AND dit.wtot IS NULL AND dot.wtot IS NULL AND ut.wtot IS NULL AND f.negocio <> 1
    LEFT JOIN util_global_tot ugt ON ugt.anomes = f.anomes
      AND dit.wtot IS NULL AND dot.wtot IS NULL AND ut.wtot IS NULL AND f.negocio <> 1
  ),
  lines AS (
    SELECT dest, valor * frac AS v FROM exp WHERE dest IS NOT NULL AND frac IS NOT NULL
  ),
  sums AS (
    SELECT (SELECT SUM(valor) FROM filt) lc,
           (SELECT SUM(v) FROM lines) al,
           (SELECT SUM(valor) FROM exp WHERE dest IS NULL OR frac IS NULL) orphan
    FROM dual
  )
  SELECT * FROM sums`, period);
console.log(r.rows?.[0]);
