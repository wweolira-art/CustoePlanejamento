import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FuelNfNumber } from "./FuelNfNumber";
import { FuelSupplierName } from "./FuelSupplierName";
import {
  api,
  type ContractControlOption,
  type ContractControlReport,
  type ContractControlRow,
  type ContractOccurrenceReport,
  type ContractFuelReport,
  type ContractFuelRow,
  type ContractSupplierGroup,
} from "../api";

const money = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fornecedorLabel(codigo: number | null | undefined, descricao: string) {
  if (codigo == null) return descricao;
  return `${codigo} — ${descricao}`;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatMoney(value: number) {
  return money.format(value);
}

function fuelNfKey(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits || value.trim().toLowerCase();
}

function formatDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function MoneyCells({ row }: { row: Pick<ContractControlRow, "valorTotal" | "adiantamento" | "combustivel" | "valorPago" | "valorDevedor"> }) {
  return (
    <>
      <td className="num">{formatMoney(row.valorTotal)}</td>
      <td className="num">{formatMoney(row.adiantamento)}</td>
      <td className="num">{formatMoney(row.combustivel)}</td>
      <td className="num">{formatMoney(row.valorPago)}</td>
      <td className="num">{formatMoney(row.valorDevedor)}</td>
    </>
  );
}

function MultiSelect<T extends string | number>({
  label,
  options,
  selected,
  onChange,
  emptyLabel = "Seleções múltiplas",
  onOpen,
}: {
  label: string;
  options: { id: T; label: string }[];
  selected: T[];
  onChange: (ids: T[]) => void;
  emptyLabel?: string;
  onOpen?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [place, setPlace] = useState({ top: 0, left: 0, width: 320 });
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const query = normalize(search);
  const visible = options.filter((option) => normalize(option.label).includes(query));
  const summary = selected.length ? `${selected.length} selecionado(s)` : emptyLabel;

  function openMenu() {
    onOpen?.();
    const rect = rootRef.current?.getBoundingClientRect();
    const width = Math.max(rect?.width ?? 180, 320);
    const left = Math.min(Math.max(8, rect?.left ?? 8), Math.max(8, window.innerWidth - width - 8));
    setPlace({ top: (rect?.bottom ?? 0) + 4, left, width });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onLayout(event: Event) {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", onLayout);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", onLayout);
    };
  }, [open]);

  return (
    <div className="contract-filter" ref={rootRef}>
      <span>{label}</span>
      <button
        type="button"
        className="contract-filter-btn"
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        {summary}
      </button>
      {open ? (
        <div className="contract-filter-pop" style={{ top: place.top, left: place.left, width: place.width }}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar"
            autoFocus
          />
          <div className="contract-filter-actions">
            <button type="button" onClick={() => onChange(visible.map((option) => option.id))}>
              Marcar visíveis
            </button>
            <button type="button" onClick={() => onChange([])}>
              Limpar
            </button>
          </div>
          <div className="contract-filter-list">
            {visible.map((option) => (
              <label key={String(option.id)}>
                <input
                  type="checkbox"
                  checked={selectedSet.has(option.id)}
                  onChange={(event) => {
                    onChange(
                      event.target.checked
                        ? [...selected, option.id]
                        : selected.filter((id) => id !== option.id),
                    );
                  }}
                />
                <span>{option.label}</span>
              </label>
            ))}
            {visible.length === 0 ? <p className="contract-filter-empty">Nenhuma opção encontrada.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ContractControl() {
  const [aba, setAba] = useState<"contas" | "combustivel" | "ocorrencias">("contas");
  const [from, setFrom] = useState("2026-01-01");
  const [to, setTo] = useState("2026-08-31");
  const [fornecedores, setFornecedores] = useState<ContractControlOption[]>([]);
  const [fornecedorIds, setFornecedorIds] = useState<number[]>([]);
  const [report, setReport] = useState<ContractControlReport | null>(null);
  const [ocorrencias, setOcorrencias] = useState<ContractOccurrenceReport | null>(null);
  const [observacaoFiltro, setObservacaoFiltro] = useState("");
  const [grupos, setGrupos] = useState<ContractSupplierGroup[]>([]);
  const [grupoNome, setGrupoNome] = useState("");
  const [grupoAtivo, setGrupoAtivo] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fornecedoresPedido = useRef(false);

  function carregarFornecedores() {
    if (fornecedoresPedido.current) return;
    fornecedoresPedido.current = true;
    api
      .contractControlOptions()
      .then((options) => setFornecedores(options.fornecedores))
      .catch((err: Error) => {
        fornecedoresPedido.current = false;
        setError(err.message);
      });
  }

  const consultaCtrl = useRef<AbortController | null>(null);

  useEffect(() => {
    api.contractSupplierGroups().then(setGrupos).catch((err: Error) => setError(err.message));
    return () => consultaCtrl.current?.abort();
  }, []);

  function cancelarConsulta() {
    consultaCtrl.current?.abort();
  }

  async function consultar(next?: {
    from?: string;
    to?: string;
    fornecedorIds?: number[];
    aba?: "contas" | "combustivel" | "ocorrencias";
  }) {
    const tela = next?.aba ?? aba;
    if (tela === "combustivel") return;
    const inicio = next?.from ?? from;
    const fim = next?.to ?? to;
    const fors = next?.fornecedorIds ?? fornecedorIds;
    consultaCtrl.current?.abort();
    const ctrl = new AbortController();
    consultaCtrl.current = ctrl;
    setLoading(true);
    setError("");
    try {
      if (tela === "ocorrencias") {
        setOcorrencias(
          await api.contractControlOccurrences({ from: inicio, to: fim, fornecedores: fors, signal: ctrl.signal }),
        );
      } else {
        setReport(await api.contractControl({ from: inicio, to: fim, fornecedores: fors, signal: ctrl.signal }));
      }
    } catch (err) {
      if (ctrl.signal.aborted || (err instanceof Error && err.name === "AbortError")) return;
      setError(err instanceof Error ? err.message : "Não foi possível carregar o relatório.");
    } finally {
      if (consultaCtrl.current === ctrl) {
        consultaCtrl.current = null;
        setLoading(false);
      }
    }
  }

  const ocorrenciaFiltro = normalize(observacaoFiltro);
  const ocorrenciaRows = useMemo(() => {
    const rows = ocorrencias?.rows ?? [];
    if (!ocorrenciaFiltro) return rows;
    return rows.filter((row) => normalize(row.observacao).includes(ocorrenciaFiltro));
  }, [ocorrencias, ocorrenciaFiltro]);
  const ocorrenciaTotal = useMemo(
    () => ocorrenciaRows.reduce((sum, row) => sum + row.valor, 0),
    [ocorrenciaRows],
  );

  const grupoPorFornecedor = useMemo(() => {
    const map = new Map<number, string>();
    for (const grupo of grupos) {
      for (const fornecedor of grupo.fornecedores) map.set(fornecedor.codigo, grupo.nome);
    }
    return map;
  }, [grupos]);

  const rows = useMemo(() => {
    return (report?.rows ?? [])
      .map((row) => ({
        ...row,
        grupo: row.fornecedorCodigo == null ? "" : (grupoPorFornecedor.get(row.fornecedorCodigo) ?? ""),
      }))
      .sort((a, b) => {
        const grupoA = a.grupo || "\uffff";
        const grupoB = b.grupo || "\uffff";
        return (
          grupoA.localeCompare(grupoB, "pt-BR") ||
          a.prestador.localeCompare(b.prestador, "pt-BR") ||
          a.razaoSocial.localeCompare(b.razaoSocial, "pt-BR")
        );
      });
  }, [report, grupoPorFornecedor]);

  async function salvarGrupo() {
    const nome = grupoNome.trim();
    if (!nome) {
      setError("Informe o nome do grupo. Ex.: Transporte de semente.");
      return;
    }
    const membros = fornecedores.filter((option) => fornecedorIds.includes(option.codigo));
    if (!membros.length) {
      setError("Selecione os fornecedores que entram nesse grupo.");
      return;
    }
    setError("");
    try {
      const saved = await api.saveContractSupplierGroup({ nome, fornecedores: membros });
      setGrupos(saved);
      const atual = saved.find((grupo) => normalize(grupo.nome) === normalize(nome));
      setGrupoAtivo(atual?.id ?? null);
      setGrupoNome(atual?.nome ?? nome);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o grupo.");
    }
  }

  function aplicarGrupo(grupo: ContractSupplierGroup) {
    const ids = grupo.fornecedores.map((fornecedor) => fornecedor.codigo);
    setFornecedorIds(ids);
    setGrupoNome(grupo.nome);
    setGrupoAtivo(grupo.id);
    void consultar({ fornecedorIds: ids });
  }

  async function retirarDoGrupo(groupId: number, codigos: number[]) {
    if (!codigos.length) {
      setError("Selecione o fornecedor que sai do grupo.");
      return;
    }
    setError("");
    try {
      const saved = await api.removeContractSupplierMembers(groupId, codigos);
      setGrupos(saved);
      const grupo = saved.find((item) => item.id === groupId);
      const restantes = grupo?.fornecedores.map((fornecedor) => fornecedor.codigo) ?? [];
      setFornecedorIds((current) => (grupoAtivo === groupId ? restantes : current.filter((id) => !codigos.includes(id))));
      if (grupoAtivo === groupId) void consultar({ fornecedorIds: restantes });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível retirar o fornecedor do grupo.");
    }
  }

  async function excluirGrupo(id: number) {
    setError("");
    try {
      setGrupos(await api.deleteContractSupplierGroup(id));
      if (grupoAtivo === id) {
        setGrupoAtivo(null);
        setGrupoNome("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir o grupo.");
    }
  }

  return (
    <div className="contract-control">
      <header className="contract-control-bar">
        <img src="/elejota-agro-logo.png" alt="Elejota Agro" />
        <h3>
          {aba === "combustivel" ? "COMBUSTÍVEL" : aba === "ocorrencias" ? "OCORRÊNCIAS" : "RELATÓRIO DE CONTAS A PAGAR"}
        </h3>
        {aba !== "combustivel" ? (
        <form
          className="contract-control-filters"
          onSubmit={(event) => {
            event.preventDefault();
            void consultar({ aba });
          }}
        >
          <label>
            {aba === "ocorrencias" ? "Data da ocorrência" : "Período"}
            <span className="contract-period">
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} required />
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} required />
            </span>
          </label>
          <MultiSelect
            label="Fornecedor"
            options={fornecedores.map((option) => ({
              id: option.codigo,
              label: fornecedorLabel(option.codigo, option.descricao),
            }))}
            selected={fornecedorIds}
            onChange={(ids) => {
              setFornecedorIds(ids);
              setGrupoAtivo(null);
            }}
            onOpen={carregarFornecedores}
          />
          {aba === "ocorrencias" ? (
            <>
              <label>
                Grupo
                <select
                  className="contract-obs-filter"
                  value={grupoAtivo ?? ""}
                  onChange={(event) => {
                    const id = Number(event.target.value);
                    if (!id) {
                      setGrupoAtivo(null);
                      setGrupoNome("");
                      setFornecedorIds([]);
                      void consultar({ fornecedorIds: [], aba: "ocorrencias" });
                      return;
                    }
                    const grupo = grupos.find((item) => item.id === id);
                    if (grupo) aplicarGrupo(grupo);
                  }}
                >
                  <option value="">Todos</option>
                  {grupos.map((grupo) => (
                    <option key={grupo.id} value={grupo.id}>
                      {grupo.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Observação
                <input
                  className="contract-obs-filter"
                  value={observacaoFiltro}
                  onChange={(event) => setObservacaoFiltro(event.target.value)}
                  placeholder="Texto da observação"
                />
              </label>
            </>
          ) : null}
          <button className="btn primary" type="submit" disabled={loading}>
            {loading ? "Consultando..." : "Consultar"}
          </button>
          {loading ? (
            <button className="btn" type="button" onClick={cancelarConsulta}>
              Cancelar
            </button>
          ) : null}
        </form>
        ) : (
          <p className="contract-fuel-hint no-print">Lance a NF com o mês de competência. A data e o valor da baixa entram depois, na linha da nota.</p>
        )}
      </header>

      <div className="kind-toggle no-print">
        <button type="button" className={`btn ${aba === "contas" ? "primary" : ""}`} onClick={() => setAba("contas")}>
          Contas a pagar
        </button>
        <button type="button" className={`btn ${aba === "combustivel" ? "primary" : ""}`} onClick={() => setAba("combustivel")}>
          Combustível
        </button>
        <button type="button" className={`btn ${aba === "ocorrencias" ? "primary" : ""}`} onClick={() => setAba("ocorrencias")}>
          Ocorrências
        </button>
      </div>

      {aba === "contas" ? (
        <div className="contract-groups no-print">
          <label>
            Grupo
            <input
              value={grupoNome}
              onChange={(event) => setGrupoNome(event.target.value)}
              placeholder="Ex.: Transporte de semente"
            />
          </label>
          <button type="button" className="btn" onClick={() => void salvarGrupo()}>
            Salvar grupo
          </button>
          <div className="contract-group-list">
            {grupos.map((grupo) => (
              <span key={grupo.id} className={`contract-group-chip${grupoAtivo === grupo.id ? " is-active" : ""}`}>
                <button type="button" onClick={() => aplicarGrupo(grupo)}>
                  {grupo.nome}
                  <small>{grupo.fornecedores.length}</small>
                </button>
                <button type="button" aria-label={`Excluir ${grupo.nome}`} onClick={() => void excluirGrupo(grupo.id)}>
                  ×
                </button>
              </span>
            ))}
            {grupos.length === 0 ? <span className="contract-group-hint">Nenhum grupo salvo.</span> : null}
          </div>
          {grupoAtivo ? (
            <div className="contract-group-members">
              {(grupos.find((grupo) => grupo.id === grupoAtivo)?.fornecedores ?? []).map((fornecedor) => (
                <span key={fornecedor.codigo} className="contract-group-member">
                  <span>{fornecedorLabel(fornecedor.codigo, fornecedor.descricao)}</span>
                  <button type="button" onClick={() => void retirarDoGrupo(grupoAtivo, [fornecedor.codigo])}>
                    Retirar
                  </button>
                </span>
              ))}
              {(grupos.find((grupo) => grupo.id === grupoAtivo)?.fornecedores.length ?? 0) === 0 ? (
                <span className="contract-group-hint">Nenhum fornecedor neste grupo.</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="lead contract-control-error">{error}</p> : null}

      {aba === "combustivel" ? (
        <FuelPanel />
      ) : aba === "ocorrencias" ? (
        <div className="table-wrap contract-control-wrap">
          <table className="contract-control-table contract-ocorr-table">
            <thead>
              <tr>
                <th>FORNECEDOR</th>
                <th>DOCUMENTO</th>
                <th>PARCELA</th>
                <th>DATA</th>
                <th>OCORRÊNCIA</th>
                <th>OBSERVAÇÃO</th>
                <th className="num">VALOR</th>
              </tr>
            </thead>
            <tbody>
              {ocorrenciaRows.map((row) => (
                <tr key={`${row.documento}-${row.parcela}-${row.sequencia ?? 0}-${row.ocorrencia}`}>
                  <td>{fornecedorLabel(row.fornecedorCodigo, row.fornecedor)}</td>
                  <td>{row.documento}</td>
                  <td>{row.parcela}</td>
                  <td className="date">{formatDate(row.data)}</td>
                  <td>{row.ocorrencia}</td>
                  <td className="obs">{row.observacao}</td>
                  <td className="num">{formatMoney(row.valor)}</td>
                </tr>
              ))}
              {!loading && ocorrencias && ocorrenciaRows.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    {ocorrencias.rows.length === 0
                      ? grupoAtivo || fornecedorIds.length
                        ? "Nenhuma ocorrência para esse grupo no período."
                        : "Nenhuma ocorrência no período."
                      : "Nenhuma observação encontrada para esse filtro."}
                  </td>
                </tr>
              ) : null}
            </tbody>
            {ocorrenciaRows.length > 0 ? (
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                  <td className="num">{formatMoney(ocorrenciaTotal)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      ) : (
      <div className="table-wrap contract-control-wrap">
        <table className="contract-control-table">
          <thead>
            <tr>
              <th>GRUPO</th>
              <th>PRESTADOR</th>
              <th>RAZAOSOCIAL</th>
              <th>VALOR TOTAL</th>
              <th>ADIANTAMENTO</th>
              <th>COMBUSTIVEL</th>
              <th>VALOR PAGO</th>
              <th>VALOR DEVEDOR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.fornecedorCodigo ?? "s"}-${row.prestador}-${row.razaoSocial}`}>
                <td>
                  {row.grupo && row.fornecedorCodigo != null ? (
                    <span className="contract-row-group">
                      {row.grupo}
                      <button
                        type="button"
                        className="contract-row-remove no-print"
                        onClick={() => {
                          const grupo = grupos.find((item) => item.nome === row.grupo);
                          if (grupo) void retirarDoGrupo(grupo.id, [row.fornecedorCodigo as number]);
                        }}
                      >
                        Retirar
                      </button>
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{row.prestador}</td>
                <td>{fornecedorLabel(row.fornecedorCodigo, row.razaoSocial)}</td>
                <MoneyCells row={row} />
              </tr>
            ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  {report ? "Nenhuma conta a pagar no período." : "Informe o período e clique em Consultar."}
                </td>
              </tr>
            ) : null}
          </tbody>
          {report ? (
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td />
                <MoneyCells row={report.totals} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      )}
    </div>
  );
}

function parseMoney(raw: string) {
  const text = raw.trim().replace(/\s/g, "");
  if (!text) return Number.NaN;
  const normal = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const value = Number(normal);
  return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
}

function formatDay(iso: string) {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

function moneyDraft(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCompetence(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[2]}/${match[1]}` : value || "—";
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function fuelSupplierName(nome: string) {
  return nome.trim() || "Sem fornecedor";
}

function fuelTotals(rows: ContractFuelRow[]) {
  return {
    valorNf: roundMoney(rows.reduce((sum, row) => sum + row.valorNf, 0)),
    valorBaixado: roundMoney(rows.reduce((sum, row) => sum + row.valorBaixado, 0)),
    restante: roundMoney(rows.reduce((sum, row) => sum + row.restante, 0)),
  };
}

function groupFuelBySupplier(rows: ContractFuelRow[]) {
  const groups = new Map<string, { nome: string; rows: ContractFuelRow[] }>();
  for (const row of rows) {
    const nome = fuelSupplierName(row.fornecedor);
    const key = normalize(nome);
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { nome, rows: [row] });
  }
  return [...groups.values()]
    .map((group) => {
      const notes = [...group.rows].sort((a, b) => a.numeroNf.localeCompare(b.numeroNf, "pt-BR", { numeric: true }));
      return {
        nome: group.nome,
        rows: notes,
        valorNf: roundMoney(notes.reduce((sum, note) => sum + note.valorNf, 0)),
        valorBaixado: roundMoney(notes.reduce((sum, note) => sum + note.valorBaixado, 0)),
        restante: roundMoney(notes.reduce((sum, note) => sum + note.restante, 0)),
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function FuelPanel() {
  const [report, setReport] = useState<ContractFuelReport | null>(null);
  const [fornecedorFiltro, setFornecedorFiltro] = useState<string[]>([]);
  const [numeroNf, setNumeroNf] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [mesCompetencia, setMesCompetencia] = useState("");
  const [valorNf, setValorNf] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api.contractControlFuel().then(setReport).catch((err: Error) => setErro(err.message));
  }, []);

  async function adicionar(event: FormEvent) {
    event.preventDefault();
    const nf = parseMoney(valorNf);
    if (!numeroNf.trim() || !fornecedor.trim() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mesCompetencia) || !Number.isFinite(nf) || !(nf > 0)) {
      setErro("Informe o número da NF, o fornecedor, o mês de competência e o valor da NF.");
      return;
    }
    const nfInformada = fuelNfKey(numeroNf);
    const repetida = (report?.rows ?? []).some((row) => fuelNfKey(row.numeroNf) === nfInformada);
    if (repetida) {
      setErro("Esta NF já está lançada. Inclua outra baixa nela.");
      return;
    }
    setSalvando(true);
    setErro("");
    try {
      setReport(
        await api.addContractFuelNote({
          numeroNf: numeroNf.trim(),
          fornecedor: fornecedor.trim(),
          mesCompetencia,
          valorNf: nf,
        }),
      );
      setNumeroNf("");
      setFornecedor("");
      setMesCompetencia("");
      setValorNf("");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível guardar a nota.");
    } finally {
      setSalvando(false);
    }
  }

  const fornecedorOpcoes = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of report?.rows ?? []) {
      const nome = fuelSupplierName(row.fornecedor);
      const key = normalize(nome);
      if (!map.has(key)) map.set(key, nome);
    }
    return [...map.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
      .map(([id, label]) => ({ id, label }));
  }, [report]);

  useEffect(() => {
    if (!report) return;
    const valid = new Set(fornecedorOpcoes.map((option) => option.id));
    setFornecedorFiltro((current) => {
      const next = current.filter((id) => valid.has(id));
      return next.length === current.length ? current : next;
    });
  }, [report, fornecedorOpcoes]);

  const rows = useMemo(() => {
    const all = report?.rows ?? [];
    if (!fornecedorFiltro.length) return all;
    const selected = new Set(fornecedorFiltro);
    return all.filter((row) => selected.has(normalize(fuelSupplierName(row.fornecedor))));
  }, [report, fornecedorFiltro]);

  const totals = useMemo(() => fuelTotals(rows), [rows]);
  const grupos = useMemo(() => groupFuelBySupplier(rows), [rows]);

  return (
    <>
      <form className="contract-fuel-form no-print" onSubmit={(event) => void adicionar(event)}>
        <label>
          Número NF
          <input value={numeroNf} onChange={(event) => setNumeroNf(event.target.value)} />
        </label>
        <label>
          Fornecedor
          <input value={fornecedor} onChange={(event) => setFornecedor(event.target.value)} />
        </label>
        <label>
          Mês de competência
          <input type="month" value={mesCompetencia} onChange={(event) => setMesCompetencia(event.target.value)} />
        </label>
        <label>
          Valor NF
          <input value={valorNf} onChange={(event) => setValorNf(event.target.value)} inputMode="decimal" placeholder="0,00" />
        </label>
        <button className="btn primary" type="submit" disabled={salvando}>
          {salvando ? "Guardando..." : "Adicionar"}
        </button>
      </form>
      {erro ? <p className="lead contract-control-error no-print">{erro}</p> : null}
      <div className="contract-fuel-toolbar no-print">
        <MultiSelect
          label="Fornecedor"
          options={fornecedorOpcoes}
          selected={fornecedorFiltro}
          onChange={setFornecedorFiltro}
          emptyLabel="Todos"
        />
        <button type="button" className="btn" onClick={() => window.print()} disabled={grupos.length === 0}>
          Imprimir por fornecedor
        </button>
      </div>
      <div className="table-wrap contract-control-wrap no-print">
        <table className="contract-control-table contract-fuel-table">
          <thead>
            <tr>
              <th>NÚMERO NF</th>
              <th>FORNECEDOR</th>
              <th>MÊS COMPETÊNCIA</th>
              <th>VALOR NF</th>
              <th>DATA DA BAIXA</th>
              <th>VALOR BAIXADO</th>
              <th>RESTANTE</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <FuelNote key={row.id} row={row} onChange={setReport} onError={setErro} />
            ))}
            {report && rows.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  {report.rows.length === 0 ? "Nenhuma nota lançada." : "Nenhuma nota para os fornecedores selecionados."}
                </td>
              </tr>
            ) : null}
          </tbody>
          {rows.length > 0 ? (
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td />
                <td className="num">{formatMoney(totals.valorNf)}</td>
                <td />
                <td className="num">{formatMoney(totals.valorBaixado)}</td>
                <td className="num">{formatMoney(totals.restante)}</td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <section className="contract-fuel-print">
        <h4>Relatório de combustível por fornecedor</h4>
        {grupos.length === 0 ? <p>Nenhuma nota lançada.</p> : null}
        {grupos.map((grupo) => (
          <table key={grupo.nome} className="contract-fuel-print-table">
            <colgroup>
              <col className="contract-fuel-col-nf" />
              <col className="contract-fuel-col-mes" />
              <col className="contract-fuel-col-valor" />
              <col className="contract-fuel-col-baixas" />
              <col className="contract-fuel-col-valor" />
              <col className="contract-fuel-col-valor" />
            </colgroup>
            <thead>
              <tr>
                <th colSpan={6}>{grupo.nome}</th>
              </tr>
              <tr>
                <th>Número NF</th>
                <th>Mês competência</th>
                <th>Valor NF</th>
                <th>Baixas</th>
                <th>Valor baixado</th>
                <th>Restante</th>
              </tr>
            </thead>
            <tbody>
              {grupo.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.numeroNf}</td>
                  <td>{formatCompetence(row.mesCompetencia)}</td>
                  <td className="num">{formatMoney(row.valorNf)}</td>
                  <td className="contract-fuel-print-baixas">
                    {row.baixas.length
                      ? row.baixas.map((baixa) => `${formatDay(baixa.data)} — ${formatMoney(baixa.valor)}`).join("\n")
                      : "—"}
                  </td>
                  <td className="num">{formatMoney(row.valorBaixado)}</td>
                  <td className="num">{formatMoney(row.restante)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Subtotal</td>
                <td className="num">{formatMoney(grupo.valorNf)}</td>
                <td />
                <td className="num">{formatMoney(grupo.valorBaixado)}</td>
                <td className="num">{formatMoney(grupo.restante)}</td>
              </tr>
            </tfoot>
          </table>
        ))}
        {grupos.length > 0 ? (
          <table className="contract-fuel-print-table contract-fuel-print-total">
            <colgroup>
              <col className="contract-fuel-col-nf" />
              <col className="contract-fuel-col-mes" />
              <col className="contract-fuel-col-valor" />
              <col className="contract-fuel-col-baixas" />
              <col className="contract-fuel-col-valor" />
              <col className="contract-fuel-col-valor" />
            </colgroup>
            <tbody>
              <tr>
                <td colSpan={2}>Total geral</td>
                <td className="num">{formatMoney(totals.valorNf)}</td>
                <td />
                <td className="num">{formatMoney(totals.valorBaixado)}</td>
                <td className="num">{formatMoney(totals.restante)}</td>
              </tr>
            </tbody>
          </table>
        ) : null}
      </section>
    </>
  );
}

function FuelNote({
  row,
  onChange,
  onError,
}: {
  row: ContractFuelRow;
  onChange: (report: ContractFuelReport) => void;
  onError: (message: string) => void;
}) {
  const [data, setData] = useState("");
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);
  const linhas = row.baixas.length > 0 ? row.baixas.length : 1;
  const span = linhas + (row.restante > 0 ? 1 : 0);

  async function novaBaixa(event: FormEvent) {
    event.preventDefault();
    const amount = parseMoney(valor);
    if (!data || !Number.isFinite(amount) || !(amount > 0)) {
      onError("Informe a data e o valor da baixa.");
      return;
    }
    setSalvando(true);
    onError("");
    try {
      onChange(await api.addContractFuelBaixa(row.id, { dataBaixa: data, valor: amount }));
      setData("");
      setValor("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Não foi possível guardar a baixa.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluirNota() {
    onError("");
    try {
      onChange(await api.deleteContractFuelNote(row.id));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Não foi possível excluir a nota.");
    }
  }

  return (
    <>
      {(row.baixas.length ? row.baixas : [null]).map((baixa, index) =>
        baixa ? (
          <FuelBaixaRow
            key={baixa.id}
            baixa={baixa}
            first={index === 0}
            span={span}
            row={row}
            onChange={onChange}
            onError={onError}
            onDeleteNote={() => void excluirNota()}
          />
        ) : (
          <tr key={`vazia-${row.id}`}>
            <td rowSpan={span}>
              <FuelNfNumber noteId={row.id} value={row.numeroNf} onChange={onChange} onError={onError} />
            </td>
            <td rowSpan={span}>
              <FuelSupplierName noteId={row.id} value={row.fornecedor} onChange={onChange} onError={onError} />
            </td>
            <td rowSpan={span}>
              <CompetenceMonth noteId={row.id} value={row.mesCompetencia} onChange={onChange} onError={onError} />
            </td>
            <td className="num" rowSpan={span}>
              {formatMoney(row.valorNf)}
            </td>
            <td>—</td>
            <td className="num">—</td>
            <td className="num" rowSpan={span}>
              {formatMoney(row.restante)}
            </td>
            <td>
              <div className="contract-fuel-actions">
                <button type="button" className="btn" onClick={() => void excluirNota()}>
                  Excluir NF
                </button>
              </div>
            </td>
          </tr>
        ),
      )}
      {row.restante > 0 ? (
        <tr>
          <td colSpan={2}>
            <form className="contract-fuel-inline" onSubmit={(event) => void novaBaixa(event)}>
              <input type="date" value={data} onChange={(event) => setData(event.target.value)} aria-label="Data da baixa" />
              <input
                value={valor}
                onChange={(event) => setValor(event.target.value)}
                inputMode="decimal"
                placeholder="Valor baixado"
                aria-label="Valor baixado"
              />
              <button className="btn primary" type="submit" disabled={salvando}>
                {salvando ? "..." : "Nova baixa"}
              </button>
            </form>
          </td>
          <td />
        </tr>
      ) : null}
    </>
  );
}

function CompetenceMonth({
  noteId,
  value,
  onChange,
  onError,
}: {
  noteId: number;
  value: string;
  onChange: (report: ContractFuelReport) => void;
  onError: (message: string) => void;
}) {
  const [mes, setMes] = useState(value);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => setMes(value), [value]);

  async function salvar(next: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(next) || next === value) {
      setMes(value);
      if (next && next !== value) onError("Informe o mês de competência da NF.");
      return;
    }
    setSalvando(true);
    onError("");
    try {
      onChange(await api.updateContractFuelNote(noteId, { mesCompetencia: next }));
    } catch (err) {
      setMes(value);
      onError(err instanceof Error ? err.message : "Não foi possível alterar o mês de competência.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <input
      type="month"
      value={mes}
      disabled={salvando}
      aria-label="Mês de competência"
      onChange={(event) => {
        const next = event.target.value;
        setMes(next);
        void salvar(next);
      }}
    />
  );
}

function FuelBaixaRow({
  baixa,
  first,
  span,
  row,
  onChange,
  onError,
  onDeleteNote,
}: {
  baixa: ContractFuelRow["baixas"][number];
  first: boolean;
  span: number;
  row: ContractFuelRow;
  onChange: (report: ContractFuelReport) => void;
  onError: (message: string) => void;
  onDeleteNote: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [data, setData] = useState(baixa.data);
  const [valor, setValor] = useState(moneyDraft(baixa.valor));
  const [salvando, setSalvando] = useState(false);

  function abrirEdicao() {
    setData(baixa.data);
    setValor(moneyDraft(baixa.valor));
    setEditing(true);
    onError("");
  }

  async function salvar(event: FormEvent) {
    event.preventDefault();
    const amount = parseMoney(valor);
    if (!data || !Number.isFinite(amount) || !(amount > 0)) {
      onError("Informe a data e o valor da baixa.");
      return;
    }
    setSalvando(true);
    onError("");
    try {
      onChange(await api.updateContractFuelBaixa(baixa.id, { dataBaixa: data, valor: amount }));
      setEditing(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Não foi possível alterar a baixa.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    onError("");
    try {
      onChange(await api.deleteContractFuelBaixa(baixa.id));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Não foi possível excluir a baixa.");
    }
  }

  return (
    <tr>
      {first ? (
        <>
          <td rowSpan={span}>
            <FuelNfNumber noteId={row.id} value={row.numeroNf} onChange={onChange} onError={onError} />
          </td>
          <td rowSpan={span}>
            <FuelSupplierName noteId={row.id} value={row.fornecedor} onChange={onChange} onError={onError} />
          </td>
          <td rowSpan={span}>
            <CompetenceMonth noteId={row.id} value={row.mesCompetencia} onChange={onChange} onError={onError} />
          </td>
          <td className="num" rowSpan={span}>
            {formatMoney(row.valorNf)}
          </td>
        </>
      ) : null}
      <td>
        {editing ? (
          <input type="date" value={data} onChange={(event) => setData(event.target.value)} aria-label="Data da baixa" />
        ) : (
          formatDay(baixa.data)
        )}
      </td>
      <td className="num">
        {editing ? (
          <input
            value={valor}
            onChange={(event) => setValor(event.target.value)}
            inputMode="decimal"
            aria-label="Valor baixado"
          />
        ) : (
          formatMoney(baixa.valor)
        )}
      </td>
      {first ? (
        <td className="num" rowSpan={span}>
          {formatMoney(row.restante)}
        </td>
      ) : null}
      <td>
        <form className="contract-fuel-actions" onSubmit={(event) => void salvar(event)}>
          {editing ? (
            <>
              <button className="btn primary" type="submit" disabled={salvando}>
                {salvando ? "..." : "Salvar"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setEditing(false);
                  onError("");
                }}
              >
                Cancelar
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={abrirEdicao}>
              Editar
            </button>
          )}
          <button type="button" className="btn" onClick={() => void excluir()}>
            Excluir
          </button>
          {first ? (
            <button type="button" className="btn" onClick={onDeleteNote}>
              Excluir NF
            </button>
          ) : null}
        </form>
      </td>
    </tr>
  );
}
