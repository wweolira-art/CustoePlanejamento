import { oracleDate, oracleNumber, oracleText, withOracle } from "../oracle.js";

export type IndicadoresCombustivelLinha = {
  origem: string;
  idAbastecimento: string;
  dataAbastecimento: string | null;
  codEquipamento: number | null;
  equipamentoDescricao: string | null;
  codMaterial: number | null;
  codModelo: number | null;
  modeloEquipamento: string;
  tipoEquipamento: string | null;
  codTipoEquipamento: number | null;
  /** H = horímetro (por hora), K = odômetro (por km), N = não controla. */
  tipoHorimetro: string | null;
  funcionaPorHora: boolean;
  frota: string;
  grupo: string;
  codOperacaoAgricola: number | null;
  descricaoOperacao: string | null;
  codFazenda: number | null;
  codTalhao: number | null;
  qtdeLitros: number;
  horasApontamento: number;
  /** Horas efetivas quando o equipamento trabalha por hora (TIPOHORIMETRO = H). */
  horasTrabalho: number;
  /** Km efetivos quando o equipamento trabalha por km (TIPOHORIMETRO = K). */
  kmRodados: number;
  kmhsRodados: number;
  areaHa: number;
  litrosPorHora: number | null;
  kmPorLitro: number | null;
  litrosPorHa: number | null;
  custoUnitario: number | null;
  vrCustoUnitario?: number | null;
  valorTotal: number;
};

export type CombustivelFrotaGrupo = {
  frota: string;
  grupo: string;
  qtdEquipamentos: number;
  qtdeLitros: number;
  valorTotal: number;
  kmRodados: number;
  horasTrabalho: number;
  kmPorLitro: number | null;
  litrosPorHora: number | null;
};

export type CombustivelEquipamento = {
  codEquipamento: number | null;
  label: string;
  descricao: string | null;
  tipoHorimetro: string | null;
  funcionaPorHora: boolean;
  qtdeLitros: number;
  valorTotal: number;
  kmRodados: number;
  horasTrabalho: number;
  kmPorLitro: number | null;
  litrosPorHora: number | null;
};

export type CombustivelTipoEquipamento = {
  codTipoEquipamento: number | null;
  tipoEquipamento: string;
  qtdEquipamentos: number;
  qtdeLitros: number;
  valorTotal: number;
  kmRodados: number;
  horasTrabalho: number;
  kmPorLitro: number | null;
  litrosPorHora: number | null;
};

export type CombustivelDashboard = {
  kpis: {
    custoTotal: number;
    litrosTotal: number;
    kmTotal: number;
    horasTotal: number;
    mediaKmPorLitro: number | null;
    mediaLitrosPorHora: number | null;
    qtdEquipamentos: number;
    qtdAbastecimentos: number;
  };
  porFrotaGrupo: CombustivelFrotaGrupo[];
  porEquipamento: CombustivelEquipamento[];
  porTipoEquipamento: CombustivelTipoEquipamento[];
};

export type IndicadoresCombustivelModelo = {
  codModelo: number | null;
  modeloEquipamento: string;
  tipoEquipamento: string | null;
  qtdEquipamentos: number;
  qtdAbastecimentos: number;
  qtdeLitros: number;
  horasApontamento: number;
  kmhsRodados: number;
  areaHa: number;
  litrosPorHora: number | null;
  litrosPorHa: number | null;
  valorTotal: number;
};

export type IndicadoresCombustivelData = {
  filtros: { dataInicio: string | null; dataFim: string | null };
  resumo: {
    totalLinhas: number;
    totalLitros: number;
    totalLitrosAutomotivo: number;
    totalLitrosPosto: number;
    totalHoras: number;
    totalKm: number;
    totalAreaHa: number;
    totalValor: number;
    totalValorAutomotivo: number;
    totalValorPosto: number;
    /** Soma SQL base (sem joins de apontamento/modelo). */
    totalValorBase: number;
    qtdModelos: number;
    mediaLitrosPorHora: number | null;
    mediaKmPorLitro: number | null;
    mediaLitrosPorHa: number | null;
  };
  dashboard: CombustivelDashboard;
  porModelo: IndicadoresCombustivelModelo[];
  dados: IndicadoresCombustivelLinha[];
};

function round3(n: number) {
  return Math.round(Number(n) * 1000) / 1000;
}

function money2(n: number) {
  return Math.round(Number(n) * 100) / 100;
}

function isMissingColumnError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /ORA-00904/i.test(message);
}

const MODELO_DESC_CANDIDATES = [
  "NVL(m.descricao, TO_CHAR(m.cod_modelo))",
  "NVL(m.descricaomodeloequipamento, TO_CHAR(m.cod_modelo))",
  "NVL(m.descricaomodelo, TO_CHAR(m.cod_modelo))",
  "NVL(m.nome, TO_CHAR(m.cod_modelo))",
  "TO_CHAR(m.cod_modelo)",
];

