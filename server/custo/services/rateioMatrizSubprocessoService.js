import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { db } from '../../db.js';
import { lerParametrosTecnicos } from '../../parametros-tecnicos.js';
import { destinoEstagio, colunaRateioEstagio } from './destinoEstagio.js';
import { grupoObjetoOperacional, OBJETOS_MAO_OBRA, OBJETOS_INSUMOS } from './grupoObjetoOperacional.js';
import { listHarvestAreas } from '../../harvest-areas.js';
import { indicadorArrendamento } from './arrendamentoSafra.js';
import { fetchMatrizRhaHectares } from '../../un-realizado.js';
import { executeQuery } from '../utils/oracle.js';
import { premissasKpis } from '../../calc.js';
import {
  consultarTotalLancamentoConsolidado,
  negociosParaConsulta,
} from './lancamentoConsolidadoService.js';
import { expandNegociosCana, normalizeNegocios, bindsObjetoCusto } from '../utils/filtros.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MATRIZ_LINHAS_SQL = readFileSync(
  join(__dirname, '../sql/rateioMatrizLinhas.sql'),
  'utf8'
)
  .replace(/^--.*$/gm, '')
  .replace(/\r\n/g, '\n')
  .trim();

const RATEIO_ADMIN_AGRICOLA_DESTINOS_SQL = (() => {
  const marcador = '\nSELECT\n';
  const fimCtes = MATRIZ_LINHAS_SQL.lastIndexOf(marcador);
  if (fimCtes < 0) throw new Error('Não foi possível localizar o CTE de rateio da matriz.');
  return `${MATRIZ_LINHAS_SQL.slice(0, fimCtes)}
SELECT r.dest_obj AS dest_obj, SUM(r.valor_rateado) AS valor
FROM rateio r
WHERE r.neg_origem = 5
  AND r.orig_processo = 1
GROUP BY r.dest_obj`;
})();

/** Retorna o custo 5/1 efetivamente rateado para cada objeto de destino. */
export async function consultarRateioAdminAgricolaPorDestino(anomesInicio, anomesFim) {
  const filtros = { negocios: [5], processo: 1, anomesInicio, anomesFim };
  const result = await executeQuery(
    RATEIO_ADMIN_AGRICOLA_DESTINOS_SQL,
    bindsConsulta(filtros),
  );
  return (result.rows || []).map((row) => ({
    codObjetoDestino: toNumber(row.DEST_OBJ ?? row.dest_obj),
    valor: toNumber(row.VALOR ?? row.valor),
  }));
}

/** Centros de custo cujas unidades do Un realizado alimentam R$/ha da coluna. */
export const COLUNAS_SHEET = {
  preparo: 'P.SOLO',
  plantio: 'PLANTIO',
  tratos_planta: 'T.C.P.',
  colheita_mudas: 'CORTE SEMENTE',
  formacao: 'PLANTIO',
  tratos_soca: 'T.C.S.',
};

/** Colunas exibidas no relatório (formação = soma das partes). */
export const COLUNAS_SUBPROCESSO = [
  { key: 'preparo', label: 'Preparo', haKey: 'preparo', sheetName: COLUNAS_SHEET.preparo },
  { key: 'plantio', label: 'Plantio', haKey: 'plantio', sheetName: COLUNAS_SHEET.plantio },
  {
    key: 'tratos_planta',
    label: 'Tratos planta',
    haKey: 'tratos_planta',
    sheetName: COLUNAS_SHEET.tratos_planta,
  },
  {
    key: 'formacao',
    label: 'Formação',
    haKey: 'formacao',
    sheetName: COLUNAS_SHEET.formacao,
    computed: true,
  },
  {
    key: 'tratos_soca',
    label: 'Tratos soca',
    haKey: 'tratos_soca',
    sheetName: COLUNAS_SHEET.tratos_soca,
  },
  { key: 'colheita', label: 'Sistema de colheita', haKey: 'colheita' },
  { key: 'irrigacao', label: 'Irrigação', haKey: 'irrigacao' },
  { key: 'administrativo', label: 'Administrativo', haKey: 'administrativo' },
  { key: 'arrendamento', label: 'Arrendamento', haKey: 'arrendamento' },
];

/** Colunas que recebem rateio direto do Oracle (antes de derivar formação). */
const COLUNAS_ROTEAMENTO = [
  'preparo',
  'plantio',
  'tratos_planta',
  'colheita_mudas',
  'tratos_soca',
  'colheita',
  'irrigacao',
  'administrativo',
  'arrendamento',
];

/** Partes que compõem a coluna Formação. */
const COLUNAS_FORMACAO_PARTES = [
  'preparo',
  'plantio',
  'tratos_planta',
  'colheita_mudas',
];

