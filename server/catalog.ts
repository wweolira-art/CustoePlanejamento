export const SHEET_TITLES: Record<string, string> = {
  RESUMO: "Resumo do orçamento",
  ASS_RESUMO: "Resumo assistido",
  PREMISSAS: "Premissas da safra",
  "premiss HB": "Premissas HB",
  "CORTE SEMENTE": "Corte de semente",
  "P.SOLO": "Preparo de solo",
  PLANTIO: "Plantio",
  "T.C.P.": "Tratos de cana planta",
  "T.C.S.": "Tratos de cana soca",
  "MECANIZAÇÃO AGR.": "Mecanização agrícola",
  "C. MECANIZADA": "Colheita mecanizada",
  "C. MANUAL": "Colheita manual",
  "TRANSP.AGRICOLA": "Transporte agrícola",
  OFICINA: "Oficina",
  IRRIGAÇÃO: "Irrigação",
  ADMINISTRAÇÃO: "Administração",
  PECUÁRIA: "Pecuária",
  DIRETORIA: "Diretoria",
  ARRENDAMENTOS: "Arrendamento",
  "ENERGIA ELETRICA": "Energia elétrica",
  "PRÉ-COLHEITA": "Pré-colheita",
  "DIM. PESSOAL": "Dimensionamento de pessoal",
  "DIM. PESSOAL MENSAL": "Pessoal mensal",
  CONTRATAÇÃO: "Contratação",
  ESCALA: "Escala",
  "PEDIDO DE EPI": "Pedido de EPI",
  "PRODUTOS E INSUMOS": "Produtos e insumos",
  Produção: "Produção",
  "Dim. irrigação": "Dimensionamento de irrigação",
  "PROCEDIMENTOS ": "Procedimentos",
  "IND. DE ORÇAMENTO": "Indicadores de orçamento",
};

export const COST_CENTERS = [
  "CORTE SEMENTE",
  "P.SOLO",
  "PLANTIO",
  "T.C.P.",
  "T.C.S.",
  "MECANIZAÇÃO AGR.",
  "C. MECANIZADA",
  "C. MANUAL",
  "TRANSP.AGRICOLA",
  "OFICINA",
  "IRRIGAÇÃO",
  "ADMINISTRAÇÃO",
  "PECUÁRIA",
  "DIRETORIA",
  "ARRENDAMENTOS",
  "ENERGIA ELETRICA",
  "PRÉ-COLHEITA",
];

export const MONTHS = [
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
];

export function sheetKind(name: string): string {
  if (name === "PREMISSAS" || name === "premiss HB") return "premissas";
  if (name === "RESUMO" || name === "ASS_RESUMO") return "resumo";
  if (COST_CENTERS.includes(name)) return "cost_center";
  return "support";
}

export function isCategoryLabel(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim().toUpperCase();
  return (
    t.startsWith("DESPESAS") ||
    t.startsWith("DEPESAS") ||
    t.startsWith("CUSTOS RECEBIDOS") ||
    t.startsWith("INVESTIMENTOS")
  );
}

export function isTotalLabel(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim().toUpperCase();
  return t.includes("TOTA") && t.includes("GERAL");
}
