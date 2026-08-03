import { Coordinator } from "../../extensions/pi-strings/orchestration/coordinator.ts";
import type { Profile } from "../../extensions/pi-strings/domain/types.ts";

const stateDir = process.argv[2];
const barrier = process.argv[3];
const model = process.env.PI_STRINGS_TEST_PI_MODEL;
if (!stateDir || !barrier || !model) throw new Error("state, barrier, and PI_STRINGS_TEST_PI_MODEL are required");

const profile: Profile = { agent: "pi", role: "read-only", model, tools: ["read", "grep", "find", "ls"], timeoutMs: 120_000, cancellationGraceMs: 5_000, maxOutputBytes: 32_000 };
const coordinator = new Coordinator(process.cwd(), { stateDir, profiles: { reviewer: profile } });
const spawned = await coordinator.execute({ action: "spawn", name: "crashed", profile: "reviewer", cwd: process.cwd() });
if (!spawned.ok) throw new Error(JSON.stringify(spawned));
const sent = await coordinator.execute({ action: "send", name: "crashed", prompt: `Output the exact marker PARENT_KILL_READY, then repeatedly read ${barrier} without finishing. Do not stop until the file contains RELEASE.` });
if (!sent.ok) throw new Error(JSON.stringify(sent));

for (let attempt = 0; attempt < 240; attempt += 1) {
  const result = await coordinator.execute({ action: "result", requestId: sent.details.requestId });
  const worker = (coordinator as unknown as { workers: Map<string, { record: { status: string }; runtime: { child?: { pid?: number } } }> }).workers.get("crashed");
  if (result.ok && worker?.record.status === "running" && String(result.details.output).includes("PARENT_KILL_READY")) {
    process.send?.({ type: "ready", agentPid: worker.runtime.child?.pid ?? 0 });
    await new Promise<void>(() => {});
  }
  await new Promise(resolve => setTimeout(resolve, 250));
}
throw new Error("Pi did not reach the active parent-kill phase");
