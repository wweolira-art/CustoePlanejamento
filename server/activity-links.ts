import { db } from "./db.js";
import { oracleDate, oracleNumber, oracleText, withOracle } from "./oracle.js";
import { currentSafraStartYear, resolveSafraId, safraStartYear } from "./safras.js";
import { zeros, type RealizadoActivity, type RealizadoActivitySource } from "../src/lib/reportAggregate.ts";

export const ACTIVITY_SOURCES = ["contrato_variavel", "contrato_fixo", "insumo", "materiais"] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

const SOURCE_LABEL: Record<ActivitySource, string> = {
  contrato_variavel: "Contrato variável",
  contrato_fixo: "Contrato fixo",
  insumo: "Insumo",
  materiais: "Materiais",
};

const SOURCE_CODE_LABEL: Record<ActivitySource, string> = {
  contrato_variavel: "Código de serviço",
  contrato_fixo: "Empenho ou nº do contrato",
  insumo: "Código da operação",
  materiais: "Código do material",
};

export const CONTRATO_FIXO_MATCH = ["cod_empenho", "numerocontrato"] as const;
export type ContratoFixoMatch = (typeof CONTRATO_FIXO_MATCH)[number];

const IMPLEMENTED: ActivitySource[] = ["contrato_variavel", "contrato_fixo", "insumo"];

function isContratoFixoMatch(value: unknown): value is ContratoFixoMatch {
  return CONTRATO_FIXO_MATCH.includes(value as ContratoFixoMatch);
}

function matchByFor(source: ActivitySource, matchBy?: string | null) {
  if (source !== "contrato_fixo") return "code";
  if (!isContratoFixoMatch(matchBy)) {
    throw new Error("Escolha se o contrato fixo entra pelo empenho ou pelo número do contrato.");
  }
  return matchBy;
}

function codeLabelFor(source: ActivitySource, matchBy?: string | null) {
  if (source === "contrato_fixo") {
    return matchBy === "numerocontrato" ? "Número do contrato" : "Código do empenho";
  }
  return SOURCE_CODE_LABEL[source];
}

function sourceLabelFor(source: ActivitySource, matchBy?: string | null) {
  if (source === "contrato_fixo") {
    return matchBy === "numerocontrato" ? "Contrato fixo · nº contrato" : "Contrato fixo · empenho";
  }
  return SOURCE_LABEL[source];
}

const SAFRA_MONTHS = [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7];

export interface ActivityRealizadoLink {
  id: number;
  safraId: number;
  activityId: number;
  activityCode: string;
  activityName: string;
  source: ActivitySource;
  sourceLabel: string;
  sourceCode: string;
  sourceCodeLabel: string;
  matchBy: string;
  oracleLabel: string | null;
}

export interface ActivitySourceOption {
  code: string;
  label: string;
  count: number;
  total: number;
}

function money(n: number) {
  return Math.round((n || 0) * 100) / 100;
}

function isSource(value: unknown): value is ActivitySource {
  return ACTIVITY_SOURCES.includes(value as ActivitySource);
}

function assertImplemented(source: ActivitySource) {
  if (!IMPLEMENTED.includes(source)) {
    throw new Error(`A consulta de ${SOURCE_LABEL[source]} ainda não foi definida.`);
  }
}

function activityLinkColumns() {
  return db.prepare("PRAGMA table_info(activity_realizado_links)").all() as { name: string }[];
}

function activityLinksHasSafraId() {
  return activityLinkColumns().some((col) => col.name === "safra_id");
}

function activityLinksHasMatchBy() {
  return activityLinkColumns().some((col) => col.name === "match_by");
}