/**
 * Fontes:
 * - posto: abastecimento + abastecimento_itensrequisicao + itensrequisicaomaterial
 *   custo = quantidade × vrcustounitario da requisição
 * - automotivo: abastecimento com nrrequisicao preenchido
 *   custo = litros × valor_unitario
 */
function buildSql(modeloDescExpr: string) {
  return `
WITH posto_abastecimentos AS (
    SELECT
        'posto' AS origem,
        (
            TO_CHAR(a.cod_grupoempresa) || '|' ||
            TO_CHAR(a.cod_empresa) || '|' ||
            TO_CHAR(a.cod_filial) || '|' ||
            TO_CHAR(a.cod_abast)
        ) AS id_abastecimento,
        a.cod_equipamento,
        NVL(MAX(c.cod_material), MAX(a.cod_material)) AS cod_material,
        a.data AS data_abastecimento,
        NVL(a.qtde_litros, 0) AS qtde_litros,
        NVL(a.kmhs_rodados, 0) AS kmhs_rodados,
        CASE
            WHEN NVL(a.qtde_litros, 0) > 0
                THEN SUM(NVL(c.quantidade, 0) * NVL(c.vrcustounitario, 0)) / a.qtde_litros
            ELSE MAX(c.vrcustounitario)
        END AS custo_unitario,
        NVL(SUM(NVL(c.quantidade, 0) * NVL(c.vrcustounitario, 0)), 0) AS valor_total
    FROM posto.abastecimento a
    LEFT JOIN posto.abastecimento_itensrequisicao b
      ON a.cod_abast = b.cod_abast
     AND a.cod_grupoempresa = b.cod_grupoempresa
     AND a.cod_empresa = b.cod_empresa
     AND a.cod_filial = b.cod_filial
    LEFT JOIN material.itensrequisicaomaterial c
      ON b.nrrequisicao = c.nrrequisicao
     AND b.item = c.item
    WHERE (
        :dataInicio IS NULL
        OR TRUNC(a.data) >= TO_DATE(:dataInicio, 'YYYY-MM-DD') - 120
    )
    AND (
        :dataFim IS NULL
        OR TRUNC(a.data) <= TO_DATE(:dataFim, 'YYYY-MM-DD')
    )
    GROUP BY
        a.cod_grupoempresa,
        a.cod_empresa,
        a.cod_filial,
        a.cod_abast,
        a.cod_equipamento,
        a.data,
        a.qtde_litros,
        a.kmhs_rodados
),
automotivo_abastecimentos AS (
    SELECT
        'automotivo' AS origem,
        (
            TO_CHAR(a.cod_grupoempresa) || '|' ||
            TO_CHAR(a.cod_equipamento) || '|' ||
            TO_CHAR(a.dtabastecimento, 'YYYYMMDDHH24MISS') || '|' ||
            TO_CHAR(a.sequencia)
        ) AS id_abastecimento,
        a.cod_equipamento,
        a.cod_material,
        a.dtabastecimento AS data_abastecimento,
        NVL(a.qtdelitros, 0) AS qtde_litros,
        NVL(a.kmhs_rodados, 0) AS kmhs_rodados,
        a.valor_unitario AS custo_unitario,
        NVL(a.qtdelitros, 0) * NVL(a.valor_unitario, 0) AS valor_total
    FROM automotivo.abastecimento a
    WHERE a.nrrequisicao IS NOT NULL
      AND (
          :dataInicio IS NULL
          OR TRUNC(a.dtabastecimento) >= TO_DATE(:dataInicio, 'YYYY-MM-DD') - 120
      )
      AND (
          :dataFim IS NULL
          OR TRUNC(a.dtabastecimento) <= TO_DATE(:dataFim, 'YYYY-MM-DD')
      )
),
abastecimentos_brutos AS (
    SELECT * FROM automotivo_abastecimentos
    UNION ALL
    SELECT * FROM posto_abastecimentos
),
abastecimentos AS (
    SELECT
        b.*,
        ROW_NUMBER() OVER (
            PARTITION BY b.cod_equipamento
            ORDER BY b.data_abastecimento, b.origem, b.id_abastecimento
        ) AS seq_equip
    FROM abastecimentos_brutos b
),
abastecimentos_periodo AS (
    SELECT a.*
      FROM abastecimentos a
     WHERE (:dataInicio IS NULL OR TRUNC(a.data_abastecimento) >= TO_DATE(:dataInicio, 'YYYY-MM-DD'))
       AND (:dataFim IS NULL OR TRUNC(a.data_abastecimento) <= TO_DATE(:dataFim, 'YYYY-MM-DD'))
),
intervalo AS (
    SELECT
        a.origem,
        a.id_abastecimento,
        a.cod_equipamento,
        a.cod_material,
        a.data_abastecimento,
        a.qtde_litros,
        a.kmhs_rodados,
        a.custo_unitario,
        a.valor_total,
        a.seq_equip,
        prev.data_abastecimento AS data_abastecimento_ant
    FROM abastecimentos_periodo a
    LEFT JOIN abastecimentos prev
      ON prev.cod_equipamento = a.cod_equipamento
     AND prev.seq_equip = a.seq_equip - 1
),
apont_intervalo AS (
    SELECT
        i.id_abastecimento,
        SUM(
            NVL(
                NULLIF(b.tothoras_trabalhadas, 0),
                NVL(b.km_final, 0) - NVL(b.km_inicial, 0)
            )
        ) AS horas_apontamento,
        SUM(NVL(b.area, 0)) AS area_ha
    FROM intervalo i
    LEFT JOIN automotivo.itens_apontamento b
      ON b.cod_equipamento = i.cod_equipamento
     AND b.dt_apontamento <= i.data_abastecimento
     AND (i.data_abastecimento_ant IS NULL OR b.dt_apontamento > i.data_abastecimento_ant)
    GROUP BY i.id_abastecimento
),
apont_escolhido AS (
    SELECT
        i.id_abastecimento,
        b.cod_operacaoagricola,
        b.cod_fazenda,
        b.cod_talhao,
        ROW_NUMBER() OVER (
            PARTITION BY i.id_abastecimento
            ORDER BY b.dt_apontamento DESC NULLS LAST,
                     NVL(b.area, 0) DESC,
                     NVL(b.tothoras_trabalhadas, 0) DESC
        ) AS rn
    FROM intervalo i
    JOIN automotivo.itens_apontamento b
      ON b.cod_equipamento = i.cod_equipamento
     AND b.dt_apontamento <= i.data_abastecimento
     AND (i.data_abastecimento_ant IS NULL OR b.dt_apontamento > i.data_abastecimento_ant)
),
tipo_vigente AS (
    SELECT
        i.id_abastecimento,
        ht.cod_tipoequipamento,
        ROW_NUMBER() OVER (
            PARTITION BY i.id_abastecimento
            ORDER BY ht.data_inicio DESC
        ) AS rn
    FROM intervalo i
    JOIN automotivo.historico_tipoequipamento ht
      ON ht.cod_equipamento = i.cod_equipamento
     AND TRUNC(i.data_abastecimento)
         BETWEEN TRUNC(ht.data_inicio) AND TRUNC(NVL(ht.data_fim, SYSDATE))
),
modelo_unico AS (
    SELECT
        m.cod_modelo,
        ${modeloDescExpr} AS modelo_equipamento,
        ROW_NUMBER() OVER (PARTITION BY m.cod_modelo ORDER BY m.cod_modelo) AS rn
    FROM automotivo.modeloequipamento m
),
equip_unico AS (
    SELECT
        e.cod_equipamento,
        e.cod_modelo,
        UPPER(NVL(e.tipohorimetro, 'N')) AS tipohorimetro,
        e.descricao AS equipamento_descricao,
        e.cod_classificacao,
        ROW_NUMBER() OVER (PARTITION BY e.cod_equipamento ORDER BY e.cod_equipamento) AS rn
    FROM automotivo.equipamento e
),
classif_unico AS (
    SELECT
        c.cod_classificacao,
        c.descricao AS grupo_descricao,
        ROW_NUMBER() OVER (PARTITION BY c.cod_classificacao ORDER BY c.cod_classificacao) AS rn
    FROM automotivo.classificacaoequipamento c
),
tipo_unico AS (
    SELECT
        t.cod_tipoequipamento,
        t.descricaotipoequipamento,
        ROW_NUMBER() OVER (PARTITION BY t.cod_tipoequipamento ORDER BY t.cod_tipoequipamento) AS rn
    FROM automotivo.tipoequipamento t
)
SELECT
    i.origem,
    i.id_abastecimento,
    i.cod_equipamento,
    i.cod_material,
    i.data_abastecimento,
    i.qtde_litros,
    i.kmhs_rodados,
    i.custo_unitario,
    i.valor_total,
    tv.cod_tipoequipamento,
    te.descricaotipoequipamento AS tipo_equipamento,
    eq.cod_modelo,
    NVL(mu.modelo_equipamento, TO_CHAR(eq.cod_modelo)) AS modelo_equipamento,
    eq.tipohorimetro,
    eq.equipamento_descricao,
    eq.cod_classificacao,
    NVL(cl.grupo_descricao, NVL(mu.modelo_equipamento, 'Sem grupo')) AS grupo_equipamento,
    ae.cod_operacaoagricola,
    op.descricao AS descricao_operacao,
    ae.cod_fazenda,
    ae.cod_talhao,
    NVL(ai.horas_apontamento, 0) AS horas_apontamento,
    NVL(ai.area_ha, 0) AS area_ha,
    CASE
        WHEN eq.tipohorimetro = 'K' THEN NVL(i.kmhs_rodados, 0)
        ELSE 0
    END AS km_rodados,
    CASE
        WHEN eq.tipohorimetro = 'H' THEN
            CASE
                WHEN NVL(ai.horas_apontamento, 0) > 0 THEN ai.horas_apontamento
                ELSE NVL(i.kmhs_rodados, 0)
            END
        ELSE NVL(ai.horas_apontamento, 0)
    END AS horas_trabalho,
    CASE
        WHEN eq.tipohorimetro = 'H'
             AND (
                 NVL(ai.horas_apontamento, 0) > 0
                 OR NVL(i.kmhs_rodados, 0) > 0
             )
        THEN i.qtde_litros / CASE
            WHEN NVL(ai.horas_apontamento, 0) > 0 THEN ai.horas_apontamento
            ELSE i.kmhs_rodados
        END
        ELSE NULL
    END AS litros_por_hora,
    CASE
        WHEN eq.tipohorimetro = 'K'
             AND NVL(i.qtde_litros, 0) > 0
             AND NVL(i.kmhs_rodados, 0) > 0
        THEN i.kmhs_rodados / i.qtde_litros
        ELSE NULL
    END AS km_por_litro,
    CASE
        WHEN NVL(ai.area_ha, 0) > 0 THEN i.qtde_litros / ai.area_ha
        ELSE NULL
    END AS litros_por_ha
FROM intervalo i
LEFT JOIN apont_intervalo ai
  ON ai.id_abastecimento = i.id_abastecimento
LEFT JOIN apont_escolhido ae
  ON ae.id_abastecimento = i.id_abastecimento
 AND ae.rn = 1
LEFT JOIN rh.operacaoagricola op
  ON op.cod_operacaoagricola = ae.cod_operacaoagricola
LEFT JOIN tipo_vigente tv
  ON tv.id_abastecimento = i.id_abastecimento
 AND tv.rn = 1
LEFT JOIN equip_unico eq
  ON eq.cod_equipamento = i.cod_equipamento
 AND eq.rn = 1
LEFT JOIN modelo_unico mu
  ON mu.cod_modelo = eq.cod_modelo
 AND mu.rn = 1
LEFT JOIN classif_unico cl
  ON cl.cod_classificacao = eq.cod_classificacao
 AND cl.rn = 1
LEFT JOIN tipo_unico te
  ON te.cod_tipoequipamento = tv.cod_tipoequipamento
 AND te.rn = 1
ORDER BY i.data_abastecimento, i.cod_equipamento, i.origem
`;
}

