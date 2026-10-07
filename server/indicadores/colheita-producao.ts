import { listarEntradaCanaCaminhao } from "../colheita/entrada-cana-caminhao-list.js";
import { listarEntradaCanaMaquinaList } from "../colheita/entrada-cana-maquina-list.js";
import { listarFazendaUsina } from "../colheita/fazenda-usina.js";
import { normalizePeriodoColheita } from "../colheita/periodo-colheita.js";
import { listarHorasMaquina, type HorasMaquinaRow } from "../colheita/horas-maquina.js";
import { diaUtcFromIso, scanOrdsCollection, toNumber } from "../colheita/ords-common.js";
import {
  enrichQualidadeImpureza,
  loadQualidadeColheita,
  type ColheitaQualidadeData,
} from "./colheita-qualidade.js";
import { oracleDate, oracleNumber, oracleText, runLimited, withOracle } from "../oracle.js";
import {
  gerarDisponibilidadeHorasPorEquipamento,
  mergeDispHorasEquipamentos,
  type DispHorasEquip,
} from "./disponibilidade-equipamentos.js";
import { anexarHorasRodadas } from "../../src/lib/colheita-horas-rodadas.js";
import { addIsoDays, calcularCapacidadeColhedoras, decomporNaoAtingimentoMeta } from "../../src/lib/capacidade-colhedoras.js";

const TIPO_COLHEDORA = 81;
const TIPOS_TRANSBORDO = new Set([90, 93]);
/** Tratores de colheita (historico vigente) — alinhado ao rateio objeto 116. */
const TIPOS_TRATOR_COLHEITA = new Set([12, 93, 64, 6]);
/** Cards de disponibilidade por tipo vigente em historico_tipoequipamento. */
export const KPI_CATEGORIAS = [
  {
    id: "colhedora",
    label: "COLHEDORA",
    tipos: [81],
    classificacoes: [] as number[],
    icon: "colhedora.svg",
  },
  {
    id: "transbordo",
    label: "TRATOR TRANSBORDO",
    tipos: [93],
    classificacoes: [] as number[],
    icon: "transbordo.svg",
  },
  {
    id: "impl_transb",
    label: "IMPL. TRANSB",
    tipos: [90],
    classificacoes: [] as number[],
    icon: "impl-transb.svg",
  },
  {
    id: "cav_mecanico",
    label: "CAV. MECÂNICO",
    tipos: [30],
    classificacoes: [] as number[],
    icon: "cav-mecanico.svg",
  },
  {
    id: "reboque",
    label: "REBOQUE",
    tipos: [8],
    classificacoes: [] as number[],
    icon: "reboque.svg",
  },
] as const;

const TIPOS_KPI_FROTA = new Set(KPI_CATEGORIAS.flatMap((k) => k.tipos));

function kpiIdPorTipo(codTipo: number | null): (typeof KPI_CATEGORIAS)[number]["id"] | null {
  if (codTipo == null) return null;
  for (const k of KPI_CATEGORIAS) {
    if (k.tipos.includes(codTipo as (typeof k.tipos)[number])) return k.id;
  }
  return null;
}

/** OS aberta com tipo vigente (dtencerramento IS NULL + historico data_fim IS NULL).
 * Colhedora (tipo 81): O.S. com plano de prevenção não conta como parada. */
const SQL_OS_PARADO_VIGENTE = `EXISTS (
  SELECT 1
    FROM automotivo.ordemservico os
   WHERE os.dtencerramento IS NULL
     AND os.cod_equipamento = e.cod_equipamento
     AND (ht.cod_tipoequipamento <> ${TIPO_COLHEDORA} OR os.cod_planoprevencao IS NULL)
     AND EXISTS (
       SELECT 1
         FROM automotivo.historico_tipoequipamento b
        WHERE b.data_fim IS NULL
          AND b.cod_equipamento = os.cod_equipamento
          AND b.cod_tipoequipamento = ht.cod_tipoequipamento
     )
)`;

function codGrupoEmpresa() {
  return Number(process.env.COD_GRUPOEMPRESA || 1);
}

function colheitaDiariaOrdsUrl() {
  const fromEnv = process.env.ORDS_COLHEITA_DIARIA_URL?.trim();
  if (!fromEnv) throw new Error("Configure ORDS_COLHEITA_DIARIA_URL no .env.");
  return fromEnv.replace(/\/?$/, "/");
}

function paradaColheitaOrdsUrl() {
  const fromEnv = process.env.ORDS_PARADA_COLHEITA_URL?.trim();
  if (!fromEnv) throw new Error("Configure ORDS_PARADA_COLHEITA_URL no .env.");
  return fromEnv.replace(/\/?$/, "/");
}

export async function gerarToneladasColheitaDiaria(dataInicio: string, dataFim: string) {
  const entrada = await listarEntradaCanaMaquinaList({ dataInicio, dataFim });
  const porDia = new Map<string, number>();
  for (const row of entrada.dados) {
    const dia = diaUtcFromIso(row.dataColheita);
    if (!dia) continue;
    porDia.set(dia, (porDia.get(dia) ?? 0) + (row.peso ?? 0));
  }
  return iterDias(dataInicio, dataFim).map((data) => ({
    data,
    toneladas: money(porDia.get(data) ?? 0),
    previsao: null,
    cotaDiaria: 0,
  }));
}
export async function gerarToneladasColheitaDiariaApi(dataInicio: string, dataFim: string) {
  const collected = await scanOrdsCollection(colheitaDiariaOrdsUrl(), {
    maxRows: 20_000,
    match: (item) => {
      const dia = diaUtcFromIso(item.data_colheita);
      return Boolean(dia && dia >= dataInicio && dia <= dataFim);
    },
    map: (item) => {
      const dia = diaUtcFromIso(item.data_colheita);
      const toneladas = toNumber(item.toneladas) ?? 0;
      const hora = toNumber(item.hora_colheita);
      const horasEfetivas = hora != null ? hora - 7 : null;
      const previsao = horasEfetivas != null && horasEfetivas > 0 ? (toneladas / horasEfetivas) * 24 : null;
      return dia
        ? { dia, toneladas, previsao, atr: toNumber(item.atr), cotaDiaria: toNumber(item.cotadiaria) ?? 0 }
        : null;
    },
  });
  const porDia = new Map<string, { toneladas: number; previsao: number | null; atrW: number; atrPeso: number; cotaDiaria: number }>();
  for (const row of collected.dados as Array<{
    dia: string;
    toneladas: number;
    previsao: number | null;
    atr: number | null;
    cotaDiaria: number;
  }>) {
    const atual = porDia.get(row.dia) ?? { toneladas: 0, previsao: null, atrW: 0, atrPeso: 0, cotaDiaria: 0 };
    atual.toneladas += row.toneladas;
    atual.cotaDiaria += row.cotaDiaria ?? 0;
    if (row.previsao != null) atual.previsao = (atual.previsao ?? 0) + row.previsao;
    if (row.atr != null && row.toneladas > 0) {
      atual.atrW += row.atr * row.toneladas;
      atual.atrPeso += row.toneladas;
    }
    porDia.set(row.dia, atual);
  }
  return iterDias(dataInicio, dataFim).map((data) => ({
    data,
    toneladas: money(porDia.get(data)?.toneladas ?? 0),
    previsao: porDia.get(data)?.previsao == null ? null : money(porDia.get(data)!.previsao!),
    atr: porDia.get(data)?.atrPeso ? money(porDia.get(data)!.atrW / porDia.get(data)!.atrPeso) : null,
    cotaDiaria: money(porDia.get(data)?.cotaDiaria ?? 0),
  }));
}

function money(n: number) {
  return Math.round((n || 0) * 100) / 100;
}

function isoTodayLocal() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function horasTrabalhadasColhedoraPorDia(rows: HorasMaquinaRow[], colhedoraIds: Set<number>) {
  const filtradas = rows.filter((row) => row.codEquipamento != null && colhedoraIds.has(row.codEquipamento));
  const comRodadas = anexarHorasRodadas(filtradas);
  const map = new Map<string, number>();
  for (const row of comRodadas) {
    const dia = diaUtcFromIso(row.data);
    if (!dia) continue;
    const horas = row.horasMotorRodadas;
    if (horas == null || !(horas > 0) || horas > 36) continue;
    map.set(dia, (map.get(dia) ?? 0) + horas);
  }
  return map;
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export type CategoriaEquip = "colhedora" | "trator" | "caminhao" | "transbordo" | "outros";

export function classificarEquipamento(descTipo: string | null, codTipo: number | null): CategoriaEquip {
  if (codTipo === TIPO_COLHEDORA) return "colhedora";
  if (codTipo != null && TIPOS_TRANSBORDO.has(codTipo)) return "transbordo";
  if (codTipo != null && TIPOS_TRATOR_COLHEITA.has(codTipo)) return "trator";
  const d = normalizeText(descTipo);
  if (d.includes("COLHED")) return "colhedora";
  if (d.includes("CAMINH")) return "caminhao";
  if (d.includes("TRANSBORD")) return "transbordo";
  if (d.includes("TRATOR")) return "trator";
  return "outros";
}

function isColhedoraTipo(codTipo: number | null) {
  return codTipo === TIPO_COLHEDORA;
}

function isTratorColheitaTipo(codTipo: number | null) {
  return codTipo != null && TIPOS_TRATOR_COLHEITA.has(codTipo);
}

function pickTagFromCount(tagCount: Map<string, number>) {
  const tagPorEquip = new Map<number, string>();
  for (const [key, qtd] of tagCount) {
    const [codStr, tag] = key.split("::");
    const cod = Number(codStr);
    const prev = tagPorEquip.get(cod);
    const prevQtd = prev ? tagCount.get(`${cod}::${prev}`) ?? 0 : 0;
    if (!prev || qtd > prevQtd) tagPorEquip.set(cod, tag);
  }
  return tagPorEquip;
}

/** Normaliza TAG / número da máquina para comparação (ex.: "01" ≡ "1"). */
function normalizeTagKey(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const raw = String(value).trim().toUpperCase();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return String(Number(raw));
  return raw;
}

type EquipamentoTagVigencia = {
  tagNorm: string;
  tag: string;
  codEquipamento: number;
  dataInicial: string;
  dataFinal: string | null;
};

/**
 * Histórico de tag → equipamento (automotivo.equipamento_tag).
 * A mesma TAG pode apontar para equipamentos diferentes conforme DATA_INICIAL/DATA_FINAL.
 */
async function loadEquipamentoTags(): Promise<EquipamentoTagVigencia[]> {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT tag,
              cod_equipamento,
              data_inicial,
              data_final
         FROM automotivo.equipamento_tag
        WHERE cod_grupoempresa = :codGrupo
          AND tag IS NOT NULL`,
      { codGrupo: codGrupoEmpresa() },
    );
    const out: EquipamentoTagVigencia[] = [];
    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const tag = oracleText(row, "tag", "TAG");
      const tagNorm = normalizeTagKey(tag);
      const cod = oracleNumber(row, "cod_equipamento", "COD_EQUIPAMENTO");
      const iniRaw = oracleDate(row, "data_inicial", "DATA_INICIAL");
      const fimRaw = oracleDate(row, "data_final", "DATA_FINAL");
      const dataInicial = iniRaw ? diaUtcFromIso(iniRaw) ?? String(iniRaw).slice(0, 10) : null;
      if (!tagNorm || cod == null || !dataInicial) continue;
      out.push({
        tagNorm,
        tag,
        codEquipamento: cod,
        dataInicial,
        dataFinal: fimRaw ? diaUtcFromIso(fimRaw) ?? String(fimRaw).slice(0, 10) : null,
      });
    }
    return out;
  });
}

/** Resolve cod_equipamento pela TAG vigente na data de colheita. */
function resolveCodPorEquipamentoTag(
  tags: EquipamentoTagVigencia[],
  maquina: number | string | null | undefined,
  dataColheita: string | null | undefined,
): number | null {
  const key = normalizeTagKey(maquina);
  const dia = diaUtcFromIso(dataColheita ?? null);
  if (!key || !dia) return null;
  let best: EquipamentoTagVigencia | null = null;
  for (const row of tags) {
    if (row.tagNorm !== key) continue;
    if (dia < row.dataInicial) continue;
    if (row.dataFinal != null && dia > row.dataFinal) continue;
    if (!best || row.dataInicial > best.dataInicial) best = row;
  }
  return best?.codEquipamento ?? null;
}

function extractCaminhaoNumeroFromDesc(desc: string | null | undefined): string | null {
  if (!desc) return null;
  const match = String(desc).match(/(\d{5,6})\s*$/);
  return match ? match[1] : null;
}

/** Mapa número do caminhão (ORDS) → cod_equipamento (descrição ERP, ex.: "... 131861"). */
async function loadCaminhaoCodPorNumero(): Promise<Map<string, number>> {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT e.cod_equipamento, e.descricao
         FROM automotivo.equipamento e
        WHERE e.descricao IS NOT NULL`,
    );
    const map = new Map<string, number>();
    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const cod = oracleNumber(row, "cod_equipamento", "COD_EQUIPAMENTO");
      const desc = oracleText(row, "descricao", "DESCRICAO");
      const num = extractCaminhaoNumeroFromDesc(desc);
      if (cod != null && num) map.set(num, cod);
    }
    return map;
  });
}

