import { db } from "./db.js";
import { matchSheetName } from "./orcado-realizado.js";
import { listSafras, resolveSafraId } from "./safras.js";

const DEFAULT_EXTERN_URL = "https://orcasafra.vercel.app/api/externo/orcamento";

type ExternSubprocess = {
  id: number;
  codigo: string;
  nome: string;
  meses: number[];
  totalSafra: number;
};

type ExternOrcamentoPayload = {
  geradoEm?: string;
  meses?: string[];
  safra?: { id: number; nome?: string; versao_label?: string; status?: string };
  historico?: boolean;
  subprocessos?: ExternSubprocess[];
  geral?: {
    orcado?: number[];
    folhaAvulsa?: number[];
    total?: number[];
    orcadoSafra?: number;
    folhaAvulsaSafra?: number;
    totalSafra?: number;
  };
};

export type FuncionarioImportPreview = {
  externalSafraId: number;
  externalSafraLabel: string | null;
  localSafraId: number;
  localSafraCode: string | null;
  sourceUrl: string;
  meses: string[];
  geral: { orcado: number[]; folhaAvulsa: number[]; total: number[]; totalSafra: number };
  itens: {
    subprocessId: number;
    subprocessCodigo: string;
    subprocessNome: string;
    sheetName: string | null;
    lineId: number | null;
    lineDescription: string | null;
    meses: number[];
    totalSafra: number;
    status: "ready" | "no_sheet" | "no_line";
  }[];
};

function externOrcamentoUrl(externalSafraId: number) {
  const raw = (process.env.ORCASAFRA_ORCAMENTO_URL || DEFAULT_EXTERN_URL).trim();
  if (/safraId=/i.test(raw)) return raw.replace(/safraId=[^&]*/i, `safraId=${externalSafraId}`);
  return `${raw}${raw.includes("?") ? "&" : "?"}safraId=${externalSafraId}`;
}

function parseCodigo(codigo: string) {
  const parts = String(codigo || "")
    .split("-")
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n));
  if (parts.length < 2) return null;
  return {
    negocio: parts[0],
    processo: parts[1],
    subprocesso: parts[2] ?? null,
  };
}

function normalizeText(text: string) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function sheetFromSubprocessName(nome: string): string | null {
  const n = normalizeText(nome);
  if (/colheita.*mecanizada|mecanizada/.test(n)) return "C. MECANIZADA";
  if (/colheita.*manual|manual/.test(n)) return "C. MANUAL";
  if (/tratos.*soca|soca/.test(n)) return "T.C.S.";
  if (/tratos.*planta|planta/.test(n)) return "T.C.P.";
  if (/plantio/.test(n)) return "PLANTIO";
  if (/preparo|solo/.test(n)) return "P.SOLO";
  if (/irrig|fertirrig/.test(n)) return "IRRIGAÇÃO";
  if (/pecu/.test(n)) return "PECUÁRIA";
  if (/oficina/.test(n)) return "OFICINA";
  if (/transporte agr/.test(n)) return "TRANSP.AGRICOLA";
  if (/mecaniz.*agr/.test(n)) return "MECANIZAÇÃO AGR.";
  if (/diretoria/.test(n)) return "DIRETORIA";
  if (/administra|controle geral|recursos humanos|suprimentos|estudos tecnicos|departamento/.test(n)) {
    return "ADMINISTRAÇÃO";
  }
  if (/arrendamento/.test(n)) return "ARRENDAMENTOS";
  if (/corte.*semente|semente/.test(n)) return "CORTE SEMENTE";
  return null;
}

export function sheetForSubprocess(sub: Pick<ExternSubprocess, "codigo" | "nome">): string | null {
  const byName = sheetFromSubprocessName(sub.nome);
  if (byName) return byName;
  const parsed = parseCodigo(sub.codigo);
  if (parsed) {
    return matchSheetName(parsed.negocio, parsed.processo, parsed.subprocesso);
  }
  return null;
}

