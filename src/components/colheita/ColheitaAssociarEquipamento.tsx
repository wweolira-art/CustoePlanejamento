import { useEffect, useMemo, useState } from "react";
import {
  api,
  type CaminhaoTerceiroVinculo,
  type ColheitaAtualizarEquipamentoResult,
  type ColheitaVinculoEquipPeriodo,
  type ColheitaVinculoItem,
  type EquipamentoTerceiro,
} from "../../api";
import { ColheitaFiltros, useColheitaPeriod } from "./ColheitaFiltros";
import { cell, formatOrdsDate, formatPeriodoDias } from "./colheita-utils";

type VinculoTipo = "caminhao" | "maquina";

function formatDateTime(value: string) {
  const parsed = new Date(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("pt-BR");
}

function VinculoAssociacoes({
  associacoes,
  terceiros,
  onToggleTerceiro,
  loading,
}: {
  associacoes: ColheitaVinculoEquipPeriodo[];
  terceiros: Set<string>;
  onToggleTerceiro: (cod: string, marcar: boolean) => void;
  loading: boolean;
}) {
  if (!associacoes.length) return <span>—</span>;
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {associacoes.map((a) => {
        const cod = a.codEquipamento != null ? String(a.codEquipamento) : null;
        const marcado = cod != null && terceiros.has(cod);
        return (
          <li key={`${a.codEquipamento ?? "sem"}-${a.dataInicio ?? ""}-${a.dataFim ?? ""}`}>
            <strong>{cod ? `equip. ${cod}` : "sem equip."}</strong>
            {" · "}
            {formatPeriodoDias(a.dataInicio, a.dataFim)}
            {" · "}
            {a.qtdEntradas} entrada(s)
            {cod ? (
              <label className="check-label" style={{ display: "inline-flex", marginLeft: 10 }}>
                <span className="check-row">
                  <input
                    type="checkbox"
                    checked={marcado}
                    disabled={loading}
                    onChange={(e) => onToggleTerceiro(cod, e.target.checked)}
                  />
                  Terceiro
                </span>
              </label>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ColheitaAssociarEquipamento() {
  const { dataInicio, dataFim, setPeriod } = useColheitaPeriod();
  const [tipo, setTipo] = useState<VinculoTipo>("caminhao");
  const [lista, setLista] = useState<ColheitaVinculoItem[]>([]);
  const [equipamentosTerceiro, setEquipamentosTerceiro] = useState<EquipamentoTerceiro[]>([]);
  const [caminhoesTerceiro, setCaminhoesTerceiro] = useState<CaminhaoTerceiroVinculo[]>([]);
  const [filtro, setFiltro] = useState("");
  const [numero, setNumero] = useState("");
  const [codEquipamento, setCodEquipamento] = useState("");
  const [marcarTerceiro, setMarcarTerceiro] = useState(false);
  const [resultado, setResultado] = useState<ColheitaAtualizarEquipamentoResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const terceirosSet = useMemo(
    () => new Set(equipamentosTerceiro.map((item) => item.codEquipamento)),
    [equipamentosTerceiro],
  );
  const caminhoesTerceiroSet = useMemo(
    () => new Set(caminhoesTerceiro.map((item) => item.caminhao)),
    [caminhoesTerceiro],
  );

  const filtrados = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((item) => {
      const key = tipo === "caminhao" ? item.caminhao : item.maquina;
      const cods = (item.associacoes ?? []).map((a) => a.codEquipamento).join(" ");
      return `${key ?? ""} ${item.codEquipamento ?? ""} ${cods}`.toLowerCase().includes(q);
    });
  }, [lista, filtro, tipo]);

  const selecionado = useMemo(
    () =>
      filtrados.find(
        (item) => String(tipo === "caminhao" ? item.caminhao : item.maquina) === numero.trim(),
      ) ?? null,
    [filtrados, numero, tipo],
  );

  const loadTerceiros = async () => {
    const [equipData, camData] = await Promise.all([
      api.colheitaEquipamentoTerceiroList(),
      api.colheitaCaminhaoTerceiroList({ dataInicio, dataFim }),
    ]);
    setEquipamentosTerceiro(equipData.dados);
    setCaminhoesTerceiro(camData.dados);
    return equipData.dados;
  };

  const loadLista = async () => {
    try {
      setLoading(true);
      setErr(null);
      setStatus(null);
      const [data] = await Promise.all([
        tipo === "caminhao"
          ? api.colheitaCaminhoesDistinct({ dataInicio, dataFim })
          : api.colheitaMaquinasDistinct({ dataInicio, dataFim }),
        loadTerceiros(),
      ]);
      setLista(data.dados);
      setStatus(`${data.dados.length} ${tipo === "caminhao" ? "caminhão(ões)" : "máquina(s)"} no período.`);
    } catch (e) {
      setLista([]);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLista();
  }, [tipo]);

  const toggleTerceiro = async (cod: string, marcar: boolean) => {
    try {
      setLoading(true);
      setErr(null);
      if (marcar) await api.colheitaEquipamentoTerceiroSave({ codEquipamento: cod });
      else await api.colheitaEquipamentoTerceiroRemove(cod);
      await loadTerceiros();
      setStatus(`Equipamento ${cod} ${marcar ? "marcado como terceiro" : "removido de terceiro"}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggleCaminhaoTerceiro = async (caminhao: string, marcar: boolean) => {
    if (!dataInicio || !dataFim) {
      setErr("Informe data inicial e final.");
      return;
    }
    try {
      setLoading(true);
      setErr(null);
      if (marcar) {
        await api.colheitaCaminhaoTerceiroSave({
          caminhao,
          nomeTerceiro: caminhao,
          dataInicio,
          dataFim,
        });
      } else {
        const matches = caminhoesTerceiro.filter((item) => item.caminhao === caminhao);
        for (const item of matches) await api.colheitaCaminhaoTerceiroRemove(item.id);
      }
      await loadTerceiros();
      setStatus(`Caminhão ${caminhao} ${marcar ? "marcado como terceiro" : "removido de terceiro"}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const atualizar = async (limpar: boolean) => {
    const num = numero.trim();
    const cod = codEquipamento.trim();
    if (!num) {
      setErr(`Informe o número do ${tipo === "caminhao" ? "caminhão" : "máquina"}.`);
      return;
    }
    if (!dataInicio || !dataFim) {
      setErr("Informe data inicial e final.");
      return;
    }
    if (!limpar && !cod) {
      if (tipo === "caminhao" && marcarTerceiro) {
        await toggleCaminhaoTerceiro(num, true);
        setResultado(null);
        await loadLista();
        return;
      }
      setErr("Informe o cod_equipamento, marque o caminhão como terceiro ou use Limpar.");
      return;
    }

    try {
      setLoading(true);
      setErr(null);
      const body = { dataInicio, dataFim, codEquipamento: limpar ? null : cod, limpar };
      const res =
        tipo === "caminhao"
          ? await api.colheitaAtualizarEquipamentoCaminhao({ ...body, caminhao: num })
          : await api.colheitaAtualizarEquipamentoMaquina({ ...body, maquina: num });
      if (!limpar) {
        if (marcarTerceiro) await api.colheitaEquipamentoTerceiroSave({ codEquipamento: cod });
        else if (terceirosSet.has(cod)) await api.colheitaEquipamentoTerceiroRemove(cod);
      } else if (tipo === "caminhao" && marcarTerceiro) {
        await api.colheitaCaminhaoTerceiroSave({
          caminhao: num,
          nomeTerceiro: num,
          dataInicio,
          dataFim,
        });
      }
      setResultado(res);
      setStatus(`${res.resumo.atualizados} atualizado(s) · ${res.resumo.falhas} falha(s).`);
      await loadLista();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const resetTipo = (next: VinculoTipo) => {
    setTipo(next);
    setLista([]);
    setResultado(null);
    setNumero("");
    setCodEquipamento("");
    setMarcarTerceiro(false);
    setStatus(null);
  };

  const terceiroFiltrados = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return equipamentosTerceiro.filter((item) => !q || item.codEquipamento.toLowerCase().includes(q));
  }, [equipamentosTerceiro, filtro]);

  return (
    <>
      <p className="lead">
        Associe o número da entrada de cana ao <code>cod_equipamento</code> do ERP. Em caminhões de terceiro sem código,
        marque o próprio número do caminhão como terceiro.
      </p>

      <div className="kind-toggle" style={{ marginBottom: 12 }}>
        <button className={`btn ${tipo === "caminhao" ? "primary" : ""}`} onClick={() => resetTipo("caminhao")}>
          Entrada caminhão
        </button>
        <button className={`btn ${tipo === "maquina" ? "primary" : ""}`} onClick={() => resetTipo("maquina")}>
          Entrada máquina
        </button>
      </div>

      <ColheitaFiltros dataInicio={dataInicio} dataFim={dataFim} onChange={setPeriod} loading={loading} onConsultar={() => void loadLista()} />

      {err ? <p className="lead" style={{ color: "var(--danger)" }}>{err}</p> : null}
      {status ? <p className="lead">{status}</p> : null}

      <section className="panel">
        <h3>{tipo === "caminhao" ? "Caminhão" : "Máquina"} e equipamento</h3>
        <div className="form-grid">
          <label>
            {tipo === "caminhao" ? "Número do caminhão na entrada" : "Número da máquina na entrada"}
            <input value={numero} onChange={(e) => setNumero(e.target.value)} />
          </label>
          <label>
            cod_equipamento
            <input
              value={codEquipamento}
              onChange={(e) => {
                const cod = e.target.value;
                setCodEquipamento(cod);
                setMarcarTerceiro(terceirosSet.has(cod.trim()));
              }}
            />
          </label>
          <label>
            Filtrar lista
            <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Número ou cod_equipamento" />
          </label>
        </div>
        <div className="modal-actions" style={{ padding: "0 16px 16px", flexWrap: "wrap" }}>
          <label className="check-label">
            <span className="check-row">
              <input type="checkbox" checked={marcarTerceiro} disabled={loading} onChange={(e) => setMarcarTerceiro(e.target.checked)} />
              {tipo === "caminhao" && !codEquipamento.trim()
                ? "Esse caminhão é terceiro"
                : "Esse cod_equipamento é terceiro"}
            </span>
          </label>
          <button className="btn primary" disabled={loading} onClick={() => void atualizar(false)}>
            Salvar associação
          </button>
          <button className="btn" disabled={loading} onClick={() => void atualizar(true)}>
            Limpar cod_equipamento
          </button>
        </div>

        {filtrados.length ? (
          <div className="table-wrap" style={{ padding: "0 16px 16px" }}>
            <table className="data">
              <thead>
                <tr>
                  <th />
                  <th>{tipo === "caminhao" ? "Caminhão" : "Máquina"}</th>
                  <th className="num">Entradas</th>
                  <th>Última data</th>
                  <th>Período por cod_equipamento</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((item) => {
                  const key = tipo === "caminhao" ? item.caminhao : item.maquina;
                  return (
                    <tr key={String(key)}>
                      <td>
                        <input
                          type="radio"
                          name="vinculo-pick"
                          checked={numero === String(key ?? "")}
                          onChange={() => {
                            const cod = item.codEquipamento != null ? String(item.codEquipamento) : "";
                            const cam = String(key ?? "");
                            setNumero(String(key ?? ""));
                            setCodEquipamento(cod);
                            setMarcarTerceiro(cod ? terceirosSet.has(cod) : tipo === "caminhao" && caminhoesTerceiroSet.has(cam));
                          }}
                        />
                      </td>
                      <td>
                        <strong>{key}</strong>
                      </td>
                      <td className="num">{item.qtdEntradas}</td>
                      <td>{formatOrdsDate(item.ultimaData)}</td>
                      <td>
                        <VinculoAssociacoes
                          associacoes={item.associacoes ?? []}
                          terceiros={terceirosSet}
                          onToggleTerceiro={(cod, marcar) => void toggleTerceiro(cod, marcar)}
                          loading={loading}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {selecionado ? (
          <div style={{ padding: "0 16px 16px" }}>
            <h4 style={{ margin: "0 0 8px" }}>
              Histórico no período — {tipo === "caminhao" ? "caminhão" : "máquina"} {numero}
            </h4>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>cod_equipamento</th>
                    <th>Período com entrada</th>
                    <th className="num">Entradas</th>
                    <th>Terceiro</th>
                  </tr>
                </thead>
                <tbody>
                  {(selecionado.associacoes ?? []).map((a) => {
                    const cod = a.codEquipamento != null ? String(a.codEquipamento) : "";
                    return (
                      <tr key={`${a.codEquipamento ?? "sem"}-${a.dataInicio}-${a.dataFim}`}>
                        <td>{cod || "sem equip."}</td>
                        <td>{formatPeriodoDias(a.dataInicio, a.dataFim)}</td>
                        <td className="num">{a.qtdEntradas}</td>
                        <td>{cod ? terceirosSet.has(cod) ? "Sim" : "Não" : tipo === "caminhao" && caminhoesTerceiroSet.has(numero) ? "Sim" : "Não"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      {tipo === "caminhao" ? (
        <section className="panel">
          <h3>Caminhões marcados como terceiro</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Caminhão</th>
                  <th>Período</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {caminhoesTerceiro.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.caminhao}</strong></td>
                    <td>{formatPeriodoDias(item.dataInicio, item.dataFim)}</td>
                    <td>
                      <button className="btn" disabled={loading} onClick={() => void toggleCaminhaoTerceiro(item.caminhao, false)}>
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!caminhoesTerceiro.length ? <p className="lead">Nenhum caminhão sem código marcado como terceiro no período.</p> : null}
        </section>
      ) : null}

      <section className="panel">
        <h3>Equipamentos marcados como terceiro</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>cod_equipamento</th>
                <th>Marcado em</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {terceiroFiltrados.map((item) => (
                <tr key={item.codEquipamento}>
                  <td>
                    <strong>{item.codEquipamento}</strong>
                  </td>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>
                    <button className="btn" disabled={loading} onClick={() => void toggleTerceiro(item.codEquipamento, false)}>
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!terceiroFiltrados.length ? <p className="lead">Nenhum código marcado.</p> : null}
      </section>

      {resultado?.dados.length ? (
        <section className="panel">
          <h3>Registros atualizados</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  {tipo === "caminhao" ? (
                    <><th>Pesagem</th><th>Guia</th><th>Caminhão</th><th>Data</th><th>Cód. equip.</th></>
                  ) : (
                    <><th>Máquina</th><th>Fazenda</th><th>Talhão</th><th>Data</th><th>Cód. equip.</th></>
                  )}
                </tr>
              </thead>
              <tbody>
                {resultado.dados.map((r, i) => (
                  <tr key={i}>
                    {tipo === "caminhao" ? (
                      <>
                        <td>{cell(r.pesagem)}</td><td>{cell(r.guia)}</td><td>{cell(r.caminhao)}</td>
                        <td>{formatOrdsDate(r.data as string)}</td><td>{cell(r.codEquipamento)}</td>
                      </>
                    ) : (
                      <>
                        <td>{cell(r.maquina)}</td><td>{cell(r.fazenda)}</td><td>{cell(r.talhao)}</td>
                        <td>{formatOrdsDate(r.dataColheita as string)}</td><td>{cell(r.codEquipamento)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
