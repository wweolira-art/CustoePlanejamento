import { useEffect, useMemo, useState } from "react";
import { api, type HarvestArea, type HarvestAreasData } from "../api";
import { formatQty } from "../lib/format";
import { useApp } from "../store";
import { ReadOnlyFieldset } from "../lib/editAccess";

const EMPTY: HarvestAreasData = { areas: [], total: 0 };

function parseArea(raw: string) {
  const value = Number(raw.trim().replace(",", "."));
  return Number.isFinite(value) ? value : NaN;
}

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function HarvestAreas() {
  const { safraId, safra } = useApp();
  const [data, setData] = useState<HarvestAreasData>(EMPTY);
  const [description, setDescription] = useState("");
  const [area, setArea] = useState("");
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);

  const load = () =>
    api
      .harvestAreas(safraId)
      .then((next) => {
        setData(next);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));

  useEffect(() => {
    if (!safraId) return;
    void load();
  }, [safraId]);

  const areas = data.areas ?? [];
  const filtered = useMemo(() => {
    const raw = fold(query.trim());
    if (!raw) return areas;
    const tokens = raw.split(/\s+/).filter(Boolean);
    return areas.filter((row) => tokens.every((t) => fold(row.description).includes(t)));
  }, [areas, query]);

  return (
    <div className="page">
      <p className="lead">
        Cadastre as áreas em hectares da {safra?.label ?? "safra selecionada"}, por exemplo tratos de
        cana soca e plantio. Os valores mudam a cada safra; você pode copiar da safra anterior e
        ajustar só o que mudou.
      </p>

      <ReadOnlyFieldset>

      <section className="panel">
        <h3>Nova área</h3>
        <div className="form-grid">
          <label>
            Descrição
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex.: Tratos cana soca"
            />
          </label>
          <label>
            Área (ha)
            <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Ex.: 4418" />
          </label>
        </div>
        {err ? <p className="lead" style={{ padding: "0 16px", color: "var(--danger)" }}>{err}</p> : null}
        <div className="modal-actions" style={{ padding: "12px 16px 16px" }}>
          <button
            className="btn primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setErr(null);
              try {
                setData(
                  await api.addHarvestArea({
                    description,
                    area: parseArea(area),
                    safraId,
                  }),
                );
                setDescription("");
                setArea("");
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Não foi possível salvar a área.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Salvando…" : "Cadastrar área"}
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>
          Áreas da {safra?.label ?? "safra"}
          <small>
            {query.trim() ? `${filtered.length} de ${areas.length}` : areas.length}
            {data.total ? ` · ${formatQty(data.total)} ha` : ""}
          </small>
        </h3>
        {data.previousSafra ? (
          <div className="modal-actions" style={{ padding: "0 16px 12px", justifyContent: "flex-start" }}>
            <button
              className="btn"
              disabled={copying || !(data.previousCount ?? 0)}
              onClick={async () => {
                const from = data.previousSafra;
                if (!from) return;
                const warn = areas.length
                  ? `Isso substitui as ${areas.length} área(s) da ${safra?.label ?? "safra atual"} pelas da ${from.label}. Continuar?`
                  : `Copiar as áreas da ${from.label} para a ${safra?.label ?? "safra atual"}?`;
                if (!confirm(warn)) return;
                setCopying(true);
                setErr(null);
                try {
                  setData(await api.copyHarvestAreasFromPrevious(safraId));
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "Não foi possível copiar as áreas.");
                } finally {
                  setCopying(false);
                }
              }}
            >
              {copying ? "Copiando…" : `Copiar áreas da ${data.previousSafra.label}`}
            </button>
          </div>
        ) : null}
        <div className="form-grid" style={{ gridTemplateColumns: "1fr", paddingBottom: 8 }}>
          <label>
            Pesquisar
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Digite a descrição"
            />
          </label>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Descrição</th>
              <th>Área (ha)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <AreaRow key={row.id} row={row} onSaved={setData} onError={setErr} />
            ))}
            {!filtered.length ? (
              <tr>
                <td className="left" colSpan={3}>
                  {areas.length ? "Nenhuma área com esse nome." : "Nenhuma área cadastrada nesta safra."}
                </td>
              </tr>
            ) : null}
          </tbody>
          {areas.length ? (
            <tfoot>
              <tr className="total">
                <td className="left">Total</td>
                <td>{formatQty(data.total ?? 0)}</td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </section>
      </ReadOnlyFieldset>
    </div>
  );
}

function AreaRow({
  row,
  onSaved,
  onError,
}: {
  row: HarvestArea;
  onSaved: (data: HarvestAreasData) => void;
  onError: (message: string | null) => void;
}) {
  return (
    <tr>
      <td className="left">
        <input
          className="cell"
          defaultValue={row.description}
          key={`${row.id}-desc-${row.description}`}
          onBlur={async (e) => {
            const next = e.target.value.trim();
            if (!next || next === row.description) return;
            try {
              onSaved(await api.updateHarvestArea(row.id, { description: next }));
              onError(null);
            } catch (error) {
              onError(error instanceof Error ? error.message : "Não foi possível alterar a descrição.");
            }
          }}
        />
      </td>
      <td>
        <input
          className="cell"
          defaultValue={String(row.area).replace(".", ",")}
          key={`${row.id}-area-${row.area}`}
          onBlur={async (e) => {
            const next = parseArea(e.target.value);
            if (next === row.area) return;
            try {
              onSaved(await api.updateHarvestArea(row.id, { area: next }));
              onError(null);
            } catch (error) {
              onError(error instanceof Error ? error.message : "Não foi possível alterar a área.");
            }
          }}
        />
      </td>
      <td>
        <button
          className="icon-btn"
          title="Excluir área"
          onClick={async () => {
            if (!confirm(`Excluir a área “${row.description}”?`)) return;
            onSaved(await api.deleteHarvestArea(row.id));
          }}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
