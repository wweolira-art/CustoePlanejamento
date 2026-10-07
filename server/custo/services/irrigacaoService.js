import { executeQuery } from '../utils/oracle.js';
import { bindsObjetoCusto } from '../utils/filtros.js';

/**
 * Complemento de operação/fazenda/talhão para equipamentos de irrigação.
 *
 * 1) Apontamento tipo I (irrigacaoapontinsumo + irrigacaoapontitem)
 * 2) OS de irrigação (irrigacaoosinsumo + irrigacaoositem) — query informada
 */
const IRRIGACAO_BASE_SQL = `
WITH apont_irrig AS (
    SELECT
        TO_CHAR(ap.data_apontamento, 'YYYYMM') AS anomes,
        ai.cod_insumo AS cod_equipamento,
        it.cod_operacao AS cod_operacaoagricola,
        it.cod_fazenda,
        it.cod_talhao,
        it.cod_objetocusto AS objetocustooperacao,
        NVL(it.area, 1) AS peso,
        'APONTAMENTO_I' AS origem
    FROM agricola.irrigacaoapontinsumo ai
    INNER JOIN agricola.apontamento ap
        ON ai.cod_grupoempresa = ap.cod_grupoempresa
       AND ai.cod_empresa = ap.cod_empresa
       AND ai.cod_filial = ap.cod_filial
       AND ai.ano_apontamento = ap.ano_apontamento
       AND ai.nr_apontamento = ap.nr_apontamento
    INNER JOIN agricola.irrigacaoapontitem it
        ON ai.cod_grupoempresa = it.cod_grupoempresa
       AND ai.cod_empresa = it.cod_empresa
       AND ai.cod_filial = it.cod_filial
       AND ai.ano_apontamento = it.ano_apontamento
       AND ai.nr_apontamento = it.nr_apontamento
       AND ai.item_apontamento = it.item_apontamento
    WHERE ap.tipo_apontamento = 'I'
      AND ai.tipo_insumo = 'E'
      AND (
          :anomesInicio IS NULL
          OR TO_CHAR(ap.data_apontamento, 'YYYYMM') >= :anomesInicio
      )
      AND (
          :anomesFim IS NULL
          OR TO_CHAR(ap.data_apontamento, 'YYYYMM') <= :anomesFim
      )
      AND (
          :equipamento IS NULL
          OR ai.cod_insumo = :equipamento
      )
),
os_irrig AS (
    SELECT
        CASE
            WHEN b.data_encerramento IS NOT NULL
                THEN TO_CHAR(b.data_encerramento, 'YYYYMM')
            ELSE TO_CHAR(a.ano_ordemservico) || '01'
        END AS anomes,
        a.cod_insumo AS cod_equipamento,
        b.cod_operacao AS cod_operacaoagricola,
        b.cod_fazenda,
        b.cod_talhao,
        b.cod_objetocusto AS objetocustooperacao,
        NVL(b.area, 1) AS peso,
        'OS_IRRIGACAO' AS origem
    FROM agricola.irrigacaoosinsumo a
    INNER JOIN agricola.irrigacaoositem b
        ON a.cod_grupoempresa = b.cod_grupoempresa
       AND a.cod_empresa = b.cod_empresa
       AND a.cod_filial = b.cod_filial
       AND a.ano_ordemservico = b.ano_ordemservico
       AND a.nr_ordemservico = b.nr_ordemservico
       AND a.item_ordemservico = b.item_ordemservico
    WHERE a.tipo_insumo = 'E'
      AND (
          :equipamento IS NULL
          OR a.cod_insumo = :equipamento
      )
      AND (
          (
              b.data_encerramento IS NOT NULL
              AND (
                  :anomesInicio IS NULL
                  OR TO_CHAR(b.data_encerramento, 'YYYYMM') >= :anomesInicio
              )
              AND (
                  :anomesFim IS NULL
                  OR TO_CHAR(b.data_encerramento, 'YYYYMM') <= :anomesFim
              )
          )
          OR (
              b.data_encerramento IS NULL
              AND (
                  :anomesInicio IS NULL
                  OR a.ano_ordemservico >= TO_NUMBER(SUBSTR(:anomesInicio, 1, 4))
              )
              AND (
                  :anomesFim IS NULL
                  OR a.ano_ordemservico <= TO_NUMBER(SUBSTR(:anomesFim, 1, 4))
              )
          )
      )
),
uniao AS (
    SELECT * FROM apont_irrig
    UNION ALL
    SELECT * FROM os_irrig
)
SELECT
    anomes,
    cod_equipamento,
    cod_operacaoagricola,
    cod_fazenda,
    cod_talhao,
    objetocustooperacao,
    SUM(peso) AS peso,
    COUNT(*) AS qtd_itens,
    MAX(origem) AS origem
FROM uniao u
WHERE (
    (
        :objetoCusto IS NULL
        AND :negociosCsv IS NULL
        AND :processo IS NULL
        AND :subprocesso IS NULL
        AND :atividade IS NULL
    )
    OR EXISTS (
        SELECT 1
        FROM custo.objetocusto oc
        WHERE oc.cod_objetocusto = u.objetocustooperacao
          AND (:objetoCusto IS NULL OR oc.cod_objetocusto = :objetoCusto)
          AND (:negociosCsv IS NULL OR INSTR(',' || :negociosCsv || ',', ',' || TO_CHAR(oc.negocio) || ',') > 0)
          AND (:processo IS NULL OR oc.processo = :processo)
          AND (:subprocesso IS NULL OR oc.subprocesso = :subprocesso)
          AND (:atividade IS NULL OR oc.atividade = :atividade)
    )
)
GROUP BY
    anomes,
    cod_equipamento,
    cod_operacaoagricola,
    cod_fazenda,
    cod_talhao,
    objetocustooperacao
ORDER BY
    anomes,
    cod_equipamento,
    cod_operacaoagricola
`;

