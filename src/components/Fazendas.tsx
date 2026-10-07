import { useEffect, useMemo, useState } from "react";
import { api, type Fazenda, type OracleFazenda } from "../api";
import { ReadOnlyFieldset } from "../lib/editAccess";

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function formatDistancia(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function Fazendas() {
  const [rows, setRows] = useState<Fazenda[]>([]);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [distancia, setDistancia] = useState("");
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = () => api.fazendas().then(setRows);
  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const raw = fold(query.trim());
    if (!raw) return rows;
    const tokens = raw.split(/\s+/).filter(Boolean);
    return rows.filter((row) => {
      const hay = fold(`${row.code} ${row.description} ${row.distancia ?? ""}`);
      return tokens.every((t) => hay.includes(t));
    });
  }, [rows, query]);

  return (
    <div className="page">
      <p className="lead">
        Cadastre as fazendas com código, descrição e distância. Você também pode importar de{" "}
        <code>agricola.fazenda</code> no Oracle.
      </p>

      <ReadOnlyFieldset>

      <section className="panel">
        <h3>Nova fazenda</h3>
        <div className="form-grid">
          <label>
            Código
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ex.: 12" />
          </label>
          <label>
            Descrição
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex.: Fazenda Santa Rita"
            />
          </label>
          <label>
            Distância (km)
            <input
              value={distancia}
              onChange={(e) => setDistancia(e.target.value)}
              placeholder="Ex.: 18,5"
            />
          </label>
        </div>
        {err ? (
          <p className="lead" style={{ padding: "0 16px", color: "var(--danger)" }}>
            {err}
          </p>
        ) : null}
        <div className="modal-actions" style={{ padding: "0 16px 16px" }}>
          <button
            className="btn primary"
            onClick={async () => {
              try {
                setErr(null);
                const distRaw = distancia.trim().replace(",", ".");
                const distNum = distRaw ? Number(distRaw) : null;
                if (distRaw && !(distNum != null && Number.isFinite(distNum))) {
                  setErr("Informe uma distância válida.");
                  return;
                }
                await api.addFazenda({
                  code,
                  description,
                  distancia: distNum,
                });
                setCode("");
                setDescription("");
                setDistancia("");
                await load();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Não foi possível salvar.");
              }
            }}
          >
            Cadastrar fazenda
          </button>
          <button className="btn" onClick={() => setImportOpen(true)}>
            Importar do Oracle
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>
          Fazendas cadastradas
          <small>{query.trim() ? `${filtered.length} de ${rows.length}` : rows.length}</small>
        </h3>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr", paddingBottom: 8 }}>
          <label>
            Pesquisar
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Digite o código, a descrição ou a distância"
            />
          </label>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Código</th>
              <th>Descrição</th>
              <th>Distância (km)</th>
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
                    defaultValue={row.distancia == null ? "" : String(row.distancia).replace(".", ",")}
                    key={`${row.id}-${row.distancia ?? ""}`}
                    placeholder="—"
                    onBlur={async (e) => {
                      const raw = e.target.value.trim().replace(",", ".");
                      const next = raw === "" ? null : Number(raw);
                      if (raw !== "" && !(next != null && Number.isFinite(next))) {
                        e.target.value =
                          row.distancia == null ? "" : String(row.distancia).replace(".", ",");
                        return;
                      }
                      if (next === (row.distancia ?? null)) return;
                      await api.updateFazenda(row.id, { distancia: next });
                      await load();
                    }}
                  />
                </td>
                <td>
                  <button
                    className="icon-btn"
                    title="Excluir"
                    onClick={async () => {
                      if (!confirm(`Excluir a fazenda ${row.code}?`)) return;
                      await api.deleteFazenda(row.id);
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
                  Nenhuma fazenda encontrada.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {importOpen ? (
        <ImportOracleFazendas
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

function ImportOracleFazendas({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const [items, setItems] = useState<OracleFazenda[]>([]);
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
      .oracleFazendas()
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
      const hay = fold(`${row.code} ${row.description} ${row.distancia ?? ""}`);
      return tokens.every((t) => hay.includes(t));
    });
  }, [items, query]);

  const selectable = items;
  const selectableFiltered = filtered;
  const selectedCount = [...selected].filter((code) => selectable.some((row) => row.code === code)).length;

  const toggle = (code: string) => {
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
        <h3>Importar fazendas do Oracle</h3>
        <p className="lead" style={{ margin: "0 0 8px" }}>
          Consulta <code>agricola.fazenda</code>. As que já existem podem ser selecionadas de novo para
          atualizar descrição e distância.
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
        {err ? (
          <p className="lead" style={{ color: "#9b2c2c" }}>
            {err}
          </p>
        ) : null}
        {!loading && !err ? (
          <p className="lead" style={{ margin: "0 0 8px" }}>
            {items.filter((row) => !row.imported).length} nova(s) ·{" "}
            {items.filter((row) => row.imported).length} já cadastrada(s)
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
                      checked={
                        selectableFiltered.length > 0 &&
                        selectableFiltered.every((row) => selected.has(row.code))
                      }
                      onChange={(e) => {
                        setSelected((current) => {
                          const next = new Set(current);
                          for (const row of selectableFiltered) {
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
                  <th>Distância</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.code}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(row.code)}
                        onChange={() => toggle(row.code)}
                      />
                    </td>
                    <td>{row.code}</td>
                    <td className="desc">{row.description}</td>
                    <td>{formatDistancia(row.distancia)}</td>
                    <td className="left">{row.imported ? "Já cadastrada" : "Nova"}</td>
                  </tr>
                ))}
                {!filtered.length ? (
                  <tr>
                    <td className="left" colSpan={5}>
                      Nenhuma fazenda encontrada.
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
                const codes = [...selected].filter((code) =>
                  selectable.some((row) => row.code === code),
                );
                await api.importOracleFazendas(codes);
                await onImported();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Não foi possível importar.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving
              ? "Importando…"
              : `Importar ${selectedCount} fazenda${selectedCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
