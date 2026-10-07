import { oracleNumber, oracleText, withOracle } from "../oracle.js";
import { diaUtcFromIso, parsePeriodoOpcional, scanOrdsCollection, toNumber } from "./ords-common.js";
import { matchPeriodoDia } from "./periodo-colheita.js";

function baseUrl() {
  const fromEnv = process.env.ORDS_HORAS_MAQUINA_URL?.trim() || process.env.HORAS_MAQUINA_ORDS_URL?.trim();
  if (!fromEnv) throw new Error("Configure ORDS_HORAS_MAQUINA_URL no .env.");
  return fromEnv.replace(/\/?$/, "/");
}

function codGrupoEmpresa() {
  return Number(process.env.COD_GRUPOEMPRESA || 1);
}

export interface HorasMaquinaRow {
  id: number | null;
  codEquipamento: number | null;
  data: string | null;
  horaMotor: number | null;
  horasElevador: number | null;
  turno: string | null;
  codTipoEquipamento?: number | null;
  tipoDescricao?: string | null;
}

function mapItem(item: Record<string, unknown>): HorasMaquinaRow | null {
  if (!item || typeof item !== "object") return null;
  return {
    id: toNumber(item.id),
    codEquipamento: toNumber(item.cod_equipamento),
    data: item.data != null ? String(item.data) : null,
    horaMotor: toNumber(item.hora_motor),
    horasElevador: toNumber(item.horas_elevador),
    turno: item.turno != null ? String(item.turno).trim() : null,
  };
}

function matchBusca(row: HorasMaquinaRow, busca: string | null) {
  if (!busca) return true;
  const q = busca.toLowerCase();
  const blob = [row.id, row.codEquipamento, row.turno, row.horaMotor, row.horasElevador]
    .filter((v) => v != null && v !== "")
    .join(" ")
    .toLowerCase();
  return blob.includes(q);
}

function matchPeriodo(row: HorasMaquinaRow, dataInicio: string | null, dataFim: string | null) {
  return matchPeriodoDia(diaUtcFromIso(row.data), dataInicio, dataFim);
}

async function loadTiposPorEquipamento(codigos: number[]) {
  const map = new Map<number, { codTipoEquipamento: number | null; tipoDescricao: string | null }>();
  const unique = [...new Set(codigos)].filter((n) => Number.isFinite(n));
  if (!unique.length) return map;

  const CHUNK = 400;
  await withOracle(async (conn) => {
    for (let offset = 0; offset < unique.length; offset += CHUNK) {
      const slice = unique.slice(offset, offset + CHUNK);
      const binds: Record<string, number> = { codGrupo: codGrupoEmpresa() };
      const placeholders: string[] = [];
      slice.forEach((cod, i) => {
        const key = `c${i}`;
        binds[key] = cod;
        placeholders.push(`:${key}`);
      });

      const result = await conn.execute(
        `SELECT e.cod_equipamento,
                ht.cod_tipoequipamento,
                te.descricaotipoequipamento
           FROM automotivo.equipamento e
           LEFT JOIN automotivo.historico_tipoequipamento ht
             ON ht.cod_equipamento = e.cod_equipamento
            AND ht.data_fim IS NULL
           LEFT JOIN automotivo.tipoequipamento te
             ON te.cod_tipoequipamento = ht.cod_tipoequipamento
          WHERE e.cod_grupoempresa = :codGrupo
            AND e.cod_equipamento IN (${placeholders.join(", ")})`,
        binds,
      );

      for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
        const cod = oracleNumber(row, "cod_equipamento", "COD_EQUIPAMENTO");
        if (cod == null || map.has(cod)) continue;
        map.set(cod, {
          codTipoEquipamento: oracleNumber(row, "cod_tipoequipamento", "COD_TIPOEQUIPAMENTO"),
          tipoDescricao: oracleText(row, "descricaotipoequipamento", "DESCRICAOTIPEQUIPAMENTO"),
        });
      }
    }
  });

  return map;
}

export async function listarHorasMaquina(filtros: {
  busca?: string | null;
  dataInicio?: string | null;
  dataFim?: string | null;
  equipamento?: string | null;
  codTipoEquipamento?: number | null;
  limit?: number | null;
} = {}) {
  const busca = filtros.busca?.trim() || null;
  const { dataInicio, dataFim } = parsePeriodoOpcional(filtros);
  const equipamento = filtros.equipamento?.trim() || null;
  const codTipoFiltro =
    filtros.codTipoEquipamento != null && Number.isFinite(Number(filtros.codTipoEquipamento))
      ? Number(filtros.codTipoEquipamento)
      : null;
  const userLimit = toNumber(filtros.limit);
  const maxRows = userLimit != null && userLimit > 0 ? userLimit : Number.MAX_SAFE_INTEGER;

  const collected = await scanOrdsCollection(baseUrl(), {
    maxRows,
    match: (item) => {
      const row = mapItem(item);
      if (!row) return false;
      if (equipamento && String(row.codEquipamento) !== String(equipamento)) return false;
      if (!matchPeriodo(row, dataInicio, dataFim)) return false;
      if (!matchBusca(row, busca)) return false;
      return true;
    },
    map: (item) => mapItem(item) as Record<string, unknown>,
  });

  let dados = collected.dados as unknown as HorasMaquinaRow[];

  const codigos = dados
    .map((r) => r.codEquipamento)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const tipoMap = await loadTiposPorEquipamento(codigos);

  dados = dados.map((row) => {
    const tipo = row.codEquipamento != null ? tipoMap.get(row.codEquipamento) : undefined;
    return {
      ...row,
      codTipoEquipamento: tipo?.codTipoEquipamento ?? null,
      tipoDescricao: tipo?.tipoDescricao ?? null,
    };
  });

  const tiposMap = new Map<number, string>();
  for (const row of dados) {
    if (row.codTipoEquipamento == null) continue;
    if (!tiposMap.has(row.codTipoEquipamento)) {
      tiposMap.set(
        row.codTipoEquipamento,
        row.tipoDescricao?.trim() || `Tipo ${row.codTipoEquipamento}`,
      );
    }
  }
  const tipos = [...tiposMap.entries()]
    .map(([codTipoEquipamento, label]) => ({ codTipoEquipamento, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  if (codTipoFiltro != null) {
    dados = dados.filter((row) => row.codTipoEquipamento === codTipoFiltro);
  }

  dados = dados.sort((a, b) => {
    const da = String(a.data || "");
    const db = String(b.data || "");
    if (da !== db) return db.localeCompare(da);
    return (a.codEquipamento || 0) - (b.codEquipamento || 0);
  });

  const equipamentos = new Set(dados.map((r) => r.codEquipamento).filter((v) => v != null));

  return {
    filtros: {
      busca,
      dataInicio,
      dataFim,
      equipamento,
      codTipoEquipamento: codTipoFiltro,
      tipos,
      limit: collected.maxRows,
    },
    resumo: {
      totalLinhas: dados.length,
      paginasOrds: collected.pages,
      qtdEquipamentos: equipamentos.size,
      truncado: collected.hasMore,
    },
    dados,
  };
}
