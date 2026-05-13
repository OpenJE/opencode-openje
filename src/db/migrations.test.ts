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
      expect(db.query("SELECT value FROM _meta WHERE key = 'schema_version';").get()).toEqual({ value: "2" });
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
      expect(db.query("SELECT value FROM _meta WHERE key = 'schema_version';").get()).toEqual({ value: "2" });
    } finally {
      db.close();
    }
  });

  test("V2 migration adds removed_at and removal_reason to analysis_functions", () => {
    const db = new Database(":memory:");
    try {
      runMigrations(db);

      const columns = db
        .query("PRAGMA table_info(analysis_functions)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(columns).toContain("removed_at");
      expect(columns).toContain("removal_reason");

      const removedAtCol = db
        .query("PRAGMA table_info(analysis_functions)")
        .all()
        .find((row) => (row as { name: string }).name === "removed_at") as { name: string; notnull: number } | undefined;
      expect(removedAtCol).toBeDefined();
      expect(removedAtCol!.notnull).toBe(0);
    } finally {
      db.close();
    }
  });

  test("V2 migration adds amend_reason to reviews", () => {
    const db = new Database(":memory:");
    try {
      runMigrations(db);

      const columns = db
        .query("PRAGMA table_info(reviews)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(columns).toContain("amend_reason");

      const amendReasonCol = db
        .query("PRAGMA table_info(reviews)")
        .all()
        .find((row) => (row as { name: string }).name === "amend_reason") as { name: string; notnull: number } | undefined;
      expect(amendReasonCol).toBeDefined();
      expect(amendReasonCol!.notnull).toBe(0);
    } finally {
      db.close();
    }
  });

  test("V2 migration sets schema version to 2", () => {
    const db = new Database(":memory:");
    try {
      runMigrations(db);

      expect(db.query("SELECT value FROM _meta WHERE key = 'schema_version';").get()).toEqual({ value: "2" });
    } finally {
      db.close();
    }
  });
});
