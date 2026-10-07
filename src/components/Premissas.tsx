import { useEffect, useMemo, useState } from "react";
import { api, type DashboardData, type PremissaSubprocess } from "../api";
import { formatQty } from "../lib/format";
import { useApp } from "../store";
import { ReadOnlyFieldset } from "../lib/editAccess";

type Kpis = DashboardData["kpis"];

const NEW_DEST = "__new__";

function copyMonthsFrom(source: number[], startMonth: number, endMonth = 11): number[] {
  const dest = Array.from({ length: 12 }, () => 0);
  const from = Math.max(0, Math.min(11, startMonth));
  const to = Math.max(from, Math.min(11, endMonth));
  const first = source.findIndex((value) => value > 0);
  if (first < 0) return dest;
  for (let i = 0; i < 12; i++) {
    const destIndex = from + i;
    const sourceIndex = first + i;
    if (destIndex > to || destIndex >= 12 || sourceIndex >= 12) break;
    dest[destIndex] = source[sourceIndex] ?? 0;
  }
  return dest;
}

function occupiedDestMonths(source: number[], startMonth: number, endMonth = 11): number[] {
  return copyMonthsFrom(source, startMonth, endMonth)
    .map((value, index) => (value > 0 ? index : -1))
    .filter((index) => index >= 0);
}

function monthInputValue(n: number) {
  if (!(n > 0)) return "";
  return String(Math.round(n * 1000) / 1000).replace(".", ",");
}

function copyRangeLabel(months: { label: string }[], startMonth: number, endMonth: number) {
  const from = months[startMonth]?.label.toLowerCase() ?? "";
  const to = months[endMonth]?.label.toLowerCase() ?? from;
  return from === to ? from : `${from} até ${to}`;
}

