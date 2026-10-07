import { ORDS_MAX_UPDATES,
  acumularVinculoEquipPeriodo,
  diaUtcFromIso,
  listarVinculosEquipPeriodo,
  parsePeriodoObrigatorio,
  parsePeriodoOpcional,
  putOrdsItem,
  scanOrdsCollection,
  selfHrefFromItem,
  toNumber,
  type VinculoEquipPeriodo,
} from "./ords-common.js";
import { matchPeriodoDia } from "./periodo-colheita.js";

function baseUrl() {
  const fromEnv =
    process.env.ORDS_ENTRADA_CANA_CAMINHAO_URL?.trim() ||
    process.env.ENTRADA_CANA_ORDS_URL?.trim();
  if (!fromEnv) throw new Error("Configure ORDS_ENTRADA_CANA_CAMINHAO_URL no .env.");
  return fromEnv.replace(/\/?$/, "/");
}

export interface EntradaCanaCaminhaoRow {
  pesagem: number | null;
  guia: number | null;
  caminhao: number | null;
  talhao: number | null;
  etapa: number | null;
  data: string | null;
  intQueima: number | null;
  pesoBruto: number | null;
  pesoTara: number | null;
  pesoLiquido: number | null;
  fazenda: string | null;
  tipoColheita: string | null;
  safra: string | null;
  atr: number | null;
  empresa: string | null;
  codEquipamento: number | null;
  selfHref?: string | null;
}

function mapItem(item: Record<string, unknown>, includeHref = false): EntradaCanaCaminhaoRow | null {
  if (!item || typeof item !== "object") return null;
  const row: EntradaCanaCaminhaoRow = {
    pesagem: toNumber(item.pesagem),
    guia: toNumber(item.guia),
    caminhao: toNumber(item.caminhao),
    talhao: toNumber(item.talhao),
    etapa: toNumber(item.etapa),
    data: item.data != null ? String(item.data) : null,
    intQueima: toNumber(item.intqueima),
    pesoBruto: toNumber(item.pesobruto),
    pesoTara: toNumber(item.pesotara),
    pesoLiquido: toNumber(item.pesoliquido),
    fazenda: item.fazenda != null ? String(item.fazenda).trim() : null,
    tipoColheita: item.tipocolheita != null ? String(item.tipocolheita).trim() : null,
    safra: item.safra != null ? String(item.safra).trim() : null,
    atr: toNumber(item.atr),
    empresa: item.empresa != null ? String(item.empresa).trim() : null,
    codEquipamento: toNumber(item.cod_equipamento),
  };
  if (includeHref) row.selfHref = selfHrefFromItem(item as { links?: { rel?: string; href?: string }[] });
  return row;
}

function toOrdsPutBody(row: EntradaCanaCaminhaoRow, codEquipamento: number | null) {
  return {
    pesagem: row.pesagem,
    guia: row.guia,
    caminhao: row.caminhao,
    talhao: row.talhao,
    etapa: row.etapa,
    data: row.data,
    intqueima: row.intQueima,
    pesobruto: row.pesoBruto,
    pesotara: row.pesoTara,
    pesoliquido: row.pesoLiquido,
    fazenda: row.fazenda,
    tipocolheita: row.tipoColheita,
    safra: row.safra,
    atr: row.atr,
    empresa: row.empresa,
    cod_equipamento: codEquipamento,
  };
}

function matchBusca(row: EntradaCanaCaminhaoRow, busca: string | null) {
  if (!busca) return true;
  const q = busca.toLowerCase();
  const blob = [row.pesagem, row.guia, row.caminhao, row.talhao, row.fazenda, row.tipoColheita, row.safra, row.empresa, row.codEquipamento]
    .filter((v) => v != null && v !== "")
    .join(" ")
    .toLowerCase();
  return blob.includes(q);
}

function matchPeriodo(row: EntradaCanaCaminhaoRow, dataInicio: string | null, dataFim: string | null) {
  return matchPeriodoDia(diaUtcFromIso(row.data), dataInicio, dataFim);
}

async function coletarLinhas(
  filtros: { busca?: string | null; dataInicio?: string | null; dataFim?: string | null; caminhao?: string | null; limit?: number | null },
  includeHref = false,
) {
  const busca = filtros.busca?.trim() || null;
  const { dataInicio, dataFim } = parsePeriodoOpcional(filtros);
  const caminhao = filtros.caminhao?.trim() || null;
  const userLimit = toNumber(filtros.limit);
  const maxRows = userLimit != null && userLimit > 0 ? userLimit : Number.MAX_SAFE_INTEGER;

  const collected = await scanOrdsCollection(baseUrl(), {
    maxRows,
    match: (item) => {
      const row = mapItem(item);
      if (!row) return false;
      if (caminhao && String(row.caminhao) !== String(caminhao)) return false;
      if (!matchPeriodo(row, dataInicio, dataFim)) return false;
      if (!matchBusca(row, busca)) return false;
      return true;
    },
    map: (item) => mapItem(item, includeHref) as Record<string, unknown>,
  });

  return {
    ...collected,
    filtros: { busca, dataInicio, dataFim, caminhao, limit: collected.maxRows },
  };
}

