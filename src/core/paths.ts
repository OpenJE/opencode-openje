import { join } from "node:path";

export const WORKDIR_NAME = ".rework";

export const WORKDIR_SUBDIRS = [
  "packets",
  "worker_outputs",
  "reviews",
  "summaries",
  "traversal_logs",
  "source_map",
  "patch_plans",
  "artifacts",
] as const;

export type WorkdirSubdir = typeof WORKDIR_SUBDIRS[number];

export function getWorkdirRoot(root: string): string {
  return join(root, WORKDIR_NAME);
}

export function getWorkdirSubdir(root: string, subdir: WorkdirSubdir): string {
  return join(getWorkdirRoot(root), subdir);
}

export function getPacketsDir(root: string): string {
  return getWorkdirSubdir(root, "packets");
}

export function getWorkerOutputsDir(root: string): string {
  return getWorkdirSubdir(root, "worker_outputs");
}

export function getReviewsDir(root: string): string {
  return getWorkdirSubdir(root, "reviews");
}

export function getSummariesDir(root: string): string {
  return getWorkdirSubdir(root, "summaries");
}

export function getTraversalLogsDir(root: string): string {
  return getWorkdirSubdir(root, "traversal_logs");
}

export function getSourceMapDir(root: string): string {
  return getWorkdirSubdir(root, "source_map");
}

export function getPatchPlansDir(root: string): string {
  return getWorkdirSubdir(root, "patch_plans");
}

export function getArtifactsDir(root: string): string {
  return getWorkdirSubdir(root, "artifacts");
}
