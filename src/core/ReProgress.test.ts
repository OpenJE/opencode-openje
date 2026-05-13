import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REWORK_DB_FILE, REWORK_DIR } from "../db/connection.js";
import { ReProgress } from "./ReProgress.js";

const validAnalysis = {
  purpose: {
    summary: "Parses a packet after checking child results.",
    confidence: 0.8,
    evidence: ["calls child parser"],
  },
  inputs: [],
  side_effects: [],
  uncertainties: [],
};

describe("ReProgress persistence integration", () => {
  let root: string;
  let reprogress: ReProgress | null;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "reprogress-e2e-"));
    reprogress = null;
  });

  afterEach(async () => {
    reprogress?.close();
    await rm(root, { recursive: true, force: true });
  });

  test("persists JSON records and reindexes them across fresh database opens", async () => {
    reprogress = await ReProgress.open({ root });

    await reprogress.functions.register({ ea: "0x401000", status: "discovered", lastPseudocodeHash: "hash-a" });
    await reprogress.functions.register({ ea: "0x402000", status: "queued", lastPseudocodeHash: "hash-b" });
    await reprogress.edges.add({
      caller: "0x401000",
      callee: "0x402000",
      kind: "direct_call",
      reason: "calls child parser",
    });
    const workerRunId = await reprogress.workers.submit({
      jobId: "job-1",
      functionEa: "0x401000",
      role: "semantic-analysis",
      model: "test-model",
      inputHash: "input-hash-a",
      output: validAnalysis,
    });

    expect(await pathExists(join(root, REWORK_DIR, "functions", "0x401000.json"))).toBe(true);
    expect(await pathExists(join(root, REWORK_DIR, "edges", "0x401000__0x402000.json"))).toBe(true);

    reprogress.close();
    reprogress = null;
    await removeDatabaseFiles(root);

    reprogress = await ReProgress.open({ root });

    expect(await reprogress.functions.get("0x401000")).toMatchObject({
      ea: "0x401000",
      status: "discovered",
      last_pseudocode_hash: "hash-a",
    });
    expect(await reprogress.edges.children("0x401000")).toEqual([
      expect.objectContaining({
        caller_ea: "0x401000",
        callee_ea: "0x402000",
        edge_kind: "direct_call",
        reason: "calls child parser",
      }),
    ]);
    expect(await reprogress.workers.get(workerRunId)).toMatchObject({
      id: workerRunId,
      function_ea: "0x401000",
      role: "semantic-analysis",
      model: "test-model",
    });

    await reprogress.edges.remove("0x401000", "0x402000");
    reprogress.close();
    reprogress = null;
    await removeDatabaseFiles(root);

    reprogress = await ReProgress.open({ root });

    expect(await reprogress.edges.children("0x401000")).toEqual([]);
  });
});

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function removeDatabaseFiles(root: string): Promise<void> {
  const dbPath = join(root, REWORK_DIR, REWORK_DB_FILE);
  await rm(dbPath, { force: true });
  await rm(`${dbPath}-shm`, { force: true });
  await rm(`${dbPath}-wal`, { force: true });
}
