import { oracleNumber, oracleText, runLimited, withOracle } from "../oracle.js";
import { db } from "../db.js";

/** Defeito corretivo em `itens_osdefeitos`; O.S. com plano de prevenção não conta como falha. */
export const COD_OSMANUTENCAO_CORRETIVA = 1;

export const META_MTTR_HORAS = 15;
export const META_MTBF_HORAS = 15;
export const META_DISPONIBILIDADE_GESTAO = 95;

const GESTAO_MANUTENCAO_CONFIG_KEY = "indicadores.gestaoManutencao.config";

export type GestaoManutencaoConfig = {
  metaMttrHoras: number;
  metaMtbfHoras: number;
  metaDisponibilidade: number;
  metasPorTipo: Record<string, {
    metaMttrHoras: number;
    metaMtbfHoras: number;
    metaDisponibilidade: number;
  }>;
};

function clampMetaHoras(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n * 100) / 100;
}

function clampMetaPct(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;
}

function defaultGestaoManutencaoConfig(): GestaoManutencaoConfig {
  return {
    metaMttrHoras: META_MTTR_HORAS,
    metaMtbfHoras: META_MTBF_HORAS,
    metaDisponibilidade: META_DISPONIBILIDADE_GESTAO,
    metasPorTipo: {},
  };
}

function normalizeMetasPorTipo(raw: unknown, fallback: GestaoManutencaoConfig) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: GestaoManutencaoConfig["metasPorTipo"] = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const cod = Number(key);
    if (!Number.isFinite(cod) || cod <= 0 || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Partial<GestaoManutencaoConfig>;
    out[String(Math.round(cod))] = {
      metaMttrHoras: clampMetaHoras(item.metaMttrHoras, fallback.metaMttrHoras),
      metaMtbfHoras: clampMetaHoras(item.metaMtbfHoras, fallback.metaMtbfHoras),
      metaDisponibilidade: clampMetaPct(item.metaDisponibilidade, fallback.metaDisponibilidade),
    };
  }
  return out;
}

export function readGestaoManutencaoConfig(): GestaoManutencaoConfig {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(GESTAO_MANUTENCAO_CONFIG_KEY) as
    | { value: string }
    | undefined;
  if (!row?.value) {
    return defaultGestaoManutencaoConfig();
  }
  try {
    const parsed = JSON.parse(row.value) as Partial<GestaoManutencaoConfig>;
    const fallback = defaultGestaoManutencaoConfig();
    const base = {
      metaMttrHoras: clampMetaHoras(parsed.metaMttrHoras, META_MTTR_HORAS),
      metaMtbfHoras: clampMetaHoras(parsed.metaMtbfHoras, META_MTBF_HORAS),
      metaDisponibilidade: clampMetaPct(parsed.metaDisponibilidade, META_DISPONIBILIDADE_GESTAO),
    };
    return {
      ...base,
      metasPorTipo: normalizeMetasPorTipo(parsed.metasPorTipo, { ...fallback, ...base }),
    };
  } catch {
    return defaultGestaoManutencaoConfig();
  }
}

export function saveGestaoManutencaoConfig(input: Partial<GestaoManutencaoConfig>): GestaoManutencaoConfig {
  const current = readGestaoManutencaoConfig();
  const next: GestaoManutencaoConfig = {
    metaMttrHoras: clampMetaHoras(
      input.metaMttrHoras !== undefined ? input.metaMttrHoras : current.metaMttrHoras,
      META_MTTR_HORAS,
    ),
    metaMtbfHoras: clampMetaHoras(
      input.metaMtbfHoras !== undefined ? input.metaMtbfHoras : current.metaMtbfHoras,
      META_MTBF_HORAS,
    ),
    metaDisponibilidade: clampMetaPct(
      input.metaDisponibilidade !== undefined ? input.metaDisponibilidade : current.metaDisponibilidade,
      META_DISPONIBILIDADE_GESTAO,
    ),
    metasPorTipo: normalizeMetasPorTipo(input.metasPorTipo ?? current.metasPorTipo, current),
  };
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    GESTAO_MANUTENCAO_CONFIG_KEY,
    JSON.stringify(next),
  );
  return next;
}

function metasParaTipo(config: GestaoManutencaoConfig, codTipoEquipamento: number | null) {
  const specific = codTipoEquipamento != null ? config.metasPorTipo[String(codTipoEquipamento)] : null;
  return {
    mttrHoras: specific?.metaMttrHoras ?? config.metaMttrHoras,
    mtbfHoras: specific?.metaMtbfHoras ?? config.metaMtbfHoras,
    disponibilidade: specific?.metaDisponibilidade ?? config.metaDisponibilidade,
    codTipoEquipamento,
    metasPorTipo: config.metasPorTipo,
  };
}

const MESES_SAFRA: { mes: number; label: string }[] = [
  { mes: 9, label: "SET" },
  { mes: 10, label: "OUT" },
  { mes: 11, label: "NOV" },
  { mes: 12, label: "DEZ" },
  { mes: 1, label: "JAN" },
  { mes: 2, label: "FEV" },
  { mes: 3, label: "MAR" },
  { mes: 4, label: "ABR" },
  { mes: 5, label: "MAI" },
  { mes: 6, label: "JUN" },
  { mes: 7, label: "JUL" },
  { mes: 8, label: "AGO" },
];

function safraLabel(anoInicio: number) {
  return `${String(anoInicio).slice(-2)}/${String(anoInicio + 1).slice(-2)}`;
}

/** Ano de início da safra vigente (setembro → agosto). */
function currentSafraStartYear(today = new Date()) {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  return m >= 9 ? y : y - 1;
}

/** Safra: 01/09/ano → 31/08/ano+1 (ou até hoje, se for a safra corrente). */
function safraBounds(anoInicio: number) {
  const from = `${anoInicio}-09-01`;
  const toFull = `${anoInicio + 1}-08-31`;
  const today = new Date().toISOString().slice(0, 10);
  const to = today < toFull && today >= from ? today : today < from ? from : toFull;
  return { from, to };
}

function isIsoDate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function safraStartFromDate(iso: string) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  if (!y || !m) return currentSafraStartYear();
  return m >= 9 ? y : y - 1;
}

function labelMes(mes: number) {
  return MESES_SAFRA.find((entry) => entry.mes === mes)?.label ?? String(mes).padStart(2, "0");
}

/** Meses civis entre dataInicio e dataFim (inclusive), na ordem cronológica. */
function monthsInRange(dataInicio: string, dataFim: string) {
  const out: { key: string; label: string; from: string; to: string }[] = [];
  if (!dataInicio || !dataFim || dataInicio > dataFim) return out;

  let y = Number(dataInicio.slice(0, 4));
  let m = Number(dataInicio.slice(5, 7));
  const endY = Number(dataFim.slice(0, 4));
  const endM = Number(dataFim.slice(5, 7));
  if (!y || !m || !endY || !endM) return out;

  while (y < endY || (y === endY && m <= endM)) {
    const mm = String(m).padStart(2, "0");
    const monthFrom = `${y}-${mm}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    let monthTo = `${y}-${mm}-${String(lastDay).padStart(2, "0")}`;
    const from = monthFrom < dataInicio ? dataInicio : monthFrom;
    if (monthTo > dataFim) monthTo = dataFim;
    if (from <= monthTo) {
      out.push({ key: `${y}-${mm}`, label: labelMes(m), from, to: monthTo });
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function resolvePeriodoGestao(opts: {
  ano?: number | null;
  dataInicio?: string | null;
  dataFim?: string | null;
  anosDisponiveis: number[];
}) {
  const safraCorrente = currentSafraStartYear();
  const fallbackAno = opts.anosDisponiveis.includes(safraCorrente)
    ? safraCorrente
    : opts.anosDisponiveis[0] ?? safraCorrente;

  const hasInicio = isIsoDate(opts.dataInicio?.trim() || null);
  const hasFim = isIsoDate(opts.dataFim?.trim() || null);

  let ano =
    opts.ano != null && Number.isFinite(opts.ano) && opts.ano > 1990 ? opts.ano : fallbackAno;

  let dataInicio: string;
  let dataFim: string;

  if (hasInicio || hasFim) {
    const bounds = safraBounds(ano);
    dataInicio = hasInicio ? opts.dataInicio!.trim() : bounds.from;
    dataFim = hasFim ? opts.dataFim!.trim() : bounds.to;
    if (dataFim < dataInicio) {
      const tmp = dataInicio;
      dataInicio = dataFim;
      dataFim = tmp;
    }
    if (opts.ano == null || !Number.isFinite(opts.ano)) {
      ano = safraStartFromDate(dataInicio);
    }
  } else {
    const bounds = safraBounds(ano);
    dataInicio = bounds.from;
    dataFim = bounds.to;
  }

  return { ano, dataInicio, dataFim };
}

function money(n: number) {
  return Math.round((n || 0) * 100) / 100;
}

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

/** Categorias compactas alinhadas ao painel (print). */
export function categoriaFromTipo(descricao: string | null | undefined, codTipo: number | null | undefined) {
  const raw = String(descricao ?? "").trim();
  if (!raw && (codTipo == null || !Number.isFinite(codTipo))) return "#N/D";
  const key = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!key) return "#N/D";
  if (key.includes("colhedor") || key.includes("colhedeir")) return "COLHEDORA";
  if (key.includes("motociclet")) return "MOTOCICLETAS";
  if (key.includes("caminh") || key.includes("bombeiro")) return "CAMINHÕES";
  if (key.includes("trator") || key.includes("transbordo")) return "TRATORES";
  if (key.includes("frota leve") || key.includes("carro")) return "FROTA LEVE";
  if (key.includes("implemento")) return "IMPLEMENTOS";
  if (key.includes("eletrobomba") || key.includes("eletro bomba") || key.includes("motor bomba")) return "BOMBAS";
  if (key.includes("pivot") || key.includes("irrig") || key.includes("turbomaq") || key.includes("aspersor")) {
    return "IRRIGAÇÃO";
  }
  if (key.includes("gerador")) return "GERADORES";
  const first = raw.split(/[-–(/]/)[0]?.trim().toUpperCase();
  return first || "#N/D";
}

type SegmentoRow = {
  codEquipamento: number;
  codTipo: number;
  tipoDescricao: string | null;
  tipoHorimetro: string;
  categoria: string;
  segIni: string;
  segFim: string;
  horasDia: number;
};

type OsRow = {
  codEquipamento: number;
  anoOs: number;
  numeroOs: number;
  abertura: Date;
  encerramento: Date;
  aberta: boolean;
};

type HoraRodadaRow = {
  codEquipamento: number;
  dia: string;
  horas: number;
};

async function loadSegmentos(dataInicio: string, dataFim: string) {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT e.cod_equipamento,
              ht.cod_tipoequipamento,
              te.descricaotipoequipamento AS tipo_desc,
              UPPER(NVL(e.tipohorimetro, 'N')) AS tipohorimetro,
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
         LEFT JOIN automotivo.tipoequipamento te
           ON te.cod_tipoequipamento = ht.cod_tipoequipamento
        WHERE TRUNC(ht.data_inicio) <= TRUNC(TO_DATE(:dataFim, 'YYYY-MM-DD'))
          AND TRUNC(NVL(ht.data_fim, SYSDATE)) >= TRUNC(TO_DATE(:dataInicio, 'YYYY-MM-DD'))`,
      { dataInicio, dataFim },
    );

    const rows: SegmentoRow[] = [];
    for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
      const codEquipamento = oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO");
      const codTipo = oracleNumber(raw, "cod_tipoequipamento", "COD_TIPOEQUIPAMENTO");
      const segIni = oracleText(raw, "seg_ini", "SEG_INI");
      const segFim = oracleText(raw, "seg_fim", "SEG_FIM");
      if (codEquipamento == null || codTipo == null || !segIni || !segFim || segIni > segFim) continue;
      const tipoDescricao = oracleText(raw, "tipo_desc", "TIPO_DESC");
      rows.push({
        codEquipamento,
        codTipo,
        tipoDescricao,
        tipoHorimetro: (oracleText(raw, "tipohorimetro", "TIPOHORIMETRO") || "N").toUpperCase(),
        categoria: categoriaFromTipo(tipoDescricao, codTipo),
        segIni,
        segFim,
        horasDia: oracleNumber(raw, "horas_dia", "HORAS_DIA") ?? 0,
      });
    }
    return rows;
  });
}

