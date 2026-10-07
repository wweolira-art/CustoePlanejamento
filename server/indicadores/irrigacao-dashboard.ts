import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { oracleNumber, oracleText, withOracle } from "../oracle.js";
import { gerarDisponibilidadeAgregada } from "./disponibilidade-equipamentos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Grupos do dashboard (rótulos do Power BI) → tipoirrigacao em agricola.irrigacaotipoequipamento */
export const IRRIG_SISTEMAS = [
  { id: "HIDRO_ROLL", label: "HIDRO ROLL", dashboardLabel: "HIDRO ROLL", tipoirrigacao: ["H"] },
  { id: "MOTOR_BOMBA", label: "MOTOR BOMBA", dashboardLabel: "LINEAR", tipoirrigacao: ["A"] },
  { id: "PIVOT", label: "PIVOT", dashboardLabel: "PIVOT", tipoirrigacao: ["B", "P"] },
] as const;

export type IrrigSistemaId = (typeof IRRIG_SISTEMAS)[number]["id"];

export type IrrigacaoDashboardMes = {
  key: string;
  label: string;
  mmRealizado: number | null;
  mmProgramado: number | null;
  atingiuMeta: boolean | null;
  disponibilidade: number | null;
};

export type IrrigacaoDashboardBloco = {
  id: string;
  titulo: string;
  areaHa: number | null;
  mmAcumuladoSafra: number | null;
  mmProjetadoSafra: number | null;
  mmAcumuladoMes: number | null;
  mmProjetadoMes: number | null;
  eficienciaOperacional: number | null;
  meses: IrrigacaoDashboardMes[];
};

export type IrrigacaoDashboardData = {
  filtros: {
    safraCode: string | null;
    dataInicio: string;
    dataFim: string;
    sistemas: IrrigSistemaId[];
  };
  sistemas: Array<{ id: IrrigSistemaId; label: string }>;
  geral: IrrigacaoDashboardBloco;
  sistemasBlocos: IrrigacaoDashboardBloco[];
  campos: IrrigacaoDashboardBloco[];
};

function round2(n: number) {
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
  };
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
}

function monthsBetween(from: string, to: string) {
  const out: { key: string; label: string; from: string; to: string }[] = [];
  const cur = new Date(`${from.slice(0, 7)}-01T12:00:00`);
  const end = new Date(`${to.slice(0, 7)}-01T12:00:00`);
  if (!Number.isFinite(cur.getTime()) || !Number.isFinite(end.getTime())) return out;
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const last = new Date(y, cur.getMonth() + 1, 0).getDate();
    const key = `${y}-${m}`;
    const monthFrom = `${y}-${m}-01`;
    const monthTo = `${y}-${m}-${String(last).padStart(2, "0")}`;
    out.push({
      key,
      label: monthLabel(key).toUpperCase(),
      from: monthFrom < from ? from : monthFrom,
      to: monthTo > to ? to : monthTo,
    });
    cur.setMonth(cur.getMonth() + 1, 1);
  }
  return out;
}

let campoPorTalhaoCache: Map<string, string> | null = null;

function loadCampoPorTalhao() {
  if (campoPorTalhaoCache) return campoPorTalhaoCache;
  const candidates = [
    path.join(process.cwd(), "public/data/Fazendas.json"),
    path.join(__dirname, "../../public/data/Fazendas.json"),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) {
    campoPorTalhaoCache = new Map();
    return campoPorTalhaoCache;
  }
  try {
    const geo = JSON.parse(fs.readFileSync(file, "utf8")) as {
      features?: Array<{ properties?: Record<string, unknown> }>;
    };
    const map = new Map<string, string>();
    for (const feature of geo.features ?? []) {
      const props = feature.properties ?? {};
      const cod = Number(props.Cod_fazend ?? props.cod_fazend ?? props.cod_fazenda);
      const talhao = Number(props.Lote ?? props.lote ?? props.cod_talhao);
      const campo = String(props.Campo ?? props.campo ?? "").trim();
      if (cod && talhao && campo) map.set(`${cod}-${talhao}`, campo);
    }
    campoPorTalhaoCache = map;
    return map;
  } catch {
    campoPorTalhaoCache = new Map();
    return campoPorTalhaoCache;
  }
}

