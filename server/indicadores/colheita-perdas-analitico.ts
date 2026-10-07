import { normalizePeriodoColheita, sqlFiltroPeriodoTrunc } from "../colheita/periodo-colheita.js";
import { oracleDate, oracleNumber, oracleText, withOracle } from "../oracle.js";

const TIPO_COLHEDORA = 81;

export type PerdasAnaliticoAgrupamento =
  | "tipoCorte"
  | "equipamento"
  | "operador"
  | "fazenda"
  | "frente"
  | "turno"
  | "mes"
  | "nenhum";

export type PerdasAnaliticoLinha = {
  fazZonaTalhao: string;
  areaRealizada: number | null;
  tch: number | null;
  numeroAmostra: number;
  dataAmostra: string;
  areaAmostra: number | null;
  estilhaco: number;
  desconte: number;
  canaAgarrada: number;
  canaPicada: number;
  tolete: number;
  tocoMecanizado: number;
  talhaoEncerrado: string;
  bituca: string;
  totalPerdas: number;
  perdasTcHa: number;
  pctPerdasEst: number | null;
  pctPerdasReal: number | null;
};

export type PerdasAnaliticoGrupo = {
  chave: string;
  label: string;
  linhas: PerdasAnaliticoLinha[];
  subtotal?: PerdasAnaliticoLinha | null;
};

export type PerdasAnaliticoEquipamentoOpcao = {
  codEquipamento: number;
  label: string;
};

export type PerdasAnaliticoData = {
  filtros: {
    dataInicio: string;
    dataFim: string;
    agrupamento: PerdasAnaliticoAgrupamento;
  };
  grupos: PerdasAnaliticoGrupo[];
  totais: PerdasAnaliticoLinha | null;
  amostras: number;
  equipamentosOpcoes?: PerdasAnaliticoEquipamentoOpcao[];
};

