import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { OFFICIAL_ACTIVITIES } from "./activities-data.js";
import { COST_CENTERS, SHEET_TITLES } from "./catalog.js";
import { OFFICIAL_COST_OBJECTS } from "./cost-objects-data.js";
import { OFFICIAL_MATERIALS } from "./materials-data.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
fs.mkdirSync(dataDir, { recursive: true });

export const dbPath = path.join(dataDir, "planejamento.db");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS sheets (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS cells (
  sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  row INTEGER NOT NULL,
  col INTEGER NOT NULL,
  formula TEXT,
  value TEXT,
  PRIMARY KEY (sheet_id, row, col)
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lines (
  id INTEGER PRIMARY KEY,
  sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  object_code TEXT,
  product_code TEXT,
  item_type TEXT,
  description TEXT NOT NULL,
  is_group INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS line_months (
  line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  month_index INTEGER NOT NULL,
  formula TEXT,
  value TEXT,
  PRIMARY KEY (line_id, month_index)
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  empenho TEXT
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('E', 'G')),
  empenho TEXT,
  valor REAL
);

CREATE TABLE IF NOT EXISTS cost_objects (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fazendas (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  distancia REAL
);

CREATE TABLE IF NOT EXISTS category_catalog (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS safras (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calc_params (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('material', 'activity')),
  material_id INTEGER REFERENCES materials(id) ON DELETE CASCADE,
  activity_id INTEGER REFERENCES activities(id) ON DELETE CASCADE,
  premise TEXT NOT NULL,
  dose REAL,
  rate_ha REAL,
  price REAL,
  safra_id INTEGER REFERENCES safras(id)
);

CREATE TABLE IF NOT EXISTS premissa_values (
  safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
  subprocess_key TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  start_day TEXT,
  end_day TEXT,
  PRIMARY KEY (safra_id, subprocess_key)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sheet_verifications (
  sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
  PRIMARY KEY (sheet_id, safra_id)
);

CREATE TABLE IF NOT EXISTS harvest_areas (
  id INTEGER PRIMARY KEY,
  safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  area REAL NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS value_distributions (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  safra_id INTEGER REFERENCES safras(id) ON DELETE CASCADE,
  activity_id INTEGER NOT NULL,
  activity_name TEXT NOT NULL,
  category_name TEXT NOT NULL,
  total_value REAL NOT NULL,
  months TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS value_distribution_lines (
  id INTEGER PRIMARY KEY,
  distribution_id INTEGER NOT NULL REFERENCES value_distributions(id) ON DELETE CASCADE,
  sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  line_id INTEGER NOT NULL,
  created_line INTEGER NOT NULL DEFAULT 0,
  previous_months TEXT
);
`);

const addColumn = (sql: string) => {
  try {
    db.exec(sql);
  } catch {
    /* coluna já existe */
  }
};

addColumn("ALTER TABLE lines ADD COLUMN activity_id INTEGER REFERENCES activities(id)");
addColumn("ALTER TABLE lines ADD COLUMN material_id INTEGER REFERENCES materials(id)");
addColumn("ALTER TABLE lines ADD COLUMN cost_object_id INTEGER REFERENCES cost_objects(id)");
addColumn("ALTER TABLE lines ADD COLUMN ref_kind TEXT");
addColumn("ALTER TABLE lines ADD COLUMN parent_id INTEGER REFERENCES lines(id)");
addColumn("ALTER TABLE materials ADD COLUMN valor REAL");
addColumn("ALTER TABLE materials ADD COLUMN grupo TEXT");
addColumn("ALTER TABLE activities ADD COLUMN valor REAL");
addColumn("ALTER TABLE activities ADD COLUMN empenho TEXT");
addColumn("ALTER TABLE calc_params ADD COLUMN rate_ha REAL");
addColumn("ALTER TABLE calc_params ADD COLUMN safra_id INTEGER REFERENCES safras(id)");
addColumn("ALTER TABLE calc_params ADD COLUMN price REAL");
addColumn("ALTER TABLE calc_params ADD COLUMN exclude_weekdays TEXT");
addColumn("ALTER TABLE calc_params ADD COLUMN area_premise TEXT");
addColumn("ALTER TABLE calc_params ADD COLUMN from_materials INTEGER NOT NULL DEFAULT 0");
addColumn("ALTER TABLE calc_params ADD COLUMN calc_mode TEXT NOT NULL DEFAULT 'area'");
addColumn("ALTER TABLE lines ADD COLUMN use_activity_auto INTEGER NOT NULL DEFAULT 1");
addColumn("ALTER TABLE lines ADD COLUMN start_month INTEGER");
addColumn("ALTER TABLE lines ADD COLUMN end_month INTEGER");
addColumn("ALTER TABLE lines ADD COLUMN calc_premise TEXT");
addColumn("ALTER TABLE lines ADD COLUMN calc_dose REAL");
addColumn("ALTER TABLE lines ADD COLUMN calc_price REAL");
addColumn("ALTER TABLE lines ADD COLUMN calc_exclude_weekdays TEXT");
addColumn("ALTER TABLE lines ADD COLUMN calc_area_premise TEXT");
addColumn("ALTER TABLE lines ADD COLUMN calc_area_pct REAL");
addColumn("ALTER TABLE lines ADD COLUMN calc_area_ha REAL");
addColumn("ALTER TABLE lines ADD COLUMN calc_months TEXT");
addColumn("ALTER TABLE lines ADD COLUMN calc_plans TEXT");
addColumn("ALTER TABLE lines ADD COLUMN calc_reduce_pct REAL");
addColumn("ALTER TABLE lines ADD COLUMN calc_applications REAL");
addColumn("ALTER TABLE lines ADD COLUMN calc_direct INTEGER NOT NULL DEFAULT 0");
addColumn("ALTER TABLE lines ADD COLUMN calc_kind TEXT");
addColumn("ALTER TABLE lines ADD COLUMN calc_trips REAL");
addColumn("ALTER TABLE lines ADD COLUMN calc_machine_qty REAL");
addColumn("ALTER TABLE lines ADD COLUMN calc_hour_interval REAL");
addColumn("ALTER TABLE lines ADD COLUMN obc_split_group TEXT");
addColumn("ALTER TABLE fazendas ADD COLUMN distancia REAL");
addColumn("ALTER TABLE categories ADD COLUMN catalog_id INTEGER REFERENCES category_catalog(id)");
addColumn("ALTER TABLE lines ADD COLUMN center_sheet_id INTEGER REFERENCES sheets(id)");
addColumn("ALTER TABLE lines ADD COLUMN funcionario_api_config TEXT");

export function linkLineCatalogs() {
  db.exec(`
    UPDATE lines
    SET cost_object_id = (SELECT id FROM cost_objects WHERE cost_objects.code = lines.object_code)
    WHERE cost_object_id IS NULL AND object_code IS NOT NULL AND TRIM(object_code) != '';

    UPDATE lines
    SET material_id = (SELECT id FROM materials WHERE materials.code = lines.product_code),
        ref_kind = 'material'
    WHERE product_code IS NOT NULL AND TRIM(product_code) != ''
      AND material_id IS NULL
      AND (ref_kind IS NULL OR TRIM(COALESCE(ref_kind, '')) = '')
      AND NOT (
        COALESCE(is_group, 0) = 1
        AND TRIM(COALESCE(product_code, '')) <> ''
      );

    UPDATE lines
    SET ref_kind = 'activity'
    WHERE activity_id IS NOT NULL AND (ref_kind IS NULL OR ref_kind = '');
  `);
}

export function seedOfficialActivities(force = false) {
  const done = db.prepare("SELECT value FROM meta WHERE key = 'activities_catalog'").get() as { value: string } | undefined;
  if (done?.value === "oficial-2026-08" && !force) return;

  const ins = db.prepare("INSERT INTO activities (code, description) VALUES (?, ?)");
  const tx = db.transaction(() => {
    db.exec("UPDATE lines SET activity_id = NULL WHERE activity_id IS NOT NULL");
    db.exec("DELETE FROM activities");
    for (const row of OFFICIAL_ACTIVITIES) {
      ins.run(row.code, row.description);
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('activities_catalog', 'oficial-2026-08')").run();
  });
  tx();
}

export function seedOfficialCostObjects(force = false) {
  const done = db.prepare("SELECT value FROM meta WHERE key = 'cost_objects_catalog'").get() as { value: string } | undefined;
  if (done?.value === "oficial-2026-08" && !force) return;

  const ins = db.prepare("INSERT INTO cost_objects (code, description) VALUES (?, ?)");
  const tx = db.transaction(() => {
    db.exec("UPDATE lines SET cost_object_id = NULL WHERE cost_object_id IS NOT NULL");
    db.exec("DELETE FROM cost_objects");
    for (const row of OFFICIAL_COST_OBJECTS) {
      ins.run(row.code, row.description);
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('cost_objects_catalog', 'oficial-2026-08')").run();
  });
  tx();
}

export function seedOfficialMaterials(force = false) {
  const done = db.prepare("SELECT value FROM meta WHERE key = 'materials_catalog'").get() as { value: string } | undefined;
  if (done?.value === "oficial-2026-08" && !force) return;

  const ins = db.prepare(
    "INSERT INTO materials (code, description, tipo, empenho, valor) VALUES (?, ?, 'E', ?, ?)",
  );
  const tx = db.transaction(() => {
    db.exec("UPDATE lines SET material_id = NULL WHERE material_id IS NOT NULL");
    db.exec("DELETE FROM materials");
    for (const row of OFFICIAL_MATERIALS) {
      ins.run(row.code, row.description, row.empenho, row.valor);
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('materials_catalog', 'oficial-2026-08')").run();
  });
  tx();
}

export function seedCategoryCatalog() {
  db.exec(`
    INSERT OR IGNORE INTO category_catalog (name)
    SELECT DISTINCT TRIM(name) FROM categories
    WHERE name IS NOT NULL AND TRIM(name) != '';

    UPDATE categories
    SET catalog_id = (
      SELECT id FROM category_catalog WHERE category_catalog.name = categories.name
    )
    WHERE catalog_id IS NULL;
  `);
}

/** Garante que todo centro de custo do catálogo exista como aba em Orçamentos. */
export function ensureCostCenterSheets() {
  const existing = new Set(
    (db.prepare("SELECT name FROM sheets").all() as { name: string }[]).map((row) => row.name),
  );
  const maxSort = (db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM sheets").get() as { m: number }).m;
  const insert = db.prepare(
    "INSERT INTO sheets (name, title, kind, sort_order, visible) VALUES (?, ?, 'cost_center', ?, 1)",
  );
  let nextSort = maxSort + 1;
  const tx = db.transaction(() => {
    for (const name of COST_CENTERS) {
      if (existing.has(name)) continue;
      insert.run(name, SHEET_TITLES[name] ?? name, nextSort++);
    }
  });
  tx();
}

export function seedCatalogs() {
  seedOfficialActivities();
  seedOfficialCostObjects();
  seedOfficialMaterials();
  seedCategoryCatalog();
  ensureCostCenterSheets();
  linkLineCatalogs();
  db.prepare("INSERT OR IGNORE INTO activities (code, description) VALUES (?, ?)").run("PLANTIO", "PLANTIO");
  try {
    const empty = db.prepare("SELECT COUNT(*) AS n FROM calc_params").get() as { n: number };
    const old = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'calc_rules'").get();
    if (old && empty.n === 0) {
      db.exec(
        `INSERT INTO calc_params (kind, material_id, activity_id, premise, dose)
         SELECT kind, material_id, activity_id, premise, dose FROM calc_rules`,
      );
    }
  } catch {
    /* tabela antiga pode não existir */
  }
}
