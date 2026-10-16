import { createHash } from "node:crypto";
import type { BudgetTable } from "./supabase.js";

export function migrationUuid(namespace: string, key: string) {
  const hex = createHash("sha256").update(`${namespace}:${key}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "8";
  const text = hex.join("");
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

export function safraDates(code: string) {
  const match = code.match(/^(\d{2}|\d{4})\/(\d{2}|\d{4})$/);
  if (!match) throw new Error(`Código de safra inválido: ${code}`);
  const year = match[1].length === 2 ? (Number(match[1]) >= 90 ? 1900 : 2000) + Number(match[1]) : Number(match[1]);
  const end = match[2].length === 2 ? (year + 1) % 100 : year + 1;
  if (Number(match[2]) !== end) throw new Error(`Anos de safra inválidos: ${code}`);
  return { year, inicio: `${year}-09-01`, fim: `${year + 1}-08-31` };
}

export function migrationCompetencia(year: number, month: number) {
  if (!Number.isInteger(month) || month < 0 || month > 11) throw new Error("Mês da safra inválido");
  const offset = 8 + month;
  return `${year + Math.floor(offset / 12)}-${String((offset % 12) + 1).padStart(2, "0")}-01`;
}

export function migrationMoney(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("Valor monetário não finito na migração");
  return Number(n.toFixed(2));
}

type Row = Record<string, any>;
export type MigrationPayload = Partial<Record<BudgetTable, Row[]>>;

/** Snapshot gerado pelo motor atual em uma cópia consistente do SQLite. */
export function buildMigration(snapshot: any, existing: MigrationPayload, updateCatalogs = false) {
  if (snapshot.formulaErrors.length) throw new Error("Existem erros de fórmula no snapshot.");
  const id = (key: string) => migrationUuid(snapshot.sourceSha256, key);
  const payload: MigrationPayload = {};
  const warnings: string[] = [];
  const maps: Record<string, Map<any, string>> = {};
  const catalog = (target: BudgetTable, source: Row[], key: string, mapRow: (row: Row) => Row) => {
    const rows: Row[] = [];
    const map = new Map<any, string>();
    const byKey = new Map((existing[target] ?? []).map((r) => [r[key], r.id]));
    for (const raw of source) {
      const row = mapRow(raw);
      let uuid = byKey.get(row[key]);
      if (!uuid) {
        uuid = id(`${target}:${row[key]}`);
        rows.push({ id: uuid, ...row });
        byKey.set(row[key], uuid);
      } else if (updateCatalogs) {
        rows.push({ id: uuid, ...row });
      }
      map.set(raw.id, uuid);
    }
    maps[target] = map;
    payload[target] = rows;
  };
  const t = snapshot.tables;
  catalog("safras", t.safras, "codigo", (r) => {
    const dates = safraDates(r.code);
    return { codigo: r.code, descricao: r.label, data_inicio: dates.inicio, data_fim: dates.fim };
  });
  catalog("materiais", t.materials, "codigo", (r) => ({ codigo: r.code, descricao: r.description, tipo: r.tipo, grupo: r.grupo ?? null, empenho: r.empenho ?? null, preco_referencia: r.valor ?? null }));
  catalog("atividades", t.activities, "codigo", (r) => ({ codigo: r.code, descricao: r.description, empenho: r.empenho ?? null, preco_referencia: r.valor ?? null }));
  catalog("objetos_custo", t.cost_objects, "codigo", (r) => ({ codigo: r.code, descricao: r.description }));
  catalog("fazendas", t.fazendas, "codigo", (r) => ({ codigo: r.code, descricao: r.description, distancia_km: r.distancia ?? null }));
  const centers = t.sheets.filter((s: Row) => s.kind === "cost_center");
  catalog("centros_custo", centers, "codigo", (r) => ({ codigo: r.name, descricao: r.title }));
  const categories = t.categories.filter((c: Row) => centers.some((s: Row) => s.id === c.sheet_id));
  catalog("categorias", categories, "nome", (r) => ({ nome: r.name }));
  const safra = t.safras.find((s: Row) => s.id === snapshot.currentSafraId);
  if (!safra) throw new Error("Safra atual não encontrada");
  const dates = safraDates(safra.code);
  const budgetId = id("orcamento:current");
  const existingBudget = (existing.orcamentos ?? []).find((b) => b.id === budgetId);
  const versions = (existing.orcamentos ?? []).filter((b) => b.safra_id === maps.safras.get(safra.id)).map((b) => b.versao);
  const version = existingBudget?.versao ?? Math.max(0, ...versions) + 1;
  const metadata = { migration: snapshot.sourceSha256, state: "uploading", source: "SQLite", safra: safra.code, detailedSafraOnly: true, capturedAt: snapshot.createdAt };
  payload.orcamentos = [{ id: budgetId, safra_id: maps.safras.get(safra.id), nome: `Migração SQLite — ${safra.label}`, versao: version, status: "rascunho", observacoes: JSON.stringify(metadata) }];
  payload.orcamento_centros = centers.map((s: Row) => ({ id: id(`center:${s.id}`), orcamento_id: budgetId, centro_custo_id: maps.centros_custo.get(s.id), ordem: s.sort_order, visivel: !!s.visible, conferido: (t.sheet_verifications ?? []).some((v: Row) => v.sheet_id === s.id && v.safra_id === safra.id) }));
  payload.orcamento_categorias = categories.map((c: Row) => ({ id: id(`category:${c.id}`), orcamento_centro_id: id(`center:${c.sheet_id}`), categoria_id: maps.categorias.get(c.id), ordem: c.sort_order }));
  const premiseRows = new Map<string, Row>();
  for (const p of snapshot.premises.subprocesses) {
    const stored = (t.premissa_values ?? []).find((v: Row) => v.safra_id === safra.id && v.subprocess_key === p.key);
    premiseRows.set(p.key, { id: id(`premise:${p.key}`), orcamento_id: budgetId, chave: p.key, descricao: p.name, unidade: p.suffix || null, quantidade: stored?.qty ?? p.qty.value, data_inicio: stored?.start_day || p.start.value || null, data_fim: stored?.end_day || p.end.value || null });
  }
  for (const p of (t.premissa_values ?? []).filter((r: Row) => r.safra_id === safra.id)) {
    if (!premiseRows.has(p.subprocess_key)) premiseRows.set(p.subprocess_key, { id: id(`premise:${p.subprocess_key}`), orcamento_id: budgetId, chave: p.subprocess_key, descricao: p.subprocess_key, quantidade: p.qty, data_inicio: p.start_day || null, data_fim: p.end_day || null });
  }
  payload.orcamento_premissas = [...premiseRows.values()];
  payload.orcamento_itens = [];
  payload.orcamento_item_meses = [];
  payload.orcamento_item_planos = [];
  payload.orcamento_item_plano_meses = [];
  const parents: { id: string; parent: string }[] = [];
  const expectedCenters: Row[] = [];
  for (const sheet of snapshot.sheets) {
    const roots: string[] = [];
    for (const category of sheet.categories) for (const line of category.lines) {
      const original = t.lines.find((l: Row) => l.id === line.id);
      if (!original) throw new Error("Item calculado sem linha original");
      const itemId = id(`line:${line.id}`);
      const ref: Record<string, string> = { material: "material", activity: "atividade", cost_object: "objeto_custo", cost_center: "centro_custo" };
      const material = maps.materiais.get(original.material_id) ?? null;
      const activity = maps.atividades.get(original.activity_id) ?? null;
      const object = maps.objetos_custo.get(line.cost_object_id) ?? null;
      const center = original.center_sheet_id ? id(`center:${original.center_sheet_id}`) : null;
      let kind = ref[original.ref_kind] ?? null;
      if ((kind === "material" && !material) || (kind === "atividade" && !activity) || (kind === "objeto_custo" && !object) || (kind === "centro_custo" && !center)) {
        warnings.push(`Item ${line.id}: referência sem cadastro; preservada integralmente na configuração legada.`);
        kind = null;
      }
      let employeeConfig = {};
      if (original.funcionario_api_config) employeeConfig = JSON.parse(original.funcionario_api_config);
      payload.orcamento_itens.push({ id: itemId, orcamento_categoria_id: id(`category:${category.id}`), item_pai_id: null, descricao: line.description, tipo_referencia: kind, eh_grupo: !!line.is_group, ordem: original.sort_order, material_id: material, atividade_id: activity, objeto_custo_id: object, centro_referencia_id: center, usar_calculo_automatico: original.use_activity_auto !== 0, configuracao_funcionarios: employeeConfig });
      if (line.parent_id) parents.push({ id: itemId, parent: id(`line:${line.parent_id}`) });
      else roots.push(itemId);
      const storedMonths = t.line_months.filter((m: Row) => m.line_id === line.id);
      for (const month of line.months) {
        const stored = storedMonths.find((m: Row) => m.month_index === month.month);
        let informed: number | null = null;
        if (stored && !stored.formula && stored.value != null) {
          const raw = JSON.parse(stored.value);
          if (typeof raw === "number") informed = migrationMoney(raw);
        }
        payload.orcamento_item_meses.push({ item_id: itemId, competencia: migrationCompetencia(dates.year, month.month), valor_informado: informed, formula: stored?.formula ?? null, valor_calculado: migrationMoney(month.value), origem: stored?.formula === "=AUTOCALC" ? "calculo" : stored?.formula ? "formula" : "manual" });
      }
      const plans = snapshot.parsedPlans[line.id]?.length ? snapshot.parsedPlans[line.id] : [null];
      for (let i = 0; i < plans.length; i++) {
        const plan = plans[i];
        const planId = id(`plan:${line.id}:${i}`);
        const premise = premiseRows.get(original.calc_premise);
        payload.orcamento_item_planos.push({ id: planId, item_id: itemId, premissa_id: premise?.id ?? null, descricao: plan ? `Plano ${i + 1}` : "Configuração original do item", ordem: i, modo_calculo: plan?.mode === "fixed" || original.calc_direct ? "direto" : original.calc_kind === "trips" ? "viagem" : original.calc_kind === "hours" ? "hora" : "area", area_ha: original.calc_area_ha ?? null, percentual_area: plan?.areaPct ?? original.calc_area_pct ?? null, dose: plan?.dose ?? original.calc_dose ?? null, preco_unitario: plan?.price ?? line.calc_price ?? null, quantidade_aplicacoes: original.calc_applications ?? null, percentual_reducao: original.calc_reduce_pct ?? null, quantidade_viagens: original.calc_trips ?? null, quantidade_maquinas: original.calc_machine_qty ?? null, intervalo_horas: original.calc_hour_interval ?? null,
          configuracao: { legado: original, plano: plan, meses_originais: storedMonths, valores_proprios: line.own_months ?? null, area_ha_meses: line.area_ha_months ?? null, regras: (t.calc_params ?? []).filter((r: Row) => r.safra_id === safra.id && ((r.activity_id != null && r.activity_id === original.activity_id) || (r.material_id != null && r.material_id === original.material_id))) } });
        // Meses selecionados são preservados no JSON. Não inventar percentuais iguais.
      }
    }
    expectedCenters.push({ sheet: sheet.name, roots, monthTotals: sheet.monthTotals, total: sheet.total });
  }
  if (payload.orcamento_itens.length !== t.lines.length) throw new Error("Existem itens fora dos centros migrados.");
  return { payload, parents, budgetId, metadata, expectedCenters, warnings, mappings: Object.fromEntries(Object.entries(maps).map(([key, map]) => [key, Object.fromEntries(map)])) };
}
