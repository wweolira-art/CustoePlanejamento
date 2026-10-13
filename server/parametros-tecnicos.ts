import { db } from "./db.js";
import { listHarvestAreas } from "./harvest-areas.js";
import { resolveSafraId } from "./safras.js";
import { fetchMatrizRhaHectares } from "./un-realizado.js";

export type ParametrosTecnicos = {
  safraId: number;
  areaPlantio: number;
  areaSoca: number;
  areaIrrigacao: number;
  areaArrendada: number;
  moagemLj: number;
  tonelagemManual: number;
  atr: number;
  produtividade: number;
  precoAtrConsecana: number;
  anomesInicio: string | null;
  anomesFim: string | null;
  updatedAt: string | null;
  armazenado: boolean;
};

function ensureParametrosTecnicos() {
  const cols = db.prepare("PRAGMA table_info(parametros_tecnicos)").all() as { name: string; pk: number }[];
  const porSafraApenas = cols.some((col) => col.name === "safra_id" && col.pk > 0) && !cols.some((col) => col.name === "anomes_inicio" && col.pk > 0);
  if (porSafraApenas) {
    db.exec(`
      CREATE TABLE parametros_tecnicos_v2 (
        safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
        anomes_inicio TEXT NOT NULL,
        anomes_fim TEXT NOT NULL,
        area_plantio REAL NOT NULL,
        area_soca REAL NOT NULL,
        area_irrigacao REAL NOT NULL,
        area_arrendada REAL NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (safra_id, anomes_inicio, anomes_fim)
      );
      INSERT INTO parametros_tecnicos_v2 (
        safra_id, anomes_inicio, anomes_fim, area_plantio, area_soca, area_irrigacao, area_arrendada, updated_at
      )
      SELECT safra_id, anomes_inicio, anomes_fim, area_plantio, area_soca, area_irrigacao, area_arrendada, updated_at
        FROM parametros_tecnicos
       WHERE anomes_inicio IS NOT NULL
         AND anomes_fim IS NOT NULL;
      DROP TABLE parametros_tecnicos;
      ALTER TABLE parametros_tecnicos_v2 RENAME TO parametros_tecnicos;
    `);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS parametros_tecnicos (
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      anomes_inicio TEXT NOT NULL,
      anomes_fim TEXT NOT NULL,
      area_plantio REAL NOT NULL,
      area_soca REAL NOT NULL,
      area_irrigacao REAL NOT NULL,
      area_arrendada REAL NOT NULL,
      updated_at TEXT NOT NULL,
        PRIMARY KEY (safra_id, anomes_inicio, anomes_fim)
    );
  `);
  const atuais = db.prepare("PRAGMA table_info(parametros_tecnicos)").all() as { name: string }[];
  if (!atuais.some((col) => col.name === "moagem_lj")) {
    db.exec("ALTER TABLE parametros_tecnicos ADD COLUMN moagem_lj REAL NOT NULL DEFAULT 0");
  }
  if (!atuais.some((col) => col.name === "tonelagem_manual")) {
    db.exec("ALTER TABLE parametros_tecnicos ADD COLUMN tonelagem_manual REAL NOT NULL DEFAULT 0");
  }
  if (!atuais.some((col) => col.name === "atr")) {
    db.exec("ALTER TABLE parametros_tecnicos ADD COLUMN atr REAL NOT NULL DEFAULT 0");
  }
  if (!atuais.some((col) => col.name === "produtividade")) {
    db.exec("ALTER TABLE parametros_tecnicos ADD COLUMN produtividade REAL NOT NULL DEFAULT 0");
  }
  if (!atuais.some((col) => col.name === "preco_atr_consecana")) {
    db.exec("ALTER TABLE parametros_tecnicos ADD COLUMN preco_atr_consecana REAL NOT NULL DEFAULT 0");
  }
}

function asArea(raw: unknown, label: string) {
  const value = typeof raw === "string" ? Number(String(raw).trim().replace(",", ".")) : Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Informe a ${label} com um número válido.`);
  return value;
}

function anomesOk(raw: unknown) {
  const value = String(raw ?? "").trim();
  if (!/^\d{6}$/.test(value)) throw new Error("Informe o anomes inicial e final no formato YYYYMM.");
  return value;
}

function vazio(safraId: number, anomesInicio: string | null, anomesFim: string | null): ParametrosTecnicos {
  return {
    safraId,
    areaPlantio: 0,
    areaSoca: 0,
    areaIrrigacao: 0,
    areaArrendada: 0,
    moagemLj: 0,
    tonelagemManual: 0,
    atr: 0,
    produtividade: 0,
    precoAtrConsecana: 0,
    anomesInicio,
    anomesFim,
    updatedAt: null,
    armazenado: false,
  };
}

function areaArrendadaDaSafra(safraId: number) {
  const areas = listHarvestAreas(safraId).areas;
  const marcadas = areas.filter((row) => /arrend/i.test(row.description));
  const usadas = marcadas.length ? marcadas : areas;
  return usadas.reduce((sum, row) => sum + (Number(row.area) || 0), 0);
}

