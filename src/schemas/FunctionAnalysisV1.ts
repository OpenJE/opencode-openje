import { z } from "zod";

export const FunctionAnalysisV1 = z.object({
  purpose: z.object({
    summary: z.string(),
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.string()),
  }),
  inputs: z.array(z.object({
    original: z.string(),
    proposed_name: z.string().optional(),
    type: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    evidence: z.array(z.string()).optional(),
  })).default([]),
  return_value: z.object({
    type: z.string().optional(),
    meaning: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    evidence: z.array(z.string()).optional(),
  }).optional(),
  side_effects: z.array(z.unknown()).default([]),
  uncertainties: z.array(z.string()).default([]),
});

export type FunctionAnalysisV1 = z.infer<typeof FunctionAnalysisV1>;
