import { oracleNumber, oracleText, withOracle } from "./oracle.js";
import { db } from "./db.js";
import { resolveSafraId } from "./safras.js";
import { consultarRateioAdminAgricolaPorDestino } from "./custo/services/rateioMatrizSubprocessoService.js";

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
const CODIGO_ADMIN_AGRICOLA = "__ADMIN_AGRICOLA__";
const CODIGO_ADMIN_AGRICOLA_MANUAL = "__ADMIN_AGRICOLA_MANUAL__";
const CODIGO_ADMIN_AGRICOLA_MECANIZADA = "__ADMIN_AGRICOLA_MECANIZADA__";
const CODIGO_MOAGEM_ORACLE = "__MOAGEM_ORACLE__";
const CACHE_ORACLE_TTL_MS = 30 * 60 * 1000;
const oracleInflight = new Map<string, Promise<{ porCodigo: Map<string, number> }>>();

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
  db.exec(`
    CREATE TABLE IF NOT EXISTS custo_colheita_oracle_cache (
      safra_id INTEGER NOT NULL,
      anomes_inicio TEXT NOT NULL,
      anomes_fim TEXT NOT NULL,
      codigo TEXT NOT NULL,
      valor REAL NOT NULL,
      PRIMARY KEY (safra_id, anomes_inicio, anomes_fim, codigo)
    );
    CREATE TABLE IF NOT EXISTS custo_colheita_oracle_cache_status (
      safra_id INTEGER NOT NULL,
      anomes_inicio TEXT NOT NULL,
      anomes_fim TEXT NOT NULL,
      atualizado_em TEXT NOT NULL,
      PRIMARY KEY (safra_id, anomes_inicio, anomes_fim)
    );
  `);
}

function lerCacheOracle(safraId: number, inicio: string, fim: string) {
  ensureCustoColheitaLocal();
  const status = db.prepare(
    `SELECT atualizado_em FROM custo_colheita_oracle_cache_status
      WHERE safra_id = ? AND anomes_inicio = ? AND anomes_fim = ?`,
  ).get(safraId, inicio, fim) as { atualizado_em: string } | undefined;
  if (!status) return null;
  const rows = db.prepare(
    `SELECT codigo, valor FROM custo_colheita_oracle_cache
      WHERE safra_id = ? AND anomes_inicio = ? AND anomes_fim = ?`,
  ).all(safraId, inicio, fim) as { codigo: string; valor: number }[];
  return {
    porCodigo: new Map(rows.map((row) => [row.codigo, Number(row.valor) || 0])),
    atualizadoEm: status.atualizado_em,
  };
}