const SECOES = [
  { key: 'operacao', label: 'Operação' },
  { key: 'insumos', label: 'Insumos' },
  { key: 'adm', label: 'Adm' },
];

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
    origemObjeto: toNumber(row.ORIGEM_OBJETO ?? row.origem_objeto),
    origemDescricao: row.ORIGEM_DESCRICAO ?? row.origem_descricao ?? null,
    destinoObjeto: toNumber(row.DESTINO_OBJETO ?? row.destino_objeto),
    destProcesso: toNumber(row.DEST_PROCESSO ?? row.dest_processo),
    destSubprocesso: toNumber(row.DEST_SUBPROCESSO ?? row.dest_subprocesso),
    destDescricao: row.DEST_DESCRICAO ?? row.dest_descricao ?? null,
    codGrupoempenho: toNumber(row.COD_GRUPOEMPENHO ?? row.cod_grupoempenho),
    grupoEmpenho: row.GRUPO_EMPENHO ?? row.grupo_empenho ?? null,
    codEmpenho: toNumber(row.COD_EMPENHO ?? row.cod_empenho),
    empenhoDescricao: row.EMPENHO_DESCRICAO ?? row.empenho_descricao ?? null,
    codGrupoItemCusto: toNumber(
      row.COD_GRUPO_ITEM_CUSTO ?? row.cod_grupo_item_custo
    ),
    grupoItemDescricao:
      row.GRUPO_ITEM_DESCRICAO ?? row.grupo_item_descricao ?? null,
    codItemCusto: toNumber(row.COD_ITEM_CUSTO ?? row.cod_item_custo),
    itemDescricao: row.ITEM_DESCRICAO ?? row.item_descricao ?? null,
    negOrigem: toNumber(row.NEG_ORIGEM ?? row.neg_origem),
    origProcesso: toNumber(row.ORIG_PROCESSO ?? row.orig_processo),
    valor: toNumber(row.VALOR ?? row.valor),
  };
}

function isColheitaMudas(linha) {
  const desc = String(linha.destDescricao || '').toUpperCase();
  return (
    desc.includes('SEMENTE') ||
    desc.includes('MUDA') ||
    desc.includes('CORTE DE') ||
    desc.includes('CORTE SEMENT')
  );
}

/** Coluna = subprocesso destino Cana que recebeu o rateio. */
function colunaDestino(linha) {
  const proc = linha.destProcesso;
  const sub = linha.destSubprocesso;
  if (proc === 1 && sub === 1) {
    return isColheitaMudas(linha) ? 'colheita_mudas' : 'preparo';
  }
  if (proc === 1 && sub === 2) return 'plantio';
  if (proc === 1 && sub === 3) return 'tratos_planta';
  if (proc === 2 || proc === 3) return 'tratos_soca';
  // Processo 5 do objeto de cana é Colheita de Mudas (corte, transporte, carregamento).
  if (proc === 5) return 'colheita_mudas';
  return null;
}

function metaIrrigacao() {
  return {
    secao: 'operacao',
    grupo: 'irrigacao',
    chave: 'irrigacao',
    label: 'Irrigação/Fertirrigação',
    indent: 1,
  };
}

function isIrrigacaoDestino(linha) {
  return linha.destProcesso === 4;
}

/** Custo do processo irrigação (proc 4) — origem ou destino. */
function isCustoIrrigacao(linha) {
  return linha.destProcesso === 4 || linha.origProcesso === 4;
}

function estagiosVazios() {
  return {
    conservacao: 0,
    preparo: 0,
    plantio: 0,
    tratosPlanta: 0,
    colheitaMudas: 0,
    manutencao: 0,
    colheita: 0,
    administrativo: 0,
    arrendamento: 0,
    irrigacao: 0,
  };
}

function acumularEstagio(buckets, meta, col, linha, valor) {
  if (!(Math.abs(valor) > 0.0001)) return;
  buckets[destinoEstagio(linha, meta, col)] += valor;
}

function acumularDestinoSemColuna(buckets, linha, valor) {
  if (!(Math.abs(valor) > 0.0001)) return;
  buckets[destinoEstagio(linha, classificarLinha(linha), null)] += valor;
}

function metaMaquina() {
  return {
    secao: 'operacao',
    grupo: 'maquina',
    chave: 'maquina',
    label: 'Máquina',
    indent: 1,
  };
}

function metaMaoObra() {
  return {
    secao: 'operacao',
    grupo: 'mao_obra',
    chave: 'mao_obra',
    label: 'Mão de obra',
    indent: 1,
  };
}

function isAluguelMaquinasEmpenho(empDesc) {
  const d = empDesc.toLowerCase();
  const aluguel =
    d.includes('aluguel') || d.includes('locação') || d.includes('locacao');
  const maquina =
    d.includes('maq') || d.includes('trator') || d.includes('equip');
  return aluguel && maquina;
}

function isMaquina(linha) {
  const grupoItem = linha.codGrupoItemCusto;
  const grupoEmp = linha.codGrupoempenho;
  const empDesc = String(linha.empenhoDescricao || '');
  const empLower = empDesc.toLowerCase();
  if (grupoItem === 4 || grupoItem === 5) return true;
  // DESPESAS C/ TRANSPORTES DE TERCEIROS
  if (grupoEmp === 18) return true;
  if (isAluguelMaquinasEmpenho(empDesc)) return true;
  // Manutenção, materiais/consumo, combustíveis, energia (fora da linha irrigação)
  if (grupoEmp === 20 || grupoEmp === 21 || grupoEmp === 25 || grupoEmp === 23) {
    return true;
  }
  // Aluguéis operacionais; arrendamento de terra permanece em Adm
  if (grupoEmp === 17 && !empLower.includes('arrend')) return true;
  return false;
}

function isMaoObra(linha) {
  const grupoEmp = linha.codGrupoempenho;
  // 10 = DESPESAS C/ FUNCIONARIO; 19 = DESPESAS C/ SERVIÇOS DE TERCEIROS; 22 = FOLHA AVULSA
  return grupoEmp === 10 || grupoEmp === 19 || grupoEmp === 22;
}

