import type { Plugin, ToolContext } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { ReProgress } from "../core/ReProgress.js";
import { jsonResult, errorResult } from "./result.js";
import type { FunctionStatus, EdgeKind, JobType } from "../db/types.js";

export const OpenJePlugin: Plugin = async ({ client, directory, worktree }) => {
  const root = worktree || directory || process.cwd();
  const re = await ReProgress.open({ root });

  await client.app.log({
    body: {
      service: "opencode-openje",
      level: "info",
      message: "Plugin initialized",
      extra: { root },
    },
  });

  return {
    tool: {
      re_status: tool({
        description: "Show overall status of the RE progress ledger",
        args: {},
        async execute(_args, _ctx: ToolContext) {
          const counts = {
            functions: re.functions.listAll().then((r) => r.length),
            edges: re.edges.listAll().then((r) => r.length),
            jobs: 0,
            worker_runs: 0,
            reviews: 0,
            stale: re.stale.list().then((r) => r.length),
            source_symbols: re.sourceSymbols.list({}).then((r) => r.length),
            source_blocks: 0,
          };
          return jsonResult({
            functions: await counts.functions,
            edges: await counts.edges,
            jobs: await counts.jobs,
            worker_runs: await counts.worker_runs,
            reviews: await counts.reviews,
            stale: await counts.stale,
            source_symbols: await counts.source_symbols,
            source_blocks: await counts.source_blocks,
          });
        },
      }),

      re_function_register: tool({
        description: "Register a function in the ledger",
        args: {
          ea: tool.schema.string().describe("Function effective address"),
          status: tool.schema.enum(["unknown", "discovered", "queued", "waiting_on_children", "ready_for_local_analysis", "analyzing", "worker_done", "review_pending", "reviewed", "failed", "skipped", "cycle_member", "stale"]).describe("Function status").optional(),
          last_pseudocode_hash: tool.schema.string().describe("Hash of pseudocode").optional(),
        },
        async execute(args, _ctx: ToolContext) {
          await re.functions.register({
            ea: args.ea,
            status: args.status as FunctionStatus | undefined,
            lastPseudocodeHash: args.last_pseudocode_hash,
          });
          return jsonResult({ registered: args.ea });
        },
      }),

      re_function_get: tool({
        description: "Get a function by EA",
        args: {
          ea: tool.schema.string().describe("Function effective address"),
        },
        async execute(args, _ctx: ToolContext) {
          const fn = await re.functions.get(args.ea);
          if (!fn) {
            return errorResult(`Function ${args.ea} not found`, "NOT_FOUND");
          }
          return jsonResult(fn);
        },
      }),

      re_function_set_status: tool({
        description: "Set function status",
        args: {
          ea: tool.schema.string().describe("Function effective address"),
          status: tool.schema.enum(["unknown", "discovered", "queued", "waiting_on_children", "ready_for_local_analysis", "analyzing", "worker_done", "review_pending", "reviewed", "failed", "skipped", "cycle_member", "stale"]).describe("New status"),
        },
        async execute(args, _ctx: ToolContext) {
          await re.functions.setStatus(args.ea, args.status as FunctionStatus);
          return jsonResult({ updated: args.ea, status: args.status });
        },
      }),

      re_function_list: tool({
        description: "List functions by status",
        args: {
          status: tool.schema.enum(["unknown", "discovered", "queued", "waiting_on_children", "ready_for_local_analysis", "analyzing", "worker_done", "review_pending", "reviewed", "failed", "skipped", "cycle_member", "stale"]).describe("Filter by status").optional(),
        },
        async execute(args, _ctx: ToolContext) {
          const list = args.status
            ? await re.functions.listByStatus(args.status as FunctionStatus)
            : await re.functions.listAll();
          return jsonResult({ count: list.length, functions: list });
        },
      }),

      re_edge_add: tool({
        description: "Add an edge between functions",
        args: {
          caller: tool.schema.string().describe("Caller EA"),
          callee: tool.schema.string().describe("Callee EA"),
          kind: tool.schema.enum(["direct_call", "indirect_call", "virtual_call", "import_call", "thunk", "tail_call", "callback_candidate", "unresolved"]).describe("Edge kind"),
          blocking: tool.schema.boolean().describe("Whether blocking").optional(),
          reason: tool.schema.string().describe("Reason").optional(),
        },
        async execute(args, _ctx: ToolContext) {
          await re.edges.add({
            caller: args.caller,
            callee: args.callee,
            kind: args.kind as EdgeKind,
            blocking: args.blocking ?? true,
            reason: args.reason,
          });
          return jsonResult({ added: `${args.caller} -> ${args.callee}` });
        },
      }),

      re_job_create: tool({
        description: "Create a job",
        args: {
          job_type: tool.schema.enum(["discover_subgraph", "classify_edges", "analyze_function_semantics", "analyze_function_types", "analyze_function_names", "review_function_contract", "analyze_scc_cluster", "emit_faithful_cpp", "review_cpp_fidelity", "fix_compile_error", "apply_ida_patch_plan"]).describe("Job type"),
          target: tool.schema.string().describe("Target EA"),
          role: tool.schema.string().describe("Agent role").optional(),
          input_path: tool.schema.string().describe("Input path").optional(),
        },
        async execute(args, _ctx: ToolContext) {
          const job = await re.jobs.create({
            jobType: args.job_type as JobType,
            target: args.target,
            agentRole: args.role,
            inputPath: args.input_path,
          });
          return jsonResult(job);
        },
      }),

      re_job_next: tool({
        description: "Claim next available job",
        args: {
          role: tool.schema.string().describe("Agent role filter").optional(),
        },
        async execute(args, _ctx: ToolContext) {
          const job = await re.jobs.next(args.role ? { role: args.role } : undefined);
          if (!job) return jsonResult(null);
          return jsonResult(job);
        },
      }),

      re_worker_submit: tool({
        description: "Submit worker run output",
        args: {
          function_ea: tool.schema.string().describe("Function EA"),
          role: tool.schema.string().describe("Worker role"),
          model: tool.schema.string().describe("Model name"),
          output: tool.schema.string().describe('Worker analysis as JSON. Required: {"purpose":{"summary":"...","confidence":0.85,"evidence":["..."]}}. Optional: inputs[], return_value, side_effects[], uncertainties[]'),
          job_id: tool.schema.string().describe("Job ID").optional(),
        },
        async execute(args, _ctx: ToolContext) {
          const id = await re.workers.submit({
            jobId: args.job_id,
            functionEa: args.function_ea,
            role: args.role,
            model: args.model,
            output: JSON.parse(args.output),
          });
          return jsonResult({ id });
        },
      }),

      re_review_submit: tool({
        description: "Submit a review contract",
        args: {
          function_ea: tool.schema.string().describe("Function EA"),
          reviewer_model: tool.schema.string().describe("Reviewer model"),
          contract: tool.schema.string().describe('Accepted contract as JSON. Required: {"accepted_name":"...","kind":"function","purpose":"...","confidence":0.9}. Kind: function|method|constructor|destructor|thunk|unknown. Optional: accepted_prototype, owner, return_value, accepted_variable_names, dependencies_used, rejected_claims'),
          rejected_claims: tool.schema.string().describe("Rejected claims as JSON string array").optional(),
        },
        async execute(args, _ctx: ToolContext) {
          await re.reviews.submit({
            functionEa: args.function_ea,
            reviewerModel: args.reviewer_model,
            acceptedContract: JSON.parse(args.contract),
            rejectedClaims: args.rejected_claims ? JSON.parse(args.rejected_claims) : undefined,
          });
          return jsonResult({ reviewed: args.function_ea });
        },
      }),

      re_stale_mark_parents: tool({
        description: "Mark parents stale when child changes",
        args: {
          child_ea: tool.schema.string().describe("Child function EA"),
        },
        async execute(args, _ctx: ToolContext) {
          const parents = await re.stale.markParentsStale(args.child_ea);
          return jsonResult({ marked: parents });
        },
      }),

      re_stale_list: tool({
        description: "List all stale functions",
        args: {},
        async execute(_args, _ctx: ToolContext) {
          const list = await re.stale.list();
          return jsonResult({ count: list.length, functions: list });
        },
      }),

      re_tree: tool({
        description: "Get status tree from root",
        args: {
          root_ea: tool.schema.string().describe("Root function EA"),
        },
        async execute(args, _ctx: ToolContext) {
          const tree = await re.tree.statusTree(args.root_ea);
          return jsonResult(tree);
        },
      }),
    },
  };
};
