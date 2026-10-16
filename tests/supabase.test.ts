import assert from "node:assert/strict";
import { test } from "node:test";
import { supabaseConfig, supabaseRequest } from "../server/supabase.js";

test("Supabase exige credenciais do servidor e rejeita chave pública", () => {
  assert.throws(() => supabaseConfig({}), /Configure SUPABASE_URL/);
  assert.throws(() => supabaseConfig({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "sb_publishable_public" }), /chave secreta/);
  assert.throws(() => supabaseConfig({ SUPABASE_URL: "http://example.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test" }), /HTTPS/);
  assert.throws(() => supabaseConfig({ SUPABASE_URL: "https://example.supabase.co/rest/v1", SUPABASE_SECRET_KEY: "sb_secret_test" }), /apenas a origem/);
});

test("Supabase envia chave nova apenas em apikey e não expõe erro remoto", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  try {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    const data = await supabaseRequest("safras", {}, async (url, options) => {
      assert.equal(String(url), "https://example.supabase.co/rest/v1/safras");
      const headers = new Headers(options?.headers);
      assert.equal(headers.get("apikey"), "sb_secret_test");
      assert.equal(headers.has("Authorization"), false);
      assert.equal(options?.redirect, "error");
      return new Response('[{"codigo":"26/27"}]');
    });
    assert.deepEqual(data, [{ codigo: "26/27" }]);
    await assert.rejects(
      supabaseRequest("safras", {}, async () => new Response("sb_secret_test private data", { status: 401 })),
      (error: Error) => error.message.includes("HTTP 401") && !error.message.includes("sb_secret_test"),
    );
    await assert.rejects(
      supabaseRequest("safras", {}, async () => { throw new Error("private data"); }),
      /Não foi possível conectar/,
    );
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});

test("Supabase aceita service_role legada e rejeita JWT anon", () => {
  const token = (role: string) => `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
  const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: token("service_role") };
  assert.equal(supabaseConfig(env).key, env.SUPABASE_SERVICE_ROLE_KEY);
  assert.throws(() => supabaseConfig({ ...env, SUPABASE_SERVICE_ROLE_KEY: token("anon") }), /chave secreta/);
});
