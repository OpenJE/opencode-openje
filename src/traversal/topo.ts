import type { AnalysisEdge } from "../db/types.js";

export function topologicalOrder(rootEa: string, edges: AnalysisEdge[]): string[] {
  const adj = new Map<string, Set<string>>();
  const allNodes = new Set<string>([rootEa]);

  for (const edge of edges) {
    allNodes.add(edge.caller_ea);
    allNodes.add(edge.callee_ea);
    if (!adj.has(edge.caller_ea)) adj.set(edge.caller_ea, new Set());
    adj.get(edge.caller_ea)!.add(edge.callee_ea);
  }

  const visited = new Set<string>();
  const temp = new Set<string>();
  const order: string[] = [];

  function visit(node: string): void {
    if (temp.has(node)) return; // cycle detected, skip
    if (visited.has(node)) return;

    temp.add(node);
    const children = adj.get(node) ?? new Set();
    for (const child of children) {
      visit(child);
    }
    temp.delete(node);
    visited.add(node);
    order.push(node);
  }

  visit(rootEa);

  // Include any disconnected nodes
  for (const node of allNodes) {
    if (!visited.has(node)) {
      visit(node);
    }
  }

  return order;
}
