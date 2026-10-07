import { useEffect, useMemo, useState } from "react";
import { api, type Activity, type CalcRulesData, type CostObject, type DashboardData, type Material, type ValueDistribution } from "../api";
import { formatBRL } from "../lib/format";
import { useApp } from "../store";
import { ReadOnlyFieldset } from "../lib/editAccess";
import { SeedRadius } from "./SeedRadius";
import { UnRealizadoSources } from "./UnRealizadoSources";

const FALLBACK: CalcRulesData = {
  drivers: [
    { key: "plantio_verao", label: "Plantio de verão" },
    { key: "plantio_inverno", label: "Plantio de inverno" },
    { key: "plantio_total", label: "Plantio total (verão + inverno)" },
    { key: "tratos_planta", label: "Tratos de cana planta" },
    { key: "tratos_soca", label: "Tratos de cana soca" },
    { key: "moagem", label: "Moagem (t)" },
    { key: "tonsManual", label: "Colheita manual (t)" },
  ],
  rules: [],
};

const WEEKDAYS = [
  { id: 0, short: "Dom", name: "domingo" },
  { id: 1, short: "Seg", name: "segunda" },
  { id: 2, short: "Ter", name: "terça" },
  { id: 3, short: "Qua", name: "quarta" },
  { id: 4, short: "Qui", name: "quinta" },
  { id: 5, short: "Sex", name: "sexta" },
  { id: 6, short: "Sáb", name: "sábado" },
];

