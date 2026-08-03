import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Coordinator, resumeIdentityMatches } from "../extensions/pi-strings/orchestration/coordinator.ts";
import { StateStore } from "../extensions/pi-strings/persistence/state-store.ts";
import type { NormalizedEvent, Profile, RuntimeCapabilities, RuntimeHandle, RuntimePort, RuntimeTerminal, RuntimeTurn, SteeringAcknowledgement } from "../extensions/pi-strings/domain/types.ts";

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
  onCancel?: () => void;
  constructor(readonly requestId: string) {}
  readonly events: AsyncIterable<NormalizedEvent> = this.stream;
  async cancel(): Promise<void> {
    this.cancelled = true;
    if (this.cancelMode === "reject") throw new Error("cancel rejected");
    if (this.cancelMode === "hang") await new Promise<void>(() => undefined);
    this.onCancel?.();
  }
  async closeStream(): Promise<void> { this.closed = true; this.stream.end(); }
  emit(event: NormalizedEvent): void { this.stream.push(event); }
  finish(terminal: RuntimeTerminal, events: NormalizedEvent[] = []): void { for (const event of events) this.stream.push(event); this.stream.end(); this.resultControl.resolve(terminal); }
  failStream(error: Error, terminal: RuntimeTerminal): void { this.stream.fail(error); this.resultControl.resolve(terminal); }
}

class FakeRuntime implements RuntimePort {
  readonly turns: ControlledTurn[] = [];
  capabilities: RuntimeCapabilities = { version: 1, steering: false, resume: true, permissions: true, questions: false };
  readonly steers: string[] = [];
  readonly replies: string[] = [];
  ensureCalls = 0;
  steerWait?: Deferred<SteeringAcknowledgement>;
  lastSteer?: { requestId: string; steerId: string };
  closed = false;
  throwOnNextStart = false;
  rejectClose = false;
  hangClose = false;
  closeDiscards: boolean[] = [];
  async ensureSession(input: { name: string; cwd: string }): Promise<RuntimeHandle> {
    this.ensureCalls += 1;
    return { sessionKey: input.name, backend: "fake", runtimeSessionName: input.name, cwd: input.cwd, backendSessionId: `session-${input.name}` };
  }
  async steer(input: { requestId: string; steerId: string; prompt: string }): Promise<SteeringAcknowledgement> {
    this.steers.push(`${input.requestId}:${input.prompt}`);
    this.lastSteer = { requestId: input.requestId, steerId: input.steerId };
    if (this.steerWait) return this.steerWait.promise;
    this.turns.at(-1)?.emit({ type: "status", text: `steered:${input.prompt}` });
    return { status: "delivered", requestId: input.requestId, steerId: input.steerId };
  }
  async reply(input: { questionId: string; answer: string }): Promise<void> { this.replies.push(`${input.questionId}:${input.answer}`); }
  startTurn(input: { requestId: string }): RuntimeTurn {
    if (this.throwOnNextStart) { this.throwOnNextStart = false; throw new Error("start failed"); }
    const turn = new ControlledTurn(input.requestId); this.turns.push(turn); return turn;
  }
  async cancel(): Promise<void> {}
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
    if (first.ok) await coordinator.execute({ action: "wait", requestId: first.details.requestId, timeoutMs: 1_000 });
    if (secondWorker.ok) await coordinator.execute({ action: "wait", requestId: secondWorker.details.requestId, timeoutMs: 1_000 });
  } finally { await coordinator.shutdown(); }
});

test("wait-any returns the first result without cancelling siblings", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "wait-a"); await spawn(coordinator, "wait-b");
    const a = await coordinator.execute({ action: "send", name: "wait-a", prompt: "a" });
    const b = await coordinator.execute({ action: "send", name: "wait-b", prompt: "b" });
    assert.equal(a.ok && b.ok, true);
    const waiting = coordinator.execute({ action: "wait", names: ["wait-a", "wait-b"], mode: "any", timeoutMs: 1_000 });
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
    const all = await coordinator.execute({ action: "wait", names: ["wait-a", "wait-b"], mode: "all", timeoutMs: 1_000 });
    assert.equal(all.ok, true);
    if (all.ok) assert.deepEqual((all.details.requests as Array<{ id: string }>).map(request => request.id).sort(), [a.ok ? a.details.requestId : "", b.ok ? b.details.requestId : ""].sort());
  } finally { await coordinator.shutdown(); }
});

