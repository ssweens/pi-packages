import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Coordinator, resumeIdentityMatches } from "../extensions/pi-strings/orchestration/coordinator.ts";
import { StateStore } from "../extensions/pi-strings/persistence/state-store.ts";
import type { NormalizedEvent, Profile, RuntimeHandle, RuntimePort, RuntimeStatus, RuntimeTerminal, RuntimeTurn } from "../extensions/pi-strings/domain/types.ts";

class Deferred<T> {
  promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (error: unknown) => void;
  constructor() { this.promise = new Promise<T>((resolve, reject) => { this.resolve = resolve; this.reject = reject; }); }
}

class EventQueue implements AsyncIterable<NormalizedEvent> {
  private values: NormalizedEvent[] = [];
  private waiters: Array<() => void> = [];
  private ended = false;
  private failure?: Error;
  push(value: NormalizedEvent): void { this.values.push(value); this.waiters.shift()?.(); }
  end(): void { this.ended = true; while (this.waiters.length) this.waiters.shift()?.(); }
  fail(error: Error): void { this.failure = error; this.end(); }
  clear(): void { this.values = []; }
  async *[Symbol.asyncIterator](): AsyncIterator<NormalizedEvent> {
    while (!this.ended || this.values.length > 0) {
      if (this.values.length > 0) { yield this.values.shift()!; continue; }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    if (this.failure) throw this.failure;
  }
}

class ControlledTurn implements RuntimeTurn {
  readonly resultControl = new Deferred<RuntimeTerminal>();
  readonly result = this.resultControl.promise;
  readonly stream = new EventQueue();
  cancelled = false;
  closed = false;
  cancelMode: "resolve" | "reject" | "hang" = "resolve";
  closeMode: "resolve" | "reject" | "hang" = "resolve";
  clearOnClose = false;
  onCancel?: () => void;
  constructor(readonly requestId: string) {}
  readonly events: AsyncIterable<NormalizedEvent> = this.stream;
  async cancel(): Promise<void> {
    this.cancelled = true;
    if (this.cancelMode === "reject") throw new Error("cancel rejected");
    if (this.cancelMode === "hang") await new Promise<void>(() => undefined);
    this.onCancel?.();
  }
  async closeStream(): Promise<void> {
    this.closed = true;
    if (this.closeMode === "reject") throw new Error("stream close rejected");
    if (this.closeMode === "hang") await new Promise<void>(() => undefined);
    if (this.clearOnClose) this.stream.clear();
    this.stream.end();
  }
  emit(event: NormalizedEvent): void { this.stream.push(event); }
  finish(terminal: RuntimeTerminal, events: NormalizedEvent[] = []): void { for (const event of events) this.stream.push(event); this.stream.end(); this.resultControl.resolve(terminal); }
  finishResult(terminal: RuntimeTerminal): void { this.resultControl.resolve(terminal); }
  finishResultWithEvents(terminal: RuntimeTerminal, events: NormalizedEvent[]): void {
    for (const event of events) this.stream.push(event);
    this.resultControl.resolve(terminal);
  }
  failStream(error: Error, terminal: RuntimeTerminal): void { this.stream.fail(error); this.resultControl.resolve(terminal); }
}

class FakeRuntime implements RuntimePort {
  readonly turns: ControlledTurn[] = [];
  ensureCalls = 0;
  closed = false;
  throwOnNextStart = false;
  rejectClose = false;
  hangClose = false;
  closeDiscards: boolean[] = [];
  ensureGate?: Promise<void>;
  lastPrompt?: string;
  setConfigOptionCalls: Array<{ key: string; value: string }> = [];
  currentModelId?: string;
  availableModelIds = ["primary", "backup", "third"];
  async ensureSession(input: { name: string; cwd: string; profile?: Profile }): Promise<RuntimeHandle> {
    this.ensureCalls += 1;
    if (input.profile?.model) this.currentModelId = input.profile.model;
    await this.ensureGate;
    return { sessionKey: input.name, backend: "fake", runtimeSessionName: input.name, cwd: input.cwd, backendSessionId: `session-${input.name}` };
  }
  startTurn(input: { requestId: string; prompt: string }): RuntimeTurn {
    if (this.throwOnNextStart) { this.throwOnNextStart = false; throw new Error("start failed"); }
    this.lastPrompt = input.prompt;
    const turn = new ControlledTurn(input.requestId); this.turns.push(turn); return turn;
  }
  async getStatus(_handle: RuntimeHandle): Promise<RuntimeStatus> {
    return { modelDiscoverySupported: true, ...(this.currentModelId ? { currentModelId: this.currentModelId } : {}), availableModelIds: this.availableModelIds };
  }
  async setConfigOption(input: { handle: RuntimeHandle; key: string; value: string }): Promise<void> {
    this.setConfigOptionCalls.push({ key: input.key, value: input.value });
    if (input.key === "model") this.currentModelId = input.value;
  }
  async close(_handle: RuntimeHandle, _reason: string, discardPersistentState: boolean): Promise<void> {
    this.closed = true;
    this.closeDiscards.push(discardPersistentState);
    if (this.rejectClose) throw new Error("close failed");
    if (this.hangClose) await new Promise<void>(() => undefined);
  }
}

async function harness(profile?: Profile) {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-coordinator-"));
  const runtimes: FakeRuntime[] = [];
  const coordinator = new Coordinator(process.cwd(), {
    stateDir,
    ...(profile ? { profiles: { "pi-reviewer": profile } } : {}),
    runtimeFactory: (_cwd: string, _state: string, _profile: Profile) => { const runtime = new FakeRuntime(); runtimes.push(runtime); return runtime; },
  });
  return { coordinator, runtimes, stateDir };
}

async function harnessProfiles(profiles: Record<string, Profile>) {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-coordinator-"));
  const runtimes: FakeRuntime[] = [];
  const coordinator = new Coordinator(process.cwd(), {
    stateDir, profiles,
    runtimeFactory: (_cwd: string, _state: string, _profile: Profile) => { const runtime = new FakeRuntime(); runtimes.push(runtime); return runtime; },
  });
  return { coordinator, runtimes, stateDir };
}

async function spawnProfile(coordinator: Coordinator, name: string, profile: string, cwd: string = process.cwd()) {
  const result = await coordinator.execute({ action: "spawn", name, profile, cwd });
  assert.equal(result.ok, true, `spawn ${name} failed: ${result.ok ? "" : JSON.stringify((result as { error?: unknown }).error)}`);
  return result;
}

const WRITER: Profile = { agent: "pi", role: "writer", kind: "worker", tools: ["read", "grep", "find", "ls", "bash", "edit", "write"], isolation: "shared", timeoutMs: 10_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 };
const WORKTREE_WRITER: Profile = { ...WRITER, isolation: "worktree" };
const ORACLE: Profile = { agent: "pi", role: "read-only", kind: "oracle", tools: ["read", "grep", "find", "ls"], timeoutMs: 10_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 };
const FINDER: Profile = { agent: "pi", role: "read-only", kind: "finder", tools: ["read", "grep", "find", "ls"], timeoutMs: 10_000, cancellationGraceMs: 100, maxOutputBytes: 4_096, maxTurns: 12 };
const REVIEWER: Profile = { agent: "pi", role: "read-only", kind: "free", tools: ["read", "grep", "find", "ls"], timeoutMs: 10_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 };

async function waitFor(predicate: () => Promise<boolean>, attempts = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error("observable condition did not become true");
}

async function spawn(coordinator: Coordinator, name: string) {
  const result = await coordinator.execute({ action: "spawn", name, profile: "pi-reviewer", cwd: process.cwd() });
  assert.equal(result.ok, true);
}

test("one worker rejects a second turn while different workers overlap", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "alpha");
    await spawn(coordinator, "beta");
    const [first, duplicate, secondWorker] = await Promise.all([
      coordinator.execute({ action: "send", name: "alpha", prompt: "first" }),
      coordinator.execute({ action: "send", name: "alpha", prompt: "duplicate" }),
      coordinator.execute({ action: "send", name: "beta", prompt: "parallel" }),
    ]);
    assert.equal(first.ok, true);
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) assert.equal(duplicate.error.code, "WORKER_BUSY");
    assert.equal(secondWorker.ok, true);
    assert.equal(runtimes[0]?.turns.length, 1);
    assert.equal(runtimes[1]?.turns.length, 1);
    runtimes[0]?.turns[0]?.finish({ status: "completed", stopReason: "end_turn" });
    runtimes[1]?.turns[0]?.finish({ status: "completed", stopReason: "end_turn" });
    if (first.ok) await coordinator.execute({ action: "wait", requestId: first.details.requestId, waitTimeoutMs: 1_000 });
    if (secondWorker.ok) await coordinator.execute({ action: "wait", requestId: secondWorker.details.requestId, waitTimeoutMs: 1_000 });
  } finally { await coordinator.shutdown(); }
});