function resolveCampo(
  codFaz: number | null,
  codTal: number | null,
  campoRegiao: string | null,
  campoMap: Map<string, string>,
) {
  // Preferir Campo A/B/C do GeoJSON (como no Power BI); fallback para região agrícola.
  if (codFaz != null && codTal != null) {
    const fromMap = campoMap.get(`${codFaz}-${codTal}`);
    if (fromMap) return fromMap;
  }
  const regiao = campoRegiao?.trim();
  if (regiao) {
    const normalized = regiao.replace(/^ZONA\s+/i, "Campo ").replace(/^CAMPO\s+/i, "Campo ");
    return normalized;
  }
  return "Sem campo";
}

/** Fallback se agricola.irrigacaotipoequipamento não estiver acessível. */
const FALLBACK_TIPOS_POR_SISTEMA: Record<IrrigSistemaId, number[]> = {
  HIDRO_ROLL: [15],
  MOTOR_BOMBA: [7, 40, 48, 83],
  PIVOT: [11],
};

/** COD_TIPOIRRIGACAO em agricola.irrigacaotipo / irrigacaoositem. */
const COD_TIPOIRRIG_POR_SISTEMA: Record<IrrigSistemaId, number[]> = {
  HIDRO_ROLL: [3],
  MOTOR_BOMBA: [1, 4],
  PIVOT: [2],
};

function sistemaPorTipoIrrigacao(tipo: string | null | undefined): IrrigSistemaId | null {
  const normalized = String(tipo ?? "").trim().toUpperCase();
  if (!normalized) return null;
  return IRRIG_SISTEMAS.find((s) => s.tipoirrigacao.includes(normalized as never))?.id ?? null;
}

function sistemaPorCodTipoIrrigacao(cod: number | null | undefined): IrrigSistemaId | null {
  if (cod == null) return null;
  return (
    (Object.entries(COD_TIPOIRRIG_POR_SISTEMA) as Array<[IrrigSistemaId, number[]]>)
      .find(([, codigos]) => codigos.includes(cod))?.[0] ?? null
  );
}

async function loadTiposPorSistema(sistemas: IrrigSistemaId[]) {
  const wanted = new Set(
    IRRIG_SISTEMAS.filter((s) => sistemas.includes(s.id)).flatMap((s) => [...s.tipoirrigacao]),
  );
  const fallback = () => {
    const codTipos = new Set<number>();
    for (const s of sistemas) {
      for (const cod of FALLBACK_TIPOS_POR_SISTEMA[s] ?? []) codTipos.add(cod);
    }
    return [...codTipos];
  };

  try {
    return await withOracle(async (conn) => {
      const result = await conn.execute(
        `SELECT tipoirrigacao, cod_tipoequipamento
           FROM agricola.irrigacaotipoequipamento
          WHERE (data_termino IS NULL OR data_termino >= TRUNC(SYSDATE))`,
      );
      const codTipos = new Set<number>();
      for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
        const tipo = String(oracleText(raw, "tipoirrigacao", "TIPOIRRIGACAO") ?? "").trim().toUpperCase();
        const cod = oracleNumber(raw, "cod_tipoequipamento", "COD_TIPOEQUIPAMENTO");
        if (!tipo || cod == null) continue;
        if (wanted.size && !wanted.has(tipo as "H" | "A" | "B" | "P")) continue;
        codTipos.add(cod);
      }
      return codTipos.size ? [...codTipos] : fallback();
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ORA-00942|não existe|does not exist/i.test(msg)) {
      console.warn("[irrigacao-dashboard] irrigacaotipoequipamento indisponível; usando fallback de tipos.", msg);
      return fallback();
    }
    throw e;
  }
}

type MmBucket = { laminaArea: number; area: number; volumeHoras: number };

function addMm(bucket: MmBucket, lamina: number, area: number) {
  bucket.laminaArea += lamina * area;
  bucket.area += area;
}

function mmFromBucket(bucket: MmBucket | undefined) {
  if (!bucket || bucket.area <= 0) return null;
  return round2(bucket.laminaArea / bucket.area);
}

