import { loadQualidadeColheita } from "./indicadores/colheita-qualidade.js";

async function main() {
  const result = await loadQualidadeColheita({
    dataInicio: "2025-09-01",
    dataFim: "2026-03-22",
    codTipoEquipamento: 81,
  });

  console.log("resumo:", JSON.stringify(result.resumo));
  console.log("linhaTempo:", result.linhaTempo.length, "itens");
  if (result.linhaTempo.length) console.log("  ex:", JSON.stringify(result.linhaTempo[0]));
  console.log("porEquipamento:", result.porEquipamento.length, "itens");
  if (result.porEquipamento.length) console.log("  ex:", JSON.stringify(result.porEquipamento[0]));
  console.log("porTipoPerda:", result.porTipoPerda.length, "itens");
  if (result.porTipoPerda.length) console.log("  ex:", JSON.stringify(result.porTipoPerda[0]));
  console.log("porOperador:", result.porOperador.length, "itens");
  if (result.porOperador.length) {
    const op = result.porOperador[0];
    console.log("  ex:", JSON.stringify({ label: op.label, pctPerda: op.pctPerda, equipamentos: op.equipamentos.length }));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERRO:", err);
  process.exit(1);
});
