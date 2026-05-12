import { describe, expect, it } from "bun:test";
import { ZodError } from "zod";

import { CppEmissionV1 } from "./CppEmissionV1.js";

describe("CppEmissionV1", () => {
  it.each([
    "pseudocode_faithful",
    "pseudocode_faithful_with_recognized_simplifications",
    "manual_override",
  ] as const)("parses fidelity mode %s", (fidelity_mode) => {
    const parsed = CppEmissionV1.parse({
      symbol_id: "symbol-1",
      function_ea: "0x140012340",
      contract_version: 0,
      file_path: "src/generated.cpp",
      block_id: "block-1",
      fidelity_mode,
    });

    expect(parsed.fidelity_mode).toBe(fidelity_mode);
    expect(parsed.simplifications).toEqual([]);
    expect(parsed.known_deviations).toEqual([]);
  });

  it("rejects missing required fields and invalid versions", () => {
    expect(() => CppEmissionV1.parse({})).toThrow(ZodError);
    expect(() =>
      CppEmissionV1.parse({
        symbol_id: "symbol-1",
        contract_version: -1,
        file_path: "src/generated.cpp",
        block_id: "block-1",
        fidelity_mode: "pseudocode_faithful",
      }),
    ).toThrow(ZodError);
  });
});
