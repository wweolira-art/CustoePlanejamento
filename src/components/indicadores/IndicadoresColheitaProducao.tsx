import { ConsultaProgressBar } from "../ConsultaProgressBar";
import { useReportAutoRefresh } from "./useReportAutoRefresh";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type IndicadoresColheitaProducaoData,
  type IndicadoresColheitaQualidadeData,
  type IndicadoresDisponibilidadePorTipoData,
  type RelatorioDiarioProducaoData,
} from "../../api";
import { useApp } from "../../store";
import { safraDefaultRange } from "../colheita/colheita-utils";
import { ConsumoCombustivelSection } from "./ConsumoCombustivelSection";
import { DisponibilidadeDiariaChart } from "./DisponibilidadeDiariaChart";
import { DisponibilidadeKpiCards } from "./DisponibilidadeKpiCards";
import { ProdutividadeMetasCards } from "./ProdutividadeMetasCards";
import { QualidadeColheitaSection } from "./QualidadeColheitaSection";
import { QualidadeEquipamentoFilter, type QualidadeEquipamentoOpcao } from "./QualidadeEquipamentoFilter";
import { QualidadePerdasAnalitico } from "./QualidadePerdasAnalitico";
import { HorasMotorElevadorSection } from "./HorasMotorElevadorSection";
import { ConsumoOleoHidraulicoSection } from "./ConsumoOleoHidraulicoSection";
import { RelatorioDesempenhoColheita } from "./RelatorioDesempenhoColheita";
import { RelatorioDiarioProducao } from "./RelatorioDiarioProducao";
import { ParadasColheitaSection } from "./ParadasColheitaSection";
import { TabelaColhedora, TabelaTrator, TabelaCaminhao } from "./ColheitaProducaoTabelas";
import { type DispModo } from "./disponibilidade-aggregate";

type ColheitaSubAba =
  | "frota-disponibilidade"
  | "producao-total"
  | "paradas-colheita"
  | "desempenho-producao"
  | "qualidade-colheita"
  | "consumo-combustivel"
  | "consumo-oleo-hidraulico"
  | "horas-motor-elevador";
type QualidadeView = "dashboard" | "analitico";

