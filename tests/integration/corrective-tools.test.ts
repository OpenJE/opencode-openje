import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/db/migrations.js";
import { FunctionsModule } from "../../src/modules/functions.js";
import { EdgesModule } from "../../src/modules/edges.js";
import { JobsModule } from "../../src/modules/jobs.js";
import { WorkerRunsModule } from "../../src/modules/workerRuns.js";
import { ReviewsModule } from "../../src/modules/reviews.js";

const VALID_ANALYSIS = {
  purpose: { summary: "test purpose", confidence: 0.9, evidence: ["e1"] },
  inputs: [{ original: "arg0", proposed_name: "x", type: "int", confidence: 0.8, evidence: ["e2"] }],
  return_value: { type: "void", meaning: "none", confidence: 0.7, evidence: [] },
  side_effects: [],
  uncertainties: [],
};

const VALID_CONTRACT = {
  function_ea: "0x1000",
  accepted_name: "testFunc",
  kind: "function" as const,
  purpose: "does a thing",
  confidence: 0.85,
  dependencies_used: [],
  rejected_claims: [],
};

describe("Integration: Corrective Tools", () => {
  test("full unregister flow: blocked by edges, then succeeds after edge removal", async () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const functions = new FunctionsModule(db);
    const edges = new EdgesModule(db);

    // Register functions A and B
    await functions.register({ ea: "0xA", status: "discovered" });
    await functions.register({ ea: "0xB", status: "discovered" });

    // Add edge A→B
    await edges.add({ caller: "0xA", callee: "0xB", kind: "direct_call", blocking: true });

    // Try unregister A — should be blocked by the edge
    await expect(functions.unregister("0xA", "removing A")).rejects.toThrow(/Cannot unregister.*has 1 edges/);

    // Verify A is still discovered (not removed)
    const fnABefore = await functions.get("0xA");
    expect(fnABefore!.status).toBe("discovered");
    expect(fnABefore!.removed_at).toBeNull();

    // Remove the edge
    await edges.remove("0xA", "0xB");

    // Now unregister should succeed
    await functions.unregister("0xA", "removing A");

    // Verify A is removed
    const fnAAfter = await functions.get("0xA");
    expect(fnAAfter!.status).toBe("removed");
    expect(fnAAfter!.removed_at).not.toBeNull();
    expect(fnAAfter!.removal_reason).toBe("removing A");
  });

  test("worker update + review flow: review persists after worker run update", async () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const functions = new FunctionsModule(db);
    const jobs = new JobsModule(db);
    const workerRuns = new WorkerRunsModule(db);
    const reviews = new ReviewsModule(db);

    // Register function
    await functions.register({ ea: "0x1000", status: "discovered" });

    // Create a job
    const job = await jobs.create({ jobType: "analyze_function_semantics", target: "0x1000" });

    // Submit a worker run
    const runId = await workerRuns.submit({
      jobId: job.job_id,
      functionEa: "0x1000",
      role: "analyst",
      model: "test-model",
      output: VALID_ANALYSIS,
    });

    // Submit a review
    await reviews.submit({
      functionEa: "0x1000",
      reviewerModel: "reviewer-model",
      acceptedContract: VALID_CONTRACT,
    });

    // Verify review exists
    const reviewBefore = await reviews.latest("0x1000");
    expect(reviewBefore).not.toBeNull();
    const contractBefore = JSON.parse(reviewBefore!.accepted_contract_json);

    // Update the worker run
    const updatedAnalysis = {
      ...VALID_ANALYSIS,
      purpose: { summary: "updated purpose", confidence: 0.95, evidence: ["e1", "e2"] },
    };
    await workerRuns.update(runId, updatedAnalysis);

    // Verify worker run was updated
    const updatedRun = await workerRuns.get(runId);
    const runOutput = JSON.parse(updatedRun!.output_json);
    expect(runOutput.purpose.summary).toBe("updated purpose");

    // Verify review still exists and is unchanged
    const reviewAfter = await reviews.latest("0x1000");
    expect(reviewAfter).not.toBeNull();
    expect(reviewAfter!.id).toBe(reviewBefore!.id);
    const contractAfter = JSON.parse(reviewAfter!.accepted_contract_json);
    expect(contractAfter.accepted_name).toBe(contractBefore.accepted_name);
  });

  test("review amend flow: function status unchanged, review content updated", async () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const functions = new FunctionsModule(db);
    const reviews = new ReviewsModule(db);

    // Register function
    await functions.register({ ea: "0x2000", status: "discovered" });

    // Submit a review
    await reviews.submit({
      functionEa: "0x2000",
      reviewerModel: "reviewer-v1",
      acceptedContract: {
        ...VALID_CONTRACT,
        function_ea: "0x2000",
        accepted_name: "originalName",
        purpose: "original purpose",
        confidence: 0.7,
      },
    });

    // Verify function is now reviewed
    const fnBefore = await functions.get("0x2000");
    expect(fnBefore!.status).toBe("reviewed");

    const reviewBefore = await reviews.latest("0x2000");
    expect(reviewBefore).not.toBeNull();
    const contractBefore = JSON.parse(reviewBefore!.accepted_contract_json);
    expect(contractBefore.accepted_name).toBe("originalName");

    // Amend the review
    await reviews.amend({
      reviewId: reviewBefore!.id,
      acceptedContract: {
        ...VALID_CONTRACT,
        function_ea: "0x2000",
        accepted_name: "amendedName",
        purpose: "amended purpose",
        confidence: 0.9,
      },
      reason: "correcting name",
    });

    // Verify function status is still "reviewed" (unchanged)
    const fnAfter = await functions.get("0x2000");
    expect(fnAfter!.status).toBe("reviewed");

    // Verify review content was updated
    const reviewAfter = await reviews.latest("0x2000");
    expect(reviewAfter).not.toBeNull();
    const contractAfter = JSON.parse(reviewAfter!.accepted_contract_json);
    expect(contractAfter.accepted_name).toBe("amendedName");
    expect(contractAfter.purpose).toBe("amended purpose");
    expect(contractAfter.confidence).toBe(0.9);

    // Verify amend_reason was recorded
    expect(reviewAfter!.amend_reason).toBe("correcting name");
  });

  test("edge remove flow: add edge, query children, remove edge, verify empty", async () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const functions = new FunctionsModule(db);
    const edges = new EdgesModule(db);

    // Register functions
    await functions.register({ ea: "0xCALLER", status: "discovered" });
    await functions.register({ ea: "0xCALLEE1", status: "discovered" });
    await functions.register({ ea: "0xCALLEE2", status: "discovered" });

    // Add edges
    await edges.add({ caller: "0xCALLER", callee: "0xCALLEE1", kind: "direct_call", blocking: true });
    await edges.add({ caller: "0xCALLER", callee: "0xCALLEE2", kind: "import_call", blocking: false });

    // Query children — should have 2
    const childrenBefore = await edges.children("0xCALLER");
    expect(childrenBefore.length).toBe(2);

    // Remove one edge
    await edges.remove("0xCALLER", "0xCALLEE1");

    // Verify children list has 1 remaining
    const childrenAfter1 = await edges.children("0xCALLER");
    expect(childrenAfter1.length).toBe(1);
    expect(childrenAfter1[0].callee_ea).toBe("0xCALLEE2");

    // Remove the other edge
    await edges.remove("0xCALLER", "0xCALLEE2");

    // Verify children list is now empty
    const childrenAfter2 = await edges.children("0xCALLER");
    expect(childrenAfter2.length).toBe(0);
  });

  test("job cancel flow: create job, cancel, verify status", async () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const jobs = new JobsModule(db);

    // Create a job
    const job = await jobs.create({ jobType: "analyze_function_semantics", target: "0x3000" });
    expect(job.status).toBe("queued");

    // Cancel the job
    await jobs.cancel(job.job_id);

    // Verify status is cancelled
    const cancelledJob = await jobs.get(job.job_id);
    expect(cancelledJob!.status).toBe("cancelled");
  });

  test("end-to-end: submit returns review_id, list shows it, get retrieves it, amend works", async () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const functions = new FunctionsModule(db);
    const reviews = new ReviewsModule(db);

    await functions.register({ ea: "0x1000", status: "discovered" });

    // Submit review
    const result = await reviews.submit({
      functionEa: "0x1000",
      reviewerModel: "test-model",
      acceptedContract: VALID_CONTRACT,
    });
    expect(result).toHaveProperty("id");
    const reviewId = result.id;

    // List reviews
    const list = await reviews.list("0x1000");
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(reviewId);

    // Get review by id
    const review = await reviews.get(reviewId);
    expect(review).not.toBeNull();
    expect(review!.id).toBe(reviewId);

    // Amend the review
    await reviews.amend({
      reviewId,
      reason: "Updated analysis",
      acceptedContract: { ...VALID_CONTRACT, accepted_name: "updatedName" },
    });

    // Verify amend worked
    const amended = await reviews.get(reviewId);
    expect(amended).not.toBeNull();
    const amendedContract = JSON.parse(amended!.accepted_contract_json);
    expect(amendedContract.accepted_name).toBe("updatedName");
  });

  test("re-register after unregister: removed_at cleared, status reset", async () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const functions = new FunctionsModule(db);

    // Register function
    await functions.register({ ea: "0x4000", status: "discovered" });

    // Unregister it
    await functions.unregister("0x4000", "no longer needed");

    // Verify it's removed
    const fnRemoved = await functions.get("0x4000");
    expect(fnRemoved!.status).toBe("removed");
    expect(fnRemoved!.removed_at).not.toBeNull();
    expect(fnRemoved!.removal_reason).toBe("no longer needed");

    // Re-register the same function
    await functions.register({ ea: "0x4000", status: "discovered" });

    // Verify removed_at is cleared and status is reset
    const fnReregistered = await functions.get("0x4000");
    expect(fnReregistered!.status).toBe("discovered");
    expect(fnReregistered!.removed_at).toBeNull();
    expect(fnReregistered!.removal_reason).toBeNull();
  });
});