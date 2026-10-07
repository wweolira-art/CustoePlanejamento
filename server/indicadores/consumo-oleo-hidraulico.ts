import { diaUtcFromIso } from "../colheita/ords-common.js";
import { listarEntradaCanaMaquinaList } from "../colheita/entrada-cana-maquina-list.js";
import { normalizePeriodoColheita } from "../colheita/periodo-colheita.js";
import { oracleNumber, oracleText, withOracle } from "../oracle.js";
import { gerarIndicadoresColheitaProducao } from "./colheita-producao.js";
import {
  META_OLEO_HIDRAULICO_LT_TON,
  oleoLtTon,
  type ConsumoOleoEquipamento,
  type ConsumoOleoHidraulicoData,
  type ConsumoOleoMes,
  type ConsumoOleoMotivo,
  type ConsumoOleoSafra,
} from "../../src/lib/consumo-oleo-hidraulico.js";

const TIPO_COLHEDORA = 81;
const MESES = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];

type EquipamentoTagVigencia = {
  tagNorm: string;
  codEquipamento: number;
  dataInicial: string;
  dataFinal: string | null;
};

type TipoEquipamentoVigencia = {
  codEquipamento: number;
  dataInicial: string;
  dataFinal: string | null;
};

function money(n: number) {
  return Math.round((n || 0) * 100) / 100;
}

function codGrupoEmpresa() {
  return Number(process.env.COD_GRUPOEMPRESA || 1);
}

function shiftIsoYear(iso: string, deltaYears: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y + deltaYears, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

function safraStartYearFromCode(code: string | null | undefined) {
  const match = String(code ?? "").match(/(\d{2})\s*\/\s*(\d{2})/);
  if (!match) return null;
  const yy = Number(match[1]);
  return yy >= 70 ? 1900 + yy : 2000 + yy;
}

function safraCodeFromIso(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  const start = m >= 9 ? y : y - 1;
  const a = String(start).slice(-2);
  const b = String((start + 1) % 100).padStart(2, "0");
  return `${a}/${b}`;
}

function diasInclusive(dataInicio: string, dataFim: string) {
  const ini = new Date(`${dataInicio}T12:00:00`);
  const fim = new Date(`${dataFim}T12:00:00`);
  if (!Number.isFinite(ini.getTime()) || !Number.isFinite(fim.getTime()) || fim < ini) return 1;
  return Math.round((fim.getTime() - ini.getTime()) / 86400000) + 1;
}

function inPeriodo(dia: string, ini: string, fim: string) {
  return dia >= ini && dia <= fim;
}

function mesLabel(chave: string) {
  const month = Number(chave.slice(5, 7));
  return MESES[month - 1] ?? chave;
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function normalizeTagKey(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const raw = String(value).trim().toUpperCase();
  if (!raw) return null;
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
}

function isOleoHidraulico(descricao: string | null | undefined) {
  const d = normalizeText(descricao);
  return d.includes("OLEO") && d.includes("HIDRAUL") && !d.includes("FILTRO");
}

async function loadEquipamentoTags(): Promise<EquipamentoTagVigencia[]> {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT tag,
              cod_equipamento,
              TO_CHAR(TRUNC(data_inicial), 'YYYY-MM-DD') AS data_inicial,
              TO_CHAR(TRUNC(data_final), 'YYYY-MM-DD') AS data_final
         FROM automotivo.equipamento_tag
        WHERE cod_grupoempresa = :codGrupo
          AND tag IS NOT NULL`,
      { codGrupo: codGrupoEmpresa() },
    );
    const out: EquipamentoTagVigencia[] = [];
    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const tagNorm = normalizeTagKey(oracleText(row, "tag", "TAG"));
      const cod = oracleNumber(row, "cod_equipamento", "COD_EQUIPAMENTO");
      const dataInicial = oracleText(row, "data_inicial", "DATA_INICIAL");
      if (!tagNorm || cod == null || !dataInicial) continue;
      out.push({
        tagNorm,
        codEquipamento: cod,
        dataInicial,
        dataFinal: oracleText(row, "data_final", "DATA_FINAL"),
      });
    }
    return out;
  });
}

async function loadHistoricoTipoColhedora(dataInicio: string, dataFim: string): Promise<TipoEquipamentoVigencia[]> {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT cod_equipamento,
              TO_CHAR(TRUNC(data_inicio), 'YYYY-MM-DD') AS data_inicial,
              TO_CHAR(TRUNC(data_fim), 'YYYY-MM-DD') AS data_final
         FROM automotivo.historico_tipoequipamento
        WHERE cod_tipoequipamento = ${TIPO_COLHEDORA}
          AND TRUNC(data_inicio) <= TO_DATE(:dataFim, 'YYYY-MM-DD')
          AND TRUNC(NVL(data_fim, DATE '9999-12-31')) >= TO_DATE(:dataInicio, 'YYYY-MM-DD')`,
      { dataInicio, dataFim },
    );
    const out: TipoEquipamentoVigencia[] = [];
    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const cod = oracleNumber(row, "cod_equipamento", "COD_EQUIPAMENTO");
      const dataInicial = oracleText(row, "data_inicial", "DATA_INICIAL");
      if (cod == null || !dataInicial) continue;
      out.push({
        codEquipamento: cod,
        dataInicial,
        dataFinal: oracleText(row, "data_final", "DATA_FINAL"),
      });
    }
    return out;
  });
}

