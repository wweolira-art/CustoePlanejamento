import { createHash, createHmac, timingSafeEqual } from "crypto";
import { loadEnvFile } from "./oracle.js";
import { getUserPermissions } from "./user-permissions.js";

export type AuthUser = {
  id: number;
  nome: string;
  email: string;
  permissions: string[];
};

type OrdsUsuario = {
  id_usuario: number;
  nome: string;
  email: string;
  senha_hash: string;
  ativo: number | boolean;
  data_cadastro?: string | null;
  data_ultimo_login?: string | null;
  links?: { rel: string; href: string }[];
};

function nowIso() {
  return new Date().toISOString();
}

function buildUsuarioBody(
  user: Pick<OrdsUsuario, "nome" | "email" | "senha_hash" | "ativo"> & {
    id_usuario?: number;
    data_cadastro?: string | null;
    data_ultimo_login?: string | null;
  },
  options?: { isCreate?: boolean },
) {
  const body: Record<string, unknown> = {
    nome: user.nome,
    email: user.email,
    senha_hash: user.senha_hash,
    ativo: user.ativo ? 1 : 0,
    data_cadastro: user.data_cadastro ?? (options?.isCreate ? nowIso() : null),
    data_ultimo_login: user.data_ultimo_login ?? null,
  };
  if (user.id_usuario != null) body.id_usuario = user.id_usuario;
  return body;
}

function usuarioCollectionUrl() {
  loadEnvFile();
  const direct = process.env.ORDS_USUARIO_URL?.trim();
  if (direct) return direct.replace(/\/?$/, "/");
  const base = process.env.ORDS_BASE_URL?.trim();
  if (base) return `${base.replace(/\/?$/, "")}/usuario/`;
  throw new Error("Configure ORDS_USUARIO_URL ou ORDS_BASE_URL no .env.");
}

function authSecret() {
  return process.env.AUTH_SECRET?.trim() || process.env.JWT_SECRET?.trim() || "planejamento-agricola-dev-secret";
}

function hashPassword(password: string) {
  return createHash("sha256").update(password, "utf8").digest("hex");
}

export function withUserPermissions(user: Omit<AuthUser, "permissions">): AuthUser {
  return { ...user, permissions: getUserPermissions(user.id) };
}

async function fetchOrdUsers(): Promise<OrdsUsuario[]> {
  const res = await fetch(usuarioCollectionUrl(), { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`API de usuários retornou ${res.status}: ${await readOrdsError(res)}`);
  }
  const data = (await res.json()) as { items?: OrdsUsuario[] };
  return data.items ?? [];
}

async function fetchUsuarioById(id: number): Promise<OrdsUsuario | null> {
  const hit = (await fetchOrdUsers()).find((row) => row.id_usuario === id);
  return hit ?? null;
}

export type AdminUserRow = {
  id: number;
  nome: string;
  email: string;
  ativo: boolean;
  permissions: string[];
};

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  const rows = await fetchOrdUsers();
  return rows
    .map((row) => ({
      id: row.id_usuario,
      nome: row.nome,
      email: row.email,
      ativo: Boolean(row.ativo),
      permissions: getUserPermissions(row.id_usuario),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export async function createAdminUser(input: {
  nome: string;
  email: string;
  password: string;
  ativo?: boolean;
}) {
  const nome = input.nome.trim();
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!nome || !email || !password) {
    throw new Error("Informe nome, e-mail e senha.");
  }
  if (password.length < 6) {
    throw new Error("A senha deve ter pelo menos 6 caracteres.");
  }
  const existing = await fetchUsuarioByEmail(email);
  if (existing) throw new Error("Já existe um usuário com este e-mail.");

  const res = await fetch(usuarioCollectionUrl(), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(
      buildUsuarioBody(
        {
          nome,
          email,
          senha_hash: hashPassword(password),
          ativo: input.ativo === false ? 0 : 1,
        },
        { isCreate: true },
      ),
    ),
  });
  if (!res.ok) {
    throw new Error(`Não foi possível criar o usuário: ${await readOrdsError(res)}`);
  }
  const created = (await res.json()) as OrdsUsuario;
  const id = created.id_usuario ?? (await fetchUsuarioByEmail(email))?.id_usuario;
  if (!id) throw new Error("Usuário criado, mas não foi possível obter o ID.");
  return {
    id,
    nome: created.nome ?? nome,
    email: created.email ?? email,
    ativo: input.ativo !== false,
    permissions: getUserPermissions(id),
  } satisfies AdminUserRow;
}

export async function updateAdminUser(
  id: number,
  input: { nome?: string; email?: string; password?: string; ativo?: boolean },
) {
  const user = await fetchUsuarioById(id);
  if (!user) throw new Error("Usuário não encontrado.");

  const nome = input.nome?.trim() || user.nome;
  const email = (input.email?.trim() || user.email).toLowerCase();
  const nextHash = input.password?.trim() ? hashPassword(input.password.trim()) : user.senha_hash;
  const ativo = input.ativo == null ? Boolean(user.ativo) : input.ativo;

  if (input.password?.trim() && input.password.trim().length < 6) {
    throw new Error("A senha deve ter pelo menos 6 caracteres.");
  }

  const self = user.links?.find((link) => link.rel === "self")?.href;
  const target = self ?? `${usuarioCollectionUrl()}${id}`;
  const res = await fetch(target, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(
      buildUsuarioBody({
        id_usuario: id,
        nome,
        email,
        senha_hash: nextHash,
        ativo: ativo ? 1 : 0,
        data_cadastro: user.data_cadastro ?? nowIso(),
        data_ultimo_login: user.data_ultimo_login ?? null,
      }),
    ),
  });
  if (!res.ok) {
    throw new Error(`Não foi possível atualizar o usuário: ${await readOrdsError(res)}`);
  }

  return {
    id,
    nome,
    email,
    ativo,
    permissions: getUserPermissions(id),
  } satisfies AdminUserRow;
}

