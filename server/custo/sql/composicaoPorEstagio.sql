-- Custo por estágio de produção (pool lancamento_custo, buckets exclusivos).
-- Exclui negócio 5 processo 3/4 e negócios 2, 98, 90, 6, 99, 8, 7.
SELECT
    NVL(SUM(CASE WHEN a.negocio = 1 AND a.processo = 2 THEN c.valor ELSE 0 END), 0) AS tratos_soca,
    NVL(SUM(CASE WHEN a.negocio = 1 AND a.processo = 3 THEN c.valor ELSE 0 END), 0) AS corte_transbordo,
    NVL(SUM(CASE WHEN a.negocio = 1 AND a.processo = 1 THEN c.valor ELSE 0 END), 0) AS formacao,
    NVL(SUM(CASE WHEN a.negocio = 5 AND a.processo = 2 THEN c.valor ELSE 0 END), 0) AS arrendamento,
    NVL(SUM(
        CASE
            WHEN a.negocio = 3 AND a.processo = 1 AND a.subprocesso = 2 THEN c.valor
            ELSE 0
        END
    ), 0) AS transporte,
    NVL(SUM(
        CASE
            WHEN a.negocio = 5 AND a.processo = 1 THEN c.valor
            WHEN a.negocio = 3 AND NOT (a.processo = 1 AND a.subprocesso = 2) THEN c.valor
            ELSE 0
        END
    ), 0) AS apoio_adm,
    NVL(SUM(c.valor), 0) AS total_lancamento
FROM custo.lancamento_custo c
LEFT JOIN custo.objetocusto a
    ON c.cod_objetocusto = a.cod_objetocusto
LEFT JOIN custo.empenho e
    ON c.cod_empenho = e.cod_empenho
WHERE c.tipo = 'R'
  AND e.cod_tipoempenho IN (1, 2)
  AND (
      :negociosCsv IS NULL
      OR INSTR(',' || :negociosCsv || ',', ',' || TO_CHAR(a.negocio) || ',') > 0
  )
  AND NOT EXISTS (
      SELECT 1
      FROM custo.objetocusto b
      WHERE b.negocio = 5
        AND b.processo IN (3, 4)
        AND a.cod_objetocusto = b.cod_objetocusto
  )
  AND NOT EXISTS (
      SELECT 1
      FROM custo.objetocusto d
      WHERE d.negocio IN (2, 98, 90, 6, 99, 8, 7)
        AND a.cod_objetocusto = d.cod_objetocusto
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
          FROM custo.objetocusto oc
          WHERE oc.cod_objetocusto = c.cod_objetocusto
            AND (:objetoCusto IS NULL OR oc.cod_objetocusto = :objetoCusto)
            AND (:processo IS NULL OR oc.processo = :processo)
            AND (:subprocesso IS NULL OR oc.subprocesso = :subprocesso)
            AND (:atividade IS NULL OR oc.atividade = :atividade)
      )
  )
