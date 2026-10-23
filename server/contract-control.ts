import type { Express, Request, Response } from "express";
import { db } from "./db.js";
import { oracleNumber, oracleText, withOracle } from "./oracle.js";

const COMPANY = { grupo: 1 };

function requestSignal(req: Request, res: Response) {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

function endIfOpen(res: Response) {
  if (res.writableEnded) return;
  try {
    res.status(499).end();
  } catch {
    /* o navegador já encerrou a conexão */
  }
}

function cancelledQuery(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /ORA-01013|Consulta cancelada/i.test(message);
}

export type ContractControlRow = {
  prestador: string;
  razaoSocial: string;
  fornecedorCodigo: number | null;
  valorTotal: number;
  adiantamento: number;
  combustivel: number;
  valorPago: number;
  valorDevedor: number;
};

export type ContractSupplierGroup = {
  id: number;
  nome: string;
  fornecedores: ContractControlOption[];
};

export type ContractFuelBaixa = {
  id: number;
  data: string;
  valor: number;
};

export type ContractFuelRow = {
  id: number;
  numeroNf: string;
  fornecedor: string;
  mesCompetencia: string;
  valorNf: number;
  valorBaixado: number;
  restante: number;
  baixas: ContractFuelBaixa[];
};

export type ContractFuelReport = {
  rows: ContractFuelRow[];
  totals: Omit<ContractFuelRow, "id" | "numeroNf" | "fornecedor" | "mesCompetencia" | "baixas">;
};

export type ContractControlOption = { codigo: number; descricao: string };

export type ContractControlReport = {
  from: string;
  to: string;
  rows: ContractControlRow[];
  totals: Omit<ContractControlRow, "prestador" | "razaoSocial" | "fornecedorCodigo">;
};

export type ContractOccurrenceRow = {
  fornecedorCodigo: number | null;
  fornecedor: string;
  documento: string;
  parcela: number;
  sequencia: number | null;
  ocorrencia: string;
  observacao: string;
  data: string;
  valor: number;
};

export type ContractOccurrenceReport = {
  from: string;
  to: string;
  rows: ContractOccurrenceRow[];
  total: number;
};

type RawOccurrenceRow = Omit<ContractOccurrenceRow, "fornecedor">;

function parseIds(value: unknown) {
  const raw = Array.isArray(value) ? value.join(",") : String(value ?? "");
  const ids = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
  return [...new Set(ids)];
}

function parseDate(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function rowOf(record: Record<string, unknown>): ContractControlRow {
  return {
    prestador: oracleText(record, "prestador", "PRESTADOR"),
    razaoSocial: oracleText(record, "razaosocial", "RAZAOSOCIAL"),
    fornecedorCodigo: oracleNumber(record, "cod_fornecedor", "COD_FORNECEDOR"),
    valorTotal: money(oracleNumber(record, "valor_total", "VALOR_TOTAL") ?? 0),
    adiantamento: money(oracleNumber(record, "adiantamento", "ADIANTAMENTO") ?? 0),
    combustivel: money(oracleNumber(record, "combustivel", "COMBUSTIVEL") ?? 0),
    valorPago: money(oracleNumber(record, "valor_pago", "VALOR_PAGO") ?? 0),
    valorDevedor: money(oracleNumber(record, "valor_devedor", "VALOR_DEVEDOR") ?? 0),
  };
}

function totalsOf(rows: ContractControlRow[]) {
  return rows.reduce(
    (acc, row) => ({
      valorTotal: money(acc.valorTotal + row.valorTotal),
      adiantamento: money(acc.adiantamento + row.adiantamento),
      combustivel: money(acc.combustivel + row.combustivel),
      valorPago: money(acc.valorPago + row.valorPago),
      valorDevedor: money(acc.valorDevedor + row.valorDevedor),
    }),
    { valorTotal: 0, adiantamento: 0, combustivel: 0, valorPago: 0, valorDevedor: 0 },
  );
}

let supplierNamesCache: { at: number; names: Map<number, string> } | null = null;
let supplierNamesTask: Promise<Map<number, string>> | null = null;

function supplierNames() {
  if (supplierNamesCache && Date.now() - supplierNamesCache.at < 10 * 60 * 1000) {
    return Promise.resolve(supplierNamesCache.names);
  }
  if (!supplierNamesTask) {
    supplierNamesTask = withOracle(async (conn) => {
      const result = await conn.execute(
        `SELECT cod_fornecedor codigo, MAX(razaosocial) descricao
           FROM material.vw_parceironegocio
          GROUP BY cod_fornecedor`,
        {},
        { maxRows: 20000, fetchArraySize: 2000 },
      );
      const names = new Map<number, string>();
      for (const row of result.rows ?? []) {
        const codigo = oracleNumber(row as Record<string, unknown>, "codigo", "CODIGO");
        if (codigo == null) continue;
        names.set(codigo, oracleText(row as Record<string, unknown>, "descricao", "DESCRICAO") || String(codigo));
      }
      supplierNamesCache = { at: Date.now(), names };
      return names;
    }).finally(() => {
      supplierNamesTask = null;
    });
  }
  return supplierNamesTask;
}

function inClause(column: string, ids: number[], prefix: string, binds: Record<string, number>) {
  if (!ids.length) return "";
  const groups: string[] = [];
  for (let start = 0; start < ids.length; start += 500) {
    const names = ids.slice(start, start + 500).map((id, index) => {
      const name = `${prefix}${start + index}`;
      binds[name] = id;
      return `:${name}`;
    });
    groups.push(`${column} IN (${names.join(", ")})`);
  }
  return ` AND (${groups.join(" OR ")})`;
}

export async function loadContractControl(input: {
  from?: unknown;
  to?: unknown;
  fornecedores?: unknown;
  empenhos?: unknown;
  signal?: AbortSignal;
}): Promise<ContractControlReport> {
  const from = parseDate(input.from, "2026-01-01");
  const to = parseDate(input.to, "2026-08-31");
  const fornecedores = parseIds(input.fornecedores);
  const empenhos = parseIds(input.empenhos);
  const binds: Record<string, string | number> = {
    grupo: COMPANY.grupo,
    ini: from,
    fim: to,
  };
  const fornecedorSql = inClause("p.cod_fornecedor", fornecedores, "forn", binds);
  const empenhoSql = inClause("p.cod_empenho", empenhos, "emp", binds);

  const [rawRows, names] = await Promise.all([
    withOracle(async (conn) => {
    const result = await conn.execute(
      `WITH fuel AS (
         SELECT /*+ MATERIALIZE */ cod_ocorrenciacontaspagar
           FROM financeiro.ocorrenciacontaspagar
          GROUP BY cod_ocorrenciacontaspagar
         HAVING MAX(CASE WHEN UPPER(descricao) LIKE '%COMBUST%' THEN 1 ELSE 0 END) = 1
       ),
       base AS (
         SELECT /*+ MATERIALIZE */
                p.cod_grupoempresa,
                p.cod_tipocontaspagar,
                p.documento,
                p.parcela,
                p.cod_fornecedor,
                NVL(p.valorparcela, 0) valorparcela,
                NVL(p.valorpago, 0) valorpago,
                p.parcelabaixada,
                CASE WHEN t.adiantamento = 'S' THEN NVL(p.valorparcela, 0) ELSE 0 END adiantamento,
                CASE WHEN REGEXP_LIKE(e.descricao, 'transporte de semente', 'i') THEN 1 ELSE 0 END semente,
                CASE WHEN UPPER(t.descricao) LIKE '%AGUARD%COMPENS%' THEN 1 ELSE 0 END aguardando_compensar
           FROM financeiro.parcelascontaspagar p
           JOIN financeiro.tipocontaspagar t
             ON t.cod_tipocontaspagar = p.cod_tipocontaspagar
            AND t.cod_grupoempresa = p.cod_grupoempresa
            AND t.cod_empresa = p.cod_empresa
            AND t.cod_filial = p.cod_filial
           LEFT JOIN (
             SELECT cod_empenho, MAX(descricao) descricao
               FROM custo.empenho
              GROUP BY cod_empenho
           ) e ON e.cod_empenho = p.cod_empenho
          WHERE p.cod_grupoempresa = :grupo
            AND p.dataentrada >= TO_DATE(:ini, 'YYYY-MM-DD')
            AND p.dataentrada < TO_DATE(:fim, 'YYYY-MM-DD') + 1
            ${fornecedorSql}
            ${empenhoSql}
       ),
       ocorr AS (
         SELECT o.cod_grupoempresa,
                o.cod_tipocontaspagar,
                o.documento,
                o.parcela,
                SUM(NVL(o.valorfinalpgto, NVL(o.valor, 0))) total_ocorr,
                SUM(CASE WHEN fuel.cod_ocorrenciacontaspagar IS NOT NULL THEN NVL(o.valor, 0) ELSE 0 END) combustivel
           FROM financeiro.ocorrenciaparcelascontaspagar o
           LEFT JOIN fuel ON fuel.cod_ocorrenciacontaspagar = o.cod_ocorrenciacontaspagar
          WHERE (o.cod_grupoempresa, o.cod_tipocontaspagar, o.documento, o.parcela) IN (
            SELECT cod_grupoempresa, cod_tipocontaspagar, documento, parcela FROM base
          )
          GROUP BY o.cod_grupoempresa, o.cod_tipocontaspagar, o.documento, o.parcela
       ),
       rateio AS (
         SELECT i.numerocontrato,
                i.parcela,
                -SUM(NVL(i.valor_rateio, 0)) combustivel
           FROM financeiro.itemcontratovariavel i
          WHERE i.cod_grupoempresa = :grupo
            AND NVL(i.valor_rateio, 0) <> 0
            AND (i.numerocontrato, i.parcela) IN (SELECT documento, parcela FROM base)
          GROUP BY i.numerocontrato, i.parcela
       ),
       aberto AS (
         SELECT bx.cod_grupoempresa,
                bx.cod_tipocontaspagar,
                bx.documento,
                bx.parcela,
                COUNT(*) qtd,
                SUM(NVL(bx.valor, 0)) valor_lancado,
                SUM(CASE WHEN NVL(bx.valor_banco_indice, 0) = 0 THEN NVL(bx.valorbaixa, 0) ELSE 0 END) valor_devedor
           FROM financeiro.baixaparcelas bx
          WHERE (bx.cod_grupoempresa, bx.cod_tipocontaspagar, bx.documento, bx.parcela) IN (
            SELECT cod_grupoempresa, cod_tipocontaspagar, documento, parcela
              FROM base
             WHERE NVL(parcelabaixada, 'N') <> 'S'
               AND aguardando_compensar = 0
          )
          GROUP BY bx.cod_grupoempresa, bx.cod_tipocontaspagar, bx.documento, bx.parcela
       ),
       agg AS (
         SELECT /*+ MATERIALIZE */
                b.cod_fornecedor,
                b.semente,
                SUM(b.valorparcela) valor_total,
                SUM(b.adiantamento) adiantamento,
                SUM(NVL(o.combustivel, 0) + NVL(rt.combustivel, 0)) combustivel,
                SUM(b.valorpago + NVL(o.total_ocorr, 0) - NVL(o.combustivel, 0)) valor_pago,
                SUM(
                CASE
                  WHEN b.parcelabaixada = 'S' OR b.aguardando_compensar = 1 THEN 0
                  WHEN NVL(ab.valor_devedor, 0) <> 0 THEN NVL(ab.valor_devedor, 0)
                  WHEN NVL(ab.qtd, 0) > 0
                       AND ABS(NVL(ab.valor_lancado, 0) - NVL(o.total_ocorr, 0)) >= 0.01
                    THEN 0
                  ELSE b.valorparcela - (b.valorpago + NVL(o.total_ocorr, 0))
                END
                ) valor_devedor
           FROM base b
           LEFT JOIN ocorr o
             ON o.cod_grupoempresa = b.cod_grupoempresa
            AND o.cod_tipocontaspagar = b.cod_tipocontaspagar
            AND o.documento = b.documento
            AND o.parcela = b.parcela
           LEFT JOIN rateio rt
             ON rt.numerocontrato = b.documento
            AND rt.parcela = b.parcela
           LEFT JOIN aberto ab
             ON ab.cod_grupoempresa = b.cod_grupoempresa
            AND ab.cod_tipocontaspagar = b.cod_tipocontaspagar
            AND ab.documento = b.documento
            AND ab.parcela = b.parcela
          GROUP BY b.cod_fornecedor, b.semente
       )
       SELECT a.cod_fornecedor,
              a.semente,
              a.valor_total,
              a.adiantamento,
              a.combustivel,
              a.valor_pago,
              a.valor_devedor
         FROM agg a`,
      binds,
      { maxRows: 8000, fetchArraySize: 2000 },
    );
    return result.rows ?? [];
    }, input.signal),
    supplierNames(),
  ]);
  const rows = rawRows
    .map((row) => {
      const record = row as Record<string, unknown>;
      const codigo = oracleNumber(record, "cod_fornecedor", "COD_FORNECEDOR");
      const razao = codigo == null ? "SEM FORNECEDOR" : (names.get(codigo) ?? "SEM FORNECEDOR");
      const semente = oracleNumber(record, "semente", "SEMENTE") === 1;
      return rowOf({
        ...record,
        prestador: semente ? "TRANSPORTE DE CANA SEMENTE" : razao,
        razaosocial: razao,
      });
    })
    .sort(
      (a, b) =>
        a.prestador.localeCompare(b.prestador, "pt-BR") || a.razaoSocial.localeCompare(b.razaoSocial, "pt-BR"),
    );

  return { from, to, rows, totals: totalsOf(rows) };
}

function occurrenceOf(record: Record<string, unknown>): RawOccurrenceRow {
  const documento = oracleNumber(record, "documento", "DOCUMENTO");
  return {
    fornecedorCodigo: oracleNumber(record, "cod_fornecedor", "COD_FORNECEDOR"),
    documento: documento == null ? oracleText(record, "documento", "DOCUMENTO") : String(documento),
    parcela: oracleNumber(record, "parcela", "PARCELA") ?? 0,
    sequencia: oracleNumber(record, "sequencia", "SEQUENCIA"),
    ocorrencia: oracleText(record, "ocorrencia", "OCORRENCIA") || "—",
    observacao: oracleText(record, "observacao", "OBSERVACAO").trim(),
    data: oracleText(record, "data_ocorrencia", "DATA_OCORRENCIA"),
    valor: money(oracleNumber(record, "valor", "VALOR") ?? 0),
  };
}

export async function loadContractOccurrences(input: {
  from?: unknown;
  to?: unknown;
  fornecedores?: unknown;
  signal?: AbortSignal;
}): Promise<ContractOccurrenceReport> {
  const from = parseDate(input.from, "2026-01-01");
  const to = parseDate(input.to, "2026-08-31");
  const fornecedores = parseIds(input.fornecedores);
  const binds: Record<string, string | number> = {
    grupo: COMPANY.grupo,
    ini: from,
    fim: to,
  };
  const fornecedorSql = inClause("p.cod_fornecedor", fornecedores, "forn", binds);

  const [rawRows, names] = await Promise.all([
    withOracle(async (conn) => {
      const result = await conn.execute(
        `SELECT p.cod_fornecedor,
                p.documento,
                p.parcela,
                o.sequenciabaixa sequencia,
                NVL(c.descricao, 'SEM OCORRÊNCIA') ocorrencia,
                o.observacao,
                TO_CHAR(o.datacriacao, 'YYYY-MM-DD') data_ocorrencia,
                NVL(o.valorfinalpgto, NVL(o.valor, 0)) valor
           FROM financeiro.ocorrenciaparcelascontaspagar o
           JOIN financeiro.parcelascontaspagar p
             ON p.cod_grupoempresa = o.cod_grupoempresa
            AND p.cod_tipocontaspagar = o.cod_tipocontaspagar
            AND p.documento = o.documento
            AND p.parcela = o.parcela
           LEFT JOIN financeiro.ocorrenciacontaspagar c
             ON c.cod_ocorrenciacontaspagar = o.cod_ocorrenciacontaspagar
          WHERE o.cod_grupoempresa = :grupo
            AND o.datacriacao >= TO_DATE(:ini, 'YYYY-MM-DD')
            AND o.datacriacao < TO_DATE(:fim, 'YYYY-MM-DD') + 1
            ${fornecedorSql}
          `,
        binds,
        { maxRows: 20000, fetchArraySize: 2000, callTimeout: 300_000 },
      );
      return (result.rows ?? []).map((row) => occurrenceOf(row as Record<string, unknown>));
    }, input.signal),
    supplierNames(),
  ]);

  const rows = rawRows
    .map((row) => ({
      ...row,
      fornecedor: row.fornecedorCodigo == null ? "SEM FORNECEDOR" : (names.get(row.fornecedorCodigo) ?? "SEM FORNECEDOR"),
    }))
    .sort(
      (a, b) =>
        a.fornecedor.localeCompare(b.fornecedor, "pt-BR") ||
        a.data.localeCompare(b.data) ||
        a.documento.localeCompare(b.documento, "pt-BR", { numeric: true }) ||
        a.parcela - b.parcela ||
        a.ocorrencia.localeCompare(b.ocorrencia, "pt-BR"),
    );

  return {
    from,
    to,
    rows,
    total: money(rows.reduce((sum, row) => sum + row.valor, 0)),
  };
}

function ensureFuelNotes() {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'contract_fuel_notes'").get();
  if (!exists) {
    db.exec(`
      CREATE TABLE contract_fuel_notes (
        id INTEGER PRIMARY KEY,
        numero_nf TEXT NOT NULL,
        fornecedor TEXT NOT NULL,
        mes_competencia TEXT,
        valor_nf REAL NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS contract_fuel_notes_numero_nf_uidx
      ON contract_fuel_notes(numero_nf);
    CREATE TABLE IF NOT EXISTS contract_fuel_baixas (
      id INTEGER PRIMARY KEY,
      note_id INTEGER NOT NULL REFERENCES contract_fuel_notes(id) ON DELETE CASCADE,
      data_baixa TEXT NOT NULL,
      valor REAL NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const cols = db.prepare("PRAGMA table_info(contract_fuel_notes)").all() as { name: string }[];
  if (!cols.some((col) => col.name === "mes_competencia")) {
    db.exec("ALTER TABLE contract_fuel_notes ADD COLUMN mes_competencia TEXT");
  }
  if (!cols.some((col) => col.name === "valor_baixado")) return;
  const pending = db
    .prepare("SELECT id, valor_baixado, created_at FROM contract_fuel_notes WHERE valor_baixado > 0")
    .all() as { id: number; valor_baixado: number; created_at: string }[];
  const insert = db.prepare(
    `INSERT INTO contract_fuel_baixas (note_id, data_baixa, valor, created_at) VALUES (?, ?, ?, ?)`,
  );
  const already = db.prepare("SELECT COUNT(*) AS n FROM contract_fuel_baixas WHERE note_id = ?");
  const move = db.transaction(() => {
    for (const row of pending) {
      const count = already.get(row.id) as { n: number };
      if (count.n > 0) continue;
      const day = String(row.created_at ?? "").slice(0, 10);
      insert.run(row.id, /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "2026-01-01", row.valor_baixado, row.created_at);
    }
  });
  move();
  db.exec("ALTER TABLE contract_fuel_notes DROP COLUMN valor_baixado");
}

function fuelDate(raw: unknown) {
  const value = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Informe a data da baixa.");
  return value;
}

function fuelCompetence(raw: unknown) {
  const value = String(raw ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error("Informe o mês de competência da NF.");
  return value;
}

function fuelNfKey(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits || value.trim().toLowerCase();
}

function fuelNfDuplicated(numeroNf: string, ignoreId?: number) {
  const key = fuelNfKey(numeroNf);
  const rows = db.prepare("SELECT id, numero_nf FROM contract_fuel_notes").all() as { id: number; numero_nf: string }[];
  return rows.some((row) => row.id !== ignoreId && fuelNfKey(row.numero_nf) === key);
}

function rejectDuplicatedFuelNf(error: unknown): never {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code.includes("SQLITE_CONSTRAINT")) {
    throw new Error("Esta NF já está lançada. Inclua outra baixa nela.");
  }
  throw error;
}

function fuelAmount(raw: unknown, label: string) {
  const text = String(raw ?? "").trim().replace(/\s/g, "");
  if (!text) throw new Error(`Informe o ${label} com um número válido.`);
  const normal = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const value = Number(normal);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Informe o ${label} com um número válido.`);
  return money(value);
}

function baixasDaNota(noteId: number): ContractFuelBaixa[] {
  const rows = db
    .prepare(
      `SELECT id, data_baixa, valor
         FROM contract_fuel_baixas
        WHERE note_id = ?
        ORDER BY data_baixa, id`,
    )
    .all(noteId) as { id: number; data_baixa: string; valor: number }[];
  return rows.map((row) => ({ id: row.id, data: row.data_baixa, valor: money(Number(row.valor) || 0) }));
}

function restanteDaNota(noteId: number, valorNf: number) {
  const baixado = baixasDaNota(noteId).reduce((sum, baixa) => sum + baixa.valor, 0);
  return { valorBaixado: money(baixado), restante: money(valorNf - baixado) };
}

export function listContractFuelNotes(): ContractFuelReport {
  ensureFuelNotes();
  const stored = db
    .prepare(
      `SELECT id, numero_nf, fornecedor, mes_competencia, valor_nf
         FROM contract_fuel_notes
        ORDER BY fornecedor, numero_nf, id`,
    )
    .all() as {
      id: number;
      numero_nf: string;
      fornecedor: string;
      mes_competencia: string | null;
      valor_nf: number;
    }[];
  const rows = stored.map((row) => {
    const valorNf = money(Number(row.valor_nf) || 0);
    const baixas = baixasDaNota(row.id);
    const valorBaixado = money(baixas.reduce((sum, baixa) => sum + baixa.valor, 0));
    return {
      id: row.id,
      numeroNf: row.numero_nf,
      fornecedor: row.fornecedor,
      mesCompetencia: row.mes_competencia ?? "",
      valorNf,
      valorBaixado,
      restante: money(valorNf - valorBaixado),
      baixas,
    };
  });
  const totals = rows.reduce(
    (acc, row) => ({
      valorNf: money(acc.valorNf + row.valorNf),
      valorBaixado: money(acc.valorBaixado + row.valorBaixado),
      restante: money(acc.restante + row.restante),
    }),
    { valorNf: 0, valorBaixado: 0, restante: 0 },
  );
  return { rows, totals };
}

export function addContractFuelNote(body: {
  numeroNf?: unknown;
  fornecedor?: unknown;
  mesCompetencia?: unknown;
  valorNf?: unknown;
}): ContractFuelReport {
  ensureFuelNotes();
  const numeroNf = String(body.numeroNf ?? "").trim();
  const fornecedor = String(body.fornecedor ?? "").trim();
  if (!numeroNf) throw new Error("Informe o número da NF.");
  if (!fornecedor) throw new Error("Informe o fornecedor.");
  const mesCompetencia = fuelCompetence(body.mesCompetencia);
  const valorNf = fuelAmount(body.valorNf, "valor da NF");
  if (!(valorNf > 0)) throw new Error("Informe o valor da NF.");
  if (fuelNfDuplicated(numeroNf)) throw new Error("Esta NF já está lançada. Inclua outra baixa nela.");
  const now = new Date().toISOString();
  const save = db.transaction(() => {
    db.prepare(
      `INSERT INTO contract_fuel_notes (numero_nf, fornecedor, mes_competencia, valor_nf, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(numeroNf, fornecedor, mesCompetencia, valorNf, now);
  });
  try {
    save();
  } catch (error) {
    rejectDuplicatedFuelNf(error);
  }
  return listContractFuelNotes();
}

export function updateContractFuelNote(
  id: number,
  body: { numeroNf?: unknown; fornecedor?: unknown; mesCompetencia?: unknown },
): ContractFuelReport {
  ensureFuelNotes();
  if (!Number.isInteger(id) || id <= 0) throw new Error("Nota de combustível inválida.");
  const note = db.prepare("SELECT id FROM contract_fuel_notes WHERE id = ?").get(id);
  if (!note) throw new Error("Nota de combustível não encontrada.");
  const sets: string[] = [];
  const params: Array<string | number> = [];
  if (body.numeroNf !== undefined) {
    const numeroNf = String(body.numeroNf ?? "").trim();
    if (!numeroNf) throw new Error("Informe o número da NF.");
    if (fuelNfDuplicated(numeroNf, id)) throw new Error("Esta NF já está lançada. Inclua outra baixa nela.");
    sets.push("numero_nf = ?");
    params.push(numeroNf);
  }
  if (body.fornecedor !== undefined) {
    const fornecedor = String(body.fornecedor ?? "").trim();
    if (!fornecedor) throw new Error("Informe o fornecedor.");
    sets.push("fornecedor = ?");
    params.push(fornecedor);
  }
  if (body.mesCompetencia !== undefined) {
    sets.push("mes_competencia = ?");
    params.push(fuelCompetence(body.mesCompetencia));
  }
  if (!sets.length) throw new Error("Informe o que deseja alterar na NF.");
  params.push(id);
  db.prepare(`UPDATE contract_fuel_notes SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return listContractFuelNotes();
}

export function addContractFuelBaixa(
  noteId: number,
  body: { dataBaixa?: unknown; valor?: unknown },
): ContractFuelReport {
  ensureFuelNotes();
  if (!Number.isInteger(noteId) || noteId <= 0) throw new Error("Nota de combustível inválida.");
  const note = db.prepare("SELECT id, valor_nf FROM contract_fuel_notes WHERE id = ?").get(noteId) as
    | { id: number; valor_nf: number }
    | undefined;
  if (!note) throw new Error("Nota de combustível não encontrada.");
  const dataBaixa = fuelDate(body.dataBaixa);
  const valor = fuelAmount(body.valor, "valor baixado");
  if (!(valor > 0)) throw new Error("Informe o valor baixado.");
  const { restante } = restanteDaNota(note.id, money(Number(note.valor_nf) || 0));
  if (valor > restante) throw new Error("O valor baixado passa do restante da NF.");
  db.prepare(
    `INSERT INTO contract_fuel_baixas (note_id, data_baixa, valor, created_at) VALUES (?, ?, ?, ?)`,
  ).run(note.id, dataBaixa, valor, new Date().toISOString());
  return listContractFuelNotes();
}

export function updateContractFuelBaixa(
  id: number,
  body: { dataBaixa?: unknown; valor?: unknown },
): ContractFuelReport {
  ensureFuelNotes();
  if (!Number.isInteger(id) || id <= 0) throw new Error("Baixa inválida.");
  const baixa = db.prepare("SELECT id, note_id, valor FROM contract_fuel_baixas WHERE id = ?").get(id) as
    | { id: number; note_id: number; valor: number }
    | undefined;
  if (!baixa) throw new Error("Baixa não encontrada.");
  const note = db.prepare("SELECT id, valor_nf FROM contract_fuel_notes WHERE id = ?").get(baixa.note_id) as
    | { id: number; valor_nf: number }
    | undefined;
  if (!note) throw new Error("Nota de combustível não encontrada.");
  const dataBaixa = fuelDate(body.dataBaixa);
  const valor = fuelAmount(body.valor, "valor baixado");
  if (!(valor > 0)) throw new Error("Informe o valor baixado.");
  const { restante } = restanteDaNota(note.id, money(Number(note.valor_nf) || 0));
  const limite = money(restante + money(Number(baixa.valor) || 0));
  if (valor > limite) throw new Error("O valor baixado passa do restante da NF.");
  db.prepare("UPDATE contract_fuel_baixas SET data_baixa = ?, valor = ? WHERE id = ?").run(dataBaixa, valor, baixa.id);
  return listContractFuelNotes();
}

export function deleteContractFuelBaixa(id: number): ContractFuelReport {
  ensureFuelNotes();
  if (!Number.isInteger(id) || id <= 0) throw new Error("Baixa inválida.");
  const removed = db.prepare("DELETE FROM contract_fuel_baixas WHERE id = ?").run(id);
  if (!removed.changes) throw new Error("Baixa não encontrada.");
  return listContractFuelNotes();
}

export function deleteContractFuelNote(id: number): ContractFuelReport {
  ensureFuelNotes();
  if (!Number.isInteger(id) || id <= 0) throw new Error("Nota de combustível inválida.");
  const removed = db.prepare("DELETE FROM contract_fuel_notes WHERE id = ?").run(id);
  if (!removed.changes) throw new Error("Nota de combustível não encontrada.");
  return listContractFuelNotes();
}

export async function loadContractControlOptions(): Promise<{
  fornecedores: ContractControlOption[];
  empenhos: ContractControlOption[];
}> {
  const [fornecedorIds, nomePorCodigo, empenhos] = await Promise.all([
    withOracle((conn) =>
      conn.execute(
        `SELECT p.cod_fornecedor codigo
           FROM financeiro.parcelascontaspagar p
          WHERE p.cod_grupoempresa = :grupo
            AND p.cod_fornecedor IS NOT NULL
          GROUP BY p.cod_fornecedor`,
        COMPANY,
        { maxRows: 8000, fetchArraySize: 2000 },
      ),
    ),
    supplierNames(),
    withOracle((conn) =>
      conn.execute(
        `SELECT e.cod_empenho codigo, e.descricao
           FROM custo.empenho e
          WHERE e.descricao IS NOT NULL
          ORDER BY e.descricao`,
        {},
        { maxRows: 2000, fetchArraySize: 500 },
      ),
    ),
  ]);
  const fornecedores = {
    rows: (fornecedorIds.rows ?? []).map((row) => {
      const codigo = oracleNumber(row as Record<string, unknown>, "codigo", "CODIGO");
      return {
        CODIGO: codigo,
        DESCRICAO: codigo == null ? "" : (nomePorCodigo.get(codigo) ?? String(codigo)),
      };
    }),
  };
  const option = (row: Record<string, unknown>): ContractControlOption | null => {
    const codigo = oracleNumber(row, "codigo", "CODIGO");
    if (codigo == null) return null;
    return { codigo, descricao: oracleText(row, "descricao", "DESCRICAO") || String(codigo) };
  };
  return {
    fornecedores: (fornecedores.rows ?? [])
      .map((row) => option(row as Record<string, unknown>))
      .filter((row): row is ContractControlOption => row != null)
      .sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR")),
    empenhos: (empenhos.rows ?? [])
      .map((row) => option(row as Record<string, unknown>))
      .filter((row): row is ContractControlOption => row != null),
  };
}

function ensureSupplierGroups() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contract_supplier_groups (
      id INTEGER PRIMARY KEY,
      nome TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contract_supplier_group_members (
      group_id INTEGER NOT NULL REFERENCES contract_supplier_groups(id) ON DELETE CASCADE,
      cod_fornecedor INTEGER NOT NULL,
      descricao TEXT NOT NULL,
      PRIMARY KEY (group_id, cod_fornecedor)
    );
  `);
}

export function listContractSupplierGroups(): ContractSupplierGroup[] {
  ensureSupplierGroups();
  const groups = db.prepare("SELECT id, nome FROM contract_supplier_groups ORDER BY nome").all() as {
    id: number;
    nome: string;
  }[];
  const members = db
    .prepare(
      `SELECT group_id, cod_fornecedor, descricao
         FROM contract_supplier_group_members
        ORDER BY descricao`,
    )
    .all() as { group_id: number; cod_fornecedor: number; descricao: string }[];
  const byGroup = new Map<number, ContractControlOption[]>();
  for (const member of members) {
    const list = byGroup.get(member.group_id) ?? [];
    list.push({ codigo: member.cod_fornecedor, descricao: member.descricao });
    byGroup.set(member.group_id, list);
  }
  return groups.map((group) => ({
    id: group.id,
    nome: group.nome,
    fornecedores: byGroup.get(group.id) ?? [],
  }));
}

export function saveContractSupplierGroup(body: {
  nome?: unknown;
  fornecedores?: unknown;
}): ContractSupplierGroup[] {
  ensureSupplierGroups();
  const nome = String(body.nome ?? "").trim();
  if (!nome) throw new Error("Informe o nome do grupo.");
  if (nome.length > 80) throw new Error("O nome do grupo é longo demais.");
  const raw = Array.isArray(body.fornecedores) ? body.fornecedores : [];
  const seen = new Set<number>();
  const fornecedores: ContractControlOption[] = [];
  for (const item of raw) {
    const record = item as { codigo?: unknown; descricao?: unknown };
    const codigo = Number(record.codigo);
    const descricao = String(record.descricao ?? "").trim();
    if (!Number.isInteger(codigo) || codigo <= 0 || !descricao || seen.has(codigo)) continue;
    seen.add(codigo);
    fornecedores.push({ codigo, descricao: descricao.slice(0, 200) });
  }
  if (!fornecedores.length) throw new Error("Selecione os fornecedores do grupo.");
  const now = new Date().toISOString();
  const save = db.transaction(() => {
    const existing = db.prepare("SELECT id FROM contract_supplier_groups WHERE nome = ?").get(nome) as
      | { id: number }
      | undefined;
    let id = existing?.id;
    if (!id) {
      const created = db.prepare("INSERT INTO contract_supplier_groups (nome, created_at) VALUES (?, ?)").run(nome, now);
      id = Number(created.lastInsertRowid);
    } else {
      db.prepare("UPDATE contract_supplier_groups SET nome = ? WHERE id = ?").run(nome, id);
      db.prepare("DELETE FROM contract_supplier_group_members WHERE group_id = ?").run(id);
    }
    const removeFromOthers = db.prepare(
      "DELETE FROM contract_supplier_group_members WHERE cod_fornecedor = ? AND group_id <> ?",
    );
    const insert = db.prepare(
      "INSERT INTO contract_supplier_group_members (group_id, cod_fornecedor, descricao) VALUES (?, ?, ?)",
    );
    for (const fornecedor of fornecedores) {
      removeFromOthers.run(fornecedor.codigo, id);
      insert.run(id, fornecedor.codigo, fornecedor.descricao);
    }
    db.prepare(
      `DELETE FROM contract_supplier_groups
        WHERE id NOT IN (SELECT group_id FROM contract_supplier_group_members)`,
    ).run();
  });
  save();
  return listContractSupplierGroups();
}

export function removeContractSupplierMembers(groupId: number, codigos: unknown): ContractSupplierGroup[] {
  ensureSupplierGroups();
  if (!Number.isInteger(groupId) || groupId <= 0) throw new Error("Grupo inválido.");
  const group = db.prepare("SELECT id FROM contract_supplier_groups WHERE id = ?").get(groupId);
  if (!group) throw new Error("Grupo não encontrado.");
  const raw = Array.isArray(codigos) ? codigos : String(codigos ?? "").split(",");
  const ids = [...new Set(raw.map((item) => Number(item)).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) throw new Error("Selecione o fornecedor que sai do grupo.");
  const remove = db.prepare(
    "DELETE FROM contract_supplier_group_members WHERE group_id = ? AND cod_fornecedor = ?",
  );
  const run = db.transaction(() => {
    for (const id of ids) remove.run(groupId, id);
  });
  run();
  return listContractSupplierGroups();
}

export function deleteContractSupplierGroup(id: number): ContractSupplierGroup[] {
  ensureSupplierGroups();
  if (!Number.isInteger(id) || id <= 0) throw new Error("Grupo inválido.");
  const removed = db.prepare("DELETE FROM contract_supplier_groups WHERE id = ?").run(id);
  if (!removed.changes) throw new Error("Grupo não encontrado.");
  return listContractSupplierGroups();
}

export function registerContractControlRoutes(app: Express) {
  app.get("/api/contract-control/grupos", (_req, res) => {
    try {
      res.json(listContractSupplierGroups());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/contract-control/grupos", (req, res) => {
    try {
      const body = req.body as { nome?: unknown; fornecedores?: unknown };
      res.json(saveContractSupplierGroup(body));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/contract-control/grupos/:id/retirar", (req, res) => {
    try {
      const body = req.body as { codigos?: unknown };
      res.json(removeContractSupplierMembers(Number(req.params.id), body.codigos));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/contract-control/grupos/:id", (req, res) => {
    try {
      res.json(deleteContractSupplierGroup(Number(req.params.id)));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/contract-control/options", async (_req, res) => {
    try {
      res.json(await loadContractControlOptions());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/contract-control/combustivel", (_req, res) => {
    try {
      res.json(listContractFuelNotes());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/contract-control/combustivel", (req, res) => {
    try {
      const body = req.body as {
        numeroNf?: unknown;
        fornecedor?: unknown;
        mesCompetencia?: unknown;
        valorNf?: unknown;
      };
      res.json(addContractFuelNote(body));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/contract-control/combustivel/:id/baixas", (req, res) => {
    try {
      const body = req.body as { dataBaixa?: unknown; valor?: unknown };
      res.json(addContractFuelBaixa(Number(req.params.id), body));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch("/api/contract-control/combustivel/baixas/:id", (req, res) => {
    try {
      const body = req.body as { dataBaixa?: unknown; valor?: unknown };
      res.json(updateContractFuelBaixa(Number(req.params.id), body));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/contract-control/combustivel/baixas/:id", (req, res) => {
    try {
      res.json(deleteContractFuelBaixa(Number(req.params.id)));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch("/api/contract-control/combustivel/:id", (req, res) => {
    try {
      const body = req.body as { numeroNf?: unknown; fornecedor?: unknown; mesCompetencia?: unknown };
      res.json(updateContractFuelNote(Number(req.params.id), body));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/contract-control/combustivel/:id", (req, res) => {
    try {
      res.json(deleteContractFuelNote(Number(req.params.id)));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/contract-control/ocorrencias", async (req: Request, res) => {
    const signal = requestSignal(req, res);
    try {
      const report = await loadContractOccurrences({
        from: req.query.from,
        to: req.query.to,
        fornecedores: req.query.fornecedores,
        signal,
      });
      if (signal.aborted || res.writableEnded) {
        endIfOpen(res);
        return;
      }
      res.json(report);
    } catch (error) {
      if (signal.aborted || cancelledQuery(error) || res.writableEnded) {
        endIfOpen(res);
        return;
      }
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/contract-control", async (req: Request, res) => {
    const signal = requestSignal(req, res);
    try {
      const report = await loadContractControl({
        from: req.query.from,
        to: req.query.to,
        fornecedores: req.query.fornecedores,
        empenhos: req.query.empenhos,
        signal,
      });
      if (signal.aborted || res.writableEnded) {
        endIfOpen(res);
        return;
      }
      res.json(report);
    } catch (error) {
      if (signal.aborted || cancelledQuery(error) || res.writableEnded) {
        endIfOpen(res);
        return;
      }
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
