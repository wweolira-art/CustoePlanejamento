import { oracleNumber, oracleText, runLimited, withOracle } from "../oracle.js";

export const META_DISPONIBILIDADE = 85;

/** Ordem e rótulos alinhados ao painel de disponibilidade (colheita / CCT primeiro). */
export const TIPOS_DISPONIBILIDADE_ORDEM: { codTipo: number; label: string; highlight?: boolean }[] = [
  { codTipo: 81, label: "Colhedoras - CCT", highlight: true },
  { codTipo: 93, label: "Trator Transbordo - CCT", highlight: true },
  { codTipo: 90, label: "Implemento Transbordo - CCT", highlight: true },
  { codTipo: 30, label: "Caminhão Apoio", highlight: true },
  { codTipo: 31, label: "Caminhão Bombeiro", highlight: true },
  { codTipo: 12, label: "Trator Plantio" },
  { codTipo: 8, label: "Trator Reboque de Cana" },
  { codTipo: 64, label: "Trator de Apoio - Tratos Culturais" },
  { codTipo: 6, label: "Trator de Apoio - Irrigação/Fertirrigação" },
  { codTipo: 11, label: "Pivot Linear - Irrigação/Fertirrigação" },
  { codTipo: 15, label: "Turbomaq - Irrigação/Fertirrigação" },
  { codTipo: 48, label: "Eletrobomba Dupla - Irrigação/Fertirrigação" },
  { codTipo: 40, label: "Eletrobomba Simples - Irrigação/Fertirrigação" },
  { codTipo: 91, label: "Implemento Agrícola" },
  { codTipo: 92, label: "Implemento Rodoviário" },
  { codTipo: 94, label: "Frota Leve" },
  { codTipo: 95, label: "Motocicleta" },
];

function money(n: number) {
  return Math.round((n || 0) * 100) / 100;
}

function parseSafraCode(code?: string | null) {
  const match = String(code ?? "").trim().match(/^(\d{2})\/(\d{2})$/);
  if (!match) return null;
  const y1 = Number(match[1]) >= 90 ? 1900 + Number(match[1]) : 2000 + Number(match[1]);
  const y2 = Number(match[2]) >= 90 ? 1900 + Number(match[2]) : 2000 + Number(match[2]);
  return {
    label: `${match[1]}/${match[2]}`,
    from: `${y1}-09-01`,
    to: `${y2}-08-31`,
    prevLabel: `${String(Number(match[1]) - 1).padStart(2, "0")}/${String(Number(match[2]) - 1).padStart(2, "0")}`,
    prevFrom: `${y1 - 1}-09-01`,
    prevTo: `${y2 - 1}-08-31`,
  };
}

function shiftYear(iso: string, delta: number) {
  const d = new Date(`${iso}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return iso;
  d.setFullYear(d.getFullYear() + delta);
  return d.toISOString().slice(0, 10);
}

function safraLabelFromStart(fromIso: string) {
  const y = Number(fromIso.slice(0, 4));
  const m = Number(fromIso.slice(5, 7));
  if (!y || !m) return "Safra";
  const y1 = m >= 9 ? y : y - 1;
  const y2 = y1 + 1;
  return `${String(y1).slice(-2)}/${String(y2).slice(-2)}`;
}

/** Meses do período filtrado; cada coluna acumula do início do período até o fim do mês. */
function monthsInPeriod(periodFrom: string, periodTo: string) {
  const out: { key: string; label: string; from: string; to: string | null }[] = [];
  if (!periodFrom || !periodTo || periodFrom > periodTo) return out;

  const start = new Date(`${periodFrom.slice(0, 7)}-01T12:00:00`);
  const endMonth = new Date(`${periodTo.slice(0, 7)}-01T12:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(endMonth.getTime())) return out;

  const cur = new Date(start);
  while (cur <= endMonth) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(y, cur.getMonth() + 1, 0).getDate();
    const monthFrom = `${y}-${m}-01`;
    const monthTo = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;

    let acumTo: string | null = null;
    if (monthFrom <= periodTo) {
      acumTo = monthTo > periodTo ? periodTo : monthTo;
      if (acumTo < periodFrom) acumTo = null;
    }

    const label = cur.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "/");
    out.push({ key: `${y}-${m}`, label, from: periodFrom, to: acumTo });
    cur.setMonth(cur.getMonth() + 1, 1);
  }
  return out;
}

