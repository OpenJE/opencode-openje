import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { REWORK_DIR } from "../db/connection.js";

export class ArtifactsModule {
  constructor(private readonly root = process.cwd()) {}

  artifactPath(dir: string, filename: string): string {
    return join(this.root, REWORK_DIR, dir, filename);
  }

  async writeArtifact(dir: string, filename: string, data: unknown): Promise<string> {
    const path = this.artifactPath(dir, filename);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    return path;
  }

  async readArtifact(dir: string, filename: string): Promise<unknown> {
    const path = this.artifactPath(dir, filename);
    return JSON.parse(await readFile(path, "utf8"));
  }
}
