# opencode-openje

**Durable progress ledger for reverse-engineering workflows.**

An OpenCode plugin that tracks RE progress -- functions, call graphs, jobs, worker outputs, reviews, staleness, and source reconstruction -- all backed by SQLite with Zod-validated schemas.

## Why?

Reverse-engineering a binary is a months-long, multi-agent collaborative effort. Without a ledger:

- **Duplicate workers**: Two agents analyze the same function independently, wasting compute and producing conflicting contracts.
- **Lost parent updates**: A child's summary changes but parents never learn their dependency is stale.
- **No version trail**: When a contract is revised, there is no record of what changed or why.
- **Lost call edges**: Edge data discovered by one agent is forgotten when another agent takes over.

`opencode-openje` solves this by maintaining a durable, queryable ledger of all RE artifacts with explicit versioning, dependency tracking, and staleness propagation.

## Non-Goals

This package:

- Does **NOT** call LLMs
- Does **NOT** manage OpenCode Team Mode
- Does **NOT** replace IDA or ida-pro-mcp
- Does **NOT** retrieve pseudocode or disassembly by itself
- Does **NOT** mutate the IDA database
- Does **NOT** make semantic decisions
- Does **NOT** generate final C++ in v1 (audit trail only)
- Does **NOT** duplicate the full IDA database

IDA remains the authoritative source of truth. This package may store hashes/snapshots for audit, but all binary facts come from IDA.

## Quickstart

### Install

```bash
bun install
```

### Library Usage

```typescript
import { ReProgress } from "opencode-openje/core";

const re = await ReProgress.open({ root: "/path/to/rework" });

// Register functions
await re.functions.register({ ea: "0x401000", status: "discovered" });
await re.functions.register({ ea: "0x401020", status: "discovered" });
await re.functions.register({ ea: "0x401040", status: "discovered" });

// Add call edges
await re.edges.add({
  caller: "0x401000",
  callee: "0x401020",
  kind: "direct_call",
  blocking: true,
});

// Create a job
const job = await re.jobs.create({
  jobType: "analyze_function_semantics",
  target: "0x401000",
  agentRole: "worker",
});

// Claim next available job (atomic claim)
const nextJob = await re.jobs.next({ role: "worker" });
if (nextJob) {
  // ... do work ...
  await re.jobs.complete(nextJob.job_id, "/path/to/output.json");
}

// Submit worker output (validated via Zod)
await re.workers.submit({
  functionEa: "0x401000",
  role: "worker",
  model: "claude-sonnet",
  output: { /* FunctionAnalysisV1 schema */ },
});

// Submit accepted review (increments summary version)
await re.reviews.submit({
  functionEa: "0x401000",
  reviewerModel: "claude-sonnet",
  acceptedContract: { /* AcceptedContractV1 schema */ },
});

// List stale functions (parents with outdated child versions)
const staleFunctions = await re.stale.list();

// Get status tree from a root function
const tree = await re.tree.statusTree("0x401000");

// Traverse: detect SCCs, topological order, build analysis plan
const sccs = re.traversal.detectSccs(await re.edges.listAll());
const order = re.traversal.topologicalOrder("0x401000", await re.edges.listAll());
const plan = re.traversal.traversalPlan("0x401000", await re.edges.listAll(), new Map());

await re.close();
```

### OpenCode Plugin Config

Add to `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-openje"]
}
```

