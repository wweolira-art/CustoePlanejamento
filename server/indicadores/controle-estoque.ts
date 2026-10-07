import { oracleNumber, oracleText, withOracle } from "../oracle.js";

export type ControleEstoqueItem = {
  codMaterial: number | null;
  codigo: string;
  descricao: string;
  unidade: string;
  grupo: string;
  codFamilia: number | null;
  codGrupoMaterial: number | null;
  codAlmoxarifado: number | null;
  almoxarifado: string;
  ano: number | null;
  mes: number | null;
  anomes: number | null;
  quantidade: number;
};

export type ControleEstoqueAlmox = {
  codigo: number;
  descricao: string;
};

export type ControleEstoqueData = {
  filtros: {
    anomes: number | null;
    busca: string | null;
    almoxarifado: number | null;
  };
  periodo: { anomes: number | null; ano: number | null; mes: number | null; label: string };
  almoxarifados: ControleEstoqueAlmox[];
  itens: ControleEstoqueItem[];
  totais: { materiais: number; quantidade: number; almoxarifados: number };
};

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function qty(n: number) {
  return Math.round((n || 0) * 1000) / 1000;
}

function parseAnomes(raw?: string | number | null) {
  if (raw == null || raw === "") return null;
  const text = String(raw).trim();
  const yyyymm = text.match(/^(\d{4})-(\d{1,2})$/);
  if (yyyymm) {
    const ano = Number(yyyymm[1]);
    const mes = Number(yyyymm[2]);
    if (ano >= 1990 && mes >= 1 && mes <= 12) return ano * 100 + mes;
  }
  const n = Number(text.replace(/\D/g, ""));
  if (!Number.isFinite(n)) return null;
  if (n >= 199001 && n <= 210012) return Math.round(n);
  return null;
}

function labelAnomes(anomes: number | null) {
  if (!anomes) return "—";
  const ano = Math.floor(anomes / 100);
  const mes = anomes % 100;
  const nome = MESES[mes - 1] ?? String(mes).padStart(2, "0");
  return `${nome}/${ano}`;
}

