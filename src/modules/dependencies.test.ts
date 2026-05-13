import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/migrations.js";
import { DependenciesModule } from "./dependencies.js";
import { FunctionsModule } from "./functions.js";
import { InMemoryJsonStore } from "../persistence/JsonStore.js";
import { summaryDependencyKey } from "../persistence/types.js";

async function withDependencies(
  testBody: (deps: DependenciesModule, db: Database) => Promise<void>,
): Promise<void> {
  const db = new Database(":memory:");
  runMigrations(db);

  try {
    await testBody(new DependenciesModule(db), db);
  } finally {
    db.close();
  }
}

async function withDependenciesAndJsonStore(
  testBody: (deps: DependenciesModule, db: Database, jsonStore: InMemoryJsonStore) => Promise<void>,
): Promise<void> {
  const db = new Database(":memory:");
  const jsonStore = new InMemoryJsonStore();
  runMigrations(db);

  try {
    await testBody(new DependenciesModule(db, jsonStore), db, jsonStore);
  } finally {
    db.close();
  }
}

describe("DependenciesModule", () => {
  test("record inserts a dependency", async () => {
    await withDependencies(async (deps) => {
      await deps.record("0x1000", "0x2000", 5);

      const result = await deps.get("0x1000", "0x2000");
      expect(result).toEqual({
        parent_ea: "0x1000",
        child_ea: "0x2000",
        child_summary_version_used: 5,
      });
    });
  });

  test("record upserts on repeated call", async () => {
    await withDependencies(async (deps) => {
      await deps.record("0x1000", "0x2000", 5);
      await deps.record("0x1000", "0x2000", 10);

      const result = await deps.get("0x1000", "0x2000");
      expect(result).toEqual({
        parent_ea: "0x1000",
        child_ea: "0x2000",
        child_summary_version_used: 10,
      });
    });
  });

  test("usedByParent returns dependencies for a given parent", async () => {
    await withDependencies(async (deps) => {
      await deps.record("0x1000", "0x2000", 1);
      await deps.record("0x1000", "0x3000", 2);
      await deps.record("0x4000", "0x2000", 1);

      const result = await deps.usedByParent("0x1000");
      expect(result.map((r) => r.child_ea)).toEqual(["0x2000", "0x3000"]);
    });
  });

  test("staleParentsOf returns parents where recorded version is behind current", async () => {
    await withDependencies(async (deps, db) => {
      const fns = new FunctionsModule(db);
      await fns.register({ ea: "0x2000", status: "unknown" });
      await fns.register({ ea: "0x1000", status: "unknown" });
      db.query(`UPDATE analysis_functions SET summary_version = 5 WHERE ea = $ea;`).run({ $ea: "0x2000" });
      await deps.record("0x1000", "0x2000", 3);

      const stale = await deps.staleParentsOf("0x2000");
      expect(stale).toEqual(["0x1000"]);
    });
  });

  test("staleParentsOf returns empty when versions match", async () => {
    await withDependencies(async (deps, db) => {
      const fns = new FunctionsModule(db);
      await fns.register({ ea: "0x2000", status: "unknown" });
      await fns.register({ ea: "0x1000", status: "unknown" });
      db.query(`UPDATE analysis_functions SET summary_version = 5 WHERE ea = $ea;`).run({ $ea: "0x2000" });
      await deps.record("0x1000", "0x2000", 5);

      const stale = await deps.staleParentsOf("0x2000");
      expect(stale).toEqual([]);
    });
  });

  test("get returns null for missing dependency", async () => {
    await withDependencies(async (deps) => {
      const result = await deps.get("0x1000", "0x2000");
      expect(result).toBeNull();
    });
  });

  test("remove deletes dependency", async () => {
    await withDependencies(async (deps) => {
      await deps.record("0x1000", "0x2000", 5);
      await deps.remove("0x1000", "0x2000");

      const result = await deps.get("0x1000", "0x2000");
      expect(result).toBeNull();
    });
  });

  test("remove on nonexistent does not throw", async () => {
    await withDependencies(async (deps) => {
      expect(() => deps.remove("0x1000", "0x2000")).not.toThrow();
    });
  });

  test("record writes to JSON store", async () => {
    await withDependenciesAndJsonStore(async (deps, _db, jsonStore) => {
      const parentEa = "0x1000";
      const childEa = "0x2000";
      const childVersion = 5;
      const key = summaryDependencyKey(parentEa, childEa);

      await deps.record(parentEa, childEa, childVersion);

      const result = await jsonStore.read("dependencies", key);
      expect(result).toEqual({
        parent_ea: parentEa,
        child_ea: childEa,
        child_summary_version_used: childVersion,
      });
    });
  });

  test("record upsert writes latest to JSON store", async () => {
    await withDependenciesAndJsonStore(async (deps, _db, jsonStore) => {
      const parentEa = "0x1000";
      const childEa = "0x2000";
      const key = summaryDependencyKey(parentEa, childEa);

      await deps.record(parentEa, childEa, 5);
      await deps.record(parentEa, childEa, 10);

      const result = await jsonStore.read("dependencies", key);
      expect(result).toEqual({
        parent_ea: parentEa,
        child_ea: childEa,
        child_summary_version_used: 10,
      });
    });
  });

  test("remove deletes from JSON store", async () => {
    await withDependenciesAndJsonStore(async (deps, _db, jsonStore) => {
      const parentEa = "0x1000";
      const childEa = "0x2000";
      const key = summaryDependencyKey(parentEa, childEa);

      await deps.record(parentEa, childEa, 5);
      await deps.remove(parentEa, childEa);

      const result = await jsonStore.read("dependencies", key);
      expect(result).toBeNull();
    });
  });
});