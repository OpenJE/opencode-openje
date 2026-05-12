import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/migrations.js";
import { WorkerRunsModule } from "./workerRuns.js";

const validAnalysis = {
  function_ea: "0x140012340",
  role: "semantic-analysis",
  model: "test-model",
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
    expect(JSON.parse(run!.output_json)).toEqual(validAnalysis);
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
    expect(JSON.parse(run!.output_json).function_ea).toBe("0xDEADBEEF");
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
});