function listarEquipamentosOpcoes(rows: PerdaAnaliticoItemRow[]): PerdasAnaliticoEquipamentoOpcao[] {
  const map = new Map<number, string>();
  for (const row of rows) {
    if (row.codEquipamento == null) continue;
    if (!map.has(row.codEquipamento)) map.set(row.codEquipamento, row.equipTag);
  }
  return [...map.entries()]
    .map(([codEquipamento, label]) => ({ codEquipamento, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { numeric: true }));
}

function filtrarPorEquipamentos(rows: PerdaAnaliticoItemRow[], codEquipamentos?: number[] | null) {
  if (!codEquipamentos?.length) return rows;
  const allowed = new Set(codEquipamentos);
  return rows.filter((row) => row.codEquipamento != null && allowed.has(row.codEquipamento));
}

type PerdaAnaliticoItemRow = {
  chaveAmostra: string;
  numeroAmostra: number;
  dataAmostra: string;
  mesRef: string;
  codFazenda: number | null;
  fazendaDesc: string;
  codTalhao: number | null;
  zona: number | null;
  areaAmostra: number | null;
  areaRealizada: number | null;
  tch: number | null;
  meta: number | null;
  bituca: string;
  talhaoEncerrado: string;
  codTipoCorte: number | null;
  tipoCorteDesc: string;
  codEquipamento: number | null;
  equipTag: string;
  codOperador: number | null;
  nomeOperador: string;
  codFrente: number | null;
  frenteDesc: string;
  turno: string;
  codTipoPerda: number | null;
  quantidade: number;
};

type AnaliticoSample = Omit<PerdaAnaliticoItemRow, "codTipoPerda" | "quantidade"> & {
  perdas: Record<keyof Pick<
    PerdasAnaliticoLinha,
    "estilhaco" | "desconte" | "canaAgarrada" | "canaPicada" | "tolete" | "tocoMecanizado"
  >, number>;
};

const LOSS_BY_CODE: Record<number, keyof AnaliticoSample["perdas"]> = {
  5: "estilhaco",
  6: "desconte",
  7: "canaAgarrada",
  8: "canaPicada",
  9: "tolete",
  14: "tocoMecanizado",
};

function codGrupoEmpresa() {
  return Number(process.env.COD_GRUPOEMPRESA || 1);
}

function money(n: number) {
  return Math.round((n || 0) * 10000) / 10000;
}

function pct(n: number) {
  return Math.round((n || 0) * 100) / 100;
}

function fmtSimNao(raw: string) {
  const v = raw.trim().toUpperCase();
  if (v === "S" || v === "SIM") return "Sim";
  if (v === "N" || v === "NAO" || v === "NÃO") return "Não";
  return raw.trim() || "—";
}

function monthLabel(mesRef: string) {
  const [year, month] = mesRef.split("-");
  const names = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
  const idx = Number(month) - 1;
  if (!year || idx < 0 || idx > 11) return mesRef;
  return `${names[idx]}/${year}`;
}

function fazZonaTalhao(row: Pick<PerdaAnaliticoItemRow, "codFazenda" | "zona" | "codTalhao">) {
  const faz = row.codFazenda ?? "?";
  const zona = row.zona ?? "?";
  const tal = row.codTalhao ?? "?";
  return `${faz} - ${zona} - ${tal}`;
}

function emptyPerdas(): AnaliticoSample["perdas"] {
  return {
    estilhaco: 0,
    desconte: 0,
    canaAgarrada: 0,
    canaPicada: 0,
    tolete: 0,
    tocoMecanizado: 0,
  };
}

function buildSamples(rows: PerdaAnaliticoItemRow[]): AnaliticoSample[] {
  const map = new Map<string, AnaliticoSample>();
  for (const row of rows) {
    let sample = map.get(row.chaveAmostra);
    if (!sample) {
      sample = {
        chaveAmostra: row.chaveAmostra,
        numeroAmostra: row.numeroAmostra,
        dataAmostra: row.dataAmostra,
        mesRef: row.mesRef,
        codFazenda: row.codFazenda,
        fazendaDesc: row.fazendaDesc,
        codTalhao: row.codTalhao,
        zona: row.zona,
        areaAmostra: row.areaAmostra,
        areaRealizada: row.areaRealizada,
        tch: row.tch,
        meta: row.meta,
        bituca: row.bituca,
        talhaoEncerrado: row.talhaoEncerrado,
        codTipoCorte: row.codTipoCorte,
        tipoCorteDesc: row.tipoCorteDesc,
        codEquipamento: row.codEquipamento,
        equipTag: row.equipTag,
        codOperador: row.codOperador,
        nomeOperador: row.nomeOperador,
        codFrente: row.codFrente,
        frenteDesc: row.frenteDesc,
        turno: row.turno,
        perdas: emptyPerdas(),
      };
      map.set(row.chaveAmostra, sample);
    }
    if (row.codTipoPerda != null) {
      const col = LOSS_BY_CODE[row.codTipoPerda];
      if (col) sample.perdas[col] += row.quantidade;
    }
  }
  return [...map.values()];
}

function talhaoKey(sample: Pick<AnaliticoSample, "codFazenda" | "zona" | "codTalhao">) {
  return `${sample.codFazenda ?? 0}-${sample.zona ?? 0}-${sample.codTalhao ?? 0}`;
}

function fazendaZonaKey(sample: Pick<AnaliticoSample, "codFazenda" | "zona">) {
  return `${sample.codFazenda ?? 0}-${sample.zona ?? 0}`;
}

function formatFazendaGrupoLabel(sample: Pick<AnaliticoSample, "codFazenda" | "fazendaDesc">) {
  const cod = sample.codFazenda ?? "?";
  const desc = sample.fazendaDesc?.trim() || `Fazenda ${cod}`;
  return `${cod} - ${desc}`;
}

function sampleToLinha(sample: AnaliticoSample): PerdasAnaliticoLinha {
  return aggregateSamplesToLinha([sample]);
}

function aggregateSamplesToLinha(samples: AnaliticoSample[], opts?: { resumoTalhao?: boolean }): PerdasAnaliticoLinha {
  const ref = samples[0];
  const amostras = samples.length;
  const sumPerdas = emptyPerdas();
  let sumTch = 0;
  let sumMeta = 0;
  let metaCount = 0;
  let sumAreaAmostra = 0;
  let areaAmostraCount = 0;

  for (const sample of samples) {
    sumTch += sample.tch ?? 0;
    if (sample.meta != null) {
      sumMeta += sample.meta;
      metaCount += 1;
    }
    if (sample.areaAmostra != null) {
      sumAreaAmostra += sample.areaAmostra;
      areaAmostraCount += 1;
    }
    for (const key of Object.keys(sumPerdas) as Array<keyof AnaliticoSample["perdas"]>) {
      sumPerdas[key] += sample.perdas[key];
    }
  }

  const perdasMedias = {
    estilhaco: money(sumPerdas.estilhaco / amostras),
    desconte: money(sumPerdas.desconte / amostras),
    canaAgarrada: money(sumPerdas.canaAgarrada / amostras),
    canaPicada: money(sumPerdas.canaPicada / amostras),
    tolete: money(sumPerdas.tolete / amostras),
    tocoMecanizado: money(sumPerdas.tocoMecanizado / amostras),
  };
  const totalPerdas = money(Object.values(perdasMedias).reduce((acc, v) => acc + v, 0));
  const tchMedio = money(sumTch / amostras);
  const denom = tchMedio + totalPerdas;

  const talhaoEncerrado = samples.every((s) => s.talhaoEncerrado === ref.talhaoEncerrado)
    ? fmtSimNao(ref.talhaoEncerrado)
    : "—";
  const bituca = samples.every((s) => s.bituca === ref.bituca) ? fmtSimNao(ref.bituca) : "—";

  return {
    fazZonaTalhao: fazZonaTalhao(ref),
    areaRealizada: ref.areaRealizada != null ? money(ref.areaRealizada) : null,
    tch: tchMedio,
    numeroAmostra: opts?.resumoTalhao ? amostras : amostras > 1 ? amostras : ref.numeroAmostra,
    dataAmostra: opts?.resumoTalhao ? "" : amostras > 1 ? "" : ref.dataAmostra,
    areaAmostra: areaAmostraCount ? money(sumAreaAmostra / areaAmostraCount) : null,
    ...perdasMedias,
    talhaoEncerrado,
    bituca,
    totalPerdas,
    perdasTcHa: totalPerdas,
    pctPerdasEst: metaCount ? pct(sumMeta / metaCount) : null,
    pctPerdasReal: denom > 0 ? pct((totalPerdas / denom) * 100) : null,
  };
}

function aggregateTalhaoResumo(samples: AnaliticoSample[]): PerdasAnaliticoLinha {
  return aggregateSamplesToLinha(samples, { resumoTalhao: true });
}

function aggregateFazendaSubtotal(samples: AnaliticoSample[]): PerdasAnaliticoLinha {
  const media = aggregateTalhaoResumo(samples);
  const somaPerdas = sumLinhas(samples.map((sample) => sampleToLinha(sample)));
  return {
    ...media,
    fazZonaTalhao: "Subtotal fazenda",
    ...{
      estilhaco: somaPerdas.estilhaco,
      desconte: somaPerdas.desconte,
      canaAgarrada: somaPerdas.canaAgarrada,
      canaPicada: somaPerdas.canaPicada,
      tolete: somaPerdas.tolete,
      tocoMecanizado: somaPerdas.tocoMecanizado,
      totalPerdas: somaPerdas.totalPerdas,
      perdasTcHa: somaPerdas.perdasTcHa,
    },
    talhaoEncerrado: "",
    bituca: "",
  };
}

function sumLinhas(linhas: PerdasAnaliticoLinha[]): PerdasAnaliticoLinha {
  const acc = linhas.reduce(
    (prev, row) => ({
      estilhaco: prev.estilhaco + row.estilhaco,
      desconte: prev.desconte + row.desconte,
      canaAgarrada: prev.canaAgarrada + row.canaAgarrada,
      canaPicada: prev.canaPicada + row.canaPicada,
      tolete: prev.tolete + row.tolete,
      tocoMecanizado: prev.tocoMecanizado + row.tocoMecanizado,
      totalPerdas: prev.totalPerdas + row.totalPerdas,
      perdasTcHa: prev.perdasTcHa + row.perdasTcHa,
      tchSum: prev.tchSum + (row.tch ?? 0),
      pctEstSum: prev.pctEstSum + (row.pctPerdasEst ?? 0),
      pctRealSum: prev.pctRealSum + (row.pctPerdasReal ?? 0),
      count: prev.count + 1,
    }),
    {
      estilhaco: 0,
      desconte: 0,
      canaAgarrada: 0,
      canaPicada: 0,
      tolete: 0,
      tocoMecanizado: 0,
      totalPerdas: 0,
      perdasTcHa: 0,
      tchSum: 0,
      pctEstSum: 0,
      pctRealSum: 0,
      count: 0,
    },
  );
  const n = acc.count || 1;
  return {
    fazZonaTalhao: "Total",
    areaRealizada: null,
    tch: money(acc.tchSum / n),
    numeroAmostra: 0,
    dataAmostra: "",
    areaAmostra: null,
    estilhaco: money(acc.estilhaco),
    desconte: money(acc.desconte),
    canaAgarrada: money(acc.canaAgarrada),
    canaPicada: money(acc.canaPicada),
    tolete: money(acc.tolete),
    tocoMecanizado: money(acc.tocoMecanizado),
    talhaoEncerrado: "",
    bituca: "",
    totalPerdas: money(acc.totalPerdas),
    perdasTcHa: money(acc.perdasTcHa / n),
    pctPerdasEst: pct(acc.pctEstSum / n),
    pctPerdasReal: pct(acc.pctRealSum / n),
  };
}

const GROUP_LABELS: Record<PerdasAnaliticoAgrupamento, string> = {
  tipoCorte: "Tipo de corte",
  equipamento: "Equipamento",
  operador: "Operador",
  fazenda: "Fazenda",
  frente: "Frente",
  turno: "Turno",
  mes: "Mês",
  nenhum: "Amostras",
};

function groupKey(sample: AnaliticoSample, agrupamento: PerdasAnaliticoAgrupamento) {
  switch (agrupamento) {
    case "tipoCorte":
      return String(sample.codTipoCorte ?? sample.tipoCorteDesc ?? "0");
    case "equipamento":
      return String(sample.codEquipamento ?? sample.equipTag ?? "0");
    case "operador":
      return String(sample.codOperador ?? sample.nomeOperador ?? "0");
    case "fazenda":
      return fazendaZonaKey(sample);
    case "frente":
      return String(sample.codFrente ?? sample.frenteDesc ?? "0");
    case "turno":
      return sample.turno?.trim() || "—";
    case "mes":
      return sample.mesRef || "—";
    case "nenhum":
      return "todas";
    default:
      return "todas";
  }
}

function groupLabel(sample: AnaliticoSample, agrupamento: PerdasAnaliticoAgrupamento) {
  switch (agrupamento) {
    case "tipoCorte":
      return sample.tipoCorteDesc?.trim() || "Sem tipo de corte";
    case "equipamento":
      return sample.equipTag?.trim() || String(sample.codEquipamento ?? "—");
    case "operador":
      return sample.nomeOperador?.trim() || "Sem operador";
    case "fazenda":
      return formatFazendaGrupoLabel(sample);
    case "frente":
      return sample.frenteDesc?.trim() || `Frente ${sample.codFrente ?? "—"}`;
    case "turno":
      return sample.turno?.trim() || "—";
    case "mes":
      return monthLabel(sample.mesRef);
    case "nenhum":
      return "Todas as amostras";
    default:
      return "Todas as amostras";
  }
}

function sortLinhasDetalhadas(a: PerdasAnaliticoLinha, b: PerdasAnaliticoLinha) {
  return a.dataAmostra.localeCompare(b.dataAmostra) || a.numeroAmostra - b.numeroAmostra;
}

function sortLinhasTalhao(a: PerdasAnaliticoLinha, b: PerdasAnaliticoLinha) {
  return a.fazZonaTalhao.localeCompare(b.fazZonaTalhao, "pt-BR", { numeric: true });
}

function buildGruposDetalhados(samples: AnaliticoSample[], agrupamento: PerdasAnaliticoAgrupamento): PerdasAnaliticoGrupo[] {
  const groupsMap = new Map<string, { label: string; linhas: PerdasAnaliticoLinha[] }>();
  for (const sample of samples) {
    const key = groupKey(sample, agrupamento);
    const label = groupLabel(sample, agrupamento);
    const list = groupsMap.get(key)?.linhas ?? [];
    list.push(sampleToLinha(sample));
    groupsMap.set(key, { label, linhas: list });
  }

  return [...groupsMap.entries()]
    .map(([chave, item]) => ({
      chave,
      label: agrupamento === "nenhum" ? item.label : `${GROUP_LABELS[agrupamento]}: ${item.label}`,
      linhas: item.linhas.sort(sortLinhasDetalhadas),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { numeric: true }));
}

function buildGruposPorFazendaTalhao(samples: AnaliticoSample[]): PerdasAnaliticoGrupo[] {
  const byFazenda = new Map<string, { label: string; samples: AnaliticoSample[] }>();
  for (const sample of samples) {
    const key = fazendaZonaKey(sample);
    const label = groupLabel(sample, "fazenda");
    const bucket = byFazenda.get(key) ?? { label, samples: [] };
    bucket.samples.push(sample);
    byFazenda.set(key, bucket);
  }

  return [...byFazenda.entries()]
    .map(([chave, item]) => {
      const byTalhao = new Map<string, AnaliticoSample[]>();
      for (const sample of item.samples) {
        const talhao = talhaoKey(sample);
        const list = byTalhao.get(talhao) ?? [];
        list.push(sample);
        byTalhao.set(talhao, list);
      }

      const linhas = [...byTalhao.values()].map(aggregateTalhaoResumo).sort(sortLinhasTalhao);
      return {
        chave,
        label: `${GROUP_LABELS.fazenda}: ${item.label}`,
        linhas,
        subtotal: item.samples.length ? aggregateFazendaSubtotal(item.samples) : null,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { numeric: true }));
}

export function montarPerdasColheitaAnalitico(
  rows: PerdaAnaliticoItemRow[],
  filtros: { dataInicio: string; dataFim: string; agrupamento: PerdasAnaliticoAgrupamento },
): PerdasAnaliticoData {
  const samples = buildSamples(rows);
  const linhas = samples
    .map(sampleToLinha)
    .sort((a, b) => a.dataAmostra.localeCompare(b.dataAmostra) || a.numeroAmostra - b.numeroAmostra);

  const grupos: PerdasAnaliticoGrupo[] =
    filtros.agrupamento === "fazenda"
      ? buildGruposPorFazendaTalhao(samples)
      : buildGruposDetalhados(samples, filtros.agrupamento);

  return {
    filtros,
    grupos,
    totais: linhas.length ? sumLinhas(linhas) : null,
    amostras: linhas.length,
    equipamentosOpcoes: [],
  };
}

export async function loadPerdasColheitaAnalitico(filtros: {
  dataInicio?: string | null;
  dataFim?: string | null;
  agrupamento?: PerdasAnaliticoAgrupamento | null;
  codEquipamentos?: number[] | null;
}): Promise<PerdasAnaliticoData> {
  const rawInicio = filtros.dataInicio?.trim() || "";
  const rawFim = filtros.dataFim?.trim() || "";
  const agrupamento = filtros.agrupamento ?? "tipoCorte";
  if (!rawInicio || !rawFim) {
    return montarPerdasColheitaAnalitico([], { dataInicio: rawInicio, dataFim: rawFim, agrupamento });
  }
  const { dataInicio, dataFim } = normalizePeriodoColheita(rawInicio, rawFim);
  const empty = montarPerdasColheitaAnalitico([], { dataInicio, dataFim, agrupamento });

  try {
    const rows = await withOracle(async (connection) => {
      const result = await connection.execute(
        `SELECT p.cod_empresa,
                p.cod_filial,
                p.cod_safra,
                p.numero_amostra,
                p.data_amostra,
                TO_CHAR(p.data_amostra, 'YYYY-MM') AS mes_ref,
                p.cod_fazenda,
                TRIM(NVL(fz.descricao, 'FAZ ' || p.cod_fazenda)) AS fazenda_desc,
                p.cod_talhao,
                p.zona,
                p.area_amostra,
                p.meta,
                p.bituca,
                p.cod_tipocorte,
                NVL(tc.descricao, 'Tipo ' || p.cod_tipocorte) AS tipo_corte_desc,
                p.cod_equipamento,
                NVL(e.tag, TO_CHAR(p.cod_equipamento)) AS equip_tag,
                p.cod_operador,
                NVL(TRIM(vo.desc_operador), NVL(TRIM(f.cscfuncionario), 'Operador ' || p.cod_operador)) AS nome_operador,
                p.cod_frente,
                NVL(fr.descricao, 'Frente ' || p.cod_frente) AS frente_desc,
                NVL(p.turno, '—') AS turno,
                t.rendimentoagricola,
                t.area_cortadamec,
                NVL(t.encerrado, 'N') AS encerrado,
                pi.cod_tipoperda,
                NVL(pi.quantidade, 0) AS quantidade
           FROM agricola.perdas p
           LEFT JOIN agricola.perdas_itens pi
             ON pi.cod_grupoempresa = p.cod_grupoempresa
            AND pi.cod_empresa = p.cod_empresa
            AND pi.cod_filial = p.cod_filial
            AND pi.cod_safra = p.cod_safra
            AND pi.numero_amostra = p.numero_amostra
           LEFT JOIN agricola.talhao t
             ON t.cod_fazenda = p.cod_fazenda
            AND t.cod_talhao = p.cod_talhao
            AND t.cod_safra = p.cod_safra
           LEFT JOIN agricola.tipo_corte tc
             ON tc.cod_tipocorte = p.cod_tipocorte
           LEFT JOIN agricola.fazenda fz
             ON fz.cod_fazenda = p.cod_fazenda
           LEFT JOIN agricola.frente fr
             ON fr.cod_frente = p.cod_frente
           LEFT JOIN automotivo.equipamento e
             ON e.cod_equipamento = p.cod_equipamento
           LEFT JOIN (
             SELECT TRIM(TO_CHAR(cod_funcionario)) AS cod_funcionario,
                    MAX(TRIM(desc_operador)) AS desc_operador
               FROM agricola.vw_operador
              WHERE cod_funcionario IS NOT NULL
              GROUP BY TRIM(TO_CHAR(cod_funcionario))
           ) vo
             ON vo.cod_funcionario = TRIM(TO_CHAR(p.cod_operador))
           LEFT JOIN agricola.sga_funcionario f
             ON TRIM(TO_CHAR(f.cdgfuncionario)) = TRIM(TO_CHAR(p.cod_operador))
          WHERE p.cod_grupoempresa = :codGrupo
            AND p.data_amostra IS NOT NULL
            AND ${sqlFiltroPeriodoTrunc("p.data_amostra")}
            AND EXISTS (
              SELECT 1
                FROM automotivo.historico_tipoequipamento ht
               WHERE ht.cod_equipamento = p.cod_equipamento
                 AND ht.data_fim IS NULL
                 AND ht.cod_tipoequipamento = :codTipoEquipamento
            )`,
        {
          codGrupo: codGrupoEmpresa(),
          dataInicio,
          dataFim,
          codTipoEquipamento: TIPO_COLHEDORA,
        },
      );
      return (result.rows ?? []) as Record<string, unknown>[];
    });

    const allParsed: PerdaAnaliticoItemRow[] = rows
      .map((raw) => {
        const dataAmostra = oracleDate(raw, "data_amostra", "DATA_AMOSTRA");
        const codEmpresa = oracleNumber(raw, "cod_empresa", "COD_EMPRESA") ?? 0;
        const codFilial = oracleNumber(raw, "cod_filial", "COD_FILIAL") ?? 0;
        const codSafra = oracleNumber(raw, "cod_safra", "COD_SAFRA") ?? 0;
        const numeroAmostra = oracleNumber(raw, "numero_amostra", "NUMERO_AMOSTRA") ?? 0;
        const codEquipamento = oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO");
        return {
          chaveAmostra: `${codEmpresa}-${codFilial}-${codSafra}-${numeroAmostra}`,
          numeroAmostra,
          dataAmostra: dataAmostra ?? "",
          mesRef: oracleText(raw, "mes_ref", "MES_REF") ?? "",
          codFazenda: oracleNumber(raw, "cod_fazenda", "COD_FAZENDA"),
          fazendaDesc: oracleText(raw, "fazenda_desc", "FAZENDA_DESC") ?? "",
          codTalhao: oracleNumber(raw, "cod_talhao", "COD_TALHAO"),
          zona: oracleNumber(raw, "zona", "ZONA"),
          areaAmostra: oracleNumber(raw, "area_amostra", "AREA_AMOSTRA"),
          areaRealizada: oracleNumber(raw, "area_cortadamec", "AREA_CORTADAMEC"),
          tch: oracleNumber(raw, "rendimentoagricola", "RENDIMENTOAGRICOLA"),
          meta: oracleNumber(raw, "meta", "META"),
          bituca: oracleText(raw, "bituca", "BITUCA") ?? "",
          talhaoEncerrado: oracleText(raw, "encerrado", "ENCERRADO") ?? "",
          codTipoCorte: oracleNumber(raw, "cod_tipocorte", "COD_TIPOCORTE"),
          tipoCorteDesc: oracleText(raw, "tipo_corte_desc", "TIPO_CORTE_DESC") ?? "",
          codEquipamento,
          equipTag: oracleText(raw, "equip_tag", "EQUIP_TAG") ?? "—",
          codOperador: oracleNumber(raw, "cod_operador", "COD_OPERADOR"),
          nomeOperador: oracleText(raw, "nome_operador", "NOME_OPERADOR") ?? "",
          codFrente: oracleNumber(raw, "cod_frente", "COD_FRENTE"),
          frenteDesc: oracleText(raw, "frente_desc", "FRENTE_DESC") ?? "",
          turno: oracleText(raw, "turno", "TURNO") ?? "",
          codTipoPerda: oracleNumber(raw, "cod_tipoperda", "COD_TIPOPERDA"),
          quantidade: oracleNumber(raw, "quantidade", "QUANTIDADE") ?? 0,
        };
      })
    const equipamentosOpcoes = listarEquipamentosOpcoes(allParsed);
    const parsed = filtrarPorEquipamentos(allParsed, filtros.codEquipamentos);

    return { ...montarPerdasColheitaAnalitico(parsed, { dataInicio, dataFim, agrupamento }), equipamentosOpcoes };
  } catch (err) {
    console.error("[colheita-perdas-analitico] Erro ao buscar perdas:", err);
    return empty;
  }
}
