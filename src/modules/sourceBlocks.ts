import type { Database } from "bun:sqlite";
import type { SourceBlock } from "../db/types.js";
import type { JsonStore } from "../persistence/types.js";

export interface CreateBlockInput {
  blockId: string;
  symbolId: string;
  filePath: string;
  blockHash?: string;
  fidelityMode?: string;
}

export class SourceBlocksModule {
  constructor(private readonly db: Database, private readonly jsonStore?: JsonStore) {}

  async create(input: CreateBlockInput): Promise<SourceBlock> {
    this.db
      .query(
        `INSERT INTO source_blocks (
           block_id, symbol_id, file_path, block_hash, managed, manual_override, fidelity_mode, updated_at
         ) VALUES (
           $blockId, $symbolId, $filePath, $blockHash, 1, 0, $fidelityMode, $updatedAt
         );`,
      )
      .run({
        $blockId: input.blockId,
        $symbolId: input.symbolId,
        $filePath: input.filePath,
        $blockHash: input.blockHash ?? null,
        $fidelityMode: input.fidelityMode ?? null,
        $updatedAt: new Date().toISOString(),
      });

    const block = await this.get(input.blockId);
    if (!block) throw new Error("Failed to create source block");

    if (this.jsonStore) {
      await this.jsonStore.write("source_blocks", block.block_id, block as unknown as Record<string, unknown>);
    }

    return block;
  }

  async get(blockId: string): Promise<SourceBlock | null> {
    return this.db
      .query("SELECT * FROM source_blocks WHERE block_id = $blockId;")
      .get({ $blockId: blockId }) as SourceBlock | null;
  }

  async listBySymbol(symbolId: string): Promise<SourceBlock[]> {
    return this.db
      .query("SELECT * FROM source_blocks WHERE symbol_id = $symbolId ORDER BY block_id;")
      .all({ $symbolId: symbolId }) as SourceBlock[];
  }

  async update(blockId: string, updates: Partial<SourceBlock>): Promise<void> {
    const fields: string[] = [];
    const params: Record<string, unknown> = { $blockId: blockId, $updatedAt: new Date().toISOString() };

    if (updates.file_path !== undefined) {
      fields.push("file_path = $filePath");
      params.$filePath = updates.file_path;
    }
    if (updates.block_hash !== undefined) {
      fields.push("block_hash = $blockHash");
      params.$blockHash = updates.block_hash;
    }
    if (updates.managed !== undefined) {
      fields.push("managed = $managed");
      params.$managed = updates.managed;
    }
    if (updates.manual_override !== undefined) {
      fields.push("manual_override = $manualOverride");
      params.$manualOverride = updates.manual_override;
    }
    if (updates.fidelity_mode !== undefined) {
      fields.push("fidelity_mode = $fidelityMode");
      params.$fidelityMode = updates.fidelity_mode;
    }

    if (fields.length === 0) return;

    fields.push("updated_at = $updatedAt");
    this.db
      .query(`UPDATE source_blocks SET ${fields.join(", ")} WHERE block_id = $blockId;`)
      .run(params as Record<string, string | number | null>);

    if (this.jsonStore) {
      const block = await this.get(blockId);
      if (block) {
        await this.jsonStore.write("source_blocks", blockId, block as unknown as Record<string, unknown>);
      }
    }
  }

  async listManualOverrides(): Promise<SourceBlock[]> {
    return this.db
      .query("SELECT * FROM source_blocks WHERE manual_override = 1 ORDER BY block_id;")
      .all() as SourceBlock[];
  }

  async remove(blockId: string): Promise<void> {
    this.db
      .query("DELETE FROM source_blocks WHERE block_id = $blockId;")
      .run({ $blockId: blockId });

    if (this.jsonStore) {
      await this.jsonStore.delete("source_blocks", blockId);
    }
  }
}
