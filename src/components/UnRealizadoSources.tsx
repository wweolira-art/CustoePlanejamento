import { useEffect, useMemo, useState } from "react";
import {
  api,
  type UnRealizadoKind,
  type UnRealizadoMetric,
  type UnRealizadoSourcesData,
} from "../api";
import { formatQty } from "../lib/format";
import { costPlanningTab, useApp } from "../store";

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const EMPTY: UnRealizadoSourcesData = { fromDate: "", toDate: "", sources: [] };

const KIND_HELP: Record<UnRealizadoKind, string> = {
  apontamento_terceiro:
    "Soma área cultivada ou quantidade em automotivo.itens_apontamentoterceiro no período da safra, filtrando pelos códigos de operação escolhidos.",
  apontamento_maquinas:
    "Soma área ou quantidade em automotivo.itens_apontamento no período da safra, filtrando pelos códigos de operação escolhidos.",
  irrigacao:
    "Soma os máximos de area_talhao por fazenda/talhão em agricola.vw_apontamentoirrigacao no período da safra. Não precisa de operação.",
};

export function UnRealizadoSources() {
  const { sheets, safra, safraId, go } = useApp();
  const [data, setData] = useState<UnRealizadoSourcesData>(EMPTY);
  const [kinds, setKinds] = useState<
    { id: UnRealizadoKind; label: string; needsOperations: boolean; metrics: UnRealizadoMetric[] }[]
  >([]);
  const [operations, setOperations] = useState<{ code: string; label: string }[]>([]);
  const [sheetId, setSheetId] = useState(0);
  const [sourceKind, setSourceKind] = useState<UnRealizadoKind>("apontamento_terceiro");
  const [metric, setMetric] = useState<UnRealizadoMetric>("area");
  const [opQuery, setOpQuery] = useState("");
  const [selectedOps, setSelectedOps] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const centers = sheets.filter((s) => s.kind === "cost_center" && s.visible);
  const kindMeta = kinds.find((row) => row.id === sourceKind);
  const needsOps = kindMeta?.needsOperations ?? sourceKind !== "irrigacao";

  const load = () => {
    setLoading(true);
    setErr(null);
    return Promise.all([
      api.unRealizadoSources(safraId),
      api.unRealizadoKinds(),
      api.unRealizadoOperations(),
    ])
      .then(([sources, kindData, ops]) => {
        setData(sources);
        setKinds(kindData.kinds);
        setOperations(ops.items);
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void load();
  }, [safraId]);

  useEffect(() => {
    if (sourceKind === "irrigacao") {
      setMetric("area");
      setSelectedOps([]);
    }
  }, [sourceKind]);

  const opHits = useMemo(() => {
    const tokens = fold(opQuery.trim()).split(/\s+/).filter(Boolean);
    const pool = operations;
    if (!tokens.length) return pool.slice(0, 40);
    return pool
      .filter((row) => {
        const hay = fold(`${row.code} ${row.label}`);
        return tokens.every((token) => hay.includes(token));
      })
      .slice(0, 40);
  }, [operations, opQuery]);

  const selectedSet = new Set(selectedOps);
  const selectedItems = operations.filter((row) => selectedSet.has(row.code));

  const toggleOp = (code: string) => {
    setSelectedOps((current) =>
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code],
    );
  };

  const editRow = (id: number) => {
    const row = data.sources.find((item) => item.id === id);
    if (!row) return;
    setSheetId(row.sheetId);
    setSourceKind(row.sourceKind);
    setMetric(row.metric);
    setSelectedOps(row.operations.map((op) => op.code));
    setOpQuery("");
  };

  return (
    <div>
      <p className="lead" style={{ marginTop: 8 }}>
        Defina de onde o Orçado x realizado busca a Un do realizado para calcular o R$/un
        Realizado em cada centro de custo. As consultas usam o período da{" "}
        {safra?.label ?? "safra"} ({data.fromDate || "…"} a {data.toDate || "…"}). O R$/un Orçado
        continua usando os hectares de plantio das premissas.
      </p>

      <section className="panel">
        <h3>Nova configuração</h3>
        <div className="form-grid">
          <label className="span-2">
            Centro de custo
            <select value={sheetId || ""} onChange={(e) => setSheetId(Number(e.target.value) || 0)}>
              <option value="">Selecione</option>
              {centers.map((sheet) => (
                <option key={sheet.id} value={sheet.id}>
                  {sheet.title}
                </option>
              ))}
            </select>
            <small>A Un calculada entra só nesse centro no resumo do Orçado x realizado.</small>
          </label>

          <label className="span-2">
            Origem da Un
            <div className="kind-toggle" style={{ padding: "8px 0 0" }}>
              {(kinds.length
                ? kinds
                : [
                    { id: "apontamento_terceiro" as const, label: "Apontamento de terceiro" },
                    { id: "apontamento_maquinas" as const, label: "Apontamento de máquinas" },
                    { id: "irrigacao" as const, label: "Irrigação" },
                  ]
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`btn ${sourceKind === item.id ? "primary" : ""}`}
                  onClick={() => setSourceKind(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <small>{KIND_HELP[sourceKind]}</small>
          </label>

          {needsOps ? (
            <label className="span-2">
              Medida
              <div className="kind-toggle" style={{ padding: "8px 0 0" }}>
                {(kindMeta?.metrics ?? (["area", "quantity"] as UnRealizadoMetric[])).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`btn ${metric === item ? "primary" : ""}`}
                    onClick={() => setMetric(item)}
                  >
                    {item === "area" ? "Área" : "Quantidade"}
                  </button>
                ))}
              </div>
            </label>
          ) : null}
        </div>

        {needsOps ? (
          <>
            <div className="form-grid">
              <label className="span-2">
                Operação agrícola (código ou descrição)
                <input
                  value={opQuery}
                  onChange={(e) => setOpQuery(e.target.value)}
                  placeholder="Ex.: 53 ou Adubação"
                />
                <small>
                  {selectedOps.length
                    ? `${selectedOps.length} selecionada(s). Clique de novo para tirar.`
                    : `${operations.length} operação(ões) no cadastro.`}
                </small>
              </label>
            </div>
            {selectedOps.length ? (
              <div className="kind-toggle">
                <span className="toggle-caption">Selecionadas</span>
                {selectedOps.map((code) => {
                  const item = selectedItems.find((row) => row.code === code);
                  const label = item ? `${code} — ${item.label}` : code;
                  return (
                    <button
                      key={code}
                      type="button"
                      className="btn primary"
                      title={label}
                      onClick={() => toggleOp(code)}
                    >
                      {label} ✕
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className="table-wrap" style={{ maxHeight: 280, overflow: "auto" }}>
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 44 }} />
                    <th>Código</th>
                    <th>Descrição</th>
                  </tr>
                </thead>
                <tbody>
                  {opHits.map((row) => {
                    const on = selectedSet.has(row.code);
                    return (
                      <tr
                        key={row.code}
                        onClick={() => toggleOp(row.code)}
                        style={{ cursor: "pointer" }}
                      >
                        <td>
                          <input type="checkbox" checked={on} readOnly />
                        </td>
                        <td>{row.code}</td>
                        <td className="desc">{row.label}</td>
                      </tr>
                    );
                  })}
                  {!opHits.length ? (
                    <tr>
                      <td className="left" colSpan={3}>
                        Nenhuma operação encontrada.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {err ? (
          <p className="lead" style={{ padding: "0 16px", color: "var(--danger)" }}>
            {err}
          </p>
        ) : null}
        <div className="modal-actions" style={{ padding: "12px 16px 16px" }}>
          <button type="button" className="btn" onClick={() => go(costPlanningTab("orcadoRealizado"))}>
            Ver Orçado x realizado
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={saving || !sheetId}
            onClick={async () => {
              if (!sheetId) {
                setErr("Escolha o centro de custo.");
                return;
              }
              if (needsOps && !selectedOps.length) {
                setErr("Marque pelo menos uma operação agrícola.");
                return;
              }
              setSaving(true);
              setErr(null);
              try {
                setData(
                  await api.saveUnRealizadoSource({
                    sheetId,
                    sourceKind,
                    metric: sourceKind === "irrigacao" ? "area" : metric,
                    operations: selectedOps.map((code) => {
                      const item = operations.find((row) => row.code === code);
                      return { code, label: item?.label };
                    }),
                    safraId,
                  }),
                );
                setSelectedOps([]);
                setOpQuery("");
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Não foi possível salvar.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>
          Configurações
          <small>
            {loading ? "Consultando…" : data.sources.length}
            {data.fromDate ? ` · ${data.fromDate} a ${data.toDate}` : ""}
          </small>
        </h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Centro de custo</th>
                <th>Origem</th>
                <th>Medida</th>
                <th>Operações</th>
                <th>Un na safra</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.sources.map((row) => (
                <tr key={row.id}>
                  <td className="desc">{row.sheetTitle}</td>
                  <td>{row.sourceLabel}</td>
                  <td>{row.metricLabel}</td>
                  <td className="desc">
                    {row.sourceKind === "irrigacao"
                      ? "—"
                      : row.operations.map((op) => `${op.code} — ${op.label}`).join("; ") || "—"}
                  </td>
                  <td>{row.units != null && row.units > 0 ? formatQty(row.units) : "—"}</td>
                  <td>
                    <button type="button" className="btn" onClick={() => editRow(row.id)}>
                      Editar
                    </button>{" "}
                    <button
                      type="button"
                      className="icon-btn"
                      title="Excluir"
                      onClick={async () => {
                        if (!confirm(`Remover a Un realizado de ${row.sheetTitle}?`)) return;
                        try {
                          setData(await api.deleteUnRealizadoSource(row.id, safraId));
                        } catch (e) {
                          setErr(e instanceof Error ? e.message : "Não foi possível excluir.");
                        }
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {!data.sources.length && !loading ? (
                <tr>
                  <td className="left" colSpan={6}>
                    Nenhuma origem configurada. Exemplo: Irrigação → área irrigada (Σ max por
                    talhão) no centro Irrigação.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
