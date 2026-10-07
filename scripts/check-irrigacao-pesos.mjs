import { consultarMatrizSubprocesso } from "../server/custo/services/rateioMatrizSubprocessoService.js";
import { listUnRealizadoSources } from "../server/un-realizado.ts";
import { premissasKpis } from "../server/calc.js";

const r = await consultarMatrizSubprocesso({
  negocios: [1],
  anomesInicio: "202509",
  anomesFim: "202608",
});

const irr = r.linhas.find((l) => l.chave === "irrigacao");
const u = await listUnRealizadoSources();
const p = premissasKpis();

console.log("=== Pesos Un realizado (distribuição irrigação) ===");
for (const key of ["preparo", "plantio", "tratos_planta", "tratos_soca"]) {
  const col = r.colunas.find((c) => c.key === key);
  console.log(key, "→", col?.hectareas ?? 0, "ha", col?.sheetName);
}

console.log("\n=== Fontes Un realizado configuradas ===");
for (const s of u.sources) {
  if (["P.SOLO", "PLANTIO", "T.C.P.", "T.C.S.", "IRRIGAÇÃO"].includes(s.sheetName)) {
    console.log(s.sheetName, "|", s.sourceKind, "| units:", s.units);
  }
}

console.log("\n=== Premissas (referência) ===");
console.log({
  areaVerao: p.areaVerao,
  areaInverno: p.areaInverno,
  areaPlanta: p.areaPlanta,
  areaSoca: p.areaSoca,
});

console.log("\n=== Linha Irrigação/Fertirrigação (R$) ===");
if (irr) {
  for (const [k, v] of Object.entries(irr.celulas)) {
    console.log(k, "valor:", v.valor?.toFixed(2), "rHa:", v.rHa);
  }
}
