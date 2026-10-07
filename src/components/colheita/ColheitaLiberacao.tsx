import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ColheitaListResumo, type LiberacaoColheitaRow, type PremiseOption } from "../../api";
import { useApp } from "../../store";
import { SearchableReportFilter } from "../SearchableReportFilter";
import { PrintButton } from "../PrintButton";

function fmt2(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function ColheitaLiberacao() {
  const { safra, safras, safraId } = useApp();
  const [reportSafraId, setReportSafraId] = useState(safraId);
  const [selectedCodFazendas, setSelectedCodFazendas] = useState<string[]>([]);
  const [selectedFazendas, setSelectedFazendas] = useState<string[]>([]);
  const [selectedTalhoes, setSelectedTalhoes] = useState<string[]>([]);
  const [filterOptions, setFilterOptions] = useState<{
    codFazendas: PremiseOption[];
    fazendas: PremiseOption[];
    talhoes: PremiseOption[];
  }>({ codFazendas: [], fazendas: [], talhoes: [] });
  const [rows, setRows] = useState<LiberacaoColheitaRow[]>([]);
  const [resumo, setResumo] = useState<ColheitaListResumo | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const safraLabel = safra?.code ?? "—";
  const reportSafra = safras.find((row) => row.id === reportSafraId) ?? safra;
  const reportSafraLabel = reportSafra?.code ?? safraLabel;

  const totals = useMemo(() => {
    if (resumo) {
      return {
        area: resumo.totalArea ?? 0,
        tch: resumo.tchMedio ?? null,
        producao: resumo.totalProducao ?? 0,
      };
    }
    const area = rows.reduce((acc, row) => acc + (row.area ?? 0), 0);
    const producao = rows.reduce((acc, row) => acc + (row.producaoEstimada ?? 0), 0);
    return { area, producao, tch: area > 0 ? producao / area : null };
  }, [resumo, rows]);

  const loadOptions = useCallback(async () => {
    try {
      setLoadingOptions(true);
      const data = await api.colheitaLiberacaoOpcoes({ safraCode: safra?.code });
      setFilterOptions({
        codFazendas: data.codFazendas,
        fazendas: data.fazendas,
        talhoes: data.talhoes,
      });
    } catch {
      setFilterOptions({ codFazendas: [], fazendas: [], talhoes: [] });
    } finally {
      setLoadingOptions(false);
    }
  }, [safra?.code]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setErr(null);
      const data = await api.colheitaLiberacao({
        safraCode: safra?.code,
        codFazendas: selectedCodFazendas.length ? selectedCodFazendas : undefined,
        fazendas: selectedFazendas.length ? selectedFazendas : undefined,
        talhoes: selectedTalhoes.length ? selectedTalhoes : undefined,
      });
      setRows(data.dados);
      setResumo(data.resumo);
    } catch (e) {
      setRows([]);
      setResumo(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [safra?.code, selectedCodFazendas, selectedFazendas, selectedTalhoes]);

  useEffect(() => {
    setSelectedCodFazendas([]);
    setSelectedFazendas([]);
    setSelectedTalhoes([]);
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <p className="lead no-print">
        Liberações de colheita no Oracle, com área e estimativas do talhão, fazenda e fornecedor associado.
      </p>
      <section className="panel no-print">
        <h3>Relatório</h3>
        <div className="form-grid">
          <label>
            Safra exibida no relatório
            <select
              value={reportSafraId || ""}
              aria-label="Safra exibida no relatório"
              onChange={(e) => setReportSafraId(Number(e.target.value))}
            >
              {safras.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="lead" style={{ margin: "0 16px 16px" }}>
          A consulta usa a safra selecionada no topo da aplicação. A safra acima altera apenas o título do relatório impresso.
        </p>
      </section>
      <section className="panel no-print">
        <h3>Fazenda e talhão</h3>
        {loading || loadingOptions ? <p className="lead">Carregando…</p> : null}
        <SearchableReportFilter
          caption="Código da fazenda"
          options={filterOptions.codFazendas}
          selected={selectedCodFazendas}
          onChange={setSelectedCodFazendas}
          placeholder="Buscar código…"
          emptyLabel="Todos"
        />
        <SearchableReportFilter
          caption="Descrição da fazenda"
          options={filterOptions.fazendas}
          selected={selectedFazendas}
          onChange={setSelectedFazendas}
          placeholder="Buscar fazenda…"
          emptyLabel="Todas"
        />
        <SearchableReportFilter
          caption="Talhão"
          options={filterOptions.talhoes}
          selected={selectedTalhoes}
          onChange={setSelectedTalhoes}
          placeholder="Buscar talhão…"
          emptyLabel="Todos"
        />
      </section>
      <div className="no-print" style={{ marginBottom: 12 }}>
        <PrintButton />
      </div>
      {err ? (
        <p className="lead no-print" style={{ color: "var(--danger)" }}>
          {err}
        </p>
      ) : null}
      {resumo?.truncado ? (
        <p className="lead no-print" style={{ color: "var(--warn, #b8860b)" }}>
          Lista truncada em 2.000 registros.
        </p>
      ) : null}
      {rows.length ? (
        <section className="panel liberacao-colheita-report print-report-intro">
          <header className="liberacao-colheita-header">
            <img src="/elejota-agro-logo.png" alt="Elejota Agro" className="liberacao-colheita-logo" />
            <h2 className="liberacao-colheita-title">LIBERAÇÃO DE COLHEITA - {reportSafraLabel}</h2>
            <div className="liberacao-colheita-brand-right">GRUPO LUIZ JATOBÁ</div>
          </header>
          <div className="table-wrap">
            <table className="data liberacao-colheita-table">
              <thead>
                <tr>
                  <th>CÓD.</th>
                  <th>FAZENDA</th>
                  <th>TALHÃO</th>
                  <th className="num">ÁREA</th>
                  <th className="num">TCH ESTIMADO</th>
                  <th className="num">PRODUÇÃO ESTIMADA</th>
                  <th>FOLHA</th>
                  <th>TIPO DA COLHEITA</th>
                  <th>TIPO DA CANA</th>
                  <th>FORNECEDOR</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.numeroLiberacao ?? "n"}-${row.codFazenda}-${row.talhao}-${index}`}>
                    <td className="num">{row.codFazenda ?? "—"}</td>
                    <td>{row.fazenda ?? "—"}</td>
                    <td className="num">{row.talhao ?? "—"}</td>
                    <td className="num">{fmt2(row.area)}</td>
                    <td className="num">{fmt2(row.tchEstimado)}</td>
                    <td className="num">{fmt2(row.producaoEstimada)}</td>
                    <td>{row.folha ?? "—"}</td>
                    <td>{row.tipoColheita ?? "—"}</td>
                    <td>{row.tipoCana ?? "—"}</td>
                    <td>{row.fornecedor ?? "—"}</td>
                  </tr>
                ))}
                <tr className="liberacao-colheita-total">
                  <td colSpan={2}>
                    <strong>TOTAL</strong>
                  </td>
                  <td />
                  <td className="num">
                    <strong>{fmt2(totals.area)}</strong>
                  </td>
                  <td className="num">
                    <strong>{fmt2(totals.tch)}</strong>
                  </td>
                  <td className="num">
                    <strong>{fmt2(totals.producao)}</strong>
                  </td>
                  <td colSpan={4} />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="liberacao-colheita-foot no-print">
            {resumo?.totalLinhas ?? rows.length} liberação(ões)
          </p>
        </section>
      ) : !loading && !err && resumo ? (
        <p className="lead no-print">
          Nenhuma liberação encontrada para a safra {safraLabel}.
        </p>
      ) : null}
    </>
  );
}
