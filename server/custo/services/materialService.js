import { executeQuery, bindsPeriodoData } from '../utils/oracle.js';

/**
 * Material de manutenção otimizado:
 * - filtra retirada pelo intervalo do mês
 * - último apontamento via LATERAL + FETCH FIRST
 * - exclui cod_objetocusto da oficina (negocio=3, processo=1) para não duplicar
 * - exclui itens já contabilizados como insumo agrícola (apontamentomaterial)
 * - exclui combustíveis (família 29 / grupos 10,11,1,4,5) já cobertos pelo abastecimento
 */
const EXCLUI_INSUMO_AGRICOLA = `
      AND NOT EXISTS (
          SELECT 1
          FROM agricola.apontamentomaterial am
          WHERE am.nrrequisicao = a.nrrequisicao
            AND am.cod_material = a.cod_material
            AND am.item_requisicao = a.item
      )`;

/** Combustível já entra via abastecimento (automotivo/posto). */
const EXCLUI_COMBUSTIVEL = `
      AND NOT EXISTS (
          SELECT 1
          FROM material.material mat
          INNER JOIN material.grupomaterial gm
              ON mat.cod_familia = gm.cod_familia
             AND mat.cod_grupomaterial = gm.cod_grupomaterial
          WHERE mat.cod_material = a.cod_material
            AND mat.cod_familia = 29
            AND mat.cod_grupomaterial IN (10, 11, 1, 4, 5)
      )`;

const MATERIAL_SQL = `
WITH req AS (
    SELECT
        a.nrrequisicao,
        a.item,
        a.cod_material,
        a.quantidade,
        a.vrcustounitario,
        a.dataretirada,
        a.cod_equipamento,
        a.cod_objetocusto AS objetocustorequisicao,
        (a.quantidade * NVL(a.vrcustounitario, 0)) AS valor_total
    FROM material.itensrequisicaomaterial a
    WHERE a.dataretirada IS NOT NULL
      AND (
          :dataInicio IS NULL
          OR a.dataretirada >= :dataInicio
      )
      AND (
          :dataFim IS NULL
          OR a.dataretirada < :dataFim
      )
      AND (
          :equipamento IS NULL
          OR a.cod_equipamento = :equipamento
      )
      /* Exclui objetos de custo da oficina (já rateados na query de OS) */
      AND NOT EXISTS (
          SELECT 1
          FROM custo.objetocusto oc_oficina
          WHERE oc_oficina.cod_objetocusto = a.cod_objetocusto
            AND oc_oficina.negocio = 3
            AND oc_oficina.processo = 1
      )
      /* Exclui insumos agrícolas (já entram em custoInsumo) */
${EXCLUI_INSUMO_AGRICOLA}
      /* Exclui combustíveis (já entram em custoCombustivel / abastecimento) */
${EXCLUI_COMBUSTIVEL}
)
SELECT
    r.nrrequisicao,
    r.cod_material,
    mat.descricao AS descricao_material,
    r.quantidade,
    r.vrcustounitario,
    NVL(b.dt_apontamento, r.dataretirada) AS dataretiradaapontamento,
    r.cod_equipamento,
    b.cod_operacaoagricola,
    d.cod_objetocusto AS objetocustooperacao,
    r.objetocustorequisicao,
    b.cod_fazenda,
    b.cod_talhao,
    r.valor_total
FROM req r
LEFT JOIN material.material mat
    ON mat.cod_material = r.cod_material
LEFT JOIN LATERAL (
    SELECT
        ap.dt_apontamento,
        ap.cod_operacaoagricola,
        ap.cod_fazenda,
        ap.cod_talhao
    FROM automotivo.itens_apontamento ap
    WHERE ap.cod_equipamento = r.cod_equipamento
      AND ap.dt_apontamento <= r.dataretirada
    ORDER BY ap.dt_apontamento DESC
    FETCH FIRST 1 ROW ONLY
) b ON 1 = 1
LEFT JOIN (
    SELECT cod_operacaoagricola, cod_objetocusto
    FROM rh.operacaoobjetocusto
    WHERE data_termino IS NULL
) d
    ON b.cod_operacaoagricola = d.cod_operacaoagricola
WHERE NOT EXISTS (
    /* Garante exclusão no resultado/total: nenhum objeto oficina (neg 3 / proc 1) */
    SELECT 1
    FROM custo.objetocusto oc_oficina
    WHERE oc_oficina.cod_objetocusto = NVL(d.cod_objetocusto, r.objetocustorequisicao)
      AND oc_oficina.negocio = 3
      AND oc_oficina.processo = 1
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
        WHERE oc.cod_objetocusto = NVL(d.cod_objetocusto, r.objetocustorequisicao)
          AND (:objetoCusto IS NULL OR oc.cod_objetocusto = :objetoCusto)
          AND (:negociosCsv IS NULL OR INSTR(',' || :negociosCsv || ',', ',' || TO_CHAR(oc.negocio) || ',') > 0)
          AND (:processo IS NULL OR oc.processo = :processo)
          AND (:subprocesso IS NULL OR oc.subprocesso = :subprocesso)
          AND (:atividade IS NULL OR oc.atividade = :atividade)
    )
)
ORDER BY
    dataretiradaapontamento,
    r.cod_equipamento,
    r.nrrequisicao
`;