function metaAdm(label = 'Administrativo') {
  return {
    secao: 'adm',
    grupo: 'adm',
    chave: 'administrativo',
    label,
    indent: 1,
  };
}

function classificarLinha(linha) {
  if (OBJETOS_INSUMOS.has(Number(linha.origemObjeto))) {
    return { secao: 'insumos', grupo: 'insumo', chave: `ins-obj-${Number(linha.origemObjeto)}`,
      label: linha.origemDescricao?.trim() || `Objeto de custo ${linha.origemObjeto}`, indent: 1 };
  }
  if (OBJETOS_MAO_OBRA.has(Number(linha.origemObjeto))) return metaMaoObra();
  const grupoEmp = linha.codGrupoempenho;
  const empDesc = String(linha.empenhoDescricao || '').toLowerCase();

  const grupoObjeto = grupoObjetoOperacional(linha.origemDescricao);
  const empenhoSeparado = grupoEmp === 24 || grupoEmp === 14
    || /royalt|arrend|imposto|taxa|mat[eé]ria-prima/.test(empDesc);
  if (!empenhoSeparado) {
    if (grupoObjeto === 'maquina') return metaMaquina();
    if (grupoObjeto === 'mao_obra') return metaMaoObra();
  }

  if (isMaquina(linha)) {
    return metaMaquina();
  }

  if (isMaoObra(linha)) {
    return metaMaoObra();
  }

  if (grupoEmp === 24) {
    let label = linha.empenhoDescricao?.trim() || `Empenho ${linha.codEmpenho}`;
    if (empDesc.includes('corretiv')) label = 'Adubação corretiva';
    else if (empDesc.includes('defens')) label = 'Defensivos';
    else if (empDesc.includes('biolog')) label = 'Controle biológico';
    else if (empDesc.includes('adub') || empDesc.includes('fertiliz')) {
      label = 'Fertilizantes';
    } else if (empDesc.includes('muda')) label = 'Mudas';
    else if (empDesc.includes('torta') || empDesc.includes('filtro')) {
      label = 'Torta de filtro';
    }
    return {
      secao: 'insumos',
      grupo: 'insumo',
      chave: `ins-${linha.codEmpenho}`,
      label,
      indent: 1,
    };
  }

  if (linha.negOrigem === 5 && linha.origProcesso === 1) {
    return metaAdm();
  }

  if (empDesc.includes('royalt') || (grupoEmp === 17 && empDesc.includes('arrend'))) {
    return {
      secao: 'adm',
      grupo: 'adm',
      chave: 'royalties',
      label: 'Royalties',
      indent: 1,
    };
  }

  if (
    grupoEmp === 14 ||
    empDesc.includes('imposto') ||
    empDesc.includes('taxa') ||
    empDesc.includes('matéria-prima') ||
    empDesc.includes('materia-prima')
  ) {
    return metaAdm();
  }

  return metaMaquina();
}

function fonteApontamentoHa({ units, label, nota, sheetName, sheetTitle }) {
  return {
    sheetName: sheetName ?? null,
    sheetTitle: sheetTitle ?? null,
    units,
    configurado: true,
    sourceKind: 'apontamento_area',
    sourceLabel: label,
    metric: 'area',
    metricLabel: 'Área',
    nota,
  };
}

