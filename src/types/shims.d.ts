declare module "@opencode-ai/plugin" {
  export interface PluginContext {
    client: {
      app: {
        log: (opts: { body: { service: string; level: string; message: string; extra?: Record<string, unknown> } }) => Promise<void>;
      };
    };
    directory: string;
    worktree?: string;
  }

  export type Plugin = (ctx: PluginContext) => Promise<{
    tool?: Record<string, unknown>;
    "tool.execute.before"?: (input: unknown, output: unknown) => Promise<void>;
    "tool.execute.after"?: (input: unknown, output: unknown) => Promise<void>;
  }>;

  export const tool: <TArgs extends Record<string, unknown>>(opts: {
    description: string;
    args: TArgs;
    execute: (args: TArgs, context: PluginContext) => Promise<unknown>;
  }) => unknown;
}
