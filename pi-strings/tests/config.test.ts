import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadProfiles } from "../extensions/pi-strings/domain/config.ts";

test("default read-only Pi profile excludes shell and mutation tools", async () => {
  const profiles = await loadProfiles(process.cwd());
  assert.deepEqual(profiles["pi-reviewer"]?.tools, ["read", "grep", "find", "ls"]);
  assert.equal(profiles["pi-reviewer"]?.tools.includes("bash"), false);
});

test("unverified external adapters cannot claim read-only policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-strings-config-"));
  await mkdir(join(root, ".pi"));
  await writeFile(join(root, ".pi", "pi-strings.json"), JSON.stringify({ profiles: { unsafe: { agent: "claude", role: "read-only", tools: [] } } }));
  await assert.rejects(loadProfiles(root), (error: unknown) => (error as { code?: string }).code === "POLICY_UNENFORCEABLE");
});

test("invalid explicit profile bounds fail instead of becoming defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-strings-config-"));
  await mkdir(join(root, ".pi"));
  await writeFile(join(root, ".pi", "pi-strings.json"), JSON.stringify({ profiles: { bad: { agent: "pi", role: "read-only", tools: ["read"], timeoutMs: -1 } } }));
  await assert.rejects(loadProfiles(root), (error: unknown) => (error as { code?: string }).code === "PROFILE_INVALID");
});

test("default profiles carry the expected kinds, isolation, and finder turn budget", async () => {
  const profiles = await loadProfiles(process.cwd());
  assert.equal(profiles["pi-reviewer"]?.kind, "free");
  assert.equal(profiles["pi-oracle"]?.kind, "oracle");
  assert.equal(profiles["pi-oracle"]?.role, "read-only");
  assert.equal(profiles["pi-finder"]?.kind, "finder");
  assert.equal(profiles["pi-finder"]?.maxTurns, 12);
  assert.equal(profiles["pi-writer"]?.kind, "worker");
  assert.equal(profiles["pi-writer"]?.isolation, "shared");
});

test("invalid kind, isolation, fallbackModels, and bounds are rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-strings-config-"));
  await mkdir(join(root, ".pi"));
  const base = { agent: "pi", role: "writer" as const, tools: ["read", "bash", "edit", "write"] };
  const cases: Array<[string, Record<string, unknown>]> = [
    ["bad-kind", { ...base, kind: "bogus" }],
    ["bad-isolation", { ...base, isolation: "chroot" }],
    ["bad-fallback", { ...base, fallbackModels: ["a", 7] }],
    ["bad-maxturns", { ...base, maxTurns: 0 }],
    ["bad-maxattempts", { ...base, maxAttempts: 99 }],
  ];
  for (const [name, profile] of cases) {
    await writeFile(join(root, ".pi", "pi-strings.json"), JSON.stringify({ profiles: { [name]: profile } }));
    await assert.rejects(loadProfiles(root), (error: unknown) => (error as { code?: string }).code === "PROFILE_INVALID", `expected ${name} to be rejected`);
  }
});