test("wait-any returns the first result without cancelling siblings", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "wait-a"); await spawn(coordinator, "wait-b");
    const a = await coordinator.execute({ action: "send", name: "wait-a", prompt: "a" });
    const b = await coordinator.execute({ action: "send", name: "wait-b", prompt: "b" });
    assert.equal(a.ok && b.ok, true);
    const waiting = coordinator.execute({ action: "wait", names: ["wait-a", "wait-b"], mode: "any", waitTimeoutMs: 1_000 });
    runtimes[1]!.turns[0]!.finish({ status: "completed" });
    const first = await waiting;
    assert.equal(first.ok, true);
    if (first.ok) {
      const requests = first.details.requests as Array<{ id: string; status: string }>;
      assert.deepEqual(requests.map(request => request.id), [b.ok ? b.details.requestId : ""]);
      assert.equal(requests[0]?.status, "completed");
    }
    assert.equal(runtimes[0]!.turns[0]!.cancelled, false);
    runtimes[0]!.turns[0]!.finish({ status: "completed" });
    const all = await coordinator.execute({ action: "wait", names: ["wait-a", "wait-b"], mode: "all", waitTimeoutMs: 1_000 });
    assert.equal(all.ok, true);
    if (all.ok) assert.deepEqual((all.details.requests as Array<{ id: string }>).map(request => request.id).sort(), [a.ok ? a.details.requestId : "", b.ok ? b.details.requestId : ""].sort());
  } finally { await coordinator.shutdown(); }
});

test("wait timeout reports timeout without cancelling work", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "wait-timeout");
    const sent = await coordinator.execute({ action: "send", name: "wait-timeout", prompt: "work" });
    const waited = await coordinator.execute({ action: "wait", requestId: sent.ok ? sent.details.requestId : "", waitTimeoutMs: 1 });
    assert.equal(waited.ok && waited.details.timedOut, true);
    assert.equal(runtimes[0]!.turns[0]!.cancelled, false);
    runtimes[0]!.turns[0]!.finish({ status: "completed" });
  } finally { await coordinator.shutdown(); }
});

test("coordinator deadline terminalizes and quarantines a late turn", async () => {
  const profile: Profile = { agent: "pi", role: "read-only", tools: ["read"], timeoutMs: 20, cancellationGraceMs: 25, maxOutputBytes: 4_096 };
  const { coordinator, runtimes } = await harness(profile);
  try {
    await spawn(coordinator, "deadline");
    const sent = await coordinator.execute({ action: "send", name: "deadline", prompt: "work" });
    assert.equal(sent.ok, true);
    await new Promise(resolve => setTimeout(resolve, 40));
    const timedOut = sent.ok ? await coordinator.execute({ action: "result", requestId: sent.details.requestId }) : sent;
    assert.equal(timedOut.ok && timedOut.details.status, "timed_out");
    assert.equal(runtimes[0]!.turns[0]!.cancelled, true);
    assert.equal(runtimes[0]!.turns[0]!.closed, true);
    const late = runtimes[0]!.turns[0]!;
    late.finishResult({ status: "completed" });
    const rejected = await coordinator.execute({ action: "send", name: "deadline", prompt: "successor" });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.error.code, "WORKER_BUSY");
    if (sent.ok) {
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "timed_out");
    }
    const closed = await coordinator.execute({ action: "close", name: "deadline", discardPersistentState: true });
    assert.equal(closed.ok, true);
    await spawn(coordinator, "deadline");
  } finally { await coordinator.shutdown(); }
});

test("terminal result closes a stream that never ends", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "terminal-stream");
    const sent = await coordinator.execute({ action: "send", name: "terminal-stream", prompt: "done" });
    assert.equal(sent.ok, true);
    runtimes[0]!.turns[0]!.finishResult({ status: "completed", stopReason: "end_turn" });
    const waited = await coordinator.execute({ action: "wait", requestId: sent.ok ? sent.details.requestId : "", waitTimeoutMs: 1_000 });
    assert.equal(waited.ok && waited.details.timedOut, false);
    assert.equal(runtimes[0]!.turns[0]!.closed, true);
    const result = await coordinator.execute({ action: "result", requestId: sent.ok ? sent.details.requestId : "" });
    assert.equal(result.ok && result.details.status, "completed");
  } finally { await coordinator.shutdown(); }
});

test("terminal result retains buffered events before an ACPX-style queue-clearing close", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "terminal-buffered-events");
    const sent = await coordinator.execute({ action: "send", name: "terminal-buffered-events", prompt: "done" });
    assert.equal(sent.ok, true);
    runtimes[0]!.turns[0]!.clearOnClose = true;
    runtimes[0]!.turns[0]!.finishResultWithEvents({ status: "completed" }, [
      { type: "text", text: "first", stream: "output" },
      { type: "text", text: "second", stream: "output" },
    ]);
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.output, "firstsecond");
    }
  } finally { await coordinator.shutdown(); }
});

test("terminal result survives post-result stream cleanup failure", async () => {
  const profile: Profile = { agent: "pi", role: "read-only", tools: ["read"], timeoutMs: 10_000, cancellationGraceMs: 25, maxOutputBytes: 4_096 };
  const { coordinator, runtimes } = await harness(profile);
  try {
    await spawn(coordinator, "terminal-cleanup-failure");
    const sent = await coordinator.execute({ action: "send", name: "terminal-cleanup-failure", prompt: "done" });
    assert.equal(sent.ok, true);
    runtimes[0]!.turns[0]!.closeMode = "reject";
    runtimes[0]!.turns[0]!.finishResult({ status: "completed", stopReason: "end_turn" });
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "completed");
    }
  } finally { await coordinator.shutdown(); }
});

test("terminal result cannot be overwritten by its deadline during stream cleanup", async () => {
  const profile: Profile = { agent: "pi", role: "read-only", tools: ["read"], timeoutMs: 20, cancellationGraceMs: 30, maxOutputBytes: 4_096 };
  const { coordinator, runtimes } = await harness(profile);
  try {
    await spawn(coordinator, "terminal-deadline-race");
    const sent = await coordinator.execute({ action: "send", name: "terminal-deadline-race", prompt: "done" });
    assert.equal(sent.ok, true);
    runtimes[0]!.turns[0]!.closeMode = "hang";
    runtimes[0]!.turns[0]!.finishResult({ status: "completed", stopReason: "end_turn" });
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "completed");
    }
  } finally { await coordinator.shutdown(); }
});

