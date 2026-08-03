import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { access, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Coordinator } from "../../extensions/pi-strings/orchestration/coordinator.ts";
import type { Profile } from "../../extensions/pi-strings/domain/types.ts";

const enabled = process.env.PI_STRINGS_E2E === "1";
const configured = {
  pi: process.env.PI_STRINGS_TEST_PI_MODEL,
  codex: process.env.PI_STRINGS_TEST_CODEX_MODEL,
  opencode: process.env.PI_STRINGS_TEST_OPENCODE_MODEL ?? "opencode/north-mini-code-free",
};

function available(command: string): boolean {
  try { execFileSync("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" }); return true; } catch { return false; }
}

function skipReason(agent: keyof typeof configured): string | undefined {
  if (!enabled) return "set PI_STRINGS_E2E=1 to opt in";
  if (!configured[agent]) return `set PI_STRINGS_TEST_${agent.toUpperCase()}_MODEL`;
  if (agent === "pi" && !available("pi")) return "pi executable is unavailable";
  if (agent === "codex" && !available("codex")) return "codex executable is unavailable";
  if (agent === "opencode" && !available("opencode")) return "opencode executable is unavailable";
  return undefined;
}

function profile(agent: keyof typeof configured, role: "read-only" | "writer", tools: string[]): Profile {
  return { agent, role, ...(configured[agent] ? { model: configured[agent] } : {}), tools, timeoutMs: 120_000, cancellationGraceMs: 5_000, maxOutputBytes: 32_000 };
}

async function closeAll(coordinator: Coordinator, names: string[]): Promise<void> {
  for (const name of names) await coordinator.execute({ action: "close", name, force: true }).catch(() => undefined);
  await coordinator.shutdown();
}

async function realPiParentKill(): Promise<void> {
  const { mkdtemp } = await import("node:fs/promises");
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-hosted-parent-kill-"));
  const barrier = join(process.cwd(), `.pi-strings-parent-kill-${Date.now()}.txt`);
  await writeFile(barrier, "WAIT\n", { mode: 0o600 });
  const child = fork(new URL("../fixtures/hosted-parent-owner.ts", import.meta.url), [stateDir, barrier], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  let agentPid = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("message", message => {
        if (message && typeof message === "object" && (message as { type?: string }).type === "ready") {
          agentPid = Number((message as { agentPid?: number }).agentPid ?? 0);
          resolve();
        } else reject(new Error(`hosted parent fixture failed: ${JSON.stringify(message)}`));
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => reject(new Error(`hosted parent fixture exited before ready: ${code ?? signal}`)));
    });
    assert.ok(agentPid > 0, "hosted fixture did not expose the live Pi child pid");
    child.kill("SIGKILL");
    await new Promise<void>(resolve => child.once("exit", () => resolve()));
    try { process.kill(-agentPid, "SIGKILL"); } catch {}
    const stale = new Date(Date.now() - 60_000);
    await utimes(`${stateDir}.lock`, stale, stale);
    const coordinator = new Coordinator(process.cwd(), { stateDir, profiles: { reviewer: profile("pi", "read-only", ["read", "grep", "find", "ls"]) } });
    try {
      const listed = await coordinator.execute({ action: "list" });
      assert.equal(listed.ok, true);
      if (listed.ok) {
        const request = (listed.details.requests as Array<{ status: string; output: string; eventPath: string; failure?: { code: string } }>)[0];
        const worker = (listed.details.workers as Array<{ name: string; status: string }>).find(candidate => candidate.name === "crashed");
        assert.equal(request?.status, "failed");
        assert.equal(request?.failure?.code, "PARENT_PROCESS_LOST");
        const events = (await readFile(request!.eventPath, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { event?: { type?: string; stream?: string; text?: string } });
        const output = events.filter(entry => entry.event?.type === "text" && entry.event.stream === "output").map(entry => entry.event?.text ?? "").join("");
        assert.match(output, /PARENT_KILL_READY/);
        assert.equal(worker?.status, "failed");
      }
    } finally { await coordinator.shutdown(); }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (agentPid > 0) { try { process.kill(-agentPid, "SIGKILL"); } catch {} }
    await rm(barrier, { force: true });
  }
}