function migrateActivityLinksToGlobal() {
  if (!activityLinksHasSafraId()) return;
  let harvestId = 0;
  try {
    harvestId = resolveSafraId();
  } catch {
    harvestId = 0;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_realizado_links_global (
      id INTEGER PRIMARY KEY,
      activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK (source IN ('contrato_variavel', 'contrato_fixo', 'insumo', 'materiais')),
      source_code TEXT NOT NULL,
      source_label TEXT,
      UNIQUE (source, source_code)
    );
  `);
  const rows = db
    .prepare(
      `SELECT activity_id, source, source_code, source_label
         FROM activity_realizado_links
        ORDER BY CASE WHEN safra_id = ? THEN 0 ELSE 1 END, id DESC`,
    )
    .all(harvestId) as {
      activity_id: number;
      source: string;
      source_code: string;
      source_label: string | null;
    }[];
  const ins = db.prepare(
    `INSERT OR IGNORE INTO activity_realizado_links_global (activity_id, source, source_code, source_label)
     VALUES (?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.source}::${row.source_code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ins.run(row.activity_id, row.source, row.source_code, row.source_label);
    }
    db.exec("DROP TABLE activity_realizado_links");
    db.exec("ALTER TABLE activity_realizado_links_global RENAME TO activity_realizado_links");
  });
  tx();
}

function migrateActivityLinksMatchBy() {
  if (activityLinksHasMatchBy()) return;
  db.exec(`
    CREATE TABLE activity_realizado_links_match (
      id INTEGER PRIMARY KEY,
      activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK (source IN ('contrato_variavel', 'contrato_fixo', 'insumo', 'materiais')),
      source_code TEXT NOT NULL,
      source_label TEXT,
      match_by TEXT NOT NULL DEFAULT 'code',
      UNIQUE (source, source_code, match_by)
    );
  `);
  db.exec(`
    INSERT INTO activity_realizado_links_match (id, activity_id, source, source_code, source_label, match_by)
    SELECT id, activity_id, source, source_code, source_label, 'code'
      FROM activity_realizado_links
  `);
  db.exec("DROP TABLE activity_realizado_links");
  db.exec("ALTER TABLE activity_realizado_links_match RENAME TO activity_realizado_links");
}