test("wait-all returns mixed terminal results", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    for (const name of ["mixed-a", "mixed-b", "mixed-c"]) await spawn(coordinator, name);
    await Promise.all(["mixed-a", "mixed-b", "mixed-c"].map(name => coordinator.execute({ action: "send", name, prompt: name })));
    runtimes[0]!.turns[0]!.finish({ status: "completed" });
    runtimes[1]!.turns[0]!.finish({ status: "failed", error: { code: "PROVIDER_FAILED", message: "provider" } });
    runtimes[2]!.turns[0]!.finish({ status: "failed", error: { code: "TIMEOUT", message: "deadline", retryable: true } });
    const waited = await coordinator.execute({ action: "wait", names: ["mixed-a", "mixed-b", "mixed-c"], mode: "all", waitTimeoutMs: 1_000 });
    assert.equal(waited.ok, true);
    if (waited.ok) {
      assert.deepEqual((waited.details.requests as Array<{ status: string }>).map(r => r.status).sort(), ["completed", "failed", "timed_out"]);
      assert.equal("status" in waited.details, false);
    }
    const listed = await coordinator.execute({ action: "list" });
    assert.equal(listed.ok, true);
    if (listed.ok) assert.deepEqual((listed.details.requests as Array<{ status: string }>).map(r => r.status).sort(), ["completed", "failed", "timed_out"]);
  } finally { await coordinator.shutdown(); }
});

test("wait snapshots exclude turns started later", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "snap-a"); await spawn(coordinator, "snap-b"); await spawn(coordinator, "snap-c");
    await coordinator.execute({ action: "send", name: "snap-a", prompt: "a" });
    await coordinator.execute({ action: "send", name: "snap-b", prompt: "b" });
    const waiting = coordinator.execute({ action: "wait", all: true, mode: "all", waitTimeoutMs: 1_000 });
    await new Promise(resolve => setImmediate(resolve));
    const c = await coordinator.execute({ action: "send", name: "snap-c", prompt: "c" });
    runtimes[0]!.turns[0]!.finish({ status: "completed" }); runtimes[1]!.turns[0]!.finish({ status: "completed" });
    const result = await waiting;
    assert.equal(result.ok, true);
    if (result.ok) assert.equal((result.details.requests as unknown[]).length, 2);
    assert.equal(c.ok, true);
    if (c.ok) {
      const cResult = await coordinator.execute({ action: "result", requestId: c.details.requestId });
      assert.equal(cResult.ok && cResult.details.status, "running");
    }
    runtimes[2]!.turns[0]!.finish({ status: "completed" });
  } finally { await coordinator.shutdown(); }
});

test("running result exposes progress before terminal completion", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "progress");
    const sent = await coordinator.execute({ action: "send", name: "progress", prompt: "work" });
    assert.equal(sent.ok, true);
    runtimes[0]!.turns[0]!.emit({ type: "status", text: "phase one" });
    runtimes[0]!.turns[0]!.emit({ type: "text", text: "visible progress", stream: "output" });
    runtimes[0]!.turns[0]!.emit({ type: "tool", text: "read package.json", status: "completed" });
    const requestId = sent.ok ? sent.details.requestId : "";
    await waitFor(async () => {
      const current = await coordinator.execute({ action: "result", requestId });
      return current.ok && String(current.details.output).includes("phase one") && String(current.details.output).includes("visible progress");
    });
    const result = await coordinator.execute({ action: "result", requestId });
    assert.equal(result.ok && result.details.status, "running");
    assert.match(result.ok ? String(result.details.output) : "", /phase one/);
    assert.match(result.ok ? String(result.details.output) : "", /visible progress/);
    const eventPath = result.ok ? String(result.details.eventPath) : "";
    runtimes[0]!.turns[0]!.finish({ status: "completed" });
    await coordinator.execute({ action: "wait", requestId, waitTimeoutMs: 1_000 });
    const completeLog = await readFile(eventPath, "utf8");
    const events = completeLog.trim().split("\n").map(line => JSON.parse(line) as { event: NormalizedEvent });
    assert.deepEqual(events.map(entry => entry.event.type), ["status", "text", "tool"]);
    const metadata = await stat(eventPath);
    assert.equal(metadata.mode & 0o777, 0o600);
  } finally { await coordinator.shutdown(); }
});

test("parallel transport failure preserves a healthy sibling", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "failure-a"); await spawn(coordinator, "healthy-b");
    const a = await coordinator.execute({ action: "send", name: "failure-a", prompt: "a" });
    const b = await coordinator.execute({ action: "send", name: "healthy-b", prompt: "b" });
    runtimes[0]!.turns[0]!.failStream(new Error("broken"), { status: "completed" });
    runtimes[1]!.turns[0]!.finish({ status: "completed" });
    await coordinator.execute({ action: "wait", all: true, waitTimeoutMs: 1_000 });
    const ar = await coordinator.execute({ action: "result", requestId: a.ok ? a.details.requestId : "" });
    const br = await coordinator.execute({ action: "result", requestId: b.ok ? b.details.requestId : "" });
    assert.equal(ar.ok && ar.details.status, "failed");
    assert.equal(br.ok && br.details.status, "completed");
    assert.equal(runtimes[1]!.turns[0]!.cancelled, false);
    assert.equal(runtimes[1]!.turns[0]!.closed, true);
    assert.equal(runtimes[1]!.closed, false);
  } finally { await coordinator.shutdown(); }
});

test("cancellation intent wins a late completed runtime result", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "cancel-race");
    const sent = await coordinator.execute({ action: "send", name: "cancel-race", prompt: "work" });
    assert.equal(sent.ok, true);
    const cancelling = coordinator.execute({ action: "cancel", name: "cancel-race", reason: "stop" });
    await new Promise((resolve) => setImmediate(resolve));
    runtimes[0]?.turns[0]?.finish({ status: "completed", stopReason: "end_turn" });
    assert.equal((await cancelling).ok, true);
    if (sent.ok) {
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "cancelled");
    }
  } finally { await coordinator.shutdown(); }
});

test("timeout and stream loss remain non-success terminal results", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "failures");
    const timed = await coordinator.execute({ action: "send", name: "failures", prompt: "timeout" });
    assert.equal(timed.ok, true);
    runtimes[0]?.turns[0]?.finish({ status: "failed", error: { message: "deadline", detailCode: "turn_timeout", retryable: true } });
    if (timed.ok) {
      await coordinator.execute({ action: "wait", requestId: timed.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: timed.details.requestId });
      assert.equal(result.ok && result.details.status, "timed_out");
    }
    const closed = await coordinator.execute({ action: "close", name: "failures", discardPersistentState: true });
    assert.equal(closed.ok, true);

    await spawn(coordinator, "stream-loss");
    const lost = await coordinator.execute({ action: "send", name: "stream-loss", prompt: "stream" });
    assert.equal(lost.ok, true);
    runtimes[1]?.turns[0]?.failStream(new Error("stream broke"), { status: "completed", stopReason: "end_turn" });
    if (lost.ok) {
      await coordinator.execute({ action: "wait", requestId: lost.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: lost.details.requestId });
      assert.equal(result.ok && result.details.status, "failed");
    }
  } finally { await coordinator.shutdown(); }
});

test("cancel cooperative and escalated are terminally cancelled", async () => {
  const profile: Profile = { agent: "pi", role: "read-only", tools: ["read"], timeoutMs: 10_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 };
  const { coordinator, runtimes } = await harness(profile);
  try {
    await spawn(coordinator, "cooperative"); await spawn(coordinator, "escalated");
    const cooperative = await coordinator.execute({ action: "send", name: "cooperative", prompt: "work" });
    const escalated = await coordinator.execute({ action: "send", name: "escalated", prompt: "work" });
    assert.equal(cooperative.ok && escalated.ok, true);
    runtimes[0]!.turns[0]!.onCancel = () => runtimes[0]!.turns[0]!.finish({ status: "cancelled", stopReason: "cooperative" });
    runtimes[1]!.turns[0]!.cancelMode = "hang";
    const cooperativeResult = await coordinator.execute({ action: "cancel", name: "cooperative", reason: "stop" });
    assert.equal(cooperativeResult.ok, true);
    const escalatedResult = await coordinator.execute({ action: "cancel", name: "escalated", reason: "stop" });
    assert.equal(escalatedResult.ok, false);
    if (!escalatedResult.ok) assert.equal(escalatedResult.error.code, "CANCEL_ESCALATED");
    if (cooperative.ok) {
      const result = await coordinator.execute({ action: "result", requestId: cooperative.details.requestId });
      assert.equal(result.ok && result.details.status, "cancelled");
    }
    if (escalated.ok) {
      const result = await coordinator.execute({ action: "result", requestId: escalated.details.requestId });
      assert.equal(result.ok && result.details.status, "cancelled");
    }
    assert.equal(runtimes[0]!.closed, false);
    assert.equal(runtimes[1]!.closed, true);
  } finally { await coordinator.shutdown(); }
});

