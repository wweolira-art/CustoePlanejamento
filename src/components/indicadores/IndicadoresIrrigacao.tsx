import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type IndicadoresIrrigacaoData,
  type IrrigacaoDashboardData,
  type IrrigacaoDashboardSistemaId,
  type IrrigacaoEquipLinha,
} from "../../api";
import { useApp } from "../../store";
import { safraDefaultRange } from "../colheita/colheita-utils";
import { ConsultaProgressBar } from "../ConsultaProgressBar";
import { PrintButton } from "../PrintButton";
import { IrrigacaoDashboardView } from "./IrrigacaoDashboardView";
import "./irrigacao.css";

type IrrigAba = "dashboard" | "controle";

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function defaultRange() {
  const today = new Date();
  return { from: `${today.getFullYear()}-01-01`, to: localToday() };
}

function fmtNum(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { maximumFractionDigits: digits });
}

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%`;
}

function fmtHoras(h: number | null | undefined) {
  if (h == null || !Number.isFinite(h)) return "—";
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${hh}:${mm}`;
}

function fmtDate(iso: string) {
  return iso.split("-").reverse().join("/");
}

function efiTone(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "";
  if (n < 0.85) return "irrig-efi-bad";
  return "irrig-efi-good";
}

function HorizBars({
  items,
  valueKey,
  labelKey,
  className,
}: {
  items: Array<Record<string, string | number>>;
  valueKey: string;
  labelKey: string;
  className?: string;
}) {
  if (!items.length) return <p className="irrig-empty">Sem dados.</p>;
  const max = Math.max(...items.map((i) => Number(i[valueKey]) || 0), 1);
  return (
    <div className={`irrig-bars${className ? ` ${className}` : ""}`}>
      {items.map((item) => (
        <div
          key={String(item[labelKey])}
          className="irrig-bar-row"
          title={`${item[labelKey]}: ${fmtHoras(Number(item[valueKey]))}`}
        >
          <span>{item[labelKey]}</span>
          <div>
            <i style={{ width: `${(Number(item[valueKey]) / max) * 100}%` }} />
            <b>{fmtHoras(Number(item[valueKey]))}</b>
          </div>
        </div>
      ))}
    </div>
  );
}

