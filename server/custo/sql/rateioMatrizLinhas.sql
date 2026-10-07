-- Rateio → matriz por subprocesso destino, empenho e item de custo (equip. automotivo).
WITH filt AS (
    SELECT
        c.cod_objetocusto,
        c.anomes,
        c.cod_item_custo,
        c.cod_empenho,
        c.valor,
        a.negocio,
        a.processo AS orig_processo,
        e.cod_grupoempenho
    FROM custo.lancamento_custo c
    JOIN custo.objetocusto a ON a.cod_objetocusto = c.cod_objetocusto
    JOIN custo.empenho e ON e.cod_empenho = c.cod_empenho
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
),
dg AS (
    SELECT
        d.cod_objetocusto,
        d.anomes,
        d.cod_item_custo,
        d.cod_objetocustocliente,
        d.porcentagem
    FROM custo.distribuicaogasto d
    JOIN custo.objetocusto cli ON cli.cod_objetocusto = d.cod_objetocustocliente
    WHERE d.tipo = 'R'
      AND cli.negocio = 1
      AND (
          :anomesInicio IS NULL
          OR d.anomes >= :anomesInicio
      )
      AND (
          :anomesFim IS NULL
          OR d.anomes <= :anomesFim
      )
),
dg_item AS (
    SELECT
        cod_objetocusto,
        anomes,
        cod_item_custo,
        cod_objetocustocliente,
        SUM(porcentagem) AS w
    FROM dg
    GROUP BY
        cod_objetocusto,
        anomes,
        cod_item_custo,
        cod_objetocustocliente
),
dg_item_tot AS (
    SELECT
        cod_objetocusto,
        anomes,
        cod_item_custo,
        SUM(w) AS wtot
    FROM dg_item
    GROUP BY cod_objetocusto, anomes, cod_item_custo
),
dg_obj AS (
    SELECT
        cod_objetocusto,
        anomes,
        cod_objetocustocliente,
        SUM(porcentagem) AS w
    FROM dg
    GROUP BY cod_objetocusto, anomes, cod_objetocustocliente
),
dg_obj_tot AS (
    SELECT cod_objetocusto, anomes, SUM(w) AS wtot
    FROM dg_obj
    GROUP BY cod_objetocusto, anomes
),
util AS (
    SELECT
        u.cod_objetoprestador,
        u.anomes,
        u.cod_objetocliente,
        u.quantidade AS w
    FROM custo.utilizacao u
    JOIN custo.objetocusto cli ON cli.cod_objetocusto = u.cod_objetocliente
    WHERE u.tipo = 'R'
      AND NVL(u.considera_rateio, 'S') = 'S'
      AND cli.negocio = 1
      AND (
          :anomesInicio IS NULL
          OR u.anomes >= :anomesInicio
      )
      AND (
          :anomesFim IS NULL
          OR u.anomes <= :anomesFim
      )
),
util_tot AS (
    SELECT cod_objetoprestador, anomes, SUM(w) AS wtot
    FROM util
    GROUP BY cod_objetoprestador, anomes
),
util_global AS (
    SELECT anomes, cod_objetocliente, SUM(w) AS w
    FROM util
    GROUP BY anomes, cod_objetocliente
),
util_global_tot AS (
    SELECT anomes, SUM(w) AS wtot
    FROM util_global
    GROUP BY anomes
),
exp AS (
    SELECT
        f.cod_objetocusto AS origem,
        f.anomes,
        f.cod_item_custo,
        f.cod_empenho,
        f.cod_grupoempenho,
        f.orig_processo,
        f.negocio AS neg_origem,
        f.valor,
        COALESCE(
            di.cod_objetocustocliente,
            dobj.cod_objetocustocliente,
            u.cod_objetocliente,
            ug.cod_objetocliente,
            CASE WHEN f.negocio = 1 THEN f.cod_objetocusto END
        ) AS dest_obj,
        COALESCE(
            di.w / NULLIF(dit.wtot, 0),
            dobj.w / NULLIF(dot.wtot, 0),
            u.w / NULLIF(ut.wtot, 0),
            ug.w / NULLIF(ugt.wtot, 0),
            CASE WHEN f.negocio = 1 THEN 1 END
        ) AS frac
    FROM filt f
    LEFT JOIN dg_item di
        ON di.cod_objetocusto = f.cod_objetocusto
       AND di.anomes = f.anomes
       AND di.cod_item_custo = f.cod_item_custo
    LEFT JOIN dg_item_tot dit
        ON dit.cod_objetocusto = f.cod_objetocusto
       AND dit.anomes = f.anomes
       AND dit.cod_item_custo = f.cod_item_custo
    LEFT JOIN dg_obj dobj
        ON dobj.cod_objetocusto = f.cod_objetocusto
       AND dobj.anomes = f.anomes
       AND dit.wtot IS NULL
    LEFT JOIN dg_obj_tot dot
        ON dot.cod_objetocusto = f.cod_objetocusto
       AND dot.anomes = f.anomes
       AND dit.wtot IS NULL
    LEFT JOIN util u
        ON u.cod_objetoprestador = f.cod_objetocusto
       AND u.anomes = f.anomes
       AND dit.wtot IS NULL
       AND dot.wtot IS NULL
    LEFT JOIN util_tot ut
        ON ut.cod_objetoprestador = f.cod_objetocusto
       AND ut.anomes = f.anomes
       AND dit.wtot IS NULL
       AND dot.wtot IS NULL
    LEFT JOIN util_global ug
        ON ug.anomes = f.anomes
       AND dit.wtot IS NULL
       AND dot.wtot IS NULL
       AND ut.wtot IS NULL
       AND f.negocio <> 1
    LEFT JOIN util_global_tot ugt
        ON ugt.anomes = f.anomes
       AND dit.wtot IS NULL
       AND dot.wtot IS NULL
       AND ut.wtot IS NULL
       AND f.negocio <> 1
),
rateio AS (
    SELECT
        origem,
        cod_item_custo,
        cod_empenho,
        cod_grupoempenho,
        orig_processo,
        neg_origem,
        dest_obj,
        SUM(valor * frac) AS valor_rateado
    FROM exp
    WHERE dest_obj IS NOT NULL
      AND frac IS NOT NULL
    GROUP BY
        origem,
        cod_item_custo,
        cod_empenho,
        cod_grupoempenho,
        orig_processo,
        neg_origem,
        dest_obj
)
SELECT
    dest.processo AS dest_processo,
    dest.subprocesso AS dest_subprocesso,
    dest.descricao AS dest_descricao,
    r.cod_grupoempenho,
    ge.descricao AS grupo_empenho,
    r.cod_empenho,
    emp.descricao AS empenho_descricao,
    ic.cod_grupo_item_custo,
    gic.descricao AS grupo_item_descricao,
    r.cod_item_custo,
    ic.descricao AS item_descricao,
    r.neg_origem,
    r.orig_processo,
    SUM(r.valor_rateado) AS valor
FROM rateio r
JOIN custo.objetocusto dest ON dest.cod_objetocusto = r.dest_obj
LEFT JOIN custo.empenho emp ON emp.cod_empenho = r.cod_empenho
LEFT JOIN custo.grupoempenho ge ON ge.cod_grupoempenho = r.cod_grupoempenho
LEFT JOIN custo.item_custo ic
    ON ic.cod_item_custo = r.cod_item_custo
   AND r.cod_item_custo <> 0
LEFT JOIN custo.grupo_item_custo gic
    ON gic.cod_grupo_item_custo = ic.cod_grupo_item_custo
GROUP BY
    dest.processo,
    dest.subprocesso,
    dest.descricao,
    r.cod_grupoempenho,
    ge.descricao,
    r.cod_empenho,
    emp.descricao,
    ic.cod_grupo_item_custo,
    gic.descricao,
    r.cod_item_custo,
    ic.descricao,
    r.neg_origem,
    r.orig_processo