function resolveCodEquipamentoCaminhao(
  caminhao: number | string | null | undefined,
  data: string | null | undefined,
  tags: EquipamentoTagVigencia[],
  porNumero: Map<string, number>,
  ordsCod: number | null | undefined,
): number | null {
  if (ordsCod != null && Number.isFinite(ordsCod)) return ordsCod;
  const porTag = resolveCodPorEquipamentoTag(tags, caminhao, data);
  if (porTag != null) return porTag;
  if (caminhao == null) return null;
  return porNumero.get(String(caminhao).trim()) ?? null;
}

function pctDisponibilidade(total: number, parado: number) {
  if (!total) return null;
  return money(((total - parado) / total) * 100);
}

function iterDias(dataInicio: string, dataFim: string) {
  const out: string[] = [];
  const ini = new Date(`${dataInicio}T12:00:00`);
  const fim = new Date(`${dataFim}T12:00:00`);
  if (!Number.isFinite(ini.getTime()) || !Number.isFinite(fim.getTime())) return out;
  for (let cur = ini; cur <= fim; cur = new Date(cur.getTime() + 86400000)) {
    out.push(cur.toISOString().slice(0, 10));
  }
  return out;
}

function diasNoPeriodo(dataInicio: string, dataFim: string) {
  const ini = new Date(`${dataInicio}T12:00:00`);
  const fim = new Date(`${dataFim}T12:00:00`);
  if (!Number.isFinite(ini.getTime()) || !Number.isFinite(fim.getTime())) return 1;
  return Math.max(1, Math.round((fim.getTime() - ini.getTime()) / 86400000) + 1);
}

type EquipOracle = {
  codEquipamento: number;
  descricao: string | null;
  codTipoEquipamento: number | null;
  tipoDescricao: string | null;
  codFrente: number | null;
  frenteDescricao: string | null;
};

async function loadEquipamentosOracle(refDate: Date) {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT e.cod_equipamento,
              e.descricao,
              ht.cod_tipoequipamento,
              te.descricaotipoequipamento,
              ef.cod_frente,
              f.descricao AS frente_descricao
         FROM automotivo.equipamento e
         LEFT JOIN automotivo.historico_tipoequipamento ht
           ON ht.cod_equipamento = e.cod_equipamento
          AND ht.data_fim IS NULL
         LEFT JOIN automotivo.tipoequipamento te
           ON te.cod_tipoequipamento = ht.cod_tipoequipamento
         LEFT JOIN agricola.equipamento_frente ef
           ON ef.cod_equipamento = e.cod_equipamento
          AND TRUNC(:refDate) BETWEEN TRUNC(ef.data_inicio) AND TRUNC(NVL(ef.data_termino, SYSDATE))
         LEFT JOIN agricola.frente f
           ON f.cod_frente = ef.cod_frente
        WHERE e.cod_grupoempresa = :codGrupo
        ORDER BY e.cod_equipamento`,
      { refDate, codGrupo: codGrupoEmpresa() },
    );
    const map = new Map<number, EquipOracle>();
    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const cod = oracleNumber(row, "cod_equipamento", "COD_EQUIPAMENTO");
      if (cod == null) continue;
      if (!map.has(cod)) {
        map.set(cod, {
          codEquipamento: cod,
          descricao: oracleText(row, "descricao", "DESCRICAO"),
          codTipoEquipamento: oracleNumber(row, "cod_tipoequipamento", "COD_TIPOEQUIPAMENTO"),
          tipoDescricao: oracleText(row, "descricaotipoequipamento", "DESCRICAOTIPEQUIPAMENTO"),
          codFrente: oracleNumber(row, "cod_frente", "COD_FRENTE"),
          frenteDescricao: oracleText(row, "frente_descricao", "FRENTE_DESCRICAO"),
        });
      }
    }
    return map;
  });
}

/** OS aberta (dtencerramento IS NULL) com tipo vigente no historico. */
async function loadParadosAbertos() {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT DISTINCT os.cod_equipamento
         FROM automotivo.ordemservico os
        WHERE os.cod_equipamento IS NOT NULL
          AND os.dtencerramento IS NULL
          AND EXISTS (
            SELECT 1
              FROM automotivo.historico_tipoequipamento b
             WHERE b.data_fim IS NULL
               AND b.cod_equipamento = os.cod_equipamento
          )
          AND (
            os.cod_planoprevencao IS NULL
            OR NOT EXISTS (
              SELECT 1
                FROM automotivo.historico_tipoequipamento b
               WHERE b.data_fim IS NULL
                 AND b.cod_equipamento = os.cod_equipamento
                 AND b.cod_tipoequipamento = ${TIPO_COLHEDORA}
            )
          )`,
    );
    const set = new Set<number>();
    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const cod = oracleNumber(row, "cod_equipamento", "COD_EQUIPAMENTO");
      if (cod != null) set.add(cod);
    }
    return set;
  });
}

/** Frota KPI: tipo vigente + disponibilidade preenchida + parada por OS aberta. */
async function loadKpiFrotaDisponibilidade() {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT e.cod_equipamento,
              e.descricao,
              ht.cod_tipoequipamento,
              CASE WHEN ${SQL_OS_PARADO_VIGENTE} THEN 1 ELSE 0 END AS parado
         FROM automotivo.equipamento e
         JOIN automotivo.historico_tipoequipamento ht
           ON ht.cod_equipamento = e.cod_equipamento
          AND ht.data_fim IS NULL
        WHERE e.cod_grupoempresa = :codGrupo
          AND e.disponibilidade IS NOT NULL
          AND ht.cod_tipoequipamento IN (81, 90, 93, 30, 8)
        ORDER BY e.cod_equipamento`,
      { codGrupo: codGrupoEmpresa() },
    );
    const rows: Array<{ cod: number; descricao: string | null; tipo: number; parado: boolean }> = [];
    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const cod = oracleNumber(row, "cod_equipamento", "COD_EQUIPAMENTO");
      const tipo = oracleNumber(row, "cod_tipoequipamento", "COD_TIPOEQUIPAMENTO");
      const parado = Number(oracleNumber(row, "parado", "PARADO") ?? 0) === 1;
      if (cod == null || tipo == null) continue;
      if (!TIPOS_KPI_FROTA.has(tipo)) continue;
      if (!kpiIdPorTipo(tipo)) continue;
      rows.push({
        cod,
        descricao: oracleText(row, "descricao", "DESCRICAO"),
        tipo,
        parado,
      });
    }
    return rows;
  });
}

async function loadEquipamentosTiposColheita(refDate: Date) {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT e.cod_equipamento,
              e.descricao,
              ht.cod_tipoequipamento,
              te.descricaotipoequipamento,
              ef.cod_frente,
              f.descricao AS frente_descricao
         FROM automotivo.equipamento e
         JOIN automotivo.historico_tipoequipamento ht
           ON ht.cod_equipamento = e.cod_equipamento
          AND ht.data_fim IS NULL
         LEFT JOIN automotivo.tipoequipamento te
           ON te.cod_tipoequipamento = ht.cod_tipoequipamento
         LEFT JOIN agricola.equipamento_frente ef
           ON ef.cod_equipamento = e.cod_equipamento
          AND TRUNC(:refDate) BETWEEN TRUNC(ef.data_inicio) AND TRUNC(NVL(ef.data_termino, SYSDATE))
         LEFT JOIN agricola.frente f
           ON f.cod_frente = ef.cod_frente
        WHERE e.cod_grupoempresa = :codGrupo
          AND e.disponibilidade IS NOT NULL
          AND ht.cod_tipoequipamento IN (81, 90, 93)
        ORDER BY e.cod_equipamento`,
      { refDate, codGrupo: codGrupoEmpresa() },
    );
    const map = new Map<number, EquipOracle>();
    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const cod = oracleNumber(row, "cod_equipamento", "COD_EQUIPAMENTO");
      if (cod == null) continue;
      if (!map.has(cod)) {
        map.set(cod, {
          codEquipamento: cod,
          descricao: oracleText(row, "descricao", "DESCRICAO"),
          codTipoEquipamento: oracleNumber(row, "cod_tipoequipamento", "COD_TIPOEQUIPAMENTO"),
          tipoDescricao: oracleText(row, "descricaotipoequipamento", "DESCRICAOTIPEQUIPAMENTO"),
          codFrente: oracleNumber(row, "cod_frente", "COD_FRENTE"),
          frenteDescricao: oracleText(row, "frente_descricao", "FRENTE_DESCRICAO"),
        });
      }
    }
    return map;
  });
}

