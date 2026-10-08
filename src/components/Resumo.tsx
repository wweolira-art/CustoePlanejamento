import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type DashboardData, type HarvestAreasData, type ResumoData, type ResumoRow } from "../api";
import { formatBRL, formatNum, formatQty } from "../lib/format";
import {
  aggregateResumo,
  buildResumoActivityByCategory,
  buildResumoTree,
  filterContributions,
  usedActivities,
  usedCategories,
  usedCostCenters,
  usedGroups,
  type ResumoMetrics,
} from "../lib/reportAggregate";
import { centerMatchesNegocios, negocioOptions } from "../lib/costCenterGroups";
import { costPlanningSheet, useApp } from "../store";
import { PrintButton } from "./PrintButton";
import { useSafraLoaded } from "./SafraLoadProgress";

type View = "detail" | "costCenter" | "category" | "activity";
type PremissaKpis = DashboardData["kpis"];

const VIEWS: { id: View; label: string }[] = [
  { id: "detail", label: "Detalhe" },
  { id: "costCenter", label: "Centro de custo" },
  { id: "category", label: "Categoria" },
  { id: "activity", label: "Atividade" },
];

function toggleKey(list: string[], key: string) {
  return list.includes(key) ? list.filter((item) => item !== key) : [...list, key];
}

function areaLabel(areaHa?: number | null, areaPct?: number | null) {
  if (areaHa != null && areaHa > 0) return `${formatQty(areaHa)} ha`;
  if (areaPct != null && areaPct > 0) return `${formatQty(areaPct)}%`;
  return "—";
}

function MetricCells({ qtyHa, rateHa, areaHa, areaPct, applications }: Partial<ResumoMetrics>) {
  return (
    <>
      <td className="col-qty-ha">{qtyHa != null && qtyHa > 0 ? formatQty(qtyHa) : "—"}</td>
      <td className="col-rate-ha">{rateHa != null && rateHa > 0 ? formatBRL(rateHa) : "—"}</td>
      <td className="col-area">{areaLabel(areaHa, areaPct)}</td>
      <td className="col-apps">{applications != null && applications > 0 ? `${formatQty(applications)}x` : "—"}</td>
    </>
  );
}

function EmptyMetrics() {
  return (
    <>
      <td className="col-qty-ha">—</td>
      <td className="col-rate-ha">—</td>
      <td className="col-area">—</td>
      <td className="col-apps">—</td>
    </>
  );
}

function PageShell({ embedded, children }: { embedded?: boolean; children: ReactNode }) {
  return embedded ? <>{children}</> : <div className="page">{children}</div>;
}

