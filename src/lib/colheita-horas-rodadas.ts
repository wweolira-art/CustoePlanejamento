export type HorasLeitura = {
  id: number | null;
  codEquipamento: number | null;
  data: string | null;
  horaMotor: number | null;
  horasElevador: number | null;
  turno: string | null;
};

export type HorasLeituraComRodadas = HorasLeitura & {
  horasMotorRodadas: number | null;
  horasElevadorRodadas: number | null;
};

function rowOrderKey(row: HorasLeitura) {
  const data = String(row.data ?? "");
  const turno = String(row.turno ?? "").trim().toUpperCase();
  const id = row.id ?? 0;
  return `${data} ${turno.padStart(3, " ")} ${String(id).padStart(12, "0")}`;
}

function delta(atual: number | null, anterior: number | null): number | null {
  if (atual == null || !Number.isFinite(atual) || anterior == null || !Number.isFinite(anterior)) return null;
  return Math.max(0, atual - anterior);
}

/**
 * Horas rodadas por leitura = diferença vs. a leitura anterior do mesmo equipamento
 * (ordenado por data, turno e id). A primeira leitura do equipamento fica sem rodadas.
 */
export function anexarHorasRodadas(rows: HorasLeitura[]): HorasLeituraComRodadas[] {
  const porEquip = new Map<number, HorasLeitura[]>();
  for (const row of rows) {
    if (row.codEquipamento == null) continue;
    const list = porEquip.get(row.codEquipamento) ?? [];
    list.push(row);
    porEquip.set(row.codEquipamento, list);
  }

  const rodadas = new Map<HorasLeitura, { motor: number | null; elevador: number | null }>();
  for (const leituras of porEquip.values()) {
    const ordenadas = leituras.slice().sort((a, b) => rowOrderKey(a).localeCompare(rowOrderKey(b)));
    for (let i = 0; i < ordenadas.length; i++) {
      const atual = ordenadas[i]!;
      const anterior = i > 0 ? ordenadas[i - 1]! : null;
      rodadas.set(atual, {
        motor: anterior ? delta(atual.horaMotor, anterior.horaMotor) : null,
        elevador: anterior ? delta(atual.horasElevador, anterior.horasElevador) : null,
      });
    }
  }

  return rows.map((row) => {
    const calc = rodadas.get(row);
    return {
      ...row,
      horasMotorRodadas: calc?.motor ?? null,
      horasElevadorRodadas: calc?.elevador ?? null,
    };
  });
}
