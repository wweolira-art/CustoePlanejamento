import { getConnection } from '../config/db.js';
import { bindsAnomes } from '../utils/oracle.js';
import { fatiarCustoParaClientes } from './transporteOficinaService.js';
import {
  carregarMapasMecanizacaoCliente,
  clientesDoEquipamentoMecanizacao,
} from './mecanizacaoOficinaService.js';

/**
 * Origem do custo de mecanização (mesma regra da oficina, objeto 3/1/3):
 * lancamento_custo.tipo = R
 * empenho.cod_tipoempenho IN (1, 2)
 * Rateio por horas OS somente entre equipamentos vigentes em 3/1/3.
 */
export const FILTRO_MECANIZACAO_LANC = {
  negocio: 3,
  processo: 1,
  subprocesso: 3,
  tipoLancamento: 'R',
  tiposEmpenho: [1, 2],
};

const FILTRO_OBJETO_MECANIZACAO = `
      AND EXISTS (
          SELECT 1
          FROM custo.objetocusto b
          WHERE b.negocio = 3
            AND b.processo = 1
            AND b.subprocesso = 3
            AND a.cod_objetocusto = b.cod_objetocusto
      )
`;

const FILTRO_EMPENHO_MECANIZACAO = `
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
      AND (:anomesInicio IS NULL OR TO_CHAR(os.dtabertura, 'YYYYMM') >= :anomesInicio)
      AND (:anomesFim IS NULL OR TO_CHAR(os.dtabertura, 'YYYYMM') <= :anomesFim)
`;

const FILTRO_OS_EQUIP_MECANIZACAO = `
      AND EXISTS (
          SELECT 1
          FROM automotivo.historicoequipamentoobcusto h
          WHERE h.cod_equipamento = os.cod_equipamento
            AND h.data_final IS NULL
            AND EXISTS (
                SELECT 1
                FROM custo.objetocusto b
                WHERE b.negocio = 3
                  AND b.processo = 1
                  AND b.subprocesso = 3
                  AND h.cod_objetocusto = b.cod_objetocusto
            )
      )
`;

const RESUMO_MECANIZACAO_SQL = `
WITH custos AS (
    SELECT
        a.anomes,
        a.cod_objetocusto,
        a.cod_empenho,
        SUM(a.valor) AS valor
    FROM custo.lancamento_custo a
    WHERE a.tipo = 'R'
${FILTRO_OBJETO_MECANIZACAO}
${FILTRO_EMPENHO_MECANIZACAO}
${FILTRO_ANOMES_COL}
    GROUP BY
        a.anomes,
        a.cod_objetocusto,
        a.cod_empenho
),

ordens AS (
    SELECT
        os.cod_equipamento,
        TO_CHAR(os.dtabertura, 'YYYYMM') AS anomes,
        SUM(
            (NVL(os.dtencerramento, SYSDATE) - os.dtabertura) * 24
        ) AS horas_os
    FROM automotivo.ordemservico os
    WHERE os.dtencerramento IS NOT NULL
${FILTRO_ANOMES_OS}
${FILTRO_OS_EQUIP_MECANIZACAO}
    GROUP BY
        os.cod_equipamento,
        TO_CHAR(os.dtabertura, 'YYYYMM')
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

const ORIGEM_MECANIZACAO_SQL = `
SELECT
    a.anomes,
    SUM(a.valor) AS valor_origem,
    COUNT(*) AS qtd_lancamentos
