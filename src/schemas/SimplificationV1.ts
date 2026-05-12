import { z } from "zod";

export const SimplificationV1 = z.object({
  kind: z.string(),
  original: z.unknown().optional(),
  replacement: z.unknown().optional(),
  evidence: z.unknown().optional(),
  risk: z.string().optional(),
  reviewer_required: z.boolean().optional(),
  accepted: z.boolean().optional(),
});

export type SimplificationV1 = z.infer<typeof SimplificationV1>;
