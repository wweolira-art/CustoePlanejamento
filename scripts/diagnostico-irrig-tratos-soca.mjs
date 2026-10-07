import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { consultarMatrizSubprocesso } from "../server/custo/services/rateioMatrizSubprocessoService.js";
import { executeQuery } from "../server/custo/utils/oracle.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(__dirname, "../server/custo/sql/rateioMatrizLinhas.sql"),
  "utf8",
)
  .replace(/^--.*$/gm, "")
  .trim();

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

function isCustoIrrigacao(linha) {
  return linha.destProcesso === 4 || linha.origProcesso === 4;
}

const filtros = { negocios: [1], anomesInicio: "202509", anomesFim: "202608" };
const r = await consultarMatrizSubprocesso(filtros);
const irr = r.linhas.find((l) => l.chave === "irrigacao");
console.log("Linha irrigacao tratos_soca:", irr?.celulas?.tratos_soca?.valor?.toFixed(2));

const result = await executeQuery(sql, {
  negociosCsv: "1,3,5",
  anomesInicio: "202509",
  anomesFim: "202608",
  objetoCusto: null,
  processo: null,
  subprocesso: null,
  atividade: null,
});

const byGrupo = new Map();
const byDest = new Map();
const byEmpenho = new Map();
let total = 0;

for (const row of result.rows ?? []) {
  const linha = {
    destProcesso: Number(row.DEST_PROCESSO ?? row.dest_processo),
    destSubprocesso: Number(row.DEST_SUBPROCESSO ?? row.dest_subprocesso),
    destDescricao: row.DEST_DESCRICAO ?? row.dest_descricao,
    origProcesso: Number(row.ORIG_PROCESSO ?? row.orig_processo),
    codGrupoempenho: Number(row.COD_GRUPOEMPENHO ?? row.cod_grupoempenho),
    grupoEmpenho: row.GRUPO_EMPENHO ?? row.grupo_empenho,
    codEmpenho: Number(row.COD_EMPENHO ?? row.cod_empenho),
    empenhoDescricao: row.EMPENHO_DESCRICAO ?? row.empenho_descricao,
    valor: Number(row.VALOR ?? row.valor) || 0,
  };

  if (!isCustoIrrigacao(linha)) continue;
  if (linha.destProcesso === 4) continue; // distribuído por ha, não coluna direta

  const col = colunaDestino(linha);
  if (col !== "tratos_soca") continue;

  total += linha.valor;
  const gk = `${linha.codGrupoempenho} — ${linha.grupoEmpenho}`;
  byGrupo.set(gk, (byGrupo.get(gk) || 0) + linha.valor);
  const dk = `${linha.destProcesso}/${linha.destSubprocesso} — ${linha.destDescricao}`;
  byDest.set(dk, (byDest.get(dk) || 0) + linha.valor);
  const ek = `${linha.codEmpenho} — ${linha.empenhoDescricao}`;
  byEmpenho.set(ek, (byEmpenho.get(ek) || 0) + linha.valor);
}

console.log("\nTotal origem proc 4 → coluna tratos_soca:", total.toFixed(2));
console.log("\nPor grupo empenho:");
[...byGrupo.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(v.toFixed(2), k));
console.log("\nPor destino Oracle:");
[...byDest.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(v.toFixed(2), k));
console.log("\nTop empenhos:");
[...byEmpenho.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([k, v]) => console.log(v.toFixed(2), k));