export async function unidadesPorColuna(filtros = {}, { irrigacao = true, buscarOracle = true } = {}) {
  const parametros = lerParametrosTecnicos(filtros.safraId, filtros.anomesInicio, filtros.anomesFim);
  const rhaHa = parametros.armazenado
    ? { planta: parametros.areaPlantio, soca: parametros.areaSoca, irrigacao: parametros.areaIrrigacao }
    : buscarOracle
    ? await fetchMatrizRhaHectares(filtros.anomesInicio, filtros.anomesFim, undefined, irrigacao)
    : { planta: 0, soca: 0, irrigacao: 0 };
  const sheetRows = db
    .prepare(`SELECT id, name, title FROM sheets WHERE kind = 'cost_center'`)
    .all();
  const sheetByName = new Map(sheetRows.map((row) => [row.name, row]));

  const unidades = {};
  const fontes = {};
  const colunasUnidade = [
    ...COLUNAS_SUBPROCESSO,
    { key: 'colheita_mudas', haKey: 'colheita_mudas', sheetName: COLUNAS_SHEET.colheita_mudas },
  ];

  for (const col of colunasUnidade) {
    const sheetName = COLUNAS_SHEET[col.key];
    const sheet = sheetName ? sheetByName.get(sheetName) : null;
    let units = 0;
    let fonte = null;

    if (col.key === 'preparo' || col.key === 'plantio' || col.key === 'tratos_planta') {
      units = rhaHa.planta || 0;
      fonte = fonteApontamentoHa({
        units,
        sheetName,
        sheetTitle: sheet?.title,
        label: 'automotivo.itens_apontamento · op. 41 (área)',
        nota: 'R$/ha de preparo, plantio e tratos planta usa a coluna Área com cod_operacaoagricola = 41',
      });
    } else if (col.key === 'formacao') {
      units = rhaHa.planta || 0;
      fonte = fonteApontamentoHa({
        units,
        sheetName,
        sheetTitle: sheet?.title,
        label: 'automotivo.itens_apontamento · op. 41 (área)',
        nota: 'Formação = preparo + plantio + tratos planta + colheita de mudas; R$/ha usa a mesma área da op. 41',
      });
    } else if (col.key === 'tratos_soca') {
      units = rhaHa.soca || 0;
      fonte = fonteApontamentoHa({
        units,
        sheetName,
        sheetTitle: sheet?.title,
        label: 'agricola.apontamentoitem · M13/M56/M80/M342',
        nota: 'Área agrupada do apontamento agrícola, filtrada nas operações M13, M56, M80 e M342',
      });
    } else if (col.key === 'colheita_mudas') {
      units = rhaHa.planta || 0;
      fonte = fonteApontamentoHa({
        units,
        sheetName,
        sheetTitle: sheet?.title,
        label: 'automotivo.itens_apontamento · op. 41 (área)',
        nota: 'Colheita de mudas compõe a formação e usa a mesma área da operação 41',
      });
    } else if (['colheita', 'irrigacao', 'administrativo', 'arrendamento'].includes(col.key)) {
      const areaTotal = (rhaHa.planta || 0) + (rhaHa.soca || 0);
      units = col.key === 'colheita' ? rhaHa.soca || 0
        : col.key === 'irrigacao' ? rhaHa.irrigacao || 0
        : col.key === 'arrendamento' && parametros.armazenado ? parametros.areaArrendada
        : areaTotal;
      fonte = fonteApontamentoHa({ units, label: 'Estágio de produção', nota: 'Mesma base de área do estágio correspondente' });
    } else {
      fonte = {
        sheetName: sheetName ?? null,
        units: 0,
        configurado: false,
        nota: sheetName
          ? 'Centro de custo não encontrado na planilha'
          : 'Sem centro de custo mapeado',
      };
    }

    unidades[col.haKey ?? col.key] = units;
    fontes[col.key] = fonte;
  }

  if (parametros.armazenado) {
    for (const fonte of Object.values(fontes)) {
      if (!fonte.configurado) continue;
      fonte.sourceKind = 'parametros_tecnicos';
      fonte.sourceLabel = 'Estágio de produção · parâmetros armazenados';
      fonte.nota = 'Mesma área armazenada para esta safra e período em Estágio de produção';
    }
  }
  unidades.irrigacao = rhaHa.irrigacao || 0;
  return { unidades, fontes };
}

function celulaVazia() {
  return { valor: 0, pct: 0, rHa: null };
}

function celulaFormacao(row, totalFormacao, haFormacao) {
  const valor = COLUNAS_FORMACAO_PARTES.reduce(
    (sum, key) => sum + (row.celulas[key]?.valor || 0),
    0
  );
  return {
    valor,
    pct: totalFormacao > 0 ? (valor / totalFormacao) * 100 : 0,
    rHa: haFormacao > 0 ? valor / haFormacao : null,
  };
}

function totalLinhaUnico(row) {
  return COLUNAS_ROTEAMENTO.reduce((sum, key) => sum + (row.celulas[key]?.valor || 0), 0);
}

function sortItensSecao(a, b) {
  const ordem = { irrigacao: 0, maquina: 1, mao_obra: 2 };
  const oa = ordem[a.grupo] ?? 99;
  const ob = ordem[b.grupo] ?? 99;
  if (oa !== ob) return oa - ob;
  return totalLinhaUnico(b) - totalLinhaUnico(a);
}

function anomesParaData(anomes, fimExclusivo = false) {
  const s = String(anomes ?? '').replace(/\D/g, '');
  if (s.length < 6) return null;
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(4, 6));
  if (!year || month < 1 || month > 12) return null;
  return new Date(year, month - 1 + (fimExclusivo ? 1 : 0), 1);
}

/** Toneladas moídas: soma de agricola.itensentradacana.pesoliquido no período. */
async function moagemEntradaCana(filtros = {}) {
  const dataInicio = anomesParaData(filtros.anomesInicio);
  const dataFim = anomesParaData(filtros.anomesFim, true);
  if (!dataInicio || !dataFim) return 0;
  const result = await executeQuery(
    `SELECT NVL(SUM(pesoliquido), 0) AS toneladas
       FROM agricola.itensentradacana
      WHERE pesoliquido > 0
        AND datamovimentoitens >= :dataInicio
        AND datamovimentoitens < :dataFim`,
    { dataInicio, dataFim }
  );
  const row = (result.rows || [])[0] || {};
  return toNumber(row.TONELADAS ?? row.toneladas);
}

function rateioPorBase(valor, base) {
  return base > 0 ? valor / base : null;
}

function linhaEstagio(chave, label, nivel, valor, baseHa, tons, total) {
  return {
    chave,
    label,
    nivel,
    valor,
    rHa: rateioPorBase(valor, baseHa),
    rTon: rateioPorBase(valor, tons),
    rKgAtr: null,
    pct: total > 0 ? (valor / total) * 100 : null,
  };
}

