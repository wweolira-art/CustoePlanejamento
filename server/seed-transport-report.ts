import type { Express, Request } from "express";
import oracledb from "oracledb";
import { oracleNumber, oracleText, oracleValue, withOracle, withOracleWrite } from "./oracle.js";
import { readBearerToken, verifySessionToken } from "./auth.js";
import { listImportedActiveUsers } from "./user-directory.js";

type SeedTransportItemInput = {
  proprietario?: string;
  placa?: string;
  data?: string;
  codOperacao?: number | string | null;
  codImplemento?: number | string | null;
  codFazendaOrigem?: number | string | null;
  codTalhaoOrigem?: number | string | null;
  codFazendaDestino?: number | string | null;
  codTalhaoDestino?: number | string | null;
  quantidade?: number | string | null;
  raioMedio?: number | string | null;
  valor?: number | string | null;
  descontoCombustivel?: number | string | null;
  imposto5?: number | string | null;
};

type SeedTransportSaveInput = {
  ano?: number | string | null;
  numero?: number | string | null;
  data?: string | null;
  codEquipamento?: number | string | null;
  codFornecedor?: number | string | null;
  responsavel?: number | string | null;
  codFuncionarioTerceiro?: number | string | null;
  codContrato?: number | string | null;
  itemContrato?: number | string | null;
  anoOsPlanoAgr?: number | string | null;
  numeroOsPlanoAgr?: number | string | null;
  observacoes?: string | null;
  itens?: SeedTransportItemInput[];
};

type ColumnMap = Map<string, string>;

const SEED_OPERATION = 159;

type CompanyContext = {
  grupo: number;
  empresa: number;
  filial: number;
};

function num(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown) {
  const out = String(value ?? "").trim();
  return out || null;
}

function isoDate(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return raw;
  return `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`;
}

function requireSessionUser(req: Request) {
  const user = verifySessionToken(readBearerToken(req.headers.authorization));
  if (!user) throw new Error("Sessão expirada ou inválida.");
  return user;
}

async function tableColumns(owner: string, tableName: string) {
  return withOracle(async (conn) => {
    const result = await conn.execute(
      `SELECT column_name
         FROM all_tab_columns
        WHERE owner = :owner
          AND table_name = :tableName`,
      { owner: owner.toUpperCase(), tableName: tableName.toUpperCase() },
      { maxRows: 0 },
    );
    const map: ColumnMap = new Map();
    for (const row of (result.rows ?? []) as Record<string, unknown>[]) {
      const col = oracleText(row, "column_name", "COLUMN_NAME").toUpperCase();
      if (col) map.set(col, col);
    }
    return map;
  });
}

function pick(columns: ColumnMap, ...names: string[]) {
  for (const name of names) {
    const found = columns.get(name.toUpperCase());
    if (found) return found;
  }
  return null;
}

function put(
  out: Record<string, unknown>,
  columns: ColumnMap,
  names: string[],
  value: unknown,
  options?: { rawDate?: boolean },
) {
  if (value == null || value === "") return;
  const col = pick(columns, ...names);
  if (!col) return;
  out[col] = options?.rawDate ? value : value;
}

function bindSql(value: unknown, idx: number) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { expr: `TO_DATE(:v${idx}, 'YYYY-MM-DD')`, bind: value };
  }
  return { expr: `:v${idx}`, bind: value };
}

async function insertDynamic(
  conn: oracledb.Connection,
  tableName: string,
  values: Record<string, unknown>,
) {
  const entries = Object.entries(values).filter(([, value]) => value != null && value !== "");
  if (!entries.length) throw new Error(`Nenhuma coluna compatível encontrada para ${tableName}.`);
  const binds: Record<string, unknown> = {};
  const cols: string[] = [];
  const vals: string[] = [];
  entries.forEach(([col, value], idx) => {
    const key = idx + 1;
    const bound = bindSql(value, key);
    cols.push(col);
    vals.push(bound.expr);
    binds[`v${key}`] = bound.bind;
  });
  await conn.execute(`INSERT INTO ${tableName} (${cols.join(", ")}) VALUES (${vals.join(", ")})`, binds);
}