const SAFRA_MONTHS = ["Set", "Out", "Nov", "Dez", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago"];
const SAFRA_CALENDAR_MONTHS = [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7];

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function safraStartYear(code?: string) {
  const match = code?.match(/^(\d{2})\//);
  if (!match) return new Date().getFullYear();
  const yy = Number(match[1]);
  return yy >= 90 ? 1900 + yy : 2000 + yy;
}

function workingDaysInMonth(year: number, month0: number, exclude: number[]) {
  const skip = new Set(exclude);
  const last = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= last; day += 1) {
    const weekday = new Date(Date.UTC(year, month0, day)).getUTCDay();
    if (!skip.has(weekday)) count += 1;
  }
  return count;
}

function workingDaysBySafra(startYear: number, exclude: number[]) {
  return SAFRA_CALENDAR_MONTHS.map((month) => {
    const year = month >= 8 ? startYear : startYear + 1;
    return workingDaysInMonth(year, month, exclude);
  });
}

function exceptLabel(days: number[]) {
  if (!days.length) return "todos os dias do mês";
  const names = days.map((id) => WEEKDAYS.find((d) => d.id === id)?.name ?? String(id));
  if (names.length === 1) return `exceto ${names[0]}`;
  if (names.length === 2) return `exceto ${names[0]} e ${names[1]}`;
  return `exceto ${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

function toggleWeekday(current: number[], id: number) {
  return current.includes(id) ? current.filter((d) => d !== id) : [...current, id].sort((a, b) => a - b);
}

function areaMonthsFor(key: string, kpis: DashboardData["kpis"] | null) {
  const zeros = () => Array.from({ length: 12 }, () => 0);
  if (!kpis) return zeros();
  if (key === "plantio_verao") return kpis.months.map((m) => m.haVerao);
  if (key === "plantio_inverno") return kpis.months.map((m) => m.haInverno);
  if (key === "plantio_total") return kpis.months.map((m) => m.haVerao + m.haInverno);
  if (key === "tratos_planta") return kpis.months.map((m) => m.haPlanta);
  if (key === "tratos_soca") return kpis.months.map((m) => m.haSoca);
  if (key === "moagem") return kpis.months.map((m) => m.tons);
  if (key === "tonsManual") return kpis.months.map((m) => m.tonsManual);
  return kpis.subprocesses?.find((row) => row.key === key)?.months ?? zeros();
}

export function AutoCalc() {
  const [tab, setTab] = useState<"params" | "radius" | "unRealizado">("params");
  return (
    <div className="page">
      <ReadOnlyFieldset>
      <div className="kind-toggle" style={{ paddingBottom: 4 }}>
        <button className={`btn ${tab === "params" ? "primary" : ""}`} onClick={() => setTab("params")}>
          Parâmetros
        </button>
        <button className={`btn ${tab === "radius" ? "primary" : ""}`} onClick={() => setTab("radius")}>
          Cálculo de raio transporte de semente
        </button>
        <button
          className={`btn ${tab === "unRealizado" ? "primary" : ""}`}
          onClick={() => setTab("unRealizado")}
        >
          Un realizado (R$/un)
        </button>
      </div>
      {tab === "radius" ? <SeedRadius /> : tab === "unRealizado" ? <UnRealizadoSources /> : <AutoCalcParams />}
      </ReadOnlyFieldset>
    </div>
  );
}

function AutoCalcParams() {
  const { safraId, safra } = useApp();
  const [data, setData] = useState<CalcRulesData>(FALLBACK);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [kind, setKind] = useState<"material" | "activity">("material");
  const [mode, setMode] = useState<"area" | "days" | "hours">("area");
  const [materialId, setMaterialId] = useState(0);
  const [activityId, setActivityId] = useState(0);
  const [premise, setPremise] = useState("plantio_verao");
  const [dose, setDose] = useState("");
  const [hoursQty, setHoursQty] = useState("1");
  const [price, setPrice] = useState("");
  const [excludeWeekdays, setExcludeWeekdays] = useState<number[]>([]);
  const [followArea, setFollowArea] = useState(false);
  const [areaPremise, setAreaPremise] = useState("plantio_total");
  const [fromMaterials, setFromMaterials] = useState(false);
  const [costObjectIds, setCostObjectIds] = useState<number[]>([]);
  const [costObjects, setCostObjects] = useState<CostObject[]>([]);
  const [kpis, setKpis] = useState<DashboardData["kpis"] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rulesQuery, setRulesQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [distributions, setDistributions] = useState<ValueDistribution[]>([]);
  const [undoing, setUndoing] = useState<number | null>(null);

  const load = () =>
    api
      .calcRules(safraId)
      .then((d) => {
        setData({
          ...d,
          drivers: d.drivers?.length ? d.drivers : FALLBACK.drivers,
          rules: d.rules ?? [],
        });
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));

  useEffect(() => {
    if (!safraId) return;
    void load();
    void api.activities().then(setActivities).catch((e: Error) => setErr(e.message));
    void api.materials().then(setMaterials).catch((e: Error) => setErr(e.message));
    void api.costObjects().then(setCostObjects).catch((e: Error) => setErr(e.message));
    void api.premissas().then(setKpis).catch(() => setKpis(null));
    void api.distributions().then(setDistributions).catch(() => setDistributions([]));
  }, [safraId]);

  const drivers = data.drivers?.length ? data.drivers : FALLBACK.drivers;
  const rules = data.rules ?? [];
  const filteredRules = useMemo(() => {
    const tokens = fold(rulesQuery.trim()).split(/\s+/).filter(Boolean);
    if (!tokens.length) return rules;
    return rules.filter((rule) => {
      const premiseLabel = drivers.find((d) => d.key === rule.premise)?.label ?? rule.premise;
      const areaLabel = rule.areaPremise
        ? drivers.find((d) => d.key === rule.areaPremise)?.label ?? rule.areaPremise
        : "";
      const hay = fold(
        [
          rule.kind === "material" ? "material" : "atividade",
          rule.materialCode,
          rule.materialName,
          rule.activityCode,
          rule.activityName,
          premiseLabel,
          areaLabel,
          rule.formula,
          rule.fromMaterials ? "materiais" : "",
          rule.mode === "hours" ? "horas tonelada" : rule.mode === "days" ? "dias" : "area",
          ...(rule.costObjectCodes ?? []),
        ]
          .filter(Boolean)
          .join(" "),
      );
      return tokens.every((token) => hay.includes(token));
    });
  }, [rules, rulesQuery, drivers]);
  const material = materials.find((m) => m.id === materialId);
  const driver = drivers.find((d) => d.key === premise);
  const qty = Number((dose || (mode === "days" ? "1" : "")).replace(",", "."));
  const hoursFactor = Number((hoursQty || "1").replace(",", "."));
  const unitPrice = Number(price.replace(",", "."));
  const startYear = safraStartYear(safra?.code);
  const monthDays = useMemo(() => workingDaysBySafra(startYear, excludeWeekdays), [startYear, excludeWeekdays]);
  const areaMonths = useMemo(
    () => (mode === "days" && followArea ? areaMonthsFor(areaPremise, kpis) : null),
    [mode, followArea, areaPremise, kpis],
  );
  const tonMonths = useMemo(
    () => (mode === "hours" ? areaMonthsFor(premise, kpis) : null),
    [mode, premise, kpis],
  );
  const hourMonths = useMemo(
    () =>
      tonMonths && qty > 0 && hoursFactor > 0
        ? tonMonths.map((tons) => (tons > 0 ? (tons / qty) * hoursFactor : 0))
        : null,
    [tonMonths, qty, hoursFactor],
  );
  const sampleIndex = monthDays.findIndex((_, i) => (areaMonths ? (areaMonths[i] ?? 0) > 0 : monthDays[i] > 0));
  const sampleMonth = sampleIndex >= 0 ? monthDays[sampleIndex] : 0;
  const selectedCostCodes = costObjects
    .filter((item) => costObjectIds.includes(item.id))
    .map((item) => item.code);
  const objectsSuffix =
    kind === "activity" && selectedCostCodes.length ? ` nos objetos ${selectedCostCodes.join(", ")}` : "";

  return (
    <>
      <p className="lead">
        Os parâmetros abaixo valem para a {safra?.label ?? "safra selecionada"}. No cálculo por área o
        sistema aplica (quantidade/ha × preço) × a premissa do mês. No cálculo por dia, aplica
        (quantidade × preço) × os dias do mês. No cálculo por tonelada, você informa t/h, a quantidade e
        escolhe a premissa (moagem, colheita manual ou outra): as horas do mês são (toneladas ÷ t/h) ×
        quantidade. Essas horas entram na despesa com manutenção, multiplicadas pelo custo/hora do
        objeto. Você pode limitar
        o cálculo por dia aos meses em que um subprocesso tiver área: se o mês não tem hectare, não
        calcula. O período de preenchimento de cada atividade é escolhido no centro de custo, ao
        incluir a atividade. Atividades que recebem materiais não precisam de preço: o parâmetro só
        define a premissa ou os dias, e o valor sai dos materiais informados na atividade. Na
        atividade, você escolhe os objetos de custo que recebem a fórmula — por exemplo 108, 110 e
        94. Sem seleção, vale para todos.
      </p>

      <section className="panel">
        <h3>Distribuições de valor</h3>
        <p className="lead" style={{ margin: "0 0 8px" }}>
          Desfazer tira o valor rateado dos centros. Se a atividade foi criada só para isso, a linha
          some.
        </p>
        {distributions.length ? (
          <div className="copy-list" style={{ margin: 0 }}>
            {distributions.map((item) => (
              <div className="copy-list-item" key={item.id}>
                <span>
                  {item.activityName} · {formatBRL(item.totalValue)}
                  {item.centers.length ? ` · ${item.centers.join(", ")}` : ""}
                  {item.months.length
                    ? ` · ${item.months.map((month) => SAFRA_MONTHS[month]).filter(Boolean).join(", ")}`
                    : ""}
                </span>
                <button
                  className="btn"
                  type="button"
                  disabled={undoing != null}
                  onClick={async () => {
                    if (!confirm(`Desfazer a distribuição de “${item.activityName}”? Os valores voltam como estavam.`)) return;
                    setUndoing(item.id);
                    try {
                      setDistributions((await api.undoAnyDistribution(item.id)).distributions);
                      setErr(null);
                    } catch (e) {
                      setErr(e instanceof Error ? e.message : "Não foi possível desfazer a distribuição.");
                    } finally {
                      setUndoing(null);
                    }
                  }}
                >
                  {undoing === item.id ? "Desfazendo…" : "Desfazer"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="lead" style={{ margin: 0 }}>Nenhuma distribuição nesta safra.</p>
        )}
      </section>

      <section className="panel">
        <h3>Novo parâmetro</h3>
        <div className="kind-toggle">
          <button
            className={`btn ${kind === "material" ? "primary" : ""}`}
            onClick={() => {
              setKind("material");
              setFromMaterials(false);
              setCostObjectIds([]);
              if (mode === "hours") setMode("area");
            }}
          >
            Pelo material
          </button>
          <button className={`btn ${kind === "activity" ? "primary" : ""}`} onClick={() => setKind("activity")}>
            Pela atividade
          </button>
        </div>
        <div className="kind-toggle">
          <button className={`btn ${mode === "area" ? "primary" : ""}`} onClick={() => setMode("area")}>
            Por área (premissa)
          </button>
          <button className={`btn ${mode === "days" ? "primary" : ""}`} onClick={() => setMode("days")}>
            {fromMaterials ? "Por dia" : "Por dia × preço"}
          </button>
          {kind === "activity" ? (
            <button
              className={`btn ${mode === "hours" ? "primary" : ""}`}
              onClick={() => {
                setMode("hours");
                setFromMaterials(false);
                if (premise === "dias") setPremise("moagem");
              }}
            >
              Por tonelada (horas)
            </button>
          ) : null}
        </div>
        <div className="form-grid">
          {kind === "material" ? (
            <label>
              Material
              <FilterSelect
                value={materialId}
                onChange={(id) => {
                  setMaterialId(id);
                  const next = materials.find((m) => m.id === id);
                  if (next?.valor != null) setPrice(String(next.valor));
                }}
                placeholder="Digite MAP, Roundup..."
                options={materials.map((m) => ({
                  id: m.id,
                  label: `${m.code} — ${m.description}`,
                  search: `${m.code} ${m.description}`,
                }))}
              />
            </label>
          ) : (
            <label>
              Atividade
              <FilterSelect
                value={activityId}
                onChange={setActivityId}
                placeholder="Digite Plantio, Dessecação..."
                options={activities.map((a) => ({
                  id: a.id,
                  label: `${a.code} — ${a.description}`,
                  search: `${a.code} ${a.description}`,
                }))}
              />
            </label>
          )}
          {kind === "activity" ? (
            <label className="span-2">
              Objetos de custo
              <small>A fórmula só entra nas linhas com estes objetos. Vazio = todos.</small>
              <CostObjectMultiSelect
                costObjects={costObjects}
                value={costObjectIds}
                onChange={setCostObjectIds}
              />
            </label>
          ) : null}
          {kind === "activity" && mode !== "hours" ? (
            <label className="span-2 check-label">
              <span className="check-row">
                <input
                  type="checkbox"
                  checked={fromMaterials}
                  onChange={(e) => setFromMaterials(e.target.checked)}
                />
                Atividade recebe materiais (sem preço próprio)
              </span>
              <small>
                Não informa quantidade nem preço da atividade. O cálculo usa o preço e a quantidade de
                cada material incluído no centro de custo, na mesma premissa ou nos mesmos dias.
              </small>
            </label>
          ) : null}
          {!fromMaterials && mode !== "hours" ? (
            <>
          <label>
            {mode === "days" ? "Quantidade" : "Quantidade por ha"}
            <input
              value={dose}
              onChange={(e) => setDose(e.target.value)}
              placeholder={mode === "days" ? "Ex.: 1" : "Ex.: 1"}
            />
          </label>
          <label>
            Preço
            <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Ex.: 850" />
          </label>
            </>
          ) : null}
          {mode === "hours" ? (
            <>
            <label>
              Tonelada / hora
              <small>Capacidade da atividade. Primeiro passo: toneladas da premissa ÷ este valor.</small>
              <input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="Ex.: 60" />
            </label>
            <label>
              Quantidade
              <small>Multiplica as horas: (toneladas ÷ t/h) × quantidade.</small>
              <input value={hoursQty} onChange={(e) => setHoursQty(e.target.value)} placeholder="Ex.: 1" />
            </label>
            </>
          ) : null}
          {mode === "area" || mode === "hours" ? (
            <label>
              Premissa
              {mode === "hours" ? (
                <small>Escolha de onde vêm as toneladas, por exemplo moagem da colheita mecanizada.</small>
              ) : null}
              <select value={premise} onChange={(e) => setPremise(e.target.value)}>
                {drivers.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="span-2">
                Desconsiderar no mês
                <small>Marque os dias da semana que não entram no cálculo, por exemplo domingo.</small>
                <WeekdayPicks value={excludeWeekdays} onChange={setExcludeWeekdays} />
              </label>
              <label className="span-2 check-label">
                <span className="check-row">
                  <input
                    type="checkbox"
                    checked={followArea}
                    onChange={(e) => setFollowArea(e.target.checked)}
                  />
                  Só nos meses com área
                </span>
                <small>
                  Se o subprocesso não tiver hectare no mês, o valor fica zerado. A área não multiplica o
                  preço — só liga ou desliga o mês.
                </small>
              </label>
              {followArea ? (
                <label>
                  Subprocesso
                  <select value={areaPremise} onChange={(e) => setAreaPremise(e.target.value)}>
                    {drivers.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </>
          )}
        </div>

        <div className="formula-box">
          {mode === "hours"
            ? `horas = (${driver?.label ?? "premissa"} / ${dose ? `${dose} t/h` : "(t/h)"}) × ${hoursQty || "1"}${objectsSuffix}`
            : fromMaterials
            ? mode === "days"
              ? `materiais × dias do mês (${exceptLabel(excludeWeekdays)})${
                  followArea ? ` só nos meses com ${drivers.find((d) => d.key === areaPremise)?.label ?? "área"}` : ""
                }${objectsSuffix}`
              : `materiais × ${driver?.label ?? "premissa"}${objectsSuffix}`
            : mode === "days"
              ? `(${dose || "1"} × ${price || "preço"}) × dias do mês (${exceptLabel(excludeWeekdays)})${
                  followArea ? ` só nos meses com ${drivers.find((d) => d.key === areaPremise)?.label ?? "área"}` : ""
                }${objectsSuffix}`
              : `(${dose || "qtd/ha"} × ${price || "preço"}) × ${driver?.label ?? "premissa"}${objectsSuffix}`}
        </div>
        {mode === "hours" ? (
          <div className="days-preview">
            {SAFRA_MONTHS.map((label, i) => {
              const tons = tonMonths?.[i] ?? 0;
              const hours = hourMonths?.[i] ?? 0;
              return (
                <span key={label} className={tons > 0 ? "" : "off"}>
                  <em>{label}</em>{" "}
                  {qty > 0 && hoursFactor > 0 && tons > 0
                    ? `${tons.toLocaleString("pt-BR")} t / ${dose} × ${hoursQty || "1"} = ${hours.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} h`
                    : "sem tonelada"}
                </span>
              );
            })}
            {qty > 0 && hoursFactor > 0 && hourMonths ? (
              <strong>
                Total: {(tonMonths ?? []).reduce((sum, n) => sum + n, 0).toLocaleString("pt-BR")} t / {dose} ×{" "}
                {hoursQty || "1"} ={" "}
                {hourMonths.reduce((sum, n) => sum + n, 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} h
              </strong>
            ) : (
              <strong>Informe t/h e a quantidade para ver as horas de cada mês da premissa.</strong>
            )}
          </div>
        ) : null}
        {mode === "days" ? (
          <div className="days-preview">
            {SAFRA_MONTHS.map((label, i) => {
              const hasArea = !areaMonths || (areaMonths[i] ?? 0) > 0;
              return (
                <span key={label} className={hasArea ? "" : "off"}>
                  <em>{label}</em> {hasArea ? `${monthDays[i]} d` : "sem área"}
                </span>
              );
            })}
            {qty > 0 && unitPrice > 0 && sampleIndex >= 0 && !fromMaterials ? (
              <strong>
                {SAFRA_MONTHS[sampleIndex]}: {sampleMonth} × {dose || "1"} × {price} ={" "}
                {formatBRL(sampleMonth * qty * unitPrice)}
              </strong>
            ) : followArea ? (
              <strong>Nenhum mês com área neste subprocesso — nada será calculado.</strong>
            ) : null}
          </div>
        ) : null}
        {kind === "material" && material && !price.trim() && material.valor == null ? (
          <p className="lead" style={{ padding: "0 16px" }}>
            Informe o preço de {material.description} neste parâmetro.
          </p>
        ) : null}
        {err ? <p className="lead" style={{ padding: "0 16px", color: "var(--danger)" }}>{err}</p> : null}
        <div className="modal-actions" style={{ padding: "12px 16px 16px" }}>
          <button
            className="btn primary"
            disabled={saving}
            onClick={async () => {
              if (mode === "hours") {
                const th = Number(dose.replace(",", "."));
                const factor = Number((hoursQty || "1").replace(",", "."));
                if (!(th > 0)) {
                  setErr("Informe as toneladas por hora.");
                  return;
                }
                if (!(factor > 0)) {
                  setErr("Informe a quantidade.");
                  return;
                }
              }
              setSaving(true);
              setErr(null);
              try {
                setData(
                  await api.addCalcRule({
                    kind,
                    mode,
                    materialId: kind === "material" ? materialId || null : null,
                    activityId: kind === "activity" ? activityId || null : null,
                    premise: mode === "days" ? "dias" : premise,
                    dose: fromMaterials ? null : Number((dose || (mode === "days" ? "1" : "")).replace(",", ".")),
                    rateHa: mode === "hours" ? Number((hoursQty || "1").replace(",", ".")) : null,
                    price: fromMaterials || mode === "hours" ? null : Number(price.replace(",", ".")),
                    excludeWeekdays: mode === "days" ? excludeWeekdays : [],
                    areaPremise: mode === "days" && followArea ? areaPremise : null,
                    fromMaterials: kind === "activity" && mode !== "hours" && fromMaterials,
                    costObjectIds: kind === "activity" ? costObjectIds : [],
                    safraId,
                  }),
                );
                setDose("");
                setHoursQty("1");
                setPrice("");
                setCostObjectIds([]);
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Não foi possível salvar.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Salvando…" : "Salvar parâmetro"}
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>
          Parâmetros da {safra?.label ?? "safra"}
          <small>{rulesQuery.trim() ? `${filteredRules.length} de ${rules.length}` : rules.length}</small>
        </h3>
        {data.previousSafra ? (
          <div className="modal-actions" style={{ padding: "0 16px 12px", justifyContent: "flex-start" }}>
            <button
              className="btn"
              disabled={copying || !(data.previousRuleCount ?? 0)}
              onClick={async () => {
                const from = data.previousSafra;
                if (!from) return;
                const warn = rules.length
                  ? `Isso substitui os ${rules.length} parâmetro(s) da ${safra?.label ?? "safra atual"} pelos da ${from.label}. Continuar?`
                  : `Copiar os parâmetros da ${from.label} para a ${safra?.label ?? "safra atual"}?`;
                if (!confirm(warn)) return;
                setCopying(true);
                setErr(null);
                try {
                  setData(await api.copyCalcRulesFromPrevious(safraId));
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "Não foi possível copiar os parâmetros.");
                } finally {
                  setCopying(false);
                }
              }}
            >
              {copying ? "Copiando…" : `Copiar parâmetros da ${data.previousSafra.label}`}
            </button>
          </div>
        ) : null}
        <div className="form-grid" style={{ gridTemplateColumns: "1fr", padding: "0 16px 8px" }}>
          <label>
            Pesquisar
            <input
              value={rulesQuery}
              onChange={(e) => setRulesQuery(e.target.value)}
              placeholder="Código, descrição, premissa, objeto de custo ou fórmula"
            />
          </label>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Item</th>
              <th>Objetos</th>
              <th>Qtd</th>
              <th>Preço</th>
              <th>Base</th>
              <th>Fórmula</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filteredRules.map((rule) => {
              const hoursMode = rule.mode === "hours";
              const daysMode = !hoursMode && (rule.mode === "days" || rule.premise === "dias");
              return (
                <tr key={rule.id}>
                  <td className="left">{rule.kind === "material" ? "Material" : "Atividade"}</td>
                  <td className="left desc">
                    {rule.kind === "material"
                      ? `${rule.materialCode} — ${rule.materialName}`
                      : `${rule.activityCode} — ${rule.activityName}`}
                  </td>
                  <td className="left">
                    {rule.kind === "activity" ? (
                      <CostObjectMultiSelect
                        compact
                        costObjects={costObjects}
                        value={rule.costObjectIds ?? []}
                        onChange={async (next) => {
                          try {
                            setData(await api.updateCalcRule(rule.id, { costObjectIds: next }));
                          } catch (error) {
                            setErr(error instanceof Error ? error.message : "Não foi possível atualizar os objetos de custo.");
                          }
                        }}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {rule.fromMaterials ? (
                      "—"
                    ) : (
                    <input
                      className="cell"
                      defaultValue={rule.dose ?? ""}
                      key={`${rule.id}-dose-${rule.dose}`}
                      title={hoursMode ? "Tonelada / hora" : undefined}
                      onBlur={async (e) => {
                        const raw = e.target.value.trim();
                        const next = raw ? Number(raw.replace(",", ".")) : null;
                        if (next === rule.dose) return;
                        try {
                          setData(await api.updateCalcRule(rule.id, { dose: next }));
                        } catch (error) {
                          setErr(error instanceof Error ? error.message : "Não foi possível atualizar a quantidade.");
                        }
                      }}
                    />
                    )}
                  </td>
                  <td>
                    {rule.fromMaterials ? (
                      "Materiais"
                    ) : hoursMode ? (
                    <div className="rule-days">
                      <span>Quantidade</span>
                      <input
                        className="cell"
                        defaultValue={rule.rateHa ?? 1}
                        key={`${rule.id}-qty-${rule.rateHa}`}
                        title="Quantidade"
                        onBlur={async (e) => {
                          const raw = e.target.value.trim();
                          const next = raw ? Number(raw.replace(",", ".")) : 1;
                          if (!(next > 0)) {
                            setErr("Informe a quantidade.");
                            return;
                          }
                          if (next === (rule.rateHa ?? 1)) return;
                          try {
                            setData(await api.updateCalcRule(rule.id, { rateHa: next, mode: "hours" }));
                          } catch (error) {
                            setErr(error instanceof Error ? error.message : "Não foi possível atualizar a quantidade.");
                          }
                        }}
                      />
                    </div>
                    ) : (
                    <input
                      className="cell"
                      defaultValue={rule.price ?? ""}
                      key={`${rule.id}-price-${rule.price}-${rule.rateHa}`}
                      onBlur={async (e) => {
                        const raw = e.target.value.trim();
                        const next = raw ? Number(raw.replace(",", ".")) : null;
                        if (next === rule.price) return;
                        try {
                          setData(await api.updateCalcRule(rule.id, { price: next }));
                        } catch (error) {
                          setErr(error instanceof Error ? error.message : "Não foi possível atualizar o preço.");
                        }
                      }}
                    />
                    )}
                  </td>
                  <td className="left">
                    {daysMode ? (
                      <div className="rule-days">
                        <span>Dias do mês</span>
                        <WeekdayPicks
                          value={rule.excludeWeekdays ?? []}
                          onChange={async (next) => {
                            try {
                              setData(await api.updateCalcRule(rule.id, { excludeWeekdays: next, mode: "days" }));
                            } catch (error) {
                              setErr(error instanceof Error ? error.message : "Não foi possível atualizar os dias.");
                            }
                          }}
                        />
                        <select
                          className="cell-select"
                          value={rule.areaPremise ?? ""}
                          onChange={async (e) => {
                            const next = e.target.value || null;
                            try {
                              setData(await api.updateCalcRule(rule.id, { areaPremise: next, mode: "days" }));
                            } catch (error) {
                              setErr(error instanceof Error ? error.message : "Não foi possível atualizar o subprocesso.");
                            }
                          }}
                        >
                          <option value="">Todos os meses</option>
                          {drivers.map((d) => (
                            <option key={d.key} value={d.key}>
                              Só meses com {d.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : hoursMode ? (
                      <select
                        className="cell-select"
                        value={rule.premise}
                        onChange={async (e) => {
                          try {
                            setData(await api.updateCalcRule(rule.id, { premise: e.target.value, mode: "hours" }));
                          } catch (error) {
                            setErr(error instanceof Error ? error.message : "Não foi possível atualizar a premissa.");
                          }
                        }}
                      >
                        {drivers.map((d) => (
                          <option key={d.key} value={d.key}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      drivers.find((d) => d.key === rule.premise)?.label ?? rule.premise
                    )}
                  </td>
                  <td className="left desc">{rule.formula}</td>
                  <td>
                    <button
                      className="icon-btn"
                      title="Excluir parâmetro"
                      onClick={async () => {
                        if (!confirm("Remover este parâmetro de cálculo?")) return;
                        setData(await api.deleteCalcRule(rule.id));
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
            {!filteredRules.length ? (
              <tr>
                <td className="left" colSpan={8}>
                  {rules.length ? "Nenhum parâmetro encontrado." : "Nenhum parâmetro ainda."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </>
  );
}

function WeekdayPicks({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  return (
    <div className="weekday-picks">
      {WEEKDAYS.map((day) => {
        const on = value.includes(day.id);
        return (
          <button
            key={day.id}
            type="button"
            className={on ? "on" : ""}
            title={on ? `Voltar a contar ${day.name}` : `Desconsiderar ${day.name}`}
            onClick={() => onChange(toggleWeekday(value, day.id))}
          >
            {day.short}
          </button>
        );
      })}
    </div>
  );
}

function CostObjectMultiSelect({
  costObjects,
  value,
  onChange,
  compact,
}: {
  costObjects: CostObject[];
  value: number[];
  onChange: (next: number[]) => void;
  compact?: boolean;
}) {
  const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const [q, setQ] = useState("");
  const selected = useMemo(
    () =>
      costObjects
        .filter((item) => value.includes(item.id))
        .sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true })),
    [costObjects, value],
  );
  const filtered = useMemo(() => {
    const raw = fold(q.trim());
    const pool = costObjects.filter((item) => !value.includes(item.id));
    const matched = raw
      ? pool.filter((item) => raw.split(/\s+/).every((t) => fold(`${item.code} ${item.description}`).includes(t)))
      : pool;
    return matched.slice(0, 80);
  }, [costObjects, q, value]);

  return (
    <div className={`cost-object-multi${compact ? " compact" : ""}`}>
      {selected.length ? (
        <div className="cost-object-chips">
          {selected.map((item) => (
            <button
              key={item.id}
              type="button"
              className="cost-object-chip"
              title={item.description}
              onClick={() => onChange(value.filter((id) => id !== item.id))}
            >
              {item.code}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : (
        <span className="cost-object-all">Todos os objetos</span>
      )}
      <div className="filter-select">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar 108, 110..." />
        <select
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (!id || value.includes(id)) return;
            onChange([...value, id]);
            setQ("");
          }}
        >
          <option value="">{filtered.length ? "Adicionar objeto" : q.trim() ? "Nenhum encontrado" : "Selecione"}</option>
          {filtered.map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.description}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: number;
  onChange: (id: number) => void;
  options: { id: number; label: string; search: string }[];
  placeholder: string;
}) {
  const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const raw = fold(q.trim());
    const pool = raw
      ? options.filter((o) => raw.split(/\s+/).every((t) => fold(o.search).includes(t)))
      : options;
    return pool.slice(0, 80);
  }, [options, q]);
  const selected = options.find((o) => o.id === value);

  return (
    <div className="filter-select">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        <option value={0}>{selected ? selected.label : "Selecione"}</option>
        {filtered.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
