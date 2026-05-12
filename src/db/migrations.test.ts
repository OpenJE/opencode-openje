import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "./migrations.js";

const expectedTables = [
  "_meta",
  "analysis_functions",
  "analysis_edges",
  "jobs",
  "worker_runs",
  "reviews",
  "summary_dependencies",
  "scc_groups",
  "source_symbols",
  "source_blocks",
  "simplifications",
];

function tableNames(db: Database): string[] {
  return db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")
    .all()
    .map((row) => (row as { name: string }).name);
}

describe("runMigrations", () => {
  test("creates all V1 tables and records schema version", () => {
    const db = new Database(":memory:");
    try {
      runMigrations(db);

      expect(tableNames(db)).toEqual([...expectedTables].sort());
      expect(db.query("SELECT value FROM _meta WHERE key = 'schema_version';").get()).toEqual({ value: "1" });
    } finally {
      db.close();
    }
  });

  test("is idempotent when run repeatedly", () => {
    const db = new Database(":memory:");
    try {
      runMigrations(db);
      runMigrations(db);

      expect(tableNames(db)).toEqual([...expectedTables].sort());
      expect(db.query("SELECT value FROM _meta WHERE key = 'schema_version';").get()).toEqual({ value: "1" });
    } finally {
      db.close();
    }
  });
});
