import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/migrations.js";
import { InMemoryJsonStore } from "../persistence/JsonStore.js";
import { WorkerRunsModule } from "./workerRuns.js";

const validAnalysis = {
  purpose: {
    summary: "Validates the incoming buffer length before parsing.",
    confidence: 0.82,
    evidence: ["checks length", "returns early on short input"],
  },
  inputs: [
    {
      original: "param_1",
      proposed_name: "buffer",
      type: "char *",
      confidence: 0.7,
      evidence: ["passed to parser"],
    },
  ],
  return_value: {
    type: "int",
    meaning: "zero on success",
    confidence: 0.6,
    evidence: ["compared against zero"],
  },
  side_effects: [],
  uncertainties: [],
};

describe("WorkerRunsModule", () => {
  let db: Database;
  let mod: WorkerRunsModule;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    mod = new WorkerRunsModule(db);
  });

  afterEach(() => {
    db.close();
  });

  test("submit validates and stores a worker run", async () => {
    const id = await mod.submit({
      jobId: "job-1",
      functionEa: "0x140012340",
      role: "semantic-analysis",
      model: "test-model",
      inputHash: "input-hash-a",
      output: validAnalysis,
    });

    expect(id).toBeGreaterThan(0);

    const run = await mod.get(id);
    expect(run).not.toBeNull();
    expect(run).toMatchObject({
      id,
      job_id: "job-1",
      function_ea: "0x140012340",
      role: "semantic-analysis",
      model: "test-model",
      input_hash: "input-hash-a",
      output_path: null,
    });
    expect(run!.created_at).toBeString();
    expect(JSON.parse(run!.output_json)).toEqual({
      function_ea: "0x140012340",
      role: "semantic-analysis",
      model: "test-model",
      job_id: "job-1",
      ...validAnalysis,
    });
  });

  test("submit defaults optional database fields to null", async () => {
    const id = await mod.submit({
      functionEa: "0x140012340",
      role: "semantic-analysis",
      model: "test-model",
      output: validAnalysis,
    });

    const run = await mod.get(id);
    expect(run).not.toBeNull();
    expect(run!.job_id).toBeNull();
    expect(run!.input_hash).toBeNull();
    expect(run!.output_path).toBeNull();
  });

  test("submit rejects output that does not match FunctionAnalysisV1", async () => {
    await expect(
      mod.submit({
        functionEa: "0x140012340",
        role: "semantic-analysis",
        model: "test-model",
        output: { function_ea: "0x140012340" },
      }),
    ).rejects.toThrow();

    expect(await mod.listForFunction("0x140012340")).toEqual([]);
  });

  test("submit does not make semantic decisions about schema-valid output", async () => {
    const id = await mod.submit({
      functionEa: "0x140012340",
      role: "semantic-analysis",
      model: "test-model",
      output: { ...validAnalysis, function_ea: "0xDEADBEEF" },
    });

    const run = await mod.get(id);
    expect(run).not.toBeNull();
    expect(run!.function_ea).toBe("0x140012340");
    expect(JSON.parse(run!.output_json).function_ea).toBe("0x140012340");
  });

  test("listForFunction returns runs for one function in insertion order", async () => {
    const first = await mod.submit({ functionEa: "A", role: "role-a", model: "model-a", output: validAnalysis });
    await mod.submit({ functionEa: "B", role: "role-b", model: "model-b", output: validAnalysis });
    const second = await mod.submit({ functionEa: "A", role: "role-c", model: "model-c", output: validAnalysis });

    const runs = await mod.listForFunction("A");

    expect(runs.map((run) => run.id)).toEqual([first, second]);
    expect(runs.map((run) => run.role)).toEqual(["role-a", "role-c"]);
  });

  test("get returns null for a missing worker run", async () => {
    await expect(mod.get(999)).resolves.toBeNull();
  });

  test("update replaces output_json on an existing worker run", async () => {
    const id = await mod.submit({
      functionEa: "0x140012340",
      role: "semantic-analysis",
      model: "test-model",
      inputHash: "hash-1",
      jobId: "job-1",
      output: validAnalysis,
    });

    const updatedOutput = {
      ...validAnalysis,
      purpose: {
        summary: "Updated purpose",
        confidence: 0.95,
        evidence: ["new evidence"],
      },
    };

    await mod.update(id, updatedOutput);

    const run = await mod.get(id);
    expect(run).not.toBeNull();
    expect(run!.function_ea).toBe("0x140012340");
    expect(run!.role).toBe("semantic-analysis");
    expect(run!.model).toBe("test-model");
    expect(run!.job_id).toBe("job-1");
    expect(run!.input_hash).toBe("hash-1");
    expect(run!.created_at).toBeString();

    const parsed = JSON.parse(run!.output_json);
    expect(parsed.purpose.summary).toBe("Updated purpose");
    expect(parsed.purpose.confidence).toBe(0.95);
  });

  test("update throws for non-existent worker run", async () => {
    await expect(mod.update(999, validAnalysis)).rejects.toThrow("Worker run 999 not found");
  });

  test("update rejects output that does not match FunctionAnalysisV1", async () => {
    const id = await mod.submit({
      functionEa: "0x140012340",
      role: "semantic-analysis",
      model: "test-model",
      output: validAnalysis,
    });

    await expect(mod.update(id, { invalid: true })).rejects.toThrow();

    const run = await mod.get(id);
    const parsed = JSON.parse(run!.output_json);
    expect(parsed.purpose.summary).toBe("Validates the incoming buffer length before parsing.");
  });

  test("update preserves role, model, function_ea, job_id unchanged", async () => {
    const id = await mod.submit({
      functionEa: "0xDEAD",
      role: "type-inference",
      model: "gpt-4",
      jobId: "job-42",
      inputHash: "hash-abc",
      output: validAnalysis,
    });

    await mod.update(id, { ...validAnalysis, uncertainties: ["new uncertainty"] });

    const run = await mod.get(id);
    expect(run!.function_ea).toBe("0xDEAD");
    expect(run!.role).toBe("type-inference");
    expect(run!.model).toBe("gpt-4");
    expect(run!.job_id).toBe("job-42");
    expect(run!.input_hash).toBe("hash-abc");
  });
});

