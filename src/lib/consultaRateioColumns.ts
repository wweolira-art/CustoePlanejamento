export type ColumnFormat = "money" | "hours" | "percent" | "date" | "anomes";

export type DataColumn = {
  key: string;
  label: string;
  num?: boolean;
  format?: ColumnFormat;
};

export const colunasResumoAtividadeSeparado: DataColumn[] = [
  { key: "objetoCusto", label: "Objeto" },
  { key: "descricao", label: "Atividade" },
  { key: "horas", label: "Horas", num: true, format: "hours" },
  { key: "custoPorHora", label: "R$/h", num: true, format: "money" },
  { key: "litrosPorHora", label: "L/h", num: true, format: "hours" },
  { key: "haPorHora", label: "ha / h", num: true, format: "hours" },
  { key: "custoOficina", label: "Oficina", num: true, format: "money" },
  { key: "custoTransporte", label: "Transporte", num: true, format: "money" },
  { key: "custoMecanizacao", label: "Mecanização", num: true, format: "money" },
  { key: "custoCombustivel", label: "Combustível", num: true, format: "money" },
  { key: "custoMaterial", label: "Material", num: true, format: "money" },
  { key: "custoInsumo", label: "Insumo", num: true, format: "money" },
  { key: "custoServicoTerceiro", label: "Serviços 3º", num: true, format: "money" },
  { key: "custoFuncionario", label: "Funcionário", num: true, format: "money" },
  { key: "custoTotal", label: "Total", num: true, format: "money" },
];

export const colunasAbastecimentos: DataColumn[] = [
  { key: "dataAbastecimento", label: "Data", format: "date" },
  { key: "origem", label: "Origem" },
  { key: "codEquipamento", label: "Equipamento" },
  { key: "modeloEquipamento", label: "Modelo" },
  { key: "codOperacaoAgricola", label: "Cód. operação" },
  { key: "descricaoOperacao", label: "Operação" },
  { key: "objetoCustoOperacao", label: "Obj. custo" },
  { key: "qtdeLitros", label: "Litros", num: true, format: "hours" },
  { key: "horasApontamento", label: "Horas", num: true, format: "hours" },
  { key: "kmhsRodados", label: "km/hs", num: true, format: "hours" },
  { key: "areaHa", label: "Área (ha)", num: true, format: "hours" },
  { key: "litrosPorHora", label: "L/h", num: true, format: "hours" },
  { key: "litrosPorHa", label: "L/ha", num: true, format: "hours" },
  { key: "vrCustoUnitario", label: "Custo unit.", num: true, format: "money" },
  { key: "valorTotal", label: "Custo", num: true, format: "money" },
  { key: "codFazenda", label: "Fazenda" },
  { key: "codTalhao", label: "Talhão" },
];

export const colunasAbastecimentosPorModelo: DataColumn[] = [
  { key: "modeloEquipamento", label: "Modelo" },
  { key: "codModelo", label: "Cód. modelo" },
  { key: "tipoEquipamento", label: "Tipo" },
  { key: "qtdEquipamentos", label: "Equip.", num: true },
  { key: "qtdAbastecimentos", label: "Abast.", num: true },
  { key: "qtdeLitros", label: "Litros", num: true, format: "hours" },
  { key: "horasApontamento", label: "Horas", num: true, format: "hours" },
  { key: "areaHa", label: "Área (ha)", num: true, format: "hours" },
  { key: "litrosPorHora", label: "L/h", num: true, format: "hours" },
  { key: "litrosPorHa", label: "L/ha", num: true, format: "hours" },
  { key: "valorTotal", label: "Custo", num: true, format: "money" },
];

export const colunasMateriais: DataColumn[] = [
  { key: "dataRetiradaApontamento", label: "Data", format: "date" },
  { key: "nrRequisicao", label: "Requisição" },
  { key: "codEquipamento", label: "Equipamento" },
  { key: "codMaterial", label: "Material" },
  { key: "descricaoMaterial", label: "Descrição" },
  { key: "quantidade", label: "Qtde", num: true, format: "hours" },
  { key: "vrCustoUnitario", label: "Custo unit.", num: true, format: "money" },
  { key: "valorTotal", label: "Custo material", num: true, format: "money" },
  { key: "codOperacaoAgricola", label: "Operação" },
  { key: "objetoCustoOperacao", label: "Obj. custo operação" },
  { key: "objetoCustoRequisicao", label: "Obj. custo requisição" },
  { key: "codFazenda", label: "Fazenda" },
  { key: "codTalhao", label: "Talhão" },
];

