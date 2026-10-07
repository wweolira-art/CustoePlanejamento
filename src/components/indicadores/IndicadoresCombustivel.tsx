import { useCallback, useMemo, useRef, useState } from "react";
import { ConsultaProgressBar } from "../ConsultaProgressBar";
import {
  api,
  type IndicadoresCombustivelData,
  type IndicadoresCombustivelLinha,
  type IndicadoresCombustivelModelo,
} from "../../api";
import {
  colunasAbastecimentos,
  colunasAbastecimentosPorModelo,
  formatConsultaValue,
} from "../../lib/consultaRateioColumns";
import { formatBRL } from "../../lib/format";
import { useApp } from "../../store";
import { safraDefaultRange } from "../colheita/colheita-utils";
import { DataTable } from "../custo/DataTable";
import { PrintButton } from "../PrintButton";
import {
  buildDashboardFromLinhas,
  CombustivelVeiculosDashboard,
} from "./CombustivelVeiculosDashboard";

function localToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function safraReportRange(code?: string) {
  const match = code?.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return safraDefaultRange(code);
  const y1 = Number(match[1]) >= 90 ? 1900 + Number(match[1]) : 2000 + Number(match[1]);
  const y2 = Number(match[2]) >= 90 ? 1900 + Number(match[2]) : 2000 + Number(match[2]);
  const from = `${y1}-09-01`;
  const to = `${y2}-08-31`;
  const today = localToday();
  return { from, to: today < to ? today : to };
}

function round3(n: number) {
  return Math.round(Number(n) * 1000) / 1000;
}

function money2(n: number) {
  return Math.round(Number(n) * 100) / 100;
}

function monthKey(iso: string | null | undefined) {
  if (!iso || iso.length < 7) return null;
  return iso.slice(0, 7);
}

const MESES_LABEL: Record<string, string> = {
  "01": "Jan",
  "02": "Fev",
  "03": "Mar",
  "04": "Abr",
  "05": "Mai",
  "06": "Jun",
  "07": "Jul",
  "08": "Ago",
  "09": "Set",
  "10": "Out",
  "11": "Nov",
  "12": "Dez",
};

function labelMes(key: string) {
  const [y, m] = key.split("-");
  return `${MESES_LABEL[m] || m}/${y}`;
}

function agregaPorModelo(dados: IndicadoresCombustivelLinha[]): IndicadoresCombustivelModelo[] {
  const map = new Map<
    string,
    {
      codModelo: number | null;
      modeloEquipamento: string;
      tipoEquipamento: string | null;
      qtdeLitros: number;
      horasApontamento: number;
      kmhsRodados: number;
      areaHa: number;
      valorTotal: number;
      qtdAbastecimentos: number;
      equipamentos: Set<string>;
    }
  >();

  for (const row of dados) {
    const key = row.codModelo != null ? `m:${row.codModelo}` : `nome:${row.modeloEquipamento}`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        codModelo: row.codModelo,
        modeloEquipamento: row.modeloEquipamento,
        tipoEquipamento: row.tipoEquipamento,
        qtdeLitros: 0,
        horasApontamento: 0,
        kmhsRodados: 0,
        areaHa: 0,
        valorTotal: 0,
        qtdAbastecimentos: 0,
        equipamentos: new Set(),
      };
      map.set(key, bucket);
    }
    bucket.qtdeLitros += row.qtdeLitros;
    bucket.horasApontamento += row.horasApontamento;
    bucket.kmhsRodados += row.kmhsRodados;
    bucket.areaHa += row.areaHa;
    bucket.valorTotal += row.valorTotal;
    bucket.qtdAbastecimentos += 1;
    if (row.tipoEquipamento && !bucket.tipoEquipamento) bucket.tipoEquipamento = row.tipoEquipamento;
    if (row.codEquipamento != null) bucket.equipamentos.add(String(row.codEquipamento));
  }

  return [...map.values()]
    .map((bucket) => {
      const horas = bucket.horasApontamento > 0 ? bucket.horasApontamento : bucket.kmhsRodados;
      return {
        codModelo: bucket.codModelo,
        modeloEquipamento: bucket.modeloEquipamento,
        tipoEquipamento: bucket.tipoEquipamento,
        qtdEquipamentos: bucket.equipamentos.size,
        qtdAbastecimentos: bucket.qtdAbastecimentos,
        qtdeLitros: round3(bucket.qtdeLitros),
        horasApontamento: round3(bucket.horasApontamento),
        kmhsRodados: round3(bucket.kmhsRodados),
        areaHa: round3(bucket.areaHa),
        valorTotal: money2(bucket.valorTotal),
        litrosPorHora: horas > 0 ? round3(bucket.qtdeLitros / horas) : null,
        litrosPorHa: bucket.areaHa > 0 ? round3(bucket.qtdeLitros / bucket.areaHa) : null,
      };
    })
    .sort((a, b) => a.modeloEquipamento.localeCompare(b.modeloEquipamento, "pt-BR"));
}