function safraCodeFromExternLabel(label?: string | null) {
  if (!label) return null;
  const match = String(label).match(/20?(\d{2})\s*[/\-]\s*20?(\d{2})/);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

export type FuncionarioApiConfig = {
  enabled: boolean;
  externalSafraId: number;
  subprocessIds: number[];
  folhaAvulsaSubprocessIds: number[];
};

function parseSubprocessIdList(raw: unknown): number[] {
  return Array.isArray(raw)
    ? [...new Set(raw.map(Number).filter((n) => Number.isFinite(n)))]
    : [];
}

export function parseFuncionarioApiConfig(raw: unknown): FuncionarioApiConfig | null {
  if (raw == null || raw === "") return null;
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== "object") return null;
    const enabled = Boolean((obj as FuncionarioApiConfig).enabled);
    const externalSafraId = Number((obj as FuncionarioApiConfig).externalSafraId);
    const subprocessIds = parseSubprocessIdList((obj as FuncionarioApiConfig).subprocessIds);
    const folhaAvulsaSubprocessIds = parseSubprocessIdList(
      (obj as FuncionarioApiConfig).folhaAvulsaSubprocessIds,
    );
    if (!enabled) {
      return {
        enabled: false,
        externalSafraId: Number.isFinite(externalSafraId) ? externalSafraId : 4,
        subprocessIds,
        folhaAvulsaSubprocessIds,
      };
    }
    if (!Number.isFinite(externalSafraId)) return null;
    if (!subprocessIds.length && !folhaAvulsaSubprocessIds.length) return null;
    return { enabled, externalSafraId, subprocessIds, folhaAvulsaSubprocessIds };
  } catch {
    return null;
  }
}

export function serializeFuncionarioApiConfig(config: FuncionarioApiConfig | null): string | null {
  if (!config) return null;
  return JSON.stringify(config);
}

export function isAdministrationSubprocess(nome: string): boolean {
  const n = normalizeText(nome);
  return (
    /estudos tecnicos/.test(n) ||
    /administracao geral/.test(n) ||
    /suprimentos/.test(n) ||
    /recursos humanos/.test(n) ||
    /controle geral agricola/.test(n)
  );
}

export function computeFolhaAvulsaMeses(
  payload: Pick<ExternOrcamentoPayload, "subprocessos" | "geral">,
  subprocessIds: number[],
): number[] {
  const selected = new Set(subprocessIds);
  const subprocessos = (payload.subprocessos ?? []).filter((sub) => selected.has(sub.id));
  const orcadoGeral = payload.geral?.orcado ?? [];
  const folhaGeral = payload.geral?.folhaAvulsa ?? [];

  return Array.from({ length: 12 }, (_, i) => {
    const totalOrcado = Number(orcadoGeral[i]) || 0;
    const totalFolha = Number(folhaGeral[i]) || 0;
    if (!(totalOrcado > 0) || !(totalFolha > 0)) return 0;
    const selectedOrcado = subprocessos.reduce((sum, sub) => sum + (Number(sub.meses?.[i]) || 0), 0);
    return Math.round(totalFolha * (selectedOrcado / totalOrcado) * 100) / 100;
  });
}

export async function listExternSubprocessos(externalSafraId: number) {
  const payload = await fetchExternFuncionarioOrcamento(externalSafraId);
  return {
    externalSafraId,
    safraLabel: payload.safra?.nome ?? null,
    meses: payload.meses ?? [],
    orcadoGeral: (payload.geral?.orcado ?? []).slice(0, 12),
    folhaAvulsaGeral: (payload.geral?.folhaAvulsa ?? []).slice(0, 12),
    folhaAvulsaSafra: payload.geral?.folhaAvulsaSafra ?? 0,
    subprocessos: (payload.subprocessos ?? []).map((sub) => ({
      id: sub.id,
      codigo: sub.codigo,
      nome: sub.nome,
      totalSafra: sub.totalSafra ?? 0,
      meses: (sub.meses ?? []).slice(0, 12),
      isAdministration: isAdministrationSubprocess(sub.nome),
    })),
  };
}