async function smoke(agent: keyof typeof configured): Promise<void> {
  const stateDir = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), `pi-strings-${agent}-`)));
  const coordinator = new Coordinator(process.cwd(), { stateDir, profiles: { reviewer: profile(agent, "read-only", ["read", "grep", "find", "ls"]) } });
  const workerName = `${agent}-reviewer`;
  try {
    assert.equal((await coordinator.execute({ action: "spawn", name: workerName, profile: "reviewer", cwd: process.cwd() })).ok, true);
    const sent = await coordinator.execute({ action: "send", name: workerName, prompt: "Return exactly the word READY and no tool calls." });
    assert.equal(sent.ok, true);
    if (!sent.ok) return;
    await coordinator.execute({ action: "wait", requestId: String(sent.details.requestId), waitTimeoutMs: 120_000 });
    const result = await coordinator.execute({ action: "result", requestId: String(sent.details.requestId) });
    assert.equal(result.ok && result.details.status, "completed");
    assert.match(result.ok ? String(result.details.output) : "", /READY/);
  } finally { await closeAll(coordinator, [workerName]); }
}

async function realPiOverlap(): Promise<void> {
  const { mkdtemp } = await import("node:fs/promises");
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-overlap-"));
  const barrier = join(process.cwd(), `.pi-strings-barrier-${Date.now()}.txt`);
  await writeFile(barrier, "WAIT\n", { mode: 0o600 });
  const coordinator = new Coordinator(process.cwd(), { stateDir, profiles: { reviewer: profile("pi", "read-only", ["read", "grep", "find", "ls"]) } });
  try {
    for (const name of ["overlap-a", "overlap-b"]) assert.equal((await coordinator.execute({ action: "spawn", name, profile: "reviewer", cwd: process.cwd() })).ok, true);
    const sent = await Promise.all(["overlap-a", "overlap-b"].map(name => coordinator.execute({ action: "send", name, prompt: `Read ${barrier} repeatedly. Do not finish. First output the exact marker READY_${name.toUpperCase().replace("-", "_")}, then keep reading until the file contains RELEASE. Only then output DONE_${name.toUpperCase().replace("-", "_")}.` })));
    assert.ok(sent.every(result => result.ok));
    for (const marker of ["READY_OVERLAP_A", "READY_OVERLAP_B"]) {
      let observed = false;
      for (let attempt = 0; attempt < 120 && !observed; attempt += 1) {
        let matchingRequest: (typeof sent)[number] | undefined;
        for (const candidate of sent) {
          if (candidate.ok && String(candidate.details.worker).toLowerCase().replace("-", "_") === marker.slice(6).toLowerCase()) matchingRequest = candidate;
        }
        if (matchingRequest?.ok) {
          const observedResult = await coordinator.execute({ action: "result", requestId: matchingRequest.details.requestId });
          observed = observedResult.ok && String(observedResult.details.output).includes(marker);
        } else {
          observed = false;
        }
        if (!observed) await new Promise(resolve => setTimeout(resolve, 250));
      }
      assert.equal(observed, true, `${marker} was not observed before release`);
    }
    const beforeRelease = await coordinator.execute({ action: "list" });
    assert.equal(beforeRelease.ok, true);
    if (beforeRelease.ok) assert.equal((beforeRelease.details.workers as Array<{ status: string }>).filter(worker => worker.status === "running").length, 2);
    await writeFile(barrier, "RELEASE\n", { mode: 0o600 });
    const waited = await coordinator.execute({ action: "wait", names: ["overlap-a", "overlap-b"], mode: "all", waitTimeoutMs: 120_000 });
    assert.equal(waited.ok, true);
    if (waited.ok) assert.ok((waited.details.requests as Array<{ status: string }>).every(request => request.status === "completed"));
  } finally { await closeAll(coordinator, ["overlap-a", "overlap-b"]); await rm(barrier, { force: true }); }
}

