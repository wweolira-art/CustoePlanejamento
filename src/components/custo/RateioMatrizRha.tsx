import { Fragment, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { api, type CustoMatrizSubprocessoData } from "../../api";
import { formatBRL } from "../../lib/format";
import { useApp } from "../../store";
import { PrintButton } from "../PrintButton";
import { composicaoPorColuna } from "../../lib/rateio-origens";
import { ArrendamentoSafraChart } from "./ArrendamentoSafraChart";

const COL_FILL: Record<string, { bg: string; color: string }> = {
  preparo: { bg: "#e3e9ef", color: "#1a2744" },
  plantio: { bg: "#e3e9ef", color: "#1a2744" },
  tratos_planta: { bg: "#e3e9ef", color: "#1a2744" },
  formacao: { bg: "#b8d88a", color: "#142018" },
  tratos_soca: { bg: "#1a2744", color: "#ffffff" },
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cellStyle(opts: { bg: string; color: string; align?: "left" | "right"; bold?: boolean }) {
  const parts = [
    `background:${opts.bg}`,
    `color:${opts.color}`,
    "border:1px solid #b8c2ce",
    "padding:5px 8px",
    `text-align:${opts.align ?? "right"}`,
    "white-space:nowrap",
    "font-family:Calibri,Arial,sans-serif",
    "font-size:11pt",
  ];
  if (opts.bold) parts.push("font-weight:700");
  return parts.join(";");
}

function fillFor(colKey: string, rowKind: "normal" | "total" | "subtotal") {
  if (colKey === "tratos_soca" && rowKind !== "normal") {
    return { bg: "#c8d2de", color: "#000000" };
  }
  if (rowKind === "total") return { bg: "#d5dde8", color: "#000000" };
  if (rowKind === "subtotal") return { bg: "#eef2f7", color: "#000000" };
  return COL_FILL[colKey] ?? { bg: "#ffffff", color: "#1a2744" };
}

function buildMatrizCopyHtml(
  data: CustoMatrizSubprocessoData,
  modo: ModoExibicao,
  modoLabel: string,
) {
  const { colunas, linhas } = data;
  const th = (text: string, style: string, extra = "") =>
    `<th ${extra} style="${style}">${escapeHtml(text)}</th>`;
  const td = (text: string, style: string) => `<td style="${style}">${escapeHtml(text)}</td>`;

  const head1 = [
    th(modoLabel, cellStyle({ bg: "#dfe5ec", color: "#1a2744", align: "left", bold: true }), 'rowspan="2"'),
    ...colunas.map((col) => {
      const fill = COL_FILL[col.key] ?? { bg: "#dfe5ec", color: "#1a2744" };
      return th(col.label, cellStyle({ ...fill, align: "center", bold: true }), 'colspan="2"');
    }),
  ].join("");

  const head2 = colunas
    .flatMap((col) => {
      const fill = COL_FILL[col.key] ?? { bg: "#dfe5ec", color: "#1a2744" };
      const style = cellStyle({ ...fill, align: "center", bold: true });
      return [th(modoLabel, style), th("%", style)];
    })
    .join("");

  const body = linhas
    .map((row) => {
      const kind =
        row.tipo === "total" ? "total" : row.tipo === "subtotal" ? "subtotal" : "normal";
      const bold = kind !== "normal";
      const labelFill =
        kind === "total" ? { bg: "#d5dde8", color: "#000000" } : kind === "subtotal" ? { bg: "#eef2f7", color: "#000000" } : { bg: "#ffffff", color: "#1a2744" };
      const cells = colunas.flatMap((col) => {
        const cell = row.celulas[col.key];
        const hasValue = kind === "total" || (cell?.valor ?? 0) > 0.005;
        const mainValue =
          modo === "valor" ? formatBRL(cell?.valor ?? 0) : fmtRha(cell?.rHa);
        const fill = fillFor(col.key, kind);
        const style = cellStyle({ ...fill, bold });
        return [td(hasValue ? mainValue : "—", style), td(hasValue ? fmtPct(cell?.pct) : "—", style)];
      });
      return `<tr>${td(row.label, cellStyle({ ...labelFill, align: "left", bold }))}${cells.join("")}</tr>`;
    })
    .join("");

  const footCells = colunas.flatMap((col) => {
    const fill = fillFor(col.key, "total");
    const style = cellStyle({ ...fill, bold: true });
    const value = modo === "valor" ? formatBRL(col.total ?? 0) : fmtRha(col.rHaTotal);
    return [th(value, style), th("100%", style)];
  });
  const foot = `<tr>${th(
    `Total ${modo === "valor" ? "R$" : "R$/ha"} (rateio)`,
    cellStyle({ bg: "#c8d2de", color: "#000000", align: "left", bold: true }),
  )}${footCells.join("")}</tr>`;

  return `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif">${`<thead><tr>${head1}</tr><tr>${head2}</tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot>`}</table>`;
}

function buildMatrizCopyText(
  data: CustoMatrizSubprocessoData,
  modo: ModoExibicao,
  modoLabel: string,
) {
  const { colunas, linhas } = data;
  const header = [
    modoLabel,
    ...colunas.flatMap((col) => [`${col.label} ${modoLabel}`, `${col.label} %`]),
  ];
  const rows = linhas.map((row) => {
    const kind = row.tipo === "total" ? "total" : "item";
    return [
      row.label,
      ...colunas.flatMap((col) => {
        const cell = row.celulas[col.key];
        const hasValue = kind === "total" || (cell?.valor ?? 0) > 0.005;
        const mainValue =
          modo === "valor" ? formatBRL(cell?.valor ?? 0) : fmtRha(cell?.rHa);
        return [hasValue ? mainValue : "—", hasValue ? fmtPct(cell?.pct) : "—"];
      }),
    ];
  });
  const foot = [
    `Total ${modo === "valor" ? "R$" : "R$/ha"} (rateio)`,
    ...colunas.flatMap((col) => [
      modo === "valor" ? formatBRL(col.total ?? 0) : fmtRha(col.rHaTotal),
      "100%",
    ]),
  ];
  return [header, ...rows, foot].map((line) => line.join("\t")).join("\r\n");
}

async function copyHtmlForOffice(html: string, plain: string) {
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return;
    }
  } catch {
    // Office no Windows costuma colar melhor o HTML via seleção + execCommand.
  }
  const holder = document.createElement("div");
  holder.setAttribute("contenteditable", "true");
  holder.style.position = "fixed";
  holder.style.left = "-9999px";
  holder.style.top = "0";
  holder.innerHTML = html;
  document.body.appendChild(holder);
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(holder);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const ok = document.execCommand("copy");
  selection?.removeAllRanges();
  holder.remove();
  if (!ok) throw new Error("Não foi possível copiar a tabela.");
}

