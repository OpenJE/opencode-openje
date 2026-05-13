import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/migrations.js";
import { SourceBlocksModule } from "./sourceBlocks.js";
import { InMemoryJsonStore } from "../persistence/JsonStore.js";

describe("SourceBlocksModule", () => {
  let db: Database;
  let mod: SourceBlocksModule;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    mod = new SourceBlocksModule(db);
  });

  afterEach(() => {
    db.close();
  });

  async function withJsonStore(testBody: (mod: SourceBlocksModule, jsonStore: InMemoryJsonStore) => Promise<void>): Promise<void> {
    const db = new Database(":memory:");
    runMigrations(db);
    const jsonStore = new InMemoryJsonStore();

    try {
      await testBody(new SourceBlocksModule(db, jsonStore), jsonStore);
    } finally {
      db.close();
    }
  }

  test("create with required fields sets defaults", async () => {
    const created = await mod.create({
      blockId: "blk_1",
      symbolId: "sym_main",
      filePath: "/src/main.cpp",
    });

    expect(created).toEqual({
      block_id: "blk_1",
      symbol_id: "sym_main",
      file_path: "/src/main.cpp",
      block_hash: null,
      managed: 1,
      manual_override: 0,
      fidelity_mode: null,
      updated_at: expect.any(String),
    });
  });

  test("create with all fields populated", async () => {
    const created = await mod.create({
      blockId: "blk_2",
      symbolId: "sym_func",
      filePath: "/src/func.cpp",
      blockHash: "abc123",
      fidelityMode: "pseudocode_faithful",
    });

    expect(created).toEqual({
      block_id: "blk_2",
      symbol_id: "sym_func",
      file_path: "/src/func.cpp",
      block_hash: "abc123",
      managed: 1,
      manual_override: 0,
      fidelity_mode: "pseudocode_faithful",
      updated_at: expect.any(String),
    });
  });

  test("get returns null for nonexistent block", async () => {
    await expect(mod.get("missing")).resolves.toBeNull();
  });

  test("listBySymbol returns blocks ordered by block_id", async () => {
    await mod.create({ blockId: "blk_z", symbolId: "sym_a", filePath: "/z.cpp" });
    await mod.create({ blockId: "blk_a", symbolId: "sym_a", filePath: "/a.cpp" });

    const blocks = await mod.listBySymbol("sym_a");

    expect(blocks.map((b) => b.block_id)).toEqual(["blk_a", "blk_z"]);
  });

  test("listBySymbol returns empty array when no blocks exist for symbol", async () => {
    const blocks = await mod.listBySymbol("nonexistent");
    expect(blocks).toEqual([]);
  });

  test("update with partial fields only updates those fields", async () => {
    await mod.create({
      blockId: "blk_upd",
      symbolId: "sym_test",
      filePath: "/original.cpp",
      blockHash: "oldhash",
    });

    await mod.update("blk_upd", { file_path: "/updated.cpp" });

    const block = await mod.get("blk_upd");
    expect(block?.file_path).toBe("/updated.cpp");
    expect(block?.block_hash).toBe("oldhash");
  });

  test("update with empty object is a no-op", async () => {
    await mod.create({
      blockId: "blk_noop",
      symbolId: "sym_test",
      filePath: "/unchanged.cpp",
    });

    const before = await mod.get("blk_noop");

    await mod.update("blk_noop", {});

    const after = await mod.get("blk_noop");
    expect(after?.file_path).toBe(before?.file_path);
    expect(after?.block_hash).toBe(before?.block_hash);
  });

  test("update sets updated_at timestamp", async () => {
    await mod.create({
      blockId: "blk_ts",
      symbolId: "sym_test",
      filePath: "/test.cpp",
    });

    await mod.update("blk_ts", { file_path: "/new.cpp" });

    const after = await mod.get("blk_ts");
    expect(after?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test("listManualOverrides returns only blocks with manual_override=1", async () => {
    await mod.create({ blockId: "blk_auto", symbolId: "sym_1", filePath: "/auto.cpp" });
    await mod.create({ blockId: "blk_manual", symbolId: "sym_2", filePath: "/manual.cpp" });

    await mod.update("blk_manual", { manual_override: 1 });

    const overrides = await mod.listManualOverrides();

    expect(overrides.map((b) => b.block_id)).toEqual(["blk_manual"]);
  });

  test("remove deletes block", async () => {
    await mod.create({ blockId: "blk_del", symbolId: "sym_del", filePath: "/del.cpp" });

    await mod.remove("blk_del");

    await expect(mod.get("blk_del")).resolves.toBeNull();
  });

  test("remove on nonexistent block does not throw", async () => {
    await expect(mod.remove("missing")).resolves.toBeUndefined();
  });

  test("create writes to json store", async () => {
    await withJsonStore(async (mod, jsonStore) => {
      await mod.create({
        blockId: "blk_json",
        symbolId: "sym_func",
        filePath: "/src/func.cpp",
        blockHash: "abc123",
      });

      const data = await jsonStore.read("source_blocks", "blk_json");
      expect(data).not.toBeNull();
      expect(data).toMatchObject({
        block_id: "blk_json",
        symbol_id: "sym_func",
        file_path: "/src/func.cpp",
        block_hash: "abc123",
        managed: 1,
        manual_override: 0,
      });
    });
  });

  test("update writes to json store", async () => {
    await withJsonStore(async (mod, jsonStore) => {
      await mod.create({
        blockId: "blk_update",
        symbolId: "sym_test",
        filePath: "/original.cpp",
      });

      await mod.update("blk_update", { file_path: "/updated.cpp", block_hash: "newhash" });

      const data = await jsonStore.read("source_blocks", "blk_update");
      expect(data).toMatchObject({
        block_id: "blk_update",
        file_path: "/updated.cpp",
        block_hash: "newhash",
      });
    });
  });

  test("remove writes tombstone to json store", async () => {
    await withJsonStore(async (mod, jsonStore) => {
      await mod.create({ blockId: "blk_tombstone", symbolId: "sym_del", filePath: "/del.cpp" });
      await mod.remove("blk_tombstone");

      const data = await jsonStore.read("source_blocks", "blk_tombstone");
      expect(data).toBeNull();

      const raw = await jsonStore.readRaw("source_blocks", "blk_tombstone");
      expect(raw).toMatchObject({
        _deleted: true,
        _table: "source_blocks",
        _key: "blk_tombstone",
      });
    });
  });
});
