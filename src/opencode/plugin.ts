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

      re_function_unregister: tool({
        description: "Unregister a function from the ledger",
        args: {
          ea: tool.schema.string().describe("Function effective address"),
          reason: tool.schema.string().describe("Reason for unregistering"),
        },
        async execute(args, _ctx: ToolContext) {
          try {
            await re.functions.unregister(args.ea, args.reason);
            return jsonResult({ unregistered: args.ea, reason: args.reason });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("not found")) {
              return errorResult(msg, "NOT_FOUND");
            }
            if (msg.includes("Cannot unregister")) {
              return errorResult(msg, "DEPENDENCY_ERROR");
            }
            throw err;
          }
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

      re_edge_remove: tool({
        description: "Remove an edge between functions",
        args: {
          caller: tool.schema.string().describe("Caller EA"),
          callee: tool.schema.string().describe("Callee EA"),
          reason: tool.schema.string().describe("Reason for removal"),
        },
        async execute(args, _ctx: ToolContext) {
          try {
            await re.edges.remove(args.caller, args.callee);
            return jsonResult({ removed: `${args.caller} -> ${args.callee}` });
          } catch (err) {
            return errorResult((err as Error).message, "NOT_FOUND");
          }
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

      re_job_cancel: tool({
        description: "Cancel a job",
        args: {
          job_id: tool.schema.string().describe("Job ID to cancel"),
          reason: tool.schema.string().describe("Reason for cancellation"),
        },
        async execute(args, _ctx: ToolContext) {
          try {
            await re.jobs.cancel(args.job_id);
            return jsonResult({ cancelled: args.job_id });
          } catch (err) {
            return errorResult(`Job ${args.job_id} not found`, "NOT_FOUND");
          }
        },
      }),

      re_worker_submit: tool({
        description: "Submit a worker run with structured analysis output",
        args: {
          function_ea: tool.schema.string().describe("Function EA"),
          role: tool.schema.string().describe("Worker role"),
          model: tool.schema.string().describe("Model name"),
          output: tool.schema.object({
            purpose: tool.schema.object({
              summary: tool.schema.string().describe("What this function does"),
              confidence: tool.schema.number().min(0).max(1).describe("Confidence 0-1"),
              evidence: tool.schema.array(tool.schema.string()).describe("Supporting evidence"),
            }).describe("Function purpose"),
            inputs: tool.schema.array(tool.schema.object({
              original: tool.schema.string().describe("Original parameter name"),
              proposed_name: tool.schema.string().optional().describe("Suggested parameter name"),
              type: tool.schema.string().optional().describe("Parameter type"),
              confidence: tool.schema.number().min(0).max(1).optional().describe("Confidence 0-1"),
              evidence: tool.schema.array(tool.schema.string()).optional().describe("Supporting evidence"),
            })).default([]).describe("Function inputs"),
            return_value: tool.schema.object({
              type: tool.schema.string().optional().describe("Return type"),
              meaning: tool.schema.string().optional().describe("Return value meaning"),
              confidence: tool.schema.number().min(0).max(1).optional().describe("Confidence 0-1"),
              evidence: tool.schema.array(tool.schema.string()).optional().describe("Supporting evidence"),
            }).optional().describe("Return value analysis"),
            side_effects: tool.schema.array(tool.schema.unknown()).default([]).describe("Side effects"),
            uncertainties: tool.schema.array(tool.schema.string()).default([]).describe("Uncertainties"),
          }).describe("Worker analysis output"),
          job_id: tool.schema.string().describe("Job ID").optional(),
        },
        async execute(args, _ctx: ToolContext) {
          const id = await re.workers.submit({
            jobId: args.job_id,
            functionEa: args.function_ea,
            role: args.role,
            model: args.model,
            output: args.output,
          });
          return jsonResult({ id });
        },
      }),

      re_worker_run_update: tool({
        description: "Update a worker run with new analysis output",
        args: {
          id: tool.schema.number().describe("Worker run ID"),
          output: tool.schema.object({
            purpose: tool.schema.object({
              summary: tool.schema.string().describe("What this function does"),
              confidence: tool.schema.number().min(0).max(1).describe("Confidence 0-1"),
              evidence: tool.schema.array(tool.schema.string()).describe("Supporting evidence"),
            }).describe("Function purpose"),
            inputs: tool.schema.array(tool.schema.object({
              original: tool.schema.string().describe("Original parameter name"),
              proposed_name: tool.schema.string().optional().describe("Suggested parameter name"),
              type: tool.schema.string().optional().describe("Parameter type"),
              confidence: tool.schema.number().min(0).max(1).optional().describe("Confidence 0-1"),
              evidence: tool.schema.array(tool.schema.string()).optional().describe("Supporting evidence"),
            })).default([]).describe("Function inputs"),
            return_value: tool.schema.object({
              type: tool.schema.string().optional().describe("Return type"),
              meaning: tool.schema.string().optional().describe("Return value meaning"),
              confidence: tool.schema.number().min(0).max(1).optional().describe("Confidence 0-1"),
              evidence: tool.schema.array(tool.schema.string()).optional().describe("Supporting evidence"),
            }).optional().describe("Return value analysis"),
            side_effects: tool.schema.array(tool.schema.unknown()).default([]).describe("Side effects"),
            uncertainties: tool.schema.array(tool.schema.string()).default([]).describe("Uncertainties"),
          }).describe("Worker analysis output"),
          reason: tool.schema.string().describe("Reason for the update"),
        },
        async execute(args, _ctx: ToolContext) {
          try {
            const existing = await re.workers.get(args.id);
            if (existing === null) {
              return errorResult(`Worker run ${args.id} not found`, "NOT_FOUND");
            }
            await re.workers.update(args.id, args.output);
            const functionEa = existing.function_ea;
            const latestReview = await re.reviews.latest(functionEa);
            if (latestReview !== null) {
              return jsonResult({
                updated: args.id,
                reason: args.reason,
                warning: `Function ${functionEa} has reviews — consider re-reviewing after this update`,
              });
            }
            return jsonResult({ updated: args.id, reason: args.reason });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return errorResult(message, "VALIDATION_ERROR");
          }
        },
      }),

      re_review_submit: tool({
        description: "Submit a review contract with structured fields",
        args: {
          function_ea: tool.schema.string().describe("Function EA"),
          reviewer_model: tool.schema.string().describe("Reviewer model"),
          contract: tool.schema.object({
            contract_version: tool.schema.number().int().nonnegative().optional().describe("Contract version"),
            accepted_name: tool.schema.string().describe("Accepted function name"),
            accepted_prototype: tool.schema.string().optional().describe("Function prototype/signature"),
            kind: tool.schema.enum(["function", "method", "constructor", "destructor", "thunk", "unknown"]).describe("Function kind"),
            owner: tool.schema.string().optional().describe("Class/struct owner"),
            purpose: tool.schema.string().describe("Function purpose description"),
            return_value: tool.schema.object({
              type: tool.schema.string().optional().describe("Return type"),
              meaning: tool.schema.string().optional().describe("Return value meaning"),
            }).optional().describe("Return value"),
            accepted_variable_names: tool.schema.record(tool.schema.string(), tool.schema.string()).default({}).describe("Variable name mappings"),
            dependencies_used: tool.schema.array(tool.schema.object({
              ea: tool.schema.string().describe("Dependency EA"),
              summary_version: tool.schema.number().int().nonnegative().describe("Summary version used"),
            })).default([]).describe("Dependencies used"),
            confidence: tool.schema.number().min(0).max(1).describe("Confidence 0-1"),
          }).describe("Accepted review contract (function_ea is auto-filled from top-level parameter)"),
          rejected_claims: tool.schema.array(tool.schema.object({
            claim: tool.schema.string().describe("Claim description"),
            reason: tool.schema.string().describe("Reason for rejection"),
          })).describe("Rejected claims").optional(),
        },
        async execute(args, _ctx: ToolContext) {
          const result = await re.reviews.submit({
            functionEa: args.function_ea,
            reviewerModel: args.reviewer_model,
            acceptedContract: { ...args.contract, function_ea: args.function_ea },
            rejectedClaims: args.rejected_claims,
          });
          return jsonResult({ reviewed: args.function_ea, review_id: result.id });
        },
      }),

      re_review_amend: tool({
        description: "Amend an existing review contract",
        args: {
          review_id: tool.schema.number().int().nonnegative().describe("Review ID to amend"),
          contract: tool.schema.object({
            contract_version: tool.schema.number().int().nonnegative().optional().describe("Contract version"),
            accepted_name: tool.schema.string().describe("Accepted function name"),
            accepted_prototype: tool.schema.string().optional().describe("Function prototype/signature"),
            kind: tool.schema.enum(["function", "method", "constructor", "destructor", "thunk", "unknown"]).describe("Function kind"),
            owner: tool.schema.string().optional().describe("Class/struct owner"),
            purpose: tool.schema.string().describe("Function purpose description"),
            return_value: tool.schema.object({
              type: tool.schema.string().optional().describe("Return type"),
              meaning: tool.schema.string().optional().describe("Return value meaning"),
            }).optional().describe("Return value"),
            accepted_variable_names: tool.schema.record(tool.schema.string(), tool.schema.string()).default({}).describe("Variable name mappings"),
            dependencies_used: tool.schema.array(tool.schema.object({
              ea: tool.schema.string().describe("Dependency EA"),
              summary_version: tool.schema.number().int().nonnegative().describe("Summary version used"),
            })).default([]).describe("Dependencies used"),
            confidence: tool.schema.number().min(0).max(1).describe("Confidence 0-1"),
          }).describe("Amended accepted contract").optional(),
          rejected_claims: tool.schema.array(tool.schema.object({
            claim: tool.schema.string().describe("Claim description"),
            reason: tool.schema.string().describe("Reason for rejection"),
          })).describe("Rejected claims").optional(),
          reason: tool.schema.string().describe("Reason for amendment"),
        },
        async execute(args, _ctx: ToolContext) {
          if (args.contract === undefined && args.rejected_claims === undefined) {
            return errorResult("Either contract or rejected_claims must be provided", "BAD_REQUEST");
          }

          let acceptedContract: unknown = args.contract;
          if (args.contract !== undefined) {
            const existingReview = await re.reviews.get(args.review_id);
            if (existingReview === null) {
              return errorResult(`Review ${args.review_id} not found`, "NOT_FOUND");
            }
            acceptedContract = { ...args.contract, function_ea: existingReview.function_ea };
          }

          try {
            await re.reviews.amend({
              reviewId: args.review_id,
              acceptedContract,
              rejectedClaims: args.rejected_claims,
              reason: args.reason,
            });
            return jsonResult({ amended: args.review_id, reason: args.reason });
          } catch (err) {
            if (err instanceof Error && err.message.includes("not found")) {
              return errorResult(`Review ${args.review_id} not found`, "NOT_FOUND");
            }
            throw err;
          }
        },
      }),

      re_review_list: tool({
        description: "List all reviews for a function",
        args: {
          function_ea: tool.schema.string().describe("Function EA"),
        },
        async execute(args, _ctx: ToolContext) {
          const reviews = await re.reviews.list(args.function_ea);
          return jsonResult(reviews);
        },
      }),

      re_review_get: tool({
        description: "Get a review by ID",
        args: {
          review_id: tool.schema.number().int().nonnegative().describe("Review ID"),
        },
        async execute(args, _ctx: ToolContext) {
          const review = await re.reviews.get(args.review_id);
          if (!review) {
            return errorResult(`Review ${args.review_id} not found`, "NOT_FOUND");
          }
          return jsonResult(review);
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