function montarEstagiosProducao(valores, ha, tons, totalPool = 0) {
  const haPlanta = ha.planta || ha.formacao || ha.preparo || 0;
  const haSoca = ha.soca || ha.tratos_soca || 0;
  const haTotal = haPlanta + haSoca;
  const formacao =
    valores.conservacao +
    valores.preparo +
    valores.plantio +
    valores.tratosPlanta +
    valores.colheitaMudas;
  const grupos = [
    { chave: 'formacao', label: 'Formação do canavial', valor: formacao, ha: haPlanta },
    { chave: 'manutencao', label: 'Manutenção de soqueira', valor: valores.manutencao, ha: haSoca },
    { chave: 'colheita', label: 'Sistema de colheita', valor: valores.colheita, ha: haSoca },
    { chave: 'irrigacao', label: 'Irrigação', valor: valores.irrigacao, ha: ha.irrigacao || 0 },
    { chave: 'administrativo', label: 'Administrativo', valor: valores.administrativo, ha: haTotal },
    { chave: 'arrendamento', label: 'Arrendamento', valor: valores.arrendamento, ha: ha.arrendamento ?? haTotal },
  ];
  const somaGrupos = grupos.reduce((sum, row) => sum + row.valor, 0);
  // Custo total é o lançamento do período. A sobra fecha no Administrativo,
  // para não existir linha sem rateio.
  const foraEstagio = totalPool > 0.0001 ? totalPool - somaGrupos : 0;
  if (Math.abs(foraEstagio) > 0.005) {
    const adm = grupos.find((row) => row.chave === 'administrativo');
    if (adm) adm.valor += foraEstagio;
  }
  const totalValor = totalPool > 0.0001 ? totalPool : somaGrupos;
  const filhos = [
    linhaEstagio('conservacao', 'Conservação de Solo', 'item', valores.conservacao, haPlanta, tons, totalValor),
    linhaEstagio('preparo', 'Preparo de solo', 'item', valores.preparo, haPlanta, tons, totalValor),
    linhaEstagio('plantio', 'Plantio', 'item', valores.plantio, haPlanta, tons, totalValor),
  ];
  if (valores.tratosPlanta > 0.5) {
    filhos.push(
      linhaEstagio('tratos_planta', 'Tratos de cana planta', 'item', valores.tratosPlanta, haPlanta, tons, totalValor)
    );
  }
  if (valores.colheitaMudas > 0.5) {
    filhos.push(
      linhaEstagio('colheita_mudas', 'Colheita de mudas', 'item', valores.colheitaMudas, haPlanta, tons, totalValor)
    );
  }
  const linhas = [
    linhaEstagio('formacao', 'Formação do canavial', 'grupo', formacao, haPlanta, tons, totalValor),
    ...filhos,
    ...grupos.slice(1).map((row) => linhaEstagio(row.chave, row.label, 'grupo', row.valor, row.ha, tons, totalValor)),
  ];
  const total = {
    chave: 'custo_total',
    label: 'Custo total',
    nivel: 'total',
    valor: totalValor,
    rHa: rateioPorBase(totalValor, haTotal),
    rTon: rateioPorBase(totalValor, tons),
    rKgAtr: null,
    pct: totalValor > 0 ? 100 : null,
  };
  linhas.push(total);
  linhas.push({
    chave: 'preco',
    label: 'Preço',
    nivel: 'preco',
    valor: null,
    rHa: null,
    rTon: null,
    rKgAtr: null,
    pct: null,
  });
  linhas.push({
    chave: 'margem',
    label: 'Margem',
    nivel: 'margem',
    valor: null,
    rHa: null,
    rTon: null,
    rKgAtr: null,
    pct: null,
  });
  return {
    linhas,
    toneladas: tons > 0 ? tons : null,
    hectares: { planta: haPlanta, soca: haSoca, irrigacao: ha.irrigacao || 0 },
  };
}

function parametrosArea(estagios) {
  const areaPlantio = estagios?.hectares?.planta || 0;
  const areaSoca = estagios?.hectares?.soca || 0;
  const areaIrrigacao = estagios?.hectares?.irrigacao || 0;
  const areaTotal = areaPlantio + areaSoca;
  const toneladas = estagios?.toneladas || 0;
  let premissa = null;
  try {
    const kpis = premissasKpis();
    premissa = {
      produtividade: toNumber(kpis?.tch),
      areaPlanta: toNumber(kpis?.areaPlanta),
      areaSoca: toNumber(kpis?.areaSoca),
      areaTotal: toNumber(kpis?.areaVerao) + toNumber(kpis?.areaInverno),
      moagem: toNumber(kpis?.moagem) + toNumber(kpis?.moagemManual),
    };
  } catch {
    premissa = null;
  }
  return {
    areaPlantio,
    areaSoca,
    areaIrrigacao,
    areaTotal,
    toneladas: toneladas > 0 ? toneladas : null,
    produtividade: areaTotal > 0 && toneladas > 0 ? toneladas / areaTotal : null,
    premissa,
  };
}

