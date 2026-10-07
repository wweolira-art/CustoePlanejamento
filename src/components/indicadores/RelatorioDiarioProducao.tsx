import { useMemo } from "react";
import { type IndicadoresColheitaProducaoData, type RelatorioDiarioProducaoData } from "../../api";
import { decomporNaoAtingimentoMeta } from "../../lib/capacidade-colhedoras";
import { TabelaCaminhao, TabelaColhedora, TabelaTrator } from "./ColheitaProducaoTabelas";

function fmt2(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmt0(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${fmt2(n)}%`;
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
}

function fmtHorasClock(h: number | null | undefined) {
  if (h == null || !Number.isFinite(h) || h <= 0) return "0:00";
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = String(Math.abs(totalMin % 60)).padStart(2, "0");
  return `${hh}:${mm}`;
}

function MetaMiniGrafico({
  cota,
  realizado,
  capacidadeEstimada,
  naoAtingimento,
}: {
  cota: number | null;
  realizado: number | null;
  capacidadeEstimada: number | null;
  naoAtingimento?: RelatorioDiarioProducaoData["indicadorPrincipal"][number]["naoAtingimento"];
}) {
  const decomp =
    naoAtingimento ??
    decomporNaoAtingimentoMeta({ cota, realizado, capacidadeEstimada });
  const meta = decomp.cota > 0 ? decomp.cota : Math.max(decomp.realizado, 1);
  const perdaCap = decomp.causas.find((c) => c.chave === "capacidade")?.toneladas ?? 0;
  const perdaOp = decomp.causas.find((c) => c.chave === "execucao")?.toneladas ?? 0;
  const title = decomp.atingiu
    ? `Cota atingida · ${fmt2(decomp.realizado)} t`
    : decomp.causas.map((c) => `${c.label}: ${fmt2(c.toneladas)} t (${fmt2(c.pct)}%)`).join(" · ");

  return (
    <div className="indicador-meta-mini" title={title}>
      <div className="indicador-meta-mini-bar" aria-hidden="true">
        <i className="is-realizado" style={{ width: `${(decomp.realizado / meta) * 100}%` }} />
        {perdaOp > 0 ? <i className="is-execucao" style={{ width: `${(perdaOp / meta) * 100}%` }} /> : null}
        {perdaCap > 0 ? <i className="is-capacidade" style={{ width: `${(perdaCap / meta) * 100}%` }} /> : null}
      </div>
      {decomp.atingiu ? (
        <small>Meta ok</small>
      ) : (
        <small>
          −{fmt2(decomp.gap)} t
          {decomp.causas[0] ? ` · ${decomp.causas[0].label}` : ""}
        </small>
      )}
    </div>
  );
}

function IndicadorPrincipalPainel({
  linhas,
}: {
  linhas: NonNullable<RelatorioDiarioProducaoData["indicadorPrincipal"]>;
}) {
  return (
    <section className="panel indicadores-tabela-panel relatorio-diario-indicador-panel">
      <h3 className="indicadores-tabela-title">INDICADOR PRINCIPAL</h3>
      {linhas.length ? (
        <>
          <p className="indicador-meta-legend no-print">
            <span className="is-realizado">Realizado</span>
            <span className="is-execucao">Abaixo da capacidade (paradas/ociosidade)</span>
            <span className="is-capacidade">Frota/horas insuficientes</span>
          </p>
          <div className="table-wrap">
            <table className="indicadores-producao-table relatorio-diario-indicador-table">
              <thead>
                <tr>
                  <th>Frente</th>
                  <th className="num">Cota Usina</th>
                  <th className="num">Realizado</th>
                  <th>Não atingimento</th>
                  <th className="num">Colhedoras</th>
                  <th className="num indicadores-th-break">Horas-máquina</th>
                  <th className="num indicadores-th-break">Prod. histórica</th>
                  <th className="num">Necessária</th>
                  <th className="num">Capacidade</th>
                  <th className="num">Diferença</th>
                  <th className="num">% cota</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((row) => {
                  const isTotal = row.frente === "TOTAL";
                  const diffClass =
                    row.diferenca == null ? "" : row.diferenca < 0 ? "is-negativo" : "is-positivo";
                  const statusClass =
                    row.capacidadeSuficiente === true
                      ? "is-suficiente"
                      : row.capacidadeSuficiente === false
                        ? "is-insuficiente"
                        : "";
                  return (
                    <tr key={`${row.frente}-${row.data ?? "total"}`} className={isTotal ? "indicadores-producao-total" : undefined}>
                      <td title={fmtDate(row.data)}>
                        {row.frente}
                        {row.data ? <small className="relatorio-diario-indicador-data">{fmtDate(row.data)}</small> : null}
                      </td>
                      <td className="num">{fmt2(row.cotaUsina)}</td>
                      <td className="num">{fmt2(row.realizado)}</td>
                      <td>
                        <MetaMiniGrafico
                          cota={row.cotaUsina}
                          realizado={row.realizado}
                          capacidadeEstimada={row.capacidadeEstimada}
                          naoAtingimento={row.naoAtingimento}
                        />
                      </td>
                      <td className="num">{fmt0(row.colhedoras)}</td>
                      <td className="num">{row.horasMaquina == null ? "—" : `${fmt2(row.horasMaquina)} h`}</td>
                      <td className="num">
                        {row.produtividadeHistorica == null ? "—" : `${fmt2(row.produtividadeHistorica)} t/h`}
                      </td>
                      <td className="num">
                        {row.capacidadeNecessaria == null ? "—" : `${fmt2(row.capacidadeNecessaria)} t/h`}
                      </td>
                      <td className="num">{fmt2(row.capacidadeEstimada)}</td>
                      <td className={`num ${diffClass}`}>{fmt2(row.diferenca)}</td>
                      <td className="num">{fmtPct(row.percentualCota)}</td>
                      <td className={`relatorio-diario-indicador-status ${statusClass}`}>
                        {row.status}
                        {row.estimativaInconsistente ? (
                          <small>Realizado acima da capacidade estimada</small>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="lead">Nenhum indicador para o período selecionado.</p>
      )}
    </section>
  );
}

function MotivosParadaPainel({
  titulo,
  itens,
}: {
  titulo: string;
  itens: Array<{ motivo: string; horas: number; qtd: number }>;
}) {
  const ranked = [...itens].sort((a, b) => b.horas - a.horas);
  const top = ranked.slice(0, 8);
  const rest = ranked.slice(8);
  const rows = rest.length
    ? [
        ...top,
        {
          motivo: "Outros",
          horas: rest.reduce((acc, row) => acc + row.horas, 0),
          qtd: rest.reduce((acc, row) => acc + row.qtd, 0),
        },
      ]
    : top;
  const total = itens.reduce((acc, row) => acc + row.horas, 0);
  const max = Math.max(...rows.map((row) => row.horas), 0.01);

  return (
    <section className="panel indicadores-tabela-panel relatorio-diario-parada-panel">
      <h3 className="indicadores-tabela-title">{titulo}</h3>
      {rows.length ? (
        <div className="relatorio-diario-parada-bars">
          {rows.map((row) => (
            <div
              key={row.motivo}
              className="relatorio-diario-parada-row"
              title={`${row.motivo}: ${fmtHorasClock(row.horas)} · ${row.qtd} OS`}
            >
              <span>{row.motivo}</span>
              <div>
                <i style={{ width: `${(row.horas / max) * 100}%` }} />
                <b>
                  {fmtHorasClock(row.horas)}
                  <small>{total > 0 ? ` ${fmt2((row.horas / total) * 100)}%` : ""}</small>
                </b>
              </div>
            </div>
          ))}
          <p className="relatorio-diario-parada-total">Horas totais: {fmtHorasClock(total)}</p>
        </div>
      ) : (
        <p className="lead">Sem paradas no período.</p>
      )}
    </section>
  );
}

function safraTitulo(code?: string | null) {
  const match = code?.match(/^(\d{2})\//);
  if (!match) return code ? `SAFRA ${code}` : "SAFRA";
  const year = Number(match[1]) >= 90 ? 1900 + Number(match[1]) : 2000 + Number(match[1]);
  return `SAFRA ${year} / ${year + 1}`;
}

export function RelatorioDiarioProducao({
  data,
  safraLabel,
  desempenho,
  loadingDesempenho,
  report,
}: {
  dataInicio?: string | null;
  data: string;
  safraInicio?: string | null;
  safraLabel?: string | null;
  desempenho?: IndicadoresColheitaProducaoData | null;
  loadingDesempenho?: boolean;
  report?: RelatorioDiarioProducaoData | null;
}) {
  const payload = report ?? null;

  const kpis = payload?.kpis;
  const frotaTabelas = useMemo(() => {
    if (!desempenho) {
      return {
        necessidade: kpis?.necessidadeFrota,
        disponivel: kpis?.frotaDisponivel,
        pct: kpis?.pctDisponibilidadeFrota,
      };
    }
    const todos = new Map<string, boolean>();
    for (const row of desempenho.tabelas.colhedora.linhas) todos.set(row.equipTag, row.parado);
    for (const row of desempenho.tabelas.trator.linhas) todos.set(row.equipTag, row.parado);
    for (const row of desempenho.tabelas.caminhao.linhas) todos.set(row.equipTag, row.parado);
    const necessidade = todos.size;
    const disponivel = [...todos.values()].filter((parado) => !parado).length;
    return {
      necessidade,
      disponivel,
      pct: necessidade > 0 ? (disponivel / necessidade) * 100 : null,
    };
  }, [desempenho, kpis?.necessidadeFrota, kpis?.frotaDisponivel, kpis?.pctDisponibilidadeFrota]);
  const grupoLabel = payload?.rodape.grupoDestaque || "grupo";
  const periodoLabel =
    payload?.filtros.dataInicio && payload.filtros.dataInicio !== payload.filtros.data
      ? `${fmtDate(payload.filtros.dataInicio)} a ${fmtDate(payload.filtros.data)}`
      : fmtDate(payload?.filtros.data ?? data);

  return (
    <section className="relatorio-diario">
      <header className="relatorio-diario-head">
        <img src="/elejota-agro-logo.png" alt="Elejota Agro" className="relatorio-diario-logo" />
        <h2>RELATÓRIO DIÁRIO {safraTitulo(safraLabel)}</h2>
        <strong>{periodoLabel}</strong>
      </header>

      <div className="relatorio-diario-kpis">
        <article>
          <span>MOAGEM REAL</span>
          <strong>{fmt2(kpis?.moagemReal)}</strong>
          <small>{fmtPct(kpis?.pctMoagemReal)}</small>
        </article>
        <article>
          <span>CANA PRÓPRIA</span>
          <strong>{fmt2(kpis?.canaPropria)}</strong>
          <small>{fmtPct(kpis?.pctPropria)}</small>
        </article>
        <article>
          <span>COTA USINA</span>
          <strong>{fmt2(kpis?.canaFornecedor)}</strong>
          <small>{fmtPct(kpis?.pctFornecedor)}</small>
        </article>
        <article className="is-previsao">
          <span>PREVISÃO DE MOAGEM 24H</span>
          <strong>{fmt2(kpis?.previsao24h)}</strong>
        </article>
      </div>

      <div className="relatorio-diario-kpis relatorio-diario-kpis-frota">
        <article>
          <span>RAIO MÉDIO FRENTE PRÓPRIA</span>
          <strong>{fmt2(kpis?.raioMedio)}</strong>
        </article>
        <article>
          <span>NECESSIDADE DE FROTA</span>
          <strong>{fmt0(frotaTabelas.necessidade)}</strong>
        </article>
        <article>
          <span>FROTA DISPONÍVEL</span>
          <strong>{fmt0(frotaTabelas.disponivel)}</strong>
        </article>
        <article>
          <span>% DISPONIBILIDADE FROTA</span>
          <strong>{fmtPct(frotaTabelas.pct)}</strong>
        </article>
      </div>

      <div className="relatorio-diario-tabelas">
        {desempenho ? (
          <>
            <section className="panel indicadores-tabela-panel">
              <h3 className="indicadores-tabela-title">COLHEDEIRA DE CANA</h3>
              <div className="table-wrap">
                {desempenho.tabelas.colhedora.linhas.length ? (
                  <TabelaColhedora
                    linhas={desempenho.tabelas.colhedora.linhas}
                    totais={desempenho.tabelas.colhedora.totais}
                    ocultarLitrosCombustivel
                    ocultarHorasMotorElevador
                    mostrarDisponibilidade
                  />
                ) : (
                  <p className="lead">Nenhum equipamento associado no período.</p>
                )}
              </div>
            </section>
            <section className="panel indicadores-tabela-panel">
              <h3 className="indicadores-tabela-title">TRATORES</h3>
              <div className="table-wrap">
                {desempenho.tabelas.trator.linhas.length ? (
                  <TabelaTrator
                    linhas={desempenho.tabelas.trator.linhas}
                    totais={desempenho.tabelas.trator.totais}
                    ocultarLitrosCombustivel
                    ocultarHorasMotorElevador
                    mostrarDisponibilidade
                  />
                ) : (
                  <p className="lead">Nenhum equipamento associado no período.</p>
                )}
              </div>
            </section>
            <section className="panel indicadores-tabela-panel">
              <h3 className="indicadores-tabela-title">CAMINHÃO</h3>
              <div className="table-wrap">
                {desempenho.tabelas.caminhao.linhas.length ? (
                  <TabelaCaminhao
                    linhas={desempenho.tabelas.caminhao.linhas}
                    totais={desempenho.tabelas.caminhao.totais}
                    ocultarLitrosCombustivel
                    ocultarKmRodados
                    mostrarDisponibilidade
                  />
                ) : (
                  <p className="lead">Nenhum equipamento associado no período.</p>
                )}
              </div>
            </section>
          </>
        ) : loadingDesempenho ? (
          <p className="lead">Carregando tabelas de colhedora, tratores e caminhões…</p>
        ) : (
          <p className="lead">Consulte o período para ver as tabelas de colhedora, tratores e caminhões.</p>
        )}
      </div>

      {desempenho || payload ? (
        <div className="relatorio-diario-paradas">
          {desempenho ? (
            <MotivosParadaPainel
              titulo="MOTIVOS DE PARADAS"
              itens={desempenho.motivosParada?.linhas ?? []}
            />
          ) : (
            <section className="panel indicadores-tabela-panel relatorio-diario-parada-panel">
              <h3 className="indicadores-tabela-title">MOTIVOS DE PARADAS</h3>
              <p className="lead">
                {loadingDesempenho ? "Carregando paradas…" : "Consulte o período para ver as paradas."}
              </p>
            </section>
          )}
          <IndicadorPrincipalPainel linhas={payload?.indicadorPrincipal ?? []} />
        </div>
      ) : null}

      <p className="relatorio-diario-tagline">
        Logística Agrícola Elejota | Safra {safraLabel || "—"}
        <small>Planejar → Controlar → Entregar resultados.</small>
      </p>

      <div className="relatorio-diario-foot">
        <article>
          <span>DIAS DE SAFRA</span>
          <strong>{fmt0(payload?.rodape.diasSafra)}</strong>
        </article>
        <article>
          <span>MOAGEM ACUMULADA</span>
          <strong>{fmt2(payload?.rodape.moagemAcumulada)}</strong>
        </article>
      </div>
      <div className="relatorio-diario-foot is-grupo">
        <article>
          <span>DIAS DE COLHEITA {grupoLabel}</span>
          <strong>{fmt0(payload?.rodape.diasColheitaGrupo)}</strong>
        </article>
        <article>
          <span>MÉDIA DIA</span>
          <strong>{fmt2(payload?.rodape.mediaDiaGrupo)}</strong>
        </article>
        <article>
          <span>ACUMULADO {grupoLabel}</span>
          <strong>{fmt2(payload?.rodape.acumuladoGrupo)}</strong>
        </article>
      </div>
    </section>
  );
}