> **Note:** The plugin is loaded from npm via the `plugin` array. For local development or GitHub installs, use:
>
> ```bash
> bun add "github:OpenJE/opencode-openje#main"
> ```
>
> Then add `"opencode-openje"` to the `plugin` array in `opencode.jsonc`. OpenCode will auto-install the package on startup.
>
> You can also place `plugin.ts` directly in `.opencode/plugins/` — see [OpenCode Plugins](https://opencode.ai/docs/plugins/).

### Plugin Return Format

All 13 tools use the official `@opencode-ai/plugin` SDK's `tool()` helper with Zod-validated schemas. Tools return `ToolResult` format: `string | { output: string; metadata?: Record<string, any> }`.

- **Success**: `{ output: "<json-stringified data>" }` or plain string
- **Error**: `{ output: "{\"error\":{\"message\":\"...\",\"code\":\"...\"}}" }`

Example: `re_status` returns JSON with function/edge/job counts; `re_function_get` on missing function returns error JSON.

## Architecture

```
                         +------------------+
                         |    IDA Pro MCP   |
                         |  (source of truth)|
                         +--------+---------+
                                  |
                                  v
                         +---------------------+
                         |  opencode-openje    |
                         |  (durable ledger)   |
                         +---------------------+
          +--------------+--------------+--------------+
          |              |              |              |
          v              v              v              v
    +-----------+  +-----------+  +-----------+  +-----------+
    | functions |  |   edges   |  |   jobs    |  |  reviews  |
    +-----------+  +-----------+  +-----------+  +-----------+
    +-----------+  +-----------+  +-----------+  +-----------+
    |  workers  |  |   stale   |  |    SCC    |  | source_  |
    |  (runs)   |  |           |  |           |  | symbols  |
    +-----------+  +-----------+  +-----------+  +-----------+
    +-----------+  +-----------+  +-----------+  +-----------+
    |    src   |  |   simpli-  |  |  dependen-|  |artifacts |
    |  blocks  |  |  fications |  |    cies   |  |          |
    +-----------+  +-----------+  +-----------+  +-----------+
                                  ^
                                  |
          +-----------------------+-----------------------+
          |                       |                       |
          v                       v                       v
    +-----------+           +-----------+           +-----------+
    |   Agent   |           |   Agent   |           | Reviewer  |
    |   Pool    |           |   Pool    |           |   Pool    |
    +-----------+           +-----------+           +-----------+
```

All data persisted in `.rework/re.db` (SQLite).

## Filesystem Layout

```
.rework/                      # Root directory (configurable)
  re.db                       # SQLite database (migrated)
  packets/                    # Job input packets
  worker_outputs/            # Worker run outputs
  reviews/                    # Accepted review contracts
  summaries/                  # Summary version snapshots
  traversal_logs/             # SCC and topo traversal logs
  source_map/                 # Source symbol to EA mappings
  patch_plans/                # IDA patch plans
  artifacts/                  # Large binary artifacts
    chunks/                   # Binary chunk storage
    blobs/                    # Large blob storage
```

## Core Concepts

### Functions

Each function tracked through a explicit status lifecycle:

```
unknown -> discovered -> queued -> waiting_on_children -> ready_for_local_analysis
         -> analyzing -> worker_done -> review_pending -> reviewed
         -> failed / skipped / cycle_member / stale
```

- `unknown`: Initial state, address known but not yet processed.
- `discovered`: Function identified in binary.
- `queued`: Job created for analysis.
- `waiting_on_children`: Waiting for child call targets to be analyzed.
- `ready_for_local_analysis`: All blocking children analyzed, ready for local analysis.
- `analyzing`: Worker actively analyzing.
- `worker_done`: Worker output submitted, awaiting review.
- `review_pending`: Review submitted, pending acceptance.
- `reviewed`: Review accepted, contract canonical.
- `failed`: Analysis failed.
- `skipped`: Intentionally skipped (e.g., library function).
- `cycle_member`: Part of an SCC, handled specially.
- `stale`: Parent that referenced an older version of this function's summary.

### Edges

Call edges between functions. Edge kinds:

- `direct_call`: Static, direct call.
- `indirect_call`: Call via function pointer.
- `virtual_call`: C++ virtual dispatch.
- `import_call`: Call to imported function (e.g., memcpy).
- `thunk`: Thunk/jump stub.
- `tail_call`: Tail call optimization.
- `callback_candidate`: Likely callback handler.
- `unresolved`: Cannot determine target.

**Blocking vs non-blocking edges:**

- `blocking: true` (default): Parent cannot proceed until callee is analyzed.
- `blocking: false`: Non-blocking (e.g., import calls to well-known functions like `memset`).

### Jobs

Work items for agents. Jobs transition through states:

- `queued`: Created, not yet claimed.
- `running`: Claimed by an agent, work in progress.
- `done`: Completed successfully.
- `failed`: Work attempted but failed.
- `cancelled`: Manually cancelled.
- `blocked`: Cannot run due to blocking dependencies.

Job claiming is **atomic** -- only one agent can claim a job, preventing duplicate work.

### Worker Outputs vs. Reviews

**Most important invariant:**

Worker outputs are **hypotheses**, not accepted truth. They are recorded for audit but do not update the canonical contract.

Reviews are the **only** source of canonical truth. Only reviews increment the `summary_version` on a function and record the accepted contract.

```
Worker submits output -> stored in worker_runs (hypothesis)
Reviewer accepts -> summary_version++, contract recorded (canonical)
```

### Staleness

When a function's `summary_version` increments, all parents that referenced an older version become `stale`.

Example:
1. Function D is reviewed, summary_version becomes 1.
2. Parent B had recorded it used D at version 0.
3. `stale.markParentsStale("D")` finds B and marks B as `stale`.
4. B must be re-reviewed to clear staleness.

### SCCs

Strongly Connected Components (cycles) are detected via Tarjan's algorithm. When call edges form a cycle, functions are grouped into an SCC and marked `cycle_member`. Analysis order within an SCC is determined by the traversal planner to prevent deadlock.

## API Reference

### `re.functions`

```typescript
// Register a function (upsert)
register(input: { ea: string; status?: FunctionStatus; lastPseudocodeHash?: string }): Promise<void>

// Get a function by EA
get(ea: string): Promise<AnalysisFunction | null>

// Update function status
setStatus(ea: string, status: FunctionStatus): Promise<void>

// Mark a function as dirty (needs re-analysis)
markDirty(ea: string, reason?: string): Promise<void>

// List all functions with a specific status
listByStatus(status: FunctionStatus): Promise<AnalysisFunction[]>

// List all dirty functions
listDirty(): Promise<AnalysisFunction[]>

// List all functions
listAll(): Promise<AnalysisFunction[]>
```

### `re.edges`

```typescript
// Add an edge (upsert by caller_ea + callee_ea)
add(input: AddEdgeInput): Promise<void>

// Get children (callees) of a function
children(caller: string): Promise<AnalysisEdge[]>

// Get parents (callers) of a function
parents(callee: string): Promise<AnalysisEdge[]>

// Get only blocking children
blockingChildren(caller: string): Promise<AnalysisEdge[]>

// List all edges
listAll(): Promise<AnalysisEdge[]>

// Remove an edge
remove(caller: string, callee: string): Promise<void>
```

### `re.jobs`

```typescript
// Create a new job
create(input: CreateJobInput): Promise<Job>

// Claim next available job (atomic)
next(filter?: { role?: string }): Promise<Job | null>

// Complete a job
complete(jobId: string, outputPath?: string): Promise<void>

// Mark a job as failed
fail(jobId: string, error: string): Promise<void>

// List jobs with optional filters
list(filter?: { status?: JobStatus; role?: string }): Promise<Job[]>

// Get a job by ID
get(jobId: string): Promise<Job | null>
```

### `re.workers`

```typescript
// Submit worker run output (validated against FunctionAnalysisV1 schema)
submit(input: SubmitWorkerRunInput): Promise<number>

// List all worker runs for a function
listForFunction(functionEa: string): Promise<WorkerRun[]>

// Get a specific worker run by ID
get(id: number): Promise<WorkerRun | null>
```

### `re.reviews`

```typescript
// Bundle all data for a function review (worker runs, edges, dependencies)
bundle(functionEa: string): Promise<ReviewBundle>

// Submit accepted review contract (increments summary_version)
submit(input: SubmitReviewInput): Promise<void>
```

### `re.dependencies`

```typescript
// Record that parent uses child's summary at a specific version
record(parentEa: string, childEa: string, childVersion: number): Promise<void>

// Get dependencies used by a parent
usedByParent(parentEa: string): Promise<SummaryDependency[]>

// Get parents that are stale with respect to a child
staleParentsOf(childEa: string): Promise<string[]>

// Get a specific dependency
get(parentEa: string, childEa: string): Promise<SummaryDependency | null>

// Remove a dependency
remove(parentEa: string, childEa: string): Promise<void>
```

### `re.stale`

```typescript
// Mark parents stale when child's summary version changes
markParentsStale(childEa: string): Promise<string[]>

// List all stale functions
list(): Promise<AnalysisFunction[]>

// Check if a function is stale
isStale(functionEa: string): Promise<boolean>
```

### `re.tree`

```typescript
// Get recursive status tree from a root function
statusTree(rootEa: string): Promise<StatusTreeNode | null>
```

### `re.sourceSymbols`

```typescript
// Create a source symbol
create(input: CreateSymbolInput): Promise<SourceSymbol>

// Get a symbol by ID
get(symbolId: string): Promise<SourceSymbol | null>

// List symbols with optional filters
list(filter?: { kind?: SourceSymbolKind; status?: SourceSymbolStatus; originEa?: string }): Promise<SourceSymbol[]>
```

### `re.sourceBlocks`

```typescript
// Create a source block
create(input: CreateBlockInput): Promise<SourceBlock>

// Get a block by ID
get(blockId: string): Promise<SourceBlock | null>

// List blocks for a symbol
listBySymbol(symbolId: string): Promise<SourceBlock[]>

// Update a block
update(blockId: string, updates: Partial<SourceBlock>): Promise<void>

// List all blocks
list(): Promise<SourceBlock[]>
```

### `re.simplifications`

```typescript
// Create a simplification proposal
create(input: CreateSimplificationInput): Promise<number>

// Get a simplification by ID
get(id: number): Promise<Simplification | null>

// List simplifications for a symbol
listBySymbol(symbolId: string): Promise<Simplification[]>

// List simplifications for a function
listByFunction(functionEa: string): Promise<Simplification[]>

// Accept a simplification
accept(id: number): Promise<void>

// Reject a simplification
reject(id: number): Promise<void>

// Remove a simplification
remove(id: number): Promise<void>
```

### `re.artifacts`

```typescript
// Write an artifact to disk
writeArtifact(dir: string, filename: string, data: unknown): Promise<string>

// Read an artifact from disk
readArtifact(dir: string, filename: string): Promise<unknown>

// Build full path to an artifact
artifactPath(dir: string, filename: string): string
```

### `re.traversal`

```typescript
// Detect SCCs (Tarjan's algorithm)
detectSccs(edges: AnalysisEdge[]): SccGroup[]

// Get topological order from root
topologicalOrder(rootEa: string, edges: AnalysisEdge[]): string[]

// Build full analysis plan
traversalPlan(rootEa: string, edges: AnalysisEdge[], functions: Map<string, AnalysisFunction>): TraversalPlan
```

## Plugin Tools

| Tool | Description |
|------|-------------|
| `re_status` | Show overall ledger status (counts of functions, edges, jobs, worker runs, reviews, stale functions, source symbols, source blocks) |
| `re_function_register` | Register a function with EA, optional status and pseudocode hash |
| `re_function_get` | Get a function by its effective address |
| `re_function_set_status` | Update a function's status |
| `re_function_list` | List all functions, optionally filtered by status |
| `re_edge_add` | Add a call edge between two functions (caller -> callee) |
| `re_job_create` | Create a new job with type, target, and optional role |
| `re_job_next` | Claim the next available job (atomic), optionally filtered by role |
| `re_worker_submit` | Submit worker run output for a function (Zod-validated) |
| `re_review_submit` | Submit an accepted review contract (increments summary_version) |
| `re_stale_mark_parents` | Mark parent functions stale after child's summary changes |
| `re_stale_list` | List all functions currently in stale state |
| `re_tree` | Get recursive status tree starting from a root function EA |

## Database Schema

### analysis_functions

| Column | Type | Notes |
|--------|------|-------|
| `ea` | TEXT | PRIMARY KEY |
| `status` | TEXT | NOT NULL |
| `summary_version` | INTEGER | DEFAULT 0 |
| `accepted_summary_json` | TEXT | Canonical contract JSON |
| `confidence` | REAL | 0.0-1.0 |
| `dirty` | INTEGER | 0 or 1 |
| `last_pseudocode_hash` | TEXT | For change detection |
| `updated_at` | TEXT | ISO timestamp |

### analysis_edges

| Column | Type | Notes |
|--------|------|-------|
| `caller_ea` | TEXT | PRIMARY KEY (composite) |
| `callee_ea` | TEXT | PRIMARY KEY (composite) |
| `edge_kind` | TEXT | NOT NULL |
| `blocking` | INTEGER | DEFAULT 1 (true) |
| `reason` | TEXT | How edge was discovered |
| `discovered_at` | TEXT | ISO timestamp |

### jobs

| Column | Type | Notes |
|--------|------|-------|
| `job_id` | TEXT | PRIMARY KEY |
| `job_type` | TEXT | NOT NULL |
| `target` | TEXT | NOT NULL (usually EA) |
| `agent_role` | TEXT | Optional role filter |
| `status` | TEXT | queued/running/done/failed/cancelled/blocked |
| `input_path` | TEXT | Path to job input |
| `output_path` | TEXT | Path to job output |
| `attempt` | INTEGER | Retry count |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

### worker_runs

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `job_id` | TEXT | Optional |
| `function_ea` | TEXT | NOT NULL |
| `role` | TEXT | NOT NULL |
| `model` | TEXT | NOT NULL |
| `input_hash` | TEXT | SHA of input |
| `output_json` | TEXT | FunctionAnalysisV1 JSON |
| `output_path` | TEXT | Path to output artifact |
| `created_at` | TEXT | ISO timestamp |

### reviews

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `function_ea` | TEXT | NOT NULL |
| `reviewer_model` | TEXT | NOT NULL |
| `contract_version` | INTEGER | NOT NULL |
| `accepted_contract_json` | TEXT | NOT NULL |
| `accepted_contract_path` | TEXT | Path to contract file |
| `rejected_claims_json` | TEXT | JSON array of rejected claims |
| `created_at` | TEXT | ISO timestamp |

### summary_dependencies

| Column | Type | Notes |
|--------|------|-------|
| `parent_ea` | TEXT | PRIMARY KEY (composite) |
| `child_ea` | TEXT | PRIMARY KEY (composite) |
| `child_summary_version_used` | INTEGER | NOT NULL |

### scc_groups

| Column | Type | Notes |
|--------|------|-------|
| `group_id` | TEXT | PRIMARY KEY |
| `members_json` | TEXT | JSON array of EA strings |
| `status` | TEXT | NOT NULL |
| `summary_json` | TEXT | SCC-level summary |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

### source_symbols

| Column | Type | Notes |
|--------|------|-------|
| `symbol_id` | TEXT | PRIMARY KEY |
| `kind` | TEXT | NOT NULL |
| `name` | TEXT | NOT NULL |
| `namespace` | TEXT | Optional |
| `origin_ea` | TEXT | Source EA |
| `contract_version` | INTEGER | Last contract version |
| `definition_json` | TEXT | Symbol definition |
| `status` | TEXT | unplaced/placement_proposed/etc |

### source_blocks

| Column | Type | Notes |
|--------|------|-------|
| `block_id` | TEXT | PRIMARY KEY |
| `symbol_id` | TEXT | NOT NULL |
| `file_path` | TEXT | NOT NULL |
| `block_hash` | TEXT | SHA of block content |
| `managed` | INTEGER | 1 = managed by package |
| `manual_override` | INTEGER | 1 = manually edited |
| `fidelity_mode` | TEXT | pseudocode_faithful/etc |
| `updated_at` | TEXT | ISO timestamp |

### simplifications

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `symbol_id` | TEXT | NOT NULL |
| `function_ea` | TEXT | Optional |
| `kind` | TEXT | NOT NULL |
| `original_json` | TEXT | Original AST |
| `replacement_json` | TEXT | Replacement AST |
| `evidence_json` | TEXT | Evidence for the simplification |
| `risk` | TEXT | low/medium/high |
| `reviewer_required` | INTEGER | 1 = needs review |
| `accepted` | INTEGER | NULL/1/0 |
| `created_at` | TEXT | ISO timestamp |

## Validation Schemas

### FunctionAnalysisV1

Worker output schema (hypothesis):

```typescript
{
  job_id?: string,
  function_ea: string,
  role: string,
  model: string,
  purpose: {
    summary: string,
    confidence: number (0.0-1.0),
    evidence: string[],
  },
  inputs: Array<{
    original: string,
    proposed_name?: string,
    type?: string,
    confidence?: number (0.0-1.0),
    evidence?: string[],
  }>,
  return_value?: {
    type?: string,
    meaning?: string,
    confidence?: number (0.0-1.0),
    evidence?: string[],
  },
  side_effects: unknown[],
  uncertainties: string[],
}
```

### AcceptedContractV1

Canonical review acceptance schema:

```typescript
{
  function_ea: string,
  contract_version?: number,
  accepted_name: string,
  accepted_prototype?: string,
  kind: "function" | "method" | "constructor" | "destructor" | "thunk" | "unknown",
  owner?: string,
  purpose: string,
  return_value?: {
    type?: string,
    meaning?: string,
  },
  accepted_variable_names: Record<string, string>,
  dependencies_used: Array<{
    ea: string,
    summary_version: number,
  }>,
  rejected_claims: Array<{
    claim: string,
    reason: string,
  }>,
  confidence: number (0.0-1.0),
}
```

### CppEmissionV1

C++ emission audit schema:

```typescript
{
  symbol_id: string,
  function_ea?: string,
  contract_version: number,
  file_path: string,
  block_id: string,
  fidelity_mode: "pseudocode_faithful" | "pseudocode_faithful_with_recognized_simplifications" | "manual_override",
  simplifications: unknown[],
  known_deviations: string[],
}
```

### SimplificationV1

Simplification proposal schema:

```typescript
{
  kind: string,
  original?: unknown,
  replacement?: unknown,
  evidence?: unknown,
  risk?: string,
  reviewer_required?: boolean,
  accepted?: boolean,
}
```

## Invariants

1. **Parent contracts record exact child summary versions**: When a parent function uses a child's summary, the exact version is recorded. This enables precise staleness detection.

2. **Child version changes -> parents become stale**: When a function's `summary_version` increments, all parents that referenced an older version are marked `stale`.

3. **Worker outputs are hypotheses, not truth**: Worker outputs are recorded for audit but do not update canonical contracts.

4. **Reviews are canonical truth**: Only accepted reviews increment `summary_version` and record the canonical contract.

5. **IDA remains authoritative for binary facts**: This package tracks RE progress, not binary facts. All factual data about the binary comes from IDA.

6. **Package does not mirror full IDA database**: Only RE-specific metadata is stored (function status, edges, summaries, contracts). Raw disassembly/pseudocode stays in IDA.

7. **SCCs/cycles represented explicitly**: Call cycles are detected and grouped into SCCs. Functions within an SCC are marked `cycle_member`.

8. **Job claiming is atomic**: Only one agent can claim a job. Prevents duplicate work.

9. **Source blocks map back to symbols and contract versions**: Source blocks track which symbol they belong to and which contract version they were generated from.

10. **Manual source overrides protected**: Source blocks with `manual_override = true` are tracked but not silently modified by the package.

11. **Simplifications recorded, not silently applied**: All simplifications are recorded with accept/reject status. Accepted simplifications require explicit action to apply.

## Integration Patterns

### Team Mode Workflow

```
Lead Agent
  |
  |-- creates job --> re.jobs.create()
  |
  |-- assigns --> Worker Agent
  |                |
  |                |-- analyzes function
  |                |-- submits worker run --> re.workers.submit()
  |                |-- marks job done --> re.jobs.complete()
  |
  |-- assigns --> Reviewer Agent
  |                |
  |                |-- bundles data --> re.reviews.bundle()
  |                |-- reviews and accepts
  |                |-- submits review --> re.reviews.submit()
  |                |                    |
  |                |                    +-- summary_version++
  |                |                    +-- parents become stale
  |                |
  |                |-- marks parents stale --> re.stale.markParentsStale()
  |
  |-- monitors --> re.stale.list() (find stale parents)
  |-- re-analyzes stale functions
```

### IDA MCP Integration

```
IDA Pro MCP
  |
  |-- discovers function --> re.functions.register()
  |-- discovers edge --> re.edges.add()
  |-- detects status change --> re.functions.setStatus()
  |-- detects pseudocode change --> re.functions.markDirty()
  |
  |-- queries status --> re.functions.get()
  |-- queries call graph --> re.edges.children() / re.edges.parents()
  |-- queries stale --> re.stale.list()
```

## Error Handling

Errors return structured JSON:

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Function 0x401000 not found",
    "details": {
      "ea": "0x401000"
    }
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `DB_ERROR` | Database operation failed |
| `NOT_FOUND` | Requested entity not found |
| `INVALID_STATUS` | Invalid function status transition |
| `INVALID_JOB_STATE` | Job cannot transition to requested state |
| `INVALID_WORKER_OUTPUT` | Worker output failed Zod validation |
| `INVALID_CONTRACT` | Contract failed Zod validation |
| `STALE_DEPENDENCY` | Operation blocked by stale dependency |
| `MANUAL_OVERRIDE` | Operation blocked by manual override |
| `UNKNOWN_TABLE` | Unknown database table |
| `UNKNOWN_EDGE_KIND` | Unknown edge kind |
| `UNKNOWN_JOB_TYPE` | Unknown job type |

## Development

```bash
# Run tests
bun test

# Type check
bun run check

# Build for distribution
bun run build
```

## Integration Test

`tests/integration/synthetic-graph.test.ts` validates the full graph lifecycle:

1. **Register functions**: A, B, C, D, E, F, memset
2. **Create edges**:
   - A -> B (direct_call, blocking)
   - A -> C (direct_call, blocking)
   - A -> memset (import_call, non-blocking)
   - B -> D (direct_call, blocking)
   - C -> D (direct_call, blocking)
   - E <-> F (direct_call, blocking) -- forms SCC
3. **Verify D has two parents** (B and C share D as child)
4. **Verify E <-> F forms one SCC** with members ["E", "F"]
5. **Verify topological order**: D before B before A; B before A
6. **Review D at v1**:
   - summary_version for D becomes 1
   - B and C become stale (they referenced D at v0)
7. **Review B at v1**:
   - summary_version for B becomes 1
   - A becomes stale (it referenced B at v0)

## License

Private. All rights reserved.