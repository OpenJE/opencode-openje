import { describe, expect, it } from "bun:test";

import {
  ERROR_CODES,
  ReProgressError,
  formatError,
  formatSuccess,
} from "./errors.js";

const expectedCodes = [
  "DB_ERROR",
  "NOT_FOUND",
  "INVALID_STATUS",
  "INVALID_JOB_STATE",
  "INVALID_WORKER_OUTPUT",
  "INVALID_CONTRACT",
  "STALE_DEPENDENCY",
  "MANUAL_OVERRIDE",
  "UNKNOWN_TABLE",
  "UNKNOWN_EDGE_KIND",
  "UNKNOWN_JOB_TYPE",
] as const;

describe("ReProgressError", () => {
  it("exposes the complete error code list", () => {
    expect(ERROR_CODES).toEqual(expectedCodes);
  });

  it("formats an error with default details", () => {
    const error = new ReProgressError("NOT_FOUND", "Function not found");

    expect(formatError(error)).toEqual({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Function not found",
        details: {},
      },
    });
  });

  it("formats all error codes and preserves details", () => {
    for (const code of expectedCodes) {
      expect(formatError(new ReProgressError(code, "message", { id: code }))).toEqual({
        ok: false,
        error: {
          code,
          message: "message",
          details: { id: code },
        },
      });
    }
  });

  it("formats successful data", () => {
    expect(formatSuccess({ id: 1 })).toEqual({ ok: true, data: { id: 1 } });
  });
});
