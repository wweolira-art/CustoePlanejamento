import type { PremiseOption } from "../api";

export type CostCenterNegocioKey = "agricola" | "pecuaria" | "diretoria";

export type CostCenterNegocio = {
  key: CostCenterNegocioKey;
  label: string;
  /** Títulos e nomes de planilha dos centros deste negócio. */
  centers: string[];
};

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Agrupamento de centros de custo por negócio (Agrícola / Pecuária / Diretoria). */
export const COST_CENTER_NEGOCIOS: CostCenterNegocio[] = [
  {
    key: "agricola",
    label: "Agrícola",
    centers: [
      "Oficina",
      "OFICINA",
      "Arrendamento",
      "ARRENDAMENTOS",
      "Preparo de solo",
      "P.SOLO",
      "Corte de semente",
      "CORTE SEMENTE",
      "Plantio",
      "PLANTIO",
      "Tratos de cana planta",
      "T.C.P.",
      "Tratos de cana soca",
      "T.C.S.",
      "Mecanização agrícola",
      "MECANIZAÇÃO AGR.",
      "Colheita mecanizada",
      "C. MECANIZADA",
      "Colheita manual",
      "C. MANUAL",
      "Transporte agrícola",
      "TRANSP.AGRICOLA",
      "Irrigação",
      "IRRIGAÇÃO",
      "Administração",
      "ADMINISTRAÇÃO",
    ],
  },
  {
    key: "pecuaria",
    label: "Pecuária",
    centers: ["Pecuária", "PECUÁRIA"],
  },
  {
    key: "diretoria",
    label: "Diretoria",
    centers: ["Diretoria", "DIRETORIA"],
  },
];

const CENTER_TO_NEGOCIO = (() => {
  const map = new Map<string, CostCenterNegocioKey>();
  for (const negocio of COST_CENTER_NEGOCIOS) {
    for (const center of negocio.centers) {
      map.set(fold(center), negocio.key);
    }
  }
  return map;
})();

export function negocioOptions(): PremiseOption[] {
  return COST_CENTER_NEGOCIOS.map((row) => ({ key: row.key, label: row.label }));
}

export function negocioKeyForCenterLabel(...labels: Array<string | null | undefined>): CostCenterNegocioKey | null {
  for (const label of labels) {
    if (!label) continue;
    const hit = CENTER_TO_NEGOCIO.get(fold(label));
    if (hit) return hit;
  }
  return null;
}

export function centerMatchesNegocios(
  label: string | null | undefined,
  selectedNegocios: string[],
  altLabel?: string | null,
): boolean {
  if (!selectedNegocios.length) return true;
  const key = negocioKeyForCenterLabel(label, altLabel);
  return key != null && selectedNegocios.includes(key);
}

export function filterCenterKeysByNegocio(
  centers: { key: string; label: string; name?: string }[],
  selectedNegocios: string[],
): string[] {
  if (!selectedNegocios.length) return [];
  return centers
    .filter((row) => centerMatchesNegocios(row.label, selectedNegocios, row.name))
    .map((row) => row.key);
}
