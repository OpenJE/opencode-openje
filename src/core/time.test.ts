import { describe, expect, it } from "bun:test";

import { nowISO } from "./time.js";

describe("nowISO", () => {
  it("returns a parseable ISO-8601 timestamp", () => {
    const timestamp = nowISO();

    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(timestamp))).toBe(false);
  });
});
