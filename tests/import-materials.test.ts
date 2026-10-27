import assert from "node:assert/strict";
import { test } from "node:test";
import { atividadeSubstituidaPorMateriaisE } from "../src/lib/import-materials.js";

const atividade = { id: 1, parent_id: null, activity_id: 60, category_id: 1, object_code: null, ref_kind: "activity" as const, item_type: null };
const material = { ...atividade, id: 2, parent_id: 1, ref_kind: "material" as const, item_type: "E" };

test("não exporta a atividade com material E, mesmo sem marca de grupo", () => {
  const lines = [atividade, material];
  const excluidos = atividadeSubstituidaPorMateriaisE(lines, "99");
  assert.deepEqual(lines.filter((line) => !excluidos.has(line.id)).map((line) => line.id), [2]);
});

test("materiais E aninhados excluem os totais intermediários sem excluir os próprios materiais", () => {
  const objeto = { ...atividade, id: 3, parent_id: 1, ref_kind: "cost_object" as const };
  const lines = [atividade, objeto, { ...material, parent_id: 3 }];
  assert.deepEqual([...atividadeSubstituidaPorMateriaisE(lines, "99")].sort(), [1, 3]);
});

test("vínculo antigo sem parent_id respeita atividade, categoria e objeto", () => {
  const lines = [atividade, { ...material, parent_id: null }, { ...atividade, id: 3, object_code: "100" }, { ...atividade, id: 4, category_id: 2 }];
  assert.deepEqual([...atividadeSubstituidaPorMateriaisE(lines, "99")], [1]);
});

test("preserva atividades sem materiais E e ignora equipamentos E", () => {
  assert.equal(atividadeSubstituidaPorMateriaisE([atividade, { ...material, item_type: "G" }], "99").size, 0);
  assert.equal(atividadeSubstituidaPorMateriaisE([atividade, { ...material, ref_kind: "cost_object" }], "99").size, 0);
});
