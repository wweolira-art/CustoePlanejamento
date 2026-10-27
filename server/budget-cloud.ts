import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { loadEnvFile } from "./env.js";
import { initializeBudgetMemory } from "./budget-memory.js";
import type { Request, Response, NextFunction } from "express";
import { buildMigration, type MigrationPayload } from "./supabase-migration.js";
import { supabaseRuntimeRequest, supabaseRequest, type BudgetTable } from "./supabase.js";

// Somente planejamento. Login, permissões, colheita e contratos mantêm seu fluxo.
export const BUDGET_LOCAL_TABLES = [
  "sheets", "cells", "categories", "lines", "line_months", "meta",
  "activities", "materials", "cost_objects", "calc_rules", "calc_params",
  "safras", "category_catalog", "premissa_values", "premissa_subprocesses",
  "premissa_copies", "seed_radius_tariffs", "value_distributions",
  "value_distribution_lines", "calc_param_cost_objects", "premissa_cells",
  "sheet_verifications", "line_safra_prices", "harvest_areas", "fazendas",
  "safra_kpis", "safra_budget_breakdown", "empenhos", "activity_realizado_links",
  "un_realizado_sources", "un_realizado_operations", "parametros_tecnicos",
  "custo_colheita_local",
] as const;

export type CloudState = { format: 1; namespace: string; initialSafra: number; activeBudgetId?: string; tables: Record<string, any[]> };
type RemoteState = { revisao: number; estado: CloudState };
let bootState: RemoteState | undefined;
let budgetBootstrapStarted = false;

export function budgetCloudEnabled() {
  return process.env.BUDGET_STORAGE === "supabase";
}

export function captureBudgetState(db: Database.Database): Record<string, any[]> {
  const present = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table' UNION SELECT name FROM sqlite_temp_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name));
  return Object.fromEntries(BUDGET_LOCAL_TABLES.filter((table) => present.has(table)).map((table) => [table, db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()]));
}

