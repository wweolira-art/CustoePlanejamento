/**
 * Proxy da API ORDS: ENTRADACANAMAQUINA
 * https://.../ords/admin/entradacanamaquina/
 */

const PAGE_SIZE = 500;
const MAX_ROWS = 20000;
const MAX_UPDATES = 5000;

function baseUrl() {
  const fromEnv =
    process.env.ORDS_ENTRADA_CANA_MAQUINA_URL?.trim() ||
    process.env.ENTRADA_CANA_MAQUINA_ORDS_URL?.trim();
  if (!fromEnv) throw new Error('Configure ORDS_ENTRADA_CANA_MAQUINA_URL no .env.');
  return fromEnv.replace(/\/?$/, '/');
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDataDia(value) {
  if (value == null || String(value).trim() === '') return null;
  const s = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

function diaUtcFromIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function selfHrefFromItem(item) {
  const links = Array.isArray(item?.links) ? item.links : [];
  const self = links.find((l) => l?.rel === 'self' && l?.href);
  return self?.href ? String(self.href) : null;
}

function mapItem(item, { includeHref = false } = {}) {
  if (!item || typeof item !== 'object') return null;
  const row = {
    maquina: toNumber(item.maquina),
    fazenda: item.fazenda != null ? String(item.fazenda).trim() : null,
    talhao: toNumber(item.talhao),
    dataColheita:
      item.datacolheita != null ? String(item.datacolheita) : null,
    tipoColheita:
      item.tipocolheita != null ? String(item.tipocolheita).trim() : null,
    tipoCana: item.tipocana != null ? String(item.tipocana).trim() : null,
    peso: toNumber(item.peso),
    impMineral: toNumber(item.impmineral),
    safra: item.safra != null ? String(item.safra).trim() : null,
    codEquipamento: toNumber(item.cod_equipamento),
  };
  if (includeHref) row.selfHref = selfHrefFromItem(item);
  return row;
}

function toOrdsPutBody(row, codEquipamento) {
  return {
    maquina: row.maquina,
    fazenda: row.fazenda,
    talhao: row.talhao,
    datacolheita: row.dataColheita,
    tipocolheita: row.tipoColheita,
    tipocana: row.tipoCana,
    peso: row.peso,
    impmineral: row.impMineral,
    safra: row.safra,
    cod_equipamento: codEquipamento,
  };
}

function matchBusca(row, busca) {
  if (!busca) return true;
  const q = busca.toLowerCase();
  const blob = [
    row.maquina,
    row.fazenda,
    row.talhao,
    row.tipoColheita,
    row.tipoCana,
    row.safra,
    row.codEquipamento,
  ]
    .filter((v) => v != null && v !== '')
    .join(' ')
    .toLowerCase();
  return blob.includes(q);
}

function matchPeriodoData(row, dataInicio, dataFim) {
  if (!dataInicio && !dataFim) return true;
  const dia = diaUtcFromIso(row.dataColheita);
  if (!dia) return false;
  if (dataInicio && dia < dataInicio) return false;
  if (dataFim && dia > dataFim) return false;
  return true;
}

function matchMaquina(row, maquina) {
  if (maquina == null || maquina === '') return true;
  return String(row.maquina) === String(maquina);
}

function parsePeriodoObrigatorio(filtros) {
  const inicioDt = parseDataDia(filtros.dataInicio);
  const fimDt = parseDataDia(filtros.dataFim);
  const dataInicio = inicioDt ? diaUtcFromIso(inicioDt.toISOString()) : null;
  const dataFim = fimDt ? diaUtcFromIso(fimDt.toISOString()) : null;

  if (!dataInicio || !dataFim) {
    const err = new Error(
      'Informe data inicial e data final (AAAA-MM-DD) para o período.'
    );
    err.status = 400;
    throw err;
  }
  if (dataInicio > dataFim) {
    const err = new Error('Data inicial não pode ser maior que a final.');
    err.status = 400;
    throw err;
  }
  return { dataInicio, dataFim };
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(
      `Falha na API ORDS entrada cana máquina (${response.status})${
        text ? `: ${text.slice(0, 200)}` : ''
      }`
    );
    err.status = response.status >= 500 ? 502 : response.status;
    throw err;
  }
  return response.json();
}

async function putOrdsItem(selfHref, body) {
  const response = await fetch(selfHref, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(
      `Falha ao atualizar registro ORDS (${response.status})${
        text ? `: ${text.slice(0, 200)}` : ''
      }`
    );
    err.status = response.status >= 500 ? 502 : response.status;
    throw err;
  }
  return response.json().catch(() => null);
}

async function coletarLinhas(filtros = {}, { includeHref = false } = {}) {
  const buscaRaw = filtros.busca ?? null;
  const busca =
    buscaRaw != null && String(buscaRaw).trim() !== ''
      ? String(buscaRaw).trim()
      : null;

  let dataInicio = null;
  let dataFim = null;
  if (filtros.dataInicio || filtros.dataFim) {
    const inicioDt = parseDataDia(filtros.dataInicio);
    const fimDt = parseDataDia(filtros.dataFim);
    dataInicio = inicioDt ? diaUtcFromIso(inicioDt.toISOString()) : null;
    dataFim = fimDt ? diaUtcFromIso(fimDt.toISOString()) : null;
    if (filtros.dataInicio && !dataInicio) {
      const err = new Error('Data inicial inválida. Use AAAA-MM-DD.');
      err.status = 400;
      throw err;
    }
    if (filtros.dataFim && !dataFim) {
      const err = new Error('Data final inválida. Use AAAA-MM-DD.');
      err.status = 400;
      throw err;
    }
    if (dataInicio && dataFim && dataInicio > dataFim) {
      const err = new Error('Data inicial não pode ser maior que a final.');
      err.status = 400;
      throw err;
    }
  }

  const maquina =
    filtros.maquina != null && String(filtros.maquina).trim() !== ''
      ? String(filtros.maquina).trim()
      : null;

  const userLimit = toNumber(filtros.limit);
  const maxRows =
    userLimit != null && userLimit > 0
      ? Math.min(userLimit, MAX_ROWS)
      : MAX_ROWS;

  const dados = [];
  let offset = 0;
  let hasMore = true;
  let pages = 0;

  while (hasMore && dados.length < maxRows) {
    const url = `${baseUrl()}?offset=${offset}&limit=${PAGE_SIZE}`;
    const payload = await fetchPage(url);
    const items = Array.isArray(payload.items) ? payload.items : [];
    for (const item of items) {
      const row = mapItem(item, { includeHref });
      if (
        row &&
        matchMaquina(row, maquina) &&
        matchPeriodoData(row, dataInicio, dataFim) &&
        matchBusca(row, busca)
      ) {
        dados.push(row);
        if (dados.length >= maxRows) break;
      }
    }
    pages += 1;
    hasMore = Boolean(payload.hasMore) && items.length > 0;
    offset += items.length;
    if (items.length === 0) break;
  }

  return {
    dados,
    pages,
    hasMore,
    maxRows,
    filtros: { busca, dataInicio, dataFim, maquina, limit: maxRows },
  };
}

export async function listarEntradaCanaMaquina(filtros = {}) {
  const collected = await coletarLinhas(filtros, { includeHref: false });
  const pesoTotal = collected.dados.reduce(
    (acc, r) => acc + (r.peso ?? 0),
    0
  );

  return {
    filtros: collected.filtros,
    logica: {
      fonte: 'ORDS admin/entradacanamaquina (ENTRADACANAMAQUINA)',
      url: baseUrl(),
      periodo: 'filtro por dia da coluna datacolheita (UTC)',
    },
    resumo: {
      totalLinhas: collected.dados.length,
      paginasOrds: collected.pages,
      pesoTotal,
      truncado: collected.hasMore,
    },
    dados: collected.dados,
  };
}

export async function listarMaquinasDistinct(filtros = {}) {
  const payload = await listarEntradaCanaMaquina({
    ...filtros,
    busca: null,
    maquina: null,
  });
  const mapa = new Map();
  for (const row of payload.dados || []) {
    if (row.maquina == null) continue;
    const key = String(row.maquina);
    const prev = mapa.get(key) || {
      maquina: row.maquina,
      qtdEntradas: 0,
      ultimaData: null,
      codEquipamento: null,
    };
    prev.qtdEntradas += 1;
    if (row.codEquipamento != null) prev.codEquipamento = row.codEquipamento;
    if (
      row.dataColheita &&
      (!prev.ultimaData || String(row.dataColheita) > String(prev.ultimaData))
    ) {
      prev.ultimaData = row.dataColheita;
    }
    mapa.set(key, prev);
  }

  const maquinas = [...mapa.values()].sort((a, b) => {
    const na = Number(a.maquina);
    const nb = Number(b.maquina);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a.maquina).localeCompare(String(b.maquina));
  });

  return {
    filtros: payload.filtros,
    logica: {
      ...payload.logica,
      distinto: 'numero maquina (coluna maquina)',
    },
    resumo: {
      totalMaquinas: maquinas.length,
      totalLinhasBase: payload.resumo?.totalLinhas ?? 0,
      truncado: payload.resumo?.truncado ?? false,
    },
    dados: maquinas,
  };
}

