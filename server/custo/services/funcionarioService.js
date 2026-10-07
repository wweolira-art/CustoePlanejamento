import { getConnection } from '../config/db.js';
import { bindsObjetoCusto } from '../utils/filtros.js';

/**
 * Custo de funcionário: grupoempenho 10 (DESPESAS C/ FUNCIONARIO),
 * lancamento tipo R + empenho tipo 1/2.
 * Exclui objetos oficina 3/1/1 e transporte 3/1/2.
 */
export const FILTRO_FUNCIONARIO = {
  grupoEmpenho: 10,
  tipoLancamento: 'R',
  tiposEmpenho: [1, 2],
  excluirSubprocessos: [1, 2],
  mecanizacaoSubprocesso: 3,
  horasApontamento: 'automotivo.itens_apontamento.tothoras_trabalhadas',
};

const FILTRO_TIPO_R = `
WHERE c.tipo = 'R'
`;

const FILTRO_PERIODO = `
AND (
    :anomesInicio IS NULL
    OR c.anomes >= :anomesInicio
)
AND (
    :anomesFim IS NULL
    OR c.anomes <= :anomesFim
)
AND :equipamento IS NULL
`;

const FILTRO_GRUPO10 = `
AND EXISTS (
    SELECT 1
    FROM custo.empenho a
    LEFT JOIN custo.grupoempenho b
        ON a.cod_grupoempenho = b.cod_grupoempenho
    WHERE a.cod_tipoempenho IN (1, 2)
      AND b.cod_grupoempenho = 10
      AND c.cod_empenho = a.cod_empenho
)
`;

const FILTRO_EXCLUI_OFICINA_TRANSPORTE = `
AND NOT EXISTS (
    SELECT 1
    FROM custo.objetocusto x
    WHERE x.negocio = 3
      AND x.processo = 1
      AND x.subprocesso IN (1, 2)
      AND c.cod_objetocusto = x.cod_objetocusto
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
        WHERE oc.cod_objetocusto = c.cod_objetocusto
          AND (:objetoCusto IS NULL OR oc.cod_objetocusto = :objetoCusto)
          AND (:negociosCsv IS NULL OR INSTR(',' || :negociosCsv || ',', ',' || TO_CHAR(oc.negocio) || ',') > 0)
          AND (:processo IS NULL OR oc.processo = :processo)
          AND (:subprocesso IS NULL OR oc.subprocesso = :subprocesso)
          AND (:atividade IS NULL OR oc.atividade = :atividade)
    )
)
`;

const FROM_DETALHE = `
FROM custo.lancamento_custo c
LEFT JOIN custo.objetocusto d
    ON c.cod_objetocusto = d.cod_objetocusto
LEFT JOIN custo.empenho emp
    ON c.cod_empenho = emp.cod_empenho
`;

const FUNCIONARIO_SQL = `
SELECT
    c.anomes,
    c.tipo,
    c.cod_objetocusto,
    d.descricao AS descricao_objeto,
    d.negocio,
    d.processo,
    d.subprocesso,
    d.atividade,
    c.cod_empenho,
    emp.cod_tipoempenho,
    emp.cod_grupoempenho,
    c.valor,
    CASE
        WHEN d.negocio = 3 AND d.processo = 1 AND d.subprocesso = 3
        THEN 'mecanizacao-rateio'
        ELSE 'objeto-retido'
    END AS via
${FROM_DETALHE}
${FILTRO_TIPO_R}
${FILTRO_PERIODO}
${FILTRO_GRUPO10}
${FILTRO_EXCLUI_OFICINA_TRANSPORTE}
${FILTRO_OBJETO}
ORDER BY
    c.anomes,
    c.cod_objetocusto,
    c.tipo
`;

const FUNCIONARIO_RETIDO_SQL = `
SELECT
    TO_CHAR(c.anomes) AS anomes,
    c.cod_objetocusto AS objetocustooperacao,
    SUM(NVL(c.valor, 0)) AS custo_funcionario,
    COUNT(*) AS qtd_itens
FROM custo.lancamento_custo c
${FILTRO_TIPO_R}
${FILTRO_PERIODO}
${FILTRO_GRUPO10}
${FILTRO_EXCLUI_OFICINA_TRANSPORTE}
AND NOT EXISTS (
    SELECT 1
    FROM custo.objetocusto x
    WHERE x.negocio = 3
      AND x.processo = 1
      AND x.subprocesso = 3
      AND c.cod_objetocusto = x.cod_objetocusto
)
GROUP BY
    TO_CHAR(c.anomes),
    c.cod_objetocusto
ORDER BY
    anomes,
    objetocustooperacao
`;

const FILTRO_ANOMES_LANC = `
      AND (:anomesInicio IS NULL OR a.anomes >= :anomesInicio)
      AND (:anomesFim IS NULL OR a.anomes <= :anomesFim)
`;

const FILTRO_ANOMES_APT = `
      AND (:anomesInicio IS NULL OR TO_CHAR(ap.dt_apontamento, 'YYYYMM') >= :anomesInicio)
      AND (:anomesFim IS NULL OR TO_CHAR(ap.dt_apontamento, 'YYYYMM') <= :anomesFim)
`;