/** Total financeiro sem joins de apontamento/modelo. */
const SQL_TOTAL_BASE = `
SELECT
    NVL(SUM(CASE WHEN origem = 'automotivo' THEN valor_total ELSE 0 END), 0) AS valor_automotivo,
    NVL(SUM(CASE WHEN origem = 'posto' THEN valor_total ELSE 0 END), 0) AS valor_posto,
    NVL(SUM(valor_total), 0) AS valor_total,
    NVL(SUM(CASE WHEN origem = 'automotivo' THEN qtde_litros ELSE 0 END), 0) AS litros_automotivo,
    NVL(SUM(CASE WHEN origem = 'posto' THEN qtde_litros ELSE 0 END), 0) AS litros_posto,
    COUNT(*) AS qtd_linhas
FROM (
    SELECT
        'automotivo' AS origem,
        NVL(a.qtdelitros, 0) AS qtde_litros,
        NVL(a.qtdelitros, 0) * NVL(a.valor_unitario, 0) AS valor_total
    FROM automotivo.abastecimento a
    WHERE a.nrrequisicao IS NOT NULL
      AND (:dataInicio IS NULL OR TRUNC(a.dtabastecimento) >= TO_DATE(:dataInicio, 'YYYY-MM-DD'))
      AND (:dataFim IS NULL OR TRUNC(a.dtabastecimento) <= TO_DATE(:dataFim, 'YYYY-MM-DD'))

    UNION ALL

    SELECT
        'posto' AS origem,
        NVL(a.qtde_litros, 0) AS qtde_litros,
        NVL(SUM(NVL(c.quantidade, 0) * NVL(c.vrcustounitario, 0)), 0) AS valor_total
    FROM posto.abastecimento a
    LEFT JOIN posto.abastecimento_itensrequisicao b
      ON a.cod_abast = b.cod_abast
     AND a.cod_grupoempresa = b.cod_grupoempresa
     AND a.cod_empresa = b.cod_empresa
     AND a.cod_filial = b.cod_filial
    LEFT JOIN material.itensrequisicaomaterial c
      ON b.nrrequisicao = c.nrrequisicao
     AND b.item = c.item
    WHERE (:dataInicio IS NULL OR TRUNC(a.data) >= TO_DATE(:dataInicio, 'YYYY-MM-DD'))
      AND (:dataFim IS NULL OR TRUNC(a.data) <= TO_DATE(:dataFim, 'YYYY-MM-DD'))
    GROUP BY
        a.cod_grupoempresa,
        a.cod_empresa,
        a.cod_filial,
        a.cod_abast,
        a.qtde_litros
)
`;

