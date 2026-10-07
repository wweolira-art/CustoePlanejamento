import { oracleNumber, oracleText, withOracle } from "./oracle.js";

/** Objetos de custo da consulta de compra (almoxarifado 2). */
const OBJETOS_CUSTO = [
  95, 416, 417, 124, 349, 96, 99, 282, 102, 103, 104, 106, 107, 108, 140, 141, 113, 114, 115, 116, 117, 181, 118, 119,
  128, 129, 132, 135, 137, 139,
];

export const MATERIAL_TIPOS = [
  "Combustível",
  "Lubrificante",
  "Pneu",
  "Servico",
  "Filtro",
  "Graxa",
  "Aditivo",
  "Peças e Acessórios",
] as const;

export type MaterialTipoFiltro = (typeof MATERIAL_TIPOS)[number];

export type MaterialEntradaSaidaItem = {
  tipo: string;
  grupo: string;
  codFamilia: number | null;
  codGrupoMaterial: number | null;
  codObjetoCusto: number | null;
  objetoCusto: string;
  codMaterial: number | null;
  codigo: string;
  descricao: string;
  qtdeEntrada: number;
  qtdeSaida: number;
  valorEntrada: number;
  valorSaida: number;
  diferenca: number;
};

export type MaterialEntradaSaidaRelatorio = {
  filtros: { dataInicio: string | null; dataFim: string | null; tipos: string[] };
  tipos: string[];
  itens: MaterialEntradaSaidaItem[];
  totais: {
    qtdeEntrada: number;
    qtdeSaida: number;
    valorEntrada: number;
    valorSaida: number;
    saldo: number;
    pctSaida: number | null;
  };
};

function money(n: number) {
  return Math.round((n || 0) * 100) / 100;
}

function qty(n: number) {
  return Math.round((n || 0) * 1000) / 1000;
}

function pctSaida(entrada: number, saida: number) {
  if (!(entrada > 0)) return null;
  return money((saida / entrada) * 100);
}

const TIPO_SQL = `NVL(
              CASE pf.tipo
                WHEN 1 THEN 'Combustível'
                WHEN 2 THEN 'Lubrificante'
                WHEN 3 THEN 'Pneu'
                WHEN 4 THEN 'Servico'
                WHEN 5 THEN 'Filtro'
                WHEN 6 THEN 'Graxa'
                WHEN 7 THEN 'Aditivo'
              END,
              'Peças e Acessórios'
            )`;

function parseTipos(raw: string | string[] | null | undefined): string[] {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const allowed = new Set<string>(MATERIAL_TIPOS);
  return [...new Set(values.flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter((item) => allowed.has(item)))];
}

function inBinds(prefix: string, values: string[]) {
  const binds: Record<string, string> = {};
  const names = values.map((value, i) => {
    const key = `${prefix}${i}`;
    binds[key] = value;
    return `:${key}`;
  });
  return { sql: names.join(", "), binds };
}

