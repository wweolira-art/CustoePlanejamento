import { useEffect, useState } from "react";
import { api } from "../../api";

type FichaRow = {
  objeto: string;
  descricao: string;
  insumo: string;
  preco: number | null;
  dose: number | null;
  rHaInsumo: number | null;
  custo: number;
};

type Secao = {
  titulo: string;
  area: "plantio" | "soca";
  semInsumo?: boolean;
  linhas: FichaRow[];
  total: number;
};

type FichaView = "detalhada" | "resumida";

function num(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function rHa(valor: number, area: number) {
  return area > 0 && valor ? valor / area : null;
}

function limitarInsumos(grupo: FichaRow[]) {
  const operacoes = grupo.filter((row) => !row.insumo.trim());
  const porNome = new Map<string, FichaRow>();
  for (const row of grupo) {
    const nome = row.insumo.trim();
    if (!nome) continue;
    const atual = porNome.get(nome);
    if (!atual) {
      porNome.set(nome, { ...row, insumo: nome });
      continue;
    }
    atual.custo += row.custo;
    if (atual.preco !== row.preco) atual.preco = null;
    if (atual.dose !== row.dose) atual.dose = null;
    atual.rHaInsumo = atual.preco != null && atual.dose != null ? atual.preco * atual.dose : null;
    if (atual.descricao !== row.descricao) atual.descricao = "";
  }
  const insumos = [...porNome.values()].sort(
    (a, b) => Math.abs(b.custo) - Math.abs(a.custo) || a.insumo.localeCompare(b.insumo, "pt-BR"),
  );
  if (insumos.length <= 4) return [...operacoes, ...insumos];
  const resto = insumos.slice(4);
  const outros: FichaRow = {
    objeto: grupo[0]?.objeto ?? "",
    descricao: "",
    insumo: "Outros insumos",
    preco: null,
    dose: null,
    rHaInsumo: null,
    custo: resto.reduce((sum, row) => sum + row.custo, 0),
  };
  return [...operacoes, ...insumos.slice(0, 4), outros];
}

function gruposPorObjeto(linhas: FichaRow[]) {
  const grupos: FichaRow[][] = [];
  const indice = new Map<string, number>();
  for (const row of linhas) {
    const chave = row.objeto.trim();
    if (!chave) {
      grupos.push([row]);
      continue;
    }
    const atual = indice.get(chave);
    if (atual == null) {
      indice.set(chave, grupos.length);
      grupos.push([row]);
    } else {
      grupos[atual].push(row);
    }
  }
  return grupos;
}

function mesclarGrupo(grupo: FichaRow[]) {
  const blocos: FichaRow[][] = [];
  const indice = new Map<string, number>();
  for (const row of grupo) {
    const chave = row.descricao.trim();
    if (!chave) {
      blocos.push([row]);
      continue;
    }
    const atual = indice.get(chave);
    if (atual == null) {
      indice.set(chave, blocos.length);
      blocos.push([row]);
    } else {
      blocos[atual].push(row);
    }
  }
  return blocos.flatMap((bloco, blocoIndex) =>
    bloco.map((row, index) => ({
      row,
      objetoSpan: blocoIndex === 0 && index === 0 ? grupo.length : 0,
      descricaoSpan: index === 0 ? bloco.length : 0,
    })),
  );
}

function imprimirFicha() {
  document.body.classList.add("print-ficha-estagio");
  const limpar = () => {
    document.body.classList.remove("print-ficha-estagio");
    window.removeEventListener("afterprint", limpar);
  };
  window.addEventListener("afterprint", limpar);
  window.print();
}

export function FichaCustoEstagio({
  areaPlantio,
  areaSoca,
  moagemLj,
  subtitulo,
  defaultView = "detalhada",
}: {
  areaPlantio: number;
  areaSoca: number;
  moagemLj: number;
  subtitulo?: string;
  defaultView?: FichaView;
}) {
  const [secoes, setSecoes] = useState<Secao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [view, setView] = useState<FichaView>(defaultView);

  useEffect(() => {
    let cancelled = false;
    api
      .fichaEstagio()
      .then((payload) => {
        if (!cancelled) setSecoes(payload.secoes);
      })
      .catch((e) => {
        if (!cancelled) setErro(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (erro) return <p className="lead">{erro}</p>;
  if (!secoes.length) return null;

  const totalGeral = secoes.reduce((sum, secao) => sum + secao.total, 0);

  return (
    <div className="ficha-estagio">
      <div className="ficha-estagio-print-bar no-print">
        <div className="kind-toggle ficha-estagio-tabs" role="tablist" aria-label="Visão da ficha de custo">
          <button
            type="button"
            role="tab"
            aria-selected={view === "detalhada"}
            className={`btn ${view === "detalhada" ? "primary" : ""}`}
            onClick={() => setView("detalhada")}
          >
            Ficha de custo
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "resumida"}
            className={`btn ${view === "resumida" ? "primary" : ""}`}
            onClick={() => setView("resumida")}
          >
            Orçamento resumido
          </button>
        </div>
        <button type="button" className="btn" onClick={imprimirFicha}>
          Imprimir
        </button>
      </div>
      <header className="ficha-estagio-print-header">
        <img src="/elejota-agro-logo.png" alt="Elejota Agro" className="liberacao-colheita-logo" />
        <div>
          <h2 className="liberacao-colheita-title">FICHA DE CUSTO POR ESTÁGIO</h2>
          {subtitulo ? <p className="ficha-estagio-print-sub">{subtitulo}</p> : null}
        </div>
        <div className="liberacao-colheita-brand-right">GRUPO LUIZ JATOBÁ</div>
      </header>
      {view === "resumida" ? (
        <section className="ficha-estagio-resumo">
          <div className="table-wrap">
            <table className="data resumo ficha-estagio-resumo-tabela">
              <thead>
                <tr>
                  <th className="left">Etapa</th>
                  <th className="left">Item</th>
                  <th>Base</th>
                  <th>R$/base</th>
                  <th>Orçamento</th>
                </tr>
              </thead>
              <tbody>
                {secoes.flatMap((secao) => {
                  const base = secao.semInsumo ? moagemLj : secao.area === "soca" ? areaSoca : areaPlantio;
                  const baseLabel = secao.semInsumo ? "t" : "ha";
                  const linhas = gruposPorObjeto(secao.linhas).map((grupo, index) => {
                    const custo = grupo.reduce((sum, row) => sum + row.custo, 0);
                    const objeto = grupo[0]?.objeto || grupo[0]?.descricao || "Sem objeto";
                    return (
                      <tr key={`${secao.titulo}-resumo-${index}`}>
                        <td className="left">{secao.titulo}</td>
                        <td className="left">{objeto}</td>
                        <td className="num">{base > 0 ? `${num(base)} ${baseLabel}` : "—"}</td>
                        <td className="num">{num(rHa(custo, base))}</td>
                        <td className="num">{num(custo)}</td>
                      </tr>
                    );
                  });
                  return [
                    ...linhas,
                    <tr className="ficha-estagio-resumo-total" key={`${secao.titulo}-resumo-total`}>
                      <td className="left" colSpan={3}>
                        Total {secao.titulo}
                      </td>
                      <td className="num">{num(rHa(secao.total, base))}</td>
                      <td className="num">{num(secao.total)}</td>
                    </tr>,
                  ];
                })}
                <tr className="total-geral">
                  <td className="left" colSpan={4}>Total geral</td>
                  <td className="num">{num(totalGeral)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : secoes.map((secao) => {
        const colunas = secao.semInsumo ? 8 : 12;
        return (
        <table key={secao.titulo} className="ficha-estagio-tabela">
          <thead>
            <tr>
              <th colSpan={colunas}>{secao.titulo}</th>
            </tr>
            <tr>
              <th rowSpan={2}>Objeto de custo</th>
              <th rowSpan={2}>R$/ha</th>
              <th rowSpan={2}>Descrição</th>
              <th colSpan={4}>Operação</th>
              {secao.semInsumo ? null : <th colSpan={4}>Insumo</th>}
              <th rowSpan={2}>Custo total</th>
            </tr>
            <tr>
              <th>R$/ha</th>
              <th>ha/h</th>
              <th>Rendimento</th>
              <th>R$/ha</th>
              {secao.semInsumo ? null : (
                <>
                  <th>Descrição</th>
                  <th>Preço</th>
                  <th>Dose</th>
                  <th>R$/ha</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {gruposPorObjeto(secao.linhas).map((grupo) => (secao.semInsumo ? grupo : limitarInsumos(grupo))).map((grupo, grupoIndex) =>
              mesclarGrupo(grupo).map((item, index) => {
              const row = item.row;
              const area = secao.area === "soca" ? areaSoca : areaPlantio;
              const totalObjeto = secao.semInsumo
                ? secao.linhas.reduce((sum, itemLinha) => sum + (itemLinha.objeto === row.objeto ? itemLinha.custo : 0), 0)
                : row.custo;
              const maquinaHa = secao.semInsumo
                ? rHa(totalObjeto, moagemLj)
                : row.objeto ? rHa(row.custo, area) : null;
              return (
                <tr key={`${secao.titulo}-${grupoIndex}-${index}`}>
                  {item.objetoSpan > 0 ? (
                    <td className="ficha-estagio-mescla" rowSpan={item.objetoSpan}>{row.objeto}</td>
                  ) : null}
                  <td className="num">{num(maquinaHa)}</td>
                  {item.descricaoSpan > 0 ? (
                    <td className="ficha-estagio-mescla" rowSpan={item.descricaoSpan}>{row.descricao}</td>
                  ) : null}
                  <td className="num" />
                  <td />
                  <td />
                  <td className="num" />
                  {secao.semInsumo ? null : (
                    <>
                      <td>{row.insumo}</td>
                      <td className="num">{num(row.preco)}</td>
                      <td className="num">{num(row.dose)}</td>
                      <td className="num">{num(row.rHaInsumo)}</td>
                    </>
                  )}
                  <td className="num">{num(row.custo)}</td>
                </tr>
              );
            }))}
            <tr className="ficha-estagio-total">
              <td colSpan={colunas - 1}>Total</td>
              <td className="num">{num(secao.total)}</td>
            </tr>
          </tbody>
        </table>
        );
      })}
    </div>
  );
}