async function realPiCancellation(): Promise<void> {
  const { mkdtemp } = await import("node:fs/promises");
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-cancel-real-"));
  const barrier = join(process.cwd(), `.pi-strings-cancel-${Date.now()}.txt`);
  await writeFile(barrier, "WAIT\n", { mode: 0o600 });
  const coordinator = new Coordinator(process.cwd(), { stateDir, profiles: { reviewer: profile("pi", "read-only", ["read", "grep", "find", "ls"]) } });
  try {
    assert.equal((await coordinator.execute({ action: "spawn", name: "cancellable", profile: "reviewer", cwd: process.cwd() })).ok, true);
    const sent = await coordinator.execute({ action: "send", name: "cancellable", prompt: `Output the exact marker CANCEL_READY, then repeatedly read ${barrier} without finishing.` });
    assert.equal(sent.ok, true);
    let ready = false;
    for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
      const current = sent.ok ? await coordinator.execute({ action: "result", requestId: sent.details.requestId }) : sent;
      ready = current.ok && String(current.details.output).includes("CANCEL_READY");
      if (!ready) await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(ready, true, "real Pi did not reach the cancellation phase");
    const cancelled = await coordinator.execute({ action: "cancel", name: "cancellable", reason: "acceptance test" });
    assert.equal(cancelled.ok, true);
    if (sent.ok) {
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "cancelled");
    }
  } finally { await closeAll(coordinator, ["cancellable"]); await rm(barrier, { force: true }); }
}

async function realPiReconnect(): Promise<void> {
  const { mkdtemp } = await import("node:fs/promises");
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-reconnect-real-"));
  const token = `PI_STRINGS_REAL_${Date.now()}`;
  let session = "";
  const first = new Coordinator(process.cwd(), { stateDir, profiles: { reviewer: profile("pi", "read-only", ["read", "grep", "find", "ls"]) } });
  try {
    assert.equal((await first.execute({ action: "spawn", name: "continuity", profile: "reviewer", cwd: process.cwd() })).ok, true);
    const sent = await first.execute({ action: "send", name: "continuity", prompt: `Remember this exact token ${token}. Reply with ACK and the token.` });
    assert.equal(sent.ok, true);
    if (sent.ok) {
      session = String(sent.details.session);
      await first.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 120_000 });
      const result = await first.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "completed");
      assert.match(result.ok ? String(result.details.output) : "", new RegExp(token));
    }
  } finally { await first.shutdown(); }
  const second = new Coordinator(process.cwd(), { stateDir, profiles: { reviewer: profile("pi", "read-only", ["read", "grep", "find", "ls"]) } });
  try {
    const listed = await second.execute({ action: "list" });
    assert.equal(listed.ok, true);
    if (listed.ok) assert.equal((listed.details.workers as Array<{ session: string; status: string }>)[0]?.session, session);
    const followUp = await second.execute({ action: "send", name: "continuity", prompt: `What exact token did I ask you to remember? Reply with only ${token}.` });
    assert.equal(followUp.ok, true);
    if (followUp.ok) {
      await second.execute({ action: "wait", requestId: followUp.details.requestId, waitTimeoutMs: 120_000 });
      const result = await second.execute({ action: "result", requestId: followUp.details.requestId });
      assert.equal(result.ok && result.details.status, "completed");
      assert.match(result.ok ? String(result.details.output) : "", new RegExp(token));
    }
    await second.execute({ action: "close", name: "continuity", discardPersistentState: true });
  } finally { await second.shutdown(); }
}

