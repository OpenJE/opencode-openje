import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactsModule } from "./artifacts.js";

describe("ArtifactsModule", () => {
  let root: string;
  let mod: ArtifactsModule;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "agentic-re-artifacts-"));
    mod = new ArtifactsModule(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("artifactPath computes the path under .rework without writing", () => {
    const path = mod.artifactPath("worker_outputs", "analysis.json");

    expect(path).toBe(join(root, ".rework", "worker_outputs", "analysis.json"));
  });

  test("writeArtifact writes JSON and returns the artifact path", async () => {
    const data = { functionEa: "0x140012340", notes: ["one", "two"], confidence: 0.9 };

    const path = await mod.writeArtifact("worker_outputs", "analysis.json", data);

    expect(path).toBe(mod.artifactPath("worker_outputs", "analysis.json"));
    expect(await mod.readArtifact("worker_outputs", "analysis.json")).toEqual(data);
  });

  test("writeArtifact creates nested artifact directories", async () => {
    const data = [{ id: 1 }, { id: 2 }];

    const path = await mod.writeArtifact("reviews/pending", "batch.json", data);

    expect(path).toBe(join(root, ".rework", "reviews", "pending", "batch.json"));
    expect(await mod.readArtifact("reviews/pending", "batch.json")).toEqual(data);
  });
});