test("wait timeout reports timeout without cancelling work", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "wait-timeout");
    const sent = await coordinator.execute({ action: "send", name: "wait-timeout", prompt: "work" });
    const waited = await coordinator.execute({ action: "wait", requestId: sent.ok ? sent.details.requestId : "", timeoutMs: 1 });
    assert.equal(waited.ok && waited.details.timedOut, true);
    assert.equal(runtimes[0]!.turns[0]!.cancelled, false);
    runtimes[0]!.turns[0]!.finish({ status: "completed" });
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
    const waited = await coordinator.execute({ action: "wait", names: ["mixed-a", "mixed-b", "mixed-c"], mode: "all", timeoutMs: 1_000 });
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
    const waiting = coordinator.execute({ action: "wait", all: true, mode: "all", timeoutMs: 1_000 });
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
    await coordinator.execute({ action: "wait", requestId, timeoutMs: 1_000 });
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
    await coordinator.execute({ action: "wait", all: true, timeoutMs: 1_000 });
    const ar = await coordinator.execute({ action: "result", requestId: a.ok ? a.details.requestId : "" });
    const br = await coordinator.execute({ action: "result", requestId: b.ok ? b.details.requestId : "" });
    assert.equal(ar.ok && ar.details.status, "failed");
    assert.equal(br.ok && br.details.status, "completed");
    assert.equal(runtimes[1]!.turns[0]!.cancelled, false);
    assert.equal(runtimes[1]!.turns[0]!.closed, false);
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
      await coordinator.execute({ action: "wait", requestId: timed.details.requestId, timeoutMs: 1_000 });
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
      await coordinator.execute({ action: "wait", requestId: lost.details.requestId, timeoutMs: 1_000 });
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

test("steer fails explicitly without starting a second runtime turn", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "steerable");
    const sent = await coordinator.execute({ action: "send", name: "steerable", prompt: "work" });
    assert.equal(sent.ok, true);
    const steered = await coordinator.execute({ action: "steer", name: "steerable", prompt: "redirect" });
    assert.equal(steered.ok, false);
    if (!steered.ok) assert.equal(steered.error.code, "STEER_UNSUPPORTED");
    assert.equal(runtimes[0]?.turns.length, 1);
    const unchanged = await coordinator.execute({ action: "result", requestId: sent.ok ? sent.details.requestId : "" });
    assert.equal(unchanged.ok && unchanged.details.status, "running");
    assert.doesNotMatch(unchanged.ok ? String(unchanged.details.output) : "", /redirect/);
    runtimes[0]?.turns[0]?.finish({ status: "completed", stopReason: "end_turn" });
    if (sent.ok) await coordinator.execute({ action: "wait", requestId: sent.details.requestId, timeoutMs: 1_000 });
  } finally { await coordinator.shutdown(); }
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
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, timeoutMs: 1_000 });
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
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, timeoutMs: 1_000 });
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
    if (first.ok) await coordinator.execute({ action: "wait", requestId: first.details.requestId, timeoutMs: 1_000 });
    const second = await coordinator.execute({ action: "send", name: "continuity", prompt: "retrieve nonce" });
    assert.equal(second.ok, true);
    assert.notEqual(first.ok && first.details.requestId, second.ok && second.details.requestId);
    if (second.ok) {
      runtimes[0]!.turns[1]!.finish({ status: "completed" }, [{ type: "text", text: "NONCE:nonce-42", stream: "output" }]);
      await coordinator.execute({ action: "wait", requestId: second.details.requestId, timeoutMs: 1_000 });
      const secondResult = await coordinator.execute({ action: "result", requestId: second.details.requestId });
      assert.match(secondResult.ok ? String(secondResult.details.output) : "", /NONCE:nonce-42/);
      assert.equal(second.details.session, first.ok ? first.details.session : undefined);
    }
  } finally { await coordinator.shutdown(); }
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
    if (sent.ok) await first.execute({ action: "wait", requestId: sent.details.requestId, timeoutMs: 1_000 });
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
    if (sent.ok) await second.execute({ action: "wait", requestId: sent.details.requestId, timeoutMs: 1_000 });
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