test("ignored cancellation escalates by closing the stream and runtime", async () => {
  const profile: Profile = { agent: "pi", role: "read-only", tools: ["read"], timeoutMs: 10_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 };
  const { coordinator, runtimes } = await harness(profile);
  try {
    await spawn(coordinator, "stuck-cancel");
    const sent = await coordinator.execute({ action: "send", name: "stuck-cancel", prompt: "work" });
    assert.equal(sent.ok, true);
    const cancelled = await coordinator.execute({ action: "cancel", name: "stuck-cancel", reason: "stop" });
    assert.equal(cancelled.ok, false);
    if (!cancelled.ok) assert.equal(cancelled.error.code, "CANCEL_ESCALATED");
    assert.equal(runtimes[0]?.turns[0]?.closed, true);
    assert.equal(runtimes[0]?.closed, true);
    if (sent.ok) {
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "cancelled");
    }
  } finally { await coordinator.shutdown(); }
});

test("rejecting or hanging cooperative cancel still forces cleanup", async () => {
  for (const cancelMode of ["reject", "hang"] as const) {
    const profile: Profile = { agent: "pi", role: "read-only", tools: ["read"], timeoutMs: 10_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 };
    const { coordinator, runtimes } = await harness(profile);
    try {
      await spawn(coordinator, `cancel-${cancelMode}`);
      const sent = await coordinator.execute({ action: "send", name: `cancel-${cancelMode}`, prompt: "work" });
      assert.equal(sent.ok, true);
      runtimes[0]!.turns[0]!.cancelMode = cancelMode;
      const cancelled = await coordinator.execute({ action: "cancel", name: `cancel-${cancelMode}`, reason: "stop" });
      assert.equal(cancelled.ok, false);
      if (!cancelled.ok) assert.equal(cancelled.error.code, "CANCEL_ESCALATED");
      assert.equal(runtimes[0]?.closed, true);
      if (sent.ok) {
        const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
        assert.equal(result.ok && result.details.status, "cancelled");
      }
    } finally { await coordinator.shutdown(); }
  }
});

test("hanging cleanup is bounded and does not block later mutating actions", async () => {
  const profile: Profile = { agent: "pi", role: "read-only", tools: ["read"], timeoutMs: 10_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 };
  const { coordinator, runtimes } = await harness(profile);
  try {
    await spawn(coordinator, "cleanup-hang");
    runtimes[0]!.hangClose = true;
    const sent = await coordinator.execute({ action: "send", name: "cleanup-hang", prompt: "work" });
    assert.equal(sent.ok, true);
    const cancelled = await coordinator.execute({ action: "cancel", name: "cleanup-hang", reason: "stop" });
    assert.equal(cancelled.ok, false);
    if (!cancelled.ok) assert.equal(cancelled.error.code, "CANCEL_CLEANUP_TIMEOUT");
    if (sent.ok) {
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "cancelled");
    }
    const laterSpawn = await coordinator.execute({ action: "spawn", name: "after-cleanup-hang", profile: "pi-reviewer", cwd: process.cwd() });
    assert.equal(laterSpawn.ok, true);
  } finally { await coordinator.shutdown(); }
});

test("cleanup rejection cannot change an escalated request from cancelled", async () => {
  const profile: Profile = { agent: "pi", role: "read-only", tools: ["read"], timeoutMs: 10_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 };
  const { coordinator, runtimes } = await harness(profile);
  try {
    await spawn(coordinator, "cleanup-failure");
    runtimes[0]!.rejectClose = true;
    const sent = await coordinator.execute({ action: "send", name: "cleanup-failure", prompt: "work" });
    assert.equal(sent.ok, true);
    const cancelled = await coordinator.execute({ action: "cancel", name: "cleanup-failure", reason: "stop" });
    assert.equal(cancelled.ok, false);
    if (!cancelled.ok) assert.equal(cancelled.error.code, "CANCEL_CLEANUP_FAILED");
    if (sent.ok) {
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "cancelled");
    }
  } finally { await coordinator.shutdown(); }
});

test("forced close terminalizes an ignored active turn and discards its persistent session", async () => {
  const profile: Profile = { agent: "pi", role: "read-only", tools: ["read"], timeoutMs: 10_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 };
  const { coordinator, runtimes } = await harness(profile);
  try {
    await spawn(coordinator, "forced-close");
    const sent = await coordinator.execute({ action: "send", name: "forced-close", prompt: "work" });
    assert.equal(sent.ok, true);
    const closed = await coordinator.execute({ action: "close", name: "forced-close", force: true, discardPersistentState: true });
    assert.equal(closed.ok, true);
    assert.deepEqual(runtimes[0]?.closeDiscards, [true]);
    if (sent.ok) {
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "cancelled");
    }
  } finally { await coordinator.shutdown(); }
});

test("close failure records a failed worker and a retry can complete cleanup", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "close-retry");
    runtimes[0]!.rejectClose = true;
    const failed = await coordinator.execute({ action: "close", name: "close-retry" });
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.equal(failed.error.code, "CLOSE_FAILED");
    const listed = await coordinator.execute({ action: "list" });
    assert.equal(listed.ok, true);
    if (listed.ok) assert.equal((listed.details.workers as Array<{ name: string; status: string }>)[0]?.status, "failed");
    runtimes[0]!.rejectClose = false;
    assert.equal((await coordinator.execute({ action: "close", name: "close-retry" })).ok, true);
  } finally { await coordinator.shutdown(); }
});

test("shutdown rejects queued mutating actions and tracks the started action", async () => {
  const gate = new Deferred<void>();
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-shutdown-tail-"));
  const runtimes: FakeRuntime[] = [];
  const coordinator = new Coordinator(process.cwd(), {
    stateDir,
    profiles: { "pi-reviewer": { agent: "pi", role: "read-only", tools: ["read"], timeoutMs: 10_000, cancellationGraceMs: 50, maxOutputBytes: 4_096 } },
    runtimeFactory: () => { const runtime = new FakeRuntime(); runtime.ensureGate = gate.promise; runtimes.push(runtime); return runtime; },
  });
  const first = coordinator.execute({ action: "spawn", name: "started", profile: "pi-reviewer", cwd: process.cwd() });
  for (let attempt = 0; attempt < 100 && runtimes.length === 0; attempt += 1) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(runtimes.length, 1);
  const queued = coordinator.execute({ action: "spawn", name: "queued", profile: "pi-reviewer", cwd: process.cwd() });
  const shutting = coordinator.shutdown();
  gate.resolve();
  assert.equal((await first).ok, true);
  assert.equal((await queued).ok, false);
  await shutting;
});

test("closing releases a worker name for respawn", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "reusable");
    const closed = await coordinator.execute({ action: "close", name: "reusable", discardPersistentState: true });
    assert.equal(closed.ok, true);
    await spawn(coordinator, "reusable");
    assert.equal(runtimes.length, 2);
    const listed = await coordinator.execute({ action: "list" });
    assert.equal(listed.ok, true);
    if (listed.ok) assert.equal((listed.details.workers as unknown[]).length, 1);
  } finally { await coordinator.shutdown(); }
});