export function montarMatriz(linhas, ha, tons, totalPool = 0) {
  const areaTotal = (ha.planta || ha.formacao || ha.preparo || 0) + (ha.soca || ha.tratos_soca || 0);
  ha = { ...ha, colheita: ha.colheita ?? ha.soca ?? ha.tratos_soca ?? 0,
    administrativo: ha.administrativo ?? areaTotal, arrendamento: ha.arrendamento ?? areaTotal };
  const rowMap = new Map();
  const origens = [];
  const colTotais = Object.fromEntries(
    COLUNAS_ROTEAMENTO.map((key) => [key, 0])
  );
  const estagioValores = estagiosVazios();

  const allCellKeys = [...COLUNAS_ROTEAMENTO, 'formacao'];

  const ensureRow = (meta) => {
    if (!rowMap.has(meta.chave)) {
      rowMap.set(meta.chave, {
        chave: meta.chave,
        label: meta.label,
        secao: meta.secao,
        grupo: meta.grupo,
        indent: meta.indent ?? 0,
        tipo: meta.tipo || 'item',
        celulas: Object.fromEntries(allCellKeys.map((key) => [key, celulaVazia()])),
      });
    }
    return rowMap.get(meta.chave);
  };

  const diferenca = totalPool > 0.0001 ? totalPool - linhas.reduce((sum, lin) => sum + lin.valor, 0) : 0;
  const linhasRateio = Math.abs(diferenca) > 0.005
    ? [...linhas, { valor: diferenca, conciliacao: true, origemDescricao: 'Conciliação com o total do período' }]
    : linhas;
  for (const lin of linhasRateio) {
    if (!(Math.abs(lin.valor) > 0.0001)) continue;

    const meta = lin.conciliacao ? { ...metaAdm('Conciliação do período'), chave: 'conciliacao' } : classificarLinha(lin);
    const destino = destinoEstagio(lin, meta, colunaDestino(lin));
    estagioValores[destino] += lin.valor;
    const col = colunaRateioEstagio(destino);
    if (!col) continue;

    const row = ensureRow(meta);
    row.celulas[col].valor += lin.valor;
    colTotais[col] += lin.valor;
    origens.push({
      linhaChave: meta.chave,
      secao: meta.secao,
      coluna: col,
      origemObjeto: lin.origemObjeto || null,
      origemDescricao: lin.origemDescricao || null,
      destinoObjeto: lin.destinoObjeto || null,
      destinoDescricao: lin.destDescricao || null,
      grupoEmpenhoCodigo: lin.codGrupoempenho || null,
      grupoEmpenho: lin.grupoEmpenho || null,
      empenhoCodigo: lin.codEmpenho || null,
      empenho: lin.empenhoDescricao || null,
      itemCodigo: lin.codItemCusto || null,
      item: lin.itemDescricao || null,
      valor: lin.valor,
    });
  }

  const totalFormacao = COLUNAS_FORMACAO_PARTES.reduce(
    (sum, key) => sum + (colTotais[key] || 0),
    0
  );
  const haFormacao = ha.formacao || 0;
  colTotais.formacao = totalFormacao;

  const fillDerived = (valor, totalCol, haCol) => ({
    valor,
    pct: totalCol > 0 ? (valor / totalCol) * 100 : 0,
    rHa: haCol > 0 ? valor / haCol : null,
  });

  // Totais por coluna, % e R$/ha (inclui formação derivada)
  for (const row of rowMap.values()) {
    for (const col of COLUNAS_SUBPROCESSO) {
      if (col.key === 'formacao') {
        row.celulas.formacao = celulaFormacao(row, totalFormacao, haFormacao);
        continue;
      }
      const cell = row.celulas[col.key];
      const totalCol = colTotais[col.key] || 0;
      cell.pct = totalCol > 0 ? (cell.valor / totalCol) * 100 : 0;
      const haCol = ha[col.haKey] || 0;
      cell.rHa = haCol > 0 ? cell.valor / haCol : null;
    }
  }

  const totalRow = {
    chave: 'total',
    label: 'TOTAL',
    secao: 'total',
    grupo: 'total',
    indent: 0,
    tipo: 'total',
    celulas: Object.fromEntries(
      COLUNAS_SUBPROCESSO.map((col) => {
        if (col.key === 'formacao') {
          return [
            col.key,
            {
              valor: totalFormacao,
              pct: totalFormacao > 0 ? 100 : 0,
              rHa: haFormacao > 0 ? totalFormacao / haFormacao : null,
            },
          ];
        }
        const valor = colTotais[col.key] || 0;
        const haCol = ha[col.haKey] || 0;
        return [
          col.key,
          {
            valor,
            pct: valor > 0 ? 100 : 0,
            rHa: haCol > 0 ? valor / haCol : null,
          },
        ];
      })
    ),
  };

  const operacaoSubtotal = ensureRow({
    chave: 'operacao-subtotal',
    label: 'Operação',
    secao: 'operacao',
    grupo: 'subtotal',
    indent: 0,
    tipo: 'subtotal',
  });
  const insumosSubtotal = ensureRow({
    chave: 'insumos-subtotal',
    label: 'Insumos',
    secao: 'insumos',
    grupo: 'subtotal',
    indent: 0,
    tipo: 'subtotal',
  });
  const admSubtotal = ensureRow({
    chave: 'adm-subtotal',
    label: 'Adm',
    secao: 'adm',
    grupo: 'subtotal',
    indent: 0,
    tipo: 'subtotal',
  });

  for (const col of COLUNAS_SUBPROCESSO) {
    let op = 0;
    let ins = 0;
    let adm = 0;
    for (const row of rowMap.values()) {
      if (row.tipo === 'subtotal') continue;
      const v =
        col.key === 'formacao'
          ? celulaFormacao(row, totalFormacao, haFormacao).valor
          : row.celulas[col.key].valor;
      if (row.secao === 'operacao') op += v;
      if (row.secao === 'insumos') ins += v;
      if (row.secao === 'adm') adm += v;
    }
    const fillSubtotal = (row, valor) => {
      if (col.key === 'formacao') {
        row.celulas.formacao = fillDerived(valor, totalFormacao, haFormacao);
        return;
      }
      const totalCol = colTotais[col.key] || 0;
      const haCol = ha[col.haKey] || 0;
      row.celulas[col.key] = fillDerived(valor, totalCol, haCol);
    };
    fillSubtotal(operacaoSubtotal, op);
    fillSubtotal(insumosSubtotal, ins);
    fillSubtotal(admSubtotal, adm);
  }

  const linhasOut = [];
  linhasOut.push(totalRow);

  for (const sec of SECOES) {
    const subtotal = [...rowMap.values()].find(
      (r) => r.secao === sec.key && r.tipo === 'subtotal'
    );
    if (subtotal) linhasOut.push(subtotal);

    const items = [...rowMap.values()]
      .filter((r) => r.secao === sec.key && r.tipo !== 'subtotal')
      .sort(sortItensSecao);
    linhasOut.push(...items);
  }

  const stripInternalCells = (row) => ({
    ...row,
    celulas: Object.fromEntries(
      COLUNAS_SUBPROCESSO.map((col) => [col.key, row.celulas[col.key] ?? celulaVazia()])
    ),
  });

  return {
    colunas: COLUNAS_SUBPROCESSO.map((col) => {
      const total =
        col.key === 'formacao'
          ? totalFormacao
          : colTotais[col.key] || 0;
      const haCol = ha[col.haKey] || 0;
      return {
        ...col,
        total,
        hectareas: haCol,
        rHaTotal: haCol > 0 ? total / haCol : null,
      };
    }),
    linhas: linhasOut.map(stripInternalCells),
    origens,
    toneladas: tons > 0 ? tons : null,
    hectareas: Object.fromEntries(
      COLUNAS_SUBPROCESSO.map((col) => [col.key, ha[col.haKey] || 0])
    ),
    estagios: montarEstagiosProducao(estagioValores, ha, tons, totalPool),
  };
}

