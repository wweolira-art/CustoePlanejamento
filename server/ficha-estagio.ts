import { db } from "./db.js";

type Linha = {
  objeto: string;
  descricao: string;
  insumo: string;
  preco: number | null;
  dose: number | null;
  rHaInsumo: number | null;
  custo: number;
};

type Bloco = { titulo: string; sheets: string[]; area: "plantio" | "soca"; semInsumo?: boolean };

const BLOCOS: Bloco[] = [
  { titulo: "Preparo de solo", sheets: ["P.SOLO"], area: "plantio" },
  { titulo: "Plantio", sheets: ["PLANTIO"], area: "plantio" },
  { titulo: "Manutenção da soqueira", sheets: ["T.C.S."], area: "soca" },
  { titulo: "Sistema de colheita", sheets: ["C. MECANIZADA", "C. MANUAL"], area: "soca", semInsumo: true },
];

type Row = {
  sheet_name: string;
  id: number;
  parent_id: number | null;
  description: string;
  ref_kind: string | null;
  calc_dose: number | null;
  calc_price: number | null;
  objeto: string | null;
  codigo: string | null;
  total: number;
};

const GRUPOS_COLHEITA: { nome: string; modalidade: "mecanizada" | "manual"; codigos: string[] }[] = [
  { nome: "Transporte", modalidade: "mecanizada", codigos: ["106", "107", "78"] },
  { nome: "Carregamento", modalidade: "mecanizada", codigos: ["116", "108", "82", "113"] },
  { nome: "Corte", modalidade: "mecanizada", codigos: ["79", "119", "75"] },
  { nome: "Transporte", modalidade: "manual", codigos: ["70", "71"] },
  { nome: "Carregamento", modalidade: "manual", codigos: ["69"] },
  { nome: "Corte", modalidade: "manual", codigos: ["68", "63"] },
];

const AVULSOS_COLHEITA = [
  { codigo: "85", nome: "85 — Serviço Apoio Adm-C.Rec- C.MEC" },
  { codigo: "266", nome: "266 — Oficina da Colheita Mecanizada" },
];

const CODIGOS_COLHEITA = [
  ...GRUPOS_COLHEITA.flatMap((grupo) => grupo.codigos),
  ...AVULSOS_COLHEITA.map((item) => item.codigo),
];

const SAFRA_MONTHS = [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7];

