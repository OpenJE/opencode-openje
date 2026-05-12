export const ERROR_CODES = [
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

export type ReProgressErrorCode = typeof ERROR_CODES[number];
export type ReProgressErrorDetails = Record<string, unknown>;

export class ReProgressError extends Error {
  readonly code: ReProgressErrorCode;
  readonly details: ReProgressErrorDetails;

  constructor(code: ReProgressErrorCode, message: string, details: ReProgressErrorDetails = {}) {
    super(message);
    this.name = "ReProgressError";
    this.code = code;
    this.details = details;
  }
}

export type ErrorResult = {
  ok: false;
  error: {
    code: ReProgressErrorCode;
    message: string;
    details: ReProgressErrorDetails;
  };
};

export type SuccessResult<T> = {
  ok: true;
  data: T;
};

export function formatError(error: ReProgressError): ErrorResult {
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  };
}

export function formatSuccess<T>(data: T): SuccessResult<T> {
  return { ok: true, data };
}
