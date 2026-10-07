/**
 * Parseia filtros comuns da API (query string).
 */

/** Lista numérica a partir de valor único, CSV ou array (ex.: ?negocio=1,2 ou ?negocio=1&negocio=2). */
export function parseNumList(value, field) {
  if (value == null) return null;
  const parts = Array.isArray(value) ? value : String(value).split(/[,;]/);
  const nums = [];
  for (const part of parts) {
    const t = String(part).trim();
    if (!t) continue;
    const n = Number(t);
    if (!Number.isFinite(n)) {
      const error = new Error(`${field} deve ser numérico`);
      error.status = 400;
      throw error;
    }
    nums.push(n);
  }
  return nums.length ? [...new Set(nums)] : null;
}

/** Negócios sempre fora do pool de custo agrícola (total, composição e rateio). */
export const NEGOCIOS_FORA_POOL = [2, 98, 90, 6, 99, 8, 7];

/**
 * Negócio 1 (Cana de Açúcar) inclui custos compartilhados do negócio 3
 * (oficina, transporte, mecanização) e do negócio 5 (administração, arrendamento).
 */
export function expandNegociosCana(negocios) {
  if (!Array.isArray(negocios) || !negocios.length) return negocios ?? null;
  if (negocios.length === 1 && negocios[0] === 1) {
    return [1, 3, 5];
  }
  return negocios;
}

/** Normaliza negocio/negocios do filtro para number[] | null. */
export function normalizeNegocios(filtros = {}) {
  if (Array.isArray(filtros.negocios) && filtros.negocios.length) {
    return filtros.negocios.map(Number).filter((n) => Number.isFinite(n));
  }
  if (filtros.negocio != null && filtros.negocio !== '') {
    if (Array.isArray(filtros.negocio)) {
      return filtros.negocio.map(Number).filter((n) => Number.isFinite(n));
    }
    const n = Number(filtros.negocio);
    return Number.isFinite(n) ? [n] : null;
  }
  return null;
}

export function parseFiltros(query = {}) {
  const equipamento = query.equipamento
    ? String(query.equipamento).trim()
    : null;

  const parseAnomes = (value, field) => {
    if (value == null || String(value).trim() === '') return null;
    const v = String(value).trim();
    if (!/^\d{6}$/.test(v)) {
      const error = new Error(
        `${field} deve estar no formato YYYYMM (ex: 202601)`
      );
      error.status = 400;
      throw error;
    }
    return v;
  };

  // Compat: ?anomes=202401 equivale a início=fim
  const anomesUnico = parseAnomes(query.anomes, 'anomes');
  let anomesInicio = parseAnomes(
    query.anomesInicio ?? query.anomes_inicio,
    'anomesInicio'
  );
  let anomesFim = parseAnomes(
    query.anomesFim ?? query.anomes_fim,
    'anomesFim'
  );

  if (anomesUnico && !anomesInicio && !anomesFim) {
    anomesInicio = anomesUnico;
    anomesFim = anomesUnico;
  }

  if (anomesInicio && anomesFim && anomesInicio > anomesFim) {
    const error = new Error('anomesInicio não pode ser maior que anomesFim');
    error.status = 400;
    throw error;
  }

  const toNum = (value, field) => {
    if (value == null || String(value).trim() === '') return null;
    const n = Number(String(value).trim());
    if (!Number.isFinite(n)) {
      const error = new Error(`${field} deve ser numérico`);
      error.status = 400;
      throw error;
    }
    return n;
  };

  const negocios = parseNumList(query.negocio ?? query.negocios, 'negocio');
  const fazenda = toNum(query.fazenda, 'fazenda');
  const operacao = toNum(query.operacao, 'operacao');
  const safraId = toNum(query.safraId ?? query.safra_id, 'safraId');

  const tipoManutencaoRaw = String(query.tipoManutencao || '')
    .trim()
    .toLowerCase();
  const tipoManutencao =
    tipoManutencaoRaw === 'corretiva' || tipoManutencaoRaw === 'programada'
      ? tipoManutencaoRaw
      : null;

  const motivoParadaRaw = String(query.motivoParada || '').trim();
  const motivoParada = motivoParadaRaw ? motivoParadaRaw : null;

  return {
    anomes: anomesUnico || anomesInicio || anomesFim || null,
    anomesInicio,
    anomesFim,
    safraId,
    equipamento,
    fazenda,
    operacao,
    tipoManutencao,
    motivoParada,
    /** Lista de negócios selecionados (null = todos). */
    negocios,
    /** Compat: primeiro negócio quando há exatamente um. */
    negocio: negocios?.length === 1 ? negocios[0] : null,
    processo: toNum(query.processo, 'processo'),
    subprocesso: toNum(query.subprocesso, 'subprocesso'),
    atividade: toNum(query.atividade, 'atividade'),
    objetoCusto: toNum(query.objetoCusto ?? query.objetocusto, 'objetoCusto'),
  };
}

