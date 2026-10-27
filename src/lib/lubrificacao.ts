export type LubrificacaoSituacao = "em_dia" | "a_vencer" | "vencido" | "em_execucao" | "sem_plano";

export type LubrificacaoEquipamentoOpcao = {
  codEquipamento: number;
  descricao: string | null;
  kmAtual: number | null;
};

export type LubrificacaoPonto = {
  codigo: number;
  descricao: string;
  ultmKmHrTroca: number | null;
  limiteTroca: number | null;
  kmHrRodado: number | null;
  dataUltmTroca: string | null;
  tempoMedioDias: number | null;
  dataEstimada: string | null;
  situacao: LubrificacaoSituacao;
};

export type LubrificacaoMaterial = {
  codigo: number;
  descricao: string;
  materialDescricao: string;
  quantidade: number | null;
};

export type LubrificacaoMensal = {
  mes: string;
  label: string;
  estimado: number;
  lancamentos: number;
  realizado: number;
};

export type LubrificacaoPorTipo = {
  tipo: string;
  estimado: number;
  realizado: number;
};

export type LubrificacaoCalendarioDia = {
  dia: number;
  quantidade: number;
};

export type LubrificacaoResumoFrota = {
  eficiencia: number | null;
  quantidadeEstimada: number;
  quantidadeLancamentos: number;
  quantidadeRealizada: number;
  mensal: LubrificacaoMensal[];
  porTipo: LubrificacaoPorTipo[];
  calendario: LubrificacaoCalendarioDia[];
};

export type LubrificacaoDashboardData = {
  atualizadoEm: string;
  equipamentos: LubrificacaoEquipamentoOpcao[];
  codEquipamento: number | null;
  kmAtual: number | null;
  pontos: LubrificacaoPonto[];
  materiais: LubrificacaoMaterial[];
  eficiencia: number | null;
  alerta: string | null;
  mensal: LubrificacaoMensal[];
  resumoFrota: LubrificacaoResumoFrota;
};

export function lubrificacaoSituacaoLabel(status: LubrificacaoSituacao) {
  switch (status) {
    case "vencido":
      return "Vencido";
    case "a_vencer":
      return "A vencer";
    case "em_dia":
      return "Em dia";
    case "em_execucao":
      return "Em execução";
    default:
      return "Sem histórico";
  }
}

export function lubrificacaoMesLabel(mes: string) {
  const [y, m] = mes.split("-");
  const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${names[idx]}/${y}` : mes;
}

export function lubrificacaoEficiencia(realizado: number, estimado: number) {
  if (!(estimado > 0)) return null;
  return (realizado / estimado) * 100;
}
