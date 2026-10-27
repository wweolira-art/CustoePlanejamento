import { useEffect, useMemo, useState } from "react";
import { api, type ImportedActiveUser, type SeedTransportOptions } from "../api";
import { PrintButton } from "./PrintButton";

type ReportRow = {
  id: number;
  proprietario: string;
  placa: string;
  data: string;
  codOperacao: string;
  codImplemento: string;
  codFazendaOrigem: string;
  origemFazenda: string;
  origemTalhao: string;
  codFazendaDestino: string;
  destinoFazenda: string;
  destinoTalhao: string;
  atividade: string;
  quantidade: string;
  raioMedio: string;
  valor: string;
  descontoCombustivel: string;
  imposto5: string;
};

type ReportHeader = {
  ano: string;
  numero: string;
  data: string;
  codEquipamento: string;
  codFornecedor: string;
  responsavel: string;
  codFuncionarioTerceiro: string;
  codContrato: string;
  itemContrato: string;
  anoOsPlanoAgr: string;
  numeroOsPlanoAgr: string;
  observacoes: string;
};

const STORAGE_KEY = "seedTransportReport:v1";
const SEED_OPERATION = "159";

const seedRows: ReportRow[] = [
  {
    id: 1,
    proprietario: "SE BENEDITO VALE",
    placa: "MUI 2197",
    data: "2026-08-22",
    codOperacao: "572",
    codImplemento: "",
    codFazendaOrigem: "",
    origemFazenda: "NOVA",
    origemTalhao: "",
    codFazendaDestino: "41900",
    destinoFazenda: "GRACAS",
    destinoTalhao: "",
    atividade: "TRANSPORTE DE ADUBO",
    quantidade: "1",
    raioMedio: "31",
    valor: "429,40",
    descontoCombustivel: "",
    imposto5: "",
  },
  {
    id: 2,
    proprietario: "SE BENEDITO VALE",
    placa: "MUI 2197",
    data: "2026-08-27",
    codOperacao: SEED_OPERATION,
    codImplemento: "",
    codFazendaOrigem: "42200",
    origemFazenda: "BOM SUCESSO",
    origemTalhao: "7",
    codFazendaDestino: "42200",
    destinoFazenda: "BOM SUCESSO",
    destinoTalhao: "5",
    atividade: "TRANSPORTE DE SEMENTE",
    quantidade: "2",
    raioMedio: "5",
    valor: "205",
    descontoCombustivel: "",
    imposto5: "",
  },
  {
    id: 3,
    proprietario: "SE BENEDITO VALE",
    placa: "MUI 2197",
    data: "2026-08-28",
    codOperacao: SEED_OPERATION,
    codImplemento: "",
    codFazendaOrigem: "42200",
    origemFazenda: "BOM SUCESSO",
    origemTalhao: "7",
    codFazendaDestino: "42200",
    destinoFazenda: "BOM SUCESSO",
    destinoTalhao: "5",
    atividade: "TRANSPORTE DE SEMENTE",
    quantidade: "1",
    raioMedio: "5",
    valor: "205",
    descontoCombustivel: "",
    imposto5: "",
  },
  {
    id: 4,
    proprietario: "JOSE EUDES",
    placa: "",
    data: "2026-08-11",
    codOperacao: SEED_OPERATION,
    codImplemento: "",
    codFazendaOrigem: "41700",
    origemFazenda: "GRACAS",
    origemTalhao: "20",
    codFazendaDestino: "",
    destinoFazenda: "GRAVATA",
    destinoTalhao: "9",
    atividade: "TRANSPORTE DE SEMENTE",
    quantidade: "1",
    raioMedio: "41",
    valor: "504,53",
    descontoCombustivel: "",
    imposto5: "",
  },
  {
    id: 5,
    proprietario: "JOSE EUDES",
    placa: "",
    data: "2026-08-12",
    codOperacao: SEED_OPERATION,
    codImplemento: "",
    codFazendaOrigem: "41700",
    origemFazenda: "GRACAS",
    origemTalhao: "20",
    codFazendaDestino: "",
    destinoFazenda: "GRAVATA",
    destinoTalhao: "11",
    atividade: "TRANSPORTE DE SEMENTE",
    quantidade: "1",
    raioMedio: "41",
    valor: "504,53",
    descontoCombustivel: "",
    imposto5: "",
  },
  {
    id: 6,
    proprietario: "JOSE EUDES",
    placa: "",
    data: "2026-08-13",
    codOperacao: SEED_OPERATION,
    codImplemento: "",
    codFazendaOrigem: "41700",
    origemFazenda: "GRACAS",
    origemTalhao: "20",
    codFazendaDestino: "",
    destinoFazenda: "GRAVATA",
    destinoTalhao: "11",
    atividade: "TRANSPORTE DE SEMENTE",
    quantidade: "1",
    raioMedio: "41",
    valor: "504,53",
    descontoCombustivel: "",
    imposto5: "",
  },
  {
    id: 7,
    proprietario: "JOSE EUDES",
    placa: "",
    data: "2026-08-12",
    codOperacao: SEED_OPERATION,
    codImplemento: "",
    codFazendaOrigem: "41700",
    origemFazenda: "GRACAS",
    origemTalhao: "20",
    codFazendaDestino: "",
    destinoFazenda: "GRAVATA",
    destinoTalhao: "1",
    atividade: "TRANSPORTE DE SEMENTE",
    quantidade: "1",
    raioMedio: "41",
    valor: "504,53",
    descontoCombustivel: "",
    imposto5: "",
  },
];

