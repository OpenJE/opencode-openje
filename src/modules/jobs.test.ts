import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/migrations.js";
import { JobsModule } from "./jobs.js";
import { InMemoryJsonStore } from "../persistence/JsonStore.js";
import type { JsonStore } from "../persistence/types.js";

function createModule(jsonStore?: JsonStore): { db: Database; jobs: JobsModule; jsonStore: JsonStore | undefined } {
  const db = new Database(":memory:");
  runMigrations(db);
  return { db, jobs: new JobsModule(db, jsonStore), jsonStore };
}

async function createInMemoryJsonStore(): Promise<InMemoryJsonStore> {
  return new InMemoryJsonStore();
}

describe("JobsModule", () => {
  test("creates a queued job with nullable optional fields", async () => {
    const { db, jobs } = createModule();
    try {
      const job = await jobs.create({
        jobType: "analyze_function_semantics",
        target: "401000",
        agentRole: "semantics",
        inputPath: ".rework/packets/job.json",
      });

      expect(job.job_id.length).toBeGreaterThan(0);
      expect(job.job_type).toBe("analyze_function_semantics");
      expect(job.target).toBe("401000");
      expect(job.agent_role).toBe("semantics");
      expect(job.status).toBe("queued");
      expect(job.input_path).toBe(".rework/packets/job.json");
      expect(job.output_path).toBeNull();
      expect(job.attempt).toBe(0);
      expect(typeof job.created_at).toBe("string");
      expect(job.updated_at).toBe(job.created_at);

      await expect(jobs.get(job.job_id)).resolves.toEqual(job);
    } finally {
      db.close();
    }
  });

  test("claims the oldest queued job atomically and increments attempt", async () => {
    const { db, jobs } = createModule();
    try {
      const first = await jobs.create({ jobType: "discover_subgraph", target: "401000" });
      const second = await jobs.create({ jobType: "discover_subgraph", target: "402000" });

      const claimed = await jobs.next();

      expect(claimed).not.toBeNull();
      expect(claimed?.status).toBe("running");
      expect(claimed?.attempt).toBe(1);
      expect(typeof claimed?.updated_at).toBe("string");

      const claimedId = claimed!.job_id;
      const otherId = claimedId === first.job_id ? second.job_id : first.job_id;

      await expect(jobs.get(claimedId)).resolves.toMatchObject({ status: "running", attempt: 1 });
      await expect(jobs.get(otherId)).resolves.toMatchObject({ status: "queued", attempt: 0 });
    } finally {
      db.close();
    }
  });

  test("claims only queued jobs for the requested role", async () => {
    const { db, jobs } = createModule();
    try {
      const reviewer = await jobs.create({
        jobType: "review_function_contract",
        target: "401000",
        agentRole: "reviewer",
      });
      const analyzer = await jobs.create({
        jobType: "analyze_function_types",
        target: "402000",
        agentRole: "analyzer",
      });

      const claimed = await jobs.next({ role: "analyzer" });

      expect(claimed?.job_id).toBe(analyzer.job_id);
      expect(claimed?.agent_role).toBe("analyzer");
      await expect(jobs.get(reviewer.job_id)).resolves.toMatchObject({ status: "queued", attempt: 0 });
    } finally {
      db.close();
    }
  });

  test("returns null when no queued job matches next filter", async () => {
    const { db, jobs } = createModule();
    try {
      const job = await jobs.create({ jobType: "classify_edges", target: "401000", agentRole: "edges" });
      await jobs.cancel(job.job_id);

      await expect(jobs.next()).resolves.toBeNull();
      await expect(jobs.next({ role: "missing" })).resolves.toBeNull();
    } finally {
      db.close();
    }
  });

  test("gets null for missing job ids", async () => {
    const { db, jobs } = createModule();
    try {
      await expect(jobs.get("missing-job")).resolves.toBeNull();
    } finally {
      db.close();
    }
  });

  test("marks jobs done with optional output path", async () => {
    const { db, jobs } = createModule();
    try {
      const job = await jobs.create({ jobType: "emit_faithful_cpp", target: "401000" });

      await jobs.complete(job.job_id, ".rework/worker_outputs/job.json");

      await expect(jobs.get(job.job_id)).resolves.toMatchObject({
        status: "done",
        output_path: ".rework/worker_outputs/job.json",
      });
    } finally {
      db.close();
    }
  });

  test("marks jobs failed", async () => {
    const { db, jobs } = createModule();
    try {
      const job = await jobs.create({ jobType: "fix_compile_error", target: "401000" });

      await jobs.fail(job.job_id, "compiler rejected generated source");

      await expect(jobs.get(job.job_id)).resolves.toMatchObject({
        status: "failed",
      });
    } finally {
      db.close();
    }
  });

  test("lists jobs with status and role filters", async () => {
    const { db, jobs } = createModule();
    try {
      const queuedAnalyzer = await jobs.create({ jobType: "analyze_function_names", target: "401000", agentRole: "analyzer" });
      const queuedReviewer = await jobs.create({ jobType: "review_cpp_fidelity", target: "402000", agentRole: "reviewer" });
      const doneAnalyzer = await jobs.create({ jobType: "apply_ida_patch_plan", target: "403000", agentRole: "analyzer" });
      await jobs.complete(doneAnalyzer.job_id);

      await expect(jobIds(jobs.list())).resolves.toEqual(expect.arrayContaining([queuedAnalyzer.job_id, queuedReviewer.job_id, doneAnalyzer.job_id]));
      await expect(jobIds(jobs.list({ status: "queued" }))).resolves.toEqual(expect.arrayContaining([queuedAnalyzer.job_id, queuedReviewer.job_id]));
      await expect(jobIds(jobs.list({ role: "analyzer" }))).resolves.toEqual(expect.arrayContaining([queuedAnalyzer.job_id, doneAnalyzer.job_id]));
      await expect(jobIds(jobs.list({ status: "done", role: "analyzer" }))).resolves.toEqual([doneAnalyzer.job_id]);
    } finally {
      db.close();
    }
  });

  test("cancels jobs", async () => {
    const { db, jobs } = createModule();
    try {
      const job = await jobs.create({ jobType: "analyze_scc_cluster", target: "scc-1" });

      await jobs.cancel(job.job_id);

      await expect(jobs.get(job.job_id)).resolves.toMatchObject({ status: "cancelled" });
      await expect(jobIds(jobs.list({ status: "cancelled" }))).resolves.toEqual([job.job_id]);
    } finally {
      db.close();
    }
  });
});