async function loadDisponibilidadeDiaria(dataInicio: string, dataFim: string) {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `WITH dias AS (
         SELECT TRUNC(TO_DATE(:dataInicio, 'YYYY-MM-DD')) + LEVEL - 1 AS dia
           FROM dual
        CONNECT BY TRUNC(TO_DATE(:dataInicio, 'YYYY-MM-DD')) + LEVEL - 1
               <= TRUNC(TO_DATE(:dataFim, 'YYYY-MM-DD'))
       ),
       equip_dia AS (
         SELECT d.dia,
                e.cod_equipamento,
                ht.cod_tipoequipamento
           FROM dias d
           JOIN automotivo.equipamento e
             ON e.cod_grupoempresa = :codGrupo
            AND e.disponibilidade IS NOT NULL
           JOIN automotivo.historico_tipoequipamento ht
             ON ht.cod_equipamento = e.cod_equipamento
            AND TRUNC(d.dia) BETWEEN TRUNC(ht.data_inicio) AND TRUNC(NVL(ht.data_fim, SYSDATE))
          WHERE ht.cod_tipoequipamento IN (81, 90, 93)
       ),
       marcado AS (
         SELECT ed.dia,
                ed.cod_equipamento,
                ed.cod_tipoequipamento,
                CASE
                  WHEN EXISTS (
                    SELECT 1
                      FROM automotivo.ordemservico os
                     WHERE os.cod_equipamento = ed.cod_equipamento
                       AND TRUNC(os.dtabertura) <= TRUNC(ed.dia)
                       AND (os.dtencerramento IS NULL OR TRUNC(os.dtencerramento) > TRUNC(ed.dia))
                       AND (ed.cod_tipoequipamento <> ${TIPO_COLHEDORA} OR os.cod_planoprevencao IS NULL)
                       AND EXISTS (
                         SELECT 1
                           FROM automotivo.historico_tipoequipamento b
                          WHERE b.cod_equipamento = os.cod_equipamento
                            AND TRUNC(ed.dia) BETWEEN TRUNC(b.data_inicio) AND TRUNC(NVL(b.data_fim, SYSDATE))
                            AND b.cod_tipoequipamento = ed.cod_tipoequipamento
                       )
                  ) THEN 1
                  ELSE 0
                END AS parado
           FROM equip_dia ed
       )
       SELECT TO_CHAR(dia, 'YYYY-MM-DD') AS dia_str,
              cod_tipoequipamento,
              COUNT(*) AS total,
              SUM(parado) AS parados
         FROM marcado
        GROUP BY dia, cod_tipoequipamento
        ORDER BY dia, cod_tipoequipamento`,
      { dataInicio, dataFim, codGrupo: codGrupoEmpresa() },
    );

    type Acc = { total: number; parado: number };
    const byDay = new Map<string, { colhedora: Acc; transbordo: Acc }>();
    for (const dia of iterDias(dataInicio, dataFim)) {
      byDay.set(dia, { colhedora: { total: 0, parado: 0 }, transbordo: { total: 0, parado: 0 } });
    }
    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const dia = oracleText(row, "dia_str", "DIA_STR");
      const codTipo = oracleNumber(row, "cod_tipoequipamento", "COD_TIPOEQUIPAMENTO");
      const total = oracleNumber(row, "total", "TOTAL") ?? 0;
      const parados = oracleNumber(row, "parados", "PARADOS") ?? 0;
      if (!dia) continue;
      const acc = byDay.get(dia) ?? { colhedora: { total: 0, parado: 0 }, transbordo: { total: 0, parado: 0 } };
      if (codTipo === TIPO_COLHEDORA) {
        acc.colhedora.total += total;
        acc.colhedora.parado += parados;
      } else if (codTipo != null && TIPOS_TRANSBORDO.has(codTipo)) {
        acc.transbordo.total += total;
        acc.transbordo.parado += parados;
      }
      byDay.set(dia, acc);
    }

    return [...byDay.entries()].map(([data, acc]) => ({
      data,
      colhedora: {
        total: acc.colhedora.total,
        parado: acc.colhedora.parado,
        rodando: acc.colhedora.total - acc.colhedora.parado,
        disponibilidade: pctDisponibilidade(acc.colhedora.total, acc.colhedora.parado),
      },
      transbordo: {
        total: acc.transbordo.total,
        parado: acc.transbordo.parado,
        rodando: acc.transbordo.total - acc.transbordo.parado,
        disponibilidade: pctDisponibilidade(acc.transbordo.total, acc.transbordo.parado),
      },
      toneladaColhida: 0,
    }));
  });
}

function tonColhedoraPorDia(
  linhas: Array<{ dataColheita: string | null; peso: number | null; codEquipamento: number | null }>,
  equipOracle: Map<number, EquipOracle>,
) {
  const map = new Map<string, number>();
  for (const row of linhas) {
    if (row.codEquipamento == null) continue;
    const codTipo = equipOracle.get(row.codEquipamento)?.codTipoEquipamento ?? null;
    if (!isColhedoraTipo(codTipo)) continue;
    const dia = diaUtcFromIso(row.dataColheita);
    if (!dia) continue;
    map.set(dia, (map.get(dia) ?? 0) + (row.peso ?? 0));
  }
  return map;
}