function resolvePeriodo(opts: {
  safraCode?: string | null;
  dataInicio?: string | null;
  dataFim?: string | null;
}) {
  const safra = parseSafraCode(opts.safraCode);
  const today = new Date().toISOString().slice(0, 10);
  const dataFim = opts.dataFim?.trim() || safra?.to || today;
  const dataInicio = opts.dataInicio?.trim() || safra?.from || `${new Date().getFullYear()}-09-01`;

  const periodFrom = dataInicio;
  const periodTo = dataFim < periodFrom ? dataInicio : dataFim;

  const prevFrom = shiftYear(periodFrom, -1);
  const prevTo = shiftYear(periodTo, -1);

  const safraAtual = safra?.label && safra.from === periodFrom && safra.to === periodTo
    ? safra.label
    : safraLabelFromStart(periodFrom);
  const safraAnterior = safra?.prevLabel && safra.prevFrom === prevFrom && safra.prevTo === prevTo
    ? safra.prevLabel
    : safraLabelFromStart(prevFrom);

  return {
    safraParsed: safra,
    periodFrom,
    periodTo,
    prevFrom,
    prevTo,
    safraAtual,
    safraAnterior,
    queryFrom: prevFrom,
    queryTo: periodTo,
  };
}

type SegmentoTipoRow = {
  codEquipamento: number;
  codTipo: number;
  segIni: string;
  segFim: string;
  horasDia: number;
};

type OrdemServicoRow = {
  codEquipamento: number;
  abertura: Date;
  encerramento: Date;
};

function daysInclusive(from: string, to: string) {
  if (!from || !to || from > to) return 0;
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function periodEndTs(fim: string) {
  const end = new Date(`${fim}T12:00:00`);
  end.setDate(end.getDate() + 1);
  end.setMilliseconds(end.getMilliseconds() - 1);
  return end;
}

function oracleDate(raw: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = raw[key] ?? raw[key.toUpperCase()];
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value.includes("T") ? value : `${value}T12:00:00`);
      if (Number.isFinite(parsed.getTime())) return parsed;
    }
  }
  return null;
}

function horasOficinaPeriodo(abertura: Date, encerramento: Date, ini: string, fim: string) {
  const pIni = new Date(`${ini}T00:00:00`);
  const pFim = periodEndTs(fim);
  const start = Math.max(abertura.getTime(), pIni.getTime());
  const end = Math.min(encerramento.getTime(), pFim.getTime());
  if (end <= start) return 0;
  return (end - start) / 3600000;
}