test("startup converts an interrupted request to PARENT_PROCESS_LOST", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-recovery-"));
  const state = new StateStore(stateDir);
  await state.acquire();
  const now = new Date().toISOString();
  await state.save([
    { name: "lost", profileName: "pi-reviewer", role: "read-only", status: "running", cwd: process.cwd(), handle: { sessionKey: "lost", backend: "fake", runtimeSessionName: "lost", cwd: process.cwd() }, activeRequestId: "req_lost", createdAt: now, updatedAt: now },
  ], [
    { id: "req_lost", workerName: "lost", status: "running", startedAt: now, output: "partial", truncated: false, eventPath: join(stateDir, "requests", "req_lost.ndjson") },
  ]);
  await state.close();
  const runtime = new FakeRuntime();
  const coordinator = new Coordinator(process.cwd(), { stateDir, runtimeFactory: () => runtime });
  try {
    const listed = await coordinator.execute({ action: "list" });
    assert.equal(listed.ok, true);
    if (listed.ok) {
      const request = (listed.details.requests as Array<{ status: string; failure?: { code: string } }>)[0];
      assert.equal(request?.status, "failed");
      assert.equal(request?.failure?.code, "PARENT_PROCESS_LOST");
    }
  } finally { await coordinator.shutdown(); }
});

test("UTF-8 output truncation stays within its byte bound", async () => {
  const profile: Profile = { agent: "pi", role: "read-only", tools: ["read"], timeoutMs: 10_000, cancellationGraceMs: 100, maxOutputBytes: 5 };
  const { coordinator, runtimes } = await harness(profile);
  try {
    await spawn(coordinator, "unicode-bound");
    const sent = await coordinator.execute({ action: "send", name: "unicode-bound", prompt: "unicode" });
    runtimes[0]!.turns[0]!.finish({ status: "completed" }, [{ type: "text", text: "😀😀", stream: "output" }]);
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok, true);
      if (result.ok) { assert.ok(Buffer.byteLength(String(result.details.output)) <= 5); assert.doesNotMatch(String(result.details.output), /�/); }
    }
  } finally { await coordinator.shutdown(); }
});

test("output remains bounded while normalized events spill to a private log", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "spill");
    const sent = await coordinator.execute({ action: "send", name: "spill", prompt: "large" });
    assert.equal(sent.ok, true);
    const text = "x".repeat(300_000);
    runtimes[0]?.turns[0]?.finish({ status: "completed", stopReason: "end_turn" }, [{ type: "text", text, stream: "output" }]);
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.details.truncated, true);
        assert.ok(Buffer.byteLength(String(result.details.output)) <= 256_000);
        const log = await readFile(String(result.details.eventPath), "utf8");
        assert.ok(log.length > 300_000);
        assert.doesNotMatch(log, /rawInput|rawOutput/);
      }
    }
  } finally { await coordinator.shutdown(); }
});

test("sequential turns preserve worker session identity and use distinct requests", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    const spawned = await coordinator.execute({ action: "spawn", name: "continuity", profile: "pi-reviewer", cwd: process.cwd() });
    assert.equal(spawned.ok, true);
    const first = await coordinator.execute({ action: "send", name: "continuity", prompt: "establish nonce" });
    assert.equal(first.ok, true);
    runtimes[0]!.turns[0]!.finish({ status: "completed" }, [{ type: "text", text: "NONCE:nonce-42", stream: "output" }]);
    if (first.ok) await coordinator.execute({ action: "wait", requestId: first.details.requestId, waitTimeoutMs: 1_000 });
    const second = await coordinator.execute({ action: "send", name: "continuity", prompt: "retrieve nonce" });
    assert.equal(second.ok, true);
    assert.notEqual(first.ok && first.details.requestId, second.ok && second.details.requestId);
    if (second.ok) {
      runtimes[0]!.turns[1]!.finish({ status: "completed" }, [{ type: "text", text: "NONCE:nonce-42", stream: "output" }]);
      await coordinator.execute({ action: "wait", requestId: second.details.requestId, waitTimeoutMs: 1_000 });
      const secondResult = await coordinator.execute({ action: "result", requestId: second.details.requestId });
      assert.match(secondResult.ok ? String(secondResult.details.output) : "", /NONCE:nonce-42/);
      assert.equal(second.details.session, first.ok ? first.details.session : undefined);
    }
  } finally { await coordinator.shutdown(); }
});

test("direct worker restart preserves exact tools and selected model", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-direct-reconnect-"));
  const firstProfiles: Profile[] = [];
  const firstRuntime = new FakeRuntime();
  const first = new Coordinator(process.cwd(), {
    stateDir,
    profiles: {},
    runtimeFactory: (_cwd, _state, profile) => { firstProfiles.push(profile); return firstRuntime; },
  });
  try {
    const spawned = await first.execute({ action: "spawn", name: "restricted", agent: "pi", role: "writer", tools: ["read", "bash"], model: "primary", cwd: process.cwd() });
    assert.equal(spawned.ok, true);
    assert.deepEqual(firstProfiles[0]?.tools, ["read", "bash"]);
  } finally { await first.shutdown(); }
  const secondProfiles: Profile[] = [];
  const secondRuntime = new FakeRuntime();
  const second = new Coordinator(process.cwd(), {
    stateDir,
    profiles: {},
    runtimeFactory: (_cwd, _state, profile) => { secondProfiles.push(profile); return secondRuntime; },
  });
  try {
    const listed = await second.execute({ action: "list" });
    assert.equal(listed.ok, true);
    assert.deepEqual(secondProfiles[0]?.tools, ["read", "bash"]);
    assert.equal(secondProfiles[0]?.model, "primary");
    assert.equal(secondProfiles[0]?.role, "writer");
  } finally { await second.shutdown(); }
});

test("idle worker reconnects with the same session after coordinator restart", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-reconnect-"));
  const profile = { agent: "pi", role: "read-only" as const, tools: ["read"], timeoutMs: 10_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 };
  const firstRuntime = new FakeRuntime();
  const first = new Coordinator(process.cwd(), { stateDir, profiles: { "pi-reviewer": profile }, runtimeFactory: () => firstRuntime });
  try {
    await spawn(first, "reconnect");
    const sent = await first.execute({ action: "send", name: "reconnect", prompt: "remember" });
    assert.equal(sent.ok, true);
    firstRuntime.turns[0]!.finish({ status: "completed" });
    if (sent.ok) await first.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
  } finally { await first.shutdown(); }
  const secondRuntime = new FakeRuntime();
  const second = new Coordinator(process.cwd(), { stateDir, profiles: { "pi-reviewer": profile }, runtimeFactory: () => secondRuntime });
  try {
    const listed = await second.execute({ action: "list" });
    assert.equal(listed.ok, true);
    assert.equal(secondRuntime.ensureCalls, 1);
    const sent = await second.execute({ action: "send", name: "reconnect", prompt: "follow up" });
    assert.equal(sent.ok, true);
    secondRuntime.turns[0]!.finish({ status: "completed" });
    if (sent.ok) await second.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
    if (listed.ok && sent.ok) assert.equal((listed.details.workers as Array<{ session: string }>)[0]?.session, sent.details.session);
  } finally { await second.shutdown(); }
});

test("cancel and reassign creates a new attempt lineage", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "attempt-a");
    const first = await coordinator.execute({ action: "send", name: "attempt-a", prompt: "partial" });
    assert.equal(first.ok, true);
    const cancelling = coordinator.execute({ action: "cancel", name: "attempt-a" });
    await new Promise(resolve => setImmediate(resolve));
    runtimes[0]!.turns[0]!.finish({ status: "cancelled" });
    await cancelling;
    assert.equal((await coordinator.execute({ action: "close", name: "attempt-a" })).ok, true);
    await spawn(coordinator, "attempt-b");
    const reassigned = await coordinator.execute({ action: "send", name: "attempt-b", prompt: "remaining", predecessorRequestId: first.ok ? first.details.requestId : "" });
    assert.equal(reassigned.ok, true);
    if (first.ok && reassigned.ok) {
      assert.equal(reassigned.details.attempt, 2);
      assert.notEqual(reassigned.details.session, first.details.session);
      const original = await coordinator.execute({ action: "result", requestId: first.details.requestId });
      assert.equal(original.ok && original.details.supersededBy, reassigned.details.requestId);
      runtimes[0]!.turns[0]!.emit({ type: "text", text: "ZOMBIE_MUTATION", stream: "output" });
      runtimes[0]!.turns[0]!.finish({ status: "completed" });
      const afterLateResult = await coordinator.execute({ action: "result", requestId: first.details.requestId });
      assert.equal(afterLateResult.ok && afterLateResult.details.status, "cancelled");
      assert.doesNotMatch(afterLateResult.ok ? String(afterLateResult.details.output) : "", /ZOMBIE_MUTATION/);
    }
    runtimes[1]!.turns[0]!.finish({ status: "completed" });
  } finally { await coordinator.shutdown(); }
});