export function ensureActivityLinks() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_realizado_links (
      id INTEGER PRIMARY KEY,
      activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK (source IN ('contrato_variavel', 'contrato_fixo', 'insumo', 'materiais')),
      source_code TEXT NOT NULL,
      source_label TEXT,
      match_by TEXT NOT NULL DEFAULT 'code',
      UNIQUE (source, source_code, match_by)
    );
  `);
  migrateActivityLinksToGlobal();
  migrateActivityLinksMatchBy();
}

function safraDateRange(startYear: number) {
  return {
    fromDate: `${startYear}-09-01`,
    toDate: `${startYear + 1}-08-31`,
  };
}

function sqlDate(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("Data da safra inválida.");
  return `TO_DATE('${iso}', 'YYYY-MM-DD')`;
}

function dateToIndex(iso: string | null, startYear: number): number | null {
  const day = (iso ?? "").slice(0, 10);
  const match = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const index = SAFRA_MONTHS.indexOf(month);
  if (index < 0) return null;
  const expectedYear = month >= 8 ? startYear : startYear + 1;
  if (year !== expectedYear) return null;
  return index;
}

function codeKey(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const n = Number(raw.replace(",", "."));
  if (Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return raw.toUpperCase();
}

function contratoFixoFromSql() {
  return `FROM financeiro.parcelascontrato a
          LEFT JOIN financeiro.historicocontrato b
            ON a.numerocontrato = b.numerocontrato
           AND a.datainicio BETWEEN b.datainicio AND NVL(b.datatermino, SYSDATE)
          LEFT JOIN custo.item_custo c
            ON b.cod_item_custo = c.cod_item_custo
          LEFT JOIN financeiro.contrato d
            ON a.numerocontrato = d.numerocontrato
           AND a.cod_empresa = d.cod_empresa
           AND a.cod_filial = d.cod_filial
          LEFT JOIN custo.empenho emp
            ON emp.cod_empenho = a.cod_empenho`;
}

function insumoFromSql() {
  return `FROM agricola.apontamentomaterial a
           JOIN agricola.apontamentoitem b
             ON a.nr_apontamento = b.nr_apontamento
            AND a.item_apontamento = b.item_apontamento
            AND a.ano_apontamento = b.ano_apontamento
           JOIN rh.operacaoagricola op
             ON b.cod_operacao = op.cod_operacaoagricola
           LEFT JOIN (
                  SELECT a.nrrequisicao,
                         a.cod_material,
                         a.vrcustounitario,
                         a.item,
                         a.dataretirada
                    FROM material.itensrequisicaomaterial a
                    LEFT JOIN material.material b
                      ON a.cod_material = b.cod_material
                    LEFT JOIN material.historicogrupomaterial c
                      ON b.cod_familia = c.cod_familia
                     AND b.cod_grupomaterial = c.cod_grupomaterial
                     AND a.cod_grupoempresa = c.cod_grupoempresa
                     AND a.cod_empresa = c.cod_empresa
                     AND a.cod_filial = c.cod_filial
                     AND c.datatermino IS NULL
                   WHERE a.data_canc IS NULL
                ) c
             ON a.item_requisicao = c.item
            AND a.cod_material = c.cod_material
            AND a.nrrequisicao = c.nrrequisicao`;
}

function inBinds(prefix: string, codes: string[]) {
  const binds: Record<string, string | number> = {};
  const names = codes.map((code, i) => {
    const key = `${prefix}${i}`;
    const n = Number(code);
    binds[key] = Number.isFinite(n) && String(Math.round(n)) === code ? n : code;
    return `:${key}`;
  });
  return { sql: names.join(", "), binds };
}

function mapLink(
  row: {
    id: number;
    activity_id: number;
    activity_code: string;
    activity_name: string;
    source: string;
    source_code: string;
    source_label: string | null;
    match_by?: string | null;
  },
  safraId: number,
): ActivityRealizadoLink {
  const source = isSource(row.source) ? row.source : "contrato_variavel";
  const matchBy = row.match_by?.trim() || (source === "contrato_fixo" ? "cod_empenho" : "code");
  return {
    id: row.id,
    safraId,
    activityId: row.activity_id,
    activityCode: row.activity_code,
    activityName: row.activity_name,
    source,
    sourceLabel: sourceLabelFor(source, matchBy),
    sourceCode: row.source_code,
    sourceCodeLabel: codeLabelFor(source, matchBy),
    matchBy,
    oracleLabel: row.source_label,
  };
}

export function listActivityLinks(safraId?: number | null) {
  ensureActivityLinks();
  const harvestId = resolveSafraId(safraId);
  const rows = db
    .prepare(
      `SELECT l.id, l.activity_id, l.source, l.source_code, l.source_label, l.match_by,
              a.code AS activity_code, a.description AS activity_name
         FROM activity_realizado_links l
         JOIN activities a ON a.id = l.activity_id
        ORDER BY a.code COLLATE NOCASE, l.source, l.match_by, l.source_code`,
    )
    .all() as {
      id: number;
      activity_id: number;
      activity_code: string;
      activity_name: string;
      source: string;
      source_code: string;
      source_label: string | null;
      match_by: string | null;
    }[];
  return {
    safraId: harvestId,
    sources: ACTIVITY_SOURCES.map((source) => ({
      id: source,
      label: SOURCE_LABEL[source],
      codeLabel: SOURCE_CODE_LABEL[source],
      implemented: IMPLEMENTED.includes(source),
    })),
    links: rows.map((row) => mapLink(row, harvestId)),
  };
}

export function createActivityLink(input: {
  activityId?: number;
  source?: string;
  sourceCode?: string;
  sourceCodes?: string[];
  sourceLabel?: string | null;
  matchBy?: string | null;
  safraId?: number | null;
}) {
  ensureActivityLinks();
  const activityId = Number(input.activityId);
  if (!activityId) throw new Error("Escolha a atividade do orçamento.");
  if (!isSource(input.source)) throw new Error("Escolha de onde buscar o realizado.");
  assertImplemented(input.source);
  const matchBy = matchByFor(input.source, input.matchBy);
  const codes = [
    ...new Set(
      [...(input.sourceCodes ?? []), input.sourceCode ?? ""]
        .map((code) => codeKey(code))
        .filter(Boolean),
    ),
  ];
  if (!codes.length) throw new Error(`Informe pelo menos um ${codeLabelFor(input.source, matchBy).toLowerCase()}.`);
  const activity = db.prepare("SELECT id FROM activities WHERE id = ?").get(activityId) as { id: number } | undefined;
  if (!activity) throw new Error("Atividade não encontrada.");
  const ins = db.prepare(
    `INSERT INTO activity_realizado_links (activity_id, source, source_code, source_label, match_by)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const find = db.prepare(
    `SELECT l.activity_id, a.code, a.description
       FROM activity_realizado_links l
       JOIN activities a ON a.id = l.activity_id
      WHERE l.source = ? AND l.source_code = ? AND l.match_by = ?`,
  );
  const conflicts: string[] = [];
  const tx = db.transaction(() => {
    for (const sourceCode of codes) {
      const existing = find.get(input.source, sourceCode, matchBy) as
        | { activity_id: number; code: string; description: string }
        | undefined;
      if (existing) {
        if (existing.activity_id !== activityId) {
          conflicts.push(
            `${sourceCode} já está associado à atividade ${existing.code} — ${existing.description}`,
          );
        }
        continue;
      }
      ins.run(activityId, input.source, sourceCode, input.sourceLabel?.trim() || null, matchBy);
    }
    if (conflicts.length) throw new Error(conflicts.join(" "));
  });
  tx();
  return listActivityLinks(input.safraId);
}

