import { useEffect, useMemo, useState } from "react";
import { api, type HarvestArea } from "../api";
import { formatQty } from "../lib/format";
import { useApp } from "../store";

const STORAGE_PREFIX = "pa-arrendamento-calc";

export type ArrendamentoCalcValue = {
  areaId: number | "total";
  tchReducePct: string;
  kgAtr: string;
  precoKgAtr: string;
};

export type ArrendamentoCalcResult = {
  areaHa: number;
  tch: number;
  tchReduced: number;
  tchReducePct: number;
  kgAtr: number;
  precoKgAtr: number;
  total: number;
  monthly: number;
  ready: boolean;
  error: string | null;
};

function storageKey(safraId: number | null | undefined) {
  return `${STORAGE_PREFIX}:${safraId ?? 0}`;
}

function loadStored(safraId: number | null | undefined): ArrendamentoCalcValue {
  try {
    const raw = localStorage.getItem(storageKey(safraId));
    if (!raw) return { areaId: "total", tchReducePct: "20", kgAtr: "", precoKgAtr: "" };
    const parsed = JSON.parse(raw) as Partial<ArrendamentoCalcValue>;
    return {
      areaId: parsed.areaId === "total" || parsed.areaId == null ? "total" : Number(parsed.areaId),
      tchReducePct: typeof parsed.tchReducePct === "string" ? parsed.tchReducePct : "20",
      kgAtr: typeof parsed.kgAtr === "string" ? parsed.kgAtr : "",
      precoKgAtr: typeof parsed.precoKgAtr === "string" ? parsed.precoKgAtr : "",
    };
  } catch {
    return { areaId: "total", tchReducePct: "20", kgAtr: "", precoKgAtr: "" };
  }
}

/** Preço/ATR: vírgula ou ponto como decimal (ex.: 1,181 → 1.181), sem milhar. */
function parseDecimalInput(raw: string) {
  let s = raw.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!s) return NaN;
  // 1.181,00 ou 1.181,123 → remove milhar e usa vírgula decimal
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function formatAtrPrice(n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n || 0);
}

function formatMoney(n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
}

export function isArrendamentoSheet(name: string) {
  return /^ARRENDAMENTOS$/i.test(name.trim());
}

export function emptyArrendamentoCalc(safraId?: number | null): ArrendamentoCalcValue {
  return loadStored(safraId);
}

