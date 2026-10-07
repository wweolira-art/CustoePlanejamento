import { oracleNumber, oracleText, withOracle } from "../oracle.js";
import { buildEquipamentoTerceiroSet } from "../colheita/caminhao-terceiro.js";

export type ManutencaoStatus = "em_dia" | "a_vencer" | "vencido" | "em_execucao" | "sem_plano";

const ALERTA_PCT = 0.9;
const SISTEMAS_EXCLUIDOS = "48,84,85";
const SERVICO_TROCA = 68;
/** Tipo de equipamento "TERCEIRO" em `automotivo.tipoequipamento`. */
const COD_TIPO_TERCEIRO = 56;

function isCategoriaTerceiro(categoria: string | null | undefined) {
  const key = String(categoria ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return key.includes("terceir");
}

function isEquipamentoTerceiro(
  equipamentosTerceiro: Set<string>,
  codEquipamento: number,
  categoria?: string | null,
  codTipo?: number | null,
) {
  if (codTipo === COD_TIPO_TERCEIRO) return true;
  if (equipamentosTerceiro.has(String(codEquipamento))) return true;
  if (isCategoriaTerceiro(categoria)) return true;
  return false;
}

function codGrupoEmpresa() {
  return Number(process.env.COD_GRUPOEMPRESA || 1);
}

function statusPorLimite(rodado: number | null, limite: number | null): ManutencaoStatus {
  if (limite == null || !(limite > 0) || rodado == null) return "sem_plano";
  if (rodado >= limite) return "vencido";
  if (rodado >= limite * ALERTA_PCT) return "a_vencer";
  return "em_dia";
}

const STATUS_RANK: Record<ManutencaoStatus, number> = {
  em_execucao: 5,
  vencido: 4,
  a_vencer: 3,
  em_dia: 2,
  sem_plano: 0,
};

function piorStatus(a: ManutencaoStatus, b: ManutencaoStatus): ManutencaoStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

/** Pior situação entre componentes (ignora sem limite/histórico). */
function agregarSituacaoComponente(statuses: ManutencaoStatus[]): ManutencaoStatus | null {
  let worst: ManutencaoStatus | null = null;
  for (const status of statuses) {
    if (status === "sem_plano") continue;
    worst = worst == null ? status : piorStatus(worst, status);
  }
  return worst;
}

type PrioridadePlano = 1 | 2 | 3 | 4;

function computePrioridadePlano(
  osAbertaPrev: boolean,
  kmRodado: number | null,
  limite: number | null,
): PrioridadePlano {
  if (osAbertaPrev) return 4;
  if (limite == null || !(limite > 0) || kmRodado == null) return 1;
  if (kmRodado >= limite) return 3;
  if (kmRodado >= limite * ALERTA_PCT) return 2;
  return 1;
}

/** Replica o VAR situacaoPlano da medida DAX Situação Plano (Power BI). */
function computeSituacaoPlano(params: {
  ultmKmPlano: number | null;
  situacaoComponente: ManutencaoStatus | null;
  prioridade: PrioridadePlano;
}): ManutencaoStatus {
  const { ultmKmPlano, situacaoComponente, prioridade } = params;
  if (ultmKmPlano == null) {
    if (situacaoComponente === "vencido") return "vencido";
    if (situacaoComponente === "a_vencer") return "a_vencer";
    return "sem_plano";
  }
  if (prioridade === 4) return "em_execucao";
  if (situacaoComponente === "em_dia") return "em_dia";
  if (prioridade === 1) return "em_dia";
  if (prioridade === 2) return "a_vencer";
  if (prioridade === 3) return "vencido";
  return "sem_plano";
}

/** Medida DAX Situação Plano — regra final por equipamento. */
export function computeSituacaoPlanoEquip(params: {
  ultmKmPlano: number | null;
  situacaoComponente: ManutencaoStatus | null;
  prioridade: PrioridadePlano;
  qtdeComponente: number;
  categoria: string;
}): ManutencaoStatus {
  const { ultmKmPlano, situacaoComponente, prioridade, qtdeComponente, categoria } = params;
  if (prioridade === 4) return "em_execucao";
  if (situacaoComponente == null && prioridade === 1) return "em_dia";
  if (ultmKmPlano == null || situacaoComponente == null) return "sem_plano";
  if (qtdeComponente >= 7) return situacaoComponente;
  if (categoria === "Motocicletas") return situacaoComponente;
  return computeSituacaoPlano({ ultmKmPlano, situacaoComponente, prioridade });
}

const SQL_COMPONENTES_BASE = `WITH UltimaData AS (
         SELECT b.cod_equipamento,
                a.cod_servicobis,
                a.cod_sistema,
                a.cod_componente,
                MAX(a.data) AS ultima_troca,
                MAX(b.dtabertura) AS ultima_data
           FROM automotivo.itens_ordemservico a
           LEFT JOIN automotivo.ordemservico b
             ON a.ano_ordemservico = b.ano_ordemservico
            AND a.numero_ordemservico = b.numero_ordemservico
          WHERE a.cod_servicobis = ${SERVICO_TROCA}
          GROUP BY b.cod_equipamento, a.cod_servicobis, a.cod_sistema, a.cod_componente
       ),
       Ultima_troca AS (
         SELECT u.cod_equipamento,
                u.ultima_data AS dataabertura,
                u.ultima_troca AS dt_ultimatroca,
                u.cod_servicobis,
                u.cod_sistema,
                u.cod_componente,
                b.km_atual,
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
       Leitura_atual AS (
         SELECT cod_equipamento,
                leitura_atual
           FROM (
             SELECT ia.cod_equipamento,
                    COALESCE(NULLIF(ia.horimetro_final, 0), NULLIF(ia.km_final, 0)) AS leitura_atual,
                    ROW_NUMBER() OVER (
                      PARTITION BY ia.cod_equipamento
                      ORDER BY ia.dt_apontamento DESC NULLS LAST,
                               ia.data_hora_final DESC NULLS LAST
                    ) AS rn
               FROM automotivo.itens_apontamento ia
              WHERE ia.cod_equipamento IS NOT NULL
                AND COALESCE(NULLIF(ia.horimetro_final, 0), NULLIF(ia.km_final, 0)) IS NOT NULL
           )
          WHERE rn = 1
       ),
       Rendimento_vigente AS (
         SELECT *
           FROM (
             SELECT r.cod_equipamento_impl AS cod_equipamento,
                    r.cod_equipamento AS cod_equipamento_principal,
                    CASE
                      WHEN UPPER(NVL(e.tipohorimetro, 'N')) = 'H'
                        THEN COALESCE(NULLIF(e.horas_total, 0), NULLIF(e.km_atual, 0), la.leitura_atual)
                      ELSE e.km_atual
                    END AS km_atual_principal,
                    ROW_NUMBER() OVER (
                      PARTITION BY r.cod_equipamento_impl
                      ORDER BY NVL(r.data_inicio, DATE '1900-01-01') DESC,
                               NVL(r.sequencia, 0) DESC
                    ) AS rn
               FROM automotivo.rendimento r
               JOIN automotivo.equipamento e
                 ON e.cod_grupoempresa = r.cod_grupoempresa
                AND e.cod_equipamento = r.cod_equipamento
               LEFT JOIN Leitura_atual la
                 ON la.cod_equipamento = e.cod_equipamento
              WHERE r.cod_grupoempresa = :codGrupo
                AND r.cod_grupoempresa_impl = :codGrupo
                AND r.cod_equipamento IS NOT NULL
                AND r.cod_equipamento_impl IS NOT NULL
                AND r.cod_equipamento <> r.cod_equipamento_impl
                AND r.data_inicio <= SYSDATE
                AND (r.data_fim IS NULL OR r.data_fim >= TRUNC(SYSDATE))
           )
          WHERE rn = 1
       ),
       Equipamento_componente AS (
         SELECT a.cod_equipamento,
                a.cod_sistema,
                a.cod_componente,
                a.limite_kmrodado,
                a.limite_hstrabalhada,
                b.km_atual AS km_na_troca,
                CASE
                  WHEN UPPER(NVL(e.tipohorimetro, 'N')) = 'H'
                    THEN COALESCE(NULLIF(e.horas_total, 0), NULLIF(e.km_atual, 0), la.leitura_atual)
                  ELSE e.km_atual
                END AS km_atual_equip,
                rv.cod_equipamento_principal,
                rv.km_atual_principal,
                s.descricao AS sistema_descricao,
                c.descricao AS componente_descricao
           FROM automotivo.equipcomponente a
           LEFT JOIN Ultima_troca b
             ON a.cod_sistema = b.cod_sistema
            AND a.cod_componente = b.cod_componente
            AND a.cod_equipamento = b.cod_equipamento
           LEFT JOIN automotivo.equipamento e
             ON e.cod_equipamento = a.cod_equipamento
            AND e.cod_grupoempresa = a.cod_grupoempresa
           LEFT JOIN Leitura_atual la
             ON la.cod_equipamento = a.cod_equipamento
           LEFT JOIN Rendimento_vigente rv
             ON rv.cod_equipamento = a.cod_equipamento
           LEFT JOIN automotivo.sistemas s
             ON s.cod_sistema = a.cod_sistema
           LEFT JOIN automotivo.componentes c
             ON c.cod_sistema = a.cod_sistema
            AND c.cod_componente = a.cod_componente
          WHERE a.cod_grupoempresa = :codGrupo
            AND a.cod_sistema NOT IN (${SISTEMAS_EXCLUIDOS})
            AND e.disponibilidade IS NOT NULL
            AND NVL(e.agregado, 'N') <> 'S'
            AND NOT EXISTS (
                  SELECT 1
                    FROM automotivo.historico_tipoequipamento ht
                    JOIN automotivo.tipoequipamento te
                      ON te.cod_tipoequipamento = ht.cod_tipoequipamento
                   WHERE ht.cod_equipamento = e.cod_equipamento
                     AND ht.data_fim IS NULL
                     AND (
                       ht.cod_tipoequipamento = ${COD_TIPO_TERCEIRO}
                       OR UPPER(NVL(te.descricaotipoequipamento, ' ')) LIKE '%TERCEIR%'
                     )
                )
            __FILTRO_EQUIP__
       )
       SELECT * FROM Equipamento_componente
       ORDER BY cod_equipamento, cod_sistema, cod_componente`;

type AlertaComponente = {
  sistemaDescricao: string | null;
  componenteDescricao: string | null;
  status: ManutencaoStatus;
  kmRodado: number | null;
  limite: number | null;
};
type ResumoComponentesEquip = {
  qtde: number;
  situacao: ManutencaoStatus | null;
  alertas: AlertaComponente[];
};

async function loadResumoComponentesPorEquip(
  conn: Parameters<Parameters<typeof withOracle>[0]>[0],
  codEquipamento?: number | null,
) {
  const binds: Record<string, number> = { codGrupo: codGrupoEmpresa() };
  let filtroEquip = "";
  if (codEquipamento != null && Number.isFinite(codEquipamento)) {
    filtroEquip = "AND a.cod_equipamento = :codEquipamento";
    binds.codEquipamento = Number(codEquipamento);
  }

  const result = await conn.execute(
    SQL_COMPONENTES_BASE.replace("__FILTRO_EQUIP__", filtroEquip),
    binds,
  );

  const porEquip = new Map<number, ResumoComponentesEquip>();
  for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
    const codEq = oracleNumber(row, "cod_equipamento", "COD_EQUIPAMENTO");
    if (codEq == null) continue;
    const kmAtualEquip = oracleNumber(row, "km_atual_equip", "KM_ATUAL_EQUIP");
    const kmNaTroca = oracleNumber(row, "km_na_troca", "KM_NA_TROCA");
    const limiteKm = oracleNumber(row, "limite_kmrodado", "LIMITE_KMRODADO");
    const limiteHs = oracleNumber(row, "limite_hstrabalhada", "LIMITE_HSTRABALHADA");
    const limite = limiteKm != null && limiteKm > 0 ? limiteKm : limiteHs;
    const kmAtualPrincipal = oracleNumber(row, "km_atual_principal", "KM_ATUAL_PRINCIPAL");
    const usaHoraDoPrincipal = (limiteKm == null || limiteKm <= 0) && limiteHs != null && limiteHs > 0 && kmAtualPrincipal != null && kmAtualPrincipal > 0;
    const kmAtualBase = usaHoraDoPrincipal ? kmAtualPrincipal : kmAtualEquip;
    const kmRodado =
      kmAtualBase != null && kmNaTroca != null
        ? Math.max(0, kmAtualBase - kmNaTroca)
        : kmAtualBase != null && kmNaTroca == null
          ? kmAtualBase
          : null;
    const status = statusPorLimite(kmRodado, limite);

    const prev = porEquip.get(codEq) ?? { qtde: 0, situacao: null, alertas: [] };
    prev.qtde += 1;
    if (status !== "sem_plano") {
      prev.situacao = prev.situacao == null ? status : piorStatus(prev.situacao, status);
    }
    if (status === "vencido" || status === "a_vencer") {
      prev.alertas.push({
        sistemaDescricao: oracleText(row, "sistema_descricao", "SISTEMA_DESCRICAO"),
        componenteDescricao: oracleText(row, "componente_descricao", "COMPONENTE_DESCRICAO"),
        status,
        kmRodado,
        limite,
      });
    }
    porEquip.set(codEq, prev);
  }
  return porEquip;
}

