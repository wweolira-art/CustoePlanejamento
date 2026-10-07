-- Total de arrendamento (objeto de custo 5/2/1)
-- lancamento_custo tipo R, empenho tipo 1 ou 2
SELECT NVL(SUM(a.valor), 0) AS total_arrendamento
FROM custo.lancamento_custo a
LEFT JOIN custo.empenho c
    ON c.cod_empenho = a.cod_empenho
LEFT JOIN custo.tipoempenho d
    ON d.cod_tipoempenho = c.cod_tipoempenho
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
        AND b.processo = 2
        AND b.subprocesso = 1
        AND a.cod_objetocusto = b.cod_objetocusto
  )
