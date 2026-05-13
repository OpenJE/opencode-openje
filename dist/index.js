// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/opencode/plugin.ts
import { tool } from "@opencode-ai/plugin";

// src/db/connection.ts
import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { join } from "path";
var REWORK_DIR = ".rework";
var REWORK_DB_FILE = "re.db";
var REWORK_SUBDIRS = [
  "packets",
  "worker_outputs",
  "reviews",
  "summaries",
  "traversal_logs",
  "source_map",
  "patch_plans",
  "artifacts"
];

class DbError extends Error {
  code = "DB_ERROR";
  constructor(message, options) {
    super(`DB_ERROR: ${message}`, options);
    this.name = "DbError";
  }
}
function ensureWorkdir(root) {
  if (root.trim().length === 0) {
    throw new DbError("root path is required");
  }
  const workdir = join(root, REWORK_DIR);
  try {
    mkdirSync(workdir, { recursive: true });
    for (const subdir of REWORK_SUBDIRS) {
      mkdirSync(join(workdir, subdir), { recursive: true });
    }
  } catch (cause) {
    throw new DbError(`failed to create ${workdir}`, { cause });
  }
  return workdir;
}
function openDatabase(root) {
  const workdir = ensureWorkdir(root);
  const dbPath = join(workdir, REWORK_DB_FILE);
  let db;
  try {
    db = new Database(dbPath);
  } catch (cause) {
    throw new DbError(`failed to open database at ${dbPath}`, { cause });
  }
  try {
    db.run("PRAGMA journal_mode = WAL;");
  } catch (cause) {
    db.close();
    throw new DbError("failed to enable WAL mode", { cause });
  }
  return db;
}
function closeDatabase(db) {
  db.close();
}

// src/db/schema.ts
var CREATE_META_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT
);
`;
var CREATE_ANALYSIS_FUNCTIONS_TABLE_SQL = `
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
var CREATE_ANALYSIS_EDGES_TABLE_SQL = `
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
var CREATE_JOBS_TABLE_SQL = `
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
var CREATE_WORKER_RUNS_TABLE_SQL = `
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
var CREATE_REVIEWS_TABLE_SQL = `
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
var CREATE_SUMMARY_DEPENDENCIES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS summary_dependencies (
  parent_ea TEXT NOT NULL,
  child_ea TEXT NOT NULL,
  child_summary_version_used INTEGER NOT NULL,
  PRIMARY KEY (parent_ea, child_ea)
);
`;
var CREATE_SCC_GROUPS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS scc_groups (
  group_id TEXT PRIMARY KEY,
  members_json TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT,
  created_at TEXT,
  updated_at TEXT
);
`;
var CREATE_SOURCE_SYMBOLS_TABLE_SQL = `
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
var CREATE_SOURCE_BLOCKS_TABLE_SQL = `
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
var CREATE_SIMPLIFICATIONS_TABLE_SQL = `
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
var V1_TABLE_STATEMENTS = [
  CREATE_ANALYSIS_FUNCTIONS_TABLE_SQL,
  CREATE_ANALYSIS_EDGES_TABLE_SQL,
  CREATE_JOBS_TABLE_SQL,
  CREATE_WORKER_RUNS_TABLE_SQL,
  CREATE_REVIEWS_TABLE_SQL,
  CREATE_SUMMARY_DEPENDENCIES_TABLE_SQL,
  CREATE_SCC_GROUPS_TABLE_SQL,
  CREATE_SOURCE_SYMBOLS_TABLE_SQL,
  CREATE_SOURCE_BLOCKS_TABLE_SQL,
  CREATE_SIMPLIFICATIONS_TABLE_SQL
];
var ALTER_ANALYSIS_FUNCTIONS_ADD_REMOVAL_COLUMNS_SQL = `
ALTER TABLE analysis_functions ADD COLUMN removed_at TEXT;
ALTER TABLE analysis_functions ADD COLUMN removal_reason TEXT;
`;
var ALTER_REVIEWS_ADD_AMEND_REASON_SQL = `
ALTER TABLE reviews ADD COLUMN amend_reason TEXT;
`;

// src/db/migrations.ts
var MIGRATIONS = [
  {
    version: 1,
    up: V1_TABLE_STATEMENTS.join(`
`)
  },
  {
    version: 2,
    up: [ALTER_ANALYSIS_FUNCTIONS_ADD_REMOVAL_COLUMNS_SQL, ALTER_REVIEWS_ADD_AMEND_REASON_SQL].map((sql) => sql.trim()).filter(Boolean).join(`
`)
  }
];
function runMigrations(db) {
  db.run(CREATE_META_TABLE_SQL);
  const currentVersion = getCurrentSchemaVersion(db);
  const pendingMigrations = MIGRATIONS.filter((migration) => migration.version > currentVersion);
  if (pendingMigrations.length === 0) {
    return;
  }
  const migrate = db.transaction(() => {
    for (const migration of pendingMigrations) {
      runSqlBatch(db, migration.up);
      setCurrentSchemaVersion(db, migration.version);
    }
  });
  migrate();
}
function getCurrentSchemaVersion(db) {
  const row = db.query("SELECT value FROM _meta WHERE key = 'schema_version';").get();
  if (!row) {
    return 0;
  }
  const version = Number.parseInt(row.value, 10);
  return Number.isFinite(version) ? version : 0;
}
function setCurrentSchemaVersion(db, version) {
  db.query(`INSERT INTO _meta (key, value, updated_at)
     VALUES ('schema_version', $version, $updatedAt)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`).run({
    $version: String(version),
    $updatedAt: new Date().toISOString()
  });
}
function runSqlBatch(db, sql) {
  for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
    db.run(`${statement};`);
  }
}

// src/modules/artifacts.ts
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join as join2 } from "path";
class ArtifactsModule {
  root;
  constructor(root = process.cwd()) {
    this.root = root;
  }
  artifactPath(dir, filename) {
    return join2(this.root, REWORK_DIR, dir, filename);
  }
  async writeArtifact(dir, filename, data) {
    const path = this.artifactPath(dir, filename);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(data, null, 2)}
`, "utf8");
    return path;
  }
  async readArtifact(dir, filename) {
    const path = this.artifactPath(dir, filename);
    return JSON.parse(await readFile(path, "utf8"));
  }
}

// src/persistence/types.ts
function sanitizeEaForFilename(ea) {
  return ea.replaceAll(/[/:]/g, "_");
}
function analysisEdgeKey(callerEa, calleeEa) {
  return `${sanitizeEaForFilename(callerEa)}__${sanitizeEaForFilename(calleeEa)}`;
}
function summaryDependencyKey(parentEa, childEa) {
  return `${sanitizeEaForFilename(parentEa)}__${sanitizeEaForFilename(childEa)}`;
}
function workerRunKey(functionEa, role, id) {
  return `${sanitizeEaForFilename(functionEa)}__${sanitizeSegment(role)}__${id}`;
}
function reviewKey(functionEa, contractVersion) {
  return `${sanitizeEaForFilename(functionEa)}__v${contractVersion}`;
}
function simplificationKey(symbolId, id) {
  return `${sanitizeSegment(symbolId)}__${id}`;
}
function sanitizeSegment(value) {
  return value.replaceAll(/[/:]/g, "_");
}
function field(record, name) {
  if (record === null || typeof record !== "object" || !(name in record)) {
    throw new TypeError(`record is missing required field ${name}`);
  }
  const value = record[name];
  if (typeof value !== "string" && typeof value !== "number") {
    throw new TypeError(`record field ${name} must be a string or number`);
  }
  return value;
}
function stringField(record, name) {
  return String(field(record, name));
}
var TABLE_CONFIGS = {
  analysis_functions: {
    tableDir: "analysis_functions",
    primaryKey: (record) => sanitizeEaForFilename(stringField(record, "ea"))
  },
  analysis_edges: {
    tableDir: "analysis_edges",
    primaryKey: (record) => analysisEdgeKey(stringField(record, "caller_ea"), stringField(record, "callee_ea"))
  },
  jobs: {
    tableDir: "jobs",
    primaryKey: (record) => sanitizeSegment(stringField(record, "job_id"))
  },
  worker_runs: {
    tableDir: "worker_runs",
    primaryKey: (record) => workerRunKey(stringField(record, "function_ea"), stringField(record, "role"), field(record, "id"))
  },
  reviews: {
    tableDir: "reviews",
    primaryKey: (record) => reviewKey(stringField(record, "function_ea"), field(record, "contract_version"))
  },
  summary_dependencies: {
    tableDir: "summary_dependencies",
    primaryKey: (record) => summaryDependencyKey(stringField(record, "parent_ea"), stringField(record, "child_ea"))
  },
  source_symbols: {
    tableDir: "source_symbols",
    primaryKey: (record) => sanitizeSegment(stringField(record, "symbol_id"))
  },
  source_blocks: {
    tableDir: "source_blocks",
    primaryKey: (record) => sanitizeSegment(stringField(record, "block_id"))
  },
  simplifications: {
    tableDir: "simplifications",
    primaryKey: (record) => simplificationKey(stringField(record, "symbol_id"), field(record, "id"))
  }
};

// src/modules/dependencies.ts
class DependenciesModule {
  db;
  jsonStore;
  constructor(db, jsonStore) {
    this.db = db;
    this.jsonStore = jsonStore;
  }
  async record(parentEa, childEa, childVersion) {
    this.db.query(`INSERT INTO summary_dependencies (parent_ea, child_ea, child_summary_version_used)
         VALUES ($parentEa, $childEa, $childVersion)
         ON CONFLICT(parent_ea, child_ea) DO UPDATE SET
           child_summary_version_used = excluded.child_summary_version_used;`).run({
      $parentEa: parentEa,
      $childEa: childEa,
      $childVersion: childVersion
    });
    if (this.jsonStore) {
      const key = summaryDependencyKey(parentEa, childEa);
      const data = { parent_ea: parentEa, child_ea: childEa, child_summary_version_used: childVersion };
      await this.jsonStore.write("dependencies", key, data);
    }
  }
  async usedByParent(parentEa) {
    return this.db.query("SELECT * FROM summary_dependencies WHERE parent_ea = $parentEa;").all({ $parentEa: parentEa });
  }
  async staleParentsOf(childEa) {
    const rows = this.db.query(`SELECT sd.parent_ea
         FROM summary_dependencies sd
         JOIN analysis_functions af ON af.ea = sd.child_ea
         WHERE sd.child_ea = $childEa
           AND sd.child_summary_version_used < af.summary_version;`).all({ $childEa: childEa });
    return rows.map((r) => r.parent_ea);
  }
  async get(parentEa, childEa) {
    return this.db.query("SELECT * FROM summary_dependencies WHERE parent_ea = $parentEa AND child_ea = $childEa;").get({ $parentEa: parentEa, $childEa: childEa });
  }
  async remove(parentEa, childEa) {
    this.db.query("DELETE FROM summary_dependencies WHERE parent_ea = $parentEa AND child_ea = $childEa;").run({ $parentEa: parentEa, $childEa: childEa });
    if (this.jsonStore) {
      const key = summaryDependencyKey(parentEa, childEa);
      await this.jsonStore.delete("dependencies", key);
    }
  }
}

