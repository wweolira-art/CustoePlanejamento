import { oracleNumber, oracleText, runLimited, withOracle } from "../oracle.js";
import type {
  LubrificacaoDashboardData,
  LubrificacaoEquipamentoOpcao,
  LubrificacaoMaterial,
  LubrificacaoMensal,
  LubrificacaoPonto,
  LubrificacaoPorTipo,
  LubrificacaoResumoFrota,
} from "../../src/lib/lubrificacao.js";
import type { ManutencaoStatus } from "./manutencao-programada.js";

/** Sistemas de lubrificação no Power BI (SISTEMAS1 filtrado). */
const SISTEMAS_LUBRIFICACAO = "48,84,85";
/** Serviço de lubrificação (Power BI / itens_ordemservico.cod_servicobis). */
const SERVICO_LUBRIFICACAO = 40;
const ALERTA_PCT = 0.9;

type ComponenteLubrificacao = {
  codEquipamento: number;
  codSistema: number;
  sistemaDescricao: string | null;
  codComponente: number;
  componenteDescricao: string | null;
  limiteKmRodado: number | null;
  limiteHsTrabalhada: number | null;
  qtdeLtTroca: number | null;
  kmAtualEquipamento: number | null;
  kmNaUltimaTroca: number | null;
  /** Leitura atual do horímetro/odômetro do equipamento. */
  kmAtualLeitura: number | null;
  kmRodado: number | null;
  horaFinal: number | null;
  dataAbertura: string | null;
  dtUltimaTroca: string | null;
  codMaterial: number | null;
  materialDescricao: string | null;
  materiais: Array<{ codMaterial: number; descricao: string | null; quantidade: number | null }>;
  status: ManutencaoStatus;
};

function codGrupoEmpresa() {
  return Number(process.env.COD_GRUPOEMPRESA || 1);
}

function statusPorLimite(rodado: number | null, limite: number | null): ManutencaoStatus {
  if (limite == null || !(limite > 0) || rodado == null) return "sem_plano";
  if (rodado >= limite) return "vencido";
  if (rodado >= limite * ALERTA_PCT) return "a_vencer";
  return "em_dia";
}