export async function gerarControleEstoque(filtros: {
  anomes?: string | number | null;
  busca?: string | null;
  almoxarifado?: string | number | null;
}): Promise<ControleEstoqueData> {
  const anomesFiltro = parseAnomes(filtros.anomes);
  const busca = filtros.busca?.trim() || null;
  const almoxRaw = Number(filtros.almoxarifado);
  const almoxarifado = Number.isFinite(almoxRaw) && almoxRaw > 0 ? almoxRaw : null;
  const buscaLike = busca ? `%${busca.replace(/[%_]/g, "").toUpperCase()}%` : null;

  const { itensRows, almoxRows, periodoAnomes } = await withOracle(async (conn) => {
    const periodResult = await conn.execute(
      `SELECT NVL(:anomes, MAX(NVL(e.anomes, e.ano * 100 + e.mes))) AS anomes
         FROM material.estoque e
        WHERE e.cod_empresa = 1
          AND e.cod_filial = 1`,
      { anomes: anomesFiltro },
    );
    const periodRow = ((periodResult.rows ?? []) as Record<string, unknown>[])[0];
    const periodoAnomes = oracleNumber(periodRow ?? {}, "anomes");
    if (periodoAnomes == null) {
      return {
        itensRows: [] as Record<string, unknown>[],
        almoxRows: [] as Record<string, unknown>[],
        periodoAnomes: null as number | null,
      };
    }

    const [itensResult, almoxResult] = await Promise.all([
      conn.execute(
        `SELECT e.cod_material,
                m.descricao,
                m.cod_unidade,
                m.cod_familia,
                m.cod_grupomaterial,
                NVL(g.descricao, 'Grupo ' || m.cod_grupomaterial) AS grupo,
                e.cod_almoxarifado,
                NVL(a.descricaoalmoxarifado, 'Almoxarifado ' || e.cod_almoxarifado) AS almoxarifado,
                e.ano,
                e.mes,
                NVL(e.anomes, e.ano * 100 + e.mes) AS anomes,
                NVL(e.quantidade, 0) AS quantidade
           FROM material.estoque e
           LEFT JOIN material.material m
             ON m.cod_material = e.cod_material
           LEFT JOIN material.grupomaterial g
             ON g.cod_familia = m.cod_familia
            AND g.cod_grupomaterial = m.cod_grupomaterial
           LEFT JOIN material.almoxarifado a
             ON a.cod_grupoempresa = e.cod_grupoempresa
            AND a.cod_empresa = e.cod_empresa
            AND a.cod_filial = e.cod_filial
            AND a.cod_almoxarifado = e.cod_almoxarifado
          WHERE e.cod_empresa = 1
            AND e.cod_filial = 1
            AND NVL(e.anomes, e.ano * 100 + e.mes) = :periodo
            AND (:almoxarifado IS NULL OR e.cod_almoxarifado = :almoxarifado)
            AND (
              :busca IS NULL
              OR UPPER(NVL(m.descricao, ' ')) LIKE :busca
              OR TO_CHAR(e.cod_material) LIKE :busca
            )
          ORDER BY NVL(g.descricao, 'Grupo ' || m.cod_grupomaterial),
                   NVL(m.descricao, 'Material ' || e.cod_material),
                   e.cod_almoxarifado`,
        { periodo: periodoAnomes, almoxarifado, busca: buscaLike },
        { maxRows: 0, fetchArraySize: 500 },
      ),
      conn.execute(
        `SELECT DISTINCT e.cod_almoxarifado,
                NVL(a.descricaoalmoxarifado, 'Almoxarifado ' || e.cod_almoxarifado) AS almoxarifado
           FROM material.estoque e
           LEFT JOIN material.almoxarifado a
             ON a.cod_grupoempresa = e.cod_grupoempresa
            AND a.cod_empresa = e.cod_empresa
            AND a.cod_filial = e.cod_filial
            AND a.cod_almoxarifado = e.cod_almoxarifado
          WHERE e.cod_empresa = 1
            AND e.cod_filial = 1
            AND NVL(e.anomes, e.ano * 100 + e.mes) = :periodo
          ORDER BY e.cod_almoxarifado`,
        { periodo: periodoAnomes },
        { maxRows: 0 },
      ),
    ]);

    return {
      itensRows: (itensResult.rows ?? []) as Record<string, unknown>[],
      almoxRows: (almoxResult.rows ?? []) as Record<string, unknown>[],
      periodoAnomes,
    };
  });

  const itens: ControleEstoqueItem[] = [];
  let quantidade = 0;

  for (const raw of itensRows) {
    const anomes = oracleNumber(raw, "anomes");
    const item: ControleEstoqueItem = {
      codMaterial: oracleNumber(raw, "cod_material"),
      codigo: oracleText(raw, "cod_material") || "—",
      descricao: oracleText(raw, "descricao") || `Material ${oracleText(raw, "cod_material")}`,
      unidade: oracleText(raw, "cod_unidade"),
      grupo: oracleText(raw, "grupo") || "Sem grupo",
      codFamilia: oracleNumber(raw, "cod_familia"),
      codGrupoMaterial: oracleNumber(raw, "cod_grupomaterial"),
      codAlmoxarifado: oracleNumber(raw, "cod_almoxarifado"),
      almoxarifado: oracleText(raw, "almoxarifado") || "Almoxarifado",
      ano: oracleNumber(raw, "ano"),
      mes: oracleNumber(raw, "mes"),
      anomes,
      quantidade: qty(oracleNumber(raw, "quantidade") ?? 0),
    };
    itens.push(item);
    quantidade += item.quantidade;
  }

  const almoxarifados = almoxRows
    .map((raw) => ({
      codigo: oracleNumber(raw, "cod_almoxarifado") ?? 0,
      descricao: oracleText(raw, "almoxarifado") || "Almoxarifado",
    }))
    .filter((row) => row.codigo > 0)
    .sort((a, b) => a.codigo - b.codigo);

  return {
    filtros: { anomes: anomesFiltro ?? periodoAnomes, busca, almoxarifado },
    periodo: {
      anomes: periodoAnomes,
      ano: periodoAnomes ? Math.floor(periodoAnomes / 100) : null,
      mes: periodoAnomes ? periodoAnomes % 100 : null,
      label: labelAnomes(periodoAnomes),
    },
    almoxarifados,
    itens,
    totais: {
      materiais: new Set(itens.map((item) => item.codigo)).size,
      quantidade: qty(quantidade),
      almoxarifados: almoxarifados.length,
    },
  };
}
