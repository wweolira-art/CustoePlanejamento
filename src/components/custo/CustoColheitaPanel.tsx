import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { ReadOnlyFieldset, useCanEditItems } from "../../lib/editAccess";

type Lado = {
  manual: number;
  mecanizada: number;
  adicionalManual?: number;
  adicionalMecanizada?: number;
  adicionalGeral?: number;
};

type LinhaCusto = {
  nome: string;
  manual: number | null;
  mecanizada: number | null;
  adicionalManual?: number;
  adicionalMecanizada?: number;
  adicionalGeral?: number;
  destaque?: boolean;
};

type LinhaLocal = { objeto: string; custo: number; custoOracle: number; armazenado: boolean };
type SecaoLocal = { titulo: string; linhas: LinhaLocal[] };

function num(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function porTonelada(valor: number | null, moagem: number) {
  if (valor == null || !(moagem > 0)) return null;
  return valor / moagem;
}

function soma(lados: Lado[]): Lado {
  return lados.reduce(
    (acc, lado) => ({
      manual: acc.manual + lado.manual,
      mecanizada: acc.mecanizada + lado.mecanizada,
      adicionalManual: (acc.adicionalManual ?? 0) + (lado.adicionalManual ?? 0),
      adicionalMecanizada: (acc.adicionalMecanizada ?? 0) + (lado.adicionalMecanizada ?? 0),
      adicionalGeral: (acc.adicionalGeral ?? 0) + (lado.adicionalGeral ?? 0),
    }),
    { manual: 0, mecanizada: 0, adicionalManual: 0, adicionalMecanizada: 0, adicionalGeral: 0 },
  );
}

function custoDaLinha(linhas: { objeto: string; custo: number }[] | undefined, nome: string) {
  return linhas?.find((linha) => linha.objeto === nome)?.custo ?? 0;
}

function custoDoCodigo(linhas: { objeto: string; custo: number }[] | undefined, codigo: string) {
  return linhas?.find((linha) => linha.objeto.startsWith(`${codigo} `) || linha.objeto.startsWith(`${codigo}—`))?.custo ?? 0;
}

function ManualMecanizadoIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className="custo-colheita-card-icon-svg">
      <path d="M33 9V2m0 0-5 5m5-5 5 5" fill="none" stroke="#df675e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 23c0-4 6-7 14-7s14 3 14 7v25c0 5-6 9-14 9s-14-4-14-9V23Z" fill="#e5e8f0" stroke="#283b66" strokeWidth="2" />
      <ellipse cx="32" cy="23" rx="14" ry="7" fill="#f8f8f3" stroke="#283b66" strokeWidth="2" />
      <path d="M20 31c0 4 5 7 12 7s12-3 12-7M20 38c0 4 5 7 12 7s12-3 12-7M20 45c0 4 5 7 12 7s12-3 12-7" fill="none" stroke="#283b66" strokeWidth="2" />
      <circle cx="32" cy="23" r="8" fill="#fff" stroke="#283b66" strokeWidth="1.7" />
      <text x="32" y="26" textAnchor="middle" fontSize="8" fontWeight="700" fill="#283b66">R$</text>
    </svg>
  );
}

