import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/migrations.js";
import { SimplificationsModule } from "./simplifications.js";
import { InMemoryJsonStore } from "../persistence/JsonStore.js";
import { simplificationKey } from "../persistence/types.js";

describe("SimplificationsModule", () => {
  let db: Database;
  let mod: SimplificationsModule;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    mod = new SimplificationsModule(db);
  });

  afterEach(() => {
    db.close();
  });

  test("create with minimal input", async () => {
    const id = await mod.create({ symbolId: "sym_test", kind: "constant folding" });

    expect(id).toBeGreaterThan(0);
    const result = await mod.get(id);
    expect(result).toEqual({
      id,
      symbol_id: "sym_test",
      function_ea: null,
      kind: "constant folding",
      original_json: null,
      replacement_json: null,
      evidence_json: null,
      risk: null,
      reviewer_required: 0,
      accepted: null,
      created_at: expect.any(String),
    });
  });

  test("create with all optional fields", async () => {
    const id = await mod.create({
      symbolId: "sym_test",
      functionEa: "0x140001000",
      kind: "dead code removal",
      originalJson: '{"type":"const","value":42}',
      replacementJson: '{"type":"int","value":42}',
      evidenceJson: '{"location":"line 42"}',
      risk: "low",
      reviewerRequired: true,
    });

    const result = await mod.get(id);
    expect(result).toEqual({
      id,
      symbol_id: "sym_test",
      function_ea: "0x140001000",
      kind: "dead code removal",
      original_json: '{"type":"const","value":42}',
      replacement_json: '{"type":"int","value":42}',
      evidence_json: '{"location":"line 42"}',
      risk: "low",
      reviewer_required: 1,
      accepted: null,
      created_at: expect.any(String),
    });
  });

  test("get returns null for nonexistent ID", async () => {
    await expect(mod.get(99999)).resolves.toBeNull();
  });

  test("listBySymbol returns simplifications ordered by id", async () => {
    const id1 = await mod.create({ symbolId: "sym_a", kind: "kind1" });
    const id2 = await mod.create({ symbolId: "sym_a", kind: "kind2" });

    const results = await mod.listBySymbol("sym_a");
    expect(results.map((r) => r.id)).toEqual([id1, id2]);
  });

  test("listBySymbol returns empty array when no simplifications exist", async () => {
    await expect(mod.listBySymbol("missing")).resolves.toEqual([]);
  });

  test("listByFunction returns simplifications ordered by id", async () => {
    const id1 = await mod.create({ symbolId: "sym_1", functionEa: "0x1000", kind: "kind1" });
    const id2 = await mod.create({ symbolId: "sym_2", functionEa: "0x1000", kind: "kind2" });

    const results = await mod.listByFunction("0x1000");
    expect(results.map((r) => r.id)).toEqual([id1, id2]);
  });

  test("listByFunction returns empty array when no simplifications exist", async () => {
    await expect(mod.listByFunction("0x9999")).resolves.toEqual([]);
  });

  test("accept sets accepted = 1", async () => {
    const id = await mod.create({ symbolId: "sym_test", kind: "test" });
    await mod.accept(id);

    const result = await mod.get(id);
    expect(result?.accepted).toBe(1);
  });

  test("reject sets accepted = 0", async () => {
    const id = await mod.create({ symbolId: "sym_test", kind: "test" });
    await mod.reject(id);

    const result = await mod.get(id);
    expect(result?.accepted).toBe(0);
  });

  test("accept then reject overwrites accepted value", async () => {
    const id = await mod.create({ symbolId: "sym_test", kind: "test" });
    await mod.accept(id);
    await mod.reject(id);

    const result = await mod.get(id);
    expect(result?.accepted).toBe(0);
  });

  test("remove deletes simplification", async () => {
    const id = await mod.create({ symbolId: "sym_test", kind: "test" });
    await mod.remove(id);

    await expect(mod.get(id)).resolves.toBeNull();
  });

  test("remove on nonexistent doesn't throw", async () => {
    await expect(mod.remove(99999)).resolves.toBeUndefined();
  });
});

describe("SimplificationsModule with JsonStore", () => {
  let db: Database;
  let jsonStore: InMemoryJsonStore;
  let mod: SimplificationsModule;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    jsonStore = new InMemoryJsonStore();
    mod = new SimplificationsModule(db, jsonStore);
  });

  afterEach(() => {
    db.close();
  });

  test("create writes to JSON store", async () => {
    const symbolId = "sym_test";
    const id = await mod.create({ symbolId, kind: "constant folding" });

    const key = simplificationKey(symbolId, id);
    const jsonData = await jsonStore.read("simplifications", key);

    expect(jsonData).not.toBeNull();
    expect(jsonData).toMatchObject({
      id,
      symbol_id: symbolId,
      kind: "constant folding",
      accepted: null,
    });
  });

  test("accept writes updated record to JSON store", async () => {
    const symbolId = "sym_accept";
    const id = await mod.create({ symbolId, kind: "test" });
    await mod.accept(id);

    const key = simplificationKey(symbolId, id);
    const jsonData = await jsonStore.read("simplifications", key);

    expect(jsonData).toMatchObject({
      id,
      symbol_id: symbolId,
      accepted: 1,
    });
  });

  test("reject writes updated record to JSON store", async () => {
    const symbolId = "sym_reject";
    const id = await mod.create({ symbolId, kind: "test" });
    await mod.reject(id);

    const key = simplificationKey(symbolId, id);
    const jsonData = await jsonStore.read("simplifications", key);

    expect(jsonData).toMatchObject({
      id,
      symbol_id: symbolId,
      accepted: 0,
    });
  });

  test("remove writes tombstone to JSON store", async () => {
    const symbolId = "sym_remove";
    const id = await mod.create({ symbolId, kind: "test" });

    const key = simplificationKey(symbolId, id);
    await mod.remove(id);

    const jsonData = await jsonStore.read("simplifications", key);
    expect(jsonData).toBeNull();

    const rawData = await jsonStore.readRaw("simplifications", key);
    expect(rawData).toMatchObject({ _deleted: true, _table: "simplifications", _key: key });
  });

  test("create skips JSON store when jsonStore is undefined", async () => {
    const modWithoutJsonStore = new SimplificationsModule(db);

    const id = await modWithoutJsonStore.create({ symbolId: "sym_no_json", kind: "test" });

    const keys = await jsonStore.list("simplifications");
    expect(keys).toEqual([]);
    expect(await modWithoutJsonStore.get(id)).not.toBeNull();
  });
});
