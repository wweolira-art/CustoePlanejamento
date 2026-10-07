export const META_OLEO_HIDRAULICO_LT_TON = 0.018;

export type ConsumoOleoMotivo = {
  codigo: string;
  label: string;
  litros: number;
  qtdRemontas: number;
};

export type ConsumoOleoEquipamento = {
  codEquipamento: number;
  descricao: string;
  troca: number;
  remonta: number;
  total: number;
  qtdRemontas: number;
  qtdTrocas: number;
  codMaterial: number | null;
  material: string;
};

export type ConsumoOleoMes = {
  chave: string;
  label: string;
  litros: number;
  toneladas: number;
  ltTon: number | null;
};

export type ConsumoOleoSafra = {
  codigo: string;
  label: string;
  dataInicio: string;
  dataFim: string;
  dias: number;
  litros: number;
  toneladas: number;
  ltTon: number | null;
  porEquipamento: Array<{
    codEquipamento: number;
    litros: number;
  }>;
};

export type ConsumoOleoHidraulicoData = {
  filtros: {
    dataInicio: string;
    dataFim: string;
    safraCode: string | null;
    dias: number;
    metaLtTon: number;
  };
  resumo: {
    litrosRemonta: number;
    litrosTroca: number;
    litrosTotal: number;
    qtdRemontas: number;
    ltTon: number | null;
    toneladas: number;
  };
  motivos: ConsumoOleoMotivo[];
  equipamentos: ConsumoOleoEquipamento[];
  mensal: ConsumoOleoMes[];
  comparativo: {
    equipamentos: number[];
    safras: ConsumoOleoSafra[];
  };
};

export function oleoLtTon(litros: number, toneladas: number): number | null {
  if (!(toneladas > 0) || !Number.isFinite(litros)) return null;
  return Math.round((litros / toneladas) * 1000) / 1000;
}
