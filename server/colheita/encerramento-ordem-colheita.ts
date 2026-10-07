import { withOracle } from "../oracle.js";
import oracledb from "oracledb";

export interface EncerrarOrdensColheitaInput {
  dataInicio: string;
  dataFim: string;
  dataEncerramento: string;
  usuarioEncerramento: string;
  obsEncerramento?: string | null;
}

export interface EncerrarOrdensColheitaResult {
  filtros: {
    dataInicio: string;
    dataFim: string;
    dataEncerramento: string;
    usuarioEncerramento: string;
    obsEncerramento: string;
  };
  resumo: {
    linhasAlteradas: number;
  };
}

function toIsoDate(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return text;
}

function plusOneDay(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function encerrarOrdensColheitaPorPeriodo(
  input: EncerrarOrdensColheitaInput,
): Promise<EncerrarOrdensColheitaResult> {
  const dataInicio = toIsoDate(input.dataInicio);
  const dataFim = toIsoDate(input.dataFim);
  const dataEncerramento = toIsoDate(input.dataEncerramento);
  const usuarioEncerramento = String(input.usuarioEncerramento ?? "").trim().slice(0, 60);
  const obsEncerramento = String(input.obsEncerramento ?? "Encerrado").trim() || "Encerrado";

  if (!dataInicio || !dataFim || !dataEncerramento) {
    throw new Error("Informe data inicial, data final e data de encerramento no formato YYYY-MM-DD.");
  }
  if (!usuarioEncerramento) {
    throw new Error("Usuário de encerramento inválido.");
  }

  const dataFimExclusiva = plusOneDay(dataFim);

  return withOracle(async (conn) => {
    const result = await conn.execute(
      `DECLARE
         v_rows NUMBER := 0;
       BEGIN
         SAVEPOINT encerramento_lote;
         agricola.pkg_variaveis.vv_encerramentooc := 'S';

         UPDATE agricola.ordem_colheita
            SET data_encerramento    = TO_DATE(:dataEncerramento, 'YYYY-MM-DD'),
                usuario_encerramento = :usuarioEncerramento,
                obs_encerramento     = :obsEncerramento
          WHERE data_encerramento IS NULL
            AND data_ordem >= TO_DATE(:dataInicio, 'YYYY-MM-DD')
            AND data_ordem <  TO_DATE(:dataFimExclusiva, 'YYYY-MM-DD');

         v_rows := SQL%ROWCOUNT;
         agricola.pkg_variaveis.vv_encerramentooc := 'N';
         COMMIT;
         :linhasAlteradas := v_rows;
       EXCEPTION
         WHEN OTHERS THEN
           agricola.pkg_variaveis.vv_encerramentooc := 'N';
           ROLLBACK TO encerramento_lote;
           RAISE;
       END;`,
      {
        dataInicio,
        dataFimExclusiva,
        dataEncerramento,
        usuarioEncerramento,
        obsEncerramento,
        linhasAlteradas: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
    );

    const linhasAlteradas = Number(result.outBinds?.linhasAlteradas ?? 0);
    return {
      filtros: {
        dataInicio,
        dataFim,
        dataEncerramento,
        usuarioEncerramento,
        obsEncerramento,
      },
      resumo: {
        linhasAlteradas: Number.isFinite(linhasAlteradas) ? linhasAlteradas : 0,
      },
    };
  });
}