async function writerReassignment(): Promise<void> {
  const worktree = process.env.PI_STRINGS_E2E_WRITER_WORKTREE!;
  const { mkdtemp } = await import("node:fs/promises");
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-writer-reassign-"));
  const marker = `.pi-strings-reassign-${Date.now()}.txt`;
  const markerPath = join(worktree, marker);
  const barrier = join(worktree, `.pi-strings-reassign-barrier-${Date.now()}.txt`);
  await writeFile(barrier, "WAIT\n", { mode: 0o600 });
  const coordinator = new Coordinator(process.cwd(), { stateDir, profiles: { writer: profile("pi", "writer", ["read", "grep", "find", "ls", "edit", "write"]) } });
  try {
    assert.equal((await coordinator.execute({ action: "spawn", name: "writer-a", profile: "writer", cwd: worktree })).ok, true);
    const first = await coordinator.execute({ action: "send", name: "writer-a", prompt: `Use the write tool to write exactly PARTIAL to ${markerPath}. Then repeatedly read ${barrier} without finishing.` });
    assert.equal(first.ok, true);
    let partial = false;
    for (let attempt = 0; attempt < 120 && !partial; attempt += 1) {
      try { partial = (await readFile(markerPath, "utf8")).trim() === "PARTIAL"; } catch {}
      if (!partial) await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!partial) {
      const evidence = first.ok ? await coordinator.execute({ action: "result", requestId: first.details.requestId }) : first;
      throw new Error(`writer did not leave partial disk evidence: ${JSON.stringify(evidence.ok ? { output: evidence.details.output, eventPath: evidence.details.eventPath } : evidence)}`);
    }
    const cancelled = await coordinator.execute({ action: "cancel", name: "writer-a", reason: "reassign" });
    assert.equal(cancelled.ok, true);
    const firstResult = first.ok ? await coordinator.execute({ action: "result", requestId: first.details.requestId }) : first;
    assert.equal(firstResult.ok && firstResult.details.status, "cancelled");
    assert.equal((await coordinator.execute({ action: "close", name: "writer-a" })).ok, true);
    assert.equal((await coordinator.execute({ action: "spawn", name: "writer-b", profile: "writer", cwd: worktree })).ok, true);
    const second = await coordinator.execute({ action: "send", name: "writer-b", predecessorRequestId: first.ok ? first.details.requestId : "", prompt: `Replace the contents of ${markerPath} with exactly COMPLETE, then report the final content.` });
    assert.equal(second.ok, true);
    if (second.ok) {
      assert.equal(second.details.attempt, 2);
      assert.notEqual(second.details.session, first.ok ? first.details.session : "");
      await coordinator.execute({ action: "wait", requestId: second.details.requestId, waitTimeoutMs: 120_000 });
      const result = await coordinator.execute({ action: "result", requestId: second.details.requestId });
      assert.equal(result.ok && result.details.status, "completed");
      assert.match((await readFile(markerPath, "utf8")).trim(), /^COMPLETE$/);
      const predecessor = first.ok ? await coordinator.execute({ action: "result", requestId: first.details.requestId }) : first;
      assert.equal(predecessor.ok && predecessor.details.supersededBy, second.details.requestId);
    }
  } finally { await closeAll(coordinator, ["writer-a", "writer-b"]); await rm(markerPath, { force: true }); await rm(barrier, { force: true }); }
}

async function writerResume(): Promise<void> {
  const worktree = process.env.PI_STRINGS_E2E_WRITER_WORKTREE!;
  const { mkdtemp } = await import("node:fs/promises");
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-writer-resume-"));
  const marker = `.pi-strings-resume-${Date.now()}.txt`;
  const markerPath = join(worktree, marker);
  let session = "";
  const profileName = "writer";
  const profiles = { writer: profile("pi", "writer", ["read", "grep", "find", "ls", "edit", "write"]) };
  const first = new Coordinator(process.cwd(), { stateDir, profiles });
  try {
    const spawned = await first.execute({ action: "spawn", name: "writer", profile: profileName, cwd: worktree });
    assert.equal(spawned.ok, true, spawned.ok ? "" : JSON.stringify(spawned));
    if (!spawned.ok) return;
    session = String(spawned.details.session);
    const initial = await first.execute({ action: "send", name: "writer", prompt: `Use the write tool to create ${markerPath} with exactly INITIAL. Then report the result.` });
    assert.equal(initial.ok, true);
    if (initial.ok) {
      await first.execute({ action: "wait", requestId: initial.details.requestId, waitTimeoutMs: 120_000 });
      const result = await first.execute({ action: "result", requestId: initial.details.requestId });
      assert.equal(result.ok && result.details.status, "completed");
    }
    assert.equal((await readFile(markerPath, "utf8")).trim(), "INITIAL");
    assert.equal((await first.execute({ action: "close", name: "writer" })).ok, true);
  } finally { await first.shutdown(); }

  const second = new Coordinator(process.cwd(), { stateDir, profiles });
  try {
    const resumed = await second.execute({ action: "spawn", name: "writer-resumed", profile: profileName, cwd: worktree, resumeSessionId: session });
    assert.equal(resumed.ok, true, resumed.ok ? "" : JSON.stringify(resumed));
    const followUp = await second.execute({ action: "send", name: "writer-resumed", prompt: `Use the write tool to replace ${markerPath} with exactly RESUMED. Then report the final content.` });
    assert.equal(followUp.ok, true);
    if (followUp.ok) {
      await second.execute({ action: "wait", requestId: followUp.details.requestId, waitTimeoutMs: 120_000 });
      const result = await second.execute({ action: "result", requestId: followUp.details.requestId });
      assert.equal(result.ok && result.details.status, "completed");
    }
    assert.equal((await readFile(markerPath, "utf8")).trim(), "RESUMED");
  } finally { await closeAll(second, ["writer-resumed"]); await rm(markerPath, { force: true }); }
}

