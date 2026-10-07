import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { oracleDate, oracleNumber, oracleText, withOracle } from "../oracle.js";
import { resolveOracleCodSafra } from "../colheita/oracle-safra.js";

type GeoRing = number[][];
type GeoCoords = GeoRing | GeoRing[];

export type MapaFazendasAreaStatus = "sem" | "parcial" | "concluido" | "acima" | "renovacao";

export type MapaFazendasEntomoIndice = "broca_comum" | "broca_gigante";

export type MapaFazendasEntomoFaixa = "verde" | "amarelo" | "vermelho" | "sem";

export type MapaFazendasEntomologico = {
  qtdeEntrenosBroca: number;
  entreNosAnalisados: number;
  canasBrocadas: number;
  indiceBrocaComum: number | null;
  canasBGigante: number;
  numeroCana: number;
  indiceBrocaGigante: number | null;
  faixaBrocaComum: MapaFazendasEntomoFaixa;
  faixaBrocaGigante: MapaFazendasEntomoFaixa;
  ultimaAnalise: string | null;
  qtdAnalises: number;
};

export type MapaFazendasOperacao = {
  codigo: string;
  descricao: string | null;
};

export type MapaFazendasAreaAplicada = {
  areaAplicada: number;
  pctAplicado: number | null;
  status: MapaFazendasAreaStatus;
  qtdApontamentos: number;
  ultimaAplicacao: string | null;
  operacao: string | null;
  operacaoDescricao: string | null;
};

export type MapaFazendasIrrigacao = {
  mmHa: number | null;
  areaIrrigada: number;
  laminaTotal: number;
  vazaoMedia: number | null;
  volumeTotal: number;
  qtdApontamentos: number;
  ultimaIrrigacao: string | null;
};

export type MapaFazendasInsumoMaterial = {
  descricao: string;
  quantidade: number;
  valor: number;
};

export type MapaFazendasInsumoResumo = {
  qtdAplicacoes: number;
  valorTotal: number;
  materiais: MapaFazendasInsumoMaterial[];
};

export type MapaFazendasFazendaResumo = {
  codFazenda: number;
  nome: string;
  areaHa: number;
  insumos: MapaFazendasInsumoResumo;
};

export type MapaFazendasData = {
  filtros: {
    safraCode: string | null;
    codSafra: number | null;
    dataInicio: string | null;
    dataFim: string | null;
    areasAplicadas: boolean;
    entomologico: boolean;
    irrigacao: boolean;
    entomologicoIndice: MapaFazendasEntomoIndice | null;
    operacao: string | null;
    operacaoDescricao: string | null;
  };
  resumo: {
    totalTalhoes: number;
    totalFazendas: number;
    totalAreaHa: number;
    areasAplicadas?: {
      concluido: number;
      parcial: number;
      acima: number;
      sem: number;
      renovacao: number;
    };
    entomologico?: Record<MapaFazendasEntomoIndice, Record<MapaFazendasEntomoFaixa, number>>;
    irrigacao?: {
      com: number;
      sem: number;
      mmHaMax: number;
      mmHaMedio: number | null;
    };
  };
  operacoes: MapaFazendasOperacao[];
  fazendas: MapaFazendasFazendaResumo[];
  geojson: {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      geometry: { type: string; coordinates: GeoCoords };
      properties: Record<string, unknown>;
    }>;
  };
};

type TalhaoOracle = {
  codFazenda: number;
  codTalhao: number;
  areaHa: number | null;
  variedade: string | null;
  tipoCana: string | null;
};

type InsumoTalhaoOracle = {
  codFazenda: number;
  codTalhao: number;
  qtdAplicacoes: number;
  valorTotal: number;
};

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const FAZENDAS_GEOJSON = path.resolve(ROOT, "../../public/data/Fazendas.json");

function geojsonPath() {
  const envPath = process.env.FAZENDAS_GEOJSON_PATH?.trim();
  if (envPath && fs.existsSync(envPath)) return envPath;
  return FAZENDAS_GEOJSON;
}

function ringAreaHa(ring: GeoRing) {
  if (ring.length < 3) return 0;
  const R = 6378137;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    const λ1 = (lon1 * Math.PI) / 180;
    const λ2 = (lon2 * Math.PI) / 180;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    total += (λ2 - λ1) * (2 + Math.sin(φ1) + Math.sin(φ2));
  }
  return Math.abs((total * R * R) / 2) / 10000;
}

function geometryAreaHa(geometry: { type: string; coordinates: GeoCoords }) {
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as GeoRing[];
    const outer = ringAreaHa(rings[0] ?? []);
    const holes = rings.slice(1).reduce((acc, ring) => acc + ringAreaHa(ring), 0);
    return Math.max(0, outer - holes);
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as GeoRing[][]).reduce((acc, poly) => {
      const outer = ringAreaHa(poly[0] ?? []);
      const holes = poly.slice(1).reduce((hAcc, ring) => hAcc + ringAreaHa(ring), 0);
      return acc + Math.max(0, outer - holes);
    }, 0);
  }
  return 0;
}

function talhaoKey(codFazenda: number | null | undefined, codTalhao: number | null | undefined) {
  if (codFazenda == null || codTalhao == null) return null;
  return `${codFazenda}:${codTalhao}`;
}

const AREA_STATUS_TOL_HA = 0.5;

