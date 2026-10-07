import { executeQuery } from '../utils/oracle.js';
import { consultarRateioAtividades } from './rateioAtividadeService.js';
import { carregarMapasTransporteCliente } from './transporteOficinaService.js';
import { carregarMapasMecanizacaoCliente } from './mecanizacaoOficinaService.js';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function objetoEfetivo(row) {
  return row.objetoCustoOperacao ?? row.objetoCustoRequisicao ?? null;
}

function isTransporteMeta(meta) {
  return (
    meta != null &&
    Number(meta.negocio) === 3 &&
    Number(meta.processo) === 1 &&
    Number(meta.subprocesso) === 2
  );
}

function isMecanizacaoMeta(meta) {
  return (
    meta != null &&
    Number(meta.negocio) === 3 &&
    Number(meta.processo) === 1 &&
    Number(meta.subprocesso) === 3
  );
}

function viaOficina(row) {
  if (row.origemLancamentoTransporte) return 'transporte-cliente';
  if (row.rateioTransporteCliente) return 'transporte-cliente';
  if (row.origemLancamentoMecanizacao) return 'mecanizacao-cliente';
  if (row.rateioMecanizacaoCliente) return 'mecanizacao-cliente';
  if (row.rateioColheitaCana) return 'colheita-cana';
  if (row.custoRetidoEquipamento) return 'objeto-equipamento';
  if (row.codOperacaoAgricola != null && !row.semOperacao) return 'apontamento';
  return 'sem-operacao';
}

function viaMaterial(row) {
  if (row.codOperacaoAgricola != null) return 'apontamento';
  if (row.objetoCustoRequisicao != null) return 'objeto-requisicao';
  return 'sem-destino';
}

function viaCombustivel(row) {
  if (row.codOperacaoAgricola != null) return 'apontamento';
  if (row.custoRetidoEquipamento) return 'objeto-equipamento';
  if (row.rateioColheitaCana) return 'colheita-cana';
  return 'sem-operacao';
}

function viaServico(row) {
  if (row.codOperacaoAgricola != null) return 'operacao-contrato';
  if (objetoEfetivo(row) != null) return 'objeto-contrato';
  return 'sem-destino';
}

function viaFuncionario(row) {
  if (row.viaFuncionario === 'apontamento-mecanizacao') return 'apontamento';
  if (row.viaFuncionario === 'residual-mecanizacao') return 'residual-mecanizacao';
  if (row.viaFuncionario === 'objeto-retido') return 'objeto-retido';
  if (row.codOperacaoAgricola != null) return 'apontamento';
  if (objetoEfetivo(row) != null) return 'objeto-retido';
  return 'sem-destino';
}

function addVia(mapa, tipo, via, valor) {
  if (Math.abs(valor) < 0.005) return;
  const key = `${tipo}|${via}`;
  const cur = mapa.get(key) || {
    tipo,
    via,
    valor: 0,
    qtdLinhas: 0,
  };
  cur.valor += valor;
  cur.qtdLinhas += 1;
  mapa.set(key, cur);
}

function addDestino(mapa, row, meta) {
  const objetoCusto = objetoEfetivo(row);
  const key = String(objetoCusto ?? 'sem-objeto');
  const cur = mapa.get(key) || {
    objetoCusto,
    descricao: meta?.descricao ?? null,
    negocio: meta?.negocio ?? null,
    processo: meta?.processo ?? null,
    subprocesso: meta?.subprocesso ?? null,
    atividade: meta?.atividade ?? null,
    isTransporte: isTransporteMeta(meta),
    isMecanizacao: isMecanizacaoMeta(meta),
    custoOficina: 0,
    custoCombustivel: 0,
    custoMaterial: 0,
    custoInsumo: 0,
    custoTransporte: 0,
    custoMecanizacao: 0,
    custoServicoTerceiro: 0,
    custoFuncionario: 0,
    custoTotal: 0,
    qtdLinhas: 0,
  };
  cur.custoOficina += toNumber(row.custoOficina);
  cur.custoCombustivel += toNumber(row.custoCombustivel);
  cur.custoMaterial += toNumber(row.custoMaterial);
  cur.custoInsumo += toNumber(row.custoInsumo);
  cur.custoTransporte += toNumber(row.custoTransporte);
  cur.custoMecanizacao += toNumber(row.custoMecanizacao);
  cur.custoServicoTerceiro += toNumber(row.custoServicoTerceiro);
  cur.custoFuncionario += toNumber(row.custoFuncionario);
  cur.custoTotal += toNumber(row.custoTotal);
  cur.qtdLinhas += 1;
  if (!cur.descricao && meta?.descricao) cur.descricao = meta.descricao;
  mapa.set(key, cur);
}

