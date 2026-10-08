import { useEffect, useMemo, useState } from "react";
import { api, type Empenho, type OracleEmpenho } from "../api";
import { ReadOnlyFieldset } from "../lib/editAccess";

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function Empenhos() {
  const [rows, setRows] = useState<Empenho[]>([]);
  const [oracleRows, setOracleRows] = useState<OracleEmpenho[]>([]);
  const [query, setQuery] = useState("");
  const [oracleQuery, setOracleQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [oracleLoading, setOracleLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadLocal = () => api.empenhos().then(setRows);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    void loadLocal()
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const tokens = fold(query.trim()).split(/\s+/).filter(Boolean);
    if (!tokens.length) return rows;
    return rows.filter((row) => tokens.every((token) => fold(`${row.code} ${row.description}`).includes(token)));
  }, [query, rows]);

  const oracleFiltered = useMemo(() => {
    const tokens = fold(oracleQuery.trim()).split(/\s+/).filter(Boolean);
    if (!tokens.length) return oracleRows;
    return oracleRows.filter((row) => tokens.every((token) => fold(`${row.code} ${row.description}`).includes(token)));
  }, [oracleQuery, oracleRows]);

  const loadOracle = async () => {
    setOracleLoading(true);
    setErr(null);
    try {
      const data = await api.oracleEmpenhos();
      setOracleRows(data.items);
      setSelected(new Set(data.items.filter((row) => !row.imported).map((row) => row.code)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível consultar os empenhos.");
    } finally {
      setOracleLoading(false);
    }
  };

  const missing = oracleRows.filter((row) => !row.imported);
  const missingFiltered = oracleFiltered.filter((row) => !row.imported);
  const selectedCount = [...selected].filter((code) => oracleRows.some((row) => row.code === code)).length;

  return (
    <div className="page">
      <p className="lead">
        Importe os empenhos do banco de dados para consultar localmente o código e a descrição.
        Use essa referência para preencher o campo Empenho no cadastro de atividades.
      </p>

      <ReadOnlyFieldset>
        <section className="panel">
          <h3>
            Empenhos locais
            <small>{query.trim() ? `${filtered.length} de ${rows.length}` : rows.length}</small>
          </h3>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr auto", alignItems: "end" }}>
            <label>
              Pesquisar
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Digite o código ou a descrição do empenho"
              />
            </label>
            <button className="btn primary" type="button" disabled={oracleLoading} onClick={loadOracle}>
              {oracleLoading ? "Consultando..." : "Consultar banco de dados"}
            </button>
          </div>
          {loading ? <p className="lead" style={{ padding: "0 16px 16px" }}>Carregando empenhos...</p> : null}
          {err ? <p className="lead" style={{ padding: "0 16px 16px", color: "var(--danger)" }}>{err}</p> : null}
          <table className="data">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td>{row.code}</td>
                  <td className="desc">{row.description}</td>
                </tr>
              ))}
              {!filtered.length && !loading ? (
                <tr>
                  <td className="left" colSpan={2}>Nenhum empenho local encontrado.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        {oracleRows.length ? (
          <section className="panel">
            <h3>
              Empenhos do banco
              <small>{missing.length} novo(s)</small>
            </h3>
            <div className="form-grid" style={{ gridTemplateColumns: "1fr", paddingBottom: 8 }}>
              <label>
                Filtrar consulta
                <input
                  value={oracleQuery}
                  onChange={(e) => setOracleQuery(e.target.value)}
                  placeholder="Digite o código ou a descrição"
                />
              </label>
            </div>
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
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {oracleFiltered.map((row) => (
                  <tr key={row.code}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(row.code)}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(row.code)) next.delete(row.code);
                            else next.add(row.code);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td>{row.code}</td>
                    <td className="desc">{row.description}</td>
                    <td className="left">{row.imported ? "Já local" : "Novo"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="modal-actions" style={{ padding: "0 16px 16px" }}>
              <button
                className="btn primary"
                disabled={saving || selectedCount === 0}
                onClick={async () => {
                  setSaving(true);
                  setErr(null);
                  try {
                    const result = await api.importOracleEmpenhos([...selected]);
                    setRows(result.empenhos);
                    setOracleRows((current) => current.map((row) => (selected.has(row.code) ? { ...row, imported: true } : row)));
                    setSelected(new Set());
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : "Não foi possível importar os empenhos.");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "Importando..." : `Importar ${selectedCount} empenho${selectedCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </section>
        ) : null}
      </ReadOnlyFieldset>
    </div>
  );
}
