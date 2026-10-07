import { oracleDate, oracleNumber, oracleText, withOracle } from "./oracle.js";

const SEED_OPERATION = 159;

export interface SeedFarmRadius {
  farmCode: number;
  farmName: string;
  cadastralKm: number | null;
  averageKm: number | null;
  minKm: number | null;
  maxKm: number | null;
  trips: number;
}

export interface SeedFarmTrip {
  date: string | null;
  originCode: number | null;
  originName: string;
  destCode: number | null;
  destName: string;
  distanceKm: number | null;
  quantity: number | null;
}

function isoDay(raw?: string | null) {
  const value = (raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function dateFilterSql(from: string | null, to: string | null) {
  const clauses: string[] = [];
  const binds: Record<string, string | number> = { operacao: SEED_OPERATION };
  if (from) {
    clauses.push("TRUNC(a.dt_apontamento) >= TO_DATE(:fromDate, 'YYYY-MM-DD')");
    binds.fromDate = from;
  }
  if (to) {
    clauses.push("TRUNC(a.dt_apontamento) <= TO_DATE(:toDate, 'YYYY-MM-DD')");
    binds.toDate = to;
  }
  return { extra: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", binds };
}

export async function listSeedRadius(fromDate?: string | null, toDate?: string | null) {
  const from = isoDay(fromDate);
  const to = isoDay(toDate);
  return withOracle(async (conn) => {
    const farms = await conn.execute(
      `SELECT f.cod_fazenda, f.descricao, f.distancia
         FROM agricola.fazenda f
        WHERE NVL(f.cod_fazenda, -1) <> 0
        ORDER BY f.descricao, f.cod_fazenda`,
    );
    const { extra, binds } = dateFilterSql(from, to);
    const averages = await conn.execute(
      `SELECT NVL(i.cod_fazenda_origem, i.cod_fazenda_destino) AS cod_fazenda,
              AVG(i.distancia) AS raio_medio,
              MIN(i.distancia) AS raio_min,
              MAX(i.distancia) AS raio_max,
              COUNT(*) AS qtd
         FROM automotivo.itens_apontamentoterceiro i
         JOIN automotivo.apontamentoterceiro a
           ON a.ano_apontamento = i.ano_apontamento
          AND a.numero_apontamento = i.numero_apontamento
          AND a.cod_grupoempresa = i.cod_grupoempresa
          AND a.cod_empresa = i.cod_empresa
          AND a.cod_filial = i.cod_filial
        WHERE i.cod_operacaoagricola = :operacao
          AND i.distancia IS NOT NULL
          AND NVL(i.cod_fazenda_origem, i.cod_fazenda_destino) IS NOT NULL
          ${extra}
        GROUP BY NVL(i.cod_fazenda_origem, i.cod_fazenda_destino)`,
      binds,
    );

    const byFarm = new Map<number, { averageKm: number; minKm: number; maxKm: number; trips: number }>();
    for (const raw of (averages.rows ?? []) as Record<string, unknown>[]) {
      const farmCode = oracleNumber(raw, "cod_fazenda");
      if (farmCode == null) continue;
      byFarm.set(farmCode, {
        averageKm: oracleNumber(raw, "raio_medio") ?? 0,
        minKm: oracleNumber(raw, "raio_min"),
        maxKm: oracleNumber(raw, "raio_max"),
        trips: oracleNumber(raw, "qtd") ?? 0,
      });
    }

    const rows: SeedFarmRadius[] = ((farms.rows ?? []) as Record<string, unknown>[]).map((raw) => {
      const farmCode = oracleNumber(raw, "cod_fazenda") ?? 0;
      const stats = byFarm.get(farmCode);
      return {
        farmCode,
        farmName: oracleText(raw, "descricao") || `Fazenda ${farmCode}`,
        cadastralKm: oracleNumber(raw, "distancia"),
        averageKm: stats?.averageKm ?? null,
        minKm: stats?.minKm ?? null,
        maxKm: stats?.maxKm ?? null,
        trips: stats?.trips ?? 0,
      };
    });

    return {
      fromDate: from,
      toDate: to,
      operation: SEED_OPERATION,
      farms: rows,
    };
  });
}

export async function listSeedRadiusTrips(farmCode: number, fromDate?: string | null, toDate?: string | null) {
  const from = isoDay(fromDate);
  const to = isoDay(toDate);
  if (!Number.isFinite(farmCode)) throw new Error("Informe a fazenda.");
  return withOracle(async (conn) => {
    const { extra, binds } = dateFilterSql(from, to);
    const result = await conn.execute(
      `SELECT a.dt_apontamento,
              i.cod_fazenda_origem,
              orig.descricao AS origem_nome,
              i.cod_fazenda_destino,
              dest.descricao AS destino_nome,
              i.distancia,
              i.quantidade
         FROM automotivo.itens_apontamentoterceiro i
         JOIN automotivo.apontamentoterceiro a
           ON a.ano_apontamento = i.ano_apontamento
          AND a.numero_apontamento = i.numero_apontamento
          AND a.cod_grupoempresa = i.cod_grupoempresa
          AND a.cod_empresa = i.cod_empresa
          AND a.cod_filial = i.cod_filial
         LEFT JOIN agricola.fazenda orig ON orig.cod_fazenda = i.cod_fazenda_origem
         LEFT JOIN agricola.fazenda dest ON dest.cod_fazenda = i.cod_fazenda_destino
        WHERE i.cod_operacaoagricola = :operacao
          AND i.distancia IS NOT NULL
          AND NVL(i.cod_fazenda_origem, i.cod_fazenda_destino) = :farmCode
          ${extra}
        ORDER BY a.dt_apontamento DESC
        FETCH FIRST 300 ROWS ONLY`,
      { ...binds, farmCode },
    );
    const trips: SeedFarmTrip[] = ((result.rows ?? []) as Record<string, unknown>[]).map((raw) => ({
      date: oracleDate(raw, "dt_apontamento"),
      originCode: oracleNumber(raw, "cod_fazenda_origem"),
      originName: oracleText(raw, "origem_nome"),
      destCode: oracleNumber(raw, "cod_fazenda_destino"),
      destName: oracleText(raw, "destino_nome"),
      distanceKm: oracleNumber(raw, "distancia"),
      quantity: oracleNumber(raw, "quantidade"),
    }));
    return { farmCode, fromDate: from, toDate: to, trips };
  });
}
