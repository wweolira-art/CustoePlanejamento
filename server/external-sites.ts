import { db } from "./db.js";

export type ExternalSiteItemRow = {
  id: number;
  group_id: number;
  label: string;
  url: string;
  sort_order: number;
  visible: number;
};

export type ExternalSiteGroupRow = {
  id: number;
  label: string;
  slug: string;
  sort_order: number;
  visible: number;
  native_key: string | null;
};

export type ExternalSiteItem = {
  id: number;
  groupId: number;
  label: string;
  url: string;
  sortOrder: number;
  visible: boolean;
};

export type ExternalSiteGroup = {
  id: number;
  label: string;
  slug: string;
  sortOrder: number;
  visible: boolean;
  nativeKey: string | null;
  items: ExternalSiteItem[];
  hiddenNativeTabs: string[];
};

export const EXTERNAL_EMBED_TARGETS = [
  { nativeKey: "cost-planning", label: "Custo e Planejamento", hideSidebar: false },
  { nativeKey: "gestao-colheita", label: "Gestão de colheita", hideSidebar: false },
  { nativeKey: "indicadores", label: "Indicadores", hideSidebar: false },
] as const;

export type ExternalSiteEmbedNativeKey = (typeof EXTERNAL_EMBED_TARGETS)[number]["nativeKey"];

const EMBED_GROUP_LABELS: Record<ExternalSiteEmbedNativeKey, string> = {
  "cost-planning": "Custo e Planejamento",
  "gestao-colheita": "Gestão de colheita",
  indicadores: "Indicadores",
};

function slugify(text: string) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function normalizeSiteUrl(raw: string) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new Error("Informe a URL do site.");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function mapItem(row: ExternalSiteItemRow): ExternalSiteItem {
  return {
    id: row.id,
    groupId: row.group_id,
    label: row.label,
    url: row.url,
    sortOrder: row.sort_order,
    visible: row.visible !== 0,
  };
}

function listHiddenNativeTabs(nativeKey: string | null) {
  if (!nativeKey) return [] as string[];
  ensureExternalSitesSchema();
  const rows = db
    .prepare("SELECT tab_id FROM native_tab_hidden WHERE native_key = ?")
    .all(nativeKey) as Array<{ tab_id: string }>;
  return rows.map((row) => row.tab_id);
}

function mapGroup(row: ExternalSiteGroupRow, items: ExternalSiteItem[]): ExternalSiteGroup {
  return {
    id: row.id,
    label: row.label,
    slug: row.slug,
    sortOrder: row.sort_order,
    visible: row.visible !== 0,
    nativeKey: row.native_key,
    items,
    hiddenNativeTabs: listHiddenNativeTabs(row.native_key),
  };
}

