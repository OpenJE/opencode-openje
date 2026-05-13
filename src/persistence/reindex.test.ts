import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../db/migrations.js";
import { JsonStore } from "./JsonStore.js";
import { reindex } from "./reindex.js";

describe("reindex", () => {
  let root: string;
  let db: Database;
  let store: JsonStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "openje-reindex-"));
    db = new Database(":memory:");
    runMigrations(db);
    store = new JsonStore(root);
  });

  afterEach(async () => {
    db.close();
    await rm(root, { recursive: true, force: true });
  });

  test("rebuilds sqlite rows from json table records", async () => {
    await store.write("analysis_functions", "0x401000", {
      status: "reviewed",
      summary_version: 2,
      accepted_summary_json: '{"purpose":"parse"}',
      confidence: 0.91,
      dirty: 0,
      last_pseudocode_hash: "hash-a",
      updated_at: "2026-05-12T10:00:00.000Z",
    });
    await store.write("analysis_edges", "0x401000__0x402000", {
      edge_kind: "direct_call",
      blocking: 1,
      reason: "calls child",
      discovered_at: "2026-05-12T10:01:00.000Z",
    });
    await store.write("worker_runs", "0x401000__semantic__7", {
      job_id: "job-done",
      model: "model-a",
      input_hash: "input-a",
      output_json: '{"ok":true}',
      output_path: ".rework/worker_outputs/7.json",
      created_at: "2026-05-12T10:02:00.000Z",
    });
    await store.write("reviews", "0x401000__v3", {
      id: 8,
      reviewer_model: "reviewer-a",
      accepted_contract_json: '{"accepted":true}',
      accepted_contract_path: ".rework/reviews/8.json",
      rejected_claims_json: "[]",
      created_at: "2026-05-12T10:03:00.000Z",
    });
    await store.write("summary_dependencies", "0x401000__0x402000", {
      child_summary_version_used: 4,
    });
    await store.write("source_symbols", "symbol-a", {
      kind: "function",
      name: "parse_packet",
      namespace: "net",
      origin_ea: "0x401000",
      contract_version: 3,
      definition_json: '{"file":"packet.cpp"}',
      status: "emitted",
    });
    await store.write("source_blocks", "block-a", {
      symbol_id: "symbol-a",
      file_path: "src/packet.cpp",
      block_hash: "block-hash",
      managed: 1,
      manual_override: 0,
      fidelity_mode: "pseudocode_faithful",
      updated_at: "2026-05-12T10:04:00.000Z",
    });
    await store.write("simplifications", "symbol-a__9", {
      function_ea: "0x401000",
      kind: "rename",
      original_json: '{"name":"FUN_401000"}',
      replacement_json: '{"name":"parse_packet"}',
      evidence_json: "[]",
      risk: "low",
      reviewer_required: 0,
      accepted: 1,
      created_at: "2026-05-12T10:05:00.000Z",
    });
    await store.write("jobs", "job-done", {
      job_type: "analyze_function_semantics",
      target: "0x401000",
      agent_role: "semantic",
      status: "done",
      input_path: ".rework/packets/job-done.json",
      output_path: ".rework/worker_outputs/job-done.json",
      attempt: 2,
      created_at: "2026-05-12T10:06:00.000Z",
      updated_at: "2026-05-12T10:07:00.000Z",
    });
    await store.write("jobs", "job-queued", {
      job_type: "analyze_function_semantics",
      target: "0x402000",
      status: "queued",
      attempt: 0,
    });

    await reindex(root, db);

    expect(db.query("SELECT * FROM analysis_functions;").get()).toEqual({
      ea: "0x401000",
      status: "reviewed",
      summary_version: 2,
      accepted_summary_json: '{"purpose":"parse"}',
      confidence: 0.91,
      dirty: 0,
      last_pseudocode_hash: "hash-a",
      removed_at: null,
      removal_reason: null,
      updated_at: "2026-05-12T10:00:00.000Z",
    });
    expect(db.query("SELECT * FROM analysis_edges;").get()).toEqual({
      caller_ea: "0x401000",
      callee_ea: "0x402000",
      edge_kind: "direct_call",
      blocking: 1,
      reason: "calls child",
      discovered_at: "2026-05-12T10:01:00.000Z",
    });
    expect(db.query("SELECT * FROM worker_runs;").get()).toEqual({
      id: 7,
      job_id: "job-done",
      function_ea: "0x401000",
      role: "semantic",
      model: "model-a",
      input_hash: "input-a",
      output_json: '{"ok":true}',
      output_path: ".rework/worker_outputs/7.json",
      created_at: "2026-05-12T10:02:00.000Z",
    });
    expect(db.query("SELECT * FROM reviews;").get()).toEqual({
      id: 8,
      function_ea: "0x401000",
      reviewer_model: "reviewer-a",
      contract_version: 3,
      accepted_contract_json: '{"accepted":true}',
      accepted_contract_path: ".rework/reviews/8.json",
      rejected_claims_json: "[]",
      amend_reason: null,
      created_at: "2026-05-12T10:03:00.000Z",
    });
    expect(db.query("SELECT * FROM summary_dependencies;").get()).toEqual({
      parent_ea: "0x401000",
      child_ea: "0x402000",
      child_summary_version_used: 4,
    });
    expect(db.query("SELECT * FROM source_symbols;").get()).toEqual({
      symbol_id: "symbol-a",
      kind: "function",
      name: "parse_packet",
      namespace: "net",
      origin_ea: "0x401000",
      contract_version: 3,
      definition_json: '{"file":"packet.cpp"}',
      status: "emitted",
    });
    expect(db.query("SELECT * FROM source_blocks;").get()).toEqual({
      block_id: "block-a",
      symbol_id: "symbol-a",
      file_path: "src/packet.cpp",
      block_hash: "block-hash",
      managed: 1,
      manual_override: 0,
      fidelity_mode: "pseudocode_faithful",
      updated_at: "2026-05-12T10:04:00.000Z",
    });
    expect(db.query("SELECT * FROM simplifications;").get()).toEqual({
      id: 9,
      symbol_id: "symbol-a",
      function_ea: "0x401000",
      kind: "rename",
      original_json: '{"name":"FUN_401000"}',
      replacement_json: '{"name":"parse_packet"}',
      evidence_json: "[]",
      risk: "low",
      reviewer_required: 0,
      accepted: 1,
      created_at: "2026-05-12T10:05:00.000Z",
    });
    expect(db.query("SELECT * FROM jobs;").all()).toEqual([
      {
        job_id: "job-done",
        job_type: "analyze_function_semantics",
        target: "0x401000",
        agent_role: "semantic",
        status: "done",
        input_path: ".rework/packets/job-done.json",
        output_path: ".rework/worker_outputs/job-done.json",
        attempt: 2,
        created_at: "2026-05-12T10:06:00.000Z",
        updated_at: "2026-05-12T10:07:00.000Z",
      },
    ]);
  });

  test("applies tombstones to delete existing sqlite rows", async () => {
    db.query(
      `INSERT INTO analysis_functions (ea, status, summary_version, dirty)
       VALUES ('0x401000', 'reviewed', 1, 0);`,
    ).run();
    db.query(
      `INSERT INTO jobs (job_id, job_type, target, status, attempt)
       VALUES ('job-done', 'analyze_function_semantics', '0x401000', 'done', 1);`,
    ).run();

    await store.delete("analysis_functions", "0x401000");
    await store.delete("jobs", "job-done");

    await reindex(root, db);

    expect(db.query("SELECT * FROM analysis_functions;").all()).toEqual([]);
    expect(db.query("SELECT * FROM jobs;").all()).toEqual([]);
  });
});
