import type { Plugin } from "@opencode-ai/plugin";
import { ReProgress } from "../core/ReProgress.js";
import { formatError, formatSuccess } from "../core/format.js";
import { ReProgressError } from "../core/errors.js";

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
      re_status: {
        description: "Show overall status of the RE progress ledger",
        args: {},
        async execute() {
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
          return formatSuccess({
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
      },

      re_function_register: {
        description: "Register a function in the ledger",
        args: {
          ea: { type: "string", description: "Function effective address" },
          status: { type: "string", description: "Function status", optional: true },
          last_pseudocode_hash: { type: "string", description: "Hash of pseudocode", optional: true },
        },
        async execute(args: any) {
          await re.functions.register({
            ea: args.ea,
            status: args.status,
            lastPseudocodeHash: args.last_pseudocode_hash,
          });
          return formatSuccess({ registered: args.ea });
        },
      },

      re_function_get: {
        description: "Get a function by EA",
        args: {
          ea: { type: "string", description: "Function effective address" },
        },
        async execute(args: any) {
          const fn = await re.functions.get(args.ea);
          if (!fn) throw new ReProgressError("NOT_FOUND", `Function ${args.ea} not found`);
          return formatSuccess(fn);
        },
      },

      re_function_set_status: {
        description: "Set function status",
        args: {
          ea: { type: "string", description: "Function effective address" },
          status: { type: "string", description: "New status" },
        },
        async execute(args: any) {
          await re.functions.setStatus(args.ea, args.status);
          return formatSuccess({ updated: args.ea, status: args.status });
        },
      },

      re_function_list: {
        description: "List functions by status",
        args: {
          status: { type: "string", description: "Filter by status", optional: true },
        },
        async execute(args: any) {
          const list = args.status
            ? await re.functions.listByStatus(args.status)
            : await re.functions.listAll();
          return formatSuccess({ count: list.length, functions: list });
        },
      },

      re_edge_add: {
        description: "Add an edge between functions",
        args: {
          caller: { type: "string", description: "Caller EA" },
          callee: { type: "string", description: "Callee EA" },
          kind: { type: "string", description: "Edge kind" },
          blocking: { type: "boolean", description: "Whether blocking", optional: true },
          reason: { type: "string", description: "Reason", optional: true },
        },
        async execute(args: any) {
          await re.edges.add({
            caller: args.caller,
            callee: args.callee,
            kind: args.kind,
            blocking: args.blocking ?? true,
            reason: args.reason,
          });
          return formatSuccess({ added: `${args.caller} -> ${args.callee}` });
        },
      },

      re_job_create: {
        description: "Create a job",
        args: {
          job_type: { type: "string", description: "Job type" },
          target: { type: "string", description: "Target EA" },
          role: { type: "string", description: "Agent role", optional: true },
          input_path: { type: "string", description: "Input path", optional: true },
        },
        async execute(args: any) {
          const job = await re.jobs.create({
            jobType: args.job_type,
            target: args.target,
            agentRole: args.role,
            inputPath: args.input_path,
          });
          return formatSuccess(job);
        },
      },

      re_job_next: {
        description: "Claim next available job",
        args: {
          role: { type: "string", description: "Agent role filter", optional: true },
        },
        async execute(args: any) {
          const job = await re.jobs.next(args.role ? { role: args.role } : undefined);
          if (!job) return formatSuccess(null);
          return formatSuccess(job);
        },
      },

      re_worker_submit: {
        description: "Submit worker run output",
        args: {
          function_ea: { type: "string", description: "Function EA" },
          role: { type: "string", description: "Worker role" },
          model: { type: "string", description: "Model name" },
          output: { type: "object", description: "Worker output JSON" },
          job_id: { type: "string", description: "Job ID", optional: true },
        },
        async execute(args: any) {
          const id = await re.workers.submit({
            jobId: args.job_id,
            functionEa: args.function_ea,
            role: args.role,
            model: args.model,
            output: args.output,
          });
          return formatSuccess({ id });
        },
      },

      re_review_submit: {
        description: "Submit a review contract",
        args: {
          function_ea: { type: "string", description: "Function EA" },
          reviewer_model: { type: "string", description: "Reviewer model" },
          contract: { type: "object", description: "Accepted contract JSON" },
          rejected_claims: { type: "array", description: "Rejected claims", optional: true },
        },
        async execute(args: any) {
          await re.reviews.submit({
            functionEa: args.function_ea,
            reviewerModel: args.reviewer_model,
            acceptedContract: args.contract,
            rejectedClaims: args.rejected_claims,
          });
          return formatSuccess({ reviewed: args.function_ea });
        },
      },

      re_stale_mark_parents: {
        description: "Mark parents stale when child changes",
        args: {
          child_ea: { type: "string", description: "Child function EA" },
        },
        async execute(args: any) {
          const parents = await re.stale.markParentsStale(args.child_ea);
          return formatSuccess({ marked: parents });
        },
      },

      re_stale_list: {
        description: "List all stale functions",
        args: {},
        async execute() {
          const list = await re.stale.list();
          return formatSuccess({ count: list.length, functions: list });
        },
      },

      re_tree: {
        description: "Get status tree from root",
        args: {
          root_ea: { type: "string", description: "Root function EA" },
        },
        async execute(args: any) {
          const tree = await re.tree.statusTree(args.root_ea);
          return formatSuccess(tree);
        },
      },
    },
  };
};
