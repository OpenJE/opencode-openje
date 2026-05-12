import type { AnalysisEdge } from "../db/types.js";

export function buildAdjacencyList(edges: AnalysisEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adj.has(edge.caller_ea)) adj.set(edge.caller_ea, new Set());
    adj.get(edge.caller_ea)!.add(edge.callee_ea);
  }
  return adj;
}