export function montarSomenteEstagios(linhas, ha, tons, totalPool = 0) {
  const estagioValores = estagiosVazios();
  for (const lin of linhas) {
    if (!(Math.abs(lin.valor) > 0.0001)) continue;
    if (isCustoIrrigacao(lin)) {
      estagioValores.irrigacao += lin.valor;
      continue;
    }
    const col = colunaDestino(lin);
    if (!col) {
      acumularDestinoSemColuna(estagioValores, lin, lin.valor);
      continue;
    }
    acumularEstagio(estagioValores, classificarLinha(lin), col, lin, lin.valor);
  }
  return {
    estagios: montarEstagiosProducao(estagioValores, ha, tons, totalPool),
  };
}

const MATRIZ_CACHE_MS = 120_000;
const matrizCache = new Map();
const matrizInflight = new Map();

function chaveMatriz(filtros, incluirEstagios) {
  const parametros = lerParametrosTecnicos(filtros.safraId, filtros.anomesInicio, filtros.anomesFim);
  return JSON.stringify({
    parametros: [parametros.areaPlantio, parametros.areaSoca, parametros.areaIrrigacao, parametros.areaArrendada, parametros.armazenado],
    anomesInicio: filtros.anomesInicio ?? null,
    anomesFim: filtros.anomesFim ?? null,
    safraId: filtros.safraId ?? null,
    negocios: filtros.negocios ?? null,
    objetoCusto: filtros.objetoCusto ?? null,
    processo: filtros.processo ?? null,
    subprocesso: filtros.subprocesso ?? null,
    atividade: filtros.atividade ?? null,
    incluirEstagios,
    somenteEstagios: filtros.somenteEstagios === true || filtros.somenteEstagios === 1 || filtros.somenteEstagios === '1',
  });
}

export async function consultarMatrizSubprocesso(filtros = {}) {
  const incluirEstagios =
    filtros.incluirEstagios !== false && filtros.incluirEstagios !== 0 && filtros.incluirEstagios !== '0';
  const somenteEstagios =
    filtros.somenteEstagios === true || filtros.somenteEstagios === 1 || filtros.somenteEstagios === '1';
  const key = chaveMatriz(filtros, incluirEstagios);
  const hit = matrizCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const pending = matrizInflight.get(key);
  if (pending) return pending;

  const run = calcularMatrizSubprocesso(filtros, incluirEstagios, somenteEstagios)
    .then((value) => {
      matrizCache.set(key, { value, expires: Date.now() + MATRIZ_CACHE_MS });
      while (matrizCache.size > 20) {
        const oldest = matrizCache.keys().next().value;
        matrizCache.delete(oldest);
      }
      matrizInflight.delete(key);
      return value;
    })
    .catch((err) => {
      matrizInflight.delete(key);
      throw err;
    });
  matrizInflight.set(key, run);
  return run;
}

