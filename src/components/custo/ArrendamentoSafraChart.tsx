import { useEffect, useRef, useState } from "react";
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { api, type ArrendamentoSafra } from "../../api";
import { formatBRL } from "../../lib/format";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend, ChartDataLabels);
const numero = (value: number) => value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ArrendamentoSafraChart() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [dados, setDados] = useState<ArrendamentoSafra[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizacao, setAtualizacao] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErro(null); setDados([]);
    api.arrendamentoPorSafra().then((result) => { if (!cancelled) setDados(result.dados); })
      .catch((error) => { if (!cancelled) setErro(error instanceof Error ? error.message : "Não foi possível carregar o gráfico."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [atualizacao]);
  useEffect(() => {
    if (!canvas.current || !dados.length || loading) return;
    const chart = new Chart(canvas.current, {
      type: "bar",
      data: { labels: dados.map((row) => row.label), datasets: [{ label: "Arrendamento (R$/ha)",
        data: dados.map((row) => row.possuiCustos && !row.erro ? row.rHa : null),
        backgroundColor: "#1d61a5", borderRadius: 6, maxBarThickness: 80 }] },
      options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 28 } },
        scales: { y: { beginAtZero: true, title: { display: true, text: "R$/ha", color: "#17375e" }, ticks: { color: "#536b87" } }, x: { ticks: { color: "#17375e" }, grid: { display: false } } },
        plugins: { legend: { display: false }, datalabels: { anchor: "end", align: "top", color: "#17375e", formatter: (value) => value == null ? "" : numero(Number(value)) },
          tooltip: { callbacks: { label: (context) => `${formatBRL(Number(context.raw))}/ha`, afterLabel: (context) => {
            const row = dados[context.dataIndex];
            return [`Custo: ${formatBRL(row.custo ?? 0)}`, `Área arrendada: ${numero(row.area ?? 0)} ha`];
          } } } } },
    });
    return () => chart.destroy();
  }, [dados, loading]);
  const status = (row: ArrendamentoSafra) => row.erro || (!row.possuiCustos ? "Sem custos no período" : !(row.area && row.area > 0) ? "Sem área arrendada" : `${numero(row.rHa ?? 0)} R$/ha`);
  return <section className="panel">
    <h3>Arrendamento por safra · R$/ha <button type="button" className="btn no-print" disabled={loading} onClick={() => setAtualizacao((value) => value + 1)}>Atualizar</button></h3>
    <div style={{ padding: 16 }}>
      <p>Comparação do período completo de cada safra (setembro a agosto). Custo de arrendamento ÷ área arrendada da safra.</p>
      {loading ? <p role="status">Carregando arrendamento por safra…</p> : erro ? <p role="alert">{erro}</p> : !dados.length ? <p>Nenhuma safra cadastrada.</p> : <>
        <div style={{ height: 300 }}><canvas ref={canvas} role="img" aria-label="Gráfico de R$/ha de arrendamento por safra. Valores disponíveis na tabela abaixo." /></div>
        <div className="table-wrap"><table className="data"><thead><tr><th>Safra</th><th>Custo de arrendamento</th><th>Área arrendada (ha)</th><th>R$/ha</th></tr></thead>
          <tbody>{dados.map((row) => <tr key={row.safraId}><td>{row.label}</td><td>{row.custo == null || !row.possuiCustos ? "—" : formatBRL(row.custo)}</td><td title={row.fonteArea}>{row.area == null ? "—" : numero(row.area)}</td><td>{status(row)}</td></tr>)}</tbody>
        </table></div>
      </>}
    </div>
  </section>;
}
