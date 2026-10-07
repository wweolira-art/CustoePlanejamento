import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../api";
import { pneusAverage, pneusAverageCost, pneusCost, pneusCostPerDistance, pneusCustoReposicao, pneusDeliveryDays, pneusDurabilidadeMedia, pneusEconomiaReforma, pneusInPeriod, pneusSum, type PneuConserto, type PneusData, type PneuItem } from "../../lib/pneus";
import { ConsultaProgressBar } from "../ConsultaProgressBar";
import { useReportAutoRefresh } from "./useReportAutoRefresh";
import "./pneus.css";

type View = "descarte" | "estoque" | "detalhes" | "reforma" | "detalheReforma";
const views: [View, string][] = [
  ["descarte", "Descarte de pneus"],
  ["estoque", "Estoque e equipamento"],
  ["detalhes", "Detalhamento de descartes"],
  ["reforma", "Ressoldadora"],
  ["detalheReforma", "Detalhamento resoladora"],
];
type RepairStatus = "" | "aguardando" | "entregue" | "recusado";
type RepairDetailRow = PneuConserto & { tire?: PneuItem };
const fmt = (n: number | null, digits = 1) => n == null ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: digits });
const money = (n: number | null) => n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (s: string | null) => s ? s.split("-").reverse().join("/") : "—";
const safraLabel = (from: string) => { const d = new Date(`${from}T12:00:00`); const y = Number.isNaN(d.getTime()) ? new Date().getFullYear() : d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear()-1; return `${y}/${y+1}`; };
const options = (items: PneuItem[], key: keyof PneuItem) => [...new Set(items.map((p) => String(p[key] ?? "")).filter(Boolean))].sort((a,b) => a.localeCompare(b,"pt-BR",{numeric:true}));
function groups<T>(items: T[], key: (p: T) => string): [string, T[]][] {
  const map = new Map<string,T[]>();
  for (const item of items) { const label = key(item); map.set(label, [...(map.get(label) ?? []), item]); }
  return [...map.entries()];
}
type Bar = { label: string; value: number | null; count?: number };
function Bars({ data, color = "#bf5553", format = fmt, horizontal = false }: { data: Bar[]; color?: string; format?: (n:number|null)=>string; horizontal?: boolean }) {
  if (!data.length) return <Empty />;
  const max = Math.max(...data.map((p) => p.value ?? 0), 1);
  if (horizontal) return <div className="tp-horizontal">{data.map((p) => <div key={p.label} title={`${p.label}: ${format(p.value)}`}><span>{p.label}</span><div><i style={{ width: `${Math.max(0,(p.value??0)/max)*100}%`, background: color }} /><b>{format(p.value)}</b></div></div>)}</div>;
  return <div className="tp-bars">{data.map((p) => <div className="tp-bar-col" key={p.label} title={`${p.label}: ${format(p.value)}${p.count != null ? ` · ${p.count} pneus` : ""}`}>
    <div className="tp-bar-track"><div className="tp-bar" style={{ height: `${Math.max(0,(p.value??0)/max)*78}%`, background: color }}><strong>{format(p.value)}</strong>{p.count != null && <small>{p.count}</small>}</div></div><span>{p.label}</span>
  </div>)}</div>;
}
function Empty() { return <div className="tp-empty">Nenhum registro para os filtros selecionados.</div>; }
function SavingsChart({ data }: { data: {month:string; purchase:number|null; repair:number; saving:number|null}[] }) {
  if (!data.length) return <Empty />;
  const width = Math.max(800, data.length * 270);
  const step = (width - 90) / data.length;
  const max = Math.max(1, ...data.flatMap((p) => [p.purchase ?? 0, p.repair, p.saving ?? 0]));
  const min = Math.min(0, ...data.map((p) => p.saving ?? 0));
  const axis = 220;
  const scale = 168;
  const y = (n: number) => axis - ((n - min) / (max - min)) * scale;
  const nudge = (target: number, others: number[]) => {
    let next = Math.max(14, Math.min(axis - 4, target));
    for (let k = 0; k < 8; k += 1) {
      const hit = others.find((other) => Math.abs(next - other) < 15);
      if (hit == null) break;
      next = Math.max(14, hit - 15);
    }
    return next;
  };
  return <div className="tp-savings-chart"><svg viewBox={`0 0 ${width} 285`} role="img" aria-label="Comparação mensal do custo de compra do pneu, valor da reforma e economia">
    <line x1="28" x2={width - 18} y1={y(0)} y2={y(0)} stroke="#9bafbe"/>
    {data.map((p, i) => {
      const x = 48 + step * (i + 0.5);
      const buyTop = p.purchase == null ? y(0) : y(p.purchase);
      const repairTop = y(p.repair);
      const repairInside = p.repair > 0 && y(0) - repairTop >= 24;
      const purchaseY = p.purchase == null ? null : nudge(buyTop - 8, []);
      const repairY = p.repair > 0 ? (repairInside ? repairTop + 14 : nudge(repairTop - 8, [])) : null;
      const savingY = p.saving ? nudge(y(p.saving) - 4, repairInside || repairY == null ? [] : [repairY]) : null;
      return <g key={p.month}>
        <title>{p.month}: custo compra {money(p.purchase)}, reforma {money(p.repair)}, economia {money(p.saving)}</title>
        {p.purchase != null && <rect x={x - 70} y={buyTop} width="44" height={Math.max(0, y(0) - buyTop)} fill="#0c4f87"/>}
        {p.repair > 0 && <rect x={x + 26} y={repairTop} width="44" height={Math.max(0, y(0) - repairTop)} fill="#c6ac00"/>}
        {p.saving ? <>
          <line x1={x} x2={x} y1={y(0)} y2={y(p.saving)} stroke="#53b535"/>
          <circle cx={x} cy={y(p.saving)} r="3" fill="#53b535"/>
          <line x1={x + 4} x2={x + 74} y1={y(p.saving)} y2={savingY} stroke="#53b535" strokeWidth="0.9"/>
          <text className="tp-savings-halo" x={x + 76} y={savingY} textAnchor="start" fill="#277622">{money(p.saving)}</text>
        </> : null}
        {purchaseY != null && <text className="tp-savings-halo" x={x - 48} y={purchaseY} textAnchor="middle" fill="#0c4f87">{money(p.purchase)}</text>}
        {repairY != null && <text className={repairInside ? undefined : "tp-savings-halo"} x={x + 48} y={repairY} textAnchor="middle" fill={repairInside ? "#3d3200" : "#6b5a00"}>{money(p.repair)}</text>}
        <text x={x} y="272" textAnchor="middle">{p.month}</text>
      </g>;
    })}
  </svg></div>;
}
function Panel({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return <section className={`tp-panel ${className}`}><h3>{title}</h3>{children}</section>;
}
function Kpi({ value, label, hint }: { value: string; label: string; hint?: string }) { return <div className="tp-kpi" title={hint}><strong>{value}</strong><span>{label}</span></div>; }
function Select({ label, value, onChange, choices }: { label: string; value: string; onChange: (v:string)=>void; choices:string[] }) {
  return <label className="tp-select">{label}<select value={value} onChange={(e)=>onChange(e.target.value)}><option value="">Todos</option>{choices.map((s)=><option key={s}>{s}</option>)}</select></label>;
}
function Checks({ title, values, selected, onChange }: { title:string; values:string[]; selected:string[]; onChange:(v:string[])=>void }) {
  return <fieldset className="tp-checks"><legend>{title}</legend><div>{values.map((v)=><label key={v} title={v}><input type="checkbox" checked={selected.includes(v)} onChange={()=>onChange(selected.includes(v)?selected.filter((s)=>s!==v):[...selected,v])} />{v}</label>)}</div></fieldset>;
}
function LifePie({ items }: { items: PneuItem[] }) {
  const values = groups(items,(p)=>`${p.vida}ª vida`).sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true}));
  const colors = ["#0678bd","#bf5553","#d0b70b","#193e86","#58a898"];
  let start = 0;
  const gradient = values.map(([,ps],i)=>{ const end=start+ps.length/items.length*100; const stop=`${colors[i%colors.length]} ${start}% ${end}%`; start=end; return stop; }).join(",");
  return items.length ? <div className="tp-life"><div role="img" aria-label={values.map(([s,p])=>`${s}: ${p.length}`).join(", ")} className="tp-pie" style={{background:`conic-gradient(${gradient})`}} /><div>{values.map(([s,p],i)=><span key={s}><i style={{background:colors[i%colors.length]}} />{s} · {p.length} ({fmt(p.length/items.length*100)}%)</span>)}</div></div> : <Empty />;
}
function RepairDetailTable({ items }: { items: RepairDetailRow[] }) {
  return <div className="tp-table-scroll"><table className="tp-table"><thead><tr>
    <th>Ressoladora</th><th>Nº fogo</th><th>Medida</th><th>Marca</th><th>Categoria</th>
    <th>Data envio</th><th>Data retorno</th><th>Recusado</th><th>Tempo entrega</th><th>Equipamento</th><th>Valor reforma</th>
  </tr></thead><tbody>{items.map((c,i)=><tr key={`${c.pneuId}-${c.inicio ?? i}`} className={c.recusado?"is-rejected":""}>
    <td title={c.fornecedor}>{c.fornecedor}</td><td>{c.tire?.numero ?? "—"}</td><td>{c.tire?.medida ?? "—"}</td><td>{c.tire?.marca ?? "—"}</td><td>{c.tire?.categoria ?? "—"}</td>
    <td>{date(c.inicio)}</td><td>{date(c.fim)}</td><td>{c.recusado?"RECUSADO":""}</td><td>{fmt(pneusDeliveryDays(c.inicio,c.fim),0)}</td>
    <td>{c.tire?.equipamento || "—"}</td><td>{money(c.recusado?0:c.valor)}</td>
  </tr>)}</tbody></table>{!items.length && <Empty />}</div>;
}
function TireTable({ items, stock = false, mounted = false, selected, onSelect }: { items:PneuItem[]; stock?:boolean; mounted?:boolean; selected?:number; onSelect?:(id:number)=>void }) {
  return <div className="tp-table-scroll"><table className="tp-table"><thead><tr>
    {!stock && !mounted && <><th>Data descarte</th><th>Frota</th></>}
    <th>Pneu / Nº fogo</th><th>Medida</th>{mounted && <th>Data colocação</th>}
    {!stock && !mounted && <><th>Motivo</th><th>Causa</th></>}
    <th>Tipo</th><th>Categoria</th><th>Marca</th>{!stock && <><th>Vida final</th><th>Sulco (mm)</th></>}
    <th>KM/HRS rodado</th>{!stock && !mounted && <><th>Custo total</th><th>R$/KM/HRS</th></>}{mounted && <th>Posição</th>}
  </tr></thead><tbody>{items.map((p)=><tr key={p.id} className={`${p.emReforma?"is-repair":""} ${selected===p.id?"is-selected":""}`} onClick={()=>onSelect?.(p.id)}>
    {!stock && !mounted && <><td>{date(p.descarte)}</td><td>{p.equipamento || "—"}</td></>}
    <td>{onSelect ? <button type="button" onClick={()=>onSelect(p.id)}>{p.numero}</button> : p.numero}</td><td>{p.medida}</td>{mounted && <td>{date(p.colocado)}</td>}
    {!stock && !mounted && <><td>{p.motivo}</td><td>{p.causa}</td></>}
    <td>{p.tipo}</td><td>{p.categoria}</td><td>{p.marca}</td>{!stock && <><td>{p.vida}</td><td title={`Última medição: ${date(p.medicao)}`}>{fmt(p.sulco)}</td></>}
    <td>{fmt(p.rodado,2)}</td>{!stock && !mounted && <><td>{money(p.custo)}</td><td>{money(pneusCostPerDistance([p]))}</td></>}{mounted && <td>{p.posicaoDescricao}</td>}
  </tr>)}</tbody></table>{!items.length && <Empty />}</div>;
}
function BrandDurabilityTable({ rows }: { rows: { marca:string; pneus:number; vidas:number; reformas:number; descartes:number; durabilidade:number|null; custoKm:number|null }[] }) {
  return <div className="tp-table-scroll tp-brand-table"><table className="tp-table"><thead><tr><th>Marca</th><th>Pneus considerados</th><th>Vidas</th><th>Reformas</th><th>Descartes</th><th>KM/HRS por vida</th><th>R$/km</th></tr></thead><tbody>{rows.map((row)=><tr key={row.marca}><td>{row.marca}</td><td>{fmt(row.pneus,0)}</td><td>{fmt(row.vidas,0)}</td><td>{fmt(row.reformas,0)}</td><td>{fmt(row.descartes,0)}</td><td>{fmt(row.durabilidade,0)}</td><td>{money(row.custoKm)}</td></tr>)}</tbody></table>{!rows.length && <Empty />}</div>;
}
function Equipment({ items, selected, onSelect }: {items:PneuItem[]; selected?:number; onSelect:(id:number)=>void}) {
  const axles = [...new Set(items.map((p)=>p.eixo || "?"))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  return <div className="tp-equipment"><span className="tp-side">Lado esquerdo</span>{!items.length ? <Empty /> : <div className="tp-chassis">{axles.map((axle)=><div className="tp-axle" key={axle}><span>Eixo {axle}</span>{["E","D"].map((side)=><div className={`tp-wheels tp-wheels-${side}`} key={side}>{items.filter((p)=>(p.eixo||"?")===axle && (p.posicao.includes("D")?"D":"E")===side).sort((a,b)=>a.posicao.localeCompare(b.posicao)).map((p)=><button key={p.id} type="button" className={`tp-tire ${selected===p.id?"is-selected":""}`} title={`${p.posicaoDescricao} · Sulco ${fmt(p.sulco)} mm`} onClick={()=>onSelect(p.id)}><span>{p.numero}</span></button>)}</div>)}</div>)}</div>}<span className="tp-side tp-side-bottom">Lado direito</span></div>;
}
export function IndicadoresPneus() {
  const today = new Date();
  const year = today.getMonth()>=8?today.getFullYear():today.getFullYear()-1;
  const [view,setView]=useState<View>("descarte");
  const [from,setFrom]=useState(`${year}-09-01`);
  const [to,setTo]=useState(`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`);
  const [categories,setCategories]=useState<string[]>([]), [causes,setCauses]=useState<string[]>([]), [reasons,setReasons]=useState<string[]>([]), [types,setTypes]=useState<string[]>([]);
  const [equipment,setEquipment]=useState(""), [size,setSize]=useState(""), [tire,setTire]=useState(""), [brand,setBrand]=useState("");
  const [repairKind,setRepairKind]=useState(""), [supplier,setSupplier]=useState("");
  const [repairTipo,setRepairTipo]=useState(""), [repairStatus,setRepairStatus]=useState<RepairStatus>("");
  const [selected,setSelected]=useState<number>();
  const [data,setData]=useState<PneusData|null>(null), [loading,setLoading]=useState(false), [error,setError]=useState<string|null>(null);
  const busy = useRef(false);
  const load=useCallback(async()=>{ if(busy.current) return; busy.current=true; setLoading(true); setError(null); try {setData(await api.indicadoresPneus());} catch(e){setError(e instanceof Error?e.message:String(e));} finally {busy.current=false;setLoading(false);} },[]);
  useEffect(()=>{void load();},[load]);
  useReportAutoRefresh(load);
  const all=data?.pneus??[];
  const filtered=useMemo(()=>all.filter((p)=>(!categories.length||categories.includes(p.categoria))&&(!types.length||types.includes(p.tipoEquipamento))&&(!size||p.medida===size)&&(!brand||p.marca===brand)&&(!tire||p.numero===tire)&&(view==="estoque"||!equipment||p.equipamento===equipment)),[all,categories,types,size,brand,tire,equipment,view]);
  const discarded=filtered.filter((p)=>pneusInPeriod(p.descarte,from,to)&&(!causes.length||causes.includes(p.causa))&&(!reasons.length||reasons.includes(p.motivo))).sort((a,b)=>(b.descarte??"").localeCompare(a.descarte??""));
  const stock=filtered.filter((p)=>!p.descarte&&!p.montado);
  const mounted=filtered.filter((p)=>!p.descarte&&p.montado&&(!equipment||p.equipamento===equipment));
  const equipmentShown=equipment||mounted[0]?.equipamento||"";
  const equipmentTires=mounted.filter((p)=>p.equipamento===equipmentShown);
  const filteredIds=useMemo(()=>new Set(filtered.map((p)=>p.id)),[filtered]);
  const tireById=useMemo(()=>new Map(all.map((p)=>[p.id,p])),[all]);
  const repairs=useMemo(()=>(data?.consertos??[]).filter((c)=>filteredIds.has(c.pneuId)&&pneusInPeriod(c.inicio,from,to)&&(!repairKind||(repairKind==="reforma"?c.reforma:!c.reforma))&&(!supplier||c.fornecedor===supplier)),[data?.consertos,filteredIds,from,to,repairKind,supplier]);
  const repairDetails=useMemo(()=>{
    const byId=new Map(all.map((p)=>[p.id,p]));
    return (data?.consertos??[]).map((c)=>({...c,tire:byId.get(c.pneuId)})).filter((c)=>{
      const t=c.tire;
      if(!t) return false;
      if(tire&&t.numero!==tire) return false;
      if(equipment&&t.equipamento!==equipment) return false;
      if(repairTipo&&c.tipo!==repairTipo) return false;
      if(repairStatus==="recusado"&&!c.recusado) return false;
      if(repairStatus==="aguardando"&&(c.fim||c.recusado)) return false;
      if(repairStatus==="entregue"&&(!c.fim||c.recusado)) return false;
      if(!pneusInPeriod(c.inicio,from,to)) return false;
      return true;
    }).sort((a,b)=>(b.inicio??"").localeCompare(a.inicio??""));
  },[data?.consertos,all,tire,equipment,repairTipo,repairStatus,from,to]);
  const repairTipoChoices=useMemo(()=>[...new Set((data?.consertos??[]).map((c)=>c.tipo))].sort((a,b)=>a.localeCompare(b,"pt-BR")),[data?.consertos]);
  const delivered=repairs.filter((c)=>c.fim&&!c.recusado);
  const repairMonths=groups(delivered,(c)=>c.fim!.slice(0,7)).sort((a,b)=>a[0].localeCompare(b[0]));
  const savings=repairMonths.map(([month,cs])=>{
    const eligible=cs.filter((c)=>c.reforma);
    const calc=pneusEconomiaReforma(eligible.map((c)=>({
      custoReposicao: pneusCustoReposicao(tireById.get(c.pneuId)),
      valorReforma: c.valor,
    })));
    return {month,purchase:calc.compra,repair:calc.reforma,saving:calc.economia};
  });
  const savingsTotals=useMemo(()=>{
    const eligible=delivered.filter((c)=>c.reforma);
    return pneusEconomiaReforma(eligible.map((c)=>({
      custoReposicao: pneusCustoReposicao(tireById.get(c.pneuId)),
      valorReforma: c.valor,
    })));
  },[delivered,tireById]);
  const durabilityTires=useMemo(()=>{
    const byId=new Map(all.map((p)=>[p.id,p]));
    const ids=new Set(repairs.map((c)=>c.pneuId));
    return [...ids]
      .map((id)=>byId.get(id))
      .filter((p): p is PneuItem => Boolean(p) && p.rodado != null && p.vida > 0);
  },[all,repairs]);
  const durabilityByBrand=useMemo(()=>groups(durabilityTires,(p)=>p.marca||"Sem marca")
    .map(([label,ps])=>({label,value:pneusDurabilidadeMedia(ps),count:ps.length}))
    .filter((row)=>row.value!=null)
    .sort((a,b)=>(b.value??0)-(a.value??0)),[durabilityTires]);
  const durabilityBrandRows=useMemo(()=>{
    const repairBrandCounts=new Map<string,number>();
    for(const c of repairs) {
      if(!c.reforma||c.recusado) continue;
      const brand=tireById.get(c.pneuId)?.marca||"Sem marca";
      repairBrandCounts.set(brand,(repairBrandCounts.get(brand)??0)+1);
    }
    const discardBrandCounts=new Map<string,number>();
    for(const p of discarded) {
      const brand=p.marca||"Sem marca";
      discardBrandCounts.set(brand,(discardBrandCounts.get(brand)??0)+1);
    }
    return groups(durabilityTires,(p)=>p.marca||"Sem marca")
      .map(([marca,ps])=>({
        marca,
        pneus: ps.length,
        vidas: pneusSum(ps.map((p)=>p.vida)),
        reformas: repairBrandCounts.get(marca)??0,
        descartes: discardBrandCounts.get(marca)??0,
        durabilidade: pneusDurabilidadeMedia(ps),
        custoKm: pneusCostPerDistance(ps),
      }))
      .sort((a,b)=>(b.durabilidade??0)-(a.durabilidade??0)||a.marca.localeCompare(b.marca,"pt-BR"));
  },[discarded,durabilityTires,repairs,tireById]);
  function clear() { setCategories([]);setCauses([]);setReasons([]);setTypes([]);setEquipment("");setSize("");setTire("");setBrand("");setRepairKind("");setSupplier("");setRepairTipo("");setRepairStatus("");setSelected(undefined); }
  const dates=<div className="tp-dates"><label>De<input aria-label="Data inicial" type="date" value={from} onChange={(e)=>setFrom(e.target.value)} /></label><label>Até<input aria-label="Data final" type="date" value={to} onChange={(e)=>setTo(e.target.value)} /></label></div>;
  return <div className="tp-root">
    <nav className="tp-tabs" aria-label="Relatórios de pneus">{views.map(([id,label])=><button type="button" key={id} aria-pressed={view===id} className={view===id?"active":""} onClick={()=>{setView(id);clear();}}>{label}</button>)}<button type="button" disabled={loading} onClick={()=>void load()}>{loading?"Atualizando…":"Atualizar dados"}</button></nav>
    <ConsultaProgressBar active={loading} label="Consultando controle de pneus…" className="consulta-progress--compact" />
    {error && <div role="alert" className="tp-alert">Não foi possível atualizar: {error}{data&&". Os dados anteriores continuam exibidos."}</div>}
    {from>to && view!=="estoque" && <div role="alert" className="tp-alert">A data inicial deve ser anterior à data final.</div>}
    <div className={`tp-dashboard tp-view-${view}`}>
      {(view==="descarte"||view==="reforma") && <aside className="tp-sidebar"><div className="tp-sidebar-mark">◉</div><h4>Período {view==="reforma"?"conserto":"sucateamento"}</h4>{dates}
        <Checks title="Categoria" values={options(all,"categoria")} selected={categories} onChange={setCategories}/>
        {view==="descarte"&&<><Checks title="Causa" values={options(all.filter((p)=>p.descarte),"causa")} selected={causes} onChange={setCauses}/><Checks title="Motivo" values={options(all.filter((p)=>p.descarte),"motivo")} selected={reasons} onChange={setReasons}/></>}
        <Checks title="Tipo de equipamento" values={options(all,"tipoEquipamento")} selected={types} onChange={setTypes}/>
        <button type="button" className="tp-clear" onClick={clear}>Limpar filtros</button>
      </aside>}
      <main className="tp-content"><header className="tp-heading"><div><h2>{view==="reforma"||view==="detalheReforma"?"RESSOLDADORA":"CONTROLE DE PNEUS"}</h2><span>{views.find(([id])=>id===view)?.[1]}</span></div><small>{data?`Atualizado em ${new Date(data.atualizadoEm).toLocaleString("pt-BR")}`:"Consultando Oracle…"}</small></header>
      {view==="descarte"&&<>
        <Panel title="Descarte por medida e custo estimado"><div className="tp-kpis"><Kpi value={money(pneusCost(discarded))} label="Custo total estimado" hint="Custo médio dos pneus (família 32) no ano da data de retirada, por medida. Sem retirada no ano/medida: não disponível."/><Kpi value={fmt(pneusAverage(discarded.map((p)=>p.vida)))} label="Vida média"/><Kpi value={fmt(pneusAverage(discarded.map((p)=>p.sulco)))} label="Sulco médio (mm)"/><Kpi value={fmt(discarded.length,0)} label="Quantidade"/><Kpi value={money(pneusCostPerDistance(discarded))} label="R$/KM-HRS"/></div>
          <Bars data={groups(discarded,(p)=>p.medida).map(([label,ps])=>({label,value:pneusAverageCost(ps),count:ps.length})).sort((a,b)=>(b.value??0)-(a.value??0))} format={money}/>
        </Panel>
        <Panel title="Motivos de descartes, sulco e vida"><div className="tp-reasons"><Bars horizontal data={groups(discarded,(p)=>p.motivo).map(([label,ps])=>({label,value:ps.length})).sort((a,b)=>b.value-a.value)}/><Bars data={[{label:"≤ 2 mm",value:discarded.filter((p)=>p.sulco!=null&&p.sulco<=2).length},{label:"> 2 mm",value:discarded.filter((p)=>p.sulco!=null&&p.sulco>2).length},{label:"Sem medição",value:discarded.filter((p)=>p.sulco==null).length}]} /><LifePie items={discarded}/></div></Panel>
        <Panel title="Custo safra"><div className="tp-legend tp-safra-legend"><strong>Safra</strong><i/> Safra {safraLabel(from)}</div><Bars color="#128ef3" format={(n)=>fmt(n,0)} data={groups(discarded,(p)=>p.tipoEquipamento).map(([label,ps])=>({label,value:ps.length})).sort((a,b)=>(b.value??0)-(a.value??0))}/></Panel>
      </>}
      {view==="detalhes"&&<><div className="tp-filterbar"><div className="tp-date-filter">Data sucateamento{dates}</div><Select label="Pneu" choices={options(all,"numero")} value={tire} onChange={setTire}/><Select label="Medida pneu" choices={options(all,"medida")} value={size} onChange={setSize}/><Select label="Equipamento" choices={options(all,"equipamento")} value={equipment} onChange={setEquipment}/><Select label="Tipo de equipamento" choices={options(all,"tipoEquipamento")} value={types[0]??""} onChange={(v)=>setTypes(v?[v]:[])}/><button type="button" className="tp-clear" onClick={clear}>Limpar filtros</button></div><Panel title={`Pneus descartados · ${discarded.length} registros`} className="tp-dark"><TireTable items={discarded}/></Panel></>}
      {view==="estoque"&&<><div className="tp-filterbar"><Select label="Categoria" choices={options(all,"categoria")} value={categories[0]??""} onChange={(v)=>setCategories(v?[v]:[])}/><Select label="Medida" choices={options(all,"medida")} value={size} onChange={setSize}/><Select label="Marca" choices={options(all.filter((p)=>!p.descarte),"marca")} value={brand} onChange={setBrand}/><button type="button" className="tp-clear" onClick={clear}>Limpar filtros</button><small>Posição atual · não utiliza filtro de período</small></div><div className="tp-stock-layout"><Panel title="Pneu em estoque" className="tp-dark"><TireTable items={stock} stock/><div className="tp-stock-bottom"><div><Kpi value={fmt(stock.filter((p)=>!p.emReforma).length,0)} label="Em estoque"/><Kpi value={fmt(stock.filter((p)=>p.emReforma).length,0)} label="Pneus em reforma"/></div><div className="tp-table-scroll"><table className="tp-table"><thead><tr><th>Medida</th><th>Quantidade</th></tr></thead><tbody>{groups(stock.filter((p)=>!p.emReforma),(p)=>p.medida).sort((a,b)=>b[1].length-a[1].length).map(([s,ps])=><tr key={s}><td>{s}</td><td>{ps.length}</td></tr>)}</tbody></table></div></div><small className="tp-stock-legend">■ Pneus em reforma</small></Panel><div className="tp-stock-right"><Panel title="Equipamento" className="tp-dark"><div className="tp-equipment-select"><Select label="Equipamento" choices={options(all.filter((p)=>!p.descarte&&p.montado),"equipamento")} value={equipmentShown} onChange={(v)=>{setEquipment(v);setSelected(undefined);}}/></div><Equipment items={equipmentTires} selected={selected} onSelect={setSelected}/></Panel><Panel title="Pneus montados no equipamento" className="tp-dark"><TireTable items={equipmentTires} mounted selected={selected} onSelect={setSelected}/></Panel></div></div></>}
      {view==="reforma"&&<><Panel title="Pneus enviados à ressoldadora"><div className="tp-repair-top"><Select label="Filtro" choices={["reforma","conserto"]} value={repairKind} onChange={setRepairKind}/><Select label="Fornecedor" choices={[...new Set((data?.consertos??[]).map((c)=>c.fornecedor))].sort()} value={supplier} onChange={setSupplier}/><div className="tp-kpis"><Kpi value="—" label="Aguard. orçamento" hint="Status de orçamento não informado nas consultas fornecidas."/><Kpi value={fmt(repairs.filter((c)=>!c.fim&&!c.recusado).length,0)} label="Aguard. entrega"/><Kpi value={fmt(delivered.length,0)} label="Total entregue"/></div></div><div className="tp-legend"><i/> Entregue · por mês de conclusão</div><Bars color="#0c4f87" data={repairMonths.map(([label,cs])=>({label,value:cs.length}))}/></Panel><Panel title="Economia na reforma de pneus"><div className="tp-kpis"><Kpi value={money(savingsTotals.compra)} label="Custo compra (reposição)" hint="Mesmo custo estimado da aba Descarte: média família 32 por medida. Compara o que custaria comprar pneu novo."/><Kpi value={money(savingsTotals.reforma)} label="Valor reforma"/><Kpi value={money(savingsTotals.economia)} label="Economia" hint="Custo de compra − valor da reforma. Positivo = reformar saiu mais barato que comprar."/></div><div className="tp-legend"><i/> Custo compra (pneu novo) <i className="yellow"/> Valor reforma <i className="green"/> Economia</div><SavingsChart data={savings}/></Panel><Panel title="Durabilidade de pneus por marca"><div className="tp-kpis"><Kpi value={fmt(pneusDurabilidadeMedia(durabilityTires),0)} label="Durabilidade média" hint="Σ KM/HRS rodado ÷ Σ vidas dos pneus enviados no período."/><Kpi value={fmt(durabilityTires.length,0)} label="Pneus considerados"/><Kpi value={fmt(durabilityByBrand.length,0)} label="Marcas"/></div><div className="tp-legend"><i/> KM/HRS por vida · marca</div><Bars color="#128ef3" format={(n)=>fmt(n,0)} data={durabilityByBrand}/><BrandDurabilityTable rows={durabilityBrandRows}/></Panel></>}
      {view==="detalheReforma"&&<><div className="tp-filterbar"><div className="tp-date-filter">Data envio{dates}</div><Select label="Pneu" choices={options(all,"numero")} value={tire} onChange={setTire}/><Select label="Equipamento" choices={options(all,"equipamento")} value={equipment} onChange={setEquipment}/><Select label="Tipo conserto" choices={repairTipoChoices} value={repairTipo} onChange={setRepairTipo}/><label className="tp-select">Situação<select value={repairStatus} onChange={(e)=>setRepairStatus(e.target.value as RepairStatus)}><option value="">Todos</option><option value="aguardando">Aguardando entrega</option><option value="entregue">Entregue</option><option value="recusado">Recusado</option></select></label><button type="button" className="tp-clear" onClick={clear}>Limpar filtros</button></div><Panel title={`Detalhamento resoladora · ${repairDetails.length} registros`} className="tp-dark"><RepairDetailTable items={repairDetails}/></Panel></>}
      {data&&((view==="descarte"||view==="detalhes")&&discarded.some((p)=>p.custo==null)||(view==="reforma"&&delivered.some((c)=>c.reforma&&pneusCustoReposicao(tireById.get(c.pneuId))==null)))&&<p className="tp-note">{view==="reforma"?"Economia aparece como “—” quando falta o custo de reposição (família 32 / medida) do pneu reformado.":"O custo total estimado soma os pneus com preço encontrado; pneus sem retirada da família 32 no ano/medida do descarte ficam fora do valor."} Aguardando orçamento depende de uma regra ainda não informada.</p>}
      <details className="tp-method"><summary>Critérios dos indicadores</summary><p>Exclui motivo de sucata 17. Vida = vida inicial (ou 1) + reformas concluídas e não recusadas. Rodado = KM/HRS total do cadastro. Sulco de descarte = última retirada; em uso = média da última medição, ou sulco de colocação. Estoque = não sucateado e sem montagem aberta. Reforma = conserto aberto e não recusado. Custo do descarte = custo médio unitário das retiradas de material da família 32 no mesmo ano da data de retirada, por medida do pneu (fallback: ano mais recente da medida). Custo safra = quantidade de descartes por tipo de equipamento no período/safra selecionado. Economia na reforma = custo de compra/reposição (mesmo custo da aba Descarte) − valor das reformas concluídas — mostra quanto se economiza reformando em vez de comprar pneu novo. Durabilidade por marca = Σ KM/HRS rodado ÷ Σ vidas dos pneus enviados à ressoldadora no período (únicos). Período da ressoldadora filtra a data de envio; o gráfico agrupa as entregas por conclusão.</p></details>
      </main>
    </div>
  </div>;
}