function shortTipoLabel(descricao: string | null, codTipo: number | null) {
  const raw = (descricao || "").trim();
  if (!raw) return codTipo != null ? `Tipo ${codTipo}` : "Outros";
  const known: Record<string, string> = {
    motocicleta: "Motocicletas",
    motocicletas: "Motocicletas",
    carro: "Carros",
    carros: "Carros",
    "frota leve": "Carros",
    caminhao: "Caminhões",
    caminhões: "Caminhões",
    caminhoes: "Caminhões",
    "caminhao apoio": "Caminhões",
    "caminhao bombeiro": "Caminhões",
    trator: "Tratores",
    tratores: "Tratores",
    colhedora: "Colhedeiras",
    colhedeira: "Colhedeiras",
    colhedeiras: "Colhedeiras",
    eletrobomba: "Eletrobomba",
    "eletrobomba dupla": "Eletrobomba",
    "eletrobomba simples": "Eletrobomba",
    "motor gerador": "Motor Gerador",
    gerador: "Motor Gerador",
  };
  const key = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  for (const [needle, label] of Object.entries(known)) {
    if (key.includes(needle)) return label;
  }
  const first = raw.split(/[-–(/]/)[0]?.trim();
  return first || raw;
}

export type ManutencaoEquipamentoItem = {
  codEquipamento: number;
  descricao: string | null;
  kmAtual: number | null;
  codTipoEquipamento: number | null;
  tipoDescricao: string | null;
  categoria: string;
  status: ManutencaoStatus;
  kmUltimaPrev: number | null;
  kmRodado: number | null;
  kmLimite: number | null;
  kmRestante: number | null;
  periodoPlano: number | null;
  planoDescricao: string | null;
  codPlanoPrevencao: number | null;
  /** Plano da última OS entre os planos de renovação configurados na categoria. */
  codPlanoUltimaRenovacao: number | null;
  planoUltimaRenovacaoDescricao: string | null;
  dataUltimaPrev: string | null;
  anoUltimaOs: number | null;
  numeroUltimaOs: number | null;
  /** Quantidade de planos distintos já realizados (OS preventiva encerrada). */
  qtdePlanos: number;
  codEquipamentoAssociado: number | null;
  equipamentoAssociadoDescricao: string | null;
  osAberta: boolean;
  alertas: AlertaComponente[];
};

export type ManutencaoComponenteItem = {
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
  kmRodado: number | null;
  dataAbertura: string | null;
  dtUltimaTroca: string | null;
  codMaterial: number | null;
  materialDescricao: string | null;
  materiais: Array<{ codMaterial: number; descricao: string | null; quantidade: number | null }>;
  status: ManutencaoStatus;
};

function isoDate(v: unknown) {
  if (v == null) return null;
  if (v instanceof Date && Number.isFinite(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s.slice(0, 10) || null;
}

type OracleConn = Parameters<Parameters<typeof withOracle>[0]>[0];

type UltimaPrevPlano = {
  codEquipamento: number;
  codPlanoPrevencao: number;
  kmPrev: number | null;
  dataUltimaPrev: string | null;
  ordemKey: string;
  anoUltimaOs: number | null;
  numeroUltimaOs: number | null;
  kmLimite: number | null;
  periodo: number | null;
  planoDescricao: string | null;
};

type PlanoMeta = {
  codPlanoPrevencao: number;
  descricao: string | null;
  kmLimite: number | null;
  periodo: number | null;
};

function limiteEfetivo(kmLimite: number | null, periodo: number | null) {
  if (kmLimite != null && kmLimite > 0) return kmLimite;
  if (periodo != null && periodo > 0) return periodo;
  return null;
}

async function carregarQtdePlanosPorEquipamento(conn: OracleConn) {
  const result = await conn.execute(
    `SELECT os.cod_equipamento,
            COUNT(DISTINCT os.cod_planoprevencao) AS qtde_planos
       FROM automotivo.ordemservico os
       JOIN automotivo.planoprevencao pp
         ON pp.cod_planoprevencao = os.cod_planoprevencao
      WHERE os.cod_grupoempresa = :codGrupo
        AND os.cod_planoprevencao IS NOT NULL
        AND os.dtencerramento IS NOT NULL
        AND NVL(pp.ativo, 'S') = 'S'
      GROUP BY os.cod_equipamento`,
    { codGrupo: codGrupoEmpresa() },
  );
  const map = new Map<number, number>();
  for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
    const cod = oracleNumber(row, "cod_equipamento", "COD_EQUIPAMENTO");
    const qtde = oracleNumber(row, "qtde_planos", "QTDE_PLANOS");
    if (cod != null && qtde != null) map.set(cod, qtde);
  }
  return map;
}

async function carregarPlanosMeta(conn: OracleConn, planIds: number[]) {
  const map = new Map<number, PlanoMeta>();
  if (!planIds.length) return map;
  const binds: Record<string, unknown> = {};
  const placeholders = planIds.map((id, i) => {
    binds[`p${i}`] = id;
    return `:p${i}`;
  });
  const result = await conn.execute(
    `SELECT pp.cod_planoprevencao,
            pp.descricao,
            pp.kmlimite,
            pp.periodo
       FROM automotivo.planoprevencao pp
      WHERE pp.cod_planoprevencao IN (${placeholders.join(",")})
        AND NVL(pp.ativo, 'S') = 'S'`,
    binds,
  );
  for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
    const cod = oracleNumber(row, "cod_planoprevencao", "COD_PLANOPREVENCAO");
    if (cod == null) continue;
    map.set(cod, {
      codPlanoPrevencao: cod,
      descricao: oracleText(row, "descricao", "DESCRICAO"),
      kmLimite: oracleNumber(row, "kmlimite", "KMLIMITE"),
      periodo: oracleNumber(row, "periodo", "PERIODO"),
    });
  }
  return map;
}

async function carregarUltimaPrevPorPlanos(conn: OracleConn, planIds: number[]) {
  const map = new Map<string, UltimaPrevPlano>();
  if (!planIds.length) return map;
  const binds: Record<string, unknown> = { codGrupo: codGrupoEmpresa() };
  const placeholders = planIds.map((id, i) => {
    binds[`p${i}`] = id;
    return `:p${i}`;
  });
  const result = await conn.execute(
    `SELECT *
       FROM (
         SELECT os.cod_equipamento,
                os.km_atual AS km_prev,
                os.dtabertura AS data_ultima_prev,
                os.dtencerramento,
                os.ano_ordemservico AS ano_ultima_os,
                os.numero_ordemservico AS numero_ultima_os,
                os.cod_planoprevencao,
                pp.kmlimite,
                pp.periodo,
                pp.descricao AS plano_descricao,
                ROW_NUMBER() OVER (
                  PARTITION BY os.cod_equipamento, os.cod_planoprevencao
                  ORDER BY NVL(os.dtencerramento, os.dtabertura) DESC NULLS LAST,
                           os.ano_ordemservico DESC,
                           os.numero_ordemservico DESC
                ) AS rn
           FROM automotivo.ordemservico os
           JOIN automotivo.planoprevencao pp
             ON pp.cod_planoprevencao = os.cod_planoprevencao
          WHERE os.cod_grupoempresa = :codGrupo
            AND os.cod_planoprevencao IN (${placeholders.join(",")})
            AND os.dtencerramento IS NOT NULL
            AND NVL(pp.ativo, 'S') = 'S'
       )
      WHERE rn = 1`,
    binds,
  );
  for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
    const codEquipamento = oracleNumber(row, "cod_equipamento", "COD_EQUIPAMENTO");
    const codPlanoPrevencao = oracleNumber(row, "cod_planoprevencao", "COD_PLANOPREVENCAO");
    if (codEquipamento == null || codPlanoPrevencao == null) continue;
    const dtEnc = row.dtencerramento ?? row.DTENCERRAMENTO;
    const dtAbertura = row.data_ultima_prev ?? row.DATA_ULTIMA_PREV;
    const ordemBase = isoDate(dtEnc) ?? isoDate(dtAbertura) ?? "";
    const ano = oracleNumber(row, "ano_ultima_os", "ANO_ULTIMA_OS") ?? 0;
    const numero = oracleNumber(row, "numero_ultima_os", "NUMERO_ULTIMA_OS") ?? 0;
    map.set(`${codEquipamento}:${codPlanoPrevencao}`, {
      codEquipamento,
      codPlanoPrevencao,
      kmPrev: oracleNumber(row, "km_prev", "KM_PREV"),
      dataUltimaPrev: isoDate(dtAbertura),
      ordemKey: `${ordemBase} ${String(ano).padStart(6, "0")} ${String(numero).padStart(12, "0")}`,
      anoUltimaOs: oracleNumber(row, "ano_ultima_os", "ANO_ULTIMA_OS"),
      numeroUltimaOs: oracleNumber(row, "numero_ultima_os", "NUMERO_ULTIMA_OS"),
      kmLimite: oracleNumber(row, "kmlimite", "KMLIMITE"),
      periodo: oracleNumber(row, "periodo", "PERIODO"),
      planoDescricao: oracleText(row, "plano_descricao", "PLANO_DESCRICAO"),
    });
  }
  return map;
}