function nextNumberSql(columns: ColumnMap) {
  const numero = pick(columns, "NUMERO", "NUM_APONTAMENTO", "NR_APONTAMENTO", "NUMERO_APONTAMENTO");
  const ano = pick(columns, "ANO", "ANO_APONTAMENTO");
  if (!numero) return null;
  return { numero, ano };
}

async function nextNumero(conn: oracledb.Connection, columns: ColumnMap, ano: number) {
  const parts = nextNumberSql(columns);
  if (!parts) return null;
  const where = parts.ano ? `WHERE ${parts.ano} = :ano` : "";
  const result = await conn.execute(
    `SELECT NVL(MAX(${parts.numero}), 0) + 1 AS proximo FROM automotivo.apontamentoterceiro ${where}`,
    parts.ano ? { ano } : {},
  );
  const row = ((result.rows ?? [])[0] ?? {}) as Record<string, unknown>;
  return oracleNumber(row, "proximo", "PROXIMO");
}

function putCompany(out: Record<string, unknown>, columns: ColumnMap, company: CompanyContext) {
  put(out, columns, ["COD_GRUPOEMPRESA"], company.grupo);
  put(out, columns, ["COD_EMPRESA"], company.empresa);
  put(out, columns, ["COD_FILIAL"], company.filial);
}

async function companyContext(conn: oracledb.Connection): Promise<CompanyContext> {
  const fromEnv = {
    grupo: num(process.env.COD_GRUPOEMPRESA),
    empresa: num(process.env.COD_EMPRESA),
    filial: num(process.env.COD_FILIAL),
  };
  if (fromEnv.grupo != null && fromEnv.empresa != null && fromEnv.filial != null) {
    return { grupo: fromEnv.grupo, empresa: fromEnv.empresa, filial: fromEnv.filial };
  }
  const result = await conn.execute(
    `SELECT cod_grupoempresa, cod_empresa, cod_filial
       FROM (
         SELECT a.cod_grupoempresa, a.cod_empresa, a.cod_filial
           FROM automotivo.itens_apontamentoterceiro i
           JOIN automotivo.apontamentoterceiro a
             ON a.ano_apontamento = i.ano_apontamento
            AND a.numero_apontamento = i.numero_apontamento
            AND a.cod_grupoempresa = i.cod_grupoempresa
            AND a.cod_empresa = i.cod_empresa
            AND a.cod_filial = i.cod_filial
          WHERE i.cod_operacaoagricola = :operacao
          ORDER BY a.data_gravacao DESC NULLS LAST
       )
      WHERE ROWNUM = 1`,
    { operacao: SEED_OPERATION },
  );
  const row = ((result.rows ?? [])[0] ?? {}) as Record<string, unknown>;
  return {
    grupo: oracleNumber(row, "cod_grupoempresa", "COD_GRUPOEMPRESA") ?? 1,
    empresa: oracleNumber(row, "cod_empresa", "COD_EMPRESA") ?? 1,
    filial: oracleNumber(row, "cod_filial", "COD_FILIAL") ?? 1,
  };
}