export async function listarEntradaCanaCaminhao(filtros: Parameters<typeof coletarLinhas>[0] = {}) {
  const collected = await coletarLinhas(filtros, false);
  const dados = collected.dados as unknown as EntradaCanaCaminhaoRow[];
  const pesoLiquidoTotal = dados.reduce((acc, r) => acc + (r.pesoLiquido ?? 0), 0);
  return {
    filtros: collected.filtros,
    resumo: { totalLinhas: dados.length, paginasOrds: collected.pages, pesoLiquidoTotal, truncado: collected.hasMore },
    dados,
  };
}

export async function listarCaminhoesDistinct(filtros: Parameters<typeof coletarLinhas>[0] = {}) {
  const payload = await listarEntradaCanaCaminhao({ ...filtros, busca: null, caminhao: null });
  const mapa = new Map<
    string,
    {
      caminhao: number | null;
      qtdEntradas: number;
      ultimaData: string | null;
      codEquipamento: number | null;
      porEquip: Map<string, VinculoEquipPeriodo>;
    }
  >();
  for (const row of payload.dados) {
    if (row.caminhao == null) continue;
    const key = String(row.caminhao);
    const prev = mapa.get(key) || {
      caminhao: row.caminhao,
      qtdEntradas: 0,
      ultimaData: null,
      codEquipamento: null,
      porEquip: new Map<string, VinculoEquipPeriodo>(),
    };
    prev.qtdEntradas += 1;
    if (row.codEquipamento != null) prev.codEquipamento = row.codEquipamento;
    if (row.data && (!prev.ultimaData || String(row.data) > String(prev.ultimaData))) prev.ultimaData = row.data;
    acumularVinculoEquipPeriodo(prev.porEquip, row.codEquipamento, diaUtcFromIso(row.data));
    mapa.set(key, prev);
  }
  const dados = [...mapa.values()]
    .map((item) => ({
      caminhao: item.caminhao,
      qtdEntradas: item.qtdEntradas,
      ultimaData: item.ultimaData,
      codEquipamento: item.codEquipamento,
      associacoes: listarVinculosEquipPeriodo(item.porEquip),
    }))
    .sort((a, b) => {
      const na = Number(a.caminhao);
      const nb = Number(b.caminhao);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return String(a.caminhao).localeCompare(String(b.caminhao));
    });
  return {
    filtros: payload.filtros,
    resumo: { totalCaminhoes: dados.length, totalLinhasBase: payload.resumo.totalLinhas, truncado: payload.resumo.truncado },
    dados,
  };
}

export async function atualizarCodEquipamentoCaminhao(params: {
  caminhao?: string | number | null;
  dataInicio?: string | null;
  dataFim?: string | null;
  codEquipamento?: number | string | null;
  limpar?: boolean;
}) {
  const caminhao = params.caminhao != null && String(params.caminhao).trim() !== "" ? String(params.caminhao).trim() : null;
  if (!caminhao) {
    const err = new Error("Informe o número do caminhão.");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  const { dataInicio, dataFim } = parsePeriodoObrigatorio(params);
  const limpar = params.limpar === true || params.codEquipamento === null;
  let codEquipamento: number | null = null;
  if (!limpar) {
    codEquipamento = toNumber(params.codEquipamento);
    if (codEquipamento == null) {
      const err = new Error("Informe um cod_equipamento válido.");
      (err as Error & { status?: number }).status = 400;
      throw err;
    }
  }

  const collected = await coletarLinhas({ caminhao, dataInicio, dataFim, limit: ORDS_MAX_UPDATES }, true);
  const rows = collected.dados as unknown as EntradaCanaCaminhaoRow[];
  if (!rows.length) {
    return {
      filtros: { caminhao, dataInicio, dataFim, codEquipamento, limpar },
      resumo: { encontrados: 0, atualizados: 0, falhas: 0, truncado: collected.hasMore },
      erros: [] as { caminhao?: number | null; pesagem?: number | null; erro: string }[],
      dados: [],
    };
  }

  let atualizados = 0;
  const erros: { caminhao?: number | null; pesagem?: number | null; erro: string }[] = [];
  const atualizadosRows: Record<string, unknown>[] = [];

  for (const row of rows) {
    if (!row.selfHref) {
      erros.push({ caminhao: row.caminhao, pesagem: row.pesagem, erro: "Registro sem link self na ORDS" });
      continue;
    }
    try {
      await putOrdsItem(row.selfHref, toOrdsPutBody(row, codEquipamento));
      atualizados += 1;
      atualizadosRows.push({ pesagem: row.pesagem, guia: row.guia, caminhao: row.caminhao, data: row.data, codEquipamento });
    } catch (err) {
      erros.push({ caminhao: row.caminhao, pesagem: row.pesagem, erro: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    filtros: { caminhao, dataInicio, dataFim, codEquipamento, limpar },
    resumo: { encontrados: rows.length, atualizados, falhas: erros.length, truncado: collected.hasMore },
    erros,
    dados: atualizadosRows,
  };
}
