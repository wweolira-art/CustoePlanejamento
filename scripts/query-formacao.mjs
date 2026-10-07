import { getOracleConnection } from "../server/oracle.ts";

const conn = await getOracleConnection();
const r = await conn.execute(`
  SELECT cod_objetocusto, descricao, processo, subprocesso, atividade
  FROM custo.objetocusto
  WHERE negocio = 1 AND processo = 1 AND NVL(subprocesso,0) = 0 AND NVL(atividade,0) <> 0
  ORDER BY atividade`);
console.log("proc1 sub0 atividades:", r.rows);

const r2 = await conn.execute(`
  SELECT e.cod_empenho, MAX(e.descricao) descricao, MAX(g.descricao) grupo, SUM(c.valor) total
  FROM custo.lancamento_custo c
  JOIN custo.empenho e ON e.cod_empenho = c.cod_empenho
  JOIN custo.grupoempenho g ON g.cod_grupoempenho = e.cod_grupoempenho
  JOIN custo.objetocusto a ON a.cod_objetocusto = c.cod_objetocusto
  WHERE c.anomes BETWEEN 202509 AND 202608 AND c.tipo='R' AND e.cod_tipoempenho IN (1,2)
    AND g.cod_grupoempenho = 24 AND a.negocio IN (1,3,5)
  GROUP BY e.cod_empenho ORDER BY total DESC FETCH FIRST 25 ROWS ONLY`);
console.log("\nempenhos grupo 24:", r2.rows);

await conn.close();
