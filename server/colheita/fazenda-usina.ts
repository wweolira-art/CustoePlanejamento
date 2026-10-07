import { oracleNumber, oracleText, withOracle } from "../oracle.js";
import { listarEntradaCanaCaminhao } from "./entrada-cana-caminhao-list.js";
import { listarEntradaCanaMaquinaList } from "./entrada-cana-maquina-list.js";
import { ORDS_MAX_ROWS, postOrdsItem, putOrdsItem, scanOrdsCollection, selfHrefFromItem, toNumber } from "./ords-common.js";

function baseUrl() {
  const fromEnv = process.env.ORDS_FAZENDA_USINA_URL?.trim() || process.env.FAZENDA_USINA_ORDS_URL?.trim();
  if (!fromEnv) throw new Error("Configure ORDS_FAZENDA_USINA_URL no .env.");
  return fromEnv.replace(/\/?$/, "/");
}

export interface FazendaUsinaRow {
  descricaoUsina: string | null;
  codSistema: number | null;
  raio: number | null;
  selfHref?: string | null;
}

function mapItem(item: Record<string, unknown>): FazendaUsinaRow | null {
  if (!item || typeof item !== "object") return null;
  return {
    descricaoUsina: item.descricaousina != null ? String(item.descricaousina).trim() : null,
    codSistema: toNumber(item.cod_sistema),
    raio: toNumber(item.raio),
    selfHref: selfHrefFromItem(item as { links?: { rel?: string; href?: string }[] }),
  };
}

function codigoPrefixo(descricao: string | null) {
  if (!descricao) return null;
  const m = String(descricao).trim().match(/^(\d{2}\.\d+)/);
  return m ? m[1] : null;
}

function matchBusca(row: FazendaUsinaRow, busca: string | null) {
  if (!busca) return true;
  const q = busca.toLowerCase();
  const blob = [row.descricaoUsina, row.codSistema, row.raio].filter((v) => v != null && v !== "").join(" ").toLowerCase();
  return blob.includes(q);
}

async function coletarMapeamentos(filtros: { busca?: string | null; limit?: number | null } = {}) {
  const busca = filtros.busca?.trim() || null;
  const userLimit = toNumber(filtros.limit);
  const maxRows = userLimit != null && userLimit > 0 ? Math.min(userLimit, ORDS_MAX_ROWS) : undefined;

  const collected = await scanOrdsCollection(baseUrl(), {
    maxRows,
    match: (item) => {
      const row = mapItem(item);
      return Boolean(row && matchBusca(row, busca));
    },
    map: (item) => mapItem(item) as Record<string, unknown>,
  });

  const dados = (collected.dados as unknown as FazendaUsinaRow[]).sort((a, b) =>
    String(a.descricaoUsina || "").localeCompare(String(b.descricaoUsina || ""), "pt-BR"),
  );

  return { dados, pages: collected.pages, hasMore: collected.hasMore, maxRows: collected.maxRows, busca };
}

export async function listarFazendaUsina(filtros: { busca?: string | null; limit?: number | null } = {}) {
  const collected = await coletarMapeamentos(filtros);
  return {
    filtros: { busca: collected.busca, limit: collected.maxRows },
    resumo: {
      totalLinhas: collected.dados.length,
      paginasOrds: collected.pages,
      comCodSistema: collected.dados.filter((r) => r.codSistema != null).length,
      truncado: collected.hasMore,
    },
    dados: collected.dados,
  };
}