export function copyActivityLinksBetween(_sourceId: number, _targetId: number) {
  ensureActivityLinks();
}

export function deleteActivityLink(id: number, safraId?: number | null) {
  ensureActivityLinks();
  const result = db.prepare("DELETE FROM activity_realizado_links WHERE id = ?").run(id);
  if (!result.changes) throw new Error("Associação não encontrada.");
  return listActivityLinks(safraId);
}

function sourceOptionFromRow(raw: Record<string, unknown>): ActivitySourceOption | null {
  const code = codeKey(oracleText(raw, "codigo") || oracleNumber(raw, "codigo"));
  if (!code) return null;
  const nome = oracleText(raw, "nome");
  return {
    code,
    label: nome || code,
    count: oracleNumber(raw, "qtd") ?? 0,
    total: money(oracleNumber(raw, "total") ?? 0),
  };
}

export async function listActivitySourceOptions(
  source: string,
  safraId?: number | null,
  matchBy?: string | null,
) {
  if (!isSource(source)) throw new Error("Origem inválida.");
  assertImplemented(source);
  const resolvedMatch = source === "contrato_fixo" ? matchByFor(source, matchBy ?? "cod_empenho") : "code";
  resolveSafraId(safraId);
  const startYear = currentSafraStartYear();
  const { fromDate, toDate } = safraDateRange(startYear);
  return withOracle(async (conn) => {
    if (source === "contrato_variavel") {
      const result = await conn.execute(
        `SELECT i.cod_servico AS codigo,
                MAX(op.descricao) AS nome,
                COUNT(*) AS qtd,
                SUM(i.vlrtotal) AS total
           FROM financeiro.itemcontratovariavel i
           LEFT JOIN rh.operacaoagricola op
             ON op.cod_operacaoagricola = i.cod_servico
          GROUP BY i.cod_servico
          ORDER BY i.cod_servico`,
        [],
        { maxRows: 0, fetchArraySize: 1000 },
      );
      const items: ActivitySourceOption[] = [];
      for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
        const item = sourceOptionFromRow(raw);
        if (item) items.push(item);
      }
      return { source, matchBy: resolvedMatch, codeLabel: SOURCE_CODE_LABEL[source], fromDate, toDate, items };
    }

    if (source === "contrato_fixo") {
      const byEmpenho = resolvedMatch === "cod_empenho";
      const codeExpr = byEmpenho ? "a.cod_empenho" : "a.numerocontrato";
      const nomeExpr = byEmpenho
        ? `MAX(NVL(emp.descricao,
                   CASE WHEN d.cod_fornecedor IS NULL THEN NULL
                        ELSE 'Fornecedor ' || TO_CHAR(d.cod_fornecedor)
                   END))`
        : `MAX(CASE
                  WHEN d.cod_fornecedor IS NULL THEN NULL
                  ELSE 'Fornecedor ' || TO_CHAR(d.cod_fornecedor)
                END)`;
      const result = await conn.execute(
        `SELECT ${codeExpr} AS codigo,
                ${nomeExpr} AS nome,
                COUNT(*) AS qtd,
                SUM(NVL(a.valor, 0)) AS total
           ${contratoFixoFromSql()}
          WHERE b.fixovariavel = 'F'
            AND ${codeExpr} IS NOT NULL
            AND TRUNC(a.datainicio) BETWEEN ${sqlDate(fromDate)} AND ${sqlDate(toDate)}
          GROUP BY ${codeExpr}
          ORDER BY ${codeExpr}`,
        [],
        { maxRows: 0, fetchArraySize: 1000 },
      );
      const items: ActivitySourceOption[] = [];
      for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
        const item = sourceOptionFromRow(raw);
        if (item) items.push(item);
      }
      return {
        source,
        matchBy: resolvedMatch,
        codeLabel: codeLabelFor(source, resolvedMatch),
        fromDate,
        toDate,
        items,
      };
    }

    const byCode = new Map<string, ActivitySourceOption>();
    const catalog = await conn.execute(
      `SELECT op.cod_operacaoagricola AS codigo,
              op.descricao AS nome
         FROM rh.operacaoagricola op
        WHERE op.cod_operacaoagricola IS NOT NULL
        ORDER BY op.cod_operacaoagricola`,
      [],
      { maxRows: 0, fetchArraySize: 1000 },
    );
    for (const raw of (catalog.rows ?? []) as Record<string, unknown>[]) {
      const item = sourceOptionFromRow(raw);
      if (item) byCode.set(item.code, item);
    }
    try {
      const stats = await conn.execute(
        `SELECT op.cod_operacaoagricola AS codigo,
                MAX(op.descricao) AS nome,
                COUNT(*) AS qtd,
                SUM(NVL(a.quantidade, 0) * NVL(c.vrcustounitario, 0)) AS total
           ${insumoFromSql()}
          WHERE op.cod_operacaoagricola IS NOT NULL
          GROUP BY op.cod_operacaoagricola`,
        [],
        { maxRows: 0, fetchArraySize: 1000 },
      );
      for (const raw of (stats.rows ?? []) as Record<string, unknown>[]) {
        const item = sourceOptionFromRow(raw);
        if (!item) continue;
        const current = byCode.get(item.code);
        byCode.set(item.code, {
          code: item.code,
          label: item.label !== item.code ? item.label : current?.label || item.code,
          count: item.count,
          total: item.total,
        });
      }
    } catch {
      /* o cadastro de operações já basta para associar */
    }
    const items = [...byCode.values()].sort((a, b) =>
      a.code.localeCompare(b.code, "pt-BR", { numeric: true }),
    );
    return { source, matchBy: resolvedMatch, codeLabel: SOURCE_CODE_LABEL[source], fromDate, toDate, items };
  });
}

