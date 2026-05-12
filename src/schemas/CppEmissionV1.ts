import { z } from "zod";

export const CppEmissionV1 = z.object({
  symbol_id: z.string(),
  function_ea: z.string().optional(),
  contract_version: z.number().int().nonnegative(),
  file_path: z.string(),
  block_id: z.string(),
  fidelity_mode: z.enum(["pseudocode_faithful", "pseudocode_faithful_with_recognized_simplifications", "manual_override"]),
  simplifications: z.array(z.unknown()).default([]),
  known_deviations: z.array(z.string()).default([]),
});

export type CppEmissionV1 = z.infer<typeof CppEmissionV1>;
