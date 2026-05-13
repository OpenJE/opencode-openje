export interface JsonStore {
  write(tableDir: string, key: string, data: Record<string, unknown>): Promise<void>;
  read(tableDir: string, key: string): Promise<Record<string, unknown> | null>;
  delete(tableDir: string, key: string): Promise<void>;
  list(tableDir: string): Promise<string[]>;
  listAll(): Promise<Map<string, string[]>>;
  readRaw(tableDir: string, key: string): Promise<Record<string, unknown> | null>;
}

export interface TableConfig {
  tableDir: string;
  primaryKey: (record: unknown) => string;
}

type TableName =
  | "analysis_functions"
  | "analysis_edges"
  | "jobs"
  | "worker_runs"
  | "reviews"
  | "summary_dependencies"
  | "source_symbols"
  | "source_blocks"
  | "simplifications";

type FieldValue = string | number;

export function sanitizeEaForFilename(ea: string): string {
  return ea.replaceAll(/[/:]/g, "_");
}

export function analysisEdgeKey(callerEa: string, calleeEa: string): string {
  return `${sanitizeEaForFilename(callerEa)}__${sanitizeEaForFilename(calleeEa)}`;
}

export function summaryDependencyKey(parentEa: string, childEa: string): string {
  return `${sanitizeEaForFilename(parentEa)}__${sanitizeEaForFilename(childEa)}`;
}

export function workerRunKey(functionEa: string, role: string, id: FieldValue): string {
  return `${sanitizeEaForFilename(functionEa)}__${sanitizeSegment(role)}__${id}`;
}

export function reviewKey(functionEa: string, contractVersion: FieldValue): string {
  return `${sanitizeEaForFilename(functionEa)}__v${contractVersion}`;
}

export function simplificationKey(symbolId: string, id: FieldValue): string {
  return `${sanitizeSegment(symbolId)}__${id}`;
}

function sanitizeSegment(value: string): string {
  return value.replaceAll(/[/:]/g, "_");
}

function field(record: unknown, name: string): FieldValue {
  if (record === null || typeof record !== "object" || !(name in record)) {
    throw new TypeError(`record is missing required field ${name}`);
  }

  const value = (record as Record<string, unknown>)[name];
  if (typeof value !== "string" && typeof value !== "number") {
    throw new TypeError(`record field ${name} must be a string or number`);
  }

  return value;
}

function stringField(record: unknown, name: string): string {
  return String(field(record, name));
}

export const TABLE_CONFIGS: Record<TableName, TableConfig> = {
  analysis_functions: {
    tableDir: "analysis_functions",
    primaryKey: (record) => sanitizeEaForFilename(stringField(record, "ea")),
  },
  analysis_edges: {
    tableDir: "analysis_edges",
    primaryKey: (record) => analysisEdgeKey(stringField(record, "caller_ea"), stringField(record, "callee_ea")),
  },
  jobs: {
    tableDir: "jobs",
    primaryKey: (record) => sanitizeSegment(stringField(record, "job_id")),
  },
  worker_runs: {
    tableDir: "worker_runs",
    primaryKey: (record) =>
      workerRunKey(stringField(record, "function_ea"), stringField(record, "role"), field(record, "id")),
  },
  reviews: {
    tableDir: "reviews",
    primaryKey: (record) => reviewKey(stringField(record, "function_ea"), field(record, "contract_version")),
  },
  summary_dependencies: {
    tableDir: "summary_dependencies",
    primaryKey: (record) => summaryDependencyKey(stringField(record, "parent_ea"), stringField(record, "child_ea")),
  },
  source_symbols: {
    tableDir: "source_symbols",
    primaryKey: (record) => sanitizeSegment(stringField(record, "symbol_id")),
  },
  source_blocks: {
    tableDir: "source_blocks",
    primaryKey: (record) => sanitizeSegment(stringField(record, "block_id")),
  },
  simplifications: {
    tableDir: "simplifications",
    primaryKey: (record) => simplificationKey(stringField(record, "symbol_id"), field(record, "id")),
  },
} as const;