export function calcularStatusAreaAplicada(
  areaAplicada: number,
  areaTalhao: number,
  operacao: string | null = null,
  operacaoDescricao: string | null = null,
): MapaFazendasAreaStatus {
  const text = `${operacao ?? ""} ${operacaoDescricao ?? ""}`.toUpperCase();
  if (/RENOV/.test(text)) return "renovacao";
  if (areaAplicada <= 0 || !Number.isFinite(areaAplicada)) return "sem";
  if (areaTalhao <= 0 || !Number.isFinite(areaTalhao)) return areaAplicada > 0 ? "acima" : "sem";
  if (areaAplicada > areaTalhao + AREA_STATUS_TOL_HA) return "acima";
  if (areaAplicada >= areaTalhao - AREA_STATUS_TOL_HA) return "concluido";
  return "parcial";
}

export function calcularIndiceBrocaComum(entrenosBrocados: number, entrenosAnalisados: number): number | null {
  if (!Number.isFinite(entrenosAnalisados) || entrenosAnalisados <= 0) return null;
  // Relatório 9138: Índice Entre-nós Brocados = Entre-nós Brocados / Entre-nós Analisados.
  // As faixas 2,50 / 5,00 do mapa são o limiar de intensidade (entre-nós), não o de incidência (cana).
  return entrenosBrocados / entrenosAnalisados;
}

export function calcularIndiceBrocaGigante(canasBGigante: number, numeroCana: number): number | null {
  if (!Number.isFinite(numeroCana) || numeroCana <= 0) return null;
  return canasBGigante / numeroCana;
}

export function calcularFaixaEntomologica(
  indice: number | null,
  tipo: MapaFazendasEntomoIndice,
): MapaFazendasEntomoFaixa {
  if (indice == null || !Number.isFinite(indice)) return "sem";
  if (tipo === "broca_comum") {
    if (indice <= 0.025) return "verde";
    if (indice < 0.05) return "amarelo";
    return "vermelho";
  }
  if (indice <= 0.01) return "verde";
  if (indice < 0.025) return "amarelo";
  return "vermelho";
}

function montarEntomologicoTalhao(row: {
  qtdeEntrenosBroca: number;
  entreNosAnalisados: number;
  canasBrocadas: number;
  canasBGigante: number;
  numeroCana: number;
  ultimaAnalise: string | null;
  qtdAnalises: number;
}): MapaFazendasEntomologico {
  const indiceBrocaComum = calcularIndiceBrocaComum(row.qtdeEntrenosBroca, row.entreNosAnalisados);
  const indiceBrocaGigante = calcularIndiceBrocaGigante(row.canasBGigante, row.numeroCana);
  return {
    qtdeEntrenosBroca: row.qtdeEntrenosBroca,
    entreNosAnalisados: row.entreNosAnalisados,
    canasBrocadas: row.canasBrocadas,
    indiceBrocaComum,
    canasBGigante: row.canasBGigante,
    numeroCana: row.numeroCana,
    indiceBrocaGigante,
    faixaBrocaComum: calcularFaixaEntomologica(indiceBrocaComum, "broca_comum"),
    faixaBrocaGigante: calcularFaixaEntomologica(indiceBrocaGigante, "broca_gigante"),
    ultimaAnalise: row.ultimaAnalise,
    qtdAnalises: row.qtdAnalises,
  };
}

type EntomologicoOracle = {
  codFazenda: number;
  codTalhao: number;
  qtdeEntrenosBroca: number;
  entreNosAnalisados: number;
  canasBrocadas: number;
  canasBGigante: number;
  numeroCana: number;
  ultimaAnalise: string | null;
  qtdAnalises: number;
};