async function loadSegmentosTipo(dataInicio: string, dataFim: string) {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT e.cod_equipamento,
              ht.cod_tipoequipamento,
              TO_CHAR(
                GREATEST(TRUNC(ht.data_inicio), TRUNC(TO_DATE(:dataInicio, 'YYYY-MM-DD'))),
                'YYYY-MM-DD'
              ) AS seg_ini,
              TO_CHAR(
                LEAST(TRUNC(NVL(ht.data_fim, SYSDATE)), TRUNC(TO_DATE(:dataFim, 'YYYY-MM-DD'))),
                'YYYY-MM-DD'
              ) AS seg_fim,
              NVL(e.disponibilidade, 0) AS horas_dia
         FROM automotivo.equipamento e
         JOIN automotivo.historico_tipoequipamento ht
           ON ht.cod_equipamento = e.cod_equipamento
        WHERE TRUNC(ht.data_inicio) <= TRUNC(TO_DATE(:dataFim, 'YYYY-MM-DD'))
          AND TRUNC(NVL(ht.data_fim, SYSDATE)) >= TRUNC(TO_DATE(:dataInicio, 'YYYY-MM-DD'))`,
      { dataInicio, dataFim },
    );

    const rows: SegmentoTipoRow[] = [];
    for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
      const codEquipamento = oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO");
      const codTipo = oracleNumber(raw, "cod_tipoequipamento", "COD_TIPOEQUIPAMENTO");
      const segIni = oracleText(raw, "seg_ini", "SEG_INI");
      const segFim = oracleText(raw, "seg_fim", "SEG_FIM");
      if (codEquipamento == null || codTipo == null || !segIni || !segFim || segIni > segFim) continue;
      rows.push({
        codEquipamento,
        codTipo,
        segIni,
        segFim,
        horasDia: oracleNumber(raw, "horas_dia", "HORAS_DIA") ?? 0,
      });
    }
    return rows;
  });
}

async function loadOrdensServicoPeriodo(dataInicio: string, dataFim: string) {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT os.cod_equipamento,
              os.dtabertura,
              NVL(os.dtencerramento, SYSDATE) AS dt_fim
         FROM automotivo.ordemservico os
        WHERE os.dtabertura < TO_DATE(:dataFim, 'YYYY-MM-DD') + 1 - (1 / 86400)
          AND NVL(os.dtencerramento, SYSDATE) > TO_DATE(:dataInicio, 'YYYY-MM-DD')`,
      { dataInicio, dataFim },
    );

    const rows: OrdemServicoRow[] = [];
    for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
      const codEquipamento = oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO");
      const abertura = oracleDate(raw, "dtabertura", "DTABERTURA");
      const encerramento = oracleDate(raw, "dt_fim", "DT_FIM");
      if (codEquipamento == null || !abertura || !encerramento) continue;
      rows.push({ codEquipamento, abertura, encerramento });
    }
    return rows;
  });
}

function dispPctHoras(horasPotenciais: number, horasOficina: number) {
  if (horasPotenciais <= 0) return horasPotenciais === 0 && horasOficina > 0 ? 0 : null;
  return money((Math.max(horasPotenciais - horasOficina, 0) / horasPotenciais) * 100);
}

export type DispHorasEquip = {
  horasPotenciais: number;
  horasOficina: number;
  disponibilidadePct: number | null;
};

function mergeDispHoras(items: DispHorasEquip[]): DispHorasEquip {
  const horasPotenciais = items.reduce((acc, item) => acc + item.horasPotenciais, 0);
  const horasOficina = items.reduce((acc, item) => acc + item.horasOficina, 0);
  return {
    horasPotenciais,
    horasOficina,
    disponibilidadePct: horasPotenciais <= 0 ? (items.length ? 0 : null) : dispPctHoras(horasPotenciais, horasOficina),
  };
}

export function calcDispHorasPorEquipamentoMap(
  segments: SegmentoTipoRow[],
  osList: OrdemServicoRow[],
  periodIni: string,
  periodTo: string,
) {
  const potencial = new Map<number, number>();
  for (const seg of segments) {
    if (seg.segFim < periodIni || seg.segIni > periodTo) continue;
    const from = seg.segIni > periodIni ? seg.segIni : periodIni;
    const to = seg.segFim < periodTo ? seg.segFim : periodTo;
    potencial.set(seg.codEquipamento, (potencial.get(seg.codEquipamento) ?? 0) + seg.horasDia * daysInclusive(from, to));
  }

  const oficina = new Map<number, number>();
  for (const os of osList) {
    const horas = horasOficinaPeriodo(os.abertura, os.encerramento, periodIni, periodTo);
    if (horas <= 0) continue;
    oficina.set(os.codEquipamento, (oficina.get(os.codEquipamento) ?? 0) + horas);
  }

  const out = new Map<number, DispHorasEquip>();
  for (const id of new Set([...potencial.keys(), ...oficina.keys()])) {
    const horasPotenciais = potencial.get(id) ?? 0;
    const horasOficina = oficina.get(id) ?? 0;
    out.set(id, {
      horasPotenciais,
      horasOficina,
      disponibilidadePct: horasPotenciais <= 0 ? 0 : dispPctHoras(horasPotenciais, horasOficina),
    });
  }
  return out;
}