function mapRow(raw: Record<string, unknown>): IndicadoresCombustivelLinha {
  const codModelo = oracleNumber(raw, "cod_modelo", "COD_MODELO");
  const modeloText = oracleText(raw, "modelo_equipamento", "MODELO_EQUIPAMENTO");
  const tipoText = oracleText(raw, "tipo_equipamento", "TIPO_EQUIPAMENTO");
  const grupoText = oracleText(raw, "grupo_equipamento", "GRUPO_EQUIPAMENTO");
  const tipoh = (oracleText(raw, "tipohorimetro", "TIPOHORIMETRO") || "N").toUpperCase();
  const qtdeLitros = oracleNumber(raw, "qtde_litros", "QTDE_LITROS") ?? 0;
  const custoUnitario = oracleNumber(raw, "custo_unitario", "CUSTO_UNITARIO");
  const valorTotal = oracleNumber(raw, "valor_total", "VALOR_TOTAL");
  const origem = oracleText(raw, "origem", "ORIGEM") || "automotivo";
  const idAbastecimento =
    oracleText(raw, "id_abastecimento", "ID_ABASTECIMENTO") ||
    `${origem}|${oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO")}|${oracleDate(raw, "data_abastecimento", "DATA_ABASTECIMENTO")}`;
  const horasApontamento = oracleNumber(raw, "horas_apontamento", "HORAS_APONTAMENTO") ?? 0;
  const kmhsRodados = oracleNumber(raw, "kmhs_rodados", "KMHS_RODADOS") ?? 0;
  const kmRodados = oracleNumber(raw, "km_rodados", "KM_RODADOS") ?? (tipoh === "K" ? kmhsRodados : 0);
  const horasTrabalho =
    oracleNumber(raw, "horas_trabalho", "HORAS_TRABALHO") ??
    (tipoh === "H" ? (horasApontamento > 0 ? horasApontamento : kmhsRodados) : horasApontamento);
  const funcionaPorHora = tipoh === "H";
  const litrosPorHoraRaw = oracleNumber(raw, "litros_por_hora", "LITROS_POR_HORA");
  const kmPorLitroRaw = oracleNumber(raw, "km_por_litro", "KM_POR_LITRO");

  return {
    origem,
    idAbastecimento,
    dataAbastecimento: oracleDate(raw, "data_abastecimento", "DATA_ABASTECIMENTO"),
    codEquipamento: oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO"),
    equipamentoDescricao: oracleText(raw, "equipamento_descricao", "EQUIPAMENTO_DESCRICAO"),
    codMaterial: oracleNumber(raw, "cod_material", "COD_MATERIAL"),
    codModelo,
    modeloEquipamento: modeloText?.trim() || (codModelo != null ? `Modelo ${codModelo}` : "Sem modelo"),
    tipoEquipamento: tipoText,
    codTipoEquipamento: oracleNumber(raw, "cod_tipoequipamento", "COD_TIPOEQUIPAMENTO"),
    tipoHorimetro: tipoh,
    funcionaPorHora,
    frota: tipoText?.trim() || "Sem frota",
    grupo: grupoText?.trim() || modeloText?.trim() || "Sem grupo",
    codOperacaoAgricola: oracleNumber(raw, "cod_operacaoagricola", "COD_OPERACAOAGRICOLA"),
    descricaoOperacao: oracleText(raw, "descricao_operacao", "DESCRICAO_OPERACAO"),
    codFazenda: oracleNumber(raw, "cod_fazenda", "COD_FAZENDA"),
    codTalhao: oracleNumber(raw, "cod_talhao", "COD_TALHAO"),
    qtdeLitros,
    horasApontamento,
    horasTrabalho,
    kmRodados,
    kmhsRodados,
    areaHa: oracleNumber(raw, "area_ha", "AREA_HA") ?? 0,
    litrosPorHora: funcionaPorHora
      ? litrosPorHoraRaw ?? (horasTrabalho > 0 ? round3(qtdeLitros / horasTrabalho) : null)
      : null,
    kmPorLitro:
      tipoh === "K"
        ? kmPorLitroRaw ?? (qtdeLitros > 0 && kmRodados > 0 ? round3(kmRodados / qtdeLitros) : null)
        : null,
    litrosPorHa: oracleNumber(raw, "litros_por_ha", "LITROS_POR_HA"),
    custoUnitario,
    vrCustoUnitario: custoUnitario,
    valorTotal:
      valorTotal != null
        ? money2(valorTotal)
        : custoUnitario != null
          ? money2(qtdeLitros * custoUnitario)
          : 0,
  };
}