export async function fetchActivityRealizado(options?: {
  safraId?: number | null;
  startYear?: number | null;
}): Promise<RealizadoActivity[]> {
  ensureActivityLinks();
  const links = db
    .prepare(
      `SELECT l.activity_id, l.source, l.source_code, l.source_label, l.match_by,
              a.code AS activity_code, a.description AS activity_name
         FROM activity_realizado_links l
         JOIN activities a ON a.id = l.activity_id`,
    )
    .all() as {
      activity_id: number;
      source: string;
      source_code: string;
      source_label: string | null;
      match_by: string | null;
      activity_code: string;
      activity_name: string;
    }[];
  if (!links.length) return [];

  let startYear = options?.startYear ?? null;
  if (startYear == null || !Number.isFinite(startYear)) {
    const id = resolveSafraId(options?.safraId);
    const safra = db.prepare("SELECT code FROM safras WHERE id = ?").get(id) as { code: string } | undefined;
    startYear = safra ? safraStartYear(safra.code) : currentSafraStartYear();
  }
  const { fromDate, toDate } = safraDateRange(startYear);
  const byActivity = new Map<number, { key: string; label: string; months: number[] }>();
  const bySource = new Map<
    string,
    { key: string; activityId: number; prefix: string; nome: string; months: number[] }
  >();
  const remember = (activityId: number, code: string, name: string) => {
    const row = byActivity.get(activityId) ?? {
      key: `a-${activityId}`,
      label: `${code} — ${name}`,
      months: zeros(),
    };
    byActivity.set(activityId, row);
    return row;
  };
  const sourceKeyOf = (activityId: number, source: string, matchBy: string, code: string) =>
    `src-${activityId}-${source}-${matchBy}-${code}`;
  const rememberSource = (
    activityId: number,
    source: ActivitySource,
    matchBy: string,
    code: string,
    storedLabel: string | null,
  ) => {
    const key = sourceKeyOf(activityId, source, matchBy, code);
    if (!bySource.has(key)) {
      const prefix = `${sourceLabelFor(source, matchBy)} · ${codeLabelFor(source, matchBy)} ${code}`;
      bySource.set(key, {
        key,
        activityId,
        prefix,
        nome: storedLabel?.trim() && storedLabel.trim() !== code ? storedLabel.trim() : "",
        months: zeros(),
      });
    }
    return key;
  };
  for (const link of links) remember(link.activity_id, link.activity_code, link.activity_name);

  type LinkItem = { activityId: number; code: string; sourceKey: string };
  const grouped = new Map<ActivitySource, LinkItem[]>();
  const contratoFixoByMatch = new Map<ContratoFixoMatch, LinkItem[]>();
  for (const link of links) {
    if (!isSource(link.source) || !IMPLEMENTED.includes(link.source)) continue;
    const code = codeKey(link.source_code);
    const match =
      link.source === "contrato_fixo"
        ? isContratoFixoMatch(link.match_by)
          ? link.match_by
          : "cod_empenho"
        : "code";
    const sourceKey = rememberSource(link.activity_id, link.source, match, code, link.source_label);
    const item = { activityId: link.activity_id, code, sourceKey };
    if (link.source === "contrato_fixo") {
      const list = contratoFixoByMatch.get(match) ?? [];
      list.push(item);
      contratoFixoByMatch.set(match, list);
      continue;
    }
    const list = grouped.get(link.source) ?? [];
    list.push(item);
    grouped.set(link.source, list);
  }

  const addRows = (
    items: LinkItem[],
    rows: Record<string, unknown>[],
    dateField: string,
    codeField: string,
    activityMap: Map<string, number[]>,
    nameField?: string,
  ) => {
    const byCode = new Map<string, LinkItem[]>();
    for (const item of items) {
      const list = byCode.get(item.code) ?? [];
      list.push(item);
      byCode.set(item.code, list);
    }
    for (const raw of rows) {
      const code = codeKey(oracleText(raw, codeField) || oracleNumber(raw, codeField));
      const list = byCode.get(code);
      if (!list?.length) continue;
      const index = dateToIndex(oracleDate(raw, dateField), startYear);
      const valor = oracleNumber(raw, "valor") ?? 0;
      if (index == null || !valor) continue;
      const nome = nameField ? oracleText(raw, nameField)?.trim() : "";
      for (const item of list) {
        const row = activityMap.get(String(item.activityId));
        if (row) row[index] = money(row[index] + valor);
        const src = bySource.get(item.sourceKey);
        if (src) {
          src.months[index] = money(src.months[index] + valor);
          if (nome && nome !== code && !src.nome) src.nome = nome;
        }
      }
    }
  };

  await withOracle(async (conn) => {
    const monthsByActivity = () => new Map([...byActivity.entries()].map(([id, row]) => [String(id), row.months]));

    const contrato = grouped.get("contrato_variavel") ?? [];
    if (contrato.length) {
      const { sql, binds } = inBinds("s", [...new Set(contrato.map((row) => row.code))]);
      const result = await conn.execute(
        `SELECT c.datainicio,
                i.cod_servico,
                MAX(op.descricao) AS nome,
                SUM(i.vlrtotal) AS valor
           FROM financeiro.itemcontratovariavel i
           JOIN financeiro.parcelascontrato c
             ON i.numerocontrato = c.numerocontrato
            AND i.parcela = c.parcela
           LEFT JOIN rh.operacaoagricola op
             ON op.cod_operacaoagricola = i.cod_servico
          WHERE TRUNC(c.datainicio) BETWEEN ${sqlDate(fromDate)} AND ${sqlDate(toDate)}
            AND i.cod_servico IN (${sql})
          GROUP BY c.datainicio, i.cod_servico`,
        binds,
      );
      addRows(
        contrato,
        (result.rows ?? []) as Record<string, unknown>[],
        "datainicio",
        "cod_servico",
        monthsByActivity(),
        "nome",
      );
    }

    for (const match of CONTRATO_FIXO_MATCH) {
      const items = contratoFixoByMatch.get(match) ?? [];
      if (!items.length) continue;
      const codeExpr = match === "numerocontrato" ? "a.numerocontrato" : "a.cod_empenho";
      const nomeExpr = match === "cod_empenho" ? "MAX(emp.descricao)" : "MAX(TO_CHAR(d.cod_fornecedor))";
      const { sql, binds } = inBinds(match === "numerocontrato" ? "c" : "e", [
        ...new Set(items.map((row) => row.code)),
      ]);
      const result = await conn.execute(
        `SELECT a.datainicio,
                ${codeExpr} AS codigo,
                ${nomeExpr} AS nome,
                SUM(NVL(a.valor, 0)) AS valor
           ${contratoFixoFromSql()}
          WHERE b.fixovariavel = 'F'
            AND ${codeExpr} IS NOT NULL
            AND TRUNC(a.datainicio) BETWEEN ${sqlDate(fromDate)} AND ${sqlDate(toDate)}
            AND ${codeExpr} IN (${sql})
          GROUP BY a.datainicio, ${codeExpr}`,
        binds,
      );
      addRows(items, (result.rows ?? []) as Record<string, unknown>[], "datainicio", "codigo", monthsByActivity(), "nome");
    }

    const insumo = grouped.get("insumo") ?? [];
    if (insumo.length) {
      const { sql, binds } = inBinds("o", [...new Set(insumo.map((row) => row.code))]);
      try {
        const result = await conn.execute(
          `SELECT c.dataretirada,
                  op.cod_operacaoagricola AS cod_operacao,
                  MAX(op.descricao) AS nome,
                  SUM(NVL(a.quantidade, 0) * NVL(c.vrcustounitario, 0)) AS valor
             ${insumoFromSql()}
            WHERE c.dataretirada IS NOT NULL
              AND TRUNC(c.dataretirada) BETWEEN ${sqlDate(fromDate)} AND ${sqlDate(toDate)}
              AND op.cod_operacaoagricola IN (${sql})
            GROUP BY c.dataretirada, op.cod_operacaoagricola`,
          binds,
        );
        addRows(
          insumo,
          (result.rows ?? []) as Record<string, unknown>[],
          "dataretirada",
          "cod_operacao",
          monthsByActivity(),
          "nome",
        );
      } catch (err) {
        const code = (err as { errorNum?: number }).errorNum;
        if (code !== 942) throw err;
      }
    }
  });

  const sourcesByActivity = new Map<number, RealizadoActivitySource[]>();
  for (const src of bySource.values()) {
    const list = sourcesByActivity.get(src.activityId) ?? [];
    list.push({
      key: src.key,
      label: src.nome ? `${src.prefix} — ${src.nome}` : src.prefix,
      months: src.months.map(money),
    });
    sourcesByActivity.set(src.activityId, list);
  }

  return [...byActivity.entries()].map(([id, row]) => ({
    key: row.key,
    label: row.label,
    months: row.months.map(money),
    sources: (sourcesByActivity.get(id) ?? []).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
  }));
}