function resolveCodPorEquipamentoTag(
  tags: EquipamentoTagVigencia[],
  maquina: number | string | null | undefined,
  dataColheita: string | null | undefined,
) {
  const key = normalizeTagKey(maquina);
  const dia = diaUtcFromIso(dataColheita);
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

function isColhedoraNoDia(historico: TipoEquipamentoVigencia[], codEquipamento: number | null, dia: string | null) {
  if (codEquipamento == null || !dia) return false;
  return historico.some(
    (row) =>
      row.codEquipamento === codEquipamento &&
      dia >= row.dataInicial &&
      (row.dataFinal == null || dia <= row.dataFinal),
  );
}

async function gerarToneladasColhedorasDiaria(dataInicio: string, dataFim: string) {
  const [entrada, tags, historicoColhedora] = await Promise.all([
    listarEntradaCanaMaquinaList({ dataInicio, dataFim }),
    loadEquipamentoTags(),
    loadHistoricoTipoColhedora(dataInicio, dataFim),
  ]);
  const porDia = new Map<string, number>();
  for (const row of entrada.dados) {
    const dia = diaUtcFromIso(row.dataColheita);
    if (!dia) continue;
    const codEquipamento = resolveCodPorEquipamentoTag(tags, row.maquina, row.dataColheita) ?? row.codEquipamento;
    if (!isColhedoraNoDia(historicoColhedora, codEquipamento, dia)) continue;
    porDia.set(dia, (porDia.get(dia) ?? 0) + (row.peso ?? 0));
  }
  const out: Array<{ data: string; toneladas: number }> = [];
  for (let cur = new Date(`${dataInicio}T12:00:00`), end = new Date(`${dataFim}T12:00:00`); cur <= end; cur = new Date(cur.getTime() + 86400000)) {
    const data = cur.toISOString().slice(0, 10);
    out.push({ data, toneladas: money(porDia.get(data) ?? 0) });
  }
  return out;
}

type HistRow = {
  dia: string;
  codEquipamento: number;
  descricao: string;
  tipoTroca: "R" | "T" | "O";
  litros: number;
  motivoCodigo: string;
  motivoLabel: string;
  codMaterial: number | null;
  material: string;
};

async function loadHistorico(dataInicio: string, dataFim: string): Promise<HistRow[]> {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT TO_CHAR(TRUNC(h.dt_lubrificacao), 'YYYY-MM-DD') AS dia,
              h.cod_equipamento,
              e.descricao AS equip_desc,
              h.tipo_troca,
              NVL(h.qtde_lubrificante, 0) AS litros,
              h.cod_material,
              m.descricao AS material_desc,
              NVL(TO_CHAR(causa.cod_oscausa), h.tipo_troca) AS motivo_cod,
              NVL(causa.descricao,
                  CASE h.tipo_troca
                    WHEN 'R' THEN 'REMONTA'
                    WHEN 'T' THEN 'TROCA'
                    ELSE 'OUTROS'
                  END) AS motivo_desc
         FROM automotivo.histlubrificacao h
         JOIN automotivo.equipamento e
           ON e.cod_equipamento = h.cod_equipamento
         JOIN automotivo.historico_tipoequipamento ht
           ON ht.cod_equipamento = h.cod_equipamento
          AND ht.data_fim IS NULL
          AND ht.cod_tipoequipamento = ${TIPO_COLHEDORA}
         JOIN material.material m
           ON m.cod_material = h.cod_material
         LEFT JOIN LATERAL (
           SELECT oc.cod_oscausa, oc.descricao
             FROM material.requisicaomaterial req
             JOIN automotivo.itens_osdefeitos d
               ON d.ano_ordemservico = req.ano_ordem_servico
              AND d.numero_ordemservico = req.numero_ordem_servico
             JOIN automotivo.oscausa oc
               ON oc.cod_oscausa = d.cod_oscausa
            WHERE req.nrrequisicao = h.nrrequisicao
              AND d.cod_oscausa IS NOT NULL
            FETCH FIRST 1 ROW ONLY
         ) causa ON 1 = 1
        WHERE h.dt_lubrificacao IS NOT NULL
          AND TRUNC(h.dt_lubrificacao) BETWEEN TO_DATE(:dataInicio, 'YYYY-MM-DD') AND TO_DATE(:dataFim, 'YYYY-MM-DD')
          AND UPPER(TRANSLATE(NVL(m.descricao, ' '),
                'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
                'AAAAAEEEEIIIIOOOOOUUUUCAAAAAEEEEIIIIOOOOOUUUUC')) LIKE '%OLEO%'
          AND UPPER(TRANSLATE(NVL(m.descricao, ' '),
                'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
                'AAAAAEEEEIIIIOOOOOUUUUCAAAAAEEEEIIIIOOOOOUUUUC')) LIKE '%HIDRAUL%'
          AND UPPER(TRANSLATE(NVL(m.descricao, ' '),
                'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
                'AAAAAEEEEIIIIOOOOOUUUUCAAAAAEEEEIIIIOOOOOUUUUC')) NOT LIKE '%FILTRO%'
        ORDER BY h.cod_equipamento, h.dt_lubrificacao`,
      { dataInicio, dataFim },
    );

    const out: HistRow[] = [];
    for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
      const dia = oracleText(raw, "dia", "DIA");
      const cod = oracleNumber(raw, "cod_equipamento", "COD_EQUIPAMENTO");
      if (!dia || cod == null) continue;
      const descMat = oracleText(raw, "material_desc", "MATERIAL_DESC");
      if (!isOleoHidraulico(descMat)) continue;
      const tipoRaw = (oracleText(raw, "tipo_troca", "TIPO_TROCA") ?? "O").trim().toUpperCase();
      const tipoTroca: HistRow["tipoTroca"] = tipoRaw === "R" || tipoRaw === "T" ? tipoRaw : "O";
      const motivoCodRaw = oracleText(raw, "motivo_cod", "MOTIVO_COD") ?? tipoTroca;
      const motivoDesc =
        oracleText(raw, "motivo_desc", "MOTIVO_DESC") ??
        (tipoTroca === "R" ? "REMONTA" : tipoTroca === "T" ? "TROCA" : "OUTROS");
      const motivoNum = /^\d+$/.test(motivoCodRaw) ? String(Number(motivoCodRaw)).padStart(2, "0") : null;
      out.push({
        dia,
        codEquipamento: cod,
        descricao: oracleText(raw, "equip_desc", "EQUIP_DESC") ?? `Equipamento ${cod}`,
        tipoTroca,
        litros: money(oracleNumber(raw, "litros", "LITROS") ?? 0),
        motivoCodigo: motivoNum ?? motivoCodRaw,
        motivoLabel: motivoNum ? `${motivoNum} - ${motivoDesc}` : motivoDesc,
        codMaterial: oracleNumber(raw, "cod_material", "COD_MATERIAL"),
        material: descMat ?? "Óleo hidráulico",
      });
    }
    return out;
  });
}

function somarToneladas(dias: Array<{ data: string; toneladas: number }>, ini: string, fim: string) {
  let total = 0;
  for (const row of dias) {
    if (inPeriodo(row.data, ini, fim)) total += row.toneladas;
  }
  return money(total);
}

async function toneladasColhedoraDesempenho(dataInicio: string, dataFim: string) {
  const desempenho = await gerarIndicadoresColheitaProducao({ dataInicio, dataFim, refDate: dataFim });
  const total = desempenho.tabelas.colhedora.totais?.toneladaColhida;
  if (total != null && Number.isFinite(total)) return money(total);
  return money(desempenho.tabelas.colhedora.linhas.reduce((acc, row) => acc + (row.toneladaColhida ?? 0), 0));
}

function monthEndIso(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
}

function monthStartIso(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);
}

function monthRanges(dataInicio: string, dataFim: string) {
  const [iniY, iniM] = dataInicio.split("-").map(Number);
  const [fimY, fimM] = dataFim.split("-").map(Number);
  const ranges: Array<{ dataInicio: string; dataFim: string }> = [];
  for (let y = iniY, m = iniM - 1; y < fimY || (y === fimY && m <= fimM - 1); m += 1) {
    if (m > 11) {
      m = 0;
      y += 1;
    }
    const ini = monthStartIso(y, m);
    const fim = monthEndIso(y, m);
    ranges.push({
      dataInicio: ini < dataInicio ? dataInicio : ini,
      dataFim: fim > dataFim ? dataFim : fim,
    });
  }
  return ranges;
}

function fullSafraRange(startYear: number) {
  return {
    dataInicio: `${startYear}-09-01`,
    dataFim: `${startYear + 1}-08-31`,
  };
}

async function toneladasColhedoraDesempenhoMensal(dataInicio: string, dataFim: string) {
  const ranges = monthRanges(dataInicio, dataFim);
  return Promise.all(
    ranges.map(async (range) => ({
      data: range.dataFim,
      toneladas: await toneladasColhedoraDesempenho(range.dataInicio, range.dataFim),
    })),
  );
}

function montarEquipamentos(rows: HistRow[]): ConsumoOleoEquipamento[] {
  const map = new Map<number, ConsumoOleoEquipamento>();
  for (const row of rows) {
    const acc =
      map.get(row.codEquipamento) ??
      ({
        codEquipamento: row.codEquipamento,
        descricao: row.descricao,
        troca: 0,
        remonta: 0,
        total: 0,
        qtdRemontas: 0,
        qtdTrocas: 0,
        codMaterial: row.codMaterial,
        material: row.material,
      } satisfies ConsumoOleoEquipamento);
    if (row.tipoTroca === "T") {
      acc.troca = money(acc.troca + row.litros);
      acc.qtdTrocas += 1;
    } else {
      acc.remonta = money(acc.remonta + row.litros);
      acc.qtdRemontas += 1;
    }
    acc.total = money(acc.troca + acc.remonta);
    if (!acc.codMaterial && row.codMaterial != null) acc.codMaterial = row.codMaterial;
    if (row.material) acc.material = row.material;
    acc.descricao = row.descricao;
    map.set(row.codEquipamento, acc);
  }
  return [...map.values()].sort((a, b) => a.codEquipamento - b.codEquipamento);
}

function montarMotivos(rows: HistRow[]): ConsumoOleoMotivo[] {
  const map = new Map<string, ConsumoOleoMotivo>();
  for (const row of rows) {
    const acc =
      map.get(row.motivoLabel) ??
      ({
        codigo: row.motivoCodigo,
        label: row.motivoLabel,
        litros: 0,
        qtdRemontas: 0,
      } satisfies ConsumoOleoMotivo);
    acc.litros = money(acc.litros + row.litros);
    if (row.tipoTroca === "R") acc.qtdRemontas += 1;
    map.set(row.motivoLabel, acc);
  }
  return [...map.values()].sort((a, b) => b.litros - a.litros);
}

function montarMensal(rows: HistRow[], tonsPorDia: Map<string, number>, ini: string, fim: string): ConsumoOleoMes[] {
  const map = new Map<string, ConsumoOleoMes>();
  for (const row of rows) {
    if (!inPeriodo(row.dia, ini, fim)) continue;
    const chave = row.dia.slice(0, 7);
    const acc =
      map.get(chave) ??
      ({ chave, label: mesLabel(chave), litros: 0, toneladas: 0, ltTon: null } satisfies ConsumoOleoMes);
    acc.litros = money(acc.litros + row.litros);
    map.set(chave, acc);
  }
  for (const [dia, ton] of tonsPorDia) {
    if (!inPeriodo(dia, ini, fim)) continue;
    const chave = dia.slice(0, 7);
    const acc =
      map.get(chave) ??
      ({ chave, label: mesLabel(chave), litros: 0, toneladas: 0, ltTon: null } satisfies ConsumoOleoMes);
    acc.toneladas = money(acc.toneladas + ton);
    map.set(chave, acc);
  }
  return [...map.values()]
    .sort((a, b) => a.chave.localeCompare(b.chave))
    .map((row) => ({ ...row, ltTon: oleoLtTon(row.litros, row.toneladas) }));
}

export async function gerarConsumoOleoHidraulico(filtros: {
  dataInicio?: string | null;
  dataFim?: string | null;
  safraCode?: string | null;
}): Promise<ConsumoOleoHidraulicoData> {
  const rawInicio = filtros.dataInicio?.trim();
  const rawFim = filtros.dataFim?.trim();
  if (!rawInicio || !rawFim) {
    throw Object.assign(new Error("Informe o período."), { status: 400 });
  }
  const periodo = normalizePeriodoColheita(rawInicio, rawFim);
  const dataInicio = periodo.dataInicio ?? rawInicio;
  const dataFim = periodo.dataFim ?? rawFim;
  const currentSafraStart = safraStartYearFromCode(filtros.safraCode) ?? Number(safraCodeFromIso(dataInicio).slice(0, 2)) + 2000;
  const janelas = [
    { offset: 0, dataInicio, dataFim },
    { offset: 1, ...fullSafraRange(currentSafraStart - 1) },
    { offset: 2, ...fullSafraRange(currentSafraStart - 2) },
  ];
  const spanIni = janelas[janelas.length - 1]!.dataInicio;
  const spanFim = dataFim;

  const [hist, tonsMensais, tonsSafras] = await Promise.all([
    loadHistorico(spanIni, spanFim),
    toneladasColhedoraDesempenhoMensal(dataInicio, dataFim),
    Promise.all(janelas.map((janela) => toneladasColhedoraDesempenho(janela.dataInicio, janela.dataFim))),
  ]);

  const tonsPorDia = new Map<string, number>();
  for (const row of tonsMensais) tonsPorDia.set(row.data, row.toneladas);

  const atualRows = hist.filter((row) => inPeriodo(row.dia, dataInicio, dataFim));
  const equipamentos = montarEquipamentos(atualRows);
  const litrosTroca = money(equipamentos.reduce((a, r) => a + r.troca, 0));
  const litrosRemonta = money(equipamentos.reduce((a, r) => a + r.remonta, 0));
  const litrosTotal = money(litrosTroca + litrosRemonta);
  const qtdRemontas = equipamentos.reduce((a, r) => a + r.qtdRemontas, 0);
  const toneladas = money(tonsSafras[0] ?? 0);

  const equipamentosCodigos = [
    ...new Set(hist.map((row) => row.codEquipamento)),
  ].sort((a, b) => a - b);

  const safras: ConsumoOleoSafra[] = janelas.map((janela) => {
    const rows = hist.filter((row) => inPeriodo(row.dia, janela.dataInicio, janela.dataFim) && row.tipoTroca === "R");
    const litros = money(rows.reduce((a, r) => a + r.litros, 0));
    const tons = money(tonsSafras[janela.offset] ?? 0);
    const codigo = filtros.safraCode && janela.offset === 0 ? filtros.safraCode : safraCodeFromIso(janela.dataInicio);
    const porEquip = new Map<number, number>();
    for (const row of rows) {
      porEquip.set(row.codEquipamento, money((porEquip.get(row.codEquipamento) ?? 0) + row.litros));
    }
    return {
      codigo,
      label: `Safra ${codigo}`,
      dataInicio: janela.dataInicio,
      dataFim: janela.dataFim,
      dias: diasInclusive(janela.dataInicio, janela.dataFim),
      litros,
      toneladas: tons,
      ltTon: oleoLtTon(litros, tons),
      porEquipamento: equipamentosCodigos.map((cod) => ({
        codEquipamento: cod,
        litros: porEquip.get(cod) ?? 0,
      })),
    };
  });

  return {
    filtros: {
      dataInicio,
      dataFim,
      safraCode: filtros.safraCode?.trim() || null,
      dias: diasInclusive(dataInicio, dataFim),
      metaLtTon: META_OLEO_HIDRAULICO_LT_TON,
    },
    resumo: {
      litrosRemonta,
      litrosTroca,
      litrosTotal,
      qtdRemontas,
      ltTon: oleoLtTon(litrosTotal, toneladas),
      toneladas,
    },
    motivos: montarMotivos(atualRows),
    equipamentos,
    mensal: montarMensal(atualRows, tonsPorDia, dataInicio, dataFim),
    comparativo: {
      equipamentos: equipamentosCodigos,
      safras: [...safras].reverse(),
    },
  };
}
