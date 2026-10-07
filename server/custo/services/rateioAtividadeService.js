import { consultarResumoPorEquipamento, FILTRO_OFICINA } from './rateioService.js';
import {
  consultarResumoPorEquipamentoTransporte,
  FILTRO_TRANSPORTE_LANC,
} from './transporteRateioService.js';
import {
  consultarResumoPorEquipamentoMecanizacao,
  FILTRO_MECANIZACAO_LANC,
} from './mecanizacaoRateioService.js';
import {
  consultarBaseAtividades,
  consultarBaseCombustivelItens,
} from './abastecimentoService.js';
import { consultarBaseMateriais } from './materialService.js';
import { consultarBaseInsumos } from './insumoService.js';
import {
  consultarBaseServicosTerceiro,
  consultarBaseServicosTerceiroFixo,
} from './servicoTerceiroService.js';
import {
  consultarBaseFuncionarios,
  FILTRO_FUNCIONARIO,
} from './funcionarioService.js';
import { consultarBaseIrrigacao } from './irrigacaoService.js';
import { listarObjetosCusto } from './objetoCustoService.js';
import {
  carregarMapasTransporteCliente,
  clientesDoEquipamentoTransporte,
  fatiarCustoParaClientes,
} from './transporteOficinaService.js';
import {
  carregarMapasMecanizacaoCliente,
  clientesDoEquipamentoMecanizacao,
} from './mecanizacaoOficinaService.js';
import {
  aplicarRateioColheitaCana,
  OBJETO_COLHEITA_CANA,
} from './colheitaCanaRateioService.js';
import { consultarLancamentoClassificado } from './lancamentoConsolidadoService.js';

/** Período/equipamento — oficina usa só isso (origem fixa 3/1/1 no rateioService). */
function filtrosPeriodo(filtros = {}) {
  return {
    anomes: filtros.anomes ?? null,
    anomesInicio: filtros.anomesInicio ?? null,
    anomesFim: filtros.anomesFim ?? null,
    equipamento: filtros.equipamento ?? null,
  };
}

/** Período + dimensões de objeto (para filtrar operação/material/insumo). */
function filtrosResultado(filtros = {}) {
  return {
    ...filtrosPeriodo(filtros),
    negocios: filtros.negocios ?? null,
    negocio: filtros.negocio ?? null,
    processo: filtros.processo ?? null,
    subprocesso: filtros.subprocesso ?? null,
    atividade: filtros.atividade ?? null,
    objetoCusto: filtros.objetoCusto ?? null,
  };
}

function temFiltroObjeto(filtros = {}) {
  return (
    (Array.isArray(filtros.negocios) && filtros.negocios.length > 0) ||
    filtros.negocio != null ||
    filtros.processo != null ||
    filtros.subprocesso != null ||
    filtros.atividade != null ||
    filtros.objetoCusto != null
  );
}

async function codigosObjetoPermitidos(filtros = {}) {
  if (!temFiltroObjeto(filtros)) return null;

  const temNegocio =
    (Array.isArray(filtros.negocios) && filtros.negocios.length > 0) ||
    filtros.negocio != null;

  if (
    filtros.objetoCusto != null &&
    !temNegocio &&
    filtros.processo == null &&
    filtros.subprocesso == null &&
    filtros.atividade == null
  ) {
    return new Set([filtros.objetoCusto]);
  }

  const lista = await listarObjetosCusto({
    negocios: filtros.negocios,
    negocio: filtros.negocio,
    processo: filtros.processo,
    subprocesso: filtros.subprocesso,
    atividade: filtros.atividade,
    objetoCusto: filtros.objetoCusto,
    incluirCabecalhos: false,
  });

  return new Set(
    lista.dados
      .map((o) => Number(o.codObjetoCusto))
      .filter((v) => Number.isFinite(v))
  );
}

function objetoCustoEfetivo(row) {
  return row.objetoCustoOperacao ?? row.objetoCustoRequisicao ?? null;
}

function chaveAtividade(row) {
  return [
    row.anomes ?? '',
    row.codEquipamento ?? '',
    row.codOperacaoAgricola ?? '',
    row.codFazenda ?? '',
    row.codTalhao ?? '',
    objetoCustoEfetivo(row) ?? '',
  ].join('|');
}

function mesclarServicosTerceiro(mapa, servicos, custoPorChave, tipoItem) {
  const isFixo = tipoItem === 'servico-terceiro-fixo';
  for (const servico of servicos) {
    const objetoCusto =
      servico.objetoCustoOperacao ?? servico.objetoCustoRequisicao ?? null;
    const servicoRow = {
      ...servico,
      objetoCustoOperacao: objetoCusto,
      ...(isFixo
        ? {
            codOperacaoAgricola: null,
            codEquipamento: null,
            codFazenda: null,
            codTalhao: null,
          }
        : {}),
    };
    const key = chaveAtividade(servicoRow);
    const existente = mapa.get(key);
    const itemServico = {
      tipo: tipoItem,
      codMaterial: isFixo
        ? servico.codServico ?? null
        : servico.codServico ?? servico.codOperacaoAgricola ?? null,
      descricaoMaterial: servico.descricaoOperacao ?? null,
      quantidade: servico.quantidade || 0,
      custo: servico.custoServicoTerceiro || 0,
      litros: 0,
    };

    if (existente) {
      existente.custoServicoTerceiro =
        (existente.custoServicoTerceiro || 0) +
        (servico.custoServicoTerceiro || 0);
      existente.quantidadeServicoTerceiro =
        (existente.quantidadeServicoTerceiro || 0) + (servico.quantidade || 0);
      existente.qtdItensServicoTerceiro =
        (existente.qtdItensServicoTerceiro || 0) + (servico.qtdItens || 0);
      existente.objetoCustoOperacao =
        existente.objetoCustoOperacao ?? objetoCusto;
      existente.semServicoTerceiro = false;
      adicionarItem(existente, itemServico);
      recalcularTotal(existente);
      continue;
    }

    const eqKey = `${servico.anomes}|${servico.codEquipamento}`;
    const custoEq = custoPorChave.get(eqKey);

    const nova = recalcularTotal(
      linhaVazia({
        anomes: servico.anomes,
        codEquipamento: isFixo ? null : servico.codEquipamento,
        codOperacaoAgricola: isFixo ? null : servico.codOperacaoAgricola,
        codFazenda: isFixo ? null : servico.codFazenda,
        codTalhao: isFixo ? null : servico.codTalhao,
        objetoCustoOperacao: objetoCusto,
        quantidadeServicoTerceiro: servico.quantidade || 0,
        qtdItensServicoTerceiro: servico.qtdItens || 0,
        horasOs: custoEq?.horasOs ?? null,
        percentualRateioEquipamento: custoEq?.percentualRateio ?? null,
        custoRateadoEquipamento: custoEq?.custoRateado || 0,
        custoServicoTerceiro: servico.custoServicoTerceiro || 0,
        semCustoOficina: !custoEq,
        semOperacao: isFixo || servico.codOperacaoAgricola == null,
        semAbastecimento: true,
        semMaterial: true,
        semInsumo: true,
        semServicoTerceiro: false,
        semVinculoCompleto:
          servico.codEquipamento == null &&
          servico.codOperacaoAgricola == null,
      })
    );
    adicionarItem(nova, itemServico);
    mapa.set(key, nova);
  }
}

function mesclarFuncionarios(mapa, funcionarios, custoPorChave) {
  for (const func of funcionarios) {
    const objetoCusto =
      func.objetoCustoOperacao ?? func.objetoCustoOrigem ?? null;
    const isRetido =
      func.via === 'objeto-retido' || func.via === 'residual-mecanizacao';
    const funcRow = {
      ...func,
      objetoCustoOperacao: objetoCusto,
      ...(isRetido
        ? {
            codOperacaoAgricola: null,
            codEquipamento: null,
            codFazenda: null,
            codTalhao: null,
          }
        : {}),
    };
    const key = chaveAtividade(funcRow);
    const existente = mapa.get(key);
    const itemFunc = {
      tipo: 'funcionario',
      codMaterial: null,
      descricaoMaterial:
        func.via === 'apontamento-mecanizacao'
          ? 'funcionário (rateio apontamento 3/1/3)'
          : func.via === 'residual-mecanizacao'
            ? 'funcionário (residual 3/1/3 sem horas)'
            : 'funcionário (objeto)',
      quantidade: func.horasApontamento || 0,
      custo: func.custoFuncionario || 0,
      litros: 0,
    };

    if (existente) {
      existente.custoFuncionario =
        (existente.custoFuncionario || 0) + (func.custoFuncionario || 0);
      existente.objetoCustoOperacao =
        existente.objetoCustoOperacao ?? objetoCusto;
      existente.semFuncionario = false;
      existente.viaFuncionario = existente.viaFuncionario || func.via;
      adicionarItem(existente, itemFunc);
      recalcularTotal(existente);
      continue;
    }

    const eqKey = `${func.anomes}|${func.codEquipamento}`;
    const custoEq = custoPorChave.get(eqKey);

    const nova = recalcularTotal(
      linhaVazia({
        anomes: func.anomes,
        codEquipamento: isRetido ? null : func.codEquipamento,
        codOperacaoAgricola: isRetido ? null : func.codOperacaoAgricola,
        codFazenda: isRetido ? null : func.codFazenda,
        codTalhao: isRetido ? null : func.codTalhao,
        objetoCustoOperacao: objetoCusto,
        horasOs: custoEq?.horasOs ?? null,
        percentualRateioEquipamento: custoEq?.percentualRateio ?? null,
        custoRateadoEquipamento: custoEq?.custoRateado || 0,
        custoFuncionario: func.custoFuncionario || 0,
        semCustoOficina: !custoEq,
        semOperacao: isRetido || func.codOperacaoAgricola == null,
        semAbastecimento: true,
        semMaterial: true,
        semInsumo: true,
        semServicoTerceiro: true,
        semFuncionario: false,
        viaFuncionario: func.via,
        semVinculoCompleto:
          func.codEquipamento == null && func.codOperacaoAgricola == null,
      })
    );
    adicionarItem(nova, itemFunc);
    mapa.set(key, nova);
  }
}

