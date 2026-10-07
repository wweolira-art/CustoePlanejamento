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

const tests = [
  ["destino negocio=1", `
    SELECT SUM(d.valor) t, COUNT(*) n
    FROM custo.distribuicaogasto d
    JOIN custo.objetocusto cli ON cli.cod_objetocusto = d.cod_objetocustocliente
    WHERE d.anomes BETWEEN :ini AND :fim AND d.tipo='R' AND cli.negocio=1`],
  ["destino negocio=1 excl origem negocio=1", `
    SELECT SUM(d.valor) t, COUNT(*) n
    FROM custo.distribuicaogasto d
    JOIN custo.objetocusto cli ON cli.cod_objetocusto = d.cod_objetocustocliente
    JOIN custo.objetocusto ori ON ori.cod_objetocusto = d.cod_objetocusto
    WHERE d.anomes BETWEEN :ini AND :fim AND d.tipo='R'
      AND cli.negocio=1 AND ori.negocio <> 1`],
  ["ultimo nivel seq (nivel=1 destino)", `
    SELECT SUM(d.valor) t, COUNT(*) n
    FROM custo.distribuicaogasto d
    JOIN custo.objetocusto cli ON cli.cod_objetocusto = d.cod_objetocustocliente
    JOIN custo.sequenciarateio s
      ON s.cod_objetocusto = d.cod_objetocusto
     AND s.anomes = d.anomes AND s.tipo = d.tipo
    WHERE d.anomes BETWEEN :ini AND :fim AND d.tipo='R'
      AND cli.negocio=1 AND s.nivel = 1`],
  ["cliente in seq nivel=1", `
    SELECT SUM(d.valor) t
    FROM custo.distribuicaogasto d
    JOIN custo.sequenciarateio s
      ON s.cod_objetocusto = d.cod_objetocustocliente
     AND s.anomes = d.anomes AND s.tipo = d.tipo AND s.nivel = 1
    WHERE d.anomes BETWEEN :ini AND :fim AND d.tipo='R'`],
  ["lancamento origem neg 3,5 -> dest neg 1", `
    SELECT SUM(d.valor) t
    FROM custo.distribuicaogasto d
    JOIN custo.objetocusto ori ON ori.cod_objetocusto = d.cod_objetocusto
    JOIN custo.objetocusto cli ON cli.cod_objetocusto = d.cod_objetocustocliente
    WHERE d.anomes BETWEEN :ini AND :fim AND d.tipo='R'
      AND ori.negocio IN (3,5) AND cli.negocio = 1`],
  ["lancamento pool origem (baseline)", `
    SELECT SUM(c.valor) t FROM custo.lancamento_custo c
    JOIN custo.objetocusto a ON c.cod_objetocusto=a.cod_objetocusto
    JOIN custo.empenho e ON c.cod_empenho=e.cod_empenho
    WHERE a.negocio IN (1,3,5) AND c.anomes BETWEEN :ini AND :fim
      AND c.tipo='R' AND e.cod_tipoempenho IN (1,2)
      AND NOT EXISTS (SELECT 1 FROM custo.objetocusto b
        WHERE b.negocio=5 AND b.processo IN (3,4) AND b.cod_objetocusto=a.cod_objetocusto)`],
  ["lancamento origem neg 1 only", `
    SELECT SUM(c.valor) t FROM custo.lancamento_custo c
    JOIN custo.objetocusto a ON c.cod_objetocusto=a.cod_objetocusto
    JOIN custo.empenho e ON c.cod_empenho=e.cod_empenho
    WHERE a.negocio=1 AND c.anomes BETWEEN :ini AND :fim
      AND c.tipo='R' AND e.cod_tipoempenho IN (1,2)`],
  ["lancamento origem neg 3,5 only", `
    SELECT SUM(c.valor) t FROM custo.lancamento_custo c
    JOIN custo.objetocusto a ON c.cod_objetocusto=a.cod_objetocusto
    JOIN custo.empenho e ON c.cod_empenho=e.cod_empenho
    WHERE a.negocio IN (3,5) AND c.anomes BETWEEN :ini AND :fim
      AND c.tipo='R' AND e.cod_tipoempenho IN (1,2)
      AND NOT EXISTS (SELECT 1 FROM custo.objetocusto b
        WHERE b.negocio=5 AND b.processo IN (3,4) AND b.cod_objetocusto=a.cod_objetocusto)`],
];

for (const [label, sql] of tests) {
  const r = await q(sql, period);
  console.log(label, r.rows?.[0]);
}

const niveis = await q(`
  SELECT s.nivel, SUM(d.valor) t, COUNT(*) n
  FROM custo.distribuicaogasto d
  JOIN custo.sequenciarateio s ON s.cod_objetocusto = d.cod_objetocusto
    AND s.anomes = d.anomes AND s.tipo = d.tipo
  JOIN custo.objetocusto cli ON cli.cod_objetocusto = d.cod_objetocustocliente
  WHERE d.anomes BETWEEN :ini AND :fim AND d.tipo='R' AND cli.negocio=1
  GROUP BY s.nivel ORDER BY s.nivel`, period);
console.log("\npor nivel origem -> dest neg 1:", niveis.rows);

const item0 = await q(`
  SELECT SUM(valor) t, COUNT(*) n FROM custo.distribuicaogasto
  WHERE anomes BETWEEN :ini AND :fim AND tipo='R' AND cod_item_custo=0`, period);
console.log("\ncod_item_custo=0:", item0.rows?.[0]);
