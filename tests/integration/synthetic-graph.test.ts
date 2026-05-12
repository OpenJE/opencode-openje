import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations.js";
import { FunctionsModule } from "../../src/modules/functions.js";
import { EdgesModule } from "../../src/modules/edges.js";
import { ReviewsModule } from "../../src/modules/reviews.js";
import { DependenciesModule } from "../../src/modules/dependencies.js";
import { StaleModule } from "../../src/modules/stale.js";
import { detectSccs } from "../../src/traversal/scc.js";
import { topologicalOrder } from "../../src/traversal/topo.js";

describe("Integration: Synthetic Graph", () => {
  test("full graph lifecycle", async () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const functions = new FunctionsModule(db);
    const edges = new EdgesModule(db);
    const reviews = new ReviewsModule(db);
    const dependencies = new DependenciesModule(db);
    const stale = new StaleModule(db);

    await functions.register({ ea: "A", status: "discovered" });
    await functions.register({ ea: "B", status: "discovered" });
    await functions.register({ ea: "C", status: "discovered" });
    await functions.register({ ea: "D", status: "discovered" });
    await functions.register({ ea: "E", status: "discovered" });
    await functions.register({ ea: "F", status: "discovered" });
    await functions.register({ ea: "memset", status: "discovered" });

    await edges.add({ caller: "A", callee: "B", kind: "direct_call", blocking: true });
    await edges.add({ caller: "A", callee: "C", kind: "direct_call", blocking: true });
    await edges.add({ caller: "A", callee: "memset", kind: "import_call", blocking: false });
    await edges.add({ caller: "B", callee: "D", kind: "direct_call", blocking: true });
    await edges.add({ caller: "C", callee: "D", kind: "direct_call", blocking: true });
    await edges.add({ caller: "E", callee: "F", kind: "direct_call", blocking: true });
    await edges.add({ caller: "F", callee: "E", kind: "direct_call", blocking: true });

    const dParents = await edges.parents("D");
    expect(dParents.length).toBe(2);

    const aChildren = await edges.children("A");
    const memsetEdge = aChildren.find((c) => c.callee_ea === "memset");
    expect(memsetEdge?.blocking).toBe(0);

    const allEdges = await edges.listAll();
    const sccs = detectSccs(allEdges);
    expect(sccs.length).toBe(1);
    expect(sccs[0].members).toEqual(["E", "F"]);

    const order = topologicalOrder("A", allEdges);
    expect(order.indexOf("D")).toBeLessThan(order.indexOf("B"));
    expect(order.indexOf("B")).toBeLessThan(order.indexOf("A"));

    await reviews.submit({
      functionEa: "D",
      reviewerModel: "test-model",
      acceptedContract: {
        function_ea: "D",
        accepted_name: "leaf_function",
        kind: "function",
        purpose: "Leaf function",
        confidence: 0.9,
        dependencies_used: [],
      },
    });

    const dFn = await functions.get("D");
    expect(dFn?.status).toBe("reviewed");
    expect(dFn?.summary_version).toBe(1);

    await dependencies.record("B", "D", 0);
    await dependencies.record("C", "D", 0);

    const staleParents = await stale.markParentsStale("D");
    expect(staleParents.sort()).toEqual(["B", "C"]);

    await dependencies.record("A", "B", 0);

    await reviews.submit({
      functionEa: "B",
      reviewerModel: "test-model",
      acceptedContract: {
        function_ea: "B",
        accepted_name: "B_function",
        kind: "function",
        purpose: "B function",
        confidence: 0.9,
        dependencies_used: [{ ea: "D", summary_version: 1 }],
      },
    });

    const staleParentsOfB = await stale.markParentsStale("B");
    expect(staleParentsOfB).toEqual(["A"]);

    db.close();
  });
});