const MATERIAL_BASE_SQL = `
WITH req AS (
    SELECT
        a.nrrequisicao,
        a.item,
        a.cod_material,
        a.quantidade,
        a.vrcustounitario,
        a.dataretirada,
        a.cod_equipamento,
        a.cod_objetocusto AS objetocustorequisicao,
        (a.quantidade * NVL(a.vrcustounitario, 0)) AS valor_total
    FROM material.itensrequisicaomaterial a
    WHERE a.dataretirada IS NOT NULL
      AND (
          :dataInicio IS NULL
          OR a.dataretirada >= :dataInicio
      )
      AND (
          :dataFim IS NULL
          OR a.dataretirada < :dataFim
      )
      AND (
          :equipamento IS NULL
          OR a.cod_equipamento = :equipamento
      )
      /* Exclui objetos de custo da oficina (já rateados na query de OS) */
      AND NOT EXISTS (
          SELECT 1
          FROM custo.objetocusto oc_oficina
          WHERE oc_oficina.cod_objetocusto = a.cod_objetocusto
            AND oc_oficina.negocio = 3
            AND oc_oficina.processo = 1
      )
      /* Exclui insumos agrícolas (já entram em custoInsumo) */
${EXCLUI_INSUMO_AGRICOLA}
      /* Exclui combustíveis (já entram em custoCombustivel / abastecimento) */
${EXCLUI_COMBUSTIVEL}
),
materiais AS (
    SELECT
        TO_CHAR(r.dataretirada, 'YYYYMM') AS anomes,
        r.nrrequisicao,
        r.cod_equipamento,
        b.cod_operacaoagricola,
        d.cod_objetocusto AS objetocustooperacao,
        r.objetocustorequisicao,
        b.cod_fazenda,
        b.cod_talhao,
        r.cod_material,
        r.quantidade,
        r.valor_total
    FROM req r
    LEFT JOIN LATERAL (
        SELECT
            ap.dt_apontamento,
            ap.cod_operacaoagricola,
            ap.cod_fazenda,
            ap.cod_talhao
        FROM automotivo.itens_apontamento ap
        WHERE ap.cod_equipamento = r.cod_equipamento
          AND ap.dt_apontamento <= r.dataretirada
        ORDER BY ap.dt_apontamento DESC
        FETCH FIRST 1 ROW ONLY
    ) b ON 1 = 1
    LEFT JOIN (
        SELECT cod_operacaoagricola, cod_objetocusto
        FROM rh.operacaoobjetocusto
        WHERE data_termino IS NULL
    ) d
        ON b.cod_operacaoagricola = d.cod_operacaoagricola
    WHERE NOT EXISTS (
        SELECT 1
        FROM custo.objetocusto oc_oficina
        WHERE oc_oficina.cod_objetocusto = NVL(d.cod_objetocusto, r.objetocustorequisicao)
          AND oc_oficina.negocio = 3
          AND oc_oficina.processo = 1
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
            WHERE oc.cod_objetocusto = NVL(d.cod_objetocusto, r.objetocustorequisicao)
              AND (:objetoCusto IS NULL OR oc.cod_objetocusto = :objetoCusto)
              AND (:negociosCsv IS NULL OR INSTR(',' || :negociosCsv || ',', ',' || TO_CHAR(oc.negocio) || ',') > 0)
              AND (:processo IS NULL OR oc.processo = :processo)
              AND (:subprocesso IS NULL OR oc.subprocesso = :subprocesso)
              AND (:atividade IS NULL OR oc.atividade = :atividade)
        )
    )
),
agg AS (
    SELECT
        anomes,
        nrrequisicao,
        cod_equipamento,
        cod_operacaoagricola,
        objetocustooperacao,
        objetocustorequisicao,
        cod_fazenda,
        cod_talhao,
        cod_material,
        SUM(NVL(quantidade, 0)) AS quantidade,
        SUM(NVL(valor_total, 0)) AS custo_material,
        COUNT(*) AS qtd_itens
    FROM materiais
    GROUP BY
        anomes,
        nrrequisicao,
        cod_equipamento,
        cod_operacaoagricola,
        objetocustooperacao,
        objetocustorequisicao,
        cod_fazenda,
        cod_talhao,
        cod_material
)
SELECT
    a.anomes,
    a.nrrequisicao,
    a.cod_equipamento,
    a.cod_operacaoagricola,
    a.objetocustooperacao,
    a.objetocustorequisicao,
    oc_req.descricao AS descricao_objeto_requisicao,
    a.cod_fazenda,
    a.cod_talhao,
    a.cod_material,
    mat.descricao AS descricao_material,
    oc.cod_objetocusto AS objeto_destino,
    oc.descricao AS descricao_objeto,
    oc.atividade AS atividade,
    a.quantidade,
    a.custo_material,
    a.qtd_itens
FROM agg a
LEFT JOIN material.material mat
    ON mat.cod_material = a.cod_material
LEFT JOIN (
    SELECT
        cod_objetocusto,
        MAX(descricao) AS descricao,
        MAX(atividade) AS atividade
    FROM custo.objetocusto
    GROUP BY cod_objetocusto
) oc
    ON oc.cod_objetocusto = NVL(a.objetocustooperacao, a.objetocustorequisicao)
LEFT JOIN (
    SELECT
        cod_objetocusto,
        MAX(descricao) AS descricao
    FROM custo.objetocusto
    GROUP BY cod_objetocusto
) oc_req
    ON oc_req.cod_objetocusto = a.objetocustorequisicao
ORDER BY
    a.anomes,
    a.nrrequisicao,
    a.cod_equipamento,
    a.cod_material
`;

function toNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapMaterialRow(row) {
  return {
    nrRequisicao: row.NRREQUISICAO,
    codMaterial: row.COD_MATERIAL,
    descricaoMaterial:
      row.DESCRICAO_MATERIAL != null
        ? String(row.DESCRICAO_MATERIAL).trim()
        : null,
    quantidade: toNumber(row.QUANTIDADE),
    vrCustoUnitario: toNumber(row.VRCUSTOUNITARIO),
    dataRetiradaApontamento: row.DATARETIRADAAPONTAMENTO,
    codEquipamento: row.COD_EQUIPAMENTO,
    codOperacaoAgricola: row.COD_OPERACAOAGRICOLA,
    objetoCustoOperacao: row.OBJETOCUSTOOPERACAO,
    objetoCustoRequisicao: row.OBJETOCUSTOREQUISICAO,
    codFazenda: row.COD_FAZENDA,
    codTalhao: row.COD_TALHAO,
    valorTotal: toNumber(row.VALOR_TOTAL),
  };
}

function mapMaterialBaseRow(row) {
  return {
    anomes: row.ANOMES != null ? String(row.ANOMES) : null,
    nrRequisicao: row.NRREQUISICAO ?? null,
    codEquipamento: row.COD_EQUIPAMENTO,
    codOperacaoAgricola: row.COD_OPERACAOAGRICOLA,
    objetoCustoOperacao: row.OBJETOCUSTOOPERACAO,
    objetoCustoRequisicao: row.OBJETOCUSTOREQUISICAO,
    descricaoObjetoRequisicao:
      row.DESCRICAO_OBJETO_REQUISICAO != null
        ? String(row.DESCRICAO_OBJETO_REQUISICAO).trim()
        : null,
    descricaoObjeto:
      row.DESCRICAO_OBJETO != null ? String(row.DESCRICAO_OBJETO).trim() : null,
    atividade: row.ATIVIDADE ?? null,
    codFazenda: row.COD_FAZENDA,
    codTalhao: row.COD_TALHAO,
    codMaterial: row.COD_MATERIAL != null ? String(row.COD_MATERIAL) : null,
    descricaoMaterial:
      row.DESCRICAO_MATERIAL != null
        ? String(row.DESCRICAO_MATERIAL).trim()
        : null,
    quantidade: toNumber(row.QUANTIDADE) || 0,
    custoMaterial: toNumber(row.CUSTO_MATERIAL) || 0,
    qtdItens: toNumber(row.QTD_ITENS) || 0,
  };
}

