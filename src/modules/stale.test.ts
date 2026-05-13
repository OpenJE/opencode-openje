import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/migrations.js";
import { FunctionsModule } from "./functions.js";
import { DependenciesModule } from "./dependencies.js";
import { StaleModule } from "./stale.js";
import { InMemoryJsonStore } from "../persistence/JsonStore.js";

describe("StaleModule", () => {
  let db: Database;
  let functions: FunctionsModule;
  let dependencies: DependenciesModule;
  let stale: StaleModule;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    functions = new FunctionsModule(db);
    dependencies = new DependenciesModule(db);
    stale = new StaleModule(db);
  });

  afterEach(() => {
    db.close();
  });

  test("markParentsStale returns empty array when no stale dependencies exist", async () => {
    await functions.register({ ea: "0x1000" });
    await functions.register({ ea: "0x2000" });
    await dependencies.record("0x1000", "0x2000", 1);

    const result = await stale.markParentsStale("0x2000");

    expect(result).toEqual([]);
  });

  test("markParentsStale returns parent EAs when child summary_version > recorded version", async () => {
    await functions.register({ ea: "0x1000" });
    await functions.register({ ea: "0x2000" });
    await dependencies.record("0x1000", "0x2000", 1);

    db.query("UPDATE analysis_functions SET summary_version = 2 WHERE ea = '0x2000';").run();

    const result = await stale.markParentsStale("0x2000");

    expect(result).toEqual(["0x1000"]);
    const parent = await functions.get("0x1000");
    expect(parent?.status).toBe("stale");
  });

  test("markParentsStale does not re-mark already-stale parents", async () => {
    await functions.register({ ea: "0x1000" });
    await functions.register({ ea: "0x2000" });
    await dependencies.record("0x1000", "0x2000", 1);
    db.query("UPDATE analysis_functions SET summary_version = 2 WHERE ea = '0x2000';").run();

    await stale.markParentsStale("0x2000");
    const result = await stale.markParentsStale("0x2000");

    expect(result).toEqual(["0x1000"]);
    const parent = await functions.get("0x1000");
    expect(parent?.status).toBe("stale");
  });

  test("markParentsStale with multiple parents where only some are stale", async () => {
    await functions.register({ ea: "0x1000" });
    await functions.register({ ea: "0x2000" });
    await functions.register({ ea: "0x3000" });
    await functions.register({ ea: "0x4000" });
    await dependencies.record("0x1000", "0x4000", 1);
    await dependencies.record("0x2000", "0x4000", 5);
    await dependencies.record("0x3000", "0x4000", 1);

    db.query("UPDATE analysis_functions SET summary_version = 2 WHERE ea = '0x4000';").run();

    const result = await stale.markParentsStale("0x4000");

    expect(result).toContain("0x1000");
    expect(result).toContain("0x3000");
    expect(result).not.toContain("0x2000");
  });

  test("list returns all stale functions ordered by ea", async () => {
    await functions.register({ ea: "0x2000", status: "stale" });
    await functions.register({ ea: "0x1000", status: "stale" });
    await functions.register({ ea: "0x3000" });

    const result = await stale.list();

    expect(result).toEqual([
      expect.objectContaining({ ea: "0x1000", status: "stale" }),
      expect.objectContaining({ ea: "0x2000", status: "stale" }),
    ]);
  });

  test("list returns empty array when no stale functions exist", async () => {
    await functions.register({ ea: "0x1000" });

    const result = await stale.list();

    expect(result).toEqual([]);
  });

  test("isStale returns true for stale function", async () => {
    await functions.register({ ea: "0x1000", status: "stale" });

    const result = await stale.isStale("0x1000");

    expect(result).toBe(true);
  });

  test("isStale returns false for non-stale function", async () => {
    await functions.register({ ea: "0x1000" });

    const result = await stale.isStale("0x1000");

    expect(result).toBe(false);
  });

  test("isStale returns false for nonexistent function", async () => {
    const result = await stale.isStale("nonexistent");

    expect(result).toBe(false);
  });

  describe("with JsonStore", () => {
    let db: Database;
    let jsonStore: InMemoryJsonStore;
    let functions: FunctionsModule;
    let dependencies: DependenciesModule;
    let stale: StaleModule;

    beforeEach(() => {
      db = new Database(":memory:");
      runMigrations(db);
      jsonStore = new InMemoryJsonStore();
      functions = new FunctionsModule(db, jsonStore);
      dependencies = new DependenciesModule(db);
      stale = new StaleModule(db, jsonStore);
    });

    afterEach(() => {
      db.close();
    });

    test("markParentsStale writes updated parents to JSON store", async () => {
      await functions.register({ ea: "0x1000" });
      await functions.register({ ea: "0x2000" });
      await dependencies.record("0x1000", "0x2000", 1);
      db.query("UPDATE analysis_functions SET summary_version = 2 WHERE ea = '0x2000';").run();

      await stale.markParentsStale("0x2000");

      const json = await jsonStore.read("functions", "0x1000");
      expect(json).not.toBeNull();
      expect(json).toMatchObject({
        ea: "0x1000",
        status: "stale",
      });
    });

    test("markParentsStale without jsonStore does not throw", async () => {
      const staleNoJson = new StaleModule(db);
      await functions.register({ ea: "0x1000" });
      await functions.register({ ea: "0x2000" });
      await dependencies.record("0x1000", "0x2000", 1);
      db.query("UPDATE analysis_functions SET summary_version = 2 WHERE ea = '0x2000';").run();

      await staleNoJson.markParentsStale("0x2000");

      const fn = await functions.get("0x1000");
      expect(fn?.status).toBe("stale");
    });
  });
});
