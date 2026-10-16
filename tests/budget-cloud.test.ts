import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import express from "express";
import { once } from "node:events";
import { BudgetCloudController, captureBudgetState, restoreBudgetState, stateHash, type CloudState } from "../server/budget-cloud.js";

async function fixture(options: { failSave?: boolean; holdSave?: Promise<void>; user?: boolean } = {}) {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE lines (id INTEGER PRIMARY KEY, description TEXT NOT NULL); INSERT INTO lines VALUES (1, 'original');");
  let remote: { revisao: number; estado: CloudState } = { revisao: 1, estado: { format: 1, namespace: "test", initialSafra: 1, tables: captureBudgetState(db) } };
  let saves = 0;
  const app = express();
  app.use(express.json());
  const controller = new BudgetCloudController(db, remote, () => ({}), () => {}, () => options.user === false ? null : { id: 42 }, {
    revision: async () => remote.revisao,
    load: async () => structuredClone(remote),
    save: async (state, revision, _snapshot, user) => {
      saves++;
      assert.equal(revision, remote.revisao);
      assert.equal(user, 42);
      await options.holdSave;
      if (options.failSave) throw new Error("Falha ao confirmar no Supabase");
      remote = { revisao: revision + 1, estado: structuredClone(state) };
      return remote.revisao;
    },
  });
  app.use(controller.middleware);
  app.get("/api/lines/1", (_req, res) => res.json(db.prepare("SELECT * FROM lines WHERE id=1").get()));
  app.patch("/api/lines/1", (req, res) => {
    db.prepare("UPDATE lines SET description=? WHERE id=1").run(req.body.description);
    res.json({ ok: true });
  });
  app.patch("/api/lines/invalid", (_req, res) => {
    db.prepare("UPDATE lines SET description='parcial' WHERE id=1").run();
    res.status(400).json({ error: "Inválido" });
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}`;
  return { db, url, saves: () => saves, remote: () => remote, externalChange: () => { remote = { revisao: remote.revisao + 1, estado: { ...remote.estado, tables: { lines: [{ id: 1, description: "outro servidor" }] } } }; },
    close: async () => { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); db.close(); } };
}

test("a resposta de sucesso aguarda a confirmação remota e serializa a leitura seguinte", async () => {
  let release!: () => void;
  const f = await fixture({ holdSave: new Promise((resolve) => { release = resolve; }) });
  try {
    let answered = false;
    const save = fetch(`${f.url}/api/lines/1`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: '{"description":"novo"}' }).then((r) => { answered = true; return r; });
    // Limite explícito evita travar a suíte se o transporte HTTP estiver bloqueado.
    for (let i = 0; i < 1000 && !f.saves(); i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(f.saves(), "A requisição não chegou à persistência em 5 segundos");
    assert.equal(answered, false);
    const reading = fetch(`${f.url}/api/lines/1`);
    release();
    assert.equal((await save).status, 200);
    assert.equal((await (await reading).json()).description, "novo");
    assert.equal(f.remote().estado.tables.lines[0].description, "novo");
  } finally { release(); await f.close(); }
});

test("falha remota desfaz a edição local e não retorna sucesso", async () => {
  const f = await fixture({ failSave: true });
  try {
    const res = await fetch(`${f.url}/api/lines/1`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: '{"description":"perdido"}' });
    assert.equal(res.status, 503);
    assert.equal((f.db.prepare("SELECT description FROM lines").get() as any).description, "original");
    assert.equal(f.remote().revisao, 1);
  } finally { await f.close(); }
});

test("alterações remotas renovam a base de cálculo antes de responder", async () => {
  const f = await fixture();
  try {
    f.externalChange();
    const res = await fetch(`${f.url}/api/lines/1`);
    assert.equal((await res.json()).description, "outro servidor");
    assert.equal(f.saves(), 0);
  } finally { await f.close(); }
});

test("erro de validação desfaz escrita parcial sem enviar ao Supabase", async () => {
  const f = await fixture();
  try {
    const res = await fetch(`${f.url}/api/lines/invalid`, { method: "PATCH" });
    assert.equal(res.status, 400);
    assert.equal((f.db.prepare("SELECT description FROM lines").get() as any).description, "original");
    assert.equal(f.saves(), 0);
  } finally { await f.close(); }
});

test("orçamento exige sessão válida antes de ler ou escrever", async () => {
  const f = await fixture({ user: false });
  try {
    assert.equal((await fetch(`${f.url}/api/lines/1`)).status, 401);
    assert.equal(f.saves(), 0);
  } finally { await f.close(); }
});

test("restauração rejeita tabelas e colunas desconhecidas sem apagar dados", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE lines (id INTEGER PRIMARY KEY, description TEXT); INSERT INTO lines VALUES(1, 'original');");
    const before = stateHash(captureBudgetState(db));
    assert.throws(() => restoreBudgetState(db, { auth_users: [] }), /inválido/);
    assert.throws(() => restoreBudgetState(db, { lines: [{ id: 1, invalid: "x" }] }), /incompatíveis/);
    assert.equal(stateHash(captureBudgetState(db)), before);
  } finally { db.close(); }
});
