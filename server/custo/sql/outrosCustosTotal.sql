-- Custo administrativo (negócio 5 / processo 1)
-- lancamento_custo tipo R, empenho tipo 1 ou 2
SELECT NVL(SUM(a.valor), 0) AS total_outros_custos
FROM custo.lancamento_custo a
LEFT JOIN custo.empenho d
    ON a.cod_empenho = d.cod_empenho
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
  AND EXISTS (
      SELECT 1
      FROM custo.objetocusto b
      WHERE b.negocio = 5
        AND b.processo = 1
        AND a.cod_objetocusto = b.cod_objetocusto
  )
