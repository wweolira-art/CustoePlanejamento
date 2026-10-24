export function indicadorArrendamento(custo, area) {
  return Number.isFinite(area) && area > 0 ? custo / area : null;
}
