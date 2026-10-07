export type IndicadoresReportId =
  | "irrigacao"
  | "meteorologico"
  | "mapa-fazendas"
  | "colheita-producao"
  | "controle-estoque"
  | "disponibilidade-equipamentos"
  | "combustivel"
  | "pneus"
  | "manutencao"
  | "gestao-manutencao"
  | "lubrificacao"
  | "materiais";

export type NativeEmbedTab = { id: string; label: string; native?: boolean };

export const INDICADORES_GROUPS: { title: string; reports: Array<NativeEmbedTab & { id: IndicadoresReportId }> }[] = [
  {
    title: "Agrícola",
    reports: [
      { id: "irrigacao", label: "Irrigação", native: true },
      { id: "meteorologico", label: "Relatório meteorológico" },
      { id: "mapa-fazendas", label: "Mapa fazendas", native: true },
      { id: "colheita-producao", label: "Gestão de colheita-CTT", native: true },
      { id: "controle-estoque", label: "Controle de estoque", native: true },
    ],
  },
  {
    title: "Automotivo",
    reports: [
      { id: "combustivel", label: "Combustível", native: true },
      { id: "pneus", label: "Controle de pneus", native: true },
      { id: "manutencao", label: "Manutenção programada", native: true },
      { id: "gestao-manutencao", label: "Gestão de manutenção", native: true },
      { id: "lubrificacao", label: "Controle de lubrificação", native: true },
      { id: "disponibilidade-equipamentos", label: "Disponibilidade equipamentos", native: true },
      { id: "materiais", label: "Gestão de materiais", native: true },
    ],
  },
];

export const INDICADORES_REPORTS = INDICADORES_GROUPS.flatMap((entry) => entry.reports);

export const GESTAO_COLHEITA_EMBED_TABS: NativeEmbedTab[] = [
  { id: "entrada-caminhao", label: "Entrada cana caminhão", native: true },
  { id: "entrada-maquina", label: "Entrada cana máquina", native: true },
  { id: "associar-equipamento", label: "Associar equipamento", native: true },
  { id: "horas-maquina", label: "Horas máquina", native: true },
  { id: "associar-fazenda", label: "Associar fazenda", native: true },
  { id: "encerramento-ordens", label: "Encerrar ordens colheita", native: true },
  { id: "liberacao-colheita", label: "Liberação de colheita", native: true },
  { id: "resumo-transporte", label: "Resumo transporte cana", native: true },
  { id: "import", label: "Importar planilha", native: true },
];

export const NATIVE_EMBED_TABS: Record<string, NativeEmbedTab[]> = {
  indicadores: INDICADORES_REPORTS,
  "gestao-colheita": GESTAO_COLHEITA_EMBED_TABS,
};

export function nativeTabsForGroup(nativeKey: string | null | undefined): NativeEmbedTab[] {
  if (!nativeKey) return [];
  return NATIVE_EMBED_TABS[nativeKey] ?? [];
}

export function isNativeTabHidden(hiddenIds: string[] | undefined, tabId: string) {
  return Boolean(hiddenIds?.includes(tabId));
}
