export type EntradaCanaImportType = "maquina" | "caminhao" | "tempo_patio";
export type EntradaCanaOperationMode = "insert" | "update";
export type EntradaCanaTipoColheitaMode = "planilha" | "MECANIZADA" | "MANUAL";

export interface EntradaCanaImportOptions {
  importType: EntradaCanaImportType;
  apiUrl?: string;
  tipoColheitaMode: EntradaCanaTipoColheitaMode;
  operationMode: EntradaCanaOperationMode;
  safraSelect?: string;
  safraCustom?: string;
  sheetName?: string;
  maxRows?: number | null;
  headerRow?: number;
  startRow?: number;
  dryRun: boolean;
  autoHeader: boolean;
}

export interface EntradaCanaFileInput {
  name: string;
  sheetName?: string;
  grid: unknown[][];
}

export interface EntradaCanaImportStats {
  processed: number;
  ok: number;
  err: number;
  skip: number;
  dupSkip: number;
  headerRowNum: number | null;
}

export interface EntradaCanaImportResult {
  stats: EntradaCanaImportStats;
  okLog: string[];
  errLog: string[];
  logLines: string[];
}

const DEFAULT_API_URLS = {
  maquina: process.env.ORDS_ENTRADA_CANA_MAQUINA_URL ?? "",
  caminhao: process.env.ORDS_ENTRADA_CANA_CAMINHAO_URL ?? "",
  tempo_patio: process.env.ORDS_TEMPO_PATIO_URL ?? "",
};

