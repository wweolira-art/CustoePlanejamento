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

console.log("=== GRUPO_ITEM_CUSTO ===");
const grupos = await q(`SELECT * FROM custo.grupo_item_custo ORDER BY cod_grupo_item_custo`);
console.log(grupos.rows);

console.log("\n=== ITEM_CUSTO ===");
const items = await q(`SELECT * FROM custo.item_custo ORDER BY cod_grupo_item_custo, cod_item_custo`);
console.log(items.rows);

console.log("\n=== SUBPROCESSOS NEG 1 (headers) ===");
const subs = await q(`
  SELECT processo, subprocesso, MAX(descricao) descricao, COUNT(*) n_obj
  FROM custo.objetocusto
  WHERE negocio = 1 AND NVL(atividade,0) = 0 AND NVL(subprocesso,0) <> 0
  GROUP BY processo, subprocesso ORDER BY processo, subprocesso`);
console.log(subs.rows);

console.log("\n=== RATEIO POR SUBPROCESSO DEST (sample totals) ===");
const bySub = await q(`
  WITH filt AS (
    SELECT c.cod_objetocusto origem, c.anomes, c.cod_item_custo, c.valor, c.cod_empenho,
           a.negocio neg_origem, e.cod_grupoempenho
    FROM custo.lancamento_custo c
    JOIN custo.objetocusto a ON a.cod_objetocusto = c.cod_objetocusto
    JOIN custo.empenho e ON e.cod_empenho = c.cod_empenho
    WHERE c.anomes BETWEEN :ini AND :fim AND c.tipo='R' AND e.cod_tipoempenho IN (1,2)
      AND a.negocio IN (1,3,5)
      AND NOT EXISTS (SELECT 1 FROM custo.objetocusto b
        WHERE b.negocio=5 AND b.processo IN (3,4) AND b.cod_objetocusto=a.cod_objetocusto)
  ),
  dg AS (
    SELECT d.*, cli.negocio neg_dest
    FROM custo.distribuicaogasto d
    JOIN custo.objetocusto cli ON cli.cod_objetocusto = d.cod_objetocustocliente
    WHERE d.anomes BETWEEN :ini AND :fim AND d.tipo='R' AND cli.negocio = 1
  )
  SELECT dest.processo, dest.subprocesso, MAX(hdr.descricao) sub_nome,
         SUM(dg.valor) total_dg
  FROM dg
  JOIN custo.objetocusto dest ON dest.cod_objetocusto = dg.cod_objetocustocliente
  LEFT JOIN custo.objetocusto hdr ON hdr.negocio=1 AND hdr.atividade=0
    AND hdr.processo=dest.processo AND hdr.subprocesso=dest.subprocesso
  GROUP BY dest.processo, dest.subprocesso
  ORDER BY dest.processo, dest.subprocesso`, period);
console.log(bySub.rows);

console.log("\n=== GRUPO EMPENHO COM VALOR NO PERIODO ===");
const ge = await q(`
  SELECT g.cod_grupoempenho, MAX(g.descricao) descricao, SUM(c.valor) total
  FROM custo.lancamento_custo c
  JOIN custo.empenho e ON e.cod_empenho = c.cod_empenho
  JOIN custo.grupoempenho g ON g.cod_grupoempenho = e.cod_grupoempenho
  JOIN custo.objetocusto a ON a.cod_objetocusto = c.cod_objetocusto
  WHERE c.anomes BETWEEN :ini AND :fim AND c.tipo='R' AND e.cod_tipoempenho IN (1,2)
    AND a.negocio IN (1,3,5)
    AND NOT EXISTS (SELECT 1 FROM custo.objetocusto b
      WHERE b.negocio=5 AND b.processo IN (3,4) AND b.cod_objetocusto=a.cod_objetocusto)
  GROUP BY g.cod_grupoempenho ORDER BY total DESC`, period);
console.log(ge.rows?.slice(0, 20));

console.log("\n=== ITEM_CUSTO COM DG PARA CANA ===");
const ic = await q(`
  SELECT ic.cod_item_custo, ic.descricao, ic.cod_grupo_item_custo, g.descricao grupo,
         g.origem, g.des_origem, SUM(d.valor) total_dg
  FROM custo.distribuicaogasto d
  JOIN custo.item_custo ic ON ic.cod_item_custo = d.cod_item_custo
  LEFT JOIN custo.grupo_item_custo g ON g.cod_grupo_item_custo = ic.cod_grupo_item_custo
  JOIN custo.objetocusto cli ON cli.cod_objetocusto = d.cod_objetocustocliente
  WHERE d.anomes BETWEEN :ini AND :fim AND d.tipo='R' AND cli.negocio = 1
    AND d.cod_item_custo <> 0
  GROUP BY ic.cod_item_custo, ic.descricao, ic.cod_grupo_item_custo, g.descricao, g.origem, g.des_origem
  ORDER BY total_dg DESC`, period);
console.log(ic.rows);