// src/modules/edges.ts
class EdgesModule {
  db;
  jsonStore;
  constructor(db, jsonStore) {
    this.db = db;
    this.jsonStore = jsonStore;
  }
  async add(input) {
    const discoveredAt = new Date().toISOString();
    this.db.query(`INSERT INTO analysis_edges (caller_ea, callee_ea, edge_kind, blocking, reason, discovered_at)
         VALUES ($caller, $callee, $kind, $blocking, $reason, $discoveredAt)
         ON CONFLICT(caller_ea, callee_ea) DO UPDATE SET
           edge_kind = excluded.edge_kind,
           blocking = excluded.blocking,
           reason = excluded.reason,
           discovered_at = excluded.discovered_at;`).run({
      $caller: input.caller,
      $callee: input.callee,
      $kind: input.kind,
      $blocking: input.blocking === false ? 0 : 1,
      $reason: input.reason ?? null,
      $discoveredAt: discoveredAt
    });
    if (this.jsonStore) {
      const key = analysisEdgeKey(input.caller, input.callee);
      const data = {
        caller_ea: input.caller,
        callee_ea: input.callee,
        edge_kind: input.kind,
        blocking: input.blocking === false ? 0 : 1,
        reason: input.reason ?? null,
        discovered_at: discoveredAt
      };
      await this.jsonStore.write("edges", key, data);
    }
  }
  async children(caller) {
    return this.db.query(`SELECT caller_ea, callee_ea, edge_kind, blocking, reason, discovered_at
         FROM analysis_edges
         WHERE caller_ea = $caller
         ORDER BY callee_ea, edge_kind;`).all({ $caller: caller });
  }
  async parents(callee) {
    return this.db.query(`SELECT caller_ea, callee_ea, edge_kind, blocking, reason, discovered_at
         FROM analysis_edges
         WHERE callee_ea = $callee
         ORDER BY caller_ea, edge_kind;`).all({ $callee: callee });
  }
  async blockingChildren(caller) {
    return this.db.query(`SELECT caller_ea, callee_ea, edge_kind, blocking, reason, discovered_at
         FROM analysis_edges
         WHERE caller_ea = $caller AND blocking = 1
         ORDER BY callee_ea, edge_kind;`).all({ $caller: caller });
  }
  async listAll() {
    return this.db.query(`SELECT caller_ea, callee_ea, edge_kind, blocking, reason, discovered_at
         FROM analysis_edges
         ORDER BY caller_ea, callee_ea;`).all();
  }
  async remove(caller, callee) {
    this.db.query(`DELETE FROM analysis_edges
         WHERE caller_ea = $caller AND callee_ea = $callee;`).run({ $caller: caller, $callee: callee });
    if (this.jsonStore) {
      const key = analysisEdgeKey(caller, callee);
      await this.jsonStore.delete("edges", key);
    }
  }
}

// src/modules/functions.ts
class FunctionsModule {
  db;
  jsonStore;
  constructor(db, jsonStore) {
    this.db = db;
    this.jsonStore = jsonStore;
  }
  async register(input) {
    const updatedAt = new Date().toISOString();
    this.db.query(`INSERT INTO analysis_functions (ea, status, last_pseudocode_hash, updated_at)
         VALUES ($ea, $status, $lastPseudocodeHash, $updatedAt)
         ON CONFLICT(ea) DO UPDATE SET
           status = excluded.status,
           last_pseudocode_hash = excluded.last_pseudocode_hash,
           updated_at = excluded.updated_at,
           removed_at = NULL,
           removal_reason = NULL;`).run({
      $ea: input.ea,
      $status: input.status ?? "unknown",
      $lastPseudocodeHash: input.lastPseudocodeHash ?? null,
      $updatedAt: updatedAt
    });
    if (this.jsonStore) {
      const fn = await this.get(input.ea);
      if (fn) {
        await this.jsonStore.write("functions", input.ea, fn);
      }
    }
  }
  async get(ea) {
    return this.db.query("SELECT * FROM analysis_functions WHERE ea = $ea;").get({ $ea: ea });
  }
  async setStatus(ea, status) {
    const updatedAt = new Date().toISOString();
    this.db.query(`UPDATE analysis_functions
         SET status = $status,
             updated_at = $updatedAt
         WHERE ea = $ea;`).run({
      $ea: ea,
      $status: status,
      $updatedAt: updatedAt
    });
    if (this.jsonStore) {
      const fn = await this.get(ea);
      if (fn) {
        await this.jsonStore.write("functions", ea, fn);
      }
    }
  }
  async markDirty(ea, reason) {
    const updatedAt = new Date().toISOString();
    this.db.query(`UPDATE analysis_functions
         SET dirty = 1,
             updated_at = $updatedAt
         WHERE ea = $ea;`).run({
      $ea: ea,
      $updatedAt: updatedAt
    });
    if (this.jsonStore) {
      const fn = await this.get(ea);
      if (fn) {
        await this.jsonStore.write("functions", ea, fn);
      }
    }
  }
  async unregister(ea, reason) {
    const tx = this.db.transaction(() => {
      const fn = this.db.query("SELECT ea FROM analysis_functions WHERE ea = $ea;").get({ $ea: ea });
      if (!fn) {
        throw new Error(`Function ${ea} not found`);
      }
      const edgeCount = this.db.query("SELECT COUNT(*) AS cnt FROM analysis_edges WHERE caller_ea = $ea OR callee_ea = $ea;").get({ $ea: ea }).cnt;
      const activeJobCount = this.db.query("SELECT COUNT(*) AS cnt FROM jobs WHERE target = $ea AND status NOT IN ('done', 'failed', 'cancelled');").get({ $ea: ea }).cnt;
      const workerRunCount = this.db.query("SELECT COUNT(*) AS cnt FROM worker_runs WHERE function_ea = $ea;").get({ $ea: ea }).cnt;
      const reviewCount = this.db.query("SELECT COUNT(*) AS cnt FROM reviews WHERE function_ea = $ea;").get({ $ea: ea }).cnt;
      const dependencyCount = this.db.query("SELECT COUNT(*) AS cnt FROM summary_dependencies WHERE parent_ea = $ea OR child_ea = $ea;").get({ $ea: ea }).cnt;
      if (edgeCount > 0 || activeJobCount > 0 || workerRunCount > 0 || reviewCount > 0 || dependencyCount > 0) {
        throw new Error(`Cannot unregister ${ea}: has ${edgeCount} edges, ${activeJobCount} active jobs, ${workerRunCount} worker_runs, ${reviewCount} reviews, ${dependencyCount} dependencies. Remove dependents first.`);
      }
      const now = new Date().toISOString();
      this.db.query(`UPDATE analysis_functions
           SET status = 'removed',
               removed_at = $now,
               removal_reason = $reason,
               updated_at = $now
           WHERE ea = $ea;`).run({
        $ea: ea,
        $now: now,
        $reason: reason
      });
    });
    tx();
    if (this.jsonStore) {
      const fn = await this.get(ea);
      if (fn) {
        await this.jsonStore.write("functions", ea, fn);
      }
    }
  }
  async listByStatus(status) {
    return this.db.query("SELECT * FROM analysis_functions WHERE status = $status ORDER BY ea;").all({ $status: status });
  }
  async listDirty() {
    return this.db.query("SELECT * FROM analysis_functions WHERE dirty = 1 ORDER BY ea;").all();
  }
  async listAll() {
    return this.db.query("SELECT * FROM analysis_functions ORDER BY ea;").all();
  }
}

// src/modules/jobs.ts
import { randomUUID } from "crypto";
var COMPLETED_STATUSES = ["done", "cancelled", "failed"];

class JobsModule {
  db;
  jsonStore;
  constructor(db, jsonStore) {
    this.db = db;
    this.jsonStore = jsonStore;
  }
  async create(input) {
    const jobId = randomUUID();
    const now = new Date().toISOString();
    this.db.query(`INSERT INTO jobs (
           job_id, job_type, target, agent_role, status, input_path, output_path, attempt, created_at, updated_at
         ) VALUES (
           $jobId, $jobType, $target, $agentRole, 'queued', $inputPath, NULL, 0, $now, $now
         );`).run({
      $jobId: jobId,
      $jobType: input.jobType,
      $target: input.target,
      $agentRole: input.agentRole ?? null,
      $inputPath: input.inputPath ?? null,
      $now: now
    });
    const job = await this.get(jobId);
    if (!job) {
      throw new Error(`failed to create job ${jobId}`);
    }
    if (this.jsonStore && COMPLETED_STATUSES.includes(job.status)) {
      await this.jsonStore.write("jobs", job.job_id, job);
    }
    return job;
  }
  async next(filter) {
    const claim = this.db.transaction((role) => {
      const job = this.db.query(`SELECT * FROM jobs
           WHERE status = 'queued' AND ($role IS NULL OR agent_role = $role)
           ORDER BY created_at, job_id
           LIMIT 1;`).get({ $role: role });
      if (!job) {
        return null;
      }
      const now = new Date().toISOString();
      this.db.query(`UPDATE jobs
           SET status = 'running', attempt = attempt + 1, updated_at = $now
           WHERE job_id = $jobId;`).run({ $jobId: job.job_id, $now: now });
      return this.findById(job.job_id);
    });
    const claimedJob = claim(filter?.role ?? null);
    if (claimedJob && this.jsonStore) {
      await this.jsonStore.delete("jobs", claimedJob.job_id);
    }
    return claimedJob;
  }
  async get(jobId) {
    return this.findById(jobId);
  }
  async complete(jobId, outputPath) {
    await this.updateStatus(jobId, "done", { outputPath: outputPath ?? null });
  }
  async fail(jobId, error) {
    await this.updateStatus(jobId, "failed");
  }
  async list(filter) {
    const status = filter?.status ?? null;
    const role = filter?.role ?? null;
    return this.db.query(`SELECT * FROM jobs
         WHERE ($status IS NULL OR status = $status)
           AND ($role IS NULL OR agent_role = $role)
         ORDER BY created_at, job_id;`).all({ $status: status, $role: role });
  }
  async cancel(jobId) {
    await this.updateStatus(jobId, "cancelled");
  }
  findById(jobId) {
    return this.db.query("SELECT * FROM jobs WHERE job_id = $jobId;").get({ $jobId: jobId });
  }
  async updateStatus(jobId, status, options = {}) {
    const now = new Date().toISOString();
    if (Object.hasOwn(options, "outputPath")) {
      this.db.query(`UPDATE jobs
           SET status = $status, output_path = $outputPath, updated_at = $now
           WHERE job_id = $jobId;`).run({ $jobId: jobId, $status: status, $outputPath: options.outputPath ?? null, $now: now });
    } else {
      this.db.query(`UPDATE jobs
           SET status = $status, updated_at = $now
           WHERE job_id = $jobId;`).run({ $jobId: jobId, $status: status, $now: now });
    }
    const job = this.findById(jobId);
    if (this.jsonStore) {
      if (COMPLETED_STATUSES.includes(status)) {
        if (job) {
          await this.jsonStore.write("jobs", jobId, job);
        }
      } else {
        await this.jsonStore.delete("jobs", jobId);
      }
    }
    return job;
  }
}

