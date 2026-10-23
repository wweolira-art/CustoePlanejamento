import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type CustoMatrizSubprocessoData, type ParametrosTecnicos } from "../../api";
import { ConsultaProgressBar } from "../ConsultaProgressBar";
import { EstagiosProducao, type AreasEstagio, type ModoEstagio } from "./RateioMatrizRha";

type Props = {
  anomesFrom: number;
  anomesTo: number;
  safraLabel: string;
  safraId?: number;
};

type Campos = {
  areaPlantio: string;
  areaSoca: string;
  areaIrrigacao: string;
  areaArrendada: string;
  moagemLj: string;
  tonelagemManual: string;
  atr: string;
  produtividade: string;
  precoAtrConsecana: string;
};

type Origem = "vazio" | "extraido" | "armazenado";

const CAMPOS: { key: keyof Campos; label: string; motivo: string }[] = [
  {
    key: "areaPlantio",
    label: "Área plantio (ha)",
    motivo: "Operação 41 de automotivo.itens_apontamento. Divide o R$/ha de Formação, Conservação, Preparo e Plantio.",
  },
  {
    key: "areaSoca",
    label: "Área soqueira (ha)",
    motivo: "Apontamento agrícola nas operações M13, M56, M80 e M342. Divide o R$/ha de Manutenção de soqueira.",
  },
  {
    key: "areaIrrigacao",
    label: "Área irrigação (ha)",
    motivo: "Soma, uma vez por talhão, a área total do talhão com apontamento de irrigação. Divide o R$/ha da Irrigação.",
  },
  {
    key: "areaArrendada",
    label: "Área arrendada (ha)",
    motivo: "Cadastros > Áreas com descrição de arrendamento. Divide o R$/ha do Arrendamento.",
  },
  {
    key: "moagemLj",
    label: "Moagem LJ (t)",
    motivo: "Divide o R$/ha do Sistema de colheita: custo total do objeto de custo ÷ esta moagem.",
  },
  {
    key: "tonelagemManual",
    label: "Tonelagem manual (t)",
    motivo: "Toneladas colhidas no manual. Divide o R$/t da coluna Manual em Custo colheita.",
  },
  {
    key: "atr",
    label: "ATR",
    motivo: "ATR médio informado para o período. Usado como referência técnica do estágio de produção.",
  },
  {
    key: "produtividade",
    label: "Produtividade (t/há)",
    motivo: "Produtividade técnica informada para o período.",
  },
  {
    key: "precoAtrConsecana",
    label: "Preço ATR Consecana AL/SE (R$/t)",
    motivo: "Preço de ATR aplicável ao contrato e período. Alimenta a linha Preço estimado e a Margem.",
  },
];

function anomesToInput(n: number) {
  return String(n).padStart(6, "0");
}

function formatArea(n: number) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

