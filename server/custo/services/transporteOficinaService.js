import { getConnection } from '../config/db.js';

/** Objeto de custo de transporte: negócio 3 / processo 1 / subprocesso 2 */
export const FILTRO_TRANSPORTE = {
  negocio: 3,
  processo: 1,
  subprocesso: 2,
};

/** Objeto de custo vigente do equipamento (sem filtrar transporte). */
const EQUIP_OBJETO_ATUAL_SQL = `
SELECT
    a.cod_equipamento,
    a.cod_objetocusto
FROM automotivo.historicoequipamentoobcusto a
WHERE a.data_final IS NULL
  AND a.cod_empresa = 1
  AND a.cod_filial = 1
`;

const EQUIP_TRANSPORTE_SQL = `
SELECT
    a.cod_equipamento,
    a.cod_objetocusto
FROM automotivo.historicoequipamentoobcusto a
WHERE a.data_final IS NULL
  AND a.cod_empresa = 1
  AND a.cod_filial = 1
  AND EXISTS (
      SELECT 1
      FROM custo.objetocusto b
      WHERE b.negocio = 3
        AND b.processo = 1
        AND b.subprocesso = 2
        AND a.cod_objetocusto = b.cod_objetocusto
  )
`;

const CLIENTES_TRANSPORTE_SQL = `
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
      AND b.subprocesso = 2
      AND a.cod_objetocusto = b.cod_objetocusto
)
`;

function toNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Clientes (prestador → unidadeobjetocusto) do objeto de transporte vigente
 * do equipamento.
 */
export function clientesDoEquipamentoTransporte(codEquipamento, mapas = {}) {
  const eqParaObjTransporte = mapas.eqParaObjTransporte ?? new Map();
  const clientesPorObj = mapas.clientesPorObjTransporte ?? new Map();
  const eq = codEquipamento == null ? null : Number(codEquipamento);
  const objTransporte =
    eq != null && Number.isFinite(eq)
      ? eqParaObjTransporte.get(eq) ?? null
      : null;
  const clientes =
    objTransporte != null ? clientesPorObj.get(objTransporte) || [] : [];
  const pesoTotal = clientes.reduce((acc, c) => acc + (c.peso || 0), 0);
  return { objTransporte, clientes, pesoTotal };
}

/** Rateia um valor entre objetos clientes, proporcional ao peso (unidades). */
export function fatiarCustoParaClientes(valor, clientes) {
  const pesoTotal = (clientes || []).reduce(
    (acc, c) => acc + (c.peso || 0),
    0
  );
  if (!clientes?.length || pesoTotal <= 0 || Math.abs(valor) < 0.005) {
    return [];
  }
  const partes = [];
  let acumulado = 0;
  for (let i = 0; i < clientes.length; i += 1) {
    const { objetoCliente, peso } = clientes[i];
    const parte =
      i === clientes.length - 1
        ? valor - acumulado
        : valor * (peso / pesoTotal);
    acumulado += parte;
    partes.push({
      objetoCliente,
      peso,
      percentual: peso / pesoTotal,
      valor: parte,
    });
  }
  return partes;
}

/**
 * @returns {{
 *   eqParaObjAtual: Map<number, number>,
 *   eqParaObjTransporte: Map<number, number>,
 *   clientesPorObjTransporte: Map<number, { objetoCliente: number, peso: number }[]>,
 *   equipamentosTransporte: number[]
 * }}
 */
export async function carregarMapasTransporteCliente() {
  const connection = await getConnection();
  try {
    const [atualRes, eqRes, cliRes] = await Promise.all([
      connection.execute(EQUIP_OBJETO_ATUAL_SQL),
      connection.execute(EQUIP_TRANSPORTE_SQL),
      connection.execute(CLIENTES_TRANSPORTE_SQL),
    ]);

    const eqParaObjAtual = new Map();
    for (const row of atualRes.rows || []) {
      const eq = toNumber(row.COD_EQUIPAMENTO);
      const obj = toNumber(row.COD_OBJETOCUSTO);
      if (eq == null || obj == null) continue;
      eqParaObjAtual.set(eq, obj);
    }

    const eqParaObjTransporte = new Map();
    for (const row of eqRes.rows || []) {
      const eq = toNumber(row.COD_EQUIPAMENTO);
      const obj = toNumber(row.COD_OBJETOCUSTO);
      if (eq == null || obj == null) continue;
      eqParaObjTransporte.set(eq, obj);
    }

    /** @type {Map<number, Map<number, number>>} */
    const pesoPorPar = new Map();
    for (const row of cliRes.rows || []) {
      const objTransp = toNumber(row.COD_OBJETOCUSTO);
      const objCliente = toNumber(row.OBJCUSTOCLIENTE);
      if (objTransp == null || objCliente == null) continue;
      if (!pesoPorPar.has(objTransp)) pesoPorPar.set(objTransp, new Map());
      const m = pesoPorPar.get(objTransp);
      m.set(objCliente, (m.get(objCliente) || 0) + 1);
    }

    const clientesPorObjTransporte = new Map();
    for (const [objTransp, clientes] of pesoPorPar.entries()) {
      clientesPorObjTransporte.set(
        objTransp,
        [...clientes.entries()].map(([objetoCliente, peso]) => ({
          objetoCliente,
          peso,
        }))
      );
    }

    return {
      eqParaObjAtual,
      eqParaObjTransporte,
      clientesPorObjTransporte,
      equipamentosTransporte: [...eqParaObjTransporte.keys()],
    };
  } finally {
    await connection.close();
  }
}
