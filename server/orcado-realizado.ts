import { fetchActivityRealizado } from "./activity-links.js";
import { MONTHS } from "./catalog.js";
import { collectBudgetContributions } from "./calc.js";
import { db } from "./db.js";
import { oracleNumber, oracleText, withOracle } from "./oracle.js";
import { currentSafraId, listSafras, resolveSafraId, safraStartYear } from "./safras.js";
import { breakdownForSafra, listSafraCostPerTon, storedSafraKpi } from "./safra-kpis.js";
import { fetchUnRealizadoUnitsBySheet } from "./un-realizado.js";
import { aggregateCompare, zeros, type CompareViewRow, type RealizadoObject } from "../src/lib/reportAggregate.ts";

const SAFRA_MONTHS = [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7];

type RealizadoRule = {
  sheetName: string;
  negocio: number;
  processo: number;
  subprocesso?: number;
};

export const REALIZADO_RULES: RealizadoRule[] = [
  { sheetName: "IRRIGAÇÃO", negocio: 1, processo: 4 },
  { sheetName: "MECANIZAÇÃO AGR.", negocio: 3, processo: 1, subprocesso: 3 },
  { sheetName: "P.SOLO", negocio: 1, processo: 1, subprocesso: 1 },
  { sheetName: "PLANTIO", negocio: 1, processo: 1, subprocesso: 2 },
  { sheetName: "T.C.P.", negocio: 1, processo: 1, subprocesso: 3 },
  { sheetName: "T.C.S.", negocio: 1, processo: 2 },
  { sheetName: "C. MECANIZADA", negocio: 1, processo: 3, subprocesso: 3 },
  { sheetName: "C. MANUAL", negocio: 1, processo: 3, subprocesso: 2 },
  { sheetName: "OFICINA", negocio: 3, processo: 1, subprocesso: 1 },
  { sheetName: "TRANSP.AGRICOLA", negocio: 3, processo: 1, subprocesso: 2 },
  { sheetName: "ADMINISTRAÇÃO", negocio: 5, processo: 1 },
  { sheetName: "ARRENDAMENTOS", negocio: 5, processo: 2 },
  { sheetName: "PECUÁRIA", negocio: 2, processo: 6, subprocesso: 1 },
  { sheetName: "DIRETORIA", negocio: 5, processo: 4, subprocesso: 3 },
  { sheetName: "CORTE SEMENTE", negocio: 1, processo: 1, subprocesso: 1 },
];

function money(n: number) {
  return Math.round((n || 0) * 100) / 100;
}

