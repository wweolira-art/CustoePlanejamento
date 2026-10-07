import { normalizePeriodoColheita } from "./periodo-colheita.js";

export const ORDS_PAGE_SIZE = 500;
export const ORDS_MAX_ROWS = 20000;
export const ORDS_MAX_UPDATES = 5000;

export function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseDataDia(value: unknown): Date | null {
  if (value == null || String(value).trim() === "") return null;
  const s = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

export function diaUtcFromIso(iso: unknown): string | null {
  if (!iso) return null;
  const s = String(iso).trim();
  if (!s) return null;
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})/);
  if (br) {
    const dd = Number(br[1]);
    const mm = Number(br[2]);
    let yyyy = Number(br[3]);
    if (br[3].length === 2) yyyy += yyyy >= 90 ? 1900 : 2000;
    if (yyyy >= 1900 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }
  const isoDay = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDay) return `${isoDay[1]}-${isoDay[2]}-${isoDay[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function selfHrefFromItem(item: { links?: { rel?: string; href?: string }[] }) {
  const links = Array.isArray(item?.links) ? item.links : [];
  const self = links.find((l) => l?.rel === "self" && l?.href);
  return self?.href ? String(self.href) : null;
}

export function parsePeriodoObrigatorio(filtros: { dataInicio?: string | null; dataFim?: string | null }) {
  const inicioDt = parseDataDia(filtros.dataInicio);
  const fimDt = parseDataDia(filtros.dataFim);
  let dataInicio = inicioDt ? diaUtcFromIso(inicioDt.toISOString()) : null;
  let dataFim = fimDt ? diaUtcFromIso(fimDt.toISOString()) : null;

  if (!dataInicio || !dataFim) {
    const err = new Error("Informe data inicial e data final (AAAA-MM-DD) para o período.");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  ({ dataInicio, dataFim } = normalizePeriodoColheita(dataInicio, dataFim));
  if (dataInicio > dataFim) {
    const err = new Error("Data inicial não pode ser maior que a final.");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  return { dataInicio, dataFim };
}

export function parsePeriodoOpcional(filtros: { dataInicio?: string | null; dataFim?: string | null }) {
  let dataInicio: string | null = null;
  let dataFim: string | null = null;
  if (filtros.dataInicio || filtros.dataFim) {
    const inicioDt = parseDataDia(filtros.dataInicio);
    const fimDt = parseDataDia(filtros.dataFim);
    dataInicio = inicioDt ? diaUtcFromIso(inicioDt.toISOString()) : null;
    dataFim = fimDt ? diaUtcFromIso(fimDt.toISOString()) : null;
    if (dataInicio && dataFim) {
      const normalized = normalizePeriodoColheita(dataInicio, dataFim);
      dataInicio = normalized.dataInicio;
      dataFim = normalized.dataFim;
    }
    if (filtros.dataInicio && !dataInicio) {
      const err = new Error("Data inicial inválida. Use AAAA-MM-DD.");
      (err as Error & { status?: number }).status = 400;
      throw err;
    }
    if (filtros.dataFim && !dataFim) {
      const err = new Error("Data final inválida. Use AAAA-MM-DD.");
      (err as Error & { status?: number }).status = 400;
      throw err;
    }
    if (dataInicio && dataFim && dataInicio > dataFim) {
      const err = new Error("Data inicial não pode ser maior que a final.");
      (err as Error & { status?: number }).status = 400;
      throw err;
    }
  }
  return { dataInicio, dataFim };
}

export type VinculoEquipPeriodo = {
  codEquipamento: number | null;
  qtdEntradas: number;
  dataInicio: string | null;
  dataFim: string | null;
};

export function acumularVinculoEquipPeriodo(
  porEquip: Map<string, VinculoEquipPeriodo>,
  codEquipamento: number | null,
  dia: string | null,
) {
  const key = codEquipamento == null ? "__sem_equip__" : String(codEquipamento);
  const prev = porEquip.get(key) ?? { codEquipamento, qtdEntradas: 0, dataInicio: null, dataFim: null };
  prev.qtdEntradas += 1;
  if (dia) {
    if (!prev.dataInicio || dia < prev.dataInicio) prev.dataInicio = dia;
    if (!prev.dataFim || dia > prev.dataFim) prev.dataFim = dia;
  }
  porEquip.set(key, prev);
}

export function listarVinculosEquipPeriodo(porEquip: Map<string, VinculoEquipPeriodo>) {
  return [...porEquip.values()].sort((a, b) => {
    if (a.codEquipamento == null) return 1;
    if (b.codEquipamento == null) return -1;
    return a.codEquipamento - b.codEquipamento;
  });
}

async function fetchWithRetry(url: string, tries = 3) {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
      clearTimeout(timeout);
      return response;
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
      if (attempt < tries) await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr ?? "fetch failed");
  const err = new Error(`Falha de conexão com a API ORDS: ${msg}`);
  (err as Error & { status?: number }).status = 502;
  throw err;
}

export async function fetchOrdsPage(url: string) {
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const err = new Error(
      `Falha na API ORDS (${response.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
    (err as Error & { status?: number }).status = response.status >= 500 ? 502 : response.status;
    throw err;
  }
  return response.json() as Promise<{ items?: Record<string, unknown>[]; hasMore?: boolean }>;
}