async function externalWriterReassignment(agent: "codex" | "opencode"): Promise<void> {
  const worktree = process.env.PI_STRINGS_E2E_WRITER_WORKTREE!;
  const { mkdtemp } = await import("node:fs/promises");
  const stateDir = await mkdtemp(join(tmpdir(), `pi-strings-${agent}-reassign-`));
  const marker = `.pi-strings-${agent}-reassign-${Date.now()}.txt`;
  const markerPath = join(worktree, marker);
  const barrier = join(worktree, `.pi-strings-${agent}-reassign-barrier-${Date.now()}.txt`);
  await writeFile(barrier, "WAIT\n", { mode: 0o600 });
  const coordinator = new Coordinator(process.cwd(), { stateDir, profiles: { writer: profile(agent, "writer", ["read", "grep", "find", "ls", "edit", "write"]) } });
  try {
    const firstSpawn = await coordinator.execute({ action: "spawn", name: `${agent}-writer-a`, profile: "writer", cwd: worktree });
    assert.equal(firstSpawn.ok, true, firstSpawn.ok ? "" : JSON.stringify(firstSpawn));
    const first = await coordinator.execute({ action: "send", name: `${agent}-writer-a`, prompt: `Use the write tool to write exactly PARTIAL to ${markerPath}. Then repeatedly read ${barrier} without finishing.` });
    assert.equal(first.ok, true);
    let partial = false;
    for (let attempt = 0; attempt < 120 && !partial; attempt += 1) {
      try { partial = (await readFile(markerPath, "utf8")).trim() === "PARTIAL"; } catch {}
      if (!partial) await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!partial) {
      const evidence = first.ok ? await coordinator.execute({ action: "result", requestId: first.details.requestId }) : first;
      throw new Error(`external writer did not leave partial evidence: ${JSON.stringify(evidence.ok ? { status: evidence.details.status, output: evidence.details.output, eventPath: evidence.details.eventPath } : evidence)}`);
    }
    const cancelled = await coordinator.execute({ action: "cancel", name: `${agent}-writer-a`, reason: "reassign" });
    assert.equal(cancelled.ok, true);
    const firstResult = first.ok ? await coordinator.execute({ action: "result", requestId: first.details.requestId }) : first;
    assert.equal(firstResult.ok && firstResult.details.status, "cancelled");
    assert.equal((await coordinator.execute({ action: "close", name: `${agent}-writer-a` })).ok, true);
    assert.equal((await coordinator.execute({ action: "spawn", name: `${agent}-writer-b`, profile: "writer", cwd: worktree })).ok, true);
    const second = await coordinator.execute({ action: "send", name: `${agent}-writer-b`, predecessorRequestId: first.ok ? first.details.requestId : "", prompt: `Use the write tool to replace ${markerPath} with exactly COMPLETE, then report the final content.` });
    assert.equal(second.ok, true);
    if (second.ok) {
      assert.equal(second.details.attempt, 2);
      await coordinator.execute({ action: "wait", requestId: second.details.requestId, waitTimeoutMs: 120_000 });
      const result = await coordinator.execute({ action: "result", requestId: second.details.requestId });
      assert.equal(result.ok && result.details.status, "completed");
      assert.equal((await readFile(markerPath, "utf8")).trim(), "COMPLETE");
    }
  } finally { await closeAll(coordinator, [`${agent}-writer-a`, `${agent}-writer-b`]); await rm(markerPath, { force: true }); await rm(barrier, { force: true }); }
}

