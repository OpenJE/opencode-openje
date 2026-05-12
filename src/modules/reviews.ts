import type { Database } from "bun:sqlite";
import { AcceptedContractV1 } from "../schemas/AcceptedContractV1.js";
import type { Review } from "../db/types.js";
import { FunctionsModule } from "./functions.js";
import { DependenciesModule } from "./dependencies.js";

export interface SubmitReviewInput {
  functionEa: string;
  reviewerModel: string;
  acceptedContract: unknown;
  rejectedClaims?: unknown[];
  acceptedContractPath?: string;
}

export interface ReviewBundle {
  functionEa: string;
  workerRuns: unknown[];
  edges: unknown[];
  dependencies: unknown[];
}

export class ReviewsModule {
  private functions: FunctionsModule;
  private dependencies: DependenciesModule;

  constructor(private readonly db: Database) {
    this.functions = new FunctionsModule(db);
    this.dependencies = new DependenciesModule(db);
  }

  async bundle(functionEa: string): Promise<ReviewBundle> {
    const workerRuns = this.db
      .query("SELECT * FROM worker_runs WHERE function_ea = $ea ORDER BY created_at DESC;")
      .all({ $ea: functionEa });
    const edges = this.db
      .query("SELECT * FROM analysis_edges WHERE caller_ea = $ea OR callee_ea = $ea;")
      .all({ $ea: functionEa });
    const dependencies = this.db
      .query("SELECT * FROM summary_dependencies WHERE parent_ea = $ea;")
      .all({ $ea: functionEa });

    return { functionEa, workerRuns, edges, dependencies };
  }

  async submit(input: SubmitReviewInput): Promise<void> {
    const parsed = AcceptedContractV1.parse(input.acceptedContract);

    const tx = this.db.transaction(() => {
      const fn = this.db
        .query("SELECT * FROM analysis_functions WHERE ea = $ea;")
        .get({ $ea: input.functionEa }) as { summary_version: number } | null;
      const newVersion = (fn?.summary_version ?? 0) + 1;

      this.db
        .query(
          `UPDATE analysis_functions
           SET status = 'reviewed',
               summary_version = $version,
               accepted_summary_json = $contractJson,
               confidence = $confidence,
               updated_at = $updatedAt
           WHERE ea = $ea;`,
        )
        .run({
          $ea: input.functionEa,
          $version: newVersion,
          $contractJson: JSON.stringify(parsed),
          $confidence: parsed.confidence ?? null,
          $updatedAt: new Date().toISOString(),
        });

      this.db
        .query(
          `INSERT INTO reviews (
             function_ea, reviewer_model, contract_version,
             accepted_contract_json, accepted_contract_path, rejected_claims_json, created_at
           ) VALUES (
             $ea, $reviewerModel, $version, $contractJson, $path, $rejected, $createdAt
           );`,
        )
        .run({
          $ea: input.functionEa,
          $reviewerModel: input.reviewerModel,
          $version: newVersion,
          $contractJson: JSON.stringify(parsed),
          $path: input.acceptedContractPath ?? null,
          $rejected: input.rejectedClaims ? JSON.stringify(input.rejectedClaims) : null,
          $createdAt: new Date().toISOString(),
        });

      for (const dep of parsed.dependencies_used ?? []) {
        this.db
          .query(
            `INSERT INTO summary_dependencies (parent_ea, child_ea, child_summary_version_used)
             VALUES ($parent, $child, $version)
             ON CONFLICT(parent_ea, child_ea) DO UPDATE SET
               child_summary_version_used = excluded.child_summary_version_used;`,
          )
          .run({
            $parent: input.functionEa,
            $child: dep.ea,
            $version: dep.summary_version,
          });
      }
    });

    tx();
  }

  async latest(functionEa: string): Promise<Review | null> {
    return this.db
      .query(
        "SELECT * FROM reviews WHERE function_ea = $ea ORDER BY contract_version DESC LIMIT 1;",
      )
      .get({ $ea: functionEa }) as Review | null;
  }
}
