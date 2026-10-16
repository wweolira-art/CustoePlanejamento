/** Somente backend: nunca importar este módulo em src/. */
export const BUDGET_TABLES = [
  "safras", "centros_custo", "categorias", "materiais", "atividades",
  "objetos_custo", "fazendas", "orcamentos", "orcamento_centros",
  "orcamento_categorias", "orcamento_itens", "orcamento_item_meses",
  "orcamento_premissas", "orcamento_item_planos", "orcamento_item_plano_meses",
  "orcamento_historico",
] as const;

export type BudgetTable = (typeof BUDGET_TABLES)[number];

export function supabaseConfig(env: NodeJS.ProcessEnv = process.env) {
  const rawUrl = env.SUPABASE_URL?.trim();
  const key = (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!rawUrl || !key) {
    throw new Error("Configure SUPABASE_URL e SUPABASE_SECRET_KEY no .env do servidor.");
  }
  const url = new URL(rawUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("SUPABASE_URL deve conter apenas a origem do projeto (https://<projeto>.supabase.co).");
  }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("SUPABASE_URL deve usar HTTPS.");
  }
  if (!key.startsWith("sb_secret_")) {
    let role: unknown;
    try {
      role = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role;
    } catch { /* erro de configuração abaixo */ }
    if (role !== "service_role") {
      throw new Error("Use uma chave secreta do servidor ou a service_role legada, nunca anon/publishable.");
    }
  }
  return { url: url.origin, key };
}

export async function supabaseRequest<T>(
  table: BudgetTable,
  options: { method?: "GET" | "POST" | "PATCH"; query?: URLSearchParams; body?: unknown; prefer?: string } = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  if (!BUDGET_TABLES.includes(table)) throw new Error("Tabela de orçamento inválida.");
  const { url, key } = supabaseConfig();
  const target = new URL(`${url}/rest/v1/${table}`);
  target.search = options.query?.toString() ?? "";
  const headers: Record<string, string> = { apikey: key, Accept: "application/json" };
  // Chaves novas não são JWTs e não devem ser enviadas como Bearer.
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.prefer) headers.Prefer = options.prefer;
  let response: Response;
  try {
    response = await fetcher(target, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
  } catch {
    throw new Error("Não foi possível conectar ao Supabase em até 20 segundos. Confira o projeto e a rede.");
  }
  if (!response.ok) {
    // Não repassar respostas remotas que possam conter dados ou credenciais.
    throw new Error(`Supabase: HTTP ${response.status} ao acessar ${table}. Verifique chave, permissões e schema.`);
  }
  const content = await response.text();
  return (content ? JSON.parse(content) : null) as T;
}

/** RPCs são chamadas somente pelo servidor, com a mesma chave protegida. */
export async function supabaseRuntimeRequest<T>(path: "orcamento_aplicativo_estado" | "rpc/salvar_orcamento_aplicativo", body?: unknown, query?: URLSearchParams): Promise<T> {
  const { url, key } = supabaseConfig();
  const headers: Record<string, string> = { apikey: key, Accept: "application/json" };
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const target = new URL(`${url}/rest/v1/${path}`);
  target.search = query?.toString() ?? "";
  const response = await fetch(target, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000), redirect: "error" });
  if (!response.ok) {
    const raw = await response.json().catch(() => ({}));
    if (raw.code === "40001") throw new Error("Outro servidor alterou o orçamento. Atualize a página e tente novamente.");
    throw new Error(`Supabase: HTTP ${response.status} na persistência do orçamento (${String(raw.code ?? "sem código").replace(/[^A-Za-z0-9_]/g, "").slice(0, 30)}).`);
  }
  return response.json() as Promise<T>;
}

export async function checkSupabaseTables() {
  const results: { table: BudgetTable; ok: boolean; error?: string }[] = [];
  // Sequencial para não sobrecarregar a instância gratuita.
  for (const table of BUDGET_TABLES) {
    try {
      await supabaseRequest(table, { query: new URLSearchParams({ select: "*", limit: "0" }) });
      results.push({ table, ok: true });
    } catch (error) {
      results.push({ table, ok: false, error: error instanceof Error ? error.message : "Erro de conexão" });
      // Falha geral de conexão/autenticação não justifica mais 15 tentativas.
      if (results.length === 1) break;
    }
  }
  return results;
}
