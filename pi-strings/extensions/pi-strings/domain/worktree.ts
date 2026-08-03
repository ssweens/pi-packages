import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import type { WorkerRecord, WorktreeIdentity } from "./types.js";
import { StringsError } from "./errors.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 10_000 });
    return stdout.trim();
  } catch (error) {
    throw new StringsError("WRITER_ISOLATION_REQUIRED", `Cannot inspect git worktree at ${cwd}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function canonical(path: string): Promise<string> {
  try { return await realpath(path); } catch { return path; }
}

export async function inspectWorktree(cwd: string): Promise<WorktreeIdentity> {
  const canonicalCwd = await realpath(cwd);
  const [top, gitDir, commonDir] = await Promise.all([
    git(canonicalCwd, "rev-parse", "--show-toplevel"),
    git(canonicalCwd, "rev-parse", "--path-format=absolute", "--git-dir"),
    git(canonicalCwd, "rev-parse", "--path-format=absolute", "--git-common-dir"),
  ]);
  return { worktreeRoot: await canonical(top), gitDir: await canonical(gitDir), commonDir: await canonical(commonDir) };
}

export function requireWriterUnowned(workers: Iterable<WorkerRecord>, worktree: WorktreeIdentity, exceptName?: string): void {
  for (const worker of workers) {
    if (worker.name === exceptName || worker.role !== "writer" || worker.status === "closed") continue;
    if (worker.worktree?.gitDir === worktree.gitDir) {
      throw new StringsError("WRITER_WORKTREE_OWNED", `Writer ${worker.name} already owns worktree ${worktree.worktreeRoot}.`);
    }
  }
}

export function requireCwdUnowned(workers: Iterable<WorkerRecord>, cwd: string, exceptName?: string): void {
  for (const worker of workers) {
    if (worker.name === exceptName || worker.role !== "writer" || worker.status === "closed") continue;
    if (worker.cwd === cwd) {
      throw new StringsError("WRITER_CWD_OWNED", `Writer ${worker.name} is already running in ${cwd}.`);
    }
  }
}

export async function requireIsolatedWriter(cwd: string, parentCwd: string): Promise<WorktreeIdentity> {
  const [worker, parent] = await Promise.all([inspectWorktree(cwd), inspectWorktree(parentCwd)]);
  if (worker.gitDir === worker.commonDir || worker.worktreeRoot === parent.worktreeRoot) {
    throw new StringsError("WRITER_ISOLATION_REQUIRED", "Writer cwd must be an existing linked worktree distinct from the parent checkout.");
  }
  return worker;
}
