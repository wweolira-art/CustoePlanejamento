import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db.js";
import { readBearerToken, verifySessionToken } from "./auth.js";
import {
  canEditPermission,
  editPermissionKey,
  PERMISSION_ADMIN,
  sheetPermissionKey,
} from "./permissions.js";

const PUBLIC_MUTATION_PREFIXES = ["/api/auth/login", "/api/auth/logout"];

const SAFRA_NAV_PREFIXES = ["/api/safras/current"];

function sheetIdFromLine(lineId: number): number | null {
  const row = db.prepare("SELECT sheet_id FROM lines WHERE id = ?").get(lineId) as { sheet_id?: number } | undefined;
  return row?.sheet_id ?? null;
}

function sheetIdFromCategory(categoryId: number): number | null {
  const row = db.prepare("SELECT sheet_id FROM categories WHERE id = ?").get(categoryId) as { sheet_id?: number } | undefined;
  return row?.sheet_id ?? null;
}

function resolveEditPermission(req: Request): string | null | undefined {
  const path = req.path;
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return null;

  if (PUBLIC_MUTATION_PREFIXES.some((prefix) => path.startsWith(prefix))) return null;
  if (SAFRA_NAV_PREFIXES.some((prefix) => path.startsWith(prefix))) return null;
  // Configuração do quadro de manutenção: só administrador (ou usuário sem restrição).
  if (path === "/api/indicadores/manutencao-programada/config") return PERMISSION_ADMIN;

  if (path.startsWith("/api/admin/users")) return "admin:users";
  if (path.startsWith("/api/premissas")) return "tab:premissas";
  if (path.startsWith("/api/calc-rules") || path.startsWith("/api/un-realizado-sources")) return "tab:autoCalc";
  if (path.startsWith("/api/activity-links")) return "tab:activityLinks";
  if (path.startsWith("/api/funcionario-orcamento")) return "tab:autoCalc";

  if (path.startsWith("/api/activities")) return "page:activities";
  if (path.startsWith("/api/empenhos")) return "page:empenhos";
  if (path.startsWith("/api/materials")) return "page:materials";
  if (path.startsWith("/api/fazendas")) return "page:fazendas";
  if (path.startsWith("/api/cost-objects")) return "page:costObjects";
  if (path.startsWith("/api/category-catalog")) return "page:categories";
  if (path.startsWith("/api/areas")) return "page:harvestAreas";
  if (path.startsWith("/api/seed-radius-tariffs")) return "page:seedRadiusTariffs";
  if (path.startsWith("/api/seed-transport-report")) return "page:seedTransportReport";
  if (path.startsWith("/api/contract-control")) return "page:contractControl";
  if (path.startsWith("/api/safras")) return "page:safras";
  if (path.startsWith("/api/external-sites")) return "page:externalSites";

  const sheetMatch = path.match(/^\/api\/sheets\/(\d+)/);
  if (sheetMatch) return sheetPermissionKey(Number(sheetMatch[1]));

  const lineMatch = path.match(/^\/api\/lines\/(\d+)/);
  if (lineMatch) {
    const sheetId = sheetIdFromLine(Number(lineMatch[1]));
    if (sheetId != null) return sheetPermissionKey(sheetId);
  }

  const categoryMatch = path.match(/^\/api\/categories\/(\d+)/);
  if (categoryMatch) {
    const sheetId = sheetIdFromCategory(Number(categoryMatch[1]));
    if (sheetId != null) return sheetPermissionKey(sheetId);
  }

  if (path.startsWith("/api/distributions/") || path.startsWith("/api/reset")) return PERMISSION_ADMIN;

  return undefined;
}

export function registerAccessControl(app: Express) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const baseKey = resolveEditPermission(req);
    if (baseKey === null) return next();

    const user = verifySessionToken(readBearerToken(req.headers.authorization));
    if (!user) {
      return res.status(401).json({ error: "Sessão expirada ou inválida." });
    }

    const permissions = user.permissions ?? [];
    if (!permissions.length || permissions.includes(PERMISSION_ADMIN)) return next();

    if (baseKey === undefined) {
      return res.status(403).json({ error: "Sem permissão para esta operação." });
    }

    if (!canEditPermission(permissions, baseKey)) {
      return res.status(403).json({ error: "Sem permissão para editar nesta aba." });
    }

    next();
  });
}