/** Horas rodadas (kmhs_rodados) dos equipamentos por horímetro (tipohorimetro = H). */
async function loadHorasRodadas(dataInicio: string, dataFim: string) {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT a.cod_equipamento,
              TO_CHAR(TRUNC(a.data_abastecimento), 'YYYY-MM-DD') AS dia,
              SUM(NVL(a.kmhs_rodados, 0)) AS horas
         FROM (
                SELECT ab.cod_equipamento,
                       ab.dtabastecimento AS data_abastecimento,
                       ab.kmhs_rodados
                  FROM automotivo.abastecimento ab
                 WHERE ab.dtabastecimento IS NOT NULL
                   AND TRUNC(ab.dtabastecimento) BETWEEN TO_DATE(:dataInicio, 'YYYY-MM-DD')
                                                    AND TO_DATE(:dataFim, 'YYYY-MM-DD')
                UNION ALL
                SELECT pb.cod_equipamento,
                       pb.data AS data_abastecimento,
                       pb.kmhs_rodados
                  FROM posto.abastecimento pb
                 WHERE pb.data IS NOT NULL
                   AND TRUNC(pb.data) BETWEEN TO_DATE(:dataInicio, 'YYYY-MM-DD')
                                          AND TO_DATE(:dataFim, 'YYYY-MM-DD')
              ) a
         JOIN automotivo.equipamento e
           ON e.cod_equipamento = a.cod_equipamento
        WHERE UPPER(NVL(e.tipohorimetro, 'N')) = 'H'
          AND NVL(a.kmhs_rodados, 0) > 0
        GROUP BY a.cod_equipamento, TO_CHAR(TRUNC(a.data_abastecimento), 'YYYY-MM-DD')`,
      { dataInicio, dataFim },
    );

    const rows: HoraRodadaRow[] = [];
    for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
      const codEquipamento = oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO");
      const dia = oracleText(raw, "dia", "DIA");
      const horas = oracleNumber(raw, "horas", "HORAS") ?? 0;
      if (codEquipamento == null || !dia || !(horas > 0)) continue;
      rows.push({ codEquipamento, dia, horas });
    }
    return rows;
  });
}

async function loadOrdensPeriodo(dataInicio: string, dataFim: string) {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT os.cod_equipamento,
              os.ano_ordemservico,
              os.numero_ordemservico,
              os.dtabertura,
              os.dtencerramento,
              NVL(os.dtencerramento, SYSDATE) AS dt_fim,
              CASE
                WHEN c.numero_ordemservico IS NOT NULL
                 AND os.cod_planoprevencao IS NULL
                THEN 1 ELSE 0
              END AS eh_corretiva
         FROM automotivo.ordemservico os
         LEFT JOIN (
                SELECT DISTINCT d.ano_ordemservico, d.numero_ordemservico
                  FROM automotivo.itens_osdefeitos d
                 WHERE d.cod_osmanutencao = ${COD_OSMANUTENCAO_CORRETIVA}
              ) c
           ON c.ano_ordemservico = os.ano_ordemservico
          AND c.numero_ordemservico = os.numero_ordemservico
        WHERE os.dtabertura < TO_DATE(:dataFim, 'YYYY-MM-DD') + 1 - (1 / 86400)
          AND NVL(os.dtencerramento, SYSDATE) > TO_DATE(:dataInicio, 'YYYY-MM-DD')`,
      { dataInicio, dataFim },
    );

    const todas: OsRow[] = [];
    const corretivas: OsRow[] = [];
    for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
      const codEquipamento = oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO");
      const anoOs = oracleNumber(raw, "ano_ordemservico", "ANO_ORDEMSERVICO");
      const numeroOs = oracleNumber(raw, "numero_ordemservico", "NUMERO_ORDEMSERVICO");
      const abertura = oracleDate(raw, "dtabertura", "DTABERTURA");
      const encerramento = oracleDate(raw, "dt_fim", "DT_FIM");
      if (codEquipamento == null || anoOs == null || numeroOs == null || !abertura || !encerramento) continue;
      const row: OsRow = {
        codEquipamento,
        anoOs,
        numeroOs,
        abertura,
        encerramento,
        aberta: !oracleDate(raw, "dtencerramento", "DTENCERRAMENTO"),
      };
      todas.push(row);
      if ((oracleNumber(raw, "eh_corretiva", "EH_CORRETIVA") ?? 0) === 1) corretivas.push(row);
    }
    return { todas, corretivas };
  });
}

async function loadAnosDisponiveis() {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT DISTINCT
              CASE
                WHEN EXTRACT(MONTH FROM os.dtabertura) >= 9
                  THEN EXTRACT(YEAR FROM os.dtabertura)
                ELSE EXTRACT(YEAR FROM os.dtabertura) - 1
              END AS ano
         FROM automotivo.ordemservico os
        WHERE os.cod_planoprevencao IS NULL
          AND EXISTS (
                SELECT 1
                  FROM automotivo.itens_osdefeitos d
                 WHERE d.ano_ordemservico = os.ano_ordemservico
                   AND d.numero_ordemservico = os.numero_ordemservico
                   AND d.cod_osmanutencao = ${COD_OSMANUTENCAO_CORRETIVA}
              )
          AND os.dtabertura IS NOT NULL
        ORDER BY ano DESC`,
    );
    const anos: number[] = [];
    for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
      const ano = oracleNumber(raw, "ano", "ANO");
      if (ano != null) anos.push(ano);
    }
    return anos;
  });
}

function equipIdsForFilter(
  segments: SegmentoRow[],
  opts: {
    categoria?: string | null;
    codTipoEquipamento?: number | null;
    codEquipamento?: number | null;
  },
) {
  const cat = opts.categoria?.trim() || null;
  const codTipo =
    opts.codTipoEquipamento != null && Number.isFinite(opts.codTipoEquipamento)
      ? opts.codTipoEquipamento
      : null;
  const codEq = opts.codEquipamento != null && Number.isFinite(opts.codEquipamento) ? opts.codEquipamento : null;
  const ids = new Set<number>();
  for (const seg of segments) {
    if (cat && seg.categoria !== cat) continue;
    if (codTipo != null && seg.codTipo !== codTipo) continue;
    if (codEq != null && seg.codEquipamento !== codEq) continue;
    ids.add(seg.codEquipamento);
  }
  return ids;
}

function horasPotenciaisEquip(
  segments: SegmentoRow[],
  equipIds: Set<number>,
  periodIni: string,
  periodTo: string,
  opts?: { categoria?: string | null; codTipoEquipamento?: number | null },
) {
  const cat = opts?.categoria?.trim() || null;
  const codTipo =
    opts?.codTipoEquipamento != null && Number.isFinite(opts.codTipoEquipamento)
      ? opts.codTipoEquipamento
      : null;
  let horas = 0;
  for (const seg of segments) {
    if (!equipIds.has(seg.codEquipamento)) continue;
    if (cat && seg.categoria !== cat) continue;
    if (codTipo != null && seg.codTipo !== codTipo) continue;
    if (seg.segFim < periodIni || seg.segIni > periodTo) continue;
    const from = seg.segIni > periodIni ? seg.segIni : periodIni;
    const to = seg.segFim < periodTo ? seg.segFim : periodTo;
    horas += seg.horasDia * daysInclusive(from, to);
  }
  return horas;
}

function horasOficinaEquip(osList: OsRow[], equipIds: Set<number>, periodIni: string, periodTo: string) {
  let horas = 0;
  for (const os of osList) {
    if (!equipIds.has(os.codEquipamento)) continue;
    horas += horasOficinaPeriodo(os.abertura, os.encerramento, periodIni, periodTo);
  }
  return horas;
}

function isoDateTime(value: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function iterFalhasMttr(corretivas: OsRow[], equipIds: Set<number>, periodIni: string, periodTo: string) {
  const pIni = new Date(`${periodIni}T00:00:00`).getTime();
  const pFim = periodEndTs(periodTo).getTime();
  const seen = new Set<string>();
  const out: OsRow[] = [];
  for (const os of corretivas) {
    if (!equipIds.has(os.codEquipamento)) continue;
    const ab = os.abertura.getTime();
    if (ab < pIni || ab > pFim) continue;
    const key = `${os.anoOs}-${os.numeroOs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(os);
  }
  return out;
}

