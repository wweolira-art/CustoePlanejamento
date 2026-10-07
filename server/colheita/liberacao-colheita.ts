import { oracleDate, oracleNumber, oracleText, oracleValue, withOracle } from "../oracle.js";
import { resolveOracleCodSafra } from "./oracle-safra.js";

export interface LiberacaoColheitaRow {
  dataLiberacao: string | null;
  numeroLiberacao: number | null;
  codFazenda: number | null;
  fazenda: string | null;
  talhao: number | null;
  area: number | null;
  tchEstimado: number | null;
  producaoEstimada: number | null;
  folha: string | null;
  tipoColheita: string | null;
  tipoCana: string | null;
  codFornecedor: number | null;
  fornecedor: string | null;
}

function formatFornecedor(cod: number | null, nome: string | null) {
  if (cod == null && !nome) return null;
  if (cod != null && nome) return `${cod}-${nome}`;
  return nome || (cod != null ? String(cod) : null);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function inBinds(prefix: string, values: string[], numeric = false) {
  const binds: Record<string, string | number> = {};
  const names = values.map((value, index) => {
    const key = `${prefix}${index}`;
    if (numeric) {
      const n = Number(value);
      binds[key] = Number.isFinite(n) ? n : value;
    } else {
      binds[key] = value;
    }
    return `:${key}`;
  });
  return { sql: names.join(", "), binds };
}

function sqlInFilter(column: string, values: string[], prefix: string, numeric = false) {
  if (!values.length) return { sql: "", binds: {} as Record<string, string | number> };
  const { sql, binds } = inBinds(prefix, values, numeric);
  return { sql: ` AND ${column} IN (${sql})`, binds };
}

const LIBERACAO_FROM_SQL = `
         FROM agricola.liberacao_corte lc
         JOIN agricola.fazenda f
           ON f.cod_fazenda = lc.cod_fazenda
         JOIN agricola.talhao t
           ON t.cod_safra = lc.cod_safra
          AND t.cod_fazenda = lc.cod_fazenda
          AND t.cod_talhao = lc.cod_talhao
          AND t.zona = lc.zona`;

function liberacaoPeriodSql(dataInicio: string | null, dataFim: string | null) {
  return `
          AND (:dataInicio IS NULL OR lc.data_liberacao >= TO_DATE(:dataInicio, 'YYYY-MM-DD'))
          AND (:dataFim IS NULL OR lc.data_liberacao < TO_DATE(:dataFim, 'YYYY-MM-DD') + 1)`;
}

export async function listarLiberacaoColheitaOpcoes(filtros: {
  safraCode: string;
  dataInicio?: string | null;
  dataFim?: string | null;
} = { safraCode: "25/26" }) {
  const safraCode = filtros.safraCode?.trim() || "25/26";
  const dataInicio = filtros.dataInicio?.trim() || null;
  const dataFim = filtros.dataFim?.trim() || null;

  return withOracle(async (conn) => {
    const codSafra = await resolveOracleCodSafra(conn, safraCode);
    if (codSafra == null) {
      throw new Error(`Safra "${safraCode}" não encontrada no Oracle (agricola.safra).`);
    }

    const result = await conn.execute(
      `SELECT DISTINCT f.cod_fazenda,
              f.descricao AS fazenda,
              t.cod_talhao AS talhao
       ${LIBERACAO_FROM_SQL}
        WHERE lc.cod_safra = :codSafra
        ${liberacaoPeriodSql(dataInicio, dataFim)}
        ORDER BY f.descricao, t.cod_talhao`,
      { codSafra, dataInicio, dataFim },
      { maxRows: 0, fetchArraySize: 1000 },
    );

    const codFazendas = new Map<string, string>();
    const fazendas = new Map<string, string>();
    const talhoes = new Map<string, string>();

    for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
      const cod = oracleNumber(raw, "cod_fazenda", "COD_FAZENDA");
      const descricao = oracleText(raw, "fazenda", "FAZENDA");
      const talhao = oracleNumber(raw, "talhao", "TALHAO");
      if (cod != null) codFazendas.set(String(cod), String(cod));
      if (descricao) fazendas.set(descricao, descricao);
      if (talhao != null) talhoes.set(String(talhao), String(talhao));
    }

    const toOptions = (entries: Map<string, string>) =>
      [...entries.entries()]
        .sort((a, b) => a[1].localeCompare(b[1], "pt-BR", { numeric: true }))
        .map(([key, label]) => ({ key, label }));

    return {
      filtros: { safraCode, dataInicio, dataFim, codSafra },
      codFazendas: toOptions(codFazendas),
      fazendas: toOptions(fazendas),
      talhoes: toOptions(talhoes),
    };
  });
}