export function entradaCanaConfig() {
  return {
    apiUrls: { ...DEFAULT_API_URLS },
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function normalizeHeader(s: unknown) {
  if (s == null) return "";
  return String(s)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function parseExcelCell(v: unknown) {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  if (v instanceof Date) {
    const yyyy = v.getFullYear();
    const mm = String(v.getMonth() + 1).padStart(2, "0");
    const dd = String(v.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return String(v).trim();
}

function parseDateToApiTimestamp(v: unknown) {
  if (v == null) return "";
  if (v instanceof Date) {
    const yyyy = v.getFullYear();
    const mm = String(v.getMonth() + 1).padStart(2, "0");
    const dd = String(v.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T00:00:00Z`;
  }
  const s0 = String(v).trim();
  if (!s0) return "";

  const m1 = s0.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m1) {
    const dd = String(parseInt(m1[1], 10)).padStart(2, "0");
    const mm = String(parseInt(m1[2], 10)).padStart(2, "0");
    let yy = m1[3];
    if (yy.length === 2) yy = String(2000 + parseInt(yy, 10));
    return `${yy}-${mm}-${dd}T00:00:00Z`;
  }
  const m2 = s0.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m2) {
    const yyyy = m2[1];
    const mm = String(parseInt(m2[2], 10)).padStart(2, "0");
    const dd = String(parseInt(m2[3], 10)).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T00:00:00Z`;
  }
  const m3 = s0.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m3) {
    const yyyy = m3[1];
    const mm = String(parseInt(m3[2], 10)).padStart(2, "0");
    const dd = String(parseInt(m3[3], 10)).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T00:00:00Z`;
  }
  if (s0.includes("T")) return parseDateToApiTimestamp(s0.split("T")[0]);
  if (s0.includes(" ")) return parseDateToApiTimestamp(s0.split(" ")[0]);
  return s0;
}

export function parseDateToApiDay(v: unknown) {
  return parseDateToApiTimestamp(v).slice(0, 10);
}

function parseNumberToString(v: unknown) {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  const s0 = String(v).trim();
  if (!s0) return "";
  const hasComma = s0.includes(",");
  const hasDot = s0.includes(".");
  const s = hasComma
    ? s0.replace(/\./g, "").replace(",", ".")
    : hasDot
      ? s0
      : s0.replace(/\s+/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return s0;
  return n.toString();
}

export function parseNumberToApi(v: unknown) {
  const s = parseNumberToString(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
}

export function compactPayload(payload: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value == null || value === "") continue;
    out[key] = value;
  }
  return out;
}

export function normalizeSafraForEntradaCaminhao(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const match = raw.match(/(\d{2}|\d{4})\s*\/\s*(\d{2}|\d{4})/);
  if (!match) return raw;
  const start = match[1].length === 2 ? 2000 + Number(match[1]) : Number(match[1]);
  const end = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return raw;
  return `${start}/${end}`;
}

function isHeaderToken(value: unknown, candidates: string[]) {
  const n = normalizeHeader(value);
  if (!n) return false;
  return candidates.some((c) => n === normalizeHeader(c));
}

function parseTimeCell(v: unknown) {
  if (v == null) return "";
  if (v instanceof Date) {
    const hh = String(v.getHours()).padStart(2, "0");
    const mm = String(v.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  const s0 = String(v).trim();
  if (!s0) return "";
  const m = s0.match(/^(\d{1,2}):(\d{2})/);
  if (m) return `${String(parseInt(m[1], 10)).padStart(2, "0")}:${m[2]}`;
  return s0;
}

function guessKeyByHeader(normalizedHeader: string, importType: EntradaCanaImportType) {
  if (!normalizedHeader) return null;
  const rules =
    importType === "tempo_patio"
      ? [
          { key: "pesagem", patterns: ["pesagem", "ticket", "romaneio"] },
          { key: "fazenda", patterns: ["fazenda", "faz", "propriedade"] },
          { key: "talhao", patterns: ["talhao", "talh", "lote"] },
          { key: "data", patterns: ["data", "datamovimento", "dtmovimento"] },
          { key: "hora_chegada", patterns: ["horachegada", "chegada", "chegad"] },
          { key: "hora_saida", patterns: ["horasaida", "saida"] },
          { key: "hora_saida_campo", patterns: ["horasaidacampo", "campo"] },
          { key: "tempo_percurso", patterns: ["tempopercurso", "percurso"] },
          { key: "tempo_patio", patterns: ["tempopatio", "patio"] },
          { key: "tempo_descarga", patterns: ["tempodescarga", "descarg", "descarga"] },
          { key: "tempo_total", patterns: ["tempototal", "total"] },
          { key: "peso_ton", patterns: ["peso", "pesoton", "ton"] },
        ]
      : importType === "caminhao"
      ? [
          { key: "rowid", patterns: ["rowid", "id", "codigo", "cod", "chave"] },
          { key: "pesagem", patterns: ["pesagem", "idpesagem", "ticket", "romaneio"] },
          { key: "guia", patterns: ["guia", "guiaentrada", "numguia"] },
          { key: "caminhao", patterns: ["caminhao", "placa", "veiculo"] },
          { key: "talhao", patterns: ["talhao", "talh", "lote", "quadra"] },
          { key: "etapa", patterns: ["etapa", "fase"] },
          { key: "data", patterns: ["data", "datapesagem", "dt", "dtmovimento"] },
          { key: "intqueima", patterns: ["intqueima", "queima", "indicequeima"] },
          { key: "pesobruto", patterns: ["pesobruto", "bruto", "pesobru"] },
          { key: "pesotara", patterns: ["pesotara", "tara"] },
          { key: "pesoliquido", patterns: ["pesoliquido", "liquido", "pesoliq"] },
          { key: "fazenda", patterns: ["fazenda", "faz", "propriedade"] },
          { key: "safra", patterns: ["safra", "safracolheita", "safracana", "periodocolheita"] },
          {
            key: "tipocolheita",
            patterns: ["tipocolheita", "tipodacolheita", "tipodecolheita", "tipo_colheita", "colheitatipo", "colheitamodo", "modo"],
          },
        ]
      : [
          { key: "rowid", patterns: ["rowid", "id", "codigo", "cod", "chave"] },
          { key: "maquina", patterns: ["maquina", "maq", "equipamento"] },
          { key: "fazenda", patterns: ["fazenda", "faz", "propriedade"] },
          { key: "talhao", patterns: ["talhao", "talh", "lote", "quadra"] },
          { key: "datacolheita", patterns: ["datacolheita", "data", "dtcolheita", "dtdata"] },
          {
            key: "tipocolheita",
            patterns: ["tipocolheita", "tipodacolheita", "tipodecolheita", "tipo_colheita", "colheitatipo", "colheitamodo", "modo"],
          },
          { key: "tipocana", patterns: ["tipocana", "tipodacana", "tipodecana", "tipo_cana", "cana", "variedade"] },
          { key: "peso", patterns: ["peso", "tonelada", "kg", "pesototal", "pesottotal"] },
          { key: "impmineral", patterns: ["impmineral", "impureza", "mineral", "imp"] },
        ];
  for (const r of rules) {
    for (const p of r.patterns) {
      if (normalizedHeader.includes(p)) return r.key;
    }
  }
  return null;
}

function shouldSkipRow(payload: Record<string, unknown>, importType: EntradaCanaImportType) {
  if (importType === "tempo_patio") {
    const p = String(payload.pesagem ?? "").trim();
    const d = String(payload.data_movimento ?? "").trim();
    if (!p || !d) return true;
    if (
      isHeaderToken(payload.pesagem, ["pesagem"]) ||
      isHeaderToken(payload.fazenda, ["fazenda"]) ||
      isHeaderToken(payload.talhao, ["talhao", "talhão"]) ||
      isHeaderToken(payload.data_movimento, ["data"])
    ) {
      return true;
    }
    if (!/^\d+$/.test(p.replace(/\s+/g, ""))) return true;
    const fl = String(payload.fazenda ?? "").toLowerCase();
    if (fl.startsWith("total")) return true;
    if (fl.startsWith("média") || fl.startsWith("media")) return true;
    if (fl.includes("caminhão") || fl.includes("caminhao")) return true;
    return false;
  }

  if (importType === "caminhao") {
    const c = String(payload.caminhao ?? "").trim();
    const d = String(payload.data ?? "").trim();
    const p = String(payload.pesagem ?? "").trim();
    if (!c || !d) return true;
    if (
      isHeaderToken(payload.pesagem, ["pesagem"]) ||
      isHeaderToken(payload.guia, ["guia"]) ||
      isHeaderToken(payload.caminhao, ["caminhao", "caminhão"]) ||
      isHeaderToken(payload.talhao, ["talhao", "talhão"]) ||
      isHeaderToken(payload.etapa, ["etapa"]) ||
      isHeaderToken(payload.data, ["data"]) ||
      isHeaderToken(payload.intqueima, ["intqueima", "int. de queima"]) ||
      isHeaderToken(payload.pesobruto, ["pesobruto", "pesos em (ton)"]) ||
      isHeaderToken(payload.fazenda, ["fazenda"]) ||
      isHeaderToken(payload.safra, ["safra"])
    ) {
      return true;
    }
    if (p && !/^\d+$/.test(p.replace(/\s+/g, ""))) return true;
    const cl = c.toLowerCase();
    if (cl.startsWith("total")) return true;
    if (cl.startsWith("categoria")) return true;
    if (cl.startsWith("usuario")) return true;
    if (cl.startsWith("usuário")) return true;
    if (cl.includes(":")) return true;
    return false;
  }

  const m = String(payload.maquina ?? "").trim();
  const d = String(payload.datacolheita ?? "").trim();
  if (!m || !d) return true;
  if (!/^\d+$/.test(m.replace(/\s+/g, ""))) return true;
  const ml = m.toLowerCase();
  if (ml.startsWith("total")) return true;
  if (ml.startsWith("prestador")) return true;
  if (ml.startsWith("categoria")) return true;
  if (ml.startsWith("usuario")) return true;
  if (ml.startsWith("usuário")) return true;
  if (ml.startsWith("coruripe")) return true;
  if (ml.includes("máquina") && payload.fazenda === "" && payload.talhao === "") return true;
  if (ml.includes(":")) return true;
  return false;
}

function isUniqueConstraintViolation(text: string) {
  return text.includes("ORA-00001");
}

async function postJson(apiUrl: string, payload: Record<string, unknown>) {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function putJson(url: string, payload: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function getItemsByQ(apiUrl: string, qObj: Record<string, unknown>) {
  const q = encodeURIComponent(JSON.stringify(qObj));
  const url = `${apiUrl}?q=${q}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET q failed HTTP ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as { items?: unknown[] };
  return Array.isArray(data.items) ? data.items : [];
}

function pickSelfHref(item: { links?: { rel?: string; href?: string }[] }) {
  const links = item?.links ?? [];
  const self = links.find((l) => l.rel === "self" || l.rel === "edit");
  return self?.href ?? null;
}

function datesAreEquivalent(a: unknown, b: unknown) {
  const aNorm = parseDateToApiTimestamp(a ?? "");
  const bNorm = parseDateToApiTimestamp(b ?? "");
  if (aNorm && bNorm) return aNorm.slice(0, 10) === bNorm.slice(0, 10);
  return String(a ?? "") === String(b ?? "");
}

function samePesagemApi(a: unknown, b: unknown) {
  const sa = String(a != null ? a : "").trim();
  const sb = String(b != null ? b : "").trim();
  if (sa === sb) return true;
  const na = Number(sa.replace(/\./g, "").replace(",", "."));
  const nb = Number(sb.replace(/\./g, "").replace(",", "."));
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return false;
}

async function findExistingSelfHref(
  apiUrl: string,
  importType: EntradaCanaImportType,
  payload: Record<string, unknown>,
) {
  if (importType === "tempo_patio") {
    const pesagemStr = payload.pesagem != null && String(payload.pesagem).trim() ? String(payload.pesagem).trim() : "";
    if (!pesagemStr) return null;
    const qObj: Record<string, unknown> = { pesagem: pesagemStr };
    try {
      const items = (await getItemsByQ(apiUrl, qObj)) as Record<string, unknown>[];
      const match =
        items.find((it) => {
          const okPes = samePesagemApi(it.pesagem, payload.pesagem);
          const okData = payload.data_movimento ? datesAreEquivalent(it.data_movimento, payload.data_movimento) : true;
          return okPes && okData;
        }) ?? items.find((it) => samePesagemApi(it.pesagem, payload.pesagem));
      if (match) return pickSelfHref(match as { links?: { rel?: string; href?: string }[] });
    } catch {
      /* ignore */
    }
    return null;
  }

  if (importType === "maquina") {
    const maquinaNum = payload.maquina != null && payload.maquina !== "" ? Number(String(payload.maquina)) : null;
    const talhaoNum = payload.talhao != null && payload.talhao !== "" ? Number(String(payload.talhao)) : null;
    const base: Record<string, unknown> = {};
    if (Number.isFinite(maquinaNum)) base.maquina = maquinaNum;
    if (talhaoNum != null && Number.isFinite(talhaoNum)) base.talhao = talhaoNum;
    if (payload.fazenda != null && String(payload.fazenda).trim()) base.fazenda = payload.fazenda;

    const candidates: Record<string, unknown>[] = [];
    const rich = { ...base };
    if (payload.tipocolheita) rich.tipocolheita = payload.tipocolheita;
    if (payload.tipocana) rich.tipocana = payload.tipocana;
    if (Object.keys(rich).length) candidates.push(rich);
    if (Object.keys(base).length) candidates.push(base);

    for (const qObj of candidates) {
      try {
        const items = (await getItemsByQ(apiUrl, qObj)) as Record<string, unknown>[];
        const match = items.find((it) => {
          const okData = payload.datacolheita ? datesAreEquivalent(it.datacolheita, payload.datacolheita) : true;
          const okTipoCol = payload.tipocolheita ? String(it.tipocolheita ?? "") === String(payload.tipocolheita) : true;
          const okTipoCana = payload.tipocana ? String(it.tipocana ?? "") === String(payload.tipocana) : true;
          return okData && okTipoCol && okTipoCana;
        });
        if (match) {
          const href = pickSelfHref(match as { links?: { rel?: string; href?: string }[] });
          if (href) return href;
        }
      } catch {
        /* tenta próximo candidato */
      }
    }
    return null;
  }

  const pesagemNum =
    payload.pesagem != null && payload.pesagem !== "" ? Number(String(payload.pesagem).replace(/\s+/g, "")) : null;
  const pesagemStr = payload.pesagem != null && String(payload.pesagem).trim() ? String(payload.pesagem).trim() : "";

  const pesagemOnly: Record<string, unknown> = {};
  if (Number.isFinite(pesagemNum)) pesagemOnly.pesagem = pesagemNum;
  else if (pesagemStr) pesagemOnly.pesagem = pesagemStr;

  const base: Record<string, unknown> = { ...pesagemOnly };
  if (payload.guia != null && String(payload.guia).trim()) base.guia = String(payload.guia).trim();
  if (payload.caminhao != null && String(payload.caminhao).trim()) base.caminhao = String(payload.caminhao).trim();
  if (payload.fazenda != null && String(payload.fazenda).trim()) base.fazenda = String(payload.fazenda).trim();

  const candidates: Record<string, unknown>[] = [];
  if (Object.keys(pesagemOnly).length) candidates.push(pesagemOnly);

  const rich = { ...base };
  if (payload.talhao) rich.talhao = payload.talhao;
  if (payload.etapa) rich.etapa = payload.etapa;
  if (Object.keys(rich).length > Object.keys(pesagemOnly).length) candidates.push(rich);
  if (Object.keys(base).length > Object.keys(pesagemOnly).length) candidates.push(base);

  function pickMatchFromItems(items: Record<string, unknown>[]) {
    if (!items?.length) return null;
    const byPes = items.filter((it) => samePesagemApi(it.pesagem, payload.pesagem));
    if (byPes.length === 1) return byPes[0];
    if (byPes.length > 1) {
      return (
        byPes.find((it) => {
          const okGuia = payload.guia ? String(it.guia ?? "").trim() === String(payload.guia ?? "").trim() : true;
          const okCaminhao = payload.caminhao ? String(it.caminhao ?? "").trim() === String(payload.caminhao ?? "").trim() : true;
          const okData = payload.data ? datesAreEquivalent(it.data, payload.data) : true;
          return okGuia && okCaminhao && okData;
        }) ?? byPes[0]
      );
    }
    if (items.length === 1 && samePesagemApi(items[0].pesagem, payload.pesagem)) return items[0];
    return items.find((it) => samePesagemApi(it.pesagem, payload.pesagem)) ?? null;
  }

  for (const qObj of candidates) {
    try {
      const items = (await getItemsByQ(apiUrl, qObj)) as Record<string, unknown>[];
      const match = pickMatchFromItems(items);
      if (match) {
        const href = pickSelfHref(match as { links?: { rel?: string; href?: string }[] });
        if (href) return href;
      }
    } catch {
      /* tenta próximo candidato */
    }
  }
  return null;
}

function getRequiredKeys(importType: EntradaCanaImportType) {
  if (importType === "tempo_patio") {
    return ["pesagem", "fazenda", "talhao", "data", "peso_ton"];
  }
  if (importType === "caminhao") {
    return ["pesagem", "guia", "caminhao", "talhao", "etapa", "data", "intqueima", "pesobruto", "pesotara", "pesoliquido", "fazenda"];
  }
  return ["maquina", "fazenda", "talhao", "datacolheita", "tipocana", "peso", "impmineral"];
}

function findBestHeaderRow(grid: unknown[][], importType: EntradaCanaImportType, maxScan = 40) {
  const wanted =
    importType === "tempo_patio"
      ? ["pesagem", "fazenda", "talhao", "data", "peso"]
      : importType === "caminhao"
        ? ["pesagem", "guia", "caminhao", "data", "pesobruto", "pesoliquido"]
        : ["maquina", "fazenda", "talhao", "datacolheita"];
  let best = { idx: -1, score: -1 };
  const scan = Math.min(maxScan, grid.length);
  for (let r = 0; r < scan; r++) {
    const row = grid[r] ?? [];
    const norm = row.map(normalizeHeader);
    let score = 0;
    for (const w of wanted) {
      if (norm.some((h) => h.includes(w))) score++;
    }
    if (score > best.score) best = { idx: r + 1, score };
  }
  return best.idx;
}

function resolveSafraCaminhao(
  row: unknown[],
  colMap: Record<string, number>,
  safraSelectVal: string,
  safraCustomText: string,
) {
  const custom = (safraCustomText || "").trim();
  if (custom) return normalizeSafraForEntradaCaminhao(custom);
  const preset = (safraSelectVal || "").trim();
  if (preset) return normalizeSafraForEntradaCaminhao(preset);
  if (colMap.safra != null) return normalizeSafraForEntradaCaminhao(parseExcelCell(row[colMap.safra]));
  return "";
}

function buildPayload(
  row: unknown[],
  colMap: Record<string, number>,
  importType: EntradaCanaImportType,
  tipoColheitaMode: EntradaCanaTipoColheitaMode,
  safraSelectVal: string,
  safraCustomText: string,
): Record<string, unknown> {
  if (importType === "tempo_patio") {
    return compactPayload({
      pesagem: parseExcelCell(row[colMap.pesagem]),
      fazenda: parseExcelCell(row[colMap.fazenda]),
      talhao: parseExcelCell(row[colMap.talhao]),
      data_movimento: parseDateToApiTimestamp(row[colMap.data]),
      hora_chegada: parseTimeCell(row[colMap.hora_chegada]),
      hora_saida: parseTimeCell(row[colMap.hora_saida]),
      hora_saida_campo: parseTimeCell(row[colMap.hora_saida_campo]),
      tempo_percurso: parseTimeCell(row[colMap.tempo_percurso]),
      tempo_patio: parseTimeCell(row[colMap.tempo_patio]),
      tempo_descarga: parseTimeCell(row[colMap.tempo_descarga]),
      tempo_total: parseTimeCell(row[colMap.tempo_total]),
      peso_ton: parseNumberToApi(row[colMap.peso_ton]),
    });
  }

  if (importType === "caminhao") {
    const rowidVal = colMap.rowid != null ? parseExcelCell(row[colMap.rowid]) : null;
    const tipoColheitaValor =
      tipoColheitaMode === "planilha"
        ? colMap.tipocolheita != null
          ? parseExcelCell(row[colMap.tipocolheita])
          : ""
        : tipoColheitaMode;
    const safraVal = resolveSafraCaminhao(row, colMap, safraSelectVal, safraCustomText);
    return compactPayload({
      rowid: rowidVal && String(rowidVal).trim() ? String(rowidVal).trim() : null,
      pesagem: parseNumberToApi(row[colMap.pesagem]),
      guia: parseNumberToApi(row[colMap.guia]),
      caminhao: parseNumberToApi(row[colMap.caminhao]),
      talhao: parseNumberToApi(row[colMap.talhao]),
      etapa: parseNumberToApi(row[colMap.etapa]),
      data: parseDateToApiTimestamp(row[colMap.data]),
      intqueima: parseNumberToApi(row[colMap.intqueima]),
      pesobruto: parseNumberToApi(row[colMap.pesobruto]),
      pesotara: parseNumberToApi(row[colMap.pesotara]),
      pesoliquido: parseNumberToApi(row[colMap.pesoliquido]),
      fazenda: parseExcelCell(row[colMap.fazenda]),
      safra: safraVal,
      tipocolheita: tipoColheitaValor,
    });
  }

  const pesoStr = parseNumberToString(row[colMap.peso]);
  const impStr = parseNumberToString(row[colMap.impmineral]);
  const rowidVal = colMap.rowid != null ? parseExcelCell(row[colMap.rowid]) : null;
  const tipoColheitaValor =
    tipoColheitaMode === "planilha"
      ? colMap.tipocolheita != null
        ? parseExcelCell(row[colMap.tipocolheita])
        : ""
      : tipoColheitaMode;
  return {
    rowid: rowidVal && String(rowidVal).trim() ? String(rowidVal).trim() : null,
    maquina: parseExcelCell(row[colMap.maquina]),
    fazenda: parseExcelCell(row[colMap.fazenda]),
    talhao: parseExcelCell(row[colMap.talhao]),
    datacolheita: parseDateToApiTimestamp(row[colMap.datacolheita]),
    tipocolheita: tipoColheitaValor,
    tipocana: parseExcelCell(row[colMap.tipocana]),
    peso: pesoStr,
    impmineral: impStr === "" ? null : impStr,
  };
}

export async function runEntradaCanaImport(
  files: EntradaCanaFileInput[],
  options: EntradaCanaImportOptions,
): Promise<EntradaCanaImportResult> {
  const importType = options.importType;
  const apiUrl = (options.apiUrl?.trim() || DEFAULT_API_URLS[importType]).trim();
  if (!apiUrl) throw new Error(`Configure a URL ORDS para importacao de entrada de cana (${importType}).`);
  if (!apiUrl) throw new Error("Informe a URL da API.");

  const logLines: string[] = [];
  const okLog: string[] = [];
  const errLog: string[] = [];
  const st: EntradaCanaImportStats = { processed: 0, ok: 0, err: 0, skip: 0, dupSkip: 0, headerRowNum: null };

  const pushLog = (msg: string) => logLines.push(msg);

  pushLog(`Arquivos: ${files.length}`);
  pushLog(
    `Tipo: ${
      importType === "tempo_patio"
        ? "TEMPO PATIO"
        : importType === "caminhao"
          ? "ENTRADA CANA CAMINHAO"
          : "ENTRADA CANA MAQUINA"
    }`,
  );
  pushLog(`Operacao: ${options.operationMode === "update" ? "UPDATE (PUT)" : "INSERCAO (POST)"}`);
  if (importType !== "tempo_patio") {
    pushLog(`Tipo colheita: ${options.tipoColheitaMode === "planilha" ? "COLUNA DA PLANILHA" : options.tipoColheitaMode}`);
  }
  if (importType === "caminhao") {
    const sc = (options.safraCustom ?? "").trim();
    const ss = (options.safraSelect ?? "").trim();
    if (sc) pushLog(`Safra (fixa digitada): ${sc}`);
    else if (ss) pushLog(`Safra (lista): ${ss}`);
    else pushLog("Safra: coluna da planilha (se existir)");
  }
  pushLog(`Modo: ${options.dryRun ? "DRY RUN" : "ENVIO REAL"}`);
  if (options.maxRows != null) pushLog(`Max linhas por arquivo: ${options.maxRows}`);

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    const sourceFile = file.name;
    let rowsThisFile = 0;

    pushLog(`---------- ${fi + 1}/${files.length}: ${sourceFile} ----------`);

    try {
      const grid = file.grid;
      if (!grid.length) throw new Error("Planilha vazia / não foi possível ler as células.");

      let headerRowNum = options.headerRow;
      if (!headerRowNum && options.autoHeader) {
        headerRowNum = findBestHeaderRow(grid, importType, 40);
      }
      if (!headerRowNum) throw new Error("Não foi possível determinar headerRow automaticamente. Use Linha do cabeçalho.");

      st.headerRowNum = headerRowNum;

      const headerIndex = headerRowNum - 1;
      const headers = (grid[headerIndex] ?? []).map((h) => String(h).trim());

      const colMap: Record<string, number> = {};
      for (let c = 0; c < headers.length; c++) {
        const key = guessKeyByHeader(normalizeHeader(headers[c]), importType);
        if (key && colMap[key] == null) colMap[key] = c;
      }

      if (importType === "caminhao") {
        colMap.pesobruto = 12;
        colMap.pesotara = 13;
        colMap.pesoliquido = 14;
      }

      if (importType === "tempo_patio") {
        colMap.pesagem = 8;
        colMap.fazenda = 9;
        colMap.talhao = 10;
        colMap.data = 11;
        colMap.hora_chegada = 14;
        colMap.hora_saida = 18;
        colMap.hora_saida_campo = 19;
        colMap.tempo_percurso = 21;
        colMap.tempo_patio = 22;
        colMap.tempo_descarga = 23;
        colMap.tempo_total = 24;
        colMap.peso_ton = 26;
      }

      const required = getRequiredKeys(importType);
      const missing = required.filter((k) => colMap[k] == null);
      if (missing.length) throw new Error("Faltando mapear colunas: " + missing.join(", "));

      const effectiveStart = options.startRow ? options.startRow : headerRowNum + 1;
      const firstIndex = Math.max(effectiveStart - 1, 0);
      const sheetName = file.sheetName ?? "(padrão)";
      pushLog(`Aba: ${sheetName} | headerRow=${headerRowNum} | startRow=${effectiveStart}`);

      for (let r = firstIndex; r < grid.length; r++) {
        const row = grid[r] ?? [];

        st.processed++;
        rowsThisFile++;
        if (options.maxRows != null && rowsThisFile > options.maxRows) break;

        const payload = buildPayload(
          row,
          colMap,
          importType,
          options.tipoColheitaMode,
          options.safraSelect ?? "",
          options.safraCustom ?? "",
        );

        if (shouldSkipRow(payload, importType)) {
          st.skip++;
          continue;
        }

        if (options.dryRun) {
          st.ok++;
          okLog.push(JSON.stringify({ sourceFile, sheet: sheetName, payload }));
          await sleep(30);
          continue;
        }

        if (options.operationMode === "insert") {
          let retries = 0;
          let resp: { ok: boolean; status: number; text: string } | null = null;
          while (true) {
            resp = await postJson(apiUrl, payload);
            if (resp.status === 429 && retries < 5) {
              retries++;
              await sleep(1000 + retries * 500);
              continue;
            }
            break;
          }

          if (resp!.ok) {
            st.ok++;
            okLog.push(JSON.stringify({ sourceFile, sheet: sheetName, payload, status: resp!.status, response: resp!.text, operation: "insert" }));
          } else {
            if ((importType === "maquina" || importType === "tempo_patio") && isUniqueConstraintViolation(resp!.text))
              st.dupSkip++;
            else st.err++;
            errLog.push(
              JSON.stringify({
                sourceFile,
                sheet: sheetName,
                payload,
                status: resp!.status,
                response: String(resp!.text || "").slice(0, 5000),
                operation: "insert",
              }),
            );
            pushLog(
              `[${sourceFile}] [ERRO] linha ${r + 1} HTTP ${resp!.status}: ${String(resp!.text || "").slice(0, 140).replace(/\s+/g, " ")}`,
            );
          }
        } else {
          const selfHref = await findExistingSelfHref(apiUrl, importType, payload);
          if (!selfHref) {
            st.err++;
            errLog.push(
              JSON.stringify({
                sourceFile,
                sheet: sheetName,
                payload,
                status: 404,
                response: "Registro para update nao encontrado via GET q.",
                operation: "update",
              }),
            );
            pushLog(`[${sourceFile}] [ERRO] linha ${r + 1}: registro para update nao encontrado.`);
            await sleep(80);
            continue;
          }

          let retries = 0;
          let putRes: { ok: boolean; status: number; text: string } | null = null;
          while (true) {
            putRes = await putJson(selfHref, payload);
            if (putRes.status === 429 && retries < 5) {
              retries++;
              await sleep(1000 + retries * 500);
              continue;
            }
            break;
          }

          if (putRes!.ok) {
            st.ok++;
            okLog.push(
              JSON.stringify({
                sourceFile,
                sheet: sheetName,
                payload,
                status: putRes!.status,
                response: putRes!.text,
                operation: "update",
                updated: true,
              }),
            );
          } else {
            st.err++;
            errLog.push(
              JSON.stringify({
                sourceFile,
                sheet: sheetName,
                payload,
                status: putRes!.status,
                response: String(putRes!.text || "").slice(0, 5000),
                operation: "update",
                updateFailed: true,
              }),
            );
            pushLog(
              `[${sourceFile}] [ERRO] linha ${r + 1} HTTP ${putRes!.status}: ${String(putRes!.text || "").slice(0, 140).replace(/\s+/g, " ")}`,
            );
          }
        }

        await sleep(80);
      }
    } catch (fileErr) {
      const m = fileErr instanceof Error ? fileErr.message : String(fileErr);
      pushLog(`Falha em "${sourceFile}": ${m}`);
    }
  }

  pushLog("Concluído (todas as planilhas).");
  pushLog(
    JSON.stringify(
      {
        importType,
        arquivos: files.length,
        headerRowNum: st.headerRowNum,
        ok: st.ok,
        err: st.err,
        skip: st.skip,
        dupSkip: st.dupSkip,
        dryRun: options.dryRun,
      },
      null,
      2,
    ),
  );

  return { stats: st, okLog, errLog, logLines };
}
