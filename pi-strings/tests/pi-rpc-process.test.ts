import assert from "node:assert/strict";
import { chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PiRpcProcess } from "../vendor/pi-acp/src/pi-rpc/process.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fakePi = resolve(here, "fixtures/fake-pi.mjs");

test("Pi RPC preserves Unicode separators and applies worker startup policy", async () => {
  await chmod(fakePi, 0o755);
  const prior = { worker: process.env.PI_STRINGS_WORKER, tools: process.env.PI_STRINGS_PI_TOOLS };
  process.env.PI_STRINGS_WORKER = "1";
  process.env.PI_STRINGS_PI_TOOLS = JSON.stringify(["read", "grep"]);
  const events: Record<string, unknown>[] = [];
  const proc = await PiRpcProcess.spawn({ cwd: here, piCommand: fakePi, startupTimeoutMs: 1_000 });
  try {
    proc.onEvent((event) => events.push(event));
    const state = await proc.getState({ timeoutMs: 1_000 }) as { stateCalls: number };
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.stateCalls, 2);
    assert.equal(events[0]?.text, "line separator preserved");
    assert.match(proc.stderrSummary(), /--no-extensions/);
    assert.match(proc.stderrSummary(), /--tools/);
  } finally {
    await proc.terminate(100);
    if (prior.worker === undefined) delete process.env.PI_STRINGS_WORKER; else process.env.PI_STRINGS_WORKER = prior.worker;
    if (prior.tools === undefined) delete process.env.PI_STRINGS_PI_TOOLS; else process.env.PI_STRINGS_PI_TOOLS = prior.tools;
  }
});

test("Pi RPC acknowledges native steering", async () => {
  const proc = await PiRpcProcess.spawn({ cwd: here, piCommand: fakePi, startupTimeoutMs: 1_000 });
  try { await proc.steer("redirect now"); } finally { await proc.terminate(100); }
});

test("Pi RPC requests reject on deadline", async () => {
  const prior = process.env.FAKE_PI_IGNORE_MODELS;
  process.env.FAKE_PI_IGNORE_MODELS = "1";
  const proc = await PiRpcProcess.spawn({ cwd: here, piCommand: fakePi, startupTimeoutMs: 1_000 });
  try {
    await assert.rejects(proc.getAvailableModels({ timeoutMs: 50 }), /timed out after 50ms/);
  } finally {
    await proc.terminate(100);
    if (prior === undefined) delete process.env.FAKE_PI_IGNORE_MODELS; else process.env.FAKE_PI_IGNORE_MODELS = prior;
  }
});

test("complete oversized LF-delimited records fail the startup handshake", async () => {
  const prior = process.env.FAKE_PI_OVERSIZED;
  process.env.FAKE_PI_OVERSIZED = "1";
  try {
    await assert.rejects(PiRpcProcess.spawn({ cwd: here, piCommand: fakePi, startupTimeoutMs: 2_000 }), /record exceeded/);
  } finally {
    if (prior === undefined) delete process.env.FAKE_PI_OVERSIZED; else process.env.FAKE_PI_OVERSIZED = prior;
  }
});

test("process termination is single-flight", async () => {
  const proc = await PiRpcProcess.spawn({ cwd: here, piCommand: fakePi, startupTimeoutMs: 1_000 });
  const first = proc.terminate(100);
  const second = proc.terminate(100);
  assert.equal(first, second);
  await first;
});