function agregaPorTipoEquipamento(dados: IndicadoresCombustivelLinha[]): CombustivelTipoEquipamento[] {
  const map = new Map<
    string,
    {
      codTipoEquipamento: number | null;
      tipoEquipamento: string;
      qtdeLitros: number;
      valorTotal: number;
      kmRodados: number;
      horasTrabalho: number;
      litrosKm: number;
      litrosHora: number;
      equipamentos: Set<string>;
    }
  >();

  for (const row of dados) {
    const tipo = row.tipoEquipamento?.trim() || row.frota || "Sem tipo";
    const key =
      row.codTipoEquipamento != null ? `t:${row.codTipoEquipamento}` : `n:${tipo.toLowerCase()}`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        codTipoEquipamento: row.codTipoEquipamento,
        tipoEquipamento: tipo,
        qtdeLitros: 0,
        valorTotal: 0,
        kmRodados: 0,
        horasTrabalho: 0,
        litrosKm: 0,
        litrosHora: 0,
        equipamentos: new Set(),
      };
      map.set(key, bucket);
    }
    bucket.qtdeLitros += row.qtdeLitros;
    bucket.valorTotal += row.valorTotal;
    bucket.kmRodados += row.kmRodados;
    if (row.funcionaPorHora) {
      bucket.horasTrabalho += row.horasTrabalho;
      bucket.litrosHora += row.qtdeLitros;
    } else if (row.tipoHorimetro === "K") {
      bucket.litrosKm += row.qtdeLitros;
    } else {
      bucket.horasTrabalho += row.horasTrabalho;
    }
    if (row.codEquipamento != null) bucket.equipamentos.add(String(row.codEquipamento));
  }

  return [...map.values()]
    .map((bucket) => ({
      codTipoEquipamento: bucket.codTipoEquipamento,
      tipoEquipamento: bucket.tipoEquipamento,
      qtdEquipamentos: bucket.equipamentos.size,
      qtdeLitros: round3(bucket.qtdeLitros),
      valorTotal: money2(bucket.valorTotal),
      kmRodados: round3(bucket.kmRodados),
      horasTrabalho: round3(bucket.horasTrabalho),
      kmPorLitro:
        bucket.litrosKm > 0 && bucket.kmRodados > 0
          ? round3(bucket.kmRodados / bucket.litrosKm)
          : null,
      litrosPorHora:
        bucket.horasTrabalho > 0 && bucket.litrosHora > 0
          ? round3(bucket.litrosHora / bucket.horasTrabalho)
          : null,
    }))
    .sort((a, b) => a.tipoEquipamento.localeCompare(b.tipoEquipamento, "pt-BR"));
}

