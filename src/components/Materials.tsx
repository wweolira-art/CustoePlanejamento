import { useEffect, useMemo, useState } from "react";
import { api, type Material, type OracleMaterial } from "../api";
import { ReadOnlyFieldset } from "../lib/editAccess";

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const parseValor = (raw: string) => {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export function Materials() {
  const [rows, setRows] = useState<Material[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [tipo, setTipo] = useState<"E" | "G">("E");
  const [valor, setValor] = useState("");
  const [empenho, setEmpenho] = useState("");
  const [grupo, setGrupo] = useState("");
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = () => api.materials().then(setRows);
  const loadGroups = () =>
    api
      .materialGroups()
      .then((data) => setGroups(data.groups))
      .catch(() => undefined);

  useEffect(() => {
    void load();
    void loadGroups();
  }, []);

  const filtered = useMemo(() => {
    const tokens = fold(query.trim()).split(/\s+/).filter(Boolean);
    if (!tokens.length) return rows;
    return rows.filter((row) => {
      const hay = fold(`${row.code} ${row.description} ${row.empenho ?? ""} ${row.grupo ?? ""}`);
      return tokens.every((token) => hay.includes(token));
    });
  }, [rows, query]);

  return (
    <div className="page">
      <p className="lead">
        Cadastre os materiais com código, descrição, tipo, preço unitário e empenho. No tipo E você
        escolhe o grupo de material.grupomaterial. O preço entra no cálculo automático; a fórmula é
        definida na tela de cálculo. Você também pode importar materiais de material.material no
        Oracle.
      </p>

      <ReadOnlyFieldset>

      <section className="panel">
        <h3>Novo material</h3>
        <div className="form-grid">
          <label>
            Código do material
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ex.: 16642" />
          </label>
          <label>
            Descrição
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: ROUNDUP WG" />
          </label>
          <label>
            Tipo
            <select
              value={tipo}
              onChange={(e) => {
                const next = e.target.value as "E" | "G";
                setTipo(next);
                if (next !== "E") setGrupo("");
              }}
            >
              <option value="E">E</option>
              <option value="G">G</option>
            </select>
          </label>
          {tipo === "E" ? (
            <label>
              Grupo
              <select value={grupo} onChange={(e) => setGrupo(e.target.value)}>
                <option value="">Sem grupo</option>
                {groups.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Valor unitário
            <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex.: 21,51" />
          </label>
          <label>
            Código de empenho
            <input value={empenho} onChange={(e) => setEmpenho(e.target.value)} placeholder="Ex.: 241" />
          </label>
        </div>
        {err ? <p className="lead" style={{ padding: "0 16px", color: "var(--danger)" }}>{err}</p> : null}
        <div className="modal-actions" style={{ padding: "0 16px 16px" }}>
          <button
            className="btn primary"
            onClick={async () => {
              try {
                setErr(null);
                await api.addMaterial({
                  code,
                  description,
                  tipo,
                  empenho,
                  valor: parseValor(valor),
                  grupo: tipo === "E" ? grupo || null : null,
                });
                setCode("");
                setDescription("");
                setTipo("E");
                setValor("");
                setEmpenho("");
                setGrupo("");
                await load();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Não foi possível salvar.");
              }
            }}
          >
            Cadastrar material
          </button>
          <button className="btn" onClick={() => setImportOpen(true)}>
            Importar do Oracle
          </button>
          <button
            className="btn"
            disabled={syncing}
            onClick={async () => {
              try {
                setErr(null);
                setSyncing(true);
                const data = await api.syncMaterialGroups();
                setRows(data.materials);
                await loadGroups();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Não foi possível buscar os grupos.");
              } finally {
                setSyncing(false);
              }
            }}
          >
            {syncing ? "Buscando grupos…" : "Buscar grupos no Oracle"}
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>
          Materiais cadastrados
          <small>{query.trim() ? `${filtered.length} de ${rows.length}` : rows.length}</small>
        </h3>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr", paddingBottom: 8 }}>
          <label>
            Pesquisar
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Digite o código, a descrição, o empenho ou o grupo"
            />
          </label>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Código</th>
              <th>Descrição</th>
              <th>Tipo</th>
              <th>Grupo</th>
              <th>Valor</th>
              <th>Empenho</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td className="left">{row.code}</td>
                <td className="desc">{row.description}</td>
                <td>{row.tipo}</td>
                <td>
                  {row.tipo === "E" ? (
                    <select
                      className="cell-select"
                      value={row.grupo ?? ""}
                      onChange={async (e) => {
                        await api.updateMaterial(row.id, { grupo: e.target.value || null });
                        await load();
                      }}
                    >
                      <option value="">Sem grupo</option>
                      {(row.grupo && !groups.includes(row.grupo) ? [row.grupo, ...groups] : groups).map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <input
                    className="cell"
                    defaultValue={row.valor ?? ""}
                    key={`${row.id}-${row.valor}`}
                    onBlur={async (e) => {
                      const raw = e.target.value.trim();
                      const next = raw ? Number(raw.replace(",", ".")) : null;
                      if (next === row.valor) return;
                      await api.updateMaterial(row.id, { valor: next });
                      await load();
                    }}
                  />
                </td>
                <td>{row.empenho ?? "—"}</td>
                <td>
                  <button
                    className="icon-btn"
                    title="Excluir"
                    onClick={async () => {
                      if (!confirm(`Excluir o material ${row.code}?`)) return;
                      await api.deleteMaterial(row.id);
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
                <td className="left" colSpan={7}>
                  Nenhum material encontrado.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
      {importOpen ? (
        <ImportOracleMaterials
          onClose={() => setImportOpen(false)}
          onImported={async (materials) => {
            setRows(materials);
            await loadGroups();
            setImportOpen(false);
          }}
        />
      ) : null}
      </ReadOnlyFieldset>
    </div>
  );
}

function ImportOracleMaterials({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (materials: Material[]) => Promise<void>;
}) {
  const [items, setItems] = useState<OracleMaterial[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    void api
      .oracleMaterials(debounced)
      .then((data) => {
        if (!alive) return;
        setItems(data.items);
        setTruncated(Boolean(data.truncated));
      })
      .catch((e: Error) => {
        if (!alive) return;
        setItems([]);
        setTruncated(false);
        setErr(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [debounced]);

  const missingVisible = items.filter((row) => !row.imported);
  const selectedCount = selected.size;

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
        <h3>Importar materiais do Oracle</h3>
        <p className="lead" style={{ margin: "0 0 8px" }}>
          Consulta material.material e o grupo em material.grupomaterial. Os que já existem no
          cadastro como tipo E ficam marcados e não entram de novo. O tipo entra como E; você pode mudar depois.
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
            {items.length} material(is)
            {truncated ? " (refine a pesquisa para ver mais)" : ""}
            {missingVisible.length !== items.length ? ` · ${items.length - missingVisible.length} já cadastrado(s) (tipo E)` : ""}
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
                      disabled={!missingVisible.length}
                      checked={missingVisible.length > 0 && missingVisible.every((row) => selected.has(row.code))}
                      onChange={(e) => {
                        setSelected((current) => {
                          const next = new Set(current);
                          for (const row of missingVisible) {
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
                  <th>Grupo</th>
                  <th>Unidade</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
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
                    <td className="desc">{row.grupo || "—"}</td>
                    <td>{row.unit || "—"}</td>
                    <td className="left">{row.imported ? "Já cadastrado" : "Novo"}</td>
                  </tr>
                ))}
                {!items.length ? (
                  <tr>
                    <td className="left" colSpan={6}>
                      Nenhum material encontrado.
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
                const data = await api.importOracleMaterials([...selected]);
                await onImported(data.materials);
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Não foi possível importar.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Importando…" : `Importar ${selectedCount} material${selectedCount === 1 ? "" : "is"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