async function carregarEntomologicoOracle(
  dataInicio: string | null,
  dataFim: string | null,
  _codSafra: number | null,
) {
  return withOracle(async (conn) => {
    // O período da tela é o recorte que o usuário pediu. Não misturar com
    // ae.cod_safra: análises da mesma safra agrícola muitas vezes estão
    // gravadas com outro código (ou nulo) e o mapa inteiro caía em "sem análise".
    const periodSql =
      dataInicio && dataFim
        ? `AND ae.data_analise >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
           AND ae.data_analise < TO_DATE(:dataFim, 'YYYY-MM-DD') + 1`
        : "";

    const binds: Record<string, string | number> = {};
    if (dataInicio && dataFim) {
      binds.dataInicio = dataInicio;
      binds.dataFim = dataFim;
    }

    const result = await conn.execute(
      `SELECT ae.cod_fazenda,
              ae.cod_talhao,
              SUM(NVL(NULLIF(ae.entre_nos_brocados, 0), NVL(item.qtde_entrenos_broca, 0))) AS qtde_entrenos_broca,
              SUM(NVL(NULLIF(ae.entre_nos_analisados, 0), NVL(item.total_entre_nos, 0))) AS entre_nos_analisados,
              SUM(NVL(NULLIF(ae.canas_brocada, 0), NVL(item.canas_brocadas, 0))) AS canas_brocadas,
              SUM(NVL(NULLIF(ae.canas_b_gigante, 0), NVL(item.canas_b_gigante, 0))) AS canas_b_gigante,
              SUM(NVL(NULLIF(ae.canas_analisadas, 0), NVL(item.numero_cana, 0))) AS numero_cana,
              COUNT(CASE
                      WHEN NVL(NULLIF(ae.canas_analisadas, 0), NVL(item.numero_cana, 0)) > 0
                        OR NVL(NULLIF(ae.entre_nos_analisados, 0), NVL(item.total_entre_nos, 0)) > 0
                      THEN 1
                    END) AS qtd_analises,
              MAX(CASE
                    WHEN NVL(NULLIF(ae.canas_analisadas, 0), NVL(item.numero_cana, 0)) > 0
                      OR NVL(NULLIF(ae.entre_nos_analisados, 0), NVL(item.total_entre_nos, 0)) > 0
                    THEN ae.data_analise
                  END) AS ultima_analise
         FROM agricola.analise_entomologico ae
         LEFT JOIN (
           SELECT ie.numero_analise,
                  ie.data_analise,
                  ie.cod_grupoempresa,
                  ie.cod_empresa,
                  ie.cod_filial,
                  SUM(NVL(ie.qtde_entrenos_broca, 0)) AS qtde_entrenos_broca,
                  SUM(NVL(ie.total_entre_nos, 0)) AS total_entre_nos,
                  SUM(NVL(ie.qtde_canas_brocada, 0)) AS canas_brocadas,
                  SUM(NVL(ie.canas_b_gigante, 0)) AS canas_b_gigante,
                  MAX(NVL(ie.numero_cana, 0)) AS numero_cana
             FROM agricola.itens_entomologico ie
            WHERE ie.tipo_infestacao = 1
            GROUP BY ie.numero_analise,
                     ie.data_analise,
                     ie.cod_grupoempresa,
                     ie.cod_empresa,
                     ie.cod_filial
         ) item
           ON item.numero_analise = ae.numero_analise
          AND item.data_analise = ae.data_analise
          AND item.cod_grupoempresa = ae.cod_grupoempresa
          AND item.cod_empresa = ae.cod_empresa
          AND item.cod_filial = ae.cod_filial
        WHERE ae.cod_fazenda IS NOT NULL
          AND ae.cod_talhao IS NOT NULL
          ${periodSql}
        GROUP BY ae.cod_fazenda, ae.cod_talhao`,
      binds,
    );

    const porTalhao = new Map<string, EntomologicoOracle>();
    for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
      const codFazenda = oracleNumber(raw, "cod_fazenda", "COD_FAZENDA");
      const codTalhao = oracleNumber(raw, "cod_talhao", "COD_TALHAO");
      const key = talhaoKey(codFazenda, codTalhao);
      if (!key || codFazenda == null || codTalhao == null) continue;
      porTalhao.set(key, {
        codFazenda,
        codTalhao,
        qtdeEntrenosBroca: oracleNumber(raw, "qtde_entrenos_broca", "QTDE_ENTRENOS_BROCA") ?? 0,
        entreNosAnalisados: oracleNumber(raw, "entre_nos_analisados", "ENTRE_NOS_ANALISADOS") ?? 0,
        canasBrocadas: oracleNumber(raw, "canas_brocadas", "CANAS_BROCADAS") ?? 0,
        canasBGigante: oracleNumber(raw, "canas_b_gigante", "CANAS_B_GIGANTE") ?? 0,
        numeroCana: oracleNumber(raw, "numero_cana", "NUMERO_CANA") ?? 0,
        ultimaAnalise: oracleDate(raw, "ultima_analise", "ULTIMA_ANALISE"),
        qtdAnalises: oracleNumber(raw, "qtd_analises", "QTD_ANALISES") ?? 0,
      });
    }

    return porTalhao;
  });
}

type AreaAplicadaOracle = {
  codFazenda: number;
  codTalhao: number;
  areaAplicada: number;
  qtdApontamentos: number;
  ultimaAplicacao: string | null;
  operacao: string | null;
  operacaoDescricao: string | null;
};