function isLineFolhaAvulsa(lineId: number) {
  const row = db
    .prepare(
      `SELECT l.description, l.funcionario_api_config,
              a.code AS activity_code, a.description AS activity_description,
              co.description AS cost_object_description
         FROM lines l
         LEFT JOIN activities a ON a.id = l.activity_id
         LEFT JOIN cost_objects co ON co.id = l.cost_object_id
        WHERE l.id = ?`,
    )
    .get(lineId) as
    | {
        description?: string;
        funcionario_api_config?: string | null;
        activity_code?: string | null;
        activity_description?: string | null;
        cost_object_description?: string | null;
      }
    | undefined;
  if (!row) return false;
  const config = parseFuncionarioApiConfig(row.funcionario_api_config);
  if (config?.enabled && config.folhaAvulsaSubprocessIds.length && !config.subprocessIds.length) {
    return true;
  }
  if (row.activity_code === "57") return true;
  if (/folha.*avulsa/i.test(String(row.activity_description ?? ""))) return true;
  if (/folha.*avulsa/i.test(String(row.description ?? ""))) return true;
  if (/folha.*avulsa/i.test(String(row.cost_object_description ?? ""))) return true;
  return /administra.*\/\s*controle/i.test(String(row.cost_object_description ?? row.description ?? ""));
}

export async function applyFuncionarioApiToLine(lineId: number, config: FuncionarioApiConfig) {
  if (!config.enabled) {
    throw new Error("Ative a fonte da API para aplicar os valores.");
  }
  if (!Number.isFinite(config.externalSafraId)) {
    throw new Error("Informe o ID externo da safra (ex.: 4).");
  }
  if (!config.subprocessIds.length && !config.folhaAvulsaSubprocessIds.length) {
    throw new Error("Selecione ao menos um subprocesso da API.");
  }
  const payload = await fetchExternFuncionarioOrcamento(config.externalSafraId);
  const folhaAvulsaTarget = isLineFolhaAvulsa(lineId);

  let meses = Array.from({ length: 12 }, () => 0);
  let totalSafra = 0;
  let subprocessos: ExternSubprocess[] = [];

  if (!folhaAvulsaTarget && config.subprocessIds.length) {
    const selected = new Set(config.subprocessIds);
    subprocessos = (payload.subprocessos ?? []).filter((sub) => selected.has(sub.id));
    if (!subprocessos.length) {
      throw new Error("Nenhum subprocesso encontrado na API para os IDs selecionados.");
    }
    meses = Array.from({ length: 12 }, (_, i) =>
      subprocessos.reduce((sum, sub) => sum + (Number(sub.meses?.[i]) || 0), 0),
    );
    totalSafra =
      Math.round(subprocessos.reduce((sum, sub) => sum + (Number(sub.totalSafra) || 0), 0) * 100) / 100;
    writeLineMonths(lineId, meses);
  }

  const lineRow = db
    .prepare("SELECT s.name AS sheet_name FROM lines l JOIN sheets s ON s.id = l.sheet_id WHERE l.id = ?")
    .get(lineId) as { sheet_name: string } | undefined;
  let folhaAvulsa:
    | { lineId: number; meses: number[]; totalSafra: number; created?: boolean }
    | undefined;

  if (config.folhaAvulsaSubprocessIds.length) {
    const faMeses = computeFolhaAvulsaMeses(payload, config.folhaAvulsaSubprocessIds);
    const faTotalSafra = Math.round(faMeses.reduce((sum, value) => sum + value, 0) * 100) / 100;

    if (folhaAvulsaTarget) {
      writeLineMonths(lineId, faMeses);
      meses = faMeses;
      totalSafra = faTotalSafra;
      folhaAvulsa = { lineId, meses: faMeses, totalSafra: faTotalSafra };
    } else if (lineRow) {
      let faLine = findFolhaAvulsaLine(lineRow.sheet_name);
      let created = false;
      if (!faLine) {
        faLine = ensureFolhaAvulsaLine(lineRow.sheet_name);
        created = Boolean(faLine);
      }
      if (faLine) {
        writeLineMonths(faLine.id, faMeses);
        folhaAvulsa = {
          lineId: faLine.id,
          meses: faMeses,
          totalSafra: faTotalSafra,
          created,
        };
      }
    }
  }

  if (folhaAvulsaTarget && !config.folhaAvulsaSubprocessIds.length) {
    throw new Error("Selecione ao menos um subprocesso para folha avulsa.");
  }

  return {
    meses,
    totalSafra,
    mesLabels: payload.meses ?? [],
    subprocessos: subprocessos.map((sub) => ({
      id: sub.id,
      codigo: sub.codigo,
      nome: sub.nome,
      totalSafra: sub.totalSafra ?? 0,
    })),
    folhaAvulsa,
  };
}

