import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/migrations.js";
import { FunctionsModule } from "./functions.js";

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
});