function linhaVazia(parcial = {}) {
  return {
    anomes: null,
    codEquipamento: null,
    codTipoEquipamento: null,
    codOperacaoAgricola: null,
    codFazenda: null,
    codTalhao: null,
    objetoCustoOperacao: null,
    objetoCustoRequisicao: null,
    kmhsRodados: 0,
    kmhsTotalEquipamento: 0,
    qtdeLitros: 0,
    valorAbastecimento: 0,
    qtdAbastecimentos: 0,
    quantidadeMaterial: 0,
    qtdItensMaterial: 0,
    quantidadeInsumo: 0,
    qtdItensInsumo: 0,
    quantidadeServicoTerceiro: 0,
    qtdItensServicoTerceiro: 0,
    horasOs: null,
    percentualRateioEquipamento: null,
    custoRateadoEquipamento: 0,
    percentualRateioAtividade: 0,
    custoOficina: 0,
    custoCombustivel: 0,
    custoMaterial: 0,
    custoInsumo: 0,
    custoTransporte: 0,
    custoMecanizacao: 0,
    custoServicoTerceiro: 0,
    custoFuncionario: 0,
    custoArrendamento: 0,
    custoOutros: 0,
    custoDireto: 0,
    custoTotal: 0,
    custoRateadoAtividade: 0,
    semCustoOficina: true,
    semOperacao: true,
    semAbastecimento: true,
    semMaterial: true,
    semInsumo: true,
    semServicoTerceiro: true,
    semFuncionario: true,
    viaFuncionario: null,
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
    itens: [],
    ...parcial,
  };
}

/** Abastecimento agregado por anomes|equipamento (kmhs, litros, valor). */
function agregarAbastecimentoPorEquipamento(atividades = []) {
  const map = new Map();
  for (const a of atividades) {
    const key = `${a.anomes}|${a.codEquipamento}`;
    const cur = map.get(key) || {
      kmhs: 0,
      litros: 0,
      valor: 0,
      qtd: 0,
    };
    cur.kmhs += a.kmhsRodados || 0;
    cur.litros += a.qtdeLitros || 0;
    cur.valor += a.valorAbastecimento || 0;
    cur.qtd += a.qtdAbastecimentos || 0;
    map.set(key, cur);
  }
  return map;
}

function clientesComPeso(objOrigem, clientesPorObj) {
  const clientes =
    objOrigem != null ? clientesPorObj.get(objOrigem) || [] : [];
  const pesoTotal = clientes.reduce((acc, c) => acc + (c.peso || 0), 0);
  return {
    clientes,
    pesoTotal,
    ok: objOrigem != null && clientes.length > 0 && pesoTotal > 0,
  };
}

/**
 * Linhas sem objeto e fora do transporte/mecanização com clientes → objeto
 * vigente do equipamento (historicoequipamentoobcusto), mantendo combustível/litros/kmhs.
 */
function atribuirObjetoEquipamentoNasLinhas(
  dados,
  mapasTransporte,
  mapasMecanizacao = null
) {
  const eqParaObjTransporte =
    mapasTransporte?.eqParaObjTransporte ?? new Map();
  const eqParaObjAtual = mapasTransporte?.eqParaObjAtual ?? new Map();
  const clientesPorObjTransp =
    mapasTransporte?.clientesPorObjTransporte ?? new Map();
  const eqParaObjMecanizacao =
    mapasMecanizacao?.eqParaObjMecanizacao ?? new Map();
  const clientesPorObjMec =
    mapasMecanizacao?.clientesPorObjMecanizacao ?? new Map();

  for (const row of dados) {
    if (objetoCustoEfetivo(row) != null) continue;
    if (row.codEquipamento == null) continue;

    const codEq = Number(row.codEquipamento);
    const objTransporte = eqParaObjTransporte.get(codEq);
    const transp = clientesComPeso(objTransporte, clientesPorObjTransp);
    // Transporte/mecanização com clientes: oficina residual trata à parte
    if (transp.ok) continue;
    const objMecanizacao = eqParaObjMecanizacao.get(codEq);
    const mec = clientesComPeso(objMecanizacao, clientesPorObjMec);
    if (mec.ok) continue;

    const objEquipamento = eqParaObjAtual.get(codEq);
    if (objEquipamento == null) continue;

    row.objetoCustoOperacao = objEquipamento;
    row.custoRetidoEquipamento = true;
    if ((row.kmhsRodados || 0) <= 0 && (row.horasOs || 0) > 0) {
      row.kmhsRodados = row.horasOs;
    }
    recalcularTotal(row);
  }
}

/**
 * Residual sem apontamento:
 * - transporte (hist 3/1/2) com clientes → rateia aos objetos clientes;
 * - mecanização (hist 3/1/3) com clientes → rateia aos objetos clientes;
 * - senão → lança no objeto de custo vigente do equipamento
 *   com oficina + combustível/litros/horas (para R$/h e L/h).
 */
