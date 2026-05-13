import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/migrations.js";
import { EdgesModule } from "./edges.js";
import { FunctionsModule } from "./functions.js";
import { StatusTreeModule } from "./statusTree.js";

describe("StatusTreeModule", () => {
  let db: Database;
  let mod: StatusTreeModule;
  let fnMod: FunctionsModule;
  let edgeMod: EdgesModule;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    mod = new StatusTreeModule(db);
    fnMod = new FunctionsModule(db);
    edgeMod = new EdgesModule(db);
  });

  afterEach(() => {
    db.close();
  });

  test("returns null for nonexistent root function", async () => {
    const result = await mod.statusTree("0xDEAD");
    expect(result).toBeNull();
  });

  test("returns single-node tree for function with no edges", async () => {
    await fnMod.register({ ea: "0x1000", status: "discovered" });

    const result = await mod.statusTree("0x1000");

    expect(result).toMatchObject({
      ea: "0x1000",
      status: "discovered",
      children: [],
    });
  });

  test("builds tree with children", async () => {
    await fnMod.register({ ea: "0x1000", status: "discovered" });
    await fnMod.register({ ea: "0x2000", status: "queued" });
    await fnMod.register({ ea: "0x3000", status: "reviewed" });
    await edgeMod.add({ caller: "0x1000", callee: "0x2000", kind: "direct_call" });
    await edgeMod.add({ caller: "0x1000", callee: "0x3000", kind: "direct_call" });

    const result = await mod.statusTree("0x1000");

    expect(result).toMatchObject({
      ea: "0x1000",
      status: "discovered",
      children: [
        { ea: "0x2000", status: "queued", children: [] },
        { ea: "0x3000", status: "reviewed", children: [] },
      ],
    });
  });

  test("builds deeper nesting (A→B→C)", async () => {
    await fnMod.register({ ea: "0xA", status: "discovered" });
    await fnMod.register({ ea: "0xB", status: "queued" });
    await fnMod.register({ ea: "0xC", status: "reviewed" });
    await edgeMod.add({ caller: "0xA", callee: "0xB", kind: "direct_call" });
    await edgeMod.add({ caller: "0xB", callee: "0xC", kind: "direct_call" });

    const result = await mod.statusTree("0xA");

    expect(result).toMatchObject({
      ea: "0xA",
      status: "discovered",
      children: [
        {
          ea: "0xB",
          status: "queued",
          children: [{ ea: "0xC", status: "reviewed", children: [] }],
        },
      ],
    });
  });

  test("handles cycles without infinite loop", async () => {
    await fnMod.register({ ea: "0xA", status: "discovered" });
    await fnMod.register({ ea: "0xB", status: "queued" });
    await edgeMod.add({ caller: "0xA", callee: "0xB", kind: "direct_call" });
    await edgeMod.add({ caller: "0xB", callee: "0xA", kind: "direct_call" });

    const result = await mod.statusTree("0xA");

    expect(result).toMatchObject({
      ea: "0xA",
      status: "discovered",
      children: [
        { ea: "0xB", status: "queued", children: [] },
      ],
    });
  });

  test("reflects summary_version from analysis_functions", async () => {
    await fnMod.register({ ea: "0x1000", status: "discovered" });
    // Register sets summary_version to 0 via default; update it via setStatus then direct query
    db.query("UPDATE analysis_functions SET summary_version = 3 WHERE ea = '0x1000';").run();

    const result = await mod.statusTree("0x1000");

    expect(result).toMatchObject({
      ea: "0x1000",
      status: "discovered",
      summary_version: 3,
      children: [],
    });
  });

  test("defaults status to unknown for function not in analysis_functions", async () => {
    // Insert an edge pointing to a function that was never registered
    await fnMod.register({ ea: "0x1000", status: "discovered" });
    await edgeMod.add({ caller: "0x1000", callee: "0x2000", kind: "direct_call" });
    // 0x2000 is NOT registered — statusTree should still build a node with status "unknown"

    const result = await mod.statusTree("0x1000");

    expect(result).toMatchObject({
      ea: "0x1000",
      status: "discovered",
      children: [
        { ea: "0x2000", status: "unknown", children: [] },
      ],
    });
  });

  test("function with only incoming edges has empty children", async () => {
    await fnMod.register({ ea: "0x1000", status: "discovered" });
    await fnMod.register({ ea: "0x2000", status: "queued" });
    await edgeMod.add({ caller: "0x1000", callee: "0x2000", kind: "direct_call" });

    const result = await mod.statusTree("0x2000");

    expect(result).toMatchObject({
      ea: "0x2000",
      status: "queued",
      children: [],
    });
  });
});