import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import piStrings from "../extensions/pi-strings/index.ts";
import { permissionModeFor, writerPermissionDecision } from "../extensions/pi-strings/runtime/acpx-runtime.ts";
import type { Profile } from "../extensions/pi-strings/domain/types.ts";

test("registers exactly one strings tool in a parent", () => {
  const tools: unknown[] = [];
  piStrings({ on: () => undefined, registerTool: (tool: unknown) => tools.push(tool) } as never);
  assert.equal(tools.length, 1);
  assert.equal((tools[0] as { name: string }).name, "strings");
});

test("ACP permissions fail closed and physically confine writer edits to the assigned cwd", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-strings-permission-"));
  const cwd = join(root, "worktree");
  const outside = join(root, "parent");
  await mkdir(cwd); await mkdir(outside); await writeFile(join(outside, "file.ts"), "outside");
  await symlink(outside, join(cwd, "escape"));
  await symlink(join(outside, "future.ts"), join(cwd, "dangling.ts"));
  await symlink(join(outside, "future-directory"), join(cwd, "dangling-directory"));
  const base = { agent: "codex", tools: ["read", "edit", "write"], timeoutMs: 1_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 };
  const writer = { ...base, role: "writer" } satisfies Profile;
  assert.equal(permissionModeFor(writer), "deny-all");
  assert.deepEqual(writerPermissionDecision(cwd, writer, { inferredKind: "edit", raw: { toolCall: { name: "edit", locations: [{ path: join(cwd, "file.ts") }] } } }), { outcome: "allow_once" });
  assert.deepEqual(writerPermissionDecision(cwd, writer, { inferredKind: "write", raw: { toolCall: { name: "write", locations: [{ path: join(cwd, "inside-write.ts") }] } } }), { outcome: "allow_once" });
  assert.deepEqual(writerPermissionDecision(cwd, writer, { inferredKind: "other", raw: { toolCall: { name: "write", locations: [{ path: join(cwd, "inside-other.ts") }] } } }), { outcome: "allow_once" });
  assert.deepEqual(writerPermissionDecision(cwd, writer, { inferredKind: "other", raw: { toolCall: { title: "write", rawInput: { filePath: join(cwd, "inside-title.ts") }, locations: [{ path: join(cwd, "inside-title.ts") }] } } }), { outcome: "allow_once" });
  assert.deepEqual(writerPermissionDecision(cwd, writer, { inferredKind: "edit", raw: { toolCall: { name: "edit", locations: [{ path: join(outside, "file.ts") }] } } }), { outcome: "reject_once" });
  assert.deepEqual(writerPermissionDecision(cwd, writer, { inferredKind: "edit", raw: { toolCall: { name: "edit", locations: [{ path: join(cwd, "escape", "file.ts") }] } } }), { outcome: "reject_once" });
  assert.deepEqual(writerPermissionDecision(cwd, writer, { inferredKind: "edit", raw: { toolCall: { name: "edit", locations: [{ path: join(cwd, "dangling.ts") }] } } }), { outcome: "reject_once" });
  assert.deepEqual(writerPermissionDecision(cwd, writer, { inferredKind: "edit", raw: { toolCall: { name: "edit", locations: [{ path: join(cwd, "dangling-directory", "file.ts") }] } } }), { outcome: "reject_once" });
  assert.deepEqual(writerPermissionDecision(cwd, writer, { inferredKind: "execute", raw: { toolCall: { name: "bash", locations: [{ path: cwd }] } } }), { outcome: "reject_once" });
});

test("does not expose recursive orchestration in a worker", () => {
  const prior = process.env.PI_STRINGS_WORKER;
  process.env.PI_STRINGS_WORKER = "1";
  const tools: unknown[] = [];
  piStrings({ on: () => undefined, registerTool: (tool: unknown) => tools.push(tool) } as never);
  assert.equal(tools.length, 0);
  if (prior === undefined) delete process.env.PI_STRINGS_WORKER; else process.env.PI_STRINGS_WORKER = prior;
});