export function IndicadoresColheitaProducao() {
  const { safra } = useApp();
  const defaults = useMemo(() => safraDefaultRange(safra?.code), [safra?.code]);
  const [dataInicio, setDataInicio] = useState(defaults.from);
  const [dataFim, setDataFim] = useState(defaults.to);

  useEffect(() => {
    setDataInicio(defaults.from);
    setDataFim(defaults.to);
  }, [defaults.from, defaults.to]);
  const [dispModo, setDispModo] = useState<DispModo>("dia");
  const [dispMes, setDispMes] = useState("");
  const [subAba, setSubAba] = useState<ColheitaSubAba>("frota-disponibilidade");
  const [frotaData, setFrotaData] = useState<IndicadoresColheitaProducaoData | null>(null);
  const [periodData, setPeriodData] = useState<IndicadoresColheitaProducaoData | null>(null);
  const [diarioReport, setDiarioReport] = useState<RelatorioDiarioProducaoData | null>(null);
  const [dispEquipData, setDispEquipData] = useState<IndicadoresDisponibilidadePorTipoData | null>(null);
  const [loadingFrota, setLoadingFrota] = useState(false);
  const [loadingPeriod, setLoadingPeriod] = useState(false);
  const [errFrota, setErrFrota] = useState<string | null>(null);
  const [errPeriod, setErrPeriod] = useState<string | null>(null);
  const [qualEquipOpcoes, setQualEquipOpcoes] = useState<QualidadeEquipamentoOpcao[]>([]);
  const [qualEquipSelected, setQualEquipSelected] = useState<Set<number>>(() => new Set());
  const [qualidadeView, setQualidadeView] = useState<QualidadeView>("dashboard");
  const [qualidadeConsultToken, setQualidadeConsultToken] = useState(0);
  const [horasConsultToken, setHorasConsultToken] = useState(0);
  const [oleoConsultToken, setOleoConsultToken] = useState(0);
  const [paradasConsultToken, setParadasConsultToken] = useState(0);
  const [loadingQualidade, setLoadingQualidade] = useState(false);
  const [loadingHoras, setLoadingHoras] = useState(false);
  const [loadingOleo, setLoadingOleo] = useState(false);
  const [loadingParadas, setLoadingParadas] = useState(false);
  const [qualidadeConsultada, setQualidadeConsultada] = useState(false);
  const qualidadeSemFiltroRef = useRef<IndicadoresColheitaQualidadeData | null>(null);
  const qualidadeReqRef = useRef(0);
  const qualFilterKeyRef = useRef<string | null>(null);
  const producaoTotalLockRef = useRef<Promise<void> | null>(null);

  const refDate = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const safraRange = useMemo(() => (safra?.code ? safraDefaultRange(safra.code) : null), [safra?.code]);

  const qualEquipamentosFiltro = useMemo(() => {
    if (!qualEquipSelected.size || qualEquipSelected.size === qualEquipOpcoes.length) return undefined;
    return [...qualEquipSelected];
  }, [qualEquipOpcoes.length, qualEquipSelected]);

  const qualFilterKey = useMemo(
    () => qualEquipamentosFiltro?.slice().sort((a, b) => a - b).join(",") ?? "",
    [qualEquipamentosFiltro],
  );

  const applyQualidadeEquipFilter = useCallback(
    async (filtro?: number[]) => {
      if (!dataInicio || !dataFim || !qualidadeSemFiltroRef.current) return;
      const reqId = ++qualidadeReqRef.current;
      try {
        setLoadingQualidade(true);
        if (!filtro?.length) {
          if (reqId !== qualidadeReqRef.current) return;
          setPeriodData((prev) =>
            prev && qualidadeSemFiltroRef.current ? { ...prev, qualidade: qualidadeSemFiltroRef.current } : prev,
          );
          return;
        }
        const qualidade = await api.indicadoresColheitaQualidade({
          dataInicio,
          dataFim,
          codEquipamentos: filtro,
        });
        if (reqId !== qualidadeReqRef.current) return;
        setPeriodData((prev) => (prev ? { ...prev, qualidade } : prev));
      } catch (e) {
        if (reqId !== qualidadeReqRef.current) return;
        setErrPeriod(e instanceof Error ? e.message : String(e));
      } finally {
        if (reqId === qualidadeReqRef.current) setLoadingQualidade(false);
      }
    },
    [dataInicio, dataFim],
  );

  const loadFrota = useCallback(async () => {
    try {
      setLoadingFrota(true);
      setErrFrota(null);
      const result = await api.indicadoresColheitaProducaoFrota({ refDate });
      setFrotaData(result);
    } catch (e) {
      setFrotaData(null);
      setErrFrota(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingFrota(false);
    }
  }, [refDate]);

  const loadPeriod = useCallback(async () => {
    try {
      setLoadingPeriod(true);
      setErrPeriod(null);
      qualFilterKeyRef.current = null;
      const [result, disp] = await Promise.all([
        api.indicadoresColheitaProducao({
          dataInicio,
          dataFim,
          refDate: dataFim,
        }),
        api
          .indicadoresDisponibilidadePorTipo({
            safraCode: safra?.code,
            dataInicio,
            dataFim,
          })
          .catch(() => null),
      ]);
      qualidadeSemFiltroRef.current = result.qualidade ?? null;
      setPeriodData(result);
      setDispEquipData(disp);
      setQualidadeConsultada(Boolean(result.qualidade));
      if (result.qualidade?.equipamentosOpcoes?.length) {
        setQualEquipOpcoes(result.qualidade.equipamentosOpcoes);
        setQualEquipSelected((prev) => {
          if (!prev.size) return prev;
          const valid = new Set(result.qualidade!.equipamentosOpcoes!.map((eq) => eq.codEquipamento));
          const next = new Set([...prev].filter((cod) => valid.has(cod)));
          return next.size === prev.size ? prev : next;
        });
      }
      qualFilterKeyRef.current = qualFilterKey;
      await applyQualidadeEquipFilter(qualEquipamentosFiltro);
      setQualidadeConsultToken((token) => token + 1);

    } catch (e) {
      setDispEquipData(null);
      const message = e instanceof Error ? e.message : String(e);
      if (/failed to fetch|network|proxy|ECONNREFUSED|ECONNRESET/i.test(message)) {
        setErrPeriod("Não foi possível consultar a API. Aguarde o servidor reiniciar e clique em Consultar novamente.");
      } else {
        setErrPeriod(message);
      }
    } finally {
      setLoadingPeriod(false);
    }
  }, [applyQualidadeEquipFilter, dataInicio, dataFim, qualEquipamentosFiltro, qualFilterKey, safra?.code]);

  useEffect(() => {
    if (!qualidadeConsultada || subAba !== "qualidade-colheita") return;
    if (qualFilterKeyRef.current === null) {
      qualFilterKeyRef.current = qualFilterKey;
      return;
    }
    if (qualFilterKeyRef.current === qualFilterKey) return;
    qualFilterKeyRef.current = qualFilterKey;
    const timer = window.setTimeout(() => {
      void applyQualidadeEquipFilter(qualEquipamentosFiltro);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    applyQualidadeEquipFilter,
    qualEquipamentosFiltro,
    qualFilterKey,
    qualidadeConsultada,
    subAba,
  ]);

  const loadProducaoTotal = useCallback(async () => {
    if (producaoTotalLockRef.current) return producaoTotalLockRef.current;
    const run = (async () => {
      try {
        setLoadingPeriod(true);
        setErrPeriod(null);
        const result = await api.indicadoresColheitaProducao({
          dataInicio,
          dataFim,
          refDate: dataFim,
          modo: "producao-total",
        });
        setPeriodData(result);
        const diario = await api.indicadoresRelatorioDiarioProducao({
          data: dataFim,
          dataInicio,
          safraInicio: safraRange?.from,
        });
        setDiarioReport(diario);
      } catch (e) {
        setDiarioReport(null);
        const message = e instanceof Error ? e.message : String(e);
        if (/failed to fetch|network|proxy|ECONNREFUSED|ECONNRESET/i.test(message)) {
          setErrPeriod("Não foi possível consultar a API. Aguarde o servidor reiniciar e clique em Consultar novamente.");
        } else {
          setErrPeriod(message);
        }
      } finally {
        setLoadingPeriod(false);
      }
    })();
    producaoTotalLockRef.current = run.finally(() => {
      producaoTotalLockRef.current = null;
    });
    return producaoTotalLockRef.current;
  }, [dataInicio, dataFim, safraRange?.from]);

  useEffect(() => {
    if (subAba !== "frota-disponibilidade") return;
    void loadFrota();
  }, [loadFrota, subAba]);

  useEffect(() => {
    if (subAba !== "producao-total") return;
    void loadProducaoTotal();
  }, [loadProducaoTotal, subAba]);

  useReportAutoRefresh(async () => {
    if (subAba === "frota-disponibilidade" && !loadingFrota) await loadFrota();
    if (subAba === "producao-total" && !loadingPeriod) await loadProducaoTotal();
    if (subAba === "desempenho-producao" && !loadingPeriod) await loadPeriod();
  });

  const kpiCards = frotaData?.resumo.kpiCards ?? periodData?.resumo.kpiCards ?? [];

  return (
    <>
      <div className="kind-toggle indicadores-colheita-subtabs">
        <button
          type="button"
          className={`btn${subAba === "frota-disponibilidade" ? " primary" : ""}`}
          onClick={() => setSubAba("frota-disponibilidade")}
        >
          Frota e disponibilidade
        </button>
        <button
          type="button"
          className={`btn${subAba === "producao-total" ? " primary" : ""}`}
          onClick={() => setSubAba("producao-total")}
        >
          Produção total
        </button>
        <button
          type="button"
          className={`btn${subAba === "paradas-colheita" ? " primary" : ""}`}
          onClick={() => setSubAba("paradas-colheita")}
        >
          Paradas na colheita
        </button>
        <button
          type="button"
          className={`btn${subAba === "desempenho-producao" ? " primary" : ""}`}
          onClick={() => setSubAba("desempenho-producao")}
        >
          Desempenho e produção
        </button>
        <button
          type="button"
          className={`btn${subAba === "qualidade-colheita" ? " primary" : ""}`}
          onClick={() => setSubAba("qualidade-colheita")}
        >
          Qualidade colheita
        </button>
        <button
          type="button"
          className={`btn${subAba === "consumo-combustivel" ? " primary" : ""}`}
          onClick={() => setSubAba("consumo-combustivel")}
        >
          Consumo de combustível
        </button>
        <button
          type="button"
          className={`btn${subAba === "consumo-oleo-hidraulico" ? " primary" : ""}`}
          onClick={() => setSubAba("consumo-oleo-hidraulico")}
        >
          Consumo de óleo hidráulico
        </button>
        <button
          type="button"
          className={`btn${subAba === "horas-motor-elevador" ? " primary" : ""}`}
          onClick={() => setSubAba("horas-motor-elevador")}
        >
          Horas motor/ Elevador
        </button>
      </div>

      {errFrota ? (
        <p className="lead" style={{ color: "var(--danger)" }}>
          Frota: {errFrota}
        </p>
      ) : null}

      <section className="panel indicadores-periodo-filter no-print">
        <div className="indicadores-periodo-filter-row">
          <strong>Produção no período</strong>
          <label>
            De
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          </label>
          <label>
            Até
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </label>
          {subAba === "qualidade-colheita" && qualidadeView === "dashboard" ? (
            <QualidadeEquipamentoFilter
              opcoes={qualEquipOpcoes}
              selected={qualEquipSelected}
              onChange={setQualEquipSelected}
              disabled={loadingPeriod}
            />
          ) : null}
          <button
            className="btn primary"
            disabled={loadingPeriod || loadingHoras || loadingOleo || loadingParadas}
            onClick={() => {
              if (subAba === "horas-motor-elevador") {
                setHorasConsultToken((token) => token + 1);
                return;
              }
              if (subAba === "consumo-oleo-hidraulico") {
                setOleoConsultToken((token) => token + 1);
                return;
              }
              if (subAba === "paradas-colheita") {
                setParadasConsultToken((token) => token + 1);
                return;
              }
              if (subAba === "producao-total") {
                void loadProducaoTotal();
                return;
              }
              void loadPeriod();
            }}
          >
            {loadingPeriod || loadingHoras || loadingOleo || loadingParadas ? "Consultando…" : "Consultar"}
          </button>
        </div>
        <ConsultaProgressBar
          active={loadingPeriod || loadingQualidade || loadingHoras || loadingOleo || loadingParadas}
          label={
            loadingHoras
              ? "Consultando horas motor/elevador…"
              : loadingOleo
                ? "Consultando consumo de óleo hidráulico…"
                : loadingParadas
                  ? "Consultando paradas da colheita…"
                : loadingQualidade
                  ? "Atualizando qualidade da colheita…"
                  : subAba === "producao-total"
                    ? "Consultando produção total…"
                  : "Consultando produção no período…"
          }
          className="consulta-progress--inline"
        />
      </section>

      {errPeriod ? (
        <p className="lead" style={{ color: "var(--danger)" }}>
          {errPeriod}
        </p>
      ) : null}

      {periodData?.resumo.truncadoEntrada || periodData?.resumo.truncadoHoras ? (
        <p className="lead" style={{ color: "var(--warn, #b8860b)" }}>
          Dados parcialmente truncados — reduza o período se necessário.
        </p>
      ) : null}

      {subAba === "horas-motor-elevador" ? (
        <HorasMotorElevadorSection
          dataInicio={dataInicio}
          dataFim={dataFim}
          consultarToken={horasConsultToken}
          onLoadingChange={setLoadingHoras}
        />
      ) : subAba === "paradas-colheita" ? (
        <ParadasColheitaSection
          dataInicio={dataInicio}
          dataFim={dataFim}
          consultarToken={paradasConsultToken}
          onLoadingChange={setLoadingParadas}
        />
      ) : subAba === "consumo-oleo-hidraulico" ? (
        <ConsumoOleoHidraulicoSection
          dataInicio={dataInicio}
          dataFim={dataFim}
          safraCode={safra?.code}
          consultarToken={oleoConsultToken}
          onLoadingChange={setLoadingOleo}
        />
      ) : subAba === "consumo-combustivel" ? (
        periodData ? (
          <ConsumoCombustivelSection data={periodData} />
        ) : (
          <p className="lead">Consulte o período para ver o consumo de combustível.</p>
        )
      ) : subAba === "qualidade-colheita" ? (
        <>
          <div className="kind-toggle qualidade-view-toggle no-print">
            <button
              type="button"
              className={`btn${qualidadeView === "dashboard" ? " primary" : ""}`}
              onClick={() => setQualidadeView("dashboard")}
            >
              Dashboard
            </button>
            <button
              type="button"
              className={`btn${qualidadeView === "analitico" ? " primary" : ""}`}
              onClick={() => setQualidadeView("analitico")}
            >
              Relatório analítico
            </button>
          </div>
          {qualidadeView === "analitico" ? (
            <QualidadePerdasAnalitico
              dataInicio={dataInicio}
              dataFim={dataFim}
              consultarToken={qualidadeConsultToken}
            />
          ) : periodData?.qualidade ? (
            <QualidadeColheitaSection data={periodData.qualidade} />
          ) : (
            <p className="lead">Consulte o período para ver a qualidade da colheita.</p>
          )}
        </>
      ) : subAba === "producao-total" ? (
        <RelatorioDiarioProducao
          dataInicio={dataInicio}
          data={dataFim}
          safraInicio={safraRange?.from}
          safraLabel={safra?.code}
          desempenho={periodData}
          loadingDesempenho={loadingPeriod}
          report={diarioReport}
        />
      ) : subAba === "frota-disponibilidade" ? (
        <>
          <section className="indicadores-kpi-section">
            <h3>Frota atual</h3>
            {loadingFrota && !frotaData ? <p className="lead">Carregando frota…</p> : null}
            {kpiCards.length ? <DisponibilidadeKpiCards cards={kpiCards} /> : null}
          </section>
          <ProdutividadeMetasCards
            safraLabel={safra?.code ? `Safra ${safra.code}` : null}
            defaultWeekEnd={dataFim}
            safraDataInicio={safraRange?.from}
            safraDataFim={dataFim || safraRange?.to}
            maquinasColhedoras={kpiCards.find((card) => card.id === "colhedora")?.total ?? 0}
          />
        </>
      ) : periodData ? (
        <>
          <RelatorioDesempenhoColheita
            data={periodData}
            disponibilidade={dispEquipData}
            safraLabel={safra?.code ? `Safra ${safra.code}` : null}
          />

          <section className="panel indicadores-disp-panel">
            <h3>Disponibilidade diária — Colhedora x Transbordo</h3>
            <div className="kind-toggle indicadores-disp-toggle">
              <span className="toggle-caption">Agrupar por:</span>
              <button
                type="button"
                className={`btn${dispModo === "dia" ? " primary" : ""}`}
                onClick={() => setDispModo("dia")}
              >
                Dia
              </button>
              <button
                type="button"
                className={`btn${dispModo === "mes" ? " primary" : ""}`}
                onClick={() => {
                  setDispModo("mes");
                }}
              >
                Mês
              </button>
              {dispModo === "mes" ? (
                <label className="indicadores-disp-mespick">
                  <span className="toggle-caption">Detalhar mês:</span>
                  <input type="month" value={dispMes} onChange={(e) => setDispMes(e.target.value)} />
                  {dispMes ? (
                    <button type="button" className="btn" onClick={() => setDispMes("")}>
                      Todos
                    </button>
                  ) : null}
                </label>
              ) : null}
              <button
                type="button"
                className={`btn${dispModo === "safra" ? " primary" : ""}`}
                onClick={() => setDispModo("safra")}
                disabled={!safra?.code}
                title={safra?.code ? `Período da safra ${safra.code}` : "Selecione uma safra"}
              >
                Safra{safra?.code ? ` (${safra.code})` : ""}
              </button>
            </div>
            <DisponibilidadeDiariaChart
              series={periodData.disponibilidadeDiaria ?? []}
              modo={dispModo}
              mesRef={dispModo === "mes" ? dispMes : undefined}
              safraLabel={safra?.code ? `Safra ${safra.code}` : "Safra"}
            />
          </section>

          <section className="panel indicadores-tabela-panel">
            <h3 className="indicadores-tabela-title">COLHEDEIRA DE CANA</h3>
            <div className="table-wrap">
              {periodData.tabelas.colhedora.linhas.length ? (
                <TabelaColhedora
                  linhas={periodData.tabelas.colhedora.linhas}
                  totais={periodData.tabelas.colhedora.totais}
                />
              ) : (
                <p className="lead">Nenhum equipamento associado no período.</p>
              )}
            </div>
          </section>

          <section className="panel indicadores-tabela-panel">
            <h3 className="indicadores-tabela-title">TRATORES</h3>
            <div className="table-wrap">
              {periodData.tabelas.trator.linhas.length ? (
                <TabelaTrator linhas={periodData.tabelas.trator.linhas} totais={periodData.tabelas.trator.totais} />
              ) : (
                <p className="lead">Nenhum equipamento associado no período.</p>
              )}
            </div>
          </section>

          <section className="panel indicadores-tabela-panel">
            <h3 className="indicadores-tabela-title">CAMINHÃO</h3>
            <div className="table-wrap">
              {periodData.tabelas.caminhao.linhas.length ? (
                <TabelaCaminhao
                  linhas={periodData.tabelas.caminhao.linhas}
                  totais={periodData.tabelas.caminhao.totais}
                />
              ) : (
                <p className="lead">Nenhum equipamento associado no período.</p>
              )}
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