export const colunasInsumos: DataColumn[] = [
  { key: "dataApontamento", label: "Data", format: "date" },
  { key: "anoApontamento", label: "Ano apont." },
  { key: "nrApontamento", label: "Nr apont." },
  { key: "codMaterial", label: "Material" },
  { key: "quantidade", label: "Qtde", num: true, format: "hours" },
  { key: "vrCustoUnitario", label: "Custo unit.", num: true, format: "money" },
  { key: "valorTotal", label: "Custo insumo", num: true, format: "money" },
  { key: "codOperacaoAgricola", label: "Operação" },
  { key: "objetoCustoOperacao", label: "Obj. custo operação" },
  { key: "codFazenda", label: "Fazenda" },
  { key: "codTalhao", label: "Talhão" },
  { key: "codEquipamento", label: "Equipamento" },
];

export const colunasServicosTerceiro: DataColumn[] = [
  { key: "tipoContrato", label: "Tipo" },
  { key: "dataInicio", label: "Data início", format: "date" },
  { key: "numeroContrato", label: "Contrato" },
  { key: "codFornecedor", label: "Fornecedor" },
  { key: "parcela", label: "Parcela" },
  { key: "codServico", label: "Cód. serviço / origem" },
  { key: "codOperacaoAgricola", label: "Operação" },
  { key: "descricaoOperacao", label: "Descrição" },
  { key: "objetoCustoOperacao", label: "Obj. custo" },
  { key: "quantidade", label: "Qtde", num: true, format: "hours" },
  { key: "vrUnitario", label: "Custo unit.", num: true, format: "money" },
  { key: "valorTotal", label: "Valor", num: true, format: "money" },
  { key: "codFazenda", label: "Fazenda" },
  { key: "codTalhao", label: "Talhão" },
  { key: "codEquipamento", label: "Equipamento" },
  { key: "codEmpenho", label: "Empenho" },
];

export const colunasFuncionarios: DataColumn[] = [
  { key: "anomes", label: "Ano/mês", format: "anomes" },
  { key: "tipo", label: "Tipo lanç." },
  { key: "via", label: "Via" },
  { key: "objetoCustoOperacao", label: "Obj. custo" },
  { key: "descricaoObjeto", label: "Descrição" },
  { key: "negocio", label: "Negócio", num: true },
  { key: "processo", label: "Processo", num: true },
  { key: "subprocesso", label: "Subproc.", num: true },
  { key: "codEmpenho", label: "Empenho" },
  { key: "valorTotal", label: "Valor", num: true, format: "money" },
];

export function formatAnomesDisplay(anomes: unknown) {
  if (anomes == null || anomes === "") return "—";
  const s = String(anomes);
  if (!/^\d{6}$/.test(s)) return s;
  return `${s.slice(4, 6)}/${s.slice(0, 4)}`;
}

export function formatConsultaValue(value: unknown, format?: ColumnFormat) {
  if (value == null || value === "" || (typeof value === "number" && Number.isNaN(value))) return "—";
  if (format === "money") {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
  }
  if (format === "percent") {
    return new Intl.NumberFormat("pt-BR", {
      style: "percent",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value));
  }
  if (format === "hours") {
    return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      Number(value),
    );
  }
  if (format === "anomes") return formatAnomesDisplay(value);
  if (format === "date") {
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : new Intl.DateTimeFormat("pt-BR").format(d);
  }
  return String(value);
}

export function labelTipoCusto(tipo: string) {
  const map: Record<string, string> = {
    oficina: "Oficina",
    transporte: "Transporte",
    mecanizacao: "Mecanização",
    combustivel: "Combustível",
    material: "Material",
    insumo: "Insumo",
    "servico-terceiro": "Serviços 3º",
    funcionario: "Funcionário",
  };
  return map[tipo] ?? tipo;
}

export function labelViaDistribuicao(via: string) {
  const map: Record<string, string> = {
    apontamento: "Apontamento",
    "transporte-cliente": "Transporte → cliente",
    "mecanizacao-cliente": "Mecanização → cliente",
    "colheita-cana": "Colheita cana",
    "objeto-equipamento": "Objeto do equipamento",
    "sem-operacao": "Sem operação",
    "objeto-requisicao": "Objeto requisição",
    "sem-destino": "Sem destino",
    "operacao-contrato": "Operação (contrato)",
    "objeto-contrato": "Objeto (contrato)",
    "residual-mecanizacao": "Residual mecanização",
    "objeto-retido": "Objeto retido",
  };
  return map[via] ?? via;
}