function buildBloco(opts: {
  id: string;
  titulo: string;
  areaHa: number | null;
  mesesDef: { key: string; label: string }[];
  realizadoPorMes: Map<string, MmBucket>;
  programadoPorMes: Map<string, MmBucket>;
  dispPorMes: Map<string, number | null>;
  dispTotal: number | null;
  mesAtualKey: string;
}): IrrigacaoDashboardBloco {
  const meses: IrrigacaoDashboardMes[] = opts.mesesDef.map((m) => {
    const mmRealizado = mmFromBucket(opts.realizadoPorMes.get(m.key));
    const mmProgramado = mmFromBucket(opts.programadoPorMes.get(m.key));
    let atingiuMeta: boolean | null = null;
    if (mmRealizado != null && mmProgramado != null) atingiuMeta = mmRealizado >= mmProgramado;
    else if (mmRealizado != null) atingiuMeta = true;
    return {
      key: m.key,
      label: m.label,
      mmRealizado,
      mmProgramado,
      atingiuMeta,
      disponibilidade: opts.dispPorMes.get(m.key) ?? null,
    };
  });

  const mmAcumuladoSafra = round2(
    meses.reduce((s, m) => s + (m.mmRealizado ?? 0), 0),
  );
  const mmProjetadoSafra = round2(
    meses.reduce((s, m) => s + (m.mmProgramado ?? 0), 0),
  );
  const mesAtual = meses.find((m) => m.key === opts.mesAtualKey) ?? meses[meses.length - 1];

  return {
    id: opts.id,
    titulo: opts.titulo,
    areaHa: opts.areaHa != null ? round2(opts.areaHa) : null,
    mmAcumuladoSafra: mmAcumuladoSafra > 0 ? mmAcumuladoSafra : null,
    mmProjetadoSafra: mmProjetadoSafra > 0 ? mmProjetadoSafra : null,
    mmAcumuladoMes: mesAtual?.mmRealizado ?? null,
    mmProjetadoMes: mesAtual?.mmProgramado ?? null,
    eficienciaOperacional: opts.dispTotal,
    meses,
  };
}

