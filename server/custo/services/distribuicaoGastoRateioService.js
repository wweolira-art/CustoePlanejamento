import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { executeQuery } from '../utils/oracle.js';
import {
  consultarTotalLancamentoConsolidado,
  negociosParaConsulta,
} from './lancamentoConsolidadoService.js';
import { expandNegociosCana, normalizeNegocios, bindsObjetoCusto } from '../utils/filtros.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RATEIO_LINHAS_SQL = readFileSync(
  join(__dirname, '../sql/rateioDistribuicaoLinhas.sql'),
  'utf8'
)
  .replace(/^--.*$/gm, '')
  .trim();

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function filtrosEff(filtros = {}) {
  const negociosBase = normalizeNegocios(filtros);
  const negociosExpandidos = expandNegociosCana(negociosBase);
  return {
    ...filtros,
    negocios: negociosExpandidos,
    negocio:
      negociosExpandidos?.length === 1 ? negociosExpandidos[0] : null,
  };
}

function bindsConsulta(filtros = {}) {
  const eff = filtrosEff(filtros);
  const negocios = negociosParaConsulta(eff);
  const obj = bindsObjetoCusto({ ...eff, negocios });
  return {
    negociosCsv: obj.negociosCsv,
    anomesInicio: eff.anomesInicio ?? null,
    anomesFim: eff.anomesFim ?? null,
    objetoCusto: obj.objetoCusto,
    processo: obj.processo,
    subprocesso: obj.subprocesso,
    atividade: obj.atividade,
  };
}

function mapLinha(row) {
  return {
    origem: toNumber(row.ORIGEM ?? row.origem),
    anomes: row.ANOMES != null ? String(row.ANOMES) : null,
    codItemCusto: toNumber(row.COD_ITEM_CUSTO ?? row.cod_item_custo),
    negOrigem: toNumber(row.NEG_ORIGEM ?? row.neg_origem),
    destObj: toNumber(row.DEST_OBJ ?? row.dest_obj),
    via: row.VIA != null ? String(row.VIA) : null,
    valorRateado: toNumber(row.VALOR_RATEADO ?? row.valor_rateado),
  };
}

async function mapearObjetos(ids) {
  const unique = [...new Set(ids.filter((v) => Number.isFinite(v)))];
  if (!unique.length) return new Map();

  const result = await executeQuery(
    `
    SELECT cod_objetocusto, descricao, negocio, processo, subprocesso, atividade
    FROM custo.objetocusto
    WHERE cod_objetocusto IN (${unique.map((_, i) => `:id${i}`).join(',')})
    `,
    Object.fromEntries(unique.map((id, i) => [`id${i}`, id]))
  );

  return new Map(
    (result.rows || []).map((row) => [
      Number(row.COD_OBJETOCUSTO),
      {
        descricao: row.DESCRICAO != null ? String(row.DESCRICAO).trim() : null,
        negocio: toNumber(row.NEGOCIO),
        processo: toNumber(row.PROCESSO),
        subprocesso: toNumber(row.SUBPROCESSO),
        atividade: toNumber(row.ATIVIDADE),
      },
    ])
  );
}

function agregarPorDestino(linhas, metas) {
  const map = new Map();
  for (const lin of linhas) {
    const key = String(lin.destObj);
    const meta = metas.get(lin.destObj) || {};
    const cur = map.get(key) || {
      objetoCusto: lin.destObj,
      descricao: meta.descricao ?? null,
      negocio: meta.negocio ?? 1,
      processo: meta.processo ?? null,
      subprocesso: meta.subprocesso ?? null,
      atividade: meta.atividade ?? null,
      custoTotal: 0,
      porVia: {},
      porOrigemNegocio: {},
      qtdLinhas: 0,
    };
    cur.custoTotal += lin.valorRateado;
    cur.qtdLinhas += 1;
    cur.porVia[lin.via || 'outros'] =
      (cur.porVia[lin.via || 'outros'] || 0) + lin.valorRateado;
    const nk = String(lin.negOrigem ?? 'outros');
    cur.porOrigemNegocio[nk] =
      (cur.porOrigemNegocio[nk] || 0) + lin.valorRateado;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.custoTotal - a.custoTotal);
}

function agregarPorVia(linhas) {
  const map = new Map();
  for (const lin of linhas) {
    const k = lin.via || 'outros';
    map.set(k, (map.get(k) || 0) + lin.valorRateado);
  }
  return [...map.entries()]
    .map(([via, valor]) => ({ via, valor }))
    .sort((a, b) => b.valor - a.valor);
}

function agregarPorOrigemNegocio(linhas) {
  const map = new Map();
  for (const lin of linhas) {
    const k = lin.negOrigem ?? 0;
    map.set(k, (map.get(k) || 0) + lin.valorRateado);
  }
  return [...map.entries()]
    .map(([negocio, valor]) => ({ negocio, valor }))
    .sort((a, b) => b.valor - a.valor);
}

const LABEL_NEGOCIO = {
  1: 'Cana de Açúcar',
  3: 'Apoio agrícola',
  5: 'Administrativo',
};

function labelNegocioOrigem(negocio) {
  return LABEL_NEGOCIO[negocio] || `Negócio ${negocio}`;
}

