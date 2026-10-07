import { getConnection } from '../config/db.js';
import { bindsObjetoCusto } from '../utils/filtros.js';

const ABASTECIMENTO_SQL = `
WITH histTipoEquip AS (
    SELECT
        cod_equipamento,
        data_inicio,
        NVL(data_fim, SYSDATE) AS data_fim,
        cod_tipoequipamento
    FROM automotivo.historico_tipoequipamento
),

histObjCusto AS (
    SELECT
        cod_grupoempresa,
        cod_empresa,
        cod_filial,
        cod_equipamento,
        cod_objetocusto,
        data_inicio,
        data_final
    FROM automotivo.historicoequipamentoobcusto
),

custoMedioMaterial AS (
    SELECT
        cod_grupoempresa,
        cod_material,
        ano,
        mes,
        AVG(custo_medio) AS custo_medio
    FROM material.customedio
    GROUP BY
        cod_grupoempresa,
        cod_material,
        ano,
        mes
),

abastecimentos AS (
    SELECT
        a.cod_grupoempresa,
        a.cod_empresa,
        a.cod_filial,
        a.cod_material,
        a.cod_equipamento,
        i.cod_objetocusto,
        a.dtabastecimento AS data_abastecimento,
        cm.custo_medio AS preco,
        a.qtdelitros AS qtde_litros,
        a.kmhs_rodados,
        tp.cod_tipoequipamento,
        (a.qtdelitros * cm.custo_medio) AS valor_total
    FROM automotivo.abastecimento a
    LEFT JOIN histTipoEquip tp
        ON tp.cod_equipamento = a.cod_equipamento
        AND TRUNC(a.dtabastecimento)
            BETWEEN TRUNC(tp.data_inicio)
            AND TRUNC(tp.data_fim)
    LEFT JOIN custoMedioMaterial cm
        ON cm.cod_grupoempresa = a.cod_grupoempresa
        AND cm.cod_material = a.cod_material
        AND cm.ano = EXTRACT(YEAR FROM a.dtabastecimento)
        AND cm.mes = EXTRACT(MONTH FROM a.dtabastecimento)
    LEFT JOIN histObjCusto i
        ON a.cod_grupoempresa = i.cod_grupoempresa
        AND a.cod_empresa = i.cod_empresa
        AND a.cod_filial = i.cod_filial
        AND a.cod_equipamento = i.cod_equipamento
        AND TRUNC(a.dtabastecimento)
            BETWEEN TRUNC(i.data_inicio)
            AND TRUNC(NVL(i.data_final, SYSDATE))

    UNION ALL

    SELECT
        a.cod_grupoempresa,
        a.cod_empresa,
        a.cod_filial,
        a.cod_material,
        a.cod_equipamento,
        i.cod_objetocusto,
        a.data AS data_abastecimento,
        cm.custo_medio AS preco,
        a.qtde_litros AS qtde_litros,
        a.kmhs_rodados,
        tp.cod_tipoequipamento,
        (a.qtde_litros * cm.custo_medio) AS valor_total
    FROM posto.abastecimento a
    LEFT JOIN histTipoEquip tp
        ON tp.cod_equipamento = a.cod_equipamento
        AND TRUNC(a.data)
            BETWEEN TRUNC(tp.data_inicio)
            AND TRUNC(tp.data_fim)
    LEFT JOIN custoMedioMaterial cm
        ON cm.cod_grupoempresa = a.cod_grupoempresa
        AND cm.cod_material = a.cod_material
        AND cm.ano = EXTRACT(YEAR FROM a.data)
        AND cm.mes = EXTRACT(MONTH FROM a.data)
    LEFT JOIN histObjCusto i
        ON a.cod_grupoempresa = i.cod_grupoempresa
        AND a.cod_empresa = i.cod_empresa
        AND a.cod_filial = i.cod_filial
        AND a.cod_equipamento = i.cod_equipamento
        AND TRUNC(a.data)
            BETWEEN TRUNC(i.data_inicio)
            AND TRUNC(NVL(i.data_final, SYSDATE))
),

intervaloAbastecimento AS (
    SELECT
        a.cod_equipamento,
        a.data_abastecimento,
        MAX(prev.data_abastecimento) AS data_abastecimento_ant
    FROM abastecimentos a
    LEFT JOIN abastecimentos prev
        ON prev.cod_equipamento = a.cod_equipamento
       AND prev.data_abastecimento < a.data_abastecimento
    WHERE (
        :anomesInicio IS NULL
        OR TO_CHAR(a.data_abastecimento, 'YYYYMM') >= :anomesInicio
    )
    AND (
        :anomesFim IS NULL
        OR TO_CHAR(a.data_abastecimento, 'YYYYMM') <= :anomesFim
    )
    AND (
        :equipamento IS NULL
        OR a.cod_equipamento = :equipamento
    )
    GROUP BY
        a.cod_equipamento,
        a.data_abastecimento
),

/* Última operação no intervalo (após o abastecimento anterior até o atual). */
ultimoApontamento AS (
    SELECT
        i.cod_equipamento,
        i.data_abastecimento,
        MAX(b.dt_apontamento) AS dt_apontamento
    FROM intervaloAbastecimento i
    LEFT JOIN automotivo.itens_apontamento b
        ON b.cod_equipamento = i.cod_equipamento
       AND b.dt_apontamento <= i.data_abastecimento
       AND (
            i.data_abastecimento_ant IS NULL
            OR b.dt_apontamento > i.data_abastecimento_ant
       )
    GROUP BY
        i.cod_equipamento,
        i.data_abastecimento
),

/* Horas e hectares apontados no mesmo intervalo entre abastecimentos. */
apontamentoIntervalo AS (
    SELECT
        i.cod_equipamento,
        i.data_abastecimento,
        SUM(
            NVL(
                NULLIF(b.tothoras_trabalhadas, 0),
                NVL(b.km_final, 0) - NVL(b.km_inicial, 0)
            )
        ) AS horas_apontamento,
        SUM(NVL(b.area, 0)) AS area_ha
    FROM intervaloAbastecimento i
    LEFT JOIN automotivo.itens_apontamento b
        ON b.cod_equipamento = i.cod_equipamento
       AND b.dt_apontamento <= i.data_abastecimento
       AND (
            i.data_abastecimento_ant IS NULL
            OR b.dt_apontamento > i.data_abastecimento_ant
       )
    GROUP BY
        i.cod_equipamento,
        i.data_abastecimento
)

SELECT
    a.cod_grupoempresa,
    a.cod_empresa,
    a.cod_filial,
    a.cod_material,
    a.cod_equipamento,
    a.cod_objetocusto,
    a.data_abastecimento,
    a.preco,
    a.qtde_litros,
    a.kmhs_rodados,
    a.cod_tipoequipamento,
    te.descricaotipoequipamento AS tipo_equipamento,
    eq.cod_modelo,
    __MODELO_DESC__ AS modelo_equipamento,
    a.valor_total,
    b.dt_apontamento,
    b.cod_operacaoagricola,
    b.cod_fazenda,
    b.cod_talhao,
    d.cod_objetocusto AS objetocustooperacao,
    NVL(ai.horas_apontamento, 0) AS horas_apontamento,
    NVL(ai.area_ha, 0) AS area_ha,
    CASE
        WHEN NVL(ai.horas_apontamento, 0) > 0 THEN a.qtde_litros / ai.horas_apontamento
        WHEN NVL(a.kmhs_rodados, 0) > 0 THEN a.qtde_litros / a.kmhs_rodados
        ELSE NULL
    END AS litros_por_hora,
    CASE
        WHEN NVL(ai.area_ha, 0) > 0 THEN a.qtde_litros / ai.area_ha
        ELSE NULL
    END AS litros_por_ha
FROM abastecimentos a
LEFT JOIN ultimoApontamento u
    ON u.cod_equipamento = a.cod_equipamento
    AND u.data_abastecimento = a.data_abastecimento
LEFT JOIN automotivo.itens_apontamento b
    ON b.cod_equipamento = u.cod_equipamento
    AND b.dt_apontamento = u.dt_apontamento
LEFT JOIN apontamentoIntervalo ai
    ON ai.cod_equipamento = a.cod_equipamento
    AND ai.data_abastecimento = a.data_abastecimento
LEFT JOIN automotivo.equipamento eq
    ON eq.cod_equipamento = a.cod_equipamento
LEFT JOIN automotivo.modeloequipamento me
    ON me.cod_modelo = eq.cod_modelo
LEFT JOIN automotivo.tipoequipamento te
    ON te.cod_tipoequipamento = a.cod_tipoequipamento
LEFT JOIN (
    SELECT *
    FROM rh.operacaoobjetocusto
    WHERE data_termino IS NULL
) d
    ON b.cod_operacaoagricola = d.cod_operacaoagricola
WHERE (
    :anomesInicio IS NULL
    OR TO_CHAR(a.data_abastecimento, 'YYYYMM') >= :anomesInicio
)
AND (
    :anomesFim IS NULL
    OR TO_CHAR(a.data_abastecimento, 'YYYYMM') <= :anomesFim
)
AND (
    :equipamento IS NULL
    OR a.cod_equipamento = :equipamento
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
        WHERE oc.cod_objetocusto = NVL(d.cod_objetocusto, a.cod_objetocusto)
          AND (:objetoCusto IS NULL OR oc.cod_objetocusto = :objetoCusto)
          AND (:negociosCsv IS NULL OR INSTR(',' || :negociosCsv || ',', ',' || TO_CHAR(oc.negocio) || ',') > 0)
          AND (:processo IS NULL OR oc.processo = :processo)
          AND (:subprocesso IS NULL OR oc.subprocesso = :subprocesso)
          AND (:atividade IS NULL OR oc.atividade = :atividade)
    )
)
ORDER BY
    a.data_abastecimento,
    a.cod_equipamento
`;

