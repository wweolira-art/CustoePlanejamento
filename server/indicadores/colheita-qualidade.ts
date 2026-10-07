import { normalizePeriodoColheita, sqlFiltroPeriodoTrunc } from "../colheita/periodo-colheita.js";
import { oracleDate, oracleNumber, oracleText, withOracle } from "../oracle.js";

const TIPO_COLHEDORA = 81;

function codGrupoEmpresa() {
  return Number(process.env.COD_GRUPOEMPRESA || 1);
}

function money(n: number) {
  return Math.round((n || 0) * 100) / 100;
}

function pct(n: number) {
  return Math.round((n || 0) * 100) / 100;
}

type PerdaItemRow = {
  chaveAmostra: string;
  numeroAmostra: number;
  dataAmostra: string;
  mesRef: string;
  codEquipamento: number | null;
  equipTag: string;
  codOperador: number | null;
  nomeOperador: string;
  codFazenda: number | null;
  codTalhao: number | null;
  fazendaDesc: string;
  rendimentoagricola: number | null;
  codTipoPerda: number | null;
  tipoPerdaDesc: string;
  quantidade: number;
};

type SampleAgg = {
  chaveAmostra: string;
  numeroAmostra: number;
  dataAmostra: string;
  mesRef: string;
  codEquipamento: number | null;
  equipTag: string;
  codOperador: number | null;
  nomeOperador: string;
  fazendaKey: string;
  fazendaDesc: string;
  rendimentoagricola: number | null;
  quantidadeTotal: number;
};

export type ColheitaQualidadeLinha = {
  label: string;
  pctPerda: number | null;
  tonHaPerda: number | null;
  amostras: number;
  mesRef?: string;
  codEquipamento?: number | null;
  codOperador?: number | null;
  codTipoPerda?: number | null;
};

export type ColheitaQualidadeOperadorLinha = ColheitaQualidadeLinha & {
  equipamentos: ColheitaQualidadeLinha[];
};

export type ColheitaQualidadeEquipamentoOpcao = {
  codEquipamento: number;
  label: string;
};

export type ColheitaQualidadeData = {
  resumo: {
    pctPerda: number | null;
    tonHaPerda: number | null;
    amostras: number;
    impurezaMineral?: number | null;
  };
  linhaTempo: ColheitaQualidadeLinha[];
  porEquipamento: ColheitaQualidadeLinha[];
  porTipoPerda: Array<ColheitaQualidadeLinha & { quantidade: number }>;
  porOperador: ColheitaQualidadeOperadorLinha[];
  porFazenda: ColheitaQualidadeLinha[];
  impurezaPorEquipamento?: Array<{
    codEquipamento: number;
    label: string;
    impurezaMineral: number | null;
    amostras: number;
  }>;
  equipamentosOpcoes?: ColheitaQualidadeEquipamentoOpcao[];
};