export function lerParametrosTecnicos(
  safraId?: number | null,
  anomesInicio?: unknown,
  anomesFim?: unknown,
): ParametrosTecnicos {
  ensureParametrosTecnicos();
  const id = resolveSafraId(safraId);
  const inicio = anomesOk(anomesInicio);
  const fim = anomesOk(anomesFim);
  const row = db
    .prepare(
      `SELECT safra_id, area_plantio, area_soca, area_irrigacao, area_arrendada, moagem_lj, tonelagem_manual,
              atr, produtividade, preco_atr_consecana,
              anomes_inicio, anomes_fim, updated_at
         FROM parametros_tecnicos
        WHERE safra_id = ?
          AND anomes_inicio = ?
          AND anomes_fim = ?`,
    )
    .get(id, inicio, fim) as
    | {
        safra_id: number;
        area_plantio: number;
        area_soca: number;
        area_irrigacao: number;
        area_arrendada: number;
        moagem_lj: number;
        tonelagem_manual: number;
        atr: number;
        produtividade: number;
        preco_atr_consecana: number;
        anomes_inicio: string | null;
        anomes_fim: string | null;
        updated_at: string;
      }
    | undefined;
  if (!row) return vazio(id, inicio, fim);
  return {
    safraId: row.safra_id,
    areaPlantio: Number(row.area_plantio) || 0,
    areaSoca: Number(row.area_soca) || 0,
    areaIrrigacao: Number(row.area_irrigacao) || 0,
    areaArrendada: Number(row.area_arrendada) || 0,
    moagemLj: Number(row.moagem_lj) || 0,
    tonelagemManual: Number(row.tonelagem_manual) || 0,
    atr: Number(row.atr) || 0,
    produtividade: Number(row.produtividade) || 0,
    precoAtrConsecana: Number(row.preco_atr_consecana) || 0,
    anomesInicio: row.anomes_inicio,
    anomesFim: row.anomes_fim,
    updatedAt: row.updated_at,
    armazenado: true,
  };
}

export async function extrairParametrosTecnicos(
  safraId: number | null | undefined,
  anomesInicio: unknown,
  anomesFim: unknown,
): Promise<ParametrosTecnicos> {
  const id = resolveSafraId(safraId);
  const inicio = anomesOk(anomesInicio);
  const fim = anomesOk(anomesFim);
  const ha = await fetchMatrizRhaHectares(inicio, fim, undefined, true);
  const guardado = lerParametrosTecnicos(id, inicio, fim);
  return {
    safraId: id,
    areaPlantio: ha.planta || 0,
    areaSoca: ha.soca || 0,
    areaIrrigacao: ha.irrigacao || 0,
    areaArrendada: areaArrendadaDaSafra(id),
    moagemLj: guardado.moagemLj,
    tonelagemManual: guardado.tonelagemManual,
    atr: guardado.atr,
    produtividade: guardado.produtividade,
    precoAtrConsecana: guardado.precoAtrConsecana,
    anomesInicio: inicio,
    anomesFim: fim,
    updatedAt: null,
    armazenado: false,
  };
}

export function salvarParametrosTecnicos(
  safraId: number | null | undefined,
  body: {
    areaPlantio?: unknown;
    areaSoca?: unknown;
    areaIrrigacao?: unknown;
    areaArrendada?: unknown;
    moagemLj?: unknown;
    tonelagemManual?: unknown;
    atr?: unknown;
    produtividade?: unknown;
    precoAtrConsecana?: unknown;
    anomesInicio?: unknown;
    anomesFim?: unknown;
  },
): ParametrosTecnicos {
  ensureParametrosTecnicos();
  const id = resolveSafraId(safraId);
  const areaPlantio = asArea(body.areaPlantio, "área de plantio");
  const areaSoca = asArea(body.areaSoca, "área de soqueira");
  const areaIrrigacao = asArea(body.areaIrrigacao, "área de irrigação");
  const areaArrendada = asArea(body.areaArrendada, "área arrendada");
  const moagemLj = asArea(body.moagemLj, "moagem LJ");
  const tonelagemManual = asArea(body.tonelagemManual, "tonelagem manual");
  const atr = asArea(body.atr, "ATR");
  const produtividade = asArea(body.produtividade, "produtividade");
  const precoAtrConsecana = asArea(body.precoAtrConsecana, "preço do ATR Consecana");
  const anomesInicio = anomesOk(body.anomesInicio);
  const anomesFim = anomesOk(body.anomesFim);
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO parametros_tecnicos (
       safra_id, anomes_inicio, anomes_fim, area_plantio, area_soca, area_irrigacao, area_arrendada, moagem_lj, tonelagem_manual, atr, produtividade, preco_atr_consecana, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(safra_id, anomes_inicio, anomes_fim) DO UPDATE SET
       area_plantio = excluded.area_plantio,
       area_soca = excluded.area_soca,
       area_irrigacao = excluded.area_irrigacao,
       area_arrendada = excluded.area_arrendada,
       moagem_lj = excluded.moagem_lj,
       tonelagem_manual = excluded.tonelagem_manual,
       atr = excluded.atr,
       produtividade = excluded.produtividade,
       preco_atr_consecana = excluded.preco_atr_consecana,
       updated_at = excluded.updated_at`,
  ).run(id, anomesInicio, anomesFim, areaPlantio, areaSoca, areaIrrigacao, areaArrendada, moagemLj, tonelagemManual, atr, produtividade, precoAtrConsecana, updatedAt);
  return lerParametrosTecnicos(id, anomesInicio, anomesFim);
}