function fecharOficinaSemOperacao(
  dados,
  custoEquipamentoDados,
  mapasTransporte = null,
  abastPorEquipamento = new Map(),
  mapasMecanizacao = null,
  opcoes = {}
) {
  const somenteLancamento = opcoes.somenteLancamento === true;
  const oficinaAlocada = new Map();
  const combJaNaLista = new Map();
  for (const row of dados) {
    const eqKey = `${row.anomes}|${row.codEquipamento}`;
    oficinaAlocada.set(
      eqKey,
      (oficinaAlocada.get(eqKey) || 0) + (row.custoOficina || 0)
    );
    combJaNaLista.set(
      eqKey,
      (combJaNaLista.get(eqKey) || 0) + (row.custoCombustivel || 0)
    );
  }

  let totalSemOperacao = 0;
  let totalRateadoTransporteCliente = 0;
  let totalRateadoMecanizacaoCliente = 0;
  const destinosTransporte = [];
  const destinosMecanizacao = [];

  const eqParaObjTransporte =
    mapasTransporte?.eqParaObjTransporte ?? new Map();
  const eqParaObjAtual = mapasTransporte?.eqParaObjAtual ?? new Map();
  const clientesPorObjTransp =
    mapasTransporte?.clientesPorObjTransporte ?? new Map();
  const eqParaObjMecanizacao =
    mapasMecanizacao?.eqParaObjMecanizacao ?? new Map();
  const clientesPorObjMec =
    mapasMecanizacao?.clientesPorObjMecanizacao ?? new Map();

  for (const custoEq of custoEquipamentoDados) {
    const eqKey = `${custoEq.anomes}|${custoEq.codEquipamento}`;
    const residual =
      (custoEq.custoRateado || 0) - (oficinaAlocada.get(eqKey) || 0);
    if (Math.abs(residual) < 0.005) continue;

    const codEq = Number(custoEq.codEquipamento);
    const objTransporte = eqParaObjTransporte.get(codEq);
    const transp = clientesComPeso(objTransporte, clientesPorObjTransp);

    if (transp.ok) {
      const partes = fatiarCustoParaClientes(residual, transp.clientes);
      for (const parte of partes) {
        const nova = recalcularTotal(
          linhaVazia({
            anomes: custoEq.anomes,
            codEquipamento: custoEq.codEquipamento,
            objetoCustoOperacao: parte.objetoCliente,
            horasOs: custoEq.horasOs,
            percentualRateioEquipamento: custoEq.percentualRateio,
            custoRateadoEquipamento: custoEq.custoRateado,
            percentualRateioAtividade: parte.percentual,
            custoOficina: parte.valor,
            custoRateadoAtividade: parte.valor,
            semCustoOficina: false,
            semOperacao: true,
            semAbastecimento: true,
            semMaterial: true,
            semInsumo: true,
            rateioTransporteCliente: true,
            objetoCustoTransporte: objTransporte,
          })
        );
        dados.push(nova);
        destinosTransporte.push({
          anomes: custoEq.anomes != null ? String(custoEq.anomes) : null,
          codEquipamento: custoEq.codEquipamento,
          objetoCustoTransporte: objTransporte,
          objetoCustoCliente: parte.objetoCliente,
          horasOs: custoEq.horasOs,
          percentual: parte.percentual,
          custoEnviado: parte.valor,
          origem: 'oficina-residual',
        });
      }
      totalRateadoTransporteCliente += residual;
      continue;
    }

    const objMecanizacao = eqParaObjMecanizacao.get(codEq);
    const mec = clientesComPeso(objMecanizacao, clientesPorObjMec);

    if (mec.ok) {
      const partes = fatiarCustoParaClientes(residual, mec.clientes);
      for (const parte of partes) {
        const nova = recalcularTotal(
          linhaVazia({
            anomes: custoEq.anomes,
            codEquipamento: custoEq.codEquipamento,
            objetoCustoOperacao: parte.objetoCliente,
            horasOs: custoEq.horasOs,
            percentualRateioEquipamento: custoEq.percentualRateio,
            custoRateadoEquipamento: custoEq.custoRateado,
            percentualRateioAtividade: parte.percentual,
            custoOficina: parte.valor,
            custoRateadoAtividade: parte.valor,
            semCustoOficina: false,
            semOperacao: true,
            semAbastecimento: true,
            semMaterial: true,
            semInsumo: true,
            rateioMecanizacaoCliente: true,
            objetoCustoMecanizacao: objMecanizacao,
          })
        );
        dados.push(nova);
        destinosMecanizacao.push({
          anomes: custoEq.anomes != null ? String(custoEq.anomes) : null,
          codEquipamento: custoEq.codEquipamento,
          objetoCustoMecanizacao: objMecanizacao,
          objetoCustoCliente: parte.objetoCliente,
          horasOs: custoEq.horasOs,
          percentual: parte.percentual,
          custoEnviado: parte.valor,
          origem: 'oficina-residual',
        });
      }
      totalRateadoMecanizacaoCliente += residual;
      continue;
    }

    // Fora do transporte: oficina + combustível/litros no objeto do equipamento
    const objEquipamento = eqParaObjAtual.get(codEq) ?? null;
    const abast = abastPorEquipamento.get(eqKey) || {
      kmhs: 0,
      litros: 0,
      valor: 0,
      qtd: 0,
    };
    const combJa = combJaNaLista.get(eqKey) || 0;
    const custoCombustivel = somenteLancamento
      ? 0
      : Math.max(0, (abast.valor || 0) - combJa);
    const litros = somenteLancamento ? 0 : combJa > 0.005 ? 0 : abast.litros || 0;
    const kmhsAbast = abast.kmhs || 0;
    const horas =
      kmhsAbast > 0 ? kmhsAbast : toNumberSafe(custoEq.horasOs) || 0;

    totalSemOperacao += residual;
    const nova = recalcularTotal(
      linhaVazia({
        anomes: custoEq.anomes,
        codEquipamento: custoEq.codEquipamento,
        objetoCustoOperacao: objEquipamento,
        horasOs: custoEq.horasOs,
        percentualRateioEquipamento: custoEq.percentualRateio,
        custoRateadoEquipamento: custoEq.custoRateado,
        kmhsRodados: horas,
        kmhsTotalEquipamento: horas,
        qtdeLitros: litros,
        valorAbastecimento: custoCombustivel,
        qtdAbastecimentos: combJa > 0.005 ? 0 : abast.qtd || 0,
        custoOficina: residual,
        custoCombustivel,
        custoRateadoAtividade: residual,
        semCustoOficina: false,
        semOperacao: true,
        semAbastecimento: custoCombustivel <= 0.005,
        semMaterial: true,
        semInsumo: true,
        custoRetidoEquipamento: true,
      })
    );
    if (custoCombustivel > 0.005) {
      adicionarItem(nova, {
        tipo: 'combustivel',
        codMaterial: null,
        quantidade: litros,
        litros,
        custo: custoCombustivel,
      });
    }
    dados.push(nova);
  }

  return {
    totalSemOperacao,
    totalRateadoTransporteCliente,
    destinosTransporte,
    totalRateadoMecanizacaoCliente,
    destinosMecanizacao,
  };
}

/**
 * Lançamento 3/1/2 (tipo R, empenho 1/2) já rateado por horas OS entre
 * equipamentos de transporte → objetos clientes (prestador/unidade).
 * Não mistura com KPI de oficina e não passa por apontamento.
 */
function distribuirLancamentoTransporte(
  dados,
  custoTransporteDados,
  mapasTransporte = null
) {
  const destinos = [];
  let totalDistribuido = 0;
  let totalSemCliente = 0;

  for (const custoEq of custoTransporteDados || []) {
    const valor = custoEq.custoRateado || 0;
    if (Math.abs(valor) < 0.005) continue;

    const { objTransporte, clientes } = clientesDoEquipamentoTransporte(
      custoEq.codEquipamento,
      mapasTransporte
    );
    const partes = fatiarCustoParaClientes(valor, clientes);

    if (objTransporte != null && partes.length) {
      for (const parte of partes) {
        const nova = recalcularTotal(
          linhaVazia({
            anomes: custoEq.anomes,
            codEquipamento: custoEq.codEquipamento,
            objetoCustoOperacao: parte.objetoCliente,
            horasOs: custoEq.horasOs,
            percentualRateioEquipamento: custoEq.percentualRateio,
            custoRateadoEquipamento: custoEq.custoRateado,
            percentualRateioAtividade: parte.percentual,
            custoTransporte: parte.valor,
            custoRateadoAtividade: parte.valor,
            semCustoOficina: true,
            semOperacao: true,
            semAbastecimento: true,
            semMaterial: true,
            semInsumo: true,
            rateioTransporteCliente: true,
            origemLancamentoTransporte: true,
            objetoCustoTransporte: objTransporte,
          })
        );
        adicionarItem(nova, {
          tipo: 'transporte',
          custo: parte.valor,
          quantidade: 0,
          litros: 0,
        });
        dados.push(nova);
        destinos.push({
          anomes: custoEq.anomes != null ? String(custoEq.anomes) : null,
          codEquipamento: custoEq.codEquipamento,
          objetoCustoTransporte: objTransporte,
          objetoCustoCliente: parte.objetoCliente,
          horasOs: custoEq.horasOs,
          percentual: parte.percentual,
          custoEnviado: parte.valor,
          origem: 'lancamento-transporte',
        });
      }
      totalDistribuido += valor;
      continue;
    }

    const eqParaObjAtual = mapasTransporte?.eqParaObjAtual ?? new Map();
    const objFallback =
      objTransporte ??
      eqParaObjAtual.get(Number(custoEq.codEquipamento)) ??
      null;
    totalSemCliente += valor;
    const nova = recalcularTotal(
      linhaVazia({
        anomes: custoEq.anomes,
        codEquipamento: custoEq.codEquipamento,
        objetoCustoOperacao: objFallback,
        horasOs: custoEq.horasOs,
        percentualRateioEquipamento: custoEq.percentualRateio,
        custoRateadoEquipamento: custoEq.custoRateado,
        percentualRateioAtividade: 1,
        custoTransporte: valor,
        custoRateadoAtividade: valor,
        semCustoOficina: true,
        semOperacao: true,
        semAbastecimento: true,
        semMaterial: true,
        semInsumo: true,
        origemLancamentoTransporte: true,
        objetoCustoTransporte: objTransporte,
        custoRetidoEquipamento: objFallback != null && objTransporte == null,
      })
    );
    adicionarItem(nova, {
      tipo: 'transporte',
      custo: valor,
      quantidade: 0,
      litros: 0,
    });
    dados.push(nova);
  }

  return { destinos, totalDistribuido, totalSemCliente };
}

/**
 * Lançamento 3/1/3 (tipo R, empenho 1/2) já rateado por horas OS entre
 * equipamentos de mecanização → objetos clientes (prestador/unidade).
 * Não mistura com KPI de oficina e não passa por apontamento.
 */
function distribuirLancamentoMecanizacao(
  dados,
  custoMecanizacaoDados,
  mapasMecanizacao = null,
  mapasTransporte = null
) {
  const destinos = [];
  let totalDistribuido = 0;
  let totalSemCliente = 0;

  for (const custoEq of custoMecanizacaoDados || []) {
    const valor = custoEq.custoRateado || 0;
    if (Math.abs(valor) < 0.005) continue;

    const { objMecanizacao, clientes } = clientesDoEquipamentoMecanizacao(
      custoEq.codEquipamento,
      mapasMecanizacao
    );
    const partes = fatiarCustoParaClientes(valor, clientes);

    if (objMecanizacao != null && partes.length) {
      for (const parte of partes) {
        const nova = recalcularTotal(
          linhaVazia({
            anomes: custoEq.anomes,
            codEquipamento: custoEq.codEquipamento,
            objetoCustoOperacao: parte.objetoCliente,
            horasOs: custoEq.horasOs,
            percentualRateioEquipamento: custoEq.percentualRateio,
            custoRateadoEquipamento: custoEq.custoRateado,
            percentualRateioAtividade: parte.percentual,
            custoMecanizacao: parte.valor,
            custoRateadoAtividade: parte.valor,
            semCustoOficina: true,
            semOperacao: true,
            semAbastecimento: true,
            semMaterial: true,
            semInsumo: true,
            rateioMecanizacaoCliente: true,
            origemLancamentoMecanizacao: true,
            objetoCustoMecanizacao: objMecanizacao,
          })
        );
        adicionarItem(nova, {
          tipo: 'mecanizacao',
          custo: parte.valor,
          quantidade: 0,
          litros: 0,
        });
        dados.push(nova);
        destinos.push({
          anomes: custoEq.anomes != null ? String(custoEq.anomes) : null,
          codEquipamento: custoEq.codEquipamento,
          objetoCustoMecanizacao: objMecanizacao,
          objetoCustoCliente: parte.objetoCliente,
          horasOs: custoEq.horasOs,
          percentual: parte.percentual,
          custoEnviado: parte.valor,
          origem: 'lancamento-mecanizacao',
        });
      }
      totalDistribuido += valor;
      continue;
    }

    const eqParaObjAtual = mapasTransporte?.eqParaObjAtual ?? new Map();
    const objFallback =
      objMecanizacao ??
      eqParaObjAtual.get(Number(custoEq.codEquipamento)) ??
      null;
    totalSemCliente += valor;
    const nova = recalcularTotal(
      linhaVazia({
        anomes: custoEq.anomes,
        codEquipamento: custoEq.codEquipamento,
        objetoCustoOperacao: objFallback,
        horasOs: custoEq.horasOs,
        percentualRateioEquipamento: custoEq.percentualRateio,
        custoRateadoEquipamento: custoEq.custoRateado,
        percentualRateioAtividade: 1,
        custoMecanizacao: valor,
        custoRateadoAtividade: valor,
        semCustoOficina: true,
        semOperacao: true,
        semAbastecimento: true,
        semMaterial: true,
        semInsumo: true,
        origemLancamentoMecanizacao: true,
        objetoCustoMecanizacao: objMecanizacao,
        custoRetidoEquipamento: objFallback != null && objMecanizacao == null,
      })
    );
    adicionarItem(nova, {
      tipo: 'mecanizacao',
      custo: valor,
      quantidade: 0,
      litros: 0,
    });
    dados.push(nova);
  }

  return { destinos, totalDistribuido, totalSemCliente };
}