function salvarCacheOracle(
  safraId: number,
  inicio: string,
  fim: string,
  porCodigo: Map<string, number>,
  atualizadoEm: string,
) {
  const save = db.transaction(() => {
    db.prepare(
      `DELETE FROM custo_colheita_oracle_cache
        WHERE safra_id = ? AND anomes_inicio = ? AND anomes_fim = ?`,
    ).run(safraId, inicio, fim);
    const insert = db.prepare(
      `INSERT INTO custo_colheita_oracle_cache (safra_id, anomes_inicio, anomes_fim, codigo, valor)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const [codigo, valor] of porCodigo) insert.run(safraId, inicio, fim, codigo, valor);
    db.prepare(
      `INSERT INTO custo_colheita_oracle_cache_status (safra_id, anomes_inicio, anomes_fim, atualizado_em)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(safra_id, anomes_inicio, anomes_fim) DO UPDATE SET atualizado_em = excluded.atualizado_em`,
    ).run(safraId, inicio, fim, atualizadoEm);
  });
  save();
}

function asAnomes(raw: unknown) {
  const value = String(raw ?? "").trim();
  if (!/^\d{6}$/.test(value)) throw new Error("Informe o anomes inicial e final no formato YYYYMM.");
  return value;
}

function datasDoPeriodo(inicio: string, fim: string) {
  const dataInicio = new Date(Number(inicio.slice(0, 4)), Number(inicio.slice(4, 6)) - 1, 1);
  const dataFim = new Date(Number(fim.slice(0, 4)), Number(fim.slice(4, 6)), 1);
  return { dataInicio, dataFim };
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
    custoAdministracaoAgricola: porCodigo.get(CODIGO_ADMIN_AGRICOLA) ?? 0,
    custoAdministracaoAgricolaManual: porCodigo.get(CODIGO_ADMIN_AGRICOLA_MANUAL) ?? 0,
    custoAdministracaoAgricolaMecanizada: porCodigo.get(CODIGO_ADMIN_AGRICOLA_MECANIZADA) ?? 0,
    moagemOracle: porCodigo.get(CODIGO_MOAGEM_ORACLE) ?? 0,
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
  opcoes: { preferirLocal?: boolean; atualizarOracle?: boolean } = {},
) {
  const inicio = asAnomes(anomesInicio);
  const fim = asAnomes(anomesFim);
  const id = resolveSafraId(safraId);
  const locais = lerAjustesLocais(id, inicio, fim);
  const cache = lerCacheOracle(id, inicio, fim);
  if (
    cache &&
    cache.porCodigo.has(CODIGO_ADMIN_AGRICOLA_MANUAL) &&
    cache.porCodigo.has(CODIGO_ADMIN_AGRICOLA_MECANIZADA) &&
    cache.porCodigo.has(CODIGO_MOAGEM_ORACLE) &&
    !opcoes.atualizarOracle &&
    Date.now() - Date.parse(cache.atualizadoEm) < CACHE_ORACLE_TTL_MS
  ) {
    return {
      ...montarCustoColheita(id, inicio, fim, cache.porCodigo, locais, true),
      cacheOracle: true,
      cacheDesatualizado: false,
      oracleAtualizadoEm: cache.atualizadoEm,
    };
  }
  const binds: Record<string, string | number> = { anomesInicio, anomesFim };
  CODIGOS_NUMERICOS.forEach((codigo, index) => {
    binds[`c${index}`] = codigo;
  });
  const cacheKey = `${id}:${inicio}:${fim}`;
  let consulta = oracleInflight.get(cacheKey);
  if (!consulta || opcoes.atualizarOracle) {
    consulta = withOracle(async (conn) => {
      const result = await conn.execute(
      `SELECT TO_CHAR(a.cod_objetocusto) AS codigo,
              NVL(SUM(a.valor), 0) AS valor
         FROM custo.lancamento_custo a
         JOIN custo.empenho emp
           ON emp.cod_empenho = a.cod_empenho
          AND emp.cod_tipoempenho IN (1, 2)
        WHERE a.tipo = 'R'
          AND a.anomes BETWEEN :anomesInicio AND :anomesFim
          AND a.cod_objetocusto IN (${CODIGOS.map((_, index) => `:c${index}`).join(", ")})
        GROUP BY a.cod_objetocusto`,
      binds,
      { callTimeout: 300_000 },
      );
      const { dataInicio, dataFim } = datasDoPeriodo(inicio, fim);
      const moagemResult = await conn.execute(
        `SELECT NVL(SUM(pesoliquido), 0) AS toneladas
           FROM agricola.itensentradacana
          WHERE pesoliquido > 0
            AND datamovimentoitens >= :dataInicio
            AND datamovimentoitens < :dataFim`,
        { dataInicio, dataFim },
        { callTimeout: 300_000 },
      );
      const porCodigo = new Map<string, number>();
      for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
        const codigo = oracleText(row, "codigo");
        const valor = oracleNumber(row, "valor") ?? 0;
        if (CODIGOS.includes(codigo)) porCodigo.set(codigo, (porCodigo.get(codigo) ?? 0) + valor);
      }
      const moagemRow = ((moagemResult.rows ?? [])[0] ?? {}) as Record<string, unknown>;
      porCodigo.set(CODIGO_MOAGEM_ORACLE, oracleNumber(moagemRow, "toneladas") ?? 0);
      return { porCodigo };
    }).finally(() => {
      if (oracleInflight.get(cacheKey) === consulta) oracleInflight.delete(cacheKey);
    });
    oracleInflight.set(cacheKey, consulta);
  }
  try {
    const resultado = await consulta;
    const destinosRateados = await consultarRateioAdminAgricolaPorDestino(anomesInicio, anomesFim);
    const custoManual = destinosRateados
      .filter((item) => item.codObjetoDestino === 72)
      .reduce((total, item) => total + item.valor, 0);
    const custoMecanizada = destinosRateados
      .filter((item) => item.codObjetoDestino === 266)
      .reduce((total, item) => total + item.valor, 0);
    resultado.porCodigo.set(CODIGO_ADMIN_AGRICOLA_MANUAL, custoManual);
    resultado.porCodigo.set(CODIGO_ADMIN_AGRICOLA_MECANIZADA, custoMecanizada);
    resultado.porCodigo.set(CODIGO_ADMIN_AGRICOLA, custoManual + custoMecanizada);
    const atualizadoEm = new Date().toISOString();
    salvarCacheOracle(id, inicio, fim, resultado.porCodigo, atualizadoEm);
    return {
      ...montarCustoColheita(id, inicio, fim, resultado.porCodigo, locais, true),
      cacheOracle: false,
      cacheDesatualizado: false,
      oracleAtualizadoEm: atualizadoEm,
    };
  } catch (error) {
    if (!cache) throw error;
    return {
      ...montarCustoColheita(id, inicio, fim, cache.porCodigo, locais, true),
      cacheOracle: true,
      cacheDesatualizado: true,
      oracleAtualizadoEm: cache.atualizadoEm,
    };
  }
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
