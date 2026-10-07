import { db } from "./db.js";
import { listSafras, resolveSafraId, safraStartYear } from "./safras.js";

export type BudgetBreakdownKind = "cost_center" | "category";

export type BudgetBreakdownRow = {
  key: string;
  label: string;
  total: number;
};

export type SafraBudgetSnapshot = {
  safraId: number;
  orcamentoTotal: number;
  moagem: number;
  costCenters: BudgetBreakdownRow[];
  category: BudgetBreakdownRow[];
};

function parseMonthsJson(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 12) return null;
    return parsed.map((value) => Number(value) || 0);
  } catch {
    return null;
  }
}

function sumMonths(months: number[] | null | undefined) {
  return (months ?? []).reduce((sum, value) => sum + (value || 0), 0);
}

function parseBreakdownJson(raw: string | null | undefined): BudgetBreakdownRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        const item = row as { key?: unknown; label?: unknown; total?: unknown };
        return {
          key: String(item.key ?? "").trim() || "none",
          label: String(item.label ?? "").trim() || "Sem classificação",
          total: Number(item.total) || 0,
        };
      })
      .filter((row) => row.total > 0);
  } catch {
    return [];
  }
}

export function ensureSafraKpis() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS safra_kpis (
      safra_id INTEGER PRIMARY KEY REFERENCES safras(id) ON DELETE CASCADE,
      orcamento_total REAL NOT NULL DEFAULT 0,
      moagem REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
  try {
    db.exec("ALTER TABLE safra_kpis ADD COLUMN cost_centers_json TEXT");
  } catch {
    /* já existe */
  }
  try {
    db.exec("ALTER TABLE safra_kpis ADD COLUMN categories_json TEXT");
  } catch {
    /* já existe */
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS safra_budget_breakdown (
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('subprocess', 'category', 'cost_center')),
      item_key TEXT NOT NULL,
      item_label TEXT NOT NULL,
      total REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (safra_id, kind, item_key)
    );
  `);
  migrateSafraBudgetBreakdownKind();
}

/** Tabelas antigas só aceitavam subprocess|category; o painel grava cost_center. */
function migrateSafraBudgetBreakdownKind() {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'safra_budget_breakdown'")
    .get() as { sql: string } | undefined;
  const sql = row?.sql ?? "";
  if (!sql.includes("CHECK") || sql.includes("'cost_center'")) return;

  db.exec(`
    CREATE TABLE safra_budget_breakdown__new (
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('subprocess', 'category', 'cost_center')),
      item_key TEXT NOT NULL,
      item_label TEXT NOT NULL,
      total REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (safra_id, kind, item_key)
    );
    INSERT INTO safra_budget_breakdown__new (safra_id, kind, item_key, item_label, total)
    SELECT safra_id, kind, item_key, item_label, total FROM safra_budget_breakdown;
    DROP TABLE safra_budget_breakdown;
    ALTER TABLE safra_budget_breakdown__new RENAME TO safra_budget_breakdown;
  `);
}

function normalizeBreakdown(rows: BudgetBreakdownRow[] | undefined) {
  return (rows ?? [])
    .map((row) => ({
      key: String(row.key ?? "").trim() || "none",
      label: String(row.label ?? "").trim() || "Sem classificação",
      total: Number(row.total) || 0,
    }))
    .filter((row) => row.total > 0);
}

export function saveSafraKpis(
  safraId: number,
  orcamentoTotal: number,
  moagem: number,
  breakdown?: { costCenters?: BudgetBreakdownRow[]; category?: BudgetBreakdownRow[] },
) {
  ensureSafraKpis();
  const id = resolveSafraId(safraId);
  const now = new Date().toISOString();
  const centers = normalizeBreakdown(breakdown?.costCenters);
  const categories = normalizeBreakdown(breakdown?.category);
  const tx = db.transaction(() => {
    if (breakdown) {
      db.prepare(
        `INSERT INTO safra_kpis (
           safra_id, orcamento_total, moagem, updated_at, cost_centers_json, categories_json
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(safra_id) DO UPDATE SET
           orcamento_total = excluded.orcamento_total,
           moagem = excluded.moagem,
           updated_at = excluded.updated_at,
           cost_centers_json = excluded.cost_centers_json,
           categories_json = excluded.categories_json`,
      ).run(
        id,
        orcamentoTotal || 0,
        moagem || 0,
        now,
        JSON.stringify(centers),
        JSON.stringify(categories),
      );

      db.prepare("DELETE FROM safra_budget_breakdown WHERE safra_id = ?").run(id);
      const ins = db.prepare(
        `INSERT INTO safra_budget_breakdown (safra_id, kind, item_key, item_label, total)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const row of centers) {
        ins.run(id, "cost_center", row.key, row.label, row.total);
      }
      for (const row of categories) {
        ins.run(id, "category", row.key, row.label, row.total);
      }
    } else {
      db.prepare(
        `INSERT INTO safra_kpis (safra_id, orcamento_total, moagem, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(safra_id) DO UPDATE SET
           orcamento_total = excluded.orcamento_total,
           moagem = excluded.moagem,
           updated_at = excluded.updated_at`,
      ).run(id, orcamentoTotal || 0, moagem || 0, now);
    }
  });
  tx();
}

