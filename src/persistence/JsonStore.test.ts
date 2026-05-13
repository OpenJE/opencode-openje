import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { InMemoryJsonStore, JsonStore } from "./JsonStore.js";
import {
  TABLE_CONFIGS,
  analysisEdgeKey,
  reviewKey,
  sanitizeEaForFilename,
  simplificationKey,
  summaryDependencyKey,
  workerRunKey,
} from "./types.js";

describe("JsonStore", () => {
  let root: string;
  let store: JsonStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "openje-json-store-"));
    store = new JsonStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("writes pretty JSON under .rework table directories", async () => {
    await store.write("analysis_functions", "0x401000", {
      ea: "0x401000",
      status: "discovered",
    });

    const path = join(root, ".rework", "analysis_functions", "0x401000.json");

    expect(await readFile(path, "utf8")).toBe(
      '{\n  "ea": "0x401000",\n  "status": "discovered"\n}\n',
    );
    expect(await store.read("analysis_functions", "0x401000")).toEqual({
      ea: "0x401000",
      status: "discovered",
    });
  });

  test("read returns null when the JSON file is missing", async () => {
    await expect(store.read("analysis_functions", "missing")).resolves.toBeNull();
    await expect(store.readRaw("analysis_functions", "missing")).resolves.toBeNull();
  });

  test("delete writes a tombstone and hides the key from normal reads and lists", async () => {
    await store.write("analysis_functions", "0x401000", { ea: "0x401000" });
    await store.write("analysis_functions", "0x402000", { ea: "0x402000" });

    await store.delete("analysis_functions", "0x401000");

    expect(await store.read("analysis_functions", "0x401000")).toBeNull();
    expect(await store.readRaw("analysis_functions", "0x401000")).toMatchObject({
      _deleted: true,
      _table: "analysis_functions",
      _key: "0x401000",
    });
    expect(await store.list("analysis_functions")).toEqual(["0x402000"]);
  });

  test("list and listAll return sorted live keys only", async () => {
    await store.write("jobs", "job-b", { job_id: "job-b" });
    await store.write("jobs", "job-a", { job_id: "job-a" });
    await store.write("reviews", "0x1000__v1", { function_ea: "0x1000" });
    await store.delete("reviews", "0x1000__v1");

    expect(await store.list("jobs")).toEqual(["job-a", "job-b"]);

    const all = await store.listAll();

    expect([...all.entries()]).toEqual([
      ["jobs", ["job-a", "job-b"]],
      ["reviews", []],
    ]);
  });
});

describe("InMemoryJsonStore", () => {
  test("matches JsonStore read, delete, list, and listAll behavior", async () => {
    const store = new InMemoryJsonStore();

    await store.write("analysis_edges", "0x1__0x2", { caller_ea: "0x1", callee_ea: "0x2" });
    await store.write("analysis_edges", "0x1__0x3", { caller_ea: "0x1", callee_ea: "0x3" });
    await store.delete("analysis_edges", "0x1__0x2");

    expect(await store.read("analysis_edges", "0x1__0x2")).toBeNull();
    expect(await store.readRaw("analysis_edges", "0x1__0x2")).toMatchObject({
      _deleted: true,
      _table: "analysis_edges",
      _key: "0x1__0x2",
    });
    expect(await store.list("analysis_edges")).toEqual(["0x1__0x3"]);
    expect([...((await store.listAll()).entries())]).toEqual([
      ["analysis_edges", ["0x1__0x3"]],
    ]);
  });
});

describe("persistence table configs", () => {
  test("defines the nine persisted table configs and excludes sqlite-only tables", () => {
    expect(Object.keys(TABLE_CONFIGS).sort()).toEqual([
      "analysis_edges",
      "analysis_functions",
      "jobs",
      "reviews",
      "simplifications",
      "source_blocks",
      "source_symbols",
      "summary_dependencies",
      "worker_runs",
    ]);
  });

  test("builds sanitized primary keys for simple, composite, and autoincrement tables", () => {
    expect(sanitizeEaForFilename("seg:401000/foo")).toBe("seg_401000_foo");
    expect(analysisEdgeKey("seg:401000/foo", "0x402000")).toBe("seg_401000_foo__0x402000");
    expect(summaryDependencyKey("0x401000", "seg:402000/foo")).toBe("0x401000__seg_402000_foo");
    expect(workerRunKey("seg:401000/foo", "analyst", 7)).toBe("seg_401000_foo__analyst__7");
    expect(reviewKey("seg:401000/foo", 3)).toBe("seg_401000_foo__v3");
    expect(simplificationKey("sym:Class/method", 11)).toBe("sym_Class_method__11");

    expect(TABLE_CONFIGS.analysis_functions.primaryKey({ ea: "seg:401000/foo" })).toBe(
      "seg_401000_foo",
    );
    expect(TABLE_CONFIGS.analysis_edges.primaryKey({ caller_ea: "0x1", callee_ea: "0x2" })).toBe(
      "0x1__0x2",
    );
    expect(TABLE_CONFIGS.worker_runs.primaryKey({ function_ea: "0x1", role: "analyst", id: 5 })).toBe(
      "0x1__analyst__5",
    );
  });
});
