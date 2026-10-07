import { MATERIAL_TIPOS } from "../materials-entrada-saida.js";
import { oracleDate, oracleNumber, oracleText, withOracle } from "../oracle.js";

export type GestaoMateriaisPrioridade = "critico" | "alto" | "medio" | "ok";

export type GestaoMateriaisItem = {
  codMaterial: number;
  descricao: string;
  tipo: string;
  grupo: string;
  codAlmoxarifado: number | null;
  codObjetoCusto: number | null;
  saida: number;
  mediaMes: number;
  estoqueAtual: number;
  coberturaMeses: number | null;
  ultimaEntrada: string | null;
  qtdSugerida: number;
  prioridade: GestaoMateriaisPrioridade;
  precoMedio: number | null;
  valorTotal: number;
};

export type GestaoMateriaisGrupo = {
  tipo: string;
  label: string;
  itens: GestaoMateriaisItem[];
  totais: {
    saida: number;
    mediaMes: number;
    estoqueAtual: number;
    qtdSugerida: number;
    valorTotal: number;
  };
};

export type GestaoMateriaisData = {
  filtros: {
    dataInicio: string | null;
    dataFim: string | null;
    tipos: string[];
    almoxarifado: number | null;
    codMaterial: number | null;
    codObjetoCusto: number | null;
    mesesEstoque: number;
    mesesSugerida: number;
  };
  tipos: string[];
  almoxarifados: Array<{ codigo: number; descricao: string }>;
  materiais: Array<{ codigo: number; descricao: string }>;
  objetosCusto: Array<{ codigo: number; descricao: string }>;
  grupos: GestaoMateriaisGrupo[];
  totais: GestaoMateriaisGrupo["totais"];
};

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

function qty(n: number) {
  return Math.round((n || 0) * 1000) / 1000;
}

function money(n: number) {
  return Math.round((n || 0) * 100) / 100;
}