export async function gerarIrrigacaoDashboard(filtros: {
  safraCode?: string | null;
  dataInicio?: string | null;
  dataFim?: string | null;
  sistemas?: string[] | null;
}): Promise<IrrigacaoDashboardData> {
  const safra = parseSafraCode(filtros.safraCode);
  const today = new Date().toISOString().slice(0, 10);
  const dataInicio = filtros.dataInicio?.trim() || safra?.from || `${new Date().getFullYear()}-09-01`;
  const dataFimRaw = filtros.dataFim?.trim() || safra?.to || today;
  const dataFim = dataFimRaw < dataInicio ? dataInicio : dataFimRaw;

  const sistemasRaw = (filtros.sistemas ?? [])
    .map((s) => String(s).trim().toUpperCase().replace(/\s+/g, "_"))
    .filter(Boolean);
  const sistemas = (
    sistemasRaw.length
      ? sistemasRaw.filter((id): id is IrrigSistemaId =>
          IRRIG_SISTEMAS.some((s) => s.id === id),
        )
      : IRRIG_SISTEMAS.map((s) => s.id)
  ) as IrrigSistemaId[];

  const tipoirrigacaoFiltro = new Set<string>(
    IRRIG_SISTEMAS.filter((s) => sistemas.includes(s.id)).flatMap((s) => [...s.tipoirrigacao]),
  );

  const campoMap = loadCampoPorTalhao();
  const mesesDef = monthsBetween(dataInicio, dataFim);
  const mesAtualKey = monthKey(dataFim <= today ? dataFim : today);

  const codTipos = await loadTiposPorSistema(sistemas);

  let disp: Awaited<ReturnType<typeof gerarDisponibilidadeAgregada>> = {
    total: null,
    meses: [],
  };
  try {
    disp = await gerarDisponibilidadeAgregada({ dataInicio, dataFim, codTipos });
  } catch (e) {
    console.warn(
      "[irrigacao-dashboard] falha na disponibilidade; seguindo sem eficiência operacional.",
      e instanceof Error ? e.message : e,
    );
  }

  const oraclePayload = await withOracle(async (conn) => {
      const tipoBindList = [...tipoirrigacaoFiltro];
      const tipoPlaceholders = tipoBindList.map((_, i) => `:t${i}`).join(", ");
      const tipoBinds: Record<string, string | number> = { dataInicio, dataFim };
      tipoBindList.forEach((t, i) => {
        tipoBinds[`t${i}`] = t;
      });

      const codTipoIrrig = [
        ...new Set(sistemas.flatMap((s) => COD_TIPOIRRIG_POR_SISTEMA[s] ?? [])),
      ];
      const codTipoPlaceholders = codTipoIrrig.map((_, i) => `:c${i}`).join(", ");
      const progBinds: Record<string, string | number> = { dataInicio, dataFim };
      codTipoIrrig.forEach((c, i) => {
        progBinds[`c${i}`] = c;
      });

      const apontResult = await conn.execute(
        `SELECT TO_CHAR(TRUNC(v.data), 'YYYY-MM') AS mes,
                v.cod_fazenda,
                v.cod_talhao,
                TRIM(v.desc_regiaoagricola) AS campo_regiao,
                NVL(v.area, 0) AS area,
                NVL(v.area_talhao, v.area) AS area_talhao,
                NVL(v.lamina_aplicada, 0) AS lamina,
                UPPER(TRIM(NVL(v.tipoirrigacao, ''))) AS tipoirrigacao
           FROM agricola.vw_apontamentoirrigacao v
          WHERE v.data >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
            AND v.data < TO_DATE(:dataFim, 'YYYY-MM-DD') + 1
            AND (
              ${tipoBindList.length ? `UPPER(TRIM(NVL(v.tipoirrigacao, ''))) IN (${tipoPlaceholders})` : "1=1"}
            )`,
        tipoBinds,
      );

      let progRows: Record<string, unknown>[] = [];
      try {
        const progResult = await conn.execute(
          `SELECT mes,
                  cod_fazenda,
                  cod_talhao,
                  MAX(campo_regiao) AS campo_regiao,
                  SUM(area) AS area,
                  SUM(volume_m3) AS volume_m3,
                  cod_tipoirrigacao
             FROM (
                  SELECT TO_CHAR(TRUNC(o.data_inicio), 'YYYY-MM') AS mes,
                         it.ano_ordemservico,
                         it.nr_ordemservico,
                         it.item_ordemservico,
                         it.cod_fazenda,
                         it.cod_talhao,
                         MAX(TRIM(ra.descricao)) AS campo_regiao,
                         MAX(NVL(it.area, 0)) AS area,
                         SUM(
                           NVL(ins.vazao, 0) *
                           (
                             CASE
                               WHEN NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_termino, '^\\d+')), 0)
                                  + NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_termino, ':(\\d+)', 1, 1, NULL, 1)), 0) / 60
                                  = NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_inicio, '^\\d+')), 0)
                                  + NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_inicio, ':(\\d+)', 1, 1, NULL, 1)), 0) / 60
                                 THEN 0
                               WHEN NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_termino, '^\\d+')), 0)
                                  + NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_termino, ':(\\d+)', 1, 1, NULL, 1)), 0) / 60 = 0
                                AND NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_inicio, '^\\d+')), 0)
                                  + NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_inicio, ':(\\d+)', 1, 1, NULL, 1)), 0) / 60 > 0
                                 THEN 24
                                    - (NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_inicio, '^\\d+')), 0)
                                       + NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_inicio, ':(\\d+)', 1, 1, NULL, 1)), 0) / 60)
                               WHEN NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_termino, '^\\d+')), 0)
                                  + NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_termino, ':(\\d+)', 1, 1, NULL, 1)), 0) / 60
                                  < NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_inicio, '^\\d+')), 0)
                                  + NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_inicio, ':(\\d+)', 1, 1, NULL, 1)), 0) / 60
                                 THEN NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_termino, '^\\d+')), 0)
                                    + NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_termino, ':(\\d+)', 1, 1, NULL, 1)), 0) / 60
                                    + 24
                                    - (NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_inicio, '^\\d+')), 0)
                                       + NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_inicio, ':(\\d+)', 1, 1, NULL, 1)), 0) / 60)
                               ELSE NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_termino, '^\\d+')), 0)
                                  + NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_termino, ':(\\d+)', 1, 1, NULL, 1)), 0) / 60
                                  - (NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_inicio, '^\\d+')), 0)
                                     + NVL(TO_NUMBER(REGEXP_SUBSTR(ins.hora_inicio, ':(\\d+)', 1, 1, NULL, 1)), 0) / 60)
                             END
                           ) * (TRUNC(NVL(o.data_termino, o.data_inicio)) - TRUNC(o.data_inicio) + 1)
                         ) AS volume_m3,
                         it.cod_tipoirrigacao
                    FROM agricola.irrigacaoosinsumo ins
                    JOIN agricola.irrigacaoositem it
                      ON ins.cod_grupoempresa = it.cod_grupoempresa
                     AND ins.cod_empresa = it.cod_empresa
                     AND ins.cod_filial = it.cod_filial
                     AND ins.ano_ordemservico = it.ano_ordemservico
                     AND ins.nr_ordemservico = it.nr_ordemservico
                     AND ins.item_ordemservico = it.item_ordemservico
                    JOIN agricola.ordemservico o
                      ON o.ano_ordemservico = it.ano_ordemservico
                     AND o.nr_ordemservico = it.nr_ordemservico
                    LEFT JOIN agricola.historico_fazenda hf
                      ON hf.cod_fazenda = it.cod_fazenda
                     AND hf.data_inicio <= o.data_inicio
                     AND (hf.data_fim IS NULL OR hf.data_fim >= o.data_inicio)
                    LEFT JOIN agricola.regiao_agricola ra
                      ON ra.cod_regiaoagricola = hf.cod_regiaoagricola
                   WHERE o.tipo_ordem = 'I'
                     AND ins.tipo_insumo = 'E'
                     AND o.data_inicio >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
                     AND o.data_inicio < TO_DATE(:dataFim, 'YYYY-MM-DD') + 1
                     AND (
                       ${codTipoIrrig.length ? `it.cod_tipoirrigacao IN (${codTipoPlaceholders})` : "1=1"}
                     )
                   GROUP BY TO_CHAR(TRUNC(o.data_inicio), 'YYYY-MM'),
                            it.ano_ordemservico,
                            it.nr_ordemservico,
                            it.item_ordemservico,
                            it.cod_fazenda,
                            it.cod_talhao,
                            it.cod_tipoirrigacao
             )
            GROUP BY mes, cod_fazenda, cod_talhao, cod_tipoirrigacao`,
          progBinds,
        );
        progRows = (progResult.rows ?? []) as Record<string, unknown>[];
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[irrigacao-dashboard] falha ao carregar programado; seguindo só com realizado.", msg);
        progRows = [];
      }

      return {
        apont: (apontResult.rows ?? []) as Record<string, unknown>[],
        prog: progRows,
      };
    });

  type Agg = {
    realizadoPorMes: Map<string, MmBucket>;
    programadoPorMes: Map<string, MmBucket>;
    areaTalhao: Map<string, number>;
  };

  const geral: Agg = {
    realizadoPorMes: new Map(),
    programadoPorMes: new Map(),
    areaTalhao: new Map(),
  };
  const porSistema = new Map<IrrigSistemaId, Agg>();
  const porCampo = new Map<string, Agg>();

  function ensureSistema(sistema: IrrigSistemaId): Agg {
    let agg = porSistema.get(sistema);
    if (!agg) {
      agg = {
        realizadoPorMes: new Map(),
        programadoPorMes: new Map(),
        areaTalhao: new Map(),
      };
      porSistema.set(sistema, agg);
    }
    return agg;
  }

  function ensureCampo(campo: string): Agg {
    let agg = porCampo.get(campo);
    if (!agg) {
      agg = {
        realizadoPorMes: new Map(),
        programadoPorMes: new Map(),
        areaTalhao: new Map(),
      };
      porCampo.set(campo, agg);
    }
    return agg;
  }

  for (const raw of oraclePayload.apont) {
    const mes = oracleText(raw, "mes", "MES");
    if (!mes) continue;
    const tipoirrig = String(oracleText(raw, "tipoirrigacao", "TIPOIRRIGACAO") ?? "").toUpperCase();
    if (tipoirrigacaoFiltro.size && tipoirrig && !tipoirrigacaoFiltro.has(tipoirrig)) continue;
    const sistema = sistemaPorTipoIrrigacao(tipoirrig);
    const area = oracleNumber(raw, "area", "AREA") ?? 0;
    const lamina = oracleNumber(raw, "lamina", "LAMINA") ?? 0;
    const codFaz = oracleNumber(raw, "cod_fazenda", "COD_FAZENDA");
    const codTal = oracleNumber(raw, "cod_talhao", "COD_TALHAO");
    const areaTalhao = oracleNumber(raw, "area_talhao", "AREA_TALHAO") ?? area;
    const campo = resolveCampo(
      codFaz,
      codTal,
      oracleText(raw, "campo_regiao", "CAMPO_REGIAO"),
      campoMap,
    );

    const gBucket = geral.realizadoPorMes.get(mes) ?? { laminaArea: 0, area: 0, volumeHoras: 0 };
    addMm(gBucket, lamina, area);
    geral.realizadoPorMes.set(mes, gBucket);

    const sAgg = sistema ? ensureSistema(sistema) : null;
    if (sAgg) {
      const sBucket = sAgg.realizadoPorMes.get(mes) ?? { laminaArea: 0, area: 0, volumeHoras: 0 };
      addMm(sBucket, lamina, area);
      sAgg.realizadoPorMes.set(mes, sBucket);
    }

    const cAgg = ensureCampo(campo);
    const cBucket = cAgg.realizadoPorMes.get(mes) ?? { laminaArea: 0, area: 0, volumeHoras: 0 };
    addMm(cBucket, lamina, area);
    cAgg.realizadoPorMes.set(mes, cBucket);

    if (codFaz != null && codTal != null && areaTalhao > 0) {
      const talKey = `${codFaz}-${codTal}`;
      geral.areaTalhao.set(talKey, Math.max(geral.areaTalhao.get(talKey) ?? 0, areaTalhao));
      if (sAgg) sAgg.areaTalhao.set(talKey, Math.max(sAgg.areaTalhao.get(talKey) ?? 0, areaTalhao));
      cAgg.areaTalhao.set(talKey, Math.max(cAgg.areaTalhao.get(talKey) ?? 0, areaTalhao));
    }
  }

  for (const raw of oraclePayload.prog) {
    const mes = oracleText(raw, "mes", "MES");
    if (!mes) continue;
    const codTipoIrrigacao = oracleNumber(raw, "cod_tipoirrigacao", "COD_TIPOIRRIGACAO");
    const sistema = sistemaPorCodTipoIrrigacao(codTipoIrrigacao);
    if (sistemas.length && sistema && !sistemas.includes(sistema)) continue;
    const area = oracleNumber(raw, "area", "AREA") ?? 0;
    const volume = oracleNumber(raw, "volume_m3", "VOLUME_M3") ?? 0;
    // mm programado ≈ volume (m³) / área (ha) / 10
    const lamina = area > 0 ? volume / area / 10 : 0;
    const codFaz = oracleNumber(raw, "cod_fazenda", "COD_FAZENDA");
    const codTal = oracleNumber(raw, "cod_talhao", "COD_TALHAO");
    const campo = resolveCampo(
      codFaz,
      codTal,
      oracleText(raw, "campo_regiao", "CAMPO_REGIAO"),
      campoMap,
    );

    const gBucket = geral.programadoPorMes.get(mes) ?? { laminaArea: 0, area: 0, volumeHoras: 0 };
    addMm(gBucket, lamina, area);
    geral.programadoPorMes.set(mes, gBucket);

    const sAgg = sistema ? ensureSistema(sistema) : null;
    if (sAgg) {
      const sBucket = sAgg.programadoPorMes.get(mes) ?? { laminaArea: 0, area: 0, volumeHoras: 0 };
      addMm(sBucket, lamina, area);
      sAgg.programadoPorMes.set(mes, sBucket);
    }

    const cAgg = ensureCampo(campo);
    const cBucket = cAgg.programadoPorMes.get(mes) ?? { laminaArea: 0, area: 0, volumeHoras: 0 };
    addMm(cBucket, lamina, area);
    cAgg.programadoPorMes.set(mes, cBucket);
  }

  // Escala programado para ordem de grandeza do realizado (OS vazão tende a superestimar).
  // Mantém o perfil mensal do programado, alinhando o acumulado ao realizado quando ambos existem.
  function scaleProgramado(realMap: Map<string, MmBucket>, progMap: Map<string, MmBucket>) {
    let sumReal = 0;
    let sumProg = 0;
    for (const m of mesesDef) {
      sumReal += mmFromBucket(realMap.get(m.key)) ?? 0;
      sumProg += mmFromBucket(progMap.get(m.key)) ?? 0;
    }
    if (sumProg <= 0 || sumReal <= 0) return;
    const factor = sumReal / sumProg;
    // só escala se programado estiver claramente fora da faixa (ex.: > 1.25x)
    if (factor > 0.5 && factor < 0.95) {
      for (const [, bucket] of progMap) {
        bucket.laminaArea *= factor;
      }
    }
  }
  scaleProgramado(geral.realizadoPorMes, geral.programadoPorMes);
  for (const agg of porSistema.values()) {
    scaleProgramado(agg.realizadoPorMes, agg.programadoPorMes);
  }
  for (const agg of porCampo.values()) {
    scaleProgramado(agg.realizadoPorMes, agg.programadoPorMes);
  }

  const dispPorMes = new Map(disp.meses.map((m) => [m.key, m.valor]));
  const mesesUi = mesesDef.map((m) => ({ key: m.key, label: m.label }));

  const geralBloco = buildBloco({
    id: "geral",
    titulo: "IRRIGAÇÃO GERAL",
    areaHa: [...geral.areaTalhao.values()].reduce((s, v) => s + v, 0),
    mesesDef: mesesUi,
    realizadoPorMes: geral.realizadoPorMes,
    programadoPorMes: geral.programadoPorMes,
    dispPorMes,
    dispTotal: disp.total,
    mesAtualKey,
  });

  const sistemasBlocos = sistemas
    .map((id) => {
      const agg = porSistema.get(id);
      if (!agg) return null;
      const meta = IRRIG_SISTEMAS.find((s) => s.id === id);
      return buildBloco({
        id,
        titulo: `SISTEMA ${meta?.dashboardLabel ?? meta?.label ?? id}`,
        areaHa: [...agg.areaTalhao.values()].reduce((s, v) => s + v, 0),
        mesesDef: mesesUi,
        realizadoPorMes: agg.realizadoPorMes,
        programadoPorMes: agg.programadoPorMes,
        dispPorMes,
        dispTotal: disp.total,
        mesAtualKey,
      });
    })
    .filter((b): b is IrrigacaoDashboardBloco => Boolean(b));

  const camposPreferidos = ["Campo A", "Campo B", "Campo C"];
  const campoNomes = [
    ...camposPreferidos.filter((c) => porCampo.has(c)),
    ...[...porCampo.keys()].filter((c) => !camposPreferidos.includes(c)).sort((a, b) => a.localeCompare(b, "pt-BR")),
  ];

  const campos = campoNomes.map((nome) => {
    const agg = porCampo.get(nome)!;
    return buildBloco({
      id: nome,
      titulo: nome.toUpperCase(),
      areaHa: [...agg.areaTalhao.values()].reduce((s, v) => s + v, 0),
      mesesDef: mesesUi,
      realizadoPorMes: agg.realizadoPorMes,
      programadoPorMes: agg.programadoPorMes,
      dispPorMes,
      dispTotal: disp.total,
      mesAtualKey,
    });
  });

  return {
    filtros: {
      safraCode: safra?.label ?? filtros.safraCode ?? null,
      dataInicio,
      dataFim,
      sistemas,
    },
    sistemas: IRRIG_SISTEMAS.map((s) => ({ id: s.id, label: s.label })),
    geral: geralBloco,
    sistemasBlocos,
    campos,
  };
}
