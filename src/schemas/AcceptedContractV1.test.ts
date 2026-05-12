import { describe, expect, it } from "bun:test";
import { ZodError } from "zod";

import { AcceptedContractV1 } from "./AcceptedContractV1.js";

describe("AcceptedContractV1", () => {
  it("parses a valid reviewer contract and applies defaults", () => {
    const parsed = AcceptedContractV1.parse({
      function_ea: "0x140012340",
      accepted_name: "initialize_renderer",
      kind: "function",
      purpose: "Initializes renderer state",
      confidence: 0.9,
    });

    expect(parsed.accepted_variable_names).toEqual({});
    expect(parsed.dependencies_used).toEqual([]);
    expect(parsed.rejected_claims).toEqual([]);
  });

  it("accepts optional canonical contract details", () => {
    const parsed = AcceptedContractV1.parse({
      function_ea: "0x140012340",
      contract_version: 2,
      accepted_name: "Widget::Widget",
      accepted_prototype: "Widget::Widget(int size)",
      kind: "constructor",
      owner: "Widget",
      purpose: "Constructs a widget",
      return_value: { type: "void", meaning: "constructor" },
      accepted_variable_names: { a1: "size" },
      dependencies_used: [{ ea: "0x140010000", summary_version: 0 }],
      rejected_claims: [{ claim: "opens a file", reason: "no file API calls" }],
      confidence: 1,
    });

    expect(parsed.kind).toBe("constructor");
    expect(parsed.dependencies_used[0]?.summary_version).toBe(0);
  });

  it("rejects invalid confidence, enum values, and negative versions", () => {
    expect(() =>
      AcceptedContractV1.parse({
        function_ea: "0x140012340",
        accepted_name: "bad",
        kind: "procedure",
        purpose: "Invalid kind",
        confidence: 0.5,
      }),
    ).toThrow(ZodError);

    expect(() =>
      AcceptedContractV1.parse({
        function_ea: "0x140012340",
        contract_version: -1,
        accepted_name: "bad",
        kind: "function",
        purpose: "Invalid version",
        confidence: 1.1,
      }),
    ).toThrow(ZodError);
  });
});