function agregaPorEquipamento(dados: IndicadoresCombustivelLinha[]): CombustivelEquipamento[] {
  const map = new Map<
    string,
    {
      codEquipamento: number | null;
      label: string;
      descricao: string | null;
      tipoHorimetro: string | null;
      funcionaPorHora: boolean;
      qtdeLitros: number;
      valorTotal: number;
      kmRodados: number;
      horasTrabalho: number;
      litrosKm: number;
      litrosHora: number;
    }
  >();

  for (const row of dados) {
    if (row.codEquipamento == null) continue;
    const key = String(row.codEquipamento);
    const desc =
      row.equipamentoDescricao?.trim() ||
      row.modeloEquipamento?.trim() ||
      `Equipamento ${row.codEquipamento}`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        codEquipamento: row.codEquipamento,
        label: String(row.codEquipamento),
        descricao: desc,
        tipoHorimetro: row.tipoHorimetro,
        funcionaPorHora: Boolean(row.funcionaPorHora),
        qtdeLitros: 0,
        valorTotal: 0,
        kmRodados: 0,
        horasTrabalho: 0,
        litrosKm: 0,
        litrosHora: 0,
      };
      map.set(key, bucket);
    }
    bucket.qtdeLitros += row.qtdeLitros;
    bucket.valorTotal += row.valorTotal;
    bucket.kmRodados += row.kmRodados;
    if (row.funcionaPorHora) {
      bucket.horasTrabalho += row.horasTrabalho;
      bucket.litrosHora += row.qtdeLitros;
      bucket.funcionaPorHora = true;
    } else if (row.tipoHorimetro === "K") {
      bucket.litrosKm += row.qtdeLitros;
    } else {
      bucket.horasTrabalho += row.horasTrabalho;
    }
  }

  return [...map.values()]
    .map((bucket) => ({
      codEquipamento: bucket.codEquipamento,
      label: bucket.label,
      descricao: bucket.descricao,
      tipoHorimetro: bucket.tipoHorimetro,
      funcionaPorHora: bucket.funcionaPorHora,
      qtdeLitros: round3(bucket.qtdeLitros),
      valorTotal: money2(bucket.valorTotal),
      kmRodados: round3(bucket.kmRodados),
      horasTrabalho: round3(bucket.horasTrabalho),
      kmPorLitro:
        bucket.litrosKm > 0 && bucket.kmRodados > 0
          ? round3(bucket.kmRodados / bucket.litrosKm)
          : null,
      litrosPorHora:
        bucket.horasTrabalho > 0 && bucket.litrosHora > 0
          ? round3(bucket.litrosHora / bucket.horasTrabalho)
          : null,
    }))
    .sort((a, b) => (a.codEquipamento ?? 0) - (b.codEquipamento ?? 0));
}