function headerValues(
  columns: ColumnMap,
  input: SeedTransportSaveInput,
  userName: string,
  numero: number | null,
  ano: number,
  company: CompanyContext,
) {
  const out: Record<string, unknown> = {};
  putCompany(out, columns, company);
  put(out, columns, ["ANO", "ANO_APONTAMENTO"], ano);
  put(out, columns, ["NUMERO", "NUM_APONTAMENTO", "NR_APONTAMENTO", "NUMERO_APONTAMENTO"], numero);
  put(out, columns, ["DATA", "DATA_APONTAMENTO", "DT_APONTAMENTO"], isoDate(input.data));
  put(out, columns, ["COD_EQUIPAMENTO", "COD_EQUIPAMENTO_TERCEIRO"], num(input.codEquipamento));
  put(out, columns, ["COD_FORNECEDOR"], num(input.codFornecedor));
  put(out, columns, ["COD_RESPONSAVEL", "RESPONSAVEL"], num(input.responsavel));
  put(out, columns, ["COD_FUNCIONARIO", "COD_FUNCIONARIOTERCEIRO", "COD_FUNCIONARIO_TERCEIRO"], num(input.codFuncionarioTerceiro));
  put(out, columns, ["NUMEROCONTRATO", "COD_CONTRATO", "CONTRATO"], num(input.codContrato));
  put(out, columns, ["ITEM_CONTRATO", "COD_ITEMCONTRATO", "COD_ITEM_CONTRATO"], num(input.itemContrato));
  put(out, columns, ["ANO_ORDEMSERVICO", "ANO_OS_PLANO_AGR", "ANO_OS"], num(input.anoOsPlanoAgr));
  put(out, columns, ["NR_ORDEMSERVICO", "NUMERO_OS_PLANO_AGR", "NUMERO_OS", "OS_PLANO_AGR"], num(input.numeroOsPlanoAgr));
  put(out, columns, ["OBSERVACOES", "OBSERVACAO"], text(input.observacoes));
  put(out, columns, ["LOGON", "USUARIO", "USUARIO_CADASTRO", "USER_CADASTRO"], userName.slice(0, 30));
  put(out, columns, ["DATA_GRAVACAO", "DATA_CADASTRO", "DT_CADASTRO"], new Date());
  return out;
}

function itemValues(
  columns: ColumnMap,
  input: SeedTransportSaveInput,
  item: SeedTransportItemInput,
  numero: number | null,
  ano: number,
  seq: number,
  company: CompanyContext,
) {
  const out: Record<string, unknown> = {};
  putCompany(out, columns, company);
  put(out, columns, ["ANO", "ANO_APONTAMENTO"], ano);
  put(out, columns, ["NUMERO", "NUM_APONTAMENTO", "NR_APONTAMENTO", "NUMERO_APONTAMENTO"], numero);
  put(out, columns, ["ITEM", "SEQ", "SEQUENCIA", "NUM_ITEM"], seq);
  put(out, columns, ["DATA", "DATA_APONTAMENTO", "DT_APONTAMENTO"], isoDate(item.data ?? input.data));
  put(out, columns, ["COD_OPERACAOAGRICOLA", "COD_OPERACAO", "COD_SERVICO", "TAREFA"], num(item.codOperacao) ?? SEED_OPERATION);
  put(out, columns, ["COD_IMPLEMENTO"], num(item.codImplemento));
  put(out, columns, ["COD_EQUIPAMENTO"], num(input.codEquipamento));
  put(out, columns, ["COD_FAZENDA", "COD_FAZENDA_ORIGEM"], num(item.codFazendaOrigem));
  put(out, columns, ["COD_TALHAO", "COD_TALHAO_ORIGEM"], num(item.codTalhaoOrigem));
  put(out, columns, ["COD_FAZENDA_DESTINO"], num(item.codFazendaDestino));
  put(out, columns, ["COD_TALHAO_DESTINO"], num(item.codTalhaoDestino));
  put(out, columns, ["QUANTIDADE", "QTD", "QTDE"], num(item.quantidade));
  put(out, columns, ["DISTANCIA", "RAIO_MEDIO", "RAIO"], num(item.raioMedio));
  put(out, columns, ["VALOR_UNITARIO", "VALOR", "VLR_UNITARIO"], num(item.valor));
  put(out, columns, ["DESCONTO_COMBUSTIVEL", "VLR_DESCONTO_COMBUSTIVEL"], num(item.descontoCombustivel));
  put(out, columns, ["IMPOSTO5", "IMPOSTO_5", "VLR_IMPOSTO5"], num(item.imposto5));
  return out;
}

