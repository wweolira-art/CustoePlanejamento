import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetStorageStatus } from "../server/budget-storage-status.js";

test("modo local não é apresentado como conectado ao Supabase", async () => {
  const result = await budgetStorageStatus(false, async () => { throw new Error("Não chamar"); });
  assert.equal(result.provider, "sqlite");
  assert.equal(result.revision, null);
});

test("conexão na nuvem só é confirmada após a leitura da revisão remota", async () => {
  const result = await budgetStorageStatus(true, async () => [{ revisao: 9, atualizado_em: "2026-10-16T12:00:00Z" }]);
  assert.equal(result.connected, true);
  assert.equal(result.revision, 9);
  assert.equal(result.updatedAt, "2026-10-16T12:00:00Z");
});

test("falha de conexão e estado ausente não confirmam acesso à nuvem", async () => {
  assert.equal((await budgetStorageStatus(true, async () => { throw new Error("Falha remota"); })).connected, false);
  assert.equal((await budgetStorageStatus(true, async () => [])).connected, false);
  assert.equal((await budgetStorageStatus(true, async () => [{ revisao: 0, atualizado_em: "" }])).connected, false);
});
