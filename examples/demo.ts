import { ReProgress } from "../src/index.js";

async function main() {
  const re = await ReProgress.open({ root: process.cwd() });

  await re.functions.register({ ea: "A", status: "discovered" });
  await re.functions.register({ ea: "B", status: "discovered" });
  await re.functions.register({ ea: "C", status: "discovered" });
  await re.functions.register({ ea: "D", status: "discovered" });

  await re.edges.add({ caller: "A", callee: "B", kind: "direct_call", blocking: true });
  await re.edges.add({ caller: "A", callee: "C", kind: "direct_call", blocking: true });
  await re.edges.add({ caller: "B", callee: "D", kind: "direct_call", blocking: true });
  await re.edges.add({ caller: "C", callee: "D", kind: "direct_call", blocking: true });

  const job = await re.jobs.create({
    jobType: "analyze_function_semantics",
    target: "D",
    agentRole: "qwen_semantics_4b",
  });

  const nextJob = await re.jobs.next({ role: "qwen_semantics_4b" });

  await re.workers.submit({
    jobId: job.job_id,
    functionEa: "D",
    role: "qwen_semantics_4b",
    model: "qwen3.5-4b",
    output: {
      function_ea: "D",
      role: "semantics",
      model: "qwen3.5-4b",
      purpose: {
        summary: "Leaf function that validates input",
        confidence: 0.85,
        evidence: ["checks bounds"],
      },
      inputs: [],
      side_effects: [],
      uncertainties: [],
    },
  });

  await re.reviews.submit({
    functionEa: "D",
    reviewerModel: "qwen3.5-35b",
    acceptedContract: {
      function_ea: "D",
      accepted_name: "validate_input",
      kind: "function",
      purpose: "Validates input buffer before processing",
      confidence: 0.95,
      dependencies_used: [],
    },
  });

  const dFn = await re.functions.get("D");
  console.log("D reviewed:", dFn?.status === "reviewed", "version:", dFn?.summary_version);

  re.close();
}

main().catch(console.error);