async function mapearObjetos(ids) {
  const unique = [
    ...new Set((ids || []).filter((v) => v != null).map(Number)),
  ].filter((v) => Number.isFinite(v));
  const mapa = new Map();
  if (!unique.length) return mapa;

  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400);
    const binds = {};
    const placeholders = chunk.map((id, idx) => {
      binds[`id${idx}`] = id;
      return `:id${idx}`;
    });
    const result = await executeQuery(
      `
      SELECT
          cod_objetocusto,
          descricao,
          negocio,
          processo,
          subprocesso,
          atividade
      FROM custo.objetocusto
      WHERE cod_objetocusto IN (${placeholders.join(',')})
      `,
      binds
    );
    for (const row of result.rows || []) {
      mapa.set(Number(row.COD_OBJETOCUSTO), {
        descricao:
          row.DESCRICAO != null ? String(row.DESCRICAO).trim() : null,
        negocio: row.NEGOCIO,
        processo: row.PROCESSO,
        subprocesso: row.SUBPROCESSO,
        atividade: row.ATIVIDADE,
      });
    }
  }
  return mapa;
}

function vaziaFicou() {
  return {
    oficina: 0,
    combustivel: 0,
    material: 0,
    insumo: 0,
    transporte: 0,
    mecanizacao: 0,
    servicoTerceiro: 0,
    funcionario: 0,
    total: 0,
    porObjeto: new Map(),
  };
}

function bumpFicou(bucket, obj, meta, valores) {
  bucket.oficina += valores.oficina;
  bucket.combustivel += valores.comb;
  bucket.material += valores.mat;
  bucket.insumo += valores.ins;
  bucket.transporte += valores.transpCusto;
  bucket.mecanizacao += valores.mecCusto;
  bucket.servicoTerceiro += valores.serv;
  bucket.funcionario += valores.func;
  bucket.total += valores.linhaTotal;
  const k = String(obj);
  const cur = bucket.porObjeto.get(k) || {
    objetoCusto: obj,
    descricao: meta?.descricao ?? null,
    custoOficina: 0,
    custoCombustivel: 0,
    custoMaterial: 0,
    custoInsumo: 0,
    custoTransporte: 0,
    custoMecanizacao: 0,
    custoServicoTerceiro: 0,
    custoFuncionario: 0,
    custoTotal: 0,
  };
  cur.custoOficina += valores.oficina;
  cur.custoCombustivel += valores.comb;
  cur.custoMaterial += valores.mat;
  cur.custoInsumo += valores.ins;
  cur.custoTransporte += valores.transpCusto;
  cur.custoMecanizacao += valores.mecCusto;
  cur.custoServicoTerceiro += valores.serv;
  cur.custoFuncionario += valores.func || 0;
  cur.custoTotal += valores.linhaTotal;
  bucket.porObjeto.set(k, cur);
}

function serializarFicou(bucket) {
  return {
    oficina: bucket.oficina,
    combustivel: bucket.combustivel,
    material: bucket.material,
    insumo: bucket.insumo,
    transporte: bucket.transporte,
    mecanizacao: bucket.mecanizacao,
    servicoTerceiro: bucket.servicoTerceiro,
    funcionario: bucket.funcionario,
    total: bucket.total,
    porObjeto: [...bucket.porObjeto.values()].sort(
      (a, b) => b.custoTotal - a.custoTotal
    ),
  };
}