type Props = {
  data: CustoMatrizSubprocessoData;
  printMeta?: string;
};

type ModoExibicao = "valor" | "rha";

function fmtRha(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(n);
}

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n)}%`;
}

function fmtHa(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
}

const COL_CLASS: Record<string, string> = {
  preparo: "matriz-col-preparo",
  plantio: "matriz-col-plantio",
  tratos_planta: "matriz-col-tratos-planta",
  formacao: "matriz-col-formacao",
  tratos_soca: "matriz-col-tratos-soca",
};

function fmtRate(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtShare(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "";
  return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)}%`;
}

function fmtQty2(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

type EstagioLinha = NonNullable<CustoMatrizSubprocessoData["estagios"]>["linhas"][number];

function aplicarAreasEstagio(
  linhas: EstagioLinha[],
  areas: AreasEstagio | null,
): EstagioLinha[] {
  if (!areas) return linhas;
  const total = areas.plantio + areas.soca;
  const haPorChave: Record<string, number> = {
    formacao: areas.plantio,
    conservacao: areas.plantio,
    preparo: areas.plantio,
    plantio: areas.plantio,
    tratos_planta: areas.plantio,
    colheita_mudas: areas.plantio,
    manutencao: areas.soca,
    colheita: areas.soca,
    irrigacao: areas.irrigacao,
    administrativo: total,
    arrendamento: areas.arrendada,
  };
  return linhas.map((row) => {
    const ha = haPorChave[row.chave];
    const rKgAtr = areas.atr > 0 && row.rTon != null ? row.rTon / areas.atr : row.rKgAtr;
    if (ha == null || row.valor == null) return { ...row, rKgAtr };
    return { ...row, rHa: ha > 0 ? row.valor / ha : null, rKgAtr };
  });
}

function aplicarPrecoEstimado(linhas: EstagioLinha[], areas: AreasEstagio | null): EstagioLinha[] {
  if (!areas?.precoAtrConsecana) {
    return linhas.map((row) => (row.chave === "preco" ? { ...row, label: "Preço estimado" } : row));
  }
  const custoTotal = linhas.find((row) => row.chave === "custo_total");
  const custoTon = custoTotal?.rTon ?? null;
  const precoTon = areas.precoAtrConsecana;
  const margemTon = custoTon != null ? precoTon - custoTon : null;
  const atr = areas.atr > 0 ? areas.atr : 0;
  return linhas.map((row) => {
    if (row.chave === "preco") {
      return {
        ...row,
        label: "Preço estimado",
        rTon: precoTon,
        rKgAtr: atr > 0 ? precoTon / atr : null,
      };
    }
    if (row.chave === "margem") {
      return {
        ...row,
        rTon: margemTon,
        rKgAtr: atr > 0 && margemTon != null ? margemTon / atr : null,
      };
    }
    return row;
  });
}

function ParametrosArea({
  data,
  areaArrendada,
}: {
  data: CustoMatrizSubprocessoData;
  areaArrendada: { ha: number; motivo: string } | null;
}) {
  const p = data.estagios?.parametros;
  if (!p) return null;
  const rows: { label: string; value: string; motivo: string }[] = [
    {
      label: "Área plantio (ha)",
      value: fmtQty2(p.areaPlantio),
      motivo: "Entra no R$/ha de Formação, Conservação de Solo, Preparo e Plantio. Soma a coluna Área de automotivo.itens_apontamento na operação 41.",
    },
    {
      label: "Área soqueira (ha)",
      value: fmtQty2(p.areaSoca),
      motivo: "Entra no R$/ha de Manutenção de soqueira e Sistema de colheita. Área de agricola.apontamentoitem nas operações M13, M56, M80 e M342.",
    },
    {
      label: "Área total (ha)",
      value: fmtQty2(p.areaTotal),
      motivo: "Plantio + soqueira. Entra no R$/ha do Administrativo.",
    },
    {
      label: "Área irrigação (ha)",
      value: fmtQty2(p.areaIrrigacao),
      motivo: "Entra no R$/ha da Irrigação. Soma, uma vez por talhão, a área total do talhão em agricola.vw_apontamentoirrigacao no período.",
    },
    {
      label: "Área arrendada (ha)",
      value: areaArrendada && areaArrendada.ha > 0 ? fmtQty2(areaArrendada.ha) : "—",
      motivo: areaArrendada
        ? `${areaArrendada.motivo} Este hectare divide o R$/ha do Arrendamento.`
        : "Lendo Cadastros > Áreas.",
    },
  ];
  rows.push(
    {
      label: "Moagem (t)",
      value: fmtQty2(p.toneladas),
      motivo: "Divisor do R$/t de todos os estágios. Soma de agricola.itensentradacana.pesoliquido no período, em toneladas.",
    },
    {
      label: "Produtividade (t/há)",
      value: fmtQty2(p.produtividade),
      motivo: "Moagem ÷ área total. Mostra a produtividade implícita da área usada no rateio.",
    },
  );
  return (
    <aside className="estagio-parametros">
      <table>
        <thead>
          <tr>
            <th colSpan={2}>Parâmetros técnicos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th>
                {row.label}
                <small>{row.motivo}</small>
              </th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}

export type ModoEstagio = "valor" | "rha" | "ambos";

export type AreasEstagio = {
  plantio: number;
  soca: number;
  irrigacao: number;
  arrendada: number;
  atr: number;
  precoAtrConsecana: number;
};

export function EstagiosProducao({
  data,
  modo = "ambos",
  areasArmazenadas = null,
  painel,
}: {
  data: CustoMatrizSubprocessoData;
  modo?: ModoEstagio;
  areasArmazenadas?: AreasEstagio | null;
  painel?: ReactNode;
}) {
  const { safraId } = useApp();
  const baseLinhas = data.estagios?.linhas ?? [];
  const [areaArrendada, setAreaArrendada] = useState<{ ha: number; motivo: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAreaArrendada(null);
    api
      .harvestAreas(safraId ?? undefined)
      .then((payload) => {
        if (cancelled) return;
        const areas = payload.areas ?? [];
        const marcadas = areas.filter((row) => /arrend/i.test(row.description));
        const usadas = marcadas.length ? marcadas : areas;
        const ha = usadas.reduce((sum, row) => sum + (Number(row.area) || 0), 0);
        const nomes = usadas.map((row) => row.description).filter(Boolean).join(", ");
        const motivo = !areas.length
          ? "Nenhuma área cadastrada em Cadastros > Áreas nesta safra."
          : marcadas.length
            ? `Cadastros > Áreas: ${nomes}.`
            : `Cadastros > Áreas não tem descrição de arrendamento. O valor é o total cadastrado${nomes ? `: ${nomes}` : ""}.`;
        setAreaArrendada({ ha, motivo });
      })
      .catch(() => {
        if (!cancelled) {
          setAreaArrendada({ ha: 0, motivo: "Não foi possível ler as áreas de Cadastros > Áreas." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [safraId]);

  const linhas = useMemo(() => {
    const comAreas = aplicarAreasEstagio(
      baseLinhas.filter((row) => row.chave !== "nao_rateado"),
      areasArmazenadas,
    );
    const areaTotal = areasArmazenadas
      ? areasArmazenadas.plantio + areasArmazenadas.soca
      : (data.estagios?.hectares?.planta ?? 0) + (data.estagios?.hectares?.soca ?? 0);
    const comTotal = comAreas.map((row) => {
      if (row.valor == null) return row;
      if (row.nivel === "total") {
        return { ...row, rHa: areaTotal > 0 ? row.valor / areaTotal : null };
      }
      return row;
    });
    return aplicarPrecoEstimado(comTotal, areasArmazenadas);
  }, [baseLinhas, areasArmazenadas, data.estagios?.hectares?.planta, data.estagios?.hectares?.soca]);
  if (!linhas.length) return null;
  return (
    <div className="estagio-producao">
      <div className="estagio-producao-layout">
        <div>
          <h4>Estágio de produção</h4>
          <div className="table-wrap">
            <table className="data estagio-producao-table">
              <thead>
                <tr>
                  <th>Estágio de produção</th>
                  {modo !== "rha" ? <th className="num">Custo total (R$)</th> : null}
                  {modo !== "valor" ? <th className="num">R$/há</th> : null}
                  <th className="num">R$/t</th>
                  <th className="num">R$/kg ATR</th>
                  <th className="num">%</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((row) => (
                  <tr key={row.chave} className={`estagio-${row.nivel}`}>
                    <td className={row.nivel === "item" ? "estagio-item" : undefined}>{row.label}</td>
                    {modo !== "rha" ? (
                      <td className="num">{row.valor == null ? "—" : formatBRL(row.valor)}</td>
                    ) : null}
                    {modo !== "valor" ? <td className="num">{fmtRate(row.rHa)}</td> : null}
                    <td className="num">{fmtRate(row.rTon)}</td>
                    <td className="num">{fmtRate(row.rKgAtr)}</td>
                    <td className="num">{row.nivel === "preco" || row.nivel === "margem" ? "" : fmtShare(row.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {painel ?? <ParametrosArea data={data} areaArrendada={areaArrendada} />}
      </div>
    </div>
  );
}

export function RateioMatrizRha({ data, printMeta }: Props) {
  const adicionais = new Set(["colheita", "irrigacao", "administrativo", "arrendamento"]);
  const separar = (outros: boolean): CustoMatrizSubprocessoData => {
    const colunas = data.colunas.filter((coluna) => adicionais.has(coluna.key) === outros);
    const chaves = new Set(colunas.map((coluna) => coluna.key));
    const origens = data.origens?.filter((origem) => chaves.has(origem.coluna) || (chaves.has("formacao") && origem.coluna === "colheita_mudas"));
    return {
      ...data,
      colunas,
      origens,
      linhas: data.linhas.filter((linha) => linha.tipo === "total"
        || colunas.some((coluna) => Math.abs(linha.celulas[coluna.key]?.valor ?? 0) > 0.0001)
        || origens?.some((origem) => linha.tipo === "subtotal" ? origem.secao === linha.secao : origem.linhaChave === linha.chave)),
    };
  };
  const principal = separar(false);
  const outros = separar(true);
  return <>
    <RateioTabela data={principal} printMeta={printMeta} titulo="Rateio por subprocesso (Cana)" />
    {outros.colunas.length ? <DemaisCustosEstagio data={outros} /> : null}
    <ArrendamentoSafraChart />
  </>;
}

function DemaisCustosEstagio({ data }: { data: CustoMatrizSubprocessoData }) {
  const [aberto, setAberto] = useState<string | null>(null);
  useEffect(() => setAberto(null), [data]);
  const total = data.linhas.find((linha) => linha.tipo === "total");
  const totalPeriodo = data.resumo.totalPool;
  const toneladas = data.toneladas ?? data.estagios?.toneladas ?? 0;
  return <section className="panel">
    <h3>Demais custos de Estágio de produção</h3>
    <div className="table-wrap">
      <table className="data estagio-producao-table">
        <thead><tr><th>Estágio de produção</th><th className="num">Custo total (R$)</th><th className="num">R$/ha</th><th className="num">R$/ton</th><th className="num">%</th></tr></thead>
        <tbody>{data.colunas.map((coluna) => {
          const composicao = aberto === coluna.key && total ? composicaoPorColuna({ ...data, colunas: [coluna], origens: data.origens?.filter((origem) => origem.coluna === coluna.key) }, total) : [];
          return <Fragment key={coluna.key}>
            <tr>
              <td><strong>{coluna.label}</strong>
                {data.origens?.some((origem) => origem.coluna === coluna.key) ? <button
                  type="button" className="matriz-origem-abrir no-print"
                  aria-expanded={aberto === coluna.key}
                  onClick={() => setAberto((atual) => atual === coluna.key ? null : coluna.key)}
                >{aberto === coluna.key ? "Ocultar composição" : "Ver composição"}</button> : null}
              </td>
              <td className="num">{formatBRL(coluna.total)}</td>
              <td className="num">{fmtRha(coluna.rHaTotal)}</td>
              <td className="num">{fmtRha(toneladas > 0 ? coluna.total / toneladas : null)}</td>
              <td className="num">{fmtPct(totalPeriodo > 0 ? coluna.total / totalPeriodo * 100 : null)}</td>
            </tr>
            {composicao.map((item) => {
              const cell = item.celulas[coluna.key];
              return <tr key={item.chave} className="matriz-composicao-item">
                <td style={{ paddingLeft: 28 }}>{item.nome}</td>
                <td className="num">{formatBRL(cell.valor)}</td>
                <td className="num">{fmtRha(cell.rHa)}</td>
                <td className="num">{fmtRha(toneladas > 0 ? cell.valor / toneladas : null)}</td>
                <td className="num">{fmtPct(totalPeriodo > 0 ? cell.valor / totalPeriodo * 100 : null)}</td>
              </tr>;
            })}
          </Fragment>;
        })}</tbody>
      </table>
    </div>
  </section>;
}

function RateioTabela({ data, printMeta, titulo }: Props & { titulo: string }) {
  const detalheId = useId();
  const modo: ModoExibicao = "rha";
  const [detalhe, setDetalhe] = useState<{ linha: string; coluna: string } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "err">("idle");
  const { colunas, linhas, hectareas, fontesUnidades } = data;
  const modoLabel = modo === "valor" ? "R$" : "R$/ha";
  useEffect(() => setDetalhe(null), [data]);

  const copyTable = async () => {
    try {
      await copyHtmlForOffice(
        buildMatrizCopyHtml(data, modo, modoLabel),
        buildMatrizCopyText(data, modo, modoLabel),
      );
      setCopyState("ok");
    } catch {
      setCopyState("err");
    }
    window.setTimeout(() => setCopyState("idle"), 2500);
  };

  return (
    <section className="panel matriz-rha-panel">
      <div className="matriz-rha-head">
        <div>
          <h3>
            {titulo}
            <span className="panel-h3-actions">
              <button
                type="button"
                className="btn no-print"
                onClick={() => void copyTable()}
                title="Copia a tabela para colar no PowerPoint ou Excel"
              >
                {copyState === "ok" ? "Copiada" : copyState === "err" ? "Falhou" : "Copiar tabela"}
              </button>
              <PrintButton />
            </span>
          </h3>
          {printMeta ? <p className="print-only-meta">{printMeta}</p> : null}
        </div>
      </div>

      <div className="table-wrap matriz-rha-wrap">
        <table className="data matriz-rha">
          <thead>
            <tr>
              <th rowSpan={2} className="matriz-row-label">
                {modoLabel}
              </th>
              {colunas.map((col) => (
                <th
                  key={col.key}
                  colSpan={2}
                  className={`matriz-col-head ${COL_CLASS[col.key] ?? ""}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
            <tr>
              {colunas.flatMap((col) => [
                <th key={`${col.key}-v`} className={`num ${COL_CLASS[col.key] ?? ""}`}>
                  {modoLabel}
                </th>,
                <th key={`${col.key}-p`} className={`num ${COL_CLASS[col.key] ?? ""}`}>
                  %
                </th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {linhas.map((row) => {
              const aberta = detalhe?.linha === row.chave;
              const composicao = aberta ? composicaoPorColuna(data, row) : [];
              const isTotal = row.tipo === "total";
              const isSubtotal = row.tipo === "subtotal";
              const isIrrigacao = row.grupo === "irrigacao";
              const cls = isTotal
                ? "matriz-total"
                : isSubtotal
                  ? "matriz-subtotal"
                  : isIrrigacao
                    ? "matriz-row-irrigacao"
                    : "";
              return (
                <Fragment key={row.chave}>
                  <tr className={cls}>
                    <td
                      className="matriz-row-label"
                      style={{ paddingLeft: 8 + (row.indent ?? 0) * 16 }}
                    >
                      {row.label}
                      {data.origens?.length ? <button
                        type="button"
                        className="matriz-origem-abrir no-print"
                        aria-expanded={aberta}
                        onClick={() => setDetalhe((atual) => atual?.linha === row.chave ? null : { linha: row.chave, coluna: "todas" })}
                      >{aberta ? "Ocultar composição" : "Ver composição"}</button> : null}
                    </td>
                    {colunas.flatMap((col) => {
                      const cell = row.celulas[col.key];
                      const hasValue = isTotal || Math.abs(cell?.valor ?? 0) > 0.005;
                      const mainValue =
                        modo === "valor"
                          ? formatBRL(cell?.valor ?? 0)
                          : fmtRha(cell?.rHa);
                      return [
                        <td key={`${row.chave}-${col.key}-v`} className={`num ${COL_CLASS[col.key] ?? ""}`}>
                          {hasValue && data.origens?.length ? (
                            <button
                              type="button"
                              className="matriz-origem-link"
                              aria-label={`Ver origem de ${row.label} em ${col.label}`}
                              aria-expanded={aberta}
                              aria-controls={aberta ? detalheId : undefined}
                              title="Ver composição do custo"
                              onClick={() => setDetalhe((atual) => atual?.linha === row.chave ? null : { linha: row.chave, coluna: col.key })}
                            >
                              {mainValue} <span aria-hidden="true">⌕</span>
                            </button>
                          ) : hasValue ? mainValue : "—"}
                        </td>,
                        <td key={`${row.chave}-${col.key}-p`} className={`num ${COL_CLASS[col.key] ?? ""}`}>
                          {hasValue ? fmtPct(cell?.pct) : "—"}
                        </td>,
                      ];
                    })}
                  </tr>
                  {aberta ? composicao.map((item) => (
                    <tr key={item.chave} className="matriz-composicao-item" id={composicao[0] === item ? detalheId : undefined}>
                      <td className="matriz-row-label" style={{ paddingLeft: 24 + (row.indent ?? 0) * 16 }}>{item.nome}</td>
                      {colunas.flatMap((col) => {
                        const cell = item.celulas[col.key];
                        const temValor = Math.abs(cell?.valor ?? 0) > 0.005;
                        return [
                          <td key={`${col.key}-v`} className={`num ${COL_CLASS[col.key] ?? ""}`} title={formatBRL(cell?.valor ?? 0)}>
                            {temValor ? (modo === "valor" ? formatBRL(cell.valor) : fmtRha(cell.rHa)) : "—"}
                          </td>,
                          <td key={`${col.key}-p`} className={`num ${COL_CLASS[col.key] ?? ""}`}>
                            {temValor ? fmtPct(cell.pct) : "—"}
                          </td>,
                        ];
                      })}
                    </tr>
                  )) : null}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th>Total {modo === "valor" ? "R$" : "R$/ha"} (rateio)</th>
              {colunas.flatMap((col) => [
                <th key={`ft-${col.key}-v`} className={`num ${COL_CLASS[col.key] ?? ""}`}>
                  {modo === "valor"
                    ? formatBRL(col.total ?? 0)
                    : fmtRha(col.rHaTotal)}
                </th>,
                <th key={`ft-${col.key}-p`} className={`num ${COL_CLASS[col.key] ?? ""}`}>
                  100%
                </th>,
              ])}
            </tr>
          </tfoot>
        </table>
      </div>

      <details className="matriz-rha-details no-print">
        <summary>Unidades por coluna (R$/ha)</summary>
        <ul style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: 13 }}>
          {colunas.map((col) => {
            const fonte = fontesUnidades?.[col.key];
            if (!fonte) {
              return (
                <li key={col.key}>
                  <strong>{col.label}:</strong> {fmtHa(hectareas[col.key])} ha
                </li>
              );
            }
            const origem =
              fonte.configurado && fonte.sourceLabel
                ? `${fonte.sourceLabel}${fonte.metricLabel ? ` (${fonte.metricLabel})` : ""}`
                : fonte.nota ?? "Não configurado";
            return (
              <li key={col.key}>
                <strong>{col.label}</strong>
                {fonte.sheetTitle ? ` · ${fonte.sheetTitle}` : null}: {fmtHa(fonte.units ?? hectareas[col.key])}{" "}
                ha — {origem}
              </li>
            );
          })}
          {fontesUnidades?.colheita_mudas ? (
            <li>
              <strong>Colheita de mudas</strong>
              {fontesUnidades.colheita_mudas.sheetTitle
                ? ` · ${fontesUnidades.colheita_mudas.sheetTitle}`
                : null}
              : {fmtHa(fontesUnidades.colheita_mudas.units)} ha — compõe a coluna Formação (
              {fontesUnidades.colheita_mudas.configurado && fontesUnidades.colheita_mudas.sourceLabel
                ? fontesUnidades.colheita_mudas.sourceLabel
                : "configure CORTE SEMENTE em Un realizado"}
              )
            </li>
          ) : null}
        </ul>
      </details>
    </section>
  );
}