function CampoChart({ items }: { items: IndicadoresIrrigacaoData["eficienciaPorCampo"] }) {
  if (!items.length) return <p className="irrig-empty">Sem dados por campo.</p>;
  const maxPct = Math.max(
    ...items.flatMap((row) => [(row.efiArea ?? 0) * 100, (row.efiHoras ?? 0) * 100]),
    100,
  );
  return (
    <div className="irrig-campo-chart">
      <div className="irrig-campo-legend">
        <span>
          <i className="irrig-campo-area" /> %Efi area aplicada
        </span>
        <span>
          <i className="irrig-campo-horas" /> %Efi Horas
        </span>
      </div>
      <div className="irrig-campo-cols">
        {items.map((row) => (
          <div key={row.campo} className="irrig-campo-col">
            <span className="irrig-campo-label">{row.campo}</span>
            <div className="irrig-campo-bars">
              <div className="irrig-campo-item">
                <em>{fmtPct(row.efiArea)}</em>
                <div className="irrig-campo-track">
                  <div
                    className="irrig-campo-bar irrig-campo-area"
                    style={{ height: `${Math.min(100, ((row.efiArea ?? 0) * 100) / maxPct) * 100}%` }}
                  />
                </div>
              </div>
              <div className="irrig-campo-item">
                <em>{fmtPct(row.efiHoras)}</em>
                <div className="irrig-campo-track">
                  <div
                    className="irrig-campo-bar irrig-campo-horas"
                    style={{ height: `${Math.min(100, ((row.efiHoras ?? 0) * 100) / maxPct) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function groupByTipo(rows: IrrigacaoEquipLinha[]) {
  const map = new Map<string, IrrigacaoEquipLinha[]>();
  for (const row of rows) {
    map.set(row.tipo, [...(map.get(row.tipo) ?? []), row]);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
}

function sumLinhas(rows: IrrigacaoEquipLinha[]): IrrigacaoEquipLinha {
  const areaProgramada = rows.reduce((s, r) => s + r.areaProgramada, 0);
  const areaAplicada = rows.reduce((s, r) => s + r.areaAplicada, 0);
  const hrsProgramada = rows.reduce((s, r) => s + r.hrsProgramada, 0);
  const hrsTrabalhadas = rows.reduce((s, r) => s + r.hrsTrabalhadas, 0);
  const volumeWeighted = rows.reduce((s, r) => s + (r.mmHa ?? 0) * r.areaAplicada, 0);
  return {
    tipo: "Total",
    codEquipamento: 0,
    areaProgramada,
    areaAplicada,
    hrsProgramada,
    hrsTrabalhadas,
    efiArea: areaProgramada > 0 ? areaAplicada / areaProgramada : null,
    efiHoras: hrsProgramada > 0 ? hrsTrabalhadas / hrsProgramada : null,
    mmHa: areaAplicada > 0 ? volumeWeighted / areaAplicada : null,
  };
}

export function IndicadoresIrrigacao() {
  const { safra } = useApp();
  const safraRange = useMemo(() => safraDefaultRange(safra?.code), [safra?.code]);
  const controleRange = useMemo(() => defaultRange(), []);
  const [aba, setAba] = useState<IrrigAba>("dashboard");
  const [dataInicio, setDataInicio] = useState(safraRange.from);
  const [dataFim, setDataFim] = useState(safraRange.to);
  const [codEquipamento, setCodEquipamento] = useState("");
  const [codFazenda, setCodFazenda] = useState("");
  const [campo, setCampo] = useState("");
  const [tipoEquipamento, setTipoEquipamento] = useState("");
  const [data, setData] = useState<IndicadoresIrrigacaoData | null>(null);
  const [dashData, setDashData] = useState<IrrigacaoDashboardData | null>(null);
  const [sistemas, setSistemas] = useState<IrrigacaoDashboardSistemaId[]>([
    "HIDRO_ROLL",
    "MOTOR_BOMBA",
    "PIVOT",
  ]);
  const [opcoes, setOpcoes] = useState<IndicadoresIrrigacaoData["opcoes"]>({
    equipamentos: [],
    fazendas: [],
    campos: [],
    tipos: [],
  });
  const [consultado, setConsultado] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opcoesErr, setOpcoesErr] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (aba === "dashboard") {
      setDataInicio(safraRange.from);
      setDataFim(safraRange.to);
    }
  }, [aba, safraRange.from, safraRange.to]);

  useEffect(() => {
    let cancelled = false;
    setOpcoesErr(null);
    void api
      .indicadoresIrrigacaoOpcoes()
      .then((result) => {
        if (!cancelled) setOpcoes(result);
      })
      .catch((e) => {
        if (!cancelled) {
          setOpcoesErr(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      if (aba === "dashboard") {
        const result = await api.indicadoresIrrigacaoDashboard({
          safraCode: safra?.code,
          dataInicio,
          dataFim,
          sistemas: sistemas.length ? sistemas : undefined,
        });
        setDashData(result);
        setConsultado(true);
      } else {
        const result = await api.indicadoresIrrigacao({
          dataInicio,
          dataFim,
          codEquipamento: codEquipamento || undefined,
          codFazenda: codFazenda || undefined,
          campo: campo || undefined,
          tipoEquipamento: tipoEquipamento || undefined,
        });
        setData(result);
        setOpcoes(result.opcoes);
        setConsultado(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [aba, dataInicio, dataFim, codEquipamento, codFazenda, campo, tipoEquipamento, sistemas, safra?.code]);

  const toggleSistema = useCallback(
    (id: string) => {
      setSistemas((prev) => {
        const typed = id as IrrigacaoDashboardSistemaId;
        if (prev.includes(typed)) {
          const next = prev.filter((s) => s !== typed);
          return next.length ? next : prev;
        }
        return [...prev, typed];
      });
    },
    [],
  );

  const grupos = useMemo(() => groupByTipo(data?.programadoRealizado ?? []), [data?.programadoRealizado]);
  const totalGeral = useMemo(() => sumLinhas(data?.programadoRealizado ?? []), [data?.programadoRealizado]);

  return (
    <div className="irrig-dashboard">
      <header className="irrig-header">
        <div className="irrig-header-brand">
          <img src="/elejota-agro-logo.png" alt="Elejota Agro" className="irrig-header-logo" />
          <div className="irrig-header-title">
            <h2>{aba === "dashboard" ? "Relatório de irrigação" : "Controle de irrigação"}</h2>
            <p>
              {aba === "dashboard" && safra?.code
                ? `Safra ${safra.code}`
                : `Periodo ${fmtDate(dataInicio)} A ${fmtDate(dataFim)}`}
            </p>
          </div>
        </div>
        <div className="irrig-filters no-print">
          <label>
            Periodo
            <span className="irrig-filter-period">
              <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
              <span>A</span>
              <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            </span>
          </label>
          {aba === "controle" ? (
            <>
              <label>
                Tipo
                <select
                  value={tipoEquipamento}
                  onChange={(e) => {
                    const nextTipo = e.target.value;
                    setTipoEquipamento(nextTipo);
                    if (nextTipo && codEquipamento) {
                      const eq = opcoes.equipamentos.find((item) => String(item.codEquipamento) === codEquipamento);
                      if (eq && eq.tipo !== nextTipo) setCodEquipamento("");
                    }
                  }}
                >
                  <option value="">Todos</option>
                  {(opcoes.tipos?.length
                    ? opcoes.tipos
                    : [...new Set(opcoes.equipamentos.map((eq) => eq.tipo).filter(Boolean))]
                  ).map((tipo) => (
                    <option key={tipo} value={tipo}>
                      {tipo}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Fazenda
                <select value={codFazenda} onChange={(e) => setCodFazenda(e.target.value)}>
                  <option value="">Todos</option>
                  {opcoes.fazendas.map((f) => (
                    <option key={f.codFazenda} value={String(f.codFazenda)}>
                      {f.descricao}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Equipamento
                <select value={codEquipamento} onChange={(e) => setCodEquipamento(e.target.value)}>
                  <option value="">Todos</option>
                  {opcoes.equipamentos
                    .filter((eq) => !tipoEquipamento || eq.tipo === tipoEquipamento)
                    .map((eq) => (
                      <option key={eq.codEquipamento} value={String(eq.codEquipamento)}>
                        {eq.descricao}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Campo
                <select value={campo} onChange={(e) => setCampo(e.target.value)}>
                  <option value="">Todos</option>
                  {opcoes.campos.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          <div className="irrig-header-actions">
            <button type="button" className="btn primary" onClick={() => void load()} disabled={loading}>
              {loading ? "Consultando…" : "Consultar"}
            </button>
            <PrintButton />
          </div>
        </div>
      </header>

      <div className="kind-toggle no-print irrig-abas">
        <button
          type="button"
          className={`btn${aba === "dashboard" ? " primary" : ""}`}
          onClick={() => {
            setAba("dashboard");
            setDataInicio(safraRange.from);
            setDataFim(safraRange.to);
            setConsultado(false);
            setError(null);
          }}
        >
          Dashboard
        </button>
        <button
          type="button"
          className={`btn${aba === "controle" ? " primary" : ""}`}
          onClick={() => {
            setAba("controle");
            setDataInicio(controleRange.from);
            setDataFim(controleRange.to);
            setConsultado(false);
            setError(null);
          }}
        >
          Controle
        </button>
      </div>

      {opcoesErr ? <p className="lead error">{opcoesErr}</p> : null}
      {error ? <p className="lead error">{error}</p> : null}
      <ConsultaProgressBar
        active={loading}
        label={aba === "dashboard" ? "Consultando dashboard de irrigação…" : "Consultando controle de irrigação…"}
      />

      {aba === "dashboard" ? (
        dashData ? (
          <IrrigacaoDashboardView
            data={dashData}
            sistemasSelecionados={sistemas}
            onToggleSistema={(id) => {
              toggleSistema(id);
            }}
          />
        ) : !loading && !consultado ? (
          <p className="lead">Consulte o período para ver o dashboard de irrigação.</p>
        ) : null
      ) : null}

      {aba === "controle" && data ? (
        <>
          <div className="irrig-kpis">
            <div className="irrig-kpi">
              <span>Área Programada</span>
              <strong>{fmtNum(data.kpis.areaProgramada)}</strong>
            </div>
            <div className="irrig-kpi">
              <span>Área Aplicada</span>
              <strong>{fmtNum(data.kpis.areaAplicada)}</strong>
            </div>
            <div className={`irrig-kpi ${efiTone(data.kpis.eficiencia)}`}>
              <span>Eficiência</span>
              <strong>{fmtPct(data.kpis.eficiencia)}</strong>
            </div>
            <div className="irrig-kpi">
              <span>MM/HA</span>
              <strong>{fmtNum(data.kpis.mmHa)}</strong>
            </div>
            <div className="irrig-kpi">
              <span>Volume (m3)</span>
              <strong>{fmtNum(data.kpis.volumeM3, 0)}</strong>
            </div>
          </div>

          <div className="irrig-main-grid">
            <section className="panel irrig-table-panel">
              <h3 className="irrig-panel-title">Programado x realizado/ Equipamento</h3>
              <div className="table-wrap">
                <table className="data irrig-table">
                  <thead>
                    <tr>
                      <th>TIPO</th>
                      <th className="num">Área programada</th>
                      <th className="num">Área aplicada</th>
                      <th className="num">Hrs Programada</th>
                      <th className="num">Hrs Trabalhadas</th>
                      <th className="num">%Eficiência Área &gt;85%</th>
                      <th className="num">%Eficiência Horas &gt;85%</th>
                      <th className="num">mm/ha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupos.map(([tipo, rows]) => (
                      <Fragment key={tipo}>
                        <tr className="irrig-group-row">
                          <td colSpan={8}>{tipo}</td>
                        </tr>
                        {rows.map((row) => (
                          <tr key={row.codEquipamento}>
                            <td>{row.codEquipamento}</td>
                            <td className="num">{fmtNum(row.areaProgramada)}</td>
                            <td className="num">{fmtNum(row.areaAplicada)}</td>
                            <td className="num">{fmtHoras(row.hrsProgramada)}</td>
                            <td className="num">{fmtHoras(row.hrsTrabalhadas)}</td>
                            <td className={`num ${efiTone(row.efiArea)}`}>{fmtPct(row.efiArea)}</td>
                            <td className={`num ${efiTone(row.efiHoras)}`}>{fmtPct(row.efiHoras)}</td>
                            <td className="num">{fmtNum(row.mmHa)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                    <tr className="irrig-total-row">
                      <td>Total</td>
                      <td className="num">{fmtNum(totalGeral.areaProgramada)}</td>
                      <td className="num">{fmtNum(totalGeral.areaAplicada)}</td>
                      <td className="num">{fmtHoras(totalGeral.hrsProgramada)}</td>
                      <td className="num">{fmtHoras(totalGeral.hrsTrabalhadas)}</td>
                      <td className={`num ${efiTone(totalGeral.efiArea)}`}>{fmtPct(totalGeral.efiArea)}</td>
                      <td className={`num ${efiTone(totalGeral.efiHoras)}`}>{fmtPct(totalGeral.efiHoras)}</td>
                      <td className="num">{fmtNum(totalGeral.mmHa)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <div className="irrig-side-panels">
              <section className="panel">
                <h3 className="irrig-panel-title">Motivo Parada</h3>
                <div className="irrig-panel-body">
                  <HorizBars
                    className="irrig-bars-motivo"
                    items={data.paradasPorMotivo.map((p) => ({ motivo: p.motivo, horas: p.horas }))}
                    labelKey="motivo"
                    valueKey="horas"
                  />
                  <p className="irrig-footnote">Horas Totais: {fmtHoras(data.horasParadasTotal)}</p>
                </div>
              </section>
              <section className="panel">
                <h3 className="irrig-panel-title">Tempo parada / Equipamento</h3>
                <div className="irrig-panel-body">
                  <HorizBars
                    items={data.paradasPorEquipamento.slice(0, 12).map((p) => ({
                      equipamento: String(p.codEquipamento),
                      horas: p.horas,
                    }))}
                    labelKey="equipamento"
                    valueKey="horas"
                  />
                </div>
              </section>
            </div>
          </div>

          <div className="irrig-bottom-grid">
            <section className="panel">
              <h3 className="irrig-panel-title">Eficiência de Área e Horas / Campo</h3>
              <div className="irrig-panel-body">
                <CampoChart items={data.eficienciaPorCampo} />
              </div>
            </section>
            <section className="panel">
              <h3 className="irrig-panel-title">Área aplicada por período programado</h3>
              <div className="table-wrap">
                <table className="data irrig-table">
                  <thead>
                    <tr>
                      <th>Data Inicial</th>
                      <th>Data Final</th>
                      <th className="num">Área programada</th>
                      <th className="num">Área aplicada</th>
                      <th className="num">%Eficiência</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.periodosProgramados.length ? (
                      data.periodosProgramados.map((row) => (
                        <tr key={`${row.dataInicio}-${row.dataFim}`}>
                          <td>{fmtDate(row.dataInicio)}</td>
                          <td>{fmtDate(row.dataFim)}</td>
                          <td className="num">{fmtNum(row.areaProgramada)}</td>
                          <td className="num">{fmtNum(row.areaAplicada)}</td>
                          <td className={`num ${efiTone(row.eficiencia)}`}>{fmtPct(row.eficiencia)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5}>Nenhum período programado no filtro.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      ) : null}

      {aba === "controle" && !data && !loading && !consultado ? (
        <p className="lead irrig-empty">Defina o período e os filtros, depois clique em Consultar.</p>
      ) : null}
    </div>
  );
}
