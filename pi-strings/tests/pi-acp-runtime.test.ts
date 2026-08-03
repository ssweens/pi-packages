import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { Coordinator } from "../extensions/pi-strings/orchestration/coordinator.ts";
import { AcpxRuntimePort } from "../extensions/pi-strings/runtime/acpx-runtime.ts";
import { PiAcpRuntimePort } from "../extensions/pi-strings/runtime/pi-acp-runtime.ts";
import type { Profile } from "../extensions/pi-strings/domain/types.ts";

const fakePi = new URL("./fixtures/fake-pi.mjs", import.meta.url).pathname;
const fakeExternalQuestionAgent = fileURLToPath(new URL("./fixtures/fake-acp-agent.ts", import.meta.url));
const tsxLoader = fileURLToPath(new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url));
const profile: Profile = { agent: "pi", role: "read-only", tools: ["read"], timeoutMs: 2_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 };

test("Pi ACP runtime preserves session context across a fresh runtime connection", async () => {
  const priorCommand = process.env.PI_ACP_PI_COMMAND;
  const priorState = process.env.FAKE_PI_STATE_FILE;
  const priorSession = process.env.FAKE_PI_SESSION_FILE;
  process.env.PI_ACP_PI_COMMAND = fakePi;
  const cwd = await mkdtemp(join(tmpdir(), "pi-strings-pi-resume-"));
  process.env.FAKE_PI_STATE_FILE = join(cwd, "fake-state.txt");
  process.env.FAKE_PI_SESSION_FILE = join(cwd, "fake-session.jsonl");
  const first = new PiAcpRuntimePort(cwd, profile);
  const second = new PiAcpRuntimePort(cwd, profile);
  let firstHandle: Awaited<ReturnType<PiAcpRuntimePort["ensureSession"]>> | undefined;
  let secondHandle: Awaited<ReturnType<PiAcpRuntimePort["ensureSession"]>> | undefined;
  try {
    firstHandle = await first.ensureSession({ name: "resume-one", agent: "pi", cwd, profile });
    const turn = first.startTurn({ handle: firstHandle, prompt: "SET:nonce-42", requestId: "set", timeoutMs: 2_000, mode: "prompt" });
    assert.equal((await turn.result).status, "completed");
    await first.close(firstHandle, "reconnect", false);
    secondHandle = await second.ensureSession({ name: "resume-two", agent: "pi", cwd, profile, ...(firstHandle.backendSessionId ? { resumeSessionId: firstHandle.backendSessionId } : {}) });
    assert.equal(secondHandle.backendSessionId, firstHandle.backendSessionId);
    const resumed = second.startTurn({ handle: secondHandle, prompt: "GET", requestId: "get", timeoutMs: 2_000, mode: "prompt" });
    let output = "";
    const drain = (async () => { for await (const event of resumed.events) if (event.type === "text") output += event.text; })();
    assert.equal((await resumed.result).status, "completed"); await drain;
    assert.match(output, /NONCE:nonce-42/);
  } finally {
    if (secondHandle) await second.close(secondHandle, "done", true).catch(() => undefined);
    else if (firstHandle) await first.close(firstHandle, "done", true).catch(() => undefined);
    if (priorCommand === undefined) delete process.env.PI_ACP_PI_COMMAND; else process.env.PI_ACP_PI_COMMAND = priorCommand;
    if (priorState === undefined) delete process.env.FAKE_PI_STATE_FILE; else process.env.FAKE_PI_STATE_FILE = priorState;
    if (priorSession === undefined) delete process.env.FAKE_PI_SESSION_FILE; else process.env.FAKE_PI_SESSION_FILE = priorSession;
  }
});