function pickUltimaPrevEntrePlanos(
  codEquipamento: number,
  planIds: number[],
  map: Map<string, UltimaPrevPlano>,
): UltimaPrevPlano | null {
  let best: UltimaPrevPlano | null = null;
  for (const planId of planIds) {
    const row = map.get(`${codEquipamento}:${planId}`);
    if (!row) continue;
    if (!best || row.ordemKey > best.ordemKey) best = row;
  }
  return best;
}

export type PlanoPrevencaoItem = {
  codPlanoPrevencao: number;
  descricao: string | null;
  kmLimite: number | null;
  periodo: number | null;
};

export async function listarPlanosPrevencao(): Promise<PlanoPrevencaoItem[]> {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT pp.cod_planoprevencao,
              pp.descricao,
              pp.kmlimite,
              pp.periodo
         FROM automotivo.planoprevencao pp
        WHERE NVL(pp.ativo, 'S') = 'S'
        ORDER BY pp.descricao, pp.cod_planoprevencao`,
    );
    const planos: PlanoPrevencaoItem[] = [];
    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const codPlanoPrevencao = oracleNumber(row, "cod_planoprevencao", "COD_PLANOPREVENCAO");
      if (codPlanoPrevencao == null) continue;
      planos.push({
        codPlanoPrevencao,
        descricao: oracleText(row, "descricao", "DESCRICAO"),
        kmLimite: oracleNumber(row, "kmlimite", "KMLIMITE"),
        periodo: oracleNumber(row, "periodo", "PERIODO"),
      });
    }
    return planos;
  });
}

export async function gerarQuadroManutencaoProgramada(opts?: {
  /** Categoria → plano cujo limite (km/h) define o acompanhamento. */
  planosPorCategoria?: Record<string, number>;
  /** Categoria → planos cuja última OS zera o acumulado (renovação). */
  dependenciasPorCategoria?: Record<string, number[]>;
}) {
  const planosPorCategoria = opts?.planosPorCategoria ?? {};
  const dependenciasPorCategoria = opts?.dependenciasPorCategoria ?? {};
  const planIdsLimite = [
    ...new Set(Object.values(planosPorCategoria).filter((id) => Number.isFinite(id) && id > 0)),
  ];
  const planIdsRenovacao = [
    ...new Set(
      Object.values(dependenciasPorCategoria)
        .flat()
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
  const planIdsConsulta = [...new Set([...planIdsLimite, ...planIdsRenovacao])];

  return withOracle(async (conn) => {
    const equipamentosTerceiro = buildEquipamentoTerceiroSet();
    const resumoComponentes = await loadResumoComponentesPorEquip(conn);
    const qtdePlanosPorEquip = await carregarQtdePlanosPorEquipamento(conn);
    const planosMeta = await carregarPlanosMeta(conn, planIdsLimite);
    const ultimaPrevPorPlano = await carregarUltimaPrevPorPlanos(conn, planIdsConsulta);

    const result = await conn.execute(
      `WITH tipo_vigente AS (
         SELECT ht.cod_equipamento,
                ht.cod_tipoequipamento,
                te.descricaotipoequipamento,
                te.exibequadro,
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
            AND ht.cod_tipoequipamento <> ${COD_TIPO_TERCEIRO}
            AND UPPER(NVL(te.descricaotipoequipamento, ' ')) NOT LIKE '%TERCEIR%'
       ),
       os_aberta AS (
         SELECT os.cod_equipamento,
                MAX(CASE WHEN os.cod_planoprevencao IS NOT NULL THEN 1 ELSE 0 END) AS tem_prev,
                MAX(os.cod_planoprevencao) AS cod_planoprevencao
           FROM automotivo.ordemservico os
          WHERE os.cod_grupoempresa = :codGrupo
            AND os.dtencerramento IS NULL
            AND os.cod_equipamento IS NOT NULL
          GROUP BY os.cod_equipamento
       ),
       ultima_prev AS (
         SELECT *
           FROM (
             SELECT os.cod_equipamento,
                    os.km_atual AS km_prev,
                    os.dtabertura,
                    os.dtencerramento,
                    os.ano_ordemservico,
                    os.numero_ordemservico,
                    os.cod_planoprevencao,
                    pp.kmlimite,
                    pp.periodo,
                    pp.descricao AS plano_descricao,
                    ROW_NUMBER() OVER (
                      PARTITION BY os.cod_equipamento
                      ORDER BY NVL(os.dtencerramento, os.dtabertura) DESC NULLS LAST,
                               os.ano_ordemservico DESC,
                               os.numero_ordemservico DESC
                    ) AS rn
               FROM automotivo.ordemservico os
               JOIN automotivo.planoprevencao pp
                 ON pp.cod_planoprevencao = os.cod_planoprevencao
              WHERE os.cod_grupoempresa = :codGrupo
                AND os.cod_planoprevencao IS NOT NULL
                AND os.dtencerramento IS NOT NULL
                AND NVL(pp.ativo, 'S') = 'S'
           )
          WHERE rn = 1
       ),
       leitura_atual AS (
         SELECT cod_equipamento,
                leitura_atual
           FROM (
             SELECT ia.cod_equipamento,
                    COALESCE(NULLIF(ia.horimetro_final, 0), NULLIF(ia.km_final, 0)) AS leitura_atual,
                    ROW_NUMBER() OVER (
                      PARTITION BY ia.cod_equipamento
                      ORDER BY ia.dt_apontamento DESC NULLS LAST,
                               ia.data_hora_final DESC NULLS LAST
                    ) AS rn
               FROM automotivo.itens_apontamento ia
              WHERE ia.cod_equipamento IS NOT NULL
                AND COALESCE(NULLIF(ia.horimetro_final, 0), NULLIF(ia.km_final, 0)) IS NOT NULL
           )
          WHERE rn = 1
       ),
       rendimento_vigente AS (
         SELECT *
           FROM (
             SELECT r.cod_equipamento_impl AS cod_equipamento,
                    r.cod_equipamento AS cod_equipamento_principal,
                    CASE
                      WHEN UPPER(NVL(e.tipohorimetro, 'N')) = 'H'
                        THEN COALESCE(NULLIF(e.horas_total, 0), NULLIF(e.km_atual, 0), la.leitura_atual)
                      ELSE e.km_atual
                    END AS km_atual_principal,
                    e.descricao AS equipamento_principal_descricao,
                    ROW_NUMBER() OVER (
                      PARTITION BY r.cod_equipamento_impl
                      ORDER BY NVL(r.data_inicio, DATE '1900-01-01') DESC,
                               NVL(r.sequencia, 0) DESC
                    ) AS rn
               FROM automotivo.rendimento r
               JOIN automotivo.equipamento e
                 ON e.cod_grupoempresa = r.cod_grupoempresa
                AND e.cod_equipamento = r.cod_equipamento
               LEFT JOIN leitura_atual la
                 ON la.cod_equipamento = e.cod_equipamento
              WHERE r.cod_grupoempresa = :codGrupo
                AND r.cod_grupoempresa_impl = :codGrupo
                AND r.cod_equipamento IS NOT NULL
                AND r.cod_equipamento_impl IS NOT NULL
                AND r.cod_equipamento <> r.cod_equipamento_impl
                AND r.data_inicio <= SYSDATE
                AND (r.data_fim IS NULL OR r.data_fim >= TRUNC(SYSDATE))
           )
          WHERE rn = 1
       )
       SELECT e.cod_equipamento,
              e.descricao,
              CASE
                WHEN UPPER(NVL(e.tipohorimetro, 'N')) = 'H'
                  THEN COALESCE(NULLIF(e.horas_total, 0), NULLIF(e.km_atual, 0), la.leitura_atual)
                ELSE e.km_atual
              END AS km_atual,
              rv.cod_equipamento_principal,
              rv.km_atual_principal,
              rv.equipamento_principal_descricao,
              tv.cod_tipoequipamento,
              tv.descricaotipoequipamento,
              NVL(oa.tem_prev, 0) AS os_aberta_prev,
              up.km_prev,
              up.dtabertura AS data_ultima_prev,
              up.ano_ordemservico AS ano_ultima_os,
              up.numero_ordemservico AS numero_ultima_os,
              up.cod_planoprevencao,
              up.kmlimite,
              up.periodo,
              up.plano_descricao
         FROM automotivo.equipamento e
         JOIN tipo_vigente tv
           ON tv.cod_equipamento = e.cod_equipamento
          AND tv.rn = 1
         LEFT JOIN os_aberta oa
           ON oa.cod_equipamento = e.cod_equipamento
         LEFT JOIN ultima_prev up
           ON up.cod_equipamento = e.cod_equipamento
         LEFT JOIN rendimento_vigente rv
           ON rv.cod_equipamento = e.cod_equipamento
         LEFT JOIN leitura_atual la
           ON la.cod_equipamento = e.cod_equipamento
        WHERE e.cod_grupoempresa = :codGrupo
          AND NVL(e.ativo, 'S') = 'S'
          AND e.disponibilidade IS NOT NULL
          AND NVL(e.agregado, 'N') <> 'S'
        ORDER BY tv.descricaotipoequipamento, e.cod_equipamento`,
      { codGrupo: codGrupoEmpresa() },
    );

    const equipamentos: ManutencaoEquipamentoItem[] = [];
    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const codEquipamento = oracleNumber(row, "cod_equipamento", "COD_EQUIPAMENTO");
      if (codEquipamento == null) continue;
      const tipoDescricao = oracleText(row, "descricaotipoequipamento", "DESCRICAOTIPOEQUIPAMENTO");
      const codTipo = oracleNumber(row, "cod_tipoequipamento", "COD_TIPOEQUIPAMENTO");
      const categoria = shortTipoLabel(tipoDescricao, codTipo);
      if (isEquipamentoTerceiro(equipamentosTerceiro, codEquipamento, categoria, codTipo)) continue;
      const kmAtual = oracleNumber(row, "km_atual", "KM_ATUAL");
      const kmAtualPrincipal = oracleNumber(row, "km_atual_principal", "KM_ATUAL_PRINCIPAL");
      let kmPrev = oracleNumber(row, "km_prev", "KM_PREV");
      let kmLimite = oracleNumber(row, "kmlimite", "KMLIMITE");
      let periodo = oracleNumber(row, "periodo", "PERIODO");
      let planoDescricao = oracleText(row, "plano_descricao", "PLANO_DESCRICAO");
      let codPlanoPrevencao = oracleNumber(row, "cod_planoprevencao", "COD_PLANOPREVENCAO");
      let codPlanoUltimaRenovacao = codPlanoPrevencao;
      let planoUltimaRenovacaoDescricao = planoDescricao;
      let dataUltimaPrev = isoDate(row.data_ultima_prev ?? row.DATA_ULTIMA_PREV);
      let anoUltimaOs = oracleNumber(row, "ano_ultima_os", "ANO_ULTIMA_OS");
      let numeroUltimaOs = oracleNumber(row, "numero_ultima_os", "NUMERO_ULTIMA_OS");
      const osAberta = (oracleNumber(row, "os_aberta_prev", "OS_ABERTA_PREV") ?? 0) > 0;
      const qtdePlanos = qtdePlanosPorEquip.get(codEquipamento) ?? (codPlanoPrevencao != null ? 1 : 0);

      const planoCategoria = planosPorCategoria[categoria];

      // Limite = plano da categoria; acumulado zera na última OS entre os planos de renovação.
      if (planoCategoria != null) {
        const meta = planosMeta.get(planoCategoria);
        const depsRaw = dependenciasPorCategoria[categoria] ?? [];
        const deps = [...new Set([planoCategoria, ...depsRaw].filter((id) => Number.isFinite(id) && id > 0))];
        const prevRenovacao = pickUltimaPrevEntrePlanos(codEquipamento, deps, ultimaPrevPorPlano);
        codPlanoPrevencao = planoCategoria;
        planoDescricao = meta?.descricao ?? null;
        kmLimite = meta?.kmLimite ?? null;
        periodo = meta?.periodo ?? null;
        if (prevRenovacao) {
          kmPrev = prevRenovacao.kmPrev;
          dataUltimaPrev = prevRenovacao.dataUltimaPrev;
          anoUltimaOs = prevRenovacao.anoUltimaOs;
          numeroUltimaOs = prevRenovacao.numeroUltimaOs;
          codPlanoUltimaRenovacao = prevRenovacao.codPlanoPrevencao;
          planoUltimaRenovacaoDescricao = prevRenovacao.planoDescricao;
        } else {
          kmPrev = null;
          dataUltimaPrev = null;
          anoUltimaOs = null;
          numeroUltimaOs = null;
          codPlanoUltimaRenovacao = null;
          planoUltimaRenovacaoDescricao = null;
        }
      }

      const limite = limiteEfetivo(kmLimite, periodo);
      const usaHoraDoPrincipal = kmLimite != null && kmLimite > 0 && kmAtualPrincipal != null && kmAtualPrincipal > 0;
      const kmAtualPlano = usaHoraDoPrincipal ? kmAtualPrincipal : kmAtual;
      const kmRodado =
        kmAtualPlano != null && kmPrev != null
          ? Math.max(0, kmAtualPlano - kmPrev)
          : kmAtualPlano != null && kmPrev == null
            ? kmAtualPlano
            : null;

      const compResumo = resumoComponentes.get(codEquipamento) ?? { qtde: 0, situacao: null, alertas: [] };
      const prioridade = computePrioridadePlano(osAberta, kmRodado, limite);
      const status = computeSituacaoPlanoEquip({
        ultmKmPlano: kmPrev,
        situacaoComponente: compResumo.situacao,
        prioridade,
        qtdeComponente: compResumo.qtde,
        categoria,
      });

      equipamentos.push({
        codEquipamento,
        descricao: oracleText(row, "descricao", "DESCRICAO"),
        kmAtual: kmAtualPlano,
        codTipoEquipamento: codTipo,
        tipoDescricao,
        categoria,
        status,
        kmUltimaPrev: kmPrev,
        kmRodado,
        kmLimite: limite,
        kmRestante: limite != null && kmRodado != null ? limite - kmRodado : null,
        periodoPlano: periodo,
        planoDescricao,
        codPlanoPrevencao,
        codPlanoUltimaRenovacao,
        planoUltimaRenovacaoDescricao,
        dataUltimaPrev,
        anoUltimaOs,
        numeroUltimaOs,
        qtdePlanos,
        codEquipamentoAssociado: oracleNumber(row, "cod_equipamento_principal", "COD_EQUIPAMENTO_PRINCIPAL"),
        equipamentoAssociadoDescricao: oracleText(
          row,
          "equipamento_principal_descricao",
          "EQUIPAMENTO_PRINCIPAL_DESCRICAO",
        ),
        osAberta,
        alertas: compResumo.alertas,
      });
    }

    const categoriasMap = new Map<
      string,
      {
        categoria: string;
        codTipoEquipamento: number | null;
        equipamentos: ManutencaoEquipamentoItem[];
        emDia: number;
        aVencer: number;
        vencido: number;
        emExecucao: number;
        semPlano: number;
      }
    >();

    for (const eq of equipamentos) {
      const key = eq.categoria;
      let bucket = categoriasMap.get(key);
      if (!bucket) {
        bucket = {
          categoria: eq.categoria,
          codTipoEquipamento: eq.codTipoEquipamento,
          equipamentos: [],
          emDia: 0,
          aVencer: 0,
          vencido: 0,
          emExecucao: 0,
          semPlano: 0,
        };
        categoriasMap.set(key, bucket);
      }
      bucket.equipamentos.push(eq);
      if (eq.status === "em_dia") bucket.emDia += 1;
      else if (eq.status === "a_vencer") bucket.aVencer += 1;
      else if (eq.status === "vencido") bucket.vencido += 1;
      else if (eq.status === "em_execucao") bucket.emExecucao += 1;
      else bucket.semPlano += 1;
    }

    for (const bucket of categoriasMap.values()) {
      bucket.equipamentos.sort((a, b) => a.codEquipamento - b.codEquipamento);
    }

    const categorias = [...categoriasMap.values()].sort(
      (a, b) =>
        b.emExecucao - a.emExecucao ||
        b.vencido - a.vencido ||
        b.aVencer - a.aVencer ||
        a.categoria.localeCompare(b.categoria, "pt-BR"),
    );

    const totais = {
      emDia: equipamentos.filter((e) => e.status === "em_dia").length,
      aVencer: equipamentos.filter((e) => e.status === "a_vencer").length,
      vencido: equipamentos.filter((e) => e.status === "vencido").length,
      emExecucao: equipamentos.filter((e) => e.status === "em_execucao").length,
      semPlano: equipamentos.filter((e) => e.status === "sem_plano").length,
      total: equipamentos.length,
    };

    return {
      atualizadoEm: new Date().toISOString(),
      alertaPct: ALERTA_PCT,
      totais,
      categorias,
      equipamentos,
    };
  });
}

export async function gerarComponentesManutencaoProgramada(codEquipamento?: number | null) {
  return withOracle(async (conn) => {
    const equipamentosTerceiro = buildEquipamentoTerceiroSet();
    const binds: Record<string, number> = { codGrupo: codGrupoEmpresa() };
    const filtroEquip =
      codEquipamento != null && Number.isFinite(codEquipamento)
        ? "AND a.cod_equipamento = :codEquipamento"
        : "";
    if (codEquipamento != null && Number.isFinite(codEquipamento)) {
      binds.codEquipamento = Number(codEquipamento);
    }

    const result = await conn.execute(
      `WITH        UltimaData AS (
         SELECT b.cod_equipamento,
                a.cod_servicobis,
                a.cod_sistema,
                a.cod_componente,
                MAX(a.data) AS ultima_troca,
                MAX(b.dtabertura) AS ultima_data
           FROM automotivo.itens_ordemservico a
           LEFT JOIN automotivo.ordemservico b
             ON a.ano_ordemservico = b.ano_ordemservico
            AND a.numero_ordemservico = b.numero_ordemservico
          WHERE a.cod_servicobis = ${SERVICO_TROCA}
          GROUP BY b.cod_equipamento, a.cod_servicobis, a.cod_sistema, a.cod_componente
       ),
       Ultima_troca AS (
         SELECT u.cod_equipamento,
                u.ultima_data AS dataabertura,
                u.ultima_troca AS dt_ultimatroca,
                u.cod_servicobis,
                u.cod_sistema,
                u.cod_componente,
                b.km_atual,
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
       Leitura_atual AS (
         SELECT cod_equipamento,
                leitura_atual
           FROM (
             SELECT ia.cod_equipamento,
                    COALESCE(NULLIF(ia.horimetro_final, 0), NULLIF(ia.km_final, 0)) AS leitura_atual,
                    ROW_NUMBER() OVER (
                      PARTITION BY ia.cod_equipamento
                      ORDER BY ia.dt_apontamento DESC NULLS LAST,
                               ia.data_hora_final DESC NULLS LAST
                    ) AS rn
               FROM automotivo.itens_apontamento ia
              WHERE ia.cod_equipamento IS NOT NULL
                AND COALESCE(NULLIF(ia.horimetro_final, 0), NULLIF(ia.km_final, 0)) IS NOT NULL
           )
          WHERE rn = 1
       ),
       Rendimento_vigente AS (
         SELECT *
           FROM (
             SELECT r.cod_equipamento_impl AS cod_equipamento,
                    r.cod_equipamento AS cod_equipamento_principal,
                    CASE
                      WHEN UPPER(NVL(e.tipohorimetro, 'N')) = 'H'
                        THEN COALESCE(NULLIF(e.horas_total, 0), NULLIF(e.km_atual, 0), la.leitura_atual)
                      ELSE e.km_atual
                    END AS km_atual_principal,
                    ROW_NUMBER() OVER (
                      PARTITION BY r.cod_equipamento_impl
                      ORDER BY NVL(r.data_inicio, DATE '1900-01-01') DESC,
                               NVL(r.sequencia, 0) DESC
                    ) AS rn
               FROM automotivo.rendimento r
               JOIN automotivo.equipamento e
                 ON e.cod_grupoempresa = r.cod_grupoempresa
                AND e.cod_equipamento = r.cod_equipamento
               LEFT JOIN Leitura_atual la
                 ON la.cod_equipamento = e.cod_equipamento
              WHERE r.cod_grupoempresa = :codGrupo
                AND r.cod_grupoempresa_impl = :codGrupo
                AND r.cod_equipamento IS NOT NULL
                AND r.cod_equipamento_impl IS NOT NULL
                AND r.cod_equipamento <> r.cod_equipamento_impl
                AND r.data_inicio <= SYSDATE
                AND (r.data_fim IS NULL OR r.data_fim >= TRUNC(SYSDATE))
           )
          WHERE rn = 1
       ),
       Equipamento_componente AS (
         SELECT a.cod_equipamento,
                a.cod_sistema,
                a.cod_componente,
                a.limite_kmrodado,
                a.limite_hstrabalhada,
                a.qtde_lttroca,
                b.km_atual AS km_na_troca,
                b.dataabertura,
                b.dt_ultimatroca,
                a.cod_material,
                CASE
                  WHEN UPPER(NVL(e.tipohorimetro, 'N')) = 'H'
                    THEN COALESCE(NULLIF(e.horas_total, 0), NULLIF(e.km_atual, 0), la.leitura_atual)
                  ELSE e.km_atual
                END AS km_atual_equip,
                rv.cod_equipamento_principal,
                rv.km_atual_principal,
                e.descricao AS equip_descricao,
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
           LEFT JOIN Leitura_atual la
             ON la.cod_equipamento = a.cod_equipamento
           LEFT JOIN Rendimento_vigente rv
             ON rv.cod_equipamento = a.cod_equipamento
           LEFT JOIN automotivo.sistemas s
             ON s.cod_sistema = a.cod_sistema
           LEFT JOIN automotivo.componentes c
             ON c.cod_sistema = a.cod_sistema
            AND c.cod_componente = a.cod_componente
           LEFT JOIN material.material m
             ON m.cod_material = a.cod_material
          WHERE a.cod_grupoempresa = :codGrupo
            AND a.cod_sistema NOT IN (${SISTEMAS_EXCLUIDOS})
            AND e.disponibilidade IS NOT NULL
            AND NVL(e.agregado, 'N') <> 'S'
            AND NOT EXISTS (
                  SELECT 1
                    FROM automotivo.historico_tipoequipamento ht
                    JOIN automotivo.tipoequipamento te
                      ON te.cod_tipoequipamento = ht.cod_tipoequipamento
                   WHERE ht.cod_equipamento = e.cod_equipamento
                     AND ht.data_fim IS NULL
                     AND (
                       ht.cod_tipoequipamento = ${COD_TIPO_TERCEIRO}
                       OR UPPER(NVL(te.descricaotipoequipamento, ' ')) LIKE '%TERCEIR%'
                     )
                )
            ${filtroEquip}
       )
       SELECT * FROM Equipamento_componente
       ORDER BY cod_equipamento, cod_sistema, cod_componente`,
      binds,
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

    const componentes: ManutencaoComponenteItem[] = [];
    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const codEq = oracleNumber(row, "cod_equipamento", "COD_EQUIPAMENTO");
      const codSistema = oracleNumber(row, "cod_sistema", "COD_SISTEMA");
      const codComponente = oracleNumber(row, "cod_componente", "COD_COMPONENTE");
      if (codEq == null || codSistema == null || codComponente == null) continue;
      if (isEquipamentoTerceiro(equipamentosTerceiro, codEq)) continue;

      const kmAtualEquip = oracleNumber(row, "km_atual_equip", "KM_ATUAL_EQUIP");
      const kmNaTroca = oracleNumber(row, "km_na_troca", "KM_NA_TROCA");
      const limiteKm = oracleNumber(row, "limite_kmrodado", "LIMITE_KMRODADO");
      const limiteHs = oracleNumber(row, "limite_hstrabalhada", "LIMITE_HSTRABALHADA");
      const limite = limiteKm != null && limiteKm > 0 ? limiteKm : limiteHs;
      const kmAtualPrincipal = oracleNumber(row, "km_atual_principal", "KM_ATUAL_PRINCIPAL");
      const usaHoraDoPrincipal = (limiteKm == null || limiteKm <= 0) && limiteHs != null && limiteHs > 0 && kmAtualPrincipal != null && kmAtualPrincipal > 0;
      const kmAtualBase = usaHoraDoPrincipal ? kmAtualPrincipal : kmAtualEquip;
      const kmRodado =
        kmAtualBase != null && kmNaTroca != null
          ? Math.max(0, kmAtualBase - kmNaTroca)
          : kmAtualBase != null && kmNaTroca == null
            ? kmAtualBase
            : null;

      const materiais = materiaisPorComp.get(`${codSistema}:${codComponente}`) ?? [];
      const codMaterial = oracleNumber(row, "cod_material", "COD_MATERIAL");

      componentes.push({
        codEquipamento: codEq,
        codSistema,
        sistemaDescricao: oracleText(row, "sistema_descricao", "SISTEMA_DESCRICAO"),
        codComponente,
        componenteDescricao: oracleText(row, "componente_descricao", "COMPONENTE_DESCRICAO"),
        limiteKmRodado: limiteKm,
        limiteHsTrabalhada: limiteHs,
        qtdeLtTroca: oracleNumber(row, "qtde_lttroca", "QTDE_LTTROCA"),
        kmAtualEquipamento: kmAtualBase,
        kmNaUltimaTroca: kmNaTroca,
        kmRodado,
        dataAbertura: isoDate(row.dataabertura ?? row.DATAABERTURA),
        dtUltimaTroca: isoDate(row.dt_ultimatroca ?? row.DT_ULTIMATROCA),
        codMaterial,
        materialDescricao: oracleText(row, "material_descricao", "MATERIAL_DESCRICAO"),
        materiais,
        status: statusPorLimite(kmRodado, limite),
      });
    }

    const totais = {
      emDia: componentes.filter((c) => c.status === "em_dia").length,
      aVencer: componentes.filter((c) => c.status === "a_vencer").length,
      vencido: componentes.filter((c) => c.status === "vencido").length,
      semPlano: componentes.filter((c) => c.status === "sem_plano").length,
      total: componentes.length,
    };

    return {
      atualizadoEm: new Date().toISOString(),
      alertaPct: ALERTA_PCT,
      codEquipamento: codEquipamento ?? null,
      totais,
      componentes,
    };
  });
}
