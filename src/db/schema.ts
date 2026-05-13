export const CREATE_META_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT
);
`;

export const CREATE_ANALYSIS_FUNCTIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS analysis_functions (
  ea TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  summary_version INTEGER NOT NULL DEFAULT 0,
  accepted_summary_json TEXT,
  confidence REAL,
  dirty INTEGER NOT NULL DEFAULT 0,
  last_pseudocode_hash TEXT,
  updated_at TEXT
);
`;

export const CREATE_ANALYSIS_EDGES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS analysis_edges (
  caller_ea TEXT NOT NULL,
  callee_ea TEXT NOT NULL,
  edge_kind TEXT NOT NULL,
  blocking INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  discovered_at TEXT,
  PRIMARY KEY (caller_ea, callee_ea)
);
`;

export const CREATE_JOBS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  target TEXT NOT NULL,
  agent_role TEXT,
  status TEXT NOT NULL,
  input_path TEXT,
  output_path TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
`;

export const CREATE_WORKER_RUNS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS worker_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT,
  function_ea TEXT NOT NULL,
  role TEXT NOT NULL,
  model TEXT NOT NULL,
  input_hash TEXT,
  output_json TEXT NOT NULL,
  output_path TEXT,
  created_at TEXT
);
`;

export const CREATE_REVIEWS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  function_ea TEXT NOT NULL,
  reviewer_model TEXT NOT NULL,
  contract_version INTEGER NOT NULL,
  accepted_contract_json TEXT NOT NULL,
  accepted_contract_path TEXT,
  rejected_claims_json TEXT,
  created_at TEXT
);
`;

export const CREATE_SUMMARY_DEPENDENCIES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS summary_dependencies (
  parent_ea TEXT NOT NULL,
  child_ea TEXT NOT NULL,
  child_summary_version_used INTEGER NOT NULL,
  PRIMARY KEY (parent_ea, child_ea)
);
`;

export const CREATE_SCC_GROUPS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS scc_groups (
  group_id TEXT PRIMARY KEY,
  members_json TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT,
  created_at TEXT,
  updated_at TEXT
);
`;

export const CREATE_SOURCE_SYMBOLS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS source_symbols (
  symbol_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  namespace TEXT,
  origin_ea TEXT,
  contract_version INTEGER,
  definition_json TEXT,
  status TEXT
);
`;

export const CREATE_SOURCE_BLOCKS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS source_blocks (
  block_id TEXT PRIMARY KEY,
  symbol_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  block_hash TEXT,
  managed INTEGER NOT NULL DEFAULT 1,
  manual_override INTEGER NOT NULL DEFAULT 0,
  fidelity_mode TEXT,
  updated_at TEXT
);
`;

export const CREATE_SIMPLIFICATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS simplifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol_id TEXT NOT NULL,
  function_ea TEXT,
  kind TEXT NOT NULL,
  original_json TEXT,
  replacement_json TEXT,
  evidence_json TEXT,
  risk TEXT,
  reviewer_required INTEGER,
  accepted INTEGER,
  created_at TEXT
);
`;

export const V1_TABLE_STATEMENTS = [
  CREATE_ANALYSIS_FUNCTIONS_TABLE_SQL,
  CREATE_ANALYSIS_EDGES_TABLE_SQL,
  CREATE_JOBS_TABLE_SQL,
  CREATE_WORKER_RUNS_TABLE_SQL,
  CREATE_REVIEWS_TABLE_SQL,
  CREATE_SUMMARY_DEPENDENCIES_TABLE_SQL,
  CREATE_SCC_GROUPS_TABLE_SQL,
  CREATE_SOURCE_SYMBOLS_TABLE_SQL,
  CREATE_SOURCE_BLOCKS_TABLE_SQL,
  CREATE_SIMPLIFICATIONS_TABLE_SQL,
] as const;

export const ALTER_ANALYSIS_FUNCTIONS_ADD_REMOVAL_COLUMNS_SQL = `
ALTER TABLE analysis_functions ADD COLUMN removed_at TEXT;
ALTER TABLE analysis_functions ADD COLUMN removal_reason TEXT;
`;

export const ALTER_REVIEWS_ADD_AMEND_REASON_SQL = `
ALTER TABLE reviews ADD COLUMN amend_reason TEXT;
`;
