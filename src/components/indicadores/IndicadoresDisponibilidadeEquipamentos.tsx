import { useCallback, useMemo, useState } from "react";
import { ConsultaProgressBar } from "../ConsultaProgressBar";
import { api, type IndicadoresDisponibilidadeEquipamentosData } from "../../api";
import { useApp } from "../../store";
import { safraDefaultRange } from "../colheita/colheita-utils";

const TIPOS_EQUIPAMENTO = [
  { cod: 81, label: "Colhedoras - CCT" },
  { cod: 93, label: "Trator Transbordo - CCT" },
  { cod: 90, label: "Implemento Transbordo - CCT" },
  { cod: 30, label: "Caminhão Apoio" },
  { cod: 31, label: "Caminhão Bombeiro" },
  { cod: 12, label: "Trator Plantio" },
  { cod: 8, label: "Trator Reboque de Cana" },
  { cod: 64, label: "Trator de Apoio - Tratos Culturais" },
  { cod: 6, label: "Trator de Apoio - Irrigação/Fertirrigação" },
  { cod: 11, label: "Pivot Linear - Irrigação/Fertirrigação" },
  { cod: 15, label: "Turbomaq - Irrigação/Fertirrigação" },
  { cod: 48, label: "Eletrobomba Dupla - Irrigação/Fertirrigação" },
  { cod: 40, label: "Eletrobomba Simples - Irrigação/Fertirrigação" },
  { cod: 91, label: "Implemento Agrícola" },
  { cod: 92, label: "Implemento Rodoviário" },
  { cod: 94, label: "Frota Leve" },
  { cod: 95, label: "Motocicleta" },
];

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function pctClass(value: number | null | undefined, meta: number) {
  if (value == null || !Number.isFinite(value)) return "";
  return value >= meta ? "disp-eq-ok" : "disp-eq-below";
}

function safraReportRange(code?: string) {
  const match = code?.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return safraDefaultRange(code);
  const y1 = Number(match[1]) >= 90 ? 1900 + Number(match[1]) : 2000 + Number(match[1]);
  const y2 = Number(match[2]) >= 90 ? 1900 + Number(match[2]) : 2000 + Number(match[2]);
  const from = `${y1}-09-01`;
  const to = `${y2}-08-31`;
  const today = new Date().toISOString().slice(0, 10);
  return { from, to: today < to ? today : to };
}

export function IndicadoresDisponibilidadeEquipamentos() {
  const { safra } = useApp();
  const defaults = useMemo(() => safraReportRange(safra?.code), [safra?.code]);
  const [dataInicio, setDataInicio] = useState(defaults.from);
  const [dataFim, setDataFim] = useState(defaults.to);
  const [codTiposEquipamento, setCodTiposEquipamento] = useState<number[]>([]);
  const [data, setData] = useState<IndicadoresDisponibilidadeEquipamentosData | null>(null);
  const [consultado, setConsultado] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleTipo = useCallback((cod: number) => {
    setCodTiposEquipamento((prev) =>
      prev.includes(cod) ? prev.filter((t) => t !== cod) : [...prev, cod].sort((a, b) => a - b),
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const result = await api.indicadoresDisponibilidadeEquipamentos({
        safraCode: safra?.code,
        dataInicio,
        dataFim,
        codTiposEquipamento: codTiposEquipamento.length ? codTiposEquipamento : undefined,
      });
      setData(result);
      setConsultado(true);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : "Não foi possível carregar a disponibilidade.");
    } finally {
      setLoading(false);
    }
  }, [safra?.code, dataInicio, dataFim, codTiposEquipamento]);

  return (
    <div className="indicadores-disp-equip-page">
      <section className="panel">
        <h3>Disponibilidade %</h3>
        <p className="lead indicadores-kpi-lead">
          Percentual acumulado por tipo de equipamento com base em horas potenciais (disponibilidade diária × dias com
          o tipo vigente) menos horas em ordem de serviço aberta no período. Meta padrão: {data?.meta ?? 85}%.
        </p>
        <form
          className="form-grid"
          style={{ padding: "8px 0 12px", maxWidth: 720 }}
          onSubmit={(e) => {
            e.preventDefault();
            void load();
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
        <fieldset className="disp-eq-tipos">
          <legend>
            Filtrar tipos{" "}
            <span className="disp-eq-tipos-actions">
              <button type="button" onClick={() => setCodTiposEquipamento(TIPOS_EQUIPAMENTO.map((t) => t.cod))}>
                Marcar todos
              </button>
              <button type="button" onClick={() => setCodTiposEquipamento([])}>
                Limpar filtro
              </button>
            </span>
          </legend>
          <p className="lead" style={{ margin: "0 0 8px", fontSize: "0.85rem" }}>
            Deixe vazio para exibir todos os tipos na matriz.
          </p>
          <div className="disp-eq-tipos-grid">
            {TIPOS_EQUIPAMENTO.map((tipo) => (
              <label key={tipo.cod} title={tipo.label}>
                <input
                  type="checkbox"
                  checked={codTiposEquipamento.includes(tipo.cod)}
                  onChange={() => toggleTipo(tipo.cod)}
                />
                {tipo.label}
              </label>
            ))}
          </div>
        </fieldset>
        {err ? <p className="lead" style={{ color: "var(--danger, #c0392b)" }}>{err}</p> : null}
        <ConsultaProgressBar active={loading} label="Consultando disponibilidade de equipamentos…" className="consulta-progress--compact" />

        {data ? (
          <div className="table-wrap indicadores-disp-equip-wrap">
            <table className="data indicadores-disp-equip-table">
              <thead>
                <tr>
                  <th rowSpan={2} className="disp-eq-title">
                    Disponibilidade %
                  </th>
                  {data.meses.map((mes) => (
                    <th key={mes.key} colSpan={1} className="disp-eq-month-head">
                      {mes.label}
                    </th>
                  ))}
                  <th colSpan={2} className="disp-eq-safra-head">
                    Acumulado Safra
                  </th>
                  <th rowSpan={2} className="disp-eq-meta-head">
                    Meta
                  </th>
                </tr>
                <tr>
                  {data.meses.map((mes) => (
                    <th key={`${mes.key}-sub`} className="disp-eq-sub">
                      Acum.
                    </th>
                  ))}
                  <th className="disp-eq-sub disp-eq-safra-prev">Safra {data.safraAnterior}</th>
                  <th className="disp-eq-sub disp-eq-safra-cur">Acum. Safra {data.safraAtual}</th>
                </tr>
              </thead>
              <tbody>
                {data.linhas.length ? (
                  data.linhas.map((linha) => (
                    <tr key={linha.codTipo} className={linha.highlight ? "disp-eq-highlight" : ""}>
                      <td className="disp-eq-label">{linha.label}</td>
                      {linha.meses.map((valor, idx) => (
                        <td key={`${linha.codTipo}-${idx}`} className={`num ${pctClass(valor, linha.meta)}`}>
                          {fmtPct(valor)}
                        </td>
                      ))}
                      <td className={`num ${pctClass(linha.safraAnterior, linha.meta)}`}>{fmtPct(linha.safraAnterior)}</td>
                      <td className={`num ${pctClass(linha.safraAtual, linha.meta)}`}>{fmtPct(linha.safraAtual)}</td>
                      <td className="num disp-eq-meta">{linha.meta}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={data.meses.length + 4}>Nenhum tipo de equipamento encontrado no período.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : !loading && !consultado ? (
          <p className="lead">Informe o período e clique em Consultar para exibir a matriz por tipo, mês e safra.</p>
        ) : null}
      </section>
    </div>
  );
}
