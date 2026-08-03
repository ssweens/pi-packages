import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { AcpxRuntime, createAgentRegistry, createFileSessionStore, type AcpRuntimeEvent, type AcpRuntimeHandle } from "acpx/runtime";
import type { NormalizedEvent, Profile, RuntimeCapabilities, RuntimeHandle, RuntimePort, RuntimeTerminal, RuntimeTurn } from "../domain/types.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adapterEntry = resolve(packageRoot, "dist/pi-acp.js");

function normalize(event: AcpRuntimeEvent): NormalizedEvent | null {
  if (event.type === "text_delta") return { type: "text", text: event.text, stream: event.stream === "thought" ? "thought" : "output" };
  if (event.type === "status") return { type: "status", text: event.text };
  if (event.type === "tool_call") return { type: "tool", text: event.text, ...(event.status ? { status: event.status } : {}) };
  return null;
}

export function permissionModeFor(profile: Profile): "deny-all" | "approve-reads" { return profile.role === "read-only" ? "approve-reads" : "deny-all"; }

export function writerPermissionDecision(cwd: string, profile: Profile, request: { inferredKind: string | undefined; raw: { toolCall: { name?: string | null; title?: string | null; rawInput?: unknown; locations?: Array<{ path: string }> | null } } }): { outcome: "allow_once" | "reject_once" } {
  if (profile.role !== "writer") return { outcome: "reject_once" };
  const kind = request.inferredKind;
  const rawInput = request.raw.toolCall.rawInput && typeof request.raw.toolCall.rawInput === "object" && !Array.isArray(request.raw.toolCall.rawInput) ? request.raw.toolCall.rawInput as Record<string, unknown> : {};
  const titleName = request.raw.toolCall.title?.trim().split(/[\s:]/, 1)[0];
  const name = request.raw.toolCall.name ?? (typeof rawInput.name === "string" ? rawInput.name : undefined) ?? (typeof rawInput.tool === "string" ? rawInput.tool : undefined) ?? (typeof rawInput.toolName === "string" ? rawInput.toolName : undefined) ?? titleName;
  const namedMutation = name === "edit" || name === "write";
  const mutation = kind === "edit" || kind === "write" || namedMutation;
  const declared = name ? profile.tools.includes(name) : kind === "read" || kind === "search" || mutation;
  if (!declared || (kind !== "read" && kind !== "search" && !mutation)) return { outcome: "reject_once" };
  if (kind === "read" || kind === "search") return { outcome: "allow_once" };
  const locations = request.raw.toolCall.locations ?? [];
  if (locations.length === 0) return { outcome: "reject_once" };
  const canonicalCwd = realpathSync(cwd);
  const inside = locations.every(location => {
    const canonicalTarget = physicalTarget(resolve(cwd, location.path));
    if (!canonicalTarget) return false;
    const pathFromCwd = relative(canonicalCwd, canonicalTarget);
    return pathFromCwd === "" || (!pathFromCwd.startsWith("..") && !isAbsolute(pathFromCwd));
  });
  return { outcome: inside ? "allow_once" : "reject_once" };
}

function physicalTarget(target: string): string | undefined {
  let unresolved = target;
  for (let hops = 0; hops < 40; hops += 1) {
    let existing = unresolved;
    const suffix: string[] = [];
    for (;;) {
      try { lstatSync(existing); break; }
      catch {
        const parent = dirname(existing);
        if (parent === existing) return undefined;
        suffix.unshift(existing.slice(parent.length + (parent.endsWith("/") ? 0 : 1)));
        existing = parent;
      }
    }
    const stat = lstatSync(existing);
    if (stat.isSymbolicLink()) {
      unresolved = resolve(dirname(existing), readlinkSync(existing), ...suffix);
      continue;
    }
    return resolve(realpathSync(existing), ...suffix);
  }
  return undefined;
}

class EventQueue implements AsyncIterable<NormalizedEvent> {
  private readonly values: NormalizedEvent[] = [];
  private readonly waiters: Array<() => void> = [];
  private ended = false;
  push(value: NormalizedEvent): void { if (!this.ended) { this.values.push(value); this.waiters.shift()?.(); } }
  end(): void { this.ended = true; while (this.waiters.length > 0) this.waiters.shift()?.(); }
  async *[Symbol.asyncIterator](): AsyncIterator<NormalizedEvent> {
    while (!this.ended || this.values.length > 0) {
      const value = this.values.shift();
      if (value) { yield value; continue; }
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
  }
}

interface PendingQuestion { requestId: string; resolve: (answer: string) => void; }
interface ActiveTurn { requestId: string; events: EventQueue; }

function externalQuestion(request: { raw: { toolCall: { toolCallId?: string | null; title?: string | null; rawInput?: unknown } } }): { id: string; text: string } | undefined {
  const rawInput = request.raw.toolCall.rawInput;
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return undefined;
  const marker = (rawInput as Record<string, unknown>).piStringsQuestion;
  if (typeof marker === "string" && marker.trim()) return { id: request.raw.toolCall.toolCallId ?? `acp-question-${Date.now()}`, text: marker.trim() };
  if (marker && typeof marker === "object" && !Array.isArray(marker)) {
    const text = (marker as Record<string, unknown>).text;
    if (typeof text === "string" && text.trim()) return { id: request.raw.toolCall.toolCallId ?? `acp-question-${Date.now()}`, text: text.trim() };
  }
  return undefined;
}

function questionDecision(answer: string): { outcome: "allow_once" } | { outcome: "reject_once" } | { outcome: "cancel" } {
  const normalized = answer.trim().toLowerCase();
  if (normalized === "cancel") return { outcome: "cancel" };
  return normalized === "yes" || normalized === "true" || normalized === "allow" || normalized === "approve" ? { outcome: "allow_once" } : { outcome: "reject_once" };
}

function sandboxPath(path: string): string { return path.replaceAll("\\", "\\\\").replaceAll('"', '\\"'); }
function codexWriterSandbox(cwd: string): string {
  const writable = [cwd, tmpdir(), join(homedir(), ".codex"), join(homedir(), ".npm")].map(path => `(allow file-write* (subpath "${sandboxPath(path)}"))`).join("");
  return `(version 1)(allow default)(allow network*)(allow process*)(deny file-write*)${writable}`;
}

function toHandle(handle: AcpRuntimeHandle): RuntimeHandle { return { ...handle }; }
function fromHandle(handle: RuntimeHandle): AcpRuntimeHandle { return { ...handle }; }

export class AcpxRuntimePort implements RuntimePort {
  readonly capabilities: RuntimeCapabilities;
  private readonly runtime: AcpxRuntime;
  private activeTurn: ActiveTurn | undefined;
  private readonly pendingQuestions = new Map<string, PendingQuestion>();

