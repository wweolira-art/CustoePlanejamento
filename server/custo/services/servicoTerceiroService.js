import { getConnection } from '../config/db.js';
import { bindsObjetoCusto } from '../utils/filtros.js';

/**
 * Serviços de terceiro (variável + fixo): parcela com empenho tipo 1 ou 2
 * (custo.empenho.cod_tipoempenho), via parcelascontrato.cod_empenho.
 */
const FILTRO_EMPENHO_VARIAVEL = `
AND EXISTS (
    SELECT 1
    FROM custo.empenho emp
    WHERE emp.cod_empenho = c.cod_empenho
      AND emp.cod_tipoempenho IN (1, 2)
)
`;

const FILTRO_EMPENHO_FIXO = `
AND EXISTS (
    SELECT 1
    FROM custo.empenho emp
    WHERE emp.cod_empenho = a.cod_empenho
      AND emp.cod_tipoempenho IN (1, 2)
)
`;

const FILTRO_PERIODO = `
WHERE (
    :anomesInicio IS NULL
    OR TO_CHAR(c.datainicio, 'YYYYMM') >= :anomesInicio
)
AND (
    :anomesFim IS NULL
    OR TO_CHAR(c.datainicio, 'YYYYMM') <= :anomesFim
)
AND (
    :equipamento IS NULL
    OR i.cod_equipamento = :equipamento
)
`;

const FILTRO_OBJETO = `
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
        WHERE oc.cod_objetocusto = NVL(i.cod_objetocusto, d.cod_objetocusto)
          AND (:objetoCusto IS NULL OR oc.cod_objetocusto = :objetoCusto)
          AND (:negociosCsv IS NULL OR INSTR(',' || :negociosCsv || ',', ',' || TO_CHAR(oc.negocio) || ',') > 0)
          AND (:processo IS NULL OR oc.processo = :processo)
          AND (:subprocesso IS NULL OR oc.subprocesso = :subprocesso)
          AND (:atividade IS NULL OR oc.atividade = :atividade)
    )
)
`;

const FROM_SQL = `
FROM financeiro.itemcontratovariavel i
LEFT JOIN financeiro.parcelascontrato c
    ON i.numerocontrato = c.numerocontrato
   AND i.parcela = c.parcela
   AND i.cod_grupoempresa = c.cod_grupoempresa
INNER JOIN rh.operacaoagricola o
    ON o.cod_operacaoagricola = i.cod_servico
LEFT JOIN rh.operacaoobjetocusto d
    ON d.cod_operacaoagricola = i.cod_servico
   AND d.data_termino IS NULL
`;

const SERVICO_SQL = `
SELECT
    c.datainicio,
    TO_CHAR(c.datainicio, 'YYYYMM') AS anomes,
    i.numerocontrato,
    i.parcela,
    i.item,
    i.cod_servico,
    o.cod_operacaoagricola,
    o.descricao AS descricao_operacao,
    NVL(i.cod_objetocusto, d.cod_objetocusto) AS objetocustooperacao,
    i.qtde,
    i.vlrunitario,
    i.vlrtotal,
    i.cod_fazenda,
    i.cod_talhao,
    i.cod_equipamento,
    c.cod_empenho
${FROM_SQL}
${FILTRO_PERIODO}
${FILTRO_EMPENHO_VARIAVEL}
${FILTRO_OBJETO}
ORDER BY
    c.datainicio,
    i.numerocontrato,
    i.parcela,
    i.item
`;

const SERVICO_BASE_SQL = `
WITH servicos AS (
    SELECT
        TO_CHAR(c.datainicio, 'YYYYMM') AS anomes,
        i.cod_equipamento,
        i.cod_servico AS cod_operacaoagricola,
        NVL(i.cod_objetocusto, d.cod_objetocusto) AS objetocustooperacao,
        i.cod_fazenda,
        i.cod_talhao,
        i.cod_servico,
        o.descricao AS descricao_operacao,
        i.qtde,
        i.vlrtotal
    ${FROM_SQL}
    ${FILTRO_PERIODO}
    ${FILTRO_EMPENHO_VARIAVEL}
    ${FILTRO_OBJETO}
)
SELECT
    anomes,
    cod_equipamento,
    cod_operacaoagricola,
    objetocustooperacao,
    cod_fazenda,
    cod_talhao,
    cod_servico,
    MAX(descricao_operacao) AS descricao_operacao,
    SUM(NVL(qtde, 0)) AS quantidade,
    SUM(NVL(vlrtotal, 0)) AS custo_servico,
    COUNT(*) AS qtd_itens
FROM servicos
GROUP BY
    anomes,
    cod_equipamento,
    cod_operacaoagricola,
    objetocustooperacao,
    cod_fazenda,
    cod_talhao,
    cod_servico
ORDER BY
    anomes,
    cod_operacaoagricola,
    cod_fazenda,
    cod_talhao,
    cod_servico
`;

