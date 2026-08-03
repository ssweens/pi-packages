import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AcpxRuntime, createAgentRegistry, createFileSessionStore, type AcpRuntimeEvent, type AcpRuntimeHandle } from "acpx/runtime";
import type { NormalizedEvent, Profile, RuntimeHandle, RuntimePort, RuntimeTerminal, RuntimeTurn, TurnUsage } from "../domain/types.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adapterEntry = resolve(packageRoot, "dist/pi-acp.js");

export function normalize(event: AcpRuntimeEvent): NormalizedEvent | null {
  if (event.type === "text_delta") return { type: "text", text: event.text, stream: event.stream === "thought" ? "thought" : "output" };
  if (event.type === "status") {
    const usage: TurnUsage | undefined = (event.breakdown || event.cost) ? { ...(event.breakdown ? { breakdown: event.breakdown } : {}), ...(event.cost ? { cost: event.cost } : {}) } : undefined;
    return { type: "status", text: event.text, ...(usage ? { usage } : {}) };
  }
  if (event.type === "tool_call") return { type: "tool", text: event.text, ...(event.status ? { status: event.status } : {}) };
  return null;
}

export function permissionModeFor(profile: Profile): "approve-reads" | "deny-all" { return profile.role === "writer" ? "approve-reads" : "deny-all"; }

function toHandle(handle: AcpRuntimeHandle): RuntimeHandle { return { ...handle }; }
function fromHandle(handle: RuntimeHandle): AcpRuntimeHandle { return { ...handle }; }

export class AcpxRuntimePort implements RuntimePort {
  private readonly runtime: AcpxRuntime;

  constructor(cwd: string, stateDir: string, profile: Profile) {
    const piAdapterArgv = [process.execPath, adapterEntry, "--pi-strings-worker", "--pi-tools-json", JSON.stringify(profile.tools)];
    if (profile.thinking) piAdapterArgv.push("--pi-thinking", profile.thinking);
    this.runtime = new AcpxRuntime({
      cwd,
      sessionStore: createFileSessionStore({ stateDir: resolve(stateDir, "acpx") }),
      agentRegistry: createAgentRegistry({ overrides: { pi: piAdapterArgv } }),
      permissionMode: permissionModeFor(profile),
      nonInteractivePermissions: "deny",
      // Coordinator deadlines are authoritative; ACPX must not terminate turns independently.
      timeoutMs: 0,
    });
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
    return { ...toHandle(handle), agent: input.agent, role: input.profile.role, cwd: input.cwd };
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
