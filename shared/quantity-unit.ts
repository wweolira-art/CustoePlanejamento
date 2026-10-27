export const QUANTITY_UNITS = [
  { value: "ha", label: "Área (ha)" },
  { value: "t", label: "Toneladas (t)" },
  { value: "kg", label: "Quilos (kg)" },
  { value: "un", label: "Unidades (un)" },
] as const;

export type QuantityUnit = typeof QUANTITY_UNITS[number]["value"];
export function quantityUnit(value: unknown): QuantityUnit {
  return QUANTITY_UNITS.find((unit) => unit.value === value)?.value ?? "un";
}
