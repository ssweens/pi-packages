import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AcpxRuntime, createAgentRegistry, createFileSessionStore, type AcpRuntimeEvent, type AcpRuntimeHandle } from "../../../dist/acpx-runtime/runtime.js";
import type { NormalizedEvent, Profile, RuntimeHandle, RuntimePort, RuntimeStatus, RuntimeTerminal, RuntimeTurn, TurnUsage } from "../domain/types.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adapterEntry = resolve(packageRoot, "dist/pi-acp.js");

export function normalize(event: AcpRuntimeEvent): NormalizedEvent | null {
  if (event.type === "text_delta") return { type: "text", text: event.text, stream: event.stream === "thought" ? "thought" : "output" };
  if (event.type === "status") {
    const usage: TurnUsage | undefined = (event.breakdown || event.cost) ? { ...(event.breakdown ? { breakdown: event.breakdown } : {}), ...(event.cost ? { cost: event.cost } : {}) } : undefined;
    return { type: "status", text: event.text, ...(usage ? { usage } : {}) };
  }
  if (event.type === "tool_call") return {
    type: "tool",
    text: event.text,
    ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
    ...(event.title && event.rawInput !== undefined ? { toolFingerprint: `${event.title}\u0000${createHash("sha256").update(stableSerialize(event.rawInput)).digest("hex")}` } : {}),
    ...(event.status ? { status: event.status } : {}),
  };
  return null;
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "undefined") return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
  }
  return String(value);
}

export function permissionModeFor(_profile: Profile): "approve-reads" { return "approve-reads"; }

function toHandle(handle: AcpRuntimeHandle): RuntimeHandle { return { ...handle }; }
function fromHandle(handle: RuntimeHandle): AcpRuntimeHandle { return { ...handle }; }

export class AcpxRuntimePort implements RuntimePort {
  private readonly runtime: AcpxRuntime;

  constructor(cwd: string, stateDir: string, profile: Profile) {
    const piAdapterArgv = [process.execPath, adapterEntry, "--pi-strings-worker", "--pi-tools-json", JSON.stringify(profile.tools)];
    if (profile.thinking) piAdapterArgv.push("--pi-thinking", profile.thinking);
    const runtimeOptions = {
      cwd,
      sessionStore: createFileSessionStore({ stateDir: resolve(stateDir, "acpx") }),
      agentRegistry: createAgentRegistry({
        overrides: {
          pi: piAdapterArgv,
          // Amp Code via its ACP adapter: drives the locally-installed `amp` CLI
          // for streaming. Requires paid Amp credits (free tier is not ACP-eligible)
          // and `amp login`. Native `amp`-mode tools are NOT confined by the ACP
          // permission layer (same provider-native boundary as Codex's Guardian).
          amp: ["npx", "-y", "amp-acp"],
        },
      }),
      permissionMode: permissionModeFor(profile),
      nonInteractivePermissions: "deny" as const,
      // ACPX's default approve-reads mode prompts for mutations when its host
      // process has a TTY. Pi-strings has no permission UI, so use ACPX's
      // native policy to settle those requests instead of leaving the turn
      // waiting on readline. Writers remain usable without an interactive
      // operator; read-only workers auto-approve reads/searches and deny the
      // rest. No provider-specific callback or matcher is involved.
      permissionPolicy: profile.role === "writer"
        ? { defaultAction: "approve" as const }
        : { autoApprove: ["read", "search"], defaultAction: "deny" as const },
      // Coordinator deadlines are authoritative; ACPX must not terminate turns independently.
      timeoutMs: 0,
    };
    this.runtime = new AcpxRuntime(runtimeOptions);
  }

  async ensureSession(input: { name: string; agent: string; cwd: string; profile: Profile; resumeSessionId?: string }): Promise<RuntimeHandle> {
    const handle = await this.runtime.ensureSession({
      sessionKey: `pi-strings:${input.name}`,
      agent: input.agent,
      mode: "persistent",
      cwd: input.cwd,
      ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
      sessionOptions: {
        ...(input.profile.model ? { model: input.profile.model } : {}),
        ...(input.agent === "pi" ? { allowedTools: input.profile.tools } : {}),
      },
    });
    if (input.agent === "codex") await this.runtime.setMode?.({ handle, mode: input.profile.role === "writer" ? "agent" : "read-only" });
    // Amp exposes its own permission + effort config options (Default/Bypass and
    // low/medium/high/ultra) via ACP config options rather than ACP session modes,
    // so no setMode call here; the adapter default (Default permissions) is used.
    return { ...toHandle(handle), agent: input.agent, role: input.profile.role, cwd: input.cwd };
  }

  async getStatus(handle: RuntimeHandle): Promise<RuntimeStatus> {
    const status = await this.runtime.getStatus({ handle: fromHandle(handle) });
    if (!status.models) return { modelDiscoverySupported: false, availableModelIds: [] };
    return {
      modelDiscoverySupported: true,
      ...(status.models.currentModelId ? { currentModelId: status.models.currentModelId } : {}),
      availableModelIds: [...status.models.availableModelIds],
    };
  }

  startTurn(input: { handle: RuntimeHandle; prompt: string; requestId: string; timeoutMs: number }): RuntimeTurn {
    const turn = this.runtime.startTurn({ handle: fromHandle(input.handle), text: input.prompt, requestId: input.requestId, timeoutMs: 0, mode: "prompt" });
    let usage: TurnUsage | undefined;
    const events: AsyncIterable<NormalizedEvent> = {
      async *[Symbol.asyncIterator]() {
        for await (const event of turn.events) {
          const item = normalize(event);
          if (!item) continue;
          if (item.type === "status" && item.usage) usage = item.usage;
          yield item;
        }
      },
    };
    const result = turn.result.then((terminal): RuntimeTerminal => (usage ? { ...(terminal as RuntimeTerminal), usage } : terminal) as RuntimeTerminal);
    return {
      requestId: turn.requestId,
      events,
      result,
      cancel: (reason) => turn.cancel(reason ? { reason } : undefined),
      closeStream: (reason) => turn.closeStream(reason ? { reason } : undefined),
    };
  }

  async setConfigOption(input: { handle: RuntimeHandle; key: string; value: string }): Promise<void> {
    await this.runtime.setConfigOption({ handle: fromHandle(input.handle), key: input.key, value: input.value });
  }

  close(handle: RuntimeHandle, reason: string, discardPersistentState: boolean): Promise<void> { return this.runtime.close({ handle: fromHandle(handle), reason, discardPersistentState }); }
}
