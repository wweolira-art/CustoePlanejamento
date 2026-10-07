import { consultarRateioDistribuicao } from "../server/custo/services/distribuicaoGastoRateioService.js";
import { executeQuery } from "../server/custo/utils/oracle.js";

const filtros = { negocios: [1], anomesInicio: "202509", anomesFim: "202608" };
const r = await consultarRateioDistribuicao(filtros);

// Mapear objetos origem proc 4
const origIds = [...new Set(r.linhas.map((l) => l.origem))];
const metasOrig = await executeQuery(
  `SELECT cod_objetocusto, descricao, processo, subprocesso
   FROM custo.objetocusto
   WHERE cod_objetocusto IN (${origIds.slice(0, 500).map((_, i) => `:id${i}`).join(",")})`,
  Object.fromEntries(origIds.slice(0, 500).map((id, i) => [`id${i}`, id])),
);
const origMap = new Map(
  (metasOrig.rows ?? []).map((row) => [
    Number(row.COD_OBJETOCUSTO),
    { descricao: row.DESCRICAO, processo: Number(row.PROCESSO) },
  ]),
);

const destIds = [...new Set(r.linhas.map((l) => l.destObj))];
const metasDest = await executeQuery(
  `SELECT cod_objetocusto, descricao, processo, subprocesso
   FROM custo.objetocusto
   WHERE cod_objetocusto IN (${destIds.slice(0, 500).map((_, i) => `:id${i}`).join(",")})`,
  Object.fromEntries(destIds.slice(0, 500).map((id, i) => [`id${i}`, id])),
);
const destMap = new Map(
  (metasDest.rows ?? []).map((row) => [
    Number(row.COD_OBJETOCUSTO),
    {
      descricao: row.DESCRICAO,
      processo: Number(row.PROCESSO),
      subprocesso: Number(row.SUBPROCESSO),
    },
  ]),
);

const byVia = new Map();
const byOrigDest = new Map();
let total = 0;

for (const lin of r.linhas) {
  const orig = origMap.get(lin.origem);
  const dest = destMap.get(lin.destObj);
  if (!orig || orig.processo !== 4) continue;
  if (!dest || dest.processo !== 2) continue;

  total += lin.valorRateado;
  byVia.set(lin.via, (byVia.get(lin.via) || 0) + lin.valorRateado);

  const key = `${lin.origem} → ${lin.destObj} (${orig.descricao?.slice(0, 30)} → ${dest.descricao?.slice(0, 30)}) [${lin.via}]`;
  byOrigDest.set(key, (byOrigDest.get(key) || 0) + lin.valorRateado);
}

console.log("Total rateado orig proc 4 → dest proc 2:", total.toFixed(2));
console.log("\nPor via ERP:");
[...byVia.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(v.toFixed(2), k));
console.log("\nTop combinações origem→destino:");
[...byOrigDest.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([k, v]) => console.log(v.toFixed(2), k));

// Amostra percentuais na distribuicaogasto para um objeto irrigação
const sampleOrig = [...byOrigDest.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]?.match(/^(\d+)/)?.[1];
if (sampleOrig) {
  const dg = await executeQuery(
    `SELECT d.cod_objetocustocliente, cli.descricao, d.porcentagem, d.cod_item_custo, d.anomes
     FROM custo.distribuicaogasto d
     JOIN custo.objetocusto cli ON cli.cod_objetocusto = d.cod_objetocustocliente
     WHERE d.cod_objetocusto = :orig
       AND d.tipo = 'R'
       AND d.anomes >= '202509' AND d.anomes <= '202608'
     ORDER BY d.anomes, d.porcentagem DESC
     FETCH FIRST 12 ROWS ONLY`,
    { orig: Number(sampleOrig) },
  );
  console.log(`\nCadastro distribuicaogasto (obj origem ${sampleOrig}, amostra):`);
  for (const row of dg.rows ?? []) {
    console.log(
      row.ANOMES,
      "item", row.COD_ITEM_CUSTO ?? row.cod_item_custo,
      "→", (row.DESCRICAO ?? row.descricao)?.slice(0, 35),
      "| pct", row.PORCENTAGEM ?? row.porcentagem,
    );
  }
}
