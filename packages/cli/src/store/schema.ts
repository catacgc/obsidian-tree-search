export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS nodes (
  vault     TEXT    NOT NULL,
  key       TEXT    NOT NULL,
  node_type TEXT    NOT NULL,
  src_path  TEXT    NOT NULL,
  boost     INTEGER NOT NULL DEFAULT 0,
  age_days  INTEGER NOT NULL DEFAULT 0,
  data      TEXT    NOT NULL,
  PRIMARY KEY (vault, key)
);

CREATE TABLE IF NOT EXISTS edges (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  vault     TEXT    NOT NULL,
  from_key  TEXT    NOT NULL,
  to_key    TEXT    NOT NULL,
  edge_type TEXT    NOT NULL,
  src_path  TEXT    NOT NULL,
  mtime     INTEGER NOT NULL DEFAULT 0,
  location  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  vault        TEXT NOT NULL PRIMARY KEY,
  last_indexed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS plugin_config (
  vault       TEXT NOT NULL,
  namespace   TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  output_path TEXT,
  PRIMARY KEY (vault, namespace)
);

CREATE INDEX IF NOT EXISTS idx_nodes_src ON nodes (vault, src_path);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges (vault, src_path);
CREATE INDEX IF NOT EXISTS idx_edges_vault ON edges (vault);
`