function viaMaterial(row) {
  if (row.codOperacaoAgricola != null) return 'apontamento';
  if (row.objetoCustoRequisicao != null || row.objetoCustoOperacao != null) {
    return 'objeto-requisicao';
  }
  return 'sem-destino';
}

function objetoDestinoMaterial(row) {
  return row.objetoCustoOperacao ?? row.objetoCustoRequisicao ?? null;
}

function sortAnomesCusto(a, b, campo = 'custoEnviado') {
  const c = String(a.anomes || '').localeCompare(String(b.anomes || ''));
  if (c !== 0) return c;
  return (b[campo] || 0) - (a[campo] || 0);
}

/**
 * Diagnóstico: como o material de manutenção é distribuído e para onde vai.
 * Mesma base do consolidado (requisição + último apontamento do equipamento).
 */
export async function consultarDiagnosticoFluxoMaterial(filtros = {}) {
  const dados = await consultarBaseMateriais(filtros);

  const totalPorEq = new Map();
  for (const row of dados) {
    const key = `${row.anomes}|${row.codEquipamento}`;
    totalPorEq.set(key, (totalPorEq.get(key) || 0) + (row.custoMaterial || 0));
  }

  const fluxo = [];
  const destinoMap = new Map();
  const materialMap = new Map();
  const mesMap = new Map();
  const semEnvio = [];

  let total = 0;
  let totalApontamento = 0;
  let totalObjetoRequisicao = 0;
  let totalSemDestino = 0;
  let totalQuantidade = 0;

  for (const row of dados) {
    const custo = row.custoMaterial || 0;
    const qtde = row.quantidade || 0;
    const via = viaMaterial(row);
    const objetoCusto = objetoDestinoMaterial(row);
    const eqKey = `${row.anomes}|${row.codEquipamento}`;
    const custoEq = totalPorEq.get(eqKey) || 0;
    const percentualEnvio = custoEq > 0 ? custo / custoEq : 0;

    total += custo;
    totalQuantidade += qtde;
    if (via === 'apontamento') totalApontamento += custo;
    else if (via === 'objeto-requisicao') totalObjetoRequisicao += custo;
    else totalSemDestino += custo;

    const item = {
      anomes: row.anomes,
      nrRequisicao: row.nrRequisicao,
      codEquipamento: row.codEquipamento,
      codMaterial: row.codMaterial,
      descricaoMaterial: row.descricaoMaterial,
      quantidade: qtde,
      qtdItens: row.qtdItens || 0,
      custoEnviado: custo,
      percentualEnvio,
      via,
      atividade: row.atividade,
      codOperacaoAgricola: row.codOperacaoAgricola,
      objetoCusto,
      descricaoObjeto: row.descricaoObjeto,
      objetoCustoOperacao: row.objetoCustoOperacao,
      objetoCustoRequisicao: row.objetoCustoRequisicao,
      descricaoObjetoRequisicao: row.descricaoObjetoRequisicao,
      codFazenda: row.codFazenda,
      codTalhao: row.codTalhao,
    };
    fluxo.push(item);

    const destKey = [
      row.anomes,
      objetoCusto,
      row.codOperacaoAgricola,
      row.codFazenda,
      row.codTalhao,
      via,
    ].join('|');
    const dest = destinoMap.get(destKey) || {
      anomes: row.anomes,
      via,
      objetoCusto,
      descricaoObjeto: row.descricaoObjeto,
      codOperacaoAgricola: row.codOperacaoAgricola,
      codFazenda: row.codFazenda,
      codTalhao: row.codTalhao,
      quantidade: 0,
      qtdItens: 0,
      qtdEquipamentos: new Set(),
      custoEnviado: 0,
    };
    dest.quantidade += qtde;
    dest.qtdItens += row.qtdItens || 0;
    dest.custoEnviado += custo;
    if (row.codEquipamento != null) dest.qtdEquipamentos.add(row.codEquipamento);
    if (!dest.descricaoObjeto && row.descricaoObjeto) {
      dest.descricaoObjeto = row.descricaoObjeto;
    }
    destinoMap.set(destKey, dest);

    const matKey = [
      row.nrRequisicao,
      row.codEquipamento,
      row.codMaterial,
      row.objetoCustoRequisicao,
      objetoCusto,
      row.atividade,
    ].join('|');
    const mat = materialMap.get(matKey) || {
      nrRequisicao: row.nrRequisicao,
      codEquipamento: row.codEquipamento,
      codMaterial: row.codMaterial,
      descricaoMaterial: row.descricaoMaterial,
      objetoCustoRequisicao: row.objetoCustoRequisicao,
      descricaoObjetoRequisicao: row.descricaoObjetoRequisicao,
      objetoCusto,
      descricaoObjeto: row.descricaoObjeto,
      atividade: row.atividade,
      via,
      quantidade: 0,
      qtdItens: 0,
      custoEnviado: 0,
      custoApontamento: 0,
      custoObjetoRequisicao: 0,
      custoSemDestino: 0,
    };
    mat.quantidade += qtde;
    mat.qtdItens += row.qtdItens || 0;
    mat.custoEnviado += custo;
    if (via === 'apontamento') mat.custoApontamento += custo;
    else if (via === 'objeto-requisicao') mat.custoObjetoRequisicao += custo;
    else mat.custoSemDestino += custo;
    if (!mat.descricaoObjeto && row.descricaoObjeto) {
      mat.descricaoObjeto = row.descricaoObjeto;
    }
    if (!mat.descricaoObjetoRequisicao && row.descricaoObjetoRequisicao) {
      mat.descricaoObjetoRequisicao = row.descricaoObjetoRequisicao;
    }
    materialMap.set(matKey, mat);

    const mes = mesMap.get(row.anomes) || {
      anomes: row.anomes,
      custoTotal: 0,
      custoApontamento: 0,
      custoObjetoRequisicao: 0,
      custoSemDestino: 0,
      qtdItens: 0,
    };
    mes.custoTotal += custo;
    mes.qtdItens += row.qtdItens || 0;
    if (via === 'apontamento') mes.custoApontamento += custo;
    else if (via === 'objeto-requisicao') mes.custoObjetoRequisicao += custo;
    else mes.custoSemDestino += custo;
    mesMap.set(row.anomes, mes);

    if (via !== 'apontamento') {
      semEnvio.push({
        ...item,
        destino:
          via === 'objeto-requisicao'
            ? `lançado no objeto da requisição (${objetoCusto})`
            : 'sem apontamento e sem objeto de custo',
        motivo: via === 'objeto-requisicao' ? 'objeto_requisicao' : 'sem_destino',
      });
    }
  }

  const destino = [...destinoMap.values()].map((d) => ({
    ...d,
    qtdEquipamentos: d.qtdEquipamentos.size,
    percentualEnvio: total > 0 ? d.custoEnviado / total : 0,
  }));
  const porMaterial = [...materialMap.values()].map((m) => ({
    ...m,
    percentualEnvio: total > 0 ? m.custoEnviado / total : 0,
  }));
  const porMes = [...mesMap.values()];

  fluxo.sort((a, b) => sortAnomesCusto(a, b));
  destino.sort((a, b) => sortAnomesCusto(a, b));
  semEnvio.sort((a, b) => sortAnomesCusto(a, b));
  porMaterial.sort((a, b) => (b.custoEnviado || 0) - (a.custoEnviado || 0));
  porMes.sort((a, b) => String(a.anomes || '').localeCompare(String(b.anomes || '')));

  return {
    filtros,
    logica: {
      origem: 'material.itensrequisicaomaterial (manutenção, fora da oficina)',
      destino:
        'último apontamento do equipamento até a data da retirada → operação / fazenda / talhão / objeto da operação',
      fallback: 'sem apontamento: objeto de custo da requisição',
      exclusoes:
        'oficina (negócio 3 / processo 1), insumo agrícola e combustível (já entram em outras bases)',
    },
    resumo: {
      totalLinhas: fluxo.length,
      totalValor: total,
      totalQuantidade,
      totalApontamento,
      totalObjetoRequisicao,
      totalSemDestino,
      qtdSemEnvio: semEnvio.length,
      qtdDestinos: destino.length,
      qtdMateriais: new Set(
        dados.map((r) => r.codMaterial).filter((v) => v != null)
      ).size,
      qtdRequisicoes: new Set(
        dados.map((r) => r.nrRequisicao).filter((v) => v != null)
      ).size,
      qtdComEquipamento: dados.filter((r) => r.codEquipamento != null).length,
      qtdSemEquipamento: dados.filter((r) => r.codEquipamento == null).length,
      totalComEquipamento: dados
        .filter((r) => r.codEquipamento != null)
        .reduce((acc, r) => acc + (r.custoMaterial || 0), 0),
      totalSemEquipamento: dados
        .filter((r) => r.codEquipamento == null)
        .reduce((acc, r) => acc + (r.custoMaterial || 0), 0),
      qtdEquipamentos: new Set(
        dados.map((r) => r.codEquipamento).filter((v) => v != null)
      ).size,
      qtdOperacoes: new Set(
        dados.map((r) => r.codOperacaoAgricola).filter((v) => v != null)
      ).size,
      qtdPeriodos: porMes.length,
    },
    porMes,
    porMaterial,
    destino,
    semEnvio,
    fluxo,
  };
}

export async function consultarMateriais(filtros = {}) {
  const result = await executeQuery(MATERIAL_SQL, bindsPeriodoData(filtros));
  const dados = (result.rows || []).map(mapMaterialRow);

  return {
    filtros,
    resumo: {
      totalLinhas: dados.length,
      totalQuantidade: dados.reduce((acc, r) => acc + (r.quantidade || 0), 0),
      totalValor: dados.reduce((acc, r) => acc + (r.valorTotal || 0), 0),
    },
    dados,
  };
}

export async function consultarBaseMateriais(filtros = {}) {
  const result = await executeQuery(MATERIAL_BASE_SQL, bindsPeriodoData(filtros));
  return (result.rows || []).map(mapMaterialBaseRow);
}
