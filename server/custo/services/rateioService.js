import { getConnection } from '../config/db.js';
import { bindsAnomes } from '../utils/oracle.js';

/**
 * Origem fixa do custo de oficina (mesma lógica da query de rateio):
 * negocio = 3, processo = 1, subprocesso = 1
 * lancamento_custo.tipo = R
 * empenho.cod_tipoempenho IN (1, 2)
 */
export const FILTRO_OFICINA = {
  negocio: 3,
  processo: 1,
  subprocesso: 1,
  tipoLancamento: 'R',
  tiposEmpenho: [1, 2],
};

const FILTRO_OBJETO_OFICINA = `
      AND EXISTS (
          SELECT 1
          FROM custo.objetocusto b
          WHERE b.negocio = 3
            AND b.processo = 1
            AND b.subprocesso = 1
            AND a.cod_objetocusto = b.cod_objetocusto
      )
`;

const FILTRO_EMPENHO_OFICINA = `
      AND EXISTS (
          SELECT 1
          FROM custo.empenho emp
          WHERE emp.cod_empenho = a.cod_empenho
            AND emp.cod_tipoempenho IN (1, 2)
      )
`;

const FILTRO_ANOMES_COL = `
      AND (:anomesInicio IS NULL OR a.anomes >= :anomesInicio)
      AND (:anomesFim IS NULL OR a.anomes <= :anomesFim)
`;

const FILTRO_ANOMES_OS = `
      AND (:anomesInicio IS NULL OR TO_CHAR(dtabertura, 'YYYYMM') >= :anomesInicio)
      AND (:anomesFim IS NULL OR TO_CHAR(dtabertura, 'YYYYMM') <= :anomesFim)
`;

const RATEIO_SQL = `
WITH custos AS (
    SELECT
        a.anomes,
        a.cod_objetocusto,
        a.cod_empenho,
        SUM(a.valor) AS valor
    FROM custo.lancamento_custo a
    WHERE a.tipo = 'R'
${FILTRO_OBJETO_OFICINA}
${FILTRO_EMPENHO_OFICINA}
${FILTRO_ANOMES_COL}
    GROUP BY
        a.anomes,
        a.cod_objetocusto,
        a.cod_empenho
),

ordens AS (
    SELECT
        cod_equipamento,
        TO_CHAR(dtabertura, 'YYYYMM') AS anomes,
        SUM(
            (NVL(dtencerramento, SYSDATE) - dtabertura) * 24
        ) AS horas_os
    FROM automotivo.ordemservico
    WHERE dtencerramento IS NOT NULL
${FILTRO_ANOMES_OS}
    GROUP BY
        cod_equipamento,
        TO_CHAR(dtabertura, 'YYYYMM')
),

horas_total AS (
    SELECT
        anomes,
        SUM(horas_os) AS horas_total
    FROM ordens
    GROUP BY anomes
)

SELECT
    c.anomes,
    c.cod_objetocusto,
    c.cod_empenho,
    o.cod_equipamento,
    o.horas_os,
    ht.horas_total,
    o.horas_os / ht.horas_total AS percentual_rateio,
    c.valor * (o.horas_os / ht.horas_total) AS custo_rateado
FROM custos c
INNER JOIN ordens o
    ON o.anomes = c.anomes
INNER JOIN horas_total ht
    ON ht.anomes = o.anomes
WHERE ht.horas_total > 0
  AND (:equipamento IS NULL OR o.cod_equipamento = :equipamento)
ORDER BY
    c.anomes,
    c.cod_objetocusto,
    c.cod_empenho,
    o.cod_equipamento
`;

