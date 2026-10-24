import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { verifyPassword } from "../server/password-verification.js";

const password = "Teste#Senha=2026!";
const salt = "MDEyMzQ1Njc4OWFiY2RlZg";

test("valida scrypt com salt textual ou decodificado sem mudar a senha", async () => {
  for (const key of ["jbQNykYikfJEP2ee57eJN951Rm-9yV7U", "lXdQqaCGJYS-osAES4Csq-hzHq-8HTgZ"]) {
    const stored = `scrypt$${salt}$${key}`;
    assert.equal(await verifyPassword(password, stored), true);
    assert.equal(await verifyPassword("senha errada", stored), false);
    assert.equal(await verifyPassword(` ${password}`, stored), false);
    assert.equal(await verifyPassword(stored, stored), false);
  }
});

test("preserva validação SHA-256 e rejeita senha incorreta", async () => {
  const hash = createHash("sha256").update(password).digest("hex");
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword(password, hash.toUpperCase()), true);
  assert.equal(await verifyPassword("senha errada", hash), false);
});

test("rejeita texto puro, formatos inválidos e dados incompletos", async () => {
  for (const stored of [null, undefined, {}, "", password, "scrypt$$", `scrypt$${salt}$a`, `scrypt$${salt}$${"A".repeat(129)}`, `scrypt$${salt}$${"A".repeat(31)}B`, `scrypt$${salt}$${"A".repeat(32)}$extra`]) {
    assert.equal(await verifyPassword(password, stored), false);
  }
  assert.equal(await verifyPassword("", createHash("sha256").update("").digest("hex")), false);
});
