import assert from "node:assert/strict";
import { test } from "node:test";
import { calcularHorasRodadasPorEquipamento } from "../server/indicadores/colheita-producao.js";
import type { HorasMaquinaRow } from "../server/colheita/horas-maquina.js";

test("horas motor e elevador usam diferenca do horimetro por equipamento", () => {
  const rows: HorasMaquinaRow[] = [
    { id: 1, data: "2026-09-01", codEquipamento: 5001, horaMotor: 18791, horasElevador: 1810, turno: "A" },
    { id: 2, data: "2026-09-01", codEquipamento: 5001, horaMotor: 18795, horasElevador: 1815, turno: "B" },
    { id: 3, data: "2026-09-02", codEquipamento: 5001, horaMotor: 18800, horasElevador: 1819, turno: "A" },
  ];

  assert.deepEqual(calcularHorasRodadasPorEquipamento(rows).get(5001), {
    motor: 9,
    elevador: 9,
  });
});

test("horimetro menor posterior nao gera hora negativa", () => {
  const rows: HorasMaquinaRow[] = [
    { id: 1, data: "2026-09-01", codEquipamento: 5002, horaMotor: 100, horasElevador: 50, turno: "A" },
    { id: 2, data: "2026-09-02", codEquipamento: 5002, horaMotor: 98, horasElevador: 49, turno: "A" },
  ];

  assert.deepEqual(calcularHorasRodadasPorEquipamento(rows).get(5002), {
    motor: 0,
    elevador: 0,
  });
});