function falhasNoPeriodo(corretivas: OsRow[], equipIds: Set<number>, periodIni: string, periodTo: string) {
  const items = iterFalhasMttr(corretivas, equipIds, periodIni, periodTo);
  let reparo = 0;
  for (const os of items) {
    reparo += horasOficinaPeriodo(os.abertura, os.encerramento, periodIni, periodTo);
  }
  return { qtd: items.length, reparo };
}

function detalheFalhasMttr(
  corretivas: OsRow[],
  equipIds: Set<number>,
  periodIni: string,
  periodTo: string,
  lookup: Map<number, { categoria: string; tipoEquipamento: string }>,
): GestaoManutencaoFalha[] {
  return iterFalhasMttr(corretivas, equipIds, periodIni, periodTo)
    .map((os) => {
      const info = lookup.get(os.codEquipamento);
      return {
        ordemServico: `${os.anoOs}/${os.numeroOs}`,
        anoOs: os.anoOs,
        numeroOs: os.numeroOs,
        codEquipamento: os.codEquipamento,
        tipoEquipamento: info?.tipoEquipamento ?? "",
        categoria: info?.categoria ?? "",
        dataAbertura: isoDateTime(os.abertura),
        dataEncerramento: os.aberta ? null : isoDateTime(os.encerramento),
        aberta: os.aberta,
        tempoReparoHoras: money(horasOficinaPeriodo(os.abertura, os.encerramento, periodIni, periodTo)),
      };
    })
    .sort((a, b) => b.dataAbertura.localeCompare(a.dataAbertura) || b.numeroOs - a.numeroOs);
}

function tipoHorimetroPorEquip(segments: SegmentoRow[]) {
  const latest = new Map<number, { tipo: string; fim: string }>();
  for (const seg of segments) {
    const cur = latest.get(seg.codEquipamento);
    if (!cur || seg.segFim >= cur.fim) {
      latest.set(seg.codEquipamento, { tipo: seg.tipoHorimetro, fim: seg.segFim });
    }
  }
  return new Map([...latest.entries()].map(([id, v]) => [id, v.tipo]));
}

function horasRodadasPeriodo(
  horasRodadas: HoraRodadaRow[],
  equipIds: Set<number>,
  periodIni: string,
  periodTo: string,
) {
  let total = 0;
  for (const row of horasRodadas) {
    if (!equipIds.has(row.codEquipamento)) continue;
    if (row.dia < periodIni || row.dia > periodTo) continue;
    total += row.horas;
  }
  return total;
}

/**
 * MTBF (tempo de operação):
 * - tipohorimetro H → horas rodadas (abastecimento.kmhs_rodados)
 * - demais → horas potenciais − horas em oficina
 */
function tempoOperacaoMtbf(params: {
  segments: SegmentoRow[];
  osList: OsRow[];
  horasRodadas: HoraRodadaRow[];
  tipoHorimetro: Map<number, string>;
  equipIds: Set<number>;
  periodIni: string;
  periodTo: string;
  filterOpts: { categoria?: string | null; codTipoEquipamento?: number | null };
}) {
  const {
    segments,
    osList,
    horasRodadas,
    tipoHorimetro,
    equipIds,
    periodIni,
    periodTo,
    filterOpts,
  } = params;

  const equipsH = new Set<number>();
  const equipsOutros = new Set<number>();
  for (const id of equipIds) {
    if ((tipoHorimetro.get(id) || "N") === "H") equipsH.add(id);
    else equipsOutros.add(id);
  }

  const horasH = horasRodadasPeriodo(horasRodadas, equipsH, periodIni, periodTo);
  const potOutros = horasPotenciaisEquip(segments, equipsOutros, periodIni, periodTo, filterOpts);
  const oficinaOutros = horasOficinaEquip(osList, equipsOutros, periodIni, periodTo);
  return money(horasH + Math.max(potOutros - oficinaOutros, 0));
}

function dispPct(horasPotenciais: number, horasOficina: number) {
  if (horasPotenciais <= 0) return horasPotenciais === 0 && horasOficina > 0 ? 0 : null;
  return money((Math.max(horasPotenciais - horasOficina, 0) / horasPotenciais) * 100);
}

function ratioOrNull(numerador: number, denominador: number) {
  if (!denominador) return null;
  return money(numerador / denominador);
}

export type GestaoManutencaoCustoTipo = "corretiva" | "preventiva" | "preditiva" | "melhoria";

export type GestaoManutencaoCustoAnalitico = {
  data: string;
  codEquipamento: number | null;
  objetoCusto: string;
  codObjetoCusto: number | null;
  componente: string;
  tipoMaterial: string;
  quantidade: number;
  valorUnitario: number;
  valor: number;
  anoOrdemServico: number | null;
  numeroOrdemServico: number | null;
  ordemServico: string | null;
  tipo: GestaoManutencaoCustoTipo;
  tipoLabel: string;
};

export type GestaoManutencaoCustoResumo = {
  total: number;
  tipoMaterial: string | null;
  tiposMaterial: string[];
  codObjetoCusto: number | null;
  objetosCusto: Array<{ codObjetoCusto: number; label: string }>;
  porTipo: Record<GestaoManutencaoCustoTipo, number>;
  percentual: Array<{ tipo: GestaoManutencaoCustoTipo; label: string; valor: number; percentual: number }>;
  porMes: Array<{ key: string; label: string; valor: number }>;
  porFrota: Array<{ codEquipamento: number; label: string; valor: number }>;
  porComponente: Array<{ componente: string; label: string; valor: number }>;
  porObjetoCusto: Array<{ codObjetoCusto: number | null; objetoCusto: string; label: string; valor: number }>;
  analitico: GestaoManutencaoCustoAnalitico[];
};

export type GestaoManutencaoFalha = {
  ordemServico: string;
  anoOs: number;
  numeroOs: number;
  codEquipamento: number;
  tipoEquipamento: string;
  categoria: string;
  dataAbertura: string;
  dataEncerramento: string | null;
  aberta: boolean;
  tempoReparoHoras: number;
};

export type GestaoManutencaoOsFalhaItem = {
  sequencial: number;
  contaNoMttr: boolean;
  values: Record<string, string>;
};

export type GestaoManutencaoOsDetalhe = {
  ordemServico: string;
  anoOs: number;
  numeroOs: number;
  codEquipamento: number | null;
  dataAbertura: string | null;
  dataEncerramento: string | null;
  aberta: boolean;
  box: string | null;
  colunas: Array<{ key: string; label: string }>;
  falhas: GestaoManutencaoOsFalhaItem[];
};

export type GestaoManutencaoMes = {
  key: string;
  label: string;
  qtdFalhas: number;
  tempoReparoHoras: number;
  tempoOperacaoHoras: number;
  mttrHoras: number | null;
  mtbfHoras: number | null;
  disponibilidade: number | null;
  indisponibilidade: number | null;
};

export type GestaoManutencaoPayload = {
  ano: number;
  safra: string;
  categoria: string | null;
  codTipoEquipamento: number | null;
  codEquipamento: number | null;
  dataInicio: string;
  dataFim: string;
  filtros: {
    anos: number[];
    safras: { ano: number; label: string }[];
    categorias: string[];
    tipos: { codTipoEquipamento: number; label: string; categoria: string }[];
    equipamentos: {
      codEquipamento: number;
      label: string;
      categoria: string;
      codTipoEquipamento: number | null;
    }[];
  };
  meta: {
    mttrHoras: number;
    mtbfHoras: number;
    disponibilidade: number;
    codTipoEquipamento: number | null;
    metasPorTipo: GestaoManutencaoConfig["metasPorTipo"];
  };
  kpis: {
    qtdFalhas: number;
    tempoReparoHoras: number;
    tempoOperacaoHoras: number;
    mttrHoras: number | null;
    mtbfHoras: number | null;
    disponibilidade: number | null;
    indisponibilidade: number | null;
  };
  meses: GestaoManutencaoMes[];
  falhasMttr: GestaoManutencaoFalha[];
  custo: GestaoManutencaoCustoResumo;
};

