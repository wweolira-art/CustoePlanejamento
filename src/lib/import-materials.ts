import type { LineItem } from "../api";

type ImportLine = Pick<LineItem, "id" | "parent_id" | "activity_id" | "category_id" | "object_code" | "ref_kind" | "item_type">;

export function atividadeSubstituidaPorMateriaisE(lines: ImportLine[], sheetCode: string) {
  const excluir = new Set<number>();
  const porId = new Map(lines.map((line) => [line.id, line]));
  for (const material of lines) {
    if (material.item_type !== "E" || material.ref_kind !== "material") continue;
    let parentId = material.parent_id;
    const vistos = new Set<number>([material.id]);
    while (parentId != null && !vistos.has(parentId)) {
      vistos.add(parentId);
      const parent = porId.get(parentId);
      if (!parent) break;
      if (!(parent.item_type === "E" && parent.ref_kind === "material")) excluir.add(parent.id);
      parentId = parent.parent_id;
    }
    // Linhas antigas podem ter o vínculo de atividade, mas não parent_id.
    if (material.parent_id == null && material.activity_id != null) {
      for (const activity of lines) {
        if (activity.ref_kind === "activity" && activity.activity_id === material.activity_id
          && activity.category_id === material.category_id
          && String(activity.object_code ?? sheetCode) === String(material.object_code ?? sheetCode)) excluir.add(activity.id);
      }
    }
  }
  return excluir;
}