/**
 * Atualiza cod_equipamento nas linhas ORDS da máquina + período (datacolheita).
 */
export async function atualizarCodEquipamentoMaquinaOrds(params = {}) {
  const maquina =
    params.maquina != null && String(params.maquina).trim() !== ''
      ? String(params.maquina).trim()
      : null;
  if (!maquina) {
    const err = new Error('Informe o número da máquina.');
    err.status = 400;
    throw err;
  }

  const { dataInicio, dataFim } = parsePeriodoObrigatorio(params);
  const limpar = params.limpar === true || params.codEquipamento === null;
  let codEquipamento = null;
  if (!limpar) {
    codEquipamento = toNumber(params.codEquipamento);
    if (codEquipamento == null) {
      const err = new Error('Informe um cod_equipamento válido.');
      err.status = 400;
      throw err;
    }
  }

  const collected = await coletarLinhas(
    {
      maquina,
      dataInicio,
      dataFim,
      limit: MAX_UPDATES,
    },
    { includeHref: true }
  );

  if (!collected.dados.length) {
    return {
      filtros: { maquina, dataInicio, dataFim, codEquipamento, limpar },
      resumo: {
        encontrados: 0,
        atualizados: 0,
        falhas: 0,
        truncado: collected.hasMore,
      },
      erros: [],
      dados: [],
    };
  }

  let atualizados = 0;
  const erros = [];
  const atualizadosRows = [];

  for (const row of collected.dados) {
    if (!row.selfHref) {
      erros.push({
        maquina: row.maquina,
        dataColheita: row.dataColheita,
        erro: 'Registro sem link self na ORDS',
      });
      continue;
    }
    try {
      await putOrdsItem(row.selfHref, toOrdsPutBody(row, codEquipamento));
      atualizados += 1;
      atualizadosRows.push({
        maquina: row.maquina,
        fazenda: row.fazenda,
        talhao: row.talhao,
        dataColheita: row.dataColheita,
        codEquipamento,
      });
    } catch (err) {
      erros.push({
        maquina: row.maquina,
        dataColheita: row.dataColheita,
        erro: err.message || 'Falha no PUT',
      });
    }
  }

  return {
    filtros: { maquina, dataInicio, dataFim, codEquipamento, limpar },
    logica: {
      fonte: 'ORDS PUT item (mantém demais colunas; altera só cod_equipamento)',
      url: baseUrl(),
    },
    resumo: {
      encontrados: collected.dados.length,
      atualizados,
      falhas: erros.length,
      truncado: collected.hasMore,
    },
    erros,
    dados: atualizadosRows,
  };
}
