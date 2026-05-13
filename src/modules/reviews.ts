import type { Database } from "bun:sqlite";
import { AcceptedContractV1 } from "../schemas/AcceptedContractV1.js";
import type { Review } from "../db/types.js";
import { FunctionsModule } from "./functions.js";
import { DependenciesModule } from "./dependencies.js";
import type { JsonStore } from "../persistence/types.js";
import { reviewKey, summaryDependencyKey } from "../persistence/types.js";

export interface SubmitReviewInput {
  functionEa: string;
  reviewerModel: string;
  acceptedContract: unknown;
  rejectedClaims?: unknown[];
  acceptedContractPath?: string;
}

export interface AmendReviewInput {
  reviewId: number;
  acceptedContract?: unknown;
  rejectedClaims?: unknown[];
  reason: string;
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

  constructor(private readonly db: Database, private readonly jsonStore?: JsonStore) {
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

  async submit(input: SubmitReviewInput): Promise<{ id: number }> {
    const parsed = AcceptedContractV1.parse(input.acceptedContract);

    const tx = this.db.transaction((): number => {
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

      const result = this.db.query("SELECT last_insert_rowid() AS id;").get() as { id: number };

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

      return result.id;
    });

    const reviewId = tx();

    if (this.jsonStore) {
      const fn = await this.functions.get(input.functionEa);
      if (fn) {
        await this.jsonStore.write("functions", input.functionEa, fn as unknown as Record<string, unknown>);
      }

      const review = await this.latest(input.functionEa);
      if (review) {
        await this.jsonStore.write("reviews", reviewKey(input.functionEa, review.contract_version), review as unknown as Record<string, unknown>);
      }

      for (const dep of parsed.dependencies_used ?? []) {
        const depRecord = await this.dependencies.get(input.functionEa, dep.ea);
        if (depRecord) {
          await this.jsonStore.write("summary_dependencies", summaryDependencyKey(input.functionEa, dep.ea), depRecord as unknown as Record<string, unknown>);
        }
      }
    }

    return { id: reviewId };
  }

  async amend(input: AmendReviewInput): Promise<void> {
    if (input.acceptedContract === undefined && input.rejectedClaims === undefined) {
      throw new Error("acceptedContract or rejectedClaims must be provided");
    }

    const existingReview = this.db
      .query("SELECT * FROM reviews WHERE id = $id;")
      .get({ $id: input.reviewId }) as Review | null;
    if (!existingReview) {
      throw new Error(`Review ${input.reviewId} not found`);
    }

    const parsed = input.acceptedContract === undefined ? undefined : AcceptedContractV1.parse(input.acceptedContract);
    let amendedReview: Review | null = null;

    const tx = this.db.transaction(() => {
      const review = this.db
        .query("SELECT * FROM reviews WHERE id = $id;")
        .get({ $id: input.reviewId }) as Review | null;
      if (!review) {
        throw new Error(`Review ${input.reviewId} not found`);
      }

      if (parsed !== undefined) {
        if (parsed.function_ea !== review.function_ea) {
          throw new Error("Cannot change review function_ea");
        }
        if (parsed.contract_version !== undefined && parsed.contract_version !== review.contract_version) {
          throw new Error("Cannot change review contract_version");
        }

        this.db
          .query(
            `UPDATE reviews
             SET accepted_contract_json = $contractJson,
                 amend_reason = $reason
             WHERE id = $id;`,
          )
          .run({
            $id: input.reviewId,
            $contractJson: JSON.stringify(parsed),
            $reason: input.reason,
          });

        const existingDeps = this.db
          .query("SELECT child_ea FROM summary_dependencies WHERE parent_ea = $parentEa;")
          .all({ $parentEa: review.function_ea }) as { child_ea: string }[];
        for (const dep of existingDeps) {
          void this.dependencies.remove(review.function_ea, dep.child_ea);
        }
        for (const dep of parsed.dependencies_used ?? []) {
          void this.dependencies.record(review.function_ea, dep.ea, dep.summary_version);
        }
      }

      if (input.rejectedClaims !== undefined) {
        this.db
          .query(
            `UPDATE reviews
             SET rejected_claims_json = $rejectedClaims
             WHERE id = $id;`,
          )
          .run({
            $id: input.reviewId,
            $rejectedClaims: JSON.stringify(input.rejectedClaims),
          });
      }

      amendedReview = this.db
        .query("SELECT * FROM reviews WHERE id = $id;")
        .get({ $id: input.reviewId }) as Review | null;
    });

    tx();

    if (this.jsonStore && amendedReview) {
      await this.jsonStore.write(
        "reviews",
        reviewKey(amendedReview.function_ea, amendedReview.contract_version),
        amendedReview as unknown as Record<string, unknown>,
      );

      if (parsed !== undefined) {
        const depKeys = await this.jsonStore.list("summary_dependencies");
        const parentPrefix = `${summaryDependencyKey(amendedReview.function_ea, "")}`;
        for (const key of depKeys) {
          if (key.startsWith(parentPrefix)) {
            await this.jsonStore.delete("summary_dependencies", key);
          }
        }

        for (const dep of parsed.dependencies_used ?? []) {
          const depRecord = await this.dependencies.get(amendedReview.function_ea, dep.ea);
          if (depRecord) {
            await this.jsonStore.write(
              "summary_dependencies",
              summaryDependencyKey(amendedReview.function_ea, dep.ea),
              depRecord as unknown as Record<string, unknown>,
            );
          }
        }
      }
    }
  }

  async latest(functionEa: string): Promise<Review | null> {
    return this.db
      .query(
        "SELECT * FROM reviews WHERE function_ea = $ea ORDER BY contract_version DESC LIMIT 1;",
      )
      .get({ $ea: functionEa }) as Review | null;
  }

  async list(functionEa: string): Promise<Review[]> {
    return this.db
      .query("SELECT * FROM reviews WHERE function_ea = $ea ORDER BY contract_version DESC;")
      .all({ $ea: functionEa }) as Review[];
  }

  async get(id: number): Promise<Review | null> {
    return this.db
      .query("SELECT * FROM reviews WHERE id = $id;")
      .get({ $id: id }) as Review | null;
  }
}