// node_modules/zod/v3/external.js
var exports_external = {};
__export(exports_external, {
  void: () => voidType,
  util: () => util,
  unknown: () => unknownType,
  union: () => unionType,
  undefined: () => undefinedType,
  tuple: () => tupleType,
  transformer: () => effectsType,
  symbol: () => symbolType,
  string: () => stringType,
  strictObject: () => strictObjectType,
  setErrorMap: () => setErrorMap,
  set: () => setType,
  record: () => recordType,
  quotelessJson: () => quotelessJson,
  promise: () => promiseType,
  preprocess: () => preprocessType,
  pipeline: () => pipelineType,
  ostring: () => ostring,
  optional: () => optionalType,
  onumber: () => onumber,
  oboolean: () => oboolean,
  objectUtil: () => objectUtil,
  object: () => objectType,
  number: () => numberType,
  nullable: () => nullableType,
  null: () => nullType,
  never: () => neverType,
  nativeEnum: () => nativeEnumType,
  nan: () => nanType,
  map: () => mapType,
  makeIssue: () => makeIssue,
  literal: () => literalType,
  lazy: () => lazyType,
  late: () => late,
  isValid: () => isValid,
  isDirty: () => isDirty,
  isAsync: () => isAsync,
  isAborted: () => isAborted,
  intersection: () => intersectionType,
  instanceof: () => instanceOfType,
  getParsedType: () => getParsedType,
  getErrorMap: () => getErrorMap,
  function: () => functionType,
  enum: () => enumType,
  effect: () => effectsType,
  discriminatedUnion: () => discriminatedUnionType,
  defaultErrorMap: () => en_default,
  datetimeRegex: () => datetimeRegex,
  date: () => dateType,
  custom: () => custom,
  coerce: () => coerce,
  boolean: () => booleanType,
  bigint: () => bigIntType,
  array: () => arrayType,
  any: () => anyType,
  addIssueToContext: () => addIssueToContext,
  ZodVoid: () => ZodVoid,
  ZodUnknown: () => ZodUnknown,
  ZodUnion: () => ZodUnion,
  ZodUndefined: () => ZodUndefined,
  ZodType: () => ZodType,
  ZodTuple: () => ZodTuple,
  ZodTransformer: () => ZodEffects,
  ZodSymbol: () => ZodSymbol,
  ZodString: () => ZodString,
  ZodSet: () => ZodSet,
  ZodSchema: () => ZodType,
  ZodRecord: () => ZodRecord,
  ZodReadonly: () => ZodReadonly,
  ZodPromise: () => ZodPromise,
  ZodPipeline: () => ZodPipeline,
  ZodParsedType: () => ZodParsedType,
  ZodOptional: () => ZodOptional,
  ZodObject: () => ZodObject,
  ZodNumber: () => ZodNumber,
  ZodNullable: () => ZodNullable,
  ZodNull: () => ZodNull,
  ZodNever: () => ZodNever,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNaN: () => ZodNaN,
  ZodMap: () => ZodMap,
  ZodLiteral: () => ZodLiteral,
  ZodLazy: () => ZodLazy,
  ZodIssueCode: () => ZodIssueCode,
  ZodIntersection: () => ZodIntersection,
  ZodFunction: () => ZodFunction,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodError: () => ZodError,
  ZodEnum: () => ZodEnum,
  ZodEffects: () => ZodEffects,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodDefault: () => ZodDefault,
  ZodDate: () => ZodDate,
  ZodCatch: () => ZodCatch,
  ZodBranded: () => ZodBranded,
  ZodBoolean: () => ZodBoolean,
  ZodBigInt: () => ZodBigInt,
  ZodArray: () => ZodArray,
  ZodAny: () => ZodAny,
  Schema: () => ZodType,
  ParseStatus: () => ParseStatus,
  OK: () => OK,
  NEVER: () => NEVER,
  INVALID: () => INVALID,
  EMPTY_PATH: () => EMPTY_PATH,
  DIRTY: () => DIRTY,
  BRAND: () => BRAND
});

// node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {};
  function assertIs(_arg) {}
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error;
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};

class ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
}
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}
// node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== undefined) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      ctx.schemaErrorMap,
      overrideMap,
      overrideMap === en_default ? undefined : en_default
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}

class ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
}
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;
// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/zod/v3/types.js
class ParseInputLazyPath {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
}
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}

class ZodType {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus,
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(undefined).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
}
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}

class ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus;
    let ctx = undefined;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
}
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}

class ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = undefined;
    const status = new ParseStatus;
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
}
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};

class ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = undefined;
    const status = new ParseStatus;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
}
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};

class ZodBoolean extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};

class ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus;
    let ctx = undefined;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
}
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};

class ZodSymbol extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};

class ZodUndefined extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};

class ZodNull extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};

class ZodAny extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
}
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};

class ZodUnknown extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
}
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};

class ZodNever extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
}
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};

class ZodVoid extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};

class ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : undefined,
          maximum: tooBig ? def.exactLength.value : undefined,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}

class ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {} else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== undefined ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  extend(augmentation) {
    return new ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  merge(merging) {
    const merged = new ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  catchall(index) {
    return new ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
}
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};

class ZodUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = undefined;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
}
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [undefined];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [undefined, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};

class ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  static create(discriminator, options, params) {
    const optionsMap = new Map;
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
}
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}

class ZodIntersection extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
}
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};

class ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new ZodTuple({
      ...this._def,
      rest
    });
  }
}
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};

class ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
}

class ZodMap extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = new Map;
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = new Map;
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
}
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};

class ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = new Set;
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};

class ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
}

class ZodLazy extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
}
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};

class ZodLiteral extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
}
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}

class ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
}
ZodEnum.create = createZodEnum;

class ZodNativeEnum extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
}
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};

class ZodPromise extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
}
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};

class ZodEffects extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
}
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
class ZodOptional extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(undefined);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};

class ZodNullable extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};

class ZodDefault extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
}
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};

class ZodCatch extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
}
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};

class ZodNaN extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
}
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");

class ZodBranded extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
}

class ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
}

class ZodReadonly extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: (arg) => ZodString.create({ ...arg, coerce: true }),
  number: (arg) => ZodNumber.create({ ...arg, coerce: true }),
  boolean: (arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  }),
  bigint: (arg) => ZodBigInt.create({ ...arg, coerce: true }),
  date: (arg) => ZodDate.create({ ...arg, coerce: true })
};
var NEVER = INVALID;
// src/schemas/AcceptedContractV1.ts
var AcceptedContractV1 = exports_external.object({
  function_ea: exports_external.string(),
  contract_version: exports_external.number().int().nonnegative().optional(),
  accepted_name: exports_external.string(),
  accepted_prototype: exports_external.string().optional(),
  kind: exports_external.enum(["function", "method", "constructor", "destructor", "thunk", "unknown"]),
  owner: exports_external.string().optional(),
  purpose: exports_external.string(),
  return_value: exports_external.object({
    type: exports_external.string().optional(),
    meaning: exports_external.string().optional()
  }).optional(),
  accepted_variable_names: exports_external.record(exports_external.string()).default({}),
  dependencies_used: exports_external.array(exports_external.object({
    ea: exports_external.string(),
    summary_version: exports_external.number().int().nonnegative()
  })).default([]),
  rejected_claims: exports_external.array(exports_external.object({
    claim: exports_external.string(),
    reason: exports_external.string()
  })).default([]),
  confidence: exports_external.number().min(0).max(1)
});

// src/modules/reviews.ts
class ReviewsModule {
  db;
  jsonStore;
  functions;
  dependencies;
  constructor(db, jsonStore) {
    this.db = db;
    this.jsonStore = jsonStore;
    this.functions = new FunctionsModule(db);
    this.dependencies = new DependenciesModule(db);
  }
  async bundle(functionEa) {
    const workerRuns = this.db.query("SELECT * FROM worker_runs WHERE function_ea = $ea ORDER BY created_at DESC;").all({ $ea: functionEa });
    const edges = this.db.query("SELECT * FROM analysis_edges WHERE caller_ea = $ea OR callee_ea = $ea;").all({ $ea: functionEa });
    const dependencies = this.db.query("SELECT * FROM summary_dependencies WHERE parent_ea = $ea;").all({ $ea: functionEa });
    return { functionEa, workerRuns, edges, dependencies };
  }
  async submit(input) {
    const parsed = AcceptedContractV1.parse(input.acceptedContract);
    const tx = this.db.transaction(() => {
      const fn = this.db.query("SELECT * FROM analysis_functions WHERE ea = $ea;").get({ $ea: input.functionEa });
      const newVersion = (fn?.summary_version ?? 0) + 1;
      this.db.query(`UPDATE analysis_functions
           SET status = 'reviewed',
               summary_version = $version,
               accepted_summary_json = $contractJson,
               confidence = $confidence,
               updated_at = $updatedAt
           WHERE ea = $ea;`).run({
        $ea: input.functionEa,
        $version: newVersion,
        $contractJson: JSON.stringify(parsed),
        $confidence: parsed.confidence ?? null,
        $updatedAt: new Date().toISOString()
      });
      this.db.query(`INSERT INTO reviews (
             function_ea, reviewer_model, contract_version,
             accepted_contract_json, accepted_contract_path, rejected_claims_json, created_at
           ) VALUES (
             $ea, $reviewerModel, $version, $contractJson, $path, $rejected, $createdAt
           );`).run({
        $ea: input.functionEa,
        $reviewerModel: input.reviewerModel,
        $version: newVersion,
        $contractJson: JSON.stringify(parsed),
        $path: input.acceptedContractPath ?? null,
        $rejected: input.rejectedClaims ? JSON.stringify(input.rejectedClaims) : null,
        $createdAt: new Date().toISOString()
      });
      const result = this.db.query("SELECT last_insert_rowid() AS id;").get();
      for (const dep of parsed.dependencies_used ?? []) {
        this.db.query(`INSERT INTO summary_dependencies (parent_ea, child_ea, child_summary_version_used)
             VALUES ($parent, $child, $version)
             ON CONFLICT(parent_ea, child_ea) DO UPDATE SET
               child_summary_version_used = excluded.child_summary_version_used;`).run({
          $parent: input.functionEa,
          $child: dep.ea,
          $version: dep.summary_version
        });
      }
      return result.id;
    });
    const reviewId = tx();
    if (this.jsonStore) {
      const fn = await this.functions.get(input.functionEa);
      if (fn) {
        await this.jsonStore.write("functions", input.functionEa, fn);
      }
      const review = await this.latest(input.functionEa);
      if (review) {
        await this.jsonStore.write("reviews", reviewKey(input.functionEa, review.contract_version), review);
      }
      for (const dep of parsed.dependencies_used ?? []) {
        const depRecord = await this.dependencies.get(input.functionEa, dep.ea);
        if (depRecord) {
          await this.jsonStore.write("summary_dependencies", summaryDependencyKey(input.functionEa, dep.ea), depRecord);
        }
      }
    }
    return { id: reviewId };
  }
  async amend(input) {
    if (input.acceptedContract === undefined && input.rejectedClaims === undefined) {
      throw new Error("acceptedContract or rejectedClaims must be provided");
    }
    const existingReview = this.db.query("SELECT * FROM reviews WHERE id = $id;").get({ $id: input.reviewId });
    if (!existingReview) {
      throw new Error(`Review ${input.reviewId} not found`);
    }
    const parsed = input.acceptedContract === undefined ? undefined : AcceptedContractV1.parse(input.acceptedContract);
    let amendedReview = null;
    const tx = this.db.transaction(() => {
      const review = this.db.query("SELECT * FROM reviews WHERE id = $id;").get({ $id: input.reviewId });
      if (!review) {
        throw new Error(`Review ${input.reviewId} not found`);
      }
      if (parsed !== undefined) {
        if (parsed.function_ea !== review.function_ea) {
          throw new Error("Cannot change review function_ea");
        }
        if (parsed.contract_version !== undefined && parsed.contract_version !== review.contract_version) {
          throw new Error("Cannot change review contract_version");
        }
        this.db.query(`UPDATE reviews
             SET accepted_contract_json = $contractJson,
                 amend_reason = $reason
             WHERE id = $id;`).run({
          $id: input.reviewId,
          $contractJson: JSON.stringify(parsed),
          $reason: input.reason
        });
        const existingDeps = this.db.query("SELECT child_ea FROM summary_dependencies WHERE parent_ea = $parentEa;").all({ $parentEa: review.function_ea });
        for (const dep of existingDeps) {
          this.dependencies.remove(review.function_ea, dep.child_ea);
        }
        for (const dep of parsed.dependencies_used ?? []) {
          this.dependencies.record(review.function_ea, dep.ea, dep.summary_version);
        }
      }
      if (input.rejectedClaims !== undefined) {
        this.db.query(`UPDATE reviews
             SET rejected_claims_json = $rejectedClaims
             WHERE id = $id;`).run({
          $id: input.reviewId,
          $rejectedClaims: JSON.stringify(input.rejectedClaims)
        });
      }
      amendedReview = this.db.query("SELECT * FROM reviews WHERE id = $id;").get({ $id: input.reviewId });
    });
    tx();
    if (this.jsonStore && amendedReview) {
      await this.jsonStore.write("reviews", reviewKey(amendedReview.function_ea, amendedReview.contract_version), amendedReview);
      if (parsed !== undefined) {
        const depKeys = await this.jsonStore.list("summary_dependencies");
        const parentPrefix = `${summaryDependencyKey(amendedReview.function_ea, "")}`;
        for (const key of depKeys) {
          if (key.startsWith(parentPrefix)) {
            await this.jsonStore.delete("summary_dependencies", key);
          }
        }
        for (const dep of parsed.dependencies_used ?? []) {
          const depRecord = await this.dependencies.get(amendedReview.function_ea, dep.ea);
          if (depRecord) {
            await this.jsonStore.write("summary_dependencies", summaryDependencyKey(amendedReview.function_ea, dep.ea), depRecord);
          }
        }
      }
    }
  }
  async latest(functionEa) {
    return this.db.query("SELECT * FROM reviews WHERE function_ea = $ea ORDER BY contract_version DESC LIMIT 1;").get({ $ea: functionEa });
  }
  async list(functionEa) {
    return this.db.query("SELECT * FROM reviews WHERE function_ea = $ea ORDER BY contract_version DESC;").all({ $ea: functionEa });
  }
  async get(id) {
    return this.db.query("SELECT * FROM reviews WHERE id = $id;").get({ $id: id });
  }
}