test("resume identity validation rejects every identity dimension", async () => {
  const provenance = { sessionId: "s", agent: "pi", profileName: "pi", role: "read-only" as const, cwd: "/repo" };
  const base = { agent: "pi", role: "read-only" as const, tools: ["read"], timeoutMs: 1, cancellationGraceMs: 1, maxOutputBytes: 1 };
  assert.equal(resumeIdentityMatches(provenance, { ...base, role: "read-only" }, "/repo", "pi"), true);
  assert.equal(resumeIdentityMatches(provenance, { ...base, agent: "codex" }, "/repo", "pi"), false);
  assert.equal(resumeIdentityMatches(provenance, { ...base, role: "writer" }, "/repo", "pi"), false);
  assert.equal(resumeIdentityMatches(provenance, { ...base }, "/other", "pi"), false);
  assert.equal(resumeIdentityMatches(provenance, { ...base }, "/repo", "other"), false);
});

test("resume rejects a mismatched agent before starting adapter work", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-resume-"));
  const profiles = {
    pi: { agent: "pi", role: "read-only" as const, tools: ["read"], timeoutMs: 10_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 },
    piAlt: { agent: "pi", role: "read-only" as const, tools: ["read"], timeoutMs: 10_000, cancellationGraceMs: 4_096, maxOutputBytes: 4_096 },
    codex: { agent: "codex", role: "read-only" as const, tools: ["read"], timeoutMs: 10_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 },
  };
  const runtime = new FakeRuntime();
  const coordinator = new Coordinator(process.cwd(), { stateDir, profiles, runtimeFactory: () => runtime });
  try {
    const original = await coordinator.execute({ action: "spawn", name: "source", profile: "pi", cwd: process.cwd() });
    assert.equal(original.ok, true);
    const session = original.ok ? String(original.details.session) : "";
    await coordinator.execute({ action: "close", name: "source" });
    const mismatch = await coordinator.execute({ action: "spawn", name: "wrong-agent", profile: "codex", cwd: process.cwd(), resumeSessionId: session });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.error.code, "RESUME_IDENTITY_MISMATCH");
    const profileMismatch = await coordinator.execute({ action: "spawn", name: "wrong-profile", profile: "piAlt", cwd: process.cwd(), resumeSessionId: session });
    assert.equal(profileMismatch.ok, false);
    if (!profileMismatch.ok) assert.equal(profileMismatch.error.code, "RESUME_IDENTITY_MISMATCH");
    const cwdMismatch = await coordinator.execute({ action: "spawn", name: "wrong-cwd", profile: "pi", cwd: "/tmp", resumeSessionId: session });
    assert.equal(cwdMismatch.ok, false);
    if (!cwdMismatch.ok) assert.equal(cwdMismatch.error.code, "RESUME_IDENTITY_MISMATCH");
    assert.equal(runtime.ensureCalls, 1);
    const unknown = await coordinator.execute({ action: "spawn", name: "unknown", profile: "pi", cwd: process.cwd(), resumeSessionId: "unknown-session" });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.error.code, "RESUME_PROVENANCE_UNKNOWN");
  } finally { await coordinator.shutdown(); }
});

test("shared writer is admitted in the parent checkout without a worktree", async () => {
  const { coordinator, runtimes } = await harnessProfiles({ "pi-writer": WRITER });
  try {
    await spawnProfile(coordinator, "shared-writer", "pi-writer", process.cwd());
    assert.equal(runtimes[0]!.closed, false);
    const listed = await coordinator.execute({ action: "list" });
    assert.equal(listed.ok, true);
    if (listed.ok) assert.equal((listed.details.workers as Array<{ worktree?: unknown }>)[0]?.worktree, undefined);
  } finally { await coordinator.shutdown(); }
});

test("two shared writers in the same canonical cwd are rejected", async () => {
  const { coordinator } = await harnessProfiles({ "pi-writer": WRITER });
  try {
    await spawnProfile(coordinator, "writer-a", "pi-writer", process.cwd());
    const second = await coordinator.execute({ action: "spawn", name: "writer-b", profile: "pi-writer", cwd: process.cwd() });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.error.code, "WRITER_CWD_OWNED");
  } finally { await coordinator.shutdown(); }
});

test("shared writers in distinct cwds coexist", async () => {
  const other = await mkdtemp(join(tmpdir(), "pi-strings-other-cwd-"));
  const { coordinator } = await harnessProfiles({ "pi-writer": WRITER });
  try {
    await spawnProfile(coordinator, "writer-a", "pi-writer", process.cwd());
    await spawnProfile(coordinator, "writer-b", "pi-writer", other);
  } finally { await coordinator.shutdown(); }
});

test("worktree isolation remains available and still rejects the parent checkout", async () => {
  const { coordinator } = await harnessProfiles({ "pi-writer": WORKTREE_WRITER });
  try {
    const rejected = await coordinator.execute({ action: "spawn", name: "wt", profile: "pi-writer", cwd: process.cwd() });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.error.code, "WRITER_ISOLATION_REQUIRED");
  } finally { await coordinator.shutdown(); }
});

test("send decorates the prompt with the per-kind role and acceptance contract", async () => {
  const { coordinator, runtimes } = await harnessProfiles({ "pi-oracle": ORACLE, "pi-finder": FINDER, "pi-reviewer": REVIEWER });
  try {
    await spawnProfile(coordinator, "o", "pi-oracle", process.cwd());
    const oracle = await coordinator.execute({ action: "send", name: "o", prompt: "advise" });
    assert.equal(oracle.ok, true);
    assert.match(runtimes[0]!.lastPrompt ?? "", /\[oracle contract\]/);
    assert.match(runtimes[0]!.lastPrompt ?? "", /```acceptance-report/);
    assert.match(runtimes[0]!.lastPrompt ?? "", /not the orchestrator/);
    runtimes[0]!.turns[0]!.finish({ status: "completed" });
    if (oracle.ok) await coordinator.execute({ action: "wait", requestId: oracle.details.requestId, waitTimeoutMs: 1_000 });

    await spawnProfile(coordinator, "f", "pi-finder", process.cwd());
    const finder = await coordinator.execute({ action: "send", name: "f", prompt: "find" });
    assert.equal(finder.ok, true);
    assert.match(runtimes[1]!.lastPrompt ?? "", /\[finder contract\]/);
    runtimes[1]!.turns[0]!.finish({ status: "completed" });

    await spawnProfile(coordinator, "r", "pi-reviewer", process.cwd());
    const reviewer = await coordinator.execute({ action: "send", name: "r", prompt: "review" });
    assert.equal(reviewer.ok, true);
    const prompt = runtimes[2]!.lastPrompt ?? "";
    assert.doesNotMatch(prompt, /\[oracle contract\]|\[finder contract\]|\[worker contract\]/);
    assert.doesNotMatch(prompt, /```acceptance-report/);
    assert.match(prompt, /not the orchestrator/);
    runtimes[2]!.turns[0]!.finish({ status: "completed" });
  } finally { await coordinator.shutdown(); }
});