function isoDate(v: unknown) {
  if (v == null) return null;
  if (v instanceof Date && Number.isFinite(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s.slice(0, 10) || null;
}

function addDays(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return null;
  d.setDate(d.getDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

function diffDays(from: string, to = new Date()) {
  const start = new Date(`${from}T12:00:00`);
  const end = to instanceof Date ? to : new Date(`${to}T12:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

function componentLimite(c: ComponenteLubrificacao) {
  if (c.limiteKmRodado != null && c.limiteKmRodado > 0) return c.limiteKmRodado;
  if (c.limiteHsTrabalhada != null && c.limiteHsTrabalhada > 0) return c.limiteHsTrabalhada;
  return null;
}

function money1(n: number) {
  return Math.round(n * 10) / 10;
}

async function listarEquipamentos(): Promise<LubrificacaoEquipamentoOpcao[]> {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT DISTINCT e.cod_equipamento,
              e.descricao,
              e.km_atual
         FROM automotivo.equipamento e
         JOIN automotivo.equipcomponente ec
           ON ec.cod_equipamento = e.cod_equipamento
          AND ec.cod_grupoempresa = e.cod_grupoempresa
        WHERE e.cod_grupoempresa = :codGrupo
          AND ec.cod_sistema IN (${SISTEMAS_LUBRIFICACAO})
          AND NVL(e.ativo, 'S') = 'S'
          AND e.disponibilidade IS NOT NULL
          AND NVL(e.agregado, 'N') <> 'S'
        ORDER BY e.cod_equipamento`,
      { codGrupo: codGrupoEmpresa() },
    );
    return ((result.rows ?? []) as Record<string, unknown>[]).map((row) => ({
      codEquipamento: oracleNumber(row, "cod_equipamento", "COD_EQUIPAMENTO")!,
      descricao: oracleText(row, "descricao", "DESCRICAO"),
      kmAtual: oracleNumber(row, "km_atual", "KM_ATUAL"),
    }));
  });
}

async function loadComponentesLubrificacao(codEquipamento: number): Promise<ComponenteLubrificacao[]> {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `WITH UltimaData AS (
         SELECT b.cod_equipamento,
                a.cod_servicobis,
                a.cod_sistema,
                a.cod_componente,
                MAX(a.data) AS ultima_troca,
                MAX(a.horafinal) AS horafinal,
                MAX(b.dtabertura) AS ultima_data
           FROM automotivo.itens_ordemservico a
           LEFT JOIN automotivo.ordemservico b
             ON a.ano_ordemservico = b.ano_ordemservico
            AND a.numero_ordemservico = b.numero_ordemservico
          WHERE a.cod_servicobis = ${SERVICO_LUBRIFICACAO}
            AND a.cod_sistema IN (${SISTEMAS_LUBRIFICACAO})
            AND b.cod_equipamento = :codEquipamento
          GROUP BY b.cod_equipamento, a.cod_servicobis, a.cod_sistema, a.cod_componente
       ),
       Ultima_troca AS (
         SELECT u.cod_equipamento,
                u.ultima_data AS dataabertura,
                u.ultima_troca AS dt_ultimatroca,
                u.horafinal,
                u.cod_sistema,
                u.cod_componente,
                b.km_atual AS km_na_troca,
                c.limite_kmrodado,
                c.limite_hstrabalhada
           FROM UltimaData u
           LEFT JOIN automotivo.ordemservico b
             ON u.cod_equipamento = b.cod_equipamento
            AND u.ultima_data = b.dtabertura
           LEFT JOIN automotivo.itens_ordemservico a
             ON a.ano_ordemservico = b.ano_ordemservico
            AND a.numero_ordemservico = b.numero_ordemservico
            AND a.cod_servicobis = u.cod_servicobis
            AND a.cod_sistema = u.cod_sistema
            AND a.cod_componente = u.cod_componente
           RIGHT JOIN automotivo.equipcomponente c
             ON c.cod_equipamento = u.cod_equipamento
            AND c.cod_sistema = u.cod_sistema
            AND c.cod_componente = u.cod_componente
       ),
       Equipamento_componente AS (
         SELECT a.cod_equipamento,
                a.cod_sistema,
                a.cod_componente,
                a.limite_kmrodado,
                a.limite_hstrabalhada,
                a.qtde_lttroca,
                MAX(b.km_na_troca) AS km_na_troca,
                MAX(b.dataabertura) AS dataabertura,
                MAX(b.dt_ultimatroca) AS dt_ultimatroca,
                MAX(b.horafinal) AS horafinal,
                a.cod_material,
                e.km_atual AS km_atual_equip,
                s.descricao AS sistema_descricao,
                c.descricao AS componente_descricao,
                m.descricao AS material_descricao
           FROM automotivo.equipcomponente a
           LEFT JOIN Ultima_troca b
             ON a.cod_sistema = b.cod_sistema
            AND a.cod_componente = b.cod_componente
            AND a.cod_equipamento = b.cod_equipamento
           LEFT JOIN automotivo.equipamento e
             ON e.cod_equipamento = a.cod_equipamento
            AND e.cod_grupoempresa = a.cod_grupoempresa
           LEFT JOIN automotivo.sistemas s
             ON s.cod_sistema = a.cod_sistema
           LEFT JOIN automotivo.componentes c
             ON c.cod_sistema = a.cod_sistema
            AND c.cod_componente = a.cod_componente
           LEFT JOIN material.material m
             ON m.cod_material = a.cod_material
          WHERE a.cod_grupoempresa = :codGrupo
            AND a.cod_equipamento = :codEquipamento
            AND a.cod_sistema IN (${SISTEMAS_LUBRIFICACAO})
            AND NVL(e.ativo, 'S') = 'S'
            AND e.disponibilidade IS NOT NULL
            AND NVL(e.agregado, 'N') <> 'S'
          GROUP BY a.cod_equipamento,
                   a.cod_sistema,
                   a.cod_componente,
                   a.limite_kmrodado,
                   a.limite_hstrabalhada,
                   a.qtde_lttroca,
                   a.cod_material,
                   e.km_atual,
                   s.descricao,
                   c.descricao,
                   m.descricao
       )
       SELECT * FROM Equipamento_componente
       ORDER BY cod_sistema, cod_componente`,
      { codGrupo: codGrupoEmpresa(), codEquipamento },
    );

    const matResult = await conn.execute(
      `SELECT mc.cod_sistema,
              mc.cod_componente,
              mc.cod_material,
              mc.quantidade,
              m.descricao
         FROM automotivo.materialcomponente mc
         LEFT JOIN material.material m
           ON m.cod_material = mc.cod_material
        WHERE mc.cod_sistema IN (${SISTEMAS_LUBRIFICACAO})
        ORDER BY mc.cod_sistema, mc.cod_componente, mc.cod_material`,
    );

    const materiaisPorComp = new Map<
      string,
      Array<{ codMaterial: number; descricao: string | null; quantidade: number | null }>
    >();
    for (const row of (matResult.rows ?? []) as Record<string, unknown>[]) {
      const codSistema = oracleNumber(row, "cod_sistema", "COD_SISTEMA");
      const codComponente = oracleNumber(row, "cod_componente", "COD_COMPONENTE");
      const codMaterial = oracleNumber(row, "cod_material", "COD_MATERIAL");
      if (codSistema == null || codComponente == null || codMaterial == null) continue;
      const key = `${codSistema}:${codComponente}`;
      const list = materiaisPorComp.get(key) ?? [];
      list.push({
        codMaterial,
        descricao: oracleText(row, "descricao", "DESCRICAO"),
        quantidade: oracleNumber(row, "quantidade", "QUANTIDADE"),
      });
      materiaisPorComp.set(key, list);
    }

    const componentes: ComponenteLubrificacao[] = [];
    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const codEq = oracleNumber(row, "cod_equipamento", "COD_EQUIPAMENTO");
      const codSistema = oracleNumber(row, "cod_sistema", "COD_SISTEMA");
      const codComponente = oracleNumber(row, "cod_componente", "COD_COMPONENTE");
      if (codEq == null || codSistema == null || codComponente == null) continue;

      const kmAtualEquip = oracleNumber(row, "km_atual_equip", "KM_ATUAL_EQUIP");
      const kmNaTroca = oracleNumber(row, "km_na_troca", "KM_NA_TROCA");
      const horaFinal = oracleNumber(row, "horafinal", "HORAFINAL");
      const limiteKm = oracleNumber(row, "limite_kmrodado", "LIMITE_KMRODADO");
      const limiteHs = oracleNumber(row, "limite_hstrabalhada", "LIMITE_HSTRABALHADA");
      const limite = limiteKm != null && limiteKm > 0 ? limiteKm : limiteHs;
      const kmRodado =
        kmAtualEquip != null && kmNaTroca != null
          ? Math.max(0, kmAtualEquip - kmNaTroca)
          : null;

      const materiais = materiaisPorComp.get(`${codSistema}:${codComponente}`) ?? [];

      componentes.push({
        codEquipamento: codEq,
        codSistema,
        sistemaDescricao: oracleText(row, "sistema_descricao", "SISTEMA_DESCRICAO"),
        codComponente,
        componenteDescricao: oracleText(row, "componente_descricao", "COMPONENTE_DESCRICAO"),
        limiteKmRodado: limiteKm,
        limiteHsTrabalhada: limiteHs,
        qtdeLtTroca: oracleNumber(row, "qtde_lttroca", "QTDE_LTTROCA"),
        kmAtualEquipamento: kmAtualEquip,
        kmAtualLeitura: kmAtualEquip,
        kmNaUltimaTroca: kmNaTroca,
        kmRodado,
        horaFinal,
        dataAbertura: isoDate(row.dataabertura ?? row.DATAABERTURA),
        dtUltimaTroca: isoDate(row.dt_ultimatroca ?? row.DT_ULTIMATROCA),
        codMaterial: oracleNumber(row, "cod_material", "COD_MATERIAL"),
        materialDescricao: oracleText(row, "material_descricao", "MATERIAL_DESCRICAO"),
        materiais,
        status: statusPorLimite(kmRodado, limite),
      });
    }

    return componentes;
  });
}

