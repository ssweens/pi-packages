import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AcpxRuntime, createAgentRegistry, createFileSessionStore } from "acpx/runtime";

const fixture = new URL("./fixtures/fake-acp-agent.ts", import.meta.url).pathname;

async function runtimeHarness() {
  const root = await mkdtemp(join(tmpdir(), "pi-strings-acpx-contract-"));
  const runtime = new AcpxRuntime({
    cwd: process.cwd(),
    sessionStore: createFileSessionStore({ stateDir: join(root, "sessions") }),
    agentRegistry: createAgentRegistry({ overrides: { fixture: [process.execPath, "--import", "tsx", fixture, join(root, "fixture-state.json")] } }),
    permissionMode: "deny-all",
    nonInteractivePermissions: "fail",
    timeoutMs: 2_000,
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
    permissionMode: "deny-all", nonInteractivePermissions: "fail", timeoutMs: 2_000,
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
