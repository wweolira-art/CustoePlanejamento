-- Linhas de lancamento_custo classificadas (mutuamente exclusivas) para conciliação.
SELECT
    CASE
        WHEN oc.negocio = 3 AND oc.processo = 1 AND oc.subprocesso = 1 THEN 'oficina'
        WHEN oc.negocio = 3 AND oc.processo = 1 AND oc.subprocesso = 2 THEN 'transporte'
        WHEN EXISTS (
            SELECT 1
            FROM custo.empenho emp
            INNER JOIN custo.grupoempenho g
                ON emp.cod_grupoempenho = g.cod_grupoempenho
            WHERE emp.cod_empenho = c.cod_empenho
              AND emp.cod_tipoempenho IN (1, 2)
              AND g.cod_grupoempenho = 10
        )
        AND NOT (
            oc.negocio = 3
            AND oc.processo = 1
            AND oc.subprocesso IN (1, 2)
        ) THEN 'funcionario'
        WHEN oc.negocio = 3 AND oc.processo = 1 AND oc.subprocesso = 3 THEN 'mecanizacao'
        WHEN oc.negocio = 5 AND oc.processo = 2 AND oc.subprocesso = 1 THEN 'arrendamento'
        WHEN oc.negocio = 5 AND oc.processo = 1 THEN 'outros'
        ELSE 'direto'
    END AS categoria,
    TO_CHAR(c.anomes) AS anomes,
    c.cod_objetocusto,
    SUM(c.valor) AS valor
FROM custo.lancamento_custo c
LEFT JOIN custo.objetocusto oc
    ON c.cod_objetocusto = oc.cod_objetocusto
LEFT JOIN custo.empenho e
    ON c.cod_empenho = e.cod_empenho
WHERE c.tipo = 'R'
  AND e.cod_tipoempenho IN (1, 2)
  AND (
      :negociosCsv IS NULL
      OR INSTR(',' || :negociosCsv || ',', ',' || TO_CHAR(oc.negocio) || ',') > 0
  )
  AND NOT EXISTS (
      SELECT 1
      FROM custo.objetocusto b
      WHERE b.negocio = 5
        AND b.processo IN (3, 4)
        AND oc.cod_objetocusto = b.cod_objetocusto
  )
  AND NOT EXISTS (
      SELECT 1
      FROM custo.objetocusto d
      WHERE d.negocio IN (2, 98, 90, 6, 99, 8, 7)
        AND oc.cod_objetocusto = d.cod_objetocusto
  )
  AND (
      :anomesInicio IS NULL
      OR c.anomes >= :anomesInicio
  )
  AND (
      :anomesFim IS NULL
      OR c.anomes <= :anomesFim
  )
  AND (
      (
          :objetoCusto IS NULL
          AND :processo IS NULL
          AND :subprocesso IS NULL
          AND :atividade IS NULL
      )
      OR EXISTS (
          SELECT 1
          FROM custo.objetocusto f
          WHERE f.cod_objetocusto = c.cod_objetocusto
            AND (:objetoCusto IS NULL OR f.cod_objetocusto = :objetoCusto)
            AND (:processo IS NULL OR f.processo = :processo)
            AND (:subprocesso IS NULL OR f.subprocesso = :subprocesso)
            AND (:atividade IS NULL OR f.atividade = :atividade)
      )
  )
GROUP BY
    CASE
        WHEN oc.negocio = 3 AND oc.processo = 1 AND oc.subprocesso = 1 THEN 'oficina'
        WHEN oc.negocio = 3 AND oc.processo = 1 AND oc.subprocesso = 2 THEN 'transporte'
        WHEN EXISTS (
            SELECT 1
            FROM custo.empenho emp
            INNER JOIN custo.grupoempenho g
                ON emp.cod_grupoempenho = g.cod_grupoempenho
            WHERE emp.cod_empenho = c.cod_empenho
              AND emp.cod_tipoempenho IN (1, 2)
              AND g.cod_grupoempenho = 10
        )
        AND NOT (
            oc.negocio = 3
            AND oc.processo = 1
            AND oc.subprocesso IN (1, 2)
        ) THEN 'funcionario'
        WHEN oc.negocio = 3 AND oc.processo = 1 AND oc.subprocesso = 3 THEN 'mecanizacao'
        WHEN oc.negocio = 5 AND oc.processo = 2 AND oc.subprocesso = 1 THEN 'arrendamento'
        WHEN oc.negocio = 5 AND oc.processo = 1 THEN 'outros'
        ELSE 'direto'
    END,
    TO_CHAR(c.anomes),
    c.cod_objetocusto
ORDER BY
    categoria,
    anomes,
    cod_objetocusto