export async function consultarArrendamentoSafra(filtros, { consultar = executeQuery } = {}) {
  const result = await consultar(MATRIZ_LINHAS_SQL, bindsConsulta(filtros));
  const linhas = (result.rows || []).map(mapLinha);
  const estagios = montarSomenteEstagios(linhas, {}, 0).estagios;
  const custo = estagios.linhas.find((linha) => linha.chave === 'arrendamento')?.valor || 0;
  const parametros = lerParametrosTecnicos(filtros.safraId, filtros.anomesInicio, filtros.anomesFim);
  // O período identifica a safra no histórico. Cadastros antigos podem ter sido
  // gravados com o período correto e o seletor de safra de outro ano.
  const porPeriodo = parametros.armazenado ? [] : db.prepare(
    'SELECT safra_id, area_arrendada FROM parametros_tecnicos WHERE anomes_inicio = ? AND anomes_fim = ?',
  ).all(String(filtros.anomesInicio), String(filtros.anomesFim));
  const areasPeriodo = new Set(porPeriodo.map((row) => Number(row.area_arrendada)));
  const periodoUnico = areasPeriodo.size === 1;
  const conflito = areasPeriodo.size > 1;
  const areas = parametros.armazenado || periodoUnico || conflito ? [] : listHarvestAreas(filtros.safraId).areas;
  const arrendadas = areas.filter((area) => /arrend/i.test(area.description));
  const area = parametros.armazenado ? parametros.areaArrendada
    : periodoUnico ? Number(porPeriodo[0].area_arrendada)
    : arrendadas.reduce((sum, item) => sum + (Number(item.area) || 0), 0);
  return { custo, area, rHa: indicadorArrendamento(custo, area),
    fonteArea: parametros.armazenado ? 'Parâmetros de Estágio de produção'
      : periodoUnico ? `Parâmetros de Estágio de produção do período ${filtros.anomesInicio} a ${filtros.anomesFim}`
      : 'Cadastros de áreas arrendadas da safra',
    ...(conflito ? { erro: 'Há áreas arrendadas divergentes cadastradas para este período.' } : {}),
    possuiCustos: linhas.length > 0 };
}

async function calcularMatrizSubprocesso(filtros, incluirEstagios, somenteEstagios = false) {
  const eff = filtrosEff(filtros);
  const binds = bindsConsulta(filtros);

  // Áreas do estágio vêm do botão Extrair. Aqui só as linhas e a moagem,
  // senão a tela espera o apontamento de plantio, soqueira e irrigação.
  const [result, totalPool, toneladas, unidadesFontes] = await Promise.all([
    executeQuery(MATRIZ_LINHAS_SQL, binds),
    consultarTotalLancamentoConsolidado(eff),
    moagemEntradaCana(eff),
    incluirEstagios
      ? unidadesPorColuna(eff, { buscarOracle: false })
      : unidadesPorColuna(eff),
  ]);

  const linhas = (result.rows || []).map(mapLinha);
  const { unidades, fontes } = unidadesFontes;
  const matriz =
    somenteEstagios && incluirEstagios
      ? montarSomenteEstagios(linhas, unidades, toneladas, totalPool)
      : montarMatriz(
          linhas,
          unidades,
          toneladas,
          totalPool
        );
  if (!incluirEstagios) delete matriz.estagios;
  else if (matriz.estagios) matriz.estagios.parametros = parametrosArea(matriz.estagios);
  if (somenteEstagios) {
    return {
      filtros: {
        ...eff,
        negociosConsulta: negociosParaConsulta(eff),
        negociosSelecionados: normalizeNegocios(filtros),
      },
      resumo: {
        totalPool,
        totalMatriz: 0,
        totalForaMatriz: 0,
        qtdLinhasOracle: linhas.length,
      },
      colunas: [],
      linhas: [],
      hectareas: {},
      fontesUnidades: {},
      ...matriz,
    };
  }
  const totalMatriz = matriz.colunas
    .filter((col) => !['preparo', 'plantio', 'tratos_planta'].includes(col.key))
    .reduce((sum, col) => sum + col.total, 0);
  const totalForaMatriz = Math.max(0, totalPool - totalMatriz);

  return {
    filtros: {
      ...eff,
      negociosConsulta: negociosParaConsulta(eff),
      negociosSelecionados: normalizeNegocios(filtros),
    },
    logica: {
      colunas:
        'Preparo 1/1, plantio 1/2, tratos planta 1/3, colheita de mudas (1/1 semente/muda), manutenção de soqueira proc 2; sistema de colheita proc 3 separado; formação = soma preparo + plantio + tratos planta + colheita de mudas',
      irrigacao:
        'Custos com origem ou destino proc 4 ficam no estágio Irrigação e não compõem Formação nem Manutenção de soqueira',
      maquina:
        'Equip. automotivo/industrial (grupo_item 4/5), transportes de terceiros (18), aluguel de máquinas, manutenção (20), materiais/consumo (21), combustíveis (25), energia fora irrigação (23) e demais aluguéis operacionais (17)',
      insumos: 'Empenho grupo 24 (produtos e insumos) — uma linha por empenho',
      operacao:
        'Operação = Máquina e Mão de obra (grupos 10, 19 e 22); irrigação permanece no seu estágio',
      adm: 'Administrativo e arrendamento ficam nos respectivos estágios e não compõem Formação nem Manutenção de soqueira',
      rHa:
        'Valor rateado ÷ área armazenada no Estágio de produção para a safra e período; sem parâmetros armazenados, usa ha do apontamento: preparo/plantio/tratos planta/formação usam automotivo.itens_apontamento.area com cod_operacaoagricola = 41; tratos soca usa agricola.apontamentoitem nas operações M13, M56, M80 e M342',
      unidades:
        'Preparo, plantio, tratos planta e formação → área da op. 41 em automotivo.itens_apontamento; tratos soca → área do apontamento agrícola (M13, M56, M80, M342); CORTE SEMENTE permanece no Un realizado só para detalhe da colheita de mudas',
      formacao:
        'Coluna calculada: preparo + plantio + tratos planta + colheita de mudas; R$/ha usa a área da op. 41',
    },
    resumo: {
      totalPool,
      totalMatriz,
      totalForaMatriz,
      qtdLinhasOracle: linhas.length,
    },
    fontesUnidades: fontes,
    ...matriz,
  };
}