function agregaPorFrotaGrupo(dados: IndicadoresCombustivelLinha[]): CombustivelFrotaGrupo[] {
  const map = new Map<
    string,
    {
      frota: string;
      grupo: string;
      qtdeLitros: number;
      valorTotal: number;
      kmRodados: number;
      horasTrabalho: number;
      litrosKm: number;
      litrosHora: number;
      equipamentos: Set<string>;
    }
  >();

  for (const row of dados) {
    const frota = row.frota || "Sem frota";
    const grupo = row.grupo || "Sem grupo";
    const key = `${frota}||${grupo}`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        frota,
        grupo,
        qtdeLitros: 0,
        valorTotal: 0,
        kmRodados: 0,
        horasTrabalho: 0,
        litrosKm: 0,
        litrosHora: 0,
        equipamentos: new Set(),
      };
      map.set(key, bucket);
    }
    bucket.qtdeLitros += row.qtdeLitros;
    bucket.valorTotal += row.valorTotal;
    bucket.kmRodados += row.kmRodados;
    if (row.funcionaPorHora) {
      bucket.horasTrabalho += row.horasTrabalho;
      bucket.litrosHora += row.qtdeLitros;
    } else if (row.tipoHorimetro === "K") {
      bucket.litrosKm += row.qtdeLitros;
    } else {
      bucket.horasTrabalho += row.horasTrabalho;
    }
    if (row.codEquipamento != null) bucket.equipamentos.add(String(row.codEquipamento));
  }

  return [...map.values()]
    .map((bucket) => ({
      frota: bucket.frota,
      grupo: bucket.grupo,
      qtdEquipamentos: bucket.equipamentos.size,
      qtdeLitros: round3(bucket.qtdeLitros),
      valorTotal: money2(bucket.valorTotal),
      kmRodados: round3(bucket.kmRodados),
      horasTrabalho: round3(bucket.horasTrabalho),
      kmPorLitro:
        bucket.litrosKm > 0 && bucket.kmRodados > 0
          ? round3(bucket.kmRodados / bucket.litrosKm)
          : null,
      litrosPorHora:
        bucket.horasTrabalho > 0 && bucket.litrosHora > 0
          ? round3(bucket.litrosHora / bucket.horasTrabalho)
          : null,
    }))
    .sort(
      (a, b) =>
        a.frota.localeCompare(b.frota, "pt-BR") || a.grupo.localeCompare(b.grupo, "pt-BR"),
    );
}

export function buildCombustivelDashboard(
  dados: IndicadoresCombustivelLinha[],
  custoTotalOverride?: number,
): CombustivelDashboard {
  const porFrotaGrupo = agregaPorFrotaGrupo(dados);
  const porEquipamento = agregaPorEquipamento(dados);
  const porTipoEquipamento = agregaPorTipoEquipamento(dados);
  const equipamentos = new Set(
    dados.filter((r) => r.codEquipamento != null).map((r) => String(r.codEquipamento)),
  );
  const litrosTotal = round3(dados.reduce((acc, r) => acc + r.qtdeLitros, 0));
  const kmTotal = round3(dados.reduce((acc, r) => acc + r.kmRodados, 0));
  const horasTotal = round3(dados.reduce((acc, r) => acc + r.horasTrabalho, 0));
  const custoTotal =
    custoTotalOverride != null
      ? money2(custoTotalOverride)
      : money2(dados.reduce((acc, r) => acc + r.valorTotal, 0));
  const comKmL = dados.filter((r) => r.kmPorLitro != null && r.kmPorLitro > 0);
  const comLh = dados.filter((r) => r.funcionaPorHora && r.litrosPorHora != null && r.litrosPorHora > 0);

  return {
    kpis: {
      custoTotal,
      litrosTotal,
      kmTotal,
      horasTotal,
      mediaKmPorLitro: comKmL.length
        ? round3(comKmL.reduce((acc, r) => acc + (r.kmPorLitro || 0), 0) / comKmL.length)
        : kmTotal > 0 && litrosTotal > 0
          ? round3(kmTotal / litrosTotal)
          : null,
      mediaLitrosPorHora: comLh.length
        ? round3(comLh.reduce((acc, r) => acc + (r.litrosPorHora || 0), 0) / comLh.length)
        : horasTotal > 0 && litrosTotal > 0
          ? round3(litrosTotal / horasTotal)
          : null,
      qtdEquipamentos: equipamentos.size,
      qtdAbastecimentos: dados.length,
    },
    porFrotaGrupo,
    porEquipamento,
    porTipoEquipamento,
  };
}

