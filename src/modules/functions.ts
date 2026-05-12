import type { Database } from "bun:sqlite";
import type { AnalysisFunction, FunctionStatus } from "../db/types.js";

export interface RegisterFunctionInput {
  ea: string;
  status?: FunctionStatus;
  lastPseudocodeHash?: string;
}

export class FunctionsModule {
  constructor(private readonly db: Database) {}

  async register(input: RegisterFunctionInput): Promise<void> {
    this.db
      .query(
        `INSERT OR REPLACE INTO analysis_functions (
           ea,
           status,
           last_pseudocode_hash,
           updated_at
         ) VALUES (
           $ea,
           $status,
           $lastPseudocodeHash,
           $updatedAt
         );`,
      )
      .run({
        $ea: input.ea,
        $status: input.status ?? "unknown",
        $lastPseudocodeHash: input.lastPseudocodeHash ?? null,
        $updatedAt: new Date().toISOString(),
      });
  }

  async get(ea: string): Promise<AnalysisFunction | null> {
    return this.db
      .query("SELECT * FROM analysis_functions WHERE ea = $ea;")
      .get({ $ea: ea }) as AnalysisFunction | null;
  }

  async setStatus(ea: string, status: FunctionStatus): Promise<void> {
    this.db
      .query(
        `UPDATE analysis_functions
         SET status = $status,
             updated_at = $updatedAt
         WHERE ea = $ea;`,
      )
      .run({
        $ea: ea,
        $status: status,
        $updatedAt: new Date().toISOString(),
      });
  }

  async markDirty(ea: string, reason?: string): Promise<void> {
    void reason;

    this.db
      .query(
        `UPDATE analysis_functions
         SET dirty = 1,
             updated_at = $updatedAt
         WHERE ea = $ea;`,
      )
      .run({
        $ea: ea,
        $updatedAt: new Date().toISOString(),
      });
  }

  async listByStatus(status: FunctionStatus): Promise<AnalysisFunction[]> {
    return this.db
      .query("SELECT * FROM analysis_functions WHERE status = $status ORDER BY ea;")
      .all({ $status: status }) as AnalysisFunction[];
  }

  async listDirty(): Promise<AnalysisFunction[]> {
    return this.db.query("SELECT * FROM analysis_functions WHERE dirty = 1 ORDER BY ea;").all() as AnalysisFunction[];
  }

  async listAll(): Promise<AnalysisFunction[]> {
    return this.db.query("SELECT * FROM analysis_functions ORDER BY ea;").all() as AnalysisFunction[];
  }
}
