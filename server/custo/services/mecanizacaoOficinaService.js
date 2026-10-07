import { getConnection } from '../config/db.js';

/** Objeto de custo de mecanização agrícola: negócio 3 / processo 1 / subprocesso 3 */
export const FILTRO_MECANIZACAO = {
  negocio: 3,
  processo: 1,
  subprocesso: 3,
};

const EQUIP_MECANIZACAO_SQL = `
SELECT
    a.cod_equipamento,
    a.cod_objetocusto,
    a.cod_empresa,
    a.cod_filial
FROM automotivo.historicoequipamentoobcusto a
WHERE a.data_final IS NULL
  AND EXISTS (
    SELECT 1
    FROM custo.objetocusto b
    WHERE b.negocio = 3
      AND b.processo = 1
      AND b.subprocesso = 3
      AND a.cod_objetocusto = b.cod_objetocusto
  )
`;

const CLIENTES_MECANIZACAO_SQL = `
SELECT
    a.cod_objetocusto,
    c.cod_objetocusto AS objcustocliente
FROM custo.prestador a
LEFT JOIN custo.unidadeobjetocusto c
    ON a.cod_unidaderateio = c.cod_unidaderateio
WHERE EXISTS (
    SELECT 1
    FROM custo.objetocusto b
    WHERE b.negocio = 3
      AND b.processo = 1
      AND b.subprocesso = 3
      AND a.cod_objetocusto = b.cod_objetocusto
)
`;

function toNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Clientes (prestador → unidadeobjetocusto) do objeto de mecanização vigente
 * do equipamento.
 */
export function clientesDoEquipamentoMecanizacao(codEquipamento, mapas = {}) {
  const eqParaObjMecanizacao = mapas.eqParaObjMecanizacao ?? new Map();
  const clientesPorObj = mapas.clientesPorObjMecanizacao ?? new Map();
  const eq = codEquipamento == null ? null : Number(codEquipamento);
  const objMecanizacao =
    eq != null && Number.isFinite(eq)
      ? eqParaObjMecanizacao.get(eq) ?? null
      : null;
  const clientes =
    objMecanizacao != null ? clientesPorObj.get(objMecanizacao) || [] : [];
  const pesoTotal = clientes.reduce((acc, c) => acc + (c.peso || 0), 0);
  return { objMecanizacao, clientes, pesoTotal };
}

/**
 * @returns {{
 *   eqParaObjMecanizacao: Map<number, number>,
 *   clientesPorObjMecanizacao: Map<number, { objetoCliente: number, peso: number }[]>,
 *   equipamentosMecanizacao: number[]
 * }}
 */
export async function carregarMapasMecanizacaoCliente() {
  const connection = await getConnection();
  try {
    const eqRes = await connection.execute(EQUIP_MECANIZACAO_SQL);
    const cliRes = await connection.execute(CLIENTES_MECANIZACAO_SQL);

    const eqParaObjMecanizacao = new Map();
    const preferEmpresaFilial = new Set();
    for (const row of eqRes.rows || []) {
      const eq = toNumber(row.COD_EQUIPAMENTO);
      const obj = toNumber(row.COD_OBJETOCUSTO);
      if (eq == null || obj == null) continue;
      const empresa1Filial1 =
        Number(row.COD_EMPRESA) === 1 && Number(row.COD_FILIAL) === 1;
      if (preferEmpresaFilial.has(eq) && !empresa1Filial1) continue;
      eqParaObjMecanizacao.set(eq, obj);
      if (empresa1Filial1) preferEmpresaFilial.add(eq);
    }

    /** @type {Map<number, Map<number, number>>} */
    const pesoPorPar = new Map();
    for (const row of cliRes.rows || []) {
      const objMec = toNumber(row.COD_OBJETOCUSTO);
      const objCliente = toNumber(row.OBJCUSTOCLIENTE);
      if (objMec == null || objCliente == null) continue;
      if (!pesoPorPar.has(objMec)) pesoPorPar.set(objMec, new Map());
      const m = pesoPorPar.get(objMec);
      m.set(objCliente, (m.get(objCliente) || 0) + 1);
    }

    const clientesPorObjMecanizacao = new Map();
    for (const [objMec, clientes] of pesoPorPar.entries()) {
      clientesPorObjMecanizacao.set(
        objMec,
        [...clientes.entries()].map(([objetoCliente, peso]) => ({
          objetoCliente,
          peso,
        }))
      );
    }

    return {
      eqParaObjMecanizacao,
      clientesPorObjMecanizacao,
      equipamentosMecanizacao: [...eqParaObjMecanizacao.keys()],
    };
  } finally {
    await connection.close();
  }
}