// src/modules/simplifications.ts
class SimplificationsModule {
  db;
  jsonStore;
  constructor(db, jsonStore) {
    this.db = db;
    this.jsonStore = jsonStore;
  }
  async create(input) {
    const result = this.db.query(`INSERT INTO simplifications (
           symbol_id, function_ea, kind, original_json, replacement_json, evidence_json, risk, reviewer_required, accepted, created_at
         ) VALUES (
           $symbolId, $functionEa, $kind, $originalJson, $replacementJson, $evidenceJson, $risk, $reviewerRequired, NULL, $createdAt
         );`).run({
      $symbolId: input.symbolId,
      $functionEa: input.functionEa ?? null,
      $kind: input.kind,
      $originalJson: input.originalJson ?? null,
      $replacementJson: input.replacementJson ?? null,
      $evidenceJson: input.evidenceJson ?? null,
      $risk: input.risk ?? null,
      $reviewerRequired: input.reviewerRequired ? 1 : 0,
      $createdAt: new Date().toISOString()
    });
    const id = Number(result.lastInsertRowid);
    if (this.jsonStore) {
      const record = await this.get(id);
      if (record) {
        await this.jsonStore.write("simplifications", simplificationKey(input.symbolId, id), record);
      }
    }
    return id;
  }
  async get(id) {
    return this.db.query("SELECT * FROM simplifications WHERE id = $id;").get({ $id: id });
  }
  async listBySymbol(symbolId) {
    return this.db.query("SELECT * FROM simplifications WHERE symbol_id = $symbolId ORDER BY id;").all({ $symbolId: symbolId });
  }
  async listByFunction(functionEa) {
    return this.db.query("SELECT * FROM simplifications WHERE function_ea = $functionEa ORDER BY id;").all({ $functionEa: functionEa });
  }
  async accept(id) {
    this.db.query("UPDATE simplifications SET accepted = 1 WHERE id = $id;").run({ $id: id });
    if (this.jsonStore) {
      const record = await this.get(id);
      if (record) {
        await this.jsonStore.write("simplifications", simplificationKey(record.symbol_id, id), record);
      }
    }
  }
  async reject(id) {
    this.db.query("UPDATE simplifications SET accepted = 0 WHERE id = $id;").run({ $id: id });
    if (this.jsonStore) {
      const record = await this.get(id);
      if (record) {
        await this.jsonStore.write("simplifications", simplificationKey(record.symbol_id, id), record);
      }
    }
  }
  async remove(id) {
    const record = await this.get(id);
    this.db.query("DELETE FROM simplifications WHERE id = $id;").run({ $id: id });
    if (this.jsonStore && record) {
      await this.jsonStore.delete("simplifications", simplificationKey(record.symbol_id, id));
    }
  }
}

// src/modules/sourceBlocks.ts
class SourceBlocksModule {
  db;
  jsonStore;
  constructor(db, jsonStore) {
    this.db = db;
    this.jsonStore = jsonStore;
  }
  async create(input) {
    this.db.query(`INSERT INTO source_blocks (
           block_id, symbol_id, file_path, block_hash, managed, manual_override, fidelity_mode, updated_at
         ) VALUES (
           $blockId, $symbolId, $filePath, $blockHash, 1, 0, $fidelityMode, $updatedAt
         );`).run({
      $blockId: input.blockId,
      $symbolId: input.symbolId,
      $filePath: input.filePath,
      $blockHash: input.blockHash ?? null,
      $fidelityMode: input.fidelityMode ?? null,
      $updatedAt: new Date().toISOString()
    });
    const block = await this.get(input.blockId);
    if (!block)
      throw new Error("Failed to create source block");
    if (this.jsonStore) {
      await this.jsonStore.write("source_blocks", block.block_id, block);
    }
    return block;
  }
  async get(blockId) {
    return this.db.query("SELECT * FROM source_blocks WHERE block_id = $blockId;").get({ $blockId: blockId });
  }
  async listBySymbol(symbolId) {
    return this.db.query("SELECT * FROM source_blocks WHERE symbol_id = $symbolId ORDER BY block_id;").all({ $symbolId: symbolId });
  }
  async update(blockId, updates) {
    const fields = [];
    const params = { $blockId: blockId, $updatedAt: new Date().toISOString() };
    if (updates.file_path !== undefined) {
      fields.push("file_path = $filePath");
      params.$filePath = updates.file_path;
    }
    if (updates.block_hash !== undefined) {
      fields.push("block_hash = $blockHash");
      params.$blockHash = updates.block_hash;
    }
    if (updates.managed !== undefined) {
      fields.push("managed = $managed");
      params.$managed = updates.managed;
    }
    if (updates.manual_override !== undefined) {
      fields.push("manual_override = $manualOverride");
      params.$manualOverride = updates.manual_override;
    }
    if (updates.fidelity_mode !== undefined) {
      fields.push("fidelity_mode = $fidelityMode");
      params.$fidelityMode = updates.fidelity_mode;
    }
    if (fields.length === 0)
      return;
    fields.push("updated_at = $updatedAt");
    this.db.query(`UPDATE source_blocks SET ${fields.join(", ")} WHERE block_id = $blockId;`).run(params);
    if (this.jsonStore) {
      const block = await this.get(blockId);
      if (block) {
        await this.jsonStore.write("source_blocks", blockId, block);
      }
    }
  }
  async listManualOverrides() {
    return this.db.query("SELECT * FROM source_blocks WHERE manual_override = 1 ORDER BY block_id;").all();
  }
  async remove(blockId) {
    this.db.query("DELETE FROM source_blocks WHERE block_id = $blockId;").run({ $blockId: blockId });
    if (this.jsonStore) {
      await this.jsonStore.delete("source_blocks", blockId);
    }
  }
}

// src/modules/sourceSymbols.ts
var UPDATE_COLUMNS = [
  "kind",
  "name",
  "namespace",
  "origin_ea",
  "contract_version",
  "definition_json",
  "status"
];

class SourceSymbolsModule {
  db;
  jsonStore;
  constructor(db, jsonStore) {
    this.db = db;
    this.jsonStore = jsonStore;
  }
  async create(input) {
    this.db.query(`INSERT INTO source_symbols (
           symbol_id,
           kind,
           name,
           namespace,
           origin_ea,
           contract_version,
           definition_json,
           status
         ) VALUES (
           $symbolId,
           $kind,
           $name,
           $namespace,
           $originEa,
           NULL,
           $definitionJson,
           $status
         );`).run({
      $symbolId: input.symbolId,
      $kind: input.kind,
      $name: input.name,
      $namespace: input.namespace ?? null,
      $originEa: input.originEa ?? null,
      $definitionJson: input.definitionJson ?? null,
      $status: "unplaced"
    });
    const symbol = await this.get(input.symbolId);
    if (!symbol) {
      throw new Error(`Failed to create source symbol ${input.symbolId}`);
    }
    if (this.jsonStore) {
      await this.jsonStore.write("source_symbols", symbol.symbol_id, symbol);
    }
    return symbol;
  }
  async get(symbolId) {
    return this.db.query("SELECT * FROM source_symbols WHERE symbol_id = $symbolId;").get({ $symbolId: symbolId });
  }
  async list(filter = {}) {
    const where = [];
    const params = {};
    if (filter.kind !== undefined) {
      where.push("kind = $kind");
      params.$kind = filter.kind;
    }
    if (filter.status !== undefined) {
      where.push("status = $status");
      params.$status = filter.status;
    }
    if (filter.originEa !== undefined) {
      where.push("origin_ea = $originEa");
      params.$originEa = filter.originEa;
    }
    const whereSql = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
    return this.db.query(`SELECT * FROM source_symbols${whereSql} ORDER BY symbol_id ASC;`).all(params);
  }
  async updateStatus(symbolId, status) {
    this.db.query("UPDATE source_symbols SET status = $status WHERE symbol_id = $symbolId;").run({ $symbolId: symbolId, $status: status });
    if (this.jsonStore) {
      const symbol = await this.get(symbolId);
      if (symbol) {
        await this.jsonStore.write("source_symbols", symbolId, symbol);
      }
    }
  }
  async update(symbolId, updates) {
    const setClauses = [];
    const params = { $symbolId: symbolId };
    for (const column of UPDATE_COLUMNS) {
      const value = updates[column];
      if (value === undefined) {
        continue;
      }
      const paramName = `$${column}`;
      setClauses.push(`${column} = ${paramName}`);
      params[paramName] = value;
    }
    if (setClauses.length === 0) {
      return;
    }
    this.db.query(`UPDATE source_symbols SET ${setClauses.join(", ")} WHERE symbol_id = $symbolId;`).run(params);
    if (this.jsonStore) {
      const symbol = await this.get(symbolId);
      if (symbol) {
        await this.jsonStore.write("source_symbols", symbolId, symbol);
      }
    }
  }
  async remove(symbolId) {
    this.db.query("DELETE FROM source_symbols WHERE symbol_id = $symbolId;").run({ $symbolId: symbolId });
    if (this.jsonStore) {
      await this.jsonStore.delete("source_symbols", symbolId);
    }
  }
}