export async function fetchExternFuncionarioOrcamento(externalSafraId: number): Promise<ExternOrcamentoPayload> {
  const url = externOrcamentoUrl(externalSafraId);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`API externa retornou ${res.status} (${url})`);
  }
  return (await res.json()) as ExternOrcamentoPayload;
}

function findFuncionarioActivityId() {
  const row = db
    .prepare(
      `SELECT id FROM activities
        WHERE code IN ('09994', '237')
           OR description LIKE '%DESPESA%FUNC%'
        ORDER BY CASE WHEN code = '09994' THEN 0 WHEN code = '237' THEN 1 ELSE 2 END, id
        LIMIT 1`,
    )
    .get() as { id: number } | undefined;
  return row?.id ?? null;
}

function ensureFuncionarioCategory(sheetId: number) {
  const existing = db
    .prepare(
      `SELECT id FROM categories
        WHERE sheet_id = ? AND (name LIKE '%FUNCIONARIO%' OR name LIKE '%FUNCIONÁRIO%')
        ORDER BY sort_order, id LIMIT 1`,
    )
    .get(sheetId) as { id: number } | undefined;
  if (existing) return existing.id;

  const preferred = "DESPESAS COM FUNCIONARIOS PROPRIO";
  let catalog = db.prepare("SELECT id FROM category_catalog WHERE name = ? COLLATE NOCASE").get(preferred) as
    | { id: number }
    | undefined;
  if (!catalog) {
    catalog = { id: Number(db.prepare("INSERT INTO category_catalog (name) VALUES (?)").run(preferred).lastInsertRowid) };
  }
  const max = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS n FROM categories WHERE sheet_id = ?").get(sheetId) as {
    n: number;
  };
  return Number(
    db
      .prepare("INSERT INTO categories (sheet_id, name, sort_order, catalog_id) VALUES (?, ?, ?, ?)")
      .run(sheetId, preferred, max.n + 1, catalog.id).lastInsertRowid,
  );
}

function ensureFuncionarioLine(sheetName: string) {
  const existing = findFuncionarioLine(sheetName);
  if (existing) return existing;

  const sheet = db.prepare("SELECT id FROM sheets WHERE name = ? AND kind = 'cost_center'").get(sheetName) as
    | { id: number }
    | undefined;
  if (!sheet) return undefined;

  const activityId = findFuncionarioActivityId();
  if (!activityId) return undefined;

  const categoryId = ensureFuncionarioCategory(sheet.id);
  const max = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS n FROM lines WHERE category_id = ?").get(categoryId) as {
    n: number;
  };
  const lineId = Number(
    db
      .prepare(
        `INSERT INTO lines (
          sheet_id, category_id, description, is_group, sort_order,
          activity_id, ref_kind, parent_id, use_activity_auto, start_month, end_month
        ) VALUES (?, ?, 'DESPESA/ FUNCIONÁRIOS', 1, ?, ?, 'activity', NULL, 0, 0, 11)`,
      )
      .run(sheet.id, categoryId, max.n + 1, activityId).lastInsertRowid,
  );

  return db
    .prepare("SELECT l.id, l.description, l.sheet_id, s.name AS sheet_name FROM lines l JOIN sheets s ON s.id = l.sheet_id WHERE l.id = ?")
    .get(lineId) as { id: number; description: string; sheet_id: number; sheet_name: string };
}