export async function relatorioMaterialEntradaSaida(filtros: {
  dataInicio?: string | null;
  dataFim?: string | null;
  tipo?: string | null;
  tipos?: string | string[] | null;
}): Promise<MaterialEntradaSaidaRelatorio> {
  const dataInicio = filtros.dataInicio?.trim() || null;
  const dataFim = filtros.dataFim?.trim() || null;
  const tipos = parseTipos([
    ...(Array.isArray(filtros.tipos) ? filtros.tipos : filtros.tipos ? [filtros.tipos] : []),
    filtros.tipo ?? "",
  ]);
  const filtraTipo = tipos.length > 0 && tipos.length < MATERIAL_TIPOS.length;
  const tipoBinds = filtraTipo ? inBinds("tp", tipos) : { sql: "", binds: {} };
  const objetosSql = OBJETOS_CUSTO.join(", ");
  const tipoWhere = filtraTipo
    ? `AND NVL(t.tipo, 'Peças e Acessórios') IN (${tipoBinds.sql})`
    : "";

  const rows = await withOracle(async (conn) => {
    const result = await conn.execute(
      `WITH tipos AS (
          SELECT gm.cod_familia,
                 gm.cod_grupomaterial,
                 NVL(gm.descricao, 'Grupo ' || gm.cod_grupomaterial) AS grupo,
                 ${TIPO_SQL} AS tipo
            FROM material.grupomaterial gm
            LEFT JOIN automotivo.parametros_familia pf
              ON pf.cod_familia = gm.cod_familia
             AND pf.cod_grupomaterial = gm.cod_grupomaterial
        ),
        entrada AS (
          SELECT NVL(m.cod_familia, 0) AS cod_familia,
                 NVL(m.cod_grupomaterial, 0) AS cod_grupomaterial,
                 NVL(NVL(ie.cod_material, sc.cod_material), 0) AS cod_material,
                 sc.cod_objetocusto AS cod_objetocusto,
                 MAX(NVL(m.descricao, 'Material ' || NVL(ie.cod_material, sc.cod_material))) AS descricao,
                 SUM(NVL(ie.quantidade, 0)) AS qtde_entrada,
                 SUM(NVL(ie.quantidade, 0) * NVL(ie.valorunitario, 0)) AS valor_entrada
            FROM material.itensentrada ie
            JOIN material.solicitacaocompra sc
              ON sc.nr_solicitacao = ie.nr_solicitacao
            LEFT JOIN material.material m
              ON m.cod_material = NVL(ie.cod_material, sc.cod_material)
           WHERE sc.cod_almoxarifado = 2
             AND sc.cod_objetocusto IN (${objetosSql})
             AND NVL(sc.situacao, ' ') <> 'C'
             AND NVL(m.cod_familia, 0) <> 1
             AND ie.nroc IS NOT NULL
             AND EXTRACT(YEAR FROM NVL(ie.dataentrada_seq, sc.data)) >= EXTRACT(YEAR FROM SYSDATE) - 4
             AND (:dataInicio IS NULL OR TRUNC(NVL(ie.dataentrada_seq, sc.data)) >= TO_DATE(:dataInicio, 'YYYY-MM-DD'))
             AND (:dataFim IS NULL OR TRUNC(NVL(ie.dataentrada_seq, sc.data)) <= TO_DATE(:dataFim, 'YYYY-MM-DD'))
           GROUP BY NVL(m.cod_familia, 0), NVL(m.cod_grupomaterial, 0), NVL(NVL(ie.cod_material, sc.cod_material), 0), sc.cod_objetocusto
        ),
        saida AS (
          SELECT NVL(m.cod_familia, 0) AS cod_familia,
                 NVL(m.cod_grupomaterial, 0) AS cod_grupomaterial,
                 NVL(r.cod_material, 0) AS cod_material,
                 NVL(r.cod_objetocusto, h.cod_objetocusto) AS cod_objetocusto,
                 MAX(NVL(m.descricao, 'Material ' || r.cod_material)) AS descricao,
                 SUM(NVL(r.quantidade, 0)) AS qtde_saida,
                 SUM(NVL(r.quantidade, 0) * NVL(r.vrcustounitario, 0)) AS valor_saida
            FROM material.itensrequisicaomaterial r
            LEFT JOIN material.material m
              ON m.cod_material = r.cod_material
            LEFT JOIN LATERAL (
              SELECT hx.cod_objetocusto
                FROM automotivo.historicoequipamentoobcusto hx
               WHERE r.cod_objetocusto IS NULL
                 AND hx.cod_equipamento = r.cod_equipamento
                 AND TRUNC(r.dataretirada)
                     BETWEEN TRUNC(hx.data_inicio)
                     AND TRUNC(NVL(hx.data_final, SYSDATE))
                 AND hx.cod_objetocusto IN (${objetosSql})
               ORDER BY NVL(hx.data_final, DATE '9999-12-31') DESC, hx.data_inicio DESC
               FETCH FIRST 1 ROW ONLY
            ) h ON 1 = 1
           WHERE r.dataretirada IS NOT NULL
             AND r.data_canc IS NULL
             AND NVL(m.cod_familia, 0) <> 1
             AND EXTRACT(YEAR FROM r.dataretirada) >= EXTRACT(YEAR FROM SYSDATE) - 4
             AND (:dataInicio IS NULL OR TRUNC(r.dataretirada) >= TO_DATE(:dataInicio, 'YYYY-MM-DD'))
             AND (:dataFim IS NULL OR TRUNC(r.dataretirada) <= TO_DATE(:dataFim, 'YYYY-MM-DD'))
             AND NVL(r.cod_objetocusto, h.cod_objetocusto) IN (${objetosSql})
           GROUP BY NVL(m.cod_familia, 0), NVL(m.cod_grupomaterial, 0), NVL(r.cod_material, 0), NVL(r.cod_objetocusto, h.cod_objetocusto)
        )
        SELECT NVL(t.tipo, 'Peças e Acessórios') AS tipo,
               NVL(t.grupo, 'Sem grupo') AS grupo,
               NVL(e.cod_familia, s.cod_familia) AS cod_familia,
               NVL(e.cod_grupomaterial, s.cod_grupomaterial) AS cod_grupomaterial,
               NVL(e.cod_objetocusto, s.cod_objetocusto) AS cod_objetocusto,
               NVL(oc.descricao, 'Objeto ' || NVL(e.cod_objetocusto, s.cod_objetocusto)) AS objeto,
               NVL(e.cod_material, s.cod_material) AS cod_material,
               NVL(e.descricao, s.descricao) AS descricao,
               NVL(e.qtde_entrada, 0) AS qtde_entrada,
               NVL(s.qtde_saida, 0) AS qtde_saida,
               NVL(e.valor_entrada, 0) AS valor_entrada,
               NVL(s.valor_saida, 0) AS valor_saida
          FROM entrada e
          FULL OUTER JOIN saida s
            ON s.cod_familia = e.cod_familia
           AND s.cod_grupomaterial = e.cod_grupomaterial
           AND s.cod_material = e.cod_material
           AND s.cod_objetocusto = e.cod_objetocusto
          LEFT JOIN tipos t
            ON t.cod_familia = NVL(e.cod_familia, s.cod_familia)
           AND t.cod_grupomaterial = NVL(e.cod_grupomaterial, s.cod_grupomaterial)
          LEFT JOIN (
            SELECT ocx.cod_objetocusto, MAX(ocx.descricao) AS descricao
              FROM custo.objetocusto ocx
             GROUP BY ocx.cod_objetocusto
          ) oc
            ON oc.cod_objetocusto = NVL(e.cod_objetocusto, s.cod_objetocusto)
         WHERE 1 = 1
           ${tipoWhere}
         ORDER BY 1, 2, 8`,
      { dataInicio, dataFim, ...tipoBinds.binds },
    );
    return (result.rows ?? []) as Record<string, unknown>[];
  });

  const itens: MaterialEntradaSaidaItem[] = [];
  for (const raw of rows) {
    const qtdeEntrada = qty(oracleNumber(raw, "qtde_entrada", "QTDE_ENTRADA") ?? 0);
    if (!(qtdeEntrada > 0)) continue;

    const valorEntrada = money(oracleNumber(raw, "valor_entrada", "VALOR_ENTRADA") ?? 0);
    let qtdeSaida = qty(oracleNumber(raw, "qtde_saida", "QTDE_SAIDA") ?? 0);
    let valorSaida = money(oracleNumber(raw, "valor_saida", "VALOR_SAIDA") ?? 0);
    if (qtdeSaida > qtdeEntrada) qtdeSaida = qtdeEntrada;
    if (valorSaida > valorEntrada) valorSaida = valorEntrada;

    const codMaterial = oracleNumber(raw, "cod_material", "COD_MATERIAL");
    const codObjetoCusto = oracleNumber(raw, "cod_objetocusto", "COD_OBJETOCUSTO");
    itens.push({
      tipo: oracleText(raw, "tipo", "TIPO") || "Peças e Acessórios",
      grupo: oracleText(raw, "grupo", "GRUPO") || "Sem grupo",
      codFamilia: oracleNumber(raw, "cod_familia", "COD_FAMILIA"),
      codGrupoMaterial: oracleNumber(raw, "cod_grupomaterial", "COD_GRUPOMATERIAL"),
      codObjetoCusto,
      objetoCusto: oracleText(raw, "objeto", "OBJETO") || (codObjetoCusto != null ? `Objeto ${codObjetoCusto}` : "Sem objeto"),
      codMaterial,
      codigo: codMaterial != null ? String(codMaterial) : "—",
      descricao: oracleText(raw, "descricao", "DESCRICAO") || (codMaterial != null ? `Material ${codMaterial}` : "Sem material"),
      qtdeEntrada,
      qtdeSaida,
      valorEntrada,
      valorSaida,
      diferenca: money(valorEntrada - valorSaida),
    });
  }

  const valorEntrada = money(itens.reduce((acc, row) => acc + row.valorEntrada, 0));
  const valorSaida = money(itens.reduce((acc, row) => acc + row.valorSaida, 0));
  const qtdeEntrada = qty(itens.reduce((acc, row) => acc + row.qtdeEntrada, 0));
  const qtdeSaida = qty(itens.reduce((acc, row) => acc + row.qtdeSaida, 0));

  return {
    filtros: { dataInicio, dataFim, tipos },
    tipos: [...MATERIAL_TIPOS],
    itens,
    totais: {
      qtdeEntrada,
      qtdeSaida,
      valorEntrada,
      valorSaida,
      saldo: money(valorEntrada - valorSaida),
      pctSaida: pctSaida(valorEntrada, valorSaida),
    },
  };
}
