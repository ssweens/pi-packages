import { chmod, mkdir, writeFile } from "node:fs/promises";
import { StateStore } from "../../extensions/pi-strings/persistence/state-store.ts";

const stateDir = process.argv[2];
if (!stateDir) throw new Error("state directory is required");
const store = new StateStore(stateDir);
await store.acquire();
const now = new Date().toISOString();
await mkdir(`${stateDir}/requests`, { recursive: true, mode: 0o700 });
await writeFile(`${stateDir}/requests/req_crashed.ndjson`, `${JSON.stringify({ observedAt: now, event: { type: "text", text: "partial evidence" } })}\n`, { mode: 0o600 });
await chmod(`${stateDir}/requests/req_crashed.ndjson`, 0o600);
await store.save([{
  name: "crashed",
  profileName: "reviewer",
  role: "read-only",
  status: "running",
  cwd: process.cwd(),
  handle: { sessionKey: "crashed", backend: "fixture", runtimeSessionName: "crashed", backendSessionId: "crashed-session" },
  activeRequestId: "req_crashed",
  createdAt: now,
  updatedAt: now,
}, {
  name: "idle",
  profileName: "reviewer",
  role: "read-only",
  status: "idle",
  cwd: process.cwd(),
  handle: { sessionKey: "idle", backend: "fixture", runtimeSessionName: "idle", backendSessionId: "idle-session" },
  createdAt: now,
  updatedAt: now,
}], [{
  id: "req_crashed",
  workerName: "crashed",
  status: "running",
  startedAt: now,
  output: "partial evidence",
  truncated: false,
  eventPath: `${stateDir}/requests/req_crashed.ndjson`,
}], [{ id: "req_crashed:q-pending", adapterQuestionId: "q-pending", workerName: "crashed", requestId: "req_crashed", text: "Need authority", status: "pending", askedAt: now }], [
  { sessionId: "crashed-session", agent: "pi", profileName: "reviewer", role: "read-only", cwd: process.cwd() },
  { sessionId: "idle-session", agent: "pi", profileName: "reviewer", role: "read-only", cwd: process.cwd() },
]);
if (process.send) process.send("ready");
setInterval(() => undefined, 60_000);
