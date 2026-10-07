import { oracleNumber, oracleText, withOracle } from "../oracle.js";
import {
  buildEquipamentoTerceiroSet,
  buildMapaCaminhaoTerceiro,
  isTerceiroColumnKey,
  labelFromColumnKey,
  listarEquipamentosTerceiroDistinct,
  listarNomesTerceiroDistinct,
  resolveNomeTerceiro,
  terceiroColumnKey,
} from "./caminhao-terceiro.js";
import { listarEntradaCanaCaminhao, type EntradaCanaCaminhaoRow } from "./entrada-cana-caminhao-list.js";
import { listarFazendaUsina } from "./fazenda-usina.js";
import { diaUtcFromIso } from "./ords-common.js";
import { resolveOracleCodSafra } from "./oracle-safra.js";
import { normalizeSafraCode, safraStartYear } from "../safras.js";

function codEmpresa() {
  return Number(process.env.COD_EMPRESA || 1);
}

function codFilial() {
  return Number(process.env.COD_FILIAL || 1);
}

function money(n: number) {
  return Math.round((n || 0) * 100) / 100;
}

function normalizeTipoColheita(value: string | null | undefined) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw.includes("MANUAL") || raw.includes("INTEIRA")) return "MANUAL";
  if (raw.includes("MECAN") || raw.includes("PICAD")) return "MECANIZADA";
  return raw || "OUTROS";
}

function tipoToCodTabela(tipo: string) {
  return tipo === "MANUAL" ? 2 : 1;
}

