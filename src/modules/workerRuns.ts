import type { Database } from "bun:sqlite";
import type { JsonStore } from "../persistence/types.js";
import { workerRunKey } from "../persistence/types.js";
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
  constructor(private readonly db: Database, private readonly jsonStore?: JsonStore) {}

  async submit(input: SubmitWorkerRunInput): Promise<number> {
    const parsed = FunctionAnalysisV1.parse(input.output);
    const createdAt = new Date().toISOString();
    const analysis = {
      function_ea: input.functionEa,
      role: input.role,
      model: input.model,
      ...(input.jobId ? { job_id: input.jobId } : {}),
      ...parsed,
    };
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
        $outputJson: JSON.stringify(analysis),
        $createdAt: createdAt,
      });

    const id = Number(result.lastInsertRowid);

    if (this.jsonStore !== undefined) {
      const key = workerRunKey(input.functionEa, input.role, id);
      await this.jsonStore.write("worker_runs", key, {
        id,
        job_id: input.jobId ?? null,
        function_ea: input.functionEa,
        role: input.role,
        model: input.model,
        input_hash: input.inputHash ?? null,
        output_json: JSON.stringify(analysis),
        output_path: null,
        created_at: createdAt,
      });
    }

    return id;
  }

  async listForFunction(functionEa: string): Promise<WorkerRun[]> {
    return this.db
      .query("SELECT * FROM worker_runs WHERE function_ea = $functionEa ORDER BY id ASC;")
      .all({ $functionEa: functionEa }) as WorkerRun[];
  }

  async get(id: number): Promise<WorkerRun | null> {
    return this.db.query("SELECT * FROM worker_runs WHERE id = $id;").get({ $id: id }) as WorkerRun | null;
  }

  async update(id: number, output: unknown): Promise<void> {
    const existing = await this.get(id);
    if (existing === null) {
      throw new Error(`Worker run ${id} not found`);
    }

    const parsed = FunctionAnalysisV1.parse(output);
    const newOutputJson = JSON.stringify({
      function_ea: existing.function_ea,
      role: existing.role,
      model: existing.model,
      ...(existing.job_id ? { job_id: existing.job_id } : {}),
      ...parsed,
    });

    this.db
      .query("UPDATE worker_runs SET output_json = $outputJson WHERE id = $id;")
      .run({ $outputJson: newOutputJson, $id: id });

    if (this.jsonStore !== undefined) {
      const key = workerRunKey(existing.function_ea, existing.role, id);
      await this.jsonStore.write("worker_runs", key, {
        id,
        job_id: existing.job_id,
        function_ea: existing.function_ea,
        role: existing.role,
        model: existing.model,
        input_hash: existing.input_hash,
        output_json: newOutputJson,
        output_path: existing.output_path,
        created_at: existing.created_at,
      });
    }
  }
}
