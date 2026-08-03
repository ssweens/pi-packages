import assert from "node:assert/strict";
import test from "node:test";
import { requireIsolatedWriter, requireWriterUnowned } from "../extensions/pi-strings/domain/worktree.ts";
import type { WorkerRecord, WorktreeIdentity } from "../extensions/pi-strings/domain/types.ts";

test("writer rejects the parent checkout", async () => {
  await assert.rejects(requireIsolatedWriter(process.cwd(), process.cwd()), (error: unknown) => (error as { code?: string }).code === "WRITER_ISOLATION_REQUIRED");
});

test("two live writers cannot own the same canonical worktree", () => {
  const worktree: WorktreeIdentity = { worktreeRoot: "/tmp/worktree", gitDir: "/repo/.git/worktrees/test", commonDir: "/repo/.git" };
  const profile = { agent: "pi", role: "writer" as const, tools: ["write"], timeoutMs: 1_000, cancellationGraceMs: 100, maxOutputBytes: 1_024 };
  const owner: WorkerRecord = { name: "owner", profileName: "writer", profile, role: "writer", status: "idle", cwd: worktree.worktreeRoot, worktree, handle: { sessionKey: "owner", backend: "fake", runtimeSessionName: "owner" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  assert.throws(() => requireWriterUnowned([owner], worktree), (error: unknown) => (error as { code?: string }).code === "WRITER_WORKTREE_OWNED");
  assert.doesNotThrow(() => requireWriterUnowned([{ ...owner, status: "closed" }], worktree));
});
