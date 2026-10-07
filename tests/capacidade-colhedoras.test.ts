import assert from "node:assert/strict";
import { test } from "node:test";
import { calcularCapacidadeColhedoras, decomporNaoAtingimentoMeta } from "../src/lib/capacidade-colhedoras.js";

test("capacidade usa t/h histórico e horas disponíveis, sem extrapolar o próprio dia", () => {
  const result = calcularCapacidadeColhedoras({
    toneladasPorDia: [
      { dia: "2026-09-12", toneladas: 1100 },
      { dia: "2026-09-13", toneladas: 1250 },
      { dia: "2026-09-14", toneladas: 1300 },
      { dia: "2026-09-15", toneladas: 1320.16 },
    ],
    horasTrabalhadasPorDia: [
      { dia: "2026-09-12", horas: 50 },
      { dia: "2026-09-13", horas: 52 },
      { dia: "2026-09-14", horas: 54 },
      { dia: "2026-09-15", horas: 31.7 },
    ],
    periodoInicio: "2026-09-15",
    periodoFim: "2026-09-15",
    horasMaquinaDisponiveis: 60,
    realizado: 1320.16,
    hoje: "2026-09-21",
  });

  assert.equal(result.diasHistoricosUsados, 3);
  assert.equal(result.produtividadeHistoricaTh, 23.4);
  assert.equal(result.capacidadeEstimada, 1404);
  assert.equal(result.capacidadeInconsistente, false);
});

test("sinaliza capacidade subestimada quando o período já encerrou e o realizado supera a estimativa", () => {
  const result = calcularCapacidadeColhedoras({
    toneladasPorDia: [{ dia: "2026-09-14", toneladas: 800 }],
    horasTrabalhadasPorDia: [{ dia: "2026-09-14", horas: 40 }],
    periodoInicio: "2026-09-15",
    periodoFim: "2026-09-15",
    horasMaquinaDisponiveis: 40,
    realizado: 1320.16,
    hoje: "2026-09-21",
  });

  assert.equal(result.produtividadeHistoricaTh, 20);
  assert.equal(result.capacidadeEstimada, 800);
  assert.equal(result.periodoEncerrado, true);
  assert.equal(result.capacidadeInconsistente, true);
});

test("não atingimento: parte pela frota e parte pela operação", () => {
  const result = decomporNaoAtingimentoMeta({ cota: 1000, realizado: 700, capacidadeEstimada: 800 });
  assert.equal(result.atingiu, false);
  assert.equal(result.gap, 300);
  assert.equal(result.causas.find((c) => c.chave === "capacidade")?.toneladas, 200);
  assert.equal(result.causas.find((c) => c.chave === "execucao")?.toneladas, 100);
});

test("não atingimento: cota cabe na capacidade, déficit é operacional", () => {
  const result = decomporNaoAtingimentoMeta({ cota: 1000, realizado: 700, capacidadeEstimada: 1200 });
  assert.equal(result.gap, 300);
  assert.equal(result.causas.length, 1);
  assert.equal(result.causas[0]?.chave, "execucao");
  assert.equal(result.causas[0]?.toneladas, 300);
});

test("cota batida não gera causa", () => {
  const result = decomporNaoAtingimentoMeta({ cota: 1000, realizado: 1000, capacidadeEstimada: 900 });
  assert.equal(result.atingiu, true);
  assert.equal(result.causas.length, 0);
});