test("Pi ACP runtime delivers a correlated question reply in the active turn", async () => {
  const priorCommand = process.env.PI_ACP_PI_COMMAND;
  process.env.PI_ACP_PI_COMMAND = fakePi;
  const cwd = await mkdtemp(join(tmpdir(), "pi-strings-pi-question-"));
  const runtime = new PiAcpRuntimePort(cwd, profile);
  try {
    const handle = await runtime.ensureSession({ name: "question", agent: "pi", cwd, profile });
    const turn = runtime.startTurn({ handle, prompt: "ASK_SELECT", requestId: "question-request", timeoutMs: 2_000, mode: "prompt" });
    let asked: { questionId: string; text: string } | undefined;
    let output = "";
    const drain = (async () => {
      for await (const event of turn.events) {
        if (event.type === "question") asked = { questionId: event.questionId, text: event.text };
        if (event.type === "text") output += event.text;
      }
    })();
    for (let attempt = 0; attempt < 100 && !asked; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(asked && { text: asked.text }, { text: "Choose a product" });
    assert.ok(asked?.questionId);
    await runtime.reply!({ handle, requestId: "question-request", questionId: asked!.questionId, answer: "A" });
    assert.equal((await turn.result).status, "completed"); await drain;
    assert.match(output, /ANSWER:A/);
    await runtime.close(handle, "done", true);
  } finally {
    if (priorCommand === undefined) delete process.env.PI_ACP_PI_COMMAND; else process.env.PI_ACP_PI_COMMAND = priorCommand;
  }
});

test("coordinator delivers Pi question replies without starting a second turn", async () => {
  const priorCommand = process.env.PI_ACP_PI_COMMAND;
  const priorSession = process.env.FAKE_PI_SESSION_FILE;
  process.env.PI_ACP_PI_COMMAND = fakePi;
  const cwd = await mkdtemp(join(tmpdir(), "pi-strings-pi-question-coordinator-"));
  process.env.FAKE_PI_SESSION_FILE = join(cwd, "fake-session.jsonl");
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-pi-question-state-"));
  const coordinator = new Coordinator(cwd, { stateDir, profiles: { reviewer: profile } });
  try {
    assert.equal((await coordinator.execute({ action: "spawn", name: "question-pi", profile: "reviewer", cwd })).ok, true);
    const sent = await coordinator.execute({ action: "send", name: "question-pi", prompt: "ASK_SELECT" });
    assert.equal(sent.ok, true);
    let questionId = "";
    for (let attempt = 0; attempt < 100 && !questionId; attempt += 1) {
      const listed = await coordinator.execute({ action: "questions" });
      if (listed.ok) questionId = String((listed.details.questions as Array<{ id: string; status: string }>).find(question => question.status === "pending")?.id ?? "");
      if (!questionId) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(questionId);
    const waiting = await coordinator.execute({ action: "result", requestId: sent.ok ? sent.details.requestId : "" });
    assert.equal(waiting.ok && waiting.details.status, "waiting");
    assert.equal((await coordinator.execute({ action: "reply", questionId, answer: "A" })).ok, true);
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, timeoutMs: 2_000 });
      const completed = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(completed.ok && completed.details.status, "completed");
      assert.match(completed.ok ? String(completed.details.output) : "", /ANSWER:A/);
    }
  } finally {
    await coordinator.execute({ action: "close", name: "question-pi", force: true, discardPersistentState: true }).catch(() => undefined);
    await coordinator.shutdown();
    if (priorCommand === undefined) delete process.env.PI_ACP_PI_COMMAND; else process.env.PI_ACP_PI_COMMAND = priorCommand;
    if (priorSession === undefined) delete process.env.FAKE_PI_SESSION_FILE; else process.env.FAKE_PI_SESSION_FILE = priorSession;
  }
});

test("external ACP permission-question bridge delivers a correlated reply", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-strings-external-question-"));
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-external-question-state-"));
  const questionProfile: Profile = { ...profile, agent: "fixture-question" };
  const runtime = new AcpxRuntimePort(cwd, stateDir, questionProfile, { "fixture-question": [process.execPath, "--import", tsxLoader, fakeExternalQuestionAgent, join(cwd, "fixture-state.json")] });
  const handle = await runtime.ensureSession({ name: "external-question", agent: questionProfile.agent, cwd, profile: questionProfile });
  const turn = runtime.startTurn({ handle, prompt: "ASK_EXTERNAL", requestId: "external-question-request", timeoutMs: 2_000, mode: "prompt" });
  let asked: { questionId: string; text: string } | undefined;
  let output = "";
  const drain = (async () => { for await (const event of turn.events) { if (event.type === "question") asked = { questionId: event.questionId, text: event.text }; if (event.type === "text") output += event.text; } })();
  try {
    for (let attempt = 0; attempt < 100 && !asked; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(asked && { text: asked.text }, { text: "Choose the external answer" });
    assert.ok(asked?.questionId);
    await runtime.reply!({ handle, requestId: "external-question-request", questionId: asked!.questionId, answer: "approve" });
    assert.equal((await turn.result).status, "completed"); await drain;
    assert.match(output, /EXTERNAL_DECISION:selected/);
  } finally { await runtime.close(handle, "done", true).catch(() => undefined); }
});

