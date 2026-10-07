import type { Request, Response } from "express";
import {
  createAdminUser,
  listAdminUsers,
  readBearerToken,
  updateAdminUser,
  verifySessionToken,
  verifyStoredPassword,
} from "./auth.js";
import { canManageUsers, permissionCatalog } from "./permissions.js";
import { setUserPermissions } from "./user-permissions.js";

function requireAuthUser(req: Request, res: Response) {
  const user = verifySessionToken(readBearerToken(req.headers.authorization));
  if (!user) {
    res.status(401).json({ error: "Sessão expirada ou inválida." });
    return null;
  }
  return user;
}

function requireUsersAdmin(req: Request, res: Response) {
  const user = requireAuthUser(req, res);
  if (!user) return null;
  if (!canManageUsers(user.permissions)) {
    res.status(403).json({ error: "Sem permissão para gerenciar usuários." });
    return null;
  }
  return user;
}

export function registerUsersAdminRoutes(app: import("express").Express) {
  app.get("/api/admin/permissions/catalog", (req, res) => {
    const user = requireAuthUser(req, res);
    if (!user) return;
    if (!canManageUsers(user.permissions)) {
      return res.status(403).json({ error: "Sem permissão para gerenciar usuários." });
    }
    res.json(permissionCatalog());
  });

  app.get("/api/admin/users", async (req, res) => {
    if (!requireUsersAdmin(req, res)) return;
    try {
      res.json(await listAdminUsers());
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Falha ao listar usuários." });
    }
  });

  app.post("/api/admin/users", async (req, res) => {
    if (!requireUsersAdmin(req, res)) return;
    try {
      const body = (req.body ?? {}) as {
        nome?: string;
        email?: string;
        password?: string;
        ativo?: boolean;
        permissions?: string[];
      };
      const created = await createAdminUser({
        nome: String(body.nome ?? ""),
        email: String(body.email ?? ""),
        password: String(body.password ?? ""),
        ativo: body.ativo !== false,
      });
      if (Array.isArray(body.permissions)) {
        setUserPermissions(created.id, body.permissions);
        created.permissions = body.permissions;
      }
      res.status(201).json(created);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível criar o usuário." });
    }
  });

  app.patch("/api/admin/users/:id", async (req, res) => {
    if (!requireUsersAdmin(req, res)) return;
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "ID inválido." });
      const body = (req.body ?? {}) as {
        nome?: string;
        email?: string;
        password?: string;
        ativo?: boolean;
        permissions?: string[];
      };
      const updated = await updateAdminUser(id, {
        nome: body.nome,
        email: body.email,
        password: body.password,
        ativo: body.ativo,
      });
      if (Array.isArray(body.permissions)) {
        setUserPermissions(id, body.permissions);
        updated.permissions = body.permissions;
      }
      res.json(updated);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível atualizar o usuário." });
    }
  });

  app.post("/api/admin/users/verify-password", async (req, res) => {
    if (!requireUsersAdmin(req, res)) return;
    try {
      const body = (req.body ?? {}) as { email?: string; password?: string };
      const email = String(body.email ?? "").trim();
      const password = String(body.password ?? "");
      if (!email || !password) {
        return res.status(400).json({ error: "Informe e-mail e senha." });
      }
      const result = await verifyStoredPassword(email, password);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Falha ao verificar senha." });
    }
  });
}