export function mergeDispHorasEquipamentos(
  map: Map<number, DispHorasEquip>,
  cods: number[],
): DispHorasEquip {
  const items = cods.map((cod) => map.get(cod)).filter((item): item is DispHorasEquip => Boolean(item));
  if (!items.length) return { horasPotenciais: 0, horasOficina: 0, disponibilidadePct: null };
  return mergeDispHoras(items);
}

export async function gerarDisponibilidadeHorasPorEquipamento(dataInicio: string, dataFim: string) {
  const periodTo = dataFim < dataInicio ? dataInicio : dataFim;
  const [segments, osList] = await runLimited(
    [() => loadSegmentosTipo(dataInicio, periodTo), () => loadOrdensServicoPeriodo(dataInicio, periodTo)],
    1,
  );
  return calcDispHorasPorEquipamentoMap(segments, osList, dataInicio, periodTo);
}

function calcDispPctTipo(
  segments: SegmentoTipoRow[],
  osList: OrdemServicoRow[],
  codTipo: number,
  periodIni: string,
  periodTo: string,
) {
  return calcDispPctTipos(segments, osList, new Set([codTipo]), periodIni, periodTo);
}

/** Disponibilidade agregada para um conjunto de tipos de equipamento. */
export function calcDispPctTipos(
  segments: SegmentoTipoRow[],
  osList: OrdemServicoRow[],
  codTipos: Set<number>,
  periodIni: string,
  periodTo: string,
) {
  if (!codTipos.size) return null;
  let horasPotenciais = 0;
  const equipIds = new Set<number>();

  for (const seg of segments) {
    if (!codTipos.has(seg.codTipo)) continue;
    if (seg.segFim < periodIni || seg.segIni > periodTo) continue;
    equipIds.add(seg.codEquipamento);
    const from = seg.segIni > periodIni ? seg.segIni : periodIni;
    const to = seg.segFim < periodTo ? seg.segFim : periodTo;
    horasPotenciais += seg.horasDia * daysInclusive(from, to);
  }

  if (!equipIds.size) return null;

  let horasOficina = 0;
  for (const os of osList) {
    if (!equipIds.has(os.codEquipamento)) continue;
    horasOficina += horasOficinaPeriodo(os.abertura, os.encerramento, periodIni, periodTo);
  }

  return dispPctHoras(horasPotenciais, horasOficina);
}

export async function gerarDisponibilidadeAgregada(opts: {
  dataInicio: string;
  dataFim: string;
  codTipos: number[];
}): Promise<{
  total: number | null;
  meses: { key: string; label: string; valor: number | null }[];
}> {
  const periodFrom = opts.dataInicio;
  const periodTo = opts.dataFim < periodFrom ? periodFrom : opts.dataFim;
  const codTipos = new Set(normalizeTiposEquipamento(opts.codTipos));
  if (!codTipos.size) return { total: null, meses: [] };

  const [segments, osList] = await runLimited(
    [() => loadSegmentosTipo(periodFrom, periodTo), () => loadOrdensServicoPeriodo(periodFrom, periodTo)],
    1,
  );

  const mesesDef = monthsInPeriod(periodFrom, periodTo);
  return {
    total: calcDispPctTipos(segments, osList, codTipos, periodFrom, periodTo),
    meses: mesesDef.map((m) => ({
      key: m.key,
      label: m.label,
      valor: m.to ? calcDispPctTipos(segments, osList, codTipos, m.from, m.to) : null,
    })),
  };
}

function labelForTipo(codTipo: number, tipoDescricao: string | null) {
  const known = TIPOS_DISPONIBILIDADE_ORDEM.find((t) => t.codTipo === codTipo);
  if (known) return known.label;
  const desc = String(tipoDescricao ?? "").trim();
  if (desc) return desc.charAt(0).toUpperCase() + desc.slice(1).toLowerCase();
  return `Tipo ${codTipo}`;
}

function highlightForTipo(codTipo: number) {
  return TIPOS_DISPONIBILIDADE_ORDEM.find((t) => t.codTipo === codTipo)?.highlight ?? false;
}

function sortTipos(codTipos: number[]) {
  const order = new Map(TIPOS_DISPONIBILIDADE_ORDEM.map((t, i) => [t.codTipo, i]));
  return [...codTipos].sort((a, b) => {
    const oa = order.get(a) ?? 999;
    const ob = order.get(b) ?? 999;
    if (oa !== ob) return oa - ob;
    return a - b;
  });
}

