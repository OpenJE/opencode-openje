import { describe, expect, it } from "bun:test";
import { ZodError } from "zod";

import { FunctionAnalysisV1 } from "./FunctionAnalysisV1.js";

describe("FunctionAnalysisV1", () => {
  it("parses a valid worker hypothesis and applies array defaults", () => {
    const parsed = FunctionAnalysisV1.parse({
      purpose: {
        summary: "Initializes the renderer",
        confidence: 0.82,
        evidence: ["calls init_device"],
      },
    });

    expect(parsed.inputs).toEqual([]);
    expect(parsed.side_effects).toEqual([]);
    expect(parsed.uncertainties).toEqual([]);
  });

  it("accepts optional input and return value details", () => {
    const parsed = FunctionAnalysisV1.parse({
      purpose: {
        summary: "Formats a string",
        confidence: 1,
        evidence: [],
      },
      inputs: [
        {
          original: "a1",
          proposed_name: "buffer",
          type: "char *",
          confidence: 0,
          evidence: ["passed to snprintf"],
        },
      ],
      return_value: {
        type: "int",
        meaning: "number of bytes written",
        confidence: 0.75,
        evidence: ["compared against zero"],
      },
    });

    expect(parsed.inputs[0]?.proposed_name).toBe("buffer");
    expect(parsed.return_value?.meaning).toBe("number of bytes written");
  });

  it("rejects missing required fields and out-of-range confidence", () => {
    expect(() => FunctionAnalysisV1.parse({})).toThrow(ZodError);
    expect(() =>
      FunctionAnalysisV1.parse({
        purpose: {
          summary: "Too certain",
          confidence: 1.1,
          evidence: [],
        },
      }),
    ).toThrow(ZodError);
  });

  it("accepts minimal valid payload with just purpose", () => {
    const parsed = FunctionAnalysisV1.parse({
      purpose: {
        summary: "Test function",
        confidence: 0.5,
        evidence: [],
      },
    });

    expect(parsed.purpose.summary).toBe("Test function");
  });
});