export function CustoColheitaPanel({
  safraId,
  safraLabel,
  anoSafra,
  anomesInicio,
  anomesFim,
}: {
  safraId?: number;
  safraLabel: string;
  anoSafra: number;
  anomesInicio: number;
  anomesFim: number;
}) {
  const [inicio, setInicio] = useState(String(anomesInicio));
  const [fim, setFim] = useState(String(anomesFim));
  const [periodo, setPeriodo] = useState({ inicio: String(anomesInicio), fim: String(anomesFim) });
  const [secoes, setSecoes] = useState<SecaoLocal[]>([]);
  const [oracleConsultado, setOracleConsultado] = useState(false);
  const [linhas, setLinhas] = useState<LinhaCusto[]>([]);
  const [moagemLj, setMoagemLj] = useState(0);
  const [custoAdministracaoAgricolaManualPorTonelada, setCustoAdministracaoAgricolaManualPorTonelada] = useState(0);
  const [custoAdministracaoAgricolaMecanizadaPorTonelada, setCustoAdministracaoAgricolaMecanizadaPorTonelada] = useState(0);
  const [custoAdministracaoAgricolaTotal, setCustoAdministracaoAgricolaTotal] = useState(0);
  const [moagemOracle, setMoagemOracle] = useState(0);
  const [tonelagemManual, setTonelagemManual] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [consultado, setConsultado] = useState(false);
  const canEdit = useCanEditItems();
  const buscaSeq = useRef(0);

  function aplicarSecoes(
    nextSecoes: SecaoLocal[],
    administrativoAgricola = {
      manual: custoAdministracaoAgricolaManualPorTonelada,
      mecanizada: custoAdministracaoAgricolaMecanizadaPorTonelada,
    },
  ) {
        setSecoes(nextSecoes);
        const mecanizada = nextSecoes.find((secao) => secao.titulo === "Colheita mecanizada");
        const manual = nextSecoes.find((secao) => secao.titulo === "Colheita manual");
        const corte = { manual: custoDaLinha(manual?.linhas, "Corte"), mecanizada: custoDaLinha(mecanizada?.linhas, "Corte") };
        const carregamento = {
          manual: custoDaLinha(manual?.linhas, "Carregamento"),
          mecanizada: custoDaLinha(mecanizada?.linhas, "Carregamento"),
        };
        const apoio = { manual: 0, mecanizada: custoDoCodigo(mecanizada?.linhas, "85") };
        const administrativo = {
          manual: custoDaLinha(manual?.linhas, "Administrativo"),
          mecanizada: custoDoCodigo(mecanizada?.linhas, "266"),
          adicionalManual: administrativoAgricola.manual,
          adicionalMecanizada: administrativoAgricola.mecanizada,
          adicionalGeral: administrativoAgricola.manual + administrativoAgricola.mecanizada,
        };
        const bitucas = { manual: custoDaLinha(manual?.linhas, "Catação de bitucas"), mecanizada: 0 };
        const transporte = {
          manual: custoDaLinha(manual?.linhas, "Transporte"),
          mecanizada: custoDaLinha(mecanizada?.linhas, "Transporte"),
        };
        const cta = soma([corte, carregamento, apoio, administrativo, bitucas]);
        const ctta = soma([cta, transporte]);
    setLinhas([
      { nome: "Corte", ...corte },
      { nome: "Carregamento/transbordo", ...carregamento },
      { nome: "Embolação/Tombo", manual: null, mecanizada: null },
      { nome: "Operações de apoio", ...apoio },
      { nome: "Administrativo", ...administrativo },
      { nome: "Catação de bitucas", ...bitucas },
      { nome: "CTA", ...cta, destaque: true },
      { nome: "Transporte de cana", ...transporte },
      { nome: "CTTA", ...ctta, destaque: true },
      { nome: "Raio médio (km)", manual: null, mecanizada: null },
    ]);
  }

  function aplicarFicha(ficha: Awaited<ReturnType<typeof api.custoColheita>>) {
    const custoAdmAgricolaTotal = ficha.custoAdministracaoAgricola ?? 0;
    const custoAdmAgricolaManual = ficha.custoAdministracaoAgricolaManual ?? 0;
    const custoAdmAgricolaMecanizada = ficha.custoAdministracaoAgricolaMecanizada ?? 0;
    const toneladasMoagemOracle = ficha.moagemOracle ?? 0;
    const custoAdmAgricolaManualPorTonelada = toneladasMoagemOracle > 0 ? custoAdmAgricolaManual / toneladasMoagemOracle : 0;
    const custoAdmAgricolaMecanizadaPorTonelada = toneladasMoagemOracle > 0 ? custoAdmAgricolaMecanizada / toneladasMoagemOracle : 0;
    setCustoAdministracaoAgricolaManualPorTonelada(custoAdmAgricolaManualPorTonelada);
    setCustoAdministracaoAgricolaMecanizadaPorTonelada(custoAdmAgricolaMecanizadaPorTonelada);
    setCustoAdministracaoAgricolaTotal(custoAdmAgricolaTotal);
    setMoagemOracle(toneladasMoagemOracle);
    setOracleConsultado(ficha.oracleConsultado);
    if (ficha.cacheDesatualizado) {
      setCacheInfo("Oracle indisponível; exibindo o último resultado em cache, que pode estar desatualizado.");
    } else if (ficha.cacheOracle && ficha.oracleAtualizadoEm) {
      setCacheInfo(`Resultado Oracle em cache desde ${new Date(ficha.oracleAtualizadoEm).toLocaleString("pt-BR")}.`);
    } else if (ficha.oracleConsultado && ficha.oracleAtualizadoEm) {
      setCacheInfo(`Consulta Oracle atualizada em ${new Date(ficha.oracleAtualizadoEm).toLocaleString("pt-BR")}.`);
    } else {
      setCacheInfo(null);
    }
    aplicarSecoes(ficha.secoes, {
      manual: custoAdmAgricolaManualPorTonelada,
      mecanizada: custoAdmAgricolaMecanizadaPorTonelada,
    });
  }

  function buscar(anomesDe: string, anomesAte: string, atualizarOracle = false) {
    const seq = ++buscaSeq.current;
    setCarregando(true);
    setErro(null);
    setPeriodo({ inicio: anomesDe, fim: anomesAte });
    Promise.all([
      api.custoColheita({ safraId, anomesInicio: anomesDe, anomesFim: anomesAte, preferirLocal: true, atualizarOracle }),
      api.parametrosTecnicos(safraId, anomesDe, anomesAte).catch(() => null),
    ])
      .then(([ficha, parametros]) => {
        if (seq !== buscaSeq.current) return;
        aplicarFicha(ficha);
        setMoagemLj(parametros?.armazenado ? parametros.moagemLj || 0 : 0);
        setTonelagemManual(parametros?.armazenado ? parametros.tonelagemManual || 0 : 0);
        setMensagem(null);
        setConsultado(true);
      })
      .catch((e) => {
        if (seq === buscaSeq.current) setErro(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (seq === buscaSeq.current) setCarregando(false);
      });
  }

  useEffect(() => {
    setInicio(String(anomesInicio));
    setFim(String(anomesFim));
    setConsultado(false);
    setSecoes([]);
    setOracleConsultado(false);
    setLinhas([]);
    setMoagemLj(0);
    setCustoAdministracaoAgricolaManualPorTonelada(0);
    setCustoAdministracaoAgricolaMecanizadaPorTonelada(0);
    setCustoAdministracaoAgricolaTotal(0);
    setMoagemOracle(0);
    setTonelagemManual(0);
    setErro(null);
    setMensagem(null);
    setCacheInfo(null);
    setCarregando(false);
    setSalvando(false);
    buscaSeq.current += 1;
  }, [anomesInicio, anomesFim, anoSafra, safraId]);

  function alterarCusto(secaoTitulo: string, objeto: string, raw: string) {
    const value = Number(raw.replace(/\./g, "").replace(",", "."));
    const next = secoes.map((secao) =>
        secao.titulo !== secaoTitulo
          ? secao
          : {
              ...secao,
              linhas: secao.linhas.map((linha) =>
                linha.objeto !== objeto
                  ? linha
                  : { ...linha, custo: Number.isFinite(value) ? value : 0, armazenado: true },
              ),
            },
      );
    aplicarSecoes(next);
  }

  function atualizarOracleAgora() {
    if (!/^\d{6}$/.test(inicio.trim()) || !/^\d{6}$/.test(fim.trim())) {
      setErro("Informe o anomes inicial e final no formato YYYYMM.");
      return;
    }
    buscar(inicio.trim(), fim.trim(), true);
  }

  async function salvarLocal() {
    setSalvando(true);
    setErro(null);
    setMensagem(null);
    try {
      await api.salvarCustoColheita({
        safraId,
        anomesInicio: periodo.inicio,
        anomesFim: periodo.fim,
        secoes: secoes.map((secao) => ({
          titulo: secao.titulo,
          linhas: secao.linhas.map((linha) => ({ objeto: linha.objeto, custo: linha.custo })),
        })),
      });
      setMensagem("Custo de colheita armazenado localmente.");
      buscar(periodo.inicio, periodo.fim);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  const filtro = (
    <form
      className="custo-colheita-filtro"
      onSubmit={(event) => {
        event.preventDefault();
        if (!/^\d{6}$/.test(inicio.trim()) || !/^\d{6}$/.test(fim.trim())) {
          setErro("Informe o anomes inicial e final no formato YYYYMM.");
          return;
        }
        setErro(null);
        buscar(inicio.trim(), fim.trim());
      }}
    >
      <label>
        Anomes inicial
        <input value={inicio} onChange={(event) => setInicio(event.target.value)} inputMode="numeric" placeholder="Ex.: 202509" />
      </label>
      <label>
        Anomes final
        <input value={fim} onChange={(event) => setFim(event.target.value)} inputMode="numeric" placeholder="Ex.: 202608" />
      </label>
      <button type="submit" className="btn primary" disabled={carregando}>
        {carregando ? "Consultando…" : "Consultar"}
      </button>
      <button type="button" className="btn" onClick={atualizarOracleAgora} disabled={carregando}>
        Atualizar do Oracle
      </button>
    </form>
  );

  const cta = linhas.find((linha) => linha.nome === "CTA");
  const toneladasManual = tonelagemManual;
  const diferenca =
    cta && toneladasManual > 0 && moagemLj > 0
      ? (porTonelada(cta.manual, toneladasManual) ?? 0) - (porTonelada(cta.mecanizada, moagemLj) ?? 0)
      : null;
  return (
    <section className="custo-colheita">
      <h2>Custo para colher 1 t de cana</h2>
      {filtro}
      {erro ? <p className="lead">{erro}</p> : null}
      {mensagem ? <p className="lead">{mensagem}</p> : null}
      {carregando ? <p className="lead">Consultando custo de colheita…</p> : null}
      {!consultado && !carregando ? (
        <p className="lead">Informe o período e clique em Consultar.</p>
      ) : null}
      {consultado ? (
        <>
      <p className="custo-colheita-nota">
        {safraLabel}, {periodo.inicio} a {periodo.fim}. Custo lançado dividido pela moagem LJ
        {moagemLj > 0 ? ` (${num(moagemLj)} t)` : ""}
        {tonelagemManual > 0 ? ` e pela tonelagem manual do Estágio de produção (${num(tonelagemManual)} t)` : ""}. Administração agrícola usa o rateio para os objetos 72 (Manual) e 266 (Mecanizada), dividido pela Moagem Oracle.
      </p>
      {custoAdministracaoAgricolaTotal > 0 ? (
        <p className="custo-colheita-nota">
          {moagemOracle > 0
            ? `Administração agrícola rateada: R$ ${num(custoAdministracaoAgricolaTotal)} (obj. 72 Manual: R$ ${num(custoAdministracaoAgricolaManual)}; obj. 266 Mecanizada: R$ ${num(custoAdministracaoAgricolaMecanizada)}) ÷ Moagem Oracle ${num(moagemOracle)} t = R$ ${num(custoAdministracaoAgricolaManualPorTonelada + custoAdministracaoAgricolaMecanizadaPorTonelada)}/t no Geral.`
            : `Custo de Administração agrícola: R$ ${num(custoAdministracaoAgricolaTotal)}. A Moagem Oracle não foi retornada para calcular o R$/t.`}
        </p>
      ) : null}
      {cacheInfo ? <p className="custo-colheita-nota">{cacheInfo}</p> : null}
      {!moagemLj ? (
        <p className="custo-colheita-nota">Armazene a moagem LJ nos parâmetros técnicos para calcular o R$/t.</p>
      ) : null}
      {!tonelagemManual ? (
        <p className="custo-colheita-nota">
          Armazene a tonelagem manual na tela Estágio de produção para calcular a coluna Manual.
        </p>
      ) : null}
      <ReadOnlyFieldset>
        <div className="custo-colheita-layout">
          {secoes.map((secao) => (
            <table key={secao.titulo} className="custo-colheita-tabela">
              <thead>
                <tr>
                  <th colSpan={4}>{secao.titulo} — custos base (R$)</th>
                </tr>
                <tr>
                  <th>Objeto</th>
                  <th>Oracle</th>
                  <th>Local</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {secao.linhas.map((linha) => (
                  <tr key={`${secao.titulo}-${linha.objeto}`}>
                    <th>{linha.objeto}</th>
                    <td>{oracleConsultado ? num(linha.custoOracle) : "Não consultado"}</td>
                    <td>
                      <input
                        value={String(linha.custo).replace(".", ",")}
                        onChange={(event) => alterarCusto(secao.titulo, linha.objeto, event.target.value)}
                        inputMode="decimal"
                        aria-label={`Custo local ${linha.objeto}`}
                      />
                    </td>
                    <td>{linha.armazenado ? "Local" : "Oracle"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
        <p className="custo-colheita-nota">
          <button type="button" className="btn primary" onClick={salvarLocal} disabled={!canEdit || salvando || carregando}>
            {salvando ? "Salvando…" : "Armazenar localmente"}
          </button>
        </p>
      </ReadOnlyFieldset>
      <div className="custo-colheita-layout">
        <table className="custo-colheita-tabela">
          <thead>
            <tr>
              <th>R$/t</th>
              <th>Manual</th>
              <th>Mecanizado</th>
              <th>Geral</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => {
              const manualBase = porTonelada(linha.manual, toneladasManual);
              const mecanizadaBase = porTonelada(linha.mecanizada, moagemLj);
              const manual = manualBase == null && !linha.adicionalManual ? null : (manualBase ?? 0) + (linha.adicionalManual ?? 0);
              const mecanizada = mecanizadaBase == null && !linha.adicionalMecanizada ? null : (mecanizadaBase ?? 0) + (linha.adicionalMecanizada ?? 0);
              const geralBase = porTonelada((linha.manual ?? 0) + (linha.mecanizada ?? 0), moagemLj);
              const adicionalGeral = linha.adicionalGeral ?? 0;
              const geral =
                linha.manual == null && linha.mecanizada == null
                  ? null
                  : geralBase == null && adicionalGeral === 0
                    ? null
                    : (geralBase ?? 0) + adicionalGeral;
              return (
                <tr key={linha.nome} className={linha.destaque ? "custo-colheita-destaque" : undefined}>
                  <th>{linha.nome}</th>
                  <td>{num(manual)}</td>
                  <td>{num(mecanizada)}</td>
                  <td>{num(geral)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="custo-colheita-cards">
          <article className="custo-colheita-card">
            <div className="custo-colheita-card-main">
              <span className="custo-colheita-card-icon"><ManualMecanizadoIcon /></span>
              <div className="custo-colheita-card-metric">
                <strong>{diferenca == null ? "—" : `${diferenca > 0 ? "+" : ""}${num(diferenca)}`}</strong>
                <span>R$/t</span>
              </div>
            </div>
            <small>Manual vs. Mecanizado</small>
          </article>
        </div>
      </div>
        </>
      ) : null}
    </section>
  );
}
