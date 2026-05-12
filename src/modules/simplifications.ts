import type { Database } from "bun:sqlite";
import type { Simplification } from "../db/types.js";

export interface CreateSimplificationInput {
  symbolId: string;
  functionEa?: string;
  kind: string;
  originalJson?: string;
  replacementJson?: string;
  evidenceJson?: string;
  risk?: string;
  reviewerRequired?: boolean;
}

export class SimplificationsModule {
  constructor(private readonly db: Database) {}

  async create(input: CreateSimplificationInput): Promise<number> {
    const result = this.db
      .query(
        `INSERT INTO simplifications (
           symbol_id, function_ea, kind, original_json, replacement_json, evidence_json, risk, reviewer_required, accepted, created_at
         ) VALUES (
           $symbolId, $functionEa, $kind, $originalJson, $replacementJson, $evidenceJson, $risk, $reviewerRequired, NULL, $createdAt
         );`,
      )
      .run({
        $symbolId: input.symbolId,
        $functionEa: input.functionEa ?? null,
        $kind: input.kind,
        $originalJson: input.originalJson ?? null,
        $replacementJson: input.replacementJson ?? null,
        $evidenceJson: input.evidenceJson ?? null,
        $risk: input.risk ?? null,
        $reviewerRequired: input.reviewerRequired ? 1 : 0,
        $createdAt: new Date().toISOString(),
      });

    return Number(result.lastInsertRowid);
  }

  async get(id: number): Promise<Simplification | null> {
    return this.db
      .query("SELECT * FROM simplifications WHERE id = $id;")
      .get({ $id: id }) as Simplification | null;
  }

  async listBySymbol(symbolId: string): Promise<Simplification[]> {
    return this.db
      .query("SELECT * FROM simplifications WHERE symbol_id = $symbolId ORDER BY id;")
      .all({ $symbolId: symbolId }) as Simplification[];
  }

  async listByFunction(functionEa: string): Promise<Simplification[]> {
    return this.db
      .query("SELECT * FROM simplifications WHERE function_ea = $functionEa ORDER BY id;")
      .all({ $functionEa: functionEa }) as Simplification[];
  }

  async accept(id: number): Promise<void> {
    this.db
      .query("UPDATE simplifications SET accepted = 1 WHERE id = $id;")
      .run({ $id: id });
  }

  async reject(id: number): Promise<void> {
    this.db
      .query("UPDATE simplifications SET accepted = 0 WHERE id = $id;")
      .run({ $id: id });
  }

  async remove(id: number): Promise<void> {
    this.db
      .query("DELETE FROM simplifications WHERE id = $id;")
      .run({ $id: id });
  }
}