function dedupeLinhas(rows: IndicadoresCombustivelLinha[]): IndicadoresCombustivelLinha[] {
  const map = new Map<string, IndicadoresCombustivelLinha>();
  for (const row of rows) {
    const key = `${row.origem}|${row.idAbastecimento}`;
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

function agregaPorModelo(dados: IndicadoresCombustivelLinha[]): IndicadoresCombustivelModelo[] {
  const map = new Map<
    string,
    {
      codModelo: number | null;
      modeloEquipamento: string;
      tipoEquipamento: string | null;
      qtdeLitros: number;
      horasApontamento: number;
      kmhsRodados: number;
      areaHa: number;
      valorTotal: number;
      qtdAbastecimentos: number;
      equipamentos: Set<string>;
    }
  >();

  for (const row of dados) {
    const key = row.codModelo != null ? `m:${row.codModelo}` : `nome:${row.modeloEquipamento}`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        codModelo: row.codModelo,
        modeloEquipamento: row.modeloEquipamento,
        tipoEquipamento: row.tipoEquipamento,
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
    bucket.qtdeLitros += row.qtdeLitros;
    bucket.horasApontamento += row.horasApontamento;
    bucket.kmhsRodados += row.kmhsRodados;
    bucket.areaHa += row.areaHa;
    bucket.valorTotal += row.valorTotal;
    bucket.qtdAbastecimentos += 1;
    if (row.tipoEquipamento && !bucket.tipoEquipamento) bucket.tipoEquipamento = row.tipoEquipamento;
    if (row.codEquipamento != null) bucket.equipamentos.add(String(row.codEquipamento));
  }

  return [...map.values()]
    .map((bucket) => {
      const horas = bucket.horasApontamento > 0 ? bucket.horasApontamento : bucket.kmhsRodados;
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
        valorTotal: money2(bucket.valorTotal),
        litrosPorHora: horas > 0 ? round3(bucket.qtdeLitros / horas) : null,
        litrosPorHa: bucket.areaHa > 0 ? round3(bucket.qtdeLitros / bucket.areaHa) : null,
      };
    })
    .sort((a, b) => a.modeloEquipamento.localeCompare(b.modeloEquipamento, "pt-BR"));
}

export async function gerarIndicadoresCombustivel(filtros: {
  dataInicio?: string | null;
  dataFim?: string | null;
}): Promise<IndicadoresCombustivelData> {
  const dataInicio = filtros.dataInicio?.trim() || null;
  const dataFim = filtros.dataFim?.trim() || null;
  const binds = { dataInicio, dataFim };

  return withOracle(async (conn) => {
    const baseResult = await conn.execute(SQL_TOTAL_BASE, binds);
    const baseRow = ((baseResult.rows ?? [])[0] ?? {}) as Record<string, unknown>;
    const totalValorBase = money2(oracleNumber(baseRow, "valor_total", "VALOR_TOTAL") ?? 0);
    const totalValorAutomotivoBase = money2(
      oracleNumber(baseRow, "valor_automotivo", "VALOR_AUTOMOTIVO") ?? 0,
    );
    const totalValorPostoBase = money2(oracleNumber(baseRow, "valor_posto", "VALOR_POSTO") ?? 0);

    let rows: Record<string, unknown>[] = [];
    let lastError: unknown = null;
    for (const expr of MODELO_DESC_CANDIDATES) {
      try {
        const result = await conn.execute(buildSql(expr), binds);
        rows = (result.rows ?? []) as Record<string, unknown>[];
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        if (!isMissingColumnError(err)) throw err;
      }
    }
    if (lastError) throw lastError;

    const dados = dedupeLinhas(rows.map(mapRow));
    const porModelo = agregaPorModelo(dados);
    const comLh = dados.filter((r) => r.funcionaPorHora && r.litrosPorHora != null && r.litrosPorHora > 0);
    const comKmL = dados.filter((r) => r.kmPorLitro != null && r.kmPorLitro > 0);
    const comLha = dados.filter((r) => r.litrosPorHa != null && r.litrosPorHa > 0);
    const auto = dados.filter((r) => r.origem === "automotivo");
    const posto = dados.filter((r) => r.origem === "posto");
    const totalKm = round3(dados.reduce((acc, r) => acc + r.kmRodados, 0));
    const totalHoras = round3(dados.reduce((acc, r) => acc + r.horasTrabalho, 0));
    const dashboard = buildCombustivelDashboard(dados, totalValorBase);

    // KPIs financeiros sempre da query base (impossível multiplicar por join de detalhe).
    return {
      filtros: { dataInicio, dataFim },
      resumo: {
        totalLinhas: dados.length,
        totalLitros: round3(dados.reduce((acc, r) => acc + r.qtdeLitros, 0)),
        totalLitrosAutomotivo: round3(auto.reduce((acc, r) => acc + r.qtdeLitros, 0)),
        totalLitrosPosto: round3(posto.reduce((acc, r) => acc + r.qtdeLitros, 0)),
        totalHoras,
        totalKm,
        totalAreaHa: round3(dados.reduce((acc, r) => acc + r.areaHa, 0)),
        totalValor: totalValorBase,
        totalValorAutomotivo: totalValorAutomotivoBase,
        totalValorPosto: totalValorPostoBase,
        totalValorBase,
        qtdModelos: porModelo.length,
        mediaLitrosPorHora: comLh.length
          ? round3(comLh.reduce((acc, r) => acc + (r.litrosPorHora || 0), 0) / comLh.length)
          : null,
        mediaKmPorLitro: comKmL.length
          ? round3(comKmL.reduce((acc, r) => acc + (r.kmPorLitro || 0), 0) / comKmL.length)
          : totalKm > 0 && dados.reduce((acc, r) => acc + r.qtdeLitros, 0) > 0
            ? round3(totalKm / dados.reduce((acc, r) => acc + r.qtdeLitros, 0))
            : null,
        mediaLitrosPorHa: comLha.length
          ? round3(comLha.reduce((acc, r) => acc + (r.litrosPorHa || 0), 0) / comLha.length)
          : null,
      },
      dashboard,
      porModelo,
      dados,
    };
  });
}
