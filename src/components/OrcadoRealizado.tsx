import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConsultaProgressBar } from "./ConsultaProgressBar";
import { api, type CompareRow, type DashboardData, type OrcadoRealizadoData } from "../api";
import { formatBRL, formatNum, formatQty } from "../lib/format";
import {
  aggregateCompare,
  buildCompareActivityByCategory,
  hasCompareAmount,
  usedAssociatedActivities,
  usedCostCenters,
} from "../lib/reportAggregate";
import { centerMatchesNegocios, negocioOptions } from "../lib/costCenterGroups";
import { costPlanningTab, useApp } from "../store";
import { ReportFilter } from "./SubprocessFilter";
import { CustoDashboard } from "./CustoDashboard";
import { ConsultaRateio } from "./custo/ConsultaRateio";
import { CustoColheitaPanel } from "./custo/CustoColheitaPanel";
import { EstagioProducaoPanel } from "./custo/EstagioProducaoPanel";
import { PrintButton } from "./PrintButton";

type MainTab = "comparativo" | "custo" | "estagio" | "colheita" | "consultaRateio";

type View = "costCenter" | "category" | "activity" | "costObject" | "safra";
type Metric = "comparativo" | "orcado" | "realizado" | "variacao" | "resumo";

const VIEWS: { id: View; label: string }[] = [
  { id: "costCenter", label: "Centro de custo" },
  { id: "category", label: "Categoria" },
  { id: "activity", label: "Atividade" },
  { id: "costObject", label: "Objeto de custo" },
  { id: "safra", label: "Safra" },
];

const METRICS: { id: Metric; label: string }[] = [
  { id: "comparativo", label: "Comparativo" },
  { id: "orcado", label: "Orçado" },
  { id: "realizado", label: "Realizado" },
  { id: "variacao", label: "Variação" },
  { id: "resumo", label: "Resumo" },
];

const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: "comparativo", label: "Comparativo orçado x realizado" },
  { id: "custo", label: "Rateio de custo" },
  { id: "estagio", label: "Estágio de produção" },
  { id: "colheita", label: "Custo colheita" },
  { id: "consultaRateio", label: "Consulta rateio" },
];

