import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type DashboardData } from "../api";
import { formatBRL, formatNum, formatQty } from "../lib/format";
import {
  centerMatchesNegocios,
  filterCenterKeysByNegocio,
  negocioOptions,
} from "../lib/costCenterGroups";
import { PrintButton } from "./PrintButton";
import { FichaCustoEstagio } from "./custo/FichaCustoEstagio";
import { costPlanningSheet, useApp } from "../store";
import { ReportFilter } from "./SubprocessFilter";
import { VerifiedMark } from "./Sidebar";
import { useSafraLoaded } from "./SafraLoadProgress";

type CompareView = "costCenter" | "category";

function safraPeriodo(code: string | undefined) {
  const match = (code ?? "").match(/^(\d{2})\//);
  const yy = match ? Number(match[1]) : 25;
  const startYear = yy >= 70 ? 1900 + yy : 2000 + yy;
  return {
    inicio: String(startYear * 100 + 9),
    fim: String((startYear + 1) * 100 + 8),
  };
}

function pctDelta(current: number, previous: number) {
  if (!(previous > 0) && !(current > 0)) return null;
  if (!(previous > 0)) return null;
  return ((current - previous) / previous) * 100;
}

function valueForSafra(bySafra: Record<string, number> | undefined, safraId: number) {
  if (!bySafra) return 0;
  return bySafra[String(safraId)] ?? bySafra[safraId as unknown as string] ?? 0;
}

function PageShell({ embedded, children }: { embedded?: boolean; children: ReactNode }) {
  return embedded ? <>{children}</> : <div className="page">{children}</div>;
}

export function Dashboard({ embedded = false }: { embedded?: boolean } = {}) {
  const { go, safra, safraId, sheets } = useApp();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedCenters, setSelectedCenters] = useState<string[]>([]);
  const [selectedNegocios, setSelectedNegocios] = useState<string[]>([]);
  const [view, setView] = useState<CompareView>("costCenter");
  const [areasFicha, setAreasFicha] = useState({ plantio: 0, soca: 0, moagemLj: 0 });
  const periodoFicha = safraPeriodo(safra?.code);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setErr(null);
    setSelectedCenters([]);
    setSelectedNegocios([]);
    void api
      .dashboard()
      .then(setData)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [safraId]);

  useEffect(() => {
    let cancelled = false;
    setAreasFicha({ plantio: 0, soca: 0, moagemLj: 0 });
    api
      .parametrosTecnicos(safraId, periodoFicha.inicio, periodoFicha.fim)
      .then((row) => {
        if (cancelled || !row.armazenado) return;
        setAreasFicha({
          plantio: row.areaPlantio || 0,
          soca: row.areaSoca || 0,
          moagemLj: row.moagemLj || 0,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [safraId, periodoFicha.inicio, periodoFicha.fim]);

  useSafraLoaded(!loading);

  const budgetCompare = data?.budgetCompareBySafra;
  const compareSafras = budgetCompare?.safras ?? [];

  const centerOptions = useMemo(() => {
    const seen = new Map<string, { key: string; label: string; name?: string }>();
    for (const row of budgetCompare?.costCenter ?? []) {
      if (!seen.has(row.key)) seen.set(row.key, { key: row.key, label: row.label });
    }
    for (const row of data?.costCenters ?? []) {
      const key = `cc-${row.sheetId}`;
      const current = seen.get(key);
      if (current) {
        seen.set(key, { ...current, name: row.name, label: current.label || row.title });
      } else {
        seen.set(key, { key, label: row.title, name: row.name });
      }
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [budgetCompare, data?.costCenters]);

  const negocioFilterOptions = useMemo(() => negocioOptions(), []);

  const filterActive = selectedNegocios.length > 0 || selectedCenters.length > 0;

  const effectiveCenterKeys = useMemo(() => {
    if (selectedCenters.length) return selectedCenters;
    if (selectedNegocios.length) return filterCenterKeysByNegocio(centerOptions, selectedNegocios);
    return [];
  }, [selectedCenters, selectedNegocios, centerOptions]);

  const compareRows = useMemo(() => {
    const source = view === "category" ? budgetCompare?.category ?? [] : budgetCompare?.costCenter ?? [];
    if (view === "costCenter" && effectiveCenterKeys.length) {
      const wanted = new Set(effectiveCenterKeys);
      return source.filter((row) => wanted.has(row.key));
    }
    if (view === "category" && filterActive && effectiveCenterKeys.length) {
      // categoria não tem chave de centro; mantém todas as categorias do filtro via total do footer
      return source;
    }
    return source;
  }, [budgetCompare, view, effectiveCenterKeys, filterActive]);

  const volumeRows = useMemo(() => {
    if (!data) return [];
    const prevByKey = new Map(
      (data.kpis.previousSubprocesses ?? []).map((row) => [row.key, row] as const),
    );
    return (data.kpis.subprocesses ?? [])
      .filter((row) => row.kind !== "producao_propria")
      .map((row) => {
        const current = row.months.reduce((sum, value) => sum + (value || 0), 0) || row.qty?.value || 0;
        const previousMonths = prevByKey.get(row.key)?.months ?? [];
        const previous = previousMonths.reduce((sum, value) => sum + (value || 0), 0);
        return {
          key: row.key,
          name: row.name,
          suffix: row.suffix,
          current,
          previous,
          delta: current - previous,
          deltaPct: pctDelta(current, previous),
        };
      })
      .filter((row) => row.current > 0 || row.previous > 0);
  }, [data]);

  const visibleCostCenters = useMemo(() => {
    if (!data) return [];
    return data.costCenters.filter((c) => {
      if (selectedCenters.length) {
        return selectedCenters.includes(`cc-${c.sheetId}`);
      }
      return centerMatchesNegocios(c.title, selectedNegocios, c.name);
    });
  }, [data, selectedCenters, selectedNegocios]);

  const filteredOrcamentoAtual = useMemo(() => {
    if (!filterActive) return data?.resumo.total ?? 0;
    return visibleCostCenters.reduce((sum, row) => sum + (row.total || 0), 0);
  }, [filterActive, visibleCostCenters, data?.resumo.total]);

  const footerTotals = useMemo(() => {
    return compareSafras.map((safraRow) => {
      if (filterActive && effectiveCenterKeys.length) {
        const source = budgetCompare?.costCenter ?? [];
        const wanted = new Set(effectiveCenterKeys);
        return source
          .filter((row) => wanted.has(row.key))
          .reduce((sum, row) => sum + valueForSafra(row.bySafra, safraRow.safraId), 0);
      }
      return safraRow.orcamentoTotal;
    });
  }, [compareSafras, filterActive, effectiveCenterKeys, budgetCompare]);

  const costPerTonRows = useMemo(() => {
    const rows = data?.costPerTonBySafra ?? [];
    if (!filterActive || !effectiveCenterKeys.length) return rows;
    return rows.map((row, index) => {
      const orcamentoTotal = footerTotals[index] ?? 0;
      const costPerTon = row.moagem > 0 && orcamentoTotal > 0 ? orcamentoTotal / row.moagem : null;
      return { ...row, orcamentoTotal, costPerTon };
    });
  }, [data?.costPerTonBySafra, filterActive, effectiveCenterKeys, footerTotals]);

  if (err) return <PageShell embedded={embedded}><p>{err}</p></PageShell>;
  if (!data) return <PageShell embedded={embedded}><p>Carregando visão geral…</p></PageShell>;

  const { kpis } = data;
  const moagemMecanizada = kpis.subprocesses?.find((row) => row.key === "tons")?.qty?.value ?? kpis.moagem;
  const moagemManual = kpis.subprocesses?.find((row) => row.key === "tonsManual")?.qty?.value ?? kpis.moagemManual;
  const moagem = moagemMecanizada + moagemManual;
  const custoPorTonelada = moagem > 0 ? filteredOrcamentoAtual / moagem : 0;
  const prevLabel = kpis.previousSafra?.label ?? "Safra anterior";
  const currentLabel = safra?.label ?? "Safra atual";
  const panelTotal =
    filterActive && effectiveCenterKeys.length
      ? (footerTotals[compareSafras.findIndex((row) => row.current)] ??
          footerTotals[footerTotals.length - 1] ??
          filteredOrcamentoAtual)
      : data.resumo.total;

  return (
    <PageShell embedded={embedded}>
      <FichaCustoEstagio
        areaPlantio={areasFicha.plantio}
        areaSoca={areasFicha.soca}
        moagemLj={areasFicha.moagemLj}
        subtitulo={[safra?.label, `${periodoFicha.inicio} a ${periodoFicha.fim}`].filter(Boolean).join(" · ")}
      />
      <div className="kpis">
        <div className="kpi"><span>Moagem</span><strong>{formatQty(moagem)} t</strong></div>
        <div className="kpi"><span>TCH</span><strong>{formatQty(kpis.tch)}</strong></div>
        <div className="kpi"><span>Plantio</span><strong>{formatQty(kpis.areaVerao + kpis.areaInverno)} ha</strong></div>
        <div className="kpi">
          <span>Orçamento{filterActive ? " (filtro)" : ""}</span>
          <strong>{formatBRL(filteredOrcamentoAtual)}</strong>
        </div>
        <div className="kpi">
          <span>R$ / tonelada{filterActive ? " (filtro)" : ""}</span>
          <strong>{moagem > 0 ? formatBRL(custoPorTonelada) : "—"}</strong>
        </div>
      </div>
      <ReportFilter
        caption="Negócio"
        options={negocioFilterOptions}
        selected={selectedNegocios}
        onChange={(keys) => {
          setSelectedNegocios(keys);
          setSelectedCenters([]);
        }}
      />
      <div className="cards">
        {visibleCostCenters.map((c) => {
          const sheet = sheets.find((s) => s.id === c.sheetId);
          return (
            <button className="card" key={c.sheetId} onClick={() => go(costPlanningSheet(c.sheetId))}>
              <b>
                {sheet?.verified ? <VerifiedMark /> : null}
                {c.title}
              </b>
              <em>{formatBRL(c.total)}</em>
            </button>
          );
        })}
      </div>

      <section className="panel">
        <h3>
          R$ / tonelada por safra
          <span className="panel-h3-actions">
            <small>{currentLabel}</small>
            <PrintButton />
          </span>
        </h3>
        <p className="print-only-meta">
          Visão geral — R$ / tonelada por safra — {currentLabel}
        </p>
        <div className="table-wrap">
          <table className="data resumo">
            <thead>
              <tr>
                <th className="left"></th>
                {costPerTonRows.map((row) => (
                  <th key={row.safraId}>
                    {row.label}
                    {row.current ? " (atual)" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!costPerTonRows.length ? (
                <tr>
                  <td className="left" colSpan={1}>
                    Ainda não há moagem ou orçamento para comparar.
                  </td>
                </tr>
              ) : (
                <>
                  <tr>
                    <td className="left">Moagem (t)</td>
                    {costPerTonRows.map((row) => (
                      <td key={row.safraId}>{row.moagem > 0 ? formatQty(row.moagem) : "—"}</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="left">Orçamento</td>
                    {costPerTonRows.map((row) => (
                      <td key={row.safraId}>
                        {row.orcamentoTotal > 0 ? formatBRL(row.orcamentoTotal) : "—"}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="left">R$ / t</td>
                    {costPerTonRows.map((row) => (
                      <td key={row.safraId}>
                        {row.costPerTon != null ? formatBRL(row.costPerTon) : "—"}
                      </td>
                    ))}
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h3>
          Comparativo de safra por subprocesso
          <small>
            {currentLabel}
            {kpis.previousSafra ? ` × ${prevLabel}` : null}
          </small>
        </h3>
        <div className="table-wrap">
          <table className="data resumo">
            <thead>
              <tr>
                <th className="left">Subprocesso</th>
                <th>{currentLabel}</th>
                <th>{prevLabel}</th>
                <th>Variação</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {volumeRows.map((row) => (
                <tr key={row.key}>
                  <td className="left">{row.name}</td>
                  <td>
                    {formatQty(row.current)} {row.suffix}
                  </td>
                  <td>
                    {kpis.previousSafra ? `${formatQty(row.previous)} ${row.suffix}` : "—"}
                  </td>
                  <td>
                    {kpis.previousSafra
                      ? `${row.delta >= 0 ? "+" : ""}${formatQty(row.delta)} ${row.suffix}`
                      : "—"}
                  </td>
                  <td>
                    {row.deltaPct == null
                      ? "—"
                      : `${row.deltaPct >= 0 ? "+" : ""}${formatNum(row.deltaPct)}%`}
                  </td>
                </tr>
              ))}
              {!volumeRows.length ? (
                <tr>
                  <td className="left" colSpan={5}>
                    Nenhum subprocesso com volume nesta safra.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h3>
          Orçamento por centro de custo
          <span className="panel-h3-actions">
            <small>{formatBRL(panelTotal)}</small>
          </span>
        </h3>
        <p className="lead" style={{ margin: "0 16px 8px" }}>
          Comparativo do orçamento entre safras. Abra a visão geral em cada safra para gravar o
          consolidado (centro de custo e categoria) e poder comparar.
        </p>
        <ReportFilter
          caption="Negócio"
          options={negocioFilterOptions}
          selected={selectedNegocios}
          onChange={(keys) => {
            setSelectedNegocios(keys);
            setSelectedCenters([]);
          }}
        />
        <ReportFilter
          caption="Centro de custo"
          options={
            selectedNegocios.length
              ? centerOptions.filter((row) => centerMatchesNegocios(row.label, selectedNegocios, row.name))
              : centerOptions
          }
          selected={selectedCenters}
          onChange={setSelectedCenters}
        />
        <div className="kind-toggle">
          <span className="toggle-caption">Visão</span>
          <button
            type="button"
            className={`btn ${view === "costCenter" ? "primary" : ""}`}
            onClick={() => setView("costCenter")}
          >
            Centro de custo
          </button>
          <button
            type="button"
            className={`btn ${view === "category" ? "primary" : ""}`}
            onClick={() => setView("category")}
          >
            Categoria
          </button>
        </div>
        <div className="table-wrap">
          <table className="data resumo">
            <thead>
              <tr>
                <th className="left">{view === "category" ? "Categoria" : "Centro de custo"}</th>
                {compareSafras.map((row) => (
                  <th key={row.safraId}>
                    {row.label}
                    {row.current ? " *" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compareRows.map((row) => (
                <tr key={row.key}>
                  <td className="left">{row.label}</td>
                  {compareSafras.map((safraRow) => {
                    const value = valueForSafra(row.bySafra, safraRow.safraId);
                    return <td key={safraRow.safraId}>{value > 0 ? formatBRL(value) : "—"}</td>;
                  })}
                </tr>
              ))}
              {!compareRows.length ? (
                <tr>
                  <td className="left" colSpan={Math.max(1, compareSafras.length) + 1}>
                    {compareSafras.length <= 1
                      ? "Abra a visão geral nas outras safras para gravar o orçamento e comparar."
                      : "Nenhum valor neste agrupamento."}
                  </td>
                </tr>
              ) : null}
              <tr className="total-geral">
                <td>Total geral</td>
                {compareSafras.map((safraRow, index) => (
                  <td key={safraRow.safraId}>
                    {(footerTotals[index] ?? 0) > 0 ? formatBRL(footerTotals[index] ?? 0) : "—"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </PageShell>
  );
}
