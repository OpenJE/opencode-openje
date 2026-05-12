import type { Database } from "bun:sqlite";
import type { SummaryDependency } from "../db/types.js";

export class DependenciesModule {
  constructor(private readonly db: Database) {}

  async record(parentEa: string, childEa: string, childVersion: number): Promise<void> {
    this.db
      .query(
        `INSERT INTO summary_dependencies (parent_ea, child_ea, child_summary_version_used)
         VALUES ($parentEa, $childEa, $childVersion)
         ON CONFLICT(parent_ea, child_ea) DO UPDATE SET
           child_summary_version_used = excluded.child_summary_version_used;`,
      )
      .run({
        $parentEa: parentEa,
        $childEa: childEa,
        $childVersion: childVersion,
      });
  }

  async usedByParent(parentEa: string): Promise<SummaryDependency[]> {
    return this.db
      .query("SELECT * FROM summary_dependencies WHERE parent_ea = $parentEa;")
      .all({ $parentEa: parentEa }) as SummaryDependency[];
  }

  async staleParentsOf(childEa: string): Promise<string[]> {
    const rows = this.db
      .query(
        `SELECT sd.parent_ea
         FROM summary_dependencies sd
         JOIN analysis_functions af ON af.ea = sd.child_ea
         WHERE sd.child_ea = $childEa
           AND sd.child_summary_version_used < af.summary_version;`,
      )
      .all({ $childEa: childEa }) as { parent_ea: string }[];
    return rows.map((r) => r.parent_ea);
  }

  async get(parentEa: string, childEa: string): Promise<SummaryDependency | null> {
    return this.db
      .query(
        "SELECT * FROM summary_dependencies WHERE parent_ea = $parentEa AND child_ea = $childEa;",
      )
      .get({ $parentEa: parentEa, $childEa: childEa }) as SummaryDependency | null;
  }

  async remove(parentEa: string, childEa: string): Promise<void> {
    this.db
      .query("DELETE FROM summary_dependencies WHERE parent_ea = $parentEa AND child_ea = $childEa;")
      .run({ $parentEa: parentEa, $childEa: childEa });
  }
}