async function jobIds(jobsPromise: Promise<Array<{ job_id: string }>>): Promise<string[]> {
  return (await jobsPromise).map((job) => job.job_id);
}

describe("JobsModule JSON persistence", () => {
  test("does not persist queued job to JSON", async () => {
    const store = await createInMemoryJsonStore();
    const { db, jobs } = createModule(store);
    try {
      const job = await jobs.create({ jobType: "analyze_function_semantics", target: "401000" });
      expect(job.status).toBe("queued");

      const persisted = await store.read("jobs", job.job_id);
      expect(persisted).toBeNull();
    } finally {
      db.close();
    }
  });

  test("does not persist running job to JSON after next()", async () => {
    const store = await createInMemoryJsonStore();
    const { db, jobs } = createModule(store);
    try {
      const job = await jobs.create({ jobType: "analyze_function_semantics", target: "401000" });
      expect(job.status).toBe("queued");

      await store.write("jobs", job.job_id, { status: "queued" } as Record<string, unknown>);

      const claimed = await jobs.next();
      expect(claimed?.status).toBe("running");

      const persisted = await store.read("jobs", job.job_id);
      expect(persisted).toBeNull();
    } finally {
      db.close();
    }
  });

  test("persists done job to JSON after complete()", async () => {
    const store = await createInMemoryJsonStore();
    const { db, jobs } = createModule(store);
    try {
      const job = await jobs.create({ jobType: "analyze_function_semantics", target: "401000" });
      await jobs.complete(job.job_id, ".rework/output.json");

      const persisted = await store.read("jobs", job.job_id);
      expect(persisted).not.toBeNull();
      expect(persisted).toMatchObject({
        job_id: job.job_id,
        status: "done",
        output_path: ".rework/output.json",
      });
    } finally {
      db.close();
    }
  });

  test("persists cancelled job to JSON after cancel()", async () => {
    const store = await createInMemoryJsonStore();
    const { db, jobs } = createModule(store);
    try {
      const job = await jobs.create({ jobType: "analyze_function_semantics", target: "401000" });
      await jobs.cancel(job.job_id);

      const persisted = await store.read("jobs", job.job_id);
      expect(persisted).not.toBeNull();
      expect(persisted).toMatchObject({
        job_id: job.job_id,
        status: "cancelled",
      });
    } finally {
      db.close();
    }
  });

  test("persists failed job to JSON after fail()", async () => {
    const store = await createInMemoryJsonStore();
    const { db, jobs } = createModule(store);
    try {
      const job = await jobs.create({ jobType: "analyze_function_semantics", target: "401000" });
      await jobs.fail(job.job_id, "analysis timeout");

      const persisted = await store.read("jobs", job.job_id);
      expect(persisted).not.toBeNull();
      expect(persisted).toMatchObject({
        job_id: job.job_id,
        status: "failed",
      });
    } finally {
      db.close();
    }
  });

  test("skips JSON persistence when jsonStore is undefined", async () => {
    const { db, jobs, jsonStore } = createModule(undefined);
    try {
      expect(jsonStore).toBeUndefined();

      const job = await jobs.create({ jobType: "analyze_function_semantics", target: "401000" });
      await jobs.complete(job.job_id);

      await expect(jobs.get(job.job_id)).resolves.toMatchObject({ status: "done" });
    } finally {
      db.close();
    }
  });
});
