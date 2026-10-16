-- Somente estrutura, sem dados. Tabelas temporárias do motor de fórmulas.

CREATE TABLE sheets (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE cells (
  sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  row INTEGER NOT NULL,
  col INTEGER NOT NULL,
  formula TEXT,
  value TEXT,
  PRIMARY KEY (sheet_id, row, col)
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
, catalog_id INTEGER REFERENCES category_catalog(id));

CREATE TABLE lines (
  id INTEGER PRIMARY KEY,
  sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  object_code TEXT,
  product_code TEXT,
  item_type TEXT,
  description TEXT NOT NULL,
  is_group INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
, activity_id INTEGER REFERENCES activities(id), material_id INTEGER REFERENCES materials(id), cost_object_id INTEGER REFERENCES cost_objects(id), ref_kind TEXT, parent_id INTEGER REFERENCES lines(id), use_activity_auto INTEGER NOT NULL DEFAULT 1, start_month INTEGER, end_month INTEGER, calc_premise TEXT, calc_dose REAL, calc_price REAL, calc_exclude_weekdays TEXT, calc_area_premise TEXT, calc_area_pct REAL, calc_area_ha REAL, calc_months TEXT, calc_applications REAL, calc_direct INTEGER NOT NULL DEFAULT 0, center_sheet_id INTEGER REFERENCES sheets(id), calc_kind TEXT, calc_trips REAL, calc_machine_qty REAL, calc_plans TEXT, calc_reduce_pct REAL, calc_hour_interval REAL, funcionario_api_config TEXT, obc_split_group TEXT);

CREATE TABLE line_months (
  line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  month_index INTEGER NOT NULL,
  formula TEXT,
  value TEXT,
  PRIMARY KEY (line_id, month_index)
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE activities (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
, valor REAL, empenho TEXT);

CREATE TABLE materials (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('E', 'G')),
  empenho TEXT
, valor REAL, grupo TEXT);

CREATE TABLE cost_objects (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

CREATE TABLE calc_rules (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('material', 'activity')),
  material_id INTEGER REFERENCES materials(id) ON DELETE CASCADE,
  activity_id INTEGER REFERENCES activities(id) ON DELETE CASCADE,
  sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  premise TEXT NOT NULL,
  dose REAL,
  rate_ha REAL,
  line_id INTEGER REFERENCES lines(id) ON DELETE SET NULL
);

CREATE TABLE calc_params (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('material', 'activity')),
  material_id INTEGER REFERENCES materials(id) ON DELETE CASCADE,
  activity_id INTEGER REFERENCES activities(id) ON DELETE CASCADE,
  premise TEXT NOT NULL,
  dose REAL
, rate_ha REAL, safra_id INTEGER REFERENCES safras(id), price REAL, exclude_weekdays TEXT, area_premise TEXT, use_activity_auto INTEGER NOT NULL DEFAULT 1, start_month INTEGER, end_month INTEGER, from_materials INTEGER NOT NULL DEFAULT 0, calc_mode TEXT NOT NULL DEFAULT 'area');

CREATE TABLE safras (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL
);

