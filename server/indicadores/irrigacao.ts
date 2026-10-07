import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { oracleNumber, oracleText, withOracle } from "../oracle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type IrrigacaoEquipLinha = {
  tipo: string;
  codEquipamento: number;
  areaProgramada: number;
  areaAplicada: number;
  hrsProgramada: number;
  hrsTrabalhadas: number;
  efiArea: number | null;
  efiHoras: number | null;
  mmHa: number | null;
};

export type IrrigacaoParadaMotivo = {
  motivo: string;
  horas: number;
};

export type IrrigacaoParadaEquip = {
  codEquipamento: number;
  horas: number;
};

export type IrrigacaoEficienciaCampo = {
  campo: string;
  efiArea: number | null;
  efiHoras: number | null;
};

export type IrrigacaoPeriodoProgramado = {
  dataInicio: string;
  dataFim: string;
  areaProgramada: number;
  areaAplicada: number;
  eficiencia: number | null;
};

export type IndicadoresIrrigacaoData = {
  filtros: {
    dataInicio: string;
    dataFim: string;
    codEquipamento: number | null;
    codFazenda: number | null;
    campo: string | null;
    tipoEquipamento: string | null;
  };
  kpis: {
    areaProgramada: number;
    areaAplicada: number;
    eficiencia: number | null;
    mmHa: number | null;
    volumeM3: number;
  };
  programadoRealizado: IrrigacaoEquipLinha[];
  paradasPorMotivo: IrrigacaoParadaMotivo[];
  paradasPorEquipamento: IrrigacaoParadaEquip[];
  eficienciaPorCampo: IrrigacaoEficienciaCampo[];
  periodosProgramados: IrrigacaoPeriodoProgramado[];
  opcoes: {
    equipamentos: Array<{ codEquipamento: number; descricao: string; tipo: string }>;
    fazendas: Array<{ codFazenda: number; descricao: string }>;
    campos: string[];
    tipos: string[];
  };
  horasParadasTotal: number;
};

function round2(n: number) {
  return Math.round((n || 0) * 100) / 100;
}

function round3(n: number) {
  return Math.round((n || 0) * 1000) / 1000;
}

function ratio(aplicado: number, programado: number) {
  if (!programado || programado <= 0) return null;
  return round3(aplicado / programado);
}

function isoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function defaultRange() {
  const today = new Date();
  return { dataInicio: `${today.getFullYear()}-01-01`, dataFim: isoDate(today) };
}

