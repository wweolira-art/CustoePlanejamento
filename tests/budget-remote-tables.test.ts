import assert from "node:assert/strict";
import { test } from "node:test";
import { remoteTables } from "../server/budget-cloud.js";

test("lê tabelas em paralelo limitado e mantém todas as páginas antes de salvar", async () => {
  let active = 0, peak = 0;
  const calls: string[] = [];
  const result = await remoteTables((async (table: string, options: any) => {
    active++; peak = Math.max(peak, active);
    const offset = Number(options.query.get("offset"));
    calls.push(`${table}:${offset}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    if (table !== "safras") return [];
    return Array.from({ length: offset === 0 ? 500 : 1 }, (_, index) => ({ id: offset + index }));
  }) as any);
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.equal(Object.keys(result).length, 14);
  assert.equal(result.safras!.length, 501);
  assert.equal(result.safras![500].id, 500);
  assert.ok(calls.includes("safras:500"));
});

test("falha em uma tabela rejeita a leitura completa e aguarda consultas em andamento", async () => {
  let active = 0;
  await assert.rejects(remoteTables((async (table: string) => {
    active++;
    try {
      await new Promise((resolve) => setTimeout(resolve, table === "safras" ? 1 : 5));
      if (table === "safras") throw new Error("Supabase indisponível");
      return [];
    } finally { active--; }
  }) as any), /Supabase indisponível/);
  assert.equal(active, 0);
});
