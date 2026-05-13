import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { dirname, join } from "node:path";
import { REWORK_DIR } from "../db/connection.js";
import type { JsonStore as JsonStoreContract } from "./types.js";

type JsonRecord = Record<string, unknown>;

export class JsonStore implements JsonStoreContract {
  constructor(private readonly root: string) {}

  async write(tableDir: string, key: string, data: JsonRecord): Promise<void> {
    const path = this.recordPath(tableDir, key);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  async read(tableDir: string, key: string): Promise<JsonRecord | null> {
    const data = await this.readRaw(tableDir, key);

    if (isTombstone(data)) {
      return null;
    }

    return data;
  }

  async delete(tableDir: string, key: string): Promise<void> {
    await this.write(tableDir, key, tombstone(tableDir, key));
  }

  async list(tableDir: string): Promise<string[]> {
    const dir = this.tablePath(tableDir);
    const entries = await safeReadDir(dir, { withFileTypes: true });
    const keys: string[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const key = entry.name.slice(0, -".json".length);
      if ((await this.read(tableDir, key)) !== null) {
        keys.push(key);
      }
    }

    return keys.sort();
  }

  async listAll(): Promise<Map<string, string[]>> {
    const workdir = join(this.root, REWORK_DIR);
    const entries = await safeReadDir(workdir, { withFileTypes: true });
    const tables = new Map<string, string[]>();

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      tables.set(entry.name, await this.list(entry.name));
    }

    return new Map([...tables.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }

  async readRaw(tableDir: string, key: string): Promise<JsonRecord | null> {
    try {
      return JSON.parse(await readFile(this.recordPath(tableDir, key), "utf8")) as JsonRecord;
    } catch (cause) {
      if (isNotFoundError(cause)) {
        return null;
      }

      throw cause;
    }
  }

  private tablePath(tableDir: string): string {
    return join(this.root, REWORK_DIR, tableDir);
  }

  private recordPath(tableDir: string, key: string): string {
    return join(this.tablePath(tableDir), `${key}.json`);
  }
}

export class InMemoryJsonStore implements JsonStoreContract {
  private readonly tables = new Map<string, Map<string, JsonRecord>>();

  async write(tableDir: string, key: string, data: JsonRecord): Promise<void> {
    this.table(tableDir).set(key, structuredClone(data));
  }

  async read(tableDir: string, key: string): Promise<JsonRecord | null> {
    const data = await this.readRaw(tableDir, key);

    if (isTombstone(data)) {
      return null;
    }

    return data;
  }

  async delete(tableDir: string, key: string): Promise<void> {
    await this.write(tableDir, key, tombstone(tableDir, key));
  }

  async list(tableDir: string): Promise<string[]> {
    const table = this.tables.get(tableDir);

    if (table === undefined) {
      return [];
    }

    const keys: string[] = [];
    for (const [key, value] of table.entries()) {
      if (!isTombstone(value)) {
        keys.push(key);
      }
    }

    return keys.sort();
  }

  async listAll(): Promise<Map<string, string[]>> {
    const tables = new Map<string, string[]>();

    for (const tableDir of this.tables.keys()) {
      tables.set(tableDir, await this.list(tableDir));
    }

    return new Map([...tables.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }

  async readRaw(tableDir: string, key: string): Promise<JsonRecord | null> {
    const data = this.tables.get(tableDir)?.get(key);

    if (data === undefined) {
      return null;
    }

    return structuredClone(data);
  }

  private table(tableDir: string): Map<string, JsonRecord> {
    let table = this.tables.get(tableDir);

    if (table === undefined) {
      table = new Map();
      this.tables.set(tableDir, table);
    }

    return table;
  }
}

function tombstone(tableDir: string, key: string): JsonRecord {
  return {
    _deleted: true,
    _deleted_at: new Date().toISOString(),
    _table: tableDir,
    _key: key,
  };
}

function isTombstone(data: JsonRecord | null): boolean {
  return data?._deleted === true;
}

function isNotFoundError(cause: unknown): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

async function safeReadDir(
  path: string,
  options: { withFileTypes: true },
): Promise<Dirent[]> {
  try {
    return await readdir(path, options);
  } catch (cause) {
    if (isNotFoundError(cause)) {
      return [];
    }

    throw cause;
  }
}
