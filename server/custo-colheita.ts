import { oracleNumber, oracleText, withOracle } from "./oracle.js";
import { db } from "./db.js";
import { resolveSafraId } from "./safras.js";

const GRUPOS: { titulo: string; linhas: { objeto: string; codigos: string[] }[] }[] = [
  {
    titulo: "Colheita mecanizada",
    linhas: [
      { objeto: "Transporte", codigos: ["106", "107", "78"] },
      { objeto: "Carregamento", codigos: ["116", "108", "82", "113"] },
      { objeto: "Corte", codigos: ["79", "119", "75"] },
      { objeto: "85 — Serviço Apoio Adm-C.Rec- C.MEC", codigos: ["85"] },
      { objeto: "266 — Oficina da Colheita Mecanizada", codigos: ["266"] },
    ],
  },
  {
    titulo: "Colheita manual",
    linhas: [
      { objeto: "Catação de bitucas", codigos: ["74"] },
      { objeto: "Administrativo", codigos: ["72"] },
      { objeto: "Transporte", codigos: ["70", "71"] },
      { objeto: "Carregamento", codigos: ["69"] },
      { objeto: "Corte", codigos: ["68", "63"] },
    ],
  },
];

const CODIGOS = [...new Set(GRUPOS.flatMap((grupo) => grupo.linhas.flatMap((linha) => linha.codigos)))];
const CODIGOS_NUMERICOS = CODIGOS.map((codigo) => Number(codigo));
const TOTAL_LINHAS = GRUPOS.reduce((sum, grupo) => sum + grupo.linhas.length, 0);

export type CustoColheitaLinha = { objeto: string; custo: number; custoOracle: number; armazenado: boolean };
export type CustoColheitaSecao = { titulo: string; linhas: CustoColheitaLinha[] };

function ensureCustoColheitaLocal() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS custo_colheita_local (
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      anomes_inicio TEXT NOT NULL,
      anomes_fim TEXT NOT NULL,
      secao TEXT NOT NULL,
      objeto TEXT NOT NULL,
      custo REAL NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (safra_id, anomes_inicio, anomes_fim, secao, objeto)
    );
  `);
}

function asAnomes(raw: unknown) {
  const value = String(raw ?? "").trim();
  if (!/^\d{6}$/.test(value)) throw new Error("Informe o anomes inicial e final no formato YYYYMM.");
  return value;
}

function asCusto(raw: unknown, label = "custo") {
  const value = typeof raw === "string" ? Number(raw.trim().replace(/\./g, "").replace(",", ".")) : Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Informe ${label} com um número válido.`);
  return value;
}

function chave(secao: string, objeto: string) {
  return `${secao}\u0000${objeto}`;
}

function lerAjustesLocais(safraId: number, anomesInicio: string, anomesFim: string) {
  ensureCustoColheitaLocal();
  const rows = db
    .prepare(
      `SELECT secao, objeto, custo
         FROM custo_colheita_local
        WHERE safra_id = ?
          AND anomes_inicio = ?
          AND anomes_fim = ?`,
    )
    .all(safraId, anomesInicio, anomesFim) as { secao: string; objeto: string; custo: number }[];
  return new Map(rows.map((row) => [chave(row.secao, row.objeto), Number(row.custo) || 0]));
}

function montarCustoColheita(
  safraId: number,
  anomesInicio: string,
  anomesFim: string,
  porCodigo: Map<string, number>,
  locais: Map<string, number>,
  oracleConsultado: boolean,
) {
  return {
    safraId,
    anomesInicio,
    anomesFim,
    oracleConsultado,
    secoes: GRUPOS.map((grupo) => ({
      titulo: grupo.titulo,
      linhas: grupo.linhas.map((linha) => {
        const custoOracle = linha.codigos.reduce((soma, codigo) => soma + (porCodigo.get(codigo) ?? 0), 0);
        const local = locais.get(chave(grupo.titulo, linha.objeto));
        return {
          objeto: linha.objeto,
          custo: local ?? custoOracle,
          custoOracle,
          armazenado: local != null,
        };
      }),
    })),
  };
}

export async function lerCustoColheita(
  anomesInicio: number,
  anomesFim: number,
  safraId?: number | null,
  opcoes: { preferirLocal?: boolean } = {},
) {
  const inicio = asAnomes(anomesInicio);
  const fim = asAnomes(anomesFim);
  const id = resolveSafraId(safraId);
  const locais = lerAjustesLocais(id, inicio, fim);
  if (opcoes.preferirLocal && locais.size >= TOTAL_LINHAS) {
    return montarCustoColheita(id, inicio, fim, new Map(), locais, false);
  }
  const binds: Record<string, string | number> = { anomesInicio, anomesFim };
  CODIGOS_NUMERICOS.forEach((codigo, index) => {
    binds[`c${index}`] = codigo;
  });
  const rows = await withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT TO_CHAR(a.cod_objetocusto) AS codigo,
              NVL(SUM(a.valor), 0) AS valor
         FROM custo.lancamento_custo a
        WHERE a.tipo = 'R'
          AND a.anomes BETWEEN :anomesInicio AND :anomesFim
          AND EXISTS (
                SELECT 1
                  FROM custo.empenho emp
                 WHERE emp.cod_empenho = a.cod_empenho
                   AND emp.cod_tipoempenho IN (1, 2)
          )
          AND a.cod_objetocusto IN (${CODIGOS.map((_, index) => `:c${index}`).join(", ")})
        GROUP BY a.cod_objetocusto`,
      binds,
    );
    return (result.rows ?? []) as Record<string, unknown>[];
  });

  const porCodigo = new Map<string, number>();
  for (const row of rows) {
    const codigo = oracleText(row, "codigo");
    porCodigo.set(codigo, (porCodigo.get(codigo) ?? 0) + (oracleNumber(row, "valor") ?? 0));
  }
  return montarCustoColheita(id, inicio, fim, porCodigo, locais, true);
}

export function salvarCustoColheitaLocal(
  safraId: number | null | undefined,
  body: {
    anomesInicio?: unknown;
    anomesFim?: unknown;
    secoes?: { titulo?: unknown; linhas?: { objeto?: unknown; custo?: unknown }[] }[];
  },
) {
  ensureCustoColheitaLocal();
  const id = resolveSafraId(safraId);
  const inicio = asAnomes(body.anomesInicio);
  const fim = asAnomes(body.anomesFim);
  const secoes = Array.isArray(body.secoes) ? body.secoes : [];
  const permitidos = new Set(GRUPOS.flatMap((grupo) => grupo.linhas.map((linha) => chave(grupo.titulo, linha.objeto))));
  const updatedAt = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO custo_colheita_local (safra_id, anomes_inicio, anomes_fim, secao, objeto, custo, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(safra_id, anomes_inicio, anomes_fim, secao, objeto) DO UPDATE SET
       custo = excluded.custo,
       updated_at = excluded.updated_at`,
  );
  const tx = db.transaction(() => {
    for (const secao of secoes) {
      const titulo = String(secao.titulo ?? "").trim();
      for (const linha of secao.linhas ?? []) {
        const objeto = String(linha.objeto ?? "").trim();
        if (!permitidos.has(chave(titulo, objeto))) continue;
        insert.run(id, inicio, fim, titulo, objeto, asCusto(linha.custo, objeto), updatedAt);
      }
    }
  });
  tx();
  return { ok: true, safraId: id, anomesInicio: inicio, anomesFim: fim, updatedAt };
}