export async function putOrdsItem(selfHref: string, body: Record<string, unknown>) {
  const response = await fetch(selfHref, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const err = new Error(
      `Falha ao atualizar registro ORDS (${response.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
    (err as Error & { status?: number }).status = response.status >= 500 ? 502 : response.status;
    throw err;
  }
  return response.json().catch(() => null);
}

export async function postOrdsItem(baseUrl: string, body: Record<string, unknown>) {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const err = new Error(
      `Falha ao criar registro ORDS (${response.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
    (err as Error & { status?: number }).status = response.status >= 500 ? 502 : response.status;
    throw err;
  }
  return response.json().catch(() => null);
}

/** ORDS retorna registros do mais recente ao mais antigo — interrompe ao passar dataInicio. */
/** @deprecated ORDS não garante ordenação por data — não usar stop antecipado no scan. */
/** @deprecated ORDS não garante ordenação por data — não usar stop antecipado no scan. */
export function ordsStopBeforeDate(dataInicio: string | null, dateField: string) {
  if (!dataInicio) return undefined;
  return (item: Record<string, unknown>) => {
    const raw = item[dateField];
    if (raw == null || String(raw).trim() === "") return false;
    const dia = diaUtcFromIso(String(raw));
    return Boolean(dia && dia < dataInicio);
  };
}

export async function scanOrdsCollection(
  baseUrl: string,
  opts: {
    maxRows?: number;
    match: (item: Record<string, unknown>) => boolean;
    map: (item: Record<string, unknown>) => Record<string, unknown> | null;
    stop?: (item: Record<string, unknown>) => boolean;
  },
) {
  const maxRows = opts.maxRows ?? ORDS_MAX_ROWS;
  const dados: Record<string, unknown>[] = [];
  let offset = 0;
  let hasMore = true;
  let pages = 0;
  let periodComplete = false;
  const urlBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  while (hasMore && dados.length < maxRows) {
    const url = `${urlBase}?offset=${offset}&limit=${ORDS_PAGE_SIZE}`;
    const payload = await fetchOrdsPage(url);
    const items = Array.isArray(payload.items) ? payload.items : [];
    let shouldStop = false;
    for (const item of items) {
      if (opts.stop?.(item)) {
        shouldStop = true;
        break;
      }
      if (!opts.match(item)) continue;
      const row = opts.map(item);
      if (row) {
        dados.push(row);
        if (dados.length >= maxRows) break;
      }
    }
    pages += 1;
    if (shouldStop) {
      // ORDS vem do mais recente ao mais antigo — parar antes de dataInicio não é truncamento.
      periodComplete = true;
      break;
    }
    hasMore = Boolean(payload.hasMore) && items.length > 0;
    offset += items.length;
    if (items.length === 0) break;
  }

  const truncado = !periodComplete && (hasMore || dados.length >= maxRows);
  return { dados, pages, hasMore: truncado, maxRows };
}
