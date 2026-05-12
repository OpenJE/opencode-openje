import type { Database } from "bun:sqlite";
import type { SourceSymbol, SourceSymbolKind, SourceSymbolStatus } from "../db/types.js";

export type CreateSymbolInput = {
  symbolId: string;
  kind: SourceSymbolKind;
  name: string;
  namespace?: string;
  originEa?: string;
  definitionJson?: string;
};

type ListFilter = {
  kind?: string;
  status?: string;
  originEa?: string;
};

type UpdatableColumn = Exclude<keyof SourceSymbol, "symbol_id">;

const UPDATE_COLUMNS: readonly UpdatableColumn[] = [
  "kind",
  "name",
  "namespace",
  "origin_ea",
  "contract_version",
  "definition_json",
  "status",
] as const;

export class SourceSymbolsModule {
  constructor(private readonly db: Database) {}

  async create(input: CreateSymbolInput): Promise<SourceSymbol> {
    this.db
      .query(
        `INSERT INTO source_symbols (
           symbol_id,
           kind,
           name,
           namespace,
           origin_ea,
           contract_version,
           definition_json,
           status
         ) VALUES (
           $symbolId,
           $kind,
           $name,
           $namespace,
           $originEa,
           NULL,
           $definitionJson,
           $status
         );`,
      )
      .run({
        $symbolId: input.symbolId,
        $kind: input.kind,
        $name: input.name,
        $namespace: input.namespace ?? null,
        $originEa: input.originEa ?? null,
        $definitionJson: input.definitionJson ?? null,
        $status: "unplaced" satisfies SourceSymbolStatus,
      });

    const symbol = await this.get(input.symbolId);
    if (!symbol) {
      throw new Error(`Failed to create source symbol ${input.symbolId}`);
    }

    return symbol;
  }

  async get(symbolId: string): Promise<SourceSymbol | null> {
    return this.db
      .query("SELECT * FROM source_symbols WHERE symbol_id = $symbolId;")
      .get({ $symbolId: symbolId }) as SourceSymbol | null;
  }

  async list(filter: ListFilter = {}): Promise<SourceSymbol[]> {
    const where: string[] = [];
    const params: Record<string, string> = {};

    if (filter.kind !== undefined) {
      where.push("kind = $kind");
      params.$kind = filter.kind;
    }

    if (filter.status !== undefined) {
      where.push("status = $status");
      params.$status = filter.status;
    }

    if (filter.originEa !== undefined) {
      where.push("origin_ea = $originEa");
      params.$originEa = filter.originEa;
    }

    const whereSql = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
    return this.db.query(`SELECT * FROM source_symbols${whereSql} ORDER BY symbol_id ASC;`).all(params) as SourceSymbol[];
  }

  async updateStatus(symbolId: string, status: SourceSymbolStatus): Promise<void> {
    this.db
      .query("UPDATE source_symbols SET status = $status WHERE symbol_id = $symbolId;")
      .run({ $symbolId: symbolId, $status: status });
  }

  async update(symbolId: string, updates: Partial<SourceSymbol>): Promise<void> {
    const setClauses: string[] = [];
    const params: Record<string, SourceSymbol[UpdatableColumn] | string> = { $symbolId: symbolId };

    for (const column of UPDATE_COLUMNS) {
      const value = updates[column];
      if (value === undefined) {
        continue;
      }

      const paramName = `$${column}`;
      setClauses.push(`${column} = ${paramName}`);
      params[paramName] = value;
    }

    if (setClauses.length === 0) {
      return;
    }

    this.db.query(`UPDATE source_symbols SET ${setClauses.join(", ")} WHERE symbol_id = $symbolId;`).run(params);
  }

  async remove(symbolId: string): Promise<void> {
    this.db.query("DELETE FROM source_symbols WHERE symbol_id = $symbolId;").run({ $symbolId: symbolId });
  }
}