CREATE TABLE category_catalog (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE premissa_values (
  safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
  subprocess_key TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  start_day TEXT,
  end_day TEXT, months TEXT, manual_months INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (safra_id, subprocess_key)
);

CREATE TABLE premissa_subprocesses (
      id INTEGER PRIMARY KEY,
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      suffix TEXT NOT NULL DEFAULT 'ha', kind TEXT NOT NULL DEFAULT 'subprocess',
      UNIQUE (safra_id, key)
    );

CREATE TABLE "premissa_copies" (
      id INTEGER PRIMARY KEY,
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      dest_key TEXT NOT NULL,
      source_key TEXT NOT NULL,
      source_scope TEXT NOT NULL CHECK (source_scope IN ('current', 'previous')),
      start_month INTEGER NOT NULL CHECK (start_month >= 0 AND start_month <= 11)
    , end_month INTEGER NOT NULL DEFAULT 11);

CREATE TABLE seed_radius_tariffs (
      id INTEGER PRIMARY KEY,
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      start_km REAL NOT NULL,
      end_km REAL NOT NULL,
      price REAL NOT NULL
    );

CREATE TABLE value_distributions (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  safra_id INTEGER REFERENCES safras(id) ON DELETE CASCADE,
  activity_id INTEGER NOT NULL,
  activity_name TEXT NOT NULL,
  category_name TEXT NOT NULL,
  total_value REAL NOT NULL,
  months TEXT NOT NULL
);

CREATE TABLE value_distribution_lines (
  id INTEGER PRIMARY KEY,
  distribution_id INTEGER NOT NULL REFERENCES value_distributions(id) ON DELETE CASCADE,
  sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  line_id INTEGER NOT NULL,
  created_line INTEGER NOT NULL DEFAULT 0,
  previous_months TEXT
);

CREATE TABLE calc_param_cost_objects (
      calc_param_id INTEGER NOT NULL REFERENCES calc_params(id) ON DELETE CASCADE,
      cost_object_id INTEGER NOT NULL REFERENCES cost_objects(id) ON DELETE CASCADE,
      PRIMARY KEY (calc_param_id, cost_object_id)
    );

CREATE TABLE premissa_cells (
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      row INTEGER NOT NULL,
      col INTEGER NOT NULL,
      formula TEXT,
      value TEXT,
      PRIMARY KEY (safra_id, row, col)
    );

CREATE TABLE sheet_verifications (
  sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
  PRIMARY KEY (sheet_id, safra_id)
);

CREATE TABLE line_safra_prices (
      line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      calc_price REAL NOT NULL,
      PRIMARY KEY (line_id, safra_id)
    );

CREATE TABLE harvest_areas (
      id INTEGER PRIMARY KEY,
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      area REAL NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

CREATE TABLE fazendas (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  distancia REAL
);

CREATE TABLE safra_kpis (
      safra_id INTEGER PRIMARY KEY REFERENCES safras(id) ON DELETE CASCADE,
      orcamento_total REAL NOT NULL DEFAULT 0,
      moagem REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    , cost_centers_json TEXT, categories_json TEXT);

CREATE TABLE "safra_budget_breakdown" (
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('subprocess', 'category', 'cost_center')),
      item_key TEXT NOT NULL,
      item_label TEXT NOT NULL,
      total REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (safra_id, kind, item_key)
    );

CREATE TABLE empenhos (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

CREATE TABLE "activity_realizado_links" (
      id INTEGER PRIMARY KEY,
      activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK (source IN ('contrato_variavel', 'contrato_fixo', 'insumo', 'materiais')),
      source_code TEXT NOT NULL,
      source_label TEXT,
      match_by TEXT NOT NULL DEFAULT 'code',
      UNIQUE (source, source_code, match_by)
    );

CREATE TABLE un_realizado_sources (
      id INTEGER PRIMARY KEY,
      sheet_id INTEGER NOT NULL UNIQUE REFERENCES sheets(id) ON DELETE CASCADE,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('apontamento_terceiro', 'apontamento_maquinas', 'irrigacao')),
      metric TEXT NOT NULL DEFAULT 'area' CHECK (metric IN ('area', 'quantity'))
    );

CREATE TABLE un_realizado_operations (
      id INTEGER PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES un_realizado_sources(id) ON DELETE CASCADE,
      cod_operacaoagricola TEXT NOT NULL,
      label TEXT,
      UNIQUE (source_id, cod_operacaoagricola)
    );

CREATE TABLE "parametros_tecnicos" (
        safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
        anomes_inicio TEXT NOT NULL,
        anomes_fim TEXT NOT NULL,
        area_plantio REAL NOT NULL,
        area_soca REAL NOT NULL,
        area_irrigacao REAL NOT NULL,
        area_arrendada REAL NOT NULL,
        updated_at TEXT NOT NULL, moagem_lj REAL NOT NULL DEFAULT 0, tonelagem_manual REAL NOT NULL DEFAULT 0, atr REAL NOT NULL DEFAULT 0, produtividade REAL NOT NULL DEFAULT 0, preco_atr_consecana REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (safra_id, anomes_inicio, anomes_fim)
      );

CREATE TABLE custo_colheita_local (
      safra_id INTEGER NOT NULL REFERENCES safras(id) ON DELETE CASCADE,
      anomes_inicio TEXT NOT NULL,
      anomes_fim TEXT NOT NULL,
      secao TEXT NOT NULL,
      objeto TEXT NOT NULL,
      custo REAL NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (safra_id, anomes_inicio, anomes_fim, secao, objeto)
    );