async function writerReviewer(): Promise<void> {
  const worktree = process.env.PI_STRINGS_E2E_WRITER_WORKTREE!;
  const { mkdtemp } = await import("node:fs/promises");
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-writer-reviewer-"));
  const token = `PI_STRINGS_${Date.now()}`;
  const marker = `.pi-strings-${Date.now()}.txt`;
  const markerPath = join(worktree, marker);
  const parentMarker = join(process.cwd(), marker);
  const coordinator = new Coordinator(process.cwd(), { stateDir, profiles: {
    writer: profile("pi", "writer", ["read", "grep", "find", "ls", "edit", "write"]),
    reviewer: profile("pi", "read-only", ["read", "grep", "find", "ls"]),
  } });
  try {
    assert.equal((await coordinator.execute({ action: "spawn", name: "writer", profile: "writer", cwd: worktree })).ok, true);
    const write = await coordinator.execute({ action: "send", name: "writer", prompt: `Create ${markerPath} containing exactly ${token}. Do not modify any other file.` });
    assert.equal(write.ok, true); if (write.ok) {
      await coordinator.execute({ action: "wait", requestId: write.details.requestId, waitTimeoutMs: 120_000 });
      const writeResult = await coordinator.execute({ action: "result", requestId: write.details.requestId });
      assert.equal(writeResult.ok && writeResult.details.status, "completed");
    }
    assert.equal((await readFile(markerPath, "utf8")).trim(), token);
    await assert.rejects(access(parentMarker));
    assert.equal((await coordinator.execute({ action: "spawn", name: "reviewer", profile: "reviewer", cwd: worktree })).ok, true);
    const listing = await coordinator.execute({ action: "list" });
    assert.equal(listing.ok, true);
    if (listing.ok) {
      const reviewer = (listing.details.workers as Array<{ name: string; role: string; profile: string }>).find(worker => worker.name === "reviewer");
      assert.equal(reviewer?.role, "read-only");
      assert.equal(reviewer?.profile, "reviewer");
    }
    const review = await coordinator.execute({ action: "send", name: "reviewer", prompt: `Read ${markerPath} and report its exact content.` });
    assert.equal(review.ok, true); if (review.ok) await coordinator.execute({ action: "wait", requestId: review.details.requestId, waitTimeoutMs: 120_000 });
    const result = review.ok ? await coordinator.execute({ action: "result", requestId: review.details.requestId }) : review;
    assert.match(result.ok ? String(result.details.output) : "", new RegExp(token));
  } finally { await closeAll(coordinator, ["writer", "reviewer"]); await rm(markerPath, { force: true }); }
}

