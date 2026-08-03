import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Profile } from "./types.js";
import { StringsError } from "./errors.js";

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const DEFAULTS: Record<string, Profile> = {
  "pi-reviewer": { agent: "pi", role: "read-only", tools: ["read", "grep", "find", "ls"], timeoutMs: 900_000, cancellationGraceMs: 5_000, maxOutputBytes: 256_000 },
  "pi-writer": { agent: "pi", role: "writer", tools: ["read", "grep", "find", "ls", "bash", "edit", "write"], timeoutMs: 1_800_000, cancellationGraceMs: 10_000, maxOutputBytes: 512_000 },
};

async function readConfig(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { profiles?: Record<string, unknown> };
    return parsed.profiles ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new StringsError("CONFIG_INVALID", `Cannot load ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseProfile(name: string, raw: unknown): Profile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new StringsError("PROFILE_INVALID", `Profile ${name} must be an object.`);
  const value = raw as Record<string, unknown>;
  const role = value.role;
  const agent = value.agent;
  const tools = value.tools;
  if ((role !== "read-only" && role !== "writer") || typeof agent !== "string" || !Array.isArray(tools) || !tools.every((v) => typeof v === "string")) {
    throw new StringsError("PROFILE_INVALID", `Profile ${name} requires agent, role, and string tools.`);
  }
  if (role === "read-only" && tools.some((tool) => !READ_ONLY_TOOLS.has(tool))) {
    throw new StringsError("POLICY_UNENFORCEABLE", `Read-only profile ${name} contains mutation-capable tool(s).`);
  }
  if (agent !== "pi" && role === "read-only") {
    throw new StringsError("POLICY_UNENFORCEABLE", `Read-only policy for adapter ${agent} is not yet verified.`);
  }
  return {
    agent,
    role,
    tools,
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(typeof value.thinking === "string" ? { thinking: value.thinking } : {}),
    timeoutMs: boundedInteger(value.timeoutMs, 900_000, "timeoutMs", 1_000, 86_400_000),
    cancellationGraceMs: boundedInteger(value.cancellationGraceMs, 5_000, "cancellationGraceMs", 100, 60_000),
    maxOutputBytes: boundedInteger(value.maxOutputBytes, 256_000, "maxOutputBytes", 1_024, 10_485_760),
  };
}

function boundedInteger(value: unknown, fallback: number, field: string, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new StringsError("PROFILE_INVALID", `${field} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

export async function loadProfiles(cwd: string): Promise<Record<string, Profile>> {
  const user = await readConfig(join(homedir(), ".pi", "agent", "pi-strings.json"));
  const project = await readConfig(join(cwd, ".pi", "pi-strings.json"));
  const merged: Record<string, unknown> = { ...DEFAULTS, ...user, ...project };
  return Object.fromEntries(Object.entries(merged).map(([name, value]) => [name, parseProfile(name, value)]));
}
