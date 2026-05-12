import type { Database } from "bun:sqlite";
import type { AnalysisFunction } from "../db/types.js";

export class StaleModule {
  constructor(private readonly db: Database) {}

  async markParentsStale(childEa: string): Promise<string[]> {
    const tx = this.db.transaction(() => {
      const parents = this.db
        .query(
          `SELECT sd.parent_ea
           FROM summary_dependencies sd
           JOIN analysis_functions af ON af.ea = sd.child_ea
           WHERE sd.child_ea = $childEa
             AND sd.child_summary_version_used < af.summary_version;`,
        )
        .all({ $childEa: childEa }) as { parent_ea: string }[];

      const parentEas = parents.map((p) => p.parent_ea);
      for (const parentEa of parentEas) {
        this.db
          .query(
            `UPDATE analysis_functions
             SET status = 'stale', updated_at = $updatedAt
             WHERE ea = $ea AND status != 'stale';`,
          )
          .run({
            $ea: parentEa,
            $updatedAt: new Date().toISOString(),
          });
      }
      return parentEas;
    });

    return tx();
  }

  async list(): Promise<AnalysisFunction[]> {
    return this.db
      .query("SELECT * FROM analysis_functions WHERE status = 'stale' ORDER BY ea;")
      .all() as AnalysisFunction[];
  }

  async isStale(functionEa: string): Promise<boolean> {
    const row = this.db
      .query("SELECT status FROM analysis_functions WHERE ea = $ea;")
      .get({ $ea: functionEa }) as { status: string } | null;
    return row?.status === "stale";
  }
}