/** Agrupa quanto cada negócio de origem enviou para objetos destino (Cana, negócio 1). */
function agregarPorNegocioOrigem(linhas, metas) {
  const map = new Map();
  for (const lin of linhas) {
    const neg = lin.negOrigem ?? 0;
    if (!map.has(neg)) {
      map.set(neg, {
        negocio: neg,
        descricaoNegocio: labelNegocioOrigem(neg),
        totalRateado: 0,
        qtdDestinos: 0,
        destinosMap: new Map(),
      });
    }
    const grupo = map.get(neg);
    grupo.totalRateado += lin.valorRateado;

    const destKey = String(lin.destObj);
    const destMeta = metas.get(lin.destObj) || {};
    const dest = grupo.destinosMap.get(destKey) || {
      objetoCusto: lin.destObj,
      descricao: destMeta.descricao ?? null,
      negocio: destMeta.negocio ?? 1,
      valor: 0,
      qtdLinhas: 0,
    };
    dest.valor += lin.valorRateado;
    dest.qtdLinhas += 1;
    grupo.destinosMap.set(destKey, dest);
  }

  return [...map.values()]
    .map((grupo) => {
      const destinos = [...grupo.destinosMap.values()].sort(
        (a, b) => b.valor - a.valor
      );
      return {
        negocio: grupo.negocio,
        descricaoNegocio: grupo.descricaoNegocio,
        totalRateado: grupo.totalRateado,
        qtdDestinos: destinos.length,
        destinos,
      };
    })
    .sort((a, b) => b.totalRateado - a.totalRateado);
}

/**
 * Rateio ERP: lancamento_custo → distribuicaogasto → objetos cana (negócio 1),
 * com fallback utilizacao / direto negócio 1. Total = pool lancamento consolidado.
 */
export async function consultarRateioDistribuicao(filtros = {}) {
  const eff = filtrosEff(filtros);
  const binds = bindsConsulta(filtros);

  const [result, totalLancamento] = await Promise.all([
    executeQuery(RATEIO_LINHAS_SQL, binds),
    consultarTotalLancamentoConsolidado(eff),
  ]);

  const linhas = (result.rows || []).map(mapLinha);
  const ids = [
    ...linhas.map((l) => l.destObj),
    ...linhas.map((l) => l.origem),
  ];
  const metas = await mapearObjetos(ids);

  const destinos = agregarPorDestino(linhas, metas);
  const totalRateado = linhas.reduce((acc, l) => acc + l.valorRateado, 0);
  const porVia = agregarPorVia(linhas);
  const porOrigemNegocio = agregarPorOrigemNegocio(linhas);
  const rateioPorNegocioOrigem = agregarPorNegocioOrigem(linhas, metas);

  const atividades = destinos.map((d) => ({
    chave: `obj:${d.objetoCusto}`,
    objetoCusto: d.objetoCusto,
    descricao: d.descricao,
    negocio: d.negocio,
    processo: d.processo,
    subprocesso: d.subprocesso,
    atividade: d.atividade,
    custoTotal: d.custoTotal,
    custoOficina: 0,
    custoTransporte: 0,
    custoMecanizacao: 0,
    custoCombustivel: 0,
    custoMaterial: 0,
    custoInsumo: 0,
    custoServicoTerceiro: 0,
    custoFuncionario: 0,
    horas: 0,
    litros: 0,
    custoPorHora: null,
    litrosPorHora: null,
    qtdLinhas: d.qtdLinhas,
    porVia: d.porVia,
    porOrigemNegocio: d.porOrigemNegocio,
    detalhes: [],
  }));

  const centrosCusto = destinos.map((d) => ({
    objetoCusto: d.objetoCusto,
    descricao: d.descricao,
    negocio: d.negocio,
    processo: d.processo,
    subprocesso: d.subprocesso,
    horas: 0,
    custoOficina: 0,
    custoTransporte: 0,
    custoMecanizacao: 0,
    custoCombustivel: 0,
    custoMaterial: 0,
    custoInsumo: 0,
    custoServicoTerceiro: 0,
    custoFuncionario: 0,
    totalRateado: d.custoTotal,
    arrendamento: 0,
    outrosCustos: 0,
    totalCentro: d.custoTotal,
  }));

  return {
    filtros: {
      ...eff,
      negociosConsulta: negociosParaConsulta(eff),
      negociosSelecionados: normalizeNegocios(filtros),
    },
    logica: {
      origem:
        'Pool = SUM(lancamento_custo tipo R, empenho 1/2, negócios Cana 1+3+5 com exclusão negócio 5 processo 3/4)',
      distribuicao:
        '1) custo.distribuicaogasto (porcentagem por item ou objeto) → destino negócio 1; 2) custo.utilizacao (prestador→cliente); 3) utilizacao global do mês; 4) direto se origem já é negócio 1',
      sequencia:
        'custo.sequenciarateio define ordem/nível dos objetos no ERP; proporções vêm de distribuicaogasto/utilizacao já calculadas',
      destino: 'objetos de custo negócio 1 (Cana de Açúcar)',
    },
    resumo: {
      totalGeral: totalLancamento,
      totalRateado,
      totalLancamentoConsolidado: totalLancamento,
      diferenca: totalLancamento - totalRateado,
      qtdLinhas: linhas.length,
      qtdDestinos: destinos.length,
      qtdAtividades: atividades.length,
      porVia,
      porOrigemNegocio,
    },
    composicao: {
      operacaoVsInsumo: porOrigemNegocio.map((row) => ({
        chave: `negocio-${row.negocio}`,
        label: `Origem negócio ${row.negocio}`,
        valor: row.valor,
      })),
      operacaoDetalhe: porVia.map((row) => ({
        chave: row.via,
        label: row.via,
        valor: row.valor,
      })),
    },
    linhas,
    atividades,
    centrosCusto,
    rateioPorNegocioOrigem,
    dados: linhas,
  };
}
