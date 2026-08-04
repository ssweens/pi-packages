import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AcpxRuntimePort, normalize } from "../extensions/pi-strings/runtime/acpx-runtime.ts";
import type { Profile } from "../extensions/pi-strings/domain/types.ts";

const fakePi = new URL("./fixtures/fake-pi.mjs", import.meta.url).pathname;
const profile: Profile = { agent: "pi", role: "read-only", tools: ["read"], timeoutMs: 2_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 };

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
}

test("tool normalization preserves identity and derives a fingerprint without exposing raw input", () => {
  const normalized = normalize({ type: "tool_call", text: "read (pending)", toolCallId: "call-1", title: "read", rawInput: { path: "file.ts" }, status: "pending" });
  assert.equal(normalized?.type, "tool");
  if (normalized?.type === "tool") {
    assert.equal(normalized.toolCallId, "call-1");
    assert.match(normalized.toolFingerprint ?? "", /^read\u0000[0-9a-f]{64}$/);
  }
  assert.doesNotMatch(JSON.stringify(normalized), /rawInput|file\.ts/);
});

async function collect(turn: ReturnType<AcpxRuntimePort["startTurn"]>): Promise<{ status: string; output: string }> {
  let output = "";
  const drain = (async () => { for await (const event of turn.events) if (event.type === "text") output += event.text; })();
  const result = await turn.result;
  await drain;
  return { status: result.status, output };
}

test("Pi uses ACPX session continuity across a fresh runtime", async () => {
  const priorCommand = process.env.PI_ACP_PI_COMMAND;
  const priorState = process.env.FAKE_PI_STATE_FILE;
  const priorSession = process.env.FAKE_PI_SESSION_FILE;
  const cwd = await mkdtemp(join(tmpdir(), "pi-strings-pi-acpx-resume-"));
  process.env.PI_ACP_PI_COMMAND = fakePi;
  process.env.FAKE_PI_STATE_FILE = join(cwd, "fake-state.txt");
  process.env.FAKE_PI_SESSION_FILE = join(cwd, "fake-session.jsonl");
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-pi-acpx-state-"));
  const first = new AcpxRuntimePort(cwd, stateDir, profile);
  const second = new AcpxRuntimePort(cwd, stateDir, profile);
  let firstHandle: Awaited<ReturnType<AcpxRuntimePort["ensureSession"]>> | undefined;
  let secondHandle: Awaited<ReturnType<AcpxRuntimePort["ensureSession"]>> | undefined;
  try {
    firstHandle = await first.ensureSession({ name: "resume", agent: "pi", cwd, profile });
    const modelStatus = await first.getStatus(firstHandle);
    assert.equal(modelStatus.modelDiscoverySupported, true);
    assert.ok(modelStatus.availableModelIds.includes("fixture/model"));
    assert.equal((await collect(first.startTurn({ handle: firstHandle, prompt: "SET:nonce-42", requestId: "set", timeoutMs: 2_000 }))).status, "completed");
    await first.close(firstHandle, "reconnect", false);
    assert.ok(firstHandle.backendSessionId);
    secondHandle = await second.ensureSession({ name: "resume", agent: "pi", cwd, profile, resumeSessionId: firstHandle.backendSessionId });
    assert.equal(secondHandle.backendSessionId, firstHandle.backendSessionId);
    assert.deepEqual(await collect(second.startTurn({ handle: secondHandle, prompt: "GET", requestId: "get", timeoutMs: 2_000 })), { status: "completed", output: "NONCE:nonce-42" });
  } finally {
    if (secondHandle) await second.close(secondHandle, "done", true).catch(() => undefined);
    else if (firstHandle) await first.close(firstHandle, "done", true).catch(() => undefined);
    restore("PI_ACP_PI_COMMAND", priorCommand);
    restore("FAKE_PI_STATE_FILE", priorState);
    restore("FAKE_PI_SESSION_FILE", priorSession);
  }
});