function parseOptionalNumber(raw: string | null | undefined) {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseHm(raw: string) {
  const parts = String(raw || "").trim().split(":");
  if (parts.length < 2) return 0;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h + m / 60;
}

/** Duração em horas; virada de dia (Pivot 06:00→03:41 ou término 00:00) conta até o dia seguinte. */
function hoursSpan(inicio: string, termino: string) {
  const start = parseHm(inicio);
  let end = parseHm(termino);
  if (end === start) return 0;
  if (end === 0 && start > 0) end = 24;
  if (end < start) end += 24;
  return Math.max(0, end - start);
}

function normalizeMotivoParada(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Parada tarifária — não entra em horas paradas nem no desconto de Hrs Trabalhadas. */
function isHorarioPico(motivo: string) {
  return normalizeMotivoParada(motivo).includes("HORARIO DE PICO");
}

function clipIsoRange(from: string, to: string, min: string, max: string) {
  const start = from < min ? min : from;
  const end = to > max ? max : to;
  return start <= end ? { start, end } : null;
}

function eachIsoDay(from: string, to: string) {
  const days: Date[] = [];
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return days;
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }
  return days;
}

/** 20 h segunda a sexta, 24 h sábado e domingo. */
function horasProgramadasCalendario(from: string, to: string) {
  return eachIsoDay(from, to).reduce((sum, d) => sum + (d.getDay() === 0 || d.getDay() === 6 ? 24 : 20), 0);
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

const IRRIG_TIPO_EQUIP = "11, 15, 48, 40, 6";

const DATE_RANGE_APONT = `
  v.data >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
  AND v.data < TO_DATE(:dataFim, 'YYYY-MM-DD') + 1
`;

const OS_PERIOD_FILTER = `
  o.TIPO_ORDEM = 'I'
  AND o.DATA_INICIO < TO_DATE(:dataFim, 'YYYY-MM-DD') + 1
  AND NVL(o.DATA_TERMINO, o.DATA_INICIO) >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
`;

export type IrrigacaoOpcoes = IndicadoresIrrigacaoData["opcoes"];

function resolveCampo(
  codFaz: number | null,
  codTal: number | null,
  zona: number | null,
  campoRegiao: string | null,
  campoMap: Map<string, string>,
  zonaCampo: Map<string, string>,
) {
  const regiao = campoRegiao?.trim();
  if (regiao) return regiao;
  const fromTalhao = codFaz != null && codTal != null ? campoMap.get(`${codFaz}-${codTal}`) : null;
  if (fromTalhao) return fromTalhao;
  const fromZona = codFaz != null && zona != null ? zonaCampo.get(`${codFaz}-${zona}`) : null;
  if (fromZona) return fromZona;
  if (zona != null) return `Zona ${zona}`;
  return "Sem campo";
}

export async function carregarOpcoesIrrigacao(): Promise<IrrigacaoOpcoes> {
  return withOracle(async (conn) => {
    const fazendasResult = await conn.execute(
      `SELECT f.cod_fazenda,
              f.descricao
         FROM agricola.fazenda f
        WHERE NVL(f.cod_fazenda, -1) <> 0
          AND f.descricao IS NOT NULL
        ORDER BY f.descricao, f.cod_fazenda`,
    );
    const fazendas = ((fazendasResult.rows ?? []) as Record<string, unknown>[]).map((raw) => ({
      codFazenda: oracleNumber(raw, "cod_fazenda", "COD_FAZENDA") ?? 0,
      descricao: oracleText(raw, "descricao", "DESCRICAO") || String(oracleNumber(raw, "cod_fazenda", "COD_FAZENDA") ?? ""),
    }));

    const camposResult = await conn.execute(
      `SELECT DISTINCT TRIM(r.descricao) AS campo
         FROM agricola.regiao_agricola r
        WHERE r.descricao IS NOT NULL
        ORDER BY 1`,
    );
    const campos = ((camposResult.rows ?? []) as Record<string, unknown>[])
      .map((raw) => oracleText(raw, "campo", "CAMPO"))
      .filter((campo): campo is string => Boolean(campo?.trim()));

    const equipResult = await conn.execute(
      `SELECT e.cod_equipamento,
              e.descricao,
              te.DESCRICAOTIPOEQUIPAMENTO AS tipo
         FROM automotivo.equipamento e
         JOIN automotivo.historico_tipoequipamento ht
           ON ht.cod_equipamento = e.cod_equipamento
          AND ht.data_fim IS NULL
         LEFT JOIN automotivo.tipoequipamento te
           ON te.cod_tipoequipamento = ht.cod_tipoequipamento
        WHERE ht.cod_tipoequipamento IN (${IRRIG_TIPO_EQUIP})
        ORDER BY e.descricao, e.cod_equipamento`,
    );
    const equipamentos = ((equipResult.rows ?? []) as Record<string, unknown>[]).map((raw) => ({
      codEquipamento: oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO") ?? 0,
      descricao: oracleText(raw, "descricao", "DESCRICAO") || String(oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO") ?? ""),
      tipo: oracleText(raw, "tipo", "TIPO") || "Sem tipo",
    }));
    const tipos = [...new Set(equipamentos.map((eq) => eq.tipo).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    );

    return { fazendas, campos, equipamentos, tipos };
  });
}

export async function gerarIndicadoresIrrigacao(filtros: {
  dataInicio?: string | null;
  dataFim?: string | null;
  codEquipamento?: string | null;
  codFazenda?: string | null;
  campo?: string | null;
  tipoEquipamento?: string | null;
}): Promise<IndicadoresIrrigacaoData> {
  const defaults = defaultRange();
  const dataInicio = filtros.dataInicio?.trim() || defaults.dataInicio;
  const dataFim = filtros.dataFim?.trim() || defaults.dataFim;
  const codEquipamento = parseOptionalNumber(filtros.codEquipamento);
  const codFazenda = parseOptionalNumber(filtros.codFazenda);
  const campoFiltro = filtros.campo?.trim() || null;
  const tipoFiltro = filtros.tipoEquipamento?.trim() || null;
  const campoMap = loadCampoPorTalhao();
  const binds = { dataInicio, dataFim, codEquipamento, codFazenda };
  const bindsParadas = { dataInicio, dataFim, codEquipamento };

  const [opcoesBase, payload] = await Promise.all([
    carregarOpcoesIrrigacao(),
    withOracle(async (conn) => {
      const equipResult = await conn.execute(
        `SELECT e.COD_EQUIPAMENTO,
                e.DESCRICAO,
                te.DESCRICAOTIPOEQUIPAMENTO AS tipo
           FROM AUTOMOTIVO.EQUIPAMENTO e
           LEFT JOIN automotivo.historico_tipoequipamento ht
             ON ht.cod_equipamento = e.cod_equipamento
            AND ht.data_fim IS NULL
           LEFT JOIN automotivo.tipoequipamento te
             ON te.cod_tipoequipamento = ht.cod_tipoequipamento
          WHERE ht.cod_tipoequipamento IN (${IRRIG_TIPO_EQUIP})
          ORDER BY te.DESCRICAOTIPOEQUIPAMENTO, e.COD_EQUIPAMENTO`,
      );
      const equipMeta = new Map<number, { descricao: string; tipo: string }>();
      for (const raw of (equipResult.rows ?? []) as Record<string, unknown>[]) {
        const cod = oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO");
        if (cod == null) continue;
        equipMeta.set(cod, {
          descricao: oracleText(raw, "descricao", "DESCRICAO"),
          tipo: oracleText(raw, "tipo", "TIPO") || "Sem tipo",
        });
      }

      const equipMatchesTipo = (codEq: number | null) => {
        if (!tipoFiltro) return true;
        if (codEq == null) return false;
        return (equipMeta.get(codEq)?.tipo ?? "Sem tipo") === tipoFiltro;
      };

      const zonaResult = await conn.execute(
        `SELECT z.cod_zona, z.cod_fazenda, z.descricao AS campo
           FROM agricola.zona z`,
      );
      const zonaCampo = new Map<string, string>();
      for (const raw of (zonaResult.rows ?? []) as Record<string, unknown>[]) {
        const codZona = oracleNumber(raw, "cod_zona", "COD_ZONA");
        const codFaz = oracleNumber(raw, "cod_fazenda", "COD_FAZENDA");
        const campo = oracleText(raw, "campo", "CAMPO");
        if (codZona != null && codFaz != null && campo) zonaCampo.set(`${codFaz}-${codZona}`, campo);
      }

      const apontResult = await conn.execute(
        `SELECT v.cod_equipamento,
                v.cod_fazenda,
                v.cod_talhao,
                v.zona,
                TRIM(v.desc_regiaoagricola) AS campo_regiao,
                TO_CHAR(TRUNC(v.data), 'YYYY-MM-DD') AS dia,
                SUM(NVL(v.area, 0)) AS area,
                SUM(NVL(v.mt_cubicos, 0) * NVL(v.area, 0)) AS mt_cubicos,
                SUM(NVL(v.tempo_aplicacao, 0)) AS tempo_aplicacao
           FROM agricola.vw_apontamentoirrigacao v
          WHERE ${DATE_RANGE_APONT}
            AND (:codEquipamento IS NULL OR v.cod_equipamento = :codEquipamento)
            AND (:codFazenda IS NULL OR v.cod_fazenda = :codFazenda)
          GROUP BY v.cod_equipamento,
                   v.cod_fazenda,
                   v.cod_talhao,
                   v.zona,
                   TRIM(v.desc_regiaoagricola),
                   TRUNC(v.data)`,
        binds,
      );

      type ApontAgg = { area: number; volume: number; horas: number; areaMm: number };
      const apontPorEquip = new Map<number, ApontAgg>();
      const apontPorCampo = new Map<string, ApontAgg>();
      const areaPorDia = new Map<string, number>();

      for (const raw of (apontResult.rows ?? []) as Record<string, unknown>[]) {
        const codEq = oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO");
        const codFaz = oracleNumber(raw, "cod_fazenda", "COD_FAZENDA");
        const codTal = oracleNumber(raw, "cod_talhao", "COD_TALHAO");
        const zona = oracleNumber(raw, "zona", "ZONA");
        const area = oracleNumber(raw, "area", "AREA") ?? 0;
        const volume = oracleNumber(raw, "mt_cubicos", "MT_CUBICOS") ?? 0;
        const horas = oracleNumber(raw, "tempo_aplicacao", "TEMPO_APLICACAO") ?? 0;
        const dia = oracleText(raw, "dia", "DIA");

        const campo = resolveCampo(
          codFaz,
          codTal,
          zona,
          oracleText(raw, "campo_regiao", "CAMPO_REGIAO"),
          campoMap,
          zonaCampo,
        );

        if (!equipMatchesTipo(codEq)) continue;
        if (campoFiltro && campo !== campoFiltro) continue;

        if (codEq != null) {
          const bucket = apontPorEquip.get(codEq) ?? { area: 0, volume: 0, horas: 0, areaMm: 0 };
          bucket.area += area;
          bucket.volume += volume;
          bucket.horas += horas;
          bucket.areaMm += area;
          apontPorEquip.set(codEq, bucket);
        }

        const campoBucket = apontPorCampo.get(campo) ?? { area: 0, volume: 0, horas: 0, areaMm: 0 };
        campoBucket.area += area;
        campoBucket.horas += horas;
        apontPorCampo.set(campo, campoBucket);

        if (dia) areaPorDia.set(dia, (areaPorDia.get(dia) ?? 0) + area);
      }

      const progResult = await conn.execute(
        `SELECT x.cod_equipamento,
                x.ano_ordemservico,
                x.nr_ordemservico,
                x.item_ordemservico,
                x.cod_fazenda,
                x.cod_talhao,
                x.data_inicio,
                x.data_termino,
                x.area,
                x.hora_inicio,
                x.hora_termino,
                MAX(ra.descricao) AS campo_regiao
           FROM (
                 SELECT ins.cod_insumo AS cod_equipamento,
                        o.ano_ordemservico,
                        o.nr_ordemservico,
                        it.item_ordemservico,
                        it.cod_fazenda,
                        it.cod_talhao,
                        TO_CHAR(TRUNC(o.data_inicio), 'YYYY-MM-DD') AS data_inicio,
                        TO_CHAR(TRUNC(NVL(o.data_termino, o.data_inicio)), 'YYYY-MM-DD') AS data_termino,
                        MAX(NVL(it.area, 0)) AS area,
                        ins.hora_inicio,
                        ins.hora_termino
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
                  WHERE ins.tipo_insumo = 'E'
                    AND ${OS_PERIOD_FILTER}
                    AND (:codEquipamento IS NULL OR ins.cod_insumo = :codEquipamento)
                    AND (:codFazenda IS NULL OR it.cod_fazenda = :codFazenda)
                  GROUP BY ins.cod_insumo,
                           o.ano_ordemservico,
                           o.nr_ordemservico,
                           it.item_ordemservico,
                           it.cod_fazenda,
                           it.cod_talhao,
                           TRUNC(o.data_inicio),
                           TRUNC(NVL(o.data_termino, o.data_inicio)),
                           ins.hora_inicio,
                           ins.hora_termino
                ) x
           LEFT JOIN agricola.historico_fazenda hf
             ON hf.cod_fazenda = x.cod_fazenda
            AND hf.data_inicio <= TO_DATE(x.data_inicio, 'YYYY-MM-DD')
            AND (hf.data_fim IS NULL OR hf.data_fim >= TO_DATE(x.data_inicio, 'YYYY-MM-DD'))
           LEFT JOIN agricola.regiao_agricola ra
             ON ra.cod_regiaoagricola = hf.cod_regiaoagricola
          GROUP BY x.cod_equipamento,
                   x.ano_ordemservico,
                   x.nr_ordemservico,
                   x.item_ordemservico,
                   x.cod_fazenda,
                   x.cod_talhao,
                   x.data_inicio,
                   x.data_termino,
                   x.area,
                   x.hora_inicio,
                   x.hora_termino`,
        binds,
      );

      type ProgAgg = { area: number; horas: number };
      const progPorEquip = new Map<number, ProgAgg>();
      const progPorCampo = new Map<string, ProgAgg>();
      const progPorPeriodo = new Map<string, ProgAgg & { dataInicio: string; dataFim: string }>();
      const areaJaContada = new Set<string>();
      const horasPorOs = new Map<string, number>();
      const horasPorItem = new Map<string, number>();

      for (const raw of (progResult.rows ?? []) as Record<string, unknown>[]) {
        const codEq = oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO");
        const anoOs = oracleNumber(raw, "ano_ordemservico", "ANO_ORDEMSERVICO");
        const nrOs = oracleNumber(raw, "nr_ordemservico", "NR_ORDEMSERVICO");
        const itemOs = oracleNumber(raw, "item_ordemservico", "ITEM_ORDEMSERVICO");
        const codFaz = oracleNumber(raw, "cod_fazenda", "COD_FAZENDA");
        const codTal = oracleNumber(raw, "cod_talhao", "COD_TALHAO");
        const area = oracleNumber(raw, "area", "AREA") ?? 0;
        const di = oracleText(raw, "data_inicio", "DATA_INICIO") || dataInicio;
        const df = oracleText(raw, "data_termino", "DATA_TERMINO") || di;
        const clipped = clipIsoRange(di, df, dataInicio, dataFim);
        const horas = clipped ? horasProgramadasCalendario(clipped.start, clipped.end) : 0;

        const campo = resolveCampo(
          codFaz,
          codTal,
          null,
          oracleText(raw, "campo_regiao", "CAMPO_REGIAO"),
          campoMap,
          zonaCampo,
        );
        if (!equipMatchesTipo(codEq)) continue;
        if (campoFiltro && campo !== campoFiltro) continue;

        const areaKey = `${codEq ?? ""}|${anoOs ?? ""}|${nrOs ?? ""}|${itemOs ?? ""}`;
        const osKey = `${codEq ?? ""}|${anoOs ?? ""}|${nrOs ?? ""}`;
        const contarArea = !areaJaContada.has(areaKey);
        if (contarArea) areaJaContada.add(areaKey);

        if (codEq != null) {
          const bucket = progPorEquip.get(codEq) ?? { area: 0, horas: 0 };
          if (contarArea) bucket.area += area;
          const prevOs = horasPorOs.get(osKey) ?? 0;
          if (horas > prevOs) {
            bucket.horas += horas - prevOs;
            horasPorOs.set(osKey, horas);
          }
          progPorEquip.set(codEq, bucket);
        }

        const campoBucket = progPorCampo.get(campo) ?? { area: 0, horas: 0 };
        if (contarArea) campoBucket.area += area;
        const prevHoras = horasPorItem.get(osKey) ?? 0;
        const deltaHoras = horas > prevHoras ? horas - prevHoras : 0;
        if (deltaHoras > 0) horasPorItem.set(osKey, horas);
        campoBucket.horas += deltaHoras;
        progPorCampo.set(campo, campoBucket);

        const periodoKey = `${di}|${df}`;
        const periodoBucket = progPorPeriodo.get(periodoKey) ?? { area: 0, horas: 0, dataInicio: di, dataFim: df };
        if (contarArea) periodoBucket.area += area;
        periodoBucket.horas += deltaHoras;
        progPorPeriodo.set(periodoKey, periodoBucket);
      }

      const equipamentos = new Set<number>([...apontPorEquip.keys(), ...progPorEquip.keys()]);
      const programadoRealizado: IrrigacaoEquipLinha[] = [...equipamentos]
        .map((cod) => {
          const meta = equipMeta.get(cod);
          const aplic = apontPorEquip.get(cod) ?? { area: 0, volume: 0, horas: 0, areaMm: 0 };
          const prog = progPorEquip.get(cod) ?? { area: 0, horas: 0 };
          const mmHa = aplic.areaMm > 0 ? round2(aplic.volume / aplic.areaMm / 10) : null;
          return {
            tipo: meta?.tipo ?? "Sem tipo",
            codEquipamento: cod,
            areaProgramada: round2(prog.area),
            areaAplicada: round2(aplic.area),
            hrsProgramada: round3(prog.horas),
            hrsTrabalhadas: round3(aplic.horas),
            efiArea: ratio(aplic.area, prog.area),
            efiHoras: ratio(aplic.horas, prog.horas),
            mmHa,
          };
        })
        .filter((row) => row.areaProgramada > 0 || row.areaAplicada > 0 || row.hrsProgramada > 0 || row.hrsTrabalhadas > 0)
        .sort((a, b) => a.tipo.localeCompare(b.tipo, "pt-BR") || a.codEquipamento - b.codEquipamento);

      const totalAreaProg = round2(programadoRealizado.reduce((s, r) => s + r.areaProgramada, 0));
      const totalAreaAplic = round2(programadoRealizado.reduce((s, r) => s + r.areaAplicada, 0));
      const totalVolume = round2([...apontPorEquip.values()].reduce((s, r) => s + r.volume, 0));
      const totalAreaVol = [...apontPorEquip.values()].reduce((s, r) => s + r.areaMm, 0);

      const paradasResult = await conn.execute(
        `SELECT TRIM(NVL(m.descricao, 'Motivo ' || TO_CHAR(a.cod_motivo))) AS motivo,
                a.cod_insumo AS cod_equipamento,
                a.inicio,
                a.termino
           FROM agricola.irrigacaomotivoparada a
           INNER JOIN agricola.apontamento b
              ON a.ano_apontamento = b.ano_apontamento
             AND a.nr_apontamento = b.nr_apontamento
           LEFT JOIN laboratorio.motivo m
             ON m.cod_grupoempresa = a.cod_grupoempresa
            AND m.cod_empresa = a.cod_empresa
            AND m.cod_filial = a.cod_filial
            AND m.cod_motivo = a.cod_motivo
          WHERE b.tipo_apontamento = 'I'
            AND b.data_apontamento >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
            AND b.data_apontamento < TO_DATE(:dataFim, 'YYYY-MM-DD') + 1
            AND (:codEquipamento IS NULL OR a.cod_insumo = :codEquipamento)`,
        bindsParadas,
      );

      const motivoHoras = new Map<string, number>();
      const equipHoras = new Map<number, number>();
      let horasParadasTotal = 0;
      for (const raw of (paradasResult.rows ?? []) as Record<string, unknown>[]) {
        const motivo = oracleText(raw, "motivo", "MOTIVO") || "Sem motivo";
        if (isHorarioPico(motivo)) continue;
        const codEq = oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO");
        const horas = hoursSpan(
          oracleText(raw, "inicio", "INICIO"),
          oracleText(raw, "termino", "TERMINO"),
        );
        if (horas <= 0) continue;
        if (!equipMatchesTipo(codEq)) continue;
        motivoHoras.set(motivo, (motivoHoras.get(motivo) ?? 0) + horas);
        if (codEq != null) equipHoras.set(codEq, (equipHoras.get(codEq) ?? 0) + horas);
        horasParadasTotal += horas;
      }

      const paradasPorMotivo: IrrigacaoParadaMotivo[] = [...motivoHoras.entries()]
        .map(([motivo, horas]) => ({ motivo, horas: round3(horas) }))
        .sort((a, b) => b.horas - a.horas);

      const paradasPorEquipamento: IrrigacaoParadaEquip[] = [...equipHoras.entries()]
        .map(([cod, horas]) => ({ codEquipamento: cod, horas: round3(horas) }))
        .sort((a, b) => b.horas - a.horas);

      for (const row of programadoRealizado) {
        const paradas = equipHoras.get(row.codEquipamento) ?? 0;
        row.hrsTrabalhadas = round3(Math.max(0, row.hrsTrabalhadas - paradas));
        row.efiHoras = ratio(row.hrsTrabalhadas, row.hrsProgramada);
      }

      const campos = [...new Set([...apontPorCampo.keys(), ...progPorCampo.keys()])]
        .filter((c) => c !== "Sem campo")
        .sort();
      const eficienciaPorCampo: IrrigacaoEficienciaCampo[] = campos.map((campo) => {
        const aplic = apontPorCampo.get(campo) ?? { area: 0, horas: 0, volume: 0, areaMm: 0 };
        const prog = progPorCampo.get(campo) ?? { area: 0, horas: 0 };
        return {
          campo,
          efiArea: ratio(aplic.area, prog.area),
          efiHoras: ratio(aplic.horas, prog.horas),
        };
      });

      const periodosProgramados: IrrigacaoPeriodoProgramado[] = [...progPorPeriodo.values()]
        .map((row) => {
          let aplic = 0;
          for (const [dia, area] of areaPorDia) {
            if (dia >= row.dataInicio && dia <= row.dataFim) aplic += area;
          }
          return {
            dataInicio: row.dataInicio,
            dataFim: row.dataFim,
            areaProgramada: round2(row.area),
            areaAplicada: round2(aplic),
            eficiencia: ratio(aplic, row.area),
          };
        })
        .sort((a, b) => b.dataInicio.localeCompare(a.dataInicio));

      return {
        equipMeta,
        programadoRealizado,
        totalAreaProg,
        totalAreaAplic,
        totalVolume,
        totalAreaVol,
        paradasPorMotivo,
        paradasPorEquipamento,
        horasParadasTotal,
        eficienciaPorCampo,
        periodosProgramados,
        campos,
      };
    }),
  ]);

  const extraEquips = payload.programadoRealizado
    .filter((row) => !opcoesBase.equipamentos.some((eq) => eq.codEquipamento === row.codEquipamento))
    .map((row) => ({
      codEquipamento: row.codEquipamento,
      descricao: payload.equipMeta.get(row.codEquipamento)?.descricao || String(row.codEquipamento),
      tipo: payload.equipMeta.get(row.codEquipamento)?.tipo || row.tipo,
    }));

  return {
    filtros: { dataInicio, dataFim, codEquipamento, codFazenda, campo: campoFiltro, tipoEquipamento: tipoFiltro },
    kpis: {
      areaProgramada: payload.totalAreaProg,
      areaAplicada: payload.totalAreaAplic,
      eficiencia: ratio(payload.totalAreaAplic, payload.totalAreaProg),
      mmHa: payload.totalAreaVol > 0 ? round2(payload.totalVolume / payload.totalAreaVol / 10) : null,
      volumeM3: payload.totalVolume,
    },
    programadoRealizado: payload.programadoRealizado,
    paradasPorMotivo: payload.paradasPorMotivo,
    paradasPorEquipamento: payload.paradasPorEquipamento,
    eficienciaPorCampo: payload.eficienciaPorCampo,
    periodosProgramados: payload.periodosProgramados,
    opcoes: {
      equipamentos: extraEquips.length ? [...opcoesBase.equipamentos, ...extraEquips] : opcoesBase.equipamentos,
      fazendas: opcoesBase.fazendas,
      campos: [...new Set([...opcoesBase.campos, ...payload.campos])].sort(),
      tipos: [...new Set([...opcoesBase.tipos, ...payload.programadoRealizado.map((row) => row.tipo)])]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "pt-BR")),
    },
    horasParadasTotal: round3(payload.horasParadasTotal),
  };
}

