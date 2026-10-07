import { getConnection } from '../config/db.js';
import { bindsObjetoCusto } from '../utils/filtros.js';

const INSUMO_SQL = `
SELECT
    m.ano_apontamento,
    m.nr_apontamento,
    m.item_apontamento,
    m.nrrequisicao,
    m.item_requisicao,
    m.cod_material,
    m.quantidade,
    NVL(req.vrcustounitario, 0) AS vrcustounitario,
    ap.data_apontamento,
    req.cod_equipamento,
    i.cod_operacao AS cod_operacaoagricola,
    NVL(i.cod_objetocusto, d.cod_objetocusto) AS objetocustooperacao,
    req.cod_objetocusto AS objetocustorequisicao,
    i.cod_fazenda,
    i.cod_talhao,
    (m.quantidade * NVL(req.vrcustounitario, 0)) AS valor_total
FROM agricola.apontamentomaterial m
INNER JOIN agricola.apontamentoitem i
    ON i.cod_grupoempresa = m.cod_grupoempresa
   AND i.cod_empresa = m.cod_empresa
   AND i.cod_filial = m.cod_filial
   AND i.ano_apontamento = m.ano_apontamento
   AND i.nr_apontamento = m.nr_apontamento
   AND i.item_apontamento = m.item_apontamento
INNER JOIN agricola.apontamento ap
    ON ap.cod_grupoempresa = m.cod_grupoempresa
   AND ap.cod_empresa = m.cod_empresa
   AND ap.cod_filial = m.cod_filial
   AND ap.ano_apontamento = m.ano_apontamento
   AND ap.nr_apontamento = m.nr_apontamento
LEFT JOIN material.itensrequisicaomaterial req
    ON req.nrrequisicao = m.nrrequisicao
   AND req.cod_material = m.cod_material
   AND req.item = m.item_requisicao
LEFT JOIN (
    SELECT *
    FROM rh.operacaoobjetocusto
    WHERE data_termino IS NULL
) d
    ON i.cod_operacao = d.cod_operacaoagricola
WHERE (
    :anomesInicio IS NULL
    OR TO_CHAR(ap.data_apontamento, 'YYYYMM') >= :anomesInicio
)
AND (
    :anomesFim IS NULL
    OR TO_CHAR(ap.data_apontamento, 'YYYYMM') <= :anomesFim
)
AND (
    :equipamento IS NULL
    OR req.cod_equipamento = :equipamento
)
AND (
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
        WHERE oc.cod_objetocusto = NVL(
            NVL(i.cod_objetocusto, d.cod_objetocusto),
            req.cod_objetocusto
        )
          AND (:objetoCusto IS NULL OR oc.cod_objetocusto = :objetoCusto)
          AND (:negociosCsv IS NULL OR INSTR(',' || :negociosCsv || ',', ',' || TO_CHAR(oc.negocio) || ',') > 0)
          AND (:processo IS NULL OR oc.processo = :processo)
          AND (:subprocesso IS NULL OR oc.subprocesso = :subprocesso)
          AND (:atividade IS NULL OR oc.atividade = :atividade)
    )
)
ORDER BY
    ap.data_apontamento,
    i.cod_operacao,
    m.cod_material
`;