function safraAnomesRange(code: string, label: string) {
  const match = code.match(/^(\d{2})\//);
  const yy = match ? Number(match[1]) : 25;
  const startYear = yy >= 70 ? 1900 + yy : 2000 + yy;
  return {
    from: startYear * 100 + 9,
    to: (startYear + 1) * 100 + 8,
    label,
  };
}

const varClass = (n: number) => (n > 0 ? "var-over" : n < 0 ? "var-under" : "");

function VarIcon({ delta }: { delta: number }) {
  if (delta > 0) {
    return (
      <span className="var-icon var-over" title="Acima do orçado" aria-label="Acima do orçado">
        ▲
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span className="var-icon var-under" title="Abaixo do orçado" aria-label="Abaixo do orçado">
        ▼
      </span>
    );
  }
  return null;
}

function CmpAmount({ delta, children }: { delta: number; children: ReactNode }) {
  return (
    <span className="var-value">
      <VarIcon delta={delta} />
      {children}
    </span>
  );
}

const formatPct = (orcado: number, realizado: number) => {
  if (!orcado) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(
    ((realizado - orcado) / Math.abs(orcado)) * 100,
  ) + "%";
};

const formatRate = (amount: number, qty: number) => {
  if (!(qty > 0) || !amount) return "—";
  return formatBRL(amount / qty);
};

const formatNonZeroNum = (n: number) => (Math.abs(n) > 0.004 ? formatNum(n) : "—");
const formatNonZeroBRL = (n: number) => (Math.abs(n) > 0.004 ? formatBRL(n) : "—");

function toggleKey(list: string[], key: string) {
  return list.includes(key) ? list.filter((item) => item !== key) : [...list, key];
}

function cellValue(row: CompareRow, index: number, metric: Metric) {
  if (metric === "orcado") return row.orcado[index] ?? 0;
  if (metric === "realizado") return row.realizado[index] ?? 0;
  return row.variacao[index] ?? 0;
}

function isAnnualOrcado(row: Pick<CompareRow, "orcadoAnnualOnly">) {
  return Boolean(row.orcadoAnnualOnly);
}

function totalsFromRows(rows: CompareRow[], months: string[]) {
  const orcado = months.map((_, i) => rows.reduce((sum, row) => sum + (row.orcado[i] ?? 0), 0));
  const realizado = months.map((_, i) => rows.reduce((sum, row) => sum + (row.realizado[i] ?? 0), 0));
  const variacao = orcado.map((value, i) => (realizado[i] ?? 0) - value);
  const totalOrcado = rows.reduce((sum, row) => sum + row.orcadoTotal, 0);
  const totalRealizado = rows.reduce((sum, row) => sum + row.realizadoTotal, 0);
  return {
    totals: { orcado, realizado, variacao },
    totalOrcado,
    totalRealizado,
    totalVariacao: totalRealizado - totalOrcado,
  };
}

function hasVisibleCompareValue(row: CompareRow) {
  const visible = (value: number | null | undefined) => Number.isFinite(value) && Math.abs(Number(value)) >= 0.5;
  return (
    visible(row.orcadoTotal) ||
    visible(row.realizadoTotal) ||
    (row.orcado ?? []).some(visible) ||
    (row.realizado ?? []).some(visible)
  );
}

function searchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function SummaryCells({
  row,
  unitsOrcado,
  unitsRealizado,
  tons,
}: {
  row: Pick<CompareRow, "orcadoTotal" | "realizadoTotal" | "origin" | "tons">;
  unitsOrcado: number;
  unitsRealizado: number;
  tons: number;
}) {
  const rowTons = row.tons != null ? row.tons : tons;
  if (row.origin) {
    return (
      <>
        <td>—</td>
        <td>{formatBRL(row.realizadoTotal)}</td>
        <td>—</td>
        <td>{formatRate(row.realizadoTotal, unitsRealizado)}</td>
        <td>—</td>
        <td>{formatRate(row.realizadoTotal, rowTons)}</td>
      </>
    );
  }
  return (
    <>
      <td className="num orcado-col">{formatBRL(row.orcadoTotal)}</td>
      <td>
        <CmpAmount delta={row.realizadoTotal - row.orcadoTotal}>{formatBRL(row.realizadoTotal)}</CmpAmount>
      </td>
      <td className="num orcado-col">{formatRate(row.orcadoTotal, unitsOrcado)}</td>
      <td>{formatRate(row.realizadoTotal, unitsRealizado)}</td>
      <td className="num orcado-col">{formatRate(row.orcadoTotal, rowTons)}</td>
      <td>{formatRate(row.realizadoTotal, rowTons)}</td>
    </>
  );
}

function CompareCells({
  row,
  months,
  metric,
}: {
  row: CompareRow;
  months: string[];
  metric: Metric;
}) {
  const origin = Boolean(row.origin);
  const annualOnly = isAnnualOrcado(row);
  const hideMonthlyOrcado = origin || annualOnly;
  if (metric === "comparativo") {
    return (
      <>
        {months.map((_, i) => (
          <Fragment key={i}>
            <td className="num orcado-col">{hideMonthlyOrcado ? "—" : formatNum(row.orcado[i] ?? 0)}</td>
            <td className="num realizado-col">
              {origin || annualOnly ? (
                formatNum(row.realizado[i] ?? 0)
              ) : (
                <CmpAmount delta={(row.realizado[i] ?? 0) - (row.orcado[i] ?? 0)}>
                  {formatNum(row.realizado[i] ?? 0)}
                </CmpAmount>
              )}
            </td>
          </Fragment>
        ))}
        <td className="num orcado-col">{origin ? "—" : formatBRL(row.orcadoTotal)}</td>
        <td className="num realizado-col">
          {origin ? formatBRL(row.realizadoTotal) : (
            <CmpAmount delta={row.variacaoTotal}>{formatBRL(row.realizadoTotal)}</CmpAmount>
          )}
        </td>
        <td className={`num ${origin ? "" : varClass(row.variacaoTotal)}`}>
          {origin ? "—" : <CmpAmount delta={row.variacaoTotal}>{formatBRL(row.variacaoTotal)}</CmpAmount>}
        </td>
        <td className={`num ${origin ? "" : varClass(row.variacaoTotal)}`}>
          {origin ? "—" : (
            <CmpAmount delta={row.variacaoTotal}>{formatPct(row.orcadoTotal, row.realizadoTotal)}</CmpAmount>
          )}
        </td>
      </>
    );
  }

  return (
    <>
      {months.map((_, i) => (
        <td
          key={i}
          className={[
            metric === "orcado" ? "num orcado-col" : "",
            !origin && !annualOnly && metric === "variacao" ? varClass(row.variacao[i] ?? 0) : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {(origin && metric !== "realizado") || (annualOnly && metric !== "realizado")
            ? "—"
            : metric === "variacao"
              ? (
                <CmpAmount delta={row.variacao[i] ?? 0}>{formatNum(cellValue(row, i, metric))}</CmpAmount>
              )
              : metric === "realizado"
                ? origin || annualOnly
                  ? formatNum(cellValue(row, i, metric))
                  : (
                    <CmpAmount delta={(row.realizado[i] ?? 0) - (row.orcado[i] ?? 0)}>
                      {formatNum(cellValue(row, i, metric))}
                    </CmpAmount>
                  )
                : formatNum(cellValue(row, i, metric))}
        </td>
      ))}
      <td
        className={[
          metric === "orcado" ? "num orcado-col" : "",
          !origin && metric === "variacao" ? varClass(row.variacaoTotal) : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {origin && metric !== "realizado"
          ? "—"
          : metric === "orcado"
            ? formatBRL(row.orcadoTotal)
            : metric === "realizado"
              ? origin
                ? formatBRL(row.realizadoTotal)
                : <CmpAmount delta={row.variacaoTotal}>{formatBRL(row.realizadoTotal)}</CmpAmount>
              : <CmpAmount delta={row.variacaoTotal}>{formatBRL(row.variacaoTotal)}</CmpAmount>}
      </td>
    </>
  );
}

function CompareTotalsCells({
  totals,
  totalOrcado,
  totalRealizado,
  totalVariacao,
  months,
  metric,
  hideMonthlyOrcado = false,
}: {
  totals: { orcado: number[]; realizado: number[]; variacao: number[] };
  totalOrcado: number;
  totalRealizado: number;
  totalVariacao: number;
  months: string[];
  metric: Metric;
  hideMonthlyOrcado?: boolean;
}) {
  if (metric === "comparativo") {
    return (
      <>
        {months.map((_, i) => (
          <Fragment key={i}>
            <td className="num orcado-col">
              {hideMonthlyOrcado ? "—" : formatNonZeroNum(totals.orcado[i] ?? 0)}
            </td>
            <td className="num realizado-col">
              {hideMonthlyOrcado ? (
                formatNonZeroNum(totals.realizado[i] ?? 0)
              ) : (
                <CmpAmount delta={(totals.realizado[i] ?? 0) - (totals.orcado[i] ?? 0)}>
                  {formatNonZeroNum(totals.realizado[i] ?? 0)}
                </CmpAmount>
              )}
            </td>
          </Fragment>
        ))}
        <td className="num orcado-col">{formatNonZeroBRL(totalOrcado)}</td>
        <td className="num realizado-col">
          <CmpAmount delta={totalVariacao}>{formatNonZeroBRL(totalRealizado)}</CmpAmount>
        </td>
        <td className={`num ${varClass(totalVariacao)}`}>
          <CmpAmount delta={totalVariacao}>{formatBRL(totalVariacao)}</CmpAmount>
        </td>
        <td className={`num ${varClass(totalVariacao)}`}>
          <CmpAmount delta={totalVariacao}>{formatPct(totalOrcado, totalRealizado)}</CmpAmount>
        </td>
      </>
    );
  }

  return (
    <>
      {months.map((_, i) => (
        <td
          key={i}
          className={[
            metric === "orcado" ? "num orcado-col" : "",
            metric === "variacao" && !hideMonthlyOrcado ? varClass(totals.variacao[i] ?? 0) : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {hideMonthlyOrcado && metric !== "realizado" ? (
            "—"
          ) : metric === "variacao" ? (
            <CmpAmount delta={totals.variacao[i] ?? 0}>{formatNum(totals.variacao[i] ?? 0)}</CmpAmount>
          ) : metric === "realizado" ? (
            hideMonthlyOrcado ? (
              formatNonZeroNum(totals.realizado[i] ?? 0)
            ) : (
              <CmpAmount delta={(totals.realizado[i] ?? 0) - (totals.orcado[i] ?? 0)}>
                {formatNonZeroNum(totals.realizado[i] ?? 0)}
              </CmpAmount>
            )
          ) : (
            formatNonZeroNum(totals.orcado[i] ?? 0)
          )}
        </td>
      ))}
      <td
        className={[
          metric === "orcado" ? "num orcado-col" : "",
          metric === "variacao" ? varClass(totalVariacao) : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {metric === "orcado" ? (
          formatNonZeroBRL(totalOrcado)
        ) : metric === "realizado" ? (
          <CmpAmount delta={totalVariacao}>{formatNonZeroBRL(totalRealizado)}</CmpAmount>
        ) : (
          <CmpAmount delta={totalVariacao}>{formatBRL(totalVariacao)}</CmpAmount>
        )}
      </td>
    </>
  );
}

function moagemFromKpis(kpis: DashboardData["kpis"] | null) {
  if (!kpis) return 0;
  const mecanizada = kpis.subprocesses?.find((row) => row.key === "tons")?.qty?.value ?? kpis.moagem;
  const manual = kpis.subprocesses?.find((row) => row.key === "tonsManual")?.qty?.value ?? kpis.moagemManual;
  return (mecanizada || 0) + (manual || 0);
}

function unitsFromKpis(kpis: DashboardData["kpis"] | null) {
  if (!kpis) return 0;
  return (kpis.areaVerao || 0) + (kpis.areaInverno || 0);
}

function PageShell({ embedded, children }: { embedded?: boolean; children: ReactNode }) {
  return embedded ? <>{children}</> : <div className="page">{children}</div>;
}

function fmtDashAmount(n: number) {
  return Math.round(n || 0).toLocaleString("pt-BR");
}

function recalcCompareRow(row: CompareRow, months: string[], sources?: CompareRow[]): CompareRow {
  const baseRows = sources ?? row.sources ?? [];
  const orcado = months.map((_, index) => baseRows.reduce((sum, child) => sum + (child.orcado[index] ?? 0), 0));
  const realizado = months.map((_, index) => baseRows.reduce((sum, child) => sum + (child.realizado[index] ?? 0), 0));
  const orcadoTotal = moneySum(orcado);
  const realizadoTotal = moneySum(realizado);
  return {
    ...row,
    sources: baseRows,
    orcado,
    realizado,
    variacao: realizado.map((value, index) => value - (orcado[index] ?? 0)),
    orcadoTotal,
    realizadoTotal,
    variacaoTotal: realizadoTotal - orcadoTotal,
  };
}

function moneySum(values: number[]) {
  return values.reduce((sum, value) => sum + (value || 0), 0);
}

function OrcadoRealizadoDashboard({
  report,
  rows,
  selectedMonth,
  onSelectedMonth,
  safraLabel,
  selectedNegocio,
  onSelectedNegocio,
  negocioOptions,
}: {
  report: OrcadoRealizadoData;
  rows: CompareRow[];
  selectedMonth: number | null;
  onSelectedMonth: (index: number | null) => void;
  safraLabel: string;
  selectedNegocio: string;
  onSelectedNegocio: (key: string) => void;
  negocioOptions: { key: string; label: string }[];
}) {
  const [selectedGrupo, setSelectedGrupo] = useState("");
  const [selectedEmpenho, setSelectedEmpenho] = useState("");
  const [selectedSubprocesso, setSelectedSubprocesso] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [openGrupos, setOpenGrupos] = useState<string[]>([]);
  const [openEmpenhos, setOpenEmpenhos] = useState<string[]>([]);
  const [loadedEmpenhoDetails, setLoadedEmpenhoDetails] = useState<Record<string, CompareRow[]>>({});
  const [loadingEmpenhoDetails, setLoadingEmpenhoDetails] = useState<Record<string, boolean>>({});
  const sourceRows =
    selectedNegocio === "agricola" ? (report.grupoGastoAgricola ?? rows) : rows;
  const normalizedFilterSearch = searchText(filterSearch.trim());
  const optionMatchesSearch = (label: string) =>
    !normalizedFilterSearch || searchText(label).includes(normalizedFilterSearch);
  const empenhoOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of sourceRows) {
      for (const child of row.sources ?? []) {
        if (hasCompareAmount(child) && !seen.has(child.key)) seen.set(child.key, child.label);
      }
    }
    return [...seen.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [sourceRows]);
  const visibleEmpenhoOptions = empenhoOptions.filter((item) => optionMatchesSearch(item.label));
  const visibleNegocioOptions = negocioOptions.filter((item) => optionMatchesSearch(item.label));
  const subprocessoOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of sourceRows) {
      for (const empenho of row.sources ?? []) {
        for (const detail of empenho.sources ?? []) {
          if (detail.subprocessoKey && hasCompareAmount(detail) && !seen.has(detail.subprocessoKey)) {
            seen.set(detail.subprocessoKey, detail.subprocessoLabel || detail.subprocessoKey);
          }
        }
      }
    }
    return [...seen.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { numeric: true }));
  }, [sourceRows]);
  const visibleSubprocessoOptions = subprocessoOptions.filter((item) => optionMatchesSearch(item.label));
  const filteredSourceRows = useMemo(() => {
    if (!selectedEmpenho && !selectedSubprocesso) return sourceRows;
    return sourceRows
      .map((row) => {
        const sources = (row.sources ?? [])
          .filter((child) => !selectedEmpenho || child.key === selectedEmpenho)
          .map((child) => {
            if (!selectedSubprocesso) return child;
            const details = (child.sources ?? []).filter(
              (detail) => detail.subprocessoKey === selectedSubprocesso && hasCompareAmount(detail),
            );
            if (!details.length) return null;
            return recalcCompareRow(child, report.months, details);
          })
          .filter((child): child is CompareRow => child != null && hasCompareAmount(child));
        if (!sources.length) return null;
        return recalcCompareRow(row, report.months, sources.map((source) => ({ ...source, sources: source.sources ?? [] })));
      })
      .filter((row): row is CompareRow => row != null);
  }, [sourceRows, selectedEmpenho, selectedSubprocesso, report.months]);
  const dashRows = filteredSourceRows
    .filter(hasCompareAmount)
    .filter((row) => !selectedGrupo || row.key === selectedGrupo);
  const visibleGrupoOptions = filteredSourceRows
    .filter(hasCompareAmount)
    .filter((row) => optionMatchesSearch(row.label));
  const getOrcado = (row: CompareRow) => (selectedMonth == null ? row.orcadoTotal : row.orcado[selectedMonth] ?? 0);
  const getRealizado = (row: CompareRow) =>
    selectedMonth == null ? row.realizadoTotal : row.realizado[selectedMonth] ?? 0;
  const totalOrcado = dashRows.reduce((sum, row) => sum + getOrcado(row), 0);
  const totalRealizado = dashRows.reduce((sum, row) => sum + getRealizado(row), 0);
  const sobra = totalOrcado - totalRealizado;

  function toggleGrupo(row: CompareRow) {
    setOpenGrupos((current) => toggleKey(current, row.key));
  }

  async function toggleEmpenhoDetalhe(group: CompareRow, child: CompareRow, childOpen: boolean) {
    setOpenEmpenhos((current) => toggleKey(current, child.key));
    if (childOpen || loadedEmpenhoDetails[child.key] || loadingEmpenhoDetails[child.key]) return;
    const grupoKey = group.key.replace(/^grupo-/, "");
    const empenhoKey = child.key.replace(new RegExp(`^empenho-${grupoKey}-`), "");
    setLoadingEmpenhoDetails((current) => ({ ...current, [child.key]: true }));
    try {
      const result = await api.orcadoRealizadoGrupoGastoDetalhes({
        safraId: report.safraId,
        grupoKey,
        empenhoKey,
        agricola: selectedNegocio === "agricola",
      });
      setLoadedEmpenhoDetails((current) => ({ ...current, [child.key]: result.rows }));
    } finally {
      setLoadingEmpenhoDetails((current) => ({ ...current, [child.key]: false }));
    }
  }

  return (
    <section className="orc-dashboard">
      <aside className="orc-dashboard-filters">
        <div className="orc-dashboard-filter-title">FILTROS</div>
        <label className="orc-dashboard-filter-search">
          <span>PESQUISAR FILTROS</span>
          <input
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="Digite para procurar..."
          />
        </label>
        <label>
          <span>UNIDADE</span>
          <select value="" onChange={() => undefined}>
            <option value="">Todos</option>
          </select>
        </label>
        <label>
          <span>PLANEJAMENTO</span>
          <select value={safraLabel} onChange={() => undefined}>
            <option value={safraLabel}>{safraLabel}</option>
          </select>
        </label>
        <label>
          <span>SUBPROCESSO</span>
          <select value={selectedSubprocesso} onChange={(e) => setSelectedSubprocesso(e.target.value)}>
            <option value="">Todos</option>
            {visibleSubprocessoOptions.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>EMPENHO</span>
          <select value={selectedEmpenho} onChange={(e) => setSelectedEmpenho(e.target.value)}>
            <option value="">Todos</option>
            {visibleEmpenhoOptions.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>NEG/PROC/SUB-PROC/ATIVIDADE</span>
          <select
            value={selectedNegocio}
            onChange={(e) => {
              setSelectedGrupo("");
              setSelectedEmpenho("");
              setSelectedSubprocesso("");
              onSelectedNegocio(e.target.value);
            }}
          >
            <option value="">Todos</option>
            {visibleNegocioOptions.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>OBJETO DE CUSTO</span>
          <select value="" onChange={() => undefined}>
            <option value="">Todos</option>
          </select>
        </label>
        <label>
          <span>EMPENHO/GRUPO GASTO</span>
          <select value={selectedGrupo} onChange={(e) => setSelectedGrupo(e.target.value)}>
            <option value="">Todos</option>
            {visibleGrupoOptions.map((row) => (
              <option key={row.key} value={row.key}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>CONTA CONTÁBIL</span>
          <select value="" onChange={() => undefined}>
            <option value="">Todos</option>
          </select>
        </label>
      </aside>
      <div className="orc-dashboard-main">
        <header className="orc-dashboard-title">
          <strong>PLANEJAMENTO E CUSTO</strong>
          <small>Orçado Oracle (tipo O) e realizado (tipo R) por grupo de gasto</small>
        </header>
        <div className="orc-dashboard-months no-print">
          <button
            type="button"
            className={selectedMonth == null ? "is-active" : ""}
            onClick={() => onSelectedMonth(null)}
          >
            Total
          </button>
          {report.months.map((month, index) => (
            <button
              key={month}
              type="button"
              className={selectedMonth === index ? "is-active" : ""}
              onClick={() => onSelectedMonth(index)}
            >
              {month}
            </button>
          ))}
        </div>
        <div className="orc-dashboard-content">
          <div className="orc-dashboard-table-card">
            <h3>Análise Orçado x Realizado por Grupo de Gasto</h3>
            <div className="orc-dashboard-table-wrap">
              <table className="orc-dashboard-table">
                <thead>
                  <tr>
                    <th>Grupo de Gasto</th>
                    <th className="orc-col-orcado">ORÇADO</th>
                    <th className="orc-col-realizado">REALIZADO</th>
                    <th>VARIAÇÃO %</th>
                    <th>VARIAÇÃO R</th>
                  </tr>
                </thead>
                <tbody>
                  {dashRows.map((row) => {
                    const orcado = getOrcado(row);
                    const realizado = getRealizado(row);
                    const variacao = realizado - orcado;
                    const pct = orcado ? (variacao / Math.abs(orcado)) * 100 : 0;
                    const children = (row.sources ?? []).filter(hasCompareAmount);
                    const isOpen = openGrupos.includes(row.key);
                    return (
                      <Fragment key={row.key}>
                        <tr>
                          <td>
                            <span className="orc-dashboard-tree-label">
                              {children.length ? (
                                <button
                                  type="button"
                                  className="icon-btn fold-btn"
                                  title={isOpen ? "Ocultar empenhos" : "Ver empenhos"}
                                  onClick={() => toggleGrupo(row)}
                                >
                                  {isOpen ? "▾" : "▸"}
                                </button>
                              ) : (
                                <span className="tree-spacer" />
                              )}
                              {row.label}
                            </span>
                          </td>
                          <td className="orc-col-orcado">{fmtDashAmount(orcado)}</td>
                          <td className="orc-col-realizado">{fmtDashAmount(realizado)}</td>
                          <td className={varClass(variacao)}>
                            {orcado ? `${pct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—"}
                          </td>
                          <td className={varClass(variacao)}>
                            <CmpAmount delta={variacao}>{formatBRL(variacao)}</CmpAmount>
                          </td>
                        </tr>
                        {isOpen
                          ? children.map((child) => {
                              const childOrcado = getOrcado(child);
                              const childRealizado = getRealizado(child);
                              const childVariacao = childRealizado - childOrcado;
                              const childPct = childOrcado ? (childVariacao / Math.abs(childOrcado)) * 100 : 0;
                              const detalhes = (loadedEmpenhoDetails[child.key] ?? child.sources ?? []).filter(hasCompareAmount);
                              const loadingDetalhes = Boolean(loadingEmpenhoDetails[child.key]);
                              const childOpen = openEmpenhos.includes(child.key);
                              return (
                                <Fragment key={child.key}>
                                  <tr className="orc-dashboard-empenho-row">
                                    <td>
                                      <span className="orc-dashboard-tree-label">
                                        {hasCompareAmount(child) ? (
                                          <button
                                            type="button"
                                            className="icon-btn fold-btn"
                                            title={childOpen ? "Ocultar detalhes" : "Ver detalhes do empenho"}
                                            onClick={() => void toggleEmpenhoDetalhe(row, child, childOpen)}
                                          >
                                            {loadingDetalhes ? "…" : childOpen ? "▾" : "▸"}
                                          </button>
                                        ) : (
                                          <span className="tree-spacer" />
                                        )}
                                        {child.label}
                                      </span>
                                    </td>
                                    <td className="orc-col-orcado">{fmtDashAmount(childOrcado)}</td>
                                    <td className="orc-col-realizado">{fmtDashAmount(childRealizado)}</td>
                                    <td className={varClass(childVariacao)}>
                                      {childOrcado
                                        ? `${childPct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
                                        : "—"}
                                    </td>
                                    <td className={varClass(childVariacao)}>
                                      <CmpAmount delta={childVariacao}>{formatBRL(childVariacao)}</CmpAmount>
                                    </td>
                                  </tr>
                                  {childOpen && loadingDetalhes ? (
                                    <tr className="orc-dashboard-detalhe-row">
                                      <td colSpan={5}>Carregando detalhes...</td>
                                    </tr>
                                  ) : childOpen
                                    ? detalhes.map((detalhe) => {
                                        const detalheOrcado = getOrcado(detalhe);
                                        const detalheRealizado = getRealizado(detalhe);
                                        const detalheVariacao = detalheRealizado - detalheOrcado;
                                        const detalhePct = detalheOrcado ? (detalheVariacao / Math.abs(detalheOrcado)) * 100 : 0;
                                        return (
                                          <tr key={detalhe.key} className="orc-dashboard-detalhe-row">
                                            <td>{detalhe.label}</td>
                                            <td className="orc-col-orcado">{fmtDashAmount(detalheOrcado)}</td>
                                            <td className="orc-col-realizado">{fmtDashAmount(detalheRealizado)}</td>
                                            <td className={varClass(detalheVariacao)}>
                                              {detalheOrcado
                                                ? `${detalhePct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
                                                : "—"}
                                            </td>
                                            <td className={varClass(detalheVariacao)}>
                                              <CmpAmount delta={detalheVariacao}>{formatBRL(detalheVariacao)}</CmpAmount>
                                            </td>
                                          </tr>
                                        );
                                      })
                                    : null}
                                </Fragment>
                              );
                            })
                          : null}
                      </Fragment>
                    );
                  })}
                  <tr className="orc-dashboard-total">
                    <td>Total</td>
                    <td className="orc-col-orcado">{fmtDashAmount(totalOrcado)}</td>
                    <td className="orc-col-realizado">{fmtDashAmount(totalRealizado)}</td>
                    <td>
                      {totalOrcado
                        ? `${(((totalRealizado - totalOrcado) / Math.abs(totalOrcado)) * 100).toLocaleString("pt-BR", {
                            maximumFractionDigits: 2,
                          })}%`
                        : "—"}
                    </td>
                    <td>{formatBRL(totalRealizado - totalOrcado)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <aside className="orc-dashboard-kpis">
            <div>
              <span>Orçado</span>
              <strong>{fmtDashAmount(totalOrcado)}</strong>
            </div>
            <div>
              <span>Realizado</span>
              <strong>{fmtDashAmount(totalRealizado)}</strong>
            </div>
            <div>
              <span>Sobra de</span>
              <strong>{fmtDashAmount(sobra)}</strong>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

export function OrcadoRealizado({ embedded = false }: { embedded?: boolean } = {}) {
  const { go, safras, safraId, safra } = useApp();
  const [mainTab, setMainTab] = useState<MainTab>("comparativo");
  const [reportSafraId, setReportSafraId] = useState(0);
  const [data, setData] = useState<OrcadoRealizadoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [kpis, setKpis] = useState<DashboardData["kpis"] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<View>("costCenter");
  const [metric, setMetric] = useState<Metric>("comparativo");
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedNegocios, setSelectedNegocios] = useState<string[]>([]);
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [selectedSafras, setSelectedSafras] = useState<string[]>([]);
  const [dashboardMonth, setDashboardMonth] = useState<number | null>(null);
  const [openCenters, setOpenCenters] = useState<string[]>([]);
  const [openCategories, setOpenCategories] = useState<string[]>([]);

  const comparativoCarregado = useRef(0);

  useEffect(() => {
    if (safraId && !reportSafraId) setReportSafraId(safraId);
  }, [safraId, reportSafraId]);

  useEffect(() => {
    if (mainTab !== "comparativo") return;
    if (!reportSafraId) return;
    if (comparativoCarregado.current === reportSafraId) return;
    setLoading(true);
    setData(null);
    setErr(null);
    setSelected([]);
    setSelectedNegocios([]);
    setSelectedActivities([]);
    setSelectedSafras([]);
    setOpenCenters([]);
    setOpenCategories([]);
    void api
      .orcadoRealizado({ safraId: reportSafraId })
      .then((next) => {
        comparativoCarregado.current = reportSafraId;
        setData(next);
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [reportSafraId, mainTab]);

  useEffect(() => {
    void api.premissas().then(setKpis).catch(() => setKpis(null));
  }, [safraId]);

  const filteredRealizadoByActivity = useMemo(() => {
    const rows = data?.realizadoByActivity ?? [];
    if (!selectedActivities.length) return rows;
    const wanted = new Set(selectedActivities);
    return rows.filter((row) => wanted.has(row.key));
  }, [data, selectedActivities]);

  const centerOptionsAll = useMemo(
    () => usedCostCenters(data?.contributions ?? [], data?.realizadoByObject ?? []),
    [data],
  );

  const centersForNegocio = useMemo(() => {
    if (!selectedNegocios.length) return selected;
    const allowed = new Set(
      centerOptionsAll
        .filter((row) => centerMatchesNegocios(row.label, selectedNegocios))
        .map((row) => row.key),
    );
    if (selected.length) return selected.filter((key) => allowed.has(key));
    return [...allowed];
  }, [centerOptionsAll, selected, selectedNegocios]);

  const filtered = useMemo(() => {
    if (!data) return data;
    const hasCenterFilter = centersForNegocio.length > 0;
    if (!hasCenterFilter) {
      return data;
    }
    const summary = aggregateCompare(
      data.contributions ?? [],
      data.realizadoByObject ?? [],
      centersForNegocio,
      data.realizadoByActivity ?? [],
    );
    return {
      ...data,
      ...summary,
      views: {
        ...summary.views,
        safra: data.views.safra ?? [],
      },
    };
  }, [data, centersForNegocio]);

  const activityTree = useMemo(
    () =>
      buildCompareActivityByCategory(
        data?.contributions ?? [],
        centersForNegocio,
        filteredRealizadoByActivity,
        selectedActivities,
      ),
    [data, centersForNegocio, filteredRealizadoByActivity, selectedActivities],
  );

  const unitsBySheet = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of data?.unitsBySheet ?? []) {
      if (row.sheetId != null && row.units > 0) map.set(row.sheetId, row.units);
    }
    return map;
  }, [data]);

  const centerOptions = useMemo(
    () =>
      selectedNegocios.length
        ? centerOptionsAll.filter((row) => centerMatchesNegocios(row.label, selectedNegocios))
        : centerOptionsAll,
    [centerOptionsAll, selectedNegocios],
  );

  const unitsRealizadoScoped = useMemo(() => {
    const centerKeys = centersForNegocio.length
      ? new Set(centersForNegocio)
      : new Set(centerOptionsAll.map((item) => item.key));
    let sum = 0;
    for (const [sheetId, units] of unitsBySheet) {
      if (centerKeys.has(`cc-${sheetId}`)) sum += units;
    }
    return sum;
  }, [unitsBySheet, centersForNegocio, centerOptionsAll]);

  const custoPeriod = useMemo(() => {
    if (data) {
      return { from: data.anomesFrom, to: data.anomesTo, label: data.safraLabel };
    }
    return safraAnomesRange(safra?.code ?? "25/26", safra?.label ?? "Safra");
  }, [data, safra]);

  const tons = useMemo(() => {
    const selectedRow = (data?.views.safra ?? []).find((row) => row.key === `safra-${reportSafraId}`);
    if (selectedRow?.tons != null && selectedRow.tons > 0) return selectedRow.tons;
    return moagemFromKpis(kpis);
  }, [data, kpis, reportSafraId]);

  const tabBar = (
    <div className="kind-toggle no-print" style={{ paddingBottom: 4, flexWrap: "wrap" }}>
      {MAIN_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`btn ${mainTab === t.id ? "primary" : ""}`}
          onClick={() => setMainTab(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  if (mainTab === "custo") {
    return (
      <PageShell embedded={embedded}>
        {tabBar}
        <CustoDashboard
          anomesFrom={custoPeriod.from}
          anomesTo={custoPeriod.to}
          safraLabel={custoPeriod.label}
          safraId={reportSafraId || safraId}
        />
      </PageShell>
    );
  }

  if (mainTab === "estagio") {
    return (
      <PageShell embedded={embedded}>
        {tabBar}
        <EstagioProducaoPanel
          anomesFrom={custoPeriod.from}
          anomesTo={custoPeriod.to}
          safraLabel={custoPeriod.label}
          safraId={reportSafraId || safraId}
        />
      </PageShell>
    );
  }

  if (mainTab === "colheita") {
    return (
      <PageShell embedded={embedded}>
        {tabBar}
        <CustoColheitaPanel
          safraId={reportSafraId || safraId}
          safraLabel={custoPeriod.label}
          anoSafra={Math.floor(custoPeriod.from / 100)}
          anomesInicio={custoPeriod.from}
          anomesFim={custoPeriod.to}
        />
      </PageShell>
    );
  }

  if (mainTab === "consultaRateio") {
    return (
      <PageShell embedded={embedded}>
        {tabBar}
        <ConsultaRateio
          anomesFrom={custoPeriod.from}
          anomesTo={custoPeriod.to}
          safraLabel={custoPeriod.label}
        />
      </PageShell>
    );
  }

  if (err) {
    return (
      <PageShell embedded={embedded}>
        {tabBar}
        <p className="lead" style={{ color: "var(--danger)" }}>
          Não foi possível consultar o realizado: {err}
        </p>
      </PageShell>
    );
  }

  if (!filtered) {
    return (
      <PageShell embedded={embedded}>
        {tabBar}
        <p>Consultando o realizado no Oracle…</p>
      </PageShell>
    );
  }

  const report = filtered;
  const isResumo = metric === "resumo";
  const isSafraView = view === "safra";
  const safraRows = (report.views.safra ?? []).filter(
    (row) => !selectedSafras.length || selectedSafras.includes(row.key),
  );
  const rows = view === "activity" ? [] : (isSafraView ? safraRows : [...(report.views[view] ?? [])]).filter(hasVisibleCompareValue);
  const header =
    view === "activity"
      ? "Centro / categoria / atividade"
      : (VIEWS.find((item) => item.id === view)?.label ?? "Centro de custo");
  const activityLeaves = activityTree.flatMap((center) =>
    center.categories.flatMap((category) => category.activities),
  );
  const scoped =
    view === "activity"
      ? {
          totals: {
            orcado: report.months.map((_, i) =>
              activityLeaves.reduce((sum, row) => sum + (row.orcado[i] ?? 0), 0),
            ),
            realizado: report.months.map((_, i) =>
              activityLeaves.reduce((sum, row) => sum + (row.realizado[i] ?? 0), 0),
            ),
            variacao: report.months.map((_, i) =>
              activityLeaves.reduce((sum, row) => sum + (row.variacao[i] ?? 0), 0),
            ),
          },
          totalOrcado: activityLeaves.reduce((sum, row) => sum + row.orcadoTotal, 0),
          totalRealizado: activityLeaves.reduce((sum, row) => sum + row.realizadoTotal, 0),
          totalVariacao: activityLeaves.reduce((sum, row) => sum + row.variacaoTotal, 0),
        }
      : isSafraView
        ? totalsFromRows(safraRows, report.months)
        : report;
  const hideMonthlyOrcadoTotals =
    isSafraView && !(scoped.totals.orcado ?? []).some((value) => value);
  const consumed = scoped.totalOrcado ? (scoped.totalRealizado / Math.abs(scoped.totalOrcado)) * 100 : 0;
  const options = centerOptions;
  const negocioFilterOptions = negocioOptions();
  const activityOptions = usedAssociatedActivities(
    report.contributions ?? [],
    data?.realizadoByActivity ?? [],
  );
  const safraOptions = (data?.views.safra ?? []).map((row) => ({ key: row.key, label: row.label }));
  const unitsOrcado = unitsFromKpis(kpis);
  const realizadoUnitsFor = (sheetId?: number) => {
    if (sheetId != null) return unitsBySheet.get(sheetId) ?? 0;
    return unitsRealizadoScoped;
  };

  const emptyColSpan = isResumo
    ? 7
    : metric === "comparativo"
      ? report.months.length * 2 + 5
      : report.months.length + 2;
  const summaryTotals = {
    orcadoTotal: scoped.totalOrcado,
    realizadoTotal: scoped.totalRealizado,
    tons: isSafraView ? safraRows.reduce((sum, row) => sum + (row.tons ?? 0), 0) : undefined,
  };

  return (
    <PageShell embedded={embedded}>
      {tabBar}
      <ConsultaProgressBar active={loading} label="Carregando comparativo da safra…" className="consulta-progress--compact" />
      <div className="kind-toggle no-print orcado-safra-filter">
        <span className="toggle-caption">Período safra</span>
        <select
          className="safra-pick"
          value={reportSafraId || ""}
          aria-label="Período de safra do comparativo"
          onChange={(e) => {
            const value = e.target.value;
            if (value === "__new__") {
              go({ kind: "safras" });
              return;
            }
            setReportSafraId(Number(value));
          }}
        >
          {safras.map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
          <option value="__new__">+ Nova safra…</option>
        </select>
        {data?.anomesFrom && data?.anomesTo ? (
          <span className="orcado-safra-range">
            Realizado Oracle: {String(data.anomesFrom).slice(0, 4)}/{String(data.anomesFrom).slice(4)} a{" "}
            {String(data.anomesTo).slice(0, 4)}/{String(data.anomesTo).slice(4)}
          </span>
        ) : null}
      </div>
      {!isSafraView ? (
        <OrcadoRealizadoDashboard
          report={report}
          rows={report.grupoGasto ?? []}
          selectedMonth={dashboardMonth}
          onSelectedMonth={setDashboardMonth}
          safraLabel={report.safraLabel}
          selectedNegocio={selectedNegocios[0] ?? ""}
          onSelectedNegocio={(key) => {
            setSelectedNegocios(key ? [key] : []);
            setSelected([]);
          }}
          negocioOptions={negocioFilterOptions}
        />
      ) : null}
      <div className="kpis">
        <div className="kpi">
          <span>Orçado</span>
          <strong>{formatBRL(scoped.totalOrcado)}</strong>
        </div>
        <div className="kpi">
          <span>Realizado</span>
          <strong>{formatBRL(scoped.totalRealizado)}</strong>
        </div>
        <div className="kpi">
          <span>Variação</span>
          <strong className={varClass(scoped.totalVariacao)}>{formatBRL(scoped.totalVariacao)}</strong>
        </div>
        <div className="kpi">
          <span>% realizado</span>
          <strong>
            {scoped.totalOrcado
              ? new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(consumed) + "%"
              : "—"}
          </strong>
        </div>
        {isResumo && !isSafraView ? (
          <>
            <div className="kpi">
              <span>Plantio (Un orçado)</span>
              <strong>{unitsOrcado > 0 ? `${formatQty(unitsOrcado)} ha` : "—"}</strong>
            </div>
            <div className="kpi">
              <span>Un realizado</span>
              <strong>{unitsRealizadoScoped > 0 ? formatQty(unitsRealizadoScoped) : "—"}</strong>
            </div>
            <div className="kpi">
              <span>Moagem</span>
              <strong>{tons > 0 ? `${formatQty(tons)} t` : "—"}</strong>
            </div>
          </>
        ) : null}
      </div>
      <section className="panel">
        <h3>
          Orçado x realizado
          <span className="panel-h3-actions">
            <small>{formatBRL(scoped.totalOrcado)} vs {formatBRL(scoped.totalRealizado)}</small>
            <PrintButton />
          </span>
        </h3>
        <p className="print-only-meta">
          Orçado x realizado — {VIEWS.find((item) => item.id === view)?.label}
          {isSafraView ? " — por safra" : report.safraLabel ? ` — ${report.safraLabel}` : ""}
          {` — ${METRICS.find((item) => item.id === metric)?.label}`}
          {isResumo && !isSafraView && unitsOrcado > 0 ? ` — plantio ${formatQty(unitsOrcado)} ha` : ""}
          {isResumo && !isSafraView && unitsRealizadoScoped > 0 ? ` — Un realizado ${formatQty(unitsRealizadoScoped)}` : ""}
          {isResumo && !isSafraView && tons > 0 ? ` — moagem ${formatQty(tons)} t` : ""}
        </p>
        <div className="orcado-visual-filters no-print">
          <label>
            <span>Agrupar</span>
            <select value={view} onChange={(e) => setView(e.target.value as View)}>
              {VIEWS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Exibir</span>
            <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
              {METRICS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => go(costPlanningTab("activityLinks"))}>
            Associar atividades
          </button>
        </div>
        {metric === "comparativo" && !isResumo ? (
          <p className="orcado-realizado-legend">
            <span className="orcado-col-swatch">Orçado</span>
            <span className="realizado-col-swatch">Realizado</span>
            <span>
              {isSafraView
                ? "Colunas azuis = orçado · Colunas brancas = realizado no Oracle · safras anteriores usam orçamento anual · ▲ acima do orçado · ▼ abaixo do orçado"
                : "Colunas azuis = orçado da safra · Colunas brancas = realizado no Oracle · ▲ acima do orçado · ▼ abaixo do orçado"}
            </span>
          </p>
        ) : null}
        {isSafraView ? (
          <div className="orcado-visual-filters no-print">
            <label>
              <span>Safra</span>
              <select
                value={selectedSafras[0] ?? ""}
                onChange={(e) => setSelectedSafras(e.target.value ? [e.target.value] : [])}
              >
                <option value="">Todas</option>
                {safraOptions.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <div className="orcado-visual-filters no-print">
            <label>
              <span>Negócio</span>
              <select
                value={selectedNegocios[0] ?? ""}
                onChange={(e) => {
                  setSelectedNegocios(e.target.value ? [e.target.value] : []);
                  setSelected([]);
                }}
              >
                <option value="">Todos</option>
                {negocioFilterOptions.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Centro de custo</span>
              <select value={selected[0] ?? ""} onChange={(e) => setSelected(e.target.value ? [e.target.value] : [])}>
                <option value="">Todos</option>
                {options.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {view === "activity" && activityOptions.length ? (
          <div className="orcado-visual-filters no-print">
            <label>
              <span>Atividade</span>
              <select
                value={selectedActivities[0] ?? ""}
                onChange={(e) =>
                  setSelectedActivities(e.target.value ? [e.target.value] : [])
                }
                aria-label="Filtrar atividade"
              >
                <option value="">Todas</option>
                {activityOptions.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        <div className="table-wrap orcado-realizado-wrap">
          <table className={`data resumo orcado-realizado ${metric === "comparativo" ? "comparativo" : ""}`}>
            <thead>
              <tr>
                <th rowSpan={metric === "comparativo" && !isResumo ? 2 : 1}>{header}</th>
                {isResumo ? (
                  <>
                    <th className="month-orcado">Orçado</th>
                    <th>Realizado</th>
                    <th className="month-orcado">R$/un Orçado</th>
                    <th>R$/un Realizado</th>
                    <th className="month-orcado">R$/Ton Orçado</th>
                    <th>R$/Ton Realizado</th>
                  </>
                ) : metric === "comparativo" ? (
                  <>
                    {report.months.map((m) => (
                      <th key={m} className="month month-group" colSpan={2}>
                        {m.slice(0, 3)}
                      </th>
                    ))}
                    <th className="month month-group" colSpan={4}>Total</th>
                  </>
                ) : (
                  <>
                    {report.months.map((m) => (
                      <th
                        key={m}
                        className={`month${metric === "orcado" ? " month-orcado" : ""}`}
                      >
                        {m.slice(0, 3)}
                      </th>
                    ))}
                    <th className={`month${metric === "orcado" ? " month-orcado" : ""}`}>Total</th>
                  </>
                )}
              </tr>
              {metric === "comparativo" && !isResumo ? (
                <tr>
                  {report.months.map((m) => (
                    <Fragment key={m}>
                      <th className="month month-orcado">Orçado</th>
                      <th className="month month-realizado">Realizado</th>
                    </Fragment>
                  ))}
                  <th className="month month-orcado">Orçado</th>
                  <th className="month month-realizado">Realizado</th>
                  <th className="month">Variação</th>
                  <th className="month">%</th>
                </tr>
              ) : null}
            </thead>
            <tbody>
              {view === "activity" ? (
                <>
                  {activityTree.map((center) => {
                    const centerOpen = openCenters.includes(center.key);
                    const visibleCategories = center.categories
                      .map((category) => ({
                        ...category,
                        activities: category.activities.filter(hasVisibleCompareValue),
                      }))
                      .filter((category) => hasVisibleCompareValue(category) || category.activities.length);
                    if (!hasVisibleCompareValue(center) && !visibleCategories.length) return null;
                    return (
                      <Fragment key={center.key}>
                        <tr className="tree-center">
                          <td className="left">
                            <span className="tree-label">
                              {visibleCategories.length ? (
                                <button
                                  type="button"
                                  className="icon-btn fold-btn"
                                  title={centerOpen ? "Ocultar categorias" : "Ver categorias"}
                                  onClick={() =>
                                    setOpenCenters((current) => toggleKey(current, center.key))
                                  }
                                >
                                  {centerOpen ? "▾" : "▸"}
                                </button>
                              ) : (
                                <span className="tree-spacer" />
                              )}
                              {center.label}
                            </span>
                          </td>
                          {isResumo ? (
                            <SummaryCells
                              row={center}
                              unitsOrcado={unitsOrcado}
                              unitsRealizado={realizadoUnitsFor(center.sheetId)}
                              tons={tons}
                            />
                          ) : (
                            <CompareCells row={center} months={report.months} metric={metric} />
                          )}
                        </tr>
                        {visibleCategories.map((category) => {
                          const categoryOpen = openCategories.includes(category.key);
                          const activities = category.activities;
                          return (
                            <Fragment key={category.key}>
                              <tr
                                className={`tree-activity${centerOpen ? "" : " is-collapsed"}`}
                              >
                                <td className="left">
                                  <span className="tree-label">
                                    {activities.length ? (
                                      <button
                                        type="button"
                                        className="icon-btn fold-btn"
                                        title={
                                          categoryOpen ? "Ocultar atividades" : "Ver atividades"
                                        }
                                        onClick={() =>
                                          setOpenCategories((current) =>
                                            toggleKey(current, category.key),
                                          )
                                        }
                                      >
                                        {categoryOpen ? "▾" : "▸"}
                                      </button>
                                    ) : (
                                      <span className="tree-spacer" />
                                    )}
                                    {category.label}
                                  </span>
                                </td>
                                {isResumo ? (
                                  <SummaryCells
                                    row={category}
                                    unitsOrcado={unitsOrcado}
                                    unitsRealizado={realizadoUnitsFor(center.sheetId)}
                                    tons={tons}
                                  />
                                ) : (
                                  <CompareCells
                                    row={category}
                                    months={report.months}
                                    metric={metric}
                                  />
                                )}
                              </tr>
                              {activities.map((activity) => (
                                <Fragment key={activity.key}>
                                <tr
                                  className={`tree-material${
                                    centerOpen && categoryOpen ? "" : " is-collapsed"
                                  }`}
                                >
                                  <td className="left">
                                    <span className="tree-label">
                                      <span className="tree-spacer" />
                                      {activity.label}
                                    </span>
                                  </td>
                                  {isResumo ? (
                                    <SummaryCells
                                      row={activity}
                                      unitsOrcado={unitsOrcado}
                                      unitsRealizado={realizadoUnitsFor(center.sheetId)}
                                      tons={tons}
                                    />
                                  ) : (
                                    <CompareCells
                                      row={activity}
                                      months={report.months}
                                      metric={metric}
                                    />
                                  )}
                                </tr>
                                {(activity.sources ?? []).filter(hasVisibleCompareValue).map((source) => (
                                  <tr
                                    key={source.key}
                                    className={`tree-source${
                                      centerOpen && categoryOpen ? "" : " is-collapsed"
                                    }`}
                                  >
                                    <td className="left">
                                      <span className="tree-label tree-source-label">{source.label}</span>
                                    </td>
                                    {isResumo ? (
                                      <SummaryCells
                                        row={source}
                                        unitsOrcado={unitsOrcado}
                                        unitsRealizado={realizadoUnitsFor(center.sheetId)}
                                        tons={tons}
                                      />
                                    ) : (
                                      <CompareCells
                                        row={source}
                                        months={report.months}
                                        metric={metric}
                                      />
                                    )}
                                  </tr>
                                ))}
                                </Fragment>
                              ))}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  {!activityTree.length ? (
                    <tr>
                      <td className="left" colSpan={emptyColSpan}>
                        {selectedActivities.length
                          ? "Nenhuma atividade neste filtro."
                          : "Nenhum valor neste agrupamento. Associe atividades para vê-las aqui."}
                      </td>
                    </tr>
                  ) : null}
                </>
              ) : (
                <>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td className="left">
                        {row.label}
                      </td>
                      {isResumo ? (
                        <SummaryCells
                          row={row}
                          unitsOrcado={isSafraView ? 0 : unitsOrcado}
                          unitsRealizado={isSafraView ? 0 : realizadoUnitsFor(row.sheetId)}
                          tons={row.tons ?? tons}
                        />
                      ) : (
                        <CompareCells row={row} months={report.months} metric={metric} />
                      )}
                    </tr>
                  ))}
                  {!rows.length ? (
                    <tr>
                      <td className="left" colSpan={emptyColSpan}>
                        Nenhum valor neste agrupamento.
                      </td>
                    </tr>
                  ) : null}
                </>
              )}
              <tr className="total-geral">
                <td>Total geral</td>
                {isResumo ? (
                  <SummaryCells
                    row={summaryTotals}
                    unitsOrcado={isSafraView ? 0 : unitsOrcado}
                    unitsRealizado={isSafraView ? 0 : unitsRealizadoScoped}
                    tons={summaryTotals.tons ?? tons}
                  />
                ) : (
                  <CompareTotalsCells
                    totals={scoped.totals}
                    totalOrcado={scoped.totalOrcado}
                    totalRealizado={scoped.totalRealizado}
                    totalVariacao={scoped.totalVariacao}
                    months={report.months}
                    metric={metric}
                    hideMonthlyOrcado={hideMonthlyOrcadoTotals}
                  />
                )}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </PageShell>
  );
}
