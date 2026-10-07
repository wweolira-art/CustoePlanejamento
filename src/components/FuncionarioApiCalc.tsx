import { useEffect, useMemo, useState } from "react";
import { api, type FuncionarioApiConfig, type FuncionarioSubprocessOption } from "../api";

const MONTHS = ["SET", "OUT", "NOV", "DEZ", "JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO"];

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function parseFuncionarioApiConfig(raw: string | null | undefined): FuncionarioApiConfig | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as FuncionarioApiConfig;
    if (!obj || typeof obj !== "object") return null;
    return {
      enabled: Boolean(obj.enabled),
      externalSafraId: Number(obj.externalSafraId) || 4,
      subprocessIds: Array.isArray(obj.subprocessIds)
        ? [...new Set(obj.subprocessIds.map(Number).filter((n) => Number.isFinite(n)))]
        : [],
      folhaAvulsaSubprocessIds: Array.isArray(obj.folhaAvulsaSubprocessIds)
        ? [...new Set(obj.folhaAvulsaSubprocessIds.map(Number).filter((n) => Number.isFinite(n)))]
        : [],
    };
  } catch {
    return null;
  }
}

export function isFuncionarioHeadLine(
  line: { parent_id?: number | null; activity_id?: number | null; description: string },
  activities: { id: number; code: string; description: string }[],
): boolean {
  if (line.parent_id) return false;
  if (isFolhaAvulsaLine(line, activities)) return false;
  const act = activities.find((a) => a.id === line.activity_id);
  if (act && (act.code === "09994" || act.code === "237" || /funcion/i.test(act.description))) return true;
  return /despesa.*funcion|funcionarios?/i.test(line.description);
}

function isFolhaAvulsaCostObject(description: string) {
  return /folha.*avulsa/i.test(description) || /administra.*\/\s*controle/i.test(description);
}

export function isFolhaAvulsaLine(
  line: {
    parent_id?: number | null;
    activity_id?: number | null;
    cost_object_id?: number | null;
    description: string;
    funcionario_api_config?: string | null;
  },
  activities: { id: number; code: string; description: string }[],
  options?: {
    categoryName?: string | null;
    costObjects?: { id: number; code: string; description: string }[];
  },
): boolean {
  if (line.parent_id) return false;
  const stored = parseFuncionarioApiConfig(line.funcionario_api_config);
  if (stored?.enabled && stored.folhaAvulsaSubprocessIds.length && !stored.subprocessIds.length) {
    return true;
  }
  const act = activities.find((a) => a.id === line.activity_id);
  if (act && (act.code === "57" || /folha.*avulsa/i.test(act.description))) return true;
  if (/folha.*avulsa/i.test(line.description)) return true;
  if (/folha.*avulsa/i.test(options?.categoryName ?? "")) return true;
  if (line.cost_object_id && options?.costObjects) {
    const costObject = options.costObjects.find((item) => item.id === line.cost_object_id);
    if (costObject && isFolhaAvulsaCostObject(costObject.description)) return true;
  }
  if (isFolhaAvulsaCostObject(line.description)) return true;
  return false;
}

export type FuncionarioApiCalcMode = "full" | "folhaAvulsaOnly";

function defaultAdminIds(items: FuncionarioSubprocessOption[]) {
  return items.filter((item) => item.isAdministration).map((item) => item.id);
}