export function mesesDoPeriodo(anomesInicio: number, anomesFim: number, startYear: number) {
  const meses: number[] = [];
  let year = Math.floor(anomesInicio / 100);
  let month = anomesInicio % 100;
  while (year * 100 + month <= anomesFim) {
    const calendar = month - 1;
    const index = SAFRA_MONTHS.indexOf(calendar);
    const expectedYear = calendar >= 8 ? startYear : startYear + 1;
    if (index >= 0 && year === expectedYear) meses.push(index);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return meses;
}

export function lerFichaEstagio(meses?: number[]) {
  const nomes = BLOCOS.flatMap((bloco) => bloco.sheets);
  const rows = db
    .prepare(
      `SELECT s.name AS sheet_name,
              l.id,
              l.parent_id,
              l.description,
              l.ref_kind,
              l.calc_dose,
              l.calc_price,
              (
                SELECT CASE
                         WHEN co.code IS NULL OR TRIM(co.code) = '' THEN co.description
                         WHEN co.description IS NULL OR TRIM(co.description) = '' THEN co.code
                         ELSE co.code || ' — ' || co.description
                       END
                  FROM cost_objects co
                 WHERE co.id = l.cost_object_id
                    OR (l.cost_object_id IS NULL AND co.code = l.object_code)
                 LIMIT 1
              ) AS objeto,
              (
                SELECT co.code
                  FROM cost_objects co
                 WHERE co.id = l.cost_object_id
                    OR (l.cost_object_id IS NULL AND co.code = l.object_code)
                 LIMIT 1
              ) AS codigo,
              COALESCE((
                SELECT SUM(CAST(m.value AS REAL))
                  FROM line_months m
                 WHERE m.line_id = l.id
                   AND m.value IS NOT NULL
                   AND TRIM(m.value) <> ''
                   ${meses ? (meses.length ? `AND m.month_index IN (${meses.map(() => "?").join(",")})` : "AND 0") : ""}
              ), 0) AS total
         FROM lines l
         JOIN sheets s ON s.id = l.sheet_id
        WHERE s.name IN (${nomes.map(() => "?").join(",")})
           OR EXISTS (
                SELECT 1
                  FROM cost_objects co
                 WHERE co.code IN (${CODIGOS_COLHEITA.map(() => "?").join(",")})
                   AND (
                     co.id = l.cost_object_id
                     OR (l.cost_object_id IS NULL AND co.code = l.object_code)
                   )
              )
        ORDER BY l.category_id, l.sort_order, l.id`,
    )
    .all(...(meses ?? []), ...nomes, ...CODIGOS_COLHEITA) as Row[];

  const porFolha = new Map<string, Row[]>();
  for (const row of rows) {
    const lista = porFolha.get(row.sheet_name) ?? [];
    lista.push(row);
    porFolha.set(row.sheet_name, lista);
  }

  return {
    secoes: BLOCOS.flatMap((bloco) => {
      if (bloco.semInsumo) return secoesColheita(rows);
      const linhas = bloco.sheets.flatMap((nome) => linhasDaFolha(porFolha.get(nome) ?? []));
      return [
        {
          titulo: bloco.titulo,
          area: bloco.area,
          semInsumo: false,
          linhas,
          total: linhas.reduce((sum, row) => sum + row.custo, 0),
        },
      ];
    }).filter((secao) => secao.linhas.length),
  };
}

function linhaColheita(nome: string, custo: number): Linha {
  return {
    objeto: nome,
    descricao: nome,
    insumo: "",
    preco: null,
    dose: null,
    rHaInsumo: null,
    custo,
  };
}

function custoDoCodigo(rows: Row[], codigo: string) {
  return rows.reduce((sum, row) => (String(row.codigo ?? "").trim() === codigo ? sum + row.total : sum), 0);
}

function extraDaFolha(rows: Row[], folha: string, usados: Set<string>) {
  return rows.reduce((sum, row) => {
    if (row.sheet_name !== folha) return sum;
    const codigo = String(row.codigo ?? "").trim();
    if (usados.has(codigo)) return sum;
    return sum + row.total;
  }, 0);
}

function secoesColheita(rows: Row[]) {
  const usados = new Set(CODIGOS_COLHEITA);
  const grupos = GRUPOS_COLHEITA.map((grupo) => {
    const codigos = new Set(grupo.codigos);
    const custo = rows.reduce((sum, row) => {
      const codigo = String(row.codigo ?? "").trim();
      return codigos.has(codigo) ? sum + row.total : sum;
    }, 0);
    return { nome: grupo.nome, modalidade: grupo.modalidade, custo };
  });
  const extras: Record<"mecanizada" | "manual", number> = {
    mecanizada: extraDaFolha(rows, "C. MECANIZADA", usados),
    manual: extraDaFolha(rows, "C. MANUAL", usados),
  };
  for (const modalidade of ["mecanizada", "manual"] as const) {
    const alvo = grupos.filter((grupo) => grupo.modalidade === modalidade);
    const extra = extras[modalidade];
    const base = alvo.reduce((sum, grupo) => sum + grupo.custo, 0);
    for (const grupo of alvo) {
      const parte = base > 0 ? (extra * grupo.custo) / base : extra / alvo.length;
      grupo.custo += parte;
    }
  }
  const blocos: { titulo: string; modalidade: "mecanizada" | "manual" }[] = [
    { titulo: "Colheita mecanizada", modalidade: "mecanizada" },
    { titulo: "Colheita manual", modalidade: "manual" },
  ];
  return blocos.map((bloco) => {
    const linhas = grupos
      .filter((grupo) => grupo.modalidade === bloco.modalidade)
      .map((grupo) => linhaColheita(grupo.nome, grupo.custo));
    if (bloco.modalidade === "mecanizada") {
      for (const item of AVULSOS_COLHEITA) {
        linhas.push(linhaColheita(item.nome, custoDoCodigo(rows, item.codigo)));
      }
    }
    return {
      titulo: bloco.titulo,
      area: "soca" as const,
      semInsumo: true,
      linhas,
      total: linhas.reduce((sum, row) => sum + row.custo, 0),
    };
  });
}

function linhasDaFolha(rows: Row[]): Linha[] {
  const out: Linha[] = [];
  const heads = rows.filter((row) => row.parent_id == null);
  for (const head of heads) {
    const insumos = rows.filter((row) => row.parent_id === head.id && row.ref_kind === "material");
    if (Math.abs(head.total) > 0.5) {
      out.push({
        objeto: head.objeto ?? "",
        descricao: head.description,
        insumo: "",
        preco: null,
        dose: null,
        rHaInsumo: null,
        custo: head.total,
      });
    }
    for (const insumo of insumos) {
      const preco = insumo.calc_price ?? null;
      const dose = insumo.calc_dose ?? null;
      if (!(Math.abs(insumo.total) > 0.5) && !(dose && preco)) continue;
      out.push({
        objeto: insumo.objeto || head.objeto || "",
        descricao: head.description,
        insumo: insumo.description,
        preco,
        dose,
        rHaInsumo: preco != null && dose != null ? preco * dose : null,
        custo: insumo.total,
      });
    }
  }
  return out;
}