// src/modules/stale.ts
class StaleModule {
  db;
  jsonStore;
  constructor(db, jsonStore) {
    this.db = db;
    this.jsonStore = jsonStore;
  }
  async markParentsStale(childEa) {
    const tx = this.db.transaction(() => {
      const parents = this.db.query(`SELECT sd.parent_ea
           FROM summary_dependencies sd
           JOIN analysis_functions af ON af.ea = sd.child_ea
           WHERE sd.child_ea = $childEa
             AND sd.child_summary_version_used < af.summary_version;`).all({ $childEa: childEa });
      const parentEas2 = parents.map((p) => p.parent_ea);
      for (const parentEa of parentEas2) {
        this.db.query(`UPDATE analysis_functions
             SET status = 'stale', updated_at = $updatedAt
             WHERE ea = $ea AND status != 'stale';`).run({
          $ea: parentEa,
          $updatedAt: new Date().toISOString()
        });
      }
      return parentEas2;
    });
    const parentEas = tx();
    if (this.jsonStore) {
      for (const parentEa of parentEas) {
        const parent = await this.get(parentEa);
        if (parent) {
          await this.jsonStore.write("functions", parentEa, parent);
        }
      }
    }
    return parentEas;
  }
  async list() {
    return this.db.query("SELECT * FROM analysis_functions WHERE status = 'stale' ORDER BY ea;").all();
  }
  async isStale(functionEa) {
    const row = this.db.query("SELECT status FROM analysis_functions WHERE ea = $ea;").get({ $ea: functionEa });
    return row?.status === "stale";
  }
  async get(ea) {
    return this.db.query("SELECT * FROM analysis_functions WHERE ea = $ea;").get({ $ea: ea });
  }
}

// src/modules/statusTree.ts
class StatusTreeModule {
  db;
  constructor(db) {
    this.db = db;
  }
  async statusTree(rootEa) {
    const rootFn = this.db.query("SELECT * FROM analysis_functions WHERE ea = $ea;").get({ $ea: rootEa });
    if (!rootFn)
      return null;
    const visited = new Set;
    async function buildNode(ea, db) {
      visited.add(ea);
      const fn = db.query("SELECT * FROM analysis_functions WHERE ea = $ea;").get({ $ea: ea });
      const children = db.query("SELECT callee_ea FROM analysis_edges WHERE caller_ea = $ea;").all({ $ea: ea });
      const childNodes = [];
      for (const child of children) {
        if (!visited.has(child.callee_ea)) {
          childNodes.push(await buildNode(child.callee_ea, db));
        }
      }
      return {
        ea,
        status: fn?.status ?? "unknown",
        summary_version: fn?.summary_version ?? undefined,
        children: childNodes
      };
    }
    return buildNode(rootEa, this.db);
  }
}

// src/schemas/FunctionAnalysisV1.ts
var FunctionAnalysisV1 = exports_external.object({
  purpose: exports_external.object({
    summary: exports_external.string(),
    confidence: exports_external.number().min(0).max(1),
    evidence: exports_external.array(exports_external.string())
  }),
  inputs: exports_external.array(exports_external.object({
    original: exports_external.string(),
    proposed_name: exports_external.string().optional(),
    type: exports_external.string().optional(),
    confidence: exports_external.number().min(0).max(1).optional(),
    evidence: exports_external.array(exports_external.string()).optional()
  })).default([]),
  return_value: exports_external.object({
    type: exports_external.string().optional(),
    meaning: exports_external.string().optional(),
    confidence: exports_external.number().min(0).max(1).optional(),
    evidence: exports_external.array(exports_external.string()).optional()
  }).optional(),
  side_effects: exports_external.array(exports_external.unknown()).default([]),
  uncertainties: exports_external.array(exports_external.string()).default([])
});

// src/modules/workerRuns.ts
class WorkerRunsModule {
  db;
  jsonStore;
  constructor(db, jsonStore) {
    this.db = db;
    this.jsonStore = jsonStore;
  }
  async submit(input) {
    const parsed = FunctionAnalysisV1.parse(input.output);
    const createdAt = new Date().toISOString();
    const analysis = {
      function_ea: input.functionEa,
      role: input.role,
      model: input.model,
      ...input.jobId ? { job_id: input.jobId } : {},
      ...parsed
    };
    const result = this.db.query(`INSERT INTO worker_runs (job_id, function_ea, role, model, input_hash, output_json, output_path, created_at)
         VALUES ($jobId, $functionEa, $role, $model, $inputHash, $outputJson, NULL, $createdAt);`).run({
      $jobId: input.jobId ?? null,
      $functionEa: input.functionEa,
      $role: input.role,
      $model: input.model,
      $inputHash: input.inputHash ?? null,
      $outputJson: JSON.stringify(analysis),
      $createdAt: createdAt
    });
    const id = Number(result.lastInsertRowid);
    if (this.jsonStore !== undefined) {
      const key = workerRunKey(input.functionEa, input.role, id);
      await this.jsonStore.write("worker_runs", key, {
        id,
        job_id: input.jobId ?? null,
        function_ea: input.functionEa,
        role: input.role,
        model: input.model,
        input_hash: input.inputHash ?? null,
        output_json: JSON.stringify(analysis),
        output_path: null,
        created_at: createdAt
      });
    }
    return id;
  }
  async listForFunction(functionEa) {
    return this.db.query("SELECT * FROM worker_runs WHERE function_ea = $functionEa ORDER BY id ASC;").all({ $functionEa: functionEa });
  }
  async get(id) {
    return this.db.query("SELECT * FROM worker_runs WHERE id = $id;").get({ $id: id });
  }
  async update(id, output) {
    const existing = await this.get(id);
    if (existing === null) {
      throw new Error(`Worker run ${id} not found`);
    }
    const parsed = FunctionAnalysisV1.parse(output);
    const newOutputJson = JSON.stringify({
      function_ea: existing.function_ea,
      role: existing.role,
      model: existing.model,
      ...existing.job_id ? { job_id: existing.job_id } : {},
      ...parsed
    });
    this.db.query("UPDATE worker_runs SET output_json = $outputJson WHERE id = $id;").run({ $outputJson: newOutputJson, $id: id });
    if (this.jsonStore !== undefined) {
      const key = workerRunKey(existing.function_ea, existing.role, id);
      await this.jsonStore.write("worker_runs", key, {
        id,
        job_id: existing.job_id,
        function_ea: existing.function_ea,
        role: existing.role,
        model: existing.model,
        input_hash: existing.input_hash,
        output_json: newOutputJson,
        output_path: existing.output_path,
        created_at: existing.created_at
      });
    }
  }
}

// src/persistence/JsonStore.ts
import { mkdir as mkdir2, readFile as readFile2, readdir, writeFile as writeFile2 } from "fs/promises";
import { dirname as dirname2, join as join3 } from "path";
class JsonStore {
  root;
  constructor(root) {
    this.root = root;
  }
  async write(tableDir, key, data) {
    const path = this.recordPath(tableDir, key);
    await mkdir2(dirname2(path), { recursive: true });
    await writeFile2(path, `${JSON.stringify(data, null, 2)}
`, "utf8");
  }
  async read(tableDir, key) {
    const data = await this.readRaw(tableDir, key);
    if (isTombstone(data)) {
      return null;
    }
    return data;
  }
  async delete(tableDir, key) {
    await this.write(tableDir, key, tombstone(tableDir, key));
  }
  async list(tableDir) {
    const dir = this.tablePath(tableDir);
    const entries = await safeReadDir(dir, { withFileTypes: true });
    const keys = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const key = entry.name.slice(0, -".json".length);
      if (await this.read(tableDir, key) !== null) {
        keys.push(key);
      }
    }
    return keys.sort();
  }
  async listAll() {
    const workdir = join3(this.root, REWORK_DIR);
    const entries = await safeReadDir(workdir, { withFileTypes: true });
    const tables = new Map;
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      tables.set(entry.name, await this.list(entry.name));
    }
    return new Map([...tables.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }
  async readRaw(tableDir, key) {
    try {
      return JSON.parse(await readFile2(this.recordPath(tableDir, key), "utf8"));
    } catch (cause) {
      if (isNotFoundError(cause)) {
        return null;
      }
      throw cause;
    }
  }
  tablePath(tableDir) {
    return join3(this.root, REWORK_DIR, tableDir);
  }
  recordPath(tableDir, key) {
    return join3(this.tablePath(tableDir), `${key}.json`);
  }
}