const MODELO_DESC_CANDIDATES = [
  "NVL(me.descricao, TO_CHAR(eq.cod_modelo))",
  "NVL(me.descricaomodeloequipamento, TO_CHAR(eq.cod_modelo))",
  "NVL(me.descricaomodelo, TO_CHAR(eq.cod_modelo))",
  "NVL(me.nome, TO_CHAR(eq.cod_modelo))",
  "TO_CHAR(eq.cod_modelo)",
];

function buildAbastecimentoSql(modeloDescExpr) {
  return ABASTECIMENTO_SQL.replace("__MODELO_DESC__", modeloDescExpr);
}

function isMissingColumnError(err) {
  const message = err instanceof Error ? err.message : String(err);
  return /ORA-00904/i.test(message);
}
const ATIVIDADE_BASE_SQL = `
WITH histTipoEquip AS (
    SELECT
        cod_equipamento,
        data_inicio,
        NVL(data_fim, SYSDATE) AS data_fim,
        cod_tipoequipamento
    FROM automotivo.historico_tipoequipamento
),

histObjCusto AS (
    SELECT
        cod_grupoempresa,
        cod_empresa,
        cod_filial,
        cod_equipamento,
        cod_objetocusto,
        data_inicio,
        data_final
    FROM automotivo.historicoequipamentoobcusto
),

custoMedioMaterial AS (
    SELECT
        cod_grupoempresa,
        cod_material,
        ano,
        mes,
        AVG(custo_medio) AS custo_medio
    FROM material.customedio
    GROUP BY
        cod_grupoempresa,
        cod_material,
        ano,
        mes
),

abastecimentos AS (
    SELECT
        a.cod_grupoempresa,
        a.cod_empresa,
        a.cod_filial,
        a.cod_material,
        a.cod_equipamento,
        i.cod_objetocusto,
        a.dtabastecimento AS data_abastecimento,
        cm.custo_medio AS preco,
        a.qtdelitros AS qtde_litros,
        a.kmhs_rodados,
        tp.cod_tipoequipamento,
        (a.qtdelitros * cm.custo_medio) AS valor_total
    FROM automotivo.abastecimento a
    LEFT JOIN histTipoEquip tp
        ON tp.cod_equipamento = a.cod_equipamento
        AND TRUNC(a.dtabastecimento)
            BETWEEN TRUNC(tp.data_inicio)
            AND TRUNC(tp.data_fim)
    LEFT JOIN custoMedioMaterial cm
        ON cm.cod_grupoempresa = a.cod_grupoempresa
        AND cm.cod_material = a.cod_material
        AND cm.ano = EXTRACT(YEAR FROM a.dtabastecimento)
        AND cm.mes = EXTRACT(MONTH FROM a.dtabastecimento)
    LEFT JOIN histObjCusto i
        ON a.cod_grupoempresa = i.cod_grupoempresa
        AND a.cod_empresa = i.cod_empresa
        AND a.cod_filial = i.cod_filial
        AND a.cod_equipamento = i.cod_equipamento
        AND TRUNC(a.dtabastecimento)
            BETWEEN TRUNC(i.data_inicio)
            AND TRUNC(NVL(i.data_final, SYSDATE))

    UNION ALL

    SELECT
        a.cod_grupoempresa,
        a.cod_empresa,
        a.cod_filial,
        a.cod_material,
        a.cod_equipamento,
        i.cod_objetocusto,
        a.data AS data_abastecimento,
        cm.custo_medio AS preco,
        a.qtde_litros AS qtde_litros,
        a.kmhs_rodados,
        tp.cod_tipoequipamento,
        (a.qtde_litros * cm.custo_medio) AS valor_total
    FROM posto.abastecimento a
    LEFT JOIN histTipoEquip tp
        ON tp.cod_equipamento = a.cod_equipamento
        AND TRUNC(a.data)
            BETWEEN TRUNC(tp.data_inicio)
            AND TRUNC(tp.data_fim)
    LEFT JOIN custoMedioMaterial cm
        ON cm.cod_grupoempresa = a.cod_grupoempresa
        AND cm.cod_material = a.cod_material
        AND cm.ano = EXTRACT(YEAR FROM a.data)
        AND cm.mes = EXTRACT(MONTH FROM a.data)
    LEFT JOIN histObjCusto i
        ON a.cod_grupoempresa = i.cod_grupoempresa
        AND a.cod_empresa = i.cod_empresa
        AND a.cod_filial = i.cod_filial
        AND a.cod_equipamento = i.cod_equipamento
        AND TRUNC(a.data)
            BETWEEN TRUNC(i.data_inicio)
            AND TRUNC(NVL(i.data_final, SYSDATE))
),

ultimoApontamento AS (
    SELECT
        a.cod_equipamento,
        a.data_abastecimento,
        MAX(b.dt_apontamento) AS dt_apontamento
    FROM abastecimentos a
    LEFT JOIN automotivo.itens_apontamento b
        ON b.cod_equipamento = a.cod_equipamento
        AND b.dt_apontamento <= a.data_abastecimento
    WHERE (
        :anomesInicio IS NULL
        OR TO_CHAR(a.data_abastecimento, 'YYYYMM') >= :anomesInicio
    )
    AND (
        :anomesFim IS NULL
        OR TO_CHAR(a.data_abastecimento, 'YYYYMM') <= :anomesFim
    )
    AND (
        :equipamento IS NULL
        OR a.cod_equipamento = :equipamento
    )
    GROUP BY
        a.cod_equipamento,
        a.data_abastecimento
),

detalhe AS (
    SELECT
        TO_CHAR(a.data_abastecimento, 'YYYYMM') AS anomes,
        a.cod_equipamento,
        a.cod_tipoequipamento,
        a.cod_material,
        NVL(a.kmhs_rodados, 0) AS kmhs_rodados,
        NVL(a.qtde_litros, 0) AS qtde_litros,
        NVL(a.valor_total, 0) AS valor_abastecimento,
        b.cod_operacaoagricola,
        b.cod_fazenda,
        b.cod_talhao,
        d.cod_objetocusto AS objetocustooperacao
    FROM abastecimentos a
    LEFT JOIN ultimoApontamento u
        ON u.cod_equipamento = a.cod_equipamento
        AND u.data_abastecimento = a.data_abastecimento
    LEFT JOIN automotivo.itens_apontamento b
        ON b.cod_equipamento = u.cod_equipamento
        AND b.dt_apontamento = u.dt_apontamento
    LEFT JOIN (
        SELECT *
        FROM rh.operacaoobjetocusto
        WHERE data_termino IS NULL
    ) d
        ON b.cod_operacaoagricola = d.cod_operacaoagricola
    WHERE (
        :anomesInicio IS NULL
        OR TO_CHAR(a.data_abastecimento, 'YYYYMM') >= :anomesInicio
    )
    AND (
        :anomesFim IS NULL
        OR TO_CHAR(a.data_abastecimento, 'YYYYMM') <= :anomesFim
    )
    AND (
        :equipamento IS NULL
        OR a.cod_equipamento = :equipamento
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
            WHERE oc.cod_objetocusto = NVL(d.cod_objetocusto, a.cod_objetocusto)
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
    cod_fazenda,
    cod_talhao,
    objetocustooperacao,
    MAX(cod_tipoequipamento) AS cod_tipoequipamento,
    SUM(kmhs_rodados) AS kmhs_rodados,
    SUM(qtde_litros) AS qtde_litros,
    SUM(valor_abastecimento) AS valor_abastecimento,
    COUNT(*) AS qtd_abastecimentos
FROM detalhe
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

/** Mesma base de atividade, quebrada por código de material (combustível). */
const COMBUSTIVEL_ITENS_SQL = `${ATIVIDADE_BASE_SQL.slice(
  0,
  ATIVIDADE_BASE_SQL.lastIndexOf('SELECT')
)}SELECT
    anomes,
    cod_equipamento,
    cod_operacaoagricola,
    cod_fazenda,
    cod_talhao,
    objetocustooperacao,
    cod_material,
    SUM(qtde_litros) AS qtde_litros,
    SUM(valor_abastecimento) AS valor_abastecimento,
    COUNT(*) AS qtd_abastecimentos