type OperacaoBloco = {
  codOperacaoAgricola: number | null;
  descricaoOperacao: string | null;
  label: string;
  qtdeLitros: number;
  horasApontamento: number;
  areaHa: number;
  valorTotal: number;
  litrosPorHora: number | null;
  litrosPorHa: number | null;
  qtdAbastecimentos: number;
  modelos: IndicadoresCombustivelModelo[];
};

function agregaPorOperacao(dados: IndicadoresCombustivelLinha[]): OperacaoBloco[] {
  const byOp = new Map<string, IndicadoresCombustivelLinha[]>();
  for (const row of dados) {
    const key =
      row.codOperacaoAgricola != null
        ? `op:${row.codOperacaoAgricola}`
        : `nome:${row.descricaoOperacao || "Sem operação"}`;
    const list = byOp.get(key) || [];
    list.push(row);
    byOp.set(key, list);
  }

  return [...byOp.entries()]
    .map(([, rows]) => {
      const first = rows[0];
      const modelos = agregaPorModelo(rows);
      const litros = rows.reduce((acc, r) => acc + r.qtdeLitros, 0);
      const horas = rows.reduce((acc, r) => acc + r.horasApontamento, 0);
      const kmhs = rows.reduce((acc, r) => acc + r.kmhsRodados, 0);
      const area = rows.reduce((acc, r) => acc + r.areaHa, 0);
      const valor = rows.reduce((acc, r) => acc + r.valorTotal, 0);
      const horasBase = horas > 0 ? horas : kmhs;
      return {
        codOperacaoAgricola: first.codOperacaoAgricola,
        descricaoOperacao: first.descricaoOperacao ?? null,
        label:
          first.descricaoOperacao?.trim() ||
          (first.codOperacaoAgricola != null
            ? `Operação ${first.codOperacaoAgricola}`
            : "Sem operação"),
        qtdeLitros: round3(litros),
        horasApontamento: round3(horas),
        areaHa: round3(area),
        valorTotal: money2(valor),
        litrosPorHora: horasBase > 0 ? round3(litros / horasBase) : null,
        litrosPorHa: area > 0 ? round3(litros / area) : null,
        qtdAbastecimentos: rows.length,
        modelos,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

function buildResumo(dados: IndicadoresCombustivelLinha[], qtdModelos: number) {
  const auto = dados.filter((r) => r.origem === "automotivo");
  const posto = dados.filter((r) => r.origem === "posto");
  const comLh = dados.filter((r) => r.litrosPorHora != null && r.litrosPorHora > 0);
  const comLha = dados.filter((r) => r.litrosPorHa != null && r.litrosPorHa > 0);
  const totalLitros = round3(dados.reduce((acc, r) => acc + r.qtdeLitros, 0));
  const totalValor = money2(dados.reduce((acc, r) => acc + r.valorTotal, 0));
  return {
    totalLinhas: dados.length,
    totalLitros,
    totalLitrosAutomotivo: round3(auto.reduce((acc, r) => acc + r.qtdeLitros, 0)),
    totalLitrosPosto: round3(posto.reduce((acc, r) => acc + r.qtdeLitros, 0)),
    totalHoras: round3(dados.reduce((acc, r) => acc + r.horasApontamento, 0)),
    totalAreaHa: round3(dados.reduce((acc, r) => acc + r.areaHa, 0)),
    totalValor,
    totalValorAutomotivo: money2(auto.reduce((acc, r) => acc + r.valorTotal, 0)),
    totalValorPosto: money2(posto.reduce((acc, r) => acc + r.valorTotal, 0)),
    totalValorBase: totalValor,
    qtdModelos,
    mediaLitrosPorHora: comLh.length
      ? round3(comLh.reduce((acc, r) => acc + (r.litrosPorHora || 0), 0) / comLh.length)
      : null,
    mediaLitrosPorHa: comLha.length
      ? round3(comLha.reduce((acc, r) => acc + (r.litrosPorHa || 0), 0) / comLha.length)
      : null,
  };
}

export function IndicadoresCombustivel() {
  const { safra, safras, selectSafra } = useApp();
  const initial = safraReportRange(safra?.code);
  const [dataInicio, setDataInicio] = useState(initial.from);
  const [dataFim, setDataFim] = useState(initial.to);
  const [mes, setMes] = useState("");
  const [codEquipamento, setCodEquipamento] = useState("");
  const [codTipoEquipamento, setCodTipoEquipamento] = useState("");
  const [codOperacaoAgricola, setCodOperacaoAgricola] = useState("");
  const [safraSelecionada, setSafraSelecionada] = useState(String(safra?.id ?? ""));
  const [filtrosAplicados, setFiltrosAplicados] = useState({
    mes: "",
    codEquipamento: "",
    codTipoEquipamento: "",
    codOperacaoAgricola: "",
  });
  const [data, setData] = useState<IndicadoresCombustivelData | null>(null);
  const [vista, setVista] = useState<"dashboard" | "modelo" | "operacao" | "detalhe">("dashboard");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async (inicio: string, fim: string, preserveFilters = false) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setErr(null);
    try {
      const result = await api.indicadoresCombustivel({
        dataInicio: inicio,
        dataFim: fim,
      });
      if (seq !== requestSeq.current) return;
      setData(result);
      if (!preserveFilters) {
        setMes("");
        setCodEquipamento("");
        setCodTipoEquipamento("");
        setCodOperacaoAgricola("");
        setFiltrosAplicados({
          mes: "",
          codEquipamento: "",
          codTipoEquipamento: "",
          codOperacaoAgricola: "",
        });
        setVista("dashboard");
      }
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setData(null);
      setErr(e instanceof Error ? e.message : "Não foi possível carregar o combustível.");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  const mesOpcoes = useMemo(() => {
    if (!data?.dados.length) return [];
    const set = new Set<string>();
    for (const row of data.dados) {
      const key = monthKey(row.dataAbastecimento);
      if (key) set.add(key);
    }
    return [...set].sort().reverse();
  }, [data]);

  const tipoOpcoes = useMemo(() => {
    if (!data?.dados.length) return [];
    const map = new Map<string, string>();
    for (const row of data.dados) {
      if (row.codTipoEquipamento == null) continue;
      const key = String(row.codTipoEquipamento);
      if (!map.has(key)) {
        map.set(key, row.tipoEquipamento?.trim() || `Tipo ${row.codTipoEquipamento}`);
      }
    }
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [data]);

  const equipamentoOpcoes = useMemo(() => {
    if (!data?.dados.length) return [];
    const map = new Map<string, string>();
    for (const row of data.dados) {
      if (row.codEquipamento == null) continue;
      if (codTipoEquipamento && String(row.codTipoEquipamento ?? "") !== codTipoEquipamento) continue;
      if (codOperacaoAgricola && String(row.codOperacaoAgricola ?? "") !== codOperacaoAgricola) continue;
      const key = String(row.codEquipamento);
      if (!map.has(key)) {
        const desc = row.equipamentoDescricao?.trim() || row.modeloEquipamento;
        map.set(key, `${row.codEquipamento} — ${desc}`);
      }
    }
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [data, codTipoEquipamento, codOperacaoAgricola]);

  const operacaoOpcoes = useMemo(() => {
    if (!data?.dados.length) return [];
    const map = new Map<string, string>();
    for (const row of data.dados) {
      if (row.codOperacaoAgricola == null) continue;
      if (codTipoEquipamento && String(row.codTipoEquipamento ?? "") !== codTipoEquipamento) continue;
      if (codEquipamento && String(row.codEquipamento ?? "") !== codEquipamento) continue;
      const key = String(row.codOperacaoAgricola);
      if (!map.has(key)) {
        map.set(key, row.descricaoOperacao?.trim() || `Operação ${row.codOperacaoAgricola}`);
      }
    }
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [data, codTipoEquipamento, codEquipamento]);

  const view = useMemo(() => {
    if (!data) return null;
    let dados = data.dados;
    if (filtrosAplicados.mes) {
      dados = dados.filter((row) => monthKey(row.dataAbastecimento) === filtrosAplicados.mes);
    }
    if (filtrosAplicados.codTipoEquipamento) {
      dados = dados.filter((row) => String(row.codTipoEquipamento ?? "") === filtrosAplicados.codTipoEquipamento);
    }
    if (filtrosAplicados.codEquipamento) {
      dados = dados.filter((row) => String(row.codEquipamento ?? "") === filtrosAplicados.codEquipamento);
    }
    if (filtrosAplicados.codOperacaoAgricola) {
      dados = dados.filter((row) => String(row.codOperacaoAgricola ?? "") === filtrosAplicados.codOperacaoAgricola);
    }
    const porModelo = agregaPorModelo(dados);
    const porOperacao = agregaPorOperacao(dados);
    const dashboard = buildDashboardFromLinhas(dados);
    return {
      ...data,
      dados,
      porModelo,
      porOperacao,
      dashboard,
      resumo: buildResumo(dados, porModelo.length),
    };
  }, [data, filtrosAplicados]);

  const resumo = view?.resumo;

  const consultar = useCallback(() => {
    const safraId = Number(safraSelecionada);
    if (Number.isFinite(safraId) && safraId > 0 && safraId !== safra?.id) {
      void selectSafra(safraId);
    }
    setFiltrosAplicados({
      mes,
      codEquipamento,
      codTipoEquipamento,
      codOperacaoAgricola,
    });
    void load(dataInicio, dataFim, true);
  }, [
    codEquipamento,
    codOperacaoAgricola,
    codTipoEquipamento,
    dataFim,
    dataInicio,
    load,
    mes,
    safra?.id,
    safraSelecionada,
    selectSafra,
  ]);

  const dashFilters = (
    <>
      <label>
        Safra
        <select
          value={safraSelecionada}
          onChange={(e) => {
            setSafraSelecionada(e.target.value);
            const selected = safras.find((s) => String(s.id) === e.target.value);
            if (selected) {
              const range = safraReportRange(selected.code);
              setDataInicio(range.from);
              setDataFim(range.to);
            }
          }}
        >
          {safras.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label || s.code}
            </option>
          ))}
        </select>
      </label>
      <label>
        Mês
        <select value={mes} onChange={(e) => setMes(e.target.value)} disabled={!data}>
          <option value="">Todos</option>
          {mesOpcoes.map((key) => (
            <option key={key} value={key}>
              {labelMes(key)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Equipamento
        <select
          value={codEquipamento}
          onChange={(e) => setCodEquipamento(e.target.value)}
          disabled={!data}
        >
          <option value="">Todos</option>
          {equipamentoOpcoes.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Operação
        <select
          value={codOperacaoAgricola}
          onChange={(e) => setCodOperacaoAgricola(e.target.value)}
          disabled={!data}
        >
          <option value="">Todas</option>
          {operacaoOpcoes.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tipo equipamento
        <select
          value={codTipoEquipamento}
          onChange={(e) => {
            setCodTipoEquipamento(e.target.value);
            setCodEquipamento("");
            setCodOperacaoAgricola("");
          }}
          disabled={!data}
        >
          <option value="">Todos</option>
          {tipoOpcoes.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );

  return (
    <div className="indicadores-combustivel-page">
      <section className="panel">
        <h3>
          Combustível
          <span className="panel-h3-actions">
            <PrintButton />
          </span>
        </h3>

        <form
          className="form-grid no-print"
          style={{ padding: "8px 0 12px", maxWidth: 980 }}
          onSubmit={(e) => {
            e.preventDefault();
            consultar();
          }}
        >
          <label>
            Data início
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          </label>
          <label>
            Data fim
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </label>
          <label style={{ alignSelf: "end" }}>
            <button type="submit" className="btn primary" disabled={loading}>
              {loading ? "Consultando…" : "Consultar"}
            </button>
          </label>
        </form>

        {err ? (
          <p className="lead" style={{ color: "var(--danger, #c0392b)" }}>
            {err}
          </p>
        ) : null}
        <ConsultaProgressBar
          active={loading}
          label="Consultando consumo de combustível…"
          className="consulta-progress--compact"
        />

        {view ? (
          <>
            <div className="combustivel-view-tabs no-print" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={`btn ${vista === "dashboard" ? "primary" : ""}`}
                onClick={() => setVista("dashboard")}
              >
                Dashboard
              </button>
              <button
                type="button"
                className={`btn ${vista === "modelo" ? "primary" : ""}`}
                onClick={() => setVista("modelo")}
              >
                Por modelos ({view.porModelo.length})
              </button>
              <button
                type="button"
                className={`btn ${vista === "operacao" ? "primary" : ""}`}
                onClick={() => setVista("operacao")}
              >
                Por operação ({view.porOperacao.length})
              </button>
              <button
                type="button"
                className={`btn ${vista === "detalhe" ? "primary" : ""}`}
                onClick={() => setVista("detalhe")}
              >
                Detalhes ({view.dados.length})
              </button>
            </div>

            {vista === "dashboard" && view.dashboard ? (
              <CombustivelVeiculosDashboard
                dashboard={view.dashboard}
                codTipoEquipamento={codTipoEquipamento}
                filtersSlot={dashFilters}
              />
            ) : null}

            {vista !== "dashboard" && resumo ? (
              <div className="kpis" style={{ margin: "16px 0 12px" }}>
                <article className="kpi">
                  <span>Modelos</span>
                  <strong>{resumo.qtdModelos}</strong>
                </article>
                <article className="kpi">
                  <span>Litros</span>
                  <strong>{formatConsultaValue(resumo.totalLitros, "hours")}</strong>
                </article>
                <article className="kpi">
                  <span>Litros automotivo</span>
                  <strong>{formatConsultaValue(resumo.totalLitrosAutomotivo ?? 0, "hours")}</strong>
                </article>
                <article className="kpi">
                  <span>Litros posto</span>
                  <strong>{formatConsultaValue(resumo.totalLitrosPosto ?? 0, "hours")}</strong>
                </article>
                <article className="kpi">
                  <span>Horas</span>
                  <strong>{formatConsultaValue(resumo.totalHoras, "hours")}</strong>
                </article>
                <article className="kpi">
                  <span>Área (ha)</span>
                  <strong>{formatConsultaValue(resumo.totalAreaHa, "hours")}</strong>
                </article>
                <article className="kpi">
                  <span>Média L/h</span>
                  <strong>{formatConsultaValue(resumo.mediaLitrosPorHora, "hours")}</strong>
                </article>
                <article className="kpi">
                  <span>Média L/ha</span>
                  <strong>{formatConsultaValue(resumo.mediaLitrosPorHa, "hours")}</strong>
                </article>
                <article className="kpi">
                  <span>Custo total</span>
                  <strong>{formatBRL(resumo.totalValor)}</strong>
                </article>
              </div>
            ) : null}

            {loading ? (
              <p className="lead no-print" style={{ marginBottom: 8 }}>
                Atualizando…
              </p>
            ) : null}

            {vista === "dashboard" ? null : vista === "modelo" ? (
              <DataTable
                columns={colunasAbastecimentosPorModelo}
                rows={view.porModelo as unknown as Record<string, unknown>[]}
                emptyMessage="Nenhum modelo com abastecimento no período."
              />
            ) : vista === "operacao" ? (
              view.porOperacao.length ? (
                <div className="combustivel-por-operacao">
                  {view.porOperacao.map((bloco) => (
                    <div key={bloco.label} className="combustivel-operacao-bloco" style={{ marginBottom: 24 }}>
                      <h4 style={{ margin: "0 0 8px" }}>{bloco.label}</h4>
                      <DataTable
                        columns={colunasAbastecimentosPorModelo}
                        rows={bloco.modelos as unknown as Record<string, unknown>[]}
                        emptyMessage="Nenhum modelo nesta operação."
                        footerRow={{
                          modeloEquipamento: "Subtotal",
                          codModelo: null,
                          tipoEquipamento: null,
                          qtdEquipamentos: bloco.modelos.reduce((acc, m) => acc + m.qtdEquipamentos, 0),
                          qtdAbastecimentos: bloco.qtdAbastecimentos,
                          qtdeLitros: bloco.qtdeLitros,
                          horasApontamento: bloco.horasApontamento,
                          areaHa: bloco.areaHa,
                          litrosPorHora: bloco.litrosPorHora,
                          litrosPorHa: bloco.litrosPorHa,
                          valorTotal: bloco.valorTotal,
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="lead">Nenhuma operação com abastecimento no período.</p>
              )
            ) : (
              <DataTable
                columns={colunasAbastecimentos}
                rows={view.dados as unknown as Record<string, unknown>[]}
                emptyMessage="Nenhum abastecimento no período."
              />
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