const ORIGEM_NUM = `CASE
        WHEN REGEXP_LIKE(TRIM(ic.cod_origem), '^[0-9]+$')
        THEN TO_NUMBER(TRIM(ic.cod_origem))
    END`;

const FROM_FIXO_SQL = `
FROM financeiro.parcelascontrato a
INNER JOIN financeiro.historicocontrato b
    ON a.numerocontrato = b.numerocontrato
   AND a.cod_grupoempresa = b.cod_grupoempresa
   AND b.fixovariavel = 'F'
   AND a.datainicio BETWEEN b.datainicio AND NVL(b.datatermino, SYSDATE)
   AND b.id_histocontrat = (
        SELECT MAX(b2.id_histocontrat)
        FROM financeiro.historicocontrato b2
        WHERE b2.numerocontrato = a.numerocontrato
          AND b2.cod_grupoempresa = a.cod_grupoempresa
          AND b2.fixovariavel = 'F'
          AND a.datainicio BETWEEN b2.datainicio AND NVL(b2.datatermino, SYSDATE)
   )
LEFT JOIN custo.item_custo ic
    ON b.cod_item_custo = ic.cod_item_custo
LEFT JOIN financeiro.contrato ct
    ON a.numerocontrato = ct.numerocontrato
   AND a.cod_empresa = ct.cod_empresa
   AND a.cod_filial = ct.cod_filial
   AND a.cod_grupoempresa = ct.cod_grupoempresa
`;

const FILTRO_PERIODO_FIXO = `
WHERE (
    :anomesInicio IS NULL
    OR TO_CHAR(a.datainicio, 'YYYYMM') >= :anomesInicio
)
AND (
    :anomesFim IS NULL
    OR TO_CHAR(a.datainicio, 'YYYYMM') <= :anomesFim
)
AND :equipamento IS NULL
`;

const FILTRO_OBJETO_FIXO = `
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
        WHERE oc.cod_objetocusto = a.cod_objetocusto
          AND (:objetoCusto IS NULL OR oc.cod_objetocusto = :objetoCusto)
          AND (:negociosCsv IS NULL OR INSTR(',' || :negociosCsv || ',', ',' || TO_CHAR(oc.negocio) || ',') > 0)
          AND (:processo IS NULL OR oc.processo = :processo)
          AND (:subprocesso IS NULL OR oc.subprocesso = :subprocesso)
          AND (:atividade IS NULL OR oc.atividade = :atividade)
    )
)
`;

const SERVICO_FIXO_SQL = `
SELECT
    a.datainicio,
    TO_CHAR(a.datainicio, 'YYYYMM') AS anomes,
    a.numerocontrato,
    ct.cod_fornecedor,
    a.parcela,
    a.valor AS vlrtotal,
    a.cod_empenho,
    a.cod_objetocusto AS objetocustooperacao,
    ${ORIGEM_NUM} AS cod_origem,
    ic.descricao AS descricao_item
${FROM_FIXO_SQL}
${FILTRO_PERIODO_FIXO}
${FILTRO_EMPENHO_FIXO}
${FILTRO_OBJETO_FIXO}
ORDER BY
    a.datainicio,
    a.numerocontrato,
    a.parcela
`;