const RESUMO_SQL = `
WITH custos AS (
    SELECT
        a.anomes,
        a.cod_objetocusto,
        a.cod_empenho,
        SUM(a.valor) AS valor
    FROM custo.lancamento_custo a
    WHERE a.tipo = 'R'
${FILTRO_OBJETO_OFICINA}
${FILTRO_EMPENHO_OFICINA}
${FILTRO_ANOMES_COL}
    GROUP BY
        a.anomes,
        a.cod_objetocusto,
        a.cod_empenho
),

ordens AS (
    SELECT
        cod_equipamento,
        TO_CHAR(dtabertura, 'YYYYMM') AS anomes,
        SUM(
            (NVL(dtencerramento, SYSDATE) - dtabertura) * 24
        ) AS horas_os
    FROM automotivo.ordemservico
    WHERE dtencerramento IS NOT NULL
${FILTRO_ANOMES_OS}
    GROUP BY
        cod_equipamento,
        TO_CHAR(dtabertura, 'YYYYMM')
),

horas_total AS (
    SELECT
        anomes,
        SUM(horas_os) AS horas_total
    FROM ordens
    GROUP BY anomes
),

rateio AS (
    SELECT
        c.anomes,
        o.cod_equipamento,
        o.horas_os,
        ht.horas_total,
        o.horas_os / ht.horas_total AS percentual_rateio,
        c.valor * (o.horas_os / ht.horas_total) AS custo_rateado
    FROM custos c
    INNER JOIN ordens o ON o.anomes = c.anomes
    INNER JOIN horas_total ht ON ht.anomes = o.anomes
    WHERE ht.horas_total > 0
      AND (:equipamento IS NULL OR o.cod_equipamento = :equipamento)
)

SELECT
    anomes,
    cod_equipamento,
    MAX(horas_os) AS horas_os,
    MAX(horas_total) AS horas_total,
    MAX(percentual_rateio) AS percentual_rateio,
    SUM(custo_rateado) AS custo_rateado
FROM rateio
GROUP BY
    anomes,
    cod_equipamento
ORDER BY
    anomes,
    custo_rateado DESC
`;

function toNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapRateioRow(row) {
  return {
    anomes: row.ANOMES != null ? String(row.ANOMES) : null,
    codObjetoCusto: row.COD_OBJETOCUSTO,
    codEmpenho: row.COD_EMPENHO,
    codEquipamento: row.COD_EQUIPAMENTO,
    horasOs: toNumber(row.HORAS_OS),
    horasTotal: toNumber(row.HORAS_TOTAL),
    percentualRateio: toNumber(row.PERCENTUAL_RATEIO),
    custoRateado: toNumber(row.CUSTO_RATEADO),
  };
}

function mapResumoRow(row) {
  return {
    anomes: row.ANOMES != null ? String(row.ANOMES) : null,
    codEquipamento: row.COD_EQUIPAMENTO,
    horasOs: toNumber(row.HORAS_OS),
    horasTotal: toNumber(row.HORAS_TOTAL),
    percentualRateio: toNumber(row.PERCENTUAL_RATEIO),
    custoRateado: toNumber(row.CUSTO_RATEADO),
  };
}

/** Binds de período/equipamento — objeto de custo da oficina é fixo no SQL. */
function buildBinds(filtros = {}) {
  const b = bindsAnomes(filtros);
  return {
    anomesInicio: b.anomesInicio,
    anomesFim: b.anomesFim,
    equipamento: b.equipamento,
  };
}

function summarize(rows) {
  const totalCustoRateado = rows.reduce(
    (acc, row) => acc + (row.custoRateado || 0),
    0
  );

  const equipamentos = new Set(
    rows.map((row) => row.codEquipamento).filter((v) => v != null)
  );

  const periodos = new Set(rows.map((row) => row.anomes).filter(Boolean));

  return {
    totalLinhas: rows.length,
    totalCustoRateado,
    qtdEquipamentos: equipamentos.size,
    qtdPeriodos: periodos.size,
  };
}

function metaFiltros(filtros = {}) {
  return {
    ...filtros,
    origemOficina: FILTRO_OFICINA,
  };
}