export function FuncionarioApiCalcPanel({
  sheetName,
  value,
  onChange,
  mode = "full",
}: {
  sheetName: string;
  value: FuncionarioApiConfig;
  onChange: (next: FuncionarioApiConfig) => void;
  mode?: FuncionarioApiCalcMode;
}) {
  const folhaAvulsaOnly = mode === "folhaAvulsaOnly";
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [subprocessos, setSubprocessos] = useState<FuncionarioSubprocessOption[]>([]);
  const [safraLabel, setSafraLabel] = useState<string | null>(null);
  const [mesLabels, setMesLabels] = useState<string[]>(MONTHS);
  const [orcadoGeral, setOrcadoGeral] = useState<number[]>([]);
  const [folhaAvulsaGeral, setFolhaAvulsaGeral] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    api
      .funcionarioSubprocessos(value.externalSafraId)
      .then((data) => {
        if (cancelled) return;
        setSubprocessos(data.subprocessos);
        setSafraLabel(data.safraLabel);
        setMesLabels(data.meses.length === 12 ? data.meses : MONTHS);
        setOrcadoGeral(data.orcadoGeral?.length === 12 ? data.orcadoGeral : []);
        setFolhaAvulsaGeral(data.folhaAvulsaGeral?.length === 12 ? data.folhaAvulsaGeral : []);
        const adminSheet = /administra/i.test(sheetName);
        const adminPreset = adminSheet ? defaultAdminIds(data.subprocessos) : [];
        if (!folhaAvulsaOnly && !value.subprocessIds.length && adminPreset.length) {
          onChange({
            ...value,
            subprocessIds: adminPreset,
            folhaAvulsaSubprocessIds: value.folhaAvulsaSubprocessIds ?? [],
          });
        } else if (folhaAvulsaOnly && !(value.folhaAvulsaSubprocessIds ?? []).length && adminPreset.length) {
          onChange({
            ...value,
            subprocessIds: value.subprocessIds ?? [],
            folhaAvulsaSubprocessIds: adminPreset,
          });
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setErr(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [value.externalSafraId]);

  const selected = useMemo(() => {
    const ids = new Set(value.subprocessIds);
    return subprocessos.filter((item) => ids.has(item.id));
  }, [subprocessos, value.subprocessIds]);

  const preview = useMemo(() => {
    const meses = Array.from({ length: 12 }, (_, i) =>
      selected.reduce((sum, item) => sum + (Number(item.meses[i]) || 0), 0),
    );
    const totalSafra = selected.reduce((sum, item) => sum + (Number(item.totalSafra) || 0), 0);
    return { meses, totalSafra };
  }, [selected]);

  const selectedFolhaAvulsa = useMemo(() => {
    const ids = new Set(value.folhaAvulsaSubprocessIds ?? []);
    return subprocessos.filter((item) => ids.has(item.id));
  }, [subprocessos, value.folhaAvulsaSubprocessIds]);

  const folhaAvulsaPreview = useMemo(() => {
    const meses = Array.from({ length: 12 }, (_, i) => {
      const totalOrcado = Number(orcadoGeral[i]) || 0;
      const totalFolha = Number(folhaAvulsaGeral[i]) || 0;
      if (!(totalOrcado > 0) || !(totalFolha > 0)) return 0;
      const selectedOrcado = selectedFolhaAvulsa.reduce(
        (sum, item) => sum + (Number(item.meses[i]) || 0),
        0,
      );
      return Math.round(totalFolha * (selectedOrcado / totalOrcado) * 100) / 100;
    });
    const totalSafra = meses.reduce((sum, amount) => sum + amount, 0);
    return { meses, totalSafra };
  }, [selectedFolhaAvulsa, orcadoGeral, folhaAvulsaGeral]);

  const toggle = (id: number) => {
    const ids = new Set(value.subprocessIds);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    onChange({ ...value, enabled: true, subprocessIds: [...ids] });
  };

  const toggleFolhaAvulsa = (id: number) => {
    const ids = new Set(value.folhaAvulsaSubprocessIds ?? []);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    onChange({ ...value, enabled: true, folhaAvulsaSubprocessIds: [...ids] });
  };

  const selectAdmin = () => {
    onChange({ ...value, enabled: true, subprocessIds: defaultAdminIds(subprocessos) });
  };

  const selectAdminFolhaAvulsa = () => {
    onChange({
      ...value,
      enabled: true,
      folhaAvulsaSubprocessIds: defaultAdminIds(subprocessos),
    });
  };

  return (
    <div className="form-grid" style={{ padding: "12px 0" }}>
      <label className="span-2">
        Fonte dos valores
        <small>
          {folhaAvulsaOnly ? (
            <>
              Busca a folha avulsa na API OrcaSafra (<code>/api/externo/orcamento</code>), rateia pelos subprocessos
              selecionados e grava nesta linha do centro de custo <strong>{sheetName}</strong>.
            </>
          ) : (
            <>
              Busca na API OrcaSafra (<code>/api/externo/orcamento</code>), soma mês a mês os subprocessos
              selecionados e grava nesta linha do centro de custo <strong>{sheetName}</strong>.
            </>
          )}
        </small>
      </label>

      <label>
        ID externo da safra
        <small>ID usado na API (ex.: 4 → 2026/2027). Pode ser diferente do ID local.</small>
        <input
          type="number"
          min={1}
          value={value.externalSafraId}
          onChange={(e) =>
            onChange({
              ...value,
              externalSafraId: Number(e.target.value) || 4,
              subprocessIds: [],
              folhaAvulsaSubprocessIds: [],
            })
          }
        />
      </label>

      <label>
        Safra na API
        <small>{loading ? "Carregando…" : safraLabel ?? "—"}</small>
        <input value={safraLabel ?? ""} readOnly disabled />
      </label>

      {!folhaAvulsaOnly ? (
      <div className="span-2">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <span className="lead" style={{ margin: 0, padding: 0 }}>
            Subprocessos → Despesa com funcionários
          </span>
          <button type="button" className="btn" onClick={selectAdmin}>
            Selecionar administração
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => onChange({ ...value, subprocessIds: subprocessos.map((item) => item.id) })}
          >
            Marcar todos
          </button>
          <button type="button" className="btn" onClick={() => onChange({ ...value, subprocessIds: [] })}>
            Limpar
          </button>
        </div>
        {err ? (
          <p className="lead" style={{ color: "var(--danger)" }}>
            {err}
          </p>
        ) : null}
        <div className="funcionario-source-list">
          {subprocessos.map((item) => {
            const on = value.subprocessIds.includes(item.id);
            return (
              <label key={item.id} className={`funcionario-source-item ${on ? "on" : ""}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(item.id)} />
                <span>
                  <strong>{item.nome}</strong>
                  <small>
                    {item.codigo} · {formatBRL(item.totalSafra)} na safra
                  </small>
                </span>
              </label>
            );
          })}
          {!loading && !subprocessos.length ? (
            <p className="lead" style={{ margin: 0 }}>
              Nenhum subprocesso retornado para safraId={value.externalSafraId}.
            </p>
          ) : null}
        </div>
      </div>
      ) : null}

      {!folhaAvulsaOnly && selected.length ? (
        <div className="span-2">
          <p className="lead" style={{ margin: "0 0 8px", padding: 0 }}>
            Prévia — despesa com funcionários · {selected.length} subprocesso
            {selected.length === 1 ? "" : "s"} · {formatBRL(preview.totalSafra)} na safra
          </p>
          <div className="funcionario-preview-grid">
            {preview.meses.map((amount, i) => (
              <div key={i} className="funcionario-preview-cell">
                <span>{mesLabels[i] ?? MONTHS[i]}</span>
                <strong>{formatBRL(amount)}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="span-2">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <span className="lead" style={{ margin: 0, padding: 0 }}>
            Subprocessos → Folha avulsa
          </span>
          <button type="button" className="btn" onClick={selectAdminFolhaAvulsa}>
            Selecionar administração
          </button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              onChange({
                ...value,
                folhaAvulsaSubprocessIds: subprocessos.map((item) => item.id),
              })
            }
          >
            Marcar todos
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => onChange({ ...value, folhaAvulsaSubprocessIds: [] })}
          >
            Limpar
          </button>
        </div>
        <small style={{ display: "block", marginBottom: 8 }}>
          Rateia a folha avulsa total da API ({formatBRL(folhaAvulsaGeral.reduce((s, v) => s + v, 0))} na safra)
          proporcionalmente ao orçado de funcionários de cada subprocesso selecionado
          {folhaAvulsaOnly ? " e grava nesta linha." : " e grava na linha FOLHA AVULSA deste centro de custo."}
        </small>
        <div className="funcionario-source-list">
          {subprocessos.map((item) => {
            const on = (value.folhaAvulsaSubprocessIds ?? []).includes(item.id);
            return (
              <label key={`fa-${item.id}`} className={`funcionario-source-item ${on ? "on" : ""}`}>
                <input type="checkbox" checked={on} onChange={() => toggleFolhaAvulsa(item.id)} />
                <span>
                  <strong>{item.nome}</strong>
                  <small>
                    {item.codigo} · {formatBRL(item.totalSafra)} orçado na safra
                  </small>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {selectedFolhaAvulsa.length ? (
        <div className="span-2">
          <p className="lead" style={{ margin: "0 0 8px", padding: 0 }}>
            Prévia — folha avulsa · {selectedFolhaAvulsa.length} subprocesso
            {selectedFolhaAvulsa.length === 1 ? "" : "s"} · {formatBRL(folhaAvulsaPreview.totalSafra)} na safra
          </p>
          <div className="funcionario-preview-grid">
            {folhaAvulsaPreview.meses.map((amount, i) => (
              <div key={`fa-${i}`} className="funcionario-preview-cell">
                <span>{mesLabels[i] ?? MONTHS[i]}</span>
                <strong>{formatBRL(amount)}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
