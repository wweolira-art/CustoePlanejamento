import type { CustoMatrizLinha, CustoMatrizSubprocessoData } from "../api";

const partesFormacao = new Set(["preparo", "plantio", "tratos_planta", "colheita_mudas"]);

export function origensDaCelula(data: CustoMatrizSubprocessoData, linha: CustoMatrizLinha, coluna: string) {
  return (data.origens ?? []).filter((origem) => {
    const mesmaColuna = coluna === "todas" || (coluna === "formacao" ? partesFormacao.has(origem.coluna) : origem.coluna === coluna);
    if (!mesmaColuna) return false;
    if (linha.tipo === "total") return true;
    if (linha.tipo === "subtotal") return origem.secao === linha.secao;
    return origem.linhaChave === linha.chave;
  }).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
}

export function composicaoPorColuna(data: CustoMatrizSubprocessoData, linha: CustoMatrizLinha) {
  const grupos = new Map<string, { chave: string; nome: string; celulas: Record<string, { valor: number; rHa: number | null; pct: number }> }>();
  for (const origem of origensDaCelula(data, linha, "todas")) {
    const chave = origem.origemObjeto != null ? String(origem.origemObjeto) : `sem-objeto:${origem.origemDescricao || ""}`;
    const descricao = origem.origemDescricao || "Objeto sem descrição";
    const nome = origem.origemObjeto != null ? `${origem.origemObjeto} · ${descricao}` : origem.origemDescricao || "Objeto de custo não informado";
    const grupo = grupos.get(chave) ?? { chave, nome, celulas: {} };
    if (origem.origemDescricao && origem.origemObjeto != null) grupo.nome = nome;
    for (const coluna of data.colunas) {
      if (coluna.key !== origem.coluna && !(coluna.key === "formacao" && partesFormacao.has(origem.coluna))) continue;
      const valor = (grupo.celulas[coluna.key]?.valor ?? 0) + origem.valor;
      grupo.celulas[coluna.key] = {
        valor,
        rHa: coluna.hectareas > 0 ? valor / coluna.hectareas : null,
        pct: coluna.total !== 0 ? valor / coluna.total * 100 : 0,
      };
    }
    grupos.set(chave, grupo);
  }
  return [...grupos.values()];
}
