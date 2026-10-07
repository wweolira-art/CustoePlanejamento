import { useEffect, useMemo, useState } from "react";
import {
  api,
  type Activity,
  type ActivityLinkSource,
  type ActivityLinksData,
  type ActivityRealizadoLink,
  type ActivitySourceOptionsData,
} from "../api";
import { formatBRL } from "../lib/format";
import { costPlanningTab, useApp } from "../store";
import { ReadOnlyFieldset } from "../lib/editAccess";

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const EMPTY: ActivityLinksData = { safraId: 0, sources: [], links: [] };

export function ActivityLinks() {
  const { go } = useApp();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [data, setData] = useState<ActivityLinksData>(EMPTY);
  const [activityQuery, setActivityQuery] = useState("");
  const [activityId, setActivityId] = useState<number | null>(null);
  const [source, setSource] = useState<ActivityRealizadoLink["source"]>("contrato_variavel");
  const [matchBy, setMatchBy] = useState<"cod_empenho" | "numerocontrato">("cod_empenho");
  const [sourceCode, setSourceCode] = useState("");
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [options, setOptions] = useState<ActivitySourceOptionsData | null>(null);
  const [loadingCodes, setLoadingCodes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectedActivity = activities.find((row) => row.id === activityId) ?? null;
  const sourceMeta = data.sources.find((row) => row.id === source);
  const implemented = sourceMeta?.implemented ?? false;

  const load = () =>
    api
      .activityLinks()
      .then((next) => {
        setData(next);
        if (!source && next.sources[0]) setSource(next.sources[0].id);
      })
      .catch((e: Error) => setErr(e.message));

  useEffect(() => {
    void api.activities().then(setActivities);
  }, []);

  useEffect(() => {
    setErr(null);
    void load();
  }, []);

  useEffect(() => {
    if (!implemented) {
      setOptions(null);
      return;
    }
    let cancelled = false;
    setLoadingCodes(true);
    setErr(null);
    void api
      .activitySourceOptions(source, undefined, source === "contrato_fixo" ? matchBy : undefined)
      .then((next) => {
        if (!cancelled) setOptions(next);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setOptions(null);
          setErr(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCodes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, matchBy, implemented]);

  const activityHits = useMemo(() => {
    const raw = fold(activityQuery.trim());
    const tokens = raw.split(/\s+/).filter(Boolean);
    return activities
      .filter((row) => {
        if (!tokens.length) return true;
        const hay = fold(`${row.code} ${row.description}`);
        return tokens.every((token) => hay.includes(token));
      })
      .slice(0, 12);
  }, [activities, activityQuery]);

  const codeHits = useMemo(() => {
    const tokens = fold(sourceCode.trim()).split(/\s+/).filter(Boolean);
    const items = options?.items ?? [];
    if (!tokens.length) return items;
    return items.filter((row) => {
      const hay = fold(`${row.code} ${row.label}`);
      return tokens.every((token) => hay.includes(token));
    });
  }, [options, sourceCode]);

  const selectedSet = new Set(selectedCodes);
  const selectedItems = (options?.items ?? []).filter((row) => selectedSet.has(row.code));
  const selectedTotal = selectedItems.reduce((sum, row) => sum + row.total, 0);
  const optionLabel = (code: string) => {
    const item = (options?.items ?? []).find((row) => row.code === code);
    if (item && item.label !== item.code) return `${code} — ${item.label}`;
    return code;
  };

  const toggleCode = (code: string) => {
    setSelectedCodes((current) =>
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code],
    );
  };

  const addTypedCode = () => {
    const typed = sourceCode.trim();
    if (!typed) return;
    const items = options?.items ?? [];
    const exact = items.find((row) => fold(row.code) === fold(typed));
    const uniqueHit = !exact && codeHits.length === 1 ? codeHits[0] : null;
    const match = exact ?? uniqueHit;
    const code = match?.code ?? (source === "insumo" || source === "contrato_fixo" ? typed : "");
    if (!code) return;
    if (!selectedCodes.includes(code)) setSelectedCodes((current) => [...current, code]);
    setSourceCode("");
  };

  const pickActivity = (row: Activity) => {
    setActivityId(row.id);
    setActivityQuery(`${row.code} — ${row.description}`);
  };

  return (
    <div className="page">
      <p className="lead">
        Diga qual atividade do orçamento recebe o realizado e de onde buscar no Oracle: contrato
        variável (código de serviço), contrato fixo (empenho ou número do contrato) ou insumo
        (código da operação). Dá para marcar vários códigos na mesma associação. A ligação vale
        para todas as safras; o realizado consultado no Oracle continua no período da safra
        selecionada. Depois confira o resultado em Orçado x realizado, agrupado por atividade.
      </p>

      <ReadOnlyFieldset>

      <section className="panel">
        <h3>Nova associação</h3>
        <div className="form-grid">
          <label className="span-2">
            Qual atividade associar?
            <input
              value={activityQuery}
              onChange={(e) => {
                setActivityQuery(e.target.value);
                setActivityId(null);
              }}
              placeholder="Ex.: 32 ou Transporte de semente"
            />
            <small>
              {selectedActivity
                ? `Selecionada: ${selectedActivity.code} — ${selectedActivity.description}`
                : "Digite o código ou a descrição da atividade cadastrada."}
            </small>
          </label>
        </div>
        {!selectedActivity && activityQuery.trim() ? (
          <div className="table-wrap" style={{ maxHeight: 220, overflow: "auto" }}>
            <table className="data">
              <tbody>
                {activityHits.map((row) => (
                  <tr key={row.id}>
                    <td style={{ width: 80 }}>{row.code}</td>
                    <td className="desc">{row.description}</td>
                    <td>
                      <button className="btn" type="button" onClick={() => pickActivity(row)}>
                        Escolher
                      </button>
                    </td>
                  </tr>
                ))}
                {!activityHits.length ? (
                  <tr>
                    <td className="left" colSpan={3}>
                      Nenhuma atividade encontrada.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="kind-toggle">
          <span className="toggle-caption">De onde buscar os valores?</span>
          {(data.sources.length ? data.sources : fallbackSources()).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`btn ${source === item.id ? "primary" : ""}`}
              onClick={() => {
                setSource(item.id);
                setSourceCode("");
                setSelectedCodes([]);
                if (item.id === "contrato_fixo") setMatchBy("cod_empenho");
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {source === "contrato_fixo" ? (
          <div className="kind-toggle">
            <span className="toggle-caption">Associar os lançamentos por</span>
            <button
              type="button"
              className={`btn ${matchBy === "cod_empenho" ? "primary" : ""}`}
              onClick={() => {
                setMatchBy("cod_empenho");
                setSourceCode("");
                setSelectedCodes([]);
              }}
            >
              Empenho
            </button>
            <button
              type="button"
              className={`btn ${matchBy === "numerocontrato" ? "primary" : ""}`}
              onClick={() => {
                setMatchBy("numerocontrato");
                setSourceCode("");
                setSelectedCodes([]);
              }}
            >
              Número do contrato
            </button>
          </div>
        ) : null}

        <div className="form-grid">
          <label className="span-2">
            {source === "insumo"
              ? "Pesquisar operação (código ou descrição)"
              : source === "contrato_variavel"
                ? "Pesquisar serviço (código ou descrição)"
                : source === "contrato_fixo"
                  ? matchBy === "numerocontrato"
                    ? "Pesquisar número do contrato"
                    : "Pesquisar empenho (código ou descrição)"
                  : sourceMeta?.codeLabel ?? "Código"}
            <input
              value={sourceCode}
              onChange={(e) => setSourceCode(e.target.value)}
              disabled={!implemented}
              placeholder={
                source === "insumo"
                  ? "Ex.: 120 ou Plantio de cana"
                  : source === "contrato_variavel"
                    ? "Ex.: 159 ou Transporte de cana"
                    : source === "contrato_fixo"
                      ? matchBy === "numerocontrato"
                        ? "Ex.: número do contrato"
                        : "Ex.: código ou descrição do empenho"
                      : "Filtrar ou informar o código de serviço"
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTypedCode();
                }
              }}
            />
            <small>
              {!implemented
                ? "A consulta Oracle desta origem ainda não foi definida."
                : loadingCodes
                  ? "Lendo todos os códigos no Oracle…"
                  : selectedCodes.length
                    ? `${selectedCodes.length} selecionado(s)${selectedItems.length ? `, total ${formatBRL(selectedTotal)}` : ""}. Clique de novo para tirar da seleção.`
                    : sourceCode.trim()
                      ? `${codeHits.length} de ${options?.items.length ?? 0} correspondem à pesquisa.`
                      : source === "insumo"
                        ? `${options?.items.length ?? 0} operação(ões) do cadastro. Inclui códigos sem lançamento de material.`
                        : source === "contrato_variavel"
                          ? `${options?.items.length ?? 0} serviço(s) do contrato variável, com descrição da operação agrícola.`
                          : source === "contrato_fixo"
                            ? matchBy === "numerocontrato"
                              ? `${options?.items.length ?? 0} contrato(s) fixo(s) da safra, agrupados pelo número do contrato.`
                              : `${options?.items.length ?? 0} empenho(s) de contrato fixo da safra. Pesquise pelo código ou pela descrição.`
                          : `${options?.items.length ?? 0} código(s). Marque um ou mais na lista.`}
            </small>
          </label>
        </div>
        {selectedCodes.length ? (
          <div className="kind-toggle">
            <span className="toggle-caption">Selecionados</span>
            {selectedCodes.map((code) => {
              const item = selectedItems.find((row) => row.code === code);
              const label = item && item.label !== item.code ? `${code} — ${item.label}` : code;
              return (
                <button
                  key={code}
                  type="button"
                  className="btn primary"
                  title={label}
                  onClick={() => toggleCode(code)}
                >
                  {label} ✕
                </button>
              );
            })}
          </div>
        ) : null}
        {implemented && !loadingCodes ? (
          <div className="table-wrap" style={{ maxHeight: 360, overflow: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 44 }} />
                  <th>{options?.codeLabel ?? sourceMeta?.codeLabel ?? "Código"}</th>
                  <th>Descrição</th>
                  <th>Lançamentos</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {codeHits.map((row) => {
                  const on = selectedSet.has(row.code);
                  return (
                    <tr key={row.code} onClick={() => toggleCode(row.code)} style={{ cursor: "pointer" }}>
                      <td>
                        <input type="checkbox" checked={on} readOnly />
                      </td>
                      <td>{row.code}</td>
                      <td className="desc">{row.label !== row.code ? row.label : "—"}</td>
                      <td>{row.count}</td>
                      <td>{formatBRL(row.total)}</td>
                    </tr>
                  );
                })}
                {!codeHits.length ? (
                  <tr>
                    <td className="left" colSpan={5}>
                      {sourceCode.trim()
                        ? source === "insumo"
                          ? "Nenhuma operação encontrada com esse código ou descrição."
                          : source === "contrato_fixo"
                            ? matchBy === "numerocontrato"
                              ? "Nenhum contrato encontrado com esse número."
                              : "Nenhum empenho encontrado com esse código ou descrição."
                            : "Nenhum serviço encontrado com esse código ou descrição."
                        : "Nenhum código encontrado no Oracle."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}

        {err ? <p className="lead" style={{ padding: "0 16px", color: "var(--danger)" }}>{err}</p> : null}
        <div className="modal-actions" style={{ padding: "12px 16px 16px" }}>
          <button className="btn" type="button" onClick={() => go(costPlanningTab("orcadoRealizado"))}>
            Ver Orçado x realizado
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={saving || !implemented}
            onClick={async () => {
              if (!activityId) {
                setErr("Escolha a atividade do orçamento.");
                return;
              }
              const codes = selectedCodes.length ? selectedCodes : sourceCode.trim() ? [sourceCode.trim()] : [];
              if (!codes.length) {
                setErr(`Marque pelo menos um ${(sourceMeta?.codeLabel ?? "código").toLowerCase()}.`);
                return;
              }
              setSaving(true);
              setErr(null);
              try {
                setData(
                  await api.addActivityLink({
                    activityId,
                    source,
                    sourceCodes: codes,
                    matchBy: source === "contrato_fixo" ? matchBy : undefined,
                  }),
                );
                setSourceCode("");
                setSelectedCodes([]);
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Não foi possível salvar a associação.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving
              ? "Salvando…"
              : selectedCodes.length > 1
                ? `Associar ${selectedCodes.length} códigos`
                : "Associar"}
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>
          Associações
          <small>{data.links.length}</small>
        </h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Atividade</th>
                <th>Origem</th>
                <th>Código Oracle</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.links.map((row) => (
                <tr key={row.id}>
                  <td className="desc">
                    {row.activityCode} — {row.activityName}
                  </td>
                  <td>{row.sourceLabel}</td>
                  <td className="desc">
                    {row.sourceCodeLabel}:{" "}
                    {row.source === source ? optionLabel(row.sourceCode) : row.sourceCode}
                  </td>
                  <td>
                    <button
                      className="icon-btn"
                      title="Excluir"
                      onClick={async () => {
                        if (!confirm(`Remover a associação de ${row.activityCode} com ${row.sourceCode}?`)) return;
                        try {
                          setData(await api.deleteActivityLink(row.id));
                        } catch (e) {
                          setErr(e instanceof Error ? e.message : "Não foi possível excluir.");
                        }
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {!data.links.length ? (
                <tr>
                  <td className="left" colSpan={4}>
                    Nenhuma associação. Exemplo: atividade 32 (Transporte de semente) com o serviço 159
                    do contrato variável, ou um contrato fixo pelo empenho ou pelo número do contrato.
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

function fallbackSources(): ActivityLinkSource[] {
  return [
    { id: "contrato_variavel", label: "Contrato variável", codeLabel: "Código de serviço", implemented: true },
    { id: "contrato_fixo", label: "Contrato fixo", codeLabel: "Empenho ou nº do contrato", implemented: true },
    { id: "insumo", label: "Insumo", codeLabel: "Código da operação", implemented: true },
    { id: "materiais", label: "Materiais", codeLabel: "Código do material", implemented: false },
  ];
}