test("capability-negotiated steering is acknowledged without a second turn", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "steer-capable");
    runtimes[0]!.capabilities.steering = true;
    const sent = await coordinator.execute({ action: "send", name: "steer-capable", prompt: "phase one" });
    assert.equal(sent.ok, true);
    const steered = await coordinator.execute({ action: "steer", name: "steer-capable", prompt: "direction two" });
    assert.equal(steered.ok, true);
    if (steered.ok) assert.equal(steered.details.status, "delivered");
    assert.equal(runtimes[0]!.turns.length, 1);
    await waitFor(async () => {
      const result = await coordinator.execute({ action: "result", requestId: sent.ok ? sent.details.requestId : "" });
      return result.ok && String(result.details.output).includes("steered:direction two");
    });
    runtimes[0]!.turns[0]!.finish({ status: "completed" });
  } finally { await coordinator.shutdown(); }
});

test("steering completion race has one terminal request outcome", async () => {
  const { coordinator, runtimes } = await harness();
  const acknowledgement = new Deferred<SteeringAcknowledgement>();
  try {
    await spawn(coordinator, "steer-race");
    runtimes[0]!.capabilities.steering = true;
    runtimes[0]!.steerWait = acknowledgement;
    const sent = await coordinator.execute({ action: "send", name: "steer-race", prompt: "work" });
    assert.equal(sent.ok, true);
    const steering = coordinator.execute({ action: "steer", name: "steer-race", prompt: "late" });
    await new Promise(resolve => setImmediate(resolve));
    runtimes[0]!.turns[0]!.finish({ status: "completed" });
    acknowledgement.resolve({ status: "delivered", requestId: runtimes[0]!.lastSteer!.requestId, steerId: runtimes[0]!.lastSteer!.steerId });
    const result = await steering;
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.details.status, "terminal-race");
    if (sent.ok) {
      const terminal = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(terminal.ok && terminal.details.status, "completed");
      assert.equal(runtimes[0]!.turns.length, 1);
    }
  } finally { await coordinator.shutdown(); }
});

test("steering rejects an acknowledgement for the wrong operation", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "steer-mismatch");
    runtimes[0]!.capabilities.steering = true;
    runtimes[0]!.steer = async input => ({ status: "delivered", requestId: input.requestId, steerId: "wrong" });
    await coordinator.execute({ action: "send", name: "steer-mismatch", prompt: "work" });
    const result = await coordinator.execute({ action: "steer", name: "steer-mismatch", prompt: "redirect" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "STEER_ACK_MISMATCH");
    runtimes[0]!.turns[0]!.finish({ status: "completed" });
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

test("correlated child question pauses and resumes the same request", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "question-child");
    runtimes[0]!.capabilities.questions = true;
    const sent = await coordinator.execute({ action: "send", name: "question-child", prompt: "choose" });
    assert.equal(sent.ok, true);
    runtimes[0]!.turns[0]!.emit({ type: "question", questionId: "q-1", text: "Which product decision?" });
    await waitFor(async () => {
      const questions = await coordinator.execute({ action: "questions" });
      return questions.ok && (questions.details.questions as Array<{ status: string }>).some(question => question.status === "pending");
    });
    const blocked = await coordinator.execute({ action: "result", requestId: sent.ok ? sent.details.requestId : "" });
    assert.equal(blocked.ok && blocked.details.status, "waiting");
    const listed = await coordinator.execute({ action: "questions" });
    const questionId = listed.ok ? String((listed.details.questions as Array<{ id: string }>)[0]?.id) : "";
    const replied = await coordinator.execute({ action: "reply", questionId, answer: "choose A" });
    assert.equal(replied.ok, true);
    assert.equal(runtimes[0]!.replies.join(""), "q-1:choose A");
    const answered = await coordinator.execute({ action: "questions" });
    assert.equal(answered.ok && (answered.details.questions as Array<{ id: string; status: string }>).find(question => question.id === questionId)?.status, "answered");
    const resumed = await coordinator.execute({ action: "result", requestId: sent.ok ? sent.details.requestId : "" });
    assert.equal(resumed.ok && resumed.details.status, "running");
    runtimes[0]!.turns[0]!.finish({ status: "completed" });
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, timeoutMs: 1_000 });
      const completed = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(completed.ok && completed.details.status, "completed");
    }
  } finally { await coordinator.shutdown(); }
});