const IRRIGACAO_DETALHE_SQL = `
SELECT
    ap.data_apontamento,
    ai.ano_apontamento,
    ai.nr_apontamento,
    ai.item_apontamento,
    ai.cod_insumo AS cod_equipamento,
    it.cod_operacao AS cod_operacaoagricola,
    it.cod_fazenda,
    it.cod_talhao,
    it.cod_objetocusto AS objetocustooperacao,
    it.area,
    'APONTAMENTO_I' AS origem
FROM agricola.irrigacaoapontinsumo ai
INNER JOIN agricola.apontamento ap
    ON ai.cod_grupoempresa = ap.cod_grupoempresa
   AND ai.cod_empresa = ap.cod_empresa
   AND ai.cod_filial = ap.cod_filial
   AND ai.ano_apontamento = ap.ano_apontamento
   AND ai.nr_apontamento = ap.nr_apontamento
INNER JOIN agricola.irrigacaoapontitem it
    ON ai.cod_grupoempresa = it.cod_grupoempresa
   AND ai.cod_empresa = it.cod_empresa
   AND ai.cod_filial = it.cod_filial
   AND ai.ano_apontamento = it.ano_apontamento
   AND ai.nr_apontamento = it.nr_apontamento
   AND ai.item_apontamento = it.item_apontamento
WHERE ap.tipo_apontamento = 'I'
  AND ai.tipo_insumo = 'E'
  AND (
      :anomesInicio IS NULL
      OR TO_CHAR(ap.data_apontamento, 'YYYYMM') >= :anomesInicio
  )
  AND (
      :anomesFim IS NULL
      OR TO_CHAR(ap.data_apontamento, 'YYYYMM') <= :anomesFim
  )
  AND (
      :equipamento IS NULL
      OR ai.cod_insumo = :equipamento
  )

UNION ALL

SELECT
    b.data_encerramento AS data_apontamento,
    a.ano_ordemservico AS ano_apontamento,
    a.nr_ordemservico AS nr_apontamento,
    a.item_ordemservico AS item_apontamento,
    a.cod_insumo AS cod_equipamento,
    b.cod_operacao AS cod_operacaoagricola,
    b.cod_fazenda,
    b.cod_talhao,
    b.cod_objetocusto AS objetocustooperacao,
    b.area,
    'OS_IRRIGACAO' AS origem
FROM agricola.irrigacaoosinsumo a
INNER JOIN agricola.irrigacaoositem b
    ON a.cod_grupoempresa = b.cod_grupoempresa
   AND a.cod_empresa = b.cod_empresa
   AND a.cod_filial = b.cod_filial
   AND a.ano_ordemservico = b.ano_ordemservico
   AND a.nr_ordemservico = b.nr_ordemservico
   AND a.item_ordemservico = b.item_ordemservico
WHERE a.tipo_insumo = 'E'
  AND (
      :equipamento IS NULL
      OR a.cod_insumo = :equipamento
  )
  AND (
      (
          b.data_encerramento IS NOT NULL
          AND (
              :anomesInicio IS NULL
              OR TO_CHAR(b.data_encerramento, 'YYYYMM') >= :anomesInicio
          )
          AND (
              :anomesFim IS NULL
              OR TO_CHAR(b.data_encerramento, 'YYYYMM') <= :anomesFim
          )
      )
      OR (
          b.data_encerramento IS NULL
          AND (
              :anomesInicio IS NULL
              OR a.ano_ordemservico >= TO_NUMBER(SUBSTR(:anomesInicio, 1, 4))
          )
          AND (
              :anomesFim IS NULL
              OR a.ano_ordemservico <= TO_NUMBER(SUBSTR(:anomesFim, 1, 4))
          )
      )
  )
ORDER BY
    1,
    5,
    6
`;

function toNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildBinds(filtros = {}) {
  return {
    anomesInicio: filtros.anomesInicio || filtros.anomes || null,
    anomesFim: filtros.anomesFim || filtros.anomes || null,
    equipamento: filtros.equipamento || null,
    ...bindsObjetoCusto(filtros),
  };
}

function mapBaseRow(row) {
  return {
    anomes: row.ANOMES != null ? String(row.ANOMES) : null,
    codEquipamento: row.COD_EQUIPAMENTO,
    codOperacaoAgricola: row.COD_OPERACAOAGRICOLA,
    codFazenda: row.COD_FAZENDA,
    codTalhao: row.COD_TALHAO,
    objetoCustoOperacao: row.OBJETOCUSTOOPERACAO,
    peso: toNumber(row.PESO) || 0,
    qtdItens: toNumber(row.QTD_ITENS) || 0,
    origem: row.ORIGEM,
  };
}

function mapDetalheRow(row) {
  return {
    dataApontamento: row.DATA_APONTAMENTO,
    anoApontamento: row.ANO_APONTAMENTO,
    nrApontamento: row.NR_APONTAMENTO,
    itemApontamento: row.ITEM_APONTAMENTO,
    codEquipamento: row.COD_EQUIPAMENTO,
    codOperacaoAgricola: row.COD_OPERACAOAGRICOLA,
    codFazenda: row.COD_FAZENDA,
    codTalhao: row.COD_TALHAO,
    objetoCustoOperacao: row.OBJETOCUSTOOPERACAO,
    area: toNumber(row.AREA),
    origem: row.ORIGEM,
  };
}

export async function consultarBaseIrrigacao(filtros = {}) {
  const result = await executeQuery(IRRIGACAO_BASE_SQL, buildBinds(filtros));
  return (result.rows || []).map(mapBaseRow);
}

export async function consultarIrrigacao(filtros = {}) {
  const result = await executeQuery(IRRIGACAO_DETALHE_SQL, buildBinds(filtros));
  const dados = (result.rows || []).map(mapDetalheRow);

  return {
    filtros,
    resumo: {
      totalLinhas: dados.length,
      qtdEquipamentos: new Set(
        dados.map((r) => r.codEquipamento).filter((v) => v != null)
      ).size,
      qtdOperacoes: new Set(
        dados.map((r) => r.codOperacaoAgricola).filter((v) => v != null)
      ).size,
    },
    dados,
  };
}