export async function listarLiberacaoColheita(filtros: {
  safraCode: string;
  dataInicio?: string | null;
  dataFim?: string | null;
  busca?: string | null;
  codFazendas?: string[] | null;
  fazendas?: string[] | null;
  talhoes?: string[] | null;
} = { safraCode: "25/26" }) {
  const safraCode = filtros.safraCode?.trim() || "25/26";
  const dataInicio = filtros.dataInicio?.trim() || null;
  const dataFim = filtros.dataFim?.trim() || null;
  const busca = filtros.busca?.trim() || null;
  const codFazendas = uniqueStrings(filtros.codFazendas ?? []);
  const fazendaDescricoes = uniqueStrings(filtros.fazendas ?? []);
  const talhoes = uniqueStrings(filtros.talhoes ?? []);

  return withOracle(async (conn) => {
    const codSafra = await resolveOracleCodSafra(conn, safraCode);
    if (codSafra == null) {
      throw new Error(`Safra "${safraCode}" não encontrada no Oracle (agricola.safra).`);
    }

    const codFazendaFilter = sqlInFilter("lc.cod_fazenda", codFazendas, "cf", true);
    const fazendaFilter = sqlInFilter("f.descricao", fazendaDescricoes, "fd", false);
    const talhaoFilter = sqlInFilter("t.cod_talhao", talhoes, "th", true);

    const result = await conn.execute(
      `SELECT lc.data_liberacao,
              lc.numero_liberacao,
              f.cod_fazenda,
              f.descricao AS fazenda,
              t.cod_talhao AS talhao,
              NVL(lc.area_prevista, t.areaproducao) AS area,
              CASE
                WHEN NVL(t.rendimentoagricola, 0) > 0 THEN t.rendimentoagricola
                WHEN NVL(t.areaproducao, 0) > 0 AND NVL(t.producaotalhao, 0) > 0
                  THEN ROUND(t.producaotalhao / t.areaproducao, 2)
                ELSE NULL
              END AS tch_estimado,
              NVL(
                t.producaotalhao,
                CASE
                  WHEN NVL(t.rendimentoagricola, 0) > 0 AND NVL(t.areaproducao, 0) > 0
                    THEN ROUND(t.rendimentoagricola * t.areaproducao, 2)
                  ELSE NULL
                END
              ) AS producao_estimada,
              CASE
                WHEN t.numerocorte IS NOT NULL AND REGEXP_LIKE(TRIM(t.numerocorte), '^[0-9]+$')
                  THEN TRIM(t.numerocorte) || 'º CORTE'
                ELSE TRIM(t.numerocorte)
              END AS folha,
              NVL(
                t.tipocolheita,
                DECODE(lc.tipo_colheita, 'M', 'MANUAL', 'C', 'MECANIZADA', lc.tipo_colheita)
              ) AS tipo_colheita,
              CASE
                WHEN lc.data_queima IS NOT NULL THEN 'QUEIMADA'
                WHEN tc.descricao IS NOT NULL THEN tc.descricao
                ELSE NULL
              END AS tipo_cana,
              hfa.cod_fornecedor,
              pn.razaosocial AS fornecedor_nome
         ${LIBERACAO_FROM_SQL}
         LEFT JOIN agricola.tipocana tc
           ON tc.cod_tipocana = lc.cod_tipocolheita
         LEFT JOIN (
           SELECT h.cod_fazenda,
                  h.cod_fornecedor,
                  ROW_NUMBER() OVER (
                    PARTITION BY h.cod_fazenda
                    ORDER BY h.data_inicio DESC NULLS LAST, h.id_hisfazasso DESC
                  ) AS rn
             FROM agricola.historico_fazenda_assoc h
            WHERE TRUNC(SYSDATE) >= TRUNC(NVL(h.data_inicio, SYSDATE))
              AND (h.data_fim IS NULL OR TRUNC(SYSDATE) <= TRUNC(h.data_fim))
         ) hfa
           ON hfa.cod_fazenda = lc.cod_fazenda
          AND hfa.rn = 1
         LEFT JOIN material.vw_parceironegocio pn
           ON pn.cod_fornecedor = hfa.cod_fornecedor
        WHERE lc.cod_safra = :codSafra
        ${liberacaoPeriodSql(dataInicio, dataFim)}
        ${codFazendaFilter.sql}
        ${fazendaFilter.sql}
        ${talhaoFilter.sql}
          AND (
            :busca IS NULL
            OR UPPER(f.descricao) LIKE '%' || UPPER(:busca) || '%'
            OR TO_CHAR(t.cod_talhao) LIKE '%' || :busca || '%'
            OR UPPER(NVL(pn.razaosocial, pn.nomefantasia)) LIKE '%' || UPPER(:busca) || '%'
            OR TO_CHAR(hfa.cod_fornecedor) LIKE '%' || :busca || '%'
          )
        ORDER BY f.descricao, t.cod_talhao, lc.data_liberacao DESC, lc.numero_liberacao DESC
        FETCH FIRST 2000 ROWS ONLY`,
      { codSafra, dataInicio, dataFim, busca, ...codFazendaFilter.binds, ...fazendaFilter.binds, ...talhaoFilter.binds },
    );

    const dados = ((result.rows ?? []) as Record<string, unknown>[]).map((row) => {
      const codFornecedorRaw = oracleValue(row, "cod_fornecedor", "COD_FORNECEDOR");
      const codFornecedor =
        codFornecedorRaw == null || codFornecedorRaw === "" ? null : oracleNumber(row, "cod_fornecedor", "COD_FORNECEDOR");
      const fornecedorNome =
        oracleText(row, "fornecedor_nome", "FORNECEDOR_NOME") ||
        oracleText(row, "razaosocial", "RAZAOSOCIAL") ||
        oracleText(row, "nomefantasia", "NOMEFANTASIA") ||
        null;
      return {
        dataLiberacao: oracleDate(row, "data_liberacao", "DATA_LIBERACAO"),
        numeroLiberacao: oracleNumber(row, "numero_liberacao", "NUMERO_LIBERACAO"),
        codFazenda: oracleNumber(row, "cod_fazenda", "COD_FAZENDA"),
        fazenda: oracleText(row, "fazenda", "FAZENDA") || null,
        talhao: oracleNumber(row, "talhao", "TALHAO"),
        area: oracleNumber(row, "area", "AREA"),
        tchEstimado: oracleNumber(row, "tch_estimado", "TCH_ESTIMADO"),
        producaoEstimada: oracleNumber(row, "producao_estimada", "PRODUCAO_ESTIMADA"),
        folha: oracleText(row, "folha", "FOLHA") || null,
        tipoColheita: oracleText(row, "tipo_colheita", "TIPO_COLHEITA") || null,
        tipoCana: oracleText(row, "tipo_cana", "TIPO_CANA") || null,
        codFornecedor,
        fornecedor: formatFornecedor(codFornecedor, fornecedorNome),
      } satisfies LiberacaoColheitaRow;
    });

    const totalArea = dados.reduce((acc, row) => acc + (row.area ?? 0), 0);
    const totalProducao = dados.reduce((acc, row) => acc + (row.producaoEstimada ?? 0), 0);
    const tchMedio = totalArea > 0 ? totalProducao / totalArea : null;

    return {
      filtros: { safraCode, dataInicio, dataFim, busca, codSafra, codFazendas, fazendas: fazendaDescricoes, talhoes },
      resumo: {
        totalLinhas: dados.length,
        totalArea,
        tchMedio,
        totalProducao,
        truncado: dados.length >= 2000,
      },
      dados,
    };
  });
}