class InMemoryJsonStore {
  tables = new Map;
  async write(tableDir, key, data) {
    this.table(tableDir).set(key, structuredClone(data));
  }
  async read(tableDir, key) {
    const data = await this.readRaw(tableDir, key);
    if (isTombstone(data)) {
      return null;
    }
    return data;
  }
  async delete(tableDir, key) {
    await this.write(tableDir, key, tombstone(tableDir, key));
  }
  async list(tableDir) {
    const table = this.tables.get(tableDir);
    if (table === undefined) {
      return [];
    }
    const keys = [];
    for (const [key, value] of table.entries()) {
      if (!isTombstone(value)) {
        keys.push(key);
      }
    }
    return keys.sort();
  }
  async listAll() {
    const tables = new Map;
    for (const tableDir of this.tables.keys()) {
      tables.set(tableDir, await this.list(tableDir));
    }
    return new Map([...tables.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }
  async readRaw(tableDir, key) {
    const data = this.tables.get(tableDir)?.get(key);
    if (data === undefined) {
      return null;
    }
    return structuredClone(data);
  }
  table(tableDir) {
    let table = this.tables.get(tableDir);
    if (table === undefined) {
      table = new Map;
      this.tables.set(tableDir, table);
    }
    return table;
  }
}
function tombstone(tableDir, key) {
  return {
    _deleted: true,
    _deleted_at: new Date().toISOString(),
    _table: tableDir,
    _key: key
  };
}
function isTombstone(data) {
  return data?._deleted === true;
}
function isNotFoundError(cause) {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}
async function safeReadDir(path, options) {
  try {
    return await readdir(path, options);
  } catch (cause) {
    if (isNotFoundError(cause)) {
      return [];
    }
    throw cause;
  }
}

// src/persistence/reindex.ts
import { readdir as readdir2 } from "fs/promises";
import { join as join4 } from "path";
var TABLE_ORDER = [
  "analysis_functions",
  "analysis_edges",
  "worker_runs",
  "reviews",
  "summary_dependencies",
  "source_symbols",
  "source_blocks",
  "simplifications",
  "jobs"
];
var TABLE_DIR_ALIASES = {
  analysis_functions: ["functions"],
  analysis_edges: ["edges"],
  summary_dependencies: ["dependencies"]
};
var INDEXED_JOB_STATUSES = new Set(["done", "cancelled", "failed"]);
var SQL = {
  analysis_functions: "INSERT OR REPLACE INTO analysis_functions (ea, status, summary_version, accepted_summary_json, confidence, dirty, last_pseudocode_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  analysis_edges: "INSERT OR REPLACE INTO analysis_edges (caller_ea, callee_ea, edge_kind, blocking, reason, discovered_at) VALUES (?, ?, ?, ?, ?, ?)",
  worker_runs: "INSERT OR REPLACE INTO worker_runs (id, job_id, function_ea, role, model, input_hash, output_json, output_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  reviews: "INSERT OR REPLACE INTO reviews (id, function_ea, reviewer_model, contract_version, accepted_contract_json, accepted_contract_path, rejected_claims_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  summary_dependencies: "INSERT OR REPLACE INTO summary_dependencies (parent_ea, child_ea, child_summary_version_used) VALUES (?, ?, ?)",
  source_symbols: "INSERT OR REPLACE INTO source_symbols (symbol_id, kind, name, namespace, origin_ea, contract_version, definition_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  source_blocks: "INSERT OR REPLACE INTO source_blocks (block_id, symbol_id, file_path, block_hash, managed, manual_override, fidelity_mode, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  simplifications: "INSERT OR REPLACE INTO simplifications (id, symbol_id, function_ea, kind, original_json, replacement_json, evidence_json, risk, reviewer_required, accepted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  jobs: "INSERT OR REPLACE INTO jobs (job_id, job_type, target, agent_role, status, input_path, output_path, attempt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
};
var DELETE_SQL = {
  analysis_functions: "DELETE FROM analysis_functions WHERE ea = ?",
  analysis_edges: "DELETE FROM analysis_edges WHERE caller_ea = ? AND callee_ea = ?",
  worker_runs: "DELETE FROM worker_runs WHERE id = ?",
  reviews: "DELETE FROM reviews WHERE function_ea = ? AND contract_version = ?",
  summary_dependencies: "DELETE FROM summary_dependencies WHERE parent_ea = ? AND child_ea = ?",
  source_symbols: "DELETE FROM source_symbols WHERE symbol_id = ?",
  source_blocks: "DELETE FROM source_blocks WHERE block_id = ?",
  simplifications: "DELETE FROM simplifications WHERE id = ?",
  jobs: "DELETE FROM jobs WHERE job_id = ?"
};
async function reindex(root, db) {
  const jsonStore = new JsonStore(root);
  const keysByTable = await listKeysIncludingTombstones(root, jsonStore);
  const rebuild = db.transaction(() => {
    for (const table of TABLE_ORDER) {
      const tableDir = TABLE_CONFIGS[table].tableDir;
      const keys = keysByTable.get(tableDir) ?? [];
      for (const key of keys) {
        const record = records.get(`${tableDir}\x00${key}`);
        if (record === undefined || record === null) {
          continue;
        }
        if (isTombstone2(record)) {
          db.query(DELETE_SQL[table]).run(...deleteValues(table, key));
          continue;
        }
        const values = insertValues(table, key, record);
        if (values === null) {
          continue;
        }
        db.query(SQL[table]).run(...values);
      }
    }
  });
  const records = await readRecords(jsonStore, keysByTable);
  rebuild();
}
async function listKeysIncludingTombstones(root, jsonStore) {
  const tables = await jsonStore.listAll();
  const merged = new Map;
  for (const [tableDir, keys] of tables.entries()) {
    merged.set(tableDir, new Set(keys));
  }
  for (const table of TABLE_ORDER) {
    const config = TABLE_CONFIGS[table];
    const keys = merged.get(config.tableDir) ?? new Set;
    for (const tableDir of tableDirsFor(table)) {
      for (const key of merged.get(tableDir) ?? []) {
        keys.add(key);
      }
      for (const key of await rawKeys(root, tableDir)) {
        keys.add(key);
      }
    }
    merged.set(config.tableDir, keys);
  }
  return new Map([...merged.entries()].map(([tableDir, keys]) => [tableDir, [...keys].sort()]));
}
async function rawKeys(root, tableDir) {
  try {
    const entries = await readdir2(join4(root, REWORK_DIR, tableDir), { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name.slice(0, -".json".length));
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return [];
    }
    throw cause;
  }
}
async function readRecords(jsonStore, keysByTable) {
  const records = new Map;
  for (const [tableDir, keys] of keysByTable.entries()) {
    for (const key of keys) {
      records.set(`${tableDir}\x00${key}`, await readRawFromDirs(jsonStore, tableDirsForCanonical(tableDir), key));
    }
  }
  return records;
}
async function readRawFromDirs(jsonStore, tableDirs, key) {
  let record = null;
  for (const tableDir of tableDirs) {
    const candidate = await jsonStore.readRaw(tableDir, key);
    if (candidate !== null) {
      record = candidate;
    }
  }
  return record;
}
function tableDirsFor(table) {
  return [TABLE_CONFIGS[table].tableDir, ...TABLE_DIR_ALIASES[table] ?? []];
}
function tableDirsForCanonical(tableDir) {
  for (const table of TABLE_ORDER) {
    if (TABLE_CONFIGS[table].tableDir === tableDir) {
      return tableDirsFor(table);
    }
  }
  return [tableDir];
}
function insertValues(table, key, record) {
  switch (table) {
    case "analysis_functions": {
      const ea = stringValue(record.ea) ?? key;
      return [
        ea,
        binding(record.status),
        binding(record.summary_version),
        binding(record.accepted_summary_json),
        binding(record.confidence),
        binding(record.dirty),
        binding(record.last_pseudocode_hash),
        binding(record.updated_at)
      ];
    }
    case "analysis_edges": {
      const [callerEa, calleeEa] = splitKey(key, 2);
      return [
        stringValue(record.caller_ea) ?? callerEa,
        stringValue(record.callee_ea) ?? calleeEa,
        binding(record.edge_kind),
        binding(record.blocking),
        binding(record.reason),
        binding(record.discovered_at)
      ];
    }
    case "worker_runs": {
      const [functionEa, role, id] = splitKey(key, 3);
      return [
        numberValue(record.id) ?? Number(id),
        binding(record.job_id),
        stringValue(record.function_ea) ?? functionEa,
        stringValue(record.role) ?? role,
        binding(record.model),
        binding(record.input_hash),
        binding(record.output_json),
        binding(record.output_path),
        binding(record.created_at)
      ];
    }
    case "reviews": {
      const [functionEa, version] = splitKey(key, 2);
      return [
        binding(record.id),
        stringValue(record.function_ea) ?? functionEa,
        binding(record.reviewer_model),
        numberValue(record.contract_version) ?? Number(version.replace(/^v/, "")),
        binding(record.accepted_contract_json),
        binding(record.accepted_contract_path),
        binding(record.rejected_claims_json),
        binding(record.created_at)
      ];
    }
    case "summary_dependencies": {
      const [parentEa, childEa] = splitKey(key, 2);
      return [
        stringValue(record.parent_ea) ?? parentEa,
        stringValue(record.child_ea) ?? childEa,
        binding(record.child_summary_version_used)
      ];
    }
    case "source_symbols":
      return [
        stringValue(record.symbol_id) ?? key,
        binding(record.kind),
        binding(record.name),
        binding(record.namespace),
        binding(record.origin_ea),
        binding(record.contract_version),
        binding(record.definition_json),
        binding(record.status)
      ];
    case "source_blocks":
      return [
        stringValue(record.block_id) ?? key,
        binding(record.symbol_id),
        binding(record.file_path),
        binding(record.block_hash),
        binding(record.managed),
        binding(record.manual_override),
        binding(record.fidelity_mode),
        binding(record.updated_at)
      ];
    case "simplifications": {
      const [symbolId, id] = splitKey(key, 2);
      return [
        numberValue(record.id) ?? Number(id),
        stringValue(record.symbol_id) ?? symbolId,
        binding(record.function_ea),
        binding(record.kind),
        binding(record.original_json),
        binding(record.replacement_json),
        binding(record.evidence_json),
        binding(record.risk),
        binding(record.reviewer_required),
        binding(record.accepted),
        binding(record.created_at)
      ];
    }
    case "jobs":
      if (typeof record.status !== "string" || !INDEXED_JOB_STATUSES.has(record.status)) {
        return null;
      }
      return [
        stringValue(record.job_id) ?? key,
        binding(record.job_type),
        binding(record.target),
        binding(record.agent_role),
        binding(record.status),
        binding(record.input_path),
        binding(record.output_path),
        binding(record.attempt),
        binding(record.created_at),
        binding(record.updated_at)
      ];
  }
}
function deleteValues(table, key) {
  switch (table) {
    case "analysis_edges":
    case "summary_dependencies":
      return splitKey(key, 2);
    case "worker_runs":
      return [Number(splitKey(key, 3)[2])];
    case "reviews":
      return splitKey(key, 2).map((part, index) => index === 1 ? Number(part.replace(/^v/, "")) : part);
    case "simplifications":
      return [Number(splitKey(key, 2)[1])];
    default:
      return [key];
  }
}
function splitKey(key, segments) {
  const parts = key.split("__");
  if (parts.length !== segments) {
    throw new Error(`invalid reindex key ${key}`);
  }
  return parts;
}
function stringValue(value) {
  return typeof value === "string" ? value : null;
}
function numberValue(value) {
  return typeof value === "number" ? value : null;
}
function binding(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value;
  }
  return JSON.stringify(value);
}
function isTombstone2(record) {
  return record?._deleted === true;
}

// src/traversal/scc.ts
function detectSccs(edges) {
  const adj = new Map;
  const nodes = new Set;
  for (const edge of edges) {
    nodes.add(edge.caller_ea);
    nodes.add(edge.callee_ea);
    if (!adj.has(edge.caller_ea))
      adj.set(edge.caller_ea, new Set);
    adj.get(edge.caller_ea).add(edge.callee_ea);
  }
  let index = 0;
  const stack = [];
  const onStack = new Set;
  const indices = new Map;
  const lowlinks = new Map;
  const sccs = [];
  function strongconnect(v) {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    const neighbors = adj.get(v) ?? new Set;
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v), lowlinks.get(w)));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v), indices.get(w)));
      }
    }
    if (lowlinks.get(v) === indices.get(v)) {
      const members = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        members.push(w);
      } while (w !== v);
      if (members.length > 1) {
        const hash = members.slice().sort().join("_");
        sccs.push({
          group_id: `SCC_${hash}`,
          members: members.sort(),
          status: "pending"
        });
      }
    }
  }
  for (const node of nodes) {
    if (!indices.has(node)) {
      strongconnect(node);
    }
  }
  return sccs;
}

