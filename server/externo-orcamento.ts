import { db } from "./db.js";
import { resumo } from "./calc.js";
import { listReportSubprocesses } from "./auto-calc.js";
import { aggregateResumo } from "../src/lib/reportAggregate.ts";
import {
  breakdownForSafra,
  ensureSafraKpis,
  moagemFromPremissa,
  type BudgetBreakdownRow,
  type StoredSafraKpi,
} from "./safra-kpis.js";
import { currentSafraId, listSafras, resolveSafraId, safraStartYear } from "./safras.js";

function loadStoredKpi(safraId: number): StoredSafraKpi | undefined {
  ensureSafraKpis();
  return db
    .prepare(
      `SELECT safra_id, orcamento_total, moagem, updated_at, cost_centers_json, categories_json
         FROM safra_kpis WHERE safra_id = ?`,
    )
    .get(safraId) as StoredSafraKpi | undefined;
}

function buildFromLive(safraId: number) {
  const summary = resumo();
  const labels = listReportSubprocesses(safraId);
  const labeled = aggregateResumo(summary.contributions ?? [], labels);

  return {
    safraId,
    safraCode: listSafras().find((s) => s.id === safraId)?.code ?? null,
    safraLabel: listSafras().find((s) => s.id === safraId)?.label ?? null,
    orcamentoTotal: labeled.total,
    moagem: moagemFromPremissa(safraId) || null,
    source: "live" as const,
    centrosCusto: labeled.views.costCenter.map((row) => ({
      key: row.key,
      label: row.label,
      total: row.total,
    })),
    categorias: labeled.views.category.map((row) => ({
      key: row.key,
      label: row.label,
      total: row.total,
    })),
    updatedAt: new Date().toISOString(),
  };
}

function buildFromSnapshot(safraId: number, stored: StoredSafraKpi | undefined) {
  const safra = listSafras().find((s) => s.id === safraId);
  const centros: BudgetBreakdownRow[] = breakdownForSafra(stored, "cost_center");
  const categorias: BudgetBreakdownRow[] = breakdownForSafra(stored, "category");
  const moagem =
    Number(stored?.moagem) > 0 ? Number(stored?.moagem) : moagemFromPremissa(safraId);

  return {
    safraId,
    safraCode: safra?.code ?? null,
    safraLabel: safra?.label ?? null,
    orcamentoTotal: Number(stored?.orcamento_total) || centros.reduce((s, r) => s + r.total, 0),
    moagem: moagem || null,
    source: "snapshot" as const,
    centrosCusto: centros,
    categorias,
    updatedAt: stored?.updated_at ?? null,
    aviso:
      stored?.orcamento_total != null
        ? null
        : "Orçamento não consolidado para esta safra. Troque para ela no sistema ou recalcule o dashboard.",
  };
}

/** Orçamento por safra — uso externo (IA, integrações). */
export function getOrcamentoExterno(safraId?: number | null) {
  const id = resolveSafraId(safraId);
  const safra = listSafras().find((s) => s.id === id);
  if (!safra) throw new Error("Safra não encontrada.");

  if (id === currentSafraId()) {
    return buildFromLive(id);
  }

  const stored = loadStoredKpi(id);
  if (stored && Number(stored.orcamento_total) > 0) {
    return buildFromSnapshot(id, stored);
  }

  return {
    ...buildFromSnapshot(id, stored),
    aviso:
      "Não há snapshot salvo desta safra. Use safraId da safra atual ou troque a safra ativa antes de consolidar.",
  };
}

export function anomesRangeForSafra(safraId?: number | null) {
  const id = resolveSafraId(safraId);
  const row = db.prepare("SELECT code FROM safras WHERE id = ?").get(id) as { code: string } | undefined;
  const startYear = row ? safraStartYear(row.code) : new Date().getFullYear();
  return {
    safraId: id,
    safraCode: row?.code ?? null,
    anomesInicio: String(startYear * 100 + 9),
    anomesFim: String((startYear + 1) * 100 + 8),
  };
}
