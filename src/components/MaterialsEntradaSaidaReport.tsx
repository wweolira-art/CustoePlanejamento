import { useReportAutoRefresh } from "./indicadores/useReportAutoRefresh";
import { useMemo, useState } from "react";
import { api, type MaterialEntradaSaidaItem, type MaterialEntradaSaidaRelatorio } from "../api";
import { ConsultaProgressBar } from "./ConsultaProgressBar";
import { PrintButton } from "./PrintButton";

const TIPOS = [
  "Combustível",
  "Lubrificante",
  "Pneu",
  "Servico",
  "Filtro",
  "Graxa",
  "Aditivo",
  "Peças e Acessórios",
];

type Agrupar = "grupo" | "objeto";

type Linha = {
  key: string;
  col1: string;
  col2: string;
  qtdeEntrada: number;
  qtdeSaida: number;
  valorEntrada: number;
  valorSaida: number;
  saldo: number;
  pctSaida: number | null;
  materiais: MaterialEntradaSaidaItem[];
};

function defaultRange() {
  const now = new Date();
  const from = new Date(now.getFullYear() - 4, 0, 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { from: iso(from), to: iso(now) };
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function fmtMoney(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function fmtQty(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(n);
}

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(n)}%`;
}

function pctSaida(entrada: number, saida: number) {
  if (!(entrada > 0)) return null;
  return Math.round((saida / entrada) * 1000) / 10;
}

function mergeItem(prev: MaterialEntradaSaidaItem, add: MaterialEntradaSaidaItem): MaterialEntradaSaidaItem {
  const qtdeEntrada = prev.qtdeEntrada + add.qtdeEntrada;
  const qtdeSaida = prev.qtdeSaida + add.qtdeSaida;
  const valorEntrada = prev.valorEntrada + add.valorEntrada;
  const valorSaida = prev.valorSaida + add.valorSaida;
  return {
    ...prev,
    qtdeEntrada,
    qtdeSaida,
    valorEntrada,
    valorSaida,
    diferenca: valorEntrada - valorSaida,
  };
}

function agruparItens(itens: MaterialEntradaSaidaItem[], agrupar: Agrupar): Linha[] {
  const grupos = new Map<string, { linha: Omit<Linha, "materiais" | "saldo" | "pctSaida">; mats: Map<string, MaterialEntradaSaidaItem> }>();
  for (const item of itens) {
    const key =
      agrupar === "objeto"
        ? `obj-${item.codObjetoCusto ?? 0}-${item.objetoCusto}`
        : `grp-${item.tipo}-${item.codFamilia ?? 0}-${item.codGrupoMaterial ?? 0}-${item.grupo}`;
    const prev =
      grupos.get(key) ??
      {
        linha: {
          key,
          col1: agrupar === "objeto" ? String(item.codObjetoCusto ?? "—") : item.tipo,
          col2: agrupar === "objeto" ? item.objetoCusto : item.grupo,
          qtdeEntrada: 0,
          qtdeSaida: 0,
          valorEntrada: 0,
          valorSaida: 0,
        },
        mats: new Map<string, MaterialEntradaSaidaItem>(),
      };
    prev.linha.qtdeEntrada += item.qtdeEntrada;
    prev.linha.qtdeSaida += item.qtdeSaida;
    prev.linha.valorEntrada += item.valorEntrada;
    prev.linha.valorSaida += item.valorSaida;
    const matKey = agrupar === "objeto" ? `${item.codigo}|${item.grupo}|${item.descricao}` : `${item.codigo}|${item.descricao}`;
    const existing = prev.mats.get(matKey);
    prev.mats.set(matKey, existing ? mergeItem(existing, item) : item);
    grupos.set(key, prev);
  }

  const linhas = [...grupos.values()].map(({ linha, mats }) => {
    const materiais = [...mats.values()].sort((a, b) => {
      const grupo = a.grupo.localeCompare(b.grupo, "pt-BR");
      if (agrupar === "objeto" && grupo) return grupo;
      return a.descricao.localeCompare(b.descricao, "pt-BR");
    });
    return {
      ...linha,
      saldo: linha.valorEntrada - linha.valorSaida,
      pctSaida: pctSaida(linha.valorEntrada, linha.valorSaida),
      materiais,
    };
  });

  linhas.sort((a, b) => {
    if (agrupar === "objeto") {
      const na = Number(a.col1);
      const nb = Number(b.col1);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    }
    const c1 = a.col1.localeCompare(b.col1, "pt-BR");
    if (c1) return c1;
    return a.col2.localeCompare(b.col2, "pt-BR");
  });
  return linhas;
}

export function MaterialsEntradaSaidaReport() {
  const defaults = useMemo(() => defaultRange(), []);
  const [dataInicio, setDataInicio] = useState(defaults.from);
  const [dataFim, setDataFim] = useState(defaults.to);
  const [tipos, setTipos] = useState<string[]>([]);
  const [agrupar, setAgrupar] = useState<Agrupar>("grupo");
  const [mostrarMateriais, setMostrarMateriais] = useState(true);
  const [data, setData] = useState<MaterialEntradaSaidaRelatorio | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleTipo(name: string) {
    setTipos((current) => (current.includes(name) ? current.filter((item) => item !== name) : [...current, name]));
  }

  function toggleGroup(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function mudarAgrupar(next: Agrupar) {
    setAgrupar(next);
    setCollapsed(new Set());
  }

  useReportAutoRefresh(() => { if (!loading) return consultar(true); });

  async function consultar(preserveGroups = false) {
    try {
      setLoading(true);
      setErr(null);
      const result = await api.materialsEntradaSaida({
        dataInicio,
        dataFim,
        tipos,
      });
      setData(result);
      if (!preserveGroups) setCollapsed(new Set());
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : "Não foi possível montar o relatório.");
    } finally {
      setLoading(false);
    }
  }

  const linhas = useMemo(() => agruparItens(data?.itens ?? [], agrupar), [data, agrupar]);
  const tiposLabel = tipos.length ? tipos.join(", ") : "Todos";
  const hasRows = Boolean(linhas.length);
  const agruparLabel = agrupar === "objeto" ? "objeto de custo" : "grupo de material";

  return (
    <section className="panel mat-es-report print-report-intro">
      <h3>
        Entrada × saída por {agruparLabel}
        {hasRows ? (
          <span className="panel-h3-actions">
            <PrintButton />
          </span>
        ) : null}
      </h3>
      <header className="mat-es-print-header">
        <img src="/elejota-agro-logo.png" alt="Elejota Agro" className="liberacao-colheita-logo" />
        <h2 className="liberacao-colheita-title">ENTRADA × SAÍDA POR {agruparLabel.toUpperCase()}</h2>
        <div className="liberacao-colheita-brand-right">GRUPO LUIZ JATOBÁ</div>
      </header>
      <p className="print-only-meta">
        Período: {fmtDate(data?.filtros.dataInicio ?? dataInicio)} a {fmtDate(data?.filtros.dataFim ?? dataFim)} — Tipos:{" "}
        {data?.filtros.tipos.length ? data.filtros.tipos.join(", ") : tiposLabel} — Agrupado por {agruparLabel}
        {mostrarMateriais ? "" : " — sem materiais"}
      </p>
      <div className="form-grid no-print">
        <label>
          Data inicial
          <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
        </label>
        <label>
          Data final
          <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
        </label>
      </div>
      <div className="kind-toggle no-print" style={{ paddingTop: 0 }}>
        <span className="toggle-caption">Tipos:</span>
        <button
          type="button"
          className={`btn${!tipos.length ? " primary" : ""}`}
          onClick={() => setTipos([])}
        >
          Todos
        </button>
        {TIPOS.map((name) => (
          <button
            key={name}
            type="button"
            className={`btn${tipos.includes(name) ? " primary" : ""}`}
            onClick={() => toggleTipo(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="kind-toggle no-print" style={{ paddingTop: 0 }}>
        <span className="toggle-caption">Agrupar:</span>
        <button type="button" className={`btn${agrupar === "grupo" ? " primary" : ""}`} onClick={() => mudarAgrupar("grupo")}>
          Grupo de material
        </button>
        <button type="button" className={`btn${agrupar === "objeto" ? " primary" : ""}`} onClick={() => mudarAgrupar("objeto")}>
          Objeto de custo
        </button>
      </div>
      <div className="kind-toggle no-print" style={{ paddingTop: 0 }}>
        <span className="toggle-caption">Materiais:</span>
        <button
          type="button"
          className={`btn${mostrarMateriais ? " primary" : ""}`}
          onClick={() => setMostrarMateriais(true)}
        >
          Mostrar
        </button>
        <button
          type="button"
          className={`btn${!mostrarMateriais ? " primary" : ""}`}
          onClick={() => setMostrarMateriais(false)}
        >
          Ocultar
        </button>
      </div>
      <p className="lead no-print" style={{ paddingTop: 0 }}>
        {tipos.length ? `${tipos.length} tipo(s) selecionado(s).` : "Nenhum tipo marcado: consulta todos."}
      </p>
      <div className="modal-actions no-print" style={{ padding: "0 16px 16px" }}>
        <button className="btn primary" disabled={loading} onClick={() => void consultar()}>
          {loading ? "Consultando…" : "Consultar relatório"}
        </button>
      </div>
      <ConsultaProgressBar active={loading} label="Consultando entrada e saída de materiais…" className="consulta-progress--compact" />
      {err ? (
        <p className="lead no-print" style={{ color: "var(--danger)" }}>
          {err}
        </p>
      ) : null}

      {data ? (
        <>
          <div className="kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", margin: "0 16px 16px" }}>
            <div className="kpi">
              <span>Valor entrada</span>
              <strong>{fmtMoney(data.totais.valorEntrada)}</strong>
            </div>
            <div className="kpi">
              <span>Valor saída</span>
              <strong>{fmtMoney(data.totais.valorSaida)}</strong>
            </div>
            <div className="kpi">
              <span>Saldo (entrada − saída)</span>
              <strong className={data.totais.saldo < 0 ? "var-over" : data.totais.saldo > 0 ? "var-under" : ""}>
                {fmtMoney(data.totais.saldo)}
              </strong>
            </div>
          </div>
          <div className="table-wrap">
            <table className={`data mat-es${mostrarMateriais ? "" : " mat-es-hide-items"}`}>
              <thead>
                <tr>
                  <th>{agrupar === "objeto" ? "Objeto de custo" : "Tipo"}</th>
                  <th>{agrupar === "objeto" ? "Descrição / material" : "Grupo / material"}</th>
                  <th className="num">Qtde entrada</th>
                  <th className="num">Qtde saída</th>
                  <th className="num">Valor entrada</th>
                  <th className="num">Valor saída</th>
                  <th className="num">Saldo</th>
                  <th className="num">% saída</th>
                </tr>
              </thead>
              <tbody>
                {linhas.length ? (
                  linhas.flatMap((row) => {
                    const materiais = row.materiais;
                    const open = mostrarMateriais && !collapsed.has(row.key);
                    const rows = [
                      <tr key={row.key} className="mat-es-group">
                        <td className="left">{row.col1}</td>
                        <td className="left">
                          <span className="activity-name-row">
                            {mostrarMateriais && materiais.length ? (
                              <button
                                type="button"
                                className="icon-btn fold-btn no-print"
                                aria-expanded={open}
                                aria-label={open ? "Recolher materiais" : "Expandir materiais"}
                                onClick={() => toggleGroup(row.key)}
                              >
                                {open ? "▾" : "▸"}
                              </button>
                            ) : null}
                            <strong>{row.col2}</strong>
                            {materiais.length ? (
                              <span className="hidden-mats no-print">
                                {materiais.length} material{materiais.length === 1 ? "" : "is"}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="num">{fmtQty(row.qtdeEntrada)}</td>
                        <td className="num">{fmtQty(row.qtdeSaida)}</td>
                        <td className="num">{fmtMoney(row.valorEntrada)}</td>
                        <td className="num">{fmtMoney(row.valorSaida)}</td>
                        <td className={`num ${row.saldo < 0 ? "var-over" : row.saldo > 0 ? "var-under" : ""}`}>
                          {fmtMoney(row.saldo)}
                        </td>
                        <td className="num">{fmtPct(row.pctSaida)}</td>
                      </tr>,
                    ];
                    if (mostrarMateriais) {
                      for (const item of materiais) {
                        rows.push(
                          <tr
                            key={`${row.key}-${item.codigo}-${item.grupo}-${item.descricao}`}
                            className={`mat-es-item${open ? "" : " is-collapsed"}`}
                          >
                            <td className="left" />
                            <td className="left">
                              <span className="mat-es-item-name">
                                {agrupar === "objeto" ? `${item.grupo} · ` : ""}
                                {item.codigo !== "—" ? `${item.codigo} — ` : ""}
                                {item.descricao}
                              </span>
                            </td>
                            <td className="num">{fmtQty(item.qtdeEntrada)}</td>
                            <td className="num">{fmtQty(item.qtdeSaida)}</td>
                            <td className="num">{fmtMoney(item.valorEntrada)}</td>
                            <td className="num">{fmtMoney(item.valorSaida)}</td>
                            <td className={`num ${item.diferenca < 0 ? "var-over" : item.diferenca > 0 ? "var-under" : ""}`}>
                              {fmtMoney(item.diferenca)}
                            </td>
                            <td className="num">—</td>
                          </tr>,
                        );
                      }
                    }
                    return rows;
                  })
                ) : (
                  <tr>
                    <td className="left" colSpan={8}>
                      Nenhum movimento no período e tipo selecionados.
                    </td>
                  </tr>
                )}
                {linhas.length ? (
                  <tr className="indicadores-producao-total">
                    <td className="left" colSpan={2}>
                      <strong>Total</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtQty(data.totais.qtdeEntrada)}</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtQty(data.totais.qtdeSaida)}</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtMoney(data.totais.valorEntrada)}</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtMoney(data.totais.valorSaida)}</strong>
                    </td>
                    <td className={`num ${data.totais.saldo < 0 ? "var-over" : data.totais.saldo > 0 ? "var-under" : ""}`}>
                      <strong>{fmtMoney(data.totais.saldo)}</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtPct(data.totais.pctSaida)}</strong>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : !loading && !err ? (
        <p className="lead no-print">Informe o período, escolha um ou mais tipos e clique em Consultar relatório.</p>
      ) : null}
    </section>
  );
}