function normalizeName(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fazendaNomeFromLabel(label: string | null | undefined) {
  const raw = String(label ?? "").trim();
  const parts = raw.split(" - ");
  return parts.length > 1 ? parts.slice(1).join(" - ").trim() : raw;
}

type PrecoFaixa = {
  codTabela: number;
  unidadeInicial: number;
  unidadeFinal: number;
  valor: number;
  dataInicial: Date;
  dataFinal: Date | null;
};

function pickPreco(faixas: PrecoFaixa[], codTabela: number, raio: number | null, refDate: Date) {
  if (raio == null || !Number.isFinite(raio)) return null;
  const candidates = faixas
    .filter((row) => {
      if (row.codTabela !== codTabela) return false;
      const start = row.dataInicial.getTime();
      const end = (row.dataFinal ?? refDate).getTime();
      const ref = refDate.getTime();
      if (ref < start || ref > end) return false;
      return raio >= row.unidadeInicial && raio <= row.unidadeFinal;
    })
    .sort((a, b) => b.dataInicial.getTime() - a.dataInicial.getTime());
  return candidates[0]?.valor ?? null;
}

async function loadOracleFrete(refDate: Date) {
  return withOracle(async (conn) => {
    const tabelasRes = await conn.execute(
      `SELECT cod_tabela, descricao
         FROM agricola.frete_tabela
        WHERE cod_grupoempresa = 1
          AND cod_empresa = :codEmpresa
          AND cod_filial = :codFilial
        ORDER BY cod_tabela`,
      { codEmpresa: codEmpresa(), codFilial: codFilial() },
    );
    const tabelas = ((tabelasRes.rows ?? []) as Record<string, unknown>[]).map((row) => ({
      codTabela: oracleNumber(row, "cod_tabela", "COD_TABELA") ?? 0,
      descricao: oracleText(row, "descricao", "DESCRICAO"),
    }));

    const precosRes = await conn.execute(
      `SELECT cod_tabela, unidade_inicial, unidade_final, valor, data_inicial, data_final
         FROM agricola.frete_tabelapreco
        WHERE cod_grupoempresa = 1
          AND cod_empresa = :codEmpresa
          AND cod_filial = :codFilial
        ORDER BY cod_tabela, data_inicial DESC, unidade_inicial`,
      { codEmpresa: codEmpresa(), codFilial: codFilial() },
    );
    const faixas: PrecoFaixa[] = [];
    for (const row of (precosRes.rows ?? []) as Record<string, unknown>[]) {
      const codTabela = oracleNumber(row, "cod_tabela", "COD_TABELA");
      const valor = oracleNumber(row, "valor", "VALOR");
      const ini = row.data_inicial ?? row.DATA_INICIAL;
      if (codTabela == null || valor == null || !(ini instanceof Date)) continue;
      const fimRaw = row.data_final ?? row.DATA_FINAL;
      faixas.push({
        codTabela,
        unidadeInicial: oracleNumber(row, "unidade_inicial", "UNIDADE_INICIAL") ?? 0,
        unidadeFinal: oracleNumber(row, "unidade_final", "UNIDADE_FINAL") ?? 0,
        valor,
        dataInicial: ini,
        dataFinal: fimRaw instanceof Date ? fimRaw : null,
      });
    }

    return { tabelas, faixas, refDate };
  });
}

function buildRaioMapFazendaUsina(dados: Awaited<ReturnType<typeof listarFazendaUsina>>["dados"]) {
  const byLabel = new Map<string, number>();
  const byNome = new Map<string, number>();
  for (const row of dados) {
    const label = String(row.descricaoUsina ?? "").trim();
    if (!label || row.raio == null) continue;
    byLabel.set(label, row.raio);
    const nome = normalizeName(fazendaNomeFromLabel(label));
    if (nome) byNome.set(nome, row.raio);
  }
  return { byLabel, byNome };
}

function resolveRaio(
  fazendaLabel: string | null,
  raioMap: ReturnType<typeof buildRaioMapFazendaUsina>,
) {
  const label = String(fazendaLabel ?? "").trim();
  if (!label) return null;
  if (raioMap.byLabel.has(label)) return raioMap.byLabel.get(label) ?? null;
  const nome = normalizeName(fazendaNomeFromLabel(label));
  if (nome && raioMap.byNome.has(nome)) return raioMap.byNome.get(nome) ?? null;
  for (const [key, raio] of raioMap.byNome) {
    if (nome.includes(key) || key.includes(nome)) return raio;
  }
  return null;
}

function safraSearchTerms(safraCode: string | null) {
  if (!safraCode) return [];
  let normalized = safraCode.trim().replace(/^safra\s+/i, "");
  try {
    normalized = normalizeSafraCode(normalized);
  } catch {
    normalized = normalized.replace(/\s+/g, "");
  }
  const startYear = safraStartYear(normalized);
  const long = `${startYear}/${startYear + 1}`;
  return [...new Set([normalized, long, `Safra ${long}`])];
}

function matchSafra(rowSafra: string | null, safraCode: string | null) {
  if (!safraCode) return true;
  const raw = String(rowSafra ?? "").trim().toUpperCase();
  if (!raw) return true;
  if (safraSearchTerms(safraCode).some((term) => raw.includes(term.toUpperCase()))) return true;
  const startYear = safraStartYear(safraCode);
  const compact = raw.replace(/[\s-]/g, "");
  const yy = String(startYear).slice(-2);
  const yyNext = String(startYear + 1).slice(-2);
  return (
    compact.includes(String(startYear)) ||
    compact.includes(`${yy}/${yyNext}`) ||
    compact.includes(`${yy}${yyNext}`) ||
    compact === yy ||
    compact === String(startYear)
  );
}

function matchPeriodo(row: EntradaCanaCaminhaoRow, dataInicio: string | null, dataFim: string | null) {
  if (!dataInicio && !dataFim) return true;
  const dia = diaUtcFromIso(row.data);
  if (!dia) return false;
  if (dataInicio && dia < dataInicio) return false;
  if (dataFim && dia > dataFim) return false;
  return true;
}

const CAM_COL_PREFIX = "cam:";

export type ResumoTransporteModo = "proprios" | "terceiros" | "ambos";

export function normalizeResumoTransporteModo(value: string | null | undefined): ResumoTransporteModo {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (raw === "terceiros") return "terceiros";
  if (raw === "ambos" || raw === "terceiros+proprios" || raw === "terceiros_proprios") return "ambos";
  return "proprios";
}

function columnKeyForRow(
  row: EntradaCanaCaminhaoRow,
  modo: ResumoTransporteModo,
  mapaTerceiros: ReturnType<typeof buildMapaCaminhaoTerceiro>,
  equipamentosTerceiro: Set<string>,
) {
  const equipKey = row.codEquipamento == null ? null : String(row.codEquipamento);
  const equipTerceiro = equipKey != null && equipamentosTerceiro.has(equipKey);
  const nomeTerceiro = resolveNomeTerceiro(mapaTerceiros, row.caminhao, row.data);

  if (modo === "terceiros") {
    if (equipTerceiro) return terceiroColumnKey(equipKey);
    return nomeTerceiro ? terceiroColumnKey(nomeTerceiro) : null;
  }

  if (modo === "proprios") {
    if (equipTerceiro) return null;
    if (nomeTerceiro && row.codEquipamento == null) return null;
    if (row.codEquipamento != null) return String(row.codEquipamento);
    return null;
  }

  if (equipTerceiro) return terceiroColumnKey(equipKey);
  if (row.codEquipamento != null) return String(row.codEquipamento);
  if (nomeTerceiro) return terceiroColumnKey(nomeTerceiro);
  return null;
}

function matchesRowFilter(
  row: EntradaCanaCaminhaoRow,
  colKey: string,
  modo: ResumoTransporteModo,
  caminhaoFilter: Set<string>,
  terceiroFilter: Set<string>,
) {
  if (modo === "terceiros") {
    return !terceiroFilter.size || terceiroFilter.has(colKey);
  }
  if (modo === "proprios") {
    return !caminhaoFilter.size || caminhaoFilter.has(colKey) || caminhaoFilter.has(String(row.caminhao));
  }
  if (isTerceiroColumnKey(colKey)) {
    return !terceiroFilter.size || terceiroFilter.has(colKey);
  }
  return !caminhaoFilter.size || caminhaoFilter.has(colKey) || caminhaoFilter.has(String(row.caminhao));
}

function columnLabelForKey(key: string) {
  if (isTerceiroColumnKey(key)) return labelFromColumnKey(key);
  if (key.startsWith(CAM_COL_PREFIX)) return key.slice(CAM_COL_PREFIX.length);
  return key;
}

function sortColumnKeys(a: string, b: string) {
  const aTerc = isTerceiroColumnKey(a);
  const bTerc = isTerceiroColumnKey(b);
  if (aTerc !== bTerc) return aTerc ? 1 : -1;
  const aCam = a.startsWith(CAM_COL_PREFIX);
  const bCam = b.startsWith(CAM_COL_PREFIX);
  if (aCam !== bCam) return aCam ? 1 : -1;
  if (aTerc && bTerc) return labelFromColumnKey(a).localeCompare(labelFromColumnKey(b), "pt-BR");
  const na = Number(aCam ? a.slice(CAM_COL_PREFIX.length) : a);
  const nb = Number(bCam ? b.slice(CAM_COL_PREFIX.length) : b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, "pt-BR");
}

export async function listarResumoTransporteOpcoes(filtros: {
  safraCode?: string | null;
  dataInicio?: string | null;
  dataFim?: string | null;
  modo?: string | null;
} = {}) {
  const entrada = await listarEntradaCanaCaminhao({
    dataInicio: filtros.dataInicio,
    dataFim: filtros.dataFim,
  });
  const modo = normalizeResumoTransporteModo(filtros.modo);
  const filtrarSafra = Boolean(filtros.safraCode) && !filtros.dataInicio && !filtros.dataFim;
  const mapaTerceiros = buildMapaCaminhaoTerceiro({
    dataInicio: filtros.dataInicio,
    dataFim: filtros.dataFim,
  });
  const equipamentosTerceiro = buildEquipamentoTerceiroSet();

  const terceiros =
    modo === "terceiros" || modo === "ambos"
      ? [
          ...listarEquipamentosTerceiroDistinct(),
          ...listarNomesTerceiroDistinct({
            dataInicio: filtros.dataInicio,
            dataFim: filtros.dataFim,
          }),
        ]
      : [];

  let lista: Array<{ key: string; label: string; qtd: number }> = [];
  if (modo === "proprios" || modo === "ambos") {
    const colunasProprias = new Map<
      string,
      { key: string; label: string; qtdEntradas: number }
    >();
    for (const row of entrada.dados) {
      if (filtrarSafra && !matchSafra(row.safra, filtros.safraCode ?? null)) continue;
      if (row.caminhao == null) continue;
      const colKey = columnKeyForRow(row, "proprios", mapaTerceiros, equipamentosTerceiro);
      if (!colKey) continue;
      const prev = colunasProprias.get(colKey) ?? {
        key: colKey,
        label: columnLabelForKey(colKey),
        qtdEntradas: 0,
      };
      prev.qtdEntradas += 1;
      colunasProprias.set(colKey, prev);
    }
    lista = [...colunasProprias.values()]
      .sort((a, b) => sortColumnKeys(a.key, b.key))
      .map((row) => ({
        key: row.key,
        label: row.key.startsWith(CAM_COL_PREFIX) ? `Caminhão ${row.label}` : `Equip. ${row.label}`,
        qtd: row.qtdEntradas,
      }));
  }

  return { caminhoes: lista, equipamentos: [], terceiros, truncado: entrada.resumo.truncado, modo };
}

export async function gerarResumoTransporteCana(filtros: {
  safraCode?: string | null;
  reportSafraCode?: string | null;
  dataInicio?: string | null;
  dataFim?: string | null;
  caminhoes?: string[] | null;
  terceiros?: string[] | null;
  modo?: string | null;
  refDate?: string | null;
} = {}) {
  const safraCode = filtros.safraCode?.trim() || null;
  const reportSafraCode = filtros.reportSafraCode?.trim() || safraCode || "25/26";
  const dataInicio = filtros.dataInicio?.trim() || null;
  const dataFim = filtros.dataFim?.trim() || null;
  const modo = normalizeResumoTransporteModo(filtros.modo);
  const filtrarSafra = Boolean(safraCode) && !dataInicio && !dataFim;
  const caminhaoFilter = new Set((filtros.caminhoes ?? []).map((v) => String(v).trim()).filter(Boolean));
  const terceiroFilter = new Set((filtros.terceiros ?? []).map((v) => String(v).trim()).filter(Boolean));
  const refDate = filtros.refDate?.trim()
    ? new Date(`${filtros.refDate}T12:00:00`)
    : dataFim
      ? new Date(`${dataFim}T12:00:00`)
      : new Date();

  const [entrada, usinaMap, oracleFrete] = await Promise.all([
    listarEntradaCanaCaminhao({ dataInicio, dataFim }),
    listarFazendaUsina(),
    loadOracleFrete(refDate),
  ]);

  const mapaTerceiros = buildMapaCaminhaoTerceiro({ dataInicio, dataFim });
  const equipamentosTerceiro = buildEquipamentoTerceiroSet();
  const raioMap = buildRaioMapFazendaUsina(usinaMap.dados);

  type RowAcc = {
    tipoColheita: string;
    fazenda: string;
    equipamentos: Map<string, number>;
    colhido: number;
    raio: number | null;
    precoTon: number | null;
    valorTotal: number;
  };

  const groups = new Map<string, RowAcc>();
  const colSet = new Set<string>();

  for (const row of entrada.dados) {
    if (filtrarSafra && !matchSafra(row.safra, safraCode)) continue;
    if (!matchPeriodo(row, dataInicio, dataFim)) continue;
    if (row.caminhao == null) continue;

    const colKey = columnKeyForRow(row, modo, mapaTerceiros, equipamentosTerceiro);
    if (!colKey) continue;

    if (!matchesRowFilter(row, colKey, modo, caminhaoFilter, terceiroFilter)) continue;

    const tipo = normalizeTipoColheita(row.tipoColheita);
    const fazenda = String(row.fazenda ?? "").trim() || "—";
    const key = `${tipo}::${fazenda}`;
    const ton = row.pesoLiquido ?? 0;
    if (!ton) continue;

    colSet.add(colKey);
    const acc =
      groups.get(key) ??
      ({
        tipoColheita: tipo,
        fazenda,
        equipamentos: new Map<string, number>(),
        colhido: 0,
        raio: resolveRaio(fazenda, raioMap),
        precoTon: null,
        valorTotal: 0,
      } satisfies RowAcc);
    acc.colhido += ton;
    acc.equipamentos.set(colKey, (acc.equipamentos.get(colKey) ?? 0) + ton);
    groups.set(key, acc);
  }

  const colunas = [...colSet].sort(sortColumnKeys).map((key) => ({ key, label: columnLabelForKey(key) }));
  const equipamentos = colunas.map((col) => col.key);
  const blocos: Array<{
    tipoColheita: string;
    linhas: Array<{
      fazenda: string;
      equipamentos: Record<string, number>;
      colhido: number;
      raio: number | null;
      precoTon: number | null;
      valorTotal: number;
    }>;
    totais: {
      equipamentos: Record<string, number>;
      colhido: number;
      valorTotal: number;
    };
  }> = [];

  for (const tipo of ["MANUAL", "MECANIZADA"]) {
    const linhasTipo = [...groups.values()].filter((row) => row.tipoColheita === tipo);
    if (!linhasTipo.length) continue;
    const codTabela = tipoToCodTabela(tipo);
    const linhas = linhasTipo
      .map((row) => {
        const precoTon = pickPreco(oracleFrete.faixas, codTabela, row.raio, refDate);
        const valorTotal = precoTon != null ? money(row.colhido * precoTon) : 0;
        const equipamentosObj: Record<string, number> = {};
        for (const col of equipamentos) {
          const v = row.equipamentos.get(col);
          if (v) equipamentosObj[col] = money(v);
        }
        return {
          fazenda: row.fazenda,
          equipamentos: equipamentosObj,
          colhido: money(row.colhido),
          raio: row.raio,
          precoTon: precoTon != null ? money(precoTon) : null,
          valorTotal,
        };
      })
      .sort((a, b) => a.fazenda.localeCompare(b.fazenda, "pt-BR"));

    const totais = {
      equipamentos: {} as Record<string, number>,
      colhido: 0,
      valorTotal: 0,
    };
    for (const linha of linhas) {
      totais.colhido += linha.colhido;
      totais.valorTotal += linha.valorTotal;
      for (const [eq, val] of Object.entries(linha.equipamentos)) {
        totais.equipamentos[eq] = money((totais.equipamentos[eq] ?? 0) + val);
      }
    }
    totais.colhido = money(totais.colhido);
    totais.valorTotal = money(totais.valorTotal);

    blocos.push({ tipoColheita: tipo, linhas, totais });
  }

  const totalGeral = {
    equipamentos: {} as Record<string, number>,
    colhido: 0,
    valorTotal: 0,
  };
  for (const bloco of blocos) {
    totalGeral.colhido += bloco.totais.colhido;
    totalGeral.valorTotal += bloco.totais.valorTotal;
    for (const [eq, val] of Object.entries(bloco.totais.equipamentos)) {
      totalGeral.equipamentos[eq] = money((totalGeral.equipamentos[eq] ?? 0) + val);
    }
  }
  totalGeral.colhido = money(totalGeral.colhido);
  totalGeral.valorTotal = money(totalGeral.valorTotal);

  const valorPorEquip = {} as Record<string, number>;
  for (const bloco of blocos) {
    for (const linha of bloco.linhas) {
      if (linha.precoTon == null) continue;
      for (const [eq, ton] of Object.entries(linha.equipamentos)) {
        valorPorEquip[eq] = money((valorPorEquip[eq] ?? 0) + ton * linha.precoTon);
      }
    }
  }

  const parceiros = await withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT cod_fornecedor, razaosocial, nomefantasia
         FROM material.vw_parceironegocio
        WHERE UPPER(razaosocial) LIKE '%JATOB%'
           OR UPPER(razaosocial) LIKE '%CORURIPE%'
           OR UPPER(nomefantasia) LIKE '%CORURIPE%'`,
    );
    return (result.rows ?? []) as Record<string, unknown>[];
  });

  const jatoba =
    parceiros.find((p) => normalizeName(oracleText(p, "razaosocial", "RAZAOSOCIAL")).includes("JATOB")) ??
    parceiros[0];
  const usina =
    parceiros.find((p) => normalizeName(oracleText(p, "razaosocial", "RAZAOSOCIAL")).includes("CORURIPE")) ??
    parceiros[1];

  const splitRows = [
    {
      nome: jatoba ? `${oracleText(jatoba, "razaosocial", "RAZAOSOCIAL")} (30%)` : "Luiz Jatobá Filho (30%)",
      pct: 0.3,
    },
    {
      nome: usina ? `${oracleText(usina, "razaosocial", "RAZAOSOCIAL")} (70%)` : "Usina Coruripe (70%)",
      pct: 0.7,
    },
  ].map((parte) => ({
    nome: parte.nome,
    equipamentos: Object.fromEntries(
      equipamentos.map((eq) => [String(eq), money((valorPorEquip[String(eq)] ?? 0) * parte.pct)]),
    ),
    total: money(
      equipamentos.reduce((acc, eq) => acc + (valorPorEquip[String(eq)] ?? 0) * parte.pct, 0),
    ),
  }));

  let codSafra: number | null = null;
  if (safraCode) {
    await withOracle(async (conn) => {
      codSafra = await resolveOracleCodSafra(conn, safraCode);
    });
  }

  return {
    filtros: {
      safraCode,
      reportSafraCode,
      dataInicio,
      dataFim,
      refDate: refDate.toISOString().slice(0, 10),
      codSafra,
      modo,
      caminhoes: modo !== "terceiros" && caminhaoFilter.size ? [...caminhaoFilter] : [],
      terceiros: modo !== "proprios" && terceiroFilter.size ? [...terceiroFilter] : [],
    },
    resumo: {
      totalLinhasEntrada: entrada.dados.length,
      truncado: entrada.resumo.truncado,
      totalGeral,
    },
    colunas,
    equipamentos,
    blocos,
    parceiros: splitRows,
    tabelasFrete: oracleFrete.tabelas,
  };
}
