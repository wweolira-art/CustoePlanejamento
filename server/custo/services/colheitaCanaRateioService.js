/**
 * Rateio dia a dia para tratores de colheita de cana (objeto 116).
 *
 * Elegibilidade: só equipamentos cujo tipo vigente é trator
 * (cod_tipoequipamento IN 12, 93, 64, 6 em historico_tipoequipamento).
 * Demais máquinas da entrada cana NÃO entram no rateio 116 (mantêm path normal).
 *
 * Regra (carry-forward):
 * - Dia com entrada cana máquina (cod_equipamento trator) → estado = colheita cana (116)
 * - Dia com apontamento agrícola de outra operação → estado = objeto dessa operação
 * - Dia sem informação nova → herda o estado do dia anterior
 * - Custos do dia (combustível diário; oficina mensal proporcional ao km/hs do dia)
 *   vão para o objeto ativo naquele dia.
 */

import { listarEntradaCanaMaquina } from './entradaCanaMaquinaService.js';
import { getConnection } from '../config/db.js';

export const OBJETO_COLHEITA_CANA = 116;
/** Tipos vigentes = tratores elegíveis ao objeto 116 */
export const TIPOS_TRATOR_COLHEITA = [12, 93, 64, 6];
const LOOKBACK_DIAS = 90;