// src/traversal/topo.ts
function topologicalOrder(rootEa, edges) {
  const adj = new Map;
  const allNodes = new Set([rootEa]);
  for (const edge of edges) {
    allNodes.add(edge.caller_ea);
    allNodes.add(edge.callee_ea);
    if (!adj.has(edge.caller_ea))
      adj.set(edge.caller_ea, new Set);
    adj.get(edge.caller_ea).add(edge.callee_ea);
  }
  const visited = new Set;
  const temp = new Set;
  const order = [];
  function visit(node) {
    if (temp.has(node))
      return;
    if (visited.has(node))
      return;
    temp.add(node);
    const children = adj.get(node) ?? new Set;
    for (const child of children) {
      visit(child);
    }
    temp.delete(node);
    visited.add(node);
    order.push(node);
  }
  visit(rootEa);
  for (const node of allNodes) {
    if (!visited.has(node)) {
      visit(node);
    }
  }
  return order;
}

// src/traversal/plan.ts
function traversalPlan(rootEa, edges, functions) {
  const sccs = detectSccs(edges);
  const order = topologicalOrder(rootEa, edges);
  const allNodes = new Set(order);
  const skipped = [];
  const warnings = [];
  for (const node of allNodes) {
    const fn = functions.get(node);
    if (!fn || fn.status === "skipped" || fn.status === "unknown") {
      skipped.push(node);
    }
  }
  if (skipped.length > 0) {
    warnings.push(`Skipped ${skipped.length} node(s): ${skipped.join(", ")}`);
  }
  for (const scc of sccs) {
    const skippedInScc = scc.members.filter((m) => skipped.includes(m));
    if (skippedInScc.length > 0) {
      warnings.push(`SCC ${scc.group_id} contains skipped nodes: ${skippedInScc.join(", ")}`);
    }
  }
  return {
    root: rootEa,
    nodes: Array.from(allNodes),
    sccs: sccs.map((s) => ({ group_id: s.group_id, members: s.members })),
    analysis_order: order,
    skipped,
    warnings
  };
}

// src/core/ReProgress.ts
class ReProgress {
  db;
  functions;
  edges;
  jobs;
  workers;
  reviews;
  dependencies;
  stale;
  tree;
  sourceSymbols;
  sourceBlocks;
  simplifications;
  artifacts;
  traversal;
  constructor(db, root, jsonStore) {
    this.db = db;
    this.functions = new FunctionsModule(db, jsonStore);
    this.edges = new EdgesModule(db, jsonStore);
    this.jobs = new JobsModule(db, jsonStore);
    this.workers = new WorkerRunsModule(db, jsonStore);
    this.reviews = new ReviewsModule(db, jsonStore);
    this.dependencies = new DependenciesModule(db, jsonStore);
    this.stale = new StaleModule(db, jsonStore);
    this.tree = new StatusTreeModule(db);
    this.sourceSymbols = new SourceSymbolsModule(db, jsonStore);
    this.sourceBlocks = new SourceBlocksModule(db, jsonStore);
    this.simplifications = new SimplificationsModule(db, jsonStore);
    this.artifacts = new ArtifactsModule(root);
    this.traversal = { detectSccs, topologicalOrder, traversalPlan };
  }
  static async open(options) {
    ensureWorkdir(options.root);
    const db = openDatabase(options.root);
    runMigrations(db);
    const jsonStore = new JsonStore(options.root);
    await reindex(options.root, db);
    return new ReProgress(db, options.root, jsonStore);
  }
  close() {
    closeDatabase(this.db);
  }
}

// src/opencode/result.ts
function jsonResult(data, metadata) {
  return {
    output: JSON.stringify(data, null, 2),
    ...metadata ? { metadata } : undefined
  };
}
function errorResult(message, code, details) {
  return {
    output: JSON.stringify({ error: { message, ...code ? { code } : {}, ...details ?? {} } })
  };
}