function inclusiveDays(start: string, end: string) {
  if (!start || !end) return 0;
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  if (Number.isNaN(+from) || Number.isNaN(+to)) return 0;
  const a = from <= to ? from : to;
  const b = from <= to ? to : from;
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function parseQtyInput(raw: string) {
  const n = Number(raw.trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function copiesOf(row?: PremissaSubprocess | null) {
  if (!row) return [];
  if (row.copies?.length) return row.copies;
  const legacy = (row as PremissaSubprocess & { copy?: PremissaSubprocess["copies"][number] | null }).copy;
  return legacy ? [legacy] : [];
}

function fallbackRows(kpis: Kpis): PremissaSubprocess[] {
  return [
    {
      key: "tons",
      name: "Colheita mecanizada",
      suffix: "t",
      builtin: true,
      qty: { row: 8, col: 3, value: kpis.moagem },
      start: { row: 4, col: 4, value: kpis.inicioColheita },
      end: { row: 4, col: 5, value: kpis.fimColheita },
      months: kpis.months.map((m) => m.tons),
      copies: [],
    },
    {
      key: "tonsManual",
      name: "Colheita manual",
      suffix: "t",
      builtin: true,
      qty: { row: 15, col: 3, value: kpis.moagemManual },
      start: { row: 13, col: 4, value: kpis.inicioManual },
      end: { row: 13, col: 5, value: kpis.fimManual },
      months: kpis.months.map((m) => m.tonsManual),
      copies: [],
    },
    {
      key: "haVerao",
      name: "Plantio de verão",
      suffix: "ha",
      builtin: true,
      qty: { row: 25, col: 2, value: kpis.areaVerao },
      start: { row: 27, col: 4, value: kpis.inicioVerao },
      end: { row: 28, col: 4, value: kpis.fimVerao },
      months: kpis.months.map((m) => m.haVerao),
      copies: [],
    },
    {
      key: "haInverno",
      name: "Plantio de inverno",
      suffix: "ha",
      builtin: true,
      qty: { row: 32, col: 2, value: kpis.areaInverno },
      start: { row: 34, col: 4, value: kpis.inicioInverno },
      end: { row: 35, col: 4, value: kpis.fimInverno },
      months: kpis.months.map((m) => m.haInverno),
      copies: [],
    },
    {
      key: "haPlanta",
      name: "Tratos cana planta",
      suffix: "ha",
      builtin: true,
      qty: { row: 40, col: 2, value: kpis.areaPlanta },
      start: { row: 42, col: 4, value: kpis.inicioPlanta },
      end: { row: 42, col: 5, value: kpis.fimPlanta },
      months: kpis.months.map((m) => m.haPlanta),
      copies: [],
    },
    {
      key: "haSoca",
      name: "Tratos cana soca",
      suffix: "ha",
      builtin: true,
      qty: { row: 45, col: 2, value: kpis.areaSoca },
      start: { row: 48, col: 4, value: kpis.inicioSoca },
      end: { row: 48, col: 5, value: kpis.fimSoca },
      months: kpis.months.map((m) => m.haSoca),
      copies: [],
    },
  ];
}

export function Premissas() {
  const { safraId, safra } = useApp();
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [destKey, setDestKey] = useState(NEW_DEST);
  const [destName, setDestName] = useState("");
  const [sourceScope, setSourceScope] = useState<"current" | "previous">("current");
  const [sourceKey, setSourceKey] = useState("haVerao");
  const [startMonth, setStartMonth] = useState(1);
  const [endMonth, setEndMonth] = useState(11);
  const [editingKeys, setEditingKeys] = useState<string[]>([]);
  const [prodName, setProdName] = useState("Produção própria");
  const [prodSuffix, setProdSuffix] = useState<"t" | "ha">("t");
  const [prodQty, setProdQty] = useState("");
  const [prodStart, setProdStart] = useState("");
  const [prodEnd, setProdEnd] = useState("");
  const [newSubName, setNewSubName] = useState("");
  const [newSubSuffix, setNewSubSuffix] = useState<"ha" | "t">("ha");
  const [newSubQty, setNewSubQty] = useState("");
  const [newSubStart, setNewSubStart] = useState("");
  const [newSubEnd, setNewSubEnd] = useState("");

  useEffect(() => {
    setKpis(null);
    setErr(null);
    void api.premissas().then(setKpis);
  }, [safraId]);

  const rows = useMemo(
    () => (kpis?.subprocesses?.length ? kpis.subprocesses : kpis ? fallbackRows(kpis) : []),
    [kpis],
  );
  const subprocessRows = useMemo(
    () => rows.filter((row) => row.kind !== "producao_propria"),
    [rows],
  );
  const productionRows = useMemo(
    () => rows.filter((row) => row.kind === "producao_propria"),
    [rows],
  );
  const sourceRows = useMemo(() => {
    if (!kpis) return [];
    if (sourceScope === "previous") return (kpis.previousSubprocesses ?? []).filter((row) => row.kind !== "producao_propria");
    return subprocessRows.map((row) => ({ key: row.key, name: row.name, suffix: row.suffix, months: row.months }));
  }, [kpis, subprocessRows, sourceScope]);

  const source = sourceRows.find((row) => row.key === sourceKey) ?? sourceRows[0];
  const destRow = destKey === NEW_DEST ? null : rows.find((row) => row.key === destKey) ?? null;
  const occupiedKey = copiesOf(destRow)
    .flatMap((copy) => copy.occupied ?? [])
    .sort((a, b) => a - b)
    .join(",");
  const occupied = useMemo(
    () => new Set(occupiedKey ? occupiedKey.split(",").map(Number) : []),
    [occupiedKey],
  );
  const incomingOccupied = source ? occupiedDestMonths(source.months, startMonth, endMonth) : [];
  const clashMonths = incomingOccupied.filter((month) => occupied.has(month));

  useEffect(() => {
    if (!sourceRows.length) return;
    if (!sourceRows.some((row) => row.key === sourceKey)) {
      setSourceKey(sourceRows[0].key);
    }
  }, [sourceKey, sourceRows]);

  useEffect(() => {
    if (!source) return;
    const taken = new Set(occupiedKey ? occupiedKey.split(",").map(Number) : []);
    if (endMonth < startMonth) {
      setEndMonth(startMonth);
      return;
    }
    if (!occupiedDestMonths(source.months, startMonth, endMonth).some((month) => taken.has(month))) return;
    const nextStart = [...Array(12).keys()].find((month) => !taken.has(month));
    if (nextStart != null && nextStart !== startMonth) setStartMonth(nextStart);
  }, [destKey, source, startMonth, endMonth, occupiedKey]);
  const preview = source ? copyMonthsFrom(source.months, startMonth, endMonth) : [];
  const previewPairs = useMemo(() => {
    if (!kpis || !source) return [];
    const first = source.months.findIndex((value) => value > 0);
    if (first < 0) return [];
    const pairs: { from: string; to: string; value: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const destIndex = startMonth + i;
      const sourceIndex = first + i;
      if (destIndex > endMonth || destIndex >= 12 || sourceIndex >= 12) break;
      const value = source.months[sourceIndex] ?? 0;
      if (!(value > 0)) continue;
      pairs.push({
        from: kpis.months[sourceIndex]?.label ?? "",
        to: kpis.months[destIndex]?.label ?? "",
        value,
      });
      if (pairs.length >= 4) break;
    }
    return pairs;
  }, [kpis, source, startMonth, endMonth]);

  if (!kpis) return <div className="page"><p>Carregando premissas…</p></div>;

  const toggleEditMonths = (key: string) => {
    setEditingKeys((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  };

  const saveMonth = async (key: string, month: number, value: string) => {
    setBusy(true);
    setErr(null);
    try {
      setKpis(await api.setPremissaMonth(key, month, value || "0"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível gravar o mês.");
    } finally {
      setBusy(false);
    }
  };

  const save = async (row: number, col: number, value: string) => {
    if (!value) return;
    setBusy(true);
    setErr(null);
    try {
      setKpis(await api.setPremissa(row, col, value));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };

  const removeCopy = async (id: number, label: string) => {
    if (!confirm(`Retirar a cópia de ${label}?`)) return;
    setBusy(true);
    setErr(null);
    try {
      const next = await api.deletePremissaCopy(id);
      setKpis(next);
      if (destKey !== NEW_DEST && !(next.subprocesses ?? []).some((row) => row.key === destKey)) {
        setDestKey(NEW_DEST);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível retirar a cópia.");
    } finally {
      setBusy(false);
    }
  };

  const applyCopy = async () => {
    setBusy(true);
    setErr(null);
    try {
      const next = await api.copyPremissa({
        destKey: destKey === NEW_DEST ? undefined : destKey,
        destName: destKey === NEW_DEST ? destName : undefined,
        destSuffix: destKey === NEW_DEST ? "ha" : undefined,
        sourceKey: source?.key ?? sourceKey,
        sourceScope,
        startMonth,
        endMonth,
      });
      const createdName = destName.trim();
      const previousKeys = new Set(rows.map((row) => row.key));
      setKpis(next);
      if (destKey === NEW_DEST) {
        const created = (next.subprocesses ?? []).find(
          (row) =>
            row.kind !== "producao_propria" &&
            !previousKeys.has(row.key) &&
            row.name === createdName,
        )
          ?? (next.subprocesses ?? []).find(
            (row) => row.kind !== "producao_propria" && !previousKeys.has(row.key),
          );
        if (created) setDestKey(created.key);
        setDestName("");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível gerar a cópia.");
    } finally {
      setBusy(false);
    }
  };

  const addSubprocess = async () => {
    setBusy(true);
    setErr(null);
    try {
      const previousKeys = new Set(rows.map((row) => row.key));
      const hasPeriod = Boolean(newSubQty.trim() && newSubStart && newSubEnd);
      const next = await api.addPremissaItem({
        name: newSubName.trim(),
        suffix: newSubSuffix,
        kind: "subprocess",
        qty: newSubQty.trim() || undefined,
        startDay: newSubStart || undefined,
        endDay: newSubEnd || undefined,
      });
      setKpis(next);
      const created = (next.subprocesses ?? []).find(
        (row) => row.kind !== "producao_propria" && !previousKeys.has(row.key),
      );
      if (created) {
        if (!hasPeriod) {
          setEditingKeys((current) => (current.includes(created.key) ? current : [...current, created.key]));
        }
        setDestKey(created.key);
      }
      setNewSubName("");
      setNewSubQty("");
      setNewSubStart("");
      setNewSubEnd("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível incluir o subprocesso.");
    } finally {
      setBusy(false);
    }
  };

  const saveCustomSubprocess = async (
    key: string,
    body: { qty?: number | string; startDay?: string | null; endDay?: string | null },
  ) => {
    setBusy(true);
    setErr(null);
    try {
      setKpis(await api.savePremissaSubprocess(key, body));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível gravar o subprocesso.");
    } finally {
      setBusy(false);
    }
  };

  const removeSubprocess = async (row: PremissaSubprocess) => {
    if (row.builtin) return;
    if (!confirm(`Excluir o subprocesso “${row.name}” das premissas?`)) return;
    setBusy(true);
    setErr(null);
    try {
      const next = await api.deletePremissaItem(row.key);
      setKpis(next);
      setEditingKeys((current) => current.filter((key) => key !== row.key));
      if (destKey === row.key) setDestKey(NEW_DEST);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível excluir o subprocesso.");
    } finally {
      setBusy(false);
    }
  };

  const addProduction = async () => {
    setBusy(true);
    setErr(null);
    try {
      const previousKeys = new Set(rows.map((row) => row.key));
      const hasFormula = Boolean(prodQty.trim() && prodStart && prodEnd);
      const next = await api.addPremissaItem({
        name: prodName.trim() || "Produção própria",
        suffix: prodSuffix,
        kind: "producao_propria",
        qtyPerDay: prodQty.trim() || undefined,
        startDay: prodStart || undefined,
        endDay: prodEnd || undefined,
      });
      setKpis(next);
      const created = (next.subprocesses ?? []).find(
        (row) => row.kind === "producao_propria" && !previousKeys.has(row.key),
      );
      if (created && !hasFormula) {
        setEditingKeys((current) => (current.includes(created.key) ? current : [...current, created.key]));
      }
      setProdName("");
      setProdQty("");
      setProdStart("");
      setProdEnd("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível incluir a produção própria.");
    } finally {
      setBusy(false);
    }
  };

  const saveProduction = async (
    key: string,
    body: { qtyPerDay?: number | string; startDay?: string | null; endDay?: string | null },
  ) => {
    setBusy(true);
    setErr(null);
    try {
      setKpis(await api.savePremissaProduction(key, body));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível gravar a produção própria.");
    } finally {
      setBusy(false);
    }
  };

  const removeProduction = async (row: PremissaSubprocess) => {
    if (!confirm(`Excluir ${row.name} das premissas?`)) return;
    setBusy(true);
    setErr(null);
    try {
      setKpis(await api.deletePremissaItem(row.key));
      setEditingKeys((current) => current.filter((key) => key !== row.key));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível excluir o item.");
    } finally {
      setBusy(false);
    }
  };

  const safraMin = `${kpis.months[0]?.year ?? ""}-09-01`;
  const safraMax = `${kpis.months[11]?.year ?? ""}-08-31`;
  const prodDays = inclusiveDays(prodStart, prodEnd);
  const prodRate = parseQtyInput(prodQty);

  return (
    <div className="page">
      <p className="lead">
        Cada subprocesso reparte a quantidade pelos meses com (quantidade / dias totais) × dias do
        mês. Na {safra?.label ?? "safra"} o calendário vai de setembro de {kpis.months[0]?.year} a
        agosto de {kpis.months[11]?.year}. Você pode incluir um novo subprocesso nesta safra e, em
        cada um, usar <strong>Editar meses</strong> para digitar os valores. Se os meses foram
        digitados, a data pode mudar sem recalcular a linha. Você pode copiar vários subprocessos
        para o mesmo destino — desta safra ou da anterior — escolhendo de que mês até que mês, sem
        repetir mês. A produção própria fica à parte: informe a quantidade por dia e o período; o
        sistema multiplica pelos dias de cada mês e usa essa premissa no cálculo automático.
      </p>

      <ReadOnlyFieldset>

      <section className="panel">
        <h3>Cópia automática</h3>
        <div className="form-grid copy-grid">
          <label>
            Copiar para
            <select
              value={destKey}
              onChange={(e) => setDestKey(e.target.value)}
              disabled={busy}
            >
              <option value={NEW_DEST}>Novo subprocesso</option>
              {subprocessRows.map((row) => (
                <option key={row.key} value={row.key}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          {destKey === NEW_DEST ? (
            <label>
              Nome do subprocesso
              <input
                value={destName}
                onChange={(e) => setDestName(e.target.value)}
                placeholder="Ex.: Preparo de solo"
                disabled={busy}
              />
            </label>
          ) : (
            <label>
              Destino
              <input value={subprocessRows.find((row) => row.key === destKey)?.name ?? ""} disabled />
            </label>
          )}
          <label>
            Origem
            <select
              value={sourceScope}
              onChange={(e) => {
                const next = e.target.value === "previous" ? "previous" : "current";
                setSourceScope(next);
              }}
              disabled={busy || !kpis.previousSafra}
            >
              <option value="current">Safra atual</option>
              {kpis.previousSafra ? (
                <option value="previous">{kpis.previousSafra.label}</option>
              ) : null}
            </select>
          </label>
          <label>
            Subprocesso de origem
            <select
              value={source?.key ?? ""}
              onChange={(e) => setSourceKey(e.target.value)}
              disabled={busy}
            >
              {sourceRows
                .filter((row) => !(sourceScope === "current" && row.key === destKey))
                .map((row) => (
                <option key={row.key} value={row.key}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            A partir do mês
            <select
              value={startMonth}
              onChange={(e) => {
                const next = Number(e.target.value);
                setStartMonth(next);
                if (endMonth < next) setEndMonth(next);
              }}
              disabled={busy}
            >
              {kpis.months.map((month, i) => (
                <option key={`${month.label}-${month.year}-from`} value={i} disabled={occupied.has(i)}>
                  {month.label}{occupied.has(i) ? " (ocupado)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Até o mês
            <select
              value={Math.max(startMonth, endMonth)}
              onChange={(e) => setEndMonth(Number(e.target.value))}
              disabled={busy}
            >
              {kpis.months.map((month, i) => {
                if (i < startMonth) return null;
                const blocked = occupiedDestMonths(source?.months ?? [], startMonth, i).some((index) => occupied.has(index));
                return (
                  <option key={`${month.label}-${month.year}-to`} value={i} disabled={blocked}>
                    {month.label}{blocked ? " (ocupado)" : ""}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        {clashMonths.length ? (
          <p className="copy-preview muted">
            Não dá para repetir {clashMonths.map((month) => kpis.months[month]?.label).join(", ")}. Esses
            meses já receberam outra cópia neste destino.
          </p>
        ) : previewPairs.length ? (
          <p className="copy-preview">
            {previewPairs.map((pair) => `${pair.from} ${formatQty(pair.value)} → ${pair.to}`).join(" · ")}
          </p>
        ) : (
          <p className="copy-preview muted">
            {sourceScope === "previous" && !(source?.months.some((value) => value > 0))
              ? "A safra anterior ainda não tem valores gravados neste subprocesso."
              : occupied.size === 12
                ? "Todos os meses deste destino já estão ocupados."
                : "O subprocesso de origem ainda não tem valores mensais para copiar."}
          </p>
        )}
        {err ? <p className="lead" style={{ padding: "0 16px", color: "var(--danger)" }}>{err}</p> : null}
        {copiesOf(destRow).length ? (
          <div className="copy-list">
            {copiesOf(destRow).map((copy) => (
              <div className="copy-list-item" key={copy.id}>
                <span>
                  {copy.sourceName} ({copy.sourceSafraLabel}) de{" "}
                  {copyRangeLabel(kpis.months, copy.startMonth, copy.endMonth ?? copy.startMonth)}
                </span>
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() => void removeCopy(copy.id, copy.sourceName)}
                >
                  Retirar
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="modal-actions" style={{ padding: "0 16px 16px", justifyContent: "flex-start" }}>
          <button
            className="btn primary"
            disabled={busy || Boolean(clashMonths.length) || (destKey === NEW_DEST && !destName.trim())}
            onClick={() => void applyCopy()}
          >
            {busy ? "Gerando…" : copiesOf(destRow).length ? "Adicionar cópia" : "Gerar cópia automática"}
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>Novo subprocesso</h3>
        <p className="lead" style={{ margin: "0 16px 8px", padding: 0 }}>
          Inclua um subprocesso na safra atual com a quantidade total e o período. O sistema reparte
          pelos meses como nos demais. Sem período, use <strong>Editar meses</strong> para digitar
          os valores, ou a cópia automática.
        </p>
        <div className="form-grid copy-grid">
          <label>
            Nome
            <input
              value={newSubName}
              onChange={(e) => setNewSubName(e.target.value)}
              placeholder="Ex.: Preparo de solo"
              disabled={busy}
            />
          </label>
          <label>
            Unidade
            <select
              value={newSubSuffix}
              onChange={(e) => setNewSubSuffix(e.target.value === "t" ? "t" : "ha")}
              disabled={busy}
            >
              <option value="ha">ha</option>
              <option value="t">t</option>
            </select>
          </label>
          <label>
            Quantidade total
            <input
              value={newSubQty}
              onChange={(e) => setNewSubQty(e.target.value)}
              placeholder="Ex.: 1200"
              inputMode="decimal"
              disabled={busy}
            />
          </label>
          <label>
            Início
            <input
              type="date"
              value={newSubStart}
              min={safraMin}
              max={safraMax}
              onChange={(e) => setNewSubStart(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Fim
            <input
              type="date"
              value={newSubEnd}
              min={newSubStart || safraMin}
              max={safraMax}
              onChange={(e) => setNewSubEnd(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>
        {err ? <p className="lead" style={{ padding: "0 16px", color: "var(--danger)" }}>{err}</p> : null}
        <div className="modal-actions" style={{ padding: "0 16px 16px", justifyContent: "flex-start" }}>
          <button
            className="btn primary"
            type="button"
            disabled={busy || !newSubName.trim()}
            onClick={() => void addSubprocess()}
          >
            {busy ? "Incluindo…" : "Incluir subprocesso"}
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>Subprocessos</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="left">Subprocessos</th>
                <th>Quantidade</th>
                <th>Início</th>
                <th>Fim</th>
                {kpis.months.map((m) => (
                  <th key={`${m.label}-${m.year}`}>
                    {m.label.slice(0, 3)}
                    <small className="month-year">{m.year}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subprocessRows.map((row) => {
                const rowCopies = copiesOf(row);
                const copied = rowCopies.length > 0;
                const editing = editingKeys.includes(row.key);
                const mergedPreview = [...row.months];
                if (destKey === row.key && !clashMonths.length) {
                  preview.forEach((value, i) => {
                    if (value > 0) mergedPreview[i] = value;
                  });
                }
                const monthValues =
                  !editing && destKey === row.key && preview.some((value) => value > 0) ? mergedPreview : row.months;
                return (
                  <tr key={row.key} className={copied ? "copied-row" : undefined}>
                    <td className="left">
                      <div className="premise-row-head">
                        <span>{row.name}</span>
                        <button
                          type="button"
                          className={`btn ${editing ? "primary" : ""}`}
                          disabled={busy}
                          onClick={() => toggleEditMonths(row.key)}
                        >
                          {editing ? "Bloquear edição" : "Editar meses"}
                        </button>
                        {!row.builtin ? (
                          <button
                            type="button"
                            className="btn"
                            disabled={busy}
                            onClick={() => void removeSubprocess(row)}
                          >
                            Excluir
                          </button>
                        ) : null}
                      </div>
                      {row.manualMonths ? <small className="copy-note">Meses digitados</small> : null}
                      {rowCopies.length ? (
                        <span className="copy-notes">
                          {rowCopies.map((copy) => (
                            <small className="copy-note" key={copy.id}>
                              Cópia de {copy.sourceName} ({copy.sourceSafraLabel}) de{" "}
                              {copyRangeLabel(kpis.months, copy.startMonth, copy.endMonth ?? copy.startMonth)}
                              <button
                                className="btn"
                                type="button"
                                disabled={busy}
                                onClick={() => void removeCopy(copy.id, copy.sourceName)}
                              >
                                Retirar
                              </button>
                            </small>
                          ))}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {row.qty && !copied && !row.manualMonths ? (
                        <span className="qty-cell">
                          <input
                            className="cell"
                            type="number"
                            step="any"
                            disabled={busy}
                            key={`${row.key}-q-${row.qty.value}`}
                            defaultValue={row.qty.value || ""}
                            onBlur={(e) => {
                              if (row.builtin) {
                                void save(row.qty!.row, row.qty!.col, e.target.value || "0");
                                return;
                              }
                              void saveCustomSubprocess(row.key, { qty: e.target.value || "0" });
                            }}
                          />
                          <small>{row.suffix}</small>
                        </span>
                      ) : (
                        <span className="qty-cell">
                          {row.months.some((value) => value > 0) ? formatQty(row.months.reduce((a, b) => a + b, 0)) : "—"}
                          <small>{row.suffix}</small>
                        </span>
                      )}
                    </td>
                    <td>
                      {(row.start && row.builtin) || (!row.builtin && row.start && !copied && !row.manualMonths) ? (
                        <input
                          className="cell date"
                          type="date"
                          disabled={busy}
                          key={`${row.key}-i-${row.start?.value ?? ""}`}
                          defaultValue={row.start?.value ?? ""}
                          min={safraMin}
                          max={safraMax}
                          onChange={(e) => {
                            if (!e.target.value) return;
                            if (row.builtin) {
                              void save(row.start!.row, row.start!.col, e.target.value);
                              return;
                            }
                            void saveCustomSubprocess(row.key, { startDay: e.target.value });
                          }}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {(row.end && row.builtin) || (!row.builtin && row.end && !copied && !row.manualMonths) ? (
                        <input
                          className="cell date"
                          type="date"
                          disabled={busy}
                          key={`${row.key}-f-${row.end?.value ?? ""}`}
                          defaultValue={row.end?.value ?? ""}
                          min={row.start?.value || safraMin}
                          max={safraMax}
                          onChange={(e) => {
                            if (!e.target.value) return;
                            if (row.builtin) {
                              void save(row.end!.row, row.end!.col, e.target.value);
                              return;
                            }
                            void saveCustomSubprocess(row.key, { endDay: e.target.value });
                          }}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    {monthValues.map((value, i) => (
                      <td key={`${row.key}-${kpis.months[i].label}`}>
                        {editing ? (
                          <input
                            className="cell month"
                            inputMode="decimal"
                            disabled={busy}
                            key={`${row.key}-${i}-${value}`}
                            defaultValue={monthInputValue(value)}
                            onBlur={(e) => {
                              const next = e.target.value.trim();
                              const current = monthInputValue(value);
                              if (next === current || (next === "" && !value)) return;
                              void saveMonth(row.key, i, next);
                            }}
                          />
                        ) : value ? (
                          formatQty(value)
                        ) : (
                          "—"
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h3>Produção própria</h3>
        <p className="lead" style={{ margin: "0 16px 8px", padding: 0 }}>
          Não entra na cópia de subprocesso. A quantidade de cada mês é (quantidade/dia) × dias do
          período naquele mês. Use o item como premissa no cálculo automático, inclusive no modo por
          tonelada (horas).
        </p>
        <div className="form-grid copy-grid">
          <label>
            Nome
            <input
              value={prodName}
              onChange={(e) => setProdName(e.target.value)}
              placeholder="Produção própria"
              disabled={busy}
            />
          </label>
          <label>
            Unidade
            <select
              value={prodSuffix}
              onChange={(e) => setProdSuffix(e.target.value === "ha" ? "ha" : "t")}
              disabled={busy}
            >
              <option value="t">t</option>
              <option value="ha">ha</option>
            </select>
          </label>
          <label>
            Quantidade/dia
            <input
              value={prodQty}
              onChange={(e) => setProdQty(e.target.value)}
              inputMode="decimal"
              placeholder="Ex.: 120"
              disabled={busy}
            />
          </label>
          <label>
            Início
            <input
              type="date"
              value={prodStart}
              min={safraMin}
              max={safraMax}
              onChange={(e) => setProdStart(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Fim
            <input
              type="date"
              value={prodEnd}
              min={prodStart || safraMin}
              max={safraMax}
              onChange={(e) => setProdEnd(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>
        {prodDays > 0 && prodRate > 0 ? (
          <p className="copy-preview">
            {prodDays} dias × {formatQty(prodRate)} {prodSuffix}/dia = {formatQty(prodDays * prodRate)} {prodSuffix}
          </p>
        ) : (
          <p className="copy-preview muted">
            Informe quantidade por dia e o período para preencher os meses automaticamente.
          </p>
        )}
        {err ? <p className="lead" style={{ padding: "0 16px", color: "var(--danger)" }}>{err}</p> : null}
        <div className="modal-actions" style={{ padding: "0 16px 16px", justifyContent: "flex-start" }}>
          <button className="btn primary" type="button" disabled={busy} onClick={() => void addProduction()}>
            {busy ? "Incluindo…" : "Incluir item"}
          </button>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="left">Item</th>
                <th>Qtd/dia</th>
                <th>Início</th>
                <th>Fim</th>
                {kpis.months.map((m) => (
                  <th key={`prod-${m.label}-${m.year}`}>
                    {m.label.slice(0, 3)}
                    <small className="month-year">{m.year}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {productionRows.map((row) => {
                const editing = editingKeys.includes(row.key);
                const total = row.months.reduce((a, b) => a + b, 0);
                return (
                  <tr key={row.key}>
                    <td className="left">
                      <div className="premise-row-head">
                        <span>{row.name}</span>
                        <button
                          type="button"
                          className={`btn ${editing ? "primary" : ""}`}
                          disabled={busy}
                          onClick={() => toggleEditMonths(row.key)}
                        >
                          {editing ? "Bloquear edição" : "Editar meses"}
                        </button>
                        <button type="button" className="btn" disabled={busy} onClick={() => void removeProduction(row)}>
                          Excluir
                        </button>
                      </div>
                      {total > 0 ? (
                        <small className="copy-note">
                          Total {formatQty(total)} {row.suffix}
                        </small>
                      ) : null}
                      {row.manualMonths ? (
                        <small className="copy-note">
                          Meses digitados — alterar qtd/dia ou o período recalcula a linha
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <span className="qty-cell">
                        <input
                          className="cell"
                          inputMode="decimal"
                          disabled={busy}
                          key={`${row.key}-q-${row.qty?.value ?? 0}`}
                          defaultValue={row.qty?.value ? monthInputValue(row.qty.value) : ""}
                          onBlur={(e) => {
                            const next = e.target.value.trim();
                            const current = row.qty?.value ? monthInputValue(row.qty.value) : "";
                            if (next === current) return;
                            void saveProduction(row.key, { qtyPerDay: next || "0" });
                          }}
                        />
                        <small>{row.suffix}/dia</small>
                      </span>
                    </td>
                    <td>
                      <input
                        className="cell date"
                        type="date"
                        disabled={busy}
                        min={safraMin}
                        max={safraMax}
                        key={`${row.key}-i-${row.start?.value ?? ""}`}
                        defaultValue={row.start?.value ?? ""}
                        onChange={(e) => {
                          void saveProduction(row.key, { startDay: e.target.value || null });
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="cell date"
                        type="date"
                        disabled={busy}
                        min={row.start?.value || safraMin}
                        max={safraMax}
                        key={`${row.key}-f-${row.end?.value ?? ""}`}
                        defaultValue={row.end?.value ?? ""}
                        onChange={(e) => {
                          void saveProduction(row.key, { endDay: e.target.value || null });
                        }}
                      />
                    </td>
                    {row.months.map((value, i) => (
                      <td key={`${row.key}-${kpis.months[i].label}`}>
                        {editing ? (
                          <input
                            className="cell month"
                            inputMode="decimal"
                            disabled={busy}
                            key={`${row.key}-${i}-${value}`}
                            defaultValue={monthInputValue(value)}
                            onBlur={(e) => {
                              const next = e.target.value.trim();
                              const current = monthInputValue(value);
                              if (next === current || (next === "" && !value)) return;
                              void saveMonth(row.key, i, next);
                            }}
                          />
                        ) : value ? (
                          formatQty(value)
                        ) : (
                          "—"
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {!productionRows.length ? (
                <tr>
                  <td className="left" colSpan={16}>
                    Nenhum item de produção própria ainda.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      </ReadOnlyFieldset>
    </div>
  );
}
