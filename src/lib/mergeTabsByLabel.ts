export function normalizeTabLabel(label: string) {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export type MergedTabGroup<T extends { label: string }> = {
  key: string;
  label: string;
  items: T[];
};

export function mergeTabsByLabel<T extends { label: string }>(items: T[]): MergedTabGroup<T>[] {
  const groups = new Map<string, MergedTabGroup<T>>();
  for (const item of items) {
    const key = normalizeTabLabel(item.label);
    const prev = groups.get(key);
    if (prev) {
      prev.items.push(item);
      continue;
    }
    groups.set(key, { key, label: item.label, items: [item] });
  }
  return [...groups.values()];
}

export function externalFrameTitle(label: string, url: string, showDetail: boolean) {
  if (!showDetail) return label;
  try {
    const host = new URL(url).hostname;
    return host ? `${label} (${host})` : label;
  } catch {
    return label;
  }
}

export function isFuncionarioExternalReport(label: string, url?: string) {
  if (normalizeTabLabel(label) === "funcionario") return true;
  if (/funcion/i.test(label)) return true;
  if (url) {
    try {
      if (/orcasafra/i.test(url)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}
