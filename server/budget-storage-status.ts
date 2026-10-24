import { supabaseRuntimeRequest } from "./supabase.js";

export async function budgetStorageStatus(cloud: boolean, read = () => supabaseRuntimeRequest<{ revisao: number; atualizado_em: string }[]>(
  "orcamento_aplicativo_estado", undefined,
  new URLSearchParams({ id: "eq.principal", select: "revisao,atualizado_em" }),
)) {
  const checkedAt = new Date().toISOString();
  if (!cloud) return { provider: "sqlite" as const, connected: true, revision: null, updatedAt: null, checkedAt, project: null };
  let project: string | null = null;
  try { project = new URL(process.env.SUPABASE_URL ?? "").hostname; } catch { /* sem configuração válida */ }
  try {
    const rows = await read();
    const row = rows[0];
    if (!row || !Number.isSafeInteger(Number(row.revisao)) || Number(row.revisao) < 1) throw new Error("Estado remoto indisponível");
    return { provider: "supabase" as const, connected: true, revision: Number(row.revisao), updatedAt: row.atualizado_em, checkedAt, project };
  } catch {
    return { provider: "supabase" as const, connected: false, revision: null, updatedAt: null, checkedAt, project };
  }
}
