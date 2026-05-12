import { z } from "zod";

export const AcceptedContractV1 = z.object({
  function_ea: z.string(),
  contract_version: z.number().int().nonnegative().optional(),
  accepted_name: z.string(),
  accepted_prototype: z.string().optional(),
  kind: z.enum(["function", "method", "constructor", "destructor", "thunk", "unknown"]),
  owner: z.string().optional(),
  purpose: z.string(),
  return_value: z.object({
    type: z.string().optional(),
    meaning: z.string().optional(),
  }).optional(),
  accepted_variable_names: z.record(z.string()).default({}),
  dependencies_used: z.array(z.object({
    ea: z.string(),
    summary_version: z.number().int().nonnegative(),
  })).default([]),
  rejected_claims: z.array(z.object({
    claim: z.string(),
    reason: z.string(),
  })).default([]),
  confidence: z.number().min(0).max(1),
});

export type AcceptedContractV1 = z.infer<typeof AcceptedContractV1>;
