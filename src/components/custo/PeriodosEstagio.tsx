import { useEffect, useState } from "react";
import { api, type Safra } from "../../api";

type Periodo = { safraId: number; safraLabel: string; anomesInicio: string; anomesFim: string };

export function PeriodosEstagio({ safraId, revisao, onSelecionar, disabled }: {
  safraId?: number; revisao: number; onSelecionar: (periodo: Periodo) => void; disabled: boolean;
}) {
  const [safras, setSafras] = useState<Safra[]>([]);
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [configurando, setConfigurando] = useState(false);
  const [novaSafra, setNovaSafra] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let cancelado = false;
    Promise.all([api.safras(), api.periodosParametrosTecnicos()]).then(([s, p]) => {
      if (cancelado) return;
      setSafras(s.safras); setPeriodos(p.periodos); setErro(null);
    }).catch((e) => { if (!cancelado) setErro(e instanceof Error ? e.message : "Não foi possível carregar os períodos."); });
    return () => { cancelado = true; };
  }, [revisao]);
  const selecionarSafra = (id: string) => {
    setNovaSafra(id);
    const safra = safras.find((row) => row.id === Number(id));
    const ano = safra ? 2000 + Number(safra.code.split("/")[0].slice(-2)) : NaN;
    setInicio(Number.isFinite(ano) ? `${ano}09` : "");
    setFim(Number.isFinite(ano) ? `${ano + 1}08` : "");
  };
  const valido = (valor: string) => /^\d{6}$/.test(valor) && Number(valor.slice(4)) >= 1 && Number(valor.slice(4)) <= 12;
  return <section className="panel no-print">
    <h3>Períodos de safra <button className="btn" type="button" disabled={disabled || !safras.length} onClick={() => {
      selecionarSafra(String(safraId ?? safras[0]?.id ?? "")); setConfigurando(true); setErro(null);
    }}>+ Configurar período</button></h3>
    <div className="form-grid">
      <label className="span-2">Períodos com parâmetros armazenados
        <select value="" disabled={disabled} onChange={(event) => {
          const escolhido = periodos[Number(event.target.value)];
          if (escolhido) { onSelecionar(escolhido); setConfigurando(false); }
        }}>
          <option value="">Selecione um período para consultar ou editar</option>
          {periodos.map((periodo, indice) => <option key={`${periodo.safraId}-${periodo.anomesInicio}-${periodo.anomesFim}`} value={indice}>{periodo.safraLabel} · {periodo.anomesInicio} a {periodo.anomesFim}</option>)}
        </select>
      </label>
      {!periodos.length ? <small className="span-2">Os períodos aparecem aqui depois de salvar os parâmetros em Armazenar.</small> : null}
    </div>
    {configurando ? <form className="form-grid" onSubmit={(event) => {
      event.preventDefault();
      const safra = safras.find((row) => row.id === Number(novaSafra));
      if (!safra || !valido(inicio) || !valido(fim) || inicio > fim) { setErro("Informe a safra e um período válido, com início anterior ou igual ao fim."); return; }
      onSelecionar({ safraId: safra.id, safraLabel: safra.label, anomesInicio: inicio, anomesFim: fim });
      setConfigurando(false); setErro(null);
    }}>
      <label>Safra<select value={novaSafra} onChange={(event) => selecionarSafra(event.target.value)} required>{safras.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
      <label>Período inicial (YYYYMM)<input value={inicio} onChange={(event) => setInicio(event.target.value)} inputMode="numeric" pattern="\d{6}" required /></label>
      <label>Período final (YYYYMM)<input value={fim} onChange={(event) => setFim(event.target.value)} inputMode="numeric" pattern="\d{6}" required /></label>
      <p className="span-2">Depois de abrir o período, informe ou extraia os parâmetros e clique em Armazenar. Os demais períodos serão preservados.</p>
      <div className="actions"><button type="submit" className="btn primary" disabled={disabled}>Abrir período</button><button type="button" className="btn" onClick={() => setConfigurando(false)}>Cancelar</button></div>
    </form> : null}
    {erro ? <p role="alert" style={{ padding: "0 16px 16px", color: "var(--danger)" }}>{erro}</p> : null}
  </section>;
}