/** Total bruto da oficina (mesma regra do SUM(valor) do usuário). */
const ORIGEM_OFICINA_SQL = `
SELECT
    a.anomes,
    SUM(a.valor) AS valor_origem,
    COUNT(*) AS qtd_lancamentos
FROM custo.lancamento_custo a
WHERE a.tipo = 'R'
${FILTRO_OBJETO_OFICINA}
${FILTRO_EMPENHO_OFICINA}
${FILTRO_ANOMES_COL}
GROUP BY a.anomes
ORDER BY a.anomes
`;

/** Meses com custo de oficina e sem horas de OS encerrada (custo some no rateio). */
const MESES_SEM_OS_SQL = `
WITH custos AS (
    SELECT
        a.anomes,
        SUM(a.valor) AS valor_origem
    FROM custo.lancamento_custo a
    WHERE a.tipo = 'R'
${FILTRO_OBJETO_OFICINA}
${FILTRO_EMPENHO_OFICINA}
${FILTRO_ANOMES_COL}
    GROUP BY a.anomes
),
horas AS (
    SELECT
        TO_CHAR(dtabertura, 'YYYYMM') AS anomes,
        SUM((NVL(dtencerramento, SYSDATE) - dtabertura) * 24) AS horas_total
    FROM automotivo.ordemservico
    WHERE dtencerramento IS NOT NULL
${FILTRO_ANOMES_OS}
    GROUP BY TO_CHAR(dtabertura, 'YYYYMM')
)
SELECT
    c.anomes,
    c.valor_origem,
    NVL(h.horas_total, 0) AS horas_total
FROM custos c
LEFT JOIN horas h ON h.anomes = c.anomes
WHERE NVL(h.horas_total, 0) <= 0
ORDER BY c.anomes
`;

const RATEADO_POR_MES_SQL = `
WITH custos AS (
    SELECT
        a.anomes,
        a.cod_objetocusto,
        a.cod_empenho,
        SUM(a.valor) AS valor
    FROM custo.lancamento_custo a
    WHERE a.tipo = 'R'
${FILTRO_OBJETO_OFICINA}
${FILTRO_EMPENHO_OFICINA}
${FILTRO_ANOMES_COL}
    GROUP BY
        a.anomes,
        a.cod_objetocusto,
        a.cod_empenho
),
ordens AS (
    SELECT
        cod_equipamento,
        TO_CHAR(dtabertura, 'YYYYMM') AS anomes,
        SUM((NVL(dtencerramento, SYSDATE) - dtabertura) * 24) AS horas_os
    FROM automotivo.ordemservico
    WHERE dtencerramento IS NOT NULL
${FILTRO_ANOMES_OS}
    GROUP BY
        cod_equipamento,
        TO_CHAR(dtabertura, 'YYYYMM')
),
horas_total AS (
    SELECT anomes, SUM(horas_os) AS horas_total
    FROM ordens
    GROUP BY anomes
)
SELECT
    c.anomes,
    SUM(c.valor * (o.horas_os / ht.horas_total)) AS valor_rateado
FROM custos c
INNER JOIN ordens o ON o.anomes = c.anomes
INNER JOIN horas_total ht ON ht.anomes = o.anomes
WHERE ht.horas_total > 0
  AND (:equipamento IS NULL OR o.cod_equipamento = :equipamento)
GROUP BY c.anomes
ORDER BY c.anomes
`;

/**
 * Confronta SUM(valor) de lancamento_custo (oficina 3/1/1) com o total rateado
 * por horas de OS — e explica diferenças.
 */