export async function consultarDiagnosticoDistribuicao(filtros = {}) {
  const rateio = await consultarRateioAtividades(filtros);
  const mapas = await carregarMapasTransporteCliente();
  const mapasMec = await carregarMapasMecanizacaoCliente();

  const dados = rateio.dados || [];
  const ids = [
    ...dados.map((r) => objetoEfetivo(r)),
    ...(rateio.transporteDestinos || []).map((d) => d.objetoCustoCliente),
    ...(rateio.transporteDestinos || []).map((d) => d.objetoCustoTransporte),
    ...(rateio.mecanizacaoDestinos || []).map((d) => d.objetoCustoCliente),
    ...(rateio.mecanizacaoDestinos || []).map((d) => d.objetoCustoMecanizacao),
    ...mapas.eqParaObjTransporte.values(),
    ...mapasMec.eqParaObjMecanizacao.values(),
  ];
  const metas = await mapearObjetos(ids);

  const objetosTransporte = new Set();
  for (const obj of mapas.eqParaObjTransporte.values()) {
    if (obj != null) objetosTransporte.add(Number(obj));
  }
  const objetosMecanizacao = new Set();
  for (const obj of mapasMec.eqParaObjMecanizacao.values()) {
    if (obj != null) objetosMecanizacao.add(Number(obj));
  }
  for (const [cod, meta] of metas.entries()) {
    if (isTransporteMeta(meta)) objetosTransporte.add(cod);
    if (isMecanizacaoMeta(meta)) objetosMecanizacao.add(cod);
  }

  const clientesTransporte = new Set();
  for (const lista of mapas.clientesPorObjTransporte.values()) {
    for (const c of lista || []) {
      if (c.objetoCliente != null) clientesTransporte.add(Number(c.objetoCliente));
    }
  }
  const clientesMecanizacao = new Set();
  for (const lista of mapasMec.clientesPorObjMecanizacao.values()) {
    for (const c of lista || []) {
      if (c.objetoCliente != null) clientesMecanizacao.add(Number(c.objetoCliente));
    }
  }

  const viaMap = new Map();
  const destinoMap = new Map();
  const ficouTransporte = vaziaFicou();
  const ficouMecanizacao = vaziaFicou();
  const semDestino = [];

  let totalOficina = 0;
  let totalCombustivel = 0;
  let totalMaterial = 0;
  let totalInsumo = 0;
  let totalTransporte = 0;
  let totalMecanizacao = 0;
  let totalServicoTerceiro = 0;
  let totalFuncionario = 0;

  for (const row of dados) {
    const oficina = toNumber(row.custoOficina);
    const comb = toNumber(row.custoCombustivel);
    const mat = toNumber(row.custoMaterial);
    const ins = toNumber(row.custoInsumo);
    const transpCusto = toNumber(row.custoTransporte);
    const mecCusto = toNumber(row.custoMecanizacao);
    const serv = toNumber(row.custoServicoTerceiro);
    const func = toNumber(row.custoFuncionario);
    const linhaTotal =
      oficina + comb + mat + ins + transpCusto + mecCusto + serv + func;
    totalOficina += oficina;
    totalCombustivel += comb;
    totalMaterial += mat;
    totalInsumo += ins;
    totalTransporte += transpCusto;
    totalMecanizacao += mecCusto;
    totalServicoTerceiro += serv;
    totalFuncionario += func;

    if (row.origemLancamentoTransporte) {
      addVia(viaMap, 'transporte', viaOficina(row), transpCusto);
    } else if (row.origemLancamentoMecanizacao) {
      addVia(viaMap, 'mecanizacao', viaOficina(row), mecCusto);
    } else {
      addVia(viaMap, 'oficina', viaOficina(row), oficina);
    }
    addVia(viaMap, 'combustivel', viaCombustivel(row), comb);
    addVia(viaMap, 'material', viaMaterial(row), mat);
    addVia(viaMap, 'insumo', viaMaterial(row), ins);
    addVia(viaMap, 'servico-terceiro', viaServico(row), serv);
    addVia(viaMap, 'funcionario', viaFuncionario(row), func);

    const obj = objetoEfetivo(row);
    const meta = obj != null ? metas.get(Number(obj)) : null;
    addDestino(destinoMap, row, meta);

    const valores = {
      oficina,
      comb,
      mat,
      ins,
      transpCusto,
      mecCusto,
      serv,
      func,
      linhaTotal,
    };
    const isTransp =
      (obj != null && objetosTransporte.has(Number(obj))) ||
      isTransporteMeta(meta);
    if (isTransp && !row.rateioTransporteCliente) {
      bumpFicou(ficouTransporte, obj, meta, valores);
    }
    const isMec =
      (obj != null && objetosMecanizacao.has(Number(obj))) ||
      isMecanizacaoMeta(meta);
    if (
      isMec &&
      !row.rateioMecanizacaoCliente &&
      !row.origemLancamentoMecanizacao
    ) {
      bumpFicou(ficouMecanizacao, obj, meta, valores);
    }

    if (obj == null && linhaTotal > 0.05) {
      semDestino.push({
        anomes: row.anomes,
        codEquipamento: row.codEquipamento,
        codOperacaoAgricola: row.codOperacaoAgricola,
        viaOficina: viaOficina(row),
        custoOficina: oficina,
        custoCombustivel: comb,
        custoMaterial: mat,
        custoInsumo: ins,
        custoTransporte: transpCusto,
        custoMecanizacao: mecCusto,
        custoServicoTerceiro: serv,
        custoFuncionario: func,
        custoTotal: linhaTotal,
      });
    }
  }

  const total =
    totalOficina +
    totalCombustivel +
    totalMaterial +
    totalInsumo +
    totalTransporte +
    totalMecanizacao +
    totalServicoTerceiro +
    totalFuncionario;
  const porVia = [...viaMap.values()]
    .map((v) => ({
      ...v,
      percentual: total > 0 ? v.valor / total : 0,
    }))
    .sort((a, b) => b.valor - a.valor);

  const porDestino = [...destinoMap.values()]
    .map((d) => ({
      ...d,
      isClienteTransporte:
        d.objetoCusto != null &&
        clientesTransporte.has(Number(d.objetoCusto)),
      isClienteMecanizacao:
        d.objetoCusto != null &&
        clientesMecanizacao.has(Number(d.objetoCusto)),
      percentual: total > 0 ? d.custoTotal / total : 0,
    }))
    .sort((a, b) => b.custoTotal - a.custoTotal);

  const destinosClientes = (rateio.transporteDestinos || []).map((d) => ({
    ...d,
    percentual: d.percentual ?? d.percentualEnvio,
    descricaoTransporte:
      metas.get(Number(d.objetoCustoTransporte))?.descricao ?? null,
    descricaoCliente:
      metas.get(Number(d.objetoCustoCliente))?.descricao ?? null,
  }));
  destinosClientes.sort((a, b) => (b.custoEnviado || 0) - (a.custoEnviado || 0));

  const destinosMecanizacao = (rateio.mecanizacaoDestinos || []).map((d) => ({
    ...d,
    percentual: d.percentual ?? d.percentualEnvio,
    descricaoMecanizacao:
      metas.get(Number(d.objetoCustoMecanizacao))?.descricao ?? null,
    descricaoCliente:
      metas.get(Number(d.objetoCustoCliente))?.descricao ?? null,
  }));
  destinosMecanizacao.sort(
    (a, b) => (b.custoEnviado || 0) - (a.custoEnviado || 0)
  );

  const r = rateio.resumo || {};
  semDestino.sort((a, b) => (b.custoTotal || 0) - (a.custoTotal || 0));

  return {
    filtros: rateio.filtros,
    logica: {
      oficina:
        'Oficina (3/1/1): lancamento_custo tipo R e empenho tipo 1 ou 2 → equipamento por horas OS → operação por km/hs; sem apontamento em transporte (3/1/2) ou mecanização (3/1/3) → objetos clientes (prestador/unidade).',
      transporte:
        'Transporte (3/1/2): lancamento_custo tipo R e empenho 1 ou 2 → equipamentos 3/1/2 por horas OS → objetos clientes (prestador/unidade). Residual de oficina sem apontamento nesses equipamentos também vai aos clientes. Material, combustível e insumo que caem no 3/1/2 permanecem nesse objeto.',
      mecanizacao:
        'Mecanização (3/1/3): lancamento_custo tipo R e empenho 1 ou 2 → equipamentos vigentes em 3/1/3 por horas OS → objetos clientes (prestador/unidade). Residual de oficina sem apontamento nesses equipamentos também vai aos clientes. Sem cliente, o custo permanece no objeto 3/1/3.',
      combustivel: 'Abastecimento vai para a operação (apontamento). Sem operação, pode ficar no objeto vigente do equipamento.',
      material:
        'Requisição de manutenção → último apontamento do equipamento ou objeto da requisição. Não passa pelo rateio transporte/mecanização→cliente.',
      insumo: 'Apontamento agrícola → operação / objeto / fazenda / talhão.',
      servicoTerceiro:
        'Contrato variável (itemcontratovariavel + parcelascontrato): cod_servico = operação agrícola; objeto do item ou cadastro da operação. Fixo: parcela + histórico F, só objeto. Empenho tipo 1 ou 2. Não passa pelo rateio de oficina/transporte/mecanização.',
      funcionario:
        'Lancamento tipo R + grupoempenho 10 + empenho 1/2. Exclui oficina 3/1/1 e transporte 3/1/2. Mecanização 3/1/3: rateio por tothoras_trabalhadas do apontamento dos equipamentos vigentes no objeto, destino = objeto da atividade; sem horas permanece no 3/1/3. Demais objetos: custo retido no objeto. Não entra em custoOperacao/R$/h.',
      consolidado:
        'custoTotal = oficina + combustível + material + insumo + transporte + mecanização + serviços 3º + funcionário',
    },
    resumo: {
      total,
      totalOficina,
      totalCombustivel,
      totalMaterial,
      totalInsumo,
      totalTransporte,
      totalMecanizacao,
      totalServicoTerceiro,
      totalFuncionario,
      oficinaApontamento: porVia
        .filter((v) => v.tipo === 'oficina' && v.via === 'apontamento')
        .reduce((acc, v) => acc + v.valor, 0),
      oficinaTransporteCliente: r.oficinaRateadoTransporteCliente || 0,
      oficinaMecanizacaoCliente: r.oficinaRateadoMecanizacaoCliente || 0,
      transporteLancamentoClientes: r.transporteLancamentoClientes || 0,
      mecanizacaoLancamentoClientes: r.mecanizacaoLancamentoClientes || 0,
      mecanizacaoSemCliente: r.mecanizacaoSemCliente || 0,
      oficinaRetida: r.oficinaRetidaEquipamento || 0,
      oficinaSemOperacao: r.oficinaSemOperacao || 0,
      qtdDestinos: porDestino.length,
      qtdSemDestino: semDestino.length,
      totalSemDestino: semDestino.reduce((acc, s) => acc + s.custoTotal, 0),
      qtdEquipamentosTransporte: mapas.equipamentosTransporte.length,
      qtdEquipamentosMecanizacao: mapasMec.equipamentosMecanizacao.length,
      colheitaCana: r.colheitaCana ?? null,
    },
    porVia,
    porDestino: porDestino.slice(0, 400),
    transporte: {
      qtdEquipamentos: mapas.equipamentosTransporte.length,
      residualOficinaParaClientes: r.oficinaRateadoTransporteCliente || 0,
      lancamentoParaClientes: r.transporteLancamentoClientes || 0,
      destinosClientes,
      ficouNoObjetoTransporte: serializarFicou(ficouTransporte),
    },
    mecanizacao: {
      qtdEquipamentos: mapasMec.equipamentosMecanizacao.length,
      residualOficinaParaClientes: r.oficinaRateadoMecanizacaoCliente || 0,
      lancamentoParaClientes: r.mecanizacaoLancamentoClientes || 0,
      lancamentoSemCliente: r.mecanizacaoSemCliente || 0,
      destinosClientes: destinosMecanizacao,
      ficouNoObjetoMecanizacao: serializarFicou(ficouMecanizacao),
    },
    semDestino: semDestino.slice(0, 200),
  };
}
