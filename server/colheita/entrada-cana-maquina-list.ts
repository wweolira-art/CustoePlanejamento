import { ORDS_MAX_ROWS, ORDS_MAX_UPDATES,
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
    process.env.ORDS_ENTRADA_CANA_MAQUINA_URL?.trim() ||
    process.env.ENTRADA_CANA_MAQUINA_ORDS_URL?.trim();
  if (!fromEnv) throw new Error("Configure ORDS_ENTRADA_CANA_MAQUINA_URL no .env.");
  return fromEnv.replace(/\/?$/, "/");
}

export interface EntradaCanaMaquinaRow {
  maquina: number | null;
  fazenda: string | null;
  talhao: number | null;
  dataColheita: string | null;
  tipoColheita: string | null;
  tipoCana: string | null;
  peso: number | null;
  impMineral: number | null;
  safra: string | null;
  codEquipamento: number | null;
  selfHref?: string | null;
}

function mapItem(item: Record<string, unknown>, includeHref = false): EntradaCanaMaquinaRow | null {
  if (!item || typeof item !== "object") return null;
  const row: EntradaCanaMaquinaRow = {
    maquina: toNumber(item.maquina),
    fazenda: item.fazenda != null ? String(item.fazenda).trim() : null,
    talhao: toNumber(item.talhao),
    dataColheita: item.datacolheita != null ? String(item.datacolheita) : null,
    tipoColheita: item.tipocolheita != null ? String(item.tipocolheita).trim() : null,
    tipoCana: item.tipocana != null ? String(item.tipocana).trim() : null,
    peso: toNumber(item.peso),
    impMineral: toNumber(item.impmineral),
    safra: item.safra != null ? String(item.safra).trim() : null,
    codEquipamento: toNumber(item.cod_equipamento),
  };
  if (includeHref) row.selfHref = selfHrefFromItem(item as { links?: { rel?: string; href?: string }[] });
  return row;
}

