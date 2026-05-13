import type { Database } from "bun:sqlite";
import type { AddEdgeInput, AnalysisEdge } from "../db/types.js";
import { analysisEdgeKey } from "../persistence/types.js";
import type { JsonStore } from "../persistence/types.js";

export class EdgesModule {
  constructor(private readonly db: Database, private readonly jsonStore?: JsonStore) {}

  async add(input: AddEdgeInput): Promise<void> {
    const discoveredAt = new Date().toISOString();

    this.db
      .query(
        `INSERT INTO analysis_edges (caller_ea, callee_ea, edge_kind, blocking, reason, discovered_at)
         VALUES ($caller, $callee, $kind, $blocking, $reason, $discoveredAt)
         ON CONFLICT(caller_ea, callee_ea) DO UPDATE SET
           edge_kind = excluded.edge_kind,
           blocking = excluded.blocking,
           reason = excluded.reason,
           discovered_at = excluded.discovered_at;`,
      )
      .run({
        $caller: input.caller,
        $callee: input.callee,
        $kind: input.kind,
        $blocking: input.blocking === false ? 0 : 1,
        $reason: input.reason ?? null,
        $discoveredAt: discoveredAt,
      });

    if (this.jsonStore) {
      const key = analysisEdgeKey(input.caller, input.callee);
      const data = {
        caller_ea: input.caller,
        callee_ea: input.callee,
        edge_kind: input.kind,
        blocking: input.blocking === false ? 0 : 1,
        reason: input.reason ?? null,
        discovered_at: discoveredAt,
      };
      await this.jsonStore.write("edges", key, data);
    }
  }

  async children(caller: string): Promise<AnalysisEdge[]> {
    return this.db
      .query(
        `SELECT caller_ea, callee_ea, edge_kind, blocking, reason, discovered_at
         FROM analysis_edges
         WHERE caller_ea = $caller
         ORDER BY callee_ea, edge_kind;`,
      )
      .all({ $caller: caller }) as AnalysisEdge[];
  }

  async parents(callee: string): Promise<AnalysisEdge[]> {
    return this.db
      .query(
        `SELECT caller_ea, callee_ea, edge_kind, blocking, reason, discovered_at
         FROM analysis_edges
         WHERE callee_ea = $callee
         ORDER BY caller_ea, edge_kind;`,
      )
      .all({ $callee: callee }) as AnalysisEdge[];
  }

  async blockingChildren(caller: string): Promise<AnalysisEdge[]> {
    return this.db
      .query(
        `SELECT caller_ea, callee_ea, edge_kind, blocking, reason, discovered_at
         FROM analysis_edges
         WHERE caller_ea = $caller AND blocking = 1
         ORDER BY callee_ea, edge_kind;`,
      )
      .all({ $caller: caller }) as AnalysisEdge[];
  }

  async listAll(): Promise<AnalysisEdge[]> {
    return this.db
      .query(
        `SELECT caller_ea, callee_ea, edge_kind, blocking, reason, discovered_at
         FROM analysis_edges
         ORDER BY caller_ea, callee_ea;`,
      )
      .all() as AnalysisEdge[];
  }

  async remove(caller: string, callee: string): Promise<void> {
    this.db
      .query(
        `DELETE FROM analysis_edges
         WHERE caller_ea = $caller AND callee_ea = $callee;`,
      )
      .run({ $caller: caller, $callee: callee });

    if (this.jsonStore) {
      const key = analysisEdgeKey(caller, callee);
      await this.jsonStore.delete("edges", key);
    }
  }
}