export type DisponibilidadePorTipoPayload = {
  meta: number;
  safraAtual: string;
  safraAnterior: string;
  dataInicio: string;
  dataFim: string;
  meses: { key: string; label: string }[];
  linhas: {
    codTipo: number;
    label: string;
    highlight: boolean;
    meses: (number | null)[];
    safraAnterior: number | null;
    safraAtual: number | null;
    meta: number;
  }[];
};

export type DisponibilidadeEquipamentosPayload = DisponibilidadePorTipoPayload & {
  codTiposEquipamento: number[];
};

function normalizeTiposEquipamento(codTipos?: number[] | null) {
  return [...new Set((codTipos ?? []).filter((t) => Number.isFinite(t) && t > 0))].sort((a, b) => a - b);
}

async function buildDisponibilidadeMatrix(opts: {
  safraCode?: string | null;
  dataInicio?: string | null;
  dataFim?: string | null;
  codTiposEquipamento?: number[] | null;
}): Promise<DisponibilidadeEquipamentosPayload> {
  const periodo = resolvePeriodo(opts);
  const { periodFrom, periodTo, prevFrom, prevTo, safraAtual, safraAnterior, queryFrom, queryTo } = periodo;
  const codTiposFilter = normalizeTiposEquipamento(opts.codTiposEquipamento);

  const [segments, osList] = await runLimited(
    [() => loadSegmentosTipo(queryFrom, queryTo), () => loadOrdensServicoPeriodo(queryFrom, queryTo)],
    1,
  );

  const tiposSet = new Set<number>();
  for (const seg of segments) tiposSet.add(seg.codTipo);
  for (const t of TIPOS_DISPONIBILIDADE_ORDEM) tiposSet.add(t.codTipo);

  let tipos = sortTipos([...tiposSet]);
  if (codTiposFilter.length) tipos = tipos.filter((cod) => codTiposFilter.includes(cod));

  const mesesDef = monthsInPeriod(periodFrom, periodTo);
  const meses = mesesDef.map((m) => ({ key: m.key, label: m.label }));

  const linhas = tipos
    .map((codTipo) => {
      const mesesValores = mesesDef.map((m) =>
        m.to ? calcDispPctTipo(segments, osList, codTipo, m.from, m.to) : null,
      );
      return {
        codTipo,
        label: labelForTipo(codTipo, null),
        highlight: highlightForTipo(codTipo),
        meses: mesesValores,
        safraAnterior: calcDispPctTipo(segments, osList, codTipo, prevFrom, prevTo),
        safraAtual: calcDispPctTipo(segments, osList, codTipo, periodFrom, periodTo),
        meta: META_DISPONIBILIDADE,
      };
    })
    .filter((line) => line.meses.some((v) => v != null) || line.safraAtual != null || line.safraAnterior != null);

  return {
    meta: META_DISPONIBILIDADE,
    safraAtual,
    safraAnterior,
    dataInicio: periodFrom,
    dataFim: periodTo,
    codTiposEquipamento: codTiposFilter.length ? codTiposFilter : tipos,
    meses,
    linhas,
  };
}

export async function gerarDisponibilidadeEquipamentos(opts: {
  safraCode?: string | null;
  dataInicio?: string | null;
  dataFim?: string | null;
  codTiposEquipamento?: number[] | null;
}): Promise<DisponibilidadeEquipamentosPayload> {
  return buildDisponibilidadeMatrix(opts);
}

export async function gerarDisponibilidadePorTipo(opts: {
  safraCode?: string | null;
  dataInicio?: string | null;
  dataFim?: string | null;
}): Promise<DisponibilidadePorTipoPayload> {
  const payload = await buildDisponibilidadeMatrix(opts);
  return {
    meta: payload.meta,
    safraAtual: payload.safraAtual,
    safraAnterior: payload.safraAnterior,
    dataInicio: payload.dataInicio,
    dataFim: payload.dataFim,
    meses: payload.meses,
    linhas: payload.linhas,
  };
}
