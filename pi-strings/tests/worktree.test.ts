import assert from "node:assert/strict";
import test from "node:test";
import { requireCwdUnowned, requireIsolatedWriter, requireWriterUnowned } from "../extensions/pi-strings/domain/worktree.ts";
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

test("requireCwdUnowned rejects a second live writer in the same cwd but allows a closed or distinct one", () => {
  const profile = { agent: "pi", role: "writer" as const, tools: ["write"], timeoutMs: 1_000, cancellationGraceMs: 100, maxOutputBytes: 1_024 };
  const base = { profileName: "writer", profile, role: "writer" as const, handle: { sessionKey: "x", backend: "fake", runtimeSessionName: "x" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const owner: WorkerRecord = { ...base, name: "owner", status: "idle", cwd: "/repo" };
  assert.throws(() => requireCwdUnowned([owner], "/repo"), (error: unknown) => (error as { code?: string }).code === "WRITER_CWD_OWNED");
  assert.doesNotThrow(() => requireCwdUnowned([{ ...owner, status: "closed" }], "/repo"));
  assert.doesNotThrow(() => requireCwdUnowned([owner], "/repo", "owner"));
  assert.doesNotThrow(() => requireCwdUnowned([owner], "/other-repo"));
});

test("requireCwdUnowned ignores read-only workers", () => {
  const profile = { agent: "pi", role: "read-only" as const, tools: ["read"], timeoutMs: 1_000, cancellationGraceMs: 100, maxOutputBytes: 1_024 };
  const reader: WorkerRecord = { name: "reader", profileName: "reviewer", profile, role: "read-only", status: "idle", cwd: "/repo", handle: { sessionKey: "reader", backend: "fake", runtimeSessionName: "reader" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  assert.doesNotThrow(() => requireCwdUnowned([reader], "/repo"));
});
