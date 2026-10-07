export const DIAS_HISTORICOS_CAPACIDADE = 7;

export function addIsoDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function money(n: number) {
  return Math.round((n || 0) * 100) / 100;
}

export type CapacidadeColhedorasInput = {
  toneladasPorDia: Iterable<{ dia: string; toneladas: number }>;
  horasTrabalhadasPorDia: Iterable<{ dia: string; horas: number }>;
  periodoInicio: string;
  periodoFim: string;
  horasMaquinaDisponiveis: number;
  realizado: number;
  hoje: string;
  diasHistoricos?: number;
};

export type CapacidadeColhedorasResult = {
  produtividadeHistoricaTh: number | null;
  diasHistoricosUsados: number;
  horasHistoricas: number;
  toneladasHistoricas: number;
  horasMaquinaDisponiveis: number;
  capacidadeEstimada: number | null;
  periodoEncerrado: boolean;
  capacidadeInconsistente: boolean;
};

/**
 * Capacidade = produtividade histórica (t / hora-máquina) × horas-máquina disponíveis.
 * Não usa a produção do próprio período para extrapolar a jornada.
 */
export function calcularCapacidadeColhedoras(input: CapacidadeColhedorasInput): CapacidadeColhedorasResult {
  const limite = input.diasHistoricos ?? DIAS_HISTORICOS_CAPACIDADE;
  const histFim = addIsoDays(input.periodoInicio, -1);
  const horasPorDia = new Map<string, number>();
  for (const row of input.horasTrabalhadasPorDia) {
    if (!row.dia || !(row.horas > 0)) continue;
    horasPorDia.set(row.dia, (horasPorDia.get(row.dia) ?? 0) + row.horas);
  }

  const validos: Array<{ dia: string; toneladas: number; horas: number }> = [];
  for (const row of input.toneladasPorDia) {
    if (!row.dia || row.dia > histFim || !(row.toneladas > 0)) continue;
    const horas = horasPorDia.get(row.dia) ?? 0;
    if (!(horas > 0)) continue;
    validos.push({ dia: row.dia, toneladas: row.toneladas, horas });
  }
  validos.sort((a, b) => b.dia.localeCompare(a.dia));
  const amostra = validos.slice(0, Math.max(1, limite));
  const toneladasHistoricas = amostra.reduce((acc, row) => acc + row.toneladas, 0);
  const horasHistoricas = amostra.reduce((acc, row) => acc + row.horas, 0);
  const produtividadeHistoricaTh =
    horasHistoricas > 0 ? money(toneladasHistoricas / horasHistoricas) : null;
  const horasMaquinaDisponiveis = Math.max(0, input.horasMaquinaDisponiveis || 0);
  const capacidadeEstimada =
    produtividadeHistoricaTh != null && horasMaquinaDisponiveis > 0
      ? money(produtividadeHistoricaTh * horasMaquinaDisponiveis)
      : null;
  const periodoEncerrado = Boolean(input.periodoFim && input.hoje && input.periodoFim < input.hoje);
  const capacidadeInconsistente = Boolean(
    periodoEncerrado &&
      capacidadeEstimada != null &&
      input.realizado > capacidadeEstimada + 0.5,
  );

  return {
    produtividadeHistoricaTh,
    diasHistoricosUsados: amostra.length,
    horasHistoricas: money(horasHistoricas),
    toneladasHistoricas: money(toneladasHistoricas),
    horasMaquinaDisponiveis: money(horasMaquinaDisponiveis),
    capacidadeEstimada,
    periodoEncerrado,
    capacidadeInconsistente,
  };
}

export type CausaNaoAtingimento = {
  chave: "capacidade" | "execucao";
  label: string;
  toneladas: number;
  pct: number;
};

export type NaoAtingimentoMeta = {
  gap: number;
  atingiu: boolean;
  realizado: number;
  cota: number;
  causas: CausaNaoAtingimento[];
};

/** Quebra o déficit da cota em frota/horas insuficientes vs. perda operacional. */
export function decomporNaoAtingimentoMeta(input: {
  cota: number | null | undefined;
  realizado: number | null | undefined;
  capacidadeEstimada: number | null | undefined;
}): NaoAtingimentoMeta {
  const cota = input.cota != null && Number.isFinite(input.cota) ? Math.max(0, input.cota) : 0;
  const realizado = input.realizado != null && Number.isFinite(input.realizado) ? Math.max(0, input.realizado) : 0;
  const cap =
    input.capacidadeEstimada != null && Number.isFinite(input.capacidadeEstimada)
      ? Math.max(0, input.capacidadeEstimada)
      : null;
  const gap = money(Math.max(0, cota - realizado));
  const atingiu = !(cota > 0) || gap <= 0.5;
  if (!(cota > 0) || atingiu) {
    return { gap: 0, atingiu: true, realizado: money(realizado), cota: money(cota), causas: [] };
  }

  const perdaCapacidade =
    cap != null ? money(Math.max(0, Math.min(gap, cota - Math.max(cap, realizado)))) : 0;
  const perdaExecucao = money(Math.max(0, gap - perdaCapacidade));
  const causas: CausaNaoAtingimento[] = [];
  if (perdaCapacidade > 0.5) {
    causas.push({
      chave: "capacidade",
      label: "Frota/horas insuficientes",
      toneladas: perdaCapacidade,
      pct: money((perdaCapacidade / gap) * 100),
    });
  }
  if (perdaExecucao > 0.5) {
    causas.push({
      chave: "execucao",
      label: "Abaixo da capacidade (paradas/ociosidade)",
      toneladas: perdaExecucao,
      pct: money((perdaExecucao / gap) * 100),
    });
  }
  if (!causas.length) {
    causas.push({
      chave: "execucao",
      label: "Não atingiu a cota",
      toneladas: gap,
      pct: 100,
    });
  }
  return { gap, atingiu: false, realizado: money(realizado), cota: money(cota), causas };
}