function parseTipos(raw: string | string[] | null | undefined): string[] {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const allowed = new Set<string>(MATERIAL_TIPOS);
  return [
    ...new Set(
      values
        .flatMap((item) => String(item).split(","))
        .map((item) => item.trim())
        .filter((item) => allowed.has(item)),
    ),
  ];
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

function prioridade(cobertura: number | null, estoque: number): GestaoMateriaisPrioridade {
  if (estoque <= 0) return "critico";
  if (cobertura == null || !Number.isFinite(cobertura)) return "ok";
  if (cobertura < 1) return "critico";
  if (cobertura < 2) return "alto";
  if (cobertura < 3) return "medio";
  return "ok";
}

function isoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function subtractMonths(iso: string, months: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setMonth(d.getMonth() - months);
  return isoDate(d);
}

export async function gerarGestaoMateriais(filtros: {
  dataInicio?: string | null;
  dataFim?: string | null;
  tipos?: string | string[] | null;
  almoxarifado?: string | number | null;
  codMaterial?: string | number | null;
  codObjetoCusto?: string | number | null;
  mesesEstoque?: string | number | null;
  mesesSugerida?: string | number | null;
}): Promise<GestaoMateriaisData> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const defaultFim = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const defaultInicio = `${now.getFullYear() - 3}-01-01`;

  const dataFim = filtros.dataFim?.trim() || defaultFim;
  const dataInicio = filtros.dataInicio?.trim() || defaultInicio;
  const tipos = parseTipos(filtros.tipos);
  const filtraTipo = tipos.length > 0 && tipos.length < MATERIAL_TIPOS.length;
  const tipoBinds = filtraTipo ? inBinds("tp", tipos) : { sql: "", binds: {} };
  const tipoWhere = filtraTipo ? `AND NVL(gt.tipo, 'Peças e Acessórios') IN (${tipoBinds.sql})` : "";

  const almoxRaw = Number(filtros.almoxarifado);
  const almoxarifado = Number.isFinite(almoxRaw) && almoxRaw > 0 ? almoxRaw : null;

  const matRaw = Number(filtros.codMaterial);
  const codMaterial = Number.isFinite(matRaw) && matRaw > 0 ? matRaw : null;

  const objRaw = Number(filtros.codObjetoCusto);
  const codObjetoCusto = Number.isFinite(objRaw) && objRaw > 0 ? objRaw : null;

  const mesesEstoqueRaw = Number(filtros.mesesEstoque);
  const mesesEstoque = Number.isFinite(mesesEstoqueRaw) && mesesEstoqueRaw > 0 ? Math.round(mesesEstoqueRaw) : 12;

  const mesesSugeridaRaw = Number(filtros.mesesSugerida);
  const mesesSugerida = Number.isFinite(mesesSugeridaRaw) && mesesSugeridaRaw > 0 ? Math.round(mesesSugeridaRaw) : 4;

  const saidaInicio = subtractMonths(dataFim, mesesEstoque);
  const saidaInicioEff = saidaInicio < dataInicio ? dataInicio : saidaInicio;

  const rows = await withOracle(async (conn) => {
    const result = await conn.execute(
      `WITH grp_tipo AS (
          SELECT gm.cod_familia,
                 gm.cod_grupomaterial,
                 NVL(gm.descricao, 'Grupo ' || gm.cod_grupomaterial) AS grupo,
                 ${TIPO_SQL} AS tipo
            FROM material.grupomaterial gm
            LEFT JOIN automotivo.parametros_familia pf
              ON pf.cod_familia = gm.cod_familia
             AND pf.cod_grupomaterial = gm.cod_grupomaterial
        ),
        saida_agg AS (
          SELECT r.cod_material,
                 SUM(NVL(r.quantidade, 0)) AS qtde_saida
            FROM material.itensrequisicaomaterial r
            LEFT JOIN LATERAL (
              SELECT hx.cod_objetocusto
                FROM automotivo.historicoequipamentoobcusto hx
               WHERE r.cod_objetocusto IS NULL
                 AND hx.cod_equipamento = r.cod_equipamento
                 AND TRUNC(r.dataretirada)
                     BETWEEN TRUNC(hx.data_inicio)
                     AND TRUNC(NVL(hx.data_final, SYSDATE))
               ORDER BY NVL(hx.data_final, DATE '9999-12-31') DESC, hx.data_inicio DESC
               FETCH FIRST 1 ROW ONLY
            ) h ON 1 = 1
           WHERE r.dataretirada IS NOT NULL
             AND r.data_canc IS NULL
             AND TRUNC(r.dataretirada) >= TO_DATE(:saidaInicio, 'YYYY-MM-DD')
             AND TRUNC(r.dataretirada) <= TO_DATE(:dataFim, 'YYYY-MM-DD')
             AND (:codObjetoCusto IS NULL OR NVL(r.cod_objetocusto, h.cod_objetocusto) = :codObjetoCusto)
           GROUP BY r.cod_material
        ),
        estoque_atual AS (
          SELECT e.cod_material,
                 e.cod_almoxarifado,
                 e.quantidade
            FROM (
              SELECT est.cod_material,
                     est.cod_almoxarifado,
                     est.cod_grupoempresa,
                     est.cod_empresa,
                     est.cod_filial,
                     est.quantidade,
                     ROW_NUMBER() OVER (
                       PARTITION BY est.cod_material,
                                    est.cod_grupoempresa,
                                    est.cod_empresa,
                                    est.cod_filial,
                                    est.cod_almoxarifado
                       ORDER BY est.anomes DESC
                     ) AS rn
                FROM material.estoque est
               WHERE est.ano <= TO_CHAR(SYSDATE, 'YYYY')
                 AND est.cod_empresa = 1
                 AND est.cod_filial = 1
            ) e
           WHERE e.rn = 1
             AND e.quantidade > 0
        ),
        estoque_agg AS (
          SELECT ea.cod_material,
                 SUM(NVL(ea.quantidade, 0)) AS qtde_estoque
            FROM estoque_atual ea
           WHERE (:almoxarifado IS NULL OR ea.cod_almoxarifado = :almoxarifado)
           GROUP BY ea.cod_material
        ),
        ultima_entrada AS (
          SELECT NVL(ie.cod_material, sc.cod_material) AS cod_material,
                 MAX(TRUNC(NVL(ie.dataentrada_seq, sc.data))) AS ultima_entrada
            FROM material.itensentrada ie
            JOIN material.solicitacaocompra sc ON sc.nr_solicitacao = ie.nr_solicitacao
           WHERE ie.nroc IS NOT NULL
             AND NVL(sc.situacao, ' ') <> 'C'
             AND (:codObjetoCusto IS NULL OR sc.cod_objetocusto = :codObjetoCusto)
           GROUP BY NVL(ie.cod_material, sc.cod_material)
        ),
        preco_medio AS (
          SELECT NVL(ie.cod_material, sc.cod_material) AS cod_material,
                 AVG(NVL(ie.valorunitario, 0)) AS preco_medio
            FROM material.itensentrada ie
            JOIN material.solicitacaocompra sc ON sc.nr_solicitacao = ie.nr_solicitacao
           WHERE ie.nroc IS NOT NULL
             AND NVL(ie.valorunitario, 0) > 0
             AND TRUNC(NVL(ie.dataentrada_seq, sc.data)) >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
             AND TRUNC(NVL(ie.dataentrada_seq, sc.data)) <= TO_DATE(:dataFim, 'YYYY-MM-DD')
           GROUP BY NVL(ie.cod_material, sc.cod_material)
        ),
        base AS (
          SELECT m.cod_material,
                 NVL(m.descricao, 'Material ' || m.cod_material) AS descricao,
                 NVL(gt.tipo, 'Peças e Acessórios') AS tipo,
                 NVL(gt.grupo, 'Sem grupo') AS grupo,
                 NVL(sa.qtde_saida, 0) AS qtde_saida,
                 NVL(ea.qtde_estoque, 0) AS estoque,
                 ue.ultima_entrada,
                 pm.preco_medio
            FROM material.material m
            LEFT JOIN grp_tipo gt
              ON gt.cod_familia = m.cod_familia
             AND gt.cod_grupomaterial = m.cod_grupomaterial
            LEFT JOIN saida_agg sa ON sa.cod_material = m.cod_material
            LEFT JOIN estoque_agg ea ON ea.cod_material = m.cod_material
            LEFT JOIN ultima_entrada ue ON ue.cod_material = m.cod_material
            LEFT JOIN preco_medio pm ON pm.cod_material = m.cod_material
           WHERE NVL(m.cod_familia, 0) <> 1
             AND (:codMaterial IS NULL OR m.cod_material = :codMaterial)
             AND (NVL(sa.qtde_saida, 0) > 0 OR NVL(ea.qtde_estoque, 0) > 0)
             ${tipoWhere}
        )
        SELECT cod_material, descricao, tipo, grupo, qtde_saida, estoque, ultima_entrada, preco_medio
          FROM base
         ORDER BY tipo, grupo, descricao`,
      {
        dataInicio,
        dataFim,
        saidaInicio: saidaInicioEff,
        almoxarifado,
        codMaterial,
        codObjetoCusto,
        ...tipoBinds.binds,
      },
      { maxRows: 0, fetchArraySize: 500 },
    );

    const almoxRes = await conn.execute(
      `SELECT e.cod_almoxarifado,
              MIN(NVL(a.descricaoalmoxarifado, 'Almoxarifado ' || e.cod_almoxarifado)) AS descricao
         FROM (
           SELECT est.cod_almoxarifado,
                  est.cod_grupoempresa,
                  est.cod_empresa,
                  est.cod_filial,
                  est.quantidade,
                  ROW_NUMBER() OVER (
                    PARTITION BY est.cod_material,
                                 est.cod_grupoempresa,
                                 est.cod_empresa,
                                 est.cod_filial,
                                 est.cod_almoxarifado
                    ORDER BY est.anomes DESC
                  ) AS rn
             FROM material.estoque est
            WHERE est.ano <= TO_CHAR(SYSDATE, 'YYYY')
              AND est.cod_empresa = 1
              AND est.cod_filial = 1
         ) e
         LEFT JOIN material.almoxarifado a
           ON a.cod_grupoempresa = e.cod_grupoempresa
          AND a.cod_empresa = e.cod_empresa
          AND a.cod_filial = e.cod_filial
          AND a.cod_almoxarifado = e.cod_almoxarifado
        WHERE e.rn = 1
          AND e.quantidade > 0
        GROUP BY e.cod_almoxarifado
        ORDER BY e.cod_almoxarifado`,
    );

    const matRes = await conn.execute(
      `SELECT DISTINCT m.cod_material, m.descricao
         FROM material.material m
        WHERE NVL(m.cod_familia, 0) <> 1
        ORDER BY m.descricao
        FETCH FIRST 500 ROWS ONLY`,
    );

    const objRes = await conn.execute(
      `SELECT DISTINCT oc.cod_objetocusto, oc.descricao
         FROM custo.objetocusto oc
        ORDER BY oc.descricao
        FETCH FIRST 300 ROWS ONLY`,
    );

    return {
      rows: (result.rows ?? []) as Record<string, unknown>[],
      almoxarifados: (almoxRes.rows ?? []) as Record<string, unknown>[],
      materiais: (matRes.rows ?? []) as Record<string, unknown>[],
      objetos: (objRes.rows ?? []) as Record<string, unknown>[],
    };
  });

  const gruposMap = new Map<string, GestaoMateriaisGrupo>();

  for (const raw of rows.rows) {
    const cod = oracleNumber(raw, "cod_material", "COD_MATERIAL");
    if (cod == null) continue;

    const saida = qty(oracleNumber(raw, "qtde_saida", "QTDE_SAIDA") ?? 0);
    const estoqueAtual = qty(oracleNumber(raw, "estoque", "ESTOQUE") ?? 0);
    const mediaMes = qty(saida / mesesEstoque);
    const coberturaMeses = mediaMes > 0 ? qty(estoqueAtual / mediaMes) : null;
    const precoMedioRaw = oracleNumber(raw, "preco_medio", "PRECO_MEDIO");
    const precoMedio = precoMedioRaw != null ? money(precoMedioRaw) : null;
    const qtdSugerida = qty(Math.max(0, mediaMes * mesesSugerida - estoqueAtual));
    const tipo = oracleText(raw, "tipo", "TIPO") || "Peças e Acessórios";
    const grupo = oracleText(raw, "grupo", "GRUPO") || "Sem grupo";
    const ultima = oracleDate(raw, "ultima_entrada", "ULTIMA_ENTRADA");

    const item: GestaoMateriaisItem = {
      codMaterial: cod,
      descricao: oracleText(raw, "descricao", "DESCRICAO") || `Material ${cod}`,
      tipo,
      grupo,
      codAlmoxarifado: almoxarifado,
      codObjetoCusto,
      saida,
      mediaMes,
      estoqueAtual,
      coberturaMeses,
      ultimaEntrada: ultima ? ultima.slice(0, 10) : null,
      qtdSugerida,
      prioridade: prioridade(coberturaMeses, estoqueAtual),
      precoMedio,
      valorTotal: money(estoqueAtual * (precoMedio ?? 0)),
    };

    const key = tipo;
    const label = tipo === "Peças e Acessórios" ? "Peças e Acessórios Automotivos" : tipo;
    const prev = gruposMap.get(key) ?? {
      tipo: key,
      label,
      itens: [],
      totais: { saida: 0, mediaMes: 0, estoqueAtual: 0, qtdSugerida: 0, valorTotal: 0 },
    };
    prev.itens.push(item);
    prev.totais.saida = qty(prev.totais.saida + item.saida);
    prev.totais.mediaMes = qty(prev.totais.mediaMes + item.mediaMes);
    prev.totais.estoqueAtual = qty(prev.totais.estoqueAtual + item.estoqueAtual);
    prev.totais.qtdSugerida = qty(prev.totais.qtdSugerida + item.qtdSugerida);
    prev.totais.valorTotal = money(prev.totais.valorTotal + item.valorTotal);
    gruposMap.set(key, prev);
  }

  const grupos = [...gruposMap.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const totais = grupos.reduce(
    (acc, g) => ({
      saida: qty(acc.saida + g.totais.saida),
      mediaMes: qty(acc.mediaMes + g.totais.mediaMes),
      estoqueAtual: qty(acc.estoqueAtual + g.totais.estoqueAtual),
      qtdSugerida: qty(acc.qtdSugerida + g.totais.qtdSugerida),
      valorTotal: money(acc.valorTotal + g.totais.valorTotal),
    }),
    { saida: 0, mediaMes: 0, estoqueAtual: 0, qtdSugerida: 0, valorTotal: 0 },
  );

  return {
    filtros: {
      dataInicio,
      dataFim,
      tipos,
      almoxarifado,
      codMaterial,
      codObjetoCusto,
      mesesEstoque,
      mesesSugerida,
    },
    tipos: [...MATERIAL_TIPOS],
    almoxarifados: rows.almoxarifados
      .map((raw) => ({
        codigo: oracleNumber(raw, "cod_almoxarifado", "COD_ALMOXARIFADO") ?? 0,
        descricao: oracleText(raw, "descricao", "DESCRICAO") || "Almoxarifado",
      }))
      .filter((row) => row.codigo > 0),
    materiais: rows.materiais
      .map((raw) => ({
        codigo: oracleNumber(raw, "cod_material", "COD_MATERIAL") ?? 0,
        descricao: oracleText(raw, "descricao", "DESCRICAO") || "",
      }))
      .filter((row) => row.codigo > 0),
    objetosCusto: rows.objetos
      .map((raw) => ({
        codigo: oracleNumber(raw, "cod_objetocusto", "COD_OBJETOCUSTO") ?? 0,
        descricao: oracleText(raw, "descricao", "DESCRICAO") || "",
      }))
      .filter((row) => row.codigo > 0),
    grupos,
    totais,
  };
}