const INSUMO_BASE_SQL = `
WITH insumos AS (
    SELECT
        TO_CHAR(ap.data_apontamento, 'YYYYMM') AS anomes,
        req.cod_equipamento,
        i.cod_operacao AS cod_operacaoagricola,
        NVL(i.cod_objetocusto, d.cod_objetocusto) AS objetocustooperacao,
        req.cod_objetocusto AS objetocustorequisicao,
        i.cod_fazenda,
        i.cod_talhao,
        m.cod_material,
        m.quantidade,
        (m.quantidade * NVL(req.vrcustounitario, 0)) AS valor_total
    FROM agricola.apontamentomaterial m
    INNER JOIN agricola.apontamentoitem i
        ON i.cod_grupoempresa = m.cod_grupoempresa
       AND i.cod_empresa = m.cod_empresa
       AND i.cod_filial = m.cod_filial
       AND i.ano_apontamento = m.ano_apontamento
       AND i.nr_apontamento = m.nr_apontamento
       AND i.item_apontamento = m.item_apontamento
    INNER JOIN agricola.apontamento ap
        ON ap.cod_grupoempresa = m.cod_grupoempresa
       AND ap.cod_empresa = m.cod_empresa
       AND ap.cod_filial = m.cod_filial
       AND ap.ano_apontamento = m.ano_apontamento
       AND ap.nr_apontamento = m.nr_apontamento
    LEFT JOIN material.itensrequisicaomaterial req
        ON req.nrrequisicao = m.nrrequisicao
       AND req.cod_material = m.cod_material
       AND req.item = m.item_requisicao
    LEFT JOIN (
        SELECT *
        FROM rh.operacaoobjetocusto
        WHERE data_termino IS NULL
    ) d
        ON i.cod_operacao = d.cod_operacaoagricola
    WHERE (
        :anomesInicio IS NULL
        OR TO_CHAR(ap.data_apontamento, 'YYYYMM') >= :anomesInicio
    )
    AND (
        :anomesFim IS NULL
        OR TO_CHAR(ap.data_apontamento, 'YYYYMM') <= :anomesFim
    )
    AND (
        :equipamento IS NULL
        OR req.cod_equipamento = :equipamento
    )
    AND (
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
            WHERE oc.cod_objetocusto = NVL(
                NVL(i.cod_objetocusto, d.cod_objetocusto),
                req.cod_objetocusto
            )
              AND (:objetoCusto IS NULL OR oc.cod_objetocusto = :objetoCusto)
              AND (:negociosCsv IS NULL OR INSTR(',' || :negociosCsv || ',', ',' || TO_CHAR(oc.negocio) || ',') > 0)
              AND (:processo IS NULL OR oc.processo = :processo)
              AND (:subprocesso IS NULL OR oc.subprocesso = :subprocesso)
              AND (:atividade IS NULL OR oc.atividade = :atividade)
        )
    )
)
SELECT
    anomes,
    cod_equipamento,
    cod_operacaoagricola,
    objetocustooperacao,
    objetocustorequisicao,
    cod_fazenda,
    cod_talhao,
    cod_material,
    SUM(NVL(quantidade, 0)) AS quantidade,
    SUM(NVL(valor_total, 0)) AS custo_insumo,
    COUNT(*) AS qtd_itens
FROM insumos
GROUP BY
    anomes,
    cod_equipamento,
    cod_operacaoagricola,
    objetocustooperacao,
    objetocustorequisicao,
    cod_fazenda,
    cod_talhao,
    cod_material
ORDER BY
    anomes,
    cod_operacaoagricola,
    cod_fazenda,
    cod_talhao,
    cod_material
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

function mapInsumoRow(row) {
  return {
    origem: 'insumo',
    anoApontamento: row.ANO_APONTAMENTO,
    nrApontamento: row.NR_APONTAMENTO,
    itemApontamento: row.ITEM_APONTAMENTO,
    nrRequisicao: row.NRREQUISICAO,
    itemRequisicao: row.ITEM_REQUISICAO,
    codMaterial: row.COD_MATERIAL,
    quantidade: toNumber(row.QUANTIDADE),
    vrCustoUnitario: toNumber(row.VRCUSTOUNITARIO),
    dataApontamento: row.DATA_APONTAMENTO,
    codEquipamento: row.COD_EQUIPAMENTO,
    codOperacaoAgricola: row.COD_OPERACAOAGRICOLA,
    objetoCustoOperacao: row.OBJETOCUSTOOPERACAO,
    objetoCustoRequisicao: row.OBJETOCUSTOREQUISICAO,
    codFazenda: row.COD_FAZENDA,
    codTalhao: row.COD_TALHAO,
    valorTotal: toNumber(row.VALOR_TOTAL),
  };
}

function mapInsumoBaseRow(row) {
  return {
    anomes: row.ANOMES != null ? String(row.ANOMES) : null,
    codEquipamento: row.COD_EQUIPAMENTO,
    codOperacaoAgricola: row.COD_OPERACAOAGRICOLA,
    objetoCustoOperacao: row.OBJETOCUSTOOPERACAO,
    objetoCustoRequisicao: row.OBJETOCUSTOREQUISICAO,
    codFazenda: row.COD_FAZENDA,
    codTalhao: row.COD_TALHAO,
    codMaterial: row.COD_MATERIAL != null ? String(row.COD_MATERIAL) : null,
    quantidade: toNumber(row.QUANTIDADE) || 0,
    custoInsumo: toNumber(row.CUSTO_INSUMO) || 0,
    qtdItens: toNumber(row.QTD_ITENS) || 0,
  };
}

export async function consultarInsumos(filtros = {}) {
  const connection = await getConnection();

  try {
    const result = await connection.execute(INSUMO_SQL, buildBinds(filtros));
    const dados = (result.rows || []).map(mapInsumoRow);

    return {
      filtros,
      resumo: {
        totalLinhas: dados.length,
        totalQuantidade: dados.reduce((acc, r) => acc + (r.quantidade || 0), 0),
        totalValor: dados.reduce((acc, r) => acc + (r.valorTotal || 0), 0),
      },
      dados,
    };
  } finally {
    await connection.close();
  }
}

export async function consultarBaseInsumos(filtros = {}) {
  const connection = await getConnection();

  try {
    const result = await connection.execute(INSUMO_BASE_SQL, buildBinds(filtros));
    return (result.rows || []).map(mapInsumoBaseRow);
  } finally {
    await connection.close();
  }
}