const defaultHeader: ReportHeader = {
  ano: String(new Date().getFullYear()),
  numero: "",
  data: new Date().toISOString().slice(0, 10),
  codEquipamento: "881",
  codFornecedor: "",
  responsavel: "",
  codFuncionarioTerceiro: "",
  codContrato: "",
  itemContrato: "",
  anoOsPlanoAgr: "",
  numeroOsPlanoAgr: "",
  observacoes: "",
};

function storedOperation(row: Pick<ReportRow, "atividade" | "codOperacao">) {
  if (row.atividade.toUpperCase().includes("SEMENTE")) return SEED_OPERATION;
  return row.codOperacao || SEED_OPERATION;
}

function withSeedOperation(row: ReportRow): ReportRow {
  return { ...row, codOperacao: storedOperation(row) };
}

function loadRows() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedRows;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.rows) ? parsed.rows.map(withSeedOperation) : seedRows;
  } catch {
    return seedRows;
  }
}

function loadHeader() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultHeader;
    const parsed = JSON.parse(raw);
    return parsed?.header ? { ...defaultHeader, ...parsed.header } : defaultHeader;
  } catch {
    return defaultHeader;
  }
}

function parseMoney(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function reportTitle(rows: ReportRow[]) {
  const dates = rows.map((row) => row.data).filter(Boolean).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  const range = first && last ? `${formatDate(first)} A ${formatDate(last)}` : "PERIODO";
  return `TRANSPORTE DE CANA SEMENTE - ${range}`;
}

function rowTotal(row: ReportRow) {
  return parseMoney(row.quantidade) * parseMoney(row.valor);
}

function rowNet(row: ReportRow) {
  return rowTotal(row) - parseMoney(row.descontoCombustivel) - parseMoney(row.imposto5);
}

function emptyRow(id: number, base?: ReportRow, proprietor = base?.proprietario ?? ""): ReportRow {
  return {
    id,
    proprietario: proprietor,
    placa: base?.placa ?? "",
    data: base?.data ?? "",
    codOperacao: base?.codOperacao || SEED_OPERATION,
    codImplemento: base?.codImplemento ?? "",
    codFazendaOrigem: base?.codFazendaOrigem ?? "",
    origemFazenda: base?.origemFazenda ?? "",
    origemTalhao: base?.origemTalhao ?? "",
    codFazendaDestino: base?.codFazendaDestino ?? "",
    destinoFazenda: base?.destinoFazenda ?? "",
    destinoTalhao: "",
    atividade: base?.atividade ?? "TRANSPORTE DE SEMENTE",
    quantidade: "1",
    raioMedio: base?.raioMedio ?? "",
    valor: base?.valor ?? "",
    descontoCombustivel: "",
    imposto5: "",
  };
}

function summarize(rows: ReportRow[]) {
  return {
    quantidade: rows.reduce((sum, row) => sum + parseMoney(row.quantidade), 0),
    total: rows.reduce((sum, row) => sum + rowTotal(row), 0),
    desconto: rows.reduce((sum, row) => sum + parseMoney(row.descontoCombustivel), 0),
    imposto: rows.reduce((sum, row) => sum + parseMoney(row.imposto5), 0),
    liquido: rows.reduce((sum, row) => sum + rowNet(row), 0),
  };
}

function groupRowsByOwner(rows: ReportRow[]) {
  const grouped = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const key = row.proprietario.trim() || "SEM PROPRIETARIO";
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return Array.from(grouped, ([proprietario, ownerRows]) => ({
    proprietario,
    rows: ownerRows,
    subtotal: summarize(ownerRows),
  }));
}

export function SeedTransportReport() {
  const [rows, setRows] = useState<ReportRow[]>(loadRows);
  const [header, setHeader] = useState<ReportHeader>(loadHeader);
  const [funcionarioTexto, setFuncionarioTexto] = useState(() => loadHeader().codFuncionarioTerceiro);
  const [draft, setDraft] = useState<ReportRow>(() => emptyRow(0, rows[rows.length - 1]));
  const [options, setOptions] = useState<SeedTransportOptions>({ operacoes: [], fazendas: [] });
  const [usuariosAtivos, setUsuariosAtivos] = useState<ImportedActiveUser[]>([]);
  const [savingOracle, setSavingOracle] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const totals = useMemo(() => summarize(rows), [rows]);
  const ownerGroups = useMemo(() => groupRowsByOwner(rows), [rows]);
  const proprietarios = useMemo(
    () => Array.from(new Set(rows.map((row) => row.proprietario.trim()).filter(Boolean))),
    [rows],
  );

  const persist = (nextRows: ReportRow[], nextHeader = header) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rows: nextRows, header: nextHeader }));
  };

  const setAndSave = (next: ReportRow[]) => {
    setRows(next);
    persist(next);
  };

  const updateHeader = (field: keyof ReportHeader, value: string) => {
    const next = { ...header, [field]: value };
    setHeader(next);
    persist(rows, next);
  };

  const updateDraft = (field: keyof ReportRow, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const addDraft = () => {
    const id = Math.max(0, ...rows.map((row) => row.id)) + 1;
    const nextRow = {
      ...draft,
      id,
      data: header.data || draft.data,
      codImplemento: draft.codImplemento || header.codEquipamento,
      proprietario: draft.proprietario.trim() || "SEM PROPRIETARIO",
      codOperacao: storedOperation(draft),
    };
    setAndSave([...rows, nextRow]);
    setDraft(emptyRow(0, nextRow));
  };

  const newOwnerDraft = () => {
    setDraft(emptyRow(0, undefined, ""));
  };

  useEffect(() => {
    api.seedTransportOptions().then(setOptions).catch((e: Error) => setStatus(e.message));
    api.seedTransportActiveUsers().then((users) => {
      setUsuariosAtivos(users);
      const existing = users.find((user) => String(user.id) === header.codFuncionarioTerceiro);
      if (existing && /^\d+$/.test(funcionarioTexto)) {
        setFuncionarioTexto(`${existing.id} - ${existing.nome}`);
      }
    }).catch(() => undefined);
  }, []);

  const updateFuncionario = (value: string) => {
    setFuncionarioTexto(value);
    const selected = value.match(/^(\d+)\s+-\s+/);
    if (selected) {
      const user = usuariosAtivos.find((item) => item.id === Number(selected[1]));
      if (user) {
        updateHeader("codFuncionarioTerceiro", String(user.id));
        return;
      }
    }
    updateHeader("codFuncionarioTerceiro", /^\d+$/.test(value.trim()) ? value.trim() : "");
  };

  const fazendaByCode = (code: string) => options.fazendas.find((row) => String(row.codigo ?? "") === code);

  const saveOracle = async () => {
    setSavingOracle(true);
    setStatus(null);
    try {
      const saved = await api.seedTransportSaveOracle({
        ...header,
        itens: rows.map((row) => ({
          proprietario: row.proprietario,
          placa: row.placa,
          data: row.data,
          codOperacao: storedOperation(row),
          codImplemento: row.codImplemento || header.codEquipamento,
          codFazendaOrigem: row.codFazendaOrigem,
          codTalhaoOrigem: row.origemTalhao,
          codFazendaDestino: row.codFazendaDestino,
          codTalhaoDestino: row.destinoTalhao,
          quantidade: row.quantidade,
          raioMedio: row.raioMedio,
          valor: row.valor,
          descontoCombustivel: row.descontoCombustivel,
          imposto5: row.imposto5,
        })),
      });
      setStatus(`Apontamento gravado: ${saved.ano}/${saved.numero ?? ""} com ${saved.itens} item(ns).`);
      if (saved.numero != null) updateHeader("numero", String(saved.numero));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Não foi possível gravar no Oracle.");
    } finally {
      setSavingOracle(false);
    }
  };

  return (
    <div className="page seed-transport-page">
      <div className="seed-transport-toolbar no-print">
        <p className="lead">
          Preencha as linhas do transporte de semente. A prévia abaixo sai no modelo do relatório do print.
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={newOwnerDraft}>
            Novo proprietário
          </button>
          <button type="button" className="btn" onClick={() => setAndSave(seedRows)}>
            Recarregar exemplo
          </button>
          <PrintButton label="Imprimir relatório" />
        </div>
      </div>
      {status ? <p className="lead no-print seed-transport-status">{status}</p> : null}

      <section className="panel no-print">
        <h3>Lançar transporte</h3>
        <datalist id="seed-report-owners">
          {proprietarios.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <datalist id="seed-report-operations">
          {options.operacoes.map((op) => (
            <option key={`${op.codigo}-${op.descricao}`} value={String(op.codigo ?? "")}>
              {op.descricao}
            </option>
          ))}
        </datalist>
        <datalist id="seed-report-farms">
          {options.fazendas.map((fazenda) => (
            <option key={`${fazenda.codigo}-${fazenda.descricao}`} value={String(fazenda.codigo ?? "")}>
              {fazenda.descricao}
            </option>
          ))}
        </datalist>
        <datalist id="seed-report-employees">
          {usuariosAtivos.map((user) => (
            <option key={user.id} value={`${user.id} - ${user.nome}`} label={user.email} />
          ))}
        </datalist>
        <form
          className="form-grid seed-transport-entry-form"
          onSubmit={(event) => {
            event.preventDefault();
            addDraft();
          }}
        >
          <h4 className="span-2 seed-transport-form-section">Dados do apontamento</h4>
          <label>
            Ano
            <input value={header.ano} onChange={(e) => updateHeader("ano", e.target.value)} />
          </label>
          <label>
            Número
            <input value={header.numero} onChange={(e) => updateHeader("numero", e.target.value)} placeholder="Automático se vazio" />
          </label>
          <label>
            Data do apontamento
            <input type="date" value={header.data} onChange={(e) => updateHeader("data", e.target.value)} />
          </label>
          <label>
            Equipamento
            <input value={header.codEquipamento} onChange={(e) => updateHeader("codEquipamento", e.target.value)} placeholder="Ex.: 881" />
          </label>
          <label>
            Fornecedor
            <input value={header.codFornecedor} onChange={(e) => updateHeader("codFornecedor", e.target.value)} placeholder="Ex.: 2899" />
          </label>
          <label>
            Responsável
            <input value={header.responsavel} onChange={(e) => updateHeader("responsavel", e.target.value)} />
          </label>
          <label>
            Código do funcionário
            <input
              list="seed-report-employees"
              value={funcionarioTexto}
              onChange={(e) => updateFuncionario(e.target.value)}
              placeholder={usuariosAtivos.length ? "Pesquise por código ou nome" : "Código do funcionário"}
            />
          </label>
          <label>
            Contrato
            <input value={header.codContrato} onChange={(e) => updateHeader("codContrato", e.target.value)} placeholder="Ex.: 2723" />
          </label>
          <label>
            Item contrato
            <input value={header.itemContrato} onChange={(e) => updateHeader("itemContrato", e.target.value)} placeholder="Ex.: 47" />
          </label>
          <label>
            Ano O.S. Plano Agr.
            <input value={header.anoOsPlanoAgr} onChange={(e) => updateHeader("anoOsPlanoAgr", e.target.value)} />
          </label>
          <label>
            Número O.S. Plano Agr.
            <input value={header.numeroOsPlanoAgr} onChange={(e) => updateHeader("numeroOsPlanoAgr", e.target.value)} />
          </label>
          <label className="span-2">
            Observações
            <input value={header.observacoes} onChange={(e) => updateHeader("observacoes", e.target.value)} />
          </label>

          <h4 className="span-2 seed-transport-form-section">Item do transporte</h4>
          <label>
            Proprietário
            <input
              list="seed-report-owners"
              value={draft.proprietario}
              onChange={(e) => updateDraft("proprietario", e.target.value)}
              placeholder="Ex.: JOSE EUDES"
              required
            />
          </label>
          <label>
            Placa
            <input value={draft.placa} onChange={(e) => updateDraft("placa", e.target.value)} placeholder="Ex.: MUI 2197" />
          </label>
          <label>
            Tarefa / operação
            <input
              list="seed-report-operations"
              value={draft.codOperacao}
              onChange={(e) => updateDraft("codOperacao", e.target.value)}
              placeholder={`Ex.: ${SEED_OPERATION}`}
            />
          </label>
          <label>
            Fazenda origem
            <input
              list="seed-report-farms"
              value={draft.codFazendaOrigem}
              onChange={(e) => {
                const value = e.target.value;
                updateDraft("codFazendaOrigem", value);
                const found = fazendaByCode(value);
                if (found) updateDraft("origemFazenda", found.descricao);
              }}
              placeholder="Código"
            />
          </label>
          <label>
            Talhão origem
            <input value={draft.origemTalhao} onChange={(e) => updateDraft("origemTalhao", e.target.value)} />
          </label>
          <label>
            Fazenda destino
            <input
              list="seed-report-farms"
              value={draft.codFazendaDestino}
              onChange={(e) => {
                const value = e.target.value;
                updateDraft("codFazendaDestino", value);
                const found = fazendaByCode(value);
                if (found) updateDraft("destinoFazenda", found.descricao);
              }}
              placeholder="Código"
            />
          </label>
          <label>
            Talhão destino
            <input value={draft.destinoTalhao} onChange={(e) => updateDraft("destinoTalhao", e.target.value)} />
          </label>
          <label className="span-2">
            Atividade
            <input value={draft.atividade} onChange={(e) => updateDraft("atividade", e.target.value)} required />
          </label>
          <label>
            Quantidade
            <input value={draft.quantidade} onChange={(e) => updateDraft("quantidade", e.target.value)} placeholder="Ex.: 1" required />
          </label>
          <label>
            Raio médio
            <input value={draft.raioMedio} onChange={(e) => updateDraft("raioMedio", e.target.value)} placeholder="Ex.: 41" />
          </label>
          <label>
            Valor
            <input value={draft.valor} onChange={(e) => updateDraft("valor", e.target.value)} placeholder="Ex.: 504,53" required />
          </label>
          <label>
            Desconto combustível
            <input value={draft.descontoCombustivel} onChange={(e) => updateDraft("descontoCombustivel", e.target.value)} placeholder="Opcional" />
          </label>
          <label>
            Imposto 5
            <input value={draft.imposto5} onChange={(e) => updateDraft("imposto5", e.target.value)} placeholder="Opcional" />
          </label>
          <div className="modal-actions span-2 seed-transport-form-actions">
            <button type="submit" className="btn primary">
              Adicionar ao relatório
            </button>
            <button type="button" className="btn primary" disabled={savingOracle || !rows.length} onClick={() => void saveOracle()}>
              {savingOracle ? "Gravando..." : "Gravar no banco"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel no-print">
        <h3>
          Lançamentos adicionados
          <small>{rows.length}</small>
        </h3>
        <div className="seed-transport-form-wrap">
          <table className="data seed-transport-form">
            <thead>
              <tr>
                <th>Proprietário</th>
                <th>Placa</th>
                <th>Data</th>
                <th>Faz. origem</th>
                <th>Talhão</th>
                <th>Faz. destino</th>
                <th>Talhão</th>
                <th>Operação</th>
                <th>Atividade</th>
                <th>Qtd.</th>
                <th>Raio</th>
                <th>Valor</th>
                <th>Total</th>
                <th>Desc.</th>
                <th>Imp.</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="left">{row.proprietario}</td>
                  <td>{row.placa}</td>
                  <td>{formatDate(row.data)}</td>
                  <td className="left">{row.origemFazenda}</td>
                  <td>{row.origemTalhao}</td>
                  <td className="left">{row.destinoFazenda}</td>
                  <td>{row.destinoTalhao}</td>
                  <td>{row.codOperacao || SEED_OPERATION}</td>
                  <td className="left">{row.atividade}</td>
                  <td>{row.quantidade}</td>
                  <td>{row.raioMedio}</td>
                  <td>{formatMoney(parseMoney(row.valor))}</td>
                  <td>{formatMoney(rowTotal(row))}</td>
                  <td>{row.descontoCombustivel ? formatMoney(parseMoney(row.descontoCombustivel)) : ""}</td>
                  <td>{row.imposto5 ? formatMoney(parseMoney(row.imposto5)) : ""}</td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Excluir linha"
                      onClick={() => setAndSave(rows.filter((item) => item.id !== row.id))}
                    >
                      x
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="seed-transport-report" aria-label="Relatório para impressão">
        <header className="seed-report-head">
          <img src="/elejota-agro-logo.png" alt="Elejota Agro" />
          <h2>{reportTitle(rows)}</h2>
          <img src="/elejota-agro-logo.png" alt="" />
        </header>
        <table className="seed-report-table">
          <thead>
            <tr>
              <th>PROPRIETÁRIO</th>
              <th>PLACA</th>
              <th>DATA</th>
              <th>FAZ: ORIGEM</th>
              <th>TALHÃO</th>
              <th>FAZ:DESTINO</th>
              <th>TALHÃO</th>
              <th>ATIVIDADE</th>
              <th>QUANTIDADE</th>
              <th>RAIO MÉDIO</th>
              <th>VALOR</th>
              <th>TOTAL</th>
              <th>DESCONTO COMBUSTÍVEL</th>
              <th>IMPOSTO 5</th>
              <th>LÍQUIDO A RECEBER</th>
            </tr>
          </thead>
          <tbody>
            {ownerGroups.map((group) => (
              <OwnerRows key={group.proprietario} group={group} />
            ))}
          </tbody>
        </table>
        <div className="seed-report-summary">
          <table>
            <tbody>
              <tr>
                <th>TOTAL GERAL</th>
                <td>{formatMoney(totals.total)}</td>
              </tr>
              <tr>
                <th>DESCONTOS</th>
                <td>{formatMoney(totals.desconto + totals.imposto)}</td>
              </tr>
              <tr>
                <th>LÍQUIDO A RECEBER</th>
                <td>{formatMoney(totals.liquido)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function OwnerRows({
  group,
}: {
  group: ReturnType<typeof groupRowsByOwner>[number];
}) {
  return (
    <>
      {group.rows.map((row) => (
        <tr key={row.id}>
          <td>{row.proprietario}</td>
          <td>{row.placa}</td>
          <td>{formatDate(row.data)}</td>
          <td>{row.origemFazenda}</td>
          <td>{row.origemTalhao}</td>
          <td>{row.destinoFazenda}</td>
          <td>{row.destinoTalhao}</td>
          <td>{row.atividade}</td>
          <td>{row.quantidade}</td>
          <td>{row.raioMedio}</td>
          <td>{formatMoney(parseMoney(row.valor))}</td>
          <td>{formatMoney(rowTotal(row))}</td>
          <td>{row.descontoCombustivel ? formatMoney(parseMoney(row.descontoCombustivel)) : ""}</td>
          <td>{row.imposto5 ? formatMoney(parseMoney(row.imposto5)) : ""}</td>
          <td>{formatMoney(rowNet(row))}</td>
        </tr>
      ))}
      <tr className="seed-report-total-row">
        <td colSpan={6}>TOTAL</td>
        <td />
        <td />
        <td>{formatMoney(group.subtotal.quantidade).replace(",00", "")}</td>
        <td />
        <td />
        <td>{formatMoney(group.subtotal.total)}</td>
        <td>{group.subtotal.desconto ? formatMoney(group.subtotal.desconto) : ""}</td>
        <td>{group.subtotal.imposto ? formatMoney(group.subtotal.imposto) : ""}</td>
        <td>{formatMoney(group.subtotal.liquido)}</td>
      </tr>
    </>
  );
}
