import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/migrations.js";
import { FunctionsModule } from "./functions.js";
import { EdgesModule } from "./edges.js";
import { WorkerRunsModule } from "./workerRuns.js";
import { DependenciesModule } from "./dependencies.js";
import { ReviewsModule } from "./reviews.js";
import { InMemoryJsonStore } from "../persistence/JsonStore.js";
import { reviewKey, summaryDependencyKey } from "../persistence/types.js";

const validAnalysis = {
  purpose: {
    summary: "Validates buffer length.",
    confidence: 0.82,
    evidence: ["checks length"],
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

const minimalContract = {
  function_ea: "0x140012340",
  accepted_name: "parse_header",
  kind: "function" as const,
  purpose: "Parses the packet header",
  confidence: 0.85,
};

const fullContract = {
  function_ea: "0x140012340",
  contract_version: 1,
  accepted_name: "parse_header",
  accepted_prototype: "int parse_header(const char *buf)",
  kind: "function" as const,
  owner: "NetworkModule",
  purpose: "Parses the packet header",
  return_value: { type: "int", meaning: "zero on success" },
  accepted_variable_names: { param_1: "buffer" },
  dependencies_used: [
    { ea: "0xDEADBEEF", summary_version: 2 },
    { ea: "0xCAFEBABE", summary_version: 1 },
  ],
  rejected_claims: [{ claim: "returns pointer", reason: "actually returns int" }],
  confidence: 0.92,
};

describe("ReviewsModule", () => {
  let db: Database;
  let reviews: ReviewsModule;
  let functions: FunctionsModule;
  let edges: EdgesModule;
  let workerRuns: WorkerRunsModule;
  let dependencies: DependenciesModule;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    reviews = new ReviewsModule(db);
    functions = new FunctionsModule(db);
    edges = new EdgesModule(db);
    workerRuns = new WorkerRunsModule(db);
    dependencies = new DependenciesModule(db);
  });

  afterEach(() => {
    db.close();
  });

  test("bundle returns empty arrays when no data exists for a function", async () => {
    await functions.register({ ea: "0x140012340" });

    const result = await reviews.bundle("0x140012340");

    expect(result).toMatchObject({
      functionEa: "0x140012340",
      workerRuns: [],
      edges: [],
      dependencies: [],
    });
  });

  test("bundle collects worker_runs, edges, and dependencies for a function", async () => {
    await functions.register({ ea: "0x140012340" });
    await workerRuns.submit({
      functionEa: "0x140012340",
      role: "semantic-analysis",
      model: "test-model",
      output: validAnalysis,
    });
    await edges.add({ caller: "0x140012340", callee: "0xDEADBEEF", kind: "direct_call" });
    await dependencies.record("0x140012340", "0xDEADBEEF", 1);

    const result = await reviews.bundle("0x140012340");

    expect(result.workerRuns.length).toBe(1);
    expect(result.edges.length).toBe(1);
    expect(result.dependencies.length).toBe(1);
    expect(result).toMatchObject({
      functionEa: "0x140012340",
      workerRuns: [{ function_ea: "0x140012340", role: "semantic-analysis" }],
      edges: [{ caller_ea: "0x140012340", callee_ea: "0xDEADBEEF", edge_kind: "direct_call" }],
      dependencies: [{ parent_ea: "0x140012340", child_ea: "0xDEADBEEF", child_summary_version_used: 1 }],
    });
  });

  test("submit with minimal valid contract updates function status and summary_version", async () => {
    await functions.register({ ea: "0x140012340" });

    await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: minimalContract,
    });

    const fn = await functions.get("0x140012340");
    expect(fn).not.toBeNull();
    expect(fn!.status).toBe("reviewed");
    expect(fn!.summary_version).toBe(1);
  });

  test("submit with full contract inserts review and records dependencies", async () => {
    await functions.register({ ea: "0x140012340" });

    await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: fullContract,
    });

    const review = await reviews.latest("0x140012340");
    expect(review).not.toBeNull();
    expect(review).toMatchObject({
      function_ea: "0x140012340",
      reviewer_model: "gpt-4",
      contract_version: 1,
    });

    const deps = await dependencies.usedByParent("0x140012340");
    expect(deps.length).toBe(2);
    const sorted = [...deps].sort((a, b) => a.child_ea.localeCompare(b.child_ea));
    expect(sorted).toMatchObject([
      { parent_ea: "0x140012340", child_ea: "0xCAFEBABE", child_summary_version_used: 1 },
      { parent_ea: "0x140012340", child_ea: "0xDEADBEEF", child_summary_version_used: 2 },
    ]);
  });

  test("submit rejects invalid contract with Zod validation error", async () => {
    await functions.register({ ea: "0x140012340" });

    await expect(
      reviews.submit({
        functionEa: "0x140012340",
        reviewerModel: "gpt-4",
        acceptedContract: { function_ea: "0x140012340" },
      }),
    ).rejects.toThrow();
  });

  test("submit rejects contract with wrong type for confidence", async () => {
    await functions.register({ ea: "0x140012340" });

    await expect(
      reviews.submit({
        functionEa: "0x140012340",
        reviewerModel: "gpt-4",
        acceptedContract: { ...minimalContract, confidence: "high" },
      }),
    ).rejects.toThrow();
  });

  test("latest returns null when no reviews exist", async () => {
    const result = await reviews.latest("0x140012340");
    expect(result).toBeNull();
  });

  test("latest returns the most recent review (highest contract_version)", async () => {
    await functions.register({ ea: "0x140012340" });

    await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: minimalContract,
    });
    await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "claude-3",
      acceptedContract: { ...minimalContract, confidence: 0.9 },
    });

    const review = await reviews.latest("0x140012340");
    expect(review).not.toBeNull();
    expect(review!.contract_version).toBe(2);
    expect(review!.reviewer_model).toBe("claude-3");
  });

  test("submit twice on same function increments contract_version each time", async () => {
    await functions.register({ ea: "0x140012340" });

    await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: minimalContract,
    });
    const fn1 = await functions.get("0x140012340");
    expect(fn1!.summary_version).toBe(1);

    await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: { ...minimalContract, confidence: 0.75 },
    });
    const fn2 = await functions.get("0x140012340");
    expect(fn2!.summary_version).toBe(2);
  });

  test("submit writes function, review, and dependency JSON files when jsonStore is provided", async () => {
    const jsonStore = new InMemoryJsonStore();
    reviews = new ReviewsModule(db, jsonStore);
    await functions.register({ ea: "0x140012340" });

    await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: fullContract,
    });

    const fnData = await jsonStore.read("functions", "0x140012340");
    expect(fnData).not.toBeNull();
    expect(fnData!.status).toBe("reviewed");
    expect(fnData!.summary_version).toBe(1);

    const reviewData = await jsonStore.read("reviews", reviewKey("0x140012340", 1));
    expect(reviewData).not.toBeNull();
    expect(reviewData!.function_ea).toBe("0x140012340");
    expect(reviewData!.reviewer_model).toBe("gpt-4");

    const dep1 = await jsonStore.read("summary_dependencies", summaryDependencyKey("0x140012340", "0xDEADBEEF"));
    expect(dep1).not.toBeNull();
    expect(dep1!.parent_ea).toBe("0x140012340");
    expect(dep1!.child_ea).toBe("0xDEADBEEF");

    const dep2 = await jsonStore.read("summary_dependencies", summaryDependencyKey("0x140012340", "0xCAFEBABE"));
    expect(dep2).not.toBeNull();
    expect(dep2!.parent_ea).toBe("0x140012340");
    expect(dep2!.child_ea).toBe("0xCAFEBABE");
  });

  test("submit with minimal contract writes function and review JSON but no dependency JSON", async () => {
    const jsonStore = new InMemoryJsonStore();
    reviews = new ReviewsModule(db, jsonStore);
    await functions.register({ ea: "0x140012340" });

    await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: minimalContract,
    });

    const fnData = await jsonStore.read("functions", "0x140012340");
    expect(fnData).not.toBeNull();
    expect(fnData!.status).toBe("reviewed");

    const reviewData = await jsonStore.read("reviews", reviewKey("0x140012340", 1));
    expect(reviewData).not.toBeNull();

    const deps = await jsonStore.list("summary_dependencies");
    expect(deps).toEqual([]);
  });

  test("submit skips JSON writes when jsonStore is not provided", async () => {
    await functions.register({ ea: "0x140012340" });

    await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: fullContract,
    });

    const fn = await functions.get("0x140012340");
    expect(fn!.status).toBe("reviewed");
    const review = await reviews.latest("0x140012340");
    expect(review).not.toBeNull();
  });

  test("amend review contract updates accepted_contract_json and amend_reason without bumping summary_version", async () => {
    const jsonStore = new InMemoryJsonStore();
    reviews = new ReviewsModule(db, jsonStore);
    await functions.register({ ea: "0x140012340" });
    await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: minimalContract,
    });
    const review = await reviews.latest("0x140012340");
    expect(review).not.toBeNull();

    const amendedContract = {
      ...minimalContract,
      accepted_name: "parse_packet_header",
      purpose: "Parses and validates the packet header",
      confidence: 0.91,
    };
    await reviews.amend({
      reviewId: review!.id,
      acceptedContract: amendedContract,
      reason: "Reviewer refined the accepted name and purpose",
    });

    const amendedReview = await reviews.latest("0x140012340");
    expect(amendedReview).not.toBeNull();
    expect(JSON.parse(amendedReview!.accepted_contract_json)).toEqual({
      ...amendedContract,
      accepted_variable_names: {},
      dependencies_used: [],
      rejected_claims: [],
    });
    expect(amendedReview!.amend_reason).toBe("Reviewer refined the accepted name and purpose");
    const fn = await functions.get("0x140012340");
    expect(fn!.summary_version).toBe(1);

    const reviewData = await jsonStore.read("reviews", reviewKey("0x140012340", 1));
    expect(reviewData).not.toBeNull();
    expect(reviewData!.accepted_contract_json).toBe(amendedReview!.accepted_contract_json);
    expect(reviewData!.amend_reason).toBe("Reviewer refined the accepted name and purpose");
  });

  test("amend review rejected_claims updates rejected_claims_json", async () => {
    await functions.register({ ea: "0x140012340" });
    await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: minimalContract,
    });
    const review = await reviews.latest("0x140012340");
    expect(review).not.toBeNull();

    const rejectedClaims = [{ claim: "returns pointer", reason: "returns int status" }];
    await reviews.amend({
      reviewId: review!.id,
      rejectedClaims,
      reason: "Rejected stale claim",
    });

    const amendedReview = await reviews.latest("0x140012340");
    expect(amendedReview).not.toBeNull();
    expect(amendedReview!.rejected_claims_json).toBe(JSON.stringify(rejectedClaims));
  });

  test("amend non-existent review throws not found", async () => {
    await expect(
      reviews.amend({
        reviewId: 999,
        acceptedContract: minimalContract,
        reason: "No matching review",
      }),
    ).rejects.toThrow("Review 999 not found");
  });

  test("amend with invalid contract throws validation error", async () => {
    await functions.register({ ea: "0x140012340" });
    await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: minimalContract,
    });
    const review = await reviews.latest("0x140012340");
    expect(review).not.toBeNull();

    await expect(
      reviews.amend({
        reviewId: review!.id,
        acceptedContract: { function_ea: "0x140012340" },
        reason: "Incomplete contract",
      }),
    ).rejects.toThrow();
  });

  test("amend with mismatched function_ea throws Cannot change review function_ea", async () => {
    await functions.register({ ea: "0x140012340" });
    await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: minimalContract,
    });
    const review = await reviews.latest("0x140012340");
    expect(review).not.toBeNull();

    const mismatchedContract = {
      function_ea: "0x99999999",
      accepted_name: "parse_header",
      kind: "function" as const,
      purpose: "Parses the packet header",
      confidence: 0.85,
    };

    await expect(
      reviews.amend({
        reviewId: review!.id,
        acceptedContract: mismatchedContract,
        reason: "Attempted function_ea change",
      }),
    ).rejects.toThrow("Cannot change review function_ea");
  });

  test("amend with dependencies_used replaces summary_dependencies rows", async () => {
    await functions.register({ ea: "0x140012340" });
    await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: fullContract,
    });

    await dependencies.record("0x140012340", "0xOLD", 7);
    const review = await reviews.latest("0x140012340");
    expect(review).not.toBeNull();

    await reviews.amend({
      reviewId: review!.id,
      acceptedContract: {
        ...fullContract,
        dependencies_used: [{ ea: "0xFEEDFACE", summary_version: 3 }],
      },
      reason: "Updated dependency evidence",
    });

    const deps = await dependencies.usedByParent("0x140012340");
    expect(deps).toEqual([
      { parent_ea: "0x140012340", child_ea: "0xFEEDFACE", child_summary_version_used: 3 },
    ]);
  });

  test("submit returns review id", async () => {
    await functions.register({ ea: "0x140012340" });
    const result = await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: minimalContract,
    });
    expect(result).toHaveProperty("id");
    expect(typeof result.id).toBe("number");
    expect(result.id).toBeGreaterThan(0);
  });

  test("list returns all reviews for a function ordered by contract_version DESC", async () => {
    await functions.register({ ea: "0x140012340" });
    await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: minimalContract,
    });
    await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: { ...minimalContract, accepted_name: "parse_header_v2" },
    });
    const list = await reviews.list("0x140012340");
    expect(list.length).toBe(2);
    expect(list[0].contract_version).toBeGreaterThan(list[1].contract_version);
  });

  test("list returns empty array for unknown function", async () => {
    const list = await reviews.list("0xUNKNOWN");
    expect(list).toEqual([]);
  });

  test("get returns review by id", async () => {
    await functions.register({ ea: "0x140012340" });
    const submitResult = await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: minimalContract,
    });
    const review = await reviews.get(submitResult.id);
    expect(review).not.toBeNull();
    expect(review!.id).toBe(submitResult.id);
  });

  test("get returns null for unknown id", async () => {
    const review = await reviews.get(999999);
    expect(review).toBeNull();
  });

  test("amend does not change function status or summary_version", async () => {
    await functions.register({ ea: "0x140012340" });
    await reviews.submit({
      functionEa: "0x140012340",
      reviewerModel: "gpt-4",
      acceptedContract: minimalContract,
    });
    const before = await functions.get("0x140012340");
    const review = await reviews.latest("0x140012340");
    expect(before).not.toBeNull();
    expect(review).not.toBeNull();

    await reviews.amend({
      reviewId: review!.id,
      acceptedContract: { ...minimalContract, confidence: 0.8 },
      rejectedClaims: [{ claim: "never fails", reason: "error path exists" }],
      reason: "Adjusted confidence and rejected claim",
    });

    const after = await functions.get("0x140012340");
    expect(after).not.toBeNull();
    expect(after!.status).toBe(before!.status);
    expect(after!.summary_version).toBe(before!.summary_version);
  });
});
