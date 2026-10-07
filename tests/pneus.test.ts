import assert from "node:assert/strict";
import {test} from "node:test";
import {pneusAverage,pneusAverageCost,pneusCost,pneusCostPerDistance,pneusCustoReposicao,pneusDeliveryDays,pneusDurabilidade,pneusDurabilidadeMedia,pneusEconomiaReforma,pneusInPeriod,type PneuItem} from "../src/lib/pneus.js";
const tire=(custo:number|null,rodado:number|null)=>({custo,rodado}) as PneuItem;
test("estimated cost sums known tire prices and does not turn all missing prices into zero",()=>{
 assert.equal(pneusCost([tire(100,10),tire(null,20)]),100);
 assert.equal(pneusCost([]),null);
 assert.equal(pneusCost([tire(null,10)]),null);
 assert.equal(pneusCost([tire(0,10)]),0);
});
test("average cost per measure uses the available annual tire estimates",()=>{
 assert.equal(pneusAverageCost([tire(2400,10),tire(2600,20),tire(null,30)]),2500);
 assert.equal(pneusAverageCost([tire(null,10)]),null);
});
test("cost per distance uses weighted totals and rejects missing denominators",()=>{
 assert.equal(pneusCostPerDistance([tire(100,10),tire(200,90)]),3);
 assert.equal(pneusCostPerDistance([tire(100,0)]),null);
 assert.equal(pneusCostPerDistance([tire(100,null)]),null);
 assert.equal(pneusCostPerDistance([tire(null,100)]),null);
 assert.equal(pneusCostPerDistance([tire(100,10),tire(null,90)]),10);
});
test("tread averages keep zero measurements and omit missing measurements",()=>{
 assert.equal(pneusAverage([0,4,null]),2);
 assert.equal(pneusAverage([null]),null);
});
test("date filters include boundaries and exclude undated records",()=>{
 assert.equal(pneusInPeriod("2026-09-01","2026-09-01","2026-09-30"),true);
 assert.equal(pneusInPeriod("2026-09-30","2026-09-01","2026-09-30"),true);
 assert.equal(pneusInPeriod(null,"2026-09-01","2026-09-30"),false);
 assert.equal(pneusInPeriod("2026-08-31","2026-09-01","2026-09-30"),false);
});
test("delivery days counts calendar days between send and return",()=>{
 assert.equal(pneusDeliveryDays("2026-08-25","2026-08-31"),6);
 assert.equal(pneusDeliveryDays("2026-08-25",null),null);
 assert.equal(pneusDeliveryDays(null,"2026-08-31"),null);
});
test("durabilidade is km rodado divided by vidas",()=>{
 assert.equal(pneusDurabilidade({rodado:120000,vida:3}),40000);
 assert.equal(pneusDurabilidade({rodado:null,vida:2}),null);
 assert.equal(pneusDurabilidade({rodado:10000,vida:0}),null);
});
test("durabilidade media uses weighted totals by brand set",()=>{
 assert.equal(pneusDurabilidadeMedia([{rodado:100000,vida:2},{rodado:80000,vida:2}]),45000);
 assert.equal(pneusDurabilidadeMedia([{rodado:null,vida:2}]),null);
 assert.equal(pneusDurabilidadeMedia([{rodado:50000,vida:0}]),null);
});
test("economia reforma compares replacement cost minus repair",()=>{
 assert.equal(pneusCustoReposicao({custo:5000,aquisicao:4000}),5000);
 assert.equal(pneusCustoReposicao({custo:null,aquisicao:4000}),4000);
 assert.deepEqual(pneusEconomiaReforma([
  {custoReposicao:5000,valorReforma:1200},
  {custoReposicao:5000,valorReforma:800},
 ]),{compra:10000,reforma:2000,economia:8000});
 assert.equal(pneusEconomiaReforma([{custoReposicao:null,valorReforma:100}]).economia,null);
});
