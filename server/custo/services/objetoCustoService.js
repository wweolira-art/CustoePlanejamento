import { executeQuery } from '../utils/oracle.js';
import { bindsObjetoCusto, sqlCondNegocio } from '../utils/filtros.js';

/**
 * Descrições da hierarquia (custo.objetocusto, atividade = 0):
 * - negócio:     processo = 0 AND subprocesso = 0
 * - processo:    subprocesso = 0 AND processo <> 0
 * - subprocesso: subprocesso <> 0 (único por processo + subprocesso)
 */
const NEGOCIOS_SQL = `
SELECT
    oc.negocio AS codigo,
    MAX(oc.descricao) AS descricao
FROM custo.objetocusto oc
WHERE NVL(oc.atividade, 0) = 0
  AND NVL(oc.processo, 0) = 0
  AND NVL(oc.subprocesso, 0) = 0
  AND oc.negocio IS NOT NULL
GROUP BY oc.negocio
ORDER BY oc.negocio
`;

const PROCESSOS_SQL = `
SELECT
    oc.processo AS codigo,
    MAX(oc.descricao) AS descricao
FROM custo.objetocusto oc
WHERE NVL(oc.atividade, 0) = 0
  AND NVL(oc.subprocesso, 0) = 0
  AND NVL(oc.processo, 0) <> 0
  AND ${sqlCondNegocio('oc.negocio')}
GROUP BY oc.processo
ORDER BY oc.processo
`;

/**
 * Subprocessos = cabeçalhos atividade = 0 com subprocesso <> 0.
 * Agrupa por (processo, subprocesso): o mesmo código 1/2 existe em vários processos
 * (ex.: Preparo Solo = proc 1 / sub 1; outro cadastro também usa sub 1).
 */
const SUBPROCESSOS_SQL = `
SELECT
    oc.processo AS processo,
    oc.subprocesso AS codigo,
    MAX(oc.descricao) AS descricao
FROM custo.objetocusto oc
WHERE NVL(oc.atividade, 0) = 0
  AND NVL(oc.subprocesso, 0) <> 0
  AND ${sqlCondNegocio('oc.negocio')}
  AND (:processo IS NULL OR oc.processo = :processo)
GROUP BY
    oc.processo,
    oc.subprocesso
ORDER BY
    oc.processo,
    oc.subprocesso,
    MAX(oc.descricao)
`;

const ATIVIDADES_SQL = `
SELECT
    oc.atividade AS codigo,
    MIN(oc.descricao) AS descricao
FROM custo.objetocusto oc
WHERE NVL(oc.atividade, 0) <> 0
  AND ${sqlCondNegocio('oc.negocio')}
  AND (:processo IS NULL OR oc.processo = :processo)
  AND (:subprocesso IS NULL OR oc.subprocesso = :subprocesso)
GROUP BY oc.atividade
ORDER BY oc.atividade
`;

const LISTA_SQL = `
SELECT
    oc.cod_objetocusto,
    oc.descricao,
    oc.negocio,
    oc.processo,
    oc.subprocesso,
    oc.atividade,
    oc.inativo
FROM custo.objetocusto oc
WHERE (:objetoCusto IS NULL OR oc.cod_objetocusto = :objetoCusto)
  AND ${sqlCondNegocio('oc.negocio')}
  AND (:processo IS NULL OR oc.processo = :processo)
  AND (:subprocesso IS NULL OR oc.subprocesso = :subprocesso)
  AND (:atividade IS NULL OR oc.atividade = :atividade)
  AND (
      :somenteAtivos IS NULL
      OR :somenteAtivos = 0
      OR NVL(oc.inativo, 'F') = 'F'
      OR UPPER(TRIM(TO_CHAR(oc.inativo))) IN ('N', '0')
  )
  AND (
      :incluirCabecalhos = 1
      OR NVL(oc.atividade, 0) <> 0
  )
ORDER BY
    oc.negocio,
    oc.processo,
    oc.subprocesso,
    oc.atividade,
    oc.cod_objetocusto
`;

function mapObjeto(row) {
  return {
    codObjetoCusto: row.COD_OBJETOCUSTO,
    descricao: row.DESCRICAO,
    negocio: row.NEGOCIO,
    processo: row.PROCESSO,
    subprocesso: row.SUBPROCESSO,
    atividade: row.ATIVIDADE,
    inativo: row.INATIVO,
  };
}

function mapDimensao(row) {
  return {
    codigo: row.CODIGO,
    descricao: row.DESCRICAO != null ? String(row.DESCRICAO).trim() : null,
  };
}

function mapSubprocesso(row) {
  const processo = row.PROCESSO;
  const codigo = row.CODIGO;
  const descricao =
    row.DESCRICAO != null ? String(row.DESCRICAO).trim() : null;
  return {
    codigo,
    processo,
    descricao,
    /** option value: processo|subprocesso — evita colidir códigos iguais */
    valor: `${processo}|${codigo}`,
    rotulo: descricao
      ? `${processo}.${codigo} — ${descricao}`
      : `${processo}.${codigo}`,
  };
}

export async function listarObjetosCusto(filtros = {}) {
  const binds = {
    ...bindsObjetoCusto(filtros),
    somenteAtivos: filtros.somenteAtivos === false ? 0 : 1,
    incluirCabecalhos: filtros.incluirCabecalhos === true ? 1 : 0,
  };

  const result = await executeQuery(LISTA_SQL, binds);
  const dados = (result.rows || []).map(mapObjeto);

  return {
    filtros,
    resumo: { totalLinhas: dados.length },
    dados,
  };
}

export async function listarDimensoesObjetoCusto(filtros = {}) {
  const objBinds = bindsObjetoCusto(filtros);
  const processo = filtros.processo ?? null;
  const subprocesso = filtros.subprocesso ?? null;

  const [negocios, processos, subprocessos, atividades] = await Promise.all([
    executeQuery(NEGOCIOS_SQL, {}),
    executeQuery(PROCESSOS_SQL, { negociosCsv: objBinds.negociosCsv }),
    executeQuery(SUBPROCESSOS_SQL, {
      negociosCsv: objBinds.negociosCsv,
      processo,
    }),
    executeQuery(ATIVIDADES_SQL, {
      negociosCsv: objBinds.negociosCsv,
      processo,
      subprocesso,
    }),
  ]);

  return {
    filtros: {
      negocios: filtros.negocios ?? null,
      negocio: filtros.negocio ?? null,
      processo,
      subprocesso,
    },
    negocios: (negocios.rows || []).map(mapDimensao),
    processos: (processos.rows || []).map(mapDimensao),
    subprocessos: (subprocessos.rows || []).map(mapSubprocesso),
    atividades: (atividades.rows || []).map(mapDimensao),
  };
}