function DropdownFilter({
  caption,
  options,
  selected,
  onChange,
  allLabel = "Todos",
}: {
  caption: string;
  options: { key: string; label: string }[];
  selected: string[];
  onChange: (keys: string[]) => void;
  allLabel?: string;
}) {
  if (!options.length) return null;
  return (
    <label className="resumo-filter-field">
      <span>{caption}</span>
      <select value={selected[0] ?? ""} onChange={(event) => onChange(event.target.value ? [event.target.value] : [])}>
        <option value="">{allLabel}</option>
        {options.map((item) => (
          <option key={item.key} value={item.key}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function arrendamentoAreaHa(areas: HarvestAreasData | null) {
  if (!areas?.areas?.length) return Number(areas?.total) || 0;
  const arrend = areas.areas.filter((row) => /arrend/i.test(row.description));
  if (arrend.length) return arrend.reduce((sum, row) => sum + (Number(row.area) || 0), 0);
  return Number(areas.total) || areas.areas.reduce((sum, row) => sum + (Number(row.area) || 0), 0);
}

export function Resumo({ embedded = false }: { embedded?: boolean } = {}) {
  const { go, safra, safraId } = useApp();
  const [data, setData] = useState<ResumoData | null>(null);
  const [kpis, setKpis] = useState<PremissaKpis | null>(null);
  const [harvestAreas, setHarvestAreas] = useState<HarvestAreasData | null>(null);
  const [view, setView] = useState<View>("detail");
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedNegocios, setSelectedNegocios] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [openCenters, setOpenCenters] = useState<string[]>([]);
  const [openActivities, setOpenActivities] = useState<string[]>([]);
  const [openCategories, setOpenCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setKpis(null);
    setHarvestAreas(null);
    setSelected([]);
    setSelectedNegocios([]);
    setSelectedCategories([]);
    setSelectedGroups([]);
    setSelectedActivities([]);
    setOpenCenters([]);
    setOpenActivities([]);
    setOpenCategories([]);
    void Promise.all([
      api.resumo().then(setData),
      api.premissas().then(setKpis).catch(() => setKpis(null)),
      api
        .harvestAreas(safraId ?? undefined)
        .then(setHarvestAreas)
        .catch(() => setHarvestAreas(null)),
    ]).finally(() => setLoading(false));
  }, [safraId]);

  useSafraLoaded(!loading);

  const centerOptionsAll = useMemo(() => usedCostCenters(data?.contributions ?? []), [data]);
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

  const filteredRows = useMemo(
    () =>
      filterContributions(
        data?.contributions ?? [],
        centersForNegocio,
        selectedCategories,
        selectedGroups,
        [],
        selectedActivities,
      ),
    [data, centersForNegocio, selectedCategories, selectedGroups, selectedActivities],
  );

  const filtered = useMemo(() => {
    if (!data) return data;
    const summary = aggregateResumo(filteredRows);
    return { ...data, ...summary };
  }, [data, filteredRows]);

  const tree = useMemo(() => buildResumoTree(filteredRows), [filteredRows]);
  const activityTree = useMemo(() => buildResumoActivityByCategory(filteredRows), [filteredRows]);

  const printMetrics = useMemo(() => {
    const moagemMecanizada =
      kpis?.subprocesses?.find((row) => row.key === "tons")?.qty?.value ?? kpis?.moagem ?? 0;
    const moagemManual =
      kpis?.subprocesses?.find((row) => row.key === "tonsManual")?.qty?.value ?? kpis?.moagemManual ?? 0;
    const toneladas = Number(moagemMecanizada) + Number(moagemManual);
    const tch = Number(kpis?.tch) || 0;
    const areaPlantio = (Number(kpis?.areaVerao) || 0) + (Number(kpis?.areaInverno) || 0);
    const areaSoca = Number(kpis?.areaSoca) || 0;
    const areaArrendamento = arrendamentoAreaHa(harvestAreas);
    const orcamento = filtered?.total ?? 0;
    const custoPorTon = toneladas > 0 ? orcamento / toneladas : 0;
    return { toneladas, tch, areaPlantio, areaSoca, areaArrendamento, orcamento, custoPorTon };
  }, [kpis, harvestAreas, filtered?.total]);

  if (!filtered) return <PageShell embedded={embedded}><p>Montando relatório…</p></PageShell>;

  const fallback: ResumoRow[] = (filtered.rows ?? []).map((row) => ({
    key: `cc-${row.sheetId}`,
    label: row.title,
    months: row.months,
    total: row.total,
    sheetId: row.sheetId,
  }));
  const flatView = view === "detail" || view === "activity" ? "costCenter" : view;
  const rows = [...(filtered.views?.[flatView] ?? fallback)].sort((a, b) => b.total - a.total);
  const header =
    view === "detail"
      ? "Centro / atividade / material"
      : view === "activity"
        ? "Categoria / atividade"
        : (VIEWS.find((item) => item.id === view)?.label ?? "Centro de custo");
  const centerOptions = selectedNegocios.length
    ? centerOptionsAll.filter((row) => centerMatchesNegocios(row.label, selectedNegocios))
    : centerOptionsAll;
  const categoryOptions = usedCategories(data?.contributions ?? []);
  const groupOptions = usedGroups(data?.contributions ?? []);
  const activityOptions = usedActivities(data?.contributions ?? []);
  const negocioFilterOptions = negocioOptions();
  const colCount = (view === "detail" ? 6 : 2) + (filtered.months?.length ?? 12);

  return (
    <PageShell embedded={embedded}>
      <p className="lead">
        Na aba Detalhe abra o centro de custo para ver as atividades e abra a atividade para ver os
        materiais. Em Atividade as linhas ficam agrupadas por categoria. Filtre por negócio (Agrícola,
        Pecuária, Diretoria), atividade, categoria, grupo de material ou centro de custo.
      </p>
      <section className="panel resumo-consolidado">
        <h3>
          Orçamento da safra
          <span className="panel-h3-actions">
            <small>{formatBRL(filtered.total)}</small>
            <PrintButton />
          </span>
        </h3>
        <p className="print-only-meta">
          Relatório consolidado — {VIEWS.find((item) => item.id === view)?.label}
          {safra?.label ? ` — ${safra.label}` : ""}
        </p>
        <div className="print-only-kpis">
          <div>
            <span>TCH</span>
            <strong>{printMetrics.tch > 0 ? formatQty(printMetrics.tch) : "—"}</strong>
          </div>
          <div>
            <span>Tonelada de cana</span>
            <strong>{printMetrics.toneladas > 0 ? `${formatQty(printMetrics.toneladas)} t` : "—"}</strong>
          </div>
          <div>
            <span>Área de plantio</span>
            <strong>{printMetrics.areaPlantio > 0 ? `${formatQty(printMetrics.areaPlantio)} ha` : "—"}</strong>
          </div>
          <div>
            <span>Área tratos cana soca</span>
            <strong>{printMetrics.areaSoca > 0 ? `${formatQty(printMetrics.areaSoca)} ha` : "—"}</strong>
          </div>
          <div>
            <span>Área de arrendamento</span>
            <strong>
              {printMetrics.areaArrendamento > 0 ? `${formatQty(printMetrics.areaArrendamento)} ha` : "—"}
            </strong>
          </div>
          <div>
            <span>R$ / tonelada</span>
            <strong>{printMetrics.custoPorTon > 0 ? formatBRL(printMetrics.custoPorTon) : "—"}</strong>
          </div>
        </div>
        <div className="resumo-filter-grid">
          <label className="resumo-filter-field">
            <span>Agrupar</span>
            <select value={view} onChange={(event) => setView(event.target.value as View)}>
              {VIEWS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <DropdownFilter
            caption="Negócio"
            options={negocioFilterOptions}
            selected={selectedNegocios}
            onChange={(keys) => {
              setSelectedNegocios(keys);
              setSelected([]);
            }}
          />
          <DropdownFilter caption="Centro de custo" options={centerOptions} selected={selected} onChange={setSelected} />
          <DropdownFilter
            caption="Categoria"
            options={categoryOptions}
            selected={selectedCategories}
            onChange={setSelectedCategories}
          />
          <DropdownFilter caption="Grupo" options={groupOptions} selected={selectedGroups} onChange={setSelectedGroups} />
          <DropdownFilter
            caption="Atividade"
            options={activityOptions}
            selected={selectedActivities}
            onChange={setSelectedActivities}
            allLabel="Todas"
          />
        </div>
        <div className="table-wrap">
          <table className={`data resumo${view === "detail" ? " resumo-detail" : ""}`}>
            <thead>
              <tr>
                <th>{header}</th>
                {view === "detail" ? (
                  <>
                    <th className="col-qty-ha">Qtd/ha</th>
                    <th className="col-rate-ha">R$/ha</th>
                    <th className="col-area">Área</th>
                    <th className="col-apps">Aplic.</th>
                  </>
                ) : null}
                {(filtered.months ?? []).map((m) => (
                  <th key={m} className="month">{m.slice(0, 3)}</th>
                ))}
                <th className="month">Total</th>
              </tr>
            </thead>
            <tbody>
              {view === "detail" ? (
                <>
                  {tree.map((center) => {
                    const centerOpen = openCenters.includes(center.key);
                    return (
                      <Fragment key={center.key}>
                        <tr className="tree-center">
                          <td className="left">
                            <span className="tree-label">
                              {center.activities.length ? (
                                <button
                                  type="button"
                                  className="icon-btn fold-btn"
                                  title={centerOpen ? "Ocultar atividades" : "Ver atividades"}
                                  onClick={() => setOpenCenters((current) => toggleKey(current, center.key))}
                                >
                                  {centerOpen ? "▾" : "▸"}
                                </button>
                              ) : (
                                <span className="tree-spacer" />
                              )}
                              {center.sheetId != null ? (
                                <button
                                  type="button"
                                  className="linkish"
                                  onClick={() => go(costPlanningSheet(center.sheetId!))}
                                >
                                  {center.label}
                                </button>
                              ) : (
                                center.label
                              )}
                            </span>
                          </td>
                          <EmptyMetrics />
                          {center.months.map((value, i) => (
                            <td key={i}>{value ? formatNum(value) : ""}</td>
                          ))}
                          <td>{formatBRL(center.total)}</td>
                        </tr>
                        {centerOpen
                          ? center.activities.map((activity) => {
                              const activityOpen = openActivities.includes(activity.key);
                              return (
                                <Fragment key={activity.key}>
                                  <tr className="tree-activity">
                                    <td className="left">
                                      <span className="tree-label">
                                        {activity.materials.length ? (
                                          <button
                                            type="button"
                                            className="icon-btn fold-btn"
                                            title={activityOpen ? "Ocultar materiais" : "Ver materiais"}
                                            onClick={() =>
                                              setOpenActivities((current) => toggleKey(current, activity.key))
                                            }
                                          >
                                            {activityOpen ? "▾" : "▸"}
                                          </button>
                                        ) : (
                                          <span className="tree-spacer" />
                                        )}
                                        {activity.label}
                                      </span>
                                    </td>
                                    <MetricCells {...activity} />
                                    {activity.months.map((value, i) => (
                                      <td key={i}>{value ? formatNum(value) : ""}</td>
                                    ))}
                                    <td>{formatBRL(activity.total)}</td>
                                  </tr>
                                  {activityOpen
                                    ? activity.materials.map((material) => (
                                        <tr key={material.key} className="tree-material">
                                          <td className="left">
                                            <span className="tree-label">
                                              <span className="tree-spacer" />
                                              {material.label}
                                            </span>
                                          </td>
                                          <MetricCells {...material} />
                                          {material.months.map((value, i) => (
                                            <td key={i}>{value ? formatNum(value) : ""}</td>
                                          ))}
                                          <td>{formatBRL(material.total)}</td>
                                        </tr>
                                      ))
                                    : null}
                                </Fragment>
                              );
                            })
                          : null}
                      </Fragment>
                    );
                  })}
                </>
              ) : view === "activity" ? (
                <>
                  {activityTree.map((category) => {
                    const categoryOpen = openCategories.includes(category.key);
                    return (
                      <Fragment key={category.key}>
                        <tr className="tree-center">
                          <td className="left">
                            <span className="tree-label">
                              {category.activities.length ? (
                                <button
                                  type="button"
                                  className="icon-btn fold-btn"
                                  title={categoryOpen ? "Ocultar atividades" : "Ver atividades"}
                                  onClick={() => setOpenCategories((current) => toggleKey(current, category.key))}
                                >
                                  {categoryOpen ? "▾" : "▸"}
                                </button>
                              ) : (
                                <span className="tree-spacer" />
                              )}
                              {category.label}
                            </span>
                          </td>
                          {category.months.map((value, i) => (
                            <td key={i}>{value ? formatNum(value) : ""}</td>
                          ))}
                          <td>{formatBRL(category.total)}</td>
                        </tr>
                        {categoryOpen
                          ? category.activities.map((activity) => (
                              <tr key={activity.key} className="tree-activity">
                                <td className="left">
                                  <span className="tree-label">
                                    <span className="tree-spacer" />
                                    {activity.label}
                                  </span>
                                </td>
                                {activity.months.map((value, i) => (
                                  <td key={i}>{value ? formatNum(value) : ""}</td>
                                ))}
                                <td>{formatBRL(activity.total)}</td>
                              </tr>
                            ))
                          : null}
                      </Fragment>
                    );
                  })}
                </>
              ) : (
                rows.map((row) => (
                  <tr key={row.key} className={view === "costCenter" ? "tree-center" : undefined}>
                    <td className="left">
                      {view === "costCenter" && row.sheetId != null ? (
                        <button type="button" className="linkish" onClick={() => go(costPlanningSheet(row.sheetId!))}>
                          {row.label}
                        </button>
                      ) : (
                        row.label
                      )}
                    </td>
                    {row.months.map((value, i) => (
                      <td key={i}>{value ? formatNum(value) : ""}</td>
                    ))}
                    <td>{formatBRL(row.total)}</td>
                  </tr>
                ))
              )}
              {!rows.length && view !== "detail" && view !== "activity" ? (
                <tr>
                  <td className="left" colSpan={colCount}>
                    Nenhum valor neste agrupamento.
                  </td>
                </tr>
              ) : null}
              <tr className="total-geral">
                <td>Total geral</td>
                {view === "detail" ? <EmptyMetrics /> : null}
                {(filtered.totals ?? []).map((value, i) => (
                  <td key={i}>{value ? formatNum(value) : ""}</td>
                ))}
                <td>{formatBRL(filtered.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </PageShell>
  );
}
