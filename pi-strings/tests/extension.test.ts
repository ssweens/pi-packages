import assert from "node:assert/strict";
import test from "node:test";
import piStrings from "../extensions/pi-strings/index.ts";
import { permissionModeFor } from "../extensions/pi-strings/runtime/acpx-runtime.ts";
import type { Profile } from "../extensions/pi-strings/domain/types.ts";

test("registers the op_* tools in a parent", () => {
  const tools: unknown[] = [];
  piStrings({ on: () => undefined, registerTool: (tool: unknown) => tools.push(tool) } as never);
  assert.deepEqual(tools.map((tool) => (tool as { name: string }).name), ["op_spawn", "op_status", "op_send", "op_wait", "op_result", "op_list", "op_cancel", "op_close"]);
});

test("routes profile roles to ACPX permission modes", () => {
  const base = { agent: "codex", tools: ["read", "edit", "write"], timeoutMs: 1_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 };
  assert.equal(permissionModeFor({ ...base, role: "writer" } satisfies Profile), "approve-reads");
  assert.equal(permissionModeFor({ ...base, role: "read-only" } satisfies Profile), "approve-reads");
});

test("does not expose recursive orchestration in a worker", () => {
  const prior = process.env.PI_STRINGS_WORKER;
  process.env.PI_STRINGS_WORKER = "1";
  const tools: unknown[] = [];
  piStrings({ on: () => undefined, registerTool: (tool: unknown) => tools.push(tool) } as never);
  assert.equal(tools.length, 0);
  if (prior === undefined) delete process.env.PI_STRINGS_WORKER; else process.env.PI_STRINGS_WORKER = prior;
});