export async function verifyStoredPassword(email: string, password: string) {
  const user = await fetchUsuarioByEmail(email.trim());
  if (!user) return { ok: false as const, reason: "Usuário não encontrado." };
  if (!user.ativo || user.ativo === 0) return { ok: false as const, reason: "Usuário inativo." };
  const hash = hashPassword(password);
  const ok = safeEqualText(hash, user.senha_hash);
  return { ok, reason: ok ? null : "Senha incorreta." };
}

function safeEqualText(a: string, b: string) {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function readOrdsError(res: Response) {
  const text = await res.text();
  try {
    const data = JSON.parse(text) as { message?: string; error?: string };
    return data.message || data.error || text.slice(0, 200);
  } catch {
    return text.slice(0, 200) || `HTTP ${res.status}`;
  }
}

async function fetchUsuarioByEmail(email: string): Promise<OrdsUsuario | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const url = `${usuarioCollectionUrl()}?q=${encodeURIComponent(JSON.stringify({ email: normalized }))}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`API de usuários retornou ${res.status}: ${await readOrdsError(res)}`);
  }
  const data = (await res.json()) as { items?: OrdsUsuario[] };
  const hit = (data.items ?? []).find((row) => String(row.email ?? "").trim().toLowerCase() === normalized);
  return hit ?? null;
}

async function touchLastLogin(user: OrdsUsuario) {
  const self = user.links?.find((link) => link.rel === "self")?.href;
  if (!self) return;
  try {
    await fetch(self, {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(
        buildUsuarioBody({
          id_usuario: user.id_usuario,
          nome: user.nome,
          email: user.email,
          senha_hash: user.senha_hash,
          ativo: user.ativo,
          data_cadastro: user.data_cadastro ?? nowIso(),
          data_ultimo_login: nowIso(),
        }),
      ),
    });
  } catch {
    /* não bloqueia o login */
  }
}

export async function loginWithCredentials(email: string, password: string): Promise<AuthUser> {
  const trimmedEmail = email.trim();
  const trimmedPassword = password;
  if (!trimmedEmail || !trimmedPassword) {
    throw new Error("Informe e-mail e senha.");
  }

  const user = await fetchUsuarioByEmail(trimmedEmail);
  if (!user) {
    throw new Error("E-mail ou senha incorretos.");
  }
  if (!user.ativo || user.ativo === 0) {
    throw new Error("Usuário inativo. Peça liberação ao administrador.");
  }

  const hash = hashPassword(trimmedPassword);
  if (!safeEqualText(hash, user.senha_hash)) {
    throw new Error("E-mail ou senha incorretos.");
  }

  void touchLastLogin(user);

  return withUserPermissions({
    id: user.id_usuario,
    nome: user.nome,
    email: user.email,
  });
}

type SessionPayload = AuthUser & { exp: number };

export function createSessionToken(user: AuthUser) {
  const payload: SessionPayload = {
    ...user,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", authSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string | null | undefined): AuthUser | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", authSecret()).update(body).digest("base64url");
  if (!safeEqualText(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload?.id || !payload.email || !payload.nome) return null;
    if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    return withUserPermissions({ id: payload.id, nome: payload.nome, email: payload.email });
  } catch {
    return null;
  }
}

export function readBearerToken(header: string | undefined) {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}
