import type { Database } from "bun:sqlite";
import { closeDatabase, ensureWorkdir, openDatabase } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { ArtifactsModule } from "../modules/artifacts.js";
import { DependenciesModule } from "../modules/dependencies.js";
import { EdgesModule } from "../modules/edges.js";
import { FunctionsModule } from "../modules/functions.js";
import { JobsModule } from "../modules/jobs.js";
import { ReviewsModule } from "../modules/reviews.js";
import { SimplificationsModule } from "../modules/simplifications.js";
import { SourceBlocksModule } from "../modules/sourceBlocks.js";
import { SourceSymbolsModule } from "../modules/sourceSymbols.js";
import { StaleModule } from "../modules/stale.js";
import { StatusTreeModule } from "../modules/statusTree.js";
import { WorkerRunsModule } from "../modules/workerRuns.js";
import { detectSccs } from "../traversal/scc.js";
import { traversalPlan } from "../traversal/plan.js";
import { topologicalOrder } from "../traversal/topo.js";

export class ReProgress {
  readonly db: Database;
  readonly functions: FunctionsModule;
  readonly edges: EdgesModule;
  readonly jobs: JobsModule;
  readonly workers: WorkerRunsModule;
  readonly reviews: ReviewsModule;
  readonly dependencies: DependenciesModule;
  readonly stale: StaleModule;
  readonly tree: StatusTreeModule;
  readonly sourceSymbols: SourceSymbolsModule;
  readonly sourceBlocks: SourceBlocksModule;
  readonly simplifications: SimplificationsModule;
  readonly artifacts: ArtifactsModule;
  readonly traversal: {
    detectSccs: typeof detectSccs;
    topologicalOrder: typeof topologicalOrder;
    traversalPlan: typeof traversalPlan;
  };

  private root: string;

  private constructor(db: Database, root: string) {
    this.db = db;
    this.root = root;
    this.functions = new FunctionsModule(db);
    this.edges = new EdgesModule(db);
    this.jobs = new JobsModule(db);
    this.workers = new WorkerRunsModule(db);
    this.reviews = new ReviewsModule(db);
    this.dependencies = new DependenciesModule(db);
    this.stale = new StaleModule(db);
    this.tree = new StatusTreeModule(db);
    this.sourceSymbols = new SourceSymbolsModule(db);
    this.sourceBlocks = new SourceBlocksModule(db);
    this.simplifications = new SimplificationsModule(db);
    this.artifacts = new ArtifactsModule(root);
    this.traversal = { detectSccs, topologicalOrder, traversalPlan };
  }

  static async open(options: { root: string }): Promise<ReProgress> {
    ensureWorkdir(options.root);
    const db = openDatabase(options.root);
    runMigrations(db);
    return new ReProgress(db, options.root);
  }

  close(): void {
    closeDatabase(this.db);
  }
}