function findFuncionarioLine(sheetName: string) {
  return db
    .prepare(
      `SELECT l.id, l.description, l.sheet_id, s.name AS sheet_name
         FROM lines l
         JOIN sheets s ON s.id = l.sheet_id
         LEFT JOIN activities a ON a.id = l.activity_id
        WHERE s.name = ?
          AND s.kind = 'cost_center'
          AND l.parent_id IS NULL
          AND (
            a.code IN ('237', '09994')
            OR l.description LIKE '%DESPESA%FUNC%'
            OR a.description LIKE '%DESPESA%FUNC%'
          )
        ORDER BY l.sort_order, l.id
        LIMIT 1`,
    )
    .get(sheetName) as
    | { id: number; description: string; sheet_id: number; sheet_name: string }
    | undefined;
}

function findFolhaAvulsaActivityId() {
  const row = db
    .prepare(
      `SELECT id FROM activities
        WHERE code = '57' OR description LIKE '%FOLHA%AVULSA%'
        ORDER BY CASE WHEN code = '57' THEN 0 ELSE 1 END, id
        LIMIT 1`,
    )
    .get() as { id: number } | undefined;
  return row?.id ?? null;
}

function findFolhaAvulsaLine(sheetName: string) {
  return db
    .prepare(
      `SELECT l.id, l.description, l.sheet_id, s.name AS sheet_name
         FROM lines l
         JOIN sheets s ON s.id = l.sheet_id
         LEFT JOIN activities a ON a.id = l.activity_id
        WHERE s.name = ?
          AND s.kind = 'cost_center'
          AND l.parent_id IS NULL
          AND (
            a.code = '57'
            OR l.description LIKE '%FOLHA%AVULSA%'
            OR a.description LIKE '%FOLHA%AVULSA%'
          )
        ORDER BY l.sort_order, l.id
        LIMIT 1`,
    )
    .get(sheetName) as
    | { id: number; description: string; sheet_id: number; sheet_name: string }
    | undefined;
}

function ensureFolhaAvulsaLine(sheetName: string) {
  const existing = findFolhaAvulsaLine(sheetName);
  if (existing) return existing;

  const sheet = db.prepare("SELECT id FROM sheets WHERE name = ? AND kind = 'cost_center'").get(sheetName) as
    | { id: number }
    | undefined;
  if (!sheet) return undefined;

  const activityId = findFolhaAvulsaActivityId();
  if (!activityId) return undefined;

  const categoryId = ensureFuncionarioCategory(sheet.id);
  const max = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS n FROM lines WHERE category_id = ?").get(categoryId) as {
    n: number;
  };
  const lineId = Number(
    db
      .prepare(
        `INSERT INTO lines (
          sheet_id, category_id, description, is_group, sort_order,
          activity_id, ref_kind, parent_id, use_activity_auto, start_month, end_month
        ) VALUES (?, ?, 'FOLHA AVULSA', 1, ?, ?, 'activity', NULL, 0, 0, 11)`,
      )
      .run(sheet.id, categoryId, max.n + 1, activityId).lastInsertRowid,
  );

  return db
    .prepare("SELECT l.id, l.description, l.sheet_id, s.name AS sheet_name FROM lines l JOIN sheets s ON s.id = l.sheet_id WHERE l.id = ?")
    .get(lineId) as { id: number; description: string; sheet_id: number; sheet_name: string };
}