test("a fenced acceptance report in worker output is parsed onto the request", async () => {
  const { coordinator, runtimes } = await harnessProfiles({ "pi-writer": WRITER });
  try {
    await spawnProfile(coordinator, "acc", "pi-writer", process.cwd());
    const sent = await coordinator.execute({ action: "send", name: "acc", prompt: "do work" });
    assert.equal(sent.ok, true);
    const report = "{ \"changedFiles\": [\"src/a.ts\"], \"testsAddedOrUpdated\": [], \"commandsRun\": [], \"residualRisks\": [\"none\"] }";
    runtimes[0]!.turns[0]!.finish({ status: "completed" }, [
      { type: "text", text: "## Summary\ndid it\n```acceptance-report\n" + report + "\n```", stream: "output" },
    ]);
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok, true);
      if (result.ok) {
        const acceptance = result.details.acceptance as { parsed: boolean; report?: unknown } | undefined;
        assert.equal(acceptance?.parsed, true);
        assert.deepEqual(acceptance?.report, { changedFiles: ["src/a.ts"], testsAddedOrUpdated: [], commandsRun: [], residualRisks: ["none"] });
      }
    }
  } finally { await coordinator.shutdown(); }
});

test("output without an acceptance block leaves acceptance.parsed false", async () => {
  const { coordinator, runtimes } = await harnessProfiles({ "pi-oracle": ORACLE });
  try {
    await spawnProfile(coordinator, "no-acc", "pi-oracle", process.cwd());
    const sent = await coordinator.execute({ action: "send", name: "no-acc", prompt: "advise" });
    assert.equal(sent.ok, true);
    runtimes[0]!.turns[0]!.finish({ status: "completed" }, [{ type: "text", text: "just prose, no report", stream: "output" }]);
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok, true);
      if (result.ok) assert.equal((result.details.acceptance as { parsed: boolean } | undefined)?.parsed, false);
    }
  } finally { await coordinator.shutdown(); }
});

test("usage on the terminal result is surfaced on the request", async () => {
  const { coordinator, runtimes } = await harnessProfiles({ "pi-reviewer": REVIEWER });
  try {
    await spawnProfile(coordinator, "usage", "pi-reviewer", process.cwd());
    const sent = await coordinator.execute({ action: "send", name: "usage", prompt: "work" });
    assert.equal(sent.ok, true);
    runtimes[0]!.turns[0]!.finish({ status: "completed", usage: { breakdown: { inputTokens: 120, outputTokens: 40, totalTokens: 160 }, cost: { amount: 0.002, currency: "USD" } } });
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok, true);
      if (result.ok) {
        const usage = result.details.usage as { breakdown?: { totalTokens?: number }; cost?: { amount?: number } } | undefined;
        assert.equal(usage?.breakdown?.totalTokens, 160);
        assert.equal(usage?.cost?.amount, 0.002);
      }
    }
  } finally { await coordinator.shutdown(); }
});

test("exceeding the turn budget cancels and terminalizes as failed", async () => {
  const budget: Profile = { ...REVIEWER, maxTurns: 2 };
  const { coordinator, runtimes } = await harnessProfiles({ "pi-reviewer": budget });
  try {
    await spawnProfile(coordinator, "budget", "pi-reviewer", process.cwd());
    const sent = await coordinator.execute({ action: "send", name: "budget", prompt: "loop" });
    assert.equal(sent.ok, true);
    const turn = runtimes[0]!.turns[0]!;
    turn.onCancel = () => turn.finishResult({ status: "cancelled" });
    turn.emit({ type: "tool", text: "read a" });
    turn.emit({ type: "tool", text: "read b" });
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "failed");
      assert.equal(result.ok && (result.details.failure as { code?: string } | undefined)?.code, "TURN_BUDGET_EXCEEDED");
      assert.equal(turn.cancelled, true);
    }
  } finally { await coordinator.shutdown(); }
});

test("streaming updates for one tool call do not trigger stall detection", async () => {
  const { coordinator, runtimes } = await harnessProfiles({ "pi-reviewer": { ...REVIEWER, maxTurns: 2 } });
  try {
    await spawnProfile(coordinator, "updates", "pi-reviewer", process.cwd());
    const sent = await coordinator.execute({ action: "send", name: "updates", prompt: "inspect" });
    assert.equal(sent.ok, true);
    const turn = runtimes[0]!.turns[0]!;
    for (const text of ["tool call (pending)", "tool call (pending)", "tool call (pending): .", "ls (completed): ."]) {
      turn.emit({ type: "tool", text, toolCallId: "call-1", status: "pending" });
    }
    turn.finish({ status: "completed" });
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "completed");
      assert.equal(turn.cancelled, false);
    }
  } finally { await coordinator.shutdown(); }
});

test("parallel same-tool calls use completed inputs instead of provisional text for stalls", async () => {
  const { coordinator, runtimes } = await harnessProfiles({ "pi-reviewer": REVIEWER });
  try {
    await spawnProfile(coordinator, "parallel-calls", "pi-reviewer");
    const sent = await coordinator.execute({ action: "send", name: "parallel-calls", prompt: "inspect" });
    assert.equal(sent.ok, true);
    const turn = runtimes[0]!.turns[0]!;
    for (let i = 0; i < 4; i += 1) {
      turn.emit({ type: "tool", text: "read (pending)", toolCallId: `parallel-${i}`, status: "in_progress" });
    }
    for (let i = 0; i < 4; i += 1) {
      turn.emit({ type: "tool", text: "read (completed)", toolCallId: `parallel-${i}`, toolFingerprint: `read\u0000{\"path\":\"file-${i}.ts\"}`, status: "completed" });
    }
    turn.finish({ status: "completed" });
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "completed");
      assert.equal(turn.cancelled, false);
    }
  } finally { await coordinator.shutdown(); }
});

test("a worker repeating distinct identical tool calls is stopped as stalled", async () => {
  const { coordinator, runtimes } = await harnessProfiles({ "pi-reviewer": REVIEWER });
  try {
    await spawnProfile(coordinator, "stall", "pi-reviewer", process.cwd());
    const sent = await coordinator.execute({ action: "send", name: "stall", prompt: "stuck" });
    assert.equal(sent.ok, true);
    const turn = runtimes[0]!.turns[0]!;
    turn.onCancel = () => turn.finishResult({ status: "cancelled" });
    for (let i = 0; i < 4; i += 1) turn.emit({ type: "tool", text: "read same", toolCallId: `call-${i}`, toolFingerprint: "read\u0000{\"path\":\"same\"}", status: "completed" });
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "failed");
      assert.equal(result.ok && (result.details.failure as { code?: string } | undefined)?.code, "STALLED");
      assert.equal(turn.cancelled, true);
    }
  } finally { await coordinator.shutdown(); }
});

test("direct workers default to Pi and accept an explicit ACP agent", async () => {
  const { coordinator, runtimes } = await harnessProfiles({ "pi-reviewer": REVIEWER });
  try {
    const pi = await coordinator.execute({ action: "spawn", name: "default", cwd: process.cwd() });
    assert.equal(pi.ok && pi.details.agent, "pi");
    const open = await coordinator.execute({ action: "spawn", name: "open", agent: "opencode", cwd: process.cwd() });
    assert.equal(open.ok && open.details.agent, "opencode");
    const overridden = await coordinator.execute({ action: "spawn", name: "override", profile: "pi-reviewer", agent: "opencode", cwd: process.cwd() });
    assert.equal(overridden.ok && overridden.details.agent, "opencode");
    assert.equal(runtimes.length, 3);
  } finally { await coordinator.shutdown(); }
});

test("op_status exposes discovered models and send records selected model provenance", async () => {
  const profile: Profile = { ...REVIEWER, model: "primary" };
  const { coordinator, runtimes } = await harnessProfiles({ "pi-reviewer": profile });
  try {
    await spawnProfile(coordinator, "status", "pi-reviewer");
    const status = await coordinator.execute({ action: "status", name: "status" });
    assert.equal(status.ok, true);
    assert.equal(status.ok && status.details.currentModelId, "primary");
    assert.deepEqual(status.ok && status.details.availableModelIds, ["primary", "backup", "third"]);
    const sent = await coordinator.execute({ action: "send", name: "status", prompt: "inspect", model: "backup" });
    assert.equal(sent.ok && sent.details.requestedModel, "backup");
    const turn = runtimes[0]!.turns[0]!;
    turn.finish({ status: "completed" });
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.requestedModel, "backup");
    }
    assert.deepEqual(runtimes[0]!.setConfigOptionCalls, [{ key: "model", value: "backup" }]);
  } finally { await coordinator.shutdown(); }
});