const FUNCIONARIO_MECANIZACAO_SQL = `
WITH custos AS (
    SELECT
        TO_CHAR(a.anomes) AS anomes,
        a.cod_objetocusto,
        SUM(NVL(a.valor, 0)) AS valor
    FROM custo.lancamento_custo a
    WHERE a.tipo = 'R'
      AND EXISTS (
        SELECT 1
        FROM custo.empenho emp
        LEFT JOIN custo.grupoempenho g
            ON emp.cod_grupoempenho = g.cod_grupoempenho
        WHERE emp.cod_tipoempenho IN (1, 2)
          AND g.cod_grupoempenho = 10
          AND a.cod_empenho = emp.cod_empenho
    )
      AND EXISTS (
          SELECT 1
          FROM custo.objetocusto b
          WHERE b.negocio = 3
            AND b.processo = 1
            AND b.subprocesso = 3
            AND a.cod_objetocusto = b.cod_objetocusto
      )
${FILTRO_ANOMES_LANC}
    GROUP BY
        TO_CHAR(a.anomes),
        a.cod_objetocusto
),
eq_mec AS (
    SELECT DISTINCT
        h.cod_equipamento,
        h.cod_objetocusto
    FROM automotivo.historicoequipamentoobcusto h
    WHERE h.data_final IS NULL
      AND EXISTS (
          SELECT 1
          FROM custo.objetocusto b
          WHERE b.negocio = 3
            AND b.processo = 1
            AND b.subprocesso = 3
            AND h.cod_objetocusto = b.cod_objetocusto
      )
),
apont AS (
    SELECT
        TO_CHAR(ap.dt_apontamento, 'YYYYMM') AS anomes,
        eq.cod_objetocusto AS objeto_origem,
        ap.cod_equipamento,
        ap.cod_operacaoagricola,
        NVL(ap.cod_objetocusto, oc.cod_objetocusto) AS objetocusto_destino,
        ap.cod_fazenda,
        ap.cod_talhao,
        SUM(NVL(ap.tothoras_trabalhadas, 0)) AS horas
    FROM automotivo.itens_apontamento ap
    INNER JOIN eq_mec eq
        ON eq.cod_equipamento = ap.cod_equipamento
    LEFT JOIN (
        SELECT *
        FROM rh.operacaoobjetocusto
        WHERE data_termino IS NULL
    ) oc
        ON oc.cod_operacaoagricola = ap.cod_operacaoagricola
    WHERE NVL(ap.tothoras_trabalhadas, 0) > 0
${FILTRO_ANOMES_APT}
    GROUP BY
        TO_CHAR(ap.dt_apontamento, 'YYYYMM'),
        eq.cod_objetocusto,
        ap.cod_equipamento,
        ap.cod_operacaoagricola,
        NVL(ap.cod_objetocusto, oc.cod_objetocusto),
        ap.cod_fazenda,
        ap.cod_talhao
),
horas_total AS (
    SELECT
        anomes,
        objeto_origem,
        SUM(horas) AS horas_total
    FROM apont
    GROUP BY
        anomes,
        objeto_origem
)
SELECT
    a.anomes,
    a.cod_equipamento,
    a.cod_operacaoagricola,
    NVL(a.objetocusto_destino, c.cod_objetocusto) AS objetocustooperacao,
    a.cod_fazenda,
    a.cod_talhao,
    c.cod_objetocusto AS objeto_origem,
    a.horas AS horas_apontamento,
    ht.horas_total,
    a.horas / ht.horas_total AS percentual_rateio,
    c.valor * (a.horas / ht.horas_total) AS custo_funcionario,
    'apontamento-mecanizacao' AS via
FROM custos c
INNER JOIN apont a
    ON a.anomes = c.anomes
   AND a.objeto_origem = c.cod_objetocusto
INNER JOIN horas_total ht
    ON ht.anomes = a.anomes
   AND ht.objeto_origem = a.objeto_origem
WHERE ht.horas_total > 0
  AND (:equipamento IS NULL OR a.cod_equipamento = :equipamento)

UNION ALL

SELECT
    c.anomes,
    CAST(NULL AS NUMBER) AS cod_equipamento,
    CAST(NULL AS NUMBER) AS cod_operacaoagricola,
    c.cod_objetocusto AS objetocustooperacao,
    CAST(NULL AS NUMBER) AS cod_fazenda,
    CAST(NULL AS NUMBER) AS cod_talhao,
    c.cod_objetocusto AS objeto_origem,
    CAST(0 AS NUMBER) AS horas_apontamento,
    CAST(0 AS NUMBER) AS horas_total,
    CAST(NULL AS NUMBER) AS percentual_rateio,
    c.valor AS custo_funcionario,
    'residual-mecanizacao' AS via
FROM custos c
LEFT JOIN horas_total ht
    ON ht.anomes = c.anomes
   AND ht.objeto_origem = c.cod_objetocusto
WHERE NVL(ht.horas_total, 0) <= 0
  AND :equipamento IS NULL

ORDER BY
    anomes,
    objetocustooperacao
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

function buildBindsPeriodo(filtros = {}) {
  return {
    anomesInicio: filtros.anomesInicio || filtros.anomes || null,
    anomesFim: filtros.anomesFim || filtros.anomes || null,
    equipamento: filtros.equipamento || null,
  };
}

function mapDetalheRow(row) {
  return {
    origem: 'funcionario',
    anomes: row.ANOMES != null ? String(row.ANOMES) : null,
    tipo: row.TIPO != null ? String(row.TIPO).trim() : null,
    objetoCustoOperacao: row.COD_OBJETOCUSTO,
    descricaoObjeto:
      row.DESCRICAO_OBJETO != null ? String(row.DESCRICAO_OBJETO).trim() : null,
    negocio: row.NEGOCIO,
    processo: row.PROCESSO,
    subprocesso: row.SUBPROCESSO,
    atividade: row.ATIVIDADE,
    codEmpenho: row.COD_EMPENHO,
    codTipoEmpenho: row.COD_TIPOEMPENHO,
    codGrupoEmpenho: row.COD_GRUPOEMPENHO,
    valorTotal: toNumber(row.VALOR),
    via: row.VIA != null ? String(row.VIA) : null,
  };
}

function mapRetidoRow(row) {
  return {
    anomes: row.ANOMES != null ? String(row.ANOMES) : null,
    codEquipamento: null,
    codOperacaoAgricola: null,
    objetoCustoOperacao: row.OBJETOCUSTOOPERACAO,
    objetoCustoOrigem: row.OBJETOCUSTOOPERACAO,
    codFazenda: null,
    codTalhao: null,
    horasApontamento: 0,
    custoFuncionario: toNumber(row.CUSTO_FUNCIONARIO) || 0,
    qtdItens: toNumber(row.QTD_ITENS) || 0,
    via: 'objeto-retido',
  };
}

function mapMecanizacaoRow(row) {
  return {
    anomes: row.ANOMES != null ? String(row.ANOMES) : null,
    codEquipamento: row.COD_EQUIPAMENTO,
    codOperacaoAgricola: row.COD_OPERACAOAGRICOLA,
    objetoCustoOperacao: row.OBJETOCUSTOOPERACAO,
    objetoCustoOrigem: row.OBJETO_ORIGEM,
    codFazenda: row.COD_FAZENDA,
    codTalhao: row.COD_TALHAO,
    horasApontamento: toNumber(row.HORAS_APONTAMENTO) || 0,
    percentualRateio: toNumber(row.PERCENTUAL_RATEIO),
    custoFuncionario: toNumber(row.CUSTO_FUNCIONARIO) || 0,
    qtdItens: 1,
    via: row.VIA != null ? String(row.VIA) : 'apontamento-mecanizacao',
  };
}

function resumoDetalhe(dados) {
  const totalValor = dados.reduce((acc, r) => acc + (r.valorTotal || 0), 0);
  const rateio = dados.filter((r) => r.via === 'mecanizacao-rateio');
  const retido = dados.filter((r) => r.via === 'objeto-retido');
  return {
    totalLinhas: dados.length,
    totalValor,
    totalMecanizacao: rateio.reduce((acc, r) => acc + (r.valorTotal || 0), 0),
    totalRetido: retido.reduce((acc, r) => acc + (r.valorTotal || 0), 0),
    qtdObjetos: new Set(
      dados.map((r) => r.objetoCustoOperacao).filter((v) => v != null)
    ).size,
  };
}

export async function consultarFuncionarios(filtros = {}) {
  const connection = await getConnection();
  try {
    const result = await connection.execute(FUNCIONARIO_SQL, buildBinds(filtros));
    const dados = (result.rows || []).map(mapDetalheRow);
    return {
      filtros,
      logica: {
        origem:
          'custo.lancamento_custo tipo R + empenho tipo 1/2 no grupoempenho 10 (DESPESAS C/ FUNCIONARIO)',
        tipoLancamento: "somente tipo R (igual oficina / transporte / mecanização)",
        exclusao: 'objetos oficina 3/1/1 e transporte 3/1/2 não entram',
        mecanizacao:
          '3/1/3 rateado por tothoras_trabalhadas dos equipamentos vigentes no objeto; destino = objeto da atividade',
        retido: 'demais objetos: custo permanece no objeto, sem operação',
        horas:
          'automotivo.itens_apontamento.tothoras_trabalhadas (não horas OS nem kmhs de abastecimento)',
      },
      resumo: resumoDetalhe(dados),
      dados,
    };
  } finally {
    await connection.close();
  }
}

export async function consultarBaseFuncionarios(filtros = {}) {
  const connection = await getConnection();
  try {
    const bindsPeriodo = buildBindsPeriodo(filtros);
    const retidos = await connection.execute(
      FUNCIONARIO_RETIDO_SQL,
      bindsPeriodo
    );
    const mecanizacao = await connection.execute(
      FUNCIONARIO_MECANIZACAO_SQL,
      bindsPeriodo
    );
    return [
      ...(retidos.rows || []).map(mapRetidoRow),
      ...(mecanizacao.rows || []).map(mapMecanizacaoRow),
    ];
  } finally {
    await connection.close();
  }
}
