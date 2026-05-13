import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/migrations.js";
import { FunctionsModule } from "./functions.js";
import { InMemoryJsonStore } from "../persistence/JsonStore.js";

describe("FunctionsModule", () => {
  let db: Database;
  let mod: FunctionsModule;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    mod = new FunctionsModule(db);
  });

  afterEach(() => {
    db.close();
  });

  test("register and get function", async () => {
    await mod.register({ ea: "0x140012340", status: "discovered", lastPseudocodeHash: "hash-a" });

    const fn = await mod.get("0x140012340");

    expect(fn).not.toBeNull();
    expect(fn).toMatchObject({
      ea: "0x140012340",
      status: "discovered",
      summary_version: 0,
      accepted_summary_json: null,
      confidence: null,
      dirty: 0,
      last_pseudocode_hash: "hash-a",
    });
    expect(fn!.updated_at).toBeString();
  });

  test("register defaults missing status and pseudocode hash", async () => {
    await mod.register({ ea: "0x140012340" });

    const fn = await mod.get("0x140012340");

    expect(fn).not.toBeNull();
    expect(fn!.status).toBe("unknown");
    expect(fn!.last_pseudocode_hash).toBeNull();
    expect(fn!.dirty).toBe(0);
  });

  test("upsert updates existing function", async () => {
    await mod.register({ ea: "0x140012340", status: "discovered", lastPseudocodeHash: "hash-a" });
    await mod.register({ ea: "0x140012340", status: "queued", lastPseudocodeHash: "hash-b" });

    const fn = await mod.get("0x140012340");

    expect(fn).not.toBeNull();
    expect(fn!.status).toBe("queued");
    expect(fn!.last_pseudocode_hash).toBe("hash-b");
  });

  test("register a soft-deleted function clears removed_at and removal_reason", async () => {
    // First register a function
    await mod.register({ ea: "0x140012340", status: "discovered" });

    // Simulate soft-delete by directly setting removed_at and removal_reason
    db.query(
      `UPDATE analysis_functions
       SET removed_at = '2024-01-01T00:00:00.000Z',
           removal_reason = 'test reason'
       WHERE ea = $ea;`,
    ).run({ $ea: "0x140012340" });

    // Re-register should clear the soft-delete markers
    await mod.register({ ea: "0x140012340", status: "queued" });

    const fn = await mod.get("0x140012340");
    expect(fn).not.toBeNull();
    expect(fn!.removed_at).toBeNull();
    expect(fn!.removal_reason).toBeNull();
    expect(fn!.status).toBe("queued");
  });

  test("re-register preserves analysis state: summary_version, confidence, dirty unchanged", async () => {
    // First register a function
    await mod.register({ ea: "0x140012340", status: "discovered" });

    // Simulate having analysis done by directly setting analysis columns
    db.query(
      `UPDATE analysis_functions
       SET summary_version = 3,
           accepted_summary_json = '{"key":"value"}',
           confidence = 0.95,
           dirty = 1
       WHERE ea = $ea;`,
    ).run({ $ea: "0x140012340" });

    // Re-register should NOT wipe analysis state
    await mod.register({ ea: "0x140012340", status: "queued" });

    const fn = await mod.get("0x140012340");
    expect(fn).not.toBeNull();
    expect(fn!.summary_version).toBe(3);
    expect(fn!.accepted_summary_json).toBe('{"key":"value"}');
    expect(fn!.confidence).toBe(0.95);
    expect(fn!.dirty).toBe(1);
  });

  test("register new function still works as before", async () => {
    await mod.register({ ea: "0x140012340", status: "discovered", lastPseudocodeHash: "hash-a" });

    const fn = await mod.get("0x140012340");

    expect(fn).not.toBeNull();
    expect(fn!.ea).toBe("0x140012340");
    expect(fn!.status).toBe("discovered");
    expect(fn!.last_pseudocode_hash).toBe("hash-a");
    expect(fn!.summary_version).toBe(0);
    expect(fn!.accepted_summary_json).toBeNull();
    expect(fn!.confidence).toBeNull();
    expect(fn!.dirty).toBe(0);
    expect(fn!.removed_at).toBeNull();
    expect(fn!.removal_reason).toBeNull();
  });

  test("get returns null for missing function", async () => {
    const fn = await mod.get("missing");

    expect(fn).toBeNull();
  });

  test("setStatus updates status with timestamp", async () => {
    await mod.register({ ea: "0x140012340", status: "discovered" });
    const before = await mod.get("0x140012340");

    await mod.setStatus("0x140012340", "reviewed");

    const after = await mod.get("0x140012340");
    expect(after).not.toBeNull();
    expect(after!.status).toBe("reviewed");
    expect(after!.updated_at).toBeString();
    expect(Date.parse(after!.updated_at!)).toBeGreaterThanOrEqual(Date.parse(before!.updated_at!));
  });

  test("markDirty sets dirty flag with timestamp", async () => {
    await mod.register({ ea: "0x140012340", status: "discovered" });
    const before = await mod.get("0x140012340");

    await mod.markDirty("0x140012340", "pseudocode changed");

    const fn = await mod.get("0x140012340");
    expect(fn).not.toBeNull();
    expect(fn!.dirty).toBe(1);
    expect(fn!.updated_at).toBeString();
    expect(Date.parse(fn!.updated_at!)).toBeGreaterThanOrEqual(Date.parse(before!.updated_at!));
  });

  test("listByStatus filters correctly", async () => {
    await mod.register({ ea: "A", status: "discovered" });
    await mod.register({ ea: "B", status: "queued" });
    await mod.register({ ea: "C", status: "discovered" });

    const discovered = await mod.listByStatus("discovered");

    expect(discovered.map((fn) => fn.ea)).toEqual(["A", "C"]);
    expect(discovered.every((fn) => fn.status === "discovered")).toBe(true);
  });

  test("listDirty returns all dirty functions", async () => {
    await mod.register({ ea: "A", status: "discovered" });
    await mod.register({ ea: "B", status: "queued" });
    await mod.register({ ea: "C", status: "reviewed" });
    await mod.markDirty("A");
    await mod.markDirty("C");

    const dirty = await mod.listDirty();

    expect(dirty.map((fn) => fn.ea)).toEqual(["A", "C"]);
    expect(dirty.every((fn) => fn.dirty === 1)).toBe(true);
  });

  test("listAll returns all functions", async () => {
    await mod.register({ ea: "A", status: "discovered" });
    await mod.register({ ea: "B", status: "queued" });
    await mod.register({ ea: "C", status: "reviewed" });

    const all = await mod.listAll();

    expect(all.map((fn) => fn.ea)).toEqual(["A", "B", "C"]);
  });

  describe("with JsonStore", () => {
    let db: Database;
    let jsonStore: InMemoryJsonStore;
    let mod: FunctionsModule;

    beforeEach(() => {
      db = new Database(":memory:");
      runMigrations(db);
      jsonStore = new InMemoryJsonStore();
      mod = new FunctionsModule(db, jsonStore);
    });

    afterEach(() => {
      db.close();
    });

    test("register writes to JSON store", async () => {
      await mod.register({ ea: "0x140012340", status: "discovered", lastPseudocodeHash: "hash-a" });

      const json = await jsonStore.read("functions", "0x140012340");

      expect(json).not.toBeNull();
      expect(json).toMatchObject({
        ea: "0x140012340",
        status: "discovered",
        last_pseudocode_hash: "hash-a",
      });
      expect(json!.updated_at).toBeString();
    });

    test("setStatus writes to JSON store", async () => {
      await mod.register({ ea: "0x140012340", status: "discovered" });
      await mod.setStatus("0x140012340", "reviewed");

      const json = await jsonStore.read("functions", "0x140012340");

      expect(json).not.toBeNull();
      expect(json).toMatchObject({
        ea: "0x140012340",
        status: "reviewed",
      });
    });

    test("markDirty writes to JSON store", async () => {
      await mod.register({ ea: "0x140012340", status: "discovered" });
      await mod.markDirty("0x140012340", "pseudocode changed");

      const json = await jsonStore.read("functions", "0x140012340");

      expect(json).not.toBeNull();
      expect(json).toMatchObject({
        ea: "0x140012340",
        dirty: 1,
      });
    });

    test("register without jsonStore does not throw", async () => {
      const modNoJson = new FunctionsModule(db);
      await modNoJson.register({ ea: "0x140012340", status: "discovered" });

      const fn = await modNoJson.get("0x140012340");
      expect(fn).not.toBeNull();
    });
  });

  describe("unregister", () => {
    test("unregister with no dependents sets status=removed, removed_at, removal_reason", async () => {
      await mod.register({ ea: "0x140012340", status: "discovered" });

      await mod.unregister("0x140012340", "no longer needed");

      const fn = await mod.get("0x140012340");
      expect(fn).not.toBeNull();
      expect(fn!.status).toBe("removed");
      expect(fn!.removed_at).not.toBeNull();
      expect(fn!.removal_reason).toBe("no longer needed");
    });

    test("unregister non-existent function throws 'not found'", async () => {
      await expect(mod.unregister("0xDEAD", "gone")).rejects.toThrow("Function 0xDEAD not found");
    });

    test("unregister with edges throws error with edge count", async () => {
      await mod.register({ ea: "0x140012340", status: "discovered" });
      await mod.register({ ea: "0x140056789", status: "discovered" });
      db.query("INSERT INTO analysis_edges (caller_ea, callee_ea, edge_kind) VALUES ($caller, $callee, $kind)").run({
        $caller: "0x140012340",
        $callee: "0x140056789",
        $kind: "direct_call",
      });

      await expect(mod.unregister("0x140012340", "gone")).rejects.toThrow(/has 1 edges.*0 active jobs.*0 worker_runs.*0 reviews.*0 dependencies/);
    });

    test("unregister with worker_runs throws error with worker_run count", async () => {
      await mod.register({ ea: "0x140012340", status: "discovered" });
      db.query("INSERT INTO worker_runs (function_ea, role, model, output_json) VALUES ($ea, $role, $model, $output)").run({
        $ea: "0x140012340",
        $role: "analyst",
        $model: "gpt-4",
        $output: "{}",
      });

      await expect(mod.unregister("0x140012340", "gone")).rejects.toThrow(/has 0 edges.*0 active jobs.*1 worker_runs.*0 reviews.*0 dependencies/);
    });

    test("unregister with reviews throws error with review count", async () => {
      await mod.register({ ea: "0x140012340", status: "discovered" });
      db.query("INSERT INTO reviews (function_ea, reviewer_model, contract_version, accepted_contract_json) VALUES ($ea, $model, $ver, $json)").run({
        $ea: "0x140012340",
        $model: "gpt-4",
        $ver: 1,
        $json: "{}",
      });

      await expect(mod.unregister("0x140012340", "gone")).rejects.toThrow(/has 0 edges.*0 active jobs.*0 worker_runs.*1 reviews.*0 dependencies/);
    });

    test("unregister with active (queued) jobs throws error", async () => {
      await mod.register({ ea: "0x140012340", status: "discovered" });
      db.query("INSERT INTO jobs (job_id, job_type, target, status) VALUES ($id, $type, $target, $status)").run({
        $id: "job-1",
        $type: "analyze_function_semantics",
        $target: "0x140012340",
        $status: "queued",
      });

      await expect(mod.unregister("0x140012340", "gone")).rejects.toThrow(/has 0 edges.*1 active jobs.*0 worker_runs.*0 reviews.*0 dependencies/);
    });

    test("unregister with active (running) jobs throws error", async () => {
      await mod.register({ ea: "0x140012340", status: "discovered" });
      db.query("INSERT INTO jobs (job_id, job_type, target, status) VALUES ($id, $type, $target, $status)").run({
        $id: "job-2",
        $type: "analyze_function_semantics",
        $target: "0x140012340",
        $status: "running",
      });

      await expect(mod.unregister("0x140012340", "gone")).rejects.toThrow(/has 0 edges.*1 active jobs/);
    });

    test("unregister with done/failed/cancelled jobs succeeds", async () => {
      await mod.register({ ea: "0x140012340", status: "discovered" });
      db.query("INSERT INTO jobs (job_id, job_type, target, status) VALUES ($id, $type, $target, $status)").run({
        $id: "job-done",
        $type: "analyze_function_semantics",
        $target: "0x140012340",
        $status: "done",
      });
      db.query("INSERT INTO jobs (job_id, job_type, target, status) VALUES ($id, $type, $target, $status)").run({
        $id: "job-failed",
        $type: "analyze_function_semantics",
        $target: "0x140012340",
        $status: "failed",
      });
      db.query("INSERT INTO jobs (job_id, job_type, target, status) VALUES ($id, $type, $target, $status)").run({
        $id: "job-cancelled",
        $type: "analyze_function_semantics",
        $target: "0x140012340",
        $status: "cancelled",
      });

      await mod.unregister("0x140012340", "done with it");

      const fn = await mod.get("0x140012340");
      expect(fn!.status).toBe("removed");
    });

    test("unregister with summary_dependencies throws error with dependency count", async () => {
      await mod.register({ ea: "0x140012340", status: "discovered" });
      await mod.register({ ea: "0x140056789", status: "discovered" });
      db.query("INSERT INTO summary_dependencies (parent_ea, child_ea, child_summary_version_used) VALUES ($parent, $child, $ver)").run({
        $parent: "0x140012340",
        $child: "0x140056789",
        $ver: 1,
      });

      await expect(mod.unregister("0x140012340", "gone")).rejects.toThrow(/has 0 edges.*0 active jobs.*0 worker_runs.*0 reviews.*1 dependencies/);
    });

    test("unregister syncs to JsonStore", async () => {
      const jsonStore = new InMemoryJsonStore();
      const modWithJson = new FunctionsModule(db, jsonStore);
      await modWithJson.register({ ea: "0x140012340", status: "discovered" });

      await modWithJson.unregister("0x140012340", "no longer needed");

      const json = await jsonStore.read("functions", "0x140012340");
      expect(json).not.toBeNull();
      expect(json).toMatchObject({
        ea: "0x140012340",
        status: "removed",
        removal_reason: "no longer needed",
      });
      expect(json!.removed_at).toBeString();
    });
  });

  describe("register (upsert fix)", () => {
    test("register after unregister clears removed_at and removal_reason", async () => {
      await mod.register({ ea: "0x140012340", status: "discovered" });
      await mod.unregister("0x140012340", "no longer needed");

      const afterUnregister = await mod.get("0x140012340");
      expect(afterUnregister!.status).toBe("removed");
      expect(afterUnregister!.removed_at).not.toBeNull();
      expect(afterUnregister!.removal_reason).toBe("no longer needed");

      await mod.register({ ea: "0x140012340", status: "discovered" });

      const afterReregister = await mod.get("0x140012340");
      expect(afterReregister!.status).toBe("discovered");
      expect(afterReregister!.removed_at).toBeNull();
      expect(afterReregister!.removal_reason).toBeNull();
    });

    test("re-register preserves analysis state (summary_version, confidence, dirty)", async () => {
      await mod.register({ ea: "0x140012340", status: "discovered" });
      // Simulate analysis state being set
      db.query("UPDATE analysis_functions SET summary_version = 3, confidence = 0.95, dirty = 1 WHERE ea = $ea").run({
        $ea: "0x140012340",
      });

      await mod.register({ ea: "0x140012340", status: "queued", lastPseudocodeHash: "new-hash" });

      const fn = await mod.get("0x140012340");
      expect(fn!.status).toBe("queued");
      expect(fn!.last_pseudocode_hash).toBe("new-hash");
      expect(fn!.summary_version).toBe(3);
      expect(fn!.confidence).toBe(0.95);
      expect(fn!.dirty).toBe(1);
    });
  });
});
