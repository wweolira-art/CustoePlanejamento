import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { consultarMatrizSubprocesso } from "../server/custo/services/rateioMatrizSubprocessoService.js";
import { consultarTotalLancamentoConsolidado } from "../server/custo/services/lancamentoConsolidadoService.js";
import { executeQuery } from "../server/custo/utils/oracle.js";
import { expandNegociosCana, normalizeNegocios } from "../server/custo/utils/filtros.js";

function isColheitaMudas(linha) {
  const desc = String(linha.destDescricao || "").toUpperCase();
  return (
    desc.includes("SEMENTE") ||
    desc.includes("MUDA") ||
    desc.includes("CORTE DE") ||
    desc.includes("CORTE SEMENT")
  );
}

function colunaDestino(linha) {
  const proc = linha.destProcesso;
  const sub = linha.destSubprocesso;
  if (proc === 1 && sub === 1) {
    return isColheitaMudas(linha) ? "colheita_mudas" : "preparo";
  }
  if (proc === 1 && sub === 2) return "plantio";
  if (proc === 1 && sub === 3) return "tratos_planta";
  if (proc === 2 || proc === 3) return "tratos_soca";
  return null;
}

function distribuirIrrigacaoDiag(valor, ha) {
  const cols = ["preparo", "plantio", "tratos_planta", "tratos_soca"];
  const total = cols.reduce((s, k) => s + (ha[k] || 0), 0);
  if (total <= 0) return {};
  return Object.fromEntries(cols.map((k) => [k, (valor * (ha[k] || 0)) / total]));
}

const filtros = {
  negocios: [1],
  anomesInicio: "202509",
  anomesFim: "202608",
};

const r = await consultarMatrizSubprocesso(filtros);

const cols = Object.fromEntries(r.colunas.map((c) => [c.key, c.total]));
const formacao = cols.formacao ?? 0;
const soca = cols.tratos_soca ?? 0;
const somaCols = r.colunas.reduce((s, c) => s + (c.total ?? 0), 0);
const somaBase = (cols.preparo ?? 0) + (cols.plantio ?? 0) + (cols.tratos_planta ?? 0) + soca;

console.log("=== RESUMO MATRIZ ===");
console.log("totalPool:", r.resumo.totalPool?.toFixed(2));
console.log("totalMatriz (formacao + soca):", r.resumo.totalMatriz?.toFixed(2));
console.log("colunas:", cols);
console.log("soma todas colunas exibidas:", somaCols.toFixed(2));
console.log("soma base (prep+plant+t.cp+soca):", somaBase.toFixed(2));
console.log("formacao + soca:", (formacao + soca).toFixed(2));
console.log("gap pool - (formacao+soca):", (r.resumo.totalPool - formacao - soca).toFixed(2));

// Linhas oracle não mapeadas para coluna
const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(__dirname, "../server/custo/sql/rateioMatrizLinhas.sql"),
  "utf8",
)
  .replace(/^--.*$/gm, "")
  .trim();

const eff = { ...filtros, negocios: expandNegociosCana(normalizeNegocios(filtros)) };
const result = await executeQuery(sql, {
  negociosCsv: "1,3,5",
  anomesInicio: filtros.anomesInicio,
  anomesFim: filtros.anomesFim,
  objetoCusto: null,
  processo: null,
  subprocesso: null,
  atividade: null,
});

const byDest = new Map();
const byCol = new Map();
let unmapped = 0;
let mapped = 0;

for (const row of result.rows ?? []) {
  const linha = {
    destProcesso: Number(row.DEST_PROCESSO ?? row.dest_processo),
    destSubprocesso: Number(row.DEST_SUBPROCESSO ?? row.dest_subprocesso),
    destDescricao: row.DEST_DESCRICAO ?? row.dest_descricao,
    valor: Number(row.VALOR ?? row.valor),
  };
  const col = colunaDestino(linha);
  const v = linha.valor || 0;
  if (col) {
    mapped += v;
    byCol.set(col, (byCol.get(col) || 0) + v);
  } else {
    unmapped += v;
    const key = `${linha.destProcesso}/${linha.destSubprocesso} — ${linha.destDescricao ?? "?"}`;
    byDest.set(key, (byDest.get(key) || 0) + v);
  }
}

console.log("\n=== RATEIO NAS COLUNAS (oracle) ===");
console.log("mapeado:", mapped.toFixed(2));
console.log("fora das colunas:", unmapped.toFixed(2));
console.log("por coluna roteamento:", Object.fromEntries(byCol));

console.log("\n=== TOP DESTINOS FORA DA MATRIZ ===");
console.log(
  [...byDest.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([k, v]) => ({ destino: k, total: v.toFixed(2) })),
);

const pool = await consultarTotalLancamentoConsolidado(eff);
console.log("\npool consolidado:", pool.toFixed(2));
console.log("mapeado / pool:", ((mapped / pool) * 100).toFixed(1) + "%");
