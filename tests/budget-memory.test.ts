import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { initializeBudgetMemory } from "../server/budget-memory.js";
import { captureBudgetState, restoreBudgetState } from "../server/budget-cloud.js";

test("orçamento fica somente em memória; configurações continuam persistentes", () => {
  const dir = mkdtempSync(join(tmpdir(), "budget-memory-"));
  const path = join(dir, "settings.db");
  const db = new Database(path);
  try {
    initializeBudgetMemory(db);
    db.exec("CREATE TABLE IF NOT EXISTS sheets(id INTEGER PRIMARY KEY); CREATE INDEX IF NOT EXISTS sheet_order ON sheets(sort_order);");
    db.exec("INSERT INTO sheets(id,name,title,kind) VALUES(1,'PLANTIO','Plantio','cost_center');");
    db.exec("CREATE TABLE IF NOT EXISTS user_permissions(user_id INTEGER, permission_key TEXT); INSERT INTO user_permissions VALUES(1,'admin');");
    assert.equal(captureBudgetState(db).sheets.length, 1);
    assert.equal((db.prepare("SELECT count(*) AS n FROM main.sqlite_master WHERE name='sheets'").get() as any).n, 0);
    assert.equal((db.prepare("SELECT count(*) AS n FROM temp.sqlite_master WHERE name='sheets'").get() as any).n, 1);
    assert.equal(db.pragma("temp_store", { simple: true }), 2);
  } finally { db.close(); }
  const reopened = new Database(path);
  try {
    assert.equal((reopened.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='sheets'").get() as any).n, 0);
    assert.equal((reopened.prepare("SELECT permission_key FROM user_permissions").get() as any).permission_key, "admin");
    initializeBudgetMemory(reopened);
    assert.equal((reopened.prepare("SELECT count(*) AS n FROM sheets").get() as any).n, 0);
    restoreBudgetState(reopened, { sheets: [{ id: 1, name: "RESTORED", title: "Nuvem", kind: "cost_center", sort_order: 0, visible: 1 }] });
    assert.equal((reopened.prepare("SELECT title FROM sheets").get() as any).title, "Nuvem");
  } finally {
    reopened.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("budget-memory-"));
    rmSync(dir, { recursive: true });
  }
});

test("restaura observação e empenho do estado remoto sem perder valores ao recapturar", () => {
  const db = new Database(":memory:");
  try {
    initializeBudgetMemory(db);
    restoreBudgetState(db, {
      sheets: [{ id: 1, name: "PLANTIO", title: "Plantio", kind: "cost_center", sort_order: 0, visible: 1 }],
      categories: [{ id: 1, sheet_id: 1, name: "Materiais", sort_order: 0, catalog_id: null }],
      lines: [{ id: 1, sheet_id: 1, category_id: 1, description: "Item", is_group: 0, sort_order: 0, observation: "Observação preservada", empenho_override: "00123" }],
    });
    db.prepare("UPDATE lines SET description = ? WHERE id = 1").run("Descrição atualizada");
    const line = captureBudgetState(db).lines[0];
    assert.equal(line.observation, "Observação preservada");
    assert.equal(line.empenho_override, "00123");
    assert.equal((db.prepare("SELECT count(*) AS n FROM main.sqlite_master WHERE name='lines'").get() as any).n, 0);
  } finally { db.close(); }
});
