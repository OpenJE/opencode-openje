import type { Database } from "bun:sqlite";
import type { AnalysisFunction, FunctionStatus } from "../db/types.js";
import type { JsonStore } from "../persistence/types.js";

export interface RegisterFunctionInput {
  ea: string;
  status?: FunctionStatus;
  lastPseudocodeHash?: string;
}

export class FunctionsModule {
  constructor(private readonly db: Database, private readonly jsonStore?: JsonStore) {}

  async register(input: RegisterFunctionInput): Promise<void> {
    const updatedAt = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO analysis_functions (ea, status, last_pseudocode_hash, updated_at)
         VALUES ($ea, $status, $lastPseudocodeHash, $updatedAt)
         ON CONFLICT(ea) DO UPDATE SET
           status = excluded.status,
           last_pseudocode_hash = excluded.last_pseudocode_hash,
           updated_at = excluded.updated_at,
           removed_at = NULL,
           removal_reason = NULL;`,
      )
      .run({
        $ea: input.ea,
        $status: input.status ?? "unknown",
        $lastPseudocodeHash: input.lastPseudocodeHash ?? null,
        $updatedAt: updatedAt,
      });

    if (this.jsonStore) {
      const fn = await this.get(input.ea);
      if (fn) {
        await this.jsonStore.write("functions", input.ea, fn as unknown as Record<string, unknown>);
      }
    }
  }

  async get(ea: string): Promise<AnalysisFunction | null> {
    return this.db
      .query("SELECT * FROM analysis_functions WHERE ea = $ea;")
      .get({ $ea: ea }) as AnalysisFunction | null;
  }

  async setStatus(ea: string, status: FunctionStatus): Promise<void> {
    const updatedAt = new Date().toISOString();
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
        $updatedAt: updatedAt,
      });

    if (this.jsonStore) {
      const fn = await this.get(ea);
      if (fn) {
        await this.jsonStore.write("functions", ea, fn as unknown as Record<string, unknown>);
      }
    }
  }

  async markDirty(ea: string, reason?: string): Promise<void> {
    void reason;

    const updatedAt = new Date().toISOString();
    this.db
      .query(
        `UPDATE analysis_functions
         SET dirty = 1,
             updated_at = $updatedAt
         WHERE ea = $ea;`,
      )
      .run({
        $ea: ea,
        $updatedAt: updatedAt,
      });

    if (this.jsonStore) {
      const fn = await this.get(ea);
      if (fn) {
        await this.jsonStore.write("functions", ea, fn as unknown as Record<string, unknown>);
      }
    }
  }

  async unregister(ea: string, reason: string): Promise<void> {
    const tx = this.db.transaction(() => {
      const fn = this.db
        .query("SELECT ea FROM analysis_functions WHERE ea = $ea;")
        .get({ $ea: ea }) as { ea: string } | null;

      if (!fn) {
        throw new Error(`Function ${ea} not found`);
      }

      const edgeCount = (
        this.db
          .query("SELECT COUNT(*) AS cnt FROM analysis_edges WHERE caller_ea = $ea OR callee_ea = $ea;")
          .get({ $ea: ea }) as { cnt: number }
      ).cnt;

      const activeJobCount = (
        this.db
          .query("SELECT COUNT(*) AS cnt FROM jobs WHERE target = $ea AND status NOT IN ('done', 'failed', 'cancelled');")
          .get({ $ea: ea }) as { cnt: number }
      ).cnt;

      const workerRunCount = (
        this.db
          .query("SELECT COUNT(*) AS cnt FROM worker_runs WHERE function_ea = $ea;")
          .get({ $ea: ea }) as { cnt: number }
      ).cnt;

      const reviewCount = (
        this.db
          .query("SELECT COUNT(*) AS cnt FROM reviews WHERE function_ea = $ea;")
          .get({ $ea: ea }) as { cnt: number }
      ).cnt;

      const dependencyCount = (
        this.db
          .query("SELECT COUNT(*) AS cnt FROM summary_dependencies WHERE parent_ea = $ea OR child_ea = $ea;")
          .get({ $ea: ea }) as { cnt: number }
      ).cnt;

      if (edgeCount > 0 || activeJobCount > 0 || workerRunCount > 0 || reviewCount > 0 || dependencyCount > 0) {
        throw new Error(
          `Cannot unregister ${ea}: has ${edgeCount} edges, ${activeJobCount} active jobs, ${workerRunCount} worker_runs, ${reviewCount} reviews, ${dependencyCount} dependencies. Remove dependents first.`,
        );
      }

      const now = new Date().toISOString();
      this.db
        .query(
          `UPDATE analysis_functions
           SET status = 'removed',
               removed_at = $now,
               removal_reason = $reason,
               updated_at = $now
           WHERE ea = $ea;`,
        )
        .run({
          $ea: ea,
          $now: now,
          $reason: reason,
        });
    });

    tx();

    if (this.jsonStore) {
      const fn = await this.get(ea);
      if (fn) {
        await this.jsonStore.write("functions", ea, fn as unknown as Record<string, unknown>);
      }
    }
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
