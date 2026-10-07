import { formatBRL } from "../../lib/format";
import {
  formatAnomesDisplay,
  formatConsultaValue,
  labelTipoCusto,
  labelViaDistribuicao,
  type DataColumn,
} from "../../lib/consultaRateioColumns";
import { DataTable } from "./DataTable";

type Row = Record<string, unknown>;

function KpiGrid({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="kpis" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
      {items.map((item) => (
        <article key={item.label} className="kpi">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </article>
      ))}
    </div>
  );
}

function viaLabel(via: unknown) {
  const v = String(via ?? "");
  if (v === "transporte-cliente") return "transporte→cliente";
  if (v === "mecanizacao-cliente") return "mecanização→cliente";
  if (v === "objeto-equipamento") return "objeto do equipamento";
  if (v === "apontamento") return "apontamento";
  return v || "—";
}

export function DiagnosticoPanel({ payload }: { payload: Record<string, unknown> }) {
  const resumo = (payload.resumo ?? {}) as Record<string, number>;
  const logica = (payload.logica ?? {}) as Record<string, string>;
  const porVia = (payload.porVia ?? []) as Row[];
  const porDestino = (payload.porDestino ?? []) as Row[];
  const semDestino = (payload.semDestino ?? []) as Row[];
  const transporte = (payload.transporte ?? {}) as Record<string, unknown>;
  const mecanizacao = (payload.mecanizacao ?? {}) as Record<string, unknown>;
  const destinosTransp = (transporte.destinosClientes ?? []) as Row[];
  const destinosMec = (mecanizacao.destinosClientes ?? []) as Row[];

  const porViaCols: DataColumn[] = [
    { key: "tipo", label: "Tipo" },
    { key: "via", label: "Via" },
    { key: "valor", label: "Valor", num: true, format: "money" },
    { key: "qtdLinhas", label: "Linhas", num: true },
    { key: "percentual", label: "%", num: true, format: "percent" },
  ];

  const porDestinoCols: DataColumn[] = [
    { key: "objetoCusto", label: "Objeto" },
    { key: "descricao", label: "Descrição" },
    { key: "custoOficina", label: "Oficina", num: true, format: "money" },
    { key: "custoCombustivel", label: "Combustível", num: true, format: "money" },
    { key: "custoMaterial", label: "Material", num: true, format: "money" },
    { key: "custoInsumo", label: "Insumo", num: true, format: "money" },
    { key: "custoTransporte", label: "Transporte", num: true, format: "money" },
    { key: "custoMecanizacao", label: "Mecanização", num: true, format: "money" },
    { key: "custoServicoTerceiro", label: "Serviços 3º", num: true, format: "money" },
    { key: "custoFuncionario", label: "Funcionário", num: true, format: "money" },
    { key: "custoTotal", label: "Total", num: true, format: "money" },
    { key: "percentual", label: "%", num: true, format: "percent" },
  ];

  return (
    <>
      <KpiGrid
        items={[
          { label: "Total", value: formatBRL(resumo.total ?? 0) },
          { label: "Oficina", value: formatBRL(resumo.totalOficina ?? 0) },
          { label: "Transporte", value: formatBRL(resumo.totalTransporte ?? 0) },
          { label: "Mecanização", value: formatBRL(resumo.totalMecanizacao ?? 0) },
          { label: "Combustível", value: formatBRL(resumo.totalCombustivel ?? 0) },
          {
            label: "Mat. + insumo + serv. + func.",
            value: formatBRL(
              (resumo.totalMaterial ?? 0) +
                (resumo.totalInsumo ?? 0) +
                (resumo.totalServicoTerceiro ?? 0) +
                (resumo.totalFuncionario ?? 0),
            ),
          },
        ]}
      />

      <section className="panel">
        <h3>Regras de distribuição</h3>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {Object.values(logica).map((texto, i) => (
            <li key={i}>{texto}</li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h3>Por tipo e via ({porVia.length})</h3>
        <DataTable
          columns={porViaCols}
          rows={porVia.map((row) => ({
            ...row,
            tipo: labelTipoCusto(String(row.tipo ?? "")),
            via: labelViaDistribuicao(String(row.via ?? "")),
          }))}
        />
      </section>

      <section className="panel">
        <h3>Por objeto de destino ({porDestino.length})</h3>
        <DataTable columns={porDestinoCols} rows={porDestino} />
      </section>

      <section className="panel">
        <h3>Transporte → clientes ({destinosTransp.length})</h3>
        <DataTable
          columns={[
            { key: "anomes", label: "Ano/mês", format: "anomes" },
            { key: "origem", label: "Origem" },
            { key: "codEquipamento", label: "Equip." },
            { key: "objetoCustoTransporte", label: "Obj. transporte" },
            { key: "objetoCustoCliente", label: "Obj. cliente" },
            { key: "percentual", label: "%", num: true, format: "percent" },
            { key: "custoEnviado", label: "Enviado", num: true, format: "money" },
          ]}
          rows={destinosTransp}
        />
      </section>

      <section className="panel">
        <h3>Mecanização → clientes ({destinosMec.length})</h3>
        <DataTable
          columns={[
            { key: "anomes", label: "Ano/mês", format: "anomes" },
            { key: "codEquipamento", label: "Equip." },
            { key: "objetoCustoMecanizacao", label: "Obj. mecanização" },
            { key: "objetoCustoCliente", label: "Obj. cliente" },
            { key: "percentual", label: "%", num: true, format: "percent" },
            { key: "custoEnviado", label: "Enviado", num: true, format: "money" },
          ]}
          rows={destinosMec}
        />
      </section>

      {semDestino.length ? (
        <section className="panel">
          <h3>Sem objeto de destino ({semDestino.length})</h3>
          <DataTable
            columns={[
              { key: "anomes", label: "Ano/mês", format: "anomes" },
              { key: "codEquipamento", label: "Equip." },
              { key: "codOperacaoAgricola", label: "Operação" },
              { key: "viaOficina", label: "Via oficina" },
              { key: "custoTotal", label: "Total", num: true, format: "money" },
            ]}
            rows={semDestino}
          />
        </section>
      ) : null}
    </>
  );
}

export function ReconciliacaoPanel({
  payload,
  titulo,
}: {
  payload: Record<string, unknown>;
  titulo: string;
}) {
  const resumo = (payload.resumo ?? {}) as Record<string, unknown>;
  const motivos = (payload.motivos ?? []) as { texto?: string }[];
  const porMes = (payload.porMes ?? []) as Row[];
  const fluxo = (payload.fluxo ?? {}) as Record<string, unknown>;
  const destinoFluxo = (fluxo.destino ?? []) as Row[];
  const semOs = (payload.mesesSemOs ?? []) as Row[];

  return (
    <>
      <KpiGrid
        items={[
          { label: "Origem", value: formatBRL(Number(resumo.totalOrigem ?? 0)) },
          {
            label: "No consolidado",
            value: formatBRL(Number(resumo.totalNoConsolidado ?? resumo.totalRateado ?? 0)),
          },
          { label: "Diferença", value: formatBRL(Number(resumo.diferenca ?? 0)) },
          { label: "Meses sem OS", value: formatBRL(Number(resumo.totalMesesSemOs ?? 0)) },
        ]}
      />

      {motivos.length ? (
        <section className="panel">
          <h3>
            Diagnóstico — por que {resumo.bate ? "bate" : "não bate"} ({titulo})
          </h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {motivos.map((m, i) => (
              <li key={i}>{m.texto}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel">
        <h3>Por mês</h3>
        <DataTable
          columns={[
            { key: "anomes", label: "Ano/mês", format: "anomes" },
            { key: "valorOrigem", label: "Origem", num: true, format: "money" },
            { key: "valorRateado", label: "Rateado", num: true, format: "money" },
            { key: "diferenca", label: "Diferença", num: true, format: "money" },
            { key: "qtdLancamentos", label: "Lanç.", num: true },
          ]}
          rows={porMes}
        />
      </section>

      <section className="panel">
        <h3>Fluxo de destino ({destinoFluxo.length})</h3>
        <DataTable
          columns={[
            { key: "anomes", label: "Ano/mês", format: "anomes" },
            { key: "codEquipamento", label: "Equip." },
            { key: "via", label: "Via" },
            { key: "codOperacaoAgricola", label: "Operação" },
            { key: "objetoCusto", label: "Objeto" },
            { key: "codFazenda", label: "Fazenda" },
            { key: "codTalhao", label: "Talhão" },
            { key: "kmhsRodados", label: "km/hs", num: true, format: "hours" },
            { key: "percentualEnvio", label: "% envio", num: true, format: "percent" },
            { key: "custoEnviado", label: "Enviado", num: true, format: "money" },
          ]}
          rows={destinoFluxo.map((row) => ({ ...row, via: viaLabel(row.via) }))}
        />
      </section>

      {semOs.length ? (
        <section className="panel">
          <h3>Meses sem OS ({semOs.length})</h3>
          <DataTable
            columns={[
              { key: "anomes", label: "Ano/mês", format: "anomes" },
              { key: "valorOrigem", label: "Origem", num: true, format: "money" },
              { key: "horasTotal", label: "Horas", num: true, format: "hours" },
            ]}
            rows={semOs}
          />
        </section>
      ) : null}
    </>
  );
}

export function MaterialFluxoPanel({ payload }: { payload: Record<string, unknown> }) {
  const resumo = (payload.resumo ?? {}) as Record<string, number>;
  const logica = (payload.logica ?? {}) as Record<string, string>;
  const porMaterial = (payload.porMaterial ?? []) as Row[];
  const porVia = (payload.porVia ?? []) as Row[];

  return (
    <>
      <KpiGrid
        items={[
          { label: "Total", value: formatBRL(resumo.total ?? 0) },
          { label: "Apontamento", value: formatBRL(resumo.apontamento ?? 0) },
          { label: "Objeto requisição", value: formatBRL(resumo.objetoRequisicao ?? 0) },
          { label: "Sem destino", value: formatBRL(resumo.semDestino ?? 0) },
        ]}
      />

      {Object.keys(logica).length ? (
        <section className="panel">
          <h3>Lógica</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {Object.values(logica).map((texto, i) => (
              <li key={i}>{texto}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel">
        <h3>Por via ({porVia.length})</h3>
        <DataTable
          columns={[
            { key: "via", label: "Via" },
            { key: "valor", label: "Valor", num: true, format: "money" },
            { key: "qtdLinhas", label: "Linhas", num: true },
            { key: "percentual", label: "%", num: true, format: "percent" },
          ]}
          rows={porVia.map((row) => ({
            ...row,
            via: labelViaDistribuicao(String(row.via ?? "")),
          }))}
        />
      </section>

      <section className="panel">
        <h3>Por material ({porMaterial.length})</h3>
        <DataTable
          columns={[
            { key: "codMaterial", label: "Material" },
            { key: "descricaoMaterial", label: "Descrição" },
            { key: "quantidade", label: "Qtde", num: true, format: "hours" },
            { key: "valorTotal", label: "Valor", num: true, format: "money" },
            { key: "apontamento", label: "Apontamento", num: true, format: "money" },
            { key: "objetoRequisicao", label: "Obj. requisição", num: true, format: "money" },
          ]}
          rows={porMaterial}
        />
      </section>
    </>
  );
}

export function formatAnomesCell(anomes: unknown) {
  return formatAnomesDisplay(anomes);
}

export function moneyCell(value: unknown) {
  return formatConsultaValue(value, "money");
}
