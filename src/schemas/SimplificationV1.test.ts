import { describe, expect, it } from "bun:test";
import { ZodError } from "zod";

import { SimplificationV1 } from "./SimplificationV1.js";

describe("SimplificationV1", () => {
  it("parses a minimal simplification record", () => {
    expect(SimplificationV1.parse({ kind: "loop_to_algorithm" })).toEqual({
      kind: "loop_to_algorithm",
    });
  });

  it("accepts optional unknown payloads and review flags", () => {
    const parsed = SimplificationV1.parse({
      kind: "constant_fold",
      original: { expr: "2 + 2" },
      replacement: 4,
      evidence: ["compiler output"],
      risk: "low",
      reviewer_required: true,
      accepted: false,
    });

    expect(parsed.original).toEqual({ expr: "2 + 2" });
    expect(parsed.accepted).toBe(false);
  });

  it("rejects records without kind", () => {
    expect(() => SimplificationV1.parse({ accepted: true })).toThrow(ZodError);
  });
});
