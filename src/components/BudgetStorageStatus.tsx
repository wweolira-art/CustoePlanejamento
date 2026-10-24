import { useEffect, useState } from "react";
import { api, type BudgetStorageStatus as StorageStatus } from "../api";

export function BudgetStorageStatus() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let pending = false;
    const abort = new AbortController();
    const check = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await api.budgetStorageStatus(abort.signal);
        if (active) { setStatus(result); setFailed(false); }
      } catch {
        if (active) setFailed(true);
      } finally { pending = false; }
    };
    void check();
    const interval = window.setInterval(() => void check(), 60_000);
    const focus = () => void check();
    window.addEventListener("focus", focus);
    return () => { active = false; abort.abort(); window.clearInterval(interval); window.removeEventListener("focus", focus); };
  }, []);

  const connected = !failed && status?.provider === "supabase" && status.connected;
  const label = failed ? "Origem não confirmada"
    : !status ? "Verificando dados…"
      : status.provider === "sqlite" ? "Orçamento: dados locais"
        : status.connected ? "Orçamento: Supabase" : "Supabase indisponível";
  const detail = failed ? "Não foi possível consultar a origem dos dados. Confira se a API foi atualizada e reiniciada."
    : status?.provider === "sqlite" ? "Esta API está usando SQLite local. Configure BUDGET_STORAGE=supabase no .env do servidor e reinicie a API."
      : connected && status ? `Conexão com a nuvem confirmada. Projeto: ${status.project}. Revisão: ${status.revision}.${status.updatedAt ? ` Última gravação: ${new Date(status.updatedAt).toLocaleString("pt-BR")}.` : ""}`
        : status ? "A API está configurada para o Supabase, mas a conexão não pôde ser confirmada agora." : "Conferindo a origem dos orçamentos no servidor.";

  return <span className={`budget-storage-status ${connected ? "is-cloud" : failed || status ? "is-warning" : "is-checking"}`} title={detail} role="status">
    <span className="budget-storage-dot" aria-hidden="true" />
    {label}
    {connected && status?.revision != null ? <small>rev. {status.revision}</small> : null}
  </span>;
}
