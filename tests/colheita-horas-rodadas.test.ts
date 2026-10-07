import assert from "node:assert/strict";
import { test } from "node:test";
import { anexarHorasRodadas } from "../src/lib/colheita-horas-rodadas.ts";

test("horas rodadas usam diferenca entre leituras consecutivas do equipamento", () => {
  const rows = anexarHorasRodadas([
    { id: 1, data: "2026-09-01", codEquipamento: 5001, horaMotor: 100, horasElevador: 10, turno: "A" },
    { id: 2, data: "2026-09-01", codEquipamento: 5001, horaMotor: 104, horasElevador: 12, turno: "B" },
    { id: 3, data: "2026-09-02", codEquipamento: 5001, horaMotor: 110, horasElevador: 15, turno: "A" },
  ]);

  assert.equal(rows[0]!.horasMotorRodadas, null);
  assert.equal(rows[0]!.horasElevadorRodadas, null);
  assert.equal(rows[1]!.horasMotorRodadas, 4);
  assert.equal(rows[1]!.horasElevadorRodadas, 2);
  assert.equal(rows[2]!.horasMotorRodadas, 6);
  assert.equal(rows[2]!.horasElevadorRodadas, 3);
});

test("horimetro menor posterior nao gera hora rodada negativa", () => {
  const rows = anexarHorasRodadas([
    { id: 1, data: "2026-09-01", codEquipamento: 5002, horaMotor: 100, horasElevador: 50, turno: "A" },
    { id: 2, data: "2026-09-02", codEquipamento: 5002, horaMotor: 98, horasElevador: 49, turno: "A" },
  ]);

  assert.equal(rows[1]!.horasMotorRodadas, 0);
  assert.equal(rows[1]!.horasElevadorRodadas, 0);
});
