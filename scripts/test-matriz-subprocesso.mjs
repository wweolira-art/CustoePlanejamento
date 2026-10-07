import { consultarMatrizSubprocesso } from "../server/custo/services/rateioMatrizSubprocessoService.js";

const r = await consultarMatrizSubprocesso({
  negocios: [1],
  anomesInicio: "202509",
  anomesFim: "202608",
});

console.log("resumo:", r.resumo);
console.log("colunas:", r.colunas);
console.log(
  "linhas:",
  r.linhas.slice(0, 15).map((l) => ({
    label: l.label,
    tipo: l.tipo,
    preparo: l.celulas.preparo?.rHa,
    plantio: l.celulas.plantio?.rHa,
    formacao: l.celulas.formacao?.rHa,
    soca: l.celulas.tratos_soca?.rHa,
  })),
);
const maq = r.linhas.filter((l) => l.grupo === "maquina");
console.log("maquina items:", maq.length, maq.slice(0, 5).map((m) => m.label));
