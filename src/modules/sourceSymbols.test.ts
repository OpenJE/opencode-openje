import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/migrations.js";
import { SourceSymbolsModule } from "./sourceSymbols.js";

describe("SourceSymbolsModule", () => {
  let db: Database;
  let mod: SourceSymbolsModule;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    mod = new SourceSymbolsModule(db);
  });

  afterEach(() => {
    db.close();
  });

  test("create and get source symbol", async () => {
    const created = await mod.create({
      symbolId: "sym_main",
      kind: "function",
      name: "main",
      namespace: "game",
      originEa: "0x140001000",
      definitionJson: JSON.stringify({ returnType: "int" }),
    });

    expect(created).toEqual({
      symbol_id: "sym_main",
      kind: "function",
      name: "main",
      namespace: "game",
      origin_ea: "0x140001000",
      contract_version: null,
      definition_json: JSON.stringify({ returnType: "int" }),
      status: "unplaced",
    });

    await expect(mod.get("sym_main")).resolves.toEqual(created);
  });

  test("create defaults optional fields", async () => {
    await mod.create({ symbolId: "sym_type", kind: "struct", name: "Player" });

    const symbol = await mod.get("sym_type");

    expect(symbol).toEqual({
      symbol_id: "sym_type",
      kind: "struct",
      name: "Player",
      namespace: null,
      origin_ea: null,
      contract_version: null,
      definition_json: null,
      status: "unplaced",
    });
  });

  test("get returns null for missing symbol", async () => {
    await expect(mod.get("missing")).resolves.toBeNull();
  });

  test("list returns all symbols ordered by symbol id", async () => {
    await mod.create({ symbolId: "sym_z", kind: "global", name: "gLast" });
    await mod.create({ symbolId: "sym_a", kind: "class", name: "Actor" });

    const symbols = await mod.list();

    expect(symbols.map((symbol) => symbol.symbol_id)).toEqual(["sym_a", "sym_z"]);
  });

  test("list filters by kind, status, and origin ea", async () => {
    await mod.create({ symbolId: "sym_func_a", kind: "function", name: "A", originEa: "0x1000" });
    await mod.create({ symbolId: "sym_func_b", kind: "function", name: "B", originEa: "0x2000" });
    await mod.create({ symbolId: "sym_class", kind: "class", name: "Widget", originEa: "0x1000" });
    await mod.updateStatus("sym_func_a", "emitted");
    await mod.updateStatus("sym_class", "emitted");

    const symbols = await mod.list({ kind: "function", status: "emitted", originEa: "0x1000" });

    expect(symbols.map((symbol) => symbol.symbol_id)).toEqual(["sym_func_a"]);
  });

  test("updateStatus changes only symbol status", async () => {
    await mod.create({ symbolId: "sym_main", kind: "function", name: "main" });

    await mod.updateStatus("sym_main", "placement_reviewed");

    const symbol = await mod.get("sym_main");
    expect(symbol).not.toBeNull();
    expect(symbol!.status).toBe("placement_reviewed");
    expect(symbol!.name).toBe("main");
  });

  test("update changes provided fields", async () => {
    await mod.create({ symbolId: "sym_main", kind: "function", name: "main", originEa: "0x1000" });

    await mod.update("sym_main", {
      kind: "method",
      name: "Player::main",
      namespace: "Player",
      origin_ea: "0x2000",
      contract_version: 3,
      definition_json: JSON.stringify({ args: [] }),
      status: "locked",
    });

    expect(await mod.get("sym_main")).toEqual({
      symbol_id: "sym_main",
      kind: "method",
      name: "Player::main",
      namespace: "Player",
      origin_ea: "0x2000",
      contract_version: 3,
      definition_json: JSON.stringify({ args: [] }),
      status: "locked",
    });
  });

  test("update ignores empty updates", async () => {
    await mod.create({ symbolId: "sym_main", kind: "function", name: "main" });
    const before = await mod.get("sym_main");

    await mod.update("sym_main", {});

    await expect(mod.get("sym_main")).resolves.toEqual(before);
  });

  test("remove deletes source symbol", async () => {
    await mod.create({ symbolId: "sym_main", kind: "function", name: "main" });

    await mod.remove("sym_main");

    await expect(mod.get("sym_main")).resolves.toBeNull();
  });
});
