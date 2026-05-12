import type { Database } from "bun:sqlite";
import type { WorkerRun } from "../db/types.js";
import { FunctionAnalysisV1 } from "../schemas/FunctionAnalysisV1.js";

export interface SubmitWorkerRunInput {
  jobId?: string;
  functionEa: string;
  role: string;
  model: string;
  inputHash?: string;
  output: unknown;
}

export class WorkerRunsModule {
  constructor(private readonly db: Database) {}

  async submit(input: SubmitWorkerRunInput): Promise<number> {
    const output = FunctionAnalysisV1.parse(input.output);
    const createdAt = new Date().toISOString();
    const result = this.db
      .query(
        `INSERT INTO worker_runs (job_id, function_ea, role, model, input_hash, output_json, output_path, created_at)
         VALUES ($jobId, $functionEa, $role, $model, $inputHash, $outputJson, NULL, $createdAt);`,
      )
      .run({
        $jobId: input.jobId ?? null,
        $functionEa: input.functionEa,
        $role: input.role,
        $model: input.model,
        $inputHash: input.inputHash ?? null,
        $outputJson: JSON.stringify(output),
        $createdAt: createdAt,
      });

    return Number(result.lastInsertRowid);
  }

  async listForFunction(functionEa: string): Promise<WorkerRun[]> {
    return this.db
      .query("SELECT * FROM worker_runs WHERE function_ea = $functionEa ORDER BY id ASC;")
      .all({ $functionEa: functionEa }) as WorkerRun[];
  }

  async get(id: number): Promise<WorkerRun | null> {
    return this.db.query("SELECT * FROM worker_runs WHERE id = $id;").get({ $id: id }) as WorkerRun | null;
  }
}
