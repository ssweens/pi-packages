import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AcpxRuntime, createAgentRegistry, createFileSessionStore } from "acpx/runtime";
import { normalize } from "../extensions/pi-strings/runtime/acpx-runtime.js";

const fixture = new URL("./fixtures/fake-acp-agent.ts", import.meta.url).pathname;

async function runtimeHarness() {
  const root = await mkdtemp(join(tmpdir(), "pi-strings-acpx-contract-"));
  const runtime = new AcpxRuntime({
    cwd: process.cwd(),
    sessionStore: createFileSessionStore({ stateDir: join(root, "sessions") }),
    agentRegistry: createAgentRegistry({ overrides: { fixture: [process.execPath, "--import", "tsx", fixture, join(root, "fixture-state.json")] } }),
    permissionMode: "deny-all",
    nonInteractivePermissions: "deny",
    timeoutMs: 0,
  });
  return { runtime, root };
}

async function collect(turn: ReturnType<AcpxRuntime["startTurn"]>): Promise<{ text: string; status: string }> {
  let text = "";
  const drain = (async () => { for await (const event of turn.events) if (event.type === "text_delta") text += event.text; })();
  const result = await turn.result; await drain;
  return { text, status: result.status };
}

test("acpx fixture preserves session context across turns and runtime reconnect", async () => {
  const { runtime, root } = await runtimeHarness();
  const handle = await runtime.ensureSession({ sessionKey: "continuity", agent: "fixture", mode: "persistent", cwd: process.cwd() });
  assert.equal((await collect(runtime.startTurn({ handle, text: "SET:nonce-42", requestId: "set", timeoutMs: 2_000, mode: "prompt" }))).status, "completed");
  assert.equal((await collect(runtime.startTurn({ handle, text: "GET", requestId: "get", timeoutMs: 2_000, mode: "prompt" }))).text, "NONCE:nonce-42");
  await runtime.close({ handle, reason: "reconnect", discardPersistentState: false });

  const replacement = new AcpxRuntime({
    cwd: process.cwd(),
    sessionStore: createFileSessionStore({ stateDir: join(root, "sessions") }),
    agentRegistry: createAgentRegistry({ overrides: { fixture: [process.execPath, "--import", "tsx", fixture, join(root, "fixture-state.json")] } }),
    permissionMode: "deny-all", nonInteractivePermissions: "deny", timeoutMs: 0,
  });
  assert.ok(handle.backendSessionId);
  const resumed = await replacement.ensureSession({ sessionKey: "continuity", agent: "fixture", mode: "persistent", cwd: process.cwd(), resumeSessionId: handle.backendSessionId });
  assert.equal(resumed.backendSessionId, handle.backendSessionId);
  assert.equal((await collect(replacement.startTurn({ handle: resumed, text: "GET", requestId: "resumed", timeoutMs: 2_000, mode: "prompt" }))).text, "NONCE:nonce-42");
  await replacement.close({ handle: resumed, reason: "done", discardPersistentState: true });
});

test("acpx fixture cancellation settles a blocked turn as cancelled", async () => {
  const { runtime } = await runtimeHarness();
  const handle = await runtime.ensureSession({ sessionKey: "cancel", agent: "fixture", mode: "persistent", cwd: process.cwd() });
  const turn = runtime.startTurn({ handle, text: "WAIT", requestId: "wait", timeoutMs: 2_000, mode: "prompt" });
  await turn.cancel({ reason: "test" });
  const result = await collect(turn);
  assert.equal(result.status, "cancelled");
  await runtime.close({ handle, reason: "done", discardPersistentState: true });
});

test("acpx 0.13 runtime exposes no genuine steering capability", async () => {
  const { runtime } = await runtimeHarness();
  const capabilities = await runtime.getCapabilities?.({});
  assert.equal(capabilities?.controls.includes("session/steer" as never), false);
});

test("normalize extracts usage from status events with breakdown and cost", () => {
  const statusWithUsage = normalize({ type: "status", text: "thinking", used: 100, size: 2000, breakdown: { inputTokens: 80, outputTokens: 20, totalTokens: 100 }, cost: { amount: 0.02, currency: "USD" } });
  assert.equal(statusWithUsage?.type, "status");
  assert.equal(statusWithUsage?.usage?.breakdown?.inputTokens, 80);
  assert.equal(statusWithUsage?.usage?.breakdown?.totalTokens, 100);
  assert.equal(statusWithUsage?.usage?.cost?.amount, 0.02);
  assert.equal(statusWithUsage?.usage?.cost?.currency, "USD");
});

test("normalize omits usage on status events without breakdown or cost", () => {
  const plainStatus = normalize({ type: "status", text: "thinking", used: 50, size: 1000 });
  assert.equal(plainStatus?.type, "status");
  assert.equal(plainStatus?.usage, undefined);
});

test("normalize maps text_delta events with thought stream", () => {
  const thought = normalize({ type: "text_delta", text: "reasoning", stream: "thought" });
  assert.equal(thought?.type, "text");
  if (thought?.type === "text") assert.equal(thought.stream, "thought");
  const output = normalize({ type: "text_delta", text: "result", stream: "output" });
  assert.equal(output?.type, "text");
  if (output?.type === "text") assert.equal(output.stream, "output");
});

test("normalize maps tool_call events", () => {
  const tool = normalize({ type: "tool_call", text: "read file.ts", status: "running" });
  assert.equal(tool?.type, "tool");
  assert.equal(tool?.text, "read file.ts");
  assert.equal(tool?.status, "running");
});

test("normalize returns null for unrecognized event types", () => {
  const unknown = normalize({ type: "custom" as never, text: "unknown" });
  assert.equal(unknown, null);
});
