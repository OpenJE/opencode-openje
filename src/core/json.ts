import { ReProgressError } from "./errors.js";

export function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new ReProgressError("INVALID_WORKER_OUTPUT", "Invalid JSON", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function safeStringify(value: unknown): string {
  try {
    const json = JSON.stringify(value);

    if (typeof json !== "string") {
      throw new TypeError("Value is not JSON serializable");
    }

    return json;
  } catch (error) {
    throw new ReProgressError("INVALID_WORKER_OUTPUT", "Unable to stringify JSON", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