function formatIndicador(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function parseArea(raw: string) {
  const s = raw.trim().replace(/\s/g, "");
  if (!s) return 0;
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function camposDe(row: ParametrosTecnicos): Campos {
  return {
    areaPlantio: formatArea(row.areaPlantio),
    areaSoca: formatArea(row.areaSoca),
    areaIrrigacao: formatArea(row.areaIrrigacao),
    areaArrendada: formatArea(row.areaArrendada),
    moagemLj: formatArea(row.moagemLj),
    tonelagemManual: formatArea(row.tonelagemManual),
    atr: formatArea(row.atr),
    produtividade: formatArea(row.produtividade),
    precoAtrConsecana: formatArea(row.precoAtrConsecana),
  };
}

const CAMPOS_VAZIOS: Campos = {
  areaPlantio: "",
  areaSoca: "",
  areaIrrigacao: "",
  areaArrendada: "",
  moagemLj: "",
  tonelagemManual: "",
  atr: "",
  produtividade: "",
  precoAtrConsecana: "",
};

function ParametrosTecnicosCard({
  campos,
  origem,
  periodoExtracao,
  moagem,
  extraindo,
  armazenando,
  onChange,
  onExtrair,
  onArmazenar,
}: {
  campos: Campos;
  origem: Origem;
  periodoExtracao: { inicio: string; fim: string } | null;
  moagem: number | null;
  extraindo: boolean;
  armazenando: boolean;
  onChange: (campo: keyof Campos, valor: string) => void;
  onExtrair: () => void;
  onArmazenar: () => void;
}) {
  const plantio = parseArea(campos.areaPlantio);
  const soca = parseArea(campos.areaSoca);
  const areaTotal = (Number.isFinite(plantio) ? plantio : 0) + (Number.isFinite(soca) ? soca : 0);
  const aviso =
    origem === "extraido"
      ? `Áreas extraídas de ${periodoExtracao?.inicio ?? "—"} a ${periodoExtracao?.fim ?? "—"}. Edite se precisar e clique em Armazenar.`
      : origem === "armazenado"
        ? `Parâmetros do período ${periodoExtracao?.inicio ?? "—"} a ${periodoExtracao?.fim ?? "—"}. Edite os campos e clique em Armazenar para gravar.`
        : "Digite as áreas deste período ou use Extrair áreas. Depois clique em Armazenar.";

  return (
    <aside className="estagio-parametros">
      <table>
        <thead>
          <tr>
            <th colSpan={2}>Parâmetros técnicos</th>
          </tr>
        </thead>
        <tbody>
          {CAMPOS.map((row) => (
            <tr key={row.key}>
              <th>
                {row.label}
                <small>{row.motivo}</small>
              </th>
              <td>
                <input
                  className="estagio-parametro-input"
                  value={campos[row.key]}
                  inputMode="decimal"
                  aria-label={row.label}
                  disabled={armazenando}
                  placeholder="0,00"
                  onChange={(e) => onChange(row.key, e.target.value)}
                />
              </td>
            </tr>
          ))}
          <tr>
            <th>
              Área total (ha)
              <small>Plantio + soqueira. Divide o R$/ha do Administrativo e do Custo total.</small>
            </th>
            <td>{formatArea(Number.isFinite(areaTotal) ? areaTotal : 0)}</td>
          </tr>
          <tr>
            <th>
              Moagem (t)
              <small>Soma de agricola.itensentradacana.pesoliquido no período consultado. Divide o R$/t.</small>
            </th>
            <td>{moagem == null ? "—" : formatArea(moagem)}</td>
          </tr>
        </tbody>
      </table>
      <p className="estagio-parametros-nota">{aviso}</p>
      <div className="actions estagio-parametros-acoes">
        <button type="button" className="btn" onClick={onExtrair} disabled={extraindo || armazenando}>
          {extraindo ? "Extraindo…" : "Extrair áreas"}
        </button>
        <button type="button" className="btn primary" onClick={onArmazenar} disabled={extraindo || armazenando}>
          {armazenando ? "Armazenando…" : "Armazenar"}
        </button>
      </div>
      <ConsultaProgressBar active={extraindo} label="Extraindo áreas do banco…" className="consulta-progress--compact" />
    </aside>
  );
}

function IndicadorIcone({ tipo }: { tipo: "produtividade" | "idade" | "qualidade" }) {
  if (tipo === "produtividade") {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M31 51V12m0 18c-9-8-14-12-21-12 2 8 8 14 21 17m0-10c7-9 14-12 22-11-3 8-9 13-22 16" fill="none" stroke="#4a8b62" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M11 54c10-5 32-5 43 0M17 59c8-3 23-3 31 0M24 51l-4 7m14-8 1 8m9-8 5 7" fill="none" stroke="#283b66" strokeWidth="2" strokeLinecap="round" />
        <path d="M31 10c0-3 2-5 4-5" fill="none" stroke="#df675e" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (tipo === "idade") {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M18 53V16m0 18c-6-6-9-8-14-8 1 6 5 10 14 12m0-9c5-7 10-9 15-8-2 6-6 10-15 12" fill="none" stroke="#4a8b62" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="42" cy="38" r="15" fill="#fff" stroke="#283b66" strokeWidth="2.5" />
        <path d="M42 29v10l7 4M37 5h10m-5 0v5" fill="none" stroke="#283b66" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18 18c3-5 7-8 12-9" fill="none" stroke="#df675e" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M22 53V13m0 18c-7-7-11-10-17-10 2 7 6 12 17 15m0-10c6-8 11-11 18-10-2 7-7 12-18 15" fill="none" stroke="#4a8b62" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M37 22 44 15l7 7-7 7-7-7Zm7-7V8m7 14h6m-20 0h-5m12 7v6" fill="none" stroke="#283b66" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="44" cy="22" r="2" fill="#df675e" />
      <path d="M14 57h39M18 53l-4 4m16-4v4m14-4 4 4" fill="none" stroke="#283b66" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IndicadoresEstagio({ produtividade, atr }: { produtividade: number | null; atr: number | null }) {
  const cards: { tipo: "produtividade" | "idade" | "qualidade"; valor: string; unidade: string; titulo: string; descricao: string; inline?: boolean }[] = [
    { tipo: "produtividade" as const, valor: formatIndicador(produtividade), unidade: "t/ha", titulo: "Produtividade", descricao: "Moagem dividida pela área total do período." },
    { tipo: "idade" as const, valor: "—", unidade: "anos", inline: true, titulo: "Idade média", descricao: "Fonte de idade média ainda não configurada." },
    { tipo: "qualidade" as const, valor: formatIndicador(atr), unidade: "kg/t", titulo: "Quali. Cana própria", descricao: "ATR informado nos parâmetros técnicos do período." },
  ];
  return (
    <div className="estagio-kpis" aria-label="Indicadores do estágio de produção">
      {cards.map((card) => (
        <article className="estagio-kpi" key={card.tipo} title={card.descricao}>
          <span className="estagio-kpi-icone"><IndicadorIcone tipo={card.tipo} /></span>
          <span className={`estagio-kpi-medida${card.inline ? " estagio-kpi-medida--inline" : ""}`}><strong>{card.valor}</strong><b>{card.unidade}</b></span>
          <small>{card.titulo}</small>
        </article>
      ))}
    </div>
  );
}

export function EstagioProducaoPanel({ anomesFrom, anomesTo, safraLabel, safraId }: Props) {
  const [inicio, setInicio] = useState(() => anomesToInput(anomesFrom));
  const [fim, setFim] = useState(() => anomesToInput(anomesTo));
  const [periodo, setPeriodo] = useState<{ inicio: string; fim: string } | null>(null);
  const [matriz, setMatriz] = useState<CustoMatrizSubprocessoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [modo, setModo] = useState<ModoEstagio>("ambos");
  const [campos, setCampos] = useState<Campos>(CAMPOS_VAZIOS);
  const [origem, setOrigem] = useState<Origem>("vazio");
  const [periodoExtracao, setPeriodoExtracao] = useState<{ inicio: string; fim: string } | null>(null);
  const [extraindo, setExtraindo] = useState(false);
  const [armazenando, setArmazenando] = useState(false);
  const [paramErr, setParamErr] = useState<string | null>(null);
  const leituraSeq = useRef(0);
  const digitou = useRef(false);

  const consultar = useCallback(
    async (anomesInicio: string, anomesFim: string) => {
      if (!/^\d{6}$/.test(anomesInicio) || !/^\d{6}$/.test(anomesFim)) {
        setErr("Informe o anomes inicial e final no formato YYYYMM.");
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const params: Record<string, string | number> = {
          anomesInicio,
          anomesFim,
          somenteEstagios: 1,
        };
        if (safraId != null) params.safraId = safraId;
        const data = await api.custoMatrizSubprocesso(params);
        setMatriz(data);
        setPeriodo({ inicio: anomesInicio, fim: anomesFim });
      } catch (e) {
        setMatriz(null);
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [safraId],
  );

  useEffect(() => {
    setInicio(anomesToInput(anomesFrom));
    setFim(anomesToInput(anomesTo));
    setMatriz(null);
    setPeriodo(null);
    setErr(null);
  }, [anomesFrom, anomesTo, safraId]);

  useEffect(() => {
    const anomesInicio = inicio.trim();
    const anomesFim = fim.trim();
    if (!/^\d{6}$/.test(anomesInicio) || !/^\d{6}$/.test(anomesFim)) return;
    const seq = ++leituraSeq.current;
    digitou.current = false;
    let cancelled = false;
    setParamErr(null);
    api
      .parametrosTecnicos(safraId, anomesInicio, anomesFim)
      .then((row) => {
        if (cancelled || seq !== leituraSeq.current) return;
        if (!row.armazenado) {
          if (digitou.current) return;
          setCampos(CAMPOS_VAZIOS);
          setOrigem("vazio");
          setPeriodoExtracao({ inicio: anomesInicio, fim: anomesFim });
          return;
        }
        setCampos(camposDe(row));
        setOrigem("armazenado");
        if (row.anomesInicio && row.anomesFim) {
          setPeriodoExtracao({ inicio: row.anomesInicio, fim: row.anomesFim });
        }
      })
      .catch((e) => {
        if (!cancelled) setParamErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [safraId, inicio, fim]);

  const aplicarExtraido = (row: ParametrosTecnicos, proximaOrigem: Origem) => {
    setCampos(camposDe(row));
    setOrigem(proximaOrigem);
    setPeriodoExtracao(row.anomesInicio && row.anomesFim ? { inicio: row.anomesInicio, fim: row.anomesFim } : null);
  };

  const extrair = async () => {
    const anomesInicio = inicio.trim();
    const anomesFim = fim.trim();
    if (!/^\d{6}$/.test(anomesInicio) || !/^\d{6}$/.test(anomesFim)) {
      setParamErr("Informe o anomes inicial e final no formato YYYYMM.");
      return;
    }
    const seq = ++leituraSeq.current;
    setExtraindo(true);
    setParamErr(null);
    try {
      const row = await api.extrairParametrosTecnicos({
        safraId,
        anomesInicio,
        anomesFim,
      });
      if (seq !== leituraSeq.current) return;
      aplicarExtraido(row, "extraido");
    } catch (e) {
      setParamErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExtraindo(false);
    }
  };

  const armazenar = async () => {
    const numeros = {
      areaPlantio: parseArea(campos.areaPlantio),
      areaSoca: parseArea(campos.areaSoca),
      areaIrrigacao: parseArea(campos.areaIrrigacao),
      areaArrendada: parseArea(campos.areaArrendada),
      moagemLj: parseArea(campos.moagemLj),
      tonelagemManual: parseArea(campos.tonelagemManual),
      atr: parseArea(campos.atr),
      produtividade: parseArea(campos.produtividade),
      precoAtrConsecana: parseArea(campos.precoAtrConsecana),
    };
    if (Object.values(numeros).some((n) => !Number.isFinite(n))) {
      setParamErr("Informe os valores com números válidos.");
      return;
    }
    const anomesInicio = periodoExtracao?.inicio ?? inicio.trim();
    const anomesFim = periodoExtracao?.fim ?? fim.trim();
    if (!/^\d{6}$/.test(anomesInicio) || !/^\d{6}$/.test(anomesFim)) {
      setParamErr("Informe o anomes inicial e final no formato YYYYMM.");
      return;
    }
    setArmazenando(true);
    setParamErr(null);
    try {
      const row = await api.salvarParametrosTecnicos({
        safraId,
        ...numeros,
        anomesInicio,
        anomesFim,
      });
      aplicarExtraido(row, "armazenado");
    } catch (e) {
      setParamErr(e instanceof Error ? e.message : String(e));
    } finally {
      setArmazenando(false);
    }
  };

  const areasArmazenadas = useMemo<AreasEstagio | null>(() => {
    if (origem !== "armazenado") return null;
    const plantio = parseArea(campos.areaPlantio);
    const soca = parseArea(campos.areaSoca);
    const irrigacao = parseArea(campos.areaIrrigacao);
    const arrendada = parseArea(campos.areaArrendada);
    const atr = parseArea(campos.atr);
    const precoAtrConsecana = parseArea(campos.precoAtrConsecana);
    if ([plantio, soca, irrigacao, arrendada, atr, precoAtrConsecana].some((n) => !Number.isFinite(n))) return null;
    return { plantio, soca, irrigacao, arrendada, atr, precoAtrConsecana };
  }, [origem, campos]);

  const moagem = matriz?.estagios?.parametros?.toneladas ?? matriz?.estagios?.toneladas ?? null;
  const produtividadeIndicador = matriz?.estagios?.parametros?.produtividade
    ?? (origem !== "vazio" ? parseArea(campos.produtividade) : null);
  const atrIndicador = origem !== "vazio" ? parseArea(campos.atr) : null;

  const card = (
    <ParametrosTecnicosCard
      campos={campos}
      origem={origem}
      periodoExtracao={periodoExtracao}
      moagem={moagem}
      extraindo={extraindo}
      armazenando={armazenando}
      onChange={(campo, valor) => {
        digitou.current = true;
        setCampos((prev) => ({ ...prev, [campo]: valor }));
      }}
      onExtrair={() => void extrair()}
      onArmazenar={() => void armazenar()}
    />
  );

  return (
    <>
      <p className="lead">
        Estágio de produção e parâmetros técnicos da {safraLabel}
        {periodo ? `, período ${periodo.inicio} a ${periodo.fim}` : ""}.
      </p>
      <section className="panel no-print">
        <h3>Filtros</h3>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void consultar(inicio.trim(), fim.trim());
          }}
        >
          <label>
            Anomes inicial (YYYYMM)
            <input
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              inputMode="numeric"
              pattern="\d{6}"
              placeholder="Ex.: 202509"
              required
            />
          </label>
          <label>
            Anomes final (YYYYMM)
            <input
              value={fim}
              onChange={(e) => setFim(e.target.value)}
              inputMode="numeric"
              pattern="\d{6}"
              placeholder="Ex.: 202608"
              required
            />
          </label>
          <div>
            <span className="toggle-caption">Exibir</span>
            <div className="kind-toggle">
              <button type="button" className={`btn ${modo === "valor" ? "primary" : ""}`} onClick={() => setModo("valor")}>
                Custo total (R$)
              </button>
              <button type="button" className={`btn ${modo === "rha" ? "primary" : ""}`} onClick={() => setModo("rha")}>
                R$/ha
              </button>
              <button type="button" className={`btn ${modo === "ambos" ? "primary" : ""}`} onClick={() => setModo("ambos")}>
                R$ e R$/ha
              </button>
            </div>
          </div>
          <div className="actions">
            <button type="submit" className="btn primary" disabled={loading}>
              {loading ? "Consultando…" : "Consultar"}
            </button>
          </div>
        </form>
        <ConsultaProgressBar active={loading} label="Consultando estágio de produção…" className="consulta-progress--compact" />
      </section>
      {err ? (
        <p className="lead" style={{ color: "var(--danger)" }}>
          {err}
        </p>
      ) : null}
      {paramErr ? (
        <p className="lead" style={{ color: "var(--danger)" }}>
          {paramErr}
        </p>
      ) : null}
      <IndicadoresEstagio
        produtividade={produtividadeIndicador != null && Number.isFinite(produtividadeIndicador) ? produtividadeIndicador : null}
        atr={atrIndicador != null && Number.isFinite(atrIndicador) ? atrIndicador : null}
      />
      {matriz?.estagios?.linhas?.length ? (
        <EstagiosProducao data={matriz} modo={modo} areasArmazenadas={areasArmazenadas} painel={card} />
      ) : (
        <div className="estagio-producao">{card}</div>
      )}
    </>
  );
}