async function carregarAreasAplicadasOracle(
  dataInicio: string | null,
  dataFim: string | null,
  operacao: string | null,
  operacaoDescricao: string | null,
) {
  return withOracle(async (conn) => {
    const periodSql =
      dataInicio && dataFim
        ? `AND TRUNC(b.data_apontamento) >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
           AND TRUNC(b.data_apontamento) <= TO_DATE(:dataFim, 'YYYY-MM-DD')`
        : "";
    const operacaoSql = operacao ? `AND a.tipo_operacao || a.cod_operacao = :operacao` : "";
    const operacaoDescSql = operacaoDescricao
      ? `AND UPPER(TRIM(op.descricao)) = UPPER(TRIM(:operacaoDescricao))`
      : "";

    const periodBinds: Record<string, string> = {};
    if (dataInicio && dataFim) {
      periodBinds.dataInicio = dataInicio;
      periodBinds.dataFim = dataFim;
    }
    const areaBinds: Record<string, string> = { ...periodBinds };
    if (operacao) areaBinds.operacao = operacao;
    if (operacaoDescricao) areaBinds.operacaoDescricao = operacaoDescricao;

    const result = await conn.execute(
      `SELECT a.cod_fazenda,
              a.cod_talhao,
              MAX(a.tipo_operacao || a.cod_operacao) AS operacao,
              MAX(op.descricao) AS operacao_descricao,
              MAX(NVL(a.area, 0)) AS area_aplicada,
              COUNT(DISTINCT a.ano_apontamento || '-' || a.nr_apontamento) AS qtd_apontamentos,
              MAX(b.data_apontamento) AS ultima_aplicacao
         FROM agricola.apontamentoitem a
         LEFT JOIN agricola.apontamento b
           ON a.ano_apontamento = b.ano_apontamento
          AND a.nr_apontamento = b.nr_apontamento
         LEFT JOIN agricola.apontamentomaterial c
           ON a.ano_apontamento = c.ano_apontamento
          AND a.nr_apontamento = c.nr_apontamento
          AND a.item_apontamento = c.item_apontamento
         LEFT JOIN rh.operacaoagricola op
           ON a.cod_operacao = op.cod_operacaoagricola
        WHERE a.cod_fazenda IS NOT NULL
          AND a.cod_talhao IS NOT NULL
          AND NVL(a.area, 0) > 0
          ${periodSql}
          ${operacaoSql}
          ${operacaoDescSql}
        GROUP BY a.cod_fazenda, a.cod_talhao`,
      areaBinds,
    );

    const operacoesResult = await conn.execute(
      `SELECT a.tipo_operacao || a.cod_operacao AS codigo,
              MAX(op.descricao) AS descricao
         FROM agricola.apontamentoitem a
         LEFT JOIN agricola.apontamento b
           ON a.ano_apontamento = b.ano_apontamento
          AND a.nr_apontamento = b.nr_apontamento
         LEFT JOIN rh.operacaoagricola op
           ON a.cod_operacao = op.cod_operacaoagricola
        WHERE a.cod_fazenda IS NOT NULL
          AND a.cod_talhao IS NOT NULL
          AND a.tipo_operacao IS NOT NULL
          AND a.cod_operacao IS NOT NULL
          ${periodSql}
        GROUP BY a.tipo_operacao || a.cod_operacao
        ORDER BY MAX(op.descricao) NULLS LAST, 1`,
      periodBinds,
    );

    const porTalhao = new Map<string, AreaAplicadaOracle>();
    for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
      const codFazenda = oracleNumber(raw, "cod_fazenda", "COD_FAZENDA");
      const codTalhao = oracleNumber(raw, "cod_talhao", "COD_TALHAO");
      const key = talhaoKey(codFazenda, codTalhao);
      if (!key || codFazenda == null || codTalhao == null) continue;
      porTalhao.set(key, {
        codFazenda,
        codTalhao,
        areaAplicada: oracleNumber(raw, "area_aplicada", "AREA_APLICADA") ?? 0,
        qtdApontamentos: oracleNumber(raw, "qtd_apontamentos", "QTD_APONTAMENTOS") ?? 0,
        ultimaAplicacao: oracleDate(raw, "ultima_aplicacao", "ULTIMA_APLICACAO"),
        operacao: oracleText(raw, "operacao", "OPERACAO") || operacao,
        operacaoDescricao: oracleText(raw, "operacao_descricao", "OPERACAO_DESCRICAO") || operacaoDescricao,
      });
    }

    const operacoes = ((operacoesResult.rows ?? []) as Record<string, unknown>[])
      .map((row) => ({
        codigo: oracleText(row, "codigo", "CODIGO") || "",
        descricao: oracleText(row, "descricao", "DESCRICAO") || null,
      }))
      .filter((row) => row.codigo);

    return { porTalhao, operacoes };
  });
}

type IrrigacaoOracle = {
  codFazenda: number;
  codTalhao: number;
  volumeTotal: number;
  areaIrrigada: number;
  laminaTotal: number;
  mmHa: number | null;
  vazaoMedia: number | null;
  qtdApontamentos: number;
  ultimaIrrigacao: string | null;
};

async function carregarIrrigacaoOracle(dataInicio: string | null, dataFim: string | null) {
  return withOracle(async (conn) => {
    const periodSql =
      dataInicio && dataFim
        ? `AND TRUNC(v.data) >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
           AND TRUNC(v.data) <= TO_DATE(:dataFim, 'YYYY-MM-DD')`
        : "";

    const binds: Record<string, string> = {};
    if (dataInicio && dataFim) {
      binds.dataInicio = dataInicio;
      binds.dataFim = dataFim;
    }

    const result = await conn.execute(
      `SELECT v.cod_fazenda,
              v.cod_talhao,
              SUM(NVL(v.mt_cubicos, 0) * NVL(v.area, 0)) AS volume_total,
              SUM(NVL(v.area, 0)) AS area_irrigada,
              SUM(NVL(v.lamina_aplicada, 0)) AS lamina_total,
              CASE
                WHEN SUM(NVL(v.area, 0)) > 0
                THEN SUM(NVL(v.mt_cubicos, 0) * NVL(v.area, 0)) / SUM(NVL(v.area, 0)) / 10
                ELSE NULL
              END AS mm_ha,
              CASE
                WHEN SUM(NVL(v.area, 0)) > 0
                THEN SUM(NVL(v.vazao, 0) * NVL(v.area, 0)) / SUM(NVL(v.area, 0))
                ELSE AVG(NULLIF(v.vazao, 0))
              END AS vazao_media,
              COUNT(*) AS qtd_apontamentos,
              MAX(v.data) AS ultima_irrigacao
         FROM agricola.vw_apontamentoirrigacao v
        WHERE v.cod_fazenda IS NOT NULL
          AND v.cod_talhao IS NOT NULL
          ${periodSql}
        GROUP BY v.cod_fazenda, v.cod_talhao`,
      binds,
    );

    const porTalhao = new Map<string, IrrigacaoOracle>();
    for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
      const codFazenda = oracleNumber(raw, "cod_fazenda", "COD_FAZENDA");
      const codTalhao = oracleNumber(raw, "cod_talhao", "COD_TALHAO");
      const key = talhaoKey(codFazenda, codTalhao);
      if (!key || codFazenda == null || codTalhao == null) continue;
      porTalhao.set(key, {
        codFazenda,
        codTalhao,
        volumeTotal: oracleNumber(raw, "volume_total", "VOLUME_TOTAL") ?? 0,
        areaIrrigada: oracleNumber(raw, "area_irrigada", "AREA_IRRIGADA") ?? 0,
        laminaTotal: oracleNumber(raw, "lamina_total", "LAMINA_TOTAL") ?? 0,
        mmHa: oracleNumber(raw, "mm_ha", "MM_HA"),
        vazaoMedia: oracleNumber(raw, "vazao_media", "VAZAO_MEDIA"),
        qtdApontamentos: oracleNumber(raw, "qtd_apontamentos", "QTD_APONTAMENTOS") ?? 0,
        ultimaIrrigacao: oracleDate(raw, "ultima_irrigacao", "ULTIMA_IRRIGACAO"),
      });
    }

    return porTalhao;
  });
}