export function restoreBudgetState(db: Database.Database, tables: Record<string, any[]>) {
  const allowed = new Set<string>(BUDGET_LOCAL_TABLES);
  for (const [table, rows] of Object.entries(tables)) {
    if (!allowed.has(table) || !Array.isArray(rows)) throw new Error("Estado remoto de orçamento inválido.");
    const cols = new Set((db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name));
    if (!cols.size) throw new Error(`Atualize a base de cálculo: tabela ${table} ausente.`);
    const unknown = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((column) => !cols.has(column));
    if (unknown.length) throw new Error(`Colunas de ${table} incompatíveis: ${unknown.join(", ")}. Atualize o aplicativo com git pull e reinicie a API.`);
  }
  const foreignKeys = db.pragma("foreign_keys", { simple: true });
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      for (const table of Object.keys(tables).reverse()) db.prepare(`DELETE FROM "${table}"`).run();
      for (const [table, rows] of Object.entries(tables)) {
        if (!rows.length) continue;
        const keys = Object.keys(rows[0]);
        if (keys.some((k) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k))) throw new Error("Coluna inválida no estado remoto.");
        const insert = db.prepare(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`);
        for (const row of rows) insert.run(...keys.map((k) => row[k] ?? null));
      }
    })();
  } finally { if (foreignKeys) db.pragma("foreign_keys = ON"); }
}

export async function readCloudBudget(): Promise<RemoteState | undefined> {
  const rows = await supabaseRuntimeRequest<RemoteState[]>("orcamento_aplicativo_estado", undefined, new URLSearchParams({ id: "eq.principal", select: "revisao,estado" }));
  const row = rows[0];
  if (row && (row.estado?.format !== 1 || !row.estado.namespace || !row.estado.tables)) throw new Error("Formato do orçamento remoto incompatível.");
  return row;
}

/** Resolve o caminho do banco sem deixar o início da API dependente da rede. */
export async function prepareBudgetCache(defaultPath: string): Promise<string> {
  loadEnvFile();
  if (process.env.PLANEJAMENTO_DB_PATH) return resolve(process.env.PLANEJAMENTO_DB_PATH);
  if (!budgetCloudEnabled()) return defaultPath;
  return resolve(dirname(defaultPath), "local-settings.db");
}

export function loadBudgetMemory(db: Database.Database) {
  if (!budgetCloudEnabled()) return;
  initializeBudgetMemory(db);
  if (bootState) restoreBudgetState(db, bootState.estado.tables);
}

/** Carrega o estado remoto em segundo plano, mantendo a API viva durante falhas de rede. */
export function startBudgetBootstrap(db: Database.Database) {
  if (!budgetCloudEnabled() || budgetBootstrapStarted) return;
  budgetBootstrapStarted = true;
  let retry = 0;
  void (async () => {
    while (!bootState) {
      try {
        const remote = await readCloudBudget();
        if (!remote) throw new Error("Execute a ativação do Supabase antes de iniciar neste modo.");
        restoreBudgetState(db, remote.estado.tables);
        bootState = remote;
        console.info(`[api] Orçamento carregado do Supabase (revisão ${remote.revisao}).`);
      } catch (error) {
        retry += 1;
        const delayMs = Math.min(30_000, 2_000 * 2 ** Math.min(retry - 1, 4));
        const message = error instanceof Error ? error.message : "Falha ao carregar o orçamento remoto.";
        console.error(`[api] Supabase indisponível; nova tentativa em ${Math.round(delayMs / 1000)}s. ${message}`);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
      }
    }
  })();
}

const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])])) : value;
export const stateHash = (tables: Record<string, any[]>) => createHash("sha256").update(JSON.stringify(canonical(tables))).digest("hex");

export async function remoteTables(fetcher: typeof supabaseRequest = supabaseRequest): Promise<MigrationPayload> {
  const result: MigrationPayload = {};
  const pending = [...["safras", "centros_custo", "categorias", "materiais", "atividades", "objetos_custo", "fazendas", "orcamentos", "orcamento_centros", "orcamento_categorias", "orcamento_premissas", "orcamento_itens", "orcamento_item_meses", "orcamento_item_planos"] as BudgetTable[]];
  let stopped = false;
  const worker = async () => {
    while (!stopped && pending.length) {
      const table = pending.shift()!;
      try {
        const rows: any[] = [];
        for (let offset = 0; ; offset += 500) {
          const page = await fetcher<any[]>(table, { query: new URLSearchParams({ select: "*", order: table === "orcamento_item_meses" ? "item_id,competencia" : "id", offset: String(offset), limit: "500" }) });
          rows.push(...page);
          if (page.length < 500) break;
        }
        result[table] = rows;
      } catch (error) { stopped = true; throw error; }
    }
  };
  // Consultas independentes em paralelo, com limite para a instância gratuita.
  const completed = await Promise.allSettled(Array.from({ length: 4 }, worker));
  const failed = completed.find((item) => item.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return result;
}

export function normalizedChanges(plan: ReturnType<typeof buildMigration>, existing: MigrationPayload) {
  const changes: MigrationPayload = {};
  const remove: Partial<Record<BudgetTable, string[]>> = {};
  for (const parent of plan.parents) plan.payload.orcamento_itens!.find((r) => r.id === parent.id)!.item_pai_id = parent.parent;
  const key = (r: any, table: string) => table === "orcamento_item_meses" ? `${r.item_id}:${r.competencia}` : r.id;
  for (const [name, expected] of Object.entries(plan.payload)) {
    const table = name as BudgetTable;
    if (table === "orcamento_item_plano_meses") continue;
    const actual = new Map((existing[table] ?? []).map((r) => [key(r, table), r]));
    changes[table] = expected.filter((row) => {
      const old = actual.get(key(row, table));
      if (table === "orcamentos" && old) {
        // Preservar status, autoria e observações: importar não aprova/reabre versões.
        row.status = old.status;
        row.observacoes = old.observacoes;
      }
      return !old || Object.entries(row).some(([field, value]) => typeof value === "number" && typeof old[field] === "number" ? Math.abs(old[field] - value) > 0.000001 : JSON.stringify(canonical(old[field])) !== JSON.stringify(canonical(value)));
    });
  }
  const centerIds = new Set((existing.orcamento_centros ?? []).filter((r) => r.orcamento_id === plan.budgetId).map((r) => r.id));
  const catIds = new Set((existing.orcamento_categorias ?? []).filter((r) => centerIds.has(r.orcamento_centro_id)).map((r) => r.id));
  const itemIds = new Set((existing.orcamento_itens ?? []).filter((r) => catIds.has(r.orcamento_categoria_id)).map((r) => r.id));
  const scopes: Partial<Record<BudgetTable, (r: any) => boolean>> = {
    orcamento_centros: (r) => r.orcamento_id === plan.budgetId,
    orcamento_categorias: (r) => centerIds.has(r.orcamento_centro_id),
    orcamento_itens: (r) => itemIds.has(r.id),
    orcamento_premissas: (r) => r.orcamento_id === plan.budgetId,
    orcamento_item_planos: (r) => itemIds.has(r.item_id),
  };
  for (const [name, scope] of Object.entries(scopes)) {
    const table = name as BudgetTable;
    const keep = new Set((plan.payload[table] ?? []).map((r) => r.id));
    remove[table] = (existing[table] ?? []).filter((r) => scope(r) && !keep.has(r.id)).map((r) => r.id);
  }
  return { changes, remove };
}

export async function persistCloudBudget(state: CloudState, revision: number, snapshot: any, user?: number) {
  const existing = await remoteTables();
  const namespace = snapshot.currentSafraId === state.initialSafra ? state.namespace : `${state.namespace}:safra:${snapshot.currentSafraId}`;
  const plan = buildMigration({ ...snapshot, sourceSha256: namespace }, existing, true);
  const budget = existing.orcamentos?.find((r) => r.id === plan.budgetId);
  if (budget && budget.status !== "rascunho") throw new Error("Esta versão não está em rascunho e não pode ser editada.");
  const { changes, remove } = normalizedChanges(plan, existing);
  const result = await supabaseRuntimeRequest<{ revisao: number }>("rpc/salvar_orcamento_aplicativo", { revisao_esperada: revision, novo_estado: { ...state, activeBudgetId: plan.budgetId }, alteracoes: changes, remover: remove, usuario: user ?? null });
  return result.revisao;
}

export function budgetPath(path: string) {
  return /^\/api\/(?:sheets|lines|categories|premissas|safras|calc-rules|distributions|activities|materials|cost-objects|fazendas|category-catalog|areas|seed-radius-tariffs|activity-links|un-realizado-sources|funcionario-orcamento|orcado-realizado)(?:\/|$)/.test(path)
    || ["/api/dashboard", "/api/resumo", "/api/orcado-realizado", "/api/externo/orcamento", "/api/reset", "/api/ficha-estagio", "/api/parametros-tecnicos", "/api/parametros-tecnicos/periodos", "/api/custo-colheita", "/api/parametros-tecnicos/extrair", "/api/empenhos", "/api/empenhos/import-oracle"].includes(path);
}

export class BudgetCloudController {
  private revision: number;
  private state: CloudState;
  private queue: Promise<void> = Promise.resolve();
  private refreshQueue: Promise<void> = Promise.resolve();
  private activeMutation = false;
  constructor(private db: Database.Database, initial: RemoteState, private snapshot: () => any, private invalidate: () => void, private authenticate: (req: Request) => { id: number } | null, private transport = {
    revision: async () => {
      const rows = await supabaseRuntimeRequest<{ revisao: number }[]>("orcamento_aplicativo_estado", undefined, new URLSearchParams({ id: "eq.principal", select: "revisao" }));
      if (!rows[0]) throw new Error("Estado remoto do orçamento não encontrado.");
      return Number(rows[0].revisao);
    },
    load: readCloudBudget,
    save: persistCloudBudget,
  }) {
    this.revision = initial.revisao;
    this.state = initial.estado;
  }
  private async refresh(mutation = false) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.refreshQueue;
    this.refreshQueue = previous.then(() => gate);
    await previous;
    try {
      // Uma leitura não restaura a base durante uma gravação. A próxima
      // atualização buscará a revisão remota depois do commit ou rollback.
      if (this.activeMutation && !mutation) return;
      const revision = await this.transport.revision();
      if (revision !== this.revision) {
        const latest = await this.transport.load();
        if (!latest) throw new Error("Estado remoto do orçamento não encontrado.");
        restoreBudgetState(this.db, latest.estado.tables);
        this.state = latest.estado;
        this.revision = Number(latest.revisao);
        this.invalidate();
      }
      if (mutation) this.activeMutation = true;
    } finally {
      release();
    }
  }
  middleware = (req: Request, res: Response, next: NextFunction) => {
    if (!budgetPath(req.path)) return next();
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    let release!: () => void;
    const previous = this.queue;
    if (mutation) {
      const gate = new Promise<void>((done) => { release = done; });
      this.queue = previous.then(() => gate);
    }
    void (async () => {
      if (mutation) await previous;
      const originalJson = res.json.bind(res);
      const user = this.authenticate(req);
      if (!user) {
        if (mutation) release();
        originalJson.call(res.status(401), { error: "Sessão expirada ou inválida." });
        return;
      }
      let routeStarted = false;
      res.once("close", () => {
        // Leituras não alteram o estado local. Se o cliente cancelar uma leitura
        // longa, libere a fila para os próximos pedidos do orçamento.
        if (!mutation && routeStarted && !res.writableFinished) this.invalidate();
      });
      let baseline: Record<string, any[]>;
      try {
        await this.refresh(mutation);
        if (mutation) baseline = captureBudgetState(this.db);
      } catch {
        if (mutation) { this.activeMutation = false; release(); }
        originalJson.call(res.status(503), { error: "Não foi possível carregar o orçamento no Supabase. Tente novamente." });
        return;
      }
      routeStarted = true;
      if (res.destroyed) { if (mutation) { this.activeMutation = false; release(); } return; }
      let responded = false;
      res.json = ((body: any) => {
        if (responded) return res;
        responded = true;
        void (async () => {
          try {
            if (!mutation) {
              originalJson(body);
              return;
            }
            if (res.statusCode >= 400) {
              restoreBudgetState(this.db, baseline);
              this.invalidate();
            } else {
              const snapshot = this.snapshot();
              const current = captureBudgetState(this.db);
              if (stateHash(current) !== stateHash(baseline)) {
                const updated = { ...this.state, tables: current };
                this.revision = await this.transport.save(updated, this.revision, snapshot, user.id);
                this.state = updated;
              }
            }
            originalJson(body);
          } catch (error) {
            restoreBudgetState(this.db, baseline);
            this.invalidate();
            res.removeHeader("Content-Length");
            originalJson.call(res.status(503), { error: error instanceof Error ? error.message : "Não foi possível confirmar a gravação no Supabase." });
          } finally {
            if (mutation) {
              this.activeMutation = false;
              release();
            }
          }
        })();
        return res;
      }) as Response["json"];
      if (mutation) res.once("finish", () => {
        if (!responded) {
          restoreBudgetState(this.db, baseline);
          this.invalidate();
          this.activeMutation = false;
          release();
        }
      });
      // Escritas mantêm a fila até o commit, mesmo se o cliente desconectar.
      next();
    })().catch(() => {
      if (mutation) {
        this.activeMutation = false;
        release();
      }
      if (!res.headersSent) res.status(503).json({ error: "Persistência do orçamento indisponível." });
    });
  };
}

export function budgetBootState() { return bootState; }
