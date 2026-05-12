import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const REWORK_DIR = ".rework";
export const REWORK_DB_FILE = "re.db";

export const REWORK_SUBDIRS = [
  "packets",
  "worker_outputs",
  "reviews",
  "summaries",
  "traversal_logs",
  "source_map",
  "patch_plans",
  "artifacts",
] as const;

export class DbError extends Error {
  readonly code = "DB_ERROR";

  constructor(message: string, options?: ErrorOptions) {
    super(`DB_ERROR: ${message}`, options);
    this.name = "DbError";
  }
}

export function ensureWorkdir(root: string): string {
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

export function openDatabase(root: string): Database {
  const workdir = ensureWorkdir(root);
  const dbPath = join(workdir, REWORK_DB_FILE);

  let db: Database;
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

export function closeDatabase(db: Database): void {
  db.close();
}
