import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProjectEnv } from "../server/env.js";

test("senhas Oracle preservam #, = e caracteres especiais sem aspas", () => {
  const env = parseProjectEnv("# comentário\nORACLE_PASSWORD_CONSULTA=Exemplo#Parte=2!\nSUPABASE_SECRET_KEY=sb_secret_exemplo\n");
  assert.equal(env.ORACLE_PASSWORD_CONSULTA, "Exemplo#Parte=2!");
  assert.equal(env.SUPABASE_SECRET_KEY, "sb_secret_exemplo");
});

test("mantém aspas opcionais, valores vazios e a primeira definição", () => {
  const env = parseProjectEnv("-- comentário\nA='valor # inteiro'\nB=\"outro=valor#\"\nC=\nA=ignorado");
  assert.equal(env.A, "valor # inteiro");
  assert.equal(env.B, "outro=valor#");
  assert.equal(env.C, "");
});