FROM detalhe
GROUP BY
    anomes,
    cod_equipamento,
    cod_operacaoagricola,
    cod_fazenda,
    cod_talhao,
    objetocustooperacao,
    cod_material
ORDER BY
    anomes,
    cod_equipamento,
    cod_operacaoagricola,
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

function mapAbastecimentoRow(row) {
  const qtdeLitros = toNumber(row.QTDE_LITROS);
  const horasApontamento = toNumber(row.HORAS_APONTAMENTO);
  const areaHa = toNumber(row.AREA_HA);
  const kmhsRodados = toNumber(row.KMHS_RODADOS);
  const litrosPorHora = toNumber(row.LITROS_POR_HORA);
  const litrosPorHa = toNumber(row.LITROS_POR_HA);
  const preco = toNumber(row.PRECO);

  return {
    codGrupoEmpresa: row.COD_GRUPOEMPRESA,
    codEmpresa: row.COD_EMPRESA,
    codFilial: row.COD_FILIAL,
    codMaterial: row.COD_MATERIAL,
    codEquipamento: row.COD_EQUIPAMENTO,
    codObjetoCusto: row.COD_OBJETOCUSTO,
    dataAbastecimento: row.DATA_ABASTECIMENTO,
    preco,
    vrCustoUnitario: preco,
    qtdeLitros,
    kmhsRodados,
    horasApontamento,
    areaHa,
    litrosPorHora,
    litrosPorHa,
    codTipoEquipamento: row.COD_TIPOEQUIPAMENTO,
    tipoEquipamento:
      row.TIPO_EQUIPAMENTO != null && String(row.TIPO_EQUIPAMENTO).trim()
        ? String(row.TIPO_EQUIPAMENTO).trim()
        : null,
    codModelo: row.COD_MODELO != null ? toNumber(row.COD_MODELO) ?? row.COD_MODELO : null,
    modeloEquipamento:
      row.MODELO_EQUIPAMENTO != null && String(row.MODELO_EQUIPAMENTO).trim()
        ? String(row.MODELO_EQUIPAMENTO).trim()
        : row.COD_MODELO != null
          ? `Modelo ${row.COD_MODELO}`
          : "Sem modelo",
    valorTotal: toNumber(row.VALOR_TOTAL),
    dtApontamento: row.DT_APONTAMENTO,
    codOperacaoAgricola: row.COD_OPERACAOAGRICOLA,
    codFazenda: row.COD_FAZENDA,
    codTalhao: row.COD_TALHAO,
    objetoCustoOperacao: row.OBJETOCUSTOOPERACAO,
  };
}

