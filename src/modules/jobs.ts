import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { CreateJobInput, Job, JobStatus } from "../db/types.js";
import type { JsonStore } from "../persistence/types.js";

type JobRow = Job;

const COMPLETED_STATUSES = ["done", "cancelled", "failed"] as const;

export class JobsModule {
  constructor(private readonly db: Database, private readonly jsonStore?: JsonStore) {}

  async create(input: CreateJobInput): Promise<Job> {
    const jobId = randomUUID();
    const now = new Date().toISOString();

    this.db
      .query(
        `INSERT INTO jobs (
           job_id, job_type, target, agent_role, status, input_path, output_path, attempt, created_at, updated_at
         ) VALUES (
           $jobId, $jobType, $target, $agentRole, 'queued', $inputPath, NULL, 0, $now, $now
         );`,
      )
      .run({
        $jobId: jobId,
        $jobType: input.jobType,
        $target: input.target,
        $agentRole: input.agentRole ?? null,
        $inputPath: input.inputPath ?? null,
        $now: now,
      });

    const job = await this.get(jobId);
    if (!job) {
      throw new Error(`failed to create job ${jobId}`);
    }

    if (this.jsonStore && (COMPLETED_STATUSES as unknown as string[]).includes(job.status)) {
      await this.jsonStore.write("jobs", job.job_id, job as unknown as Record<string, unknown>);
    }

    return job;
  }

  async next(filter?: { role?: string }): Promise<Job | null> {
    const claim = this.db.transaction((role: string | null) => {
      const job = this.db
        .query(
          `SELECT * FROM jobs
           WHERE status = 'queued' AND ($role IS NULL OR agent_role = $role)
           ORDER BY created_at, job_id
           LIMIT 1;`,
        )
        .get({ $role: role }) as JobRow | null;

      if (!job) {
        return null;
      }

      const now = new Date().toISOString();
      this.db
        .query(
          `UPDATE jobs
           SET status = 'running', attempt = attempt + 1, updated_at = $now
           WHERE job_id = $jobId;`,
        )
        .run({ $jobId: job.job_id, $now: now });

      return this.findById(job.job_id);
    });

    const claimedJob = claim(filter?.role ?? null);

    if (claimedJob && this.jsonStore) {
      await this.jsonStore.delete("jobs", claimedJob.job_id);
    }

    return claimedJob;
  }

  async get(jobId: string): Promise<Job | null> {
    return this.findById(jobId);
  }

  async complete(jobId: string, outputPath?: string): Promise<void> {
    await this.updateStatus(jobId, "done", { outputPath: outputPath ?? null });
  }

  async fail(jobId: string, error: string): Promise<void> {
    void error;
    await this.updateStatus(jobId, "failed");
  }

  async list(filter?: { status?: JobStatus; role?: string }): Promise<Job[]> {
    const status = filter?.status ?? null;
    const role = filter?.role ?? null;

    return this.db
      .query(
        `SELECT * FROM jobs
         WHERE ($status IS NULL OR status = $status)
           AND ($role IS NULL OR agent_role = $role)
         ORDER BY created_at, job_id;`,
      )
      .all({ $status: status, $role: role }) as JobRow[];
  }

  async cancel(jobId: string): Promise<void> {
    await this.updateStatus(jobId, "cancelled");
  }

  private findById(jobId: string): Job | null {
    return this.db.query("SELECT * FROM jobs WHERE job_id = $jobId;").get({ $jobId: jobId }) as JobRow | null;
  }

  private async updateStatus(jobId: string, status: JobStatus, options: { outputPath?: string | null } = {}): Promise<Job | null> {
    const now = new Date().toISOString();

    if (Object.hasOwn(options, "outputPath")) {
      this.db
        .query(
          `UPDATE jobs
           SET status = $status, output_path = $outputPath, updated_at = $now
           WHERE job_id = $jobId;`,
        )
        .run({ $jobId: jobId, $status: status, $outputPath: options.outputPath ?? null, $now: now });
    } else {
      this.db
        .query(
          `UPDATE jobs
           SET status = $status, updated_at = $now
           WHERE job_id = $jobId;`,
        )
        .run({ $jobId: jobId, $status: status, $now: now });
    }

    const job = this.findById(jobId);

    if (this.jsonStore) {
      if ((COMPLETED_STATUSES as unknown as string[]).includes(status)) {
        if (job) {
          await this.jsonStore.write("jobs", jobId, job as unknown as Record<string, unknown>);
        }
      } else {
        await this.jsonStore.delete("jobs", jobId);
      }
    }

    return job;
  }
}
