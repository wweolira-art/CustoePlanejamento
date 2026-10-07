import { useEffect, useMemo, useState } from "react";
import { api, type Activity, type OracleActivity } from "../api";
import { ReadOnlyFieldset } from "../lib/editAccess";

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function Activities() {
  const [rows, setRows] = useState<Activity[]>([]);
  const [empenhos, setEmpenhos] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [empenho, setEmpenho] = useState("");
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = () => api.activities().then(setRows);
  useEffect(() => {
    void load();
    void api.materials().then((materials) => {
      const codes = [...new Set(materials.map((m) => m.empenho).filter((v): v is string => Boolean(v)))];
      codes.sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
      setEmpenhos(codes);
    });
  }, []);

  const suggestions = useMemo(() => {
    const extra = rows.map((row) => row.empenho).filter((v): v is string => Boolean(v));
    return [...new Set([...empenhos, ...extra])].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  }, [empenhos, rows]);

  const filtered = useMemo(() => {
    const raw = fold(query.trim());
    if (!raw) return rows;
    const tokens = raw.split(/\s+/).filter(Boolean);
    return rows.filter((row) => {
      const hay = fold(`${row.code} ${row.description} ${row.empenho ?? ""}`);
      return tokens.every((t) => hay.includes(t));
    });
  }, [rows, query]);

  return (
    <div className="page">
      <p className="lead">
        Cadastre as atividades da safra com código, descrição e empenho. O empenho define a qual
        classificação cada atividade pertence; o R$/ha muda a cada safra e fica na tela de cálculo
        automático. Você também pode importar atividades de planejamento.subempgenerico no Oracle.
      </p>

      <ReadOnlyFieldset>

      <section className="panel">
        <h3>Nova atividade</h3>
        <div className="form-grid">
          <label>
            Código
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ex.: 34" />
          </label>
          <label>
            Descrição
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Cobrição química" />
          </label>
          <label>
            Empenho
            <input
              list="activity-empenhos"
              value={empenho}
              onChange={(e) => setEmpenho(e.target.value)}
              placeholder="Ex.: 241"
            />
          </label>
        </div>
        {err ? <p className="lead" style={{ padding: "0 16px", color: "var(--danger)" }}>{err}</p> : null}
        <div className="modal-actions" style={{ padding: "0 16px 16px" }}>
          <button
            className="btn primary"
            onClick={async () => {
              try {
                setErr(null);
                await api.addActivity({ code, description, empenho });
                setCode("");
                setDescription("");
                setEmpenho("");
                await load();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Não foi possível salvar.");
              }
            }}
          >
            Cadastrar atividade
          </button>
          <button className="btn" onClick={() => setImportOpen(true)}>
            Importar do Oracle
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>
          Atividades cadastradas
          <small>{query.trim() ? `${filtered.length} de ${rows.length}` : rows.length}</small>
        </h3>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr", paddingBottom: 8 }}>
          <label>
            Pesquisar
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Digite o código, a descrição ou o empenho"
            />
          </label>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Código</th>
              <th>Descrição</th>
              <th>Empenho</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td>{row.code}</td>
                <td className="desc">{row.description}</td>
                <td>
                  <input
                    className="cell"
                    list="activity-empenhos"
                    defaultValue={row.empenho ?? ""}
                    key={`${row.id}-${row.empenho ?? ""}`}
                    placeholder="—"
                    onBlur={async (e) => {
                      const next = e.target.value.trim() || null;
                      if (next === (row.empenho ?? null)) return;
                      await api.updateActivity(row.id, { empenho: next });
                      await load();
                    }}
                  />
                </td>
                <td>
                  <button
                    className="icon-btn"
                    title="Excluir"
                    onClick={async () => {
                      if (!confirm(`Excluir a atividade ${row.code}?`)) return;
                      await api.deleteActivity(row.id);
                      await load();
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {!filtered.length ? (
              <tr>
                <td className="left" colSpan={4}>
                  Nenhuma atividade encontrada.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
      <datalist id="activity-empenhos">
        {suggestions.map((code) => (
          <option key={code} value={code} />
        ))}
      </datalist>
      {importOpen ? (
        <ImportOracleActivities
          onClose={() => setImportOpen(false)}
          onImported={async () => {
            await load();
            setImportOpen(false);
          }}
        />
      ) : null}
      </ReadOnlyFieldset>
    </div>
  );
}

function ImportOracleActivities({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const [items, setItems] = useState<OracleActivity[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    void api
      .oracleActivities()
      .then((data) => {
        if (!alive) return;
        setItems(data.items);
        setSelected(new Set(data.items.filter((row) => !row.imported).map((row) => row.code)));
      })
      .catch((e: Error) => {
        if (!alive) return;
        setItems([]);
        setErr(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const raw = fold(query.trim());
    if (!raw) return items;
    const tokens = raw.split(/\s+/).filter(Boolean);
    return items.filter((row) => {
      const hay = fold(`${row.code} ${row.description} ${row.unit}`);
      return tokens.every((t) => hay.includes(t));
    });
  }, [items, query]);

  const missing = items.filter((row) => !row.imported);
  const missingFiltered = filtered.filter((row) => !row.imported);
  const selectedCount = [...selected].filter((code) => missing.some((row) => row.code === code)).length;

  const toggle = (code: string, imported: boolean) => {
    if (imported) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 820 }}>
        <h3>Importar atividades do Oracle</h3>
        <p className="lead" style={{ margin: "0 0 8px" }}>
          Consulta planejamento.subempgenerico. As que já existem no cadastro ficam marcadas e não
          entram de novo.
        </p>
        <div className="form-grid" style={{ padding: "12px 0 8px" }}>
          <label className="span-2">
            Pesquisar
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Digite o código ou a descrição"
            />
          </label>
        </div>
        {loading ? <p className="lead">Consultando o Oracle…</p> : null}
        {err ? <p className="lead" style={{ color: "#9b2c2c" }}>{err}</p> : null}
        {!loading && !err ? (
          <p className="lead" style={{ margin: "0 0 8px" }}>
            {missing.length} nova(s) · {items.length - missing.length} já cadastrada(s)
          </p>
        ) : null}
        {!loading && !err ? (
          <div style={{ maxHeight: 360, overflow: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={missingFiltered.length > 0 && missingFiltered.every((row) => selected.has(row.code))}
                      onChange={(e) => {
                        setSelected((current) => {
                          const next = new Set(current);
                          for (const row of missingFiltered) {
                            if (e.target.checked) next.add(row.code);
                            else next.delete(row.code);
                          }
                          return next;
                        });
                      }}
                    />
                  </th>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>Unidade</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.code}>
                    <td>
                      <input
                        type="checkbox"
                        disabled={row.imported}
                        checked={row.imported || selected.has(row.code)}
                        onChange={() => toggle(row.code, row.imported)}
                      />
                    </td>
                    <td>{row.code}</td>
                    <td className="desc">{row.description}</td>
                    <td>{row.unit || "—"}</td>
                    <td className="left">{row.imported ? "Já cadastrada" : "Nova"}</td>
                  </tr>
                ))}
                {!filtered.length ? (
                  <tr>
                    <td className="left" colSpan={5}>
                      Nenhuma atividade encontrada.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            disabled={saving || loading || selectedCount === 0}
            onClick={async () => {
              setSaving(true);
              setErr(null);
              try {
                const codes = [...selected].filter((code) => missing.some((row) => row.code === code));
                await api.importOracleActivities(codes);
                await onImported();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Não foi possível importar.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Importando…" : `Importar ${selectedCount} atividade${selectedCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
