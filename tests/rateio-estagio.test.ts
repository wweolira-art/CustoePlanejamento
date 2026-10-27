import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composicaoPorColuna, origensDaCelula } from "../src/lib/rateio-origens.js";
import { grupoObjetoOperacional } from "../server/custo/services/grupoObjetoOperacional.js";

const directory = mkdtempSync(join(tmpdir(), "rateio-estagio-"));
process.env.PLANEJAMENTO_DB_PATH = join(directory, "teste.db");
process.env.BUDGET_STORAGE = "sqlite";
const { montarMatriz, montarSomenteEstagios, unidadesPorColuna, consultarArrendamentoSafra } = await import("../server/custo/services/rateioMatrizSubprocessoService.js");
const { db } = await import("../server/db.js");
const { salvarParametrosTecnicos, lerParametrosTecnicos, listarPeriodosParametrosTecnicos } = await import("../server/parametros-tecnicos.js");
const { ensureSafras } = await import("../server/safras.js");
const { storeCalcPlans, parseCalcPlans, computeActivityPlanMonths, computeMaterialAutoMonths, gateMonthsBySelection, applyAutoCalcFull } = await import("../server/auto-calc.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

test("unidade da quantidade permanece salva com preço e meses, inclusive em cálculos antigos", () => {
  for (const quantityUnit of ["ha", "t", "kg", "un"]) {
    const serializado = storeCalcPlans([{ mode: "fixed", dose: 12.5, price: 80, months: [0, 3, 7], quantityUnit }]);
    const [plano] = parseCalcPlans(serializado);
    assert.equal(plano.quantityUnit, quantityUnit);
    assert.equal(plano.dose, 12.5);
    assert.equal(plano.price, 80);
    assert.deepEqual(plano.months, [0, 3, 7]);
  }
  const [legado] = parseCalcPlans(storeCalcPlans([{ mode: "fixed", dose: 2, price: 100, months: null }]));
  assert.equal(legado.quantityUnit, "un");
  assert.equal(legado.dose, 2);
  assert.equal(legado.price, 100);
  const [invalido] = parseCalcPlans([{ mode: "fixed", quantityUnit: "desconhecida", dose: 1, price: 50 }]);
  assert.equal(invalido.quantityUnit, "un");
});

test("aplicações opcionais multiplicam quantidade e preço somente nos meses selecionados", () => {
  const [plano] = parseCalcPlans(storeCalcPlans([{ mode: 'fixed', dose: 3, price: 10, applications: 2, quantityUnit: 'kg', months: [0, 2] }]));
  assert.equal(plano.applications, 2);
  assert.equal(plano.quantityUnit, 'kg');
  const valores = computeActivityPlanMonths(plano, {}, 2026)!;
  assert.deepEqual(gateMonthsBySelection(valores, plano.months), [60, 0, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const [semAplicacoes] = parseCalcPlans(storeCalcPlans([{ mode: 'fixed', dose: 3, price: 10, quantityUnit: 'kg', months: [0, 2] }]));
  assert.equal(semAplicacoes.applications, undefined);
  assert.deepEqual(gateMonthsBySelection(computeActivityPlanMonths(semAplicacoes, {}, 2026)!, semAplicacoes.months), [30, 0, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("recalcular sem repartir equipamentos não depende de conexão Oracle", { timeout: 2000 }, async () => {
  ensureSafras();
  await applyAutoCalcFull(undefined, { syncEquipmentObc: false, strictObcSplit: true });
});

test("material por quantidade calcula sem área, dias ou premissa do pai", () => {
  const linha = { calc_kind: 'quantity', calc_dose: 20, calc_price: 5.5, calc_applications: 2,
    calc_months: '[0,1,2]', calc_area_ha: 99999, calc_area_premise: 'plantio_total' };
  assert.deepEqual(computeMaterialAutoMonths(null, linha, 2026), [220, 220, 220, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(computeMaterialAutoMonths(null, { ...linha, calc_applications: 1 }, 2026), [110, 110, 110, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(computeMaterialAutoMonths(null, { ...linha, calc_dose: 0 }, 2026), null);
});

const ha = { preparo: 10, plantio: 10, tratos_planta: 10, formacao: 10, tratos_soca: 20, irrigacao: 5 };
function linha(destProcesso: number, destSubprocesso: number, valor: number, extra = {}) {
  return { destProcesso, destSubprocesso, valor, codGrupoempenho: 24, codEmpenho: 1, empenhoDescricao: "Insumos", ...extra };
}

test("formação e manutenção do rateio coincidem com os estágios, sem irrigação, colheita ou administração", () => {
  const rows = [
    linha(1, 1, 10, { destDescricao: "Conservação de solo" }),
    linha(1, 1, 100), linha(1, 2, 200), linha(1, 3, 300),
    linha(5, 1, 40), linha(2, 1, 500), linha(3, 1, 600),
    linha(4, 1, 700), linha(1, 2, 80, { origProcesso: 4 }),
    linha(1, 2, 90, { negOrigem: 5, origProcesso: 1, codGrupoempenho: 14 }),
    linha(2, 1, 50, { codGrupoempenho: 17, empenhoDescricao: "Arrendamento de terra" }),
    linha(6, 1, 30),
  ];
  const total = rows.reduce((sum, row) => sum + row.valor, 0);
  const matriz = montarMatriz(rows, ha, 1000, total);
  const estagio = montarSomenteEstagios(rows, ha, 1000, total).estagios;
  assert.equal(matriz.toneladas, estagio.toneladas);
  assert.deepEqual(matriz.estagios, estagio);
  for (const [coluna, chave, esperado, rha] of [
    ["formacao", "formacao", 650, 65], ["tratos_soca", "manutencao", 500, 25],
    ["colheita", "colheita", 600, 30], ["irrigacao", "irrigacao", 780, 156],
    ["administrativo", "administrativo", 120, 4], ["arrendamento", "arrendamento", 50, 50 / 30],
  ] as const) {
    const col = matriz.colunas.find((c: any) => c.key === coluna)!;
    const stage = estagio.linhas.find((r: any) => r.chave === chave)!;
    assert.equal(col.total, esperado);
    assert.equal(col.total, stage.valor);
    assert.equal(col.rHaTotal, rha);
    assert.equal(col.rHaTotal, stage.rHa);
    const items = matriz.linhas.filter((r: any) => r.tipo === "item");
    assert.equal(items.reduce((sum: number, r: any) => sum + r.celulas[coluna].valor, 0), esperado);
    assert.equal(origensDaCelula(matriz, matriz.linhas[0], coluna).reduce((sum, origem) => sum + origem.valor, 0), esperado);
  }
  assert.equal(estagio.linhas.find((r: any) => r.chave === "custo_total")!.valor, total);
  assert.equal(matriz.colunas.filter((col: any) => !["preparo", "plantio", "tratos_planta"].includes(col.key)).reduce((sum: number, col: any) => sum + col.total, 0), total);
});

test("diferença com o total do período aparece identificada no Administrativo", () => {
  const rows = [linha(1, 2, 100)];
  const matriz = montarMatriz(rows, ha, 1000, 120);
  assert.deepEqual(matriz.estagios, montarSomenteEstagios(rows, ha, 1000, 120).estagios);
  assert.equal(matriz.colunas.find((col: any) => col.key === "administrativo")!.total, 20);
  const conciliacao = matriz.linhas.find((row: any) => row.chave === "conciliacao")!;
  assert.equal(conciliacao.celulas.administrativo.valor, 20);
  assert.equal(composicaoPorColuna(matriz, conciliacao)[0].nome, "Conciliação com o total do período");
});

test("estornos e área zero preservam os mesmos totais nas duas consultas", () => {
  const rows = [linha(1, 2, 200), linha(1, 2, -50), linha(2, 1, 100), linha(2, 1, -20)];
  const matriz = montarMatriz(rows, {}, 0, 230);
  assert.equal(matriz.toneladas, null);
  assert.deepEqual(matriz.estagios, montarSomenteEstagios(rows, {}, 0, 230).estagios);
  assert.equal(matriz.colunas.find((c: any) => c.key === "formacao")!.total, 150);
  assert.equal(matriz.colunas.find((c: any) => c.key === "tratos_soca")!.total, 80);
  assert.equal(matriz.colunas.find((c: any) => c.key === "formacao")!.rHaTotal, null);
});

test("composição identifica máquinas e mão de obra e fecha cada célula sem duplicar formação", () => {
  const rows = [
    linha(1, 2, 200, { codGrupoempenho: 20, codItemCusto: 10, itemDescricao: "Colhedeira de cana", origemObjeto: 101, origemDescricao: "Equipamentos" }),
    linha(2, 1, 300, { codGrupoempenho: 20, codItemCusto: 10, itemDescricao: "Colhedeira de cana", origemObjeto: 101 }),
    linha(1, 2, 100, { codGrupoempenho: 10, origemObjeto: 201, origemDescricao: "Corte de cana" }),
    linha(1, 2, -10, { codGrupoempenho: 10, origemObjeto: 201, origemDescricao: "Corte de cana" }),
    linha(2, 1, 50, { codGrupoempenho: 19, origemObjeto: 202, origemDescricao: "Apoio à irrigação" }),
  ];
  const matriz = montarMatriz(rows, ha, 1000, 640);
  for (const row of matriz.linhas) {
    const composicao = composicaoPorColuna(matriz, row);
    for (const col of matriz.colunas) {
      const soma = origensDaCelula(matriz, row, col.key).reduce((sum, item) => sum + item.valor, 0);
      assert.equal(soma, row.celulas[col.key].valor);
      assert.equal(composicao.reduce((sum, item) => sum + (item.celulas[col.key]?.valor ?? 0), 0), row.celulas[col.key].valor);
      assert.equal(composicao.reduce((sum, item) => sum + (item.celulas[col.key]?.rHa ?? 0), 0), row.celulas[col.key].rHa);
      assert.ok(Math.abs(composicao.reduce((sum, item) => sum + (item.celulas[col.key]?.pct ?? 0), 0) - row.celulas[col.key].pct) < 0.000001);
    }
  }
  const maquina = matriz.linhas.find((row: any) => row.chave === "maquina")!;
  const equipamento = composicaoPorColuna(matriz, maquina)[0];
  assert.equal(equipamento.nome, "101 · Equipamentos");
  assert.equal(equipamento.celulas.plantio.valor, 200);
  assert.equal(equipamento.celulas.formacao.valor, 200);
  assert.equal(equipamento.celulas.tratos_soca.valor, 300);
  assert.equal(equipamento.celulas.formacao.rHa, 20);
  assert.equal(equipamento.celulas.tratos_soca.rHa, 15);
  const maoObra = matriz.linhas.find((row: any) => row.chave === "mao-obra") ?? matriz.linhas.find((row: any) => row.grupo === "mao_obra");
  assert.ok(maoObra);
  assert.deepEqual(composicaoPorColuna(matriz, maoObra).map((item) => item.nome), ["201 · Corte de cana", "202 · Apoio à irrigação"]);
});

test("agrupa itens diferentes pelo mesmo objeto e separa objetos com a mesma descrição", () => {
  const rows = [
    linha(1, 2, 100, { codGrupoempenho: 20, origemObjeto: 101, origemDescricao: "Máquinas", itemDescricao: "Colhedeira", codItemCusto: 10 }),
    linha(1, 2, 50, { codGrupoempenho: 20, origemObjeto: 101, origemDescricao: "Máquinas", itemDescricao: "Trator", codItemCusto: 11 }),
    linha(1, 2, 20, { codGrupoempenho: 20, origemObjeto: 102, origemDescricao: "Máquinas", itemDescricao: "Trator", codItemCusto: 11 }),
  ];
  const matriz = montarMatriz(rows, ha, 0, 170);
  const maquina = matriz.linhas.find((row: any) => row.grupo === "maquina")!;
  const composicao = composicaoPorColuna(matriz, maquina);
  assert.equal(composicao.length, 2);
  assert.equal(composicao[0].nome, "101 · Máquinas");
  assert.equal(composicao[0].celulas.formacao.valor, 150);
  assert.equal(composicao[1].nome, "102 · Máquinas");
  assert.equal(composicao[1].celulas.formacao.valor, 20);
});

test("descrições do cadastro Oracle classificam objetos explícitos sem confundir transporte e corte manual", () => {
  for (const nome of ["Colhedeiras de Cana", "Tratores de Pneus Médios", "Equip. Eletro Bombas", "Oficina da Colheita Mecanizada", "Transporte Cana Corte Manual- C.Man", "Corte de Cana Mecanizada- C.Mec", "Drone"]) {
    assert.equal(grupoObjetoOperacional(nome), "maquina", nome);
  }
  for (const nome of ["Mão de Obra Ruricola", "Mão de Obra Ruricola - C. Manual", "Corte Cana Manual -C.Man", "Corte de Mudas Manual", "Apoio à irrigação", "Serviço Apoio Adm-C.Rec-FERTIRRIGAÇÃO"]) {
    assert.equal(grupoObjetoOperacional(nome), "mao_obra", nome);
  }
  for (const nome of [null, "", "Aplicação de Herbicida - TC.Soca", "Administração/Contr. Máquinas Agrícolas"]) {
    assert.equal(grupoObjetoOperacional(nome), null);
  }
});

test("prioriza objeto operacional sobre despesa sem reclassificar insumos e preserva os estágios", () => {
  const rows = [
    linha(1, 2, 100, { codGrupoempenho: 10, origemDescricao: "Colhedeiras de Cana" }),
    linha(1, 2, 50, { codGrupoempenho: 19, origemDescricao: "Tratores de Terceiros" }),
    linha(1, 2, 80, { codGrupoempenho: 20, origemDescricao: "Mão de Obra Ruricola - Plantio", negOrigem: 5, origProcesso: 1 }),
    linha(1, 2, 20, { codGrupoempenho: 21, origemDescricao: "Corte de Mudas Manual" }),
    linha(1, 2, 30, { codGrupoempenho: 24, origemDescricao: "Colhedeiras de Cana" }),
  ];
  const matriz = montarMatriz(rows, ha, 1000, 280);
  assert.equal(matriz.linhas.find((row: any) => row.grupo === "maquina")!.celulas.formacao.valor, 150);
  assert.equal(matriz.linhas.find((row: any) => row.grupo === "mao_obra")!.celulas.formacao.valor, 100);
  assert.equal(matriz.linhas.find((row: any) => row.grupo === "insumo")!.celulas.formacao.valor, 30);
  assert.deepEqual(matriz.estagios, montarSomenteEstagios(rows, ha, 1000, 280).estagios);
});

test("R$/ha usa as áreas armazenadas apenas na safra e no período correspondentes, inclusive zero", async () => {
  ensureSafras();
  const safraId = (db.prepare("SELECT id FROM safras ORDER BY id LIMIT 1").get() as { id: number }).id;
  const filtros = { safraId, anomesInicio: "202601", anomesFim: "202606" };
  const campos = { ...filtros, areaArrendada: 0, moagemLj: 0, tonelagemManual: 0, atr: 0, produtividade: 0, precoAtrConsecana: 0 };
  salvarParametrosTecnicos(safraId, { ...campos, areaPlantio: 12.5, areaSoca: 25, areaIrrigacao: 7, areaArrendada: 9 });
  const stored = await unidadesPorColuna(filtros, { buscarOracle: false });
  assert.equal(stored.unidades.formacao, 12.5);
  assert.equal(stored.unidades.tratos_soca, 25);
  assert.equal(stored.unidades.colheita, 25);
  assert.equal(stored.unidades.irrigacao, 7);
  assert.equal(stored.unidades.administrativo, 37.5);
  assert.equal(stored.unidades.arrendamento, 9);
  assert.equal(stored.fontes.formacao.sourceKind, "parametros_tecnicos");
  const other = await unidadesPorColuna({ ...filtros, anomesFim: "202605" }, { buscarOracle: false });
  assert.equal(other.unidades.formacao, 0);
  assert.notEqual(other.fontes.formacao.sourceKind, "parametros_tecnicos");
  const otherSafra = (db.prepare("SELECT id FROM safras WHERE id != ? LIMIT 1").get(safraId) as { id: number }).id;
  const otherYear = await unidadesPorColuna({ ...filtros, safraId: otherSafra }, { buscarOracle: false });
  assert.notEqual(otherYear.fontes.formacao.sourceKind, "parametros_tecnicos");
  salvarParametrosTecnicos(safraId, { ...campos, areaPlantio: 0, areaSoca: 0, areaIrrigacao: 0 });
  const zero = await unidadesPorColuna(filtros);
  assert.equal(zero.unidades.formacao, 0);
  assert.equal(zero.unidades.tratos_soca, 0);
});

test("os 21 objetos indicados pertencem a mão de obra, com prioridade sobre descrição e empenho", () => {
  const objetos = [24, 383, 199, 35, 94, 211, 30, 378, 84, 294,
    37, 9, 4, 6, 58, 19, 32, 134, 112, 109, 297];
  const rows = objetos.flatMap((codigo) => [10, 20, 24, 14].map((codGrupoempenho) =>
    linha(1, 2, 10, { origemObjeto: codigo, origemDescricao: "Máquinas", codGrupoempenho }),
  ));
  const total = rows.reduce((sum, row) => sum + row.valor, 0);
  const matriz = montarMatriz(rows, ha, 1000, total);
  const maoObra = matriz.linhas.find((row: any) => row.grupo === "mao_obra")!;
  assert.equal(maoObra.celulas.formacao.valor, total);
  assert.equal(matriz.origens.length, rows.length);
  assert.ok(matriz.origens.every((origem: any) => origem.linhaChave === "mao_obra"));
  assert.equal(composicaoPorColuna(matriz, maoObra).length, objetos.length);
  assert.deepEqual(matriz.estagios, montarSomenteEstagios(rows, ha, 1000, total).estagios);
});

test("objetos 45, 29, 2, 56, 49 e 34 ficam em Insumos em vez de Máquina ou Mão de obra", () => {
  const rows = [45, 29, 2, 56, 49, 34].flatMap((origemObjeto) => [10, 20, 24].map((codGrupoempenho) =>
    linha(1, 2, 10, { origemObjeto, origemDescricao: 'Adubação Mecânica', codGrupoempenho }),
  ));
  const matriz = montarMatriz(rows, ha, 1000, 180);
  assert.ok(matriz.origens.every((origem: any) => origem.secao === 'insumos'));
  assert.equal(matriz.linhas.find((row: any) => row.chave === 'insumos-subtotal')!.celulas.formacao.valor, 180);
  assert.equal(matriz.linhas.filter((row: any) => row.tipo === 'item' && row.grupo === 'insumo').length, 6);
  assert.deepEqual(matriz.estagios, montarSomenteEstagios(rows, ha, 1000, 180).estagios);
});

test("histórico divide o custo pela área da própria safra e não inventa valor sem área", async () => {
  ensureSafras();
  const safras = db.prepare("SELECT id FROM safras ORDER BY code LIMIT 2").all() as { id: number }[];
  for (const [indice, safra] of safras.entries()) {
    const inicio = String(202509 + indice * 100), fim = String(202608 + indice * 100);
    salvarParametrosTecnicos(safra.id, { anomesInicio: inicio, anomesFim: fim,
      areaPlantio: 0, areaSoca: 0, areaIrrigacao: 0, areaArrendada: indice === 0 ? 100 : 50,
      moagemLj: 0, tonelagemManual: 0, atr: 0, produtividade: 0, precoAtrConsecana: 0 });
    const filtros = { safraId: safra.id, anomesInicio: inicio, anomesFim: fim };
    const consultar = async (_sql: string, binds: any) => {
      assert.equal(binds.anomesInicio, inicio); assert.equal(binds.anomesFim, fim);
      return { rows: [{ DEST_PROCESSO: 2, COD_GRUPOEMPENHO: 17, EMPENHO_DESCRICAO: "Arrendamento de terra", VALOR: indice === 0 ? 20000 : 15000 }] };
    };
    const ponto = await consultarArrendamentoSafra(filtros, { consultar });
    assert.equal(ponto.rHa, indice === 0 ? 200 : 300);
    const vazio = await consultarArrendamentoSafra({ ...filtros, anomesInicio: "200009", anomesFim: "200108" }, { consultar: async () => ({ rows: [] }) });
    assert.equal(vazio.rHa, null);
    assert.equal(vazio.possuiCustos, false);
  }
});

test("histórico reconhece a área do período exato mesmo com vínculo antigo à safra incorreta", async () => {
  ensureSafras();
  db.prepare('DELETE FROM parametros_tecnicos WHERE anomes_inicio = ? AND anomes_fim = ?').run('202509', '202608');
  const safras = db.prepare('SELECT id, code FROM safras ORDER BY code LIMIT 2').all() as { id: number; code: string }[];
  const campos = { anomesInicio: '202509', anomesFim: '202608', areaPlantio: 0, areaSoca: 0,
    areaIrrigacao: 0, areaArrendada: 2318.4, moagemLj: 0, tonelagemManual: 0, atr: 0, produtividade: 0, precoAtrConsecana: 0 };
  salvarParametrosTecnicos(safras[1].id, campos);
  const consultar = async () => ({ rows: [{ DEST_PROCESSO: 2, COD_GRUPOEMPENHO: 17, EMPENHO_DESCRICAO: 'Arrendamento de terra', VALOR: 463680 }] });
  const ponto = await consultarArrendamentoSafra({ safraId: safras[0].id, anomesInicio: '202509', anomesFim: '202608' }, { consultar });
  assert.equal(ponto.area, 2318.4);
  assert.equal(ponto.rHa, 200);
  assert.match(ponto.fonteArea, /202509 a 202608/);
  const outroPeriodo = await consultarArrendamentoSafra({ safraId: safras[0].id, anomesInicio: '202409', anomesFim: '202508' }, { consultar });
  assert.equal(outroPeriodo.area, 0);
  assert.equal(outroPeriodo.rHa, null);
  salvarParametrosTecnicos(safras[0].id, { ...campos, areaArrendada: 2500 });
  const proprio = await consultarArrendamentoSafra({ safraId: safras[0].id, anomesInicio: '202509', anomesFim: '202608' }, { consultar });
  assert.equal(proprio.area, 2500);
});

test("configura vários períodos da mesma safra e preserva os parâmetros ao editar outro", () => {
  ensureSafras();
  const safra = db.prepare('SELECT id FROM safras ORDER BY code LIMIT 1').get() as { id: number };
  const base = { areaPlantio: 0, areaSoca: 0, areaIrrigacao: 0, areaArrendada: 100,
    moagemLj: 0, tonelagemManual: 0, atr: 0, produtividade: 0, precoAtrConsecana: 0 };
  salvarParametrosTecnicos(safra.id, { ...base, anomesInicio: '202609', anomesFim: '202702' });
  salvarParametrosTecnicos(safra.id, { ...base, areaArrendada: 200, anomesInicio: '202703', anomesFim: '202708' });
  salvarParametrosTecnicos(safra.id, { ...base, areaArrendada: 250, anomesInicio: '202703', anomesFim: '202708' });
  assert.equal(lerParametrosTecnicos(safra.id, '202609', '202702').areaArrendada, 100);
  assert.equal(lerParametrosTecnicos(safra.id, '202703', '202708').areaArrendada, 250);
  const periodos = listarPeriodosParametrosTecnicos() as { safraId: number; safraLabel: string; anomesInicio: string; anomesFim: string }[];
  assert.equal(periodos.filter((periodo) => periodo.safraId === safra.id && periodo.anomesInicio === '202703' && periodo.anomesFim === '202708').length, 1);
  assert.ok(periodos.find((periodo) => periodo.safraId === safra.id && periodo.anomesInicio === '202609' && periodo.safraLabel));
});