describe("WorkerRunsModule with JsonStore", () => {
  let db: Database;
  let jsonStore: InMemoryJsonStore;
  let mod: WorkerRunsModule;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    jsonStore = new InMemoryJsonStore();
    mod = new WorkerRunsModule(db, jsonStore);
  });

  afterEach(() => {
    db.close();
  });

  test("submit writes to JSON store after SQLite write", async () => {
    const id = await mod.submit({
      jobId: "job-1",
      functionEa: "0x140012340",
      role: "semantic-analysis",
      model: "test-model",
      inputHash: "input-hash-a",
      output: validAnalysis,
    });

    const key = "0x140012340__semantic-analysis__" + id;
    const jsonData = await jsonStore.read("worker_runs", key);

    expect(jsonData).not.toBeNull();
    expect(jsonData).toMatchObject({
      id,
      job_id: "job-1",
      function_ea: "0x140012340",
      role: "semantic-analysis",
      model: "test-model",
      input_hash: "input-hash-a",
      output_path: null,
    });
    expect(jsonData!.created_at).toBeString();
  });

  test("submit skips JSON store when jsonStore is undefined", async () => {
    const modWithoutJsonStore = new WorkerRunsModule(db);

    const id = await modWithoutJsonStore.submit({
      functionEa: "0x140012340",
      role: "semantic-analysis",
      model: "test-model",
      output: validAnalysis,
    });

    const keys = await jsonStore.list("worker_runs");
    expect(keys).toEqual([]);
    expect(await mod.get(id)).not.toBeNull();
  });

  test("submit writes all required fields to JSON store", async () => {
    const id = await mod.submit({
      functionEa: "0x140012340",
      role: "semantic-analysis",
      model: "test-model",
      output: validAnalysis,
    });

    const key = "0x140012340__semantic-analysis__" + id;
    const jsonData = await jsonStore.read("worker_runs", key);

    expect(jsonData).toMatchObject({
      id,
      job_id: null,
      function_ea: "0x140012340",
      role: "semantic-analysis",
      model: "test-model",
      input_hash: null,
      output_path: null,
    });
  });

  test("update syncs updated output_json to JsonStore", async () => {
    const id = await mod.submit({
      functionEa: "0x140012340",
      role: "semantic-analysis",
      model: "test-model",
      jobId: "job-1",
      inputHash: "hash-1",
      output: validAnalysis,
    });

    const updatedOutput = {
      ...validAnalysis,
      purpose: {
        summary: "Updated purpose",
        confidence: 0.95,
        evidence: ["new evidence"],
      },
    };

    await mod.update(id, updatedOutput);

    const key = "0x140012340__semantic-analysis__" + id;
    const jsonData = await jsonStore.read("worker_runs", key);

    expect(jsonData).not.toBeNull();
    expect(jsonData).toMatchObject({
      id,
      job_id: "job-1",
      function_ea: "0x140012340",
      role: "semantic-analysis",
      model: "test-model",
      input_hash: "hash-1",
      output_path: null,
    });
    const parsedJson = JSON.parse(jsonData!.output_json as string);
    expect(parsedJson.purpose.summary).toBe("Updated purpose");
  });

  test("update skips JsonStore when jsonStore is undefined", async () => {
    const modWithoutJsonStore = new WorkerRunsModule(db);
    const id = await modWithoutJsonStore.submit({
      functionEa: "0x140012340",
      role: "semantic-analysis",
      model: "test-model",
      output: validAnalysis,
    });

    await modWithoutJsonStore.update(id, { ...validAnalysis, uncertainties: ["updated"] });

    const run = await modWithoutJsonStore.get(id);
    const parsed = JSON.parse(run!.output_json);
    expect(parsed.uncertainties).toEqual(["updated"]);
  });
});