type CustoManutencaoRaw = {
  codEquipamento: number | null;
  tipo: GestaoManutencaoCustoTipo;
  tipoMaterial: string;
  componente: string;
  codObjetoCusto: number | null;
  objetoCusto: string;
  data: string;
  valor: number;
  quantidade: number;
  valorUnitario: number;
  anoOrdemServico: number | null;
  numeroOrdemServico: number | null;
};

function labelTipoCusto(tipo: GestaoManutencaoCustoTipo) {
  switch (tipo) {
    case "corretiva":
      return "Corretiva";
    case "preventiva":
      return "Preventiva";
    case "preditiva":
      return "Preditiva";
    case "melhoria":
      return "Melhoria";
  }
}

function tipoCustoFromCod(cod: number | null): GestaoManutencaoCustoTipo {
  if (cod === 1 || cod === 8) return "corretiva";
  if (cod === 3 || cod === 11) return "preditiva";
  if (cod === 12) return "melhoria";
  return "preventiva";
}

function labelManutencaoCod(cod: number | null) {
  const base = labelTipoCusto(tipoCustoFromCod(cod));
  return cod != null ? `${cod} · ${base}` : base;
}

const OSDEFEITO_COL_LABEL: Record<string, string> = {
  SEQUENCIAL: "Seq.",
  DESCRICAO: "Descrição",
  COD_OSMANUTENCAO: "Cód. tipo",
  TIPO_MANUTENCAO: "Tipo",
  COD_OSCAUSA: "Cód. causa",
  CAUSA_DESC: "Causa",
  OBSERVACAO: "Observação",
  SITUACAO: "Situação",
  HORAS: "Horas previstas",
  DATA_INICIO: "Início",
  DATA_TERMINO: "Término",
  COD_COMPONENTE: "Componente",
  COD_FUNCIONARIO: "Funcionário",
  COD_FORNECEDOR: "Fornecedor",
  CODIGO_DESTINO_MANUTENCAO: "Destino",
  BLOQUEADO: "Bloqueio",
  TIPO_BLOQUEIO: "Tipo bloqueio",
  PREVISAO_DESBLOQUEIO: "Previsão desbloqueio",
  JUSTIFICATIVA_BLOQUEIO: "Justificativa bloqueio",
  COD_PLANOPREVENCAO: "Plano prevenção",
  ID_DEFEITO: "Id defeito",
  COD_SISTEMA: "Sistema",
  USUARIO_INCLUSAO: "Usuário inclusão",
  DATA_INCLUSAO: "Data inclusão",
  ANO_ORDEMSERVICO_ORIGEM: "Ano O.S. origem",
  NUMERO_ORDEMSERVICO_ORIGEM: "Nº O.S. origem",
  SEQUENCIAL_ORIGEM: "Seq. origem",
  ANO_SOLICITACAO: "Ano solicitação",
  NUMERO_SOLICITACAO: "Nº solicitação",
  ID_SERVICO_SOLICITADO: "Serviço solicitado",
  ID_SOLMANU: "Solicitação manutenção",
  ID_SOLMANITEM: "Item solicitação",
  ID_MOTIVO_RDI: "Motivo RDI",
  ID_ITENSPLANOPR: "Item plano",
  ID_CHECK_LIST_PONTO_CHECAR: "Checklist ponto",
  ID_CHECK_LIST_ITENS: "Checklist item",
  ID_INTEROSDEF: "Id intermediária",
  ID_ANALISE: "Id análise óleo",
};

const OSDEFEITO_COL_ORDER = [
  "SEQUENCIAL",
  "DESCRICAO",
  "TIPO_MANUTENCAO",
  "COD_OSMANUTENCAO",
  "CAUSA_DESC",
  "COD_OSCAUSA",
  "SITUACAO",
  "OBSERVACAO",
  "HORAS",
  "DATA_INICIO",
  "DATA_TERMINO",
  "COD_COMPONENTE",
  "COD_FUNCIONARIO",
  "COD_FORNECEDOR",
  "CODIGO_DESTINO_MANUTENCAO",
  "BLOQUEADO",
  "USUARIO_INCLUSAO",
  "DATA_INCLUSAO",
  "COD_PLANOPREVENCAO",
  "ID_DEFEITO",
];

const OSDEFEITO_HIDDEN = new Set([
  "ANO_ORDEMSERVICO",
  "NUMERO_ORDEMSERVICO",
  "COD_GRUPOEMPRESA",
  "COD_EMPRESA",
  "COD_FILIAL",
  "COD_GRUPOEMPRESA_FUNC",
]);

function labelSituacaoDefeito(value: string) {
  const key = value.trim().toUpperCase();
  if (key === "E") return "E · Executado";
  if (key === "N") return "N · Não executado";
  if (key === "R") return "R · Recusado";
  if (key === "T") return "T · Transferida";
  return value;
}

function labelBloqueioDefeito(value: string) {
  const key = value.trim().toUpperCase();
  if (key === "B") return "B · Bloqueado";
  if (key === "D") return "D · Desbloqueado";
  if (key === "I") return "I · Bloqueado e indisponível";
  return value;
}

function formatOsDefeitoValue(key: string, value: unknown) {
  if (value == null || value === "") return "";
  if (value instanceof Date && Number.isFinite(value.getTime())) return isoDateTime(value);
  const text = String(value).trim();
  if (!text) return "";
  if (key === "SITUACAO") return labelSituacaoDefeito(text);
  if (key === "BLOQUEADO") return labelBloqueioDefeito(text);
  if (key === "TIPO_BLOQUEIO") {
    const t = text.toUpperCase();
    if (t === "A") return "A · Automático";
    if (t === "M") return "M · Manual";
  }
  return text;
}

function labelOsDefeitoCol(key: string) {
  return OSDEFEITO_COL_LABEL[key] ?? key.replace(/_/g, " ").toLowerCase();
}

export async function loadOsFalhaDetalhe(anoOs: number, numeroOs: number): Promise<GestaoManutencaoOsDetalhe> {
  if (!Number.isFinite(anoOs) || !Number.isFinite(numeroOs) || anoOs <= 0 || numeroOs <= 0) {
    throw new Error("Informe a O.S. (ano e número).");
  }
  return withOracle(async (conn) => {
    const header = await conn.execute(
      `SELECT os.cod_equipamento,
              os.dtabertura,
              os.dtencerramento,
              os.box,
              os.cod_box
         FROM automotivo.ordemservico os
        WHERE os.ano_ordemservico = :anoOs
          AND os.numero_ordemservico = :numeroOs`,
      { anoOs, numeroOs },
    );
    const hraw = ((header.rows ?? [])[0] ?? null) as Record<string, unknown> | null;
    if (!hraw) throw new Error(`O.S. ${anoOs}/${numeroOs} não encontrada.`);

    const abertura = oracleDate(hraw, "dtabertura", "DTABERTURA");
    const encerramento = oracleDate(hraw, "dtencerramento", "DTENCERRAMENTO");
    const boxNum = oracleNumber(hraw, "cod_box", "COD_BOX");
    const boxTxt = oracleText(hraw, "box", "BOX");

    let rawFalhas: Record<string, unknown>[] = [];
    try {
      const defects = await conn.execute(
        `SELECT d.*,
                oc.descricao AS causa_desc,
                om.descricao AS tipo_manutencao
           FROM automotivo.itens_osdefeitos d
           LEFT JOIN automotivo.oscausa oc
             ON oc.cod_oscausa = d.cod_oscausa
           LEFT JOIN automotivo.osmanutencao om
             ON om.cod_osmanutencao = d.cod_osmanutencao
          WHERE d.ano_ordemservico = :anoOs
            AND d.numero_ordemservico = :numeroOs
          ORDER BY d.sequencial`,
        { anoOs, numeroOs },
      );
      rawFalhas = (defects.rows ?? []) as Record<string, unknown>[];
    } catch {
      const defects = await conn.execute(
        `SELECT d.*,
                oc.descricao AS causa_desc
           FROM automotivo.itens_osdefeitos d
           LEFT JOIN automotivo.oscausa oc
             ON oc.cod_oscausa = d.cod_oscausa
          WHERE d.ano_ordemservico = :anoOs
            AND d.numero_ordemservico = :numeroOs
          ORDER BY d.sequencial`,
        { anoOs, numeroOs },
      );
      rawFalhas = (defects.rows ?? []) as Record<string, unknown>[];
    }

    const falhas: GestaoManutencaoOsFalhaItem[] = rawFalhas.map((raw) => {
      const values: Record<string, string> = {};
      for (const [rawKey, rawValue] of Object.entries(raw)) {
        const key = rawKey.toUpperCase();
        if (OSDEFEITO_HIDDEN.has(key)) continue;
        values[key] = formatOsDefeitoValue(key, rawValue);
      }
      const tipoCodigo = oracleNumber(raw, "cod_osmanutencao", "COD_OSMANUTENCAO");
      if (!values.TIPO_MANUTENCAO) values.TIPO_MANUTENCAO = labelManutencaoCod(tipoCodigo);
      return {
        sequencial: oracleNumber(raw, "sequencial", "SEQUENCIAL") ?? 0,
        contaNoMttr: tipoCodigo === COD_OSMANUTENCAO_CORRETIVA,
        values,
      };
    });

    const seen = new Set<string>();
    const colunas: Array<{ key: string; label: string }> = [];
    const pushCol = (key: string) => {
      if (seen.has(key) || OSDEFEITO_HIDDEN.has(key)) return;
      const used = falhas.some((row) => (row.values[key] ?? "").trim() !== "");
      if (!used && key !== "DESCRICAO" && key !== "SEQUENCIAL") return;
      seen.add(key);
      colunas.push({ key, label: labelOsDefeitoCol(key) });
    };
    for (const key of OSDEFEITO_COL_ORDER) pushCol(key);
    for (const row of falhas) {
      for (const key of Object.keys(row.values)) pushCol(key);
    }

    return {
      ordemServico: `${anoOs}/${numeroOs}`,
      anoOs,
      numeroOs,
      codEquipamento: oracleNumber(hraw, "cod_equipamento", "COD_EQUIPAMENTO"),
      dataAbertura: abertura ? isoDateTime(abertura) : null,
      dataEncerramento: encerramento ? isoDateTime(encerramento) : null,
      aberta: !encerramento,
      box: boxNum != null ? String(boxNum) : boxTxt,
      colunas,
      falhas,
    };
  });
}

