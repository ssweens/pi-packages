import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Coordinator } from "../extensions/pi-strings/orchestration/coordinator.ts";
import { StateStore } from "../extensions/pi-strings/persistence/state-store.ts";

test("coordinator state lease excludes a second parent", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-strings-state-"));
  const first = new StateStore(root);
  const second = new StateStore(root);
  await first.acquire();
  try {
    await assert.rejects(second.acquire(), (error: unknown) => (error as { code?: string }).code === "COORDINATOR_OWNED");
  } finally {
    await first.close();
  }
});

test("coordinator state is atomic, private, and corruption is explicit", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-strings-state-"));
  const store = new StateStore(root);
  await store.acquire();
  try {
    await store.save([], []);
    const path = join(root, "state.json");
    assert.equal((await stat(root)).mode & 0o777, 0o700);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await store.load(), { version: 1, workers: [], requests: [], sessions: [] });
    await writeFile(path, "{broken", { mode: 0o600 });
    await assert.rejects(store.load(), (error: unknown) => (error as { code?: string }).code === "STATE_CORRUPT");
    assert.equal(await readFile(path, "utf8"), "{broken");
  } finally {
    await store.close();
  }
});

test("coordinator rejects structurally invalid nested state", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-strings-state-"));
  const store = new StateStore(root);
  await store.acquire();
  try {
    await writeFile(join(root, "state.json"), JSON.stringify({ version: 1, workers: [{ name: "bad", profileName: "pi-reviewer", role: "writer", status: "idle", cwd: "/repo", handle: {}, createdAt: "not-a-date", updatedAt: "not-a-date" }], requests: [] }), { mode: 0o600 });
    await assert.rejects(store.load(), (error: unknown) => (error as { code?: string }).code === "STATE_CORRUPT");
  } finally {
    await store.close();
  }
});

test("legacy waiting statuses are rejected as corrupt state", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-strings-state-"));
  const store = new StateStore(root);
  await store.acquire();
  try {
    await writeFile(join(root, "state.json"), JSON.stringify({ version: 1, workers: [], requests: [{ id: "req", workerName: "worker", status: "waiting", startedAt: new Date().toISOString(), output: "", truncated: false }] }), { mode: 0o600 });
    await assert.rejects(store.load(), (error: unknown) => (error as { code?: string }).code === "STATE_CORRUPT");
  } finally { await store.close(); }
});

test("legacy questions are rejected as corrupt state", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-strings-state-"));
  const store = new StateStore(root);
  await store.acquire();
  try {
    await writeFile(join(root, "state.json"), JSON.stringify({ version: 1, workers: [], requests: [], questions: [] }), { mode: 0o600 });
    await assert.rejects(store.load(), (error: unknown) => (error as { code?: string }).code === "STATE_CORRUPT");
  } finally { await store.close(); }
});

test("shutdown after failed initialization preserves corrupt state", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-strings-state-"));
  const path = join(root, "state.json");
  await writeFile(path, "{broken", { mode: 0o600 });
  const coordinator = new Coordinator(process.cwd(), { stateDir: root });
  const result = await coordinator.execute({ action: "list" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "STATE_CORRUPT");
  await coordinator.shutdown();
  assert.equal(await readFile(path, "utf8"), "{broken");
});

test("request usage, acceptance, attemptModels, and attempts round-trip through state", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-strings-state-"));
  const store = new StateStore(root);
  await store.acquire();
  try {
    const now = new Date().toISOString();
    await store.save([], [{
      id: "req-1", workerName: "w", status: "completed", startedAt: now, output: "done", truncated: false,
      eventPath: join(root, "requests", "req-1.ndjson"),
      usage: { breakdown: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, cost: { amount: 0.01, currency: "USD" } },
      acceptance: { parsed: true, report: { changedFiles: ["a.ts"] } },
      attemptModels: ["primary", "backup"], attempts: 2,
    }]);
    const loaded = await store.load();
    const request = loaded.requests[0];
    assert.ok(request, "request was not persisted/loaded");
    assert.equal(request!.usage?.breakdown?.totalTokens, 15);
    assert.equal(request!.usage?.cost?.amount, 0.01);
    assert.equal(request!.acceptance?.parsed, true);
    assert.deepEqual(request!.acceptance?.report, { changedFiles: ["a.ts"] });
    assert.deepEqual(request!.attemptModels, ["primary", "backup"]);
    assert.equal(request!.attempts, 2);
  } finally {
    await store.close();
  }
});