/** Binds de objeto de custo para SQL (negócio via CSV para multi-select). */
export function bindsObjetoCusto(filtros = {}) {
  const negocios = normalizeNegocios(filtros);
  return {
    negociosCsv: negocios?.length ? negocios.join(',') : null,
    processo: filtros.processo ?? null,
    subprocesso: filtros.subprocesso ?? null,
    atividade: filtros.atividade ?? null,
    objetoCusto: filtros.objetoCusto ?? null,
  };
}

/** Condição: negócio na lista CSV ou todos se null. */
export function sqlCondNegocio(expressao = 'oc.negocio') {
  return `(:negociosCsv IS NULL OR INSTR(',' || :negociosCsv || ',', ',' || TO_CHAR(${expressao}) || ',') > 0)`;
}

/**
 * EXISTS padrão contra custo.objetocusto.
 * @param {string} colunaExpressao - ex: "a.cod_objetocusto" ou "NVL(x, y)"
 */
export function sqlFiltroObjetoCusto(colunaExpressao) {
  return `
AND EXISTS (
    SELECT 1
    FROM custo.objetocusto oc
    WHERE oc.cod_objetocusto = ${colunaExpressao}
      AND (:objetoCusto IS NULL OR oc.cod_objetocusto = :objetoCusto)
      AND ${sqlCondNegocio('oc.negocio')}
      AND (:processo IS NULL OR oc.processo = :processo)
      AND (:subprocesso IS NULL OR oc.subprocesso = :subprocesso)
      AND (:atividade IS NULL OR oc.atividade = :atividade)
)
`.trim();
}

/**
 * Filtro opcional: se nenhum critério de objeto foi informado, não restringe.
 */
export function sqlFiltroObjetoCustoOpcional(colunaExpressao) {
  return `
AND (
    (
        :objetoCusto IS NULL
        AND :negociosCsv IS NULL
        AND :processo IS NULL
        AND :subprocesso IS NULL
        AND :atividade IS NULL
    )
    OR EXISTS (
        SELECT 1
        FROM custo.objetocusto oc
        WHERE oc.cod_objetocusto = ${colunaExpressao}
          AND (:objetoCusto IS NULL OR oc.cod_objetocusto = :objetoCusto)
          AND ${sqlCondNegocio('oc.negocio')}
          AND (:processo IS NULL OR oc.processo = :processo)
          AND (:subprocesso IS NULL OR oc.subprocesso = :subprocesso)
          AND (:atividade IS NULL OR oc.atividade = :atividade)
    )
)
`.trim();
}

/** Filtro de anomes (YYYYMM) por intervalo inclusivo. */
export function sqlFiltroAnomes(expressaoAnomes) {
  return `
AND (:anomesInicio IS NULL OR ${expressaoAnomes} >= :anomesInicio)
AND (:anomesFim IS NULL OR ${expressaoAnomes} <= :anomesFim)
`.trim();
}