function toNumberSafe(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Reindexa o mapa após mudar objetoCusto (chave inclui o objeto). */
function reindexarMapaAtividades(mapa) {
  const novo = new Map();
  for (const row of mapa.values()) {
    const k = chaveAtividade(row);
    const ex = novo.get(k);
    if (!ex) {
      novo.set(k, row);
      continue;
    }
    ex.custoOficina = (ex.custoOficina || 0) + (row.custoOficina || 0);
    ex.custoCombustivel =
      (ex.custoCombustivel || 0) + (row.custoCombustivel || 0);
    ex.custoMaterial = (ex.custoMaterial || 0) + (row.custoMaterial || 0);
    ex.custoInsumo = (ex.custoInsumo || 0) + (row.custoInsumo || 0);
    ex.custoTransporte = (ex.custoTransporte || 0) + (row.custoTransporte || 0);
    ex.custoMecanizacao =
      (ex.custoMecanizacao || 0) + (row.custoMecanizacao || 0);
    ex.custoServicoTerceiro =
      (ex.custoServicoTerceiro || 0) + (row.custoServicoTerceiro || 0);
    ex.custoFuncionario =
      (ex.custoFuncionario || 0) + (row.custoFuncionario || 0);
    ex.kmhsRodados = (ex.kmhsRodados || 0) + (row.kmhsRodados || 0);
    ex.qtdeLitros = (ex.qtdeLitros || 0) + (row.qtdeLitros || 0);
    ex.valorAbastecimento =
      (ex.valorAbastecimento || 0) + (row.valorAbastecimento || 0);
    ex.qtdAbastecimentos =
      (ex.qtdAbastecimentos || 0) + (row.qtdAbastecimentos || 0);
    if (row.custoRetidoEquipamento) ex.custoRetidoEquipamento = true;
    if (Array.isArray(row.itens)) {
      for (const item of row.itens) adicionarItem(ex, item);
    }
    recalcularTotal(ex);
  }
  return novo;
}

function adicionarItem(row, item) {
  if (!row.itens) row.itens = [];
  if (item.codMaterial == null && !(item.custo > 0)) return;
  const key = `${item.tipo}|${item.codMaterial ?? ''}`;
  const existente = row.itens.find(
    (i) => `${i.tipo}|${i.codMaterial ?? ''}` === key
  );
  if (existente) {
    existente.custo = (existente.custo || 0) + (item.custo || 0);
    existente.quantidade = (existente.quantidade || 0) + (item.quantidade || 0);
    existente.litros = (existente.litros || 0) + (item.litros || 0);
    return;
  }
  row.itens.push({ ...item });
}

function recalcularTotal(row) {
  row.custoTotal =
    (row.custoOficina || 0) +
    (row.custoCombustivel || 0) +
    (row.custoMaterial || 0) +
    (row.custoInsumo || 0) +
    (row.custoTransporte || 0) +
    (row.custoMecanizacao || 0) +
    (row.custoServicoTerceiro || 0) +
    (row.custoFuncionario || 0) +
    (row.custoArrendamento || 0) +
    (row.custoOutros || 0) +
    (row.custoDireto || 0);
  return row;
}

const CAMPO_POR_CATEGORIA = {
  oficina: 'custoOficina',
  transporte: 'custoTransporte',
  mecanizacao: 'custoMecanizacao',
  funcionario: 'custoFuncionario',
  arrendamento: 'custoArrendamento',
  outros: 'custoOutros',
  direto: 'custoDireto',
};

function totaisPorCategoriaDados(dados = []) {
  const totais = {};
  for (const [cat, campo] of Object.entries(CAMPO_POR_CATEGORIA)) {
    totais[cat] = dados.reduce((acc, row) => acc + (row[campo] || 0), 0);
  }
  return totais;
}

function mesclarLinhaLancamento(mapa, linha) {
  const campo = CAMPO_POR_CATEGORIA[linha.categoria];
  if (!campo || !(linha.valor > 0.005)) return;

  const rowBase = {
    anomes: linha.anomes,
    objetoCustoOperacao: linha.codObjetoCusto,
    semOperacao: true,
    semAbastecimento: true,
    semMaterial: true,
    semInsumo: true,
    semServicoTerceiro: true,
    semFuncionario: linha.categoria !== 'funcionario',
    semCustoOficina: linha.categoria !== 'oficina',
    lancamentoDireto: true,
  };
  rowBase[campo] = linha.valor;

  const key = chaveAtividade(rowBase);
  const existente = mapa.get(key);
  if (existente) {
    existente[campo] = (existente[campo] || 0) + linha.valor;
    recalcularTotal(existente);
    return;
  }
  mapa.set(key, recalcularTotal(linhaVazia(rowBase)));
}

/**
 * Completa gaps entre rateio e lancamento_custo classificado.
 * Garante SUM(categorias) = total consolidado de lançamento.
 */
async function completarDistribuicaoLancamento(dados, filtros) {
  const classificado = await consultarLancamentoClassificado(filtros);
  const esperado = {};
  for (const lin of classificado) {
    esperado[lin.categoria] = (esperado[lin.categoria] || 0) + lin.valor;
  }

  const distribuido = totaisPorCategoriaDados(dados);
  const mapa = new Map(dados.map((row) => [chaveAtividade(row), row]));

  for (const categoria of ['arrendamento', 'outros', 'direto']) {
    for (const lin of classificado.filter((l) => l.categoria === categoria)) {
      mesclarLinhaLancamento(mapa, lin);
    }
  }

  for (const categoria of ['oficina', 'transporte', 'mecanizacao', 'funcionario']) {
    const gap = (esperado[categoria] || 0) - (distribuido[categoria] || 0);
    if (gap <= 0.01) continue;

    const linhasCat = classificado.filter((l) => l.categoria === categoria);
    const totalCat = linhasCat.reduce((acc, l) => acc + l.valor, 0);
    if (totalCat <= 0) continue;

    for (const lin of linhasCat) {
      const parte = (lin.valor / totalCat) * gap;
      if (parte <= 0.005) continue;
      mesclarLinhaLancamento(mapa, {
        ...lin,
        valor: parte,
      });
    }
  }

  return [...mapa.values()];
}

function precisaComplemento(row) {
  return (
    row.codOperacaoAgricola == null ||
    row.codFazenda == null ||
    row.codTalhao == null
  );
}

/**
 * Completa operação/fazenda/talhão via irrigação (OS + apontamento tipo I).
 * Se houver várias operações, rateia o custo pelo peso (área).
 */
function complementarComIrrigacao(dados, irrigacoes) {
  const irrigPorEquip = new Map();
  for (const irr of irrigacoes) {
    const key = `${irr.anomes}|${irr.codEquipamento}`;
    if (!irrigPorEquip.has(key)) irrigPorEquip.set(key, []);
    irrigPorEquip.get(key).push(irr);
  }

  const resultado = [];

  for (const row of dados) {
    if (
      row.origemLancamentoTransporte ||
      row.rateioTransporteCliente ||
      row.origemLancamentoMecanizacao ||
      row.rateioMecanizacaoCliente
    ) {
      resultado.push(row);
      continue;
    }
    if (!precisaComplemento(row) || row.codEquipamento == null) {
      resultado.push(row);
      continue;
    }

    const ops = irrigPorEquip.get(`${row.anomes}|${row.codEquipamento}`) || [];
    if (!ops.length) {
      resultado.push(row);
      continue;
    }

    // Já tem operação: só completa fazenda/talhão/objeto
    if (row.codOperacaoAgricola != null) {
      const match =
        ops.find((o) => o.codOperacaoAgricola === row.codOperacaoAgricola) ||
        ops[0];
      row.codFazenda = row.codFazenda ?? match.codFazenda;
      row.codTalhao = row.codTalhao ?? match.codTalhao;
      row.objetoCustoOperacao =
        row.objetoCustoOperacao ?? match.objetoCustoOperacao;
      row.complementarIrrigacao = true;
      row.origemIrrigacao = match.origem;
      row.semOperacao = false;
      resultado.push(row);
      continue;
    }

    const pesos = ops.map((o) =>
      o.peso != null && Number(o.peso) > 0 ? Number(o.peso) : null
    );
    const semPeso = pesos.every((p) => p == null);
    const pesoTotal = semPeso
      ? ops.length
      : pesos.reduce((acc, p) => acc + (p || 0), 0);

    for (const op of ops) {
      const fator = semPeso
        ? 1 / ops.length
        : (op.peso != null && Number(op.peso) > 0 ? Number(op.peso) : 0) /
          pesoTotal;
      if (fator <= 0) continue;
      const nova = {
        ...row,
        codOperacaoAgricola: op.codOperacaoAgricola,
        codFazenda: row.codFazenda ?? op.codFazenda,
        codTalhao: row.codTalhao ?? op.codTalhao,
        objetoCustoOperacao: row.objetoCustoOperacao ?? op.objetoCustoOperacao,
        custoOficina: (row.custoOficina || 0) * fator,
        custoCombustivel: (row.custoCombustivel || 0) * fator,
        custoMaterial: (row.custoMaterial || 0) * fator,
        custoInsumo: (row.custoInsumo || 0) * fator,
        custoTransporte: (row.custoTransporte || 0) * fator,
        custoMecanizacao: (row.custoMecanizacao || 0) * fator,
        custoServicoTerceiro: (row.custoServicoTerceiro || 0) * fator,
        custoFuncionario: (row.custoFuncionario || 0) * fator,
        custoRateadoAtividade: (row.custoRateadoAtividade || 0) * fator,
        kmhsRodados: (row.kmhsRodados || 0) * fator,
        qtdeLitros: (row.qtdeLitros || 0) * fator,
        valorAbastecimento: (row.valorAbastecimento || 0) * fator,
        quantidadeMaterial: (row.quantidadeMaterial || 0) * fator,
        quantidadeInsumo: (row.quantidadeInsumo || 0) * fator,
        quantidadeServicoTerceiro:
          (row.quantidadeServicoTerceiro || 0) * fator,
        complementarIrrigacao: true,
        origemIrrigacao: op.origem,
        percentualComplementoIrrigacao: fator,
        semOperacao: op.codOperacaoAgricola == null,
      };
      resultado.push(recalcularTotal(nova));
    }
  }

  // Reagrupa chaves iguais após complemento
  const mapa = new Map();
  for (const row of resultado) {
    const key = chaveAtividade(row);
    const existente = mapa.get(key);
    if (!existente) {
      mapa.set(key, row);
      continue;
    }

    existente.custoOficina += row.custoOficina || 0;
    existente.custoCombustivel += row.custoCombustivel || 0;
    existente.custoMaterial += row.custoMaterial || 0;
    existente.custoInsumo += row.custoInsumo || 0;
    existente.custoTransporte =
      (existente.custoTransporte || 0) + (row.custoTransporte || 0);
    existente.custoMecanizacao =
      (existente.custoMecanizacao || 0) + (row.custoMecanizacao || 0);
    existente.custoServicoTerceiro =
      (existente.custoServicoTerceiro || 0) + (row.custoServicoTerceiro || 0);
    existente.custoFuncionario =
      (existente.custoFuncionario || 0) + (row.custoFuncionario || 0);
    existente.kmhsRodados += row.kmhsRodados || 0;
    existente.qtdeLitros += row.qtdeLitros || 0;
    existente.valorAbastecimento += row.valorAbastecimento || 0;
    existente.quantidadeMaterial += row.quantidadeMaterial || 0;
    existente.quantidadeInsumo += row.quantidadeInsumo || 0;
    existente.quantidadeServicoTerceiro =
      (existente.quantidadeServicoTerceiro || 0) +
      (row.quantidadeServicoTerceiro || 0);
    existente.complementarIrrigacao =
      existente.complementarIrrigacao || row.complementarIrrigacao;
    existente.origemIrrigacao =
      existente.origemIrrigacao || row.origemIrrigacao;
    recalcularTotal(existente);
  }

  return [...mapa.values()];
}

/**
 * Pipeline consolidado:
 * 1) Oficina → equipamento (horas OS) → operação (kmhs abastecimento)
 * 2) Combustível por operação (abastecimento)
 * 3) Material de manutenção (requisição + apontamento automotivo)
 * 4) Insumo agrícola (apontamentomaterial + apontamentoitem)
 * 5) Serviços de terceiro (contrato variável: cod_servico = operação)
 * 6) Funcionário (tipo R, grupo 10; 3/1/3 por horas de apontamento; demais no objeto)
 *
 * custoTotal = oficina + combustível + material + insumo + transporte + mecanização + serviços 3º + funcionário
 */
export async function consultarRateioAtividades(filtros = {}, opcoes = {}) {
  const somenteLancamento = opcoes.somenteLancamento === true;
  // Oficina: sempre negocio 3 / processo 1 / subprocesso 1 (query de rateio).
  // Transporte: lancamento 3/1/2 tipo R + empenho 1/2 → OS só 3/1/2 → clientes.
  // Mecanização: lancamento 3/1/3 tipo R + empenho 1/2 → OS só 3/1/3 → clientes.
  // Abastecimento: todas as ops do período (rateio justo por kmhs).
  // Material/insumo + recorte final: filtro de objeto (ex.: plantio = processo 1 / sub 2).
  const periodo = filtrosPeriodo(filtros);
  const resultado = filtrosResultado(filtros);
  const filtroObjetoAtivo = temFiltroObjeto(resultado);

  // Sequencial: evita derrubar o túnel/DB com várias queries pesadas em paralelo
  const custoEquipamento = await consultarResumoPorEquipamento(periodo);
  const custoTransporteEq = await consultarResumoPorEquipamentoTransporte(
    periodo
  );
  const custoMecanizacaoEq = await consultarResumoPorEquipamentoMecanizacao(
    periodo
  );
  const atividades = await consultarBaseAtividades(periodo);
  const combustivelItens = somenteLancamento
    ? []
    : await consultarBaseCombustivelItens(resultado);
  const materiais = somenteLancamento ? [] : await consultarBaseMateriais(resultado);
  const insumos = somenteLancamento ? [] : await consultarBaseInsumos(resultado);
  const servicosTerceiro = somenteLancamento
    ? []
    : await consultarBaseServicosTerceiro(resultado);
  const servicosTerceiroFixo = somenteLancamento
    ? []
    : await consultarBaseServicosTerceiroFixo(resultado);
  const funcionarios = await consultarBaseFuncionarios(periodo);
  const irrigacoes = somenteLancamento ? [] : await consultarBaseIrrigacao(resultado);
  const mapasTransporte = await carregarMapasTransporteCliente();
  const mapasMecanizacao = await carregarMapasMecanizacaoCliente();
  const objetosOk = filtroObjetoAtivo
    ? await codigosObjetoPermitidos(resultado)
    : null;

  const custoPorChave = new Map(
    custoEquipamento.dados.map((row) => [
      `${row.anomes}|${row.codEquipamento}`,
      row,
    ])
  );

  const kmhsPorEquipamento = new Map();
  for (const row of atividades) {
    const key = `${row.anomes}|${row.codEquipamento}`;
    kmhsPorEquipamento.set(
      key,
      (kmhsPorEquipamento.get(key) || 0) + (row.kmhsRodados || 0)
    );
  }

  const mapa = new Map();

  for (const atividade of atividades) {
    const eqKey = `${atividade.anomes}|${atividade.codEquipamento}`;
    const custoEq = custoPorChave.get(eqKey);
    const kmhsTotal = kmhsPorEquipamento.get(eqKey) || 0;
    const custoRateadoEquipamento = custoEq?.custoRateado || 0;
    const percentualAtividade =
      kmhsTotal > 0 ? atividade.kmhsRodados / kmhsTotal : 0;
    const custoOficina = custoRateadoEquipamento * percentualAtividade;
    const custoCombustivel = somenteLancamento ? 0 : atividade.valorAbastecimento || 0;

    const row = linhaVazia({
      anomes: atividade.anomes,
      codEquipamento: atividade.codEquipamento,
      codTipoEquipamento: atividade.codTipoEquipamento,
      codOperacaoAgricola: atividade.codOperacaoAgricola,
      codFazenda: atividade.codFazenda,
      codTalhao: atividade.codTalhao,
      objetoCustoOperacao: atividade.objetoCustoOperacao,
      kmhsRodados: atividade.kmhsRodados,
      kmhsTotalEquipamento: kmhsTotal,
      qtdeLitros: atividade.qtdeLitros,
      valorAbastecimento: custoCombustivel,
      qtdAbastecimentos: atividade.qtdAbastecimentos,
      horasOs: custoEq?.horasOs ?? null,
      percentualRateioEquipamento: custoEq?.percentualRateio ?? null,
      custoRateadoEquipamento,
      percentualRateioAtividade: percentualAtividade,
      custoOficina,
      custoCombustivel,
      custoMaterial: 0,
      custoInsumo: 0,
      custoRateadoAtividade: custoOficina,
      semCustoOficina: !custoEq,
      semOperacao: atividade.codOperacaoAgricola == null,
      semAbastecimento: false,
      semMaterial: true,
      semInsumo: true,
    });

    mapa.set(chaveAtividade(row), recalcularTotal(row));
  }

  // Sem objeto e fora do transporte/mecanização com clientes → objeto vigente
  atribuirObjetoEquipamentoNasLinhas(
    [...mapa.values()],
    mapasTransporte,
    mapasMecanizacao
  );
  const mapaReindexado = reindexarMapaAtividades(mapa);
  mapa.clear();
  for (const [k, v] of mapaReindexado.entries()) mapa.set(k, v);

  for (const material of materiais) {
    const objetoCusto =
      material.objetoCustoOperacao ?? material.objetoCustoRequisicao ?? null;
    const materialRow = {
      ...material,
      objetoCustoOperacao: objetoCusto,
    };
    const key = chaveAtividade(materialRow);
    const existente = mapa.get(key);
    const itemMaterial = {
      tipo: 'material',
      nrRequisicao: material.nrRequisicao ?? null,
      codMaterial: material.codMaterial ?? null,
      descricaoMaterial: material.descricaoMaterial ?? null,
      quantidade: material.quantidade || 0,
      custo: material.custoMaterial || 0,
      litros: 0,
    };

    if (existente) {
      existente.custoMaterial =
        (existente.custoMaterial || 0) + (material.custoMaterial || 0);
      existente.quantidadeMaterial =
        (existente.quantidadeMaterial || 0) + (material.quantidade || 0);
      existente.qtdItensMaterial =
        (existente.qtdItensMaterial || 0) + (material.qtdItens || 0);
      existente.objetoCustoRequisicao =
        existente.objetoCustoRequisicao ?? material.objetoCustoRequisicao;
      existente.objetoCustoOperacao =
        existente.objetoCustoOperacao ?? objetoCusto;
      existente.semMaterial = false;
      existente.semVinculoCompleto =
        material.codEquipamento == null &&
        material.codOperacaoAgricola == null;
      adicionarItem(existente, itemMaterial);
      recalcularTotal(existente);
      continue;
    }

    const eqKey = `${material.anomes}|${material.codEquipamento}`;
    const custoEq = custoPorChave.get(eqKey);

    const nova = recalcularTotal(
      linhaVazia({
        anomes: material.anomes,
        codEquipamento: material.codEquipamento,
        codOperacaoAgricola: material.codOperacaoAgricola,
        codFazenda: material.codFazenda,
        codTalhao: material.codTalhao,
        objetoCustoOperacao: objetoCusto,
        objetoCustoRequisicao: material.objetoCustoRequisicao,
        quantidadeMaterial: material.quantidade || 0,
        qtdItensMaterial: material.qtdItens || 0,
        horasOs: custoEq?.horasOs ?? null,
        percentualRateioEquipamento: custoEq?.percentualRateio ?? null,
        custoRateadoEquipamento: custoEq?.custoRateado || 0,
        custoMaterial: material.custoMaterial || 0,
        semCustoOficina: !custoEq,
        semOperacao: material.codOperacaoAgricola == null,
        semAbastecimento: true,
        semMaterial: false,
        semInsumo: true,
        semVinculoCompleto:
          material.codEquipamento == null &&
          material.codOperacaoAgricola == null,
      })
    );
    adicionarItem(nova, itemMaterial);
    mapa.set(key, nova);
  }

  for (const insumo of insumos) {
    const objetoCusto =
      insumo.objetoCustoOperacao ?? insumo.objetoCustoRequisicao ?? null;
    const insumoRow = {
      ...insumo,
      objetoCustoOperacao: objetoCusto,
    };
    const key = chaveAtividade(insumoRow);
    const existente = mapa.get(key);
    const itemInsumo = {
      tipo: 'insumo',
      codMaterial: insumo.codMaterial ?? null,
      quantidade: insumo.quantidade || 0,
      custo: insumo.custoInsumo || 0,
      litros: 0,
    };

    if (existente) {
      existente.custoInsumo =
        (existente.custoInsumo || 0) + (insumo.custoInsumo || 0);
      existente.quantidadeInsumo =
        (existente.quantidadeInsumo || 0) + (insumo.quantidade || 0);
      existente.qtdItensInsumo =
        (existente.qtdItensInsumo || 0) + (insumo.qtdItens || 0);
      existente.objetoCustoRequisicao =
        existente.objetoCustoRequisicao ?? insumo.objetoCustoRequisicao;
      existente.objetoCustoOperacao =
        existente.objetoCustoOperacao ?? objetoCusto;
      existente.semInsumo = false;
      adicionarItem(existente, itemInsumo);
      recalcularTotal(existente);
      continue;
    }

    const eqKey = `${insumo.anomes}|${insumo.codEquipamento}`;
    const custoEq = custoPorChave.get(eqKey);

    const nova = recalcularTotal(
      linhaVazia({
        anomes: insumo.anomes,
        codEquipamento: insumo.codEquipamento,
        codOperacaoAgricola: insumo.codOperacaoAgricola,
        codFazenda: insumo.codFazenda,
        codTalhao: insumo.codTalhao,
        objetoCustoOperacao: objetoCusto,
        objetoCustoRequisicao: insumo.objetoCustoRequisicao,
        quantidadeInsumo: insumo.quantidade || 0,
        qtdItensInsumo: insumo.qtdItens || 0,
        horasOs: custoEq?.horasOs ?? null,
        percentualRateioEquipamento: custoEq?.percentualRateio ?? null,
        custoRateadoEquipamento: custoEq?.custoRateado || 0,
        custoInsumo: insumo.custoInsumo || 0,
        semCustoOficina: !custoEq,
        semOperacao: insumo.codOperacaoAgricola == null,
        semAbastecimento: true,
        semMaterial: true,
        semInsumo: false,
        semVinculoCompleto:
          insumo.codEquipamento == null &&
          insumo.codOperacaoAgricola == null,
      })
    );
    adicionarItem(nova, itemInsumo);
    mapa.set(key, nova);
  }

  mesclarServicosTerceiro(
    mapa,
    servicosTerceiro,
    custoPorChave,
    'servico-terceiro'
  );
  mesclarServicosTerceiro(
    mapa,
    servicosTerceiroFixo,
    custoPorChave,
    'servico-terceiro-fixo'
  );
  mesclarFuncionarios(mapa, funcionarios, custoPorChave);

  for (const comb of combustivelItens) {
    const key = chaveAtividade(comb);
    const existente = mapa.get(key);
    if (!existente) continue;
    adicionarItem(existente, {
      tipo: 'combustivel',
      codMaterial: comb.codMaterial ?? null,
      quantidade: comb.qtdeLitros || 0,
      litros: comb.qtdeLitros || 0,
      custo: comb.valorAbastecimento || 0,
    });
  }

  const dadosBrutos = [...mapa.values()];
  let dados = complementarComIrrigacao(dadosBrutos, irrigacoes);

  // Após irrigação, tenta de novo amarrar objeto do equipamento
  atribuirObjetoEquipamentoNasLinhas(
    dados,
    mapasTransporte,
    mapasMecanizacao
  );

  const abastPorEquipamento = agregarAbastecimentoPorEquipamento(atividades);

  // Eq sem operação: transporte/mecanização → clientes; demais → objeto do equip.
  const {
    totalSemOperacao,
    totalRateadoTransporteCliente,
    destinosTransporte,
    totalRateadoMecanizacaoCliente,
    destinosMecanizacao,
  } = fecharOficinaSemOperacao(
    dados,
    custoEquipamento.dados,
    mapasTransporte,
    abastPorEquipamento,
    mapasMecanizacao,
    { somenteLancamento }
  );

  const {
    destinos: destinosLancamentoTransporte,
    totalDistribuido: totalCustoTransporteDistribuido,
    totalSemCliente: totalTransporteSemCliente,
  } = distribuirLancamentoTransporte(
    dados,
    custoTransporteEq.dados,
    mapasTransporte
  );

  const {
    destinos: destinosLancamentoMecanizacao,
    totalDistribuido: totalCustoMecanizacaoDistribuido,
    totalSemCliente: totalMecanizacaoSemCliente,
  } = distribuirLancamentoMecanizacao(
    dados,
    custoMecanizacaoEq.dados,
    mapasMecanizacao,
    mapasTransporte
  );

  // Tratores de colheita cana (entrada cana máquina) → calendário com carry-forward → obj 116
  const colheitaCana = await aplicarRateioColheitaCana({
    dados,
    custoEquipamentoDados: custoEquipamento.dados,
    filtros: periodo,
  });
  dados = colheitaCana.dados;

  if (somenteLancamento) {
    dados = await completarDistribuicaoLancamento(dados, resultado);
  }

  if (objetosOk) {
    dados = dados.filter((row) => {
      const obj = Number(objetoCustoEfetivo(row));
      if (Number.isFinite(obj) && objetosOk.has(obj)) return true;
      // Retido sem objeto cadastrado no histórico — ainda entra no total
      if (row.custoRetidoEquipamento && !Number.isFinite(obj)) return true;
      return false;
    });
  }

  dados = dados.sort((a, b) =>
    chaveAtividade(a).localeCompare(chaveAtividade(b), 'pt-BR')
  );

  const totalCustoOficinaDistribuido = dados.reduce(
    (acc, row) => acc + (row.custoOficina || 0),
    0
  );
  const totalCustoCombustivel = dados.reduce(
    (acc, row) => acc + (row.custoCombustivel || 0),
    0
  );
  const totalCustoMaterial = dados.reduce(
    (acc, row) => acc + (row.custoMaterial || 0),
    0
  );
  const totalCustoInsumo = dados.reduce(
    (acc, row) => acc + (row.custoInsumo || 0),
    0
  );
  const totalCustoTransporte = dados.reduce(
    (acc, row) => acc + (row.custoTransporte || 0),
    0
  );
  const totalCustoMecanizacao = dados.reduce(
    (acc, row) => acc + (row.custoMecanizacao || 0),
    0
  );
  const totalCustoServicoTerceiro = dados.reduce(
    (acc, row) => acc + (row.custoServicoTerceiro || 0),
    0
  );
  const totalCustoFuncionario = dados.reduce(
    (acc, row) => acc + (row.custoFuncionario || 0),
    0
  );
  const totalCustoArrendamento = dados.reduce(
    (acc, row) => acc + (row.custoArrendamento || 0),
    0
  );
  const totalCustoOutros = dados.reduce(
    (acc, row) => acc + (row.custoOutros || 0),
    0
  );
  const totalCustoDireto = dados.reduce(
    (acc, row) => acc + (row.custoDireto || 0),
    0
  );
  const totalCustoOficinaPool = custoEquipamento.dados.reduce(
    (acc, row) => acc + (row.custoRateado || 0),
    0
  );
  const totalCustoTransportePool = custoTransporteEq.dados.reduce(
    (acc, row) => acc + (row.custoRateado || 0),
    0
  );
  const totalCustoMecanizacaoPool = custoMecanizacaoEq.dados.reduce(
    (acc, row) => acc + (row.custoRateado || 0),
    0
  );
  const totalOficinaRetida = dados.reduce(
    (acc, row) =>
      acc + (row.custoRetidoEquipamento ? row.custoOficina || 0 : 0),
    0
  );
  // KPI Oficina = soma das linhas exibidas (inclui retido no equipamento)
  const totalCustoOficina = totalCustoOficinaDistribuido;
  const totalCustoConsolidado =
    totalCustoOficinaDistribuido +
    totalCustoCombustivel +
    totalCustoMaterial +
    totalCustoInsumo +
    totalCustoTransporte +
    totalCustoMecanizacao +
    totalCustoServicoTerceiro +
    totalCustoFuncionario +
    totalCustoArrendamento +
    totalCustoOutros +
    totalCustoDireto;

  return {
    filtros: {
      ...resultado,
      somenteLancamento,
      origemOficina: FILTRO_OFICINA,
      origemTransporte: FILTRO_TRANSPORTE_LANC,
      origemMecanizacao: FILTRO_MECANIZACAO_LANC,
      origemFuncionario: FILTRO_FUNCIONARIO,
      filtroObjetoAtivo,
    },
    logica: {
      etapa1:
        'oficina: lancamento_custo tipo R + empenho tipo 1 ou 2 (negocio=3, processo=1, subprocesso=1) rateado por horas OS',
      etapa2:
        'com apontamento: custo do equipamento rateado por operação (kmhs abastecimento)',
      etapa2b:
        'sem apontamento + transporte (3/1/2): residual de oficina → objetos clientes (prestador/unidade), proporcional às unidades',
      etapa2b2:
        'sem apontamento + mecanização (3/1/3): residual de oficina → objetos clientes (prestador/unidade), proporcional às unidades; sem cliente permanece no objeto 3/1/3',
      etapa2c:
        'sem apontamento e fora do transporte/mecanização com clientes: oficina + combustível/litros/horas no objeto vigente do equipamento (historicoequipamentoobcusto) para R$/h e L/h',
      etapa2e:
        'transporte (3/1/2): lancamento_custo tipo R + empenho 1 ou 2 rateado por horas OS só entre equipamentos vigentes em 3/1/2 → objetos clientes (prestador/unidade); não passa por apontamento',
      etapa2f:
        'mecanização (3/1/3): lancamento_custo tipo R + empenho 1 ou 2 rateado por horas OS só entre equipamentos vigentes em 3/1/3 → objetos clientes (prestador/unidade); não passa por apontamento',
      etapa2d: `colheita cana (objeto ${OBJETO_COLHEITA_CANA}): só tratores (tipo vigente 12/93/64/6) da entrada cana máquina + carry-forward dia a dia; não-tratores da entrada cana mantêm path normal; apontamento de outra operação interrompe e muda o objeto`,
      etapa3: 'material de manutenção (requisição + apontamento automotivo)',
      etapa4:
        'insumo agrícola (apontamentomaterial + apontamentoitem.cod_operacao)',
      etapa5:
        'serviços de terceiro: variável (itemcontratovariavel.cod_servico = operação) + fixo (parcelascontrato.valor, historicocontrato F; destino só o objeto da parcela, sem operação); empenho tipo 1 ou 2',
      etapa5b:
        'funcionário: lancamento_custo tipo R + grupoempenho 10 + empenho 1/2; exclui oficina 3/1/1 e transporte 3/1/2; mecanização 3/1/3 rateada por tothoras_trabalhadas do apontamento dos equipamentos vigentes no objeto; demais objetos retidos; não entra em custoOperacao/R$/h',
      etapa6:
        'complemento irrigação (irrigacaoosinsumo/ositem + apontamento tipo I)',
      consolidado:
        'custoTotal = custoOficina + custoCombustivel + custoMaterial + custoInsumo + custoTransporte + custoMecanizacao + custoServicoTerceiro + custoFuncionario',
      oficinaKpi:
        'KPI Oficina = SUM das linhas (inclui custo retido em equipamento sem atividade/transporte/mecanização-cliente)',
      colheitaCana: colheitaCana.resumo?.logica,
    },
    resumo: {
      totalLinhas: dados.length,
      totalCustoOficina,
      totalCustoOficinaDistribuido,
      totalCustoCombustivel,
      totalCustoMaterial,
      totalCustoInsumo,
      totalCustoTransporte,
      totalCustoMecanizacao,
      totalCustoServicoTerceiro,
      totalCustoFuncionario,
      totalCustoArrendamento,
      totalCustoOutros,
      totalCustoDireto,
      totalCustoConsolidado,
      totalCustoRateadoAtividade: totalCustoOficinaDistribuido,
      totalCustoOficinaPool,
      totalCustoTransportePool,
      totalCustoMecanizacaoPool,
      custoNaoDistribuido: Math.max(
        0,
        totalCustoOficinaPool - totalCustoOficinaDistribuido
      ),
      oficinaSemOperacao: totalSemOperacao,
      oficinaRetidaEquipamento: totalOficinaRetida,
      oficinaRateadoTransporteCliente: totalRateadoTransporteCliente,
      oficinaRateadoMecanizacaoCliente: totalRateadoMecanizacaoCliente,
      transporteLancamentoClientes: totalCustoTransporteDistribuido,
      transporteSemCliente: totalTransporteSemCliente,
      mecanizacaoLancamentoClientes: totalCustoMecanizacaoDistribuido,
      mecanizacaoSemCliente: totalMecanizacaoSemCliente,
      qtdDestinosTransporte:
        destinosTransporte.length + destinosLancamentoTransporte.length,
      qtdDestinosMecanizacao:
        destinosMecanizacao.length + destinosLancamentoMecanizacao.length,
      colheitaCana: colheitaCana.resumo,
      filtroObjetoAtivo,
      qtdComplementadasIrrigacao: dados.filter((r) => r.complementarIrrigacao)
        .length,
      qtdSemVinculoCompleto: dados.filter((r) => r.semVinculoCompleto).length,
      qtdEquipamentos: new Set(
        dados.map((r) => r.codEquipamento).filter((v) => v != null)
      ).size,
      qtdOperacoes: new Set(
        dados.map((r) => r.codOperacaoAgricola).filter((v) => v != null)
      ).size,
      qtdPeriodos: new Set(dados.map((r) => r.anomes).filter(Boolean)).size,
    },
    transporteDestinos: [
      ...destinosTransporte,
      ...destinosLancamentoTransporte,
    ],
    mecanizacaoDestinos: [
      ...destinosMecanizacao,
      ...destinosLancamentoMecanizacao,
    ],
    dados,
  };
}

/**
 * Diagnóstico: quem recebeu oficina por OS, quem não enviou para operação,
 * e para qual objeto/operação cada equipamento está mandando.
 */
export async function consultarDiagnosticoFluxoOficina(filtros = {}) {
  const periodo = filtrosPeriodo(filtros);
  const custoEquipamento = await consultarResumoPorEquipamento(periodo);
  const atividades = await consultarBaseAtividades(periodo);
  const mapasTransporte = await carregarMapasTransporteCliente();
  const mapasMecanizacao = await carregarMapasMecanizacaoCliente();

  const eqParaObj = mapasTransporte.eqParaObjTransporte;
  const eqParaObjAtual = mapasTransporte.eqParaObjAtual ?? new Map();
  const clientesPorObj = mapasTransporte.clientesPorObjTransporte;
  const eqParaObjMec = mapasMecanizacao.eqParaObjMecanizacao;
  const clientesPorObjMec = mapasMecanizacao.clientesPorObjMecanizacao;

  const atividadesPorEq = new Map();
  for (const a of atividades) {
    const key = `${a.anomes}|${a.codEquipamento}`;
    if (!atividadesPorEq.has(key)) atividadesPorEq.set(key, []);
    atividadesPorEq.get(key).push(a);
  }

  const semEnvio = [];
  const destino = [];
  const destinoTransporte = [];
  const destinoMecanizacao = [];
  let totalSemEnvio = 0;
  let totalEnviado = 0;
  let totalTransporteCliente = 0;
  let totalMecanizacaoCliente = 0;

  for (const eq of custoEquipamento.dados) {
    const custoRecebido = eq.custoRateado || 0;
    if (Math.abs(custoRecebido) < 0.005) continue;

    const key = `${eq.anomes}|${eq.codEquipamento}`;
    const ops = (atividadesPorEq.get(key) || []).filter(
      (a) => a.codOperacaoAgricola != null && (a.kmhsRodados || 0) > 0
    );
    const kmhsTotal = ops.reduce((acc, a) => acc + (a.kmhsRodados || 0), 0);

    if (!ops.length || kmhsTotal <= 0) {
      const codEq = Number(eq.codEquipamento);
      const objTransporte = eqParaObj.get(codEq);
      const clientes =
        objTransporte != null ? clientesPorObj.get(objTransporte) || [] : [];
      const pesoTotal = clientes.reduce((acc, c) => acc + (c.peso || 0), 0);

      if (objTransporte != null && clientes.length && pesoTotal > 0) {
        let acumulado = 0;
        for (let i = 0; i < clientes.length; i += 1) {
          const { objetoCliente, peso } = clientes[i];
          const parte =
            i === clientes.length - 1
              ? custoRecebido - acumulado
              : custoRecebido * (peso / pesoTotal);
          acumulado += parte;
          totalTransporteCliente += parte;
          totalEnviado += parte;
          destinoTransporte.push({
            anomes: eq.anomes != null ? String(eq.anomes) : null,
            codEquipamento: eq.codEquipamento,
            objetoCustoTransporte: objTransporte,
            objetoCustoCliente: objetoCliente,
            horasOs: eq.horasOs,
            percentualEnvio: peso / pesoTotal,
            custoEnviado: parte,
            origem: 'oficina-residual',
          });
          destino.push({
            anomes: eq.anomes != null ? String(eq.anomes) : null,
            codEquipamento: eq.codEquipamento,
            horasOs: eq.horasOs,
            percentualRateioEq: eq.percentualRateio,
            custoRecebidoEq: custoRecebido,
            codOperacaoAgricola: null,
            objetoCusto: objetoCliente,
            objetoCustoTransporte: objTransporte,
            codFazenda: null,
            codTalhao: null,
            kmhsRodados: null,
            kmhsTotalEquipamento: null,
            percentualEnvio: peso / pesoTotal,
            custoEnviado: parte,
            via: 'transporte-cliente',
          });
        }
        continue;
      }

      const objMecanizacao = eqParaObjMec.get(codEq);
      const mec = clientesComPeso(objMecanizacao, clientesPorObjMec);
      if (mec.ok) {
        const partes = fatiarCustoParaClientes(custoRecebido, mec.clientes);
        for (const parte of partes) {
          totalMecanizacaoCliente += parte.valor;
          totalEnviado += parte.valor;
          destinoMecanizacao.push({
            anomes: eq.anomes != null ? String(eq.anomes) : null,
            codEquipamento: eq.codEquipamento,
            objetoCustoMecanizacao: objMecanizacao,
            objetoCustoCliente: parte.objetoCliente,
            horasOs: eq.horasOs,
            percentualEnvio: parte.percentual,
            custoEnviado: parte.valor,
            origem: 'oficina-residual',
          });
          destino.push({
            anomes: eq.anomes != null ? String(eq.anomes) : null,
            codEquipamento: eq.codEquipamento,
            horasOs: eq.horasOs,
            percentualRateioEq: eq.percentualRateio,
            custoRecebidoEq: custoRecebido,
            codOperacaoAgricola: null,
            objetoCusto: parte.objetoCliente,
            objetoCustoMecanizacao: objMecanizacao,
            codFazenda: null,
            codTalhao: null,
            kmhsRodados: null,
            kmhsTotalEquipamento: null,
            percentualEnvio: parte.percentual,
            custoEnviado: parte.valor,
            via: 'mecanizacao-cliente',
          });
        }
        continue;
      }

      const objEquipamento = eqParaObjAtual.get(codEq) ?? null;
      totalSemEnvio += custoRecebido;
      if (objEquipamento != null) {
        totalEnviado += custoRecebido;
        destino.push({
          anomes: eq.anomes != null ? String(eq.anomes) : null,
          codEquipamento: eq.codEquipamento,
          horasOs: eq.horasOs,
          percentualRateioEq: eq.percentualRateio,
          custoRecebidoEq: custoRecebido,
          codOperacaoAgricola: null,
          objetoCusto: objEquipamento,
          codFazenda: null,
          codTalhao: null,
          kmhsRodados: null,
          kmhsTotalEquipamento: null,
          percentualEnvio: 1,
          custoEnviado: custoRecebido,
          via: 'objeto-equipamento',
        });
      }
      semEnvio.push({
        anomes: eq.anomes != null ? String(eq.anomes) : null,
        codEquipamento: eq.codEquipamento,
        horasOs: eq.horasOs,
        percentualRateio: eq.percentualRateio,
        custoRecebido,
        custoEnviado: objEquipamento != null ? custoRecebido : 0,
        objetoCustoTransporte: objTransporte ?? null,
        objetoCustoMecanizacao: objMecanizacao ?? null,
        objetoCustoEquipamento: objEquipamento,
        destino:
          objEquipamento != null
            ? `lançado no objeto de custo do equipamento (${objEquipamento})`
            : objTransporte != null
              ? 'transporte sem objeto cliente e sem objeto do equipamento'
              : objMecanizacao != null
                ? 'mecanização sem objeto cliente e sem objeto do equipamento'
                : 'sem apontamento, fora do transporte/mecanização e sem objeto no histórico',
        motivo: 'sem_apontamento',
      });
      continue;
    }

    let enviadoEq = 0;
    for (const a of ops) {
      const custoOficina = custoRecebido * ((a.kmhsRodados || 0) / kmhsTotal);
      enviadoEq += custoOficina;
      totalEnviado += custoOficina;
      destino.push({
        anomes: eq.anomes != null ? String(eq.anomes) : null,
        codEquipamento: eq.codEquipamento,
        horasOs: eq.horasOs,
        percentualRateioEq: eq.percentualRateio,
        custoRecebidoEq: custoRecebido,
        codOperacaoAgricola: a.codOperacaoAgricola,
        objetoCusto: a.objetoCustoOperacao ?? null,
        codFazenda: a.codFazenda ?? null,
        codTalhao: a.codTalhao ?? null,
        kmhsRodados: a.kmhsRodados || 0,
        kmhsTotalEquipamento: kmhsTotal,
        percentualEnvio: (a.kmhsRodados || 0) / kmhsTotal,
        custoEnviado: custoOficina,
        via: 'apontamento',
      });
    }

    const sobra = custoRecebido - enviadoEq;
    if (Math.abs(sobra) >= 0.05) {
      totalSemEnvio += sobra;
      semEnvio.push({
        anomes: eq.anomes != null ? String(eq.anomes) : null,
        codEquipamento: eq.codEquipamento,
        horasOs: eq.horasOs,
        percentualRateio: eq.percentualRateio,
        custoRecebido: sobra,
        custoEnviado: enviadoEq,
        destino: 'residual de arredondamento',
        motivo: 'residual',
      });
    }
  }

  semEnvio.sort((a, b) => {
    const c = String(a.anomes).localeCompare(String(b.anomes));
    if (c !== 0) return c;
    return (b.custoRecebido || 0) - (a.custoRecebido || 0);
  });
  destino.sort((a, b) => {
    const c = String(a.anomes).localeCompare(String(b.anomes));
    if (c !== 0) return c;
    return (b.custoEnviado || 0) - (a.custoEnviado || 0);
  });
  destinoTransporte.sort((a, b) => {
    const c = String(a.anomes).localeCompare(String(b.anomes));
    if (c !== 0) return c;
    return (b.custoEnviado || 0) - (a.custoEnviado || 0);
  });
  destinoMecanizacao.sort((a, b) => {
    const c = String(a.anomes).localeCompare(String(b.anomes));
    if (c !== 0) return c;
    return (b.custoEnviado || 0) - (a.custoEnviado || 0);
  });

  return {
    resumo: {
      qtdSemEnvio: semEnvio.filter((r) => r.motivo === 'sem_apontamento').length,
      totalSemEnvio,
      qtdDestinos: destino.length,
      totalEnviado,
      totalTransporteCliente,
      totalMecanizacaoCliente,
      qtdDestinosTransporte: destinoTransporte.length,
      qtdDestinosMecanizacao: destinoMecanizacao.length,
      qtdEquipamentosComEnvio: new Set(
        destino.map((d) => `${d.anomes}|${d.codEquipamento}`)
      ).size,
    },
    semEnvio,
    destino,
    destinoTransporte,
    destinoMecanizacao,
  };
}