async function externalWriterBoundary(agent: "codex" | "opencode"): Promise<void> {
  const worktree = process.env.PI_STRINGS_E2E_WRITER_WORKTREE!;
  const { mkdtemp } = await import("node:fs/promises");
  const stateDir = await mkdtemp(join(tmpdir(), `pi-strings-${agent}-writer-`));
  const marker = `.pi-strings-${agent}-${Date.now()}.txt`;
  const markerPath = join(worktree, marker);
  const forbidden = join(process.cwd(), `.pi-strings-forbidden-${agent}-${Date.now()}.txt`);
  const opencodeConfig = join(worktree, "opencode.json");
  const priorOpenCodeConfig = process.env.OPENCODE_CONFIG_CONTENT;
  if (agent === "opencode") {
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ permission: { edit: "allow", external_directory: "deny" } });
    await writeFile(opencodeConfig, JSON.stringify({ permission: { edit: "allow", external_directory: "deny" } }) + "\n", { mode: 0o600 });
  }
  const coordinator = new Coordinator(process.cwd(), { stateDir, profiles: {
    writer: profile(agent, "writer", ["read", "edit", "write"]),
    reviewer: profile("pi", "read-only", ["read", "grep", "find", "ls"]),
  } });
  try {
    const spawned = await coordinator.execute({ action: "spawn", name: `${agent}-writer`, profile: "writer", cwd: worktree });
    assert.equal(spawned.ok, true, spawned.ok ? "" : JSON.stringify(spawned));
    const sent = await coordinator.execute({ action: "send", name: `${agent}-writer`, prompt: `Use the write tool to create ${markerPath} with exactly the text ALLOWED. Do only this write, then report the result.` });
    assert.equal(sent.ok, true);
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, waitTimeoutMs: 120_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "completed", result.ok ? String(result.details.output) : JSON.stringify(result));
      try {
        assert.equal((await readFile(markerPath, "utf8")).trim(), "ALLOWED");
      } catch (error) {
        throw new Error(`declared writer marker missing; result=${JSON.stringify(result.ok ? { output: result.details.output, eventPath: result.details.eventPath } : result)}; cause=${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const forbiddenAttempt = await coordinator.execute({ action: "send", name: `${agent}-writer`, prompt: `Attempt one write-tool call to ${forbidden} with exactly the text FORBIDDEN. This path is outside your assigned worktree. Report whether the tool was rejected.` });
    assert.equal(forbiddenAttempt.ok, true);
    if (forbiddenAttempt.ok) await coordinator.execute({ action: "wait", requestId: forbiddenAttempt.details.requestId, waitTimeoutMs: 120_000 });
    if (await access(forbidden).then(() => true, () => false)) {
      const evidence = forbiddenAttempt.ok ? await coordinator.execute({ action: "result", requestId: forbiddenAttempt.details.requestId }) : forbiddenAttempt;
      throw new Error(`forbidden writer path was created: ${JSON.stringify(evidence.ok ? { output: evidence.details.output, eventPath: evidence.details.eventPath } : evidence)}`);
    }
    assert.equal((await coordinator.execute({ action: "spawn", name: `${agent}-reviewer`, profile: "reviewer", cwd: worktree })).ok, true);
    const review = await coordinator.execute({ action: "send", name: `${agent}-reviewer`, prompt: `Read ${markerPath} and report the exact file content.` });
    assert.equal(review.ok, true);
    if (review.ok) {
      await coordinator.execute({ action: "wait", requestId: review.details.requestId, waitTimeoutMs: 120_000 });
      const result = await coordinator.execute({ action: "result", requestId: review.details.requestId });
      assert.equal(result.ok && result.details.status, "completed");
      assert.match(result.ok ? String(result.details.output) : "", /ALLOWED/);
    }
    const listing = await coordinator.execute({ action: "list" });
    assert.equal(listing.ok, true);
    if (listing.ok) assert.equal((listing.details.workers as Array<{ name: string; role: string }>).find(worker => worker.name === `${agent}-reviewer`)?.role, "read-only");
  } finally {
    await closeAll(coordinator, [`${agent}-writer`, `${agent}-reviewer`]); await rm(markerPath, { force: true }); await rm(forbidden, { force: true }); await rm(opencodeConfig, { force: true });
    if (priorOpenCodeConfig === undefined) delete process.env.OPENCODE_CONFIG_CONTENT; else process.env.OPENCODE_CONFIG_CONTENT = priorOpenCodeConfig;
  }
}

const writerSkip = process.env.PI_STRINGS_E2E_WRITER_WORKTREE ? skipReason("pi") : "set PI_STRINGS_E2E_WRITER_WORKTREE to an existing linked worktree";
function externalWriterSkip(agent: "codex" | "opencode"): string | undefined {
  if (!process.env.PI_STRINGS_E2E_WRITER_WORKTREE) return "set PI_STRINGS_E2E_WRITER_WORKTREE to an existing linked worktree";
  return skipReason(agent) ?? skipReason("pi");
}
test("real Pi ACP spawn-send-wait smoke", { skip: skipReason("pi") }, async () => smoke("pi"));
test("real Pi parent kill preserves active-turn evidence", { skip: skipReason("pi") }, realPiParentKill);
test("real Codex ACP spawn-send-wait smoke", { skip: skipReason("codex") }, async () => smoke("codex"));
test("real OpenCode ACP spawn-send-wait smoke", { skip: skipReason("opencode") }, async () => smoke("opencode"));
test("real Pi workers overlap", { skip: skipReason("pi") }, realPiOverlap);
test("real Pi cooperative cancellation remains cancelled", { skip: skipReason("pi") }, realPiCancellation);
test("real Pi session continuity survives coordinator restart", { skip: skipReason("pi") }, realPiReconnect);
test("real Pi writer then fresh reviewer remains worktree-isolated", { skip: writerSkip }, writerReviewer);
test("real Pi writer cancellation then reassignment preserves authority", { skip: writerSkip }, writerReassignment);
test("real Pi writer resume preserves role and worktree authority", { skip: writerSkip }, writerResume);
test("real Codex writer permission boundary", { skip: externalWriterSkip("codex") }, async () => externalWriterBoundary("codex"));
test("real OpenCode writer permission boundary", { skip: externalWriterSkip("opencode") }, async () => externalWriterBoundary("opencode"));
test("real Codex writer cancellation then reassignment preserves authority", { skip: externalWriterSkip("codex") }, async () => externalWriterReassignment("codex"));
test("real OpenCode writer cancellation then reassignment preserves authority", { skip: externalWriterSkip("opencode") }, async () => externalWriterReassignment("opencode"));
