import type { ToolResult } from "@opencode-ai/plugin";

export function textResult(output: string): ToolResult {
  return output;
}

export function jsonResult(data: unknown, metadata?: Record<string, any>): ToolResult {
  return {
    output: JSON.stringify(data, null, 2),
    ...(metadata ? { metadata } : undefined),
  };
}

export function errorResult(message: string, code?: string, details?: Record<string, unknown>): ToolResult {
  return {
    output: JSON.stringify({ error: { message, ...(code ? { code } : {}), ...(details ?? {}) } }),
  };
}
