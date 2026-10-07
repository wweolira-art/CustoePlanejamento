import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { executeQuery } from '../utils/oracle.js';
import {
  bindsObjetoCusto,
  expandNegociosCana,
  normalizeNegocios,
} from '../utils/filtros.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const LANCAMENTO_TOTAL_SQL = readFileSync(
  join(__dirname, '../sql/lancamentoConsolidadoTotal.sql'),
  'utf8'
)
  .replace(/^--.*$/gm, '')
  .trim();

const LANCAMENTO_CLASSIFICADO_SQL = readFileSync(
  join(__dirname, '../sql/lancamentoClassificado.sql'),
  'utf8'
)
  .replace(/^--.*$/gm, '')
  .trim();

const COMPOSICAO_POR_ESTAGIO_SQL = readFileSync(
  join(__dirname, '../sql/composicaoPorEstagio.sql'),
  'utf8'
)
  .replace(/^--.*$/gm, '')
  .trim();

const COMPOSICAO_CUSTO_TOTAL_SQL = readFileSync(
  join(__dirname, '../sql/composicaoCustoTotal.sql'),
  'utf8'
)
  .replace(/^--.*$/gm, '')
  .trim();

function bindsConsulta(filtros = {}) {
  const negocios = negociosParaConsulta(filtros);
  const obj = bindsObjetoCusto({ ...filtros, negocios });
  return {
    negociosCsv: obj.negociosCsv,
    anomesInicio: filtros.anomesInicio ?? null,
    anomesFim: filtros.anomesFim ?? null,
    objetoCusto: obj.objetoCusto,
    processo: obj.processo,
    subprocesso: obj.subprocesso,
    atividade: obj.atividade,
  };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function negociosParaConsulta(filtros = {}) {
  const base = normalizeNegocios(filtros);
  const expandidos = expandNegociosCana(base);
  return expandidos?.length ? expandidos : null;
}

/**
 * Soma direta de custo.lancamento_custo (tipo R, empenho 1/2),
 * com exclusão de objetos negócio 5 / processo 3 ou 4 e negócios 2, 98, 90, 6, 99, 8, 7.
 */
export async function consultarTotalLancamentoConsolidado(filtros = {}) {
  const result = await executeQuery(LANCAMENTO_TOTAL_SQL, bindsConsulta(filtros));
  const row = result.rows?.[0];
  return toNumber(row?.TOTAL_LANCAMENTO ?? row?.total_lancamento);
}

/**
 * Composição do custo total: outros (5/1), insumo (grupo 24), arrendamento (5/2), operação = restante.
 */
export async function consultarComposicaoCustoTotal(filtros = {}) {
  const result = await executeQuery(
    COMPOSICAO_CUSTO_TOTAL_SQL,
    bindsConsulta(filtros)
  );
  const row = result.rows?.[0] || {};
  const total = toNumber(row.TOTAL_LANCAMENTO ?? row.total_lancamento);
  const outrosCustos = toNumber(
    row.TOTAL_OUTROS_CUSTOS ?? row.total_outros_custos
  );
  const insumo = toNumber(row.TOTAL_INSUMO ?? row.total_insumo);
  const arrendamento = toNumber(row.TOTAL_ARRENDAMENTO ?? row.total_arrendamento);
  const operacao = Math.max(0, total - outrosCustos - insumo - arrendamento);

  return {
    total,
    outrosCustos,
    insumo,
    arrendamento,
    operacao,
  };
}

const ESTAGIO_ITENS = [
  { chave: 'tratos_soca', label: 'Tratos Soca', column: 'tratos_soca' },
  { chave: 'corte_transbordo', label: 'Corte + transbordo+ tombo', column: 'corte_transbordo' },
  { chave: 'formacao', label: 'Formação', column: 'formacao' },
  { chave: 'arrendamento', label: 'Arrendamento', column: 'arrendamento' },
  { chave: 'apoio_adm', label: 'Apoio + adm + bituca', column: 'apoio_adm' },
  { chave: 'transporte', label: 'Transporte', column: 'transporte' },
];

/**
 * Composição por estágio de produção (objeto de custo: cana 1/1–1/3, arrendamento 5/2,
 * transporte 3/1/2, apoio/adm 3 e 5/1). Outros = residual do pool.
 */
export async function consultarComposicaoPorEstagio(filtros = {}) {
  const result = await executeQuery(
    COMPOSICAO_POR_ESTAGIO_SQL,
    bindsConsulta(filtros)
  );
  const row = result.rows?.[0] || {};
  const total = toNumber(row.TOTAL_LANCAMENTO ?? row.total_lancamento);
  const itens = ESTAGIO_ITENS.map((item) => ({
    chave: item.chave,
    label: item.label,
    valor: toNumber(row[item.column.toUpperCase()] ?? row[item.column]),
  }));
  const alocado = itens.reduce((sum, item) => sum + item.valor, 0);
  const outros = Math.max(0, total - alocado);
  itens.push({ chave: 'outros', label: 'Outros', valor: outros });
  return itens.filter((item) => item.valor > 0.005);
}

/** Linhas agrupadas por categoria + anomes + objeto de custo. */
export async function consultarLancamentoClassificado(filtros = {}) {
  const result = await executeQuery(
    LANCAMENTO_CLASSIFICADO_SQL,
    bindsConsulta(filtros)
  );
  return (result.rows || []).map((row) => ({
    categoria: String(row.CATEGORIA ?? row.categoria ?? '').toLowerCase(),
    anomes: row.ANOMES != null ? String(row.ANOMES) : null,
    codObjetoCusto: Number(row.COD_OBJETOCUSTO ?? row.cod_objetocusto),
    valor: toNumber(row.VALOR ?? row.valor),
  }));
}

export async function consultarTotaisPorCategoria(filtros = {}) {
  const linhas = await consultarLancamentoClassificado(filtros);
  const totais = {};
  for (const lin of linhas) {
    totais[lin.categoria] = (totais[lin.categoria] || 0) + lin.valor;
  }
  return totais;
}

export { negociosParaConsulta };