// src/opencode/plugin.ts
var OpenJePlugin = async ({ client, directory, worktree }) => {
  const root = worktree || directory || process.cwd();
  const re = await ReProgress.open({ root });
  await client.app.log({
    body: {
      service: "opencode-openje",
      level: "info",
      message: "Plugin initialized",
      extra: { root }
    }
  });
  return {
    tool: {
      re_status: tool({
        description: "Show overall status of the RE progress ledger",
        args: {},
        async execute(_args, _ctx) {
          const counts = {
            functions: re.functions.listAll().then((r) => r.length),
            edges: re.edges.listAll().then((r) => r.length),
            jobs: 0,
            worker_runs: 0,
            reviews: 0,
            stale: re.stale.list().then((r) => r.length),
            source_symbols: re.sourceSymbols.list({}).then((r) => r.length),
            source_blocks: 0
          };
          return jsonResult({
            functions: await counts.functions,
            edges: await counts.edges,
            jobs: await counts.jobs,
            worker_runs: await counts.worker_runs,
            reviews: await counts.reviews,
            stale: await counts.stale,
            source_symbols: await counts.source_symbols,
            source_blocks: await counts.source_blocks
          });
        }
      }),
      re_function_register: tool({
        description: "Register a function in the ledger",
        args: {
          ea: tool.schema.string().describe("Function effective address"),
          status: tool.schema.enum(["unknown", "discovered", "queued", "waiting_on_children", "ready_for_local_analysis", "analyzing", "worker_done", "review_pending", "reviewed", "failed", "skipped", "cycle_member", "stale"]).describe("Function status").optional(),
          last_pseudocode_hash: tool.schema.string().describe("Hash of pseudocode").optional()
        },
        async execute(args, _ctx) {
          await re.functions.register({
            ea: args.ea,
            status: args.status,
            lastPseudocodeHash: args.last_pseudocode_hash
          });
          return jsonResult({ registered: args.ea });
        }
      }),
      re_function_get: tool({
        description: "Get a function by EA",
        args: {
          ea: tool.schema.string().describe("Function effective address")
        },
        async execute(args, _ctx) {
          const fn = await re.functions.get(args.ea);
          if (!fn) {
            return errorResult(`Function ${args.ea} not found`, "NOT_FOUND");
          }
          return jsonResult(fn);
        }
      }),
      re_function_unregister: tool({
        description: "Unregister a function from the ledger",
        args: {
          ea: tool.schema.string().describe("Function effective address"),
          reason: tool.schema.string().describe("Reason for unregistering")
        },
        async execute(args, _ctx) {
          try {
            await re.functions.unregister(args.ea, args.reason);
            return jsonResult({ unregistered: args.ea, reason: args.reason });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("not found")) {
              return errorResult(msg, "NOT_FOUND");
            }
            if (msg.includes("Cannot unregister")) {
              return errorResult(msg, "DEPENDENCY_ERROR");
            }
            throw err;
          }
        }
      }),
      re_function_set_status: tool({
        description: "Set function status",
        args: {
          ea: tool.schema.string().describe("Function effective address"),
          status: tool.schema.enum(["unknown", "discovered", "queued", "waiting_on_children", "ready_for_local_analysis", "analyzing", "worker_done", "review_pending", "reviewed", "failed", "skipped", "cycle_member", "stale"]).describe("New status")
        },
        async execute(args, _ctx) {
          await re.functions.setStatus(args.ea, args.status);
          return jsonResult({ updated: args.ea, status: args.status });
        }
      }),
      re_function_list: tool({
        description: "List functions by status",
        args: {
          status: tool.schema.enum(["unknown", "discovered", "queued", "waiting_on_children", "ready_for_local_analysis", "analyzing", "worker_done", "review_pending", "reviewed", "failed", "skipped", "cycle_member", "stale"]).describe("Filter by status").optional()
        },
        async execute(args, _ctx) {
          const list = args.status ? await re.functions.listByStatus(args.status) : await re.functions.listAll();
          return jsonResult({ count: list.length, functions: list });
        }
      }),
      re_edge_add: tool({
        description: "Add an edge between functions",
        args: {
          caller: tool.schema.string().describe("Caller EA"),
          callee: tool.schema.string().describe("Callee EA"),
          kind: tool.schema.enum(["direct_call", "indirect_call", "virtual_call", "import_call", "thunk", "tail_call", "callback_candidate", "unresolved"]).describe("Edge kind"),
          blocking: tool.schema.boolean().describe("Whether blocking").optional(),
          reason: tool.schema.string().describe("Reason").optional()
        },
        async execute(args, _ctx) {
          await re.edges.add({
            caller: args.caller,
            callee: args.callee,
            kind: args.kind,
            blocking: args.blocking ?? true,
            reason: args.reason
          });
          return jsonResult({ added: `${args.caller} -> ${args.callee}` });
        }
      }),
      re_edge_remove: tool({
        description: "Remove an edge between functions",
        args: {
          caller: tool.schema.string().describe("Caller EA"),
          callee: tool.schema.string().describe("Callee EA"),
          reason: tool.schema.string().describe("Reason for removal")
        },
        async execute(args, _ctx) {
          try {
            await re.edges.remove(args.caller, args.callee);
            return jsonResult({ removed: `${args.caller} -> ${args.callee}` });
          } catch (err) {
            return errorResult(err.message, "NOT_FOUND");
          }
        }
      }),
      re_job_create: tool({
        description: "Create a job",
        args: {
          job_type: tool.schema.enum(["discover_subgraph", "classify_edges", "analyze_function_semantics", "analyze_function_types", "analyze_function_names", "review_function_contract", "analyze_scc_cluster", "emit_faithful_cpp", "review_cpp_fidelity", "fix_compile_error", "apply_ida_patch_plan"]).describe("Job type"),
          target: tool.schema.string().describe("Target EA"),
          role: tool.schema.string().describe("Agent role").optional(),
          input_path: tool.schema.string().describe("Input path").optional()
        },
        async execute(args, _ctx) {
          const job = await re.jobs.create({
            jobType: args.job_type,
            target: args.target,
            agentRole: args.role,
            inputPath: args.input_path
          });
          return jsonResult(job);
        }
      }),
      re_job_next: tool({
        description: "Claim next available job",
        args: {
          role: tool.schema.string().describe("Agent role filter").optional()
        },
        async execute(args, _ctx) {
          const job = await re.jobs.next(args.role ? { role: args.role } : undefined);
          if (!job)
            return jsonResult(null);
          return jsonResult(job);
        }
      }),
      re_job_cancel: tool({
        description: "Cancel a job",
        args: {
          job_id: tool.schema.string().describe("Job ID to cancel"),
          reason: tool.schema.string().describe("Reason for cancellation")
        },
        async execute(args, _ctx) {
          try {
            await re.jobs.cancel(args.job_id);
            return jsonResult({ cancelled: args.job_id });
          } catch (err) {
            return errorResult(`Job ${args.job_id} not found`, "NOT_FOUND");
          }
        }
      }),
      re_worker_submit: tool({
        description: "Submit a worker run with structured analysis output",
        args: {
          function_ea: tool.schema.string().describe("Function EA"),
          role: tool.schema.string().describe("Worker role"),
          model: tool.schema.string().describe("Model name"),
          output: tool.schema.object({
            purpose: tool.schema.object({
              summary: tool.schema.string().describe("What this function does"),
              confidence: tool.schema.number().min(0).max(1).describe("Confidence 0-1"),
              evidence: tool.schema.array(tool.schema.string()).describe("Supporting evidence")
            }).describe("Function purpose"),
            inputs: tool.schema.array(tool.schema.object({
              original: tool.schema.string().describe("Original parameter name"),
              proposed_name: tool.schema.string().optional().describe("Suggested parameter name"),
              type: tool.schema.string().optional().describe("Parameter type"),
              confidence: tool.schema.number().min(0).max(1).optional().describe("Confidence 0-1"),
              evidence: tool.schema.array(tool.schema.string()).optional().describe("Supporting evidence")
            })).default([]).describe("Function inputs"),
            return_value: tool.schema.object({
              type: tool.schema.string().optional().describe("Return type"),
              meaning: tool.schema.string().optional().describe("Return value meaning"),
              confidence: tool.schema.number().min(0).max(1).optional().describe("Confidence 0-1"),
              evidence: tool.schema.array(tool.schema.string()).optional().describe("Supporting evidence")
            }).optional().describe("Return value analysis"),
            side_effects: tool.schema.array(tool.schema.unknown()).default([]).describe("Side effects"),
            uncertainties: tool.schema.array(tool.schema.string()).default([]).describe("Uncertainties")
          }).describe("Worker analysis output"),
          job_id: tool.schema.string().describe("Job ID").optional()
        },
        async execute(args, _ctx) {
          const id = await re.workers.submit({
            jobId: args.job_id,
            functionEa: args.function_ea,
            role: args.role,
            model: args.model,
            output: args.output
          });
          return jsonResult({ id });
        }
      }),
      re_worker_run_update: tool({
        description: "Update a worker run with new analysis output",
        args: {
          id: tool.schema.number().describe("Worker run ID"),
          output: tool.schema.object({
            purpose: tool.schema.object({
              summary: tool.schema.string().describe("What this function does"),
              confidence: tool.schema.number().min(0).max(1).describe("Confidence 0-1"),
              evidence: tool.schema.array(tool.schema.string()).describe("Supporting evidence")
            }).describe("Function purpose"),
            inputs: tool.schema.array(tool.schema.object({
              original: tool.schema.string().describe("Original parameter name"),
              proposed_name: tool.schema.string().optional().describe("Suggested parameter name"),
              type: tool.schema.string().optional().describe("Parameter type"),
              confidence: tool.schema.number().min(0).max(1).optional().describe("Confidence 0-1"),
              evidence: tool.schema.array(tool.schema.string()).optional().describe("Supporting evidence")
            })).default([]).describe("Function inputs"),
            return_value: tool.schema.object({
              type: tool.schema.string().optional().describe("Return type"),
              meaning: tool.schema.string().optional().describe("Return value meaning"),
              confidence: tool.schema.number().min(0).max(1).optional().describe("Confidence 0-1"),
              evidence: tool.schema.array(tool.schema.string()).optional().describe("Supporting evidence")
            }).optional().describe("Return value analysis"),
            side_effects: tool.schema.array(tool.schema.unknown()).default([]).describe("Side effects"),
            uncertainties: tool.schema.array(tool.schema.string()).default([]).describe("Uncertainties")
          }).describe("Worker analysis output"),
          reason: tool.schema.string().describe("Reason for the update")
        },
        async execute(args, _ctx) {
          try {
            const existing = await re.workers.get(args.id);
            if (existing === null) {
              return errorResult(`Worker run ${args.id} not found`, "NOT_FOUND");
            }
            await re.workers.update(args.id, args.output);
            const functionEa = existing.function_ea;
            const latestReview = await re.reviews.latest(functionEa);
            if (latestReview !== null) {
              return jsonResult({
                updated: args.id,
                reason: args.reason,
                warning: `Function ${functionEa} has reviews \u2014 consider re-reviewing after this update`
              });
            }
            return jsonResult({ updated: args.id, reason: args.reason });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return errorResult(message, "VALIDATION_ERROR");
          }
        }
      }),
      re_review_submit: tool({
        description: "Submit a review contract with structured fields",
        args: {
          function_ea: tool.schema.string().describe("Function EA"),
          reviewer_model: tool.schema.string().describe("Reviewer model"),
          contract: tool.schema.object({
            contract_version: tool.schema.number().int().nonnegative().optional().describe("Contract version"),
            accepted_name: tool.schema.string().describe("Accepted function name"),
            accepted_prototype: tool.schema.string().optional().describe("Function prototype/signature"),
            kind: tool.schema.enum(["function", "method", "constructor", "destructor", "thunk", "unknown"]).describe("Function kind"),
            owner: tool.schema.string().optional().describe("Class/struct owner"),
            purpose: tool.schema.string().describe("Function purpose description"),
            return_value: tool.schema.object({
              type: tool.schema.string().optional().describe("Return type"),
              meaning: tool.schema.string().optional().describe("Return value meaning")
            }).optional().describe("Return value"),
            accepted_variable_names: tool.schema.record(tool.schema.string(), tool.schema.string()).default({}).describe("Variable name mappings"),
            dependencies_used: tool.schema.array(tool.schema.object({
              ea: tool.schema.string().describe("Dependency EA"),
              summary_version: tool.schema.number().int().nonnegative().describe("Summary version used")
            })).default([]).describe("Dependencies used"),
            confidence: tool.schema.number().min(0).max(1).describe("Confidence 0-1")
          }).describe("Accepted review contract (function_ea is auto-filled from top-level parameter)"),
          rejected_claims: tool.schema.array(tool.schema.object({
            claim: tool.schema.string().describe("Claim description"),
            reason: tool.schema.string().describe("Reason for rejection")
          })).describe("Rejected claims").optional()
        },
        async execute(args, _ctx) {
          const result = await re.reviews.submit({
            functionEa: args.function_ea,
            reviewerModel: args.reviewer_model,
            acceptedContract: { ...args.contract, function_ea: args.function_ea },
            rejectedClaims: args.rejected_claims
          });
          return jsonResult({ reviewed: args.function_ea, review_id: result.id });
        }
      }),
      re_review_amend: tool({
        description: "Amend an existing review contract",
        args: {
          review_id: tool.schema.number().int().nonnegative().describe("Review ID to amend"),
          contract: tool.schema.object({
            contract_version: tool.schema.number().int().nonnegative().optional().describe("Contract version"),
            accepted_name: tool.schema.string().describe("Accepted function name"),
            accepted_prototype: tool.schema.string().optional().describe("Function prototype/signature"),
            kind: tool.schema.enum(["function", "method", "constructor", "destructor", "thunk", "unknown"]).describe("Function kind"),
            owner: tool.schema.string().optional().describe("Class/struct owner"),
            purpose: tool.schema.string().describe("Function purpose description"),
            return_value: tool.schema.object({
              type: tool.schema.string().optional().describe("Return type"),
              meaning: tool.schema.string().optional().describe("Return value meaning")
            }).optional().describe("Return value"),
            accepted_variable_names: tool.schema.record(tool.schema.string(), tool.schema.string()).default({}).describe("Variable name mappings"),
            dependencies_used: tool.schema.array(tool.schema.object({
              ea: tool.schema.string().describe("Dependency EA"),
              summary_version: tool.schema.number().int().nonnegative().describe("Summary version used")
            })).default([]).describe("Dependencies used"),
            confidence: tool.schema.number().min(0).max(1).describe("Confidence 0-1")
          }).describe("Amended accepted contract").optional(),
          rejected_claims: tool.schema.array(tool.schema.object({
            claim: tool.schema.string().describe("Claim description"),
            reason: tool.schema.string().describe("Reason for rejection")
          })).describe("Rejected claims").optional(),
          reason: tool.schema.string().describe("Reason for amendment")
        },
        async execute(args, _ctx) {
          if (args.contract === undefined && args.rejected_claims === undefined) {
            return errorResult("Either contract or rejected_claims must be provided", "BAD_REQUEST");
          }
          let acceptedContract = args.contract;
          if (args.contract !== undefined) {
            const existingReview = await re.reviews.get(args.review_id);
            if (existingReview === null) {
              return errorResult(`Review ${args.review_id} not found`, "NOT_FOUND");
            }
            acceptedContract = { ...args.contract, function_ea: existingReview.function_ea };
          }
          try {
            await re.reviews.amend({
              reviewId: args.review_id,
              acceptedContract,
              rejectedClaims: args.rejected_claims,
              reason: args.reason
            });
            return jsonResult({ amended: args.review_id, reason: args.reason });
          } catch (err) {
            if (err instanceof Error && err.message.includes("not found")) {
              return errorResult(`Review ${args.review_id} not found`, "NOT_FOUND");
            }
            throw err;
          }
        }
      }),
      re_review_list: tool({
        description: "List all reviews for a function",
        args: {
          function_ea: tool.schema.string().describe("Function EA")
        },
        async execute(args, _ctx) {
          const reviews = await re.reviews.list(args.function_ea);
          return jsonResult(reviews);
        }
      }),
      re_review_get: tool({
        description: "Get a review by ID",
        args: {
          review_id: tool.schema.number().int().nonnegative().describe("Review ID")
        },
        async execute(args, _ctx) {
          const review = await re.reviews.get(args.review_id);
          if (!review) {
            return errorResult(`Review ${args.review_id} not found`, "NOT_FOUND");
          }
          return jsonResult(review);
        }
      }),
      re_stale_mark_parents: tool({
        description: "Mark parents stale when child changes",
        args: {
          child_ea: tool.schema.string().describe("Child function EA")
        },
        async execute(args, _ctx) {
          const parents = await re.stale.markParentsStale(args.child_ea);
          return jsonResult({ marked: parents });
        }
      }),
      re_stale_list: tool({
        description: "List all stale functions",
        args: {},
        async execute(_args, _ctx) {
          const list = await re.stale.list();
          return jsonResult({ count: list.length, functions: list });
        }
      }),
      re_tree: tool({
        description: "Get status tree from root",
        args: {
          root_ea: tool.schema.string().describe("Root function EA")
        },
        async execute(args, _ctx) {
          const tree = await re.tree.statusTree(args.root_ea);
          return jsonResult(tree);
        }
      })
    }
  };
};
// src/core/errors.ts
class ReProgressError extends Error {
  code;
  details;
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ReProgressError";
    this.code = code;
    this.details = details;
  }
}
function formatError(error) {
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      details: error.details
    }
  };
}
function formatSuccess(data) {
  return { ok: true, data };
}

// src/index.ts
var pluginModule = { id: "opencode-openje", server: OpenJePlugin };
var src_default = pluginModule;
export {
  formatSuccess,
  formatError,
  src_default as default,
  ReProgressError,
  ReProgress,
  OpenJePlugin
};
