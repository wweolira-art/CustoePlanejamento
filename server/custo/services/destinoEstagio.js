/** Classificação compartilhada pelo estágio de produção e pela matriz de rateio. */
export function destinoEstagio(linha, meta, coluna) {
  if (linha.destProcesso === 4 || linha.origProcesso === 4) return 'irrigacao';
  if (!coluna) {
    if (meta?.chave === 'royalties') return 'arrendamento';
    const descricao = String(linha.destDescricao || '').toUpperCase();
    if (linha.destProcesso === 5 || /SEMENTE|MUDA|CORTE DE|CORTE SEMENT/.test(descricao)) return 'colheitaMudas';
    return 'administrativo';
  }
  if (linha.destProcesso === 5) return 'colheitaMudas';
  if (meta?.chave === 'royalties') return 'arrendamento';
  if (meta?.secao === 'adm') return 'administrativo';
  if (coluna === 'colheita_mudas') return 'colheitaMudas';
  if (coluna === 'preparo') {
    const descricao = `${linha.destDescricao || ''} ${linha.itemDescricao || ''}`.toUpperCase();
    return descricao.includes('CONSERV') ? 'conservacao' : 'preparo';
  }
  if (coluna === 'plantio') return 'plantio';
  if (coluna === 'tratos_planta') return 'tratosPlanta';
  if (coluna === 'tratos_soca') return linha.destProcesso === 3 ? 'colheita' : 'manutencao';
  return 'administrativo';
}

export function colunaRateioEstagio(destino) {
  return {
    conservacao: 'preparo',
    preparo: 'preparo',
    plantio: 'plantio',
    tratosPlanta: 'tratos_planta',
    colheitaMudas: 'colheita_mudas',
    manutencao: 'tratos_soca',
    colheita: 'colheita',
    irrigacao: 'irrigacao',
    administrativo: 'administrativo',
    arrendamento: 'arrendamento',
  }[destino] ?? null;
}
