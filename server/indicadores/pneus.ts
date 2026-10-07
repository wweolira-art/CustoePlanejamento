import { oracleText, oracleValue, withOracle } from "../oracle.js";
import type { PneusData, PneuItem, PneuConserto } from "../../src/lib/pneus.js";

type Row = Record<string, unknown>;
const num = (r: Row, key: string) => {
  const value = oracleValue(r, key);
  return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
};
const label = (r: Row, key: string) => oracleText(r, key) || "Não informado";

export async function gerarControlePneus(): Promise<PneusData> {
  return withOracle(async (conn) => {
    // Rank complete records; independent MAX(date)/MAX(hour) can select a non-existent event.
    const tires = await conn.execute(`
      WITH montagem AS (
        SELECT ep.*, ROW_NUMBER() OVER (PARTITION BY cod_pneu
          ORDER BY dtcolocado DESC NULLS LAST, hora_fim_montagem DESC NULLS LAST, sequencia DESC) rn
        FROM automotivo.equip_pneu ep
      ), medicao AS (
        SELECT i.cod_pneu, m.cod_equipamento, m.dtmedicao,
          (NVL(i.medicao1,0)+NVL(i.medicao2,0)+NVL(i.medicao3,0)+NVL(i.medicao4,0)) /
          NULLIF((CASE WHEN i.medicao1 IS NOT NULL THEN 1 ELSE 0 END)+
            (CASE WHEN i.medicao2 IS NOT NULL THEN 1 ELSE 0 END)+
            (CASE WHEN i.medicao3 IS NOT NULL THEN 1 ELSE 0 END)+
            (CASE WHEN i.medicao4 IS NOT NULL THEN 1 ELSE 0 END),0) sulco,
          ROW_NUMBER() OVER (PARTITION BY i.cod_pneu, m.cod_equipamento
            ORDER BY m.dtmedicao DESC, m.hora_ini DESC NULLS LAST, m.n_documento DESC) rn
        FROM automotivo.medicaosulcopneu m
        JOIN automotivo.itens_medicaosulco i ON i.n_documento=m.n_documento
      ), tipo_equip AS (
        SELECT h.cod_equipamento, t.descricaotipoequipamento,
          ROW_NUMBER() OVER (PARTITION BY h.cod_equipamento ORDER BY h.data_inicio DESC NULLS LAST) rn
        FROM automotivo.historico_tipoequipamento h
        LEFT JOIN automotivo.tipoequipamento t ON t.cod_tipoequipamento=h.cod_tipoequipamento
        WHERE h.data_fim IS NULL
      ), reformas AS (
        SELECT c.cod_pneu,
          SUM(CASE WHEN t.reforma='S' AND c.dtconserto_fim IS NOT NULL AND NVL(c.recusado,'N')<>'S' THEN 1 ELSE 0 END) vidas,
          MAX(CASE WHEN c.dtconserto_fim IS NULL AND NVL(c.recusado,'N')<>'S' THEN 1 ELSE 0 END) em_reforma,
          SUM(CASE WHEN c.dtconserto_fim IS NOT NULL AND NVL(c.recusado,'N')<>'S' THEN NVL(c.valor_conserto,0) ELSE 0 END) custo_reforma
        FROM automotivo.consertopneu c
        LEFT JOIN automotivo.tipoconsertopneu t ON t.cod_tipoconsertopneu=c.cod_tipoconsertopneu
        GROUP BY c.cod_pneu
      ), custo_descarte AS (
        SELECT EXTRACT(YEAR FROM a.dataretirada) AS ano,
          c.cod_medidapneu,
          ROUND(SUM(a.vrcustounitario * a.quantidade) / NULLIF(SUM(a.quantidade), 0), 2) AS customedio
        FROM material.itensrequisicaomaterial a
        LEFT JOIN material.material b ON a.cod_material = b.cod_material
        LEFT JOIN automotivo.medidapneu_material c ON a.cod_material = c.cod_material
        WHERE b.cod_familia IN (32)
          AND a.dataretirada IS NOT NULL
          AND c.cod_medidapneu IS NOT NULL
        GROUP BY EXTRACT(YEAR FROM a.dataretirada), c.cod_medidapneu
      ), custo_medida_recente AS (
        SELECT cod_medidapneu, customedio,
          ROW_NUMBER() OVER (PARTITION BY cod_medidapneu ORDER BY ano DESC) rn
        FROM custo_descarte
      )
      SELECT p.cod_pneu, p.numero_fogo, me.desc_medidapneu medida, tp.desc_tipopneu tipo,
        ca.desc_categoriapneu categoria, ma.desc_marcapneu marca,
        TO_CHAR(p.dt_sucateamento,'YYYY-MM-DD') descarte,
        mo.desc_motivosucata motivo, cr.desc_causaretpneu causa,
        ep.cod_equipamento equipamento, te.descricaotipoequipamento tipo_equipamento,
        TO_CHAR(ep.dtcolocado,'YYYY-MM-DD') colocado,
        CASE WHEN ep.cod_pneu IS NOT NULL AND ep.dtretirado IS NULL THEN 1 ELSE 0 END montado,
        NVL(r.em_reforma,0) em_reforma, NVL(p.vida_inicial,1)+NVL(r.vidas,0) vida,
        CASE WHEN p.dt_sucateamento IS NOT NULL THEN ep.sulcoretirado
          ELSE COALESCE(md.sulco,ep.sulcocolocado) END sulco,
        p.km_hstotal rodado, p.valor_aquisicao aquisicao,
        COALESCE(cd.customedio, cm.customedio) custo,
        po.posicao, po.eixo, po.desc_posicaopneu posicao_descricao,
        TO_CHAR(md.dtmedicao,'YYYY-MM-DD') medicao
      FROM automotivo.pneu p
      LEFT JOIN montagem ep ON ep.cod_pneu=p.cod_pneu AND ep.rn=1
      LEFT JOIN medicao md ON md.cod_pneu=p.cod_pneu AND md.cod_equipamento=ep.cod_equipamento AND md.rn=1
      LEFT JOIN tipo_equip te ON te.cod_equipamento=ep.cod_equipamento AND te.rn=1
      LEFT JOIN reformas r ON r.cod_pneu=p.cod_pneu
      LEFT JOIN custo_descarte cd
        ON cd.cod_medidapneu = p.cod_medidapneu
       AND cd.ano = EXTRACT(YEAR FROM NVL(p.dt_sucateamento, SYSDATE))
      LEFT JOIN custo_medida_recente cm
        ON cm.cod_medidapneu = p.cod_medidapneu
       AND cm.rn = 1
      LEFT JOIN automotivo.medidapneu me ON me.cod_medidapneu=p.cod_medidapneu
      LEFT JOIN automotivo.tipopneu tp ON tp.cod_tipopneu=p.cod_tipopneu
      LEFT JOIN automotivo.categoriapneu ca ON ca.cod_categoriapneu=p.cod_categoriapneu
      LEFT JOIN automotivo.marcapneu ma ON ma.cod_marcapneu=p.cod_marcapneu
      LEFT JOIN automotivo.motivosucata mo ON mo.cod_motivosucata=p.cod_motivosucata
      LEFT JOIN automotivo.causaretirarpneu cr ON cr.cod_causaretpneu=p.cod_causaretpneusucata
      LEFT JOIN automotivo.posicaopneu po ON po.cod_posicaopneu=ep.cod_posicaopneu
      WHERE p.cod_motivosucata<>17 OR p.cod_motivosucata IS NULL
      ORDER BY p.numero_fogo`, {}, { maxRows: 100000 });
    const repairs = await conn.execute(`
      SELECT c.cod_pneu, TO_CHAR(c.dtconserto_ini,'YYYY-MM-DD') inicio,
        TO_CHAR(c.dtconserto_fim,'YYYY-MM-DD') fim, t.reforma, c.recusado,
        NVL(c.valor_conserto,0) valor, t.desc_tipoconsertopneu tipo,
        f.razaosocial fornecedor
      FROM automotivo.consertopneu c
      JOIN automotivo.pneu p ON p.cod_pneu=c.cod_pneu
      LEFT JOIN automotivo.tipoconsertopneu t ON t.cod_tipoconsertopneu=c.cod_tipoconsertopneu
      LEFT JOIN (SELECT cod_fornecedor, MAX(razaosocial) razaosocial
        FROM material.vw_parceironegocio GROUP BY cod_fornecedor) f ON f.cod_fornecedor=c.cod_fornecedor
      WHERE p.cod_motivosucata<>17 OR p.cod_motivosucata IS NULL`, {}, { maxRows: 100000 });
    if ((tires.rows?.length ?? 0) >= 100000 || (repairs.rows?.length ?? 0) >= 100000) {
      throw new Error("O volume de pneus excedeu o limite da consulta. Refine a consulta antes de exibir totais.");
    }
    const pneus: PneuItem[] = (tires.rows as Row[] ?? []).map((r) => ({
      id: num(r,"cod_pneu")!, numero: oracleText(r,"numero_fogo") || String(num(r,"cod_pneu")),
      medida: label(r,"medida"), tipo: label(r,"tipo"), categoria: label(r,"categoria"), marca: label(r,"marca"),
      descarte: oracleText(r,"descarte") || null, motivo: label(r,"motivo"), causa: label(r,"causa"),
      equipamento: oracleText(r,"equipamento"), tipoEquipamento: label(r,"tipo_equipamento"),
      colocado: oracleText(r,"colocado") || null, montado: num(r,"montado")===1, emReforma: num(r,"em_reforma")===1,
      vida: num(r,"vida") ?? 1, sulco: num(r,"sulco"), rodado: num(r,"rodado"), aquisicao: num(r,"aquisicao"), custo: num(r,"custo"),
      posicao: oracleText(r,"posicao"), eixo: oracleText(r,"eixo"), posicaoDescricao: label(r,"posicao_descricao"),
      medicao: oracleText(r,"medicao") || null,
    }));
    const consertos: PneuConserto[] = (repairs.rows as Row[] ?? []).map((r) => ({
      pneuId: num(r,"cod_pneu")!, inicio: oracleText(r,"inicio") || null, fim: oracleText(r,"fim") || null,
      reforma: oracleText(r,"reforma")==="S", recusado: oracleText(r,"recusado")==="S",
      valor: num(r,"valor") ?? 0, fornecedor: label(r,"fornecedor"), tipo: label(r,"tipo"),
    }));
    return { pneus, consertos, atualizadoEm: new Date().toISOString() };
  });
}
