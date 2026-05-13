import type { Database } from "bun:sqlite";
import {
  CREATE_META_TABLE_SQL,
  V1_TABLE_STATEMENTS,
  ALTER_ANALYSIS_FUNCTIONS_ADD_REMOVAL_COLUMNS_SQL,
  ALTER_REVIEWS_ADD_AMEND_REASON_SQL,
} from "./schema.js";

export interface Migration {
  version: number;
  up: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: V1_TABLE_STATEMENTS.join("\n"),
  },
  {
    version: 2,
    up: [ALTER_ANALYSIS_FUNCTIONS_ADD_REMOVAL_COLUMNS_SQL, ALTER_REVIEWS_ADD_AMEND_REASON_SQL]
      .map((sql) => sql.trim())
      .filter(Boolean)
      .join("\n"),
  },
] as const;

export function runMigrations(db: Database): void {
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

function getCurrentSchemaVersion(db: Database): number {
  const row = db.query("SELECT value FROM _meta WHERE key = 'schema_version';").get() as { value: string } | null;
  if (!row) {
    return 0;
  }

  const version = Number.parseInt(row.value, 10);
  return Number.isFinite(version) ? version : 0;
}

function setCurrentSchemaVersion(db: Database, version: number): void {
  db.query(
    `INSERT INTO _meta (key, value, updated_at)
     VALUES ('schema_version', $version, $updatedAt)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
  ).run({
    $version: String(version),
    $updatedAt: new Date().toISOString(),
  });
}

function runSqlBatch(db: Database, sql: string): void {
  for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
    db.run(`${statement};`);
  }
}
