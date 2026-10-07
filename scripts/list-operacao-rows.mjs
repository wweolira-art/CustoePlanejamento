import { consultarMatrizSubprocesso } from "../server/custo/services/rateioMatrizSubprocessoService.js";

const r = await consultarMatrizSubprocesso({
  negocios: [1],
  anomesInicio: "202509",
  anomesFim: "202608",
});

console.log("total linhas", r.linhas.length);
for (const row of r.linhas) {
  const total = Object.values(row.celulas).reduce((s, c) => s + (c.valor || 0), 0);
  if (row.secao === "operacao") {
    console.log(
      (row.tipo || "item").padEnd(10),
      (row.grupo || "").padEnd(18),
      (row.label || "").slice(0, 50).padEnd(50),
      total.toFixed(0),
    );
  }
}
