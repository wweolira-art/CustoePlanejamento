/** Último dia incluso no período (Até). Equivalente a SQL `< DATE 'YYYY-09-01'`. */
export function normalizePeriodoColheita(dataInicio: string | null, dataFim: string | null) {
  if (!dataInicio || !dataFim) return { dataInicio, dataFim };

  const iniMatch = dataInicio.match(/^(\d{4})-09-01$/);
  const fimMatch = dataFim.match(/^(\d{4})-09-01$/);
  if (iniMatch && fimMatch && Number(fimMatch[1]) === Number(iniMatch[1]) + 1) {
    return { dataInicio, dataFim: `${fimMatch[1]}-08-31` };
  }

  return { dataInicio, dataFim };
}

export function sqlFiltroPeriodoTrunc(coluna: string) {
  return `TRUNC(${coluna}) >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
            AND TRUNC(${coluna}) < TO_DATE(:dataFim, 'YYYY-MM-DD') + 1`;
}

export function matchPeriodoDia(dia: string | null, dataInicio: string | null, dataFim: string | null) {
  if (!dataInicio && !dataFim) return true;
  if (!dia) return false;
  if (dataInicio && dia < dataInicio) return false;
  if (dataFim && dia > dataFim) return false;
  return true;
}