function listarEquipamentosOpcoes(rows: PerdaItemRow[]): ColheitaQualidadeEquipamentoOpcao[] {
  const map = new Map<number, string>();
  for (const row of rows) {
    if (row.codEquipamento == null) continue;
    if (!map.has(row.codEquipamento)) map.set(row.codEquipamento, row.equipTag);
  }
  return [...map.entries()]
    .map(([codEquipamento, label]) => ({ codEquipamento, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { numeric: true }));
}

function filtrarPorEquipamentos(rows: PerdaItemRow[], codEquipamentos?: number[] | null) {
  if (!codEquipamentos?.length) return rows;
  const allowed = new Set(codEquipamentos);
  return rows.filter((row) => row.codEquipamento != null && allowed.has(row.codEquipamento));
}

/**
 * Power BI:
 *   md_TchMedio     = SUM(RENDIMENTOAGRICOLA) / COUNT(DATA_AMOSTRA)
 *   md_Qtde Percas  = SUM(QUANTIDADE)
 *   md_Mediaperdas  = md_Qtde Percas / COUNT(DATA_AMOSTRA)
 *   md_%Perdas      = md_Mediaperdas / (md_TchMedio + md_Mediaperdas)
 *
 * COUNT(DATA_AMOSTRA) is the number of sample rows in fPerdas (not item rows).
 * The percentage is stored as 0–100 to match the UI (Power BI formats the ratio as %).
 */
function perdaMetrics(samples: SampleAgg[]): { pctPerda: number | null; tonHaPerda: number | null; amostras: number } {
  const amostras = samples.length;
  if (!amostras) return { pctPerda: null, tonHaPerda: null, amostras: 0 };

  const sumTch = samples.reduce((acc, s) => acc + (s.rendimentoagricola ?? 0), 0);
  const sumQty = samples.reduce((acc, s) => acc + s.quantidadeTotal, 0);
  const tchMedio = sumTch / amostras;
  const mediaPerdas = sumQty / amostras;
  const denom = tchMedio + mediaPerdas;
  return {
    pctPerda: denom > 0 ? pct((mediaPerdas / denom) * 100) : 0,
    tonHaPerda: money(mediaPerdas),
    amostras,
  };
}

function monthLabel(mesRef: string) {
  const [year, month] = mesRef.split("-");
  const names = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
  const idx = Number(month) - 1;
  if (!year || idx < 0 || idx > 11) return mesRef;
  return `${names[idx]} ${year.slice(-2)}`;
}

function buildSamples(rows: PerdaItemRow[]): SampleAgg[] {
  const map = new Map<string, SampleAgg>();
  for (const row of rows) {
    const prev = map.get(row.chaveAmostra);
    if (!prev) {
      map.set(row.chaveAmostra, {
        chaveAmostra: row.chaveAmostra,
        numeroAmostra: row.numeroAmostra,
        dataAmostra: row.dataAmostra,
        mesRef: row.mesRef,
        codEquipamento: row.codEquipamento,
        equipTag: row.equipTag,
        codOperador: row.codOperador,
        nomeOperador: row.nomeOperador,
        fazendaKey: `${row.codFazenda ?? 0}-${row.codTalhao ?? 0}`,
        fazendaDesc: row.fazendaDesc,
        rendimentoagricola: row.rendimentoagricola,
        quantidadeTotal: row.quantidade,
      });
      continue;
    }
    prev.quantidadeTotal += row.quantidade;
  }

  return [...map.values()];
}

function aggregateGroup(
  samples: SampleAgg[],
  keyFn: (s: SampleAgg) => string,
  labelFn: (s: SampleAgg) => string,
  extra?: (s: SampleAgg) => Partial<ColheitaQualidadeLinha>,
): ColheitaQualidadeLinha[] {
  const groups = new Map<string, SampleAgg[]>();
  for (const sample of samples) {
    const key = keyFn(sample);
    const list = groups.get(key) ?? [];
    list.push(sample);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const ref = list[0];
      return {
        label: labelFn(ref),
        mesRef: /^\d{4}-\d{2}$/.test(key) ? key : ref.mesRef,
        ...perdaMetrics(list),
        ...(extra ? extra(ref) : {}),
      };
    })
    .sort((a, b) => (b.pctPerda ?? 0) - (a.pctPerda ?? 0));
}

function aggregateOperadorEquipamento(samples: SampleAgg[]): ColheitaQualidadeOperadorLinha[] {
  const byOperador = new Map<string, SampleAgg[]>();
  for (const sample of samples.filter((s) => s.codOperador != null || s.nomeOperador.trim())) {
    const key = String(sample.codOperador ?? sample.nomeOperador);
    const list = byOperador.get(key) ?? [];
    list.push(sample);
    byOperador.set(key, list);
  }

  return [...byOperador.values()]
    .map((list) => {
      const ref = list[0];
      return {
        label: ref.nomeOperador,
        ...perdaMetrics(list),
        codOperador: ref.codOperador,
        equipamentos: aggregateGroup(
          list.filter((s) => s.codEquipamento != null),
          (s) => String(s.codEquipamento),
          (s) => s.equipTag,
          (s) => ({ codEquipamento: s.codEquipamento }),
        ),
      };
    })
    .sort((a, b) => (b.pctPerda ?? 0) - (a.pctPerda ?? 0));
}

