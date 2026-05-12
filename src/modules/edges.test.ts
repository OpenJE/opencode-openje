import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/migrations.js";
import type { AddEdgeInput } from "../db/types.js";
import { EdgesModule } from "./edges.js";

async function withEdges(testBody: (edges: EdgesModule, db: Database) => Promise<void>): Promise<void> {
  const db = new Database(":memory:");
  runMigrations(db);

  try {
    await testBody(new EdgesModule(db), db);
  } finally {
    db.close();
  }
}

describe("EdgesModule", () => {
  test("adds an edge using db-shaped fields and defaults blocking to true", async () => {
    await withEdges(async (edges) => {
      await edges.add({ caller: "0x1000", callee: "0x2000", kind: "direct_call" });

      expect(await edges.listAll()).toEqual([
        {
          caller_ea: "0x1000",
          callee_ea: "0x2000",
          edge_kind: "direct_call",
          blocking: 1,
          reason: null,
          discovered_at: expect.any(String),
        },
      ]);
    });
  });

  test("preserves non-blocking edges and reasons", async () => {
    await withEdges(async (edges) => {
      const input: AddEdgeInput = {
        caller: "0x1000",
        callee: "0x3000",
        kind: "callback_candidate",
        blocking: false,
        reason: "registered callback",
      };

      await edges.add(input);

      expect(await edges.listAll()).toEqual([
        {
          caller_ea: "0x1000",
          callee_ea: "0x3000",
          edge_kind: "callback_candidate",
          blocking: 0,
          reason: "registered callback",
          discovered_at: expect.any(String),
        },
      ]);
    });
  });

  test("lists children, parents, and blocking children in deterministic order", async () => {
    await withEdges(async (edges) => {
      await edges.add({ caller: "0x1000", callee: "0x3000", kind: "virtual_call", blocking: false });
      await edges.add({ caller: "0x1000", callee: "0x2000", kind: "direct_call", blocking: true });
      await edges.add({ caller: "0x4000", callee: "0x2000", kind: "import_call", blocking: true });

      expect((await edges.children("0x1000")).map((edge) => edge.callee_ea)).toEqual(["0x2000", "0x3000"]);
      expect((await edges.parents("0x2000")).map((edge) => edge.caller_ea)).toEqual(["0x1000", "0x4000"]);
      expect(await edges.blockingChildren("0x1000")).toEqual([
        {
          caller_ea: "0x1000",
          callee_ea: "0x2000",
          edge_kind: "direct_call",
          blocking: 1,
          reason: null,
          discovered_at: expect.any(String),
        },
      ]);
    });
  });

  test("updates an existing caller-callee edge on repeated add", async () => {
    await withEdges(async (edges) => {
      await edges.add({ caller: "0x1000", callee: "0x2000", kind: "direct_call", reason: "first" });
      await edges.add({ caller: "0x1000", callee: "0x2000", kind: "tail_call", blocking: false, reason: "refined" });

      expect(await edges.listAll()).toEqual([
        {
          caller_ea: "0x1000",
          callee_ea: "0x2000",
          edge_kind: "tail_call",
          blocking: 0,
          reason: "refined",
          discovered_at: expect.any(String),
        },
      ]);
    });
  });

  test("removes only the matching caller-callee edge", async () => {
    await withEdges(async (edges) => {
      await edges.add({ caller: "0x1000", callee: "0x2000", kind: "direct_call" });
      await edges.add({ caller: "0x1000", callee: "0x3000", kind: "indirect_call" });
      await edges.add({ caller: "0x4000", callee: "0x2000", kind: "thunk" });

      await edges.remove("0x1000", "0x2000");

      expect((await edges.listAll()).map((edge) => [edge.caller_ea, edge.callee_ea])).toEqual([
        ["0x1000", "0x3000"],
        ["0x4000", "0x2000"],
      ]);
    });
  });
});
