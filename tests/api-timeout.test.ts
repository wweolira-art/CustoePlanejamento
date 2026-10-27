import assert from "node:assert/strict";
import { test } from "node:test";
import { apiTimeoutMs } from "../src/lib/api-timeout.js";

test("salvar cálculo aguarda a confirmação remota sem ampliar consultas simples", () => {
  assert.equal(apiTimeoutMs("/api/lines/42", "PATCH"), 180_000);
  assert.equal(apiTimeoutMs("/api/sheets/5/reconcile-equipment-obc", "POST"), 180_000);
  assert.equal(apiTimeoutMs("/api/parametros-tecnicos", "PUT"), 180_000);
  assert.equal(apiTimeoutMs("/api/lines/42"), 30_000);
  assert.equal(apiTimeoutMs("/api/health"), 30_000);
  assert.equal(apiTimeoutMs("/api/auth/login", "POST"), 30_000);
});

test("mantém margem para os relatórios Oracle, com e sem parâmetros na URL", () => {
  assert.equal(apiTimeoutMs("/api/custo/rateio/matriz-subprocesso?anomesInicio=202509"), 600_000);
  assert.equal(apiTimeoutMs("/api/custo-colheita"), 600_000);
  assert.equal(apiTimeoutMs("/api/contract-control/ocorrencias?inicio=2025-09-01"), 600_000);
});