export function ArrendamentoCalcFields({
  value,
  onChange,
  onResult,
  areaHaFixo,
}: {
  value: ArrendamentoCalcValue;
  onChange: (next: ArrendamentoCalcValue) => void;
  onResult?: (result: ArrendamentoCalcResult) => void;
  /** Quando informado, a área não vem do seletor: usa o hectare dos parâmetros técnicos. */
  areaHaFixo?: number | null;
}) {
  const { safraId } = useApp();
  const [areas, setAreas] = useState<HarvestArea[]>([]);
  const [areasTotal, setAreasTotal] = useState(0);
  const [tch, setTch] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);
    Promise.all([api.harvestAreas(safraId ?? undefined), api.premissas()])
      .then(([areasData, kpis]) => {
        if (cancelled) return;
        setAreas(areasData.areas ?? []);
        setAreasTotal(
          Number(areasData.total) || (areasData.areas ?? []).reduce((s, a) => s + (Number(a.area) || 0), 0),
        );
        setTch(Number(kpis.tch) || 0);
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadErr(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [safraId]);

  useEffect(() => {
    localStorage.setItem(storageKey(safraId), JSON.stringify(value));
  }, [safraId, value]);

  const areaTravada = areaHaFixo !== undefined;
  const areaHa = useMemo(() => {
    if (areaTravada) return areaHaFixo != null && areaHaFixo > 0 ? areaHaFixo : 0;
    if (value.areaId === "total") return areasTotal;
    const row = areas.find((a) => a.id === value.areaId);
    return row ? Number(row.area) || 0 : 0;
  }, [areaTravada, areaHaFixo, value.areaId, areas, areasTotal]);

  const kg = parseDecimalInput(value.kgAtr);
  const preco = parseDecimalInput(value.precoKgAtr);
  const tchValue = tch ?? 0;
  const reduceRaw = value.tchReducePct.trim() === "" ? 0 : parseDecimalInput(value.tchReducePct);
  const reducePct = Number.isFinite(reduceRaw) && reduceRaw >= 0 ? Math.min(reduceRaw, 100) : NaN;
  const tchReduced =
    tchValue > 0 && Number.isFinite(reducePct) ? tchValue * (1 - reducePct / 100) : 0;
  const total =
    areaHa > 0 && tchReduced > 0 && kg > 0 && preco > 0 ? areaHa * tchReduced * kg * preco : 0;
  const monthly = total > 0 ? total / 12 : 0;
  const result = useMemo<ArrendamentoCalcResult>(
    () => ({
      areaHa,
      tch: tchValue,
      tchReduced,
      tchReducePct: Number.isFinite(reducePct) ? reducePct : 0,
      kgAtr: kg > 0 ? kg : 0,
      precoKgAtr: preco > 0 ? preco : 0,
      total,
      monthly,
      ready: total > 0 && !loading && !loadErr && Number.isFinite(reducePct),
      error: loadErr,
    }),
    [areaHa, tchValue, tchReduced, reducePct, kg, preco, total, monthly, loading, loadErr],
  );

  useEffect(() => {
    onResult?.(result);
  }, [result, onResult]);

  return (
    <div>
      <p className="lead" style={{ margin: "0 0 8px", padding: 0 }}>
        {areaTravada
          ? "Área arrendada dos parâmetros técnicos × TCH reduzido × kg ATR × preço do kg de ATR."
          : "Área (cadastro de áreas) × TCH reduzido × kg ATR × preço do kg de ATR. O total é dividido em 12 meses iguais."}
      </p>
      {loading ? <p className="lead" style={{ margin: "0 0 8px", padding: 0 }}>Carregando área e TCH…</p> : null}
      {loadErr ? (
        <p className="lead" style={{ margin: "0 0 8px", padding: 0, color: "var(--danger)" }}>
          {loadErr}
        </p>
      ) : null}
      <div className="form-grid" style={{ padding: "0 0 8px" }}>
        <label>
          Área
          <small>
            {areaTravada
              ? "Mesma área arrendada de Parâmetros técnicos."
              : "Vem do cadastro de áreas da safra."}
          </small>
          {areaTravada ? (
            <input readOnly value={areaHa > 0 ? formatQty(areaHa) : ""} />
          ) : (
            <select
              value={value.areaId === "total" ? "total" : String(value.areaId)}
              onChange={(e) => {
                const v = e.target.value;
                onChange({ ...value, areaId: v === "total" ? "total" : Number(v) });
              }}
              disabled={loading || !areas.length}
            >
              <option value="total">Total cadastrado ({formatQty(areasTotal)} ha)</option>
              {areas.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.description} ({formatQty(row.area)} ha)
                </option>
              ))}
            </select>
          )}
        </label>

        <label>
          TCH extraído
          <small>Mesmo valor da visão geral (Premissas).</small>
          <input readOnly value={tch == null ? "" : formatQty(tch)} />
        </label>

        <label>
          Redução do TCH (%)
          <small>Abate este percentual do TCH extraído no arrendamento.</small>
          <input
            value={value.tchReducePct}
            onChange={(e) => onChange({ ...value, tchReducePct: e.target.value })}
            placeholder="Ex.: 20"
            inputMode="decimal"
          />
        </label>

        <label>
          TCH usado
          <small>
            {Number.isFinite(reducePct) && reducePct > 0
              ? `${formatQty(tchValue)} − ${String(value.tchReducePct).replace(".", ",")}%`
              : "Sem redução"}
          </small>
          <input readOnly value={tchReduced > 0 ? formatQty(tchReduced) : ""} />
        </label>

        <label>
          kg ATR
          <small>Quilos de ATR por tonelada.</small>
          <input
            value={value.kgAtr}
            onChange={(e) => onChange({ ...value, kgAtr: e.target.value })}
            placeholder="Ex.: 140"
            inputMode="decimal"
          />
        </label>

        <label>
          Preço kg ATR (R$)
          <small>Use vírgula decimal, ex.: 1,181</small>
          <input
            value={value.precoKgAtr}
            onChange={(e) => onChange({ ...value, precoKgAtr: e.target.value })}
            placeholder="Ex.: 1,181"
            inputMode="decimal"
          />
        </label>
      </div>

      <div className="formula-box" style={{ margin: "0 0 8px" }}>
        {formatQty(areaHa)} ha × {tchReduced > 0 ? formatQty(tchReduced) : "TCH"} TCH
        {Number.isFinite(reducePct) && reducePct > 0 ? ` (−${String(value.tchReducePct).replace(".", ",")}%)` : ""} ×{" "}
        {kg > 0 ? formatQty(kg) : "kg ATR"} × {preco > 0 ? formatAtrPrice(preco) : "preço/kg"} ={" "}
        {total > 0 ? formatMoney(total) : "—"}
        {monthly > 0 ? ` → ${formatMoney(monthly)} / mês` : ""}
      </div>
    </div>
  );
}
