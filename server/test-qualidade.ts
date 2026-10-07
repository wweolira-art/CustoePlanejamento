import { withOracle } from "./oracle.js";

async function main() {
  // 1) Quantas amostras existem em agricola.perdas no período?
  const r1 = await withOracle(async (conn) => {
    return conn.execute(
      `SELECT COUNT(*) AS cnt
         FROM agricola.perdas p
        WHERE p.cod_grupoempresa = :codGrupo
          AND p.data_amostra IS NOT NULL
          AND TRUNC(p.data_amostra) BETWEEN TO_DATE(:di, 'YYYY-MM-DD') AND TO_DATE(:df, 'YYYY-MM-DD')`,
      { codGrupo: Number(process.env.COD_GRUPOEMPRESA || 1), di: "2025-09-01", df: "2026-03-22" },
    );
  });
  console.log("1) Total perdas no período:", (r1.rows as any)?.[0]);

  // 2) Dessas, quantas têm cod_equipamento com tipo 81 ativo?
  const r2 = await withOracle(async (conn) => {
    return conn.execute(
      `SELECT COUNT(*) AS cnt
         FROM agricola.perdas p
        WHERE p.cod_grupoempresa = :codGrupo
          AND p.data_amostra IS NOT NULL
          AND TRUNC(p.data_amostra) BETWEEN TO_DATE(:di, 'YYYY-MM-DD') AND TO_DATE(:df, 'YYYY-MM-DD')
          AND EXISTS (
            SELECT 1
              FROM automotivo.historico_tipoequipamento ht
             WHERE ht.cod_equipamento = p.cod_equipamento
               AND ht.data_fim IS NULL
               AND ht.cod_tipoequipamento = 81
          )`,
      { codGrupo: Number(process.env.COD_GRUPOEMPRESA || 1), di: "2025-09-01", df: "2026-03-22" },
    );
  });
  console.log("2) Perdas com equip tipo 81 ativo:", (r2.rows as any)?.[0]);

  // 3) Quantas têm cod_equipamento NULL?
  const r3 = await withOracle(async (conn) => {
    return conn.execute(
      `SELECT COUNT(*) AS cnt
         FROM agricola.perdas p
        WHERE p.cod_grupoempresa = :codGrupo
          AND p.data_amostra IS NOT NULL
          AND TRUNC(p.data_amostra) BETWEEN TO_DATE(:di, 'YYYY-MM-DD') AND TO_DATE(:df, 'YYYY-MM-DD')
          AND p.cod_equipamento IS NULL`,
      { codGrupo: Number(process.env.COD_GRUPOEMPRESA || 1), di: "2025-09-01", df: "2026-03-22" },
    );
  });
  console.log("3) Perdas com equip NULL:", (r3.rows as any)?.[0]);

  // 4) Equipamentos distintos nas perdas e seus tipos
  const r4 = await withOracle(async (conn) => {
    return conn.execute(
      `SELECT p.cod_equipamento, ht.cod_tipoequipamento, ht.data_fim, COUNT(*) AS cnt
         FROM agricola.perdas p
         LEFT JOIN automotivo.historico_tipoequipamento ht
           ON ht.cod_equipamento = p.cod_equipamento AND ht.data_fim IS NULL
        WHERE p.cod_grupoempresa = :codGrupo
          AND p.data_amostra IS NOT NULL
          AND TRUNC(p.data_amostra) BETWEEN TO_DATE(:di, 'YYYY-MM-DD') AND TO_DATE(:df, 'YYYY-MM-DD')
        GROUP BY p.cod_equipamento, ht.cod_tipoequipamento, ht.data_fim
        ORDER BY cnt DESC
        FETCH FIRST 20 ROWS ONLY`,
      { codGrupo: Number(process.env.COD_GRUPOEMPRESA || 1), di: "2025-09-01", df: "2026-03-22" },
    );
  });
  console.log("4) Equipamentos nas perdas (top 20):");
  for (const row of (r4.rows as any[]) ?? []) {
    console.log("  ", row);
  }

  // 5) COD_GRUPOEMPRESA usado
  console.log("5) COD_GRUPOEMPRESA:", Number(process.env.COD_GRUPOEMPRESA || 1));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERRO:", err);
  process.exit(1);
});
