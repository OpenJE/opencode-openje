export type SqliteBoolean = 0 | 1;

export type FunctionStatus =
  | "unknown"
  | "discovered"
  | "queued"
  | "waiting_on_children"
  | "ready_for_local_analysis"
  | "analyzing"
  | "worker_done"
  | "review_pending"
  | "reviewed"
  | "failed"
  | "skipped"
  | "cycle_member"
  | "stale";

export type EdgeKind =
  | "direct_call"
  | "indirect_call"
  | "virtual_call"
  | "import_call"
  | "thunk"
  | "tail_call"
  | "callback_candidate"
  | "unresolved";

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled" | "blocked";

export type JobType =
  | "discover_subgraph"
  | "classify_edges"
  | "analyze_function_semantics"
  | "analyze_function_types"
  | "analyze_function_names"
  | "review_function_contract"
  | "analyze_scc_cluster"
  | "emit_faithful_cpp"
  | "review_cpp_fidelity"
  | "fix_compile_error"
  | "apply_ida_patch_plan";

export type SourceSymbolKind =
  | "function"
  | "method"
  | "class"
  | "struct"
  | "enum"
  | "global"
  | "typedef"
  | "namespace"
  | "constant";

export type SourceSymbolStatus =
  | "unplaced"
  | "placement_proposed"
  | "placement_reviewed"
  | "emitted"
  | "compiles"
  | "locked"
  | "stale"
  | "manual_override";

export type FidelityMode =
  | "pseudocode_faithful"
  | "pseudocode_faithful_with_recognized_simplifications"
  | "manual_override";

export interface AnalysisFunction {
  ea: string;
  status: FunctionStatus;
  summary_version: number;
  accepted_summary_json: string | null;
  confidence: number | null;
  dirty: SqliteBoolean;
  last_pseudocode_hash: string | null;
  updated_at: string | null;
}

export interface AnalysisEdge {
  caller_ea: string;
  callee_ea: string;
  edge_kind: EdgeKind;
  blocking: SqliteBoolean;
  reason: string | null;
  discovered_at: string | null;
}

export interface AddEdgeInput {
  caller: string;
  callee: string;
  kind: EdgeKind;
  blocking?: boolean;
  reason?: string;
}

export interface Job {
  job_id: string;
  job_type: JobType;
  target: string;
  agent_role: string | null;
  status: JobStatus;
  input_path: string | null;
  output_path: string | null;
  attempt: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface WorkerRun {
  id: number;
  job_id: string | null;
  function_ea: string;
  role: string;
  model: string;
  input_hash: string | null;
  output_json: string;
  output_path: string | null;
  created_at: string | null;
}

export interface Review {
  id: number;
  function_ea: string;
  reviewer_model: string;
  contract_version: number;
  accepted_contract_json: string;
  accepted_contract_path: string | null;
  rejected_claims_json: string | null;
  created_at: string | null;
}

export interface SummaryDependency {
  parent_ea: string;
  child_ea: string;
  child_summary_version_used: number;
}

export interface SccGroup {
  group_id: string;
  members_json: string;
  status: FunctionStatus;
  summary_json: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SourceSymbol {
  symbol_id: string;
  kind: SourceSymbolKind;
  name: string;
  namespace: string | null;
  origin_ea: string | null;
  contract_version: number | null;
  definition_json: string | null;
  status: SourceSymbolStatus | null;
}

export interface SourceBlock {
  block_id: string;
  symbol_id: string;
  file_path: string;
  block_hash: string | null;
  managed: SqliteBoolean;
  manual_override: SqliteBoolean;
  fidelity_mode: FidelityMode | null;
  updated_at: string | null;
}

export interface Simplification {
  id: number;
  symbol_id: string;
  function_ea: string | null;
  kind: string;
  original_json: string | null;
  replacement_json: string | null;
  evidence_json: string | null;
  risk: string | null;
  reviewer_required: SqliteBoolean | null;
  accepted: SqliteBoolean | null;
  created_at: string | null;
}

export interface CreateJobInput {
  jobType: JobType;
  target: string;
  agentRole?: string;
  inputPath?: string;
}

export interface SubmitWorkerRunInput {
  jobId?: string;
  functionEa: string;
  role: string;
  model: string;
  inputHash?: string;
  output: unknown;
  outputPath?: string;
}

export interface SubmitReviewInput {
  functionEa: string;
  reviewerModel: string;
  acceptedContract: unknown;
  rejectedClaims?: unknown[];
  acceptedContractPath?: string;
}
