import type { Activity, LineItem } from "../api";

type LinhaImportacao = Pick<LineItem, "activity_id" | "item_type" | "product_code" | "empenho_override">;

export function atividadeDaImportacao(activities: Activity[], line: LinhaImportacao) {
  const product = String(line.product_code ?? "").trim();
  const generico = line.item_type === "G" || (line.item_type !== "E" && /^G\d+$/i.test(product));
  if (generico && product) {
    const code = product.replace(/^G(?=\d)/i, "").toUpperCase();
    return activities.find((activity) => String(activity.code).trim().replace(/^G(?=\d)/i, "").toUpperCase() === code);
  }
  return activities.find((activity) => activity.id === line.activity_id);
}

export function empenhoDaImportacao(activities: Activity[], line: LinhaImportacao) {
  const override = String(line.empenho_override ?? "").trim();
  return override || String(atividadeDaImportacao(activities, line)?.empenho ?? "").trim();
}