test("Pi ACP runtime delivers acknowledged steering into the active turn", async () => {
  const priorCommand = process.env.PI_ACP_PI_COMMAND;
  const priorWait = process.env.FAKE_PI_WAIT_FOR_STEER;
  process.env.PI_ACP_PI_COMMAND = fakePi;
  process.env.FAKE_PI_WAIT_FOR_STEER = "1";
  const cwd = await mkdtemp(join(tmpdir(), "pi-strings-pi-acp-"));
  const runtime = new PiAcpRuntimePort(cwd, profile);
  try {
    const handle = await runtime.ensureSession({ name: "steer", agent: "pi", cwd, profile });
    const turn = runtime.startTurn({ handle, prompt: "phase one", requestId: "req-1", timeoutMs: 2_000, mode: "prompt" });
    const output = (async () => { let text = ""; for await (const event of turn.events) if (event.type === "text") text += event.text; return text; })();
    const ack = await runtime.steer!({ handle, requestId: "req-1", steerId: "steer-1", prompt: "direction two" });
    assert.deepEqual(ack, { status: "delivered", requestId: "req-1", steerId: "steer-1" });
    assert.equal((await turn.result).status, "completed");
    assert.equal(await output, "STEERED:direction two");
    await runtime.close(handle, "done", true);
  } finally {
    if (priorCommand === undefined) delete process.env.PI_ACP_PI_COMMAND; else process.env.PI_ACP_PI_COMMAND = priorCommand;
    if (priorWait === undefined) delete process.env.FAKE_PI_WAIT_FOR_STEER; else process.env.FAKE_PI_WAIT_FOR_STEER = priorWait;
  }
});

test("Pi ACP timeout cancels the backend turn before a successor starts", async () => {
  const priorCommand = process.env.PI_ACP_PI_COMMAND;
  const priorWait = process.env.FAKE_PI_WAIT_FOR_STEER;
  process.env.PI_ACP_PI_COMMAND = fakePi;
  process.env.FAKE_PI_WAIT_FOR_STEER = "1";
  const cwd = await mkdtemp(join(tmpdir(), "pi-strings-pi-timeout-"));
  const runtime = new PiAcpRuntimePort(cwd, profile);
  let handle: Awaited<ReturnType<PiAcpRuntimePort["ensureSession"]>> | undefined;
  try {
    handle = await runtime.ensureSession({ name: "timeout", agent: "pi", cwd, profile });
    const timed = runtime.startTurn({ handle, prompt: "phase one", requestId: "timed", timeoutMs: 25, mode: "prompt" });
    const first = await timed.result;
    assert.equal(first.status, "failed");
    if (first.status === "failed") assert.equal(first.error.code, "TIMEOUT");
    const successor = runtime.startTurn({ handle, prompt: "second", requestId: "successor", timeoutMs: 2_000, mode: "prompt" });
    let output = ""; const drain = (async () => { for await (const event of successor.events) if (event.type === "text") output += event.text; })();
    assert.equal((await successor.result).status, "completed"); await drain;
    assert.equal(output, "READY");
  } finally {
    if (handle) await runtime.close(handle, "done", true).catch(() => undefined);
    if (priorCommand === undefined) delete process.env.PI_ACP_PI_COMMAND; else process.env.PI_ACP_PI_COMMAND = priorCommand;
    if (priorWait === undefined) delete process.env.FAKE_PI_WAIT_FOR_STEER; else process.env.FAKE_PI_WAIT_FOR_STEER = priorWait;
  }
});

test("coordinator steers a production Pi ACP worker without starting a second turn", async () => {
  const priorCommand = process.env.PI_ACP_PI_COMMAND;
  const priorWait = process.env.FAKE_PI_WAIT_FOR_STEER;
  process.env.PI_ACP_PI_COMMAND = fakePi;
  process.env.FAKE_PI_WAIT_FOR_STEER = "1";
  const cwd = await mkdtemp(join(tmpdir(), "pi-strings-pi-coordinator-"));
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-pi-state-"));
  const coordinator = new Coordinator(cwd, { stateDir, profiles: { reviewer: profile } });
  try {
    assert.equal((await coordinator.execute({ action: "spawn", name: "native-steer", profile: "reviewer", cwd })).ok, true);
    const sent = await coordinator.execute({ action: "send", name: "native-steer", prompt: "phase one" });
    assert.equal(sent.ok, true);
    const steered = await coordinator.execute({ action: "steer", name: "native-steer", prompt: "direction two" });
    assert.equal(steered.ok, true);
    if (steered.ok) assert.equal(steered.details.status, "delivered");
    if (sent.ok) {
      await coordinator.execute({ action: "wait", requestId: sent.details.requestId, timeoutMs: 2_000 });
      const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
      assert.equal(result.ok && result.details.status, "completed");
      assert.match(result.ok ? String(result.details.output) : "", /STEERED:direction two/);
    }
  } finally {
    await coordinator.execute({ action: "close", name: "native-steer", force: true }).catch(() => undefined);
    await coordinator.shutdown();
    if (priorCommand === undefined) delete process.env.PI_ACP_PI_COMMAND; else process.env.PI_ACP_PI_COMMAND = priorCommand;
    if (priorWait === undefined) delete process.env.FAKE_PI_WAIT_FOR_STEER; else process.env.FAKE_PI_WAIT_FOR_STEER = priorWait;
  }
});