async function carregarTalhoesOracle(codSafra: number) {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT t.cod_fazenda,
              t.cod_talhao,
              NVL(t.areaproducao, t.areaplantada) AS area_ha,
              v.descricao AS variedade,
              tc.descricao AS tipo_cana
         FROM agricola.talhao t
         LEFT JOIN agricola.variedade v
           ON v.cod_variedade = t.cod_variedade
         LEFT JOIN (
           SELECT lc.cod_fazenda,
                  lc.cod_talhao,
                  lc.cod_tipocolheita,
                  ROW_NUMBER() OVER (
                    PARTITION BY lc.cod_fazenda, lc.cod_talhao
                    ORDER BY lc.data_liberacao DESC NULLS LAST, lc.numero_liberacao DESC
                  ) AS rn
             FROM agricola.liberacao_corte lc
            WHERE lc.cod_safra = :codSafra
         ) lc
           ON lc.cod_fazenda = t.cod_fazenda
          AND lc.cod_talhao = t.cod_talhao
          AND lc.rn = 1
         LEFT JOIN agricola.tipocana tc
           ON tc.cod_tipocana = lc.cod_tipocolheita
        WHERE t.cod_safra = :codSafra`,
      { codSafra },
    );

    const map = new Map<string, TalhaoOracle>();
    for (const raw of (result.rows ?? []) as Record<string, unknown>[]) {
      const codFazenda = oracleNumber(raw, "cod_fazenda", "COD_FAZENDA");
      const codTalhao = oracleNumber(raw, "cod_talhao", "COD_TALHAO");
      const key = talhaoKey(codFazenda, codTalhao);
      if (!key || codFazenda == null || codTalhao == null) continue;
      map.set(key, {
        codFazenda,
        codTalhao,
        areaHa: oracleNumber(raw, "area_ha", "AREA_HA"),
        variedade: oracleText(raw, "variedade", "VARIEDADE") || null,
        tipoCana: oracleText(raw, "tipo_cana", "TIPO_CANA") || null,
      });
    }
    return map;
  });
}

async function carregarInsumosOracle(dataInicio: string | null, dataFim: string | null) {
  return withOracle(async (conn) => {
    const periodSql =
      dataInicio && dataFim
        ? `AND TRUNC(ap.data_apontamento) >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
           AND TRUNC(ap.data_apontamento) <= TO_DATE(:dataFim, 'YYYY-MM-DD')`
        : "";

    const binds: Record<string, string> = {};
    if (dataInicio && dataFim) {
      binds.dataInicio = dataInicio;
      binds.dataFim = dataFim;
    }

    const porFazenda = await conn.execute(
      `SELECT i.cod_fazenda,
              COUNT(DISTINCT ap.ano_apontamento || '-' || ap.nr_apontamento) AS qtd_aplicacoes,
              SUM(m.quantidade * NVL(req.vrcustounitario, 0)) AS valor_total
         FROM agricola.apontamentomaterial m
         INNER JOIN agricola.apontamentoitem i
           ON i.cod_grupoempresa = m.cod_grupoempresa
          AND i.cod_empresa = m.cod_empresa
          AND i.cod_filial = m.cod_filial
          AND i.ano_apontamento = m.ano_apontamento
          AND i.nr_apontamento = m.nr_apontamento
          AND i.item_apontamento = m.item_apontamento
         INNER JOIN agricola.apontamento ap
           ON ap.cod_grupoempresa = m.cod_grupoempresa
          AND ap.cod_empresa = m.cod_empresa
          AND ap.cod_filial = m.cod_filial
          AND ap.ano_apontamento = m.ano_apontamento
          AND ap.nr_apontamento = m.nr_apontamento
        LEFT JOIN material.itensrequisicaomaterial req
           ON req.nrrequisicao = m.nrrequisicao
          AND req.cod_material = m.cod_material
          AND req.item = m.item_requisicao
        WHERE i.cod_fazenda IS NOT NULL
          ${periodSql}
        GROUP BY i.cod_fazenda`,
      binds,
    );

    const materiais = await conn.execute(
      `SELECT i.cod_fazenda,
              NVL(mat.descricao, TO_CHAR(m.cod_material)) AS descricao,
              SUM(m.quantidade) AS quantidade,
              SUM(m.quantidade * NVL(req.vrcustounitario, 0)) AS valor
         FROM agricola.apontamentomaterial m
         INNER JOIN agricola.apontamentoitem i
           ON i.cod_grupoempresa = m.cod_grupoempresa
          AND i.cod_empresa = m.cod_empresa
          AND i.cod_filial = m.cod_filial
          AND i.ano_apontamento = m.ano_apontamento
          AND i.nr_apontamento = m.nr_apontamento
          AND i.item_apontamento = m.item_apontamento
         INNER JOIN agricola.apontamento ap
           ON ap.cod_grupoempresa = m.cod_grupoempresa
          AND ap.cod_empresa = m.cod_empresa
          AND ap.cod_filial = m.cod_filial
          AND ap.ano_apontamento = m.ano_apontamento
          AND ap.nr_apontamento = m.nr_apontamento
        LEFT JOIN material.itensrequisicaomaterial req
           ON req.nrrequisicao = m.nrrequisicao
          AND req.cod_material = m.cod_material
          AND req.item = m.item_requisicao
        LEFT JOIN material.material mat
           ON mat.cod_material = m.cod_material
        WHERE i.cod_fazenda IS NOT NULL
          ${periodSql}
        GROUP BY i.cod_fazenda, NVL(mat.descricao, TO_CHAR(m.cod_material))
        ORDER BY i.cod_fazenda, SUM(m.quantidade * NVL(req.vrcustounitario, 0)) DESC`,
      binds,
    );

    const porTalhao = await conn.execute(
      `SELECT i.cod_fazenda,
              i.cod_talhao,
              COUNT(DISTINCT ap.ano_apontamento || '-' || ap.nr_apontamento) AS qtd_aplicacoes,
              SUM(m.quantidade * NVL(req.vrcustounitario, 0)) AS valor_total
         FROM agricola.apontamentomaterial m
         INNER JOIN agricola.apontamentoitem i
           ON i.cod_grupoempresa = m.cod_grupoempresa
          AND i.cod_empresa = m.cod_empresa
          AND i.cod_filial = m.cod_filial
          AND i.ano_apontamento = m.ano_apontamento
          AND i.nr_apontamento = m.nr_apontamento
          AND i.item_apontamento = m.item_apontamento
         INNER JOIN agricola.apontamento ap
           ON ap.cod_grupoempresa = m.cod_grupoempresa
          AND ap.cod_empresa = m.cod_empresa
          AND ap.cod_filial = m.cod_filial
          AND ap.ano_apontamento = m.ano_apontamento
          AND ap.nr_apontamento = m.nr_apontamento
        LEFT JOIN material.itensrequisicaomaterial req
           ON req.nrrequisicao = m.nrrequisicao
          AND req.cod_material = m.cod_material
          AND req.item = m.item_requisicao
        WHERE i.cod_fazenda IS NOT NULL
          AND i.cod_talhao IS NOT NULL
          ${periodSql}
        GROUP BY i.cod_fazenda, i.cod_talhao`,
      binds,
    );

    const insumoPorFazenda = new Map<number, MapaFazendasInsumoResumo>();
    for (const raw of (porFazenda.rows ?? []) as Record<string, unknown>[]) {
      const codFazenda = oracleNumber(raw, "cod_fazenda", "COD_FAZENDA");
      if (codFazenda == null) continue;
      insumoPorFazenda.set(codFazenda, {
        qtdAplicacoes: oracleNumber(raw, "qtd_aplicacoes", "QTD_APLICACOES") ?? 0,
        valorTotal: oracleNumber(raw, "valor_total", "VALOR_TOTAL") ?? 0,
        materiais: [],
      });
    }

    for (const raw of (materiais.rows ?? []) as Record<string, unknown>[]) {
      const codFazenda = oracleNumber(raw, "cod_fazenda", "COD_FAZENDA");
      if (codFazenda == null) continue;
      const entry = insumoPorFazenda.get(codFazenda) ?? {
        qtdAplicacoes: 0,
        valorTotal: 0,
        materiais: [],
      };
      if (entry.materiais.length < 8) {
        entry.materiais.push({
          descricao: oracleText(raw, "descricao", "DESCRICAO") || "—",
          quantidade: oracleNumber(raw, "quantidade", "QUANTIDADE") ?? 0,
          valor: oracleNumber(raw, "valor", "VALOR") ?? 0,
        });
      }
      insumoPorFazenda.set(codFazenda, entry);
    }

    const insumoPorTalhao = new Map<string, InsumoTalhaoOracle>();
    for (const raw of (porTalhao.rows ?? []) as Record<string, unknown>[]) {
      const codFazenda = oracleNumber(raw, "cod_fazenda", "COD_FAZENDA");
      const codTalhao = oracleNumber(raw, "cod_talhao", "COD_TALHAO");
      const key = talhaoKey(codFazenda, codTalhao);
      if (!key || codFazenda == null || codTalhao == null) continue;
      insumoPorTalhao.set(key, {
        codFazenda,
        codTalhao,
        qtdAplicacoes: oracleNumber(raw, "qtd_aplicacoes", "QTD_APLICACOES") ?? 0,
        valorTotal: oracleNumber(raw, "valor_total", "VALOR_TOTAL") ?? 0,
      });
    }

    return { insumoPorFazenda, insumoPorTalhao };
  });
}

export async function gerarIndicadoresMapaFazendas(filtros: {
  safraCode?: string | null;
  dataInicio?: string | null;
  dataFim?: string | null;
  areasAplicadas?: boolean;
  entomologico?: boolean;
  irrigacao?: boolean;
  entomologicoIndice?: MapaFazendasEntomoIndice | null;
  operacao?: string | null;
  operacaoDescricao?: string | null;
}): Promise<MapaFazendasData> {
  const filePath = geojsonPath();
  if (!fs.existsSync(filePath)) {
    const err = new Error(`Arquivo GeoJSON não encontrado: ${filePath}`);
    (err as Error & { status?: number }).status = 404;
    throw err;
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as MapaFazendasData["geojson"];
  const safraCode = filtros.safraCode?.trim() || null;
  const dataInicio = filtros.dataInicio?.trim() || null;
  const dataFim = filtros.dataFim?.trim() || null;
  const areasAplicadas = Boolean(filtros.areasAplicadas);
  const entomologico = Boolean(filtros.entomologico);
  const irrigacao = Boolean(filtros.irrigacao);
  const entomologicoIndice: MapaFazendasEntomoIndice =
    filtros.entomologicoIndice === "broca_gigante" ? "broca_gigante" : "broca_comum";
  const operacao = filtros.operacao?.trim() || null;
  const operacaoDescricao = filtros.operacaoDescricao?.trim() || null;

  let talhoesOracle = new Map<string, TalhaoOracle>();
  let insumoPorFazenda = new Map<number, MapaFazendasInsumoResumo>();
  let insumoPorTalhao = new Map<string, InsumoTalhaoOracle>();
  let areasPorTalhao = new Map<string, AreaAplicadaOracle>();
  let entomoPorTalhao = new Map<string, EntomologicoOracle>();
  let irrigacaoPorTalhao = new Map<string, IrrigacaoOracle>();
  let operacoes: MapaFazendasOperacao[] = [];
  let codSafra: number | null = null;

  if (safraCode) {
    try {
      codSafra = await withOracle(async (conn) => resolveOracleCodSafra(conn, safraCode));
      if (codSafra != null) {
        talhoesOracle = await carregarTalhoesOracle(codSafra);
      }
    } catch {
      talhoesOracle = new Map();
    }
  }

  try {
    const insumos = await carregarInsumosOracle(dataInicio, dataFim);
    insumoPorFazenda = insumos.insumoPorFazenda;
    insumoPorTalhao = insumos.insumoPorTalhao;
  } catch {
    insumoPorFazenda = new Map();
    insumoPorTalhao = new Map();
  }

  if (areasAplicadas) {
    try {
      const areas = await carregarAreasAplicadasOracle(dataInicio, dataFim, operacao, operacaoDescricao);
      areasPorTalhao = areas.porTalhao;
      operacoes = areas.operacoes;
    } catch {
      areasPorTalhao = new Map();
      operacoes = [];
    }
  }

  if (entomologico) {
    entomoPorTalhao = await carregarEntomologicoOracle(dataInicio, dataFim, codSafra);
  }

  if (irrigacao) {
    try {
      irrigacaoPorTalhao = await carregarIrrigacaoOracle(dataInicio, dataFim);
    } catch {
      irrigacaoPorTalhao = new Map();
    }
  }

  const porFazendaAgg = new Map<
    number,
    { nome: string; areaHa: number; insumos: MapaFazendasInsumoResumo }
  >();

  const areaStatusCount = {
    concluido: 0,
    parcial: 0,
    acima: 0,
    sem: 0,
    renovacao: 0,
  };

  const entomoStatusCount: Record<MapaFazendasEntomoIndice, Record<MapaFazendasEntomoFaixa, number>> = {
    broca_comum: { verde: 0, amarelo: 0, vermelho: 0, sem: 0 },
    broca_gigante: { verde: 0, amarelo: 0, vermelho: 0, sem: 0 },
  };

  const irrigacaoStatusCount = { com: 0, sem: 0 };
  const mmHaValues: number[] = [];

  const features = raw.features.map((feature) => {
    const props = { ...(feature.properties ?? {}) } as Record<string, unknown>;
    const codFazendaRaw = props.Cod_fazend ?? props.cod_fazend ?? props.cod_fazenda;
    const loteRaw = props.Lote ?? props.lote ?? props.cod_talhao;
    const codFazenda = codFazendaRaw != null && codFazendaRaw !== "" ? Number(codFazendaRaw) : null;
    const codTalhao = loteRaw != null && loteRaw !== "" ? Number(loteRaw) : null;
    const nomeFazenda = String(props.Fazenda ?? props.fazenda ?? "").trim() || null;

    const areaMapaHa = geometryAreaHa(feature.geometry);
    const oracle = talhaoKey(codFazenda, codTalhao) ? talhoesOracle.get(talhaoKey(codFazenda, codTalhao)!) : null;
    const insumoTalhao = talhaoKey(codFazenda, codTalhao)
      ? insumoPorTalhao.get(talhaoKey(codFazenda, codTalhao)!)
      : null;
    const areaHa =
      oracle?.areaHa != null && oracle.areaHa > 0 ? oracle.areaHa : areaMapaHa;

    props.codFazenda = codFazenda;
    props.codTalhao = codTalhao;
    props.fazenda = nomeFazenda;
    props.lote = codTalhao;
    props.areaHa = areaHa != null ? Number(areaHa.toFixed(2)) : null;
    props.areaMapaHa = Number(areaMapaHa.toFixed(2));
    props.variedade = oracle?.variedade ?? null;
    props.tipoCana = oracle?.tipoCana ?? null;
    props.insumoTalhao = insumoTalhao
      ? {
          qtdAplicacoes: insumoTalhao.qtdAplicacoes,
          valorTotal: insumoTalhao.valorTotal,
        }
      : null;

    const areaAplicadaRow = talhaoKey(codFazenda, codTalhao)
      ? areasPorTalhao.get(talhaoKey(codFazenda, codTalhao)!)
      : null;
    const areaAplicada = areaAplicadaRow?.areaAplicada ?? 0;
    const pctAplicado =
      areaHa != null && areaHa > 0 ? Number(((areaAplicada / areaHa) * 100).toFixed(1)) : null;
    const statusArea = areasAplicadas
      ? calcularStatusAreaAplicada(
          areaAplicada,
          areaHa ?? 0,
          areaAplicadaRow?.operacao ?? operacao,
          areaAplicadaRow?.operacaoDescricao ?? operacaoDescricao,
        )
      : null;
    if (statusArea) areaStatusCount[statusArea] += 1;

    props.areaAplicada = areasAplicadas ? Number(areaAplicada.toFixed(2)) : null;
    props.pctAplicado = areasAplicadas ? pctAplicado : null;
    props.statusArea = statusArea;
    props.areaAplicadaInfo = areasAplicadas
      ? ({
          areaAplicada: Number(areaAplicada.toFixed(2)),
          pctAplicado,
          status: statusArea,
          qtdApontamentos: areaAplicadaRow?.qtdApontamentos ?? 0,
          ultimaAplicacao: areaAplicadaRow?.ultimaAplicacao ?? null,
          operacao: areaAplicadaRow?.operacao ?? operacao,
          operacaoDescricao: areaAplicadaRow?.operacaoDescricao ?? operacaoDescricao,
        } satisfies MapaFazendasAreaAplicada)
      : null;

    const entomoRow = talhaoKey(codFazenda, codTalhao)
      ? entomoPorTalhao.get(talhaoKey(codFazenda, codTalhao)!)
      : null;
    const entomologicoInfo = entomoRow ? montarEntomologicoTalhao(entomoRow) : null;
    const faixaEntomologica = entomologicoInfo
      ? entomologicoIndice === "broca_gigante"
        ? entomologicoInfo.faixaBrocaGigante
        : entomologicoInfo.faixaBrocaComum
      : entomologico
        ? "sem"
        : null;
    if (entomologico) {
      entomoStatusCount.broca_comum[entomologicoInfo?.faixaBrocaComum ?? "sem"] += 1;
      entomoStatusCount.broca_gigante[entomologicoInfo?.faixaBrocaGigante ?? "sem"] += 1;
    }
    props.entomologico = entomologicoInfo;
    props.faixaEntomologica = faixaEntomologica;
    props.entomologicoIndiceAtivo = entomologico ? entomologicoIndice : null;

    const irrigacaoRow = talhaoKey(codFazenda, codTalhao)
      ? irrigacaoPorTalhao.get(talhaoKey(codFazenda, codTalhao)!)
      : null;
    const irrigacaoInfo: MapaFazendasIrrigacao | null = irrigacao
      ? {
          mmHa: irrigacaoRow?.mmHa != null ? Number(irrigacaoRow.mmHa.toFixed(2)) : null,
          areaIrrigada: Number((irrigacaoRow?.areaIrrigada ?? 0).toFixed(2)),
          laminaTotal: Number((irrigacaoRow?.laminaTotal ?? 0).toFixed(2)),
          vazaoMedia: irrigacaoRow?.vazaoMedia != null ? Number(irrigacaoRow.vazaoMedia.toFixed(2)) : null,
          volumeTotal: Number((irrigacaoRow?.volumeTotal ?? 0).toFixed(2)),
          qtdApontamentos: irrigacaoRow?.qtdApontamentos ?? 0,
          ultimaIrrigacao: irrigacaoRow?.ultimaIrrigacao ?? null,
        }
      : null;
    props.irrigacao = irrigacaoInfo;
    if (irrigacao) {
      if (irrigacaoInfo && irrigacaoInfo.qtdApontamentos > 0) {
        irrigacaoStatusCount.com += 1;
        if (irrigacaoInfo.mmHa != null && irrigacaoInfo.mmHa > 0) mmHaValues.push(irrigacaoInfo.mmHa);
      } else {
        irrigacaoStatusCount.sem += 1;
      }
    }

    if (codFazenda != null) {
      const insumosFazenda = insumoPorFazenda.get(codFazenda) ?? {
        qtdAplicacoes: 0,
        valorTotal: 0,
        materiais: [],
      };
      props.insumoFazenda = insumosFazenda;
      const prev = porFazendaAgg.get(codFazenda) ?? {
        nome: nomeFazenda ?? String(codFazenda),
        areaHa: 0,
        insumos: insumosFazenda,
      };
      prev.areaHa += areaHa ?? 0;
      if (nomeFazenda) prev.nome = nomeFazenda;
      porFazendaAgg.set(codFazenda, prev);
    }

    return { ...feature, properties: props };
  });

  const fazendas = [...porFazendaAgg.entries()]
    .map(([codFazenda, item]) => ({
      codFazenda,
      nome: item.nome,
      areaHa: Number(item.areaHa.toFixed(2)),
      insumos: item.insumos,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const totalAreaHa = features.reduce((acc, feature) => acc + Number(feature.properties.areaHa ?? 0), 0);
  const mmHaMax = mmHaValues.length ? Math.max(...mmHaValues) : 0;
  const mmHaMedio = mmHaValues.length
    ? Number((mmHaValues.reduce((acc, v) => acc + v, 0) / mmHaValues.length).toFixed(2))
    : null;

  return {
    filtros: {
      safraCode,
      codSafra,
      dataInicio,
      dataFim,
      areasAplicadas,
      entomologico,
      irrigacao,
      entomologicoIndice: entomologico ? entomologicoIndice : null,
      operacao,
      operacaoDescricao,
    },
    resumo: {
      totalTalhoes: features.length,
      totalFazendas: fazendas.length,
      totalAreaHa: Number(totalAreaHa.toFixed(2)),
      ...(areasAplicadas ? { areasAplicadas: areaStatusCount } : {}),
      ...(entomologico ? { entomologico: entomoStatusCount } : {}),
      ...(irrigacao ? { irrigacao: { ...irrigacaoStatusCount, mmHaMax: Number(mmHaMax.toFixed(2)), mmHaMedio } } : {}),
    },
    operacoes,
    fazendas,
    geojson: { type: "FeatureCollection", features },
  };
}