function agregaPorModelo(dados) {
  const map = new Map();
  for (const row of dados) {
    const key =
      row.codModelo != null
        ? `m:${row.codModelo}`
        : `nome:${row.modeloEquipamento || "Sem modelo"}`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        codModelo: row.codModelo ?? null,
        modeloEquipamento: row.modeloEquipamento || "Sem modelo",
        tipoEquipamento: row.tipoEquipamento || null,
        qtdeLitros: 0,
        horasApontamento: 0,
        kmhsRodados: 0,
        areaHa: 0,
        valorTotal: 0,
        qtdAbastecimentos: 0,
        equipamentos: new Set(),
      };
      map.set(key, bucket);
    }
    bucket.qtdeLitros += row.qtdeLitros || 0;
    bucket.horasApontamento += row.horasApontamento || 0;
    bucket.kmhsRodados += row.kmhsRodados || 0;
    bucket.areaHa += row.areaHa || 0;
    bucket.valorTotal += row.valorTotal || 0;
    bucket.qtdAbastecimentos += 1;
    if (row.tipoEquipamento && !bucket.tipoEquipamento) {
      bucket.tipoEquipamento = row.tipoEquipamento;
    }
    if (row.codEquipamento != null) bucket.equipamentos.add(String(row.codEquipamento));
  }

  return [...map.values()]
    .map((bucket) => {
      const horas =
        bucket.horasApontamento > 0 ? bucket.horasApontamento : bucket.kmhsRodados;
      return {
        codModelo: bucket.codModelo,
        modeloEquipamento: bucket.modeloEquipamento,
        tipoEquipamento: bucket.tipoEquipamento,
        qtdEquipamentos: bucket.equipamentos.size,
        qtdAbastecimentos: bucket.qtdAbastecimentos,
        qtdeLitros: round3(bucket.qtdeLitros),
        horasApontamento: round3(bucket.horasApontamento),
        kmhsRodados: round3(bucket.kmhsRodados),
        areaHa: round3(bucket.areaHa),
        valorTotal: round3(bucket.valorTotal),
        litrosPorHora: horas > 0 ? round3(bucket.qtdeLitros / horas) : null,
        litrosPorHa: bucket.areaHa > 0 ? round3(bucket.qtdeLitros / bucket.areaHa) : null,
      };
    })
    .sort((a, b) =>
      String(a.modeloEquipamento).localeCompare(String(b.modeloEquipamento), "pt-BR"),
    );
}

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

