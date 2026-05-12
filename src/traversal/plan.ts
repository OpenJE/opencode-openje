import type { AnalysisEdge, AnalysisFunction } from "../db/types.js";
import { detectSccs } from "./scc.js";
import { topologicalOrder } from "./topo.js";

export interface TraversalPlan {
  root: string;
  nodes: string[];
  sccs: { group_id: string; members: string[] }[];
  analysis_order: string[];
  skipped: string[];
  warnings: string[];
}

export function traversalPlan(
  rootEa: string,
  edges: AnalysisEdge[],
  functions: Map<string, AnalysisFunction>,
): TraversalPlan {
  const sccs = detectSccs(edges);
  const order = topologicalOrder(rootEa, edges);
  const allNodes = new Set(order);

  const skipped: string[] = [];
  const warnings: string[] = [];

  for (const node of allNodes) {
    const fn = functions.get(node);
    if (!fn || fn.status === "skipped" || fn.status === "unknown") {
      skipped.push(node);
    }
  }

  if (skipped.length > 0) {
    warnings.push(`Skipped ${skipped.length} node(s): ${skipped.join(", ")}`);
  }

  for (const scc of sccs) {
    const skippedInScc = scc.members.filter((m) => skipped.includes(m));
    if (skippedInScc.length > 0) {
      warnings.push(`SCC ${scc.group_id} contains skipped nodes: ${skippedInScc.join(", ")}`);
    }
  }

  return {
    root: rootEa,
    nodes: Array.from(allNodes),
    sccs: sccs.map((s) => ({ group_id: s.group_id, members: s.members })),
    analysis_order: order,
    skipped,
    warnings,
  };
}