const SERVICO_FIXO_BASE_SQL = `
WITH servicos AS (
    SELECT
        TO_CHAR(a.datainicio, 'YYYYMM') AS anomes,
        a.cod_objetocusto AS objetocustooperacao,
        ${ORIGEM_NUM} AS cod_servico,
        ic.descricao AS descricao_item,
        a.valor AS vlrtotal
    ${FROM_FIXO_SQL}
    ${FILTRO_PERIODO_FIXO}
    ${FILTRO_EMPENHO_FIXO}
    ${FILTRO_OBJETO_FIXO}
)
SELECT
    anomes,
    CAST(NULL AS NUMBER) AS cod_equipamento,
    CAST(NULL AS NUMBER) AS cod_operacaoagricola,
    objetocustooperacao,
    CAST(NULL AS NUMBER) AS cod_fazenda,
    CAST(NULL AS NUMBER) AS cod_talhao,
    cod_servico,
    MAX(descricao_item) AS descricao_operacao,
    CAST(0 AS NUMBER) AS quantidade,
    SUM(NVL(vlrtotal, 0)) AS custo_servico,
    COUNT(*) AS qtd_itens
FROM servicos
GROUP BY
    anomes,
    objetocustooperacao,
    cod_servico
ORDER BY
    anomes,
    objetocustooperacao,
    cod_servico
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

function mapDetalheRow(row, tipoContrato) {
  const isFixo = tipoContrato === 'Fixo';
  const descricao = isFixo
    ? row.DESCRICAO_ITEM ?? row.DESCRICAO_OPERACAO
    : row.DESCRICAO_OPERACAO;
  return {
    origem: isFixo ? 'servico-terceiro-fixo' : 'servico-terceiro',
    tipoContrato,
    dataInicio: row.DATAINICIO,
    anomes: row.ANOMES != null ? String(row.ANOMES) : null,
    numeroContrato: row.NUMEROCONTRATO,
    codFornecedor: row.COD_FORNECEDOR,
    parcela: row.PARCELA,
    item: row.ITEM ?? null,
    codServico: row.COD_SERVICO ?? row.COD_ORIGEM ?? row.COD_ITEM ?? null,
    codOrigem: row.COD_ORIGEM ?? row.COD_ITEM ?? null,
    codOperacaoAgricola: isFixo ? null : row.COD_OPERACAOAGRICOLA,
    descricaoOperacao:
      descricao != null ? String(descricao).trim() : null,
    objetoCustoOperacao: row.OBJETOCUSTOOPERACAO ?? row.COD_OBJETOCUSTO ?? null,
    quantidade: toNumber(row.QTDE),
    vrUnitario: toNumber(row.VLRUNITARIO),
    valorTotal: toNumber(row.VLRTOTAL),
    codFazenda: isFixo ? null : row.COD_FAZENDA,
    codTalhao: isFixo ? null : row.COD_TALHAO,
    codEquipamento: isFixo ? null : row.COD_EQUIPAMENTO,
    codEmpenho: row.COD_EMPENHO,
  };
}

function mapBaseRow(row) {
  return {
    anomes: row.ANOMES != null ? String(row.ANOMES) : null,
    codEquipamento: row.COD_EQUIPAMENTO,
    codOperacaoAgricola: row.COD_OPERACAOAGRICOLA,
    objetoCustoOperacao: row.OBJETOCUSTOOPERACAO,
    objetoCustoRequisicao: null,
    codFazenda: row.COD_FAZENDA,
    codTalhao: row.COD_TALHAO,
    codServico: row.COD_SERVICO,
    descricaoOperacao:
      row.DESCRICAO_OPERACAO != null
        ? String(row.DESCRICAO_OPERACAO).trim()
        : null,
    quantidade: toNumber(row.QUANTIDADE) || 0,
    custoServicoTerceiro: toNumber(row.CUSTO_SERVICO) || 0,
    qtdItens: toNumber(row.QTD_ITENS) || 0,
  };
}

function resumoDetalhe(dados) {
  return {
    totalLinhas: dados.length,
    totalQuantidade: dados.reduce((acc, r) => acc + (r.quantidade || 0), 0),
    totalValor: dados.reduce((acc, r) => acc + (r.valorTotal || 0), 0),
    qtdOperacoes: new Set(
      dados.map((r) => r.codOperacaoAgricola).filter((v) => v != null)
    ).size,
    qtdContratos: new Set(
      dados.map((r) => r.numeroContrato).filter((v) => v != null)
    ).size,
  };
}

export async function consultarServicosTerceiro(filtros = {}) {
  const connection = await getConnection();
  try {
    const binds = buildBinds(filtros);
    const variavel = await connection.execute(SERVICO_SQL, binds);
    const fixo = await connection.execute(SERVICO_FIXO_SQL, binds);
    const dados = [
      ...(variavel.rows || []).map((row) => mapDetalheRow(row, 'Variável')),
      ...(fixo.rows || []).map((row) => mapDetalheRow(row, 'Fixo')),
    ];
    return {
      filtros,
      logica: {
        origemVariavel:
          'financeiro.itemcontratovariavel + parcelascontrato (datainicio)',
        operacaoVariavel:
          'cod_servico = rh.operacaoagricola.cod_operacaoagricola',
        origemFixo:
          'financeiro.parcelascontrato.valor + historicocontrato (fixovariavel = F)',
        destinoFixo:
          'somente parcelascontrato.cod_objetocusto; sem operação agrícola',
        itemFixo:
          'item_custo.cod_origem é descritivo (não vira cod_operacaoagricola)',
        empenho: 'empenho tipo 1 ou 2 (cod_tipoempenho; parcela sem empenho fica de fora)',
      },
      resumo: resumoDetalhe(dados),
      dados,
    };
  } finally {
    await connection.close();
  }
}

export async function consultarBaseServicosTerceiro(filtros = {}) {
  const connection = await getConnection();
  try {
    const result = await connection.execute(
      SERVICO_BASE_SQL,
      buildBinds(filtros)
    );
    return (result.rows || []).map(mapBaseRow);
  } finally {
    await connection.close();
  }
}

export async function consultarBaseServicosTerceiroFixo(filtros = {}) {
  const connection = await getConnection();
  try {
    const result = await connection.execute(
      SERVICO_FIXO_BASE_SQL,
      buildBinds(filtros)
    );
    return (result.rows || []).map((row) => ({
      ...mapBaseRow(row),
      codOperacaoAgricola: null,
      codEquipamento: null,
      codFazenda: null,
      codTalhao: null,
    }));
  } finally {
    await connection.close();
  }
}
