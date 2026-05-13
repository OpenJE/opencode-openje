import type { Database, SQLQueryBindings } from "bun:sqlite";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { REWORK_DIR } from "../db/connection.js";
import { JsonStore } from "./JsonStore.js";
import { TABLE_CONFIGS } from "./types.js";

type JsonRecord = Record<string, unknown>;
type TableName = keyof typeof TABLE_CONFIGS;

const TABLE_ORDER: readonly TableName[] = [
  "analysis_functions",
  "analysis_edges",
  "worker_runs",
  "reviews",
  "summary_dependencies",
  "source_symbols",
  "source_blocks",
  "simplifications",
  "jobs",
];

const TABLE_DIR_ALIASES: Partial<Record<TableName, readonly string[]>> = {
  analysis_functions: ["functions"],
  analysis_edges: ["edges"],
  summary_dependencies: ["dependencies"],
};

const INDEXED_JOB_STATUSES = new Set(["done", "cancelled", "failed"]);

const SQL = {
  analysis_functions:
    "INSERT OR REPLACE INTO analysis_functions (ea, status, summary_version, accepted_summary_json, confidence, dirty, last_pseudocode_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  analysis_edges:
    "INSERT OR REPLACE INTO analysis_edges (caller_ea, callee_ea, edge_kind, blocking, reason, discovered_at) VALUES (?, ?, ?, ?, ?, ?)",
  worker_runs:
    "INSERT OR REPLACE INTO worker_runs (id, job_id, function_ea, role, model, input_hash, output_json, output_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  reviews:
    "INSERT OR REPLACE INTO reviews (id, function_ea, reviewer_model, contract_version, accepted_contract_json, accepted_contract_path, rejected_claims_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  summary_dependencies:
    "INSERT OR REPLACE INTO summary_dependencies (parent_ea, child_ea, child_summary_version_used) VALUES (?, ?, ?)",
  source_symbols:
    "INSERT OR REPLACE INTO source_symbols (symbol_id, kind, name, namespace, origin_ea, contract_version, definition_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  source_blocks:
    "INSERT OR REPLACE INTO source_blocks (block_id, symbol_id, file_path, block_hash, managed, manual_override, fidelity_mode, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  simplifications:
    "INSERT OR REPLACE INTO simplifications (id, symbol_id, function_ea, kind, original_json, replacement_json, evidence_json, risk, reviewer_required, accepted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  jobs:
    "INSERT OR REPLACE INTO jobs (job_id, job_type, target, agent_role, status, input_path, output_path, attempt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
} as const;

const DELETE_SQL = {
  analysis_functions: "DELETE FROM analysis_functions WHERE ea = ?",
  analysis_edges: "DELETE FROM analysis_edges WHERE caller_ea = ? AND callee_ea = ?",
  worker_runs: "DELETE FROM worker_runs WHERE id = ?",
  reviews: "DELETE FROM reviews WHERE function_ea = ? AND contract_version = ?",
  summary_dependencies: "DELETE FROM summary_dependencies WHERE parent_ea = ? AND child_ea = ?",
  source_symbols: "DELETE FROM source_symbols WHERE symbol_id = ?",
  source_blocks: "DELETE FROM source_blocks WHERE block_id = ?",
  simplifications: "DELETE FROM simplifications WHERE id = ?",
  jobs: "DELETE FROM jobs WHERE job_id = ?",
} as const;

export async function reindex(root: string, db: Database): Promise<void> {
  const jsonStore = new JsonStore(root);
  const keysByTable = await listKeysIncludingTombstones(root, jsonStore);

  const rebuild = db.transaction(() => {
    for (const table of TABLE_ORDER) {
      const tableDir = TABLE_CONFIGS[table].tableDir;
      const keys = keysByTable.get(tableDir) ?? [];

      for (const key of keys) {
        const record = records.get(`${tableDir}\0${key}`);
        if (record === undefined || record === null) {
          continue;
        }

        if (isTombstone(record)) {
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

async function listKeysIncludingTombstones(root: string, jsonStore: JsonStore): Promise<Map<string, string[]>> {
  const tables = await jsonStore.listAll();
  const merged = new Map<string, Set<string>>();

  for (const [tableDir, keys] of tables.entries()) {
    merged.set(tableDir, new Set(keys));
  }

  for (const table of TABLE_ORDER) {
    const config = TABLE_CONFIGS[table];
    const keys = merged.get(config.tableDir) ?? new Set<string>();

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

async function rawKeys(root: string, tableDir: string): Promise<string[]> {
  try {
    const entries = await readdir(join(root, REWORK_DIR, tableDir), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -".json".length));
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return [];
    }

    throw cause;
  }
}

async function readRecords(jsonStore: JsonStore, keysByTable: Map<string, string[]>): Promise<Map<string, JsonRecord | null>> {
  const records = new Map<string, JsonRecord | null>();

  for (const [tableDir, keys] of keysByTable.entries()) {
    for (const key of keys) {
      records.set(`${tableDir}\0${key}`, await readRawFromDirs(jsonStore, tableDirsForCanonical(tableDir), key));
    }
  }

  return records;
}

async function readRawFromDirs(jsonStore: JsonStore, tableDirs: readonly string[], key: string): Promise<JsonRecord | null> {
  let record: JsonRecord | null = null;

  for (const tableDir of tableDirs) {
    const candidate = await jsonStore.readRaw(tableDir, key);
    if (candidate !== null) {
      record = candidate;
    }
  }

  return record;
}

function tableDirsFor(table: TableName): readonly string[] {
  return [TABLE_CONFIGS[table].tableDir, ...(TABLE_DIR_ALIASES[table] ?? [])];
}

function tableDirsForCanonical(tableDir: string): readonly string[] {
  for (const table of TABLE_ORDER) {
    if (TABLE_CONFIGS[table].tableDir === tableDir) {
      return tableDirsFor(table);
    }
  }

  return [tableDir];
}

function insertValues(table: TableName, key: string, record: JsonRecord): SQLQueryBindings[] | null {
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
        binding(record.updated_at),
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
        binding(record.discovered_at),
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
        binding(record.created_at),
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
        binding(record.created_at),
      ];
    }
    case "summary_dependencies": {
      const [parentEa, childEa] = splitKey(key, 2);
      return [
        stringValue(record.parent_ea) ?? parentEa,
        stringValue(record.child_ea) ?? childEa,
        binding(record.child_summary_version_used),
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
        binding(record.status),
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
        binding(record.updated_at),
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
        binding(record.created_at),
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
        binding(record.updated_at),
      ];
  }
}

function deleteValues(table: TableName, key: string): SQLQueryBindings[] {
  switch (table) {
    case "analysis_edges":
    case "summary_dependencies":
      return splitKey(key, 2);
    case "worker_runs":
      return [Number(splitKey(key, 3)[2])];
    case "reviews":
      return splitKey(key, 2).map((part, index) => (index === 1 ? Number(part.replace(/^v/, "")) : part));
    case "simplifications":
      return [Number(splitKey(key, 2)[1])];
    default:
      return [key];
  }
}

function splitKey(key: string, segments: number): string[] {
  const parts = key.split("__");
  if (parts.length !== segments) {
    throw new Error(`invalid reindex key ${key}`);
  }

  return parts;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function binding(value: unknown): SQLQueryBindings {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value;
  }

  return JSON.stringify(value);
}

function isTombstone(record: JsonRecord | null): boolean {
  return record?._deleted === true;
}
