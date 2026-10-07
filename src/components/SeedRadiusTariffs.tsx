import { useEffect, useState } from "react";
import { api, type SeedRadiusTariff, type SeedRadiusTariffsData } from "../api";
import { formatBRL, formatQty } from "../lib/format";
import { useApp } from "../store";
import { ReadOnlyFieldset } from "../lib/editAccess";

const EMPTY: SeedRadiusTariffsData = { tariffs: [] };

function parseNum(raw: string) {
  const value = Number(raw.trim().replace(",", "."));
  return Number.isFinite(value) ? value : NaN;
}

export function SeedRadiusTariffs() {
  const { safraId, safra } = useApp();
  const [data, setData] = useState<SeedRadiusTariffsData>(EMPTY);
  const [startKm, setStartKm] = useState("");
  const [endKm, setEndKm] = useState("");
  const [price, setPrice] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);

  const load = () =>
    api
      .seedRadiusTariffs(safraId)
      .then((next) => {
        setData(next);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));

  useEffect(() => {
    if (!safraId) return;
    void load();
  }, [safraId]);

  const tariffs = data.tariffs ?? [];

  return (
    <div className="page">
      <p className="lead">
        Cadastre as faixas de raio do transporte de semente da {safra?.label ?? "safra selecionada"}.
        Informe o quilômetro inicial, o quilômetro final e o preço da faixa, por exemplo 0 a 10 km
        a um preço e 10 a 25 km a outro.
      </p>

      <ReadOnlyFieldset>

      <section className="panel">
        <h3>Nova faixa</h3>
        <div className="form-grid">
          <label>
            Valor inicial (km)
            <input value={startKm} onChange={(e) => setStartKm(e.target.value)} placeholder="Ex.: 0" />
          </label>
          <label>
            Valor final (km)
            <input value={endKm} onChange={(e) => setEndKm(e.target.value)} placeholder="Ex.: 10" />
          </label>
          <label>
            Preço
            <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Ex.: 18,50" />
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
                  await api.addSeedRadiusTariff({
                    startKm: parseNum(startKm),
                    endKm: parseNum(endKm),
                    price: parseNum(price),
                    safraId,
                  }),
                );
                setStartKm("");
                setEndKm("");
                setPrice("");
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Não foi possível salvar a faixa.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Salvando…" : "Salvar faixa"}
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>
          Faixas da {safra?.label ?? "safra"}
          <small>{tariffs.length}</small>
        </h3>
        {data.previousSafra ? (
          <div className="modal-actions" style={{ padding: "0 16px 12px", justifyContent: "flex-start" }}>
            <button
              className="btn"
              disabled={copying || !(data.previousCount ?? 0)}
              onClick={async () => {
                const from = data.previousSafra;
                if (!from) return;
                const warn = tariffs.length
                  ? `Isso substitui as ${tariffs.length} faixa(s) da ${safra?.label ?? "safra atual"} pelas da ${from.label}. Continuar?`
                  : `Copiar as faixas da ${from.label} para a ${safra?.label ?? "safra atual"}?`;
                if (!confirm(warn)) return;
                setCopying(true);
                setErr(null);
                try {
                  setData(await api.copySeedRadiusTariffsFromPrevious(safraId));
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "Não foi possível copiar as faixas.");
                } finally {
                  setCopying(false);
                }
              }}
            >
              {copying ? "Copiando…" : `Copiar faixas da ${data.previousSafra.label}`}
            </button>
          </div>
        ) : null}
        <table className="data">
          <thead>
            <tr>
              <th>Valor inicial</th>
              <th>Valor final</th>
              <th>Preço</th>
              <th>Faixa</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tariffs.map((row) => (
              <TariffRow
                key={row.id}
                row={row}
                onSaved={setData}
                onError={setErr}
              />
            ))}
            {!tariffs.length ? (
              <tr>
                <td className="left" colSpan={5}>
                  Nenhuma faixa cadastrada nesta safra.
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

function TariffRow({
  row,
  onSaved,
  onError,
}: {
  row: SeedRadiusTariff;
  onSaved: (data: SeedRadiusTariffsData) => void;
  onError: (message: string | null) => void;
}) {
  return (
    <tr>
      <td>
        <input
          className="cell"
          defaultValue={row.startKm}
          key={`${row.id}-start-${row.startKm}`}
          onBlur={async (e) => {
            const next = parseNum(e.target.value);
            if (next === row.startKm) return;
            try {
              onSaved(await api.updateSeedRadiusTariff(row.id, { startKm: next }));
              onError(null);
            } catch (error) {
              onError(error instanceof Error ? error.message : "Não foi possível atualizar o valor inicial.");
            }
          }}
        />
      </td>
      <td>
        <input
          className="cell"
          defaultValue={row.endKm}
          key={`${row.id}-end-${row.endKm}`}
          onBlur={async (e) => {
            const next = parseNum(e.target.value);
            if (next === row.endKm) return;
            try {
              onSaved(await api.updateSeedRadiusTariff(row.id, { endKm: next }));
              onError(null);
            } catch (error) {
              onError(error instanceof Error ? error.message : "Não foi possível atualizar o valor final.");
            }
          }}
        />
      </td>
      <td>
        <input
          className="cell"
          defaultValue={row.price}
          key={`${row.id}-price-${row.price}`}
          onBlur={async (e) => {
            const next = parseNum(e.target.value);
            if (next === row.price) return;
            try {
              onSaved(await api.updateSeedRadiusTariff(row.id, { price: next }));
              onError(null);
            } catch (error) {
              onError(error instanceof Error ? error.message : "Não foi possível atualizar o preço.");
            }
          }}
        />
      </td>
      <td className="left desc">
        {formatQty(row.startKm)} a {formatQty(row.endKm)} km · {formatBRL(row.price)}
      </td>
      <td>
        <button
          className="icon-btn"
          title="Excluir faixa"
          onClick={async () => {
            if (!confirm("Remover esta faixa de raio?")) return;
            onSaved(await api.deleteSeedRadiusTariff(row.id));
          }}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