async function loadTempoMedioEquipamento(codEquipamento: number) {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `WITH trocas AS (
         SELECT TRUNC(a.data) AS dt,
                LAG(TRUNC(a.data)) OVER (ORDER BY a.data) AS dt_ant
           FROM automotivo.itens_ordemservico a
           JOIN automotivo.ordemservico b
             ON a.ano_ordemservico = b.ano_ordemservico
            AND a.numero_ordemservico = b.numero_ordemservico
          WHERE a.cod_servicobis = ${SERVICO_LUBRIFICACAO}
            AND a.cod_sistema IN (${SISTEMAS_LUBRIFICACAO})
            AND b.cod_equipamento = :codEquipamento
            AND a.data IS NOT NULL
       )
       SELECT ROUND(AVG(dt - dt_ant), 0) AS tempo_medio
         FROM trocas
        WHERE dt_ant IS NOT NULL`,
      { codEquipamento },
    );
    const row = (result.rows ?? [])[0] as Record<string, unknown> | undefined;
    return oracleNumber(row ?? {}, "tempo_medio", "TEMPO_MEDIO");
  });
}

async function loadKmMensalEquipamento(codEquipamento: number, ano: number | null) {
  return withOracle(async (conn) => {
    const binds: Record<string, number> = { codEquipamento };
    let filtroAno = "";
    if (ano != null && Number.isFinite(ano)) {
      filtroAno = "AND EXTRACT(YEAR FROM o.dtabertura) = :ano";
      binds.ano = ano;
    }
    const result = await conn.execute(
      `SELECT TO_CHAR(o.dtabertura, 'YYYY-MM') AS mes,
              GREATEST(0, MAX(o.km_atual) - MIN(o.km_atual)) AS km_mes
         FROM automotivo.ordemservico o
        WHERE o.cod_equipamento = :codEquipamento
          AND o.dtabertura IS NOT NULL
          AND o.km_atual IS NOT NULL
          ${filtroAno}
        GROUP BY TO_CHAR(o.dtabertura, 'YYYY-MM')
        ORDER BY 1`,
      binds,
    );
    const map = new Map<string, number>();
    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const mes = oracleText(row, "mes", "MES");
      const kmMes = oracleNumber(row, "km_mes", "KM_MES");
      if (!mes) continue;
      map.set(mes, kmMes ?? 0);
    }
    return map;
  });
}

