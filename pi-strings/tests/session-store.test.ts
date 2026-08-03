import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionStore } from "../vendor/pi-acp/src/acp/session-store.ts";

test("session store writes atomically with private modes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-strings-store-"));
  const path = join(root, "private", "session-map.json");
  const store = new SessionStore(path);
  store.upsert({ sessionId: "one", cwd: "/repo", sessionFile: "/sessions/one.jsonl" });
  assert.equal(store.get("one")?.cwd, "/repo");
  assert.equal((await stat(join(root, "private"))).mode & 0o777, 0o700);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.match(await readFile(path, "utf8"), /"sessionId": "one"/);
});

test("session store surfaces corruption instead of resetting state", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-strings-store-"));
  const path = join(root, "session-map.json");
  const store = new SessionStore(path);
  await writeFile(path, "{broken", { mode: 0o600 });
  assert.throws(() => store.upsert({ sessionId: "two", cwd: "/repo", sessionFile: "/sessions/two.jsonl" }), /Corrupt pi-acp session map/);
  assert.equal(await readFile(path, "utf8"), "{broken");
});
