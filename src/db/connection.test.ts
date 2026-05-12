import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, ensureWorkdir, openDatabase, REWORK_SUBDIRS } from "./connection.js";

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "agentic-re-db-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("ensureWorkdir", () => {
  test("creates .rework and required subdirectories", () => {
    const root = tempRoot();

    const workdir = ensureWorkdir(root);

    expect(workdir).toBe(join(root, ".rework"));
    expect(existsSync(workdir)).toBe(true);
    for (const subdir of REWORK_SUBDIRS) {
      expect(existsSync(join(workdir, subdir))).toBe(true);
    }
  });

  test("rejects an empty root path", () => {
    expect(() => ensureWorkdir("")).toThrow(/DB_ERROR/);
  });

  test("throws when the root cannot contain a .rework directory", () => {
    const rootFile = join(tempRoot(), "not-a-directory");
    writeFileSync(rootFile, "file roots are invalid");

    expect(() => ensureWorkdir(rootFile)).toThrow(/DB_ERROR/);
  });
});

describe("openDatabase", () => {
  test("opens .rework/re.db with WAL mode enabled", () => {
    const root = tempRoot();

    const db = openDatabase(root);
    try {
      const journalMode = db.query("PRAGMA journal_mode;").get() as { journal_mode: string };

      expect(existsSync(join(root, ".rework", "re.db"))).toBe(true);
      expect(journalMode.journal_mode.toLowerCase()).toBe("wal");
    } finally {
      closeDatabase(db);
    }
  });
});