export function moagemFromPremissa(safraId: number) {
  const rows = db
    .prepare(
      `SELECT subprocess_key, months, qty
         FROM premissa_values
        WHERE safra_id = ?
          AND subprocess_key IN ('tons', 'tonsManual')`,
    )
    .all(safraId) as { subprocess_key: string; months: string | null; qty: number | null }[];
  let total = 0;
  for (const row of rows) {
    const fromMonths = sumMonths(parseMonthsJson(row.months));
    total += fromMonths > 0 ? fromMonths : Number(row.qty) || 0;
  }
  return total;
}

export type StoredSafraKpi = {
  safra_id: number;
  orcamento_total: number;
  moagem: number;
  updated_at: string;
  cost_centers_json: string | null;
  categories_json: string | null;
};

function loadStoredKpis() {
  ensureSafraKpis();
  return db
    .prepare(
      `SELECT safra_id, orcamento_total, moagem, updated_at, cost_centers_json, categories_json
         FROM safra_kpis`,
    )
    .all() as StoredSafraKpi[];
}

export function storedSafraKpi(safraId: number) {
  return loadStoredKpis().find((row) => row.safra_id === safraId);
}

function loadBreakdownFallback(safraId: number, kind: BudgetBreakdownKind | "subprocess") {
  return (
    db
      .prepare(
        `SELECT item_key, item_label, total
           FROM safra_budget_breakdown
          WHERE safra_id = ? AND kind = ?`,
      )
      .all(safraId, kind) as { item_key: string; item_label: string; total: number }[]
  ).map((row) => ({
    key: row.item_key,
    label: row.item_label,
    total: Number(row.total) || 0,
  }));
}

export function breakdownForSafra(row: StoredSafraKpi | undefined, kind: BudgetBreakdownKind): BudgetBreakdownRow[] {
  if (!row) return [];
  if (kind === "cost_center") {
    const fromJson = parseBreakdownJson(row.cost_centers_json);
    if (fromJson.length) return fromJson;
    const fromTable = loadBreakdownFallback(row.safra_id, "cost_center");
    if (fromTable.length) return fromTable;
    return loadBreakdownFallback(row.safra_id, "subprocess");
  }
  const fromJson = parseBreakdownJson(row.categories_json);
  if (fromJson.length) return fromJson;
  return loadBreakdownFallback(row.safra_id, "category");
}

export function listSafraCostPerTon(current?: SafraBudgetSnapshot) {
  if (current) {
    saveSafraKpis(current.safraId, current.orcamentoTotal, current.moagem, {
      costCenters: current.costCenters,
      category: current.category,
    });
  }

  const stored = new Map(loadStoredKpis().map((row) => [row.safra_id, row] as const));

  return listSafras()
    .map((safra) => {
      const row = stored.get(safra.id);
      const moagem =
        current && safra.id === current.safraId
          ? current.moagem
          : Number(row?.moagem) > 0
            ? Number(row?.moagem)
            : moagemFromPremissa(safra.id);
      const orcamentoTotal =
        current && safra.id === current.safraId
          ? current.orcamentoTotal
          : Number(row?.orcamento_total) || 0;
      const costPerTon = moagem > 0 && orcamentoTotal > 0 ? orcamentoTotal / moagem : null;
      return {
        safraId: safra.id,
        code: safra.code,
        label: safra.label,
        moagem,
        orcamentoTotal,
        costPerTon,
        current: current ? safra.id === current.safraId : false,
        year: safraStartYear(safra.code),
      };
    })
    .filter((row) => row.moagem > 0 || row.orcamentoTotal > 0 || row.current)
    .sort((a, b) => a.year - b.year);
}

export function listSafraBudgetCompare(current?: SafraBudgetSnapshot) {
  const costPerTonBySafra = listSafraCostPerTon(current);
  const safras = costPerTonBySafra.filter((row) => row.orcamentoTotal > 0 || row.current);
  const stored = new Map(loadStoredKpis().map((row) => [row.safra_id, row] as const));

  const buildRows = (kind: BudgetBreakdownKind, live?: BudgetBreakdownRow[]) => {
    const totals = new Map<string, { key: string; label: string; bySafra: Record<string, number> }>();
    const add = (safraId: number, key: string, label: string, total: number) => {
      if (!(total > 0)) return;
      if (!safras.some((row) => row.safraId === safraId)) return;
      const id = String(safraId);
      const currentRow = totals.get(key) ?? { key, label, bySafra: {} };
      currentRow.bySafra[id] = (currentRow.bySafra[id] ?? 0) + total;
      if (!currentRow.label || currentRow.label === key) currentRow.label = label;
      totals.set(key, currentRow);
    };

    for (const safra of safras) {
      if (current && safra.safraId === current.safraId && live) {
        for (const row of live) add(safra.safraId, row.key, row.label, row.total);
        continue;
      }
      for (const row of breakdownForSafra(stored.get(safra.safraId), kind)) {
        add(safra.safraId, row.key, row.label, row.total);
      }
    }

    return [...totals.values()]
      .map((row) => {
        const values = safras.map((safra) => row.bySafra[String(safra.safraId)] ?? 0);
        return {
          key: row.key,
          label: row.label,
          bySafra: row.bySafra,
          values,
          total: values.reduce((sum, value) => sum + value, 0),
        };
      })
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total);
  };

  return {
    safras,
    costCenter: buildRows("cost_center", current?.costCenters),
    category: buildRows("category", current?.category),
  };
}