function mapAtividadeBaseRow(row) {
  return {
    anomes: row.ANOMES != null ? String(row.ANOMES) : null,
    codEquipamento: row.COD_EQUIPAMENTO,
    codOperacaoAgricola: row.COD_OPERACAOAGRICOLA,
    codFazenda: row.COD_FAZENDA,
    codTalhao: row.COD_TALHAO,
    objetoCustoOperacao: row.OBJETOCUSTOOPERACAO,
    codTipoEquipamento: row.COD_TIPOEQUIPAMENTO,
    kmhsRodados: toNumber(row.KMHS_RODADOS) || 0,
    qtdeLitros: toNumber(row.QTDE_LITROS) || 0,
    valorAbastecimento: toNumber(row.VALOR_ABASTECIMENTO) || 0,
    qtdAbastecimentos: toNumber(row.QTD_ABASTECIMENTOS) || 0,
  };
}

function mapCombustivelItemRow(row) {
  return {
    anomes: row.ANOMES != null ? String(row.ANOMES) : null,
    codEquipamento: row.COD_EQUIPAMENTO,
    codOperacaoAgricola: row.COD_OPERACAOAGRICOLA,
    codFazenda: row.COD_FAZENDA,
    codTalhao: row.COD_TALHAO,
    objetoCustoOperacao: row.OBJETOCUSTOOPERACAO,
    codMaterial: row.COD_MATERIAL != null ? String(row.COD_MATERIAL) : null,
    qtdeLitros: toNumber(row.QTDE_LITROS) || 0,
    valorAbastecimento: toNumber(row.VALOR_ABASTECIMENTO) || 0,
    qtdAbastecimentos: toNumber(row.QTD_ABASTECIMENTOS) || 0,
  };
}

