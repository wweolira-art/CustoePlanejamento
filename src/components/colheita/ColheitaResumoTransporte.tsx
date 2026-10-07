import { useCallback, useMemo, useState } from "react";
import { api, type PremiseOption, type ResumoTransporteCanaData, type ResumoTransporteModo } from "../../api";
import { useApp } from "../../store";
import { SearchableReportFilter } from "../SearchableReportFilter";
import { ConsultaProgressBar } from "../ConsultaProgressBar";
import { PrintButton } from "../PrintButton";
import { safraDefaultRange } from "./colheita-utils";

function fmt2(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtMoney(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

export function ColheitaResumoTransporte() {
  const { safra, safras, safraId } = useApp();
  const defaults = useMemo(() => safraDefaultRange(safra?.code), [safra?.code]);
  const [dataInicio, setDataInicio] = useState(defaults.from);
  const [dataFim, setDataFim] = useState(defaults.to);
  const [reportSafraId, setReportSafraId] = useState(safraId);
  const [selectedCaminhoes, setSelectedCaminhoes] = useState<string[]>([]);
  const [selectedTerceiros, setSelectedTerceiros] = useState<string[]>([]);
  const [modo, setModo] = useState<ResumoTransporteModo>("proprios");
  const [caminhaoOptions, setCaminhaoOptions] = useState<PremiseOption[]>([]);
  const [terceiroOptions, setTerceiroOptions] = useState<PremiseOption[]>([]);
  const [data, setData] = useState<ResumoTransporteCanaData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reportSafra = safras.find((row) => row.id === reportSafraId) ?? safra;
  const reportSafraLabel = reportSafra?.code ?? safra?.code ?? "—";
  const colunas = data?.colunas ?? data?.equipamentos?.map((key) => ({ key, label: key })) ?? [];
  const colKeys = colunas.map((col) => col.key);
  const valorPorEquip = useMemo(() => {
    const map: Record<string, number> = {};
    for (const parte of data?.parceiros ?? []) {
      for (const [eq, val] of Object.entries(parte.equipamentos)) {
        map[eq] = (map[eq] ?? 0) + val;
      }
    }
    return map;
  }, [data]);

  const loadOptions = useCallback(async () => {
    try {
      const opts = await api.colheitaResumoTransporteOpcoes({
        dataInicio,
        dataFim,
        modo,
      });
      setCaminhaoOptions(opts.caminhoes);
      setTerceiroOptions(opts.terceiros);
    } catch {
      setCaminhaoOptions([]);
      setTerceiroOptions([]);
    }
  }, [dataInicio, dataFim, modo]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setErr(null);
      const result = await api.colheitaResumoTransporte({
        reportSafraCode: reportSafraLabel,
        dataInicio,
        dataFim,
        refDate: dataFim,
        modo,
        caminhoes: modo !== "terceiros" && selectedCaminhoes.length ? selectedCaminhoes : undefined,
        terceiros: modo !== "proprios" && selectedTerceiros.length ? selectedTerceiros : undefined,
      });
      setData(result);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [reportSafraLabel, dataInicio, dataFim, modo, selectedCaminhoes, selectedTerceiros]);

  const consultar = useCallback(async () => {
    await Promise.all([loadOptions(), load()]);
  }, [loadOptions, load]);

  const alterarPeriodoInicio = (value: string) => {
    setDataInicio(value);
    setSelectedCaminhoes([]);
    setSelectedTerceiros([]);
  };

  const alterarPeriodoFim = (value: string) => {
    setDataFim(value);
    setSelectedCaminhoes([]);
    setSelectedTerceiros([]);
  };

  const alterarModo = (next: ResumoTransporteModo) => {
    setModo(next);
    setSelectedCaminhoes([]);
    setSelectedTerceiros([]);
  };

  return (
    <>
      <p className="lead no-print">
        Resumo de transporte de cana por tipo de colheita, fazenda e equipamentos associados ou marcados como terceiro, com raio da FAZENDAUSINA e preço por faixa de frete.
      </p>
      <section className="panel no-print">
        <h3>Filtros</h3>
        <div className="form-grid">
          <label>
            Data inicial
            <input type="date" value={dataInicio} onChange={(e) => alterarPeriodoInicio(e.target.value)} />
          </label>
          <label>
            Data final
            <input type="date" value={dataFim} onChange={(e) => alterarPeriodoFim(e.target.value)} />
          </label>
          <label>
            Safra no relatório
            <select value={reportSafraId || ""} onChange={(e) => setReportSafraId(Number(e.target.value))}>
              {safras.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="kind-toggle" style={{ padding: "0 16px 12px" }}>
          <button
            type="button"
            className={`btn ${modo === "proprios" ? "primary" : ""}`}
            onClick={() => alterarModo("proprios")}
          >
            Próprios
          </button>
          <button
            type="button"
            className={`btn ${modo === "terceiros" ? "primary" : ""}`}
            onClick={() => alterarModo("terceiros")}
          >
            Terceiros
          </button>
          <button
            type="button"
            className={`btn ${modo === "ambos" ? "primary" : ""}`}
            onClick={() => alterarModo("ambos")}
          >
            Terceiros + Próprios
          </button>
        </div>
        {modo !== "terceiros" ? (
          <SearchableReportFilter
            caption="Equipamento próprio associado"
            options={caminhaoOptions}
            selected={selectedCaminhoes}
            onChange={setSelectedCaminhoes}
            placeholder="Buscar equipamento…"
            emptyLabel="Todos"
          />
        ) : null}
        {modo !== "proprios" ? (
          <SearchableReportFilter
            caption="Equipamento/caminhão terceiro"
            options={terceiroOptions}
            selected={selectedTerceiros}
            onChange={setSelectedTerceiros}
            placeholder="Buscar terceiro…"
            emptyLabel="Todos"
          />
        ) : null}
        <div className="modal-actions" style={{ padding: "0 16px 16px" }}>
          <button className="btn primary" disabled={loading} onClick={() => void consultar()}>
            {loading ? "Consultando…" : "Consultar"}
          </button>
        </div>
        <ConsultaProgressBar active={loading} label="Consultando resumo de transporte…" className="consulta-progress--compact" />
      </section>
      <div className="no-print" style={{ marginBottom: 12 }}>
        <PrintButton />
      </div>
      {err ? (
        <p className="lead no-print" style={{ color: "var(--danger)" }}>
          {err}
        </p>
      ) : null}
      {data && data.blocos.length ? (
        <section className="panel resumo-transporte-report print-report-intro">
          <header className="liberacao-colheita-header">
            <img src="/elejota-agro-logo.png" alt="Elejota Agro" className="liberacao-colheita-logo" />
            <h2 className="liberacao-colheita-title">RESUMO TRANSPORTE DE CANA SAFRA {reportSafraLabel}</h2>
            <div className="liberacao-colheita-brand-right">GRUPO LUIZ JATOBÁ</div>
          </header>
          {data.blocos.map((bloco) => (
            <div key={bloco.tipoColheita} className="resumo-transporte-bloco">
              <h3 className="resumo-transporte-grupo">{bloco.tipoColheita}</h3>
              <div className="table-wrap">
                <table className="data resumo-transporte-table">
                  <thead>
                    <tr>
                      <th>TIPOCOLHEITA</th>
                      <th>FAZENDA</th>
                      {colunas.map((col) => (
                        <th key={col.key} className="num">
                          {col.label}
                        </th>
                      ))}
                      <th className="num">COLHIDO</th>
                      <th className="num">RAIO</th>
                      <th className="num">PRECOTON</th>
                      <th className="num">VALOR TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bloco.linhas.map((linha) => (
                      <tr key={`${bloco.tipoColheita}-${linha.fazenda}`}>
                        <td>{bloco.tipoColheita}</td>
                        <td>{linha.fazenda}</td>
                        {colKeys.map((eq) => (
                          <td key={eq} className="num">
                            {fmt2(linha.equipamentos[eq])}
                          </td>
                        ))}
                        <td className="num">{fmt2(linha.colhido)}</td>
                        <td className="num">{fmt2(linha.raio)}</td>
                        <td className="num">{fmt2(linha.precoTon)}</td>
                        <td className="num">{fmtMoney(linha.valorTotal)}</td>
                      </tr>
                    ))}
                    <tr className="resumo-transporte-total">
                      <td colSpan={2}>
                        <strong>Total</strong>
                      </td>
                      {colKeys.map((eq) => (
                        <td key={eq} className="num">
                          <strong>{fmt2(bloco.totais.equipamentos[eq])}</strong>
                        </td>
                      ))}
                      <td className="num">
                        <strong>{fmt2(bloco.totais.colhido)}</strong>
                      </td>
                      <td className="num" />
                      <td className="num" />
                      <td className="num">
                        <strong>{fmtMoney(bloco.totais.valorTotal)}</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <div className="table-wrap">
            <table className="data resumo-transporte-table resumo-transporte-parceiros">
              <thead>
                <tr>
                  <th>Produto</th>
                  {colunas.map((col) => (
                    <th key={col.key} className="num">
                      {col.label}
                    </th>
                  ))}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.parceiros.map((row) => (
                  <tr key={row.nome}>
                    <td>{row.nome}</td>
                    {colKeys.map((eq) => (
                      <td key={eq} className="num">
                        {fmtMoney(row.equipamentos[eq])}
                      </td>
                    ))}
                    <td className="num">{fmtMoney(row.total)}</td>
                  </tr>
                ))}
                <tr className="resumo-transporte-total-geral">
                  <td>
                    <strong>Total</strong>
                  </td>
                  {colKeys.map((eq) => (
                    <td key={eq} className="num">
                      <strong>{fmtMoney(valorPorEquip[eq])}</strong>
                    </td>
                  ))}
                  <td className="num">
                    <strong>{fmtMoney(Object.values(valorPorEquip).reduce((acc, v) => acc + v, 0))}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : !loading && !err ? (
        <p className="lead no-print">Nenhum dado encontrado para o período selecionado.</p>
      ) : null}
    </>
  );
}