function normalizeTipoMaterial(value: string | null | undefined) {
  const text = String(value || "").trim().toUpperCase();
  return text || "NA";
}

function normalizeComponente(value: string | null | undefined) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text || "SEM DESCRICAO";
}

function semAcentoUpper(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function grupoComponente(descricao: string, tipoMaterial: string) {
  const text = semAcentoUpper(descricao);
  if (tipoMaterial === "SERVICO") return "SERVICO";
  if (tipoMaterial === "PNEU" || /\bPNEU(S)?\b/.test(text)) {
    if (text.includes("REFORMA") || text.includes("RECAP") || text.includes("VULCAN")) return "MANUTENCAO PNEU";
    return "PNEUS";
  }
  if (tipoMaterial === "FILTRO" || text.includes("FILTRO") || text.includes("ELEMENTO FILTRANTE")) return "FILTRO";
  if (tipoMaterial === "LUBRIFICANTE" || text.includes("OLEO") || text.includes("LUBRIFICANTE")) return "LUBRIFICANTE";
  if (tipoMaterial === "GRAXA" || text.includes("GRAXA")) return "GRAXA";
  if (tipoMaterial === "ADITIVO" || text.includes("ADITIVO")) return "ADITIVO";

  if (text.includes("ROLAMENTO")) return "ROLAMENTO";
  if (text.includes("LAMINA") || text.includes("FACA") || text.includes("FACAO")) return "LAMINA";
  if (text.includes("MANGUEIRA")) return "MANGUEIRA";
  if (text.includes("CORREIA")) return "CORREIA";
  if (text.includes("TUBO") || text.includes("TUBULACAO") || text.includes("CONEXAO")) return "TUBULACAO";
  if (text.includes("DISCO")) return "DISCO";
  if (text.includes("CHAPA")) return "CHAPA";
  if (text.includes("ABRACADEIRA")) return "ABRACADEIRA";
  if (text.includes("EIXO")) return "EIXO";
  if (text.includes("ALTERNADOR")) return "ALTERNADOR";
  if (text.includes("DISJUNTOR")) return "DISJUNTOR";
  if (text.includes("BATERIA")) return "BATERIA";
  if (text.includes("MODULO")) return "MODULO";
  if (text.includes("SENSOR")) return "SENSOR";
  if (text.includes("BOMBA")) return "BOMBA";
  if (text.includes("PARAFUSO") || text.includes("PORCA") || text.includes("ARRUELA")) return "FIXADORES";
  if (text.includes("VEDADOR") || text.includes("RETENTOR") || text.includes("ANEL O") || text.includes("ORING")) return "VEDACAO";
  if (text.includes("TERMINAL") || text.includes("CABO") || text.includes("CHICOTE")) return "ELETRICO";

  const cleaned = text
    .replace(/\b(DO|DA|DE|DOS|DAS|PARA|COM|SEM|CJ|CONJ|KIT)\b/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.split(" ").slice(0, 2).join(" ") || "OUTROS";
}

function normalizeObjetoCusto(cod: number | null, descricao: string | null | undefined) {
  const text = String(descricao || "").trim().replace(/\s+/g, " ");
  if (text) return cod != null ? `${cod} - ${text}` : text;
  return cod != null ? `Objeto ${cod}` : "SEM OBJETO";
}

async function loadCustosManutencao(dataInicio: string, dataFim: string) {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `WITH custos AS (
          SELECT req.ano_ordem_servico AS ano_ordemservico,
                 req.numero_ordem_servico AS numero_ordemservico,
                 NVL(r.cod_equipamento, os.cod_equipamento) AS cod_equipamento,
                 NVL(d.cod_osmanutencao, CASE WHEN os.cod_planoprevencao IS NOT NULL THEN 2 ELSE 1 END) AS cod_osmanutencao,
                 CASE pf.tipo
                   WHEN 1 THEN 'COMBUSTIVEL'
                   WHEN 2 THEN 'LUBRIFICANTE'
                   WHEN 3 THEN 'PNEU'
                   WHEN 4 THEN 'SERVICO'
                   WHEN 5 THEN 'FILTRO'
                   WHEN 6 THEN 'GRAXA'
                   WHEN 7 THEN 'ADITIVO'
                   ELSE 'NA'
                 END AS tipo_material,
                 MAX(NVL(m.descricao, 'Material ' || r.cod_material)) AS componente,
                 NVL(r.cod_objetocusto, hobj.cod_objetocusto) AS cod_objetocusto,
                 MAX(oc.descricao) AS objeto_custo,
                 r.dataretirada AS data,
                 SUM(NVL(r.quantidade, 0)) AS quantidade,
                 CASE
                   WHEN SUM(NVL(r.quantidade, 0)) > 0
                   THEN SUM(NVL(r.quantidade, 0) * NVL(r.vrcustounitario, 0)) / SUM(NVL(r.quantidade, 0))
                   ELSE MAX(NVL(r.vrcustounitario, 0))
                 END AS valor_unitario,
                 SUM(NVL(r.quantidade, 0) * NVL(r.vrcustounitario, 0)) AS valor
            FROM material.itensrequisicaomaterial r
            LEFT JOIN material.requisicaomaterial req
              ON req.nrrequisicao = r.nrrequisicao
            LEFT JOIN automotivo.ordemservico os
              ON os.ano_ordemservico = req.ano_ordem_servico
             AND os.numero_ordemservico = req.numero_ordem_servico
            LEFT JOIN automotivo.itens_osdefeitos d
              ON d.sequencial = r.item_ordem_servico
             AND d.ano_ordemservico = req.ano_ordem_servico
             AND d.numero_ordemservico = req.numero_ordem_servico
            LEFT JOIN LATERAL (
              SELECT hx.cod_objetocusto
                FROM automotivo.historicoequipamentoobcusto hx
               WHERE r.cod_objetocusto IS NULL
                 AND hx.cod_grupoempresa = r.cod_grupoempresa
                 AND hx.cod_empresa = r.cod_empresa
                 AND hx.cod_filial = r.cod_filial
                 AND hx.cod_equipamento = NVL(r.cod_equipamento, os.cod_equipamento)
                 AND TRUNC(r.dataretirada)
                     BETWEEN TRUNC(hx.data_inicio)
                     AND TRUNC(NVL(hx.data_final, SYSDATE))
               ORDER BY NVL(hx.data_final, DATE '9999-12-31') DESC, hx.data_inicio DESC
               FETCH FIRST 1 ROW ONLY
            ) hobj ON 1 = 1
            LEFT JOIN material.historicofamiliagrupo_material hfg
              ON hfg.cod_material = r.cod_material
             AND r.dataretirada >= hfg.data_inicio
             AND r.dataretirada <= NVL(hfg.data_termino, SYSDATE)
            LEFT JOIN material.historicogrupomaterial hgm
              ON hgm.cod_grupoempresa = r.cod_grupoempresa
             AND hgm.cod_empresa = r.cod_empresa
             AND hgm.cod_filial = r.cod_filial
             AND hgm.cod_familia = hfg.cod_familia
             AND hgm.cod_grupomaterial = hfg.cod_grupomaterial
             AND r.dataretirada >= hgm.datainicio
             AND r.dataretirada <= NVL(hgm.datatermino, SYSDATE)
            LEFT JOIN automotivo.parametros_familia pf
              ON pf.cod_familia = hfg.cod_familia
             AND pf.cod_grupomaterial = hfg.cod_grupomaterial
            LEFT JOIN material.material m
              ON m.cod_material = r.cod_material
            LEFT JOIN custo.objetocusto oc
              ON oc.cod_objetocusto = NVL(r.cod_objetocusto, hobj.cod_objetocusto)
           WHERE r.dataretirada IS NOT NULL
             AND r.data_canc IS NULL
             AND (
                   NVL(r.cod_equipamento, os.cod_equipamento) IS NOT NULL
                OR r.cod_objetocusto IS NOT NULL
                OR hobj.cod_objetocusto IS NOT NULL
             )
             AND TRUNC(r.dataretirada) BETWEEN TO_DATE(:dataInicio, 'YYYY-MM-DD') AND TO_DATE(:dataFim, 'YYYY-MM-DD')
           GROUP BY req.ano_ordem_servico,
                    req.numero_ordem_servico,
                    NVL(r.cod_equipamento, os.cod_equipamento),
                    NVL(d.cod_osmanutencao, CASE WHEN os.cod_planoprevencao IS NOT NULL THEN 2 ELSE 1 END),
                    CASE pf.tipo
                      WHEN 1 THEN 'COMBUSTIVEL'
                      WHEN 2 THEN 'LUBRIFICANTE'
                      WHEN 3 THEN 'PNEU'
                      WHEN 4 THEN 'SERVICO'
                      WHEN 5 THEN 'FILTRO'
                      WHEN 6 THEN 'GRAXA'
                      WHEN 7 THEN 'ADITIVO'
                      ELSE 'NA'
                    END,
                    r.cod_material,
                    NVL(r.cod_objetocusto, hobj.cod_objetocusto),
                    r.dataretirada
          UNION ALL
          SELECT t.ano_ordemservico,
                 t.numero_ordemservico,
                 os.cod_equipamento,
                 NVL(t.cod_osmanutencao, CASE WHEN os.cod_planoprevencao IS NOT NULL THEN 2 ELSE 1 END) AS cod_osmanutencao,
                 'SERVICO' AS tipo_material,
                 'SERVICO' AS componente,
                 hobj.cod_objetocusto,
                 MAX(oc.descricao) AS objeto_custo,
                 NVL(t.data_final, t.data_inicial) AS data,
                 SUM(NVL(t.qtde_tempo, 0)) AS quantidade,
                 CASE
                   WHEN SUM(NVL(t.qtde_tempo, 0)) > 0
                   THEN SUM(NVL(t.qtde_tempo, 0) * NVL(t.valor_unitario, 0)) / SUM(NVL(t.qtde_tempo, 0))
                   ELSE MAX(NVL(t.valor_unitario, 0))
                 END AS valor_unitario,
                 SUM(NVL(t.qtde_tempo, 0) * NVL(t.valor_unitario, 0)) AS valor
            FROM automotivo.itens_ordemservicoterceiro t
            JOIN automotivo.ordemservico os
              ON os.ano_ordemservico = t.ano_ordemservico
             AND os.numero_ordemservico = t.numero_ordemservico
            LEFT JOIN automotivo.historicoequipamentoobcusto hobj
              ON hobj.cod_grupoempresa = os.cod_grupoempresa
             AND hobj.cod_empresa = os.cod_empresa
             AND hobj.cod_filial = os.cod_filial
             AND hobj.cod_equipamento = os.cod_equipamento
             AND TRUNC(NVL(t.data_final, t.data_inicial)) BETWEEN TRUNC(hobj.data_inicio) AND TRUNC(NVL(hobj.data_final, SYSDATE))
            LEFT JOIN custo.objetocusto oc
              ON oc.cod_objetocusto = hobj.cod_objetocusto
           WHERE NVL(t.data_final, t.data_inicial) IS NOT NULL
             AND TRUNC(NVL(t.data_final, t.data_inicial)) BETWEEN TO_DATE(:dataInicio, 'YYYY-MM-DD') AND TO_DATE(:dataFim, 'YYYY-MM-DD')
           GROUP BY t.ano_ordemservico,
                    t.numero_ordemservico,
                    os.cod_equipamento,
                    NVL(t.cod_osmanutencao, CASE WHEN os.cod_planoprevencao IS NOT NULL THEN 2 ELSE 1 END),
                    'SERVICO',
                    'SERVICO',
                    hobj.cod_objetocusto,
                    NVL(t.data_final, t.data_inicial)
        )
        SELECT c.ano_ordemservico,
               c.numero_ordemservico,
               c.cod_equipamento,
               TO_CHAR(TRUNC(c.data), 'YYYY-MM-DD') AS data_custo,
               c.cod_osmanutencao,
               c.tipo_material,
               c.componente,
               c.cod_objetocusto,
               MAX(c.objeto_custo) AS objeto_custo,
               SUM(NVL(c.quantidade, 0)) AS quantidade,
               CASE
                 WHEN SUM(NVL(c.quantidade, 0)) > 0
                 THEN SUM(NVL(c.valor, 0)) / SUM(NVL(c.quantidade, 0))
                 ELSE MAX(NVL(c.valor_unitario, 0))
               END AS valor_unitario,
               SUM(NVL(c.valor, 0)) AS valor
          FROM custos c
         WHERE c.cod_equipamento IS NOT NULL
            OR c.cod_objetocusto IS NOT NULL
         GROUP BY c.ano_ordemservico,
                  c.numero_ordemservico,
                  c.cod_equipamento,
                  TO_CHAR(TRUNC(c.data), 'YYYY-MM-DD'),
                  c.cod_osmanutencao,
                  c.tipo_material,
                  c.componente,
                  c.cod_objetocusto`,
      { dataInicio, dataFim },
      { maxRows: 0, fetchArraySize: 500 },
    );

    const rows: CustoManutencaoRaw[] = [];
    for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
      const codEquipamento = oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO");
      const data = oracleText(raw, "data_custo", "DATA_CUSTO");
      const valor = oracleNumber(raw, "valor", "VALOR") ?? 0;
      if (!data || !(valor > 0)) continue;
      const quantidade = oracleNumber(raw, "quantidade", "QUANTIDADE") ?? 0;
      const valorUnitario =
        oracleNumber(raw, "valor_unitario", "VALOR_UNITARIO") ??
        (quantidade > 0 ? valor / quantidade : valor);
      rows.push({
        codEquipamento,
        data,
        valor,
        quantidade,
        valorUnitario,
        anoOrdemServico: oracleNumber(raw, "ano_ordemservico", "ANO_ORDEMSERVICO"),
        numeroOrdemServico: oracleNumber(raw, "numero_ordemservico", "NUMERO_ORDEMSERVICO"),
        tipoMaterial: normalizeTipoMaterial(oracleText(raw, "tipo_material", "TIPO_MATERIAL")),
        componente: normalizeComponente(oracleText(raw, "componente", "COMPONENTE")),
        codObjetoCusto: oracleNumber(raw, "cod_objetocusto", "COD_OBJETOCUSTO"),
        objetoCusto: normalizeObjetoCusto(
          oracleNumber(raw, "cod_objetocusto", "COD_OBJETOCUSTO"),
          oracleText(raw, "objeto_custo", "OBJETO_CUSTO"),
        ),
        tipo: tipoCustoFromCod(oracleNumber(raw, "cod_osmanutencao", "COD_OSMANUTENCAO")),
      });
    }
    return rows;
  });
}

