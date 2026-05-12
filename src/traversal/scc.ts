import type { AnalysisEdge } from "../db/types.js";

export interface SccGroup {
  group_id: string;
  members: string[];
  status: string;
}

export function detectSccs(edges: AnalysisEdge[]): SccGroup[] {
  const adj = new Map<string, Set<string>>();
  const nodes = new Set<string>();

  for (const edge of edges) {
    nodes.add(edge.caller_ea);
    nodes.add(edge.callee_ea);
    if (!adj.has(edge.caller_ea)) adj.set(edge.caller_ea, new Set());
    adj.get(edge.caller_ea)!.add(edge.callee_ea);
  }

  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const sccs: SccGroup[] = [];

  function strongconnect(v: string): void {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const neighbors = adj.get(v) ?? new Set();
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const members: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        members.push(w);
      } while (w !== v);

      if (members.length > 1) {
        const hash = members.slice().sort().join("_");
        sccs.push({
          group_id: `SCC_${hash}`,
          members: members.sort(),
          status: "pending",
        });
      }
    }
  }

  for (const node of nodes) {
    if (!indices.has(node)) {
      strongconnect(node);
    }
  }

  return sccs;
}