FROM custo.lancamento_custo a
WHERE a.tipo = 'R'
${FILTRO_OBJETO_MECANIZACAO}
${FILTRO_EMPENHO_MECANIZACAO}
${FILTRO_ANOMES_COL}
GROUP BY a.anomes
ORDER BY a.anomes
`;

const MESES_SEM_OS_MECANIZACAO_SQL = `
WITH custos AS (
    SELECT
        a.anomes,
        SUM(a.valor) AS valor_origem
    FROM custo.lancamento_custo a
    WHERE a.tipo = 'R'
${FILTRO_OBJETO_MECANIZACAO}
${FILTRO_EMPENHO_MECANIZACAO}
${FILTRO_ANOMES_COL}
    GROUP BY a.anomes
),
horas AS (
    SELECT
        TO_CHAR(os.dtabertura, 'YYYYMM') AS anomes,
        SUM((NVL(os.dtencerramento, SYSDATE) - os.dtabertura) * 24) AS horas_total
    FROM automotivo.ordemservico os
    WHERE os.dtencerramento IS NOT NULL
${FILTRO_ANOMES_OS}
${FILTRO_OS_EQUIP_MECANIZACAO}
    GROUP BY TO_CHAR(os.dtabertura, 'YYYYMM')
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

const RATEADO_POR_MES_MECANIZACAO_SQL = `
WITH custos AS (
    SELECT
        a.anomes,
        a.cod_objetocusto,
        a.cod_empenho,
        SUM(a.valor) AS valor
    FROM custo.lancamento_custo a
    WHERE a.tipo = 'R'
${FILTRO_OBJETO_MECANIZACAO}
${FILTRO_EMPENHO_MECANIZACAO}
${FILTRO_ANOMES_COL}
    GROUP BY
        a.anomes,
        a.cod_objetocusto,
        a.cod_empenho
),
ordens AS (
    SELECT
        os.cod_equipamento,
        TO_CHAR(os.dtabertura, 'YYYYMM') AS anomes,
        SUM((NVL(os.dtencerramento, SYSDATE) - os.dtabertura) * 24) AS horas_os
    FROM automotivo.ordemservico os
    WHERE os.dtencerramento IS NOT NULL
${FILTRO_ANOMES_OS}
${FILTRO_OS_EQUIP_MECANIZACAO}
    GROUP BY
        os.cod_equipamento,
        TO_CHAR(os.dtabertura, 'YYYYMM')
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

function toNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
    origemMecanizacao: FILTRO_MECANIZACAO_LANC,
  };
}

export async function consultarResumoPorEquipamentoMecanizacao(filtros = {}) {
  const connection = await getConnection();
  try {
    const result = await connection.execute(
      RESUMO_MECANIZACAO_SQL,
      buildBinds(filtros)
    );
    const dados = (result.rows || []).map(mapResumoRow);
    return {
      filtros: metaFiltros(filtros),
      logica: {
        origem:
          'lancamento_custo tipo R · empenho tipo 1 ou 2 · objetocusto negocio=3 processo=1 subprocesso=3',
        rateio:
          'custo_rateado = valor × (horas_os / horas_total) só entre equipamentos vigentes em 3/1/3',
        destino:
          'cada fatia do equipamento vai aos objetos clientes (prestador / unidadeobjetocusto)',
      },
      resumo: summarize(dados),
      dados,
    };
  } finally {
    await connection.close();
  }
}

export async function consultarReconciliacaoMecanizacao(filtros = {}) {
  const connection = await getConnection();
  const binds = buildBinds(filtros);

  try {
    const origemRes = await connection.execute(ORIGEM_MECANIZACAO_SQL, {
      anomesInicio: binds.anomesInicio,
      anomesFim: binds.anomesFim,
    });
    const rateadoMesRes = await connection.execute(
      RATEADO_POR_MES_MECANIZACAO_SQL,
      binds
    );
    const semOsRes = await connection.execute(MESES_SEM_OS_MECANIZACAO_SQL, {
      anomesInicio: binds.anomesInicio,
      anomesFim: binds.anomesFim,
    });
    const resumoEq = await connection.execute(RESUMO_MECANIZACAO_SQL, binds);

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
    const totalNoConsolidado = totalRateado;
    const diferencaConsolidado = totalOrigem - totalNoConsolidado;

    const motivos = [];
    motivos.push({
      codigo: 'comparativo',
      texto: `Comparativo: SUM(lancamento_custo 3/1/3) ${totalOrigem.toFixed(2)} × pool rateado por horas OS de equipamentos de mecanização ${totalNoConsolidado.toFixed(2)}.`,
    });

    if (Math.abs(diferencaConsolidado) < 0.05) {
      motivos.push({
        codigo: 'bate',
        texto: 'Origem e rateio batem (diferença < R$ 0,05). O consolidado envia esse pool aos objetos clientes (prestador/unidade). Equipamento sem cliente permanece no objeto 3/1/3.',
      });
    } else {
      if (mesesSemOs.length) {
        motivos.push({
          codigo: 'meses_sem_os',
          texto: `${mesesSemOs.length} mês(es) com lançamento de mecanização e sem OS encerrada em equipamento 3/1/3 — esse valor (${totalMesesSemOs.toFixed(2)}) entra no SUM mas não no rateio.`,
          valor: totalMesesSemOs,
        });
      }
      if (temFiltroEquipamento) {
        motivos.push({
          codigo: 'filtro_equipamento',
          texto: `Filtro de equipamento (${filtros.equipamento}) reduz o rateado; a origem continua sendo o pool inteiro de 3/1/3.`,
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
    }

    return {
      filtros: metaFiltros(filtros),
      logica: {
        origem:
          "SUM(valor) FROM custo.lancamento_custo WHERE tipo='R' AND empenho.cod_tipoempenho IN (1,2) AND objetocusto negocio=3 processo=1 subprocesso=3",
        consolidado:
          'KPI Mecanização = mesmo pool rateado por horas OS só entre equipamentos vigentes em 3/1/3, depois fatiado aos objetos clientes',
        destino:
          'custo_rateado = valor × (horas_os / horas_total_mecanizacao) → prestador/unidadeobjetocusto',
        porqueNaoBate:
          'Meses com custo e sem OS de equipamento de mecanização, ou filtro de equipamento.',
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

/**
 * Equipamento (já rateado por OS) → objetos clientes.
 * Não passa por apontamento.
 */
export async function consultarDiagnosticoFluxoMecanizacao(filtros = {}) {
  const periodo = {
    anomes: filtros.anomes ?? null,
    anomesInicio: filtros.anomesInicio ?? null,
    anomesFim: filtros.anomesFim ?? null,
    equipamento: filtros.equipamento ?? null,
  };
  const custoEquipamento =
    await consultarResumoPorEquipamentoMecanizacao(periodo);
  const mapas = await carregarMapasMecanizacaoCliente();

  const destinos = [];
  const semCliente = [];
  let totalEnviado = 0;
  let totalSemCliente = 0;

  for (const eq of custoEquipamento.dados) {
    const custoRecebido = eq.custoRateado || 0;
    if (Math.abs(custoRecebido) < 0.005) continue;

    const { objMecanizacao, clientes } = clientesDoEquipamentoMecanizacao(
      eq.codEquipamento,
      mapas
    );
    const partes = fatiarCustoParaClientes(custoRecebido, clientes);

    if (objMecanizacao != null && partes.length) {
      for (const parte of partes) {
        totalEnviado += parte.valor;
        destinos.push({
          anomes: eq.anomes != null ? String(eq.anomes) : null,
          codEquipamento: eq.codEquipamento,
          objetoCustoMecanizacao: objMecanizacao,
          objetoCustoCliente: parte.objetoCliente,
          horasOs: eq.horasOs,
          percentualEnvio: parte.percentual,
          custoEnviado: parte.valor,
          origem: 'lancamento-mecanizacao',
          via: 'mecanizacao-cliente',
        });
      }
      continue;
    }

    totalSemCliente += custoRecebido;
    semCliente.push({
      anomes: eq.anomes != null ? String(eq.anomes) : null,
      codEquipamento: eq.codEquipamento,
      horasOs: eq.horasOs,
      percentualRateio: eq.percentualRateio,
      custoRecebido,
      objetoCustoMecanizacao: objMecanizacao ?? null,
      destino:
        objMecanizacao != null
          ? 'mecanização sem objeto cliente (prestador/unidade)'
          : 'equipamento sem objeto de mecanização vigente',
    });
  }

  destinos.sort((a, b) => {
    const c = String(a.anomes).localeCompare(String(b.anomes));
    if (c !== 0) return c;
    return (b.custoEnviado || 0) - (a.custoEnviado || 0);
  });
  semCliente.sort((a, b) => (b.custoRecebido || 0) - (a.custoRecebido || 0));

  return {
    resumo: {
      totalEnviado,
      totalSemCliente,
      qtdDestinos: destinos.length,
      qtdSemCliente: semCliente.length,
      qtdEquipamentos: new Set(
        custoEquipamento.dados
          .map((d) => d.codEquipamento)
          .filter((v) => v != null)
      ).size,
    },
    destinos,
    semCliente,
  };
}
