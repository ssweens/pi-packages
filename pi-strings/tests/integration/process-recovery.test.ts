import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readFile, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Coordinator } from "../../extensions/pi-strings/orchestration/coordinator.ts";
import type { Profile, RuntimePort } from "../../extensions/pi-strings/domain/types.ts";

const profile: Profile = { agent: "pi", role: "read-only", tools: ["read"], timeoutMs: 10_000, cancellationGraceMs: 100, maxOutputBytes: 4_096 };

test("actual parent kill preserves evidence and quarantines the active session", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pi-strings-process-loss-"));
  const child = fork(new URL("../fixtures/state-owner.ts", import.meta.url), [stateDir], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  await new Promise<void>((resolve, reject) => {
    child.once("message", message => message === "ready" && resolve());
    child.once("error", reject);
    child.once("exit", code => code !== null && reject(new Error(`fixture exited ${code}`)));
  });
  child.kill("SIGKILL");
  await new Promise<void>(resolve => child.once("exit", () => resolve()));
  const stale = new Date(Date.now() - 60_000);
  await utimes(`${stateDir}.lock`, stale, stale);

  const resumed: string[] = [];
  const runtime = {
    capabilities: { version: 1, steering: false, resume: true, permissions: true, questions: false },
    async ensureSession(input: { name: string; resumeSessionId?: string }) {
      resumed.push(input.name);
      if (input.name !== "idle" || input.resumeSessionId !== "idle-session") throw new Error("only the idle session may reconnect");
      return { sessionKey: "idle", backend: "fixture", runtimeSessionName: "idle", backendSessionId: "idle-session" };
    },
    startTurn() { throw new Error("not used"); },
    async cancel() {},
    async close() {},
  } as RuntimePort;
  const coordinator = new Coordinator(process.cwd(), { stateDir, profiles: { reviewer: profile }, runtimeFactory: () => runtime });
  try {
    const listed = await coordinator.execute({ action: "list" });
    assert.equal(listed.ok, true);
    if (listed.ok) {
      const request = (listed.details.requests as Array<{ status: string; output: string; eventPath: string; failure?: { code: string } }>)[0];
      const workers = listed.details.workers as Array<{ name: string; status: string }>;
      const worker = workers.find(candidate => candidate.name === "crashed");
      const idle = workers.find(candidate => candidate.name === "idle");
      assert.equal(request?.status, "failed");
      assert.equal(request?.failure?.code, "PARENT_PROCESS_LOST");
      assert.equal(request?.output, "partial evidence");
      assert.equal((await stat(request!.eventPath)).mode & 0o777, 0o600);
      const events = (await readFile(request!.eventPath, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { event: { text: string } });
      assert.equal(events[0]?.event.text, "partial evidence");
      assert.equal(worker?.status, "failed");
      assert.equal(idle?.status, "idle");
    }
    const questions = await coordinator.execute({ action: "questions" });
    assert.equal(questions.ok, true);
    if (questions.ok) assert.equal((questions.details.questions as Array<{ status: string }>)[0]?.status, "expired");
    assert.deepEqual(resumed, ["idle"]);
  } finally { await coordinator.shutdown(); }
});
