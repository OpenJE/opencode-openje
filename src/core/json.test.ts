import { describe, expect, it } from "bun:test";

import { ReProgressError } from "./errors.js";
import { safeParse, safeStringify } from "./json.js";

describe("JSON helpers", () => {
  it("parses valid JSON", () => {
    expect(safeParse('{"ok":true}')).toEqual({ ok: true });
  });

  it("wraps invalid JSON parse errors", () => {
    expect(() => safeParse("{"))
      .toThrow(ReProgressError);

    try {
      safeParse("{");
    } catch (error) {
      expect(error).toBeInstanceOf(ReProgressError);
      expect((error as ReProgressError).code).toBe("INVALID_WORKER_OUTPUT");
    }
  });

  it("stringifies serializable values", () => {
    expect(safeStringify({ ok: true })).toBe('{"ok":true}');
  });

  it("wraps stringify errors", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    try {
      safeStringify(circular);
    } catch (error) {
      expect(error).toBeInstanceOf(ReProgressError);
      expect((error as ReProgressError).code).toBe("INVALID_WORKER_OUTPUT");
      return;
    }

    throw new Error("safeStringify should have thrown");
  });
});