function writeLineMonths(lineId: number, meses: number[]) {
  db.prepare("DELETE FROM line_months WHERE line_id = ?").run(lineId);
  const ins = db.prepare(
    "INSERT INTO line_months (line_id, month_index, formula, value) VALUES (?, ?, ?, ?)",
  );
  for (let i = 0; i < 12; i += 1) {
    const value = Math.round((Number(meses[i]) || 0) * 100) / 100;
    if (!(value > 0)) continue;
    const text = Number.isInteger(value) ? String(value) : String(value);
    ins.run(lineId, i, `=${text}`, JSON.stringify(value));
  }
  db.prepare("UPDATE lines SET use_activity_auto = 0 WHERE id = ?").run(lineId);
}

export async function previewFuncionarioOrcamentoImport(input: {
  externalSafraId: number;
  localSafraId?: number | null;
}): Promise<FuncionarioImportPreview> {
  const payload = await fetchExternFuncionarioOrcamento(input.externalSafraId);
  const subprocessos = payload.subprocessos ?? [];
  const externLabel = payload.safra?.nome ?? null;
  const code = safraCodeFromExternLabel(externLabel);
  const localSafra =
    input.localSafraId != null
      ? listSafras().find((s) => s.id === resolveSafraId(input.localSafraId))
      : code
        ? listSafras().find((s) => s.code === code)
        : null;

  const itens = subprocessos.map((sub) => {
    const sheetName = sheetForSubprocess(sub);
    const line = sheetName ? findFuncionarioLine(sheetName) : undefined;
    return {
      subprocessId: sub.id,
      subprocessCodigo: sub.codigo,
      subprocessNome: sub.nome,
      sheetName,
      lineId: line?.id ?? null,
      lineDescription: line?.description ?? null,
      meses: (sub.meses ?? []).slice(0, 12),
      totalSafra: sub.totalSafra ?? 0,
      status: !sheetName ? ("no_sheet" as const) : !line ? ("no_line" as const) : ("ready" as const),
    };
  });

  return {
    externalSafraId: input.externalSafraId,
    externalSafraLabel: externLabel,
    localSafraId: localSafra?.id ?? resolveSafraId(input.localSafraId),
    localSafraCode: localSafra?.code ?? code,
    sourceUrl: externOrcamentoUrl(input.externalSafraId),
    meses: payload.meses ?? [],
    geral: {
      orcado: payload.geral?.orcado ?? [],
      folhaAvulsa: payload.geral?.folhaAvulsa ?? [],
      total: payload.geral?.total ?? [],
      totalSafra: payload.geral?.totalSafra ?? 0,
    },
    itens,
  };
}

function lineHasEnabledFuncionarioConfig(lineId: number) {
  const row = db.prepare("SELECT funcionario_api_config FROM lines WHERE id = ?").get(lineId) as
    | { funcionario_api_config?: string | null }
    | undefined;
  const config = parseFuncionarioApiConfig(row?.funcionario_api_config);
  return Boolean(
    config?.enabled && (config.subprocessIds.length || config.folhaAvulsaSubprocessIds.length),
  );
}

