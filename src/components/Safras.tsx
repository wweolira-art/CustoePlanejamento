import { useMemo, useState } from "react";
import { useApp } from "../store";
import { ReadOnlyFieldset } from "../lib/editAccess";

function nextSafraCode(codes: string[]) {
  const years = codes
    .map((code) => {
      const match = code.match(/^(\d{2})\//);
      if (!match) return null;
      const yy = Number(match[1]);
      return yy >= 90 ? 1900 + yy : 2000 + yy;
    })
    .filter((n): n is number => n != null);
  const start = (years.length ? Math.max(...years) : new Date().getFullYear()) + 1;
  const yy = start % 100;
  return `${String(yy).padStart(2, "0")}/${String((yy + 1) % 100).padStart(2, "0")}`;
}

export function Safras() {
  const { safras, safraId, addSafra, selectSafra, removeSafra } = useApp();
  const suggested = useMemo(() => nextSafraCode(safras.map((row) => row.code)), [safras]);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [copyFrom, setCopyFrom] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const source = [...safras].sort((a, b) => a.code.localeCompare(b.code)).at(-1);

  return (
    <div className="page">
      <p className="lead">
        Cadastre as safras do orçamento, como 25/26 e 26/27. O seletor do topo escolhe qual está em
        uso. Premissas, cálculo automático e tarifas de raio ficam separados por safra.
      </p>

      <ReadOnlyFieldset>

      <section className="panel">
        <h3>Nova safra</h3>
        <div className="form-grid">
          <label>
            Período
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={`Ex.: ${suggested}`}
            />
          </label>
          <label>
            Nome
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={
                (code.trim() || suggested) ? `Safra ${code.trim() || suggested}` : "Ex.: Safra 27/28"
              }
            />
          </label>
          <label className="span-2 check-label">
            <span className="check-row">
              <input
                type="checkbox"
                checked={copyFrom}
                onChange={(e) => setCopyFrom(e.target.checked)}
              />
              Copiar premissas, áreas e parâmetros da {source?.label ?? "safra anterior"}
            </span>
            <small>
              A nova safra já entra com hectares, áreas cadastradas, cálculo automático e raio de semente. As associações
              do realizado valem para todas as safras. Depois você ajusta só o que mudou.
            </small>
          </label>
        </div>
        {err ? <p className="lead" style={{ padding: "0 16px", color: "var(--danger)" }}>{err}</p> : null}
        <div className="modal-actions" style={{ padding: "0 16px 16px" }}>
          <button
            className="btn primary"
            disabled={saving}
            onClick={async () => {
              try {
                setErr(null);
                setSaving(true);
                await addSafra(code.trim() || suggested, label.trim() || undefined, copyFrom);
                setCode("");
                setLabel("");
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Não foi possível cadastrar a safra.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Cadastrando…" : "Cadastrar safra"}
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>
          Safras cadastradas
          <small>{safras.length}</small>
        </h3>
        <table className="data">
          <thead>
            <tr>
              <th>Período</th>
              <th>Nome</th>
              <th>Situação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {safras.map((row) => (
              <tr key={row.id}>
                <td>{row.code}</td>
                <td className="left desc">{row.label}</td>
                <td className="left">{row.id === safraId ? "Em uso" : "—"}</td>
                <td>
                  <div className="row-actions">
                    {row.id !== safraId ? (
                      <button className="btn" onClick={() => void selectSafra(row.id)}>
                        Usar
                      </button>
                    ) : null}
                    <button
                      className="icon-btn"
                      title="Excluir safra"
                      onClick={async () => {
                        if (!confirm(`Excluir a ${row.label}? Os parâmetros de cálculo dessa safra também saem.`)) {
                          return;
                        }
                        try {
                          await removeSafra(row.id);
                        } catch (e) {
                          setErr(e instanceof Error ? e.message : "Não foi possível excluir.");
                        }
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!safras.length ? (
              <tr>
                <td className="left" colSpan={4}>
                  Nenhuma safra cadastrada.
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
