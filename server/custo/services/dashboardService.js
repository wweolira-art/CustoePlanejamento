import { consultarRateioDistribuicao } from './distribuicaoGastoRateioService.js';
import {
  consultarComposicaoCustoTotal,
  consultarComposicaoPorEstagio,
  negociosParaConsulta,
} from './lancamentoConsolidadoService.js';
import { expandNegociosCana, normalizeNegocios } from '../utils/filtros.js';

const VIA_LABEL = {
  'distribuicaogasto-item': 'Distribuição gasto (item)',
  'distribuicaogasto-objeto': 'Distribuição gasto (objeto)',
  utilizacao: 'Utilização (prestador→cliente)',
  'utilizacao-global': 'Utilização global',
  'direto-negocio-1': 'Direto negócio 1',
};

function labelVia(via) {
  return VIA_LABEL[via] || via || 'Outros';
}

function montarComposicaoTotal(comp) {
  return [
    { chave: 'operacao', label: 'Operação', valor: comp.operacao },
    { chave: 'insumo', label: 'Insumo agrícola', valor: comp.insumo },
    { chave: 'arrendamento', label: 'Arrendamento', valor: comp.arrendamento },
    { chave: 'outrosCustos', label: 'Outros custos', valor: comp.outrosCustos },
  ].filter((item) => item.valor > 0.005);
}

/**
 * Dashboard de custo realizado via rateio ERP (distribuicaogasto + utilizacao).
 * Total = pool lancamento_custo (tipo R, empenho 1/2; exclui 5/3, 5/4 e negócios 2, 98, 90, 6, 99, 8, 7).
 */
export async function consultarDashboard(filtros = {}) {
  const negociosBase = normalizeNegocios(filtros);
  const negociosExpandidos = expandNegociosCana(negociosBase);
  const filtrosEff = {
    ...filtros,
    negocios: negociosExpandidos,
    negocio:
      negociosExpandidos?.length === 1 ? negociosExpandidos[0] : null,
  };

  const [rateio, composicaoTotal, porEstagio] = await Promise.all([
    consultarRateioDistribuicao(filtrosEff),
    consultarComposicaoCustoTotal(filtrosEff),
    consultarComposicaoPorEstagio(filtrosEff),
  ]);
  const res = rateio.resumo || {};
  const totalGeral = composicaoTotal.total || res.totalLancamentoConsolidado || res.totalGeral || 0;
  const totalRateado = res.totalRateado ?? 0;
  const porVia = res.porVia || [];
  const porOrigemNegocio = res.porOrigemNegocio || [];

  const atividades = (rateio.atividades || []).map((a) => ({
    ...a,
    horas: a.horas ?? 0,
    litros: a.litros ?? 0,
    custoPorHora: null,
    litrosPorHora: null,
    haPorHora: null,
    detalhes: a.detalhes ?? [],
  }));

  const centrosCusto = (rateio.centrosCusto || []).map((c) => ({
    ...c,
    horas: 0,
    custoOficina: 0,
    custoTransporte: 0,
    custoMecanizacao: 0,
    custoCombustivel: 0,
    custoMaterial: 0,
    custoInsumo: 0,
    custoServicoTerceiro: 0,
    custoFuncionario: 0,
    arrendamento: 0,
    outrosCustos: 0,
    totalCentro: c.totalRateado ?? c.totalCentro ?? 0,
  }));

  return {
    filtros: {
      ...rateio.filtros,
      negociosConsulta: negociosParaConsulta(filtrosEff),
      negociosSelecionados: negociosBase,
    },
    logica: rateio.logica,
    resumo: {
      totalGeral,
      totalRateado,
      totalLancamentoConsolidado: totalGeral,
      diferenca: res.diferenca ?? totalGeral - totalRateado,
      totalOperacao: composicaoTotal.operacao,
      totalOperacaoComFuncionario: composicaoTotal.operacao,
      totalInsumo: composicaoTotal.insumo,
      totalServicoTerceiro: 0,
      totalFuncionario: 0,
      totalArrendamento: composicaoTotal.arrendamento,
      totalOutrosCustos: composicaoTotal.outrosCustos,
      totalHoras: 0,
      totalLitros: 0,
      custoMedioPorHora: null,
      litrosMedioPorHora: null,
      totalOficina: 0,
      totalOficinaRetida: 0,
      totalCombustivel: 0,
      totalMaterial: 0,
      totalTransporte: 0,
      totalMecanizacao: 0,
      qtdAtividades: res.qtdAtividades ?? atividades.length,
      qtdLinhas: res.qtdLinhas ?? 0,
      qtdDestinos: res.qtdDestinos ?? centrosCusto.length,
      porVia,
      porOrigemNegocio,
    },
    composicao: {
      operacaoVsInsumo: montarComposicaoTotal(composicaoTotal),
      operacaoDetalhe: porVia.map((row) => ({
        chave: row.via,
        label: labelVia(row.via),
        valor: row.valor,
      })),
      porEstagio,
    },
    centrosCusto,
    atividades,
    linhas: rateio.linhas,
    rateioPorNegocioOrigem: rateio.rateioPorNegocioOrigem ?? [],
  };
}