export function montarQualidadeColheita(rows: PerdaItemRow[]): ColheitaQualidadeData {
  const samples = buildSamples(rows);
  const totalQty = rows.reduce((acc, row) => acc + row.quantidade, 0);

  const porTipoMap = new Map<number, { descricao: string; quantidade: number }>();
  for (const row of rows) {
    if (row.codTipoPerda == null) continue;
    const prev = porTipoMap.get(row.codTipoPerda) ?? { descricao: row.tipoPerdaDesc, quantidade: 0 };
    prev.quantidade += row.quantidade;
    porTipoMap.set(row.codTipoPerda, prev);
  }

  return {
    resumo: {
      ...perdaMetrics(samples),
    },
    linhaTempo: aggregateGroup(
      samples,
      (s) => s.mesRef,
      (s) => monthLabel(s.mesRef),
    ).sort((a, b) => String(a.mesRef ?? a.label).localeCompare(String(b.mesRef ?? b.label))),
    porEquipamento: aggregateGroup(
      samples.filter((s) => s.codEquipamento != null),
      (s) => String(s.codEquipamento),
      (s) => s.equipTag,
      (s) => ({ codEquipamento: s.codEquipamento }),
    ),
    porTipoPerda: [...porTipoMap.entries()]
      .map(([codTipoPerda, item]) => ({
        codTipoPerda,
        label: item.descricao,
        quantidade: money(item.quantidade),
        pctPerda: totalQty > 0 ? pct((item.quantidade / totalQty) * 100) : null,
        tonHaPerda: null,
        amostras: 0,
      }))
      .sort((a, b) => (b.quantidade ?? 0) - (a.quantidade ?? 0)),
    porOperador: aggregateOperadorEquipamento(samples),
    porFazenda: aggregateGroup(
      samples.filter((s) => s.fazendaDesc.trim()),
      (s) => s.fazendaKey,
      (s) => s.fazendaDesc,
    ),
  };
}

export type EntradaMaquinaImpurezaLinha = {
  codEquipamento: number | null;
  maquina?: number | null;
  impMineral: number | null;
  peso: number | null;
};

export function enrichQualidadeImpureza(
  qualidade: ColheitaQualidadeData | null,
  linhas: EntradaMaquinaImpurezaLinha[],
  labelPorEquip = new Map<number, string>(),
): ColheitaQualidadeData | null {
  if (!linhas.length) return qualidade;

  const base = qualidade ?? montarQualidadeColheita([]);
  const impMap = new Map<
    string,
    { weighted: number; peso: number; label: string; codEquipamento: number | null }
  >();
  let totalWeighted = 0;
  let totalPeso = 0;

  for (const row of linhas) {
    if (row.impMineral == null || !Number.isFinite(row.impMineral)) continue;
    const peso = row.peso ?? 0;
    if (!(peso > 0)) continue;

    const key =
      row.codEquipamento != null
        ? `cod:${row.codEquipamento}`
        : row.maquina != null
          ? `maq:${row.maquina}`
          : null;
    if (!key) continue;

    const label =
      row.codEquipamento != null
        ? labelPorEquip.get(row.codEquipamento) ?? String(row.codEquipamento)
        : row.maquina != null
          ? String(row.maquina)
          : key;

    const prev = impMap.get(key) ?? { weighted: 0, peso: 0, label, codEquipamento: row.codEquipamento };
    prev.weighted += row.impMineral * peso;
    prev.peso += peso;
    impMap.set(key, prev);
    totalWeighted += row.impMineral * peso;
    totalPeso += peso;
  }

  if (!(totalPeso > 0)) return base;

  const impurezaPorEquipamento = [...impMap.values()]
    .map((agg) => ({
      codEquipamento: agg.codEquipamento,
      label: agg.label,
      impurezaMineral: agg.peso > 0 ? pct(agg.weighted / agg.peso) : null,
      amostras: 0,
    }))
    .sort((a, b) => (b.impurezaMineral ?? 0) - (a.impurezaMineral ?? 0));

  return {
    ...base,
    resumo: {
      ...base.resumo,
      impurezaMineral: pct(totalWeighted / totalPeso),
    },
    impurezaPorEquipamento,
  };
}

