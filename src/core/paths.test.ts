import { describe, expect, it } from "bun:test";

import {
  getArtifactsDir,
  getPacketsDir,
  getPatchPlansDir,
  getReviewsDir,
  getSourceMapDir,
  getSummariesDir,
  getTraversalLogsDir,
  getWorkerOutputsDir,
  getWorkdirRoot,
  getWorkdirSubdir,
} from "./paths.js";

describe("path helpers", () => {
  const root = "/tmp/agentic-re";

  it("builds the .rework root path", () => {
    expect(getWorkdirRoot(root)).toBe("/tmp/agentic-re/.rework");
  });

  it("builds artifact directory paths", () => {
    expect(getPacketsDir(root)).toBe("/tmp/agentic-re/.rework/packets");
    expect(getWorkerOutputsDir(root)).toBe("/tmp/agentic-re/.rework/worker_outputs");
    expect(getReviewsDir(root)).toBe("/tmp/agentic-re/.rework/reviews");
    expect(getSummariesDir(root)).toBe("/tmp/agentic-re/.rework/summaries");
    expect(getTraversalLogsDir(root)).toBe("/tmp/agentic-re/.rework/traversal_logs");
    expect(getSourceMapDir(root)).toBe("/tmp/agentic-re/.rework/source_map");
    expect(getPatchPlansDir(root)).toBe("/tmp/agentic-re/.rework/patch_plans");
    expect(getArtifactsDir(root)).toBe("/tmp/agentic-re/.rework/artifacts");
  });

  it("builds a typed subdirectory path", () => {
    expect(getWorkdirSubdir(root, "reviews")).toBe("/tmp/agentic-re/.rework/reviews");
  });
});
