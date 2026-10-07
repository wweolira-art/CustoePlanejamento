-- Arrendamento (5/2/1) por objeto de custo
SELECT
    a.cod_objetocusto,
    NVL(SUM(a.valor), 0) AS valor
FROM custo.lancamento_custo a
LEFT JOIN custo.empenho c
    ON c.cod_empenho = a.cod_empenho
LEFT JOIN custo.objetocusto oc
    ON oc.cod_objetocusto = a.cod_objetocusto
WHERE a.tipo = 'R'
  AND c.cod_tipoempenho IN (1, 2)
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
        AND b.processo = 2
        AND b.subprocesso = 1
        AND a.cod_objetocusto = b.cod_objetocusto
  )
GROUP BY a.cod_objetocusto
ORDER BY a.cod_objetocusto