export async function loadQualidadeColheita(filtros: {
  dataInicio?: string | null;
  dataFim?: string | null;
  codTipoEquipamento?: number | null;
  codEquipamentos?: number[] | null;
}): Promise<ColheitaQualidadeData> {
  const rawInicio = filtros.dataInicio?.trim();
  const rawFim = filtros.dataFim?.trim();
  if (!rawInicio || !rawFim) {
    return montarQualidadeColheita([]);
  }
  const { dataInicio, dataFim } = normalizePeriodoColheita(rawInicio, rawFim);

  const codTipoEquipamento = filtros.codTipoEquipamento ?? TIPO_COLHEDORA;

  try {
    const rows = await withOracle(async (connection) => {
    const result = await connection.execute(
      `SELECT p.cod_empresa,
              p.cod_filial,
              p.cod_safra,
              p.numero_amostra,
              p.data_amostra,
              TO_CHAR(p.data_amostra, 'YYYY-MM') AS mes_ref,
              p.cod_equipamento,
              NVL(e.tag, TO_CHAR(p.cod_equipamento)) AS equip_tag,
              p.cod_operador,
              NVL(TRIM(vo.desc_operador), NVL(TRIM(f.cscfuncionario), 'Operador ' || p.cod_operador)) AS nome_operador,
              p.cod_fazenda,
              p.cod_talhao,
              TRIM(
                CASE
                  WHEN fz.descricao IS NOT NULL AND p.cod_talhao IS NOT NULL THEN fz.descricao || ' ' || p.cod_talhao
                  WHEN fz.descricao IS NOT NULL THEN fz.descricao
                  WHEN p.cod_fazenda IS NOT NULL AND p.cod_talhao IS NOT NULL THEN 'FAZ ' || p.cod_fazenda || ' ' || p.cod_talhao
                  ELSE 'FAZ ' || NVL(TO_CHAR(p.cod_fazenda), '?')
                END
              ) AS fazenda_desc,
              t.rendimentoagricola,
              pi.cod_tipoperda,
              NVL(tp.descricao, 'Tipo ' || pi.cod_tipoperda) AS tipo_perda_desc,
              NVL(pi.quantidade, 0) AS quantidade
         FROM agricola.perdas p
         LEFT JOIN agricola.perdas_itens pi
           ON pi.cod_grupoempresa = p.cod_grupoempresa
          AND pi.cod_empresa = p.cod_empresa
          AND pi.cod_filial = p.cod_filial
          AND pi.cod_safra = p.cod_safra
          AND pi.numero_amostra = p.numero_amostra
         LEFT JOIN agricola.tipo_perdacolheita tp
           ON tp.cod_tipoperda = pi.cod_tipoperda
         LEFT JOIN (
           SELECT cod_fazenda,
                  cod_talhao,
                  cod_safra,
                  MAX(rendimentoagricola) AS rendimentoagricola
             FROM agricola.talhao
            GROUP BY cod_fazenda, cod_talhao, cod_safra
         ) t
           ON t.cod_fazenda = p.cod_fazenda
          AND t.cod_talhao = p.cod_talhao
          AND t.cod_safra = p.cod_safra
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
         LEFT JOIN agricola.fazenda fz
           ON fz.cod_fazenda = p.cod_fazenda
          AND fz.cod_grupoempresa = p.cod_grupoempresa
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
        codTipoEquipamento,
      },
    );

    return (result.rows ?? []) as Record<string, unknown>[];
    });

    const parsed: PerdaItemRow[] = rows.map((raw) => {
    const dataAmostra = oracleDate(raw, "data_amostra", "DATA_AMOSTRA");
    const codEmpresa = oracleNumber(raw, "cod_empresa", "COD_EMPRESA") ?? 0;
    const codFilial = oracleNumber(raw, "cod_filial", "COD_FILIAL") ?? 0;
    const codSafra = oracleNumber(raw, "cod_safra", "COD_SAFRA") ?? 0;
    const numeroAmostra = oracleNumber(raw, "numero_amostra", "NUMERO_AMOSTRA") ?? 0;
    return {
      chaveAmostra: `${codEmpresa}-${codFilial}-${codSafra}-${numeroAmostra}`,
      numeroAmostra,
      dataAmostra: dataAmostra ?? "",
      mesRef: oracleText(raw, "mes_ref", "MES_REF") ?? "",
      codEquipamento: oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO"),
      equipTag: oracleText(raw, "equip_tag", "EQUIP_TAG") ?? "—",
      codOperador: oracleNumber(raw, "cod_operador", "COD_OPERADOR"),
      nomeOperador: oracleText(raw, "nome_operador", "NOME_OPERADOR") ?? "",
      codFazenda: oracleNumber(raw, "cod_fazenda", "COD_FAZENDA"),
      codTalhao: oracleNumber(raw, "cod_talhao", "COD_TALHAO"),
      fazendaDesc: oracleText(raw, "fazenda_desc", "FAZENDA_DESC") ?? "",
      rendimentoagricola: oracleNumber(raw, "rendimentoagricola", "RENDIMENTOAGRICOLA"),
      codTipoPerda: oracleNumber(raw, "cod_tipoperda", "COD_TIPOPERDA"),
      tipoPerdaDesc: oracleText(raw, "tipo_perda_desc", "TIPO_PERDA_DESC") ?? "",
      quantidade: oracleNumber(raw, "quantidade", "QUANTIDADE") ?? 0,
    };
    });

    const equipamentosOpcoes = listarEquipamentosOpcoes(parsed);
    const filtrado = filtrarPorEquipamentos(parsed, filtros.codEquipamentos);
    return { ...montarQualidadeColheita(filtrado), equipamentosOpcoes };
  } catch (err) {
    console.error("[colheita-qualidade] Erro ao buscar perdas:", err);
    return { ...montarQualidadeColheita([]), equipamentosOpcoes: [] };
  }
}