function toOrdsPutBody(row: EntradaCanaMaquinaRow, codEquipamento: number | null) {
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

function matchBusca(row: EntradaCanaMaquinaRow, busca: string | null) {
  if (!busca) return true;
  const q = busca.toLowerCase();
  const blob = [row.maquina, row.fazenda, row.talhao, row.tipoColheita, row.tipoCana, row.safra, row.codEquipamento]
    .filter((v) => v != null && v !== "")
    .join(" ")
    .toLowerCase();
  return blob.includes(q);
}

function matchPeriodo(row: EntradaCanaMaquinaRow, dataInicio: string | null, dataFim: string | null) {
  return matchPeriodoDia(diaUtcFromIso(row.dataColheita), dataInicio, dataFim);
}

async function coletarLinhas(
  filtros: { busca?: string | null; dataInicio?: string | null; dataFim?: string | null; maquina?: string | null; limit?: number | null },
  includeHref = false,
) {
  const busca = filtros.busca?.trim() || null;
  const { dataInicio, dataFim } = parsePeriodoOpcional(filtros);
  const maquina = filtros.maquina?.trim() || null;
  const userLimit = toNumber(filtros.limit);
  const maxRows = userLimit != null && userLimit > 0 ? userLimit : Number.MAX_SAFE_INTEGER;

  const collected = await scanOrdsCollection(baseUrl(), {
    maxRows,
    match: (item) => {
      const row = mapItem(item);
      if (!row) return false;
      if (maquina && String(row.maquina) !== String(maquina)) return false;
      if (!matchPeriodo(row, dataInicio, dataFim)) return false;
      if (!matchBusca(row, busca)) return false;
      return true;
    },
    map: (item) => mapItem(item, includeHref) as Record<string, unknown>,
  });

  return { ...collected, filtros: { busca, dataInicio, dataFim, maquina, limit: collected.maxRows } };
}

export async function listarEntradaCanaMaquinaList(filtros: Parameters<typeof coletarLinhas>[0] = {}) {
  const collected = await coletarLinhas(filtros, false);
  const dados = collected.dados as unknown as EntradaCanaMaquinaRow[];
  const pesoTotal = dados.reduce((acc, r) => acc + (r.peso ?? 0), 0);
  return {
    filtros: collected.filtros,
    resumo: { totalLinhas: dados.length, paginasOrds: collected.pages, pesoTotal, truncado: collected.hasMore },
    dados,
  };
}

export async function listarMaquinasDistinct(filtros: Parameters<typeof coletarLinhas>[0] = {}) {
  const payload = await listarEntradaCanaMaquinaList({ ...filtros, busca: null, maquina: null });
  const mapa = new Map<
    string,
    {
      maquina: number | null;
      qtdEntradas: number;
      ultimaData: string | null;
      codEquipamento: number | null;
      porEquip: Map<string, VinculoEquipPeriodo>;
    }
  >();
  for (const row of payload.dados) {
    if (row.maquina == null) continue;
    const key = String(row.maquina);
    const prev = mapa.get(key) || {
      maquina: row.maquina,
      qtdEntradas: 0,
      ultimaData: null,
      codEquipamento: null,
      porEquip: new Map<string, VinculoEquipPeriodo>(),
    };
    prev.qtdEntradas += 1;
    if (row.codEquipamento != null) prev.codEquipamento = row.codEquipamento;
    if (row.dataColheita && (!prev.ultimaData || String(row.dataColheita) > String(prev.ultimaData))) {
      prev.ultimaData = row.dataColheita;
    }
    acumularVinculoEquipPeriodo(prev.porEquip, row.codEquipamento, diaUtcFromIso(row.dataColheita));
    mapa.set(key, prev);
  }
  const dados = [...mapa.values()]
    .map((item) => ({
      maquina: item.maquina,
      qtdEntradas: item.qtdEntradas,
      ultimaData: item.ultimaData,
      codEquipamento: item.codEquipamento,
      associacoes: listarVinculosEquipPeriodo(item.porEquip),
    }))
    .sort((a, b) => {
      const na = Number(a.maquina);
      const nb = Number(b.maquina);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return String(a.maquina).localeCompare(String(b.maquina));
    });
  return {
    filtros: payload.filtros,
    resumo: { totalMaquinas: dados.length, totalLinhasBase: payload.resumo.totalLinhas, truncado: payload.resumo.truncado },
    dados,
  };
}

export async function atualizarCodEquipamentoMaquina(params: {
  maquina?: string | number | null;
  dataInicio?: string | null;
  dataFim?: string | null;
  codEquipamento?: number | string | null;
  limpar?: boolean;
}) {
  const maquina = params.maquina != null && String(params.maquina).trim() !== "" ? String(params.maquina).trim() : null;
  if (!maquina) {
    const err = new Error("Informe o número da máquina.");
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

  const collected = await coletarLinhas({ maquina, dataInicio, dataFim, limit: ORDS_MAX_UPDATES }, true);
  const rows = collected.dados as unknown as EntradaCanaMaquinaRow[];
  if (!rows.length) {
    return {
      filtros: { maquina, dataInicio, dataFim, codEquipamento, limpar },
      resumo: { encontrados: 0, atualizados: 0, falhas: 0, truncado: collected.hasMore },
      erros: [] as { maquina?: number | null; dataColheita?: string | null; erro: string }[],
      dados: [],
    };
  }

  let atualizados = 0;
  const erros: { maquina?: number | null; dataColheita?: string | null; erro: string }[] = [];
  const atualizadosRows: Record<string, unknown>[] = [];

  for (const row of rows) {
    if (!row.selfHref) {
      erros.push({ maquina: row.maquina, dataColheita: row.dataColheita, erro: "Registro sem link self na ORDS" });
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
      erros.push({ maquina: row.maquina, dataColheita: row.dataColheita, erro: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    filtros: { maquina, dataInicio, dataFim, codEquipamento, limpar },
    resumo: { encontrados: rows.length, atualizados, falhas: erros.length, truncado: collected.hasMore },
    erros,
    dados: atualizadosRows,
  };
}