  constructor(cwd: string, stateDir: string, profile: Profile, extraAgentOverrides: Record<string, string | string[]> = {}) {
    const piAdapterArgv = [process.execPath, adapterEntry, "--pi-strings-worker", "--pi-tools-json", JSON.stringify(profile.tools)];
    if (profile.thinking) piAdapterArgv.push("--pi-thinking", profile.thinking);
    const agentOverrides: Record<string, string | string[]> = { pi: piAdapterArgv, opencode: ["opencode", "acp", "--cwd", cwd], ...extraAgentOverrides };
    if (profile.agent === "codex" && profile.role === "writer") agentOverrides.codex = ["sandbox-exec", "-p", codexWriterSandbox(cwd), "npx", "-y", "@agentclientprotocol/codex-acp@^1.1.5"];
    this.capabilities = { version: 1, steering: false, resume: true, permissions: true, questions: profile.role === "read-only" };
    this.runtime = new AcpxRuntime({
      cwd,
      sessionStore: createFileSessionStore({ stateDir: resolve(stateDir, "acpx") }),
      agentRegistry: createAgentRegistry({ overrides: agentOverrides }),
      permissionMode: permissionModeFor(profile),
      nonInteractivePermissions: "fail",
      timeoutMs: profile.timeoutMs,
      onPermissionRequest: async request => this.handlePermissionRequest(cwd, profile, request),
    });
  }

  private async handlePermissionRequest(cwd: string, profile: Profile, request: Parameters<typeof writerPermissionDecision>[2]): Promise<{ outcome: "allow_once" | "reject_once" | "cancel" }> {
    const question = profile.role === "read-only" ? externalQuestion(request) : undefined;
    if (!question || !this.activeTurn) return writerPermissionDecision(cwd, profile, request);
    const questionId = question.id;
    const answer = new Promise<string>(resolve => this.pendingQuestions.set(questionId, { requestId: this.activeTurn!.requestId, resolve }));
    this.activeTurn.events.push({ type: "question", questionId, text: question.text });
    try { return questionDecision(await answer); }
    finally { this.pendingQuestions.delete(questionId); }
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
        allowedTools: input.profile.tools,
      },
    });
    return { ...toHandle(handle), agent: input.agent, role: input.profile.role, cwd: input.cwd };
  }

  startTurn(input: { handle: RuntimeHandle; prompt: string; requestId: string; timeoutMs: number; mode: "prompt" | "steer" }): RuntimeTurn {
    const events = new EventQueue();
    this.activeTurn = { requestId: input.requestId, events };
    let turn: ReturnType<AcpxRuntime["startTurn"]>;
    try { turn = this.runtime.startTurn({ handle: fromHandle(input.handle), text: input.prompt, requestId: input.requestId, timeoutMs: input.timeoutMs, mode: input.mode }); }
    catch (error) { this.activeTurn = undefined; events.end(); throw error; }
    void (async () => {
      try { for await (const event of turn.events) { const item = normalize(event); if (item) events.push(item); } }
      finally { events.end(); }
    })();
    return {
      requestId: turn.requestId,
      events,
      result: turn.result.finally(() => { if (this.activeTurn?.requestId === input.requestId) this.activeTurn = undefined; }) as Promise<RuntimeTerminal>,
      cancel: async (reason) => { this.resolveQuestions(input.requestId, "cancel"); await turn.cancel(reason ? { reason } : undefined); },
      closeStream: async (reason) => { events.end(); await turn.closeStream(reason ? { reason } : undefined); },
    };
  }

  async reply(input: { handle: RuntimeHandle; requestId: string; questionId: string; answer: string }): Promise<void> {
    const pending = this.pendingQuestions.get(input.questionId);
    if (!pending || pending.requestId !== input.requestId) throw new Error(`Unknown ACP question ${input.questionId}`);
    pending.resolve(input.answer);
  }

  async cancel(handle: RuntimeHandle, reason?: string): Promise<void> {
    this.resolveQuestions(this.activeTurn?.requestId, "cancel");
    await this.runtime.cancel({ handle: fromHandle(handle), ...(reason ? { reason } : {}) });
  }
  async close(handle: RuntimeHandle, reason: string, discardPersistentState: boolean): Promise<void> {
    this.resolveQuestions(this.activeTurn?.requestId, "cancel");
    await this.runtime.close({ handle: fromHandle(handle), reason, discardPersistentState });
  }

  private resolveQuestions(requestId: string | undefined, answer: string): void {
    for (const [questionId, pending] of this.pendingQuestions) {
      if (!requestId || pending.requestId === requestId) {
        this.pendingQuestions.delete(questionId);
        pending.resolve(answer);
      }
    }
  }
}