test("question correlation permits the same adapter question id across workers", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "question-a"); await spawn(coordinator, "question-b");
    runtimes[0]!.capabilities.questions = true; runtimes[1]!.capabilities.questions = true;
    await coordinator.execute({ action: "send", name: "question-a", prompt: "a" });
    await coordinator.execute({ action: "send", name: "question-b", prompt: "b" });
    runtimes[0]!.turns[0]!.emit({ type: "question", questionId: "shared", text: "A?" });
    runtimes[0]!.turns[0]!.emit({ type: "question", questionId: "shared", text: "A duplicate?" });
    runtimes[1]!.turns[0]!.emit({ type: "question", questionId: "shared", text: "B?" });
    await waitFor(async () => {
      const listed = await coordinator.execute({ action: "questions" });
      return listed.ok && (listed.details.questions as unknown[]).length === 2;
    });
    const listed = await coordinator.execute({ action: "questions" });
    assert.equal(listed.ok, true);
    if (listed.ok) {
      assert.equal(new Set((listed.details.questions as Array<{ id: string }>).map(q => q.id)).size, 2);
      assert.deepEqual((listed.details.questions as Array<{ adapterQuestionId: string }>).map(q => q.adapterQuestionId).sort(), ["shared", "shared"]);
    }
    const cancelling = coordinator.execute({ action: "cancel", name: "question-a" });
    runtimes[0]!.turns[0]!.finish({ status: "cancelled" });
    assert.equal((await cancelling).ok, true);
    runtimes[1]!.turns[0]!.finish({ status: "completed" });
  } finally { await coordinator.shutdown(); }
});

test("expired child question rejects a late reply", async () => {
  const { coordinator, runtimes } = await harness();
  try {
    await spawn(coordinator, "expiring-question");
    runtimes[0]!.capabilities.questions = true;
    await coordinator.execute({ action: "send", name: "expiring-question", prompt: "ask" });
    runtimes[0]!.turns[0]!.emit({ type: "question", questionId: "expired", text: "Late?", expiresAt: new Date(Date.now() - 1).toISOString() });
    await waitFor(async () => {
      const listed = await coordinator.execute({ action: "questions" });
      return listed.ok && (listed.details.questions as Array<{ status: string }>).some(q => q.status === "expired");
    });
    const listed = await coordinator.execute({ action: "questions" });
    const id = listed.ok ? String((listed.details.questions as Array<{ id: string }>)[0]?.id) : "";
    const reply = await coordinator.execute({ action: "reply", questionId: id, answer: "too late" });
    assert.equal(reply.ok, false);
    if (!reply.ok) assert.equal(reply.error.code, "QUESTION_SETTLED");
    const cancelling = coordinator.execute({ action: "cancel", name: "expiring-question" });
    runtimes[0]!.turns[0]!.finish({ status: "cancelled" });
    await cancelling;
  } finally { await coordinator.shutdown(); }
});

test("pending child question expires explicitly after parent loss", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-question-loss-"));
  const profile = { agent: "pi", role: "read-only" as const, tools: ["read"], timeoutMs: 10_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 };
  const runtime = new FakeRuntime();
  runtime.capabilities.questions = true;
  const first = new Coordinator(process.cwd(), { stateDir, profiles: { "pi-reviewer": profile }, runtimeFactory: () => runtime });
  try {
    await spawn(first, "orphan-question");
    const sent = await first.execute({ action: "send", name: "orphan-question", prompt: "ask" });
    assert.equal(sent.ok, true);
    runtime.turns[0]!.emit({ type: "question", questionId: "q-orphan", text: "Need authority" });
    await waitFor(async () => {
      const questions = await first.execute({ action: "questions" });
      return questions.ok && (questions.details.questions as Array<{ adapterQuestionId: string; status: string }>).some(question => question.adapterQuestionId === "q-orphan" && question.status === "pending");
    });
  } finally { await first.shutdown(); }
  const replacement = new Coordinator(process.cwd(), { stateDir, profiles: { "pi-reviewer": profile }, runtimeFactory: () => new FakeRuntime() });
  try {
    const questions = await replacement.execute({ action: "questions" });
    assert.equal(questions.ok, true, questions.ok ? "" : JSON.stringify(questions));
    if (questions.ok) assert.equal((questions.details.questions as Array<{ adapterQuestionId: string; status: string }>).find(question => question.adapterQuestionId === "q-orphan")?.status, "expired");
  } finally { await replacement.shutdown(); }
});
