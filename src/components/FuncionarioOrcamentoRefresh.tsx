import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { formatBRL } from "../lib/format";
import { canAccessCostTab } from "../lib/permissions";
import { useApp } from "../store";

function defaultExternalSafraId(safraCode?: string | null) {
  const match = safraCode?.match(/^(\d{2})\//);
  if (!match) return 4;
  const yy = Number(match[1]);
  const startYear = yy >= 90 ? 1900 + yy : 2000 + yy;
  // OrcaSafra externo: safra 2026/27 costuma ser id 4 na API legada.
  if (startYear >= 2026) return 4;
  if (startYear >= 2025) return 3;
  return 4;
}

export function FuncionarioOrcamentoRefreshBar() {
  const { authUser, safra, safraId, reload } = useApp();
  const permissions = authUser?.permissions ?? [];
  const canRefresh = canAccessCostTab(permissions, "autoCalc");

  const [externalSafraId, setExternalSafraId] = useState(() => defaultExternalSafraId(safra?.code));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setExternalSafraId(defaultExternalSafraId(safra?.code));
  }, [safra?.code]);
  const [message, setMessage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setMessage(null);
    try {
      const result = await api.funcionarioOrcamentoRefreshAll({
        externalSafraId,
        localSafraId: safraId,
      });
      await reload();
      const parts = [
        `${result.updatedCount} centro${result.updatedCount === 1 ? "" : "s"} atualizado${result.updatedCount === 1 ? "" : "s"}`,
      ];
      if (result.configUpdatedCount) {
        parts.push(`${result.configUpdatedCount} com configuração salva`);
      }
      if (result.importUpdatedCount) {
        parts.push(`${result.importUpdatedCount} via mapeamento da API`);
      }
      if (result.skippedCount) {
        parts.push(`${result.skippedCount} subprocesso(s) ignorado(s)`);
      }
      const total = [...result.configUpdated, ...result.importUpdated].reduce(
        (sum, row) => sum + (row.totalSafra ?? 0),
        0,
      );
      setMessage(
        `${parts.join(" · ")}${total > 0 ? ` · total ${formatBRL(total)}` : ""}${
          result.externalSafraLabel ? ` (${result.externalSafraLabel})` : ""
        }`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível atualizar os funcionários.");
    } finally {
      setLoading(false);
    }
  }, [externalSafraId, reload, safraId]);

  if (!canRefresh) return null;

  return (
    <div className="funcionario-refresh-bar no-print">
      <div className="funcionario-refresh-copy">
        <strong>Funcionários (API OrcaSafra)</strong>
        <span>Atualiza a linha de despesa com funcionários em todos os centros de custo.</span>
      </div>
      <label className="funcionario-refresh-safra">
        <span>ID safra na API</span>
        <input
          type="number"
          min={1}
          value={externalSafraId}
          onChange={(e) => setExternalSafraId(Number(e.target.value) || 4)}
          disabled={loading}
        />
      </label>
      <button type="button" className="btn primary" disabled={loading} onClick={() => void refresh()}>
        {loading ? "Atualizando…" : "Atualizar funcionários"}
      </button>
      {message ? <p className="funcionario-refresh-ok">{message}</p> : null}
      {err ? <p className="funcionario-refresh-err">{err}</p> : null}
    </div>
  );
}