const TRATORES_COLHEITA_SQL = `
SELECT
    cod_equipamento,
    cod_tipoequipamento
FROM automotivo.historico_tipoequipamento
WHERE data_fim IS NULL
  AND cod_tipoequipamento IN (${TIPOS_TRATOR_COLHEITA.join(', ')})
`;

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function anomesParaDataInicio(anomes) {
  const s = String(anomes);
  if (!/^\d{6}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-01`;
}

function anomesParaDataFim(anomes) {
  const s = String(anomes);
  if (!/^\d{6}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${String(last).padStart(2, '0')}`;
}

function addDays(isoDia, delta) {
  const [y, m, d] = isoDia.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function eachDay(dataInicio, dataFim) {
  const out = [];
  let cur = dataInicio;
  while (cur <= dataFim) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function diaFromIso(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function periodoFromFiltros(filtros = {}) {
  const ini = filtros.anomesInicio || filtros.anomes;
  const fim = filtros.anomesFim || filtros.anomes || ini;
  if (!ini) return null;
  const dataInicio = anomesParaDataInicio(ini);
  const dataFim = anomesParaDataFim(fim);
  if (!dataInicio || !dataFim) return null;
  return {
    dataInicio,
    dataFim,
    dataLookback: addDays(dataInicio, -LOOKBACK_DIAS),
    anomesInicio: String(ini),
    anomesFim: String(fim),
  };
}

const CUSTOS_DIARIOS_SQL = `
WITH histTipoEquip AS (
    SELECT
        cod_equipamento,
        data_inicio,
        NVL(data_fim, SYSDATE) AS data_fim,
        cod_tipoequipamento
    FROM automotivo.historico_tipoequipamento
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
        a.cod_equipamento,
        a.cod_material,
        TRUNC(a.dtabastecimento) AS dia,
        a.qtdelitros AS qtde_litros,
        a.kmhs_rodados,
        (a.qtdelitros * cm.custo_medio) AS valor_total
    FROM automotivo.abastecimento a
    LEFT JOIN custoMedioMaterial cm
        ON cm.cod_grupoempresa = a.cod_grupoempresa
        AND cm.cod_material = a.cod_material
        AND cm.ano = EXTRACT(YEAR FROM a.dtabastecimento)
        AND cm.mes = EXTRACT(MONTH FROM a.dtabastecimento)
    WHERE TRUNC(a.dtabastecimento) BETWEEN TO_DATE(:dataInicio, 'YYYY-MM-DD')
                                      AND TO_DATE(:dataFim, 'YYYY-MM-DD')
      AND (
          :equipamentosCsv IS NULL
          OR INSTR(',' || :equipamentosCsv || ',', ',' || TO_CHAR(a.cod_equipamento) || ',') > 0
      )

    UNION ALL

    SELECT
        a.cod_grupoempresa,
        a.cod_equipamento,
        a.cod_material,
        TRUNC(a.data) AS dia,
        a.qtde_litros AS qtde_litros,
        a.kmhs_rodados,
        (a.qtde_litros * cm.custo_medio) AS valor_total
    FROM posto.abastecimento a
    LEFT JOIN custoMedioMaterial cm
        ON cm.cod_grupoempresa = a.cod_grupoempresa
        AND cm.cod_material = a.cod_material
        AND cm.ano = EXTRACT(YEAR FROM a.data)
        AND cm.mes = EXTRACT(MONTH FROM a.data)
    WHERE TRUNC(a.data) BETWEEN TO_DATE(:dataInicio, 'YYYY-MM-DD')
                            AND TO_DATE(:dataFim, 'YYYY-MM-DD')
      AND (
          :equipamentosCsv IS NULL
          OR INSTR(',' || :equipamentosCsv || ',', ',' || TO_CHAR(a.cod_equipamento) || ',') > 0
      )
)
SELECT
    TO_CHAR(dia, 'YYYY-MM-DD') AS dia,
    cod_equipamento,
    SUM(NVL(kmhs_rodados, 0)) AS kmhs_rodados,
    SUM(NVL(qtde_litros, 0)) AS qtde_litros,
    SUM(NVL(valor_total, 0)) AS valor_abastecimento
FROM abastecimentos
GROUP BY
    dia,
    cod_equipamento
ORDER BY
    dia,
    cod_equipamento
`;

const APONTAMENTOS_DIARIOS_SQL = `
SELECT
    TO_CHAR(TRUNC(b.dt_apontamento), 'YYYY-MM-DD') AS dia,
    b.cod_equipamento,
    b.cod_operacaoagricola,
    d.cod_objetocusto AS objetocustooperacao
FROM automotivo.itens_apontamento b
LEFT JOIN (
    SELECT *
    FROM rh.operacaoobjetocusto
    WHERE data_termino IS NULL
) d ON b.cod_operacaoagricola = d.cod_operacaoagricola
WHERE TRUNC(b.dt_apontamento) BETWEEN TO_DATE(:dataInicio, 'YYYY-MM-DD')
                                  AND TO_DATE(:dataFim, 'YYYY-MM-DD')
  AND (
      :equipamentosCsv IS NULL
      OR INSTR(',' || :equipamentosCsv || ',', ',' || TO_CHAR(b.cod_equipamento) || ',') > 0
  )
ORDER BY
    b.dt_apontamento,
    b.cod_equipamento
`;

/**
 * Equipamentos com tipo vigente de trator (12, 93, 64, 6).
 * @returns {Promise<Set<number>>}
 */
export async function carregarEquipamentosTratores() {
  const connection = await getConnection();
  try {
    const result = await connection.execute(TRATORES_COLHEITA_SQL);
    const set = new Set();
    for (const row of result.rows || []) {
      const eq = toNumber(row.COD_EQUIPAMENTO);
      if (eq != null) set.add(eq);
    }
    return set;
  } finally {
    await connection.close();
  }
}

async function carregarCustosDiarios(dataInicio, dataFim, equipamentos) {
  if (!equipamentos.length) return [];
  const connection = await getConnection();
  try {
    const result = await connection.execute(CUSTOS_DIARIOS_SQL, {
      dataInicio,
      dataFim,
      equipamentosCsv: equipamentos.join(','),
    });
    return (result.rows || []).map((row) => ({
      dia: row.DIA != null ? String(row.DIA).slice(0, 10) : null,
      codEquipamento: toNumber(row.COD_EQUIPAMENTO),
      kmhsRodados: toNumber(row.KMHS_RODADOS) || 0,
      qtdeLitros: toNumber(row.QTDE_LITROS) || 0,
      valorAbastecimento: toNumber(row.VALOR_ABASTECIMENTO) || 0,
    }));
  } finally {
    await connection.close();
  }
}

async function carregarApontamentosDiarios(dataInicio, dataFim, equipamentos) {
  if (!equipamentos.length) return [];
  const connection = await getConnection();
  try {
    const result = await connection.execute(APONTAMENTOS_DIARIOS_SQL, {
      dataInicio,
      dataFim,
      equipamentosCsv: equipamentos.join(','),
    });
    return (result.rows || []).map((row) => ({
      dia: row.DIA != null ? String(row.DIA).slice(0, 10) : null,
      codEquipamento: toNumber(row.COD_EQUIPAMENTO),
      codOperacaoAgricola: toNumber(row.COD_OPERACAOAGRICOLA),
      objetoCusto: toNumber(row.OBJETOCUSTOOPERACAO),
    }));
  } finally {
    await connection.close();
  }
}

/**
 * Eventos de estado por equipamento/dia.
 * Ordem no mesmo dia: cana (116) depois apontamento (apontamento vence).
 */
function montarCalendarioEstados({
  dataLookback,
  dataFim,
  diasCana,
  apontamentos,
}) {
  /** @type {Map<number, Map<string, { objetoCusto: number, fonte: string, codOperacaoAgricola?: number|null }>>} */
  const eventosPorEq = new Map();

  function addEvento(eq, dia, payload) {
    if (eq == null || !dia) return;
    if (!eventosPorEq.has(eq)) eventosPorEq.set(eq, new Map());
    eventosPorEq.get(eq).set(dia, payload);
  }

  for (const e of diasCana) {
    addEvento(e.codEquipamento, e.dia, {
      objetoCusto: OBJETO_COLHEITA_CANA,
      fonte: 'entrada-cana-maquina',
      codOperacaoAgricola: null,
    });
  }
  for (const a of apontamentos) {
    if (a.objetoCusto == null) continue;
    // Apontamento no mesmo dia sobrescreve cana (ex.: herbicida)
    addEvento(a.codEquipamento, a.dia, {
      objetoCusto: a.objetoCusto,
      fonte: 'apontamento',
      codOperacaoAgricola: a.codOperacaoAgricola,
    });
  }

  /** @type {Map<string, { objetoCusto: number|null, fonte: string|null, codOperacaoAgricola: number|null }>} */
  const estadoPorEqDia = new Map();
  const dias = eachDay(dataLookback, dataFim);

  for (const [eq, eventos] of eventosPorEq.entries()) {
    let estado = null;
    let fonte = null;
    let codOp = null;
    for (const dia of dias) {
      if (eventos.has(dia)) {
        const ev = eventos.get(dia);
        estado = ev.objetoCusto;
        fonte = ev.fonte;
        codOp = ev.codOperacaoAgricola ?? null;
      }
      estadoPorEqDia.set(`${eq}|${dia}`, {
        objetoCusto: estado,
        fonte: estado == null ? null : fonte === 'apontamento' && !eventos.has(dia) ? 'carry-forward' : eventos.has(dia) ? fonte : 'carry-forward',
        codOperacaoAgricola: estado == null ? null : codOp,
      });
      // Corrige fonte carry-forward quando herda
      if (!eventos.has(dia) && estado != null) {
        estadoPorEqDia.set(`${eq}|${dia}`, {
          objetoCusto: estado,
          fonte: 'carry-forward',
          codOperacaoAgricola: codOp,
        });
      }
    }
  }

  return {
    equipamentos: [...eventosPorEq.keys()],
    estadoPorEqDia,
  };
}

/**
 * Redistribui oficina (mensal) + combustível (diário) dos tratores de cana
 * conforme calendário com carry-forward → objeto ativo do dia (ex. 116).
 */
export async function aplicarRateioColheitaCana({
  dados,
  custoEquipamentoDados = [],
  filtros = {},
} = {}) {
  const periodo = periodoFromFiltros(filtros);
  if (!periodo) {
    return {
      dados,
      resumo: {
        aplicado: false,
        motivo: 'periodo_ausente',
        objetoColheitaCana: OBJETO_COLHEITA_CANA,
        qtdEquipamentos: 0,
        qtdDiasCana: 0,
        valorOficina116: 0,
        valorCombustivel116: 0,
        valorEnviado116: 0,
      },
    };
  }

  let canaPayload;
  try {
    canaPayload = await listarEntradaCanaMaquina({
      dataInicio: periodo.dataLookback,
      dataFim: periodo.dataFim,
    });
  } catch (err) {
    console.warn('[colheitaCana] falha ORDS entrada cana máquina:', err.message);
    return {
      dados,
      resumo: {
        aplicado: false,
        motivo: 'ords_indisponivel',
        erro: err.message,
        objetoColheitaCana: OBJETO_COLHEITA_CANA,
        qtdEquipamentos: 0,
        qtdDiasCana: 0,
        valorOficina116: 0,
        valorCombustivel116: 0,
        valorEnviado116: 0,
      },
    };
  }

  const diasCanaBrutos = [];
  for (const row of canaPayload.dados || []) {
    // Prefer cod_equipamento associado; senão usa o código da máquina na API
    const eq = toNumber(row.codEquipamento) ?? toNumber(row.maquina);
    const dia = diaFromIso(row.dataColheita);
    if (eq == null || !dia) continue;
    diasCanaBrutos.push({ codEquipamento: eq, dia });
  }

  if (!diasCanaBrutos.length) {
    return {
      dados,
      resumo: {
        aplicado: false,
        motivo: 'sem_entrada_cana',
        objetoColheitaCana: OBJETO_COLHEITA_CANA,
        tiposTrator: TIPOS_TRATOR_COLHEITA,
        qtdEquipamentos: 0,
        qtdEquipamentosEntradaCana: 0,
        qtdEquipamentosExcluidosNaoTrator: 0,
        qtdDiasCana: 0,
        qtdDiasCanaExcluidosNaoTrator: 0,
        valorOficina116: 0,
        valorCombustivel116: 0,
        valorEnviado116: 0,
      },
    };
  }

  let tratoresSet;
  try {
    tratoresSet = await carregarEquipamentosTratores();
  } catch (err) {
    console.warn('[colheitaCana] falha ao carregar tratores:', err.message);
    return {
      dados,
      resumo: {
        aplicado: false,
        motivo: 'tratores_indisponivel',
        erro: err.message,
        objetoColheitaCana: OBJETO_COLHEITA_CANA,
        tiposTrator: TIPOS_TRATOR_COLHEITA,
        qtdEquipamentos: 0,
        qtdEquipamentosEntradaCana: new Set(
          diasCanaBrutos.map((d) => d.codEquipamento)
        ).size,
        qtdEquipamentosExcluidosNaoTrator: 0,
        qtdDiasCana: 0,
        qtdDiasCanaExcluidosNaoTrator: 0,
        valorOficina116: 0,
        valorCombustivel116: 0,
        valorEnviado116: 0,
      },
    };
  }

  const eqsEntrada = new Set(diasCanaBrutos.map((d) => d.codEquipamento));
  const eqsExcluidos = [...eqsEntrada].filter((eq) => !tratoresSet.has(eq));
  const diasCana = diasCanaBrutos.filter((d) =>
    tratoresSet.has(d.codEquipamento)
  );
  const chaveDia = (d) => `${d.codEquipamento}|${d.dia}`;
  const qtdDiasCanaBrutos = new Set(diasCanaBrutos.map(chaveDia)).size;
  const qtdDiasCanaFiltrados = new Set(diasCana.map(chaveDia)).size;
  const qtdDiasCanaExcluidosNaoTrator =
    qtdDiasCanaBrutos - qtdDiasCanaFiltrados;

  if (!diasCana.length) {
    return {
      dados,
      resumo: {
        aplicado: false,
        motivo: 'sem_tratores_entrada_cana',
        objetoColheitaCana: OBJETO_COLHEITA_CANA,
        tiposTrator: TIPOS_TRATOR_COLHEITA,
        qtdEquipamentos: 0,
        qtdEquipamentosEntradaCana: eqsEntrada.size,
        qtdEquipamentosExcluidosNaoTrator: eqsExcluidos.length,
        qtdDiasCana: 0,
        qtdDiasCanaExcluidosNaoTrator,
        valorOficina116: 0,
        valorCombustivel116: 0,
        valorEnviado116: 0,
      },
    };
  }

  const equipamentos = [
    ...new Set(diasCana.map((d) => d.codEquipamento)),
  ].sort((a, b) => a - b);

  const [apontamentos, custosDiarios] = await Promise.all([
    carregarApontamentosDiarios(
      periodo.dataLookback,
      periodo.dataFim,
      equipamentos
    ),
    carregarCustosDiarios(periodo.dataInicio, periodo.dataFim, equipamentos),
  ]);

  const { estadoPorEqDia } = montarCalendarioEstados({
    dataLookback: periodo.dataLookback,
    dataFim: periodo.dataFim,
    diasCana,
    apontamentos,
  });

  const eqSet = new Set(equipamentos);

  // Zera oficina/combustível dos tratores de cana — serão realocados pelo calendário
  for (const row of dados) {
    const eq = toNumber(row.codEquipamento);
    if (eq == null || !eqSet.has(eq)) continue;
    row.custoOficina = 0;
    row.custoCombustivel = 0;
    row.qtdeLitros = 0;
    row.valorAbastecimento = 0;
    row.kmhsRodados = 0;
    row.semAbastecimento = true;
    if (Array.isArray(row.itens)) {
      row.itens = row.itens.filter((i) => i.tipo !== 'combustivel' && i.tipo !== 'oficina');
    }
    row.custoTotal =
      (row.custoOficina || 0) +
      (row.custoCombustivel || 0) +
      (row.custoMaterial || 0) +
      (row.custoInsumo || 0) +
      (row.custoTransporte || 0) +
      (row.custoMecanizacao || 0) +
      (row.custoServicoTerceiro || 0) +
      (row.custoFuncionario || 0);
    row.rateioColheitaCanaOrigem = true;
  }

  // Oficina mensal por equipamento → rateio pelos kmhs dos dias do mês
  const oficinaPorEqMes = new Map();
  for (const c of custoEquipamentoDados) {
    const eq = toNumber(c.codEquipamento);
    if (eq == null || !eqSet.has(eq)) continue;
    const anomes = c.anomes != null ? String(c.anomes) : null;
    if (!anomes) continue;
    oficinaPorEqMes.set(`${eq}|${anomes}`, toNumber(c.custoRateado) || 0);
  }

  /** kmhs por eq|anomes e por eq|dia */
  const kmhsMes = new Map();
  const custosPorDia = new Map();
  for (const c of custosDiarios) {
    if (c.codEquipamento == null || !c.dia) continue;
    if (c.dia < periodo.dataInicio || c.dia > periodo.dataFim) continue;
    const key = `${c.codEquipamento}|${c.dia}`;
    custosPorDia.set(key, c);
    const anomes = c.dia.slice(0, 4) + c.dia.slice(5, 7);
    const mk = `${c.codEquipamento}|${anomes}`;
    kmhsMes.set(mk, (kmhsMes.get(mk) || 0) + (c.kmhsRodados || 0));
  }

  // Dias do mês sem abastecimento mas com estado: ainda recebem fatia igual da oficina se kmhs mês = 0
  const diasComEstadoNoMes = new Map();
  for (const eq of equipamentos) {
    for (const dia of eachDay(periodo.dataInicio, periodo.dataFim)) {
      const st = estadoPorEqDia.get(`${eq}|${dia}`);
      if (!st?.objetoCusto) continue;
      const anomes = dia.slice(0, 4) + dia.slice(5, 7);
      const mk = `${eq}|${anomes}`;
      if (!diasComEstadoNoMes.has(mk)) diasComEstadoNoMes.set(mk, []);
      diasComEstadoNoMes.get(mk).push(dia);
    }
  }

  /** Agrega alocações: anomes|eq|objeto → custos */
  const aloc = new Map();

  function bump(eq, dia, objeto, patch) {
    const anomes = dia.slice(0, 4) + dia.slice(5, 7);
    const key = `${anomes}|${eq}|${objeto}`;
    if (!aloc.has(key)) {
      aloc.set(key, {
        anomes,
        codEquipamento: eq,
        objetoCustoOperacao: objeto,
        kmhsRodados: 0,
        qtdeLitros: 0,
        custoOficina: 0,
        custoCombustivel: 0,
        qtdDias: 0,
        fontes: new Set(),
      });
    }
    const a = aloc.get(key);
    a.kmhsRodados += patch.kmhsRodados || 0;
    a.qtdeLitros += patch.qtdeLitros || 0;
    a.custoOficina += patch.custoOficina || 0;
    a.custoCombustivel += patch.custoCombustivel || 0;
    if (patch.fonte) a.fontes.add(patch.fonte);
    a.qtdDias += patch.contaDia ? 1 : 0;
  }

  // Combustível diário → objeto do dia
  for (const c of custosDiarios) {
    if (c.dia < periodo.dataInicio || c.dia > periodo.dataFim) continue;
    const st = estadoPorEqDia.get(`${c.codEquipamento}|${c.dia}`);
    if (!st?.objetoCusto) continue;
    bump(c.codEquipamento, c.dia, st.objetoCusto, {
      kmhsRodados: c.kmhsRodados,
      qtdeLitros: c.qtdeLitros,
      custoCombustivel: c.valorAbastecimento,
      fonte: st.fonte,
      contaDia: true,
    });
  }

  // Oficina mensal proporcional
  for (const [mk, oficinaTotal] of oficinaPorEqMes.entries()) {
    if (Math.abs(oficinaTotal) < 0.005) continue;
    const [eqStr, anomes] = mk.split('|');
    const eq = Number(eqStr);
    const kmhsTotal = kmhsMes.get(mk) || 0;
    const diasEstado = diasComEstadoNoMes.get(mk) || [];

    if (kmhsTotal > 0) {
      for (const dia of diasEstado) {
        const c = custosPorDia.get(`${eq}|${dia}`);
        const kmhs = c?.kmhsRodados || 0;
        if (kmhs <= 0) continue;
        const st = estadoPorEqDia.get(`${eq}|${dia}`);
        if (!st?.objetoCusto) continue;
        bump(eq, dia, st.objetoCusto, {
          custoOficina: oficinaTotal * (kmhs / kmhsTotal),
          fonte: st.fonte,
        });
      }
    } else if (diasEstado.length) {
      const fatia = oficinaTotal / diasEstado.length;
      for (const dia of diasEstado) {
        const st = estadoPorEqDia.get(`${eq}|${dia}`);
        if (!st?.objetoCusto) continue;
        bump(eq, dia, st.objetoCusto, {
          custoOficina: fatia,
          fonte: st.fonte,
        });
      }
    }
  }

  let valorOficina116 = 0;
  let valorCombustivel116 = 0;
  let qtdDias116 = 0;

  for (const a of aloc.values()) {
    if (a.objetoCustoOperacao === OBJETO_COLHEITA_CANA) {
      valorOficina116 += a.custoOficina;
      valorCombustivel116 += a.custoCombustivel;
      qtdDias116 += a.qtdDias;
    }

    dados.push({
      anomes: a.anomes,
      codEquipamento: a.codEquipamento,
      codTipoEquipamento: null,
      codOperacaoAgricola: null,
      codFazenda: null,
      codTalhao: null,
      objetoCustoOperacao: a.objetoCustoOperacao,
      objetoCustoRequisicao: null,
      kmhsRodados: a.kmhsRodados,
      kmhsTotalEquipamento: a.kmhsRodados,
      qtdeLitros: a.qtdeLitros,
      valorAbastecimento: a.custoCombustivel,
      qtdAbastecimentos: a.qtdDias,
      horasOs: null,
      percentualRateioEquipamento: null,
      custoRateadoEquipamento: 0,
      percentualRateioAtividade: 0,
      custoOficina: a.custoOficina,
      custoCombustivel: a.custoCombustivel,
      custoMaterial: 0,
      custoInsumo: 0,
      custoTransporte: 0,
      custoMecanizacao: 0,
      custoServicoTerceiro: 0,
      custoFuncionario: 0,
      custoTotal: a.custoOficina + a.custoCombustivel,
      custoRateadoAtividade: a.custoOficina,
      semCustoOficina: a.custoOficina <= 0.005,
      semOperacao: true,
      semAbastecimento: a.custoCombustivel <= 0.005,
      semMaterial: true,
      semInsumo: true,
      semServicoTerceiro: true,
      semFuncionario: true,
      complementarIrrigacao: false,
      origemIrrigacao: null,
      semVinculoCompleto: false,
      oficinaRedistribuida: 0,
      rateioTransporteCliente: false,
      origemLancamentoTransporte: false,
      objetoCustoTransporte: null,
      rateioMecanizacaoCliente: false,
      origemLancamentoMecanizacao: false,
      objetoCustoMecanizacao: null,
      custoRetidoEquipamento: false,
      rateioColheitaCana: true,
      fontesColheitaCana: [...a.fontes],
      itens: [
        ...(a.custoOficina > 0.005
          ? [
              {
                tipo: 'oficina',
                codMaterial: null,
                quantidade: 0,
                litros: 0,
                custo: a.custoOficina,
              },
            ]
          : []),
        ...(a.custoCombustivel > 0.005
          ? [
              {
                tipo: 'combustivel',
                codMaterial: null,
                quantidade: a.qtdeLitros,
                litros: a.qtdeLitros,
                custo: a.custoCombustivel,
              },
            ]
          : []),
      ],
    });
  }

  // Remove linhas “esvaziadas” só de oficina/combustível (sem material/insumo)
  const dadosFinais = dados.filter((row) => {
    if (!row.rateioColheitaCanaOrigem) return true;
    const temOutro =
      (row.custoMaterial || 0) > 0.005 ||
      (row.custoInsumo || 0) > 0.005 ||
      (row.custoServicoTerceiro || 0) > 0.005 ||
      (row.custoFuncionario || 0) > 0.005;
    if (temOutro) {
      delete row.rateioColheitaCanaOrigem;
      return true;
    }
    return false;
  });

  return {
    dados: dadosFinais,
    resumo: {
      aplicado: true,
      objetoColheitaCana: OBJETO_COLHEITA_CANA,
      tiposTrator: TIPOS_TRATOR_COLHEITA,
      qtdEquipamentos: equipamentos.length,
      qtdEquipamentosEntradaCana: eqsEntrada.size,
      qtdEquipamentosExcluidosNaoTrator: eqsExcluidos.length,
      qtdDiasCana: qtdDiasCanaFiltrados,
      qtdDiasCanaExcluidosNaoTrator,
      qtdDiasComCusto116: qtdDias116,
      valorOficina116,
      valorCombustivel116,
      valorEnviado116: valorOficina116 + valorCombustivel116,
      lookbackDias: LOOKBACK_DIAS,
      periodo: {
        dataInicio: periodo.dataInicio,
        dataFim: periodo.dataFim,
        dataLookback: periodo.dataLookback,
      },
      logica:
        'Só tratores (tipo vigente 12/93/64/6) da entrada cana →116; demais máquinas da entrada cana ficam no path normal. Dia com cana→116; dia com apontamento→objeto da operação; dia sem info→herda estado anterior (carry-forward). Oficina mensal rateada por km/hs do dia.',
    },
    // útil para diagnóstico do exemplo 4014
    diagnosticarEquipamento(codEquipamento, dataInicio, dataFim) {
      const eq = Number(codEquipamento);
      const ini = dataInicio || periodo.dataInicio;
      const fim = dataFim || periodo.dataFim;
      return eachDay(ini, fim).map((dia) => {
        const st = estadoPorEqDia.get(`${eq}|${dia}`) || {
          objetoCusto: null,
          fonte: null,
        };
        const c = custosPorDia.get(`${eq}|${dia}`);
        return {
          dia,
          objetoCusto: st.objetoCusto,
          fonte: st.fonte,
          kmhs: c?.kmhsRodados || 0,
          litros: c?.qtdeLitros || 0,
          combustivel: c?.valorAbastecimento || 0,
        };
      });
    },
  };
}