export function ensureExternalSitesSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS external_site_groups (
      id INTEGER PRIMARY KEY,
      label TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      visible INTEGER NOT NULL DEFAULT 1,
      native_key TEXT
    );

    CREATE TABLE IF NOT EXISTS external_site_items (
      id INTEGER PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES external_site_groups(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      visible INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS native_tab_hidden (
      native_key TEXT NOT NULL,
      tab_id TEXT NOT NULL,
      PRIMARY KEY (native_key, tab_id)
    );
  `);
}

/** Remove a aba legada Orca Safra (iframe standalone no menu lateral). */
export function removeLegacyOrcaSafraScreen() {
  db.prepare(`
    DELETE FROM external_site_groups
    WHERE slug = ?
       OR (native_key IS NULL AND LOWER(label) LIKE '%orca%safra%')
  `).run("orca-safra");
  db.prepare(`
    DELETE FROM external_site_items
    WHERE LOWER(url) LIKE '%orcasafra.vercel.app%'
      AND LOWER(url) NOT LIKE '%/api/%'
  `).run();
}

function isLegacyOrcaSafraGroupRow(row: ExternalSiteGroupRow) {
  if (row.slug === "orca-safra") return true;
  if (row.native_key) return false;
  const label = row.label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return label.includes("orca") && label.includes("safra");
}

function isLegacyOrcaSafraItemUrl(url: string) {
  const lower = url.toLowerCase();
  return lower.includes("orcasafra.vercel.app") && !lower.includes("/api/");
}

export function seedExternalSites() {
  ensureExternalSitesSchema();
  const upsertGroup = db.prepare(`
    INSERT INTO external_site_groups (label, slug, sort_order, visible, native_key)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(slug) DO UPDATE SET
      label = excluded.label,
      native_key = COALESCE(external_site_groups.native_key, excluded.native_key)
  `);

  upsertGroup.run("Custo e Planejamento", "cost-planning", 46, "cost-planning");
  upsertGroup.run("Indicadores", "indicadores", 43, "indicadores");

  removeLegacyOrcaSafraScreen();

  const done = db.prepare("SELECT value FROM meta WHERE key = 'external_sites_seed'").get() as { value: string } | undefined;
  if (done?.value === "v2") return;

  const tx = db.transaction(() => {
    upsertGroup.run("Gestão de colheita", "gestao-colheita", 45, "gestao-colheita");
    upsertGroup.run("Custo e Planejamento", "cost-planning", 46, "cost-planning");

    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('external_sites_seed', 'v2')").run();
  });
  tx();
}

export function listExternalSiteGroups(): ExternalSiteGroup[] {
  ensureExternalSitesSchema();
  const groups = db
    .prepare("SELECT * FROM external_site_groups WHERE visible = 1 ORDER BY sort_order, id")
    .all() as ExternalSiteGroupRow[];
  const itemStmt = db.prepare(
    "SELECT * FROM external_site_items WHERE group_id = ? AND visible = 1 ORDER BY sort_order, id",
  );
  return groups
    .filter((group) => !isLegacyOrcaSafraGroupRow(group))
    .map((group) => {
      const items = (itemStmt.all(group.id) as ExternalSiteItemRow[])
        .filter((item) => !isLegacyOrcaSafraItemUrl(item.url))
        .map(mapItem);
      return mapGroup(group, items);
    });
}

export function listExternalSiteGroupsAdmin(): ExternalSiteGroup[] {
  ensureExternalSitesSchema();
  const groups = db
    .prepare("SELECT * FROM external_site_groups ORDER BY sort_order, id")
    .all() as ExternalSiteGroupRow[];
  const itemStmt = db.prepare("SELECT * FROM external_site_items WHERE group_id = ? ORDER BY sort_order, id");
  return groups.map((group) => {
    const items = (itemStmt.all(group.id) as ExternalSiteItemRow[]).map(mapItem);
    return mapGroup(group, items);
  });
}

function nextGroupSort() {
  const row = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS n FROM external_site_groups").get() as { n: number };
  return row.n + 1;
}

function nextItemSort(groupId: number) {
  const row = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS n FROM external_site_items WHERE group_id = ?")
    .get(groupId) as { n: number };
  return row.n + 1;
}

function uniqueSlug(base: string) {
  let slug = slugify(base) || "site";
  let attempt = slug;
  let i = 2;
  while (db.prepare("SELECT id FROM external_site_groups WHERE slug = ?").get(attempt)) {
    attempt = `${slug}-${i}`;
    i += 1;
  }
  return attempt;
}

export function findGroupByNativeKey(nativeKey: string) {
  return db
    .prepare("SELECT * FROM external_site_groups WHERE native_key = ? LIMIT 1")
    .get(nativeKey) as ExternalSiteGroupRow | undefined;
}

export function ensureNativeEmbedGroup(nativeKey: ExternalSiteEmbedNativeKey) {
  ensureExternalSitesSchema();
  const existing = findGroupByNativeKey(nativeKey);
  if (existing) return existing;
  const label = EMBED_GROUP_LABELS[nativeKey];
  const id = Number(
    db
      .prepare(
        "INSERT INTO external_site_groups (label, slug, sort_order, visible, native_key) VALUES (?, ?, ?, 1, ?)",
      )
      .run(label, nativeKey, nextGroupSort(), nativeKey).lastInsertRowid,
  );
  return db.prepare("SELECT * FROM external_site_groups WHERE id = ?").get(id) as ExternalSiteGroupRow;
}

export function getExternalSitesForEmbed(nativeKey: ExternalSiteEmbedNativeKey) {
  const group = findGroupByNativeKey(nativeKey);
  if (!group) return [];
  return (db
    .prepare("SELECT * FROM external_site_items WHERE group_id = ? AND visible = 1 ORDER BY sort_order, id")
    .all(group.id) as ExternalSiteItemRow[]).map(mapItem);
}

export function findGroupByLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  return db
    .prepare("SELECT * FROM external_site_groups WHERE LOWER(label) = ? LIMIT 1")
    .get(normalized) as ExternalSiteGroupRow | undefined;
}

export function createExternalSiteGroup(input: { label: string; slug?: string; nativeKey?: string | null }) {
  ensureExternalSitesSchema();
  const label = String(input.label || "").trim();
  if (!label) throw new Error("Informe o nome da aba.");
  const slug = input.slug?.trim() ? uniqueSlug(input.slug) : uniqueSlug(label);
  const id = Number(
    db
      .prepare(
        "INSERT INTO external_site_groups (label, slug, sort_order, visible, native_key) VALUES (?, ?, ?, 1, ?)",
      )
      .run(label, slug, nextGroupSort(), input.nativeKey ?? null).lastInsertRowid,
  );
  return listExternalSiteGroupsAdmin().find((group) => group.id === id)!;
}

export function createExternalSiteItem(input: { groupId: number; label: string; url: string }) {
  ensureExternalSitesSchema();
  const label = String(input.label || "").trim();
  if (!label) throw new Error("Informe o nome da subaba.");
  const url = normalizeSiteUrl(input.url);
  const group = db.prepare("SELECT id FROM external_site_groups WHERE id = ?").get(input.groupId) as { id: number } | undefined;
  if (!group) throw new Error("Aba não encontrada.");
  const id = Number(
    db
      .prepare("INSERT INTO external_site_items (group_id, label, url, sort_order, visible) VALUES (?, ?, ?, ?, 1)")
      .run(group.id, label, url, nextItemSort(group.id)).lastInsertRowid,
  );
  const row = db.prepare("SELECT * FROM external_site_items WHERE id = ?").get(id) as ExternalSiteItemRow;
  return mapItem(row);
}

export function registerExternalSite(input: {
  tabLabel?: string;
  subTabLabel: string;
  url: string;
  embedNativeKey?: ExternalSiteEmbedNativeKey | null;
  groupId?: number | null;
}) {
  const subTabLabel = String(input.subTabLabel || "").trim();
  if (!subTabLabel) throw new Error("Informe a subaba.");
  let group: ExternalSiteGroupRow | undefined;
  if (input.groupId) {
    group = db.prepare("SELECT * FROM external_site_groups WHERE id = ?").get(input.groupId) as
      | ExternalSiteGroupRow
      | undefined;
    if (!group) throw new Error("Aba não encontrada.");
  } else if (input.embedNativeKey) {
    group = ensureNativeEmbedGroup(input.embedNativeKey);
  } else {
    const tabLabel = String(input.tabLabel || "").trim();
    if (!tabLabel) throw new Error("Informe a aba de destino.");
    group = findGroupByLabel(tabLabel);
    if (!group) {
      const created = createExternalSiteGroup({ label: tabLabel });
      group = db.prepare("SELECT * FROM external_site_groups WHERE id = ?").get(created.id) as ExternalSiteGroupRow;
    }
  }
  const item = createExternalSiteItem({ groupId: group.id, label: subTabLabel, url: input.url });
  return { group: listExternalSiteGroupsAdmin().find((row) => row.id === group!.id)!, item };
}

export function updateExternalSiteGroup(
  id: number,
  patch: Partial<{ label: string; sortOrder: number; visible: boolean }>,
) {
  const current = db.prepare("SELECT * FROM external_site_groups WHERE id = ?").get(id) as ExternalSiteGroupRow | undefined;
  if (!current) throw new Error("Aba não encontrada.");
  db.prepare("UPDATE external_site_groups SET label = ?, sort_order = ?, visible = ? WHERE id = ?").run(
    patch.label !== undefined ? patch.label.trim() || current.label : current.label,
    patch.sortOrder !== undefined ? patch.sortOrder : current.sort_order,
    patch.visible !== undefined ? (patch.visible ? 1 : 0) : current.visible,
    id,
  );
}

export function resolveExternalSiteDestination(input: {
  groupId?: number | null;
  embedNativeKey?: ExternalSiteEmbedNativeKey | null;
  tabLabel?: string;
}) {
  if (input.groupId) {
    const group = db.prepare("SELECT id FROM external_site_groups WHERE id = ?").get(input.groupId) as
      | { id: number }
      | undefined;
    if (!group) throw new Error("Aba não encontrada.");
    return group.id;
  }
  if (input.embedNativeKey) {
    return ensureNativeEmbedGroup(input.embedNativeKey).id;
  }
  const tabLabel = String(input.tabLabel || "").trim();
  if (!tabLabel) throw new Error("Informe a aba de destino.");
  let group = findGroupByLabel(tabLabel);
  if (!group) {
    const created = createExternalSiteGroup({ label: tabLabel });
    group = db.prepare("SELECT * FROM external_site_groups WHERE id = ?").get(created.id) as ExternalSiteGroupRow;
  }
  return group.id;
}

export function updateExternalSiteItem(
  id: number,
  patch: Partial<{
    label: string;
    url: string;
    sortOrder: number;
    visible: boolean;
    groupId: number;
    embedNativeKey: ExternalSiteEmbedNativeKey;
    tabLabel: string;
  }>,
) {
  const current = db.prepare("SELECT * FROM external_site_items WHERE id = ?").get(id) as ExternalSiteItemRow | undefined;
  if (!current) throw new Error("Subaba não encontrada.");
  let groupId = current.group_id;
  if (patch.groupId !== undefined || patch.embedNativeKey !== undefined || patch.tabLabel !== undefined) {
    groupId = resolveExternalSiteDestination({
      groupId: patch.groupId,
      embedNativeKey: patch.embedNativeKey,
      tabLabel: patch.tabLabel,
    });
  }
  const sortOrder =
    groupId !== current.group_id
      ? nextItemSort(groupId)
      : patch.sortOrder !== undefined
        ? patch.sortOrder
        : current.sort_order;
  db.prepare("UPDATE external_site_items SET group_id = ?, label = ?, url = ?, sort_order = ?, visible = ? WHERE id = ?").run(
    groupId,
    patch.label !== undefined ? patch.label.trim() || current.label : current.label,
    patch.url !== undefined ? normalizeSiteUrl(patch.url) : current.url,
    sortOrder,
    patch.visible !== undefined ? (patch.visible ? 1 : 0) : current.visible,
    id,
  );
  const row = db.prepare("SELECT * FROM external_site_items WHERE id = ?").get(id) as ExternalSiteItemRow;
  return mapItem(row);
}

export function deleteExternalSiteItem(id: number) {
  db.prepare("DELETE FROM external_site_items WHERE id = ?").run(id);
}

export function deleteExternalSiteGroup(id: number) {
  const group = db.prepare("SELECT native_key FROM external_site_groups WHERE id = ?").get(id) as
    | { native_key: string | null }
    | undefined;
  if (!group) throw new Error("Aba não encontrada.");
  if (group.native_key === "gestao-colheita" || group.native_key === "cost-planning" || group.native_key === "indicadores") {
    throw new Error(`A aba ${EMBED_GROUP_LABELS[group.native_key as ExternalSiteEmbedNativeKey] ?? group.native_key} é nativa e não pode ser excluída.`);
  }
  db.prepare("DELETE FROM external_site_groups WHERE id = ?").run(id);
}

export function parseEmbedNativeKey(value: unknown): ExternalSiteEmbedNativeKey | null {
  if (value === "cost-planning" || value === "gestao-colheita" || value === "indicadores") return value;
  return null;
}

export function setNativeTabHidden(nativeKey: string, tabId: string, hidden: boolean) {
  const key = parseEmbedNativeKey(nativeKey);
  if (!key) throw new Error("Aba nativa inválida.");
  const id = String(tabId || "").trim();
  if (!id) throw new Error("Informe a subaba.");
  ensureExternalSitesSchema();
  if (hidden) {
    db.prepare("INSERT OR IGNORE INTO native_tab_hidden (native_key, tab_id) VALUES (?, ?)").run(key, id);
  } else {
    db.prepare("DELETE FROM native_tab_hidden WHERE native_key = ? AND tab_id = ?").run(key, id);
  }
  return { nativeKey: key, tabId: id, hidden, hiddenNativeTabs: listHiddenNativeTabs(key) };
}

export function getExternalSiteGroup(id: number) {
  const group = db.prepare("SELECT * FROM external_site_groups WHERE id = ?").get(id) as ExternalSiteGroupRow | undefined;
  if (!group) return null;
  const items = (db
    .prepare("SELECT * FROM external_site_items WHERE group_id = ? AND visible = 1 ORDER BY sort_order, id")
    .all(id) as ExternalSiteItemRow[]).map(mapItem);
  return mapGroup(group, items);
}