export async function consultarReconciliacaoOficina(filtros = {}) {
  const connection = await getConnection();
  const binds = buildBinds(filtros);

  try {
    const [origemRes, rateadoMesRes, semOsRes, resumoEq] = await Promise.all([
      connection.execute(ORIGEM_OFICINA_SQL, {
        anomesInicio: binds.anomesInicio,
        anomesFim: binds.anomesFim,
      }),
      connection.execute(RATEADO_POR_MES_SQL, binds),
      connection.execute(MESES_SEM_OS_SQL, {
        anomesInicio: binds.anomesInicio,
        anomesFim: binds.anomesFim,
      }),
      connection.execute(RESUMO_SQL, binds),
    ]);

    const origemPorMes = (origemRes.rows || []).map((row) => ({
      anomes: row.ANOMES != null ? String(row.ANOMES) : null,
      valorOrigem: toNumber(row.VALOR_ORIGEM) || 0,
      qtdLancamentos: toNumber(row.QTD_LANCAMENTOS) || 0,
    }));

    const rateadoPorMesMap = new Map(
      (rateadoMesRes.rows || []).map((row) => [
        String(row.ANOMES),
        toNumber(row.VALOR_RATEADO) || 0,
      ])
    );

    const porMes = origemPorMes.map((o) => {
      const rateado = rateadoPorMesMap.get(o.anomes) || 0;
      return {
        anomes: o.anomes,
        valorOrigem: o.valorOrigem,
        valorRateado: rateado,
        diferenca: o.valorOrigem - rateado,
        qtdLancamentos: o.qtdLancamentos,
      };
    });

    // Meses que só aparecem no rateado (raro) — inclui por segurança
    for (const [anomes, rateado] of rateadoPorMesMap.entries()) {
      if (porMes.some((p) => p.anomes === anomes)) continue;
      porMes.push({
        anomes,
        valorOrigem: 0,
        valorRateado: rateado,
        diferenca: -rateado,
        qtdLancamentos: 0,
      });
    }
    porMes.sort((a, b) => String(a.anomes).localeCompare(String(b.anomes)));

    const mesesSemOs = (semOsRes.rows || []).map((row) => ({
      anomes: row.ANOMES != null ? String(row.ANOMES) : null,
      valorOrigem: toNumber(row.VALOR_ORIGEM) || 0,
      horasTotal: toNumber(row.HORAS_TOTAL) || 0,
    }));

    const destinoEquipamento = (resumoEq.rows || []).map(mapResumoRow);
    const totalOrigem = porMes.reduce((a, r) => a + r.valorOrigem, 0);
    const totalRateado = destinoEquipamento.reduce(
      (a, r) => a + (r.custoRateado || 0),
      0
    );
    const totalMesesSemOs = mesesSemOs.reduce((a, r) => a + r.valorOrigem, 0);
    const diferenca = totalOrigem - totalRateado;
    const temFiltroEquipamento =
      filtros.equipamento != null && String(filtros.equipamento).trim() !== '';

    // No consolidado, o KPI Oficina usa o mesmo pool rateado por OS.
    const totalNoConsolidado = totalRateado;
    const diferencaConsolidado = totalOrigem - totalNoConsolidado;

    const motivos = [];
    motivos.push({
      codigo: 'comparativo',
      texto: `Comparativo: valor correto SUM(lancamento_custo) ${totalOrigem.toFixed(2)} × no consolidado (KPI Oficina / pool rateado) ${totalNoConsolidado.toFixed(2)}.`,
    });

    if (Math.abs(diferencaConsolidado) < 0.05) {
      motivos.push({
        codigo: 'bate',
        texto: 'Consolidado e SUM de origem batem (diferença < R$ 0,05). O consolidado usa o pool rateado por horas de OS, que neste período fecha com o lançamento.',
      });
    } else {
      if (mesesSemOs.length) {
        motivos.push({
          codigo: 'meses_sem_os',
          texto: `${mesesSemOs.length} mês(es) com lançamento de oficina e sem OS encerrada — esse valor (${totalMesesSemOs.toFixed(2)}) entra no SUM correto mas não no consolidado (JOIN exige horas_total > 0).`,
          valor: totalMesesSemOs,
        });
      }
      if (temFiltroEquipamento) {
        motivos.push({
          codigo: 'filtro_equipamento',
          texto: `Filtro de equipamento (${filtros.equipamento}) reduz o consolidado/rateado; a origem continua sendo o pool inteiro da oficina.`,
        });
      }
      const explicado = totalMesesSemOs;
      const resto = diferencaConsolidado - (temFiltroEquipamento ? 0 : explicado);
      if (!temFiltroEquipamento && Math.abs(resto) >= 0.05) {
        motivos.push({
          codigo: 'outra',
          texto: `Diferença residual ≈ ${resto.toFixed(2)} após meses sem OS (arredondamento ou inconsistência de horas).`,
          valor: resto,
        });
      }
      if (temFiltroEquipamento && Math.abs(diferencaConsolidado) >= 0.05) {
        motivos.push({
          codigo: 'parcial',
          texto:
            'Com equipamento filtrado, o consolidado mostra só esse equipamento — não o SUM total da origem.',
        });
      }
    }
    motivos.push({
      codigo: 'filtro_objeto',
      texto: 'Filtro de negócio/processo/subprocesso/atividade no formulário não altera o pool de oficina (origem fixa 3/1/1). Se a coluna Oficina na tabela somar menos, é só a fatia das linhas filtradas — o KPI Oficina do consolidado usa o pool completo.',
    });

    return {
      filtros: metaFiltros(filtros),
      logica: {
        origem:
          "SUM(valor) FROM custo.lancamento_custo WHERE tipo='R' AND empenho.cod_tipoempenho IN (1,2) AND objetocusto negocio=3 processo=1 subprocesso=1",
        consolidado:
          'KPI Oficina do consolidado = mesmo pool rateado por horas OS (custo_rateado)',
        destino:
          'custo_rateado = valor × (horas_os / horas_total) por equipamento (OS encerrada)',
        porqueNaoBate:
          'Meses com custo e sem OS, ou filtro de equipamento. Filtro de objeto não deve reduzir o KPI Oficina.',
      },
      resumo: {
        totalOrigem,
        totalNoConsolidado,
        totalRateado,
        diferenca: diferencaConsolidado,
        diferencaRateado: diferenca,
        totalMesesSemOs,
        qtdMesesSemOs: mesesSemOs.length,
        qtdEquipamentos: new Set(
          destinoEquipamento.map((r) => r.codEquipamento).filter(Boolean)
        ).size,
        bate: Math.abs(diferencaConsolidado) < 0.05 && !temFiltroEquipamento,
        temFiltroEquipamento,
      },
      motivos,
      porMes,
      mesesSemOs,
      destinoEquipamento,
    };
  } finally {
    await connection.close();
  }
}

export async function consultarRateio(filtros = {}) {
  const connection = await getConnection();

  try {
    const result = await connection.execute(RATEIO_SQL, buildBinds(filtros));
    const dados = (result.rows || []).map(mapRateioRow);

    return {
      filtros: metaFiltros(filtros),
      logica: {
        origem:
          'lancamento_custo tipo R · empenho tipo 1 ou 2 · objetocusto negocio=3 processo=1 subprocesso=1',
        rateio: 'custo_rateado = valor × (horas_os / horas_total)',
      },
      resumo: summarize(dados),
      dados,
    };
  } finally {
    await connection.close();
  }
}

export async function consultarResumoPorEquipamento(filtros = {}) {
  const connection = await getConnection();

  try {
    const result = await connection.execute(RESUMO_SQL, buildBinds(filtros));
    const dados = (result.rows || []).map(mapResumoRow);

    return {
      filtros: metaFiltros(filtros),
      logica: {
        origem:
          'lancamento_custo tipo R · empenho tipo 1 ou 2 · objetocusto negocio=3 processo=1 subprocesso=1',
        rateio: 'custo_rateado = valor × (horas_os / horas_total)',
      },
      resumo: summarize(dados),
      dados,
    };
  } finally {
    await connection.close();
  }
}
