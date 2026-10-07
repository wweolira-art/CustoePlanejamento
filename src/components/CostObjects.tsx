import { useEffect, useState } from "react";
import { api, type CostObject } from "../api";
import { ReadOnlyFieldset } from "../lib/editAccess";

export function CostObjects() {
  const [rows, setRows] = useState<CostObject[]>([]);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.costObjects().then(setRows);
  useEffect(() => {
    void load();
  }, []);

  const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const filtered = q.trim()
    ? rows.filter((row) => fold(`${row.code} ${row.description}`).includes(fold(q)))
    : rows;

  return (
    <div className="page">
      <p className="lead">
        Cadastre os objetos de custo com código e descrição. Eles aparecem na coluna de objeto de
        custo de cada linha dos centros.
      </p>

      <ReadOnlyFieldset>

      <section className="panel">
        <h3>Novo objeto de custo</h3>
        <div className="form-grid">
          <label>
            Código do objeto de custo
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ex.: 34" />
          </label>
          <label>
            Descrição
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Cobrição química" />
          </label>
        </div>
        {err ? <p className="lead" style={{ padding: "0 16px", color: "var(--danger)" }}>{err}</p> : null}
        <div className="modal-actions" style={{ padding: "0 16px 16px" }}>
          <button
            className="btn primary"
            onClick={async () => {
              try {
                setErr(null);
                await api.addCostObject({ code, description });
                setCode("");
                setDescription("");
                await load();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Não foi possível salvar.");
              }
            }}
          >
            Cadastrar objeto de custo
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>
          Objetos de custo cadastrados
          <small>{filtered.length}</small>
        </h3>
        <div className="form-grid" style={{ paddingBottom: 8 }}>
          <label>
            Pesquisar
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código ou descrição" />
          </label>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Código</th>
              <th>Descrição</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td className="left">{row.code}</td>
                <td className="desc">{row.description}</td>
                <td>
                  <button
                    className="icon-btn"
                    title="Excluir"
                    onClick={async () => {
                      if (!confirm(`Excluir o objeto de custo ${row.code}?`)) return;
                      await api.deleteCostObject(row.id);
                      await load();
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      </ReadOnlyFieldset>
    </div>
  );
}
