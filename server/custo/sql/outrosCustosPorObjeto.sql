-- Custo administrativo (5/1) por objeto de custo
SELECT
    a.cod_objetocusto,
    NVL(SUM(a.valor), 0) AS valor
FROM custo.lancamento_custo a
LEFT JOIN custo.empenho d
    ON a.cod_empenho = d.cod_empenho
LEFT JOIN custo.objetocusto oc
    ON oc.cod_objetocusto = a.cod_objetocusto
WHERE a.tipo = 'R'
  AND d.cod_tipoempenho IN (1, 2)
  AND (
      :anomesInicio IS NULL
      OR a.anomes >= :anomesInicio
  )
  AND (
      :anomesFim IS NULL
      OR a.anomes <= :anomesFim
  )
  AND (
      :negociosCsv IS NULL
      OR INSTR(',' || :negociosCsv || ',', ',' || TO_CHAR(oc.negocio) || ',') > 0
  )
  AND EXISTS (
      SELECT 1
      FROM custo.objetocusto b
      WHERE b.negocio = 5
        AND b.processo = 1
        AND a.cod_objetocusto = b.cod_objetocusto
  )
GROUP BY a.cod_objetocusto
ORDER BY a.cod_objetocusto
