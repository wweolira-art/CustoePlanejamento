import { useMemo, useState } from "react";
import { api, type ColheitaFazendaEntradaRow, type ColheitaFazendaSistemaRow, type ColheitaFazendaUsinaRow } from "../../api";
import { ColheitaFiltros, useColheitaPeriod } from "./ColheitaFiltros";
import { cell } from "./colheita-utils";

export function ColheitaAssociarFazenda() {
  const { dataInicio, dataFim, setPeriod } = useColheitaPeriod();
  const [filtro, setFiltro] = useState("");
  const [entrada, setEntrada] = useState<ColheitaFazendaEntradaRow[]>([]);
  const [sistema, setSistema] = useState<ColheitaFazendaSistemaRow[]>([]);
  const [usina, setUsina] = useState<ColheitaFazendaUsinaRow[]>([]);
  const [descricao, setDescricao] = useState("");
  const [codSistema, setCodSistema] = useState("");
  const [raio, setRaio] = useState("");
  const [resumo, setResumo] = useState<{ totalFazendas?: number; comVinculo?: number; semVinculo?: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const filtrados = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return entrada;
    return entrada.filter((r) => [r.fazenda, r.codSistema, r.codigoPrefixo].join(" ").toLowerCase().includes(q));
  }, [entrada, filtro]);

  const load = async () => {
    try {
      setLoading(true);
      setErr(null);
      const [ent, sis, us] = await Promise.all([
        api.colheitaFazendasEntrada({ dataInicio, dataFim }),
        api.colheitaFazendasSistema(),
        api.colheitaFazendaUsina(),
      ]);
      setEntrada(ent.dados);
      setResumo(ent.resumo);
      setSistema(sis.dados);
      setUsina(us.dados);
      setStatus(`${ent.dados.length} fazenda(s) na entrada de cana.`);
    } catch (e) {
      setEntrada([]);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const salvar = async (limpar: boolean) => {
    const desc = descricao.trim();
    if (!desc) {
      setErr("Informe a descrição da fazenda (entrada).");
      return;
    }
    if (!limpar && !codSistema.trim()) {
      setErr("Informe o cod_sistema ou use Limpar.");
      return;
    }
    if (!window.confirm(limpar ? `Limpar cod_sistema de "${desc}"?` : `Salvar vínculo "${desc}" → cod_sistema ${codSistema}?`)) return;
    try {
      setLoading(true);
      setErr(null);
      await api.colheitaSalvarFazendaUsina({
        descricaoUsina: desc,
        codSistema: limpar ? null : codSistema.trim(),
        raio: raio.trim() || null,
        limpar,
      });
      setStatus(limpar ? "Vínculo limpo." : "Vínculo salvo.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <p className="lead">
        De-para entre nomes de fazenda na entrada de cana (usina) e <code>cod_sistema</code> do ERP (FAZENDAUSINA / agricola.fazenda).
      </p>
      <ColheitaFiltros dataInicio={dataInicio} dataFim={dataFim} onChange={setPeriod} loading={loading} onConsultar={() => void load()} />
      {err ? <p className="lead" style={{ color: "var(--danger)" }}>{err}</p> : null}
      {status ? <p className="lead">{status}</p> : null}
      {resumo ? (
        <div className="kpis">
          <div className="kpi"><span>Fazendas entrada</span><strong>{resumo.totalFazendas ?? 0}</strong></div>
          <div className="kpi"><span>Com vínculo</span><strong>{resumo.comVinculo ?? 0}</strong></div>
          <div className="kpi"><span>Sem vínculo</span><strong>{resumo.semVinculo ?? 0}</strong></div>
        </div>
      ) : null}

      <section className="panel">
        <h3>Salvar vínculo</h3>
        <div className="form-grid">
          <label className="span-2">
            Descrição usina (fazenda entrada)
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </label>
          <label>
            cod_sistema
            <input value={codSistema} onChange={(e) => setCodSistema(e.target.value)} />
          </label>
          <label>
            Raio (km)
            <input value={raio} onChange={(e) => setRaio(e.target.value)} />
          </label>
          <label>
            Filtrar lista entrada
            <input value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          </label>
        </div>
        <div className="modal-actions" style={{ padding: "0 16px 16px" }}>
          <button className="btn primary" disabled={loading} onClick={() => void salvar(false)}>Salvar</button>
          <button className="btn" disabled={loading} onClick={() => void salvar(true)}>Limpar cod_sistema</button>
        </div>
        {filtrados.length ? (
          <div style={{ padding: "0 16px 16px", display: "grid", gap: 8, maxHeight: 220, overflow: "auto" }}>
            {filtrados.map((r) => (
              <label key={r.fazenda} className="check-label" style={{ cursor: "pointer" }}>
                <span className="check-row">
                  <input
                    type="radio"
                    name="fazenda-pick"
                    checked={descricao === r.fazenda}
                    onChange={() => {
                      setDescricao(r.fazenda);
                      if (r.codSistema != null) setCodSistema(String(r.codSistema));
                      if (r.raio != null) setRaio(String(r.raio));
                    }}
                  />
                  <span>
                    <strong>{r.fazenda}</strong> — {r.qtdEntradas} entrada(s)
                    {r.codSistema != null ? ` · cod ${r.codSistema}` : " · sem vínculo"}
                    {r.match ? ` (${r.match})` : ""}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : null}
      </section>

      <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <section className="panel">
          <h3>Fazendas ERP (agricola.fazenda)</h3>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Código</th><th>Descrição</th><th>Distância</th></tr></thead>
              <tbody>
                {sistema.slice(0, 200).map((r, i) => (
                  <tr
                    key={i}
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      if (r.codFazenda != null) setCodSistema(String(r.codFazenda));
                      if (r.distancia != null) setRaio(String(r.distancia));
                    }}
                  >
                    <td>{cell(r.codFazenda)}</td><td>{cell(r.descricao)}</td><td>{cell(r.distancia)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <h3>Mapeamentos FAZENDAUSINA</h3>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Descrição usina</th><th>cod_sistema</th><th>Raio</th></tr></thead>
              <tbody>
                {usina.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    <td>{cell(r.descricaoUsina)}</td><td>{cell(r.codSistema)}</td><td>{cell(r.raio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