async function loadAbastecimento(dataInicio: string, dataFim: string) {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT cod_equipamento,
              SUM(NVL(qtdelitros, 0)) AS litros,
              SUM(NVL(kmhs_rodados, 0)) AS kmhs,
              SUM(NVL(valor, 0)) AS valor,
              SUM(CASE WHEN origem = 'posto' THEN NVL(qtdelitros, 0) ELSE 0 END) AS litros_posto,
              SUM(CASE WHEN origem = 'posto' THEN NVL(kmhs_rodados, 0) ELSE 0 END) AS kmhs_posto
         FROM (
           SELECT 'automotivo' AS origem,
                  a.cod_equipamento,
                  a.qtdelitros,
                  a.kmhs_rodados,
                  a.qtdelitros * cm.custo_medio AS valor
             FROM automotivo.abastecimento a
             LEFT JOIN (
               SELECT cod_grupoempresa, cod_material, ano, mes, AVG(custo_medio) AS custo_medio
                 FROM material.customedio
                GROUP BY cod_grupoempresa, cod_material, ano, mes
             ) cm
               ON cm.cod_grupoempresa = a.cod_grupoempresa
              AND cm.cod_material = a.cod_material
              AND cm.ano = EXTRACT(YEAR FROM a.dtabastecimento)
              AND cm.mes = EXTRACT(MONTH FROM a.dtabastecimento)
            WHERE TRUNC(a.dtabastecimento) >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
              AND TRUNC(a.dtabastecimento) <= TO_DATE(:dataFim, 'YYYY-MM-DD')
           UNION ALL
           SELECT 'posto' AS origem,
                  p.cod_equipamento,
                  p.qtde_litros AS qtdelitros,
                  p.kmhs_rodados,
                  p.qtde_litros * cm.custo_medio AS valor
             FROM posto.abastecimento p
             LEFT JOIN (
               SELECT cod_grupoempresa, cod_material, ano, mes, AVG(custo_medio) AS custo_medio
                 FROM material.customedio
                GROUP BY cod_grupoempresa, cod_material, ano, mes
             ) cm
               ON cm.cod_grupoempresa = p.cod_grupoempresa
              AND cm.cod_material = p.cod_material
              AND cm.ano = EXTRACT(YEAR FROM p.data)
              AND cm.mes = EXTRACT(MONTH FROM p.data)
            WHERE TRUNC(p.data) >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
              AND TRUNC(p.data) <= TO_DATE(:dataFim, 'YYYY-MM-DD')
         )
        GROUP BY cod_equipamento`,
      { dataInicio, dataFim },
    );
    const map = new Map<number, { litros: number; kmhs: number; valor: number; litrosPosto: number; kmhsPosto: number }>();
    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const cod = oracleNumber(row, "cod_equipamento", "COD_EQUIPAMENTO");
      if (cod == null) continue;
      map.set(cod, {
        litros: money(oracleNumber(row, "litros", "LITROS") ?? 0),
        kmhs: money(oracleNumber(row, "kmhs", "KMHS") ?? 0),
        valor: money(oracleNumber(row, "valor", "VALOR") ?? 0),
        litrosPosto: money(oracleNumber(row, "litros_posto", "LITROS_POSTO") ?? 0),
        kmhsPosto: money(oracleNumber(row, "kmhs_posto", "KMHS_POSTO") ?? 0),
      });
    }
    return map;
  });
}

export type LinhaProducaoEquip = {
  equipTag: string;
  codEquipamento: number;
  toneladaColhida: number;
  litrosCombustivel: number;
  hrsMotor: number;
  hrsElevador: number | null;
  kmRodados: number | null;
  ltTon: number | null;
  ltHr: number | null;
  tonHrMotor: number | null;
  tonHrElevador: number | null;
  tonDia: number | null;
  kmLt: number | null;
  tonViagem: number | null;
  mediaDiaria: number | null;
  custoCombustivel: number;
  rsTon: number | null;
  litrosPosto: number;
  kmhsPosto: number;
  parado: boolean;
  viagens: number | null;
  horasPotenciais: number;
  horasOficina: number;
  disponibilidadePct: number | null;
};

type HorimetroDiff = { motor: number; elevador: number };

function rowOrderKey(row: HorasMaquinaRow) {
  const data = String(row.data ?? "");
  const turno = String(row.turno ?? "").trim().toUpperCase();
  const id = row.id ?? 0;
  return `${data} ${turno.padStart(3, " ")} ${String(id).padStart(12, "0")}`;
}

export function calcularHorasRodadasPorEquipamento(rows: HorasMaquinaRow[]) {
  const porEquip = new Map<number, HorasMaquinaRow[]>();
  for (const row of rows) {
    if (row.codEquipamento == null) continue;
    const leituras = porEquip.get(row.codEquipamento) ?? [];
    leituras.push(row);
    porEquip.set(row.codEquipamento, leituras);
  }

  const result = new Map<number, HorimetroDiff>();
  for (const [cod, leituras] of porEquip) {
    const ordenadas = leituras.slice().sort((a, b) => rowOrderKey(a).localeCompare(rowOrderKey(b)));
    const motor = ordenadas
      .map((row) => row.horaMotor)
      .filter((value): value is number => value != null && Number.isFinite(value));
    const elevador = ordenadas
      .map((row) => row.horasElevador)
      .filter((value): value is number => value != null && Number.isFinite(value));
    result.set(cod, {
      motor: motor.length >= 2 ? Math.max(0, motor[motor.length - 1] - motor[0]) : 0,
      elevador: elevador.length >= 2 ? Math.max(0, elevador[elevador.length - 1] - elevador[0]) : 0,
    });
  }
  return result;
}

function buildLinha(
  cod: number,
  tag: string,
  parado: boolean,
  ton: number,
  abast: { litros: number; kmhs: number; valor?: number; litrosPosto?: number; kmhsPosto?: number } | undefined,
  horas: { motor: number; elevador: number } | undefined,
  viagens: number | null,
  dias: number,
  tableKind: "colhedora" | "trator" | "caminhao",
  disp?: DispHorasEquip | null,
): LinhaProducaoEquip {
  const litros = abast?.litros ?? 0;
  const hrsMotor = horas?.motor ?? 0;
  const hrsElevador = horas?.elevador ?? 0;
  const km = abast?.kmhs ?? 0;
  const valor = abast?.valor ?? 0;
  const litrosPosto = abast?.litrosPosto ?? 0;
  const kmhsPosto = abast?.kmhsPosto ?? 0;
  const base: LinhaProducaoEquip = {
    equipTag: tag,
    codEquipamento: cod,
    toneladaColhida: money(ton),
    litrosCombustivel: money(litros),
    hrsMotor: money(hrsMotor),
    hrsElevador: tableKind === "colhedora" ? money(hrsElevador) : null,
    kmRodados: tableKind === "caminhao" ? money(km) : null,
    ltTon: ton > 0 ? money(litros / ton) : null,
    ltHr: kmhsPosto > 0 ? money(litrosPosto / kmhsPosto) : null,
    tonHrMotor: hrsMotor > 0 ? money(ton / hrsMotor) : null,
    tonHrElevador: tableKind === "colhedora" && hrsElevador > 0 ? money(ton / hrsElevador) : null,
    tonDia: dias > 0 ? money(ton / dias) : null,
    kmLt: litros > 0 && tableKind === "caminhao" ? money(km / litros) : null,
    tonViagem: viagens && viagens > 0 && tableKind === "caminhao" ? money(ton / viagens) : null,
    mediaDiaria: dias > 0 && tableKind === "caminhao" ? money(ton / dias) : null,
    custoCombustivel: money(valor),
    rsTon: ton > 0 ? money(valor / ton) : null,
    litrosPosto: money(litrosPosto),
    kmhsPosto: money(kmhsPosto),
    parado,
    viagens,
    horasPotenciais: disp?.horasPotenciais ?? 0,
    horasOficina: disp?.horasOficina ?? 0,
    disponibilidadePct: disp?.disponibilidadePct ?? null,
  };
  return base;
}

function sumLinhas(
  linhas: LinhaProducaoEquip[],
  tableKind: "colhedora" | "trator" | "caminhao",
  dias: number,
): LinhaProducaoEquip {
  const ton = linhas.reduce((a, r) => a + r.toneladaColhida, 0);
  const litros = linhas.reduce((a, r) => a + r.litrosCombustivel, 0);
  const hrsMotor = linhas.reduce((a, r) => a + r.hrsMotor, 0);
  const hrsElevador = linhas.reduce((a, r) => a + (r.hrsElevador ?? 0), 0);
  const km = linhas.reduce((a, r) => a + (r.kmRodados ?? 0), 0);
  const valor = linhas.reduce((a, r) => a + r.custoCombustivel, 0);
  const litrosPosto = linhas.reduce((a, r) => a + r.litrosPosto, 0);
  const kmhsPosto = linhas.reduce((a, r) => a + r.kmhsPosto, 0);
  const viagens = linhas.reduce((a, r) => a + (r.viagens ?? 0), 0);
  const disp = {
    horasPotenciais: linhas.reduce((a, r) => a + (r.horasPotenciais ?? 0), 0),
    horasOficina: linhas.reduce((a, r) => a + (r.horasOficina ?? 0), 0),
    disponibilidadePct: null as number | null,
  };
  const horasDisp = Math.max(disp.horasPotenciais - disp.horasOficina, 0);
  disp.disponibilidadePct =
    disp.horasPotenciais <= 0 ? (linhas.length ? 0 : null) : money((horasDisp / disp.horasPotenciais) * 100);
  return buildLinha(
    0,
    "Total",
    false,
    ton,
    { litros, kmhs: km, valor, litrosPosto, kmhsPosto },
    { motor: hrsMotor, elevador: hrsElevador },
    viagens || null,
    dias,
    tableKind,
    disp,
  );
}

function buildKpiCards(
  kpiFrota: Array<{ cod: number; descricao: string | null; tipo: number; parado: boolean }>,
) {
  const kpiAcc = new Map<string, { total: number; parado: number; rodando: number }>();
  const kpiEquipList = new Map<
    string,
    Array<{ codEquipamento: number; descricao: string | null; parado: boolean }>
  >();
  for (const k of KPI_CATEGORIAS) {
    kpiAcc.set(k.id, { total: 0, parado: 0, rodando: 0 });
    kpiEquipList.set(k.id, []);
  }
  for (const item of kpiFrota) {
    const kpiId = kpiIdPorTipo(item.tipo);
    if (!kpiId) continue;
    const acc = kpiAcc.get(kpiId)!;
    acc.total += 1;
    if (item.parado) acc.parado += 1;
    else acc.rodando += 1;
    kpiEquipList.get(kpiId)!.push({
      codEquipamento: item.cod,
      descricao: item.descricao,
      parado: item.parado,
    });
  }
  return KPI_CATEGORIAS.map((k) => {
    const acc = kpiAcc.get(k.id)!;
    const equipamentos = (kpiEquipList.get(k.id) ?? []).sort((a, b) =>
      String(a.descricao ?? a.codEquipamento).localeCompare(String(b.descricao ?? b.codEquipamento), "pt-BR"),
    );
    return {
      id: k.id,
      label: k.label,
      icon: k.icon,
      tipos: [...k.tipos],
      classificacoes: [...k.classificacoes],
      total: acc.total,
      parado: acc.parado,
      rodando: acc.rodando,
      disponibilidade: acc.total ? money((acc.rodando / acc.total) * 100) : null,
      equipamentos,
    };
  });
}

type FrenteCtx = {
  cod: number;
  categoria: CategoriaEquip;
  parado: boolean;
  frenteKey: string;
  frenteLabel: string;
};

function buildFrentes(ctxFrenteList: FrenteCtx[]) {
  type FrenteAcc = {
    codFrente: string;
    label: string;
    colhedora: { parado: number; rodando: number };
    transbordo: { parado: number; rodando: number };
  };
  const frentesMap = new Map<string, FrenteAcc>();
  for (const e of ctxFrenteList) {
    if (e.categoria !== "colhedora" && e.categoria !== "transbordo") continue;
    const acc =
      frentesMap.get(e.frenteKey) ??
      ({
        codFrente: e.frenteKey,
        label: e.frenteLabel,
        colhedora: { parado: 0, rodando: 0 },
        transbordo: { parado: 0, rodando: 0 },
      } satisfies FrenteAcc);
    const bucket = e.categoria === "colhedora" ? acc.colhedora : acc.transbordo;
    if (e.parado) bucket.parado += 1;
    else bucket.rodando += 1;
    frentesMap.set(e.frenteKey, acc);
  }

  return [...frentesMap.values()]
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))
    .map((f) => {
      const totalColh = f.colhedora.parado + f.colhedora.rodando;
      const totalTrans = f.transbordo.parado + f.transbordo.rodando;
      const dispColh = totalColh ? money((f.colhedora.rodando / totalColh) * 100) : null;
      const dispTrans = totalTrans ? money((f.transbordo.rodando / totalTrans) * 100) : null;
      const totalGeral = totalColh + totalTrans;
      const dispGeral = totalGeral
        ? money(((f.colhedora.rodando + f.transbordo.rodando) / totalGeral) * 100)
        : null;
      return { ...f, dispColhedora: dispColh, dispTransbordo: dispTrans, dispGeral };
    });
}

const EMPTY_TABELAS = {
  colhedora: { linhas: [], totais: null },
  trator: { linhas: [], totais: null },
  caminhao: { linhas: [], totais: null },
};

type MotivoParadaLinha = { motivo: string; horas: number; qtd: number };
type MotivosParadaTabelas = {
  linhas: MotivoParadaLinha[];
  horasTotal: number;
};

export type ParadaColheitaEvento = {
  id: string | number | null;
  motivo: string;
  inicio: string;
  fim: string;
  horas: number;
};

export type ParadasColheitaData = {
  filtros: { dataInicio: string; dataFim: string };
  resumo: { horasTotal: number; qtd: number; qtdMotivos: number };
  motivos: MotivoParadaLinha[];
  eventos: ParadaColheitaEvento[];
};

const EMPTY_MOTIVOS_PARADA: MotivosParadaTabelas = {
  linhas: [],
  horasTotal: 0,
};

function parseOrdsDateTime(value: unknown): Date | null {
  if (value == null || String(value).trim() === "") return null;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function horasSobrepostasPeriodo(inicio: Date, fim: Date, dataInicio: string, dataFim: string) {
  const pIni = new Date(`${dataInicio}T00:00:00`);
  const pFim = new Date(`${dataFim}T23:59:59.999`);
  const start = Math.max(inicio.getTime(), pIni.getTime());
  const end = Math.min(fim.getTime(), pFim.getTime());
  if (end <= start) return 0;
  return (end - start) / 3600000;
}

async function loadMotivosParadaColheita(dataInicio: string, dataFim: string): Promise<MotivosParadaTabelas> {
  const data = await gerarParadasColheita(dataInicio, dataFim);
  return { linhas: data.motivos, horasTotal: data.resumo.horasTotal };
}

export async function gerarParadasColheita(dataInicio: string, dataFim: string): Promise<ParadasColheitaData> {
  const collected = await scanOrdsCollection(paradaColheitaOrdsUrl(), {
    maxRows: 20_000,
    match: (item) => {
      const inicio = parseOrdsDateTime(item.datahorainicial ?? item.data_hora_inicial);
      const fim = parseOrdsDateTime(item.datahorafinal ?? item.data_hora_final);
      if (!inicio || !fim) return false;
      return horasSobrepostasPeriodo(inicio, fim, dataInicio, dataFim) > 0;
    },
    map: (item) => {
      const inicio = parseOrdsDateTime(item.datahorainicial ?? item.data_hora_inicial);
      const fim = parseOrdsDateTime(item.datahorafinal ?? item.data_hora_final);
      const motivo = String(item.motivoparada ?? item.motivo_parada ?? "").trim();
      if (!inicio || !fim || !motivo) return null;
      const horas = horasSobrepostasPeriodo(inicio, fim, dataInicio, dataFim);
      if (!(horas > 0)) return null;
      const rawId = item.id;
      const id =
        rawId == null || String(rawId).trim() === ""
          ? null
          : typeof rawId === "number" || typeof rawId === "string"
            ? rawId
            : String(rawId);
      return { id, motivo, inicio: inicio.toISOString(), fim: fim.toISOString(), horas };
    },
  });

  const eventos = (collected.dados as ParadaColheitaEvento[]).sort((a, b) => b.inicio.localeCompare(a.inicio));
  const buckets = new Map<string, { label: string; horas: number; qtd: number }>();
  for (const row of eventos) {
    const key = normalizeText(row.motivo).replace(/\s+/g, " ").trim() || "SEM MOTIVO";
    const acc = buckets.get(key) ?? { label: row.motivo, horas: 0, qtd: 0 };
    acc.horas += row.horas;
    acc.qtd += 1;
    if (row.motivo.length > acc.label.length) acc.label = row.motivo;
    buckets.set(key, acc);
  }

  const motivos = [...buckets.values()]
    .map((row) => ({ motivo: row.label, horas: money(row.horas), qtd: row.qtd }))
    .sort((a, b) => b.horas - a.horas || a.motivo.localeCompare(b.motivo, "pt-BR"));

  return {
    filtros: { dataInicio, dataFim },
    resumo: {
      horasTotal: money(motivos.reduce((acc, row) => acc + row.horas, 0)),
      qtd: eventos.length,
      qtdMotivos: motivos.length,
    },
    motivos,
    eventos: eventos.map((row) => ({ ...row, horas: money(row.horas) })),
  };
}

/** Snapshot da frota (Oracle) — não depende do período de datas. */
type EntradaMaquinaImpurezaCtx = {
  maquina: number | null;
  peso: number | null;
  impMineral: number | null;
  dataColheita: string | null;
  codEquipamento: number | null;
};

async function resolveEntradaMaquinaImpureza(
  dataInicio: string,
  dataFim: string,
  preload?: EntradaMaquinaImpurezaCtx[],
): Promise<EntradaMaquinaImpurezaCtx[]> {
  if (preload?.length) return preload;
  const [equipamentoTags, entradaMaquina] = await runLimited(
    [() => loadEquipamentoTags(), () => listarEntradaCanaMaquinaList({ dataInicio, dataFim })],
    2,
  );
  return entradaMaquina.dados.map((row) => {
    const codPorTag = resolveCodPorEquipamentoTag(equipamentoTags, row.maquina, row.dataColheita);
    return {
      maquina: row.maquina,
      peso: row.peso,
      impMineral: row.impMineral,
      dataColheita: row.dataColheita,
      codEquipamento: codPorTag ?? row.codEquipamento,
    };
  });
}

async function enrichQualidadeComEntradaMaquina(
  dataInicio: string,
  dataFim: string,
  qualidadeBase: ColheitaQualidadeData | null,
  entradaPreload?: EntradaMaquinaImpurezaCtx[],
): Promise<ColheitaQualidadeData | null> {
  const entradaMaquinaResolvida = await resolveEntradaMaquinaImpureza(dataInicio, dataFim, entradaPreload);

  const labelPorEquipQualidade = new Map<number, string>(
    (qualidadeBase?.equipamentosOpcoes ?? qualidadeBase?.porEquipamento ?? [])
      .filter((row) => row.codEquipamento != null)
      .map((row) => [row.codEquipamento as number, row.label]),
  );

  return enrichQualidadeImpureza(
    qualidadeBase,
    entradaMaquinaResolvida.map((row) => ({
      codEquipamento: row.codEquipamento,
      maquina: row.maquina,
      impMineral: row.impMineral,
      peso: row.peso,
    })),
    labelPorEquipQualidade,
  );
}

export async function gerarQualidadeColheitaIndicadores(filtros: {
  dataInicio?: string | null;
  dataFim?: string | null;
  codEquipamentos?: number[] | null;
}) {
  const dataInicio = filtros.dataInicio?.trim() || null;
  const dataFim = filtros.dataFim?.trim() || null;
  if (!dataInicio || !dataFim) {
    return loadQualidadeColheita({ dataInicio, dataFim });
  }

  const qualidadeBase = await loadQualidadeColheita({
    dataInicio,
    dataFim,
    codTipoEquipamento: TIPO_COLHEDORA,
    codEquipamentos: filtros.codEquipamentos,
  });
  return enrichQualidadeComEntradaMaquina(dataInicio, dataFim, qualidadeBase);
}

export async function gerarIndicadoresColheitaProducaoFrota(filtros: { refDate?: string | null } = {}) {
  const refDate = filtros.refDate?.trim()
    ? new Date(`${filtros.refDate}T12:00:00`)
    : new Date();

  const [equipColheita, kpiFrota, parados] = await runLimited(
    [
      () => loadEquipamentosTiposColheita(refDate),
      () => loadKpiFrotaDisponibilidade(),
      () => loadParadosAbertos(),
    ],
    2,
  );

  const ctxFrenteList: FrenteCtx[] = [...equipColheita.values()].map((oracle) => ({
    cod: oracle.codEquipamento,
    categoria: classificarEquipamento(oracle.tipoDescricao, oracle.codTipoEquipamento),
    parado: parados.has(oracle.codEquipamento),
    frenteKey: oracle.codFrente != null ? String(oracle.codFrente) : "sem-frente",
    frenteLabel:
      oracle.frenteDescricao?.trim() || (oracle.codFrente != null ? `Frente ${oracle.codFrente}` : "Sem frente"),
  }));

  const kpiCards = buildKpiCards(kpiFrota);
  const frentes = buildFrentes(ctxFrenteList);
  const resumoCategorias = ["colhedora", "transbordo", "trator", "caminhao"] as const;
  const categorias = resumoCategorias.map((cat) => {
    const items = ctxFrenteList.filter((e) => e.categoria === cat);
    const parado = items.filter((e) => e.parado).length;
    const rodando = items.length - parado;
    const total = items.length;
    return {
      categoria: cat,
      label:
        cat === "colhedora"
          ? "COLHEDORA"
          : cat === "transbordo"
            ? "TRANSBORDO"
            : cat === "trator"
              ? "TRATORES"
              : "CAMINHÃO",
      total,
      parado,
      rodando,
      disponibilidade: total ? money((rodando / total) * 100) : null,
    };
  });

  return {
    filtros: { dataInicio: null, dataFim: null, refDate: refDate.toISOString().slice(0, 10), dias: 0, diasColheitaColhedora: 0 },
    resumo: { categorias, kpiCards, truncadoEntrada: false, truncadoHoras: false },
    frentes,
    disponibilidadeDiaria: [],
    tabelas: EMPTY_TABELAS,
    qualidade: null,
    motivosParada: EMPTY_MOTIVOS_PARADA,
  };
}

export async function gerarIndicadoresColheitaProducao(filtros: {
  dataInicio?: string | null;
  dataFim?: string | null;
  refDate?: string | null;
  codTipoEquipamento?: number | null;
  codEquipamentos?: number[] | null;
  modo?: "completo" | "producao-total" | null;
} = {}) {
  const rawInicio = filtros.dataInicio?.trim() || null;
  const rawFim = filtros.dataFim?.trim() || null;
  const periodo =
    rawInicio && rawFim ? normalizePeriodoColheita(rawInicio, rawFim) : { dataInicio: rawInicio, dataFim: rawFim };
  const dataInicio = periodo.dataInicio;
  const dataFim = periodo.dataFim;
  const codTipoEquipamento = filtros.codTipoEquipamento ?? TIPO_COLHEDORA;
  const refDate = filtros.refDate?.trim()
    ? new Date(`${filtros.refDate}T12:00:00`)
    : dataFim
      ? new Date(`${dataFim}T12:00:00`)
      : new Date();
  const dias = dataInicio && dataFim ? diasNoPeriodo(dataInicio, dataFim) : 1;
  const modoLeve = filtros.modo === "producao-total";

  const [entradaMaquina, entradaCaminhao, horas, motivosParada] = await runLimited(
    [
      () =>
        dataInicio && dataFim
          ? listarEntradaCanaMaquinaList({ dataInicio, dataFim })
          : Promise.resolve({ dados: [], resumo: { truncado: false } }),
      () =>
        dataInicio && dataFim
          ? listarEntradaCanaCaminhao({ dataInicio, dataFim })
          : Promise.resolve({ dados: [], resumo: { truncado: false } }),
      () => listarHorasMaquina({ dataInicio, dataFim }),
      () =>
        dataInicio && dataFim
          ? loadMotivosParadaColheita(dataInicio, dataFim).catch((err) => {
              console.error("[colheita-producao] motivos de parada", err);
              return EMPTY_MOTIVOS_PARADA;
            })
          : Promise.resolve(EMPTY_MOTIVOS_PARADA),
    ],
    2,
  );

  const [equipOracle, equipColheita, kpiFrota, parados] = await runLimited(
    [
      () => loadEquipamentosOracle(refDate),
      () => loadEquipamentosTiposColheita(refDate),
      () => loadKpiFrotaDisponibilidade(),
      () => loadParadosAbertos(),
    ],
    2,
  );

  const [abastecimento, equipamentoTags, caminhaoCodPorNumero, disponibilidadeDiaria, qualidadeBase, dispPorEquip] =
    await runLimited(
      [
        () => (dataInicio && dataFim ? loadAbastecimento(dataInicio, dataFim) : Promise.resolve(new Map())),
        () => loadEquipamentoTags(),
        () => loadCaminhaoCodPorNumero(),
        () =>
          dataInicio && dataFim && !modoLeve ? loadDisponibilidadeDiaria(dataInicio, dataFim) : Promise.resolve([]),
        () =>
          dataInicio && dataFim && !modoLeve
            ? loadQualidadeColheita({
                dataInicio,
                dataFim,
                codTipoEquipamento,
              })
            : Promise.resolve(null),
        () =>
          dataInicio && dataFim
            ? gerarDisponibilidadeHorasPorEquipamento(dataInicio, dataFim)
            : Promise.resolve(new Map<number, DispHorasEquip>()),
      ],
      2,
    );

  /** Entrada máquina ORDS com cod_equipamento resolvido por equipamento_tag na data da colheita. */
  const entradaMaquinaResolvida = entradaMaquina.dados.map((row) => {
    const codPorTag = resolveCodPorEquipamentoTag(equipamentoTags, row.maquina, row.dataColheita);
    return {
      maquina: row.maquina,
      peso: row.peso,
      impMineral: row.impMineral,
      dataColheita: row.dataColheita,
      codPorTag,
      codEquipamento: codPorTag ?? row.codEquipamento,
    };
  });

  const qualidade =
    !modoLeve && dataInicio && dataFim
      ? await enrichQualidadeComEntradaMaquina(dataInicio, dataFim, qualidadeBase, entradaMaquinaResolvida)
      : null;

  const tonMaquinaPorEquip = new Map<number, number>();
  const equipMaquinaAssociados = new Set<number>();
  const tagMaquinaCount = new Map<string, number>();

  for (const row of entradaMaquinaResolvida) {
    if (row.codEquipamento == null) continue;
    const cod = row.codEquipamento;
    equipMaquinaAssociados.add(cod);
    tonMaquinaPorEquip.set(cod, money((tonMaquinaPorEquip.get(cod) ?? 0) + (row.peso ?? 0)));
    const tag = row.maquina != null ? `${row.maquina}-${cod}` : String(cod);
    const tagKey = `${cod}::${tag}`;
    tagMaquinaCount.set(tagKey, (tagMaquinaCount.get(tagKey) ?? 0) + 1);
  }

  const tonCaminhaoPorEquip = new Map<number, number>();
  const equipCaminhaoAssociados = new Set<number>();
  const tagCaminhaoCount = new Map<string, number>();
  const viagensPorEquip = new Map<number, number>();

  const entradaCaminhaoResolvida = entradaCaminhao.dados.map((row) => ({
    ...row,
    codEquipamento: resolveCodEquipamentoCaminhao(
      row.caminhao,
      row.data,
      equipamentoTags,
      caminhaoCodPorNumero,
      row.codEquipamento,
    ),
  }));

  for (const row of entradaCaminhaoResolvida) {
    if (row.codEquipamento == null) continue;
    const cod = row.codEquipamento;
    equipCaminhaoAssociados.add(cod);
    tonCaminhaoPorEquip.set(cod, money((tonCaminhaoPorEquip.get(cod) ?? 0) + (row.pesoLiquido ?? 0)));
    viagensPorEquip.set(cod, (viagensPorEquip.get(cod) ?? 0) + 1);
    const tag = row.caminhao != null ? `${row.caminhao}-${cod}` : String(cod);
    const tagKey = `${cod}::${tag}`;
    tagCaminhaoCount.set(tagKey, (tagCaminhaoCount.get(tagKey) ?? 0) + 1);
  }

  const tagMaquinaPorEquip = pickTagFromCount(tagMaquinaCount);
  const tagCaminhaoPorEquip = pickTagFromCount(tagCaminhaoCount);

  const horasPorEquip = calcularHorasRodadasPorEquipamento(horas.dados);

  const equipAtivos = new Set<number>([
    ...equipMaquinaAssociados,
    ...equipCaminhaoAssociados,
    ...horasPorEquip.keys(),
    ...abastecimento.keys(),
  ]);

  type EquipCtx = {
    cod: number;
    /** cod_equipamento ERP principal para metadados (frente, tipo). */
    codMetricas: number | null;
    /** Todos os cod_equipamento do período (tag reatribuída via equipamento_tag). */
    codMetricasList?: number[];
    categoria: CategoriaEquip;
    parado: boolean;
    frenteKey: string;
    frenteLabel: string;
    tag: string;
    ton: number;
  };

  const buildCtxFromAssociados = (
    associados: Set<number>,
    tonMap: Map<number, number>,
    tagMap: Map<number, string>,
    tipoFilter: (codTipo: number | null) => boolean,
  ): EquipCtx[] => {
    const out: EquipCtx[] = [];
    for (const cod of associados) {
      const oracle = equipOracle.get(cod);
      const codTipo = oracle?.codTipoEquipamento ?? null;
      if (!tipoFilter(codTipo)) continue;
      out.push({
        cod,
        codMetricas: cod,
        categoria: classificarEquipamento(oracle?.tipoDescricao ?? null, codTipo),
        parado: parados.has(cod),
        frenteKey: oracle?.codFrente != null ? String(oracle.codFrente) : "sem-frente",
        frenteLabel:
          oracle?.frenteDescricao?.trim() || (oracle?.codFrente != null ? `Frente ${oracle.codFrente}` : "Sem frente"),
        tag: String(cod),
        ton: tonMap.get(cod) ?? 0,
      });
    }
    return out.sort((a, b) => a.tag.localeCompare(b.tag, "pt-BR", { numeric: true }));
  };

  /** Tratores: só equipamentos com TAG vigente em equipamento_tag. */
  const buildCtxTratorFromEntradaMaquina = (): EquipCtx[] => {
    type MaquinaAgg = { ton: number; cods: Set<number> };
    const porMaquina = new Map<number, MaquinaAgg>();

    for (const row of entradaMaquinaResolvida) {
      if (row.maquina == null || row.codPorTag == null) continue;
      const ton = row.peso ?? 0;
      const prev = porMaquina.get(row.maquina) ?? { ton: 0, cods: new Set<number>() };
      prev.ton = money(prev.ton + ton);
      prev.cods.add(row.codPorTag);
      porMaquina.set(row.maquina, prev);
    }

    const isTratorGrupo = (cods: Set<number>) => {
      if (!cods.size) return false;
      for (const cod of cods) {
        const oracle = equipOracle.get(cod);
        const codTipo = oracle?.codTipoEquipamento ?? null;
        if (isColhedoraTipo(codTipo)) continue;
        if (classificarEquipamento(oracle?.tipoDescricao ?? null, codTipo) === "caminhao") continue;
        return true;
      }
      return false;
    };

    const primaryCodTrator = (cods: Set<number>): number | null => {
      for (const cod of cods) {
        const oracle = equipOracle.get(cod);
        const codTipo = oracle?.codTipoEquipamento ?? null;
        if (isColhedoraTipo(codTipo)) continue;
        if (classificarEquipamento(oracle?.tipoDescricao ?? null, codTipo) === "caminhao") continue;
        return cod;
      }
      return null;
    };

    const out: EquipCtx[] = [];

    const pushTratorAgg = (associado: number, ton: number, cods: Set<number>) => {
      if (!isTratorGrupo(cods)) return;
      const codList = [...cods];
      const primaryCod = primaryCodTrator(cods);
      const oracle = primaryCod != null ? equipOracle.get(primaryCod) : null;
      const codTipo = oracle?.codTipoEquipamento ?? null;
      const codEquipamento = primaryCod ?? associado;
      out.push({
        cod: codEquipamento,
        codMetricas: primaryCod,
        codMetricasList: codList.length ? codList : undefined,
        categoria: primaryCod != null ? classificarEquipamento(oracle?.tipoDescricao ?? null, codTipo) : "trator",
        parado: codList.some((c) => parados.has(c)),
        frenteKey: oracle?.codFrente != null ? String(oracle.codFrente) : "sem-frente",
        frenteLabel:
          oracle?.frenteDescricao?.trim() || (oracle?.codFrente != null ? `Frente ${oracle.codFrente}` : "Sem frente"),
        tag: String(codEquipamento),
        ton,
      });
    };

    for (const [maquina, agg] of porMaquina) {
      pushTratorAgg(maquina, agg.ton, agg.cods);
    }

    return out.sort((a, b) => a.tag.localeCompare(b.tag, "pt-BR", { numeric: true }));
  };

  const ctxColhedoraList = buildCtxFromAssociados(
    equipMaquinaAssociados,
    tonMaquinaPorEquip,
    tagMaquinaPorEquip,
    isColhedoraTipo,
  );

  const toneladasColheitaDiaria = new Map<string, number>();
  let primeiroDiaColheitaColhedora: string | null = null;
  for (const row of entradaMaquinaResolvida) {
    const dia = diaUtcFromIso(row.dataColheita);
    if (!dia) continue;
    const peso = row.peso ?? 0;
    toneladasColheitaDiaria.set(dia, (toneladasColheitaDiaria.get(dia) ?? 0) + peso);
    const codTipo = row.codEquipamento != null ? equipOracle.get(row.codEquipamento)?.codTipoEquipamento ?? null : null;
    if (peso > 0 && isColhedoraTipo(codTipo) && (!primeiroDiaColheitaColhedora || dia < primeiroDiaColheitaColhedora)) {
      primeiroDiaColheitaColhedora = dia;
    }
  }
  const diasColheitaColhedora =
    primeiroDiaColheitaColhedora && dataFim ? diasNoPeriodo(primeiroDiaColheitaColhedora, dataFim) : dias;
  const ctxTratorList = buildCtxTratorFromEntradaMaquina();
  const ctxCaminhaoList = buildCtxFromAssociados(
    equipCaminhaoAssociados,
    tonCaminhaoPorEquip,
    tagCaminhaoPorEquip,
    () => true,
  );

  const ctxList: EquipCtx[] = [];
  for (const cod of equipAtivos) {
    const oracle = equipOracle.get(cod);
    const categoria = classificarEquipamento(oracle?.tipoDescricao ?? null, oracle?.codTipoEquipamento ?? null);
    const ton = (tonMaquinaPorEquip.get(cod) ?? 0) + (tonCaminhaoPorEquip.get(cod) ?? 0);
    if (ton <= 0 && !horasPorEquip.has(cod) && !abastecimento.has(cod)) continue;
    ctxList.push({
      cod,
      codMetricas: cod,
      categoria,
      parado: parados.has(cod),
      frenteKey: oracle?.codFrente != null ? String(oracle.codFrente) : "sem-frente",
      frenteLabel: oracle?.frenteDescricao?.trim() || (oracle?.codFrente != null ? `Frente ${oracle.codFrente}` : "Sem frente"),
      tag: String(cod),
      ton,
    });
  }

  const ctxFrenteList: EquipCtx[] = [...equipColheita.values()].map((oracle) => ({
    cod: oracle.codEquipamento,
    codMetricas: oracle.codEquipamento,
    categoria: classificarEquipamento(oracle.tipoDescricao, oracle.codTipoEquipamento),
    parado: parados.has(oracle.codEquipamento),
    frenteKey: oracle.codFrente != null ? String(oracle.codFrente) : "sem-frente",
    frenteLabel: oracle.frenteDescricao?.trim() || (oracle.codFrente != null ? `Frente ${oracle.codFrente}` : "Sem frente"),
    tag: tagMaquinaPorEquip.get(oracle.codEquipamento) ?? String(oracle.codEquipamento),
    ton: tonMaquinaPorEquip.get(oracle.codEquipamento) ?? 0,
  }));

  const mergeAbastecimento = (cods: number[]) => {
    let litros = 0;
    let kmhs = 0;
    let valor = 0;
    let litrosPosto = 0;
    let kmhsPosto = 0;
    for (const cod of cods) {
      const abast = abastecimento.get(cod);
      if (!abast) continue;
      litros += abast.litros;
      kmhs += abast.kmhs;
      valor += abast.valor ?? 0;
      litrosPosto += abast.litrosPosto ?? 0;
      kmhsPosto += abast.kmhsPosto ?? 0;
    }
    if (!litros && !kmhs && !valor && !litrosPosto && !kmhsPosto) return undefined;
    return { litros, kmhs, valor, litrosPosto, kmhsPosto };
  };

  const mergeHoras = (cods: number[]) => {
    let motor = 0;
    let elevador = 0;
    for (const cod of cods) {
      const horasEquip = horasPorEquip.get(cod);
      if (!horasEquip) continue;
      motor += horasEquip.motor;
      elevador += horasEquip.elevador;
    }
    if (!motor && !elevador) return undefined;
    return { motor, elevador };
  };

  const metricasCods = (e: EquipCtx) =>
    e.codMetricasList?.length ? e.codMetricasList : e.codMetricas != null ? [e.codMetricas] : [e.cod];

  const montarTabelaFromCtx = (
    items: EquipCtx[],
    tableKind: "colhedora" | "trator" | "caminhao",
  ) => {
    const linhas = items.map((e) => {
      const cods = metricasCods(e);
      const codLookup = e.codMetricas ?? e.cod;
      return buildLinha(
        e.cod,
        e.tag,
        e.parado,
        e.ton,
        tableKind === "trator" && cods.length > 1 ? mergeAbastecimento(cods) : abastecimento.get(codLookup),
        tableKind === "trator" && cods.length > 1 ? mergeHoras(cods) : horasPorEquip.get(codLookup),
        viagensPorEquip.get(codLookup) ?? null,
        dias,
        tableKind,
        mergeDispHorasEquipamentos(dispPorEquip, cods),
      );
    });
    return { linhas, totais: linhas.length ? sumLinhas(linhas, tableKind, dias) : null };
  };

  const resumoCategorias = ["colhedora", "transbordo", "trator", "caminhao"] as const;
  const resumo = resumoCategorias.map((cat) => {
    const items =
      cat === "colhedora"
        ? ctxColhedoraList
        : cat === "trator"
          ? ctxTratorList
          : cat === "caminhao"
            ? ctxCaminhaoList
            : ctxFrenteList.filter((e) => e.categoria === cat);
    const parado = items.filter((e) => e.parado).length;
    const rodando = items.length - parado;
    const total = items.length;
    const disponibilidade = total ? money((rodando / total) * 100) : null;
    return {
      categoria: cat,
      label:
        cat === "colhedora"
          ? "COLHEDORA"
          : cat === "transbordo"
            ? "TRANSBORDO"
            : cat === "trator"
              ? "TRATORES"
              : "CAMINHÃO",
      total,
      parado,
      rodando,
      disponibilidade,
    };
  });

  const kpiCards = buildKpiCards(kpiFrota);
  const frentes = buildFrentes(
    ctxFrenteList.map((e) => ({
      cod: e.cod,
      categoria: e.categoria,
      parado: e.parado,
      frenteKey: e.frenteKey,
      frenteLabel: e.frenteLabel,
    })),
  );

  const disponibilidadeComTon = disponibilidadeDiaria.map((row) => ({
    ...row,
    toneladaColhida: money(toneladasColheitaDiaria.get(row.data) ?? 0),
  }));

  return {
    filtros: { dataInicio, dataFim, refDate: refDate.toISOString().slice(0, 10), dias, diasColheitaColhedora },
    resumo: {
      categorias: resumo,
      kpiCards,
      truncadoEntrada: Boolean(entradaMaquina.resumo.truncado || entradaCaminhao.resumo.truncado),
      truncadoHoras: horas.resumo.truncado,
    },
    frentes,
    disponibilidadeDiaria: disponibilidadeComTon,
    tabelas: {
      colhedora: montarTabelaFromCtx(ctxColhedoraList, "colhedora"),
      trator: montarTabelaFromCtx(ctxTratorList, "trator"),
      caminhao: montarTabelaFromCtx(ctxCaminhaoList, "caminhao"),
    },
    qualidade,
    motivosParada,
  };
}

const TIPO_COLHEITA_KEYS = ["MECANIZADA_PROPRIA", "MECANIZADA_FORNECEDOR", "MANUAL_PROPRIA", "MANUAL_FORNECEDOR"] as const;

export type RelatorioDiarioTipoKey = (typeof TIPO_COLHEITA_KEYS)[number];

const TIPO_COLHEITA_LABELS: Record<RelatorioDiarioTipoKey, string> = {
  MECANIZADA_PROPRIA: "MECANIZADA PRÓPRIA",
  MECANIZADA_FORNECEDOR: "MECANIZADA FORNECEDOR",
  MANUAL_PROPRIA: "MANUAL PRÓPRIA",
  MANUAL_FORNECEDOR: "MANUAL FORNECEDOR",
};

function normalizeTipoColheitaRelatorio(value: string | null | undefined) {
  const raw = normalizeText(value);
  if (raw.includes("MANUAL") || raw.includes("INTEIRA")) return "MANUAL" as const;
  return "MECANIZADA" as const;
}

function grupoFromFazenda(fazenda: string | null | undefined) {
  const raw = String(fazenda ?? "").trim();
  if (!raw) return { key: "SEM GRUPO", label: "SEM GRUPO" };
  const dotted = raw.match(/^(\d{2})[.\-\/](\d{2})[.\-\/](\d{2,})/);
  if (dotted) {
    const label = `${dotted[1]}-${dotted[2]}-${dotted[3]}`;
    return { key: label, label };
  }
  const code = raw.match(/^(\d+)/);
  const nome = raw.replace(/^\d+\s*[-–]\s*/, "").trim();
  const key = code?.[1] ?? raw;
  return { key, label: nome && nome !== raw ? `${key} ${nome}` : key };
}

type QualidadeAcc = { peso: number; mineralW: number; mineralPeso: number; vegetalW: number; vegetalPeso: number; umidadeW: number; umidadePeso: number; atrW: number; atrPeso: number };

function emptyQualidade(): QualidadeAcc {
  return { peso: 0, mineralW: 0, mineralPeso: 0, vegetalW: 0, vegetalPeso: 0, umidadeW: 0, umidadePeso: 0, atrW: 0, atrPeso: 0 };
}

function addQualidade(acc: QualidadeAcc, peso: number, mineral: number | null, atr: number | null) {
  if (!(peso > 0)) return;
  acc.peso += peso;
  if (mineral != null && Number.isFinite(mineral)) {
    acc.mineralW += mineral * peso;
    acc.mineralPeso += peso;
  }
  if (atr != null && Number.isFinite(atr)) {
    acc.atrW += atr * peso;
    acc.atrPeso += peso;
  }
}

function avgQualidade(acc: QualidadeAcc) {
  return {
    impMineral: acc.mineralPeso > 0 ? money(acc.mineralW / acc.mineralPeso) : null,
    impVegetal: acc.vegetalPeso > 0 ? money(acc.vegetalW / acc.vegetalPeso) : null,
    umidade: acc.umidadePeso > 0 ? money(acc.umidadeW / acc.umidadePeso) : null,
    atr: acc.atrPeso > 0 ? money(acc.atrW / acc.atrPeso) : null,
  };
}

function tipoKey(mecanizada: boolean, propria: boolean): RelatorioDiarioTipoKey {
  if (mecanizada && propria) return "MECANIZADA_PROPRIA";
  if (mecanizada && !propria) return "MECANIZADA_FORNECEDOR";
  if (!mecanizada && propria) return "MANUAL_PROPRIA";
  return "MANUAL_FORNECEDOR";
}

function pickFrotaKpi(
  cards: Array<{ id: string; total: number; rodando: number; disponibilidade: number | null }>,
) {
  const cav = cards.find((card) => card.id === "cav_mecanico");
  const colhedora = cards.find((card) => card.id === "colhedora");
  const chosen = (cav && cav.total > 0 ? cav : null) || colhedora || cards[0] || null;
  return {
    necessidadeFrota: chosen?.total ?? 0,
    frotaDisponivel: chosen?.rodando ?? 0,
    pctDisponibilidadeFrota: chosen?.disponibilidade ?? null,
  };
}

export type IndicadorPrincipalLinha = {
  frente: string;
  data: string | null;
  cotaUsina: number | null;
  realizado: number | null;
  colhedoras: number;
  horasMaquina: number | null;
  produtividadeHistorica: number | null;
  capacidadeNecessaria: number | null;
  capacidadeEstimada: number | null;
  diferenca: number | null;
  percentualCota: number | null;
  capacidadeSuficiente: boolean | null;
  status: string;
  estimativaInconsistente: boolean;
  naoAtingimento: {
    gap: number;
    atingiu: boolean;
    realizado: number;
    cota: number;
    causas: Array<{ chave: "capacidade" | "execucao"; label: string; toneladas: number; pct: number }>;
  };
};

function montarIndicadorPrincipalLinha(input: {
  frente: string;
  data: string | null;
  cota: number;
  realizado: number;
  colhedoras: number;
  horas: number;
  produtividade: number | null;
  hoje: string;
}): IndicadorPrincipalLinha {
  const alvo = input.cota > 0 ? money(input.cota) : null;
  const realizado = money(input.realizado);
  const horasDisp = input.horas > 0 ? money(input.horas) : null;
  const prod =
    input.produtividade != null && Number.isFinite(input.produtividade) && input.produtividade > 0
      ? money(input.produtividade)
      : null;
  const capacidadeNecessaria = alvo != null && horasDisp ? money(alvo / horasDisp) : null;
  const capacidadeEstimada = prod != null && horasDisp ? money(prod * horasDisp) : null;
  const diferenca =
    capacidadeEstimada != null && alvo != null ? money(capacidadeEstimada - alvo) : null;
  const percentualCota =
    capacidadeEstimada != null && alvo != null ? money((capacidadeEstimada / alvo) * 100) : null;
  const capacidadeSuficiente =
    capacidadeEstimada != null && alvo != null ? capacidadeEstimada >= alvo : null;
  const estimativaInconsistente = Boolean(
    input.data &&
      input.data < input.hoje &&
      capacidadeEstimada != null &&
      realizado > capacidadeEstimada,
  );
  let status = "Não informado";
  if (capacidadeSuficiente === true) status = "Capacidade suficiente";
  else if (capacidadeSuficiente === false) status = "Capacidade insuficiente";
  return {
    frente: input.frente,
    data: input.data,
    cotaUsina: alvo,
    realizado,
    colhedoras: input.colhedoras,
    horasMaquina: horasDisp,
    produtividadeHistorica: prod,
    capacidadeNecessaria,
    capacidadeEstimada,
    diferenca,
    percentualCota,
    capacidadeSuficiente,
    status,
    estimativaInconsistente,
    naoAtingimento: decomporNaoAtingimentoMeta({
      cota: alvo,
      realizado,
      capacidadeEstimada,
    }),
  };
}

export async function gerarRelatorioDiarioProducao(filtros: {
  data?: string | null;
  dataInicio?: string | null;
  safraInicio?: string | null;
}) {
  const data = filtros.data?.trim() || null;
  if (!data) {
    const err = new Error("Informe a data do relatório.");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
  const safraInicioSolicitado = filtros.safraInicio?.trim() && filtros.safraInicio.trim() <= data ? filtros.safraInicio.trim() : data;
  const periodoInicioSolicitado =
    filtros.dataInicio?.trim() && filtros.dataInicio.trim() <= data ? filtros.dataInicio.trim() : data;
  const diaria = await gerarToneladasColheitaDiariaApi(safraInicioSolicitado, data);
  const diariaRows = diaria as Array<{
    data: string;
    toneladas: number;
    previsao: number | null;
    atr: number | null;
    cotaDiaria?: number;
  }>;
  const dataReferencia =
    diariaRows.some((row) => row.data === data && row.toneladas > 0)
      ? data
      : [...diariaRows]
          .filter((row) => row.data >= periodoInicioSolicitado && row.data <= data && row.toneladas > 0)
          .sort((a, b) => b.data.localeCompare(a.data))[0]?.data ?? data;
  const safraInicio =
    filtros.safraInicio?.trim() && filtros.safraInicio.trim() <= dataReferencia ? filtros.safraInicio.trim() : dataReferencia;
  const periodoInicio =
    periodoInicioSolicitado <= dataReferencia ? periodoInicioSolicitado : dataReferencia;
  const diariaPeriodo = dataReferencia === data ? diariaRows : await gerarToneladasColheitaDiariaApi(safraInicio, dataReferencia);

  const lookbackStart = addIsoDays(periodoInicio, -21);
  const horasInicio =
    safraInicio && safraInicio > lookbackStart ? safraInicio : lookbackStart;
  const horasFetchInicio = addIsoDays(horasInicio, -1);

  const [entradaMaquina, entradaCaminhao, fazendas, horasMaquina] = await runLimited(
    [
      () => listarEntradaCanaMaquinaList({ dataInicio: safraInicio, dataFim: dataReferencia }),
      () => listarEntradaCanaCaminhao({ dataInicio: periodoInicio, dataFim: dataReferencia }),
      () => listarFazendaUsina(),
      () =>
        listarHorasMaquina({
          dataInicio: horasFetchInicio,
          dataFim: dataReferencia,
          codTipoEquipamento: TIPO_COLHEDORA,
        }),
    ],
    2,
  );
  const [frota, equipOracle, equipamentoTags, dispPorEquip] = await runLimited(
    [
      () => gerarIndicadoresColheitaProducaoFrota({ refDate: dataReferencia }),
      () => loadEquipamentosOracle(new Date(`${dataReferencia}T12:00:00`)),
      () => loadEquipamentoTags(),
      () => gerarDisponibilidadeHorasPorEquipamento(periodoInicio, dataReferencia),
    ],
    2,
  );

  let moagemDia = 0;
  let cotaUsina = 0;
  let moagemAcumulada = 0;
  let diasSafra = 0;
  let atrDiaW = 0;
  let atrDiaPeso = 0;
  const diasComMoagem = new Set<string>();
  const diasColheitaPeriodo = new Set<string>();
  for (const row of diariaPeriodo as Array<{
    data: string;
    toneladas: number;
    previsao: number | null;
    atr: number | null;
    cotaDiaria?: number;
  }>) {
    if (row.toneladas > 0) {
      diasComMoagem.add(row.data);
      moagemAcumulada += row.toneladas;
    }
    if (row.data < periodoInicio || row.data > dataReferencia) continue;
    moagemDia += row.toneladas;
    if (row.toneladas > 0) diasColheitaPeriodo.add(row.data);
    cotaUsina += row.cotaDiaria ?? 0;
    if (row.atr != null && row.toneladas > 0) {
      atrDiaW += row.atr * row.toneladas;
      atrDiaPeso += row.toneladas;
    }
  }
  diasSafra = diasComMoagem.size;
  moagemDia = money(moagemDia);
  moagemAcumulada = money(moagemAcumulada);
  cotaUsina = money(cotaUsina);

  const colhedorasHistorico = new Set<number>();
  for (const row of horasMaquina.dados) {
    if (row.codEquipamento != null && row.codTipoEquipamento === TIPO_COLHEDORA) {
      colhedorasHistorico.add(row.codEquipamento);
    }
  }
  for (const [cod, meta] of equipOracle) {
    if (isColhedoraTipo(meta.codTipoEquipamento)) colhedorasHistorico.add(cod);
  }
  const horasPorDia = horasTrabalhadasColhedoraPorDia(horasMaquina.dados, colhedorasHistorico);

  const colhedorasPeriodo = new Set<number>();
  for (const row of horasMaquina.dados) {
    const dia = diaUtcFromIso(row.data);
    if (!dia || dia < periodoInicio || dia > dataReferencia) continue;
    if (row.codEquipamento != null && row.codTipoEquipamento === TIPO_COLHEDORA) {
      colhedorasPeriodo.add(row.codEquipamento);
    }
  }
  for (const row of entradaMaquina.dados) {
    const dia = diaUtcFromIso(row.dataColheita);
    if (!dia || dia < periodoInicio || dia > dataReferencia) continue;
    const codPorTag = resolveCodPorEquipamentoTag(equipamentoTags, row.maquina, row.dataColheita);
    const codEquipamento = codPorTag ?? row.codEquipamento;
    if (codEquipamento != null && isColhedoraTipo(equipOracle.get(codEquipamento)?.codTipoEquipamento ?? null)) {
      colhedorasPeriodo.add(codEquipamento);
    }
  }
  const dispIds = colhedorasPeriodo.size ? [...colhedorasPeriodo] : [...colhedorasHistorico];
  const dispColhedoras = mergeDispHorasEquipamentos(dispPorEquip, dispIds);
  const horasMaquinaDisponiveis = Math.max(0, dispColhedoras.horasPotenciais - dispColhedoras.horasOficina);
  const capacidade = calcularCapacidadeColhedoras({
    toneladasPorDia: (diariaPeriodo as Array<{ data: string; toneladas: number }>).map((row) => ({
      dia: row.data,
      toneladas: row.toneladas,
    })),
    horasTrabalhadasPorDia: [...horasPorDia.entries()].map(([dia, horas]) => ({ dia, horas })),
    periodoInicio,
    periodoFim: dataReferencia,
    horasMaquinaDisponiveis,
    realizado: moagemDia,
    hoje: isoTodayLocal(),
  });
  const previsao24h = capacidade.capacidadeEstimada ?? 0;

  let canaPropria = 0;
  const tipos = new Map<RelatorioDiarioTipoKey, QualidadeAcc>();
  for (const key of TIPO_COLHEITA_KEYS) tipos.set(key, emptyQualidade());
  const gruposDia = new Map<string, { label: string; toneladas: number }>();
  const grupoDias = new Map<string, Set<string>>();
  const grupoAcumulado = new Map<string, number>();
  let raioW = 0;
  let raioPeso = 0;

  const raioByLabel = new Map<string, number>();
  const raioByNome = new Map<string, number>();
  for (const row of fazendas.dados) {
    const label = String(row.descricaoUsina ?? "").trim();
    if (!label || row.raio == null) continue;
    raioByLabel.set(normalizeText(label), row.raio);
    const nome = normalizeText(label.replace(/^\d+[.\-\s]+/, ""));
    if (nome) raioByNome.set(nome, row.raio);
  }
  const resolveRaioFazenda = (fazenda: string | null) => {
    const label = String(fazenda ?? "").trim();
    if (!label) return null;
    const exact = raioByLabel.get(normalizeText(label));
    if (exact != null) return exact;
    const nome = normalizeText(label.replace(/^\d+[.\-\s]+/, ""));
    if (nome && raioByNome.has(nome)) return raioByNome.get(nome) ?? null;
    for (const [key, raio] of raioByNome) {
      if (nome.includes(key) || key.includes(nome)) return raio;
    }
    return null;
  };

  for (const row of entradaMaquina.dados) {
    const dia = diaUtcFromIso(row.dataColheita);
    if (!dia) continue;
    const peso = row.peso ?? 0;
    if (!(peso > 0)) continue;
    const codPorTag = resolveCodPorEquipamentoTag(equipamentoTags, row.maquina, row.dataColheita);
    const codEquipamento = codPorTag ?? row.codEquipamento;
    const isColhedora = codEquipamento != null && equipOracle.get(codEquipamento)?.codTipoEquipamento === TIPO_COLHEDORA;
    if (!isColhedora) continue;
    const grupo = grupoFromFazenda(row.fazenda);
    grupoAcumulado.set(grupo.key, (grupoAcumulado.get(grupo.key) ?? 0) + peso);
    const dias = grupoDias.get(grupo.key) ?? new Set<string>();
    dias.add(dia);
    grupoDias.set(grupo.key, dias);
    if (dia < periodoInicio || dia > dataReferencia) continue;
    canaPropria += peso;
    const mecanizada = normalizeTipoColheitaRelatorio(row.tipoColheita) === "MECANIZADA";
    const acc = tipos.get(tipoKey(mecanizada, true))!;
    addQualidade(acc, peso, row.impMineral, null);
    const g = gruposDia.get(grupo.key) ?? { label: grupo.label, toneladas: 0 };
    g.toneladas += peso;
    gruposDia.set(grupo.key, g);
    const raio = resolveRaioFazenda(row.fazenda);
    if (raio != null) {
      raioW += raio * peso;
      raioPeso += peso;
    }
  }
  const caminhaoTipo = { MECANIZADA: 0, MANUAL: 0 };
  for (const row of entradaCaminhao.dados) {
    const peso = row.pesoLiquido ?? 0;
    if (!(peso > 0)) continue;
    const mecanizada = normalizeTipoColheitaRelatorio(row.tipoColheita) === "MECANIZADA";
    caminhaoTipo[mecanizada ? "MECANIZADA" : "MANUAL"] += peso;
    const acc = tipos.get(tipoKey(mecanizada, false))!;
    addQualidade(acc, peso, null, row.atr);
    const grupo = grupoFromFazenda(row.fazenda);
    const g = gruposDia.get(grupo.key) ?? { label: grupo.label, toneladas: 0 };
    g.toneladas += peso;
    gruposDia.set(grupo.key, g);
  }

  canaPropria = money(canaPropria);
  const canaFornecedor = money(cotaUsina);
  const canaFornecedorResidual = money(Math.max(0, moagemDia - canaPropria));

  const propriaMec = tipos.get("MECANIZADA_PROPRIA")!.peso;
  const propriaMan = tipos.get("MANUAL_PROPRIA")!.peso;
  let fornMec = Math.max(0, caminhaoTipo.MECANIZADA - propriaMec);
  let fornMan = Math.max(0, caminhaoTipo.MANUAL - propriaMan);
  const fornecedorAlocado = fornMec + fornMan;
  if (canaFornecedorResidual > 0 && fornecedorAlocado < canaFornecedorResidual - 0.01) {
    const residual = canaFornecedorResidual - fornecedorAlocado;
    if (fornMec + fornMan > 0) {
      const shareMec = fornMec / (fornMec + fornMan);
      fornMec += residual * shareMec;
      fornMan += residual * (1 - shareMec);
    } else if (propriaMan > propriaMec) {
      fornMan += residual;
    } else {
      fornMec += residual;
    }
  }
  tipos.get("MECANIZADA_FORNECEDOR")!.peso = money(fornMec);
  tipos.get("MANUAL_FORNECEDOR")!.peso = money(fornMan);

  const tiposPeso = TIPO_COLHEITA_KEYS.reduce((acc, key) => acc + tipos.get(key)!.peso, 0);
  const residualGrupo = money(Math.max(0, moagemDia - [...gruposDia.values()].reduce((acc, row) => acc + row.toneladas, 0)));
  if (residualGrupo > 0.01) {
    const current = gruposDia.get("FORNECEDOR") ?? { label: "FORNECEDOR", toneladas: 0 };
    current.toneladas += residualGrupo;
    gruposDia.set("FORNECEDOR", current);
  }

  const totalTipos = tiposPeso > 0 ? tiposPeso : moagemDia;
  const tiposColheita = TIPO_COLHEITA_KEYS.map((key) => {
    const acc = tipos.get(key)!;
    const qualidade = avgQualidade(acc);
    const toneladas = money(acc.peso);
    return {
      key,
      label: TIPO_COLHEITA_LABELS[key],
      toneladas,
      percentual: totalTipos > 0 ? money((toneladas / totalTipos) * 100) : 0,
      ...qualidade,
    };
  });
  const totalQualidade = emptyQualidade();
  for (const key of TIPO_COLHEITA_KEYS) {
    const acc = tipos.get(key)!;
    totalQualidade.peso += acc.peso;
    totalQualidade.mineralW += acc.mineralW;
    totalQualidade.mineralPeso += acc.mineralPeso;
    totalQualidade.atrW += acc.atrW;
    totalQualidade.atrPeso += acc.atrPeso;
  }
  if (atrDiaPeso > 0 && totalQualidade.atrPeso <= 0) {
    totalQualidade.atrW = atrDiaW;
    totalQualidade.atrPeso = atrDiaPeso;
  }
  const totalRow = {
    key: "TOTAL" as const,
    label: "TOTAL",
    toneladas: money(totalTipos || moagemDia),
    percentual: 100,
    ...avgQualidade(totalQualidade),
  };

  const gruposTon = [...gruposDia.entries()]
    .map(([key, row]) => ({ key, label: row.label, toneladas: money(row.toneladas) }))
    .filter((row) => row.toneladas > 0)
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { numeric: true }));
  const gruposTotal = gruposTon.reduce((acc, row) => acc + row.toneladas, 0);
  const grupos = gruposTon.map((row) => ({
    ...row,
    previsao24h: gruposTotal > 0 ? money((row.toneladas / gruposTotal) * previsao24h) : 0,
  }));

  const featured =
    [...gruposTon].sort((a, b) => b.toneladas - a.toneladas)[0] ??
    null;
  const featuredKey = featured?.key ?? null;
  const diasGrupo = featuredKey ? grupoDias.get(featuredKey)?.size ?? 0 : 0;
  const acumuladoGrupo = featuredKey ? money(grupoAcumulado.get(featuredKey) ?? featured?.toneladas ?? 0) : 0;
  const mediaDiaGrupo =
    diasColheitaPeriodo.size > 0 ? money(moagemDia / diasColheitaPeriodo.size) : 0;

  const frotaKpi = pickFrotaKpi(frota.resumo.kpiCards);
  const pctCapacidadeCota =
    cotaUsina > 0 && capacidade.capacidadeEstimada != null
      ? money((capacidade.capacidadeEstimada / cotaUsina) * 100)
      : null;
  const margemDeficit =
    capacidade.capacidadeEstimada != null ? money(capacidade.capacidadeEstimada - cotaUsina) : null;
  const pctMoagemReal = cotaUsina > 0 ? money((moagemDia / cotaUsina) * 100) : null;
  const pctPropria = moagemDia > 0 ? money((canaPropria / moagemDia) * 100) : null;
  const pctFornecedor = moagemDia > 0 ? money((canaFornecedor / moagemDia) * 100) : null;

  const hoje = isoTodayLocal();
  const diariaPorDia = new Map(
    (diariaPeriodo as Array<{ data: string; toneladas: number; cotaDiaria?: number }>).map((row) => [row.data, row]),
  );
  const diasIndicador: string[] = [];
  for (let dia = periodoInicio; dia <= dataReferencia; dia = addIsoDays(dia, 1)) {
    diasIndicador.push(dia);
  }
  const colhedorasIndicador = frotaKpi.frotaDisponivel > 0 ? frotaKpi.frotaDisponivel : colhedorasPeriodo.size;
  const horasDiaIndicador =
    diasIndicador.length > 0 ? money(horasMaquinaDisponiveis / Math.max(1, diasIndicador.length)) : 0;
  const indicadorPrincipal = diasIndicador.map((dia, index) => {
    const row = diariaPorDia.get(dia);
    return montarIndicadorPrincipalLinha({
      frente: `Frente ${String(index + 1).padStart(2, "0")}`,
      data: dia,
      cota: row?.cotaDiaria ?? 0,
      realizado: row?.toneladas ?? 0,
      colhedoras: colhedorasIndicador,
      horas: horasDiaIndicador,
      produtividade: capacidade.produtividadeHistoricaTh,
      hoje,
    });
  });
  if (diasIndicador.length > 1) {
    indicadorPrincipal.push(
      montarIndicadorPrincipalLinha({
        frente: "TOTAL",
        data: null,
        cota: cotaUsina,
        realizado: moagemDia,
        colhedoras: colhedorasIndicador,
        horas: horasMaquinaDisponiveis,
        produtividade: capacidade.produtividadeHistoricaTh,
        hoje,
      }),
    );
  }

  return {
    filtros: { data: dataReferencia, dataInicio: periodoInicio, dataSolicitada: data, safraInicio },
    kpis: {
      moagemReal: moagemDia,
      pctMoagemReal,
      canaPropria,
      pctPropria,
      canaFornecedor,
      pctFornecedor,
      previsao24h,
      produtividadeHistoricaTh: capacidade.produtividadeHistoricaTh,
      horasMaquinaDisponiveis: capacidade.horasMaquinaDisponiveis,
      capacidadeEstimada: capacidade.capacidadeEstimada,
      pctCapacidadeCota,
      margemDeficit,
      capacidadeInconsistente: capacidade.capacidadeInconsistente,
      diasHistoricosUsados: capacidade.diasHistoricosUsados,
      raioMedio: raioPeso > 0 ? money(raioW / raioPeso) : null,
      ...frotaKpi,
    },
    tiposColheita,
    indicadorPrincipal,
    total: totalRow,
    grupos,
    gruposTotal: {
      toneladas: money(gruposTotal || moagemDia),
      previsao24h,
    },
    rodape: {
      diasSafra,
      moagemAcumulada,
      grupoDestaque: featured?.label ?? null,
      diasColheitaGrupo: diasGrupo,
      mediaDiaGrupo,
      acumuladoGrupo,
    },
  };
}
