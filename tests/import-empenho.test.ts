import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { atividadeDaImportacao, empenhoDaImportacao } from "../src/lib/import-empenho.js";
import type { Activity } from "../src/api.js";

const activities: Activity[] = [
  { id: 251, code: "60", description: "LUBRIFICANTES", empenho: "252" },
  { id: 307, code: "28", description: "Manutenção", empenho: "428" },
];
const generico = { activity_id: null, item_type: "G" as const, product_code: "60", empenho_override: null };

test("G60 sem vínculo preenche o empenho 252 nos três objetos da planilha", () => {
  const rows = [99, 896, 124].map((objeto) => ({ OBJETOCUSTO: objeto,
    EMPENHO: Number(empenhoDaImportacao(activities, generico)), SUBEMPENHO: "G60" }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Import");
  const arquivo = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const relido = XLSX.read(arquivo, { type: "buffer" });
  assert.deepEqual(XLSX.utils.sheet_to_json(relido.Sheets.Import), rows);
  assert.ok(rows.every((row) => row.EMPENHO === 252));
});

test("o código G60 prevalece sobre um vínculo antigo de outra atividade", () => {
  assert.equal(empenhoDaImportacao(activities, { ...generico, activity_id: 307 }), "252");
  assert.equal(atividadeDaImportacao(activities, { ...generico, activity_id: 307 })?.code, "60");
  assert.equal(empenhoDaImportacao(activities, { ...generico, product_code: " g60 " }), "252");
});

test("preserva empenho manual e resolve campo manual vazio pelo cadastro", () => {
  assert.equal(empenhoDaImportacao(activities, { ...generico, empenho_override: "00254" }), "00254");
  assert.equal(empenhoDaImportacao(activities, { ...generico, empenho_override: " " }), "252");
});

test("preserva vínculos normais e não confunde material E60 com subempenho G60", () => {
  assert.equal(empenhoDaImportacao(activities, { ...generico, item_type: null, product_code: null, activity_id: 307 }), "428");
  assert.equal(empenhoDaImportacao(activities, { ...generico, item_type: "E" }), "");
  assert.equal(empenhoDaImportacao(activities, { ...generico, product_code: "999", activity_id: 307 }), "");
});
