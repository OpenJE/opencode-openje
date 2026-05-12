export type FunctionStatus = "discovered" | "queued" | "running" | "reviewed" | "accepted" | "dirty";
export type EdgeKind = "direct_call" | "indirect_call" | "virtual_call" | "data_dependency" | "control_dependency" | "unknown";
export type JobStatus = "queued" | "running" | "done" | "failed";
export type JobType = "analyze_function_semantics" | "review_contract" | "emit_cpp" | "simplify_cpp";
export type SourceSymbolKind = "function" | "method" | "constructor" | "destructor" | "struct" | "class" | "enum" | "global" | "unknown";
export type SourceSymbolStatus = "unplaced" | "placement_proposed" | "placement_reviewed" | "emitted" | "compiles" | "locked" | "stale" | "manual_override";

export interface AnalysisFunction {
  ea: string;
  status: FunctionStatus;
  pseudocodeHash?: string;
  summaryVersion?: number;
  dirty?: boolean;
  dirtyReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AnalysisEdge {
  caller: string;
  callee: string;
  kind: EdgeKind;
  blocking: boolean;
  reason?: string;
}

export interface Job {
  jobId: string;
  jobType: JobType;
  target: string;
  agentRole?: string;
  status: JobStatus;
  attempt: number;
  outputPath?: string;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkerRun {
  id: number;
  jobId?: string;
  functionEa: string;
  role: string;
  model: string;
  outputPath: string;
  createdAt?: string;
}

export interface Review {
  id: number;
  functionEa: string;
  contractVersion: number;
  outputPath: string;
  createdAt?: string;
}

export interface SummaryDependency {
  functionEa: string;
  dependsOnEa: string;
  summaryVersion: number;
}

export interface SccGroup {
  groupId: string;
  functionEa: string;
}

export interface SourceSymbol {
  symbolId: string;
  kind: SourceSymbolKind;
  status: SourceSymbolStatus;
  originEa?: string;
  name?: string;
  filePath?: string;
}

export interface SourceBlock {
  blockId: string;
  symbolId: string;
  filePath: string;
  content?: string;
  manualOverride?: boolean;
}

export interface Simplification {
  id: number;
  symbolId?: string;
  functionEa?: string;
  kind: string;
  accepted?: boolean;
}

export interface RegisterFunctionInput {
  ea: string;
  status: FunctionStatus;
  pseudocodeHash?: string;
}

export interface FunctionsModule {
  register(input: RegisterFunctionInput): Promise<void>;
  get(ea: string): Promise<AnalysisFunction | null>;
  setStatus(ea: string, status: FunctionStatus): Promise<void>;
  markDirty(ea: string, reason?: string): Promise<void>;
  listByStatus(status: FunctionStatus): Promise<AnalysisFunction[]>;
}

export interface AddEdgeInput {
  caller: string;
  callee: string;
  kind: EdgeKind;
  blocking: boolean;
  reason?: string;
}

export interface EdgesModule {
  add(input: AddEdgeInput): Promise<void>;
  children(caller: string): Promise<AnalysisEdge[]>;
  parents(callee: string): Promise<AnalysisEdge[]>;
  blockingChildren(caller: string): Promise<AnalysisEdge[]>;
}

export interface CreateJobInput {
  jobType: JobType;
  target: string;
  agentRole?: string;
}

export interface JobsModule {
  create(input: CreateJobInput): Promise<Job>;
  next(filter?: { role?: string }): Promise<Job | null>;
  complete(jobId: string, outputPath?: string): Promise<void>;
  fail(jobId: string, error: string): Promise<void>;
  list(filter?: { status?: JobStatus; role?: string }): Promise<Job[]>;
}

export interface SubmitWorkerRunInput {
  jobId?: string;
  functionEa: string;
  role: string;
  model: string;
  output: unknown;
}

export interface WorkerRunsModule {
  submit(input: SubmitWorkerRunInput): Promise<number>;
}

export interface ArtifactsModule {
  writeArtifact(dir: string, filename: string, data: unknown): Promise<string>;
}

export interface SubmitReviewInput {
  functionEa: string;
  contractVersion?: number;
  contract: unknown;
}

export interface ReviewsModule {
  submit(input: SubmitReviewInput): Promise<number>;
}

export interface CreateSymbolInput {
  symbolId: string;
  kind: SourceSymbolKind;
  status?: SourceSymbolStatus;
  originEa?: string;
  name?: string;
  filePath?: string;
}

export interface SourceSymbolsModule {
  create(input: CreateSymbolInput): Promise<SourceSymbol>;
  get(symbolId: string): Promise<SourceSymbol | null>;
  list(filter?: { kind?: string; status?: string; originEa?: string }): Promise<SourceSymbol[]>;
}

export interface CreateBlockInput {
  blockId: string;
  symbolId: string;
  filePath: string;
  content?: string;
}

export interface SourceBlocksModule {
  create(input: CreateBlockInput): Promise<SourceBlock>;
  get(blockId: string): Promise<SourceBlock | null>;
  listBySymbol(symbolId: string): Promise<SourceBlock[]>;
  update(blockId: string, updates: Partial<SourceBlock>): Promise<void>;
  listManualOverrides(): Promise<SourceBlock[]>;
}

export interface StatusTreeNode {
  ea: string;
  status: FunctionStatus;
  summaryVersion?: number;
  sccGroup?: string;
  children: StatusTreeNode[];
}

export interface StatusTreeModule {
  get(rootEa: string): Promise<StatusTreeNode | null>;
}

export interface SimplificationsModule {
  create(input: Simplification): Promise<number>;
}