async function loadRealizadoMensal(codEquipamento: number, ano: number | null) {
  return withOracle(async (conn) => {
    const binds: Record<string, number> = { codEquipamento };
    let filtroAno = "";
    if (ano != null && Number.isFinite(ano)) {
      filtroAno = "AND EXTRACT(YEAR FROM i.data) = :ano";
      binds.ano = ano;
    }
    const result = await conn.execute(
      `SELECT TO_CHAR(i.data, 'YYYY-MM') AS mes,
              COUNT(DISTINCT TRUNC(i.data)) AS realizado,
              COUNT(*) AS lancamentos
         FROM automotivo.itens_ordemservico i
         JOIN automotivo.ordemservico o
           ON i.ano_ordemservico = o.ano_ordemservico
          AND i.numero_ordemservico = o.numero_ordemservico
        WHERE i.cod_servicobis = ${SERVICO_LUBRIFICACAO}
          AND i.cod_sistema IN (${SISTEMAS_LUBRIFICACAO})
          AND o.cod_equipamento = :codEquipamento
          AND i.data IS NOT NULL
          ${filtroAno}
        GROUP BY TO_CHAR(i.data, 'YYYY-MM')
        ORDER BY 1`,
      binds,
    );
    const dias = new Map<string, number>();
    const lancamentos = new Map<string, number>();
    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const mes = oracleText(row, "mes", "MES");
      const realizado = oracleNumber(row, "realizado", "REALIZADO");
      if (!mes) continue;
      dias.set(mes, realizado ?? 0);
      lancamentos.set(mes, oracleNumber(row, "lancamentos", "LANCAMENTOS") ?? 0);
    }
    return { dias, lancamentos };
  });
}

function buildDataEstimada(dataUltmTroca: string | null, kmRodado: number | null, limite: number | null) {
  if (!dataUltmTroca || kmRodado == null || !(kmRodado > 0) || limite == null || !(limite > 0)) return null;
  const diasDecorridos = diffDays(dataUltmTroca);
  if (diasDecorridos == null || diasDecorridos <= 0) return null;
  const diasAteLimite = (limite * diasDecorridos) / kmRodado;
  return addDays(dataUltmTroca, diasAteLimite);
}

function kmHrRodadoDesdeUltmTroca(kmAtual: number | null, ultmKmHrTroca: number | null) {
  if (kmAtual == null || ultmKmHrTroca == null) return null;
  return Math.max(0, kmAtual - ultmKmHrTroca);
}

function buildPontos(
  componentes: ComponenteLubrificacao[],
  tempoMedioEquipamento: number | null,
  kmAtualEquipamento: number | null,
): LubrificacaoPonto[] {
  return componentes.map((c) => {
    const limite = componentLimite(c);
    const dataUltmTroca = c.dtUltimaTroca || c.dataAbertura;
    const tempoMedioDias = dataUltmTroca ? tempoMedioEquipamento : null;
    const ultmKmHrTroca = c.kmNaUltimaTroca;
    const kmHrRodado = kmHrRodadoDesdeUltmTroca(kmAtualEquipamento, ultmKmHrTroca);
    return {
      codigo: c.codComponente,
      descricao: c.componenteDescricao || `Componente ${c.codComponente}`,
      ultmKmHrTroca,
      limiteTroca: limite,
      kmHrRodado,
      dataUltmTroca,
      tempoMedioDias,
      dataEstimada: buildDataEstimada(dataUltmTroca, kmHrRodado, limite),
      situacao: c.status,
    };
  });
}