function costObjectKey(code: unknown): string {
  const raw = String(code ?? "").trim();
  if (!raw) return "none";
  const n = Number(raw.replace(",", "."));
  if (Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return raw.toUpperCase();
}

function anomesRange(startYear: number) {
  return { from: startYear * 100 + 9, to: (startYear + 1) * 100 + 8 };
}

function sumMonths(months: number[]) {
  return months.reduce((acc, value) => acc + (value || 0), 0);
}

function subprocessoFromRaw(raw: Record<string, unknown>) {
  const negocio = oracleNumber(raw, "negocio");
  const processo = oracleNumber(raw, "processo");
  const subprocesso = oracleNumber(raw, "subprocesso");
  if (negocio == null || processo == null) {
    return { key: "sem-subprocesso", label: "Sem subprocesso" };
  }
  return {
    key: [negocio, processo, subprocesso ?? 0].join("/"),
    label:
      subprocesso == null
        ? `Negócio ${negocio} / Processo ${processo}`
        : `Negócio ${negocio} / Processo ${processo} / Subprocesso ${subprocesso}`,
  };
}

function addInto(target: number[], extra: number[]) {
  for (let i = 0; i < 12; i++) target[i] = money((target[i] ?? 0) + (extra[i] ?? 0));
}

function anomesSpanForSafras(codes: string[], fallbackYear: number) {
  const years = codes.map((code) => safraStartYear(code));
  const minYear = Math.min(fallbackYear, ...years);
  const maxYear = Math.max(fallbackYear, ...years);
  return { from: minYear * 100 + 9, to: (maxYear + 1) * 100 + 8 };
}

function buildSafraCompare(
  contributions: { months: number[] }[],
  oracleRows: Record<string, unknown>[],
  currentId: number,
  sheetByName: Map<string, { id: number }>,
): CompareViewRow[] {
  const safras = listSafras().map((safra) => ({
    ...safra,
    year: safraStartYear(safra.code),
  }));
  const kpiById = new Map(listSafraCostPerTon().map((row) => [row.safraId, row] as const));

  const currentOrcado = zeros();
  for (const row of contributions) addInto(currentOrcado, row.months);

  const realizadoBySafra = new Map<number, number[]>();
  for (const safra of safras) realizadoBySafra.set(safra.id, zeros());

  for (const raw of oracleRows) {
    const anomes = oracleNumber(raw, "anomes");
    const valor = oracleNumber(raw, "valor") ?? 0;
    if (anomes == null || !valor) continue;
    const sheetName = matchSheetName(
      oracleNumber(raw, "negocio"),
      oracleNumber(raw, "processo"),
      oracleNumber(raw, "subprocesso"),
    );
    if (!sheetName || !sheetByName.has(sheetName)) continue;
    for (const safra of safras) {
      const index = anomesToIndex(anomes, safra.year);
      if (index == null) continue;
      const months = realizadoBySafra.get(safra.id)!;
      months[index] = money(months[index] + valor);
      break;
    }
  }

  return safras
    .slice()
    .sort((a, b) => a.year - b.year)
    .map((safra) => {
      const kpi = kpiById.get(safra.id);
      const realizado = realizadoBySafra.get(safra.id) ?? zeros();
      const isCurrent = safra.id === currentId;
      const orcado = isCurrent ? currentOrcado.slice() : zeros();
      const orcadoTotal = isCurrent ? money(sumMonths(orcado)) : money(kpi?.orcamentoTotal ?? 0);
      const realizadoTotal = money(sumMonths(realizado));
      const orcadoAnnualOnly = !isCurrent;
      const variacao = orcado.map((value, i) =>
        orcadoAnnualOnly ? 0 : money((realizado[i] ?? 0) - value),
      );
      return {
        key: `safra-${safra.id}`,
        label: safra.label,
        orcado,
        realizado,
        variacao,
        orcadoTotal,
        realizadoTotal,
        variacaoTotal: money(realizadoTotal - orcadoTotal),
        orcadoAnnualOnly,
        tons: kpi?.moagem ?? 0,
      };
    })
    .filter(
      (row) => row.orcadoTotal || row.realizadoTotal || row.key === `safra-${currentId}`,
    );
}

function anomesToIndex(anomes: number, startYear: number): number | null {
  const year = Math.floor(anomes / 100);
  const month = anomes % 100;
  if (month < 1 || month > 12) return null;
  const calendar = month - 1;
  const index = SAFRA_MONTHS.indexOf(calendar);
  if (index < 0) return null;
  const expectedYear = calendar >= 8 ? startYear : startYear + 1;
  if (year !== expectedYear) return null;
  return index;
}

export function matchSheetName(negocio: number | null, processo: number | null, subprocesso: number | null) {
  if (negocio == null || processo == null) return null;
  const specific = REALIZADO_RULES.find(
    (rule) =>
      rule.subprocesso != null &&
      rule.negocio === negocio &&
      rule.processo === processo &&
      rule.subprocesso === subprocesso,
  );
  if (specific) return specific.sheetName;
  const general = REALIZADO_RULES.find(
    (rule) => rule.subprocesso == null && rule.negocio === negocio && rule.processo === processo,
  );
  return general?.sheetName ?? null;
}

function oracleFilterSql() {
  return REALIZADO_RULES.map((rule) => {
    const parts = [`ob.negocio = ${rule.negocio}`, `ob.processo = ${rule.processo}`];
    if (rule.subprocesso != null) parts.push(`ob.subprocesso = ${rule.subprocesso}`);
    return `(${parts.join(" AND ")})`;
  }).join("\n              OR ");
}

function patchRowsWithStoredOrcado(rows: CompareViewRow[], totalsByKey: Map<string, number>): CompareViewRow[] {
  const patched = rows.map((row) => {
    const orcadoTotal = money(totalsByKey.get(row.key) ?? 0);
    const realizadoTotal = money(row.realizadoTotal);
    return {
      ...row,
      orcado: zeros(),
      orcadoTotal,
      orcadoAnnualOnly: true,
      variacao: row.realizado.map((value) => money(value)),
      variacaoTotal: money(realizadoTotal - orcadoTotal),
    };
  });
  return patched.filter((row) => row.orcadoTotal || row.realizadoTotal);
}

function applyStoredOrcadoForSafra(
  summary: ReturnType<typeof aggregateCompare>,
  harvestId: number,
) {
  if (harvestId === currentSafraId()) return summary;
  const stored = storedSafraKpi(harvestId);
  const ccTotals = new Map(breakdownForSafra(stored, "cost_center").map((row) => [row.key, row.total]));
  const catTotals = new Map(breakdownForSafra(stored, "category").map((row) => [row.key, row.total]));
  const costCenter = patchRowsWithStoredOrcado(summary.views.costCenter, ccTotals);
  const category = patchRowsWithStoredOrcado(summary.views.category, catTotals);
  const totalOrcado = money(costCenter.reduce((sum, row) => sum + row.orcadoTotal, 0));
  const totalRealizado = money(summary.totalRealizado);
  const totalVariacao = money(totalRealizado - totalOrcado);
  return {
    ...summary,
    views: {
      ...summary.views,
      costCenter,
      category,
    },
    totals: {
      orcado: zeros(),
      realizado: summary.totals.realizado,
      variacao: summary.totals.realizado.map((value) => money(value)),
    },
    totalOrcado,
    totalVariacao,
  };
}

async function fetchRealizado(anomesFrom: number, anomesTo: number) {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT a.anomes,
              a.cod_objetocusto,
              ob.negocio,
              ob.processo,
              ob.subprocesso,
              SUM(a.valor) AS valor
         FROM custo.lancamento_custo a
         JOIN custo.objetocusto ob
           ON ob.cod_objetocusto = a.cod_objetocusto
        WHERE a.tipo = 'R'
          AND a.anomes BETWEEN :anomesFrom AND :anomesTo
          AND EXISTS (
              SELECT 1
                FROM custo.empenho emp
               WHERE emp.cod_empenho = a.cod_empenho
                 AND emp.cod_tipoempenho IN (1, 2)
          )
          AND (
              ${oracleFilterSql()}
          )
        GROUP BY a.anomes, a.cod_objetocusto, ob.negocio, ob.processo, ob.subprocesso`,
      { anomesFrom, anomesTo },
    );
    return (result.rows ?? []) as Record<string, unknown>[];
  });
}

async function fetchGrupoGastoOracle(anomesFrom: number, anomesTo: number) {
  const agricolaSql = `NOT EXISTS (
              SELECT 1
                FROM custo.objetocusto b
               WHERE b.negocio = 5
                 AND b.processo IN (3, 4)
                 AND oc.cod_objetocusto = b.cod_objetocusto
          )
          AND NOT EXISTS (
              SELECT 1
                FROM custo.objetocusto d
               WHERE d.negocio IN (2, 98, 90, 6, 99, 8, 7)
                 AND oc.cod_objetocusto = d.cod_objetocusto
          )`;
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `WITH lancamentos AS (
          SELECT ge.cod_grupoempenho,
                 ge.descricao,
                 emp.cod_empenho,
                 emp.descricao AS empenho_descricao,
                 oc.negocio,
                 oc.processo,
                 oc.subprocesso,
                 a.anomes,
                 NVL(SUM(CASE WHEN a.tipo = 'O' THEN a.valor ELSE 0 END), 0) AS orcado,
                 NVL(SUM(CASE WHEN a.tipo = 'R' THEN a.valor ELSE 0 END), 0) AS realizado,
                 NVL(SUM(CASE WHEN a.tipo = 'O' AND ${agricolaSql} THEN a.valor ELSE 0 END), 0) AS orcado_agricola,
                 NVL(SUM(CASE WHEN a.tipo = 'R' AND ${agricolaSql} THEN a.valor ELSE 0 END), 0) AS realizado_agricola
            FROM custo.lancamento_custo a
            JOIN custo.empenho emp
              ON emp.cod_empenho = a.cod_empenho
            JOIN custo.grupoempenho ge
              ON ge.cod_grupoempenho = emp.cod_grupoempenho
            LEFT JOIN custo.objetocusto oc
              ON oc.cod_objetocusto = a.cod_objetocusto
           WHERE a.anomes BETWEEN :anomesFrom AND :anomesTo
             AND a.tipo IN ('O', 'R')
             AND emp.cod_tipoempenho IN (1, 2)
           GROUP BY ge.cod_grupoempenho, ge.descricao, emp.cod_empenho, emp.descricao,
                 oc.negocio, oc.processo, oc.subprocesso, a.anomes
      ),
      lancamento_itens AS (
          SELECT ge.cod_grupoempenho,
                 emp.cod_empenho,
                 oc.negocio,
                 oc.processo,
                 oc.subprocesso,
                 a.anomes,
                 COALESCE(NULLIF(TRIM(ic.descricao), ''), emp.descricao, 'Lançamento integrado') AS item_descricao,
                 NVL(SUM(CASE WHEN a.tipo = 'O' THEN a.valor ELSE 0 END), 0) AS orcado,
                 NVL(SUM(CASE WHEN a.tipo = 'R' THEN a.valor ELSE 0 END), 0) AS realizado,
                 NVL(SUM(CASE WHEN a.tipo = 'O' AND ${agricolaSql} THEN a.valor ELSE 0 END), 0) AS orcado_agricola,
                 NVL(SUM(CASE WHEN a.tipo = 'R' AND ${agricolaSql} THEN a.valor ELSE 0 END), 0) AS realizado_agricola
            FROM custo.lancamento_custo a
            JOIN custo.empenho emp
              ON emp.cod_empenho = a.cod_empenho
            JOIN custo.grupoempenho ge
              ON ge.cod_grupoempenho = emp.cod_grupoempenho
            LEFT JOIN custo.item_custo ic
              ON ic.cod_item_custo = a.cod_item_custo
             AND a.cod_item_custo <> 0
            LEFT JOIN custo.objetocusto oc
              ON oc.cod_objetocusto = a.cod_objetocusto
           WHERE a.anomes BETWEEN :anomesFrom AND :anomesTo
             AND a.tipo IN ('O', 'R')
             AND emp.cod_tipoempenho IN (1, 2)
           GROUP BY ge.cod_grupoempenho, emp.cod_empenho,
                 oc.negocio, oc.processo, oc.subprocesso, a.anomes,
                 COALESCE(NULLIF(TRIM(ic.descricao), ''), emp.descricao, 'Lançamento integrado')
      ),
      origem_documento AS (
          SELECT
              TO_NUMBER(TO_CHAR(p.datainicio, 'YYYYMM')) AS anomes,
              p.cod_empenho,
              p.cod_objetocusto,
              SUM(NVL(p.valor, 0)) AS valor,
              'Contrato' AS origem_tipo,
              'Contrato ' || TO_CHAR(p.numerocontrato) || ' · parcela ' || TO_CHAR(p.parcela) AS origem_doc,
              MAX(
                COALESCE(
                  NULLIF(TRIM(pn.razaosocial), '') || COALESCE(' · ' || NULLIF(TRIM(p.observacao), ''), ''),
                  NULLIF(TRIM(p.observacao), ''),
                  CASE WHEN ct.cod_fornecedor IS NOT NULL THEN 'Fornecedor ' || TO_CHAR(ct.cod_fornecedor) END
                )
              ) AS origem_descricao
         FROM financeiro.parcelascontrato p
         LEFT JOIN financeiro.contrato ct
           ON ct.cod_grupoempresa = p.cod_grupoempresa
          AND ct.cod_empresa = p.cod_empresa
          AND ct.cod_filial = p.cod_filial
          AND ct.numerocontrato = p.numerocontrato
         LEFT JOIN material.vw_parceironegocio pn
           ON pn.cod_fornecedor = ct.cod_fornecedor
        WHERE p.cod_empenho IS NOT NULL
          AND TO_NUMBER(TO_CHAR(p.datainicio, 'YYYYMM')) BETWEEN :anomesFrom AND :anomesTo
          AND NOT EXISTS (
              SELECT 1
                FROM financeiro.itemcontratovariavel iv
               WHERE iv.cod_grupoempresa = p.cod_grupoempresa
                 AND iv.numerocontrato = p.numerocontrato
                 AND iv.parcela = p.parcela
          )
        GROUP BY
              TO_NUMBER(TO_CHAR(p.datainicio, 'YYYYMM')),
              p.cod_empenho,
              p.cod_objetocusto,
              p.numerocontrato,
              p.parcela
        UNION ALL
          SELECT
              TO_NUMBER(TO_CHAR(p.datainicio, 'YYYYMM')) AS anomes,
              p.cod_empenho,
              NVL(i.cod_objetocusto, p.cod_objetocusto) AS cod_objetocusto,
              SUM(NVL(i.vlrtotal, 0)) AS valor,
              'Contrato variável' AS origem_tipo,
              'Item de contrato' AS origem_doc,
              COALESCE(NULLIF(TRIM(i.observacao), ''), op.descricao, 'Item de contrato') AS origem_descricao
         FROM financeiro.itemcontratovariavel i
         JOIN financeiro.parcelascontrato p
           ON p.cod_grupoempresa = i.cod_grupoempresa
          AND p.numerocontrato = i.numerocontrato
          AND p.parcela = i.parcela
         LEFT JOIN financeiro.contrato ct
           ON ct.cod_grupoempresa = p.cod_grupoempresa
          AND ct.cod_empresa = p.cod_empresa
          AND ct.cod_filial = p.cod_filial
          AND ct.numerocontrato = p.numerocontrato
         LEFT JOIN material.vw_parceironegocio pn
           ON pn.cod_fornecedor = ct.cod_fornecedor
         LEFT JOIN rh.operacaoagricola op
           ON op.cod_operacaoagricola = i.cod_servico
        WHERE p.cod_empenho IS NOT NULL
          AND TO_NUMBER(TO_CHAR(p.datainicio, 'YYYYMM')) BETWEEN :anomesFrom AND :anomesTo
        GROUP BY
              TO_NUMBER(TO_CHAR(p.datainicio, 'YYYYMM')),
              p.cod_empenho,
              NVL(i.cod_objetocusto, p.cod_objetocusto),
              COALESCE(NULLIF(TRIM(i.observacao), ''), op.descricao, 'Item de contrato')
      ),
      origem_agrupada AS (
          SELECT ge.cod_grupoempenho,
                 ge.descricao,
                 emp.cod_empenho,
                 emp.descricao AS empenho_descricao,
                 oc.negocio,
                 oc.processo,
                 oc.subprocesso,
                 od.origem_tipo,
                 od.origem_doc,
                 od.origem_descricao,
                 od.anomes,
                 SUM(od.valor) AS realizado,
                 SUM(CASE WHEN ${agricolaSql} THEN od.valor ELSE 0 END) AS realizado_agricola
            FROM origem_documento od
            JOIN custo.empenho emp
              ON emp.cod_empenho = od.cod_empenho
            JOIN custo.grupoempenho ge
              ON ge.cod_grupoempenho = emp.cod_grupoempenho
            LEFT JOIN custo.objetocusto oc
              ON oc.cod_objetocusto = od.cod_objetocusto
           WHERE emp.cod_tipoempenho IN (1, 2)
           GROUP BY ge.cod_grupoempenho, ge.descricao, emp.cod_empenho, emp.descricao,
                 oc.negocio, oc.processo, oc.subprocesso,
                 od.origem_tipo, od.origem_doc, od.origem_descricao, od.anomes
      ),
      origem_totais AS (
          SELECT cod_grupoempenho,
                 cod_empenho,
                 negocio,
                 processo,
                 subprocesso,
                 anomes,
                 SUM(realizado) AS realizado,
                 SUM(realizado_agricola) AS realizado_agricola
            FROM origem_agrupada
           GROUP BY cod_grupoempenho, cod_empenho, negocio, processo, subprocesso, anomes
      )
       SELECT ge.cod_grupoempenho,
              ge.descricao,
              ge.cod_empenho,
              ge.empenho_descricao,
              ge.negocio,
              ge.processo,
              ge.subprocesso,
              ge.origem_tipo,
              ge.origem_doc,
              ge.origem_descricao,
              ge.anomes,
              0 AS orcado,
              ge.realizado,
              0 AS orcado_agricola,
              ge.realizado_agricola
         FROM origem_agrupada ge
        UNION ALL
       SELECT l.cod_grupoempenho,
              l.descricao,
              l.cod_empenho,
              l.empenho_descricao,
              l.negocio,
              l.processo,
              l.subprocesso,
              'Origem financeira' AS origem_tipo,
              'Lançamento integrado' AS origem_doc,
              li.item_descricao AS origem_descricao,
              l.anomes,
              li.orcado,
              CASE
                WHEN l.realizado = 0 THEN 0
                ELSE li.realizado * ((l.realizado - NVL(o.realizado, 0)) / l.realizado)
              END AS realizado,
              li.orcado_agricola,
              CASE
                WHEN l.realizado_agricola = 0 THEN 0
                ELSE li.realizado_agricola * ((l.realizado_agricola - NVL(o.realizado_agricola, 0)) / l.realizado_agricola)
              END AS realizado_agricola
         FROM lancamentos l
         JOIN lancamento_itens li
           ON li.cod_grupoempenho = l.cod_grupoempenho
          AND li.cod_empenho = l.cod_empenho
          AND NVL(li.negocio, -999999) = NVL(l.negocio, -999999)
          AND NVL(li.processo, -999999) = NVL(l.processo, -999999)
          AND NVL(li.subprocesso, -999999) = NVL(l.subprocesso, -999999)
          AND li.anomes = l.anomes
         LEFT JOIN origem_totais o
           ON o.cod_grupoempenho = l.cod_grupoempenho
          AND o.cod_empenho = l.cod_empenho
          AND NVL(o.negocio, -999999) = NVL(l.negocio, -999999)
          AND NVL(o.processo, -999999) = NVL(l.processo, -999999)
          AND NVL(o.subprocesso, -999999) = NVL(l.subprocesso, -999999)
          AND o.anomes = l.anomes
        WHERE l.orcado <> 0
           OR ABS(l.realizado - NVL(o.realizado, 0)) > 0.005
           OR l.orcado_agricola <> 0
           OR ABS(l.realizado_agricola - NVL(o.realizado_agricola, 0)) > 0.005`,
      { anomesFrom, anomesTo },
    );
    return (result.rows ?? []) as Record<string, unknown>[];
  });
}

function buildGrupoGastoRows(
  oracleRows: Record<string, unknown>[],
  startYear: number,
  fields: { orcado: string; realizado: string } = { orcado: "orcado", realizado: "realizado" },
): CompareViewRow[] {
  const map = new Map<string, CompareViewRow>();
  const sourceMap = new Map<string, Map<string, CompareViewRow>>();
  const detailMap = new Map<string, Map<string, Map<string, CompareViewRow>>>();
  for (const raw of oracleRows) {
    const anomes = oracleNumber(raw, "anomes");
    const index = anomes == null ? null : anomesToIndex(anomes, startYear);
    if (index == null) continue;
    const cod = oracleNumber(raw, "cod_grupoempenho");
    const key = String(cod ?? (oracleText(raw, "descricao") || "none"));
    const label = (oracleText(raw, "descricao") || `Grupo ${key}`).trim();
    const row =
      map.get(key) ??
      ({
        key: `grupo-${key}`,
        label,
        orcado: zeros(),
        realizado: zeros(),
        variacao: zeros(),
        orcadoTotal: 0,
        realizadoTotal: 0,
        variacaoTotal: 0,
      } satisfies CompareViewRow);
    const codEmpenho = oracleNumber(raw, "cod_empenho");
    const empenhoKey = String(codEmpenho ?? (oracleText(raw, "empenho_descricao") || "none"));
    const empenhoLabel = [
      codEmpenho == null ? null : String(codEmpenho),
      oracleText(raw, "empenho_descricao") || null,
    ].filter(Boolean).join(" — ") || `Empenho ${empenhoKey}`;
    const subprocesso = subprocessoFromRaw(raw);
    const children = sourceMap.get(key) ?? new Map<string, CompareViewRow>();
    const child =
      children.get(empenhoKey) ??
      ({
        key: `empenho-${key}-${empenhoKey}`,
        label: empenhoLabel,
        orcado: zeros(),
        realizado: zeros(),
        variacao: zeros(),
        orcadoTotal: 0,
        realizadoTotal: 0,
        variacaoTotal: 0,
      } satisfies CompareViewRow);
    const origemTipo = oracleText(raw, "origem_tipo") || "Lançamento de custo";
    const origemDoc = oracleText(raw, "origem_doc") || "Lançamento ERP";
    const origemDescricao = oracleText(raw, "origem_descricao") || "Detalhe de origem não localizado";
    const itemKey = `${subprocesso.key}|${origemTipo}|${origemDoc}|${origemDescricao}`;
    const itemLabel =
      origemTipo === "Contrato variável" || origemTipo === "Origem financeira"
        ? origemDescricao
        : `${origemDoc} — ${origemDescricao}`;
    const groupDetails = detailMap.get(key) ?? new Map<string, Map<string, CompareViewRow>>();
    const empenhoDetails = groupDetails.get(empenhoKey) ?? new Map<string, CompareViewRow>();
    const item =
      empenhoDetails.get(itemKey) ??
      ({
        key: `item-${key}-${empenhoKey}-${itemKey}`,
        label: itemLabel,
        orcado: zeros(),
        realizado: zeros(),
        variacao: zeros(),
        orcadoTotal: 0,
        realizadoTotal: 0,
        variacaoTotal: 0,
        subprocessoKey: subprocesso.key,
        subprocessoLabel: subprocesso.label,
      } satisfies CompareViewRow);
    const orcado = oracleNumber(raw, fields.orcado) ?? 0;
    const realizado = oracleNumber(raw, fields.realizado) ?? 0;
    row.orcado[index] = money(row.orcado[index] + orcado);
    row.realizado[index] = money(row.realizado[index] + realizado);
    child.orcado[index] = money(child.orcado[index] + orcado);
    child.realizado[index] = money(child.realizado[index] + realizado);
    item.orcado[index] = money(item.orcado[index] + orcado);
    item.realizado[index] = money(item.realizado[index] + realizado);
    empenhoDetails.set(itemKey, item);
    groupDetails.set(empenhoKey, empenhoDetails);
    detailMap.set(key, groupDetails);
    children.set(empenhoKey, child);
    sourceMap.set(key, children);
    map.set(key, row);
  }
  return [...map.values()]
    .map((row) => {
      const orcadoTotal = money(sumMonths(row.orcado));
      const realizadoTotal = money(sumMonths(row.realizado));
      const variacao = row.orcado.map((value, i) => money((row.realizado[i] ?? 0) - value));
      const groupKey = row.key.replace(/^grupo-/, "");
      const sources = [...(sourceMap.get(groupKey)?.values() ?? [])]
        .map((child) => {
          const childOrcadoTotal = money(sumMonths(child.orcado));
          const childRealizadoTotal = money(sumMonths(child.realizado));
          const childVariacao = child.orcado.map((value, i) => money((child.realizado[i] ?? 0) - value));
          const childKey = child.key.replace(new RegExp(`^empenho-${groupKey}-`), "");
          const childSources = [...(detailMap.get(groupKey)?.get(childKey)?.values() ?? [])]
            .map((item) => {
              const itemOrcadoTotal = money(sumMonths(item.orcado));
              const itemRealizadoTotal = money(sumMonths(item.realizado));
              const itemVariacao = item.orcado.map((value, i) => money((item.realizado[i] ?? 0) - value));
              return {
                ...item,
                orcadoTotal: itemOrcadoTotal,
                realizadoTotal: itemRealizadoTotal,
                variacao: itemVariacao,
                variacaoTotal: money(itemRealizadoTotal - itemOrcadoTotal),
              };
            })
            .filter((item) => item.orcadoTotal || item.realizadoTotal)
            .sort((a, b) => Math.abs(b.realizadoTotal) - Math.abs(a.realizadoTotal) || a.label.localeCompare(b.label, "pt-BR"));
          return {
            ...child,
            orcadoTotal: childOrcadoTotal,
            realizadoTotal: childRealizadoTotal,
            variacao: childVariacao,
            variacaoTotal: money(childRealizadoTotal - childOrcadoTotal),
            sources: childSources,
          };
        })
        .filter((child) => child.orcadoTotal || child.realizadoTotal)
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
      return {
        ...row,
        orcadoTotal,
        realizadoTotal,
        variacao,
        variacaoTotal: money(realizadoTotal - orcadoTotal),
        sources,
      };
    })
    .filter((row) => row.orcadoTotal || row.realizadoTotal)
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

export async function orcadoRealizado(options?: { safraId?: number | null }) {
  const harvestId = resolveSafraId(options?.safraId);
  const safra = db.prepare("SELECT code, label FROM safras WHERE id = ?").get(harvestId) as
    | { code: string; label: string }
    | undefined;
  const startYear = safra ? safraStartYear(safra.code) : new Date().getFullYear();
  const { from: anomesFrom, to: anomesTo } = anomesRange(startYear);
  const fetchRange = anomesSpanForSafras(
    listSafras().map((row) => row.code),
    startYear,
  );
  const sheets = db
    .prepare("SELECT id, name, title FROM sheets WHERE kind = 'cost_center'")
    .all() as { id: number; name: string; title: string }[];
  const sheetByName = new Map(sheets.map((row) => [row.name, row]));

  const contributions = collectBudgetContributions();
  const objectLabels = new Map(contributions.map((row) => [row.objectKey, row.objectLabel]));
  const objects = db.prepare("SELECT code, description FROM cost_objects").all() as { code: string; description: string }[];
  for (const row of objects) {
    const key = costObjectKey(row.code);
    if (!objectLabels.has(key)) objectLabels.set(key, `${row.code} — ${row.description}`);
  }

  const realizadoMap = new Map<string, RealizadoObject>();
  const [oracleRows, realizadoByActivity, grupoGastoRows] = await Promise.all([
    fetchRealizado(fetchRange.from, fetchRange.to),
    fetchActivityRealizado({ safraId: harvestId, startYear }),
    fetchGrupoGastoOracle(anomesFrom, anomesTo),
  ]);
  const grupoGasto = buildGrupoGastoRows(grupoGastoRows, startYear);
  const grupoGastoAgricola = buildGrupoGastoRows(grupoGastoRows, startYear, {
    orcado: "orcado_agricola",
    realizado: "realizado_agricola",
  });
  for (const raw of oracleRows) {
    const anomes = oracleNumber(raw, "anomes");
    const valor = oracleNumber(raw, "valor") ?? 0;
    if (anomes == null || !valor) continue;
    if (anomes < anomesFrom || anomes > anomesTo) continue;
    const index = anomesToIndex(anomes, startYear);
    if (index == null) continue;
    const sheetName = matchSheetName(
      oracleNumber(raw, "negocio"),
      oracleNumber(raw, "processo"),
      oracleNumber(raw, "subprocesso"),
    );
    const sheet = sheetName ? sheetByName.get(sheetName) : undefined;
    if (!sheet) continue;
    const objectKey = costObjectKey(oracleText(raw, "cod_objetocusto") || oracleNumber(raw, "cod_objetocusto"));
    const mapKey = `${sheet.id}::${objectKey}`;
    const row = realizadoMap.get(mapKey) ?? {
      sheetId: sheet.id,
      sheetTitle: sheet.title,
      key: objectKey,
      label: objectLabels.get(objectKey) ?? (objectKey === "none" ? "Sem objeto de custo" : objectKey),
      months: zeros(),
    };
    row.months[index] = money(row.months[index] + valor);
    realizadoMap.set(mapKey, row);
  }

  const realizadoByObject = [...realizadoMap.values()];
  const unitsBySheet = await fetchUnRealizadoUnitsBySheet(harvestId).catch(
    () => [] as { sheetId: number; units: number }[],
  );
  const summaryRaw = aggregateCompare(contributions, realizadoByObject, [], realizadoByActivity);
  const summary = applyStoredOrcadoForSafra(summaryRaw, harvestId);
  const safraRows = buildSafraCompare(contributions, oracleRows, currentSafraId(), sheetByName);

  return {
    months: MONTHS,
    safraId: harvestId,
    anomesFrom,
    anomesTo,
    safraLabel: safra?.label ?? `Safra ${startYear}/${startYear + 1}`,
    contributions,
    realizadoByObject,
    realizadoByActivity,
    unitsBySheet,
    ...summary,
    grupoGasto,
    grupoGastoAgricola,
    views: {
      ...summary.views,
      safra: safraRows,
    },
  };
}