function custoResumo(
  custos: CustoManutencaoRaw[],
  equipIds: Set<number>,
  meses: { key: string; label: string; from: string; to: string }[],
  tipoMaterialFiltro?: string | null,
  codObjetoCustoFiltro?: number | null,
): GestaoManutencaoCustoResumo {
  const custosSemCombustivel = custos.filter((row) => row.tipoMaterial !== "COMBUSTIVEL");
  const tiposMaterial = [...new Set(custosSemCombustivel.map((row) => row.tipoMaterial).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  const tipoMaterial = tipoMaterialFiltro ? normalizeTipoMaterial(tipoMaterialFiltro) : null;
  const codObjetoCusto =
    codObjetoCustoFiltro != null && Number.isFinite(codObjetoCustoFiltro) && codObjetoCustoFiltro > 0
      ? codObjetoCustoFiltro
      : null;
  const objetosCusto = [
    ...new Map(
      custosSemCombustivel
        .filter((row) => row.codObjetoCusto != null)
        .map((row) => [row.codObjetoCusto!, { codObjetoCusto: row.codObjetoCusto!, label: row.objetoCusto }]),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const porTipo: Record<GestaoManutencaoCustoTipo, number> = {
    corretiva: 0,
    preventiva: 0,
    preditiva: 0,
    melhoria: 0,
  };
  const porMesMap = new Map(meses.map((mes) => [mes.key, { key: mes.key, label: mes.label, valor: 0 }]));
  const porFrotaMap = new Map<number, number>();
  const porComponenteMap = new Map<string, { componente: string; amostras: Set<string>; valor: number }>();
  const porObjetoCustoMap = new Map<string, { codObjetoCusto: number | null; objetoCusto: string; valor: number }>();
  const analitico: GestaoManutencaoCustoAnalitico[] = [];

  for (const row of custosSemCombustivel) {
    if (tipoMaterial && row.tipoMaterial !== tipoMaterial) continue;
    if (codObjetoCusto != null && row.codObjetoCusto !== codObjetoCusto) continue;
    if (codObjetoCusto == null && row.codEquipamento != null && !equipIds.has(row.codEquipamento)) continue;
    if (row.codEquipamento == null && row.codObjetoCusto == null) continue;
    porTipo[row.tipo] = money(porTipo[row.tipo] + row.valor);
    const mes = porMesMap.get(row.data.slice(0, 7));
    if (mes) mes.valor = money(mes.valor + row.valor);
    if (row.codEquipamento != null) {
      porFrotaMap.set(row.codEquipamento, money((porFrotaMap.get(row.codEquipamento) ?? 0) + row.valor));
    }
    const grupo = grupoComponente(row.componente, row.tipoMaterial);
    const componente = porComponenteMap.get(grupo) ?? { componente: grupo, amostras: new Set<string>(), valor: 0 };
    if (componente.amostras.size < 4 && row.componente !== grupo) componente.amostras.add(row.componente);
    componente.valor = money(componente.valor + row.valor);
    porComponenteMap.set(grupo, componente);
    const objetoKey = row.codObjetoCusto != null ? String(row.codObjetoCusto) : row.objetoCusto;
    const objeto = porObjetoCustoMap.get(objetoKey) ?? {
      codObjetoCusto: row.codObjetoCusto,
      objetoCusto: row.objetoCusto,
      valor: 0,
    };
    objeto.valor = money(objeto.valor + row.valor);
    porObjetoCustoMap.set(objetoKey, objeto);
    const ordemServico =
      row.anoOrdemServico != null && row.numeroOrdemServico != null
        ? `${row.anoOrdemServico}/${row.numeroOrdemServico}`
        : null;
    analitico.push({
      data: row.data,
      codEquipamento: row.codEquipamento,
      objetoCusto: row.objetoCusto,
      codObjetoCusto: row.codObjetoCusto,
      componente: row.componente,
      tipoMaterial: row.tipoMaterial,
      quantidade: money(row.quantidade),
      valorUnitario: money(row.valorUnitario),
      valor: money(row.valor),
      anoOrdemServico: row.anoOrdemServico,
      numeroOrdemServico: row.numeroOrdemServico,
      ordemServico,
      tipo: row.tipo,
      tipoLabel: labelTipoCusto(row.tipo),
    });
  }

  analitico.sort((a, b) => {
    const byDate = b.data.localeCompare(a.data);
    if (byDate) return byDate;
    const osA = a.ordemServico ?? "";
    const osB = b.ordemServico ?? "";
    if (osA !== osB) return osA.localeCompare(osB, "pt-BR");
    return (a.codEquipamento ?? 0) - (b.codEquipamento ?? 0);
  });

  const total = money(Object.values(porTipo).reduce((acc, value) => acc + value, 0));
  const percentual = (Object.keys(porTipo) as GestaoManutencaoCustoTipo[]).map((tipo) => ({
    tipo,
    label: labelTipoCusto(tipo),
    valor: porTipo[tipo],
    percentual: total > 0 ? money((porTipo[tipo] / total) * 100) : 0,
  }));

  const porFrota = [...porFrotaMap.entries()]
    .map(([codEquipamento, valor]) => ({ codEquipamento, label: String(codEquipamento), valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 20);
  const porComponente = [...porComponenteMap.values()]
    .map((row) => ({
      componente: row.amostras.size ? `${row.componente}: ${[...row.amostras].join("; ")}` : row.componente,
      label: row.componente.length > 18 ? `${row.componente.slice(0, 18).trim()}...` : row.componente,
      valor: row.valor,
    }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 18);
  const porObjetoCusto = [...porObjetoCustoMap.values()]
    .map((row) => ({
      ...row,
      label: row.objetoCusto.length > 24 ? `${row.objetoCusto.slice(0, 24).trim()}...` : row.objetoCusto,
    }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 18);

  return {
    total,
    tipoMaterial,
    tiposMaterial,
    codObjetoCusto,
    objetosCusto,
    porTipo,
    percentual,
    porMes: [...porMesMap.values()],
    porFrota,
    porComponente,
    porObjetoCusto,
    analitico,
  };
}

export async function gerarGestaoManutencao(opts: {
  ano?: number | null;
  dataInicio?: string | null;
  dataFim?: string | null;
  categoria?: string | null;
  codTipoEquipamento?: number | null;
  codEquipamento?: number | null;
  tipoMaterial?: string | null;
  codObjetoCusto?: number | null;
}): Promise<GestaoManutencaoPayload> {
  const anos = await loadAnosDisponiveis();
  const { ano, dataInicio, dataFim } = resolvePeriodoGestao({
    ano: opts.ano,
    dataInicio: opts.dataInicio,
    dataFim: opts.dataFim,
    anosDisponiveis: anos,
  });

  const [segments, ordens, horasRodadas, custos] = await runLimited(
    [
      () => loadSegmentos(dataInicio, dataFim),
      () => loadOrdensPeriodo(dataInicio, dataFim),
      () => loadHorasRodadas(dataInicio, dataFim),
      () => loadCustosManutencao(dataInicio, dataFim),
    ],
    1,
  );
  const { todas: osTodas, corretivas } = ordens;
  const tipoHorimetro = tipoHorimetroPorEquip(segments);

  const categoriasSet = new Set<string>();
  const tipoMap = new Map<number, { codTipoEquipamento: number; label: string; categoria: string }>();
  const equipMap = new Map<
    number,
    {
      codEquipamento: number;
      label: string;
      categoria: string;
      codTipoEquipamento: number;
      fim: string;
    }
  >();
  for (const seg of segments) {
    categoriasSet.add(seg.categoria);
    if (!tipoMap.has(seg.codTipo)) {
      tipoMap.set(seg.codTipo, {
        codTipoEquipamento: seg.codTipo,
        label: (seg.tipoDescricao || `Tipo ${seg.codTipo}`).trim(),
        categoria: seg.categoria,
      });
    }
    const prev = equipMap.get(seg.codEquipamento);
    if (!prev || seg.segFim >= prev.fim) {
      equipMap.set(seg.codEquipamento, {
        codEquipamento: seg.codEquipamento,
        label: String(seg.codEquipamento),
        categoria: seg.categoria,
        codTipoEquipamento: seg.codTipo,
        fim: seg.segFim,
      });
    }
  }

  const categoria = opts.categoria?.trim() || null;
  const codTipoEquipamento =
    opts.codTipoEquipamento != null && Number.isFinite(opts.codTipoEquipamento) && opts.codTipoEquipamento > 0
      ? opts.codTipoEquipamento
      : null;
  const codEquipamento =
    opts.codEquipamento != null && Number.isFinite(opts.codEquipamento) && opts.codEquipamento > 0
      ? opts.codEquipamento
      : null;

  const filterOpts = { categoria, codTipoEquipamento, codEquipamento };
  const equipIds = equipIdsForFilter(segments, filterOpts);

  const calcPeriodo = (ini: string, fim: string) => {
    const pot = horasPotenciaisEquip(segments, equipIds, ini, fim, {
      categoria,
      codTipoEquipamento,
    });
    const oficina = horasOficinaEquip(osTodas, equipIds, ini, fim);
    const operacao = tempoOperacaoMtbf({
      segments,
      osList: osTodas,
      horasRodadas,
      tipoHorimetro,
      equipIds,
      periodIni: ini,
      periodTo: fim,
      filterOpts: { categoria, codTipoEquipamento },
    });
    const { qtd, reparo } = falhasNoPeriodo(corretivas, equipIds, ini, fim);
    const disponibilidade = dispPct(pot, oficina);
    const indisponibilidade =
      disponibilidade == null ? null : money(Math.max(100 - disponibilidade, 0));
    return {
      qtdFalhas: qtd,
      tempoReparoHoras: money(reparo),
      tempoOperacaoHoras: money(operacao),
      mttrHoras: ratioOrNull(reparo, qtd),
      mtbfHoras: ratioOrNull(operacao, qtd),
      disponibilidade,
      indisponibilidade,
    };
  };

  const kpis = calcPeriodo(dataInicio, dataFim);
  const lookupEquip = new Map<number, { categoria: string; tipoEquipamento: string }>();
  for (const eq of equipMap.values()) {
    lookupEquip.set(eq.codEquipamento, {
      categoria: eq.categoria,
      tipoEquipamento: tipoMap.get(eq.codTipoEquipamento)?.label ?? "",
    });
  }
  const falhasMttr = detalheFalhasMttr(corretivas, equipIds, dataInicio, dataFim, lookupEquip);

  const mesesPeriodo = monthsInRange(dataInicio, dataFim);
  const meses: GestaoManutencaoMes[] = mesesPeriodo.map((mes) => ({
    key: mes.key,
    label: mes.label,
    ...calcPeriodo(mes.from, mes.to),
  }));
  const custo = custoResumo(custos, equipIds, mesesPeriodo, opts.tipoMaterial, opts.codObjetoCusto);

  const categorias = [...categoriasSet].sort((a, b) => {
    if (a === "#N/D") return 1;
    if (b === "#N/D") return -1;
    return a.localeCompare(b, "pt-BR");
  });

  const tipos = [...tipoMap.values()]
    .filter((t) => !categoria || t.categoria === categoria)
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  const equipamentos = [...equipMap.values()]
    .map(({ codEquipamento: cod, label, categoria: cat, codTipoEquipamento: codTipo }) => ({
      codEquipamento: cod,
      label,
      categoria: cat,
      codTipoEquipamento: codTipo,
    }))
    .filter((e) => !categoria || e.categoria === categoria)
    .filter((e) => codTipoEquipamento == null || e.codTipoEquipamento === codTipoEquipamento)
    .sort((a, b) => a.codEquipamento - b.codEquipamento);

  const anosFiltro = anos.length ? anos : [ano];
  const configMetas = readGestaoManutencaoConfig();
  const metaCodTipo =
    codTipoEquipamento ?? (codEquipamento != null ? equipMap.get(codEquipamento)?.codTipoEquipamento ?? null : null);
  const metaAtiva = metasParaTipo(configMetas, metaCodTipo);

  return {
    ano,
    safra: safraLabel(ano),
    categoria,
    codTipoEquipamento,
    codEquipamento,
    dataInicio,
    dataFim,
    filtros: {
      anos: anosFiltro,
      safras: anosFiltro.map((a) => ({ ano: a, label: safraLabel(a) })),
      categorias,
      tipos,
      equipamentos,
    },
    meta: metaAtiva,
    kpis,
    meses,
    falhasMttr,
    custo,
  };
}

const SQL_BOX_OS = `CASE
            WHEN NVL(os.cod_box, 0) <> 0 THEN os.cod_box
            ELSE TO_NUMBER(REGEXP_SUBSTR(TRIM(os.box), '^[0-9]+'))
          END`;

export type MonitoramentoOsStatus = "DENTRO DO PRAZO" | "EM ATRASO" | "INFORMAR PREVISÃO";

export type MonitoramentoOsItem = {
  ano: number;
  os: number;
  codEquipamento: number | null;
  tipoEquipamento: string;
  box: number | null;
  dataAbertura: string | null;
  horaAbertura: string | null;
  dataPrevisao: string | null;
  horaPrevisao: string | null;
  status: MonitoramentoOsStatus;
  prazoHoras: number;
};

export type MonitoramentoOsData = {
  atualizadoEm: string;
  filtros: {
    box: number | null;
    codTipoEquipamento: number | null;
    codEquipamento: number | null;
    boxes: number[];
    tipos: { codTipoEquipamento: number; label: string }[];
    equipamentos: { codEquipamento: number; label: string; codTipoEquipamento: number | null }[];
  };
  kpis: { emAtraso: number; semPrevisao: number; totalAberta: number };
  status: Array<{ status: MonitoramentoOsStatus; qtd: number; percentual: number }>;
  prazoMedioPorBox: Array<{ box: number | null; label: string; prazoHoras: number }>;
  totalPorBox: Array<{ box: number | null; label: string; qtd: number }>;
  semPrevisaoPorBox: Array<{ box: number | null; label: string; qtd: number }>;
  itens: MonitoramentoOsItem[];
};

function boxLabel(box: number | null) {
  return box == null ? "Sem box" : String(box);
}

function readBox(raw: Record<string, unknown>) {
  const text = oracleText(raw, "box", "BOX");
  const n = Number(text);
  if (text !== "" && Number.isFinite(n)) return n;
  return null;
}

function parseStatusOs(raw: string | null | undefined): MonitoramentoOsStatus {
  const text = String(raw ?? "").trim().toUpperCase();
  if (text === "EM ATRASO") return "EM ATRASO";
  if (text === "INFORMAR PREVISÃO" || text === "INFORMAR PREVISAO") return "INFORMAR PREVISÃO";
  return "DENTRO DO PRAZO";
}

export async function gerarMonitoramentoOs(opts: {
  box?: number | null;
  codTipoEquipamento?: number | null;
  codEquipamento?: number | null;
}): Promise<MonitoramentoOsData> {
  const boxFiltro = opts.box != null && Number.isFinite(opts.box) && opts.box > 0 ? opts.box : null;
  const tipoFiltro =
    opts.codTipoEquipamento != null && Number.isFinite(opts.codTipoEquipamento) && opts.codTipoEquipamento > 0
      ? opts.codTipoEquipamento
      : null;
  const equipFiltro =
    opts.codEquipamento != null && Number.isFinite(opts.codEquipamento) && opts.codEquipamento > 0
      ? opts.codEquipamento
      : null;

  return withOracle(async (conn) => {
    const [itensResult, atualizadoResult] = await Promise.all([
      conn.execute(
        `SELECT os.ano_ordemservico,
                os.numero_ordemservico,
                os.cod_equipamento,
                ht.cod_tipoequipamento,
                NVL(te.descricaotipoequipamento, 'Tipo ' || ht.cod_tipoequipamento) AS tipo_equipamento,
                ${SQL_BOX_OS} AS box,
                TO_CHAR(os.dtabertura, 'YYYY-MM-DD') AS data_abertura,
                TO_CHAR(os.dtabertura, 'HH24:MI:SS') AS hora_abertura,
                TO_CHAR(os.dtprevisao, 'YYYY-MM-DD') AS data_previsao,
                TO_CHAR(os.dtprevisao, 'HH24:MI:SS') AS hora_previsao,
                CASE
                  WHEN os.dtprevisao IS NULL THEN 'INFORMAR PREVISÃO'
                  WHEN os.dtprevisao < SYSDATE THEN 'EM ATRASO'
                  ELSE 'DENTRO DO PRAZO'
                END AS status,
                (SYSDATE - os.dtabertura) * 24 AS prazo_horas
           FROM automotivo.ordemservico os
           LEFT JOIN automotivo.historico_tipoequipamento ht
             ON ht.cod_equipamento = os.cod_equipamento
            AND ht.data_fim IS NULL
           LEFT JOIN automotivo.tipoequipamento te
             ON te.cod_tipoequipamento = ht.cod_tipoequipamento
          WHERE os.dtencerramento IS NULL
            AND os.cod_equipamento IS NOT NULL
          ORDER BY os.ano_ordemservico, os.numero_ordemservico`,
        {},
        { maxRows: 0, fetchArraySize: 500 },
      ),
      conn.execute(`SELECT TO_CHAR(SYSDATE, 'DD/MM/YYYY HH24:MI:SS') AS atualizado_em FROM dual`),
    ]);

    const atualizadoEm =
      oracleText((atualizadoResult.rows ?? [])[0] as Record<string, unknown> | undefined ?? {}, "atualizado_em") ||
      "";

    const boxes = new Set<number>();
    const tipoMap = new Map<number, string>();
    const equipMap = new Map<number, { label: string; codTipoEquipamento: number | null }>();
    const itensMap = new Map<string, MonitoramentoOsItem>();

    for (const raw of (itensResult.rows ?? []) as Record<string, unknown>[]) {
      const ano = oracleNumber(raw, "ano_ordemservico", "ANO_ORDEMSERVICO");
      const os = oracleNumber(raw, "numero_ordemservico", "NUMERO_ORDEMSERVICO");
      if (ano == null || os == null) continue;
      const box = readBox(raw);
      const codTipo = oracleNumber(raw, "cod_tipoequipamento", "COD_TIPOEQUIPAMENTO");
      const codEquipamento = oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO");
      const tipoLabel = oracleText(raw, "tipo_equipamento", "TIPO_EQUIPAMENTO") || "—";
      if (box != null) boxes.add(box);
      if (codTipo != null) tipoMap.set(codTipo, tipoLabel);
      if (codEquipamento != null) {
        equipMap.set(codEquipamento, {
          label: String(codEquipamento),
          codTipoEquipamento: codTipo,
        });
      }

      if (boxFiltro != null && box !== boxFiltro) continue;
      if (tipoFiltro != null && codTipo !== tipoFiltro) continue;
      if (equipFiltro != null && codEquipamento !== equipFiltro) continue;

      const dtprevisao = oracleText(raw, "data_previsao", "DATA_PREVISAO") || null;
      const key = `${ano}/${os}`;
      if (!itensMap.has(key)) {
        itensMap.set(key, {
          ano,
          os,
          codEquipamento,
          tipoEquipamento: tipoLabel,
          box,
          dataAbertura: oracleText(raw, "data_abertura", "DATA_ABERTURA") || null,
          horaAbertura: oracleText(raw, "hora_abertura", "HORA_ABERTURA") || null,
          dataPrevisao: dtprevisao,
          horaPrevisao: oracleText(raw, "hora_previsao", "HORA_PREVISAO") || null,
          status: parseStatusOs(oracleText(raw, "status", "STATUS")),
          prazoHoras: money(oracleNumber(raw, "prazo_horas", "PRAZO_HORAS") ?? 0),
        });
      }
    }

    const itens = [...itensMap.values()];

    const totalAberta = itens.length;
    const emAtraso = itens.filter((row) => row.status === "EM ATRASO").length;
    const semPrevisao = itens.filter((row) => row.status === "INFORMAR PREVISÃO").length;
    const dentro = itens.filter((row) => row.status === "DENTRO DO PRAZO").length;
    const pct = (n: number) => (totalAberta > 0 ? money((n / totalAberta) * 100) : 0);

    const prazoAcc = new Map<string, { box: number | null; soma: number; n: number }>();
    const totalBox = new Map<string, { box: number | null; qtd: number }>();
    const semPrevBox = new Map<string, { box: number | null; qtd: number }>();
    for (const row of itens) {
      const key = boxLabel(row.box);
      const tot = totalBox.get(key) ?? { box: row.box, qtd: 0 };
      tot.qtd += 1;
      totalBox.set(key, tot);
      const acc = prazoAcc.get(key) ?? { box: row.box, soma: 0, n: 0 };
      acc.soma += row.prazoHoras;
      acc.n += 1;
      prazoAcc.set(key, acc);
      if (row.status === "INFORMAR PREVISÃO") {
        const prev = semPrevBox.get(key) ?? { box: row.box, qtd: 0 };
        prev.qtd += 1;
        semPrevBox.set(key, prev);
      }
    }

    return {
      atualizadoEm,
      filtros: {
        box: boxFiltro,
        codTipoEquipamento: tipoFiltro,
        codEquipamento: equipFiltro,
        boxes: [...boxes].sort((a, b) => a - b),
        tipos: [...tipoMap.entries()]
          .map(([codTipoEquipamento, label]) => ({ codTipoEquipamento, label }))
          .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
        equipamentos: [...equipMap.entries()]
          .map(([codEquipamento, info]) => ({
            codEquipamento,
            label: info.label,
            codTipoEquipamento: info.codTipoEquipamento,
          }))
          .sort((a, b) => a.codEquipamento - b.codEquipamento),
      },
      kpis: { emAtraso, semPrevisao, totalAberta },
      status: [
        { status: "DENTRO DO PRAZO" as const, qtd: dentro, percentual: pct(dentro) },
        { status: "EM ATRASO" as const, qtd: emAtraso, percentual: pct(emAtraso) },
        { status: "INFORMAR PREVISÃO" as const, qtd: semPrevisao, percentual: pct(semPrevisao) },
      ].filter((row) => row.qtd > 0),
      prazoMedioPorBox: [...prazoAcc.values()]
        .map((acc) => ({ box: acc.box, label: boxLabel(acc.box), prazoHoras: money(acc.soma / acc.n) }))
        .sort((a, b) => b.prazoHoras - a.prazoHoras),
      totalPorBox: [...totalBox.values()]
        .map((row) => ({ box: row.box, label: boxLabel(row.box), qtd: row.qtd }))
        .sort((a, b) => b.qtd - a.qtd),
      semPrevisaoPorBox: [...semPrevBox.values()]
        .map((row) => ({ box: row.box, label: boxLabel(row.box), qtd: row.qtd }))
        .sort((a, b) => b.qtd - a.qtd),
      itens,
    };
  });
}