function buildMateriais(componentes: ComponenteLubrificacao[]): LubrificacaoMaterial[] {
  const rows: LubrificacaoMaterial[] = [];
  for (const c of componentes) {
    const descricao = c.componenteDescricao || `Componente ${c.codComponente}`;
    if (c.materiais.length) {
      for (const m of c.materiais) {
        rows.push({
          codigo: c.codComponente,
          descricao,
          materialDescricao: m.descricao || `Material ${m.codMaterial}`,
          quantidade: m.quantidade,
        });
      }
    } else if (c.materialDescricao || c.codMaterial != null) {
      rows.push({
        codigo: c.codComponente,
        descricao,
        materialDescricao: c.materialDescricao || `Material ${c.codMaterial}`,
        quantidade: c.qtdeLtTroca,
      });
    }
  }
  return rows;
}

function componentesComHistorico(componentes: ComponenteLubrificacao[]) {
  return componentes.filter((c) => c.dtUltimaTroca || c.dataAbertura);
}

function estimadoPorKm(km: number, componentes: ComponenteLubrificacao[]) {
  let total = 0;
  for (const c of componentesComHistorico(componentes)) {
    const limite = componentLimite(c);
    if (limite == null || !(limite > 0)) continue;
    total += Math.max(0, km / limite);
  }
  return money1(total);
}

function buildMensal(
  realizadoMap: Map<string, number>,
  lancamentosMap: Map<string, number>,
  kmMensalMap: Map<string, number>,
  componentes: ComponenteLubrificacao[],
  ano: number | null,
  mes: number | null,
): LubrificacaoMensal[] {
  const monthNames = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const mesKeys = new Set<string>([...realizadoMap.keys(), ...kmMensalMap.keys()]);
  const rows: LubrificacaoMensal[] = [];
  for (const mesKey of mesKeys) {
    const [y, m] = mesKey.split("-");
    const monthNum = Number(m);
    const yearNum = Number(y);
    if (ano != null && yearNum !== ano) continue;
    if (mes != null && monthNum !== mes) continue;
    rows.push({
      mes: mesKey,
      label: monthNum >= 1 && monthNum <= 12 ? `${monthNames[monthNum - 1]}/${y}` : mesKey,
      estimado: estimadoPorKm(kmMensalMap.get(mesKey) ?? 0, componentes),
      lancamentos: lancamentosMap.get(mesKey) ?? 0,
      realizado: realizadoMap.get(mesKey) ?? 0,
    });
  }
  return rows.sort((a, b) => a.mes.localeCompare(b.mes));
}

function buildAlerta(eficiencia: number | null) {
  if (eficiencia == null) return null;
  if (eficiencia >= 10) return null;
  const pct = eficiencia.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  return `Esse equipamento teve uma eficiência de ${pct}%. Índice considerado muito baixo em relação à sua programação. Verifique se falta apontamento ou falha na lubrificação.`;
}

function buildMensalCompleto(
  ano: number,
  realizadoMap: Map<string, number>,
  lancamentosMap: Map<string, number>,
  estimadoMap: Map<string, number>,
): LubrificacaoMensal[] {
  const monthNames = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const rows: LubrificacaoMensal[] = [];
  for (let monthNum = 1; monthNum <= 12; monthNum++) {
    const mesKey = `${ano}-${String(monthNum).padStart(2, "0")}`;
    rows.push({
      mes: mesKey,
      label: `${monthNames[monthNum - 1]}/${ano}`,
      estimado: estimadoMap.get(mesKey) ?? 0,
      lancamentos: lancamentosMap.get(mesKey) ?? 0,
      realizado: realizadoMap.get(mesKey) ?? 0,
    });
  }
  return rows;
}

function sqlLubEquipamentos() {
  return `SELECT DISTINCT e.cod_equipamento
            FROM automotivo.equipamento e
            JOIN automotivo.equipcomponente ec
              ON ec.cod_equipamento = e.cod_equipamento
             AND ec.cod_grupoempresa = e.cod_grupoempresa
           WHERE e.cod_grupoempresa = :codGrupo
             AND ec.cod_sistema IN (${SISTEMAS_LUBRIFICACAO})
             AND NVL(e.ativo, 'S') = 'S'
             AND e.disponibilidade IS NOT NULL
             AND NVL(e.agregado, 'N') <> 'S'`;
}

function sqlTipoVigente() {
  return `tipo_vigente AS (
            SELECT ht.cod_equipamento,
                   te.descricaotipoequipamento,
                   ROW_NUMBER() OVER (
                     PARTITION BY ht.cod_equipamento
                     ORDER BY NVL(ht.data_inicio, DATE '1900-01-01') DESC
                   ) AS rn
              FROM automotivo.historico_tipoequipamento ht
              JOIN automotivo.tipoequipamento te
                ON te.cod_tipoequipamento = ht.cod_tipoequipamento
             WHERE ht.data_fim IS NULL
               AND NVL(te.exibequadro, 'S') <> 'N'
               AND NVL(te.ativo, 'S') = 'S'
          )`;
}