export function registerSeedTransportReportRoutes(app: Express) {
  app.get("/api/seed-transport-report/active-users", (req, res) => {
    try {
      requireSessionUser(req);
      res.json(listImportedActiveUsers());
    } catch (e) {
      res.status(401).json({ error: e instanceof Error ? e.message : "Sessão inválida." });
    }
  });

  app.get("/api/seed-transport-report/options", async (_req, res) => {
    try {
      const data = await withOracle(async (conn) => {
        const [operacoes, fazendas] = await Promise.all([
          conn.execute(
            `SELECT cod_operacaoagricola AS codigo, descricao
               FROM rh.operacaoagricola
              WHERE cod_operacaoagricola IS NOT NULL
              ORDER BY cod_operacaoagricola`,
            {},
            { maxRows: 500 },
          ),
          conn.execute(
            `SELECT cod_fazenda AS codigo, descricao
               FROM agricola.fazenda
              WHERE cod_fazenda IS NOT NULL
              ORDER BY descricao, cod_fazenda`,
            {},
            { maxRows: 1000 },
          ),
        ]);
        return {
          operacoes: ((operacoes.rows ?? []) as Record<string, unknown>[]).map((row) => ({
            codigo: oracleNumber(row, "codigo", "CODIGO"),
            descricao: oracleText(row, "descricao", "DESCRICAO"),
          })),
          fazendas: ((fazendas.rows ?? []) as Record<string, unknown>[]).map((row) => ({
            codigo: oracleNumber(row, "codigo", "CODIGO"),
            descricao: oracleText(row, "descricao", "DESCRICAO"),
          })),
        };
      });
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível carregar opções Oracle." });
    }
  });

  app.get("/api/seed-transport-report/talhoes", async (req, res) => {
    try {
      const codFazenda = num(req.query.codFazenda);
      if (codFazenda == null) return res.json({ talhoes: [] });
      const data = await withOracle(async (conn) => {
        const result = await conn.execute(
          `SELECT cod_talhao AS codigo
             FROM agricola.talhao
            WHERE cod_fazenda = :codFazenda
            ORDER BY cod_talhao`,
          { codFazenda },
          { maxRows: 1000 },
        );
        return {
          talhoes: ((result.rows ?? []) as Record<string, unknown>[]).map((row) => ({
            codigo: oracleNumber(row, "codigo", "CODIGO"),
          })),
        };
      });
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível carregar talhões." });
    }
  });

  app.post("/api/seed-transport-report/save-oracle", async (req, res) => {
    try {
      const user = requireSessionUser(req);
      const input = req.body as SeedTransportSaveInput;
      const itens = Array.isArray(input.itens) ? input.itens : [];
      if (!itens.length) throw new Error("Adicione ao menos um item para gravar.");
      const ano = num(input.ano) ?? new Date().getFullYear();

      const result = await withOracleWrite(async (conn) => {
        const [headerCols, itemCols] = await Promise.all([
          tableColumns("AUTOMOTIVO", "APONTAMENTOTERCEIRO"),
          tableColumns("AUTOMOTIVO", "ITENS_APONTAMENTOTERCEIRO"),
        ]);
        const numero = num(input.numero) ?? (await nextNumero(conn, headerCols, ano));
        const company = await companyContext(conn);
        await insertDynamic(
          conn,
          "automotivo.apontamentoterceiro",
          headerValues(headerCols, input, user.nome || user.email, numero, ano, company),
        );
        for (let i = 0; i < itens.length; i += 1) {
          await insertDynamic(
            conn,
            "automotivo.itens_apontamentoterceiro",
            itemValues(itemCols, input, itens[i]!, numero, ano, i + 1, company),
          );
        }
        await conn.commit();
        return { ano, numero, itens: itens.length };
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Não foi possível gravar no Oracle." });
    }
  });
}
