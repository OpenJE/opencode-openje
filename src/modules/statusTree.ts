import type { Database } from "bun:sqlite";
import type { AnalysisFunction, FunctionStatus } from "../db/types.js";

export interface StatusTreeNode {
  ea: string;
  status: FunctionStatus;
  summary_version?: number;
  scc_group?: string;
  children: StatusTreeNode[];
}

export class StatusTreeModule {
  constructor(private readonly db: Database) {}

  async statusTree(rootEa: string): Promise<StatusTreeNode | null> {
    const rootFn = this.db
      .query("SELECT * FROM analysis_functions WHERE ea = $ea;")
      .get({ $ea: rootEa }) as AnalysisFunction | null;
    if (!rootFn) return null;

    const visited = new Set<string>();

    async function buildNode(ea: string, db: Database): Promise<StatusTreeNode> {
      visited.add(ea);
      const fn = db
        .query("SELECT * FROM analysis_functions WHERE ea = $ea;")
        .get({ $ea: ea }) as AnalysisFunction | null;

      const children = db
        .query("SELECT callee_ea FROM analysis_edges WHERE caller_ea = $ea;")
        .all({ $ea: ea }) as { callee_ea: string }[];

      const childNodes: StatusTreeNode[] = [];
      for (const child of children) {
        if (!visited.has(child.callee_ea)) {
          childNodes.push(await buildNode(child.callee_ea, db));
        }
      }

      return {
        ea,
        status: fn?.status ?? "unknown",
        summary_version: fn?.summary_version ?? undefined,
        children: childNodes,
      };
    }

    return buildNode(rootEa, this.db);
  }
}
