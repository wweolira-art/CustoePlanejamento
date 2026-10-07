import { db } from "../db.js";
import { diaUtcFromIso, parsePeriodoObrigatorio } from "./ords-common.js";

export type CaminhaoTerceiroRow = {
  id: number;
  caminhao: string;
  nomeTerceiro: string;
  dataInicio: string;
  dataFim: string;
};

export type EquipamentoTerceiroRow = {
  codEquipamento: string;
  createdAt: string;
};

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS colheita_caminhao_terceiro (
      id INTEGER PRIMARY KEY,
      caminhao TEXT NOT NULL,
      nome_terceiro TEXT NOT NULL,
      data_inicio TEXT NOT NULL,
      data_fim TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_colheita_caminhao_terceiro_caminhao
      ON colheita_caminhao_terceiro(caminhao);
    CREATE TABLE IF NOT EXISTS colheita_equipamento_terceiro (
      cod_equipamento TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function normalizeNomeTerceiro(value: string) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function cleanTerceiroLabel(nome: string) {
  return normalizeNomeTerceiro(nome).replace(/^equip\.?\s+(terceiro\s+)?/i, "").trim();
}

export function terceiroColumnKey(nome: string) {
  return `terc:${cleanTerceiroLabel(nome).toUpperCase()}`;
}

export function isTerceiroColumnKey(key: string) {
  return key.startsWith("terc:");
}

export function labelFromColumnKey(key: string) {
  if (isTerceiroColumnKey(key)) return key.slice(5);
  return key;
}

function rowFromDb(row: Record<string, unknown>): CaminhaoTerceiroRow {
  return {
    id: Number(row.id),
    caminhao: String(row.caminhao),
    nomeTerceiro: String(row.nome_terceiro),
    dataInicio: String(row.data_inicio),
    dataFim: String(row.data_fim),
  };
}

function periodsOverlap(aInicio: string, aFim: string, bInicio: string | null, bFim: string | null) {
  const ini = bInicio ?? "0000-01-01";
  const fim = bFim ?? "9999-12-31";
  return aInicio <= fim && aFim >= ini;
}

export function listarCaminhaoTerceiro(filtros: {
  caminhao?: string | null;
  dataInicio?: string | null;
  dataFim?: string | null;
} = {}) {
  ensureTable();
  const caminhao = filtros.caminhao?.trim() || null;
  const dataInicio = filtros.dataInicio?.trim() || null;
  const dataFim = filtros.dataFim?.trim() || null;

  let sql = `SELECT id, caminhao, nome_terceiro, data_inicio, data_fim FROM colheita_caminhao_terceiro WHERE 1=1`;
  const params: Record<string, string> = {};
  if (caminhao) {
    sql += ` AND caminhao = @caminhao`;
    params.caminhao = caminhao;
  }
  sql += ` ORDER BY nome_terceiro, data_inicio, caminhao`;

  const rows = db.prepare(sql).all(params) as Record<string, unknown>[];
  return rows
    .map(rowFromDb)
    .filter((row) => {
      if (!dataInicio && !dataFim) return true;
      return periodsOverlap(row.dataInicio, row.dataFim, dataInicio, dataFim);
    });
}

export function salvarCaminhaoTerceiro(params: {
  caminhao?: string | number | null;
  nomeTerceiro?: string | null;
  dataInicio?: string | null;
  dataFim?: string | null;
}) {
  ensureTable();
  const caminhao = params.caminhao != null && String(params.caminhao).trim() !== "" ? String(params.caminhao).trim() : null;
  if (!caminhao) {
    const err = new Error("Informe o número do caminhão.");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  const nomeTerceiro = normalizeNomeTerceiro(params.nomeTerceiro ?? "");
  if (!nomeTerceiro) {
    const err = new Error("Informe o nome do equipamento de terceiro.");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  const { dataInicio, dataFim } = parsePeriodoObrigatorio(params);

  const existing = db
    .prepare(
      `SELECT id FROM colheita_caminhao_terceiro
        WHERE caminhao = ? AND data_inicio = ? AND data_fim = ? AND nome_terceiro = ?`,
    )
    .get(caminhao, dataInicio, dataFim, nomeTerceiro) as { id: number } | undefined;

  if (existing) {
    return rowFromDb(
      db
        .prepare(`SELECT id, caminhao, nome_terceiro, data_inicio, data_fim FROM colheita_caminhao_terceiro WHERE id = ?`)
        .get(existing.id) as Record<string, unknown>,
    );
  }

  const result = db
    .prepare(
      `INSERT INTO colheita_caminhao_terceiro (caminhao, nome_terceiro, data_inicio, data_fim)
       VALUES (?, ?, ?, ?)`,
    )
    .run(caminhao, nomeTerceiro, dataInicio, dataFim);

  return rowFromDb(
    db
      .prepare(`SELECT id, caminhao, nome_terceiro, data_inicio, data_fim FROM colheita_caminhao_terceiro WHERE id = ?`)
      .get(Number(result.lastInsertRowid)) as Record<string, unknown>,
  );
}

export function removerCaminhaoTerceiro(id: number) {
  ensureTable();
  const prev = db
    .prepare(`SELECT id, caminhao, nome_terceiro, data_inicio, data_fim FROM colheita_caminhao_terceiro WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!prev) {
    const err = new Error("Vínculo de terceiro não encontrado.");
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
  db.prepare(`DELETE FROM colheita_caminhao_terceiro WHERE id = ?`).run(id);
  return rowFromDb(prev);
}

/** Mapa caminhao → lista de vínculos vigentes no recorte informado. */
export function buildMapaCaminhaoTerceiro(filtros: { dataInicio?: string | null; dataFim?: string | null } = {}) {
  const rows = listarCaminhaoTerceiro(filtros);
  const map = new Map<string, CaminhaoTerceiroRow[]>();
  for (const row of rows) {
    const list = map.get(row.caminhao) ?? [];
    list.push(row);
    map.set(row.caminhao, list);
  }
  return map;
}

/** Resolve nome do terceiro para um caminhão na data da entrada. */
export function resolveNomeTerceiro(
  mapa: Map<string, CaminhaoTerceiroRow[]>,
  caminhao: number | string | null | undefined,
  dataColheita: string | null | undefined,
): string | null {
  if (caminhao == null) return null;
  const dia = diaUtcFromIso(dataColheita ?? null);
  if (!dia) return null;
  const vinculos = mapa.get(String(caminhao)) ?? [];
  const matches = vinculos.filter((row) => dia >= row.dataInicio && dia <= row.dataFim);
  if (!matches.length) return null;
  matches.sort((a, b) => b.dataInicio.localeCompare(a.dataInicio));
  return matches[0].nomeTerceiro;
}

export function listarNomesTerceiroDistinct(filtros: { dataInicio?: string | null; dataFim?: string | null } = {}) {
  const rows = listarCaminhaoTerceiro(filtros);
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = terceiroColumnKey(row.nomeTerceiro);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => labelFromColumnKey(a[0]).localeCompare(labelFromColumnKey(b[0]), "pt-BR"))
    .map(([key, qtd]) => ({ key, label: labelFromColumnKey(key), qtd }));
}

function normalizeCodEquipamento(value: string | number | null | undefined) {
  return value != null && String(value).trim() !== "" ? String(value).trim() : null;
}

function equipamentoTerceiroFromDb(row: Record<string, unknown>): EquipamentoTerceiroRow {
  return {
    codEquipamento: String(row.cod_equipamento),
    createdAt: String(row.created_at),
  };
}

export function listarEquipamentosTerceiro(filtros: { busca?: string | null } = {}) {
  ensureTable();
  const busca = filtros.busca?.trim().toLowerCase() || null;
  const rows = db
    .prepare(`SELECT cod_equipamento, created_at FROM colheita_equipamento_terceiro ORDER BY CAST(cod_equipamento AS INTEGER), cod_equipamento`)
    .all() as Record<string, unknown>[];
  return rows.map(equipamentoTerceiroFromDb).filter((row) => !busca || row.codEquipamento.toLowerCase().includes(busca));
}

export function salvarEquipamentoTerceiro(params: { codEquipamento?: string | number | null }) {
  ensureTable();
  const codEquipamento = normalizeCodEquipamento(params.codEquipamento);
  if (!codEquipamento) {
    const err = new Error("Informe o cod_equipamento.");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  db.prepare(`INSERT OR IGNORE INTO colheita_equipamento_terceiro (cod_equipamento) VALUES (?)`).run(codEquipamento);
  return equipamentoTerceiroFromDb(
    db
      .prepare(`SELECT cod_equipamento, created_at FROM colheita_equipamento_terceiro WHERE cod_equipamento = ?`)
      .get(codEquipamento) as Record<string, unknown>,
  );
}

export function removerEquipamentoTerceiro(codEquipamento: string | number | null | undefined) {
  ensureTable();
  const cod = normalizeCodEquipamento(codEquipamento);
  if (!cod) {
    const err = new Error("Informe o cod_equipamento.");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  const prev = db
    .prepare(`SELECT cod_equipamento, created_at FROM colheita_equipamento_terceiro WHERE cod_equipamento = ?`)
    .get(cod) as Record<string, unknown> | undefined;
  if (!prev) {
    const err = new Error("Equipamento de terceiro não encontrado.");
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
  db.prepare(`DELETE FROM colheita_equipamento_terceiro WHERE cod_equipamento = ?`).run(cod);
  return equipamentoTerceiroFromDb(prev);
}

export function buildEquipamentoTerceiroSet() {
  return new Set(listarEquipamentosTerceiro().map((row) => row.codEquipamento));
}

export function listarEquipamentosTerceiroDistinct() {
  return listarEquipamentosTerceiro().map((row) => ({
    key: terceiroColumnKey(row.codEquipamento),
    label: row.codEquipamento,
    qtd: 1,
  }));
}