async function loadResumoFrota(ano: number, mesCalendario: number): Promise<LubrificacaoResumoFrota> {
  return withOracle(async (conn) => {
    const binds = { codGrupo: codGrupoEmpresa(), ano };

    const mensalResult = await conn.execute(
      `WITH lub_equip AS (${sqlLubEquipamentos()}),
       ult AS (
         SELECT b.cod_equipamento, a.cod_sistema, a.cod_componente
           FROM automotivo.itens_ordemservico a
           JOIN automotivo.ordemservico b
             ON a.ano_ordemservico = b.ano_ordemservico
            AND a.numero_ordemservico = b.numero_ordemservico
          WHERE a.cod_servicobis = ${SERVICO_LUBRIFICACAO}
            AND a.cod_sistema IN (${SISTEMAS_LUBRIFICACAO})
          GROUP BY b.cod_equipamento, a.cod_sistema, a.cod_componente
       ),
       comp AS (
         SELECT ec.cod_equipamento,
                SUM(1.0 / NULLIF(NVL(NULLIF(ec.limite_kmrodado, 0), ec.limite_hstrabalhada), 0)) inv_sum
           FROM automotivo.equipcomponente ec
           JOIN lub_equip le ON le.cod_equipamento = ec.cod_equipamento
          WHERE ec.cod_sistema IN (${SISTEMAS_LUBRIFICACAO})
            AND EXISTS (
              SELECT 1 FROM ult u
               WHERE u.cod_equipamento = ec.cod_equipamento
                 AND u.cod_sistema = ec.cod_sistema
                 AND u.cod_componente = ec.cod_componente
            )
          GROUP BY ec.cod_equipamento
       ),
       km_mes AS (
         SELECT o.cod_equipamento,
                TO_CHAR(o.dtabertura, 'YYYY-MM') AS mes,
                GREATEST(0, MAX(o.km_atual) - MIN(o.km_atual)) AS km_mes
           FROM automotivo.ordemservico o
           JOIN lub_equip le ON le.cod_equipamento = o.cod_equipamento
          WHERE o.dtabertura IS NOT NULL
            AND o.km_atual IS NOT NULL
            AND EXTRACT(YEAR FROM o.dtabertura) = :ano
          GROUP BY o.cod_equipamento, TO_CHAR(o.dtabertura, 'YYYY-MM')
       ),
       realizado AS (
         SELECT TO_CHAR(i.data, 'YYYY-MM') AS mes,
                COUNT(DISTINCT TRUNC(i.data)) AS realizado,
                COUNT(*) AS lancamentos
           FROM automotivo.itens_ordemservico i
           JOIN automotivo.ordemservico o
             ON i.ano_ordemservico = o.ano_ordemservico
            AND i.numero_ordemservico = o.numero_ordemservico
           JOIN lub_equip le ON le.cod_equipamento = o.cod_equipamento
          WHERE i.cod_servicobis = ${SERVICO_LUBRIFICACAO}
            AND i.cod_sistema IN (${SISTEMAS_LUBRIFICACAO})
            AND i.data IS NOT NULL
            AND EXTRACT(YEAR FROM i.data) = :ano
          GROUP BY TO_CHAR(i.data, 'YYYY-MM')
       ),
       estimado AS (
         SELECT km.mes,
                ROUND(SUM(km.km_mes * comp.inv_sum), 1) AS estimado
           FROM km_mes km
           JOIN comp ON comp.cod_equipamento = km.cod_equipamento
          GROUP BY km.mes
       )
       SELECT NVL(e.mes, r.mes) AS mes,
              NVL(e.estimado, 0) AS estimado,
              NVL(r.realizado, 0) AS realizado,
              NVL(r.lancamentos, 0) AS lancamentos
         FROM estimado e
         FULL OUTER JOIN realizado r ON r.mes = e.mes
        ORDER BY 1`,
      binds,
    );

    const tipoResult = await conn.execute(
      `WITH lub_equip AS (${sqlLubEquipamentos()}),
       ${sqlTipoVigente()},
       ult AS (
         SELECT b.cod_equipamento, a.cod_sistema, a.cod_componente
           FROM automotivo.itens_ordemservico a
           JOIN automotivo.ordemservico b
             ON a.ano_ordemservico = b.ano_ordemservico
            AND a.numero_ordemservico = b.numero_ordemservico
          WHERE a.cod_servicobis = ${SERVICO_LUBRIFICACAO}
            AND a.cod_sistema IN (${SISTEMAS_LUBRIFICACAO})
          GROUP BY b.cod_equipamento, a.cod_sistema, a.cod_componente
       ),
       comp AS (
         SELECT ec.cod_equipamento,
                SUM(1.0 / NULLIF(NVL(NULLIF(ec.limite_kmrodado, 0), ec.limite_hstrabalhada), 0)) inv_sum
           FROM automotivo.equipcomponente ec
           JOIN lub_equip le ON le.cod_equipamento = ec.cod_equipamento
          WHERE ec.cod_sistema IN (${SISTEMAS_LUBRIFICACAO})
            AND EXISTS (
              SELECT 1 FROM ult u
               WHERE u.cod_equipamento = ec.cod_equipamento
                 AND u.cod_sistema = ec.cod_sistema
                 AND u.cod_componente = ec.cod_componente
            )
          GROUP BY ec.cod_equipamento
       ),
       km_mes AS (
         SELECT o.cod_equipamento,
                TO_CHAR(o.dtabertura, 'YYYY-MM') AS mes,
                GREATEST(0, MAX(o.km_atual) - MIN(o.km_atual)) AS km_mes
           FROM automotivo.ordemservico o
           JOIN lub_equip le ON le.cod_equipamento = o.cod_equipamento
          WHERE o.dtabertura IS NOT NULL
            AND o.km_atual IS NOT NULL
            AND EXTRACT(YEAR FROM o.dtabertura) = :ano
          GROUP BY o.cod_equipamento, TO_CHAR(o.dtabertura, 'YYYY-MM')
       ),
       estimado AS (
         SELECT NVL(tv.descricaotipoequipamento, '(Em branco)') AS tipo,
                ROUND(SUM(km.km_mes * comp.inv_sum), 1) AS estimado
           FROM km_mes km
           JOIN comp ON comp.cod_equipamento = km.cod_equipamento
           JOIN tipo_vigente tv ON tv.cod_equipamento = km.cod_equipamento AND tv.rn = 1
          GROUP BY NVL(tv.descricaotipoequipamento, '(Em branco)')
       ),
       realizado AS (
         SELECT NVL(tv.descricaotipoequipamento, '(Em branco)') AS tipo,
                COUNT(DISTINCT TRUNC(i.data)) AS realizado
           FROM automotivo.itens_ordemservico i
           JOIN automotivo.ordemservico o
             ON i.ano_ordemservico = o.ano_ordemservico
            AND i.numero_ordemservico = o.numero_ordemservico
           JOIN lub_equip le ON le.cod_equipamento = o.cod_equipamento
           JOIN tipo_vigente tv ON tv.cod_equipamento = o.cod_equipamento AND tv.rn = 1
          WHERE i.cod_servicobis = ${SERVICO_LUBRIFICACAO}
            AND i.cod_sistema IN (${SISTEMAS_LUBRIFICACAO})
            AND i.data IS NOT NULL
            AND EXTRACT(YEAR FROM i.data) = :ano
          GROUP BY NVL(tv.descricaotipoequipamento, '(Em branco)')
       )
       SELECT NVL(e.tipo, r.tipo) AS tipo,
              NVL(e.estimado, 0) AS estimado,
              NVL(r.realizado, 0) AS realizado
         FROM estimado e
         FULL OUTER JOIN realizado r ON r.tipo = e.tipo
        ORDER BY NVL(e.estimado, 0) DESC, NVL(r.realizado, 0) DESC`,
      binds,
    );

    const calResult = await conn.execute(
      `WITH lub_equip AS (${sqlLubEquipamentos()})
       SELECT EXTRACT(DAY FROM i.data) AS dia,
              COUNT(*) AS quantidade
         FROM automotivo.itens_ordemservico i
         JOIN automotivo.ordemservico o
           ON i.ano_ordemservico = o.ano_ordemservico
          AND i.numero_ordemservico = o.numero_ordemservico
         JOIN lub_equip le ON le.cod_equipamento = o.cod_equipamento
        WHERE i.cod_servicobis = ${SERVICO_LUBRIFICACAO}
          AND i.cod_sistema IN (${SISTEMAS_LUBRIFICACAO})
          AND i.data IS NOT NULL
          AND EXTRACT(YEAR FROM i.data) = :ano
          AND EXTRACT(MONTH FROM i.data) = :mesCalendario
        GROUP BY EXTRACT(DAY FROM i.data)
        ORDER BY 1`,
      { codGrupo: codGrupoEmpresa(), ano, mesCalendario },
    );

    const realizadoMap = new Map<string, number>();
    const lancamentosMap = new Map<string, number>();
    const estimadoMap = new Map<string, number>();
    for (const row of (mensalResult.rows ?? []) as Record<string, unknown>[]) {
      const mes = oracleText(row, "mes", "MES");
      if (!mes) continue;
      estimadoMap.set(mes, oracleNumber(row, "estimado", "ESTIMADO") ?? 0);
      realizadoMap.set(mes, oracleNumber(row, "realizado", "REALIZADO") ?? 0);
      lancamentosMap.set(mes, oracleNumber(row, "lancamentos", "LANCAMENTOS") ?? 0);
    }

    const mensal = buildMensalCompleto(ano, realizadoMap, lancamentosMap, estimadoMap);
    const quantidadeEstimada = money1(mensal.reduce((acc, row) => acc + row.estimado, 0));
    const quantidadeRealizada = mensal.reduce((acc, row) => acc + row.realizado, 0);
    const quantidadeLancamentos = mensal.reduce((acc, row) => acc + row.lancamentos, 0);
    const eficiencia =
      quantidadeEstimada > 0 ? money1((quantidadeRealizada / quantidadeEstimada) * 100) : null;

    const porTipo: LubrificacaoPorTipo[] = [];
    for (const row of (tipoResult.rows ?? []) as Record<string, unknown>[]) {
      const tipo = oracleText(row, "tipo", "TIPO");
      if (!tipo) continue;
      porTipo.push({
        tipo,
        estimado: oracleNumber(row, "estimado", "ESTIMADO") ?? 0,
        realizado: oracleNumber(row, "realizado", "REALIZADO") ?? 0,
      });
    }

    const calendario = ((calResult.rows ?? []) as Record<string, unknown>[]).map((row) => ({
      dia: oracleNumber(row, "dia", "DIA") ?? 0,
      quantidade: oracleNumber(row, "quantidade", "QUANTIDADE") ?? 0,
    }));

    return {
      eficiencia,
      quantidadeEstimada,
      quantidadeLancamentos,
      quantidadeRealizada,
      mensal,
      porTipo,
      calendario,
    };
  });
}