test("unsupported discovery and selection fail explicitly", async () => {
  const { coordinator, runtimes } = await harnessProfiles({ "pi-reviewer": REVIEWER });
  try {
    await spawnProfile(coordinator, "unsupported", "pi-reviewer");
    (runtimes[0] as unknown as { getStatus?: unknown }).getStatus = undefined;
    const discovery = await coordinator.execute({ action: "send", name: "unsupported", prompt: "inspect", model: "backup" });
    assert.equal(discovery.ok, false);
    assert.equal(!discovery.ok && discovery.error.code, "MODEL_DISCOVERY_UNSUPPORTED");
  } finally { await coordinator.shutdown(); }

  const selectionHarness = await harnessProfiles({ "pi-reviewer": REVIEWER });
  try {
    await spawnProfile(selectionHarness.coordinator, "unsupported", "pi-reviewer");
    (selectionHarness.runtimes[0] as unknown as { setConfigOption?: unknown }).setConfigOption = undefined;
    const selection = await selectionHarness.coordinator.execute({ action: "send", name: "unsupported", prompt: "inspect", model: "backup" });
    assert.equal(selection.ok, false);
    assert.equal(!selection.ok && selection.error.code, "MODEL_SELECTION_UNSUPPORTED");
  } finally { await selectionHarness.coordinator.shutdown(); }
});

test("direct spawn unavailable models clean up without registering a worker", async () => {
  const { coordinator, runtimes } = await harnessProfiles({});
  try {
    const result = await coordinator.execute({ action: "spawn", name: "bad-model", model: "missing", cwd: process.cwd() });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.error.code, "MODEL_UNAVAILABLE");
    assert.equal(runtimes[0]?.closed, true);
    const listed = await coordinator.execute({ action: "list" });
    assert.equal(listed.ok && (listed.details.workers as unknown[]).length, 0);
  } finally { await coordinator.shutdown(); }
});

test("requested unavailable models fail explicitly before a turn starts", async () => {
  const { coordinator, runtimes } = await harnessProfiles({ "pi-reviewer": REVIEWER });
  try {
    await spawnProfile(coordinator, "unavailable", "pi-reviewer");
    const result = await coordinator.execute({ action: "send", name: "unavailable", prompt: "inspect", model: "missing" });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.error.code, "MODEL_UNAVAILABLE");
    assert.equal(runtimes[0]!.turns.length, 0);
  } finally { await coordinator.shutdown(); }
});

test("a retryable failure retries on the fallback model and completes", async () => {
  const retryable: Profile = { ...REVIEWER, model: "primary", fallbackModels: ["backup"], maxAttempts: 2 };
  const { coordinator, runtimes } = await harnessProfiles({ "pi-reviewer": retryable });
  try {
    await spawnProfile(coordinator, "retry", "pi-reviewer", process.cwd());
    const sent = await coordinator.execute({ action: "send", name: "retry", prompt: "work" });
    assert.equal(sent.ok, true);
    runtimes[0]!.turns[0]!.finish({ status: "failed", error: { code: "PROVIDER_OVERLOAD", message: "capacity", retryable: true } });
    await waitFor(async () => runtimes[0]!.turns.length >= 2);
    runtimes[0]!.turns[1]!.finish({ status: "completed" });
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "completed");
      assert.deepEqual(result.ok && (result.details.attemptModels as string[] | undefined), ["primary", "backup"]);
      assert.equal(result.ok && (result.details.attempts as number | undefined), 2);
      assert.deepEqual(runtimes[0]!.setConfigOptionCalls, [{ key: "model", value: "backup" }]);
    }
  } finally { await coordinator.shutdown(); }
});

test("a missing primary model does not attribute fallback zero to attempt one", async () => {
  const retryable: Profile = { ...REVIEWER, fallbackModels: ["backup"], maxAttempts: 2 };
  const { coordinator, runtimes } = await harnessProfiles({ "pi-reviewer": retryable });
  try {
    await spawnProfile(coordinator, "fallback-only", "pi-reviewer", process.cwd());
    const sent = await coordinator.execute({ action: "send", name: "fallback-only", prompt: "work" });
    assert.equal(sent.ok, true);
    runtimes[0]!.turns[0]!.finish({ status: "failed", error: { code: "PROVIDER_OVERLOAD", message: "capacity", retryable: true } });
    await waitFor(async () => runtimes[0]!.turns.length >= 2);
    runtimes[0]!.turns[1]!.finish({ status: "completed" });
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "completed");
      assert.deepEqual(result.ok && (result.details.attemptModels as string[] | undefined), ["backup"]);
      assert.equal(result.ok && (result.details.attempts as number | undefined), 2);
      assert.deepEqual(runtimes[0]!.setConfigOptionCalls, [{ key: "model", value: "backup" }]);
    }
  } finally { await coordinator.shutdown(); }
});

test("a non-retryable failure does not retry on a fallback model", async () => {
  const retryable: Profile = { ...REVIEWER, model: "primary", fallbackModels: ["backup"], maxAttempts: 2 };
  const { coordinator, runtimes } = await harnessProfiles({ "pi-reviewer": retryable });
  try {
    await spawnProfile(coordinator, "noretry", "pi-reviewer", process.cwd());
    const sent = await coordinator.execute({ action: "send", name: "noretry", prompt: "work" });
    assert.equal(sent.ok, true);
    runtimes[0]!.turns[0]!.finish({ status: "failed", error: { code: "POLICY", message: "denied", retryable: false } });
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "failed");
      assert.equal(runtimes[0]!.turns.length, 1);
      assert.deepEqual(runtimes[0]!.setConfigOptionCalls, []);
      assert.equal(result.ok && (result.details.attempts as number | undefined), 1);
    }
  } finally { await coordinator.shutdown(); }
});

test("the coordinator deadline bounds the whole retry window", async () => {
  const retryable: Profile = { ...REVIEWER, model: "primary", fallbackModels: ["backup", "third"], maxAttempts: 3, timeoutMs: 40 };
  const { coordinator, runtimes } = await harnessProfiles({ "pi-reviewer": retryable });
  try {
    await spawnProfile(coordinator, "deadline-retry", "pi-reviewer", process.cwd());
    const sent = await coordinator.execute({ action: "send", name: "deadline-retry", prompt: "work" });
    assert.equal(sent.ok, true);
    runtimes[0]!.turns[0]!.finish({ status: "failed", error: { code: "PROVIDER_OVERLOAD", message: "capacity", retryable: true } });
    await waitFor(async () => runtimes[0]!.turns.length >= 2);
    // Leave attempt 2 hanging; the deadline fires and terminalizes the whole request as timed_out.
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 2_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "timed_out");
      assert.equal(runtimes[0]!.turns[1]!.cancelled, true);
    }
  } finally { await coordinator.shutdown(); }
});

test("events arriving just after the terminal result are retained before a queue-clearing close", async () => {
  const { coordinator, runtimes } = await harnessProfiles({ "pi-reviewer": REVIEWER });
  try {
    await spawnProfile(coordinator, "async-arrival", "pi-reviewer", process.cwd());
    const sent = await coordinator.execute({ action: "send", name: "async-arrival", prompt: "done" });
    assert.equal(sent.ok, true);
    const turn = runtimes[0]!.turns[0]!;
    turn.clearOnClose = true;
    turn.finishResult({ status: "completed" });
    queueMicrotask(() => turn.emit({ type: "text", text: "late", stream: "output" }));
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 1_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok, true);
      if (result.ok) assert.match(String(result.details.output), /late/);
    }
  } finally { await coordinator.shutdown(); }
});
