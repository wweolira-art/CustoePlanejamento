import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { ReadOnlyFieldset, useCanEditItems } from "../../lib/editAccess";

type Lado = { manual: number; mecanizada: number };

type LinhaCusto = {
  nome: string;
  manual: number | null;
  mecanizada: number | null;
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
    (acc, lado) => ({ manual: acc.manual + lado.manual, mecanizada: acc.mecanizada + lado.mecanizada }),
    { manual: 0, mecanizada: 0 },
  );
}

function custoDaLinha(linhas: { objeto: string; custo: number }[] | undefined, nome: string) {
  return linhas?.find((linha) => linha.objeto === nome)?.custo ?? 0;
}

function custoDoCodigo(linhas: { objeto: string; custo: number }[] | undefined, codigo: string) {
  return linhas?.find((linha) => linha.objeto.startsWith(`${codigo} `) || linha.objeto.startsWith(`${codigo}—`))?.custo ?? 0;
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
  const [tonelagemManual, setTonelagemManual] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [consultado, setConsultado] = useState(false);
  const canEdit = useCanEditItems();
  const buscaSeq = useRef(0);

  function aplicarSecoes(nextSecoes: SecaoLocal[]) {
        setSecoes(nextSecoes);
        const mecanizada = nextSecoes.find((secao) => secao.titulo === "Colheita mecanizada");
        const manual = nextSecoes.find((secao) => secao.titulo === "Colheita manual");
        const corte = { manual: custoDaLinha(manual?.linhas, "Corte"), mecanizada: custoDaLinha(mecanizada?.linhas, "Corte") };
        const carregamento = {
          manual: custoDaLinha(manual?.linhas, "Carregamento"),
          mecanizada: custoDaLinha(mecanizada?.linhas, "Carregamento"),
        };
        const apoio = { manual: 0, mecanizada: custoDoCodigo(mecanizada?.linhas, "85") };
        const administrativo = { manual: 0, mecanizada: custoDoCodigo(mecanizada?.linhas, "266") };
        const transporte = {
          manual: custoDaLinha(manual?.linhas, "Transporte"),
          mecanizada: custoDaLinha(mecanizada?.linhas, "Transporte"),
        };
        const cta = soma([corte, carregamento, apoio, administrativo]);
        const ctta = soma([cta, transporte]);
    setLinhas([
      { nome: "Corte", ...corte },
      { nome: "Carregamento/transbordo", ...carregamento },
      { nome: "Embolação/Tombo", manual: null, mecanizada: null },
      { nome: "Operações de apoio", ...apoio },
      { nome: "Administrativo", ...administrativo },
      { nome: "Catação de bitucas", manual: null, mecanizada: null },
      { nome: "CTA", ...cta, destaque: true },
      { nome: "Transporte de cana", ...transporte },
      { nome: "CTTA", ...ctta, destaque: true },
      { nome: "Raio médio (km)", manual: null, mecanizada: null },
    ]);
  }

  function aplicarFicha(ficha: Awaited<ReturnType<typeof api.custoColheita>>) {
    setOracleConsultado(ficha.oracleConsultado);
    aplicarSecoes(ficha.secoes);
  }

  function buscar(anomesDe: string, anomesAte: string) {
    const seq = ++buscaSeq.current;
    setCarregando(true);
    setErro(null);
    setPeriodo({ inicio: anomesDe, fim: anomesAte });
    Promise.all([
      api.custoColheita({ safraId, anomesInicio: anomesDe, anomesFim: anomesAte, preferirLocal: true }),
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
    setTonelagemManual(0);
    setErro(null);
    setMensagem(null);
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
      <button type="submit" className="btn primary">
        {carregando ? "Consultando…" : "Consultar"}
      </button>
    </form>
  );

  const cta = linhas.find((linha) => linha.nome === "CTA");
  const ctta = linhas.find((linha) => linha.nome === "CTTA");
  const toneladasManual = tonelagemManual;
  const diferenca =
    cta && toneladasManual > 0 && moagemLj > 0
      ? (porTonelada(cta.manual, toneladasManual) ?? 0) - (porTonelada(cta.mecanizada, moagemLj) ?? 0)
      : null;
  const custoManual = ctta?.manual ?? 0;
  const custoMec = ctta?.mecanizada ?? 0;
  const participacaoManual = custoManual + custoMec > 0 ? (custoManual / (custoManual + custoMec)) * 100 : null;

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
        {tonelagemManual > 0 ? ` e pela tonelagem manual do Estágio de produção (${num(tonelagemManual)} t)` : ""}. O geral divide o custo das duas colunas pela moagem LJ.
      </p>
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
              const manual = porTonelada(linha.manual, toneladasManual);
              const mecanizada = porTonelada(linha.mecanizada, moagemLj);
              const geral =
                linha.manual == null && linha.mecanizada == null
                  ? null
                  : porTonelada((linha.manual ?? 0) + (linha.mecanizada ?? 0), moagemLj);
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
          <article>
            <strong>{diferenca == null ? "—" : `${diferenca > 0 ? "+" : ""}${num(diferenca)}`}</strong>
            <span>R$/t</span>
            <small>CTA manual − mecanizado</small>
          </article>
          <article>
            <strong>{participacaoManual == null ? "—" : `${num(participacaoManual)} %`}</strong>
            <small>Participação do custo manual no CTTA</small>
          </article>
        </div>
      </div>
        </>
      ) : null}
    </section>
  );
}