export async function listarFazendasSistema(filtros: { busca?: string | null } = {}) {
  const busca = filtros.busca?.trim() || null;
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT f.cod_fazenda, f.descricao, f.distancia
         FROM agricola.fazenda f
        WHERE NVL(f.cod_fazenda, -1) <> 0
          AND (:busca IS NULL
               OR UPPER(f.descricao) LIKE '%' || UPPER(:busca) || '%'
               OR TO_CHAR(f.cod_fazenda) LIKE '%' || :busca || '%')
        ORDER BY f.descricao, f.cod_fazenda`,
      { busca },
    );
    const dados = ((result.rows ?? []) as Record<string, unknown>[]).map((row) => ({
      codFazenda: oracleNumber(row, "cod_fazenda") ?? toNumber(row.COD_FAZENDA),
      descricao: oracleText(row, "descricao") || (row.DESCRICAO != null ? String(row.DESCRICAO).trim() : null),
      distancia: oracleNumber(row, "distancia") ?? toNumber(row.DISTANCIA),
    }));
    return { filtros: { busca }, resumo: { totalLinhas: dados.length }, dados };
  });
}

export async function listarFazendasEntrada(filtros: {
  dataInicio?: string | null;
  dataFim?: string | null;
  busca?: string | null;
} = {}) {
  const [caminhao, maquina] = await Promise.all([
    listarEntradaCanaCaminhao({ dataInicio: filtros.dataInicio, dataFim: filtros.dataFim, busca: null }),
    listarEntradaCanaMaquinaList({ dataInicio: filtros.dataInicio, dataFim: filtros.dataFim, busca: null }),
  ]);

  const mapa = new Map<
    string,
    { fazenda: string; codigoPrefixo: string | null; qtdEntradas: number; origens: Set<string>; ultimaData: string | null }
  >();

  const add = (fazenda: string | null, origem: string, data: string | null) => {
    if (fazenda == null || String(fazenda).trim() === "") return;
    const key = String(fazenda).trim();
    const prev = mapa.get(key) || {
      fazenda: key,
      codigoPrefixo: codigoPrefixo(key),
      qtdEntradas: 0,
      origens: new Set<string>(),
      ultimaData: null,
    };
    prev.qtdEntradas += 1;
    prev.origens.add(origem);
    if (data && (!prev.ultimaData || String(data) > String(prev.ultimaData))) prev.ultimaData = data;
    mapa.set(key, prev);
  };

  for (const row of caminhao.dados) add(row.fazenda, "caminhao", row.data);
  for (const row of maquina.dados) add(row.fazenda, "maquina", row.dataColheita);

  const mapeamentos = await listarFazendaUsina({ limit: ORDS_MAX_ROWS });
  const porDescricao = new Map(
    mapeamentos.dados.filter((r) => r.descricaoUsina).map((r) => [r.descricaoUsina!, r]),
  );
  const porPrefixo = new Map<string, FazendaUsinaRow>();
  for (const r of mapeamentos.dados) {
    const p = codigoPrefixo(r.descricaoUsina);
    if (p && !porPrefixo.has(p)) porPrefixo.set(p, r);
  }

  const dados = [...mapa.values()]
    .map((f) => {
      const exato = porDescricao.get(f.fazenda) || null;
      const porCod = f.codigoPrefixo ? porPrefixo.get(f.codigoPrefixo) || null : null;
      const vinculo = exato || porCod;
      return {
        fazenda: f.fazenda,
        codigoPrefixo: f.codigoPrefixo,
        qtdEntradas: f.qtdEntradas,
        origens: [...f.origens],
        ultimaData: f.ultimaData,
        descricaoUsina: vinculo?.descricaoUsina ?? null,
        codSistema: vinculo?.codSistema ?? null,
        raio: vinculo?.raio ?? null,
        selfHref: vinculo?.selfHref ?? null,
        match: exato ? "exato" : porCod ? "prefixo" : null,
      };
    })
    .sort((a, b) => a.fazenda.localeCompare(b.fazenda, "pt-BR"));

  const busca = filtros.busca?.trim().toLowerCase() || null;
  const filtrados = busca
    ? dados.filter((r) => [r.fazenda, r.codSistema, r.descricaoUsina, r.codigoPrefixo].join(" ").toLowerCase().includes(busca))
    : dados;

  return {
    filtros: { dataInicio: filtros.dataInicio || null, dataFim: filtros.dataFim || null, busca: filtros.busca || null },
    resumo: {
      totalFazendas: filtrados.length,
      comVinculo: filtrados.filter((r) => r.codSistema != null).length,
      semVinculo: filtrados.filter((r) => r.codSistema == null).length,
    },
    dados: filtrados,
  };
}

export async function salvarFazendaUsina(params: {
  descricaoUsina?: string | null;
  fazenda?: string | null;
  codSistema?: number | string | null;
  raio?: number | string | null;
  limpar?: boolean;
}) {
  const descricaoUsina =
    params.descricaoUsina?.trim() ||
    params.fazenda?.trim() ||
    null;
  if (!descricaoUsina) {
    const err = new Error("Informe a descrição da fazenda (descricaousina).");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }

  const limpar = params.limpar === true;
  let codSistema: number | null = null;
  if (!limpar) {
    codSistema = toNumber(params.codSistema);
    if (codSistema == null) {
      const err = new Error("Informe o cod_sistema ou use Limpar.");
      (err as Error & { status?: number }).status = 400;
      throw err;
    }
  }

  const raio = params.raio === "" || params.raio == null ? null : toNumber(params.raio);
  const lista = await listarFazendaUsina({ limit: ORDS_MAX_ROWS });
  const existente =
    lista.dados.find(
      (r) => r.descricaoUsina && r.descricaoUsina.toLowerCase() === descricaoUsina.toLowerCase(),
    ) || null;

  const body = {
    descricaousina: descricaoUsina,
    cod_sistema: limpar ? null : codSistema,
    raio: raio ?? existente?.raio ?? null,
  };

  const acao = existente?.selfHref ? "atualizar" : "criar";
  const resultado = existente?.selfHref
    ? await putOrdsItem(existente.selfHref, body)
    : await postOrdsItem(baseUrl(), body);

  return {
    filtros: { descricaoUsina, codSistema, raio, limpar },
    resumo: { acao, descricaoUsina, codSistema: limpar ? null : codSistema, raio: body.raio },
    dados: resultado,
  };
}
