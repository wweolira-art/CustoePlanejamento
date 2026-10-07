import { useEffect, useMemo, useState } from "react";
import { api, type CatalogCategory } from "../api";
import { ReadOnlyFieldset } from "../lib/editAccess";

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function Categories() {
  const [rows, setRows] = useState<CatalogCategory[]>([]);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.catalogCategories().then(setRows);
  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const raw = fold(query.trim());
    if (!raw) return rows;
    const tokens = raw.split(/\s+/).filter(Boolean);
    return rows.filter((row) => tokens.every((t) => fold(row.name).includes(t)));
  }, [rows, query]);

  return (
    <div className="page">
      <p className="lead">
        Cadastre as categorias usadas nos centros de custo. No centro de custo você escolhe uma
        categoria desta lista; o nome não fica solto em cada aba.
      </p>

      <ReadOnlyFieldset>

      <section className="panel">
        <h3>Nova categoria</h3>
        <div className="form-grid">
          <label>
            Nome da categoria
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: DESPESAS COM EPI" />
          </label>
        </div>
        {err ? <p className="lead" style={{ padding: "0 16px", color: "var(--danger)" }}>{err}</p> : null}
        <div className="modal-actions" style={{ padding: "0 16px 16px" }}>
          <button
            className="btn primary"
            onClick={async () => {
              try {
                setErr(null);
                await api.addCatalogCategory({ name });
                setName("");
                await load();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Não foi possível salvar.");
              }
            }}
          >
            Cadastrar categoria
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>
          Categorias cadastradas
          <small>{query.trim() ? `${filtered.length} de ${rows.length}` : rows.length}</small>
        </h3>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr", paddingBottom: 8 }}>
          <label>
            Pesquisar
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Digite o nome da categoria"
            />
          </label>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Nome</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td className="left">
                  <input
                    className="cell"
                    defaultValue={row.name}
                    key={`${row.id}-${row.name}`}
                    onBlur={async (e) => {
                      const next = e.target.value.trim();
                      if (!next || next === row.name) return;
                      try {
                        setErr(null);
                        await api.updateCatalogCategory(row.id, { name: next });
                        await load();
                      } catch (e) {
                        setErr(e instanceof Error ? e.message : "Não foi possível alterar.");
                      }
                    }}
                  />
                </td>
                <td>
                  <button
                    className="icon-btn"
                    title="Excluir"
                    onClick={async () => {
                      if (!confirm(`Excluir a categoria “${row.name}”?`)) return;
                      try {
                        setErr(null);
                        await api.deleteCatalogCategory(row.id);
                        await load();
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
            {!filtered.length ? (
              <tr>
                <td className="left" colSpan={2}>
                  Nenhuma categoria encontrada.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
      </ReadOnlyFieldset>
    </div>
  );
}