export async function consultarAbastecimentos(filtros = {}) {
  const connection = await getConnection();

  try {
    const binds = buildBinds(filtros);
    let result = null;
    let lastError = null;
    for (const expr of MODELO_DESC_CANDIDATES) {
      try {
        result = await connection.execute(buildAbastecimentoSql(expr), binds);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        if (!isMissingColumnError(err)) throw err;
      }
    }
    if (!result) throw lastError;

    const dados = (result.rows || []).map(mapAbastecimentoRow);
    const porModelo = agregaPorModelo(dados);
    const comLh = dados.filter((r) => r.litrosPorHora != null && r.litrosPorHora > 0);
    const comLha = dados.filter((r) => r.litrosPorHa != null && r.litrosPorHa > 0);

    return {
      filtros,
      resumo: {
        totalLinhas: dados.length,
        totalLitros: dados.reduce((acc, r) => acc + (r.qtdeLitros || 0), 0),
        totalValor: dados.reduce((acc, r) => acc + (r.valorTotal || 0), 0),
        totalHoras: dados.reduce((acc, r) => acc + (r.horasApontamento || 0), 0),
        totalAreaHa: dados.reduce((acc, r) => acc + (r.areaHa || 0), 0),
        mediaLitrosPorHora: comLh.length
          ? comLh.reduce((acc, r) => acc + (r.litrosPorHora || 0), 0) / comLh.length
          : null,
        mediaLitrosPorHa: comLha.length
          ? comLha.reduce((acc, r) => acc + (r.litrosPorHa || 0), 0) / comLha.length
          : null,
        qtdModelos: porModelo.length,
      },
      porModelo,
      dados,
    };
  } finally {
    await connection.close();
  }
}

export async function consultarBaseAtividades(filtros = {}) {
  const connection = await getConnection();

  try {
    const result = await connection.execute(
      ATIVIDADE_BASE_SQL,
      buildBinds(filtros)
    );
    return (result.rows || []).map(mapAtividadeBaseRow);
  } finally {
    await connection.close();
  }
}

export async function consultarBaseCombustivelItens(filtros = {}) {
  const connection = await getConnection();

  try {
    const result = await connection.execute(
      COMBUSTIVEL_ITENS_SQL,
      buildBinds(filtros)
    );
    return (result.rows || []).map(mapCombustivelItemRow);
  } finally {
    await connection.close();
  }
}