export async function refreshAllFuncionarioOrcamentoValues(input: {
  externalSafraId: number;
  localSafraId?: number | null;
}) {
  const configUpdated: { lineId: number; sheetName: string; totalSafra: number }[] = [];

  const rows = db
    .prepare(
      `SELECT l.id, l.funcionario_api_config, s.name AS sheet_name
         FROM lines l
         JOIN sheets s ON s.id = l.sheet_id
        WHERE s.kind = 'cost_center'
          AND l.parent_id IS NULL
          AND l.funcionario_api_config IS NOT NULL
          AND TRIM(l.funcionario_api_config) <> ''`,
    )
    .all() as Array<{ id: number; funcionario_api_config: string; sheet_name: string }>;

  for (const row of rows) {
    const config = parseFuncionarioApiConfig(row.funcionario_api_config);
    if (!config?.enabled || (!config.subprocessIds.length && !config.folhaAvulsaSubprocessIds.length)) {
      continue;
    }
    const configToApply = { ...config, externalSafraId: input.externalSafraId };
    const applied = await applyFuncionarioApiToLine(row.id, configToApply);
    db.prepare("UPDATE lines SET funcionario_api_config = ? WHERE id = ?").run(
      serializeFuncionarioApiConfig(configToApply),
      row.id,
    );
    configUpdated.push({
      lineId: row.id,
      sheetName: row.sheet_name,
      totalSafra: applied.totalSafra,
    });
  }

  const importResult = await importFuncionarioOrcamento({
    externalSafraId: input.externalSafraId,
    localSafraId: input.localSafraId,
    apply: true,
    createMissingLines: true,
    skipConfiguredSheets: true,
  });

  return {
    externalSafraId: input.externalSafraId,
    externalSafraLabel: importResult.externalSafraLabel,
    localSafraId: importResult.localSafraId,
    localSafraCode: importResult.localSafraCode,
    configUpdated,
    importUpdated: importResult.updated,
    skipped: importResult.skipped,
    updatedCount: configUpdated.length + importResult.updated.length,
    configUpdatedCount: configUpdated.length,
    importUpdatedCount: importResult.updated.length,
    skippedCount: importResult.skipped.length,
  };
}

export async function importFuncionarioOrcamento(input: {
  externalSafraId: number;
  localSafraId?: number | null;
  apply?: boolean;
  createMissingLines?: boolean;
  skipConfiguredSheets?: boolean;
}) {
  const preview = await previewFuncionarioOrcamentoImport(input);
  const updated: { lineId: number; sheetName: string; totalSafra: number; created?: boolean }[] = [];
  const skipped: FuncionarioImportPreview["itens"] = [];

  if (input.apply !== false) {
    const bySheet = new Map<
      string,
      { meses: number[]; totalSafra: number; subprocessIds: number[] }
    >();

    for (const item of preview.itens) {
      if (!item.sheetName) {
        skipped.push(item);
        continue;
      }
      const bucket = bySheet.get(item.sheetName) ?? {
        meses: Array.from({ length: 12 }, () => 0),
        totalSafra: 0,
        subprocessIds: [],
      };
      for (let i = 0; i < 12; i += 1) {
        bucket.meses[i] += Number(item.meses[i]) || 0;
      }
      bucket.totalSafra += item.totalSafra || 0;
      bucket.subprocessIds.push(item.subprocessId);
      bySheet.set(item.sheetName, bucket);
    }

    for (const [sheetName, bucket] of bySheet) {
      let line = findFuncionarioLine(sheetName);
      if (line && input.skipConfiguredSheets && lineHasEnabledFuncionarioConfig(line.id)) {
        continue;
      }
      let created = false;
      if (!line && input.createMissingLines !== false) {
        line = ensureFuncionarioLine(sheetName);
        created = Boolean(line);
      }
      if (!line) {
        skipped.push({
          subprocessId: bucket.subprocessIds[0],
          subprocessCodigo: "",
          subprocessNome: bucket.subprocessIds.map(String).join(", "),
          sheetName,
          lineId: null,
          lineDescription: null,
          meses: bucket.meses,
          totalSafra: bucket.totalSafra,
          status: "no_line",
        });
        continue;
      }
      writeLineMonths(line.id, bucket.meses);
      updated.push({
        lineId: line.id,
        sheetName,
        totalSafra: Math.round(bucket.totalSafra * 100) / 100,
        created,
      });
    }
  }

  return {
    ...preview,
    applied: input.apply !== false,
    updated,
    skipped,
    updatedCount: updated.length,
    skippedCount: skipped.length,
  };
}