export async function gerarIndicadoresLubrificacao(params: {
  codEquipamento?: number | null;
  ano?: number | null;
  mes?: number | null;
}): Promise<LubrificacaoDashboardData> {
  const equipamentos = await listarEquipamentos();
  let codEquipamento = params.codEquipamento ?? null;
  if (codEquipamento == null && equipamentos.length) {
    codEquipamento = equipamentos[0]!.codEquipamento;
  }

  const ano = params.ano ?? new Date().getFullYear();
  const mesCalendario = params.mes ?? new Date().getMonth() + 1;
  const resumoFrotaPromise = loadResumoFrota(ano, mesCalendario);

  if (codEquipamento == null) {
    return {
      atualizadoEm: new Date().toISOString(),
      equipamentos,
      codEquipamento: null,
      kmAtual: null,
      pontos: [],
      materiais: [],
      eficiencia: null,
      alerta: null,
      mensal: [],
      resumoFrota: await resumoFrotaPromise,
    };
  }

  const [componentes, tempoMedioEquipamento, realizado, kmMensalMap, resumoFrota] = await runLimited(
    [
      () => loadComponentesLubrificacao(codEquipamento),
      () => loadTempoMedioEquipamento(codEquipamento),
      () => loadRealizadoMensal(codEquipamento, ano),
      () => loadKmMensalEquipamento(codEquipamento, ano),
      () => resumoFrotaPromise,
    ],
    1,
  );

  const equipInfo = equipamentos.find((e) => e.codEquipamento === codEquipamento);
  const kmAtual = equipInfo?.kmAtual ?? componentes[0]?.kmAtualEquipamento ?? null;
  const pontos = buildPontos(componentes, tempoMedioEquipamento, kmAtual);
  const materiais = buildMateriais(componentes);

  const mensal = buildMensal(realizado.dias, realizado.lancamentos, kmMensalMap, componentes, ano, params.mes ?? null);
  const realizadoPeriodo = mensal.reduce((acc, row) => acc + row.realizado, 0);
  const estimadoPeriodo = mensal.reduce((acc, row) => acc + row.estimado, 0);
  const eficiencia =
    estimadoPeriodo > 0 ? money1((realizadoPeriodo / estimadoPeriodo) * 100) : null;

  return {
    atualizadoEm: new Date().toISOString(),
    equipamentos,
    codEquipamento,
    kmAtual,
    pontos,
    materiais,
    eficiencia,
    alerta: buildAlerta(eficiencia),
    mensal,
    resumoFrota,
  };
}
