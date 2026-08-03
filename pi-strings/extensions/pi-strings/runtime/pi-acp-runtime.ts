import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { NormalizedEvent, Profile, RuntimeCapabilities, RuntimeHandle, RuntimePort, RuntimeTerminal, RuntimeTurn, SteeringAcknowledgement } from "../domain/types.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adapterEntry = resolve(packageRoot, "dist/pi-acp.js");

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

interface ActiveTurn { requestId: string; events: EventQueue }
interface PendingQuestion { requestId: string; resolve: (answer: string) => void }

export class PiAcpRuntimePort implements RuntimePort {
  readonly capabilities: RuntimeCapabilities = { version: 1, steering: true, resume: true, permissions: false, questions: true };
  private child: ChildProcessWithoutNullStreams | undefined;
  private connection: ClientSideConnection | undefined;
  private handle: RuntimeHandle | undefined;
  private active: ActiveTurn | undefined;
  private readonly pendingQuestions = new Map<string, PendingQuestion>();

  constructor(private readonly cwd: string, private readonly profile: Profile) {}

  async ensureSession(input: { name: string; agent: string; cwd: string; profile: Profile; resumeSessionId?: string }): Promise<RuntimeHandle> {
    if (this.connection) return this.handle!;
    const argv = [adapterEntry, "--pi-strings-worker", "--pi-tools-json", JSON.stringify(this.profile.tools)];
    if (this.profile.thinking) argv.push("--pi-thinking", this.profile.thinking);
    const child = spawn(process.execPath, argv, { cwd: this.cwd, stdio: "pipe", env: process.env, detached: process.platform !== "win32" });
    this.child = child;
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const client: any = {
      sessionUpdate: async (notification: any) => this.onSessionUpdate(notification),
      requestPermission: async (request: any) => this.requestPermission(request),
      readTextFile: async () => { throw new Error("ACP filesystem reads are disabled; Pi uses its native read tool") },
      writeTextFile: async () => { throw new Error("ACP filesystem writes are disabled; Pi uses its native write tool") },
      createTerminal: async () => { throw new Error("ACP terminal capability is disabled") },
    };
    const connection = new ClientSideConnection(() => client, stream);
    this.connection = connection;
    await connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    const session = input.resumeSessionId
      ? await connection.loadSession({ sessionId: input.resumeSessionId, cwd: input.cwd, mcpServers: [] })
      : await connection.newSession({ cwd: input.cwd, mcpServers: [] });
    const sessionId = input.resumeSessionId ?? (session as { sessionId: string }).sessionId;
    this.handle = { sessionKey: `pi-strings:${input.name}`, backend: "pi-acp-direct", runtimeSessionName: input.name, backendSessionId: sessionId, cwd: input.cwd, agent: input.agent, role: input.profile.role };
    return this.handle;
  }

  startTurn(input: { handle: RuntimeHandle; prompt: string; requestId: string; timeoutMs: number; mode: "prompt" | "steer" }): RuntimeTurn {
    if (input.mode !== "prompt") throw new Error("Use steer() for in-flight Pi steering");
    if (!this.connection || !input.handle.backendSessionId) throw new Error("Pi ACP session is not initialized");
    if (this.active) throw new Error("Pi ACP worker already has an active turn");
    const events = new EventQueue();
    this.active = { requestId: input.requestId, events };
    const result = this.runPrompt(input.handle.backendSessionId, input.prompt, input.requestId, input.timeoutMs, events);
    return {
      requestId: input.requestId,
      events,
      result,
      cancel: async () => { await this.connection!.cancel({ sessionId: input.handle.backendSessionId! }); },
      closeStream: async () => { events.end(); },
    };
  }

  async steer(input: { handle: RuntimeHandle; requestId: string; steerId: string; prompt: string }): Promise<SteeringAcknowledgement> {
    if (!this.connection || !input.handle.backendSessionId || this.active?.requestId !== input.requestId) return { status: "terminal-race", requestId: input.requestId, steerId: input.steerId, message: "The target turn is no longer active." };
    try {
      await this.connection.prompt({ sessionId: input.handle.backendSessionId, prompt: [{ type: "text", text: input.prompt }], _meta: { piStrings: { mode: "steer", requestId: input.requestId, steerId: input.steerId } } });
      return { status: "delivered", requestId: input.requestId, steerId: input.steerId };
    } catch (error) {
      return { status: "failed", requestId: input.requestId, steerId: input.steerId, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async cancel(handle: RuntimeHandle): Promise<void> {
    this.resolvePendingQuestions(handle.backendSessionId, "cancelled");
    if (this.connection && handle.backendSessionId) await this.connection.cancel({ sessionId: handle.backendSessionId });
  }

  async reply(input: { handle: RuntimeHandle; requestId: string; questionId: string; answer: string }): Promise<void> {
    const pending = this.pendingQuestions.get(input.questionId);
    if (!pending || pending.requestId !== input.requestId) throw new Error(`Unknown Pi question ${input.questionId}`);
    pending.resolve(input.answer);
  }

  async close(handle: RuntimeHandle, _reason: string, discardPersistentState: boolean): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    this.resolvePendingQuestions(this.handle?.backendSessionId, "cancelled");
    this.active?.events.end(); this.active = undefined;
    if (connection && handle.backendSessionId) {
      try {
        if (discardPersistentState) await connection.deleteSession({ sessionId: handle.backendSessionId });
        else await connection.closeSession({ sessionId: handle.backendSessionId });
      } catch { /* process termination remains authoritative */ }
    }
    if (discardPersistentState) this.handle = undefined;
    await this.terminate();
  }

  private async runPrompt(sessionId: string, prompt: string, requestId: string, timeoutMs: number, events: EventQueue): Promise<RuntimeTerminal> {
    let timer: NodeJS.Timeout | undefined;
    const promptOperation = this.connection!.prompt({ sessionId, prompt: [{ type: "text", text: prompt }] });
    try {
      const response = await Promise.race([
        promptOperation,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Pi turn timed out after ${timeoutMs}ms`)), timeoutMs); }),
      ]);
      return response.stopReason === "cancelled" ? { status: "cancelled", stopReason: "cancelled" } : { status: "completed", stopReason: response.stopReason };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = message.includes("timed out");
      if (timedOut) {
        let cancellationTimer: NodeJS.Timeout | undefined;
        try {
          await this.connection!.cancel({ sessionId });
          await Promise.race([
            promptOperation,
            new Promise<never>((_, reject) => { cancellationTimer = setTimeout(() => reject(new Error("Pi cancellation did not settle")), 2_000); }),
          ]);
        } catch {
          this.connection = undefined;
          await this.terminate();
        } finally {
          if (cancellationTimer) clearTimeout(cancellationTimer);
        }
      }
      return { status: "failed", error: { code: timedOut ? "TIMEOUT" : "PI_ACP_FAILED", message, retryable: timedOut } };
    } finally {
      if (timer) clearTimeout(timer);
      if (this.active?.requestId === requestId) this.active = undefined;
      events.end();
    }
  }

  private async requestPermission(request: any): Promise<any> {
    const toolCall = request?.toolCall;
    const rawInput = toolCall?.rawInput;
    const method = rawInput?.method;
    if ((method !== "select" && method !== "confirm") || !this.active) return { outcome: { outcome: "cancelled", _meta: { reason: "unsupported-or-idle" } } };
    const questionId = String(toolCall.toolCallId ?? `pi-ui-${Date.now()}`);
    const text = String(toolCall.title ?? rawInput?.title ?? `Pi ${method}`);
    const rawOptions: unknown = rawInput?.options;
    const options: string[] = Array.isArray(rawOptions) ? rawOptions.map((option: unknown) => String(option)) : [];
    const answer = new Promise<string>(resolve => this.pendingQuestions.set(questionId, { requestId: this.active!.requestId, resolve }));
    this.active.events.push({ type: "question", questionId, text });
    const selected = await answer;
    this.pendingQuestions.delete(questionId);
    if (selected === "cancelled") return { outcome: { outcome: "cancelled", _meta: { reason: "cancelled" } } };
    if (method === "confirm") {
      const normalized = selected.trim().toLowerCase();
      if (normalized !== "yes" && normalized !== "no" && normalized !== "true" && normalized !== "false") return { outcome: { outcome: "cancelled", _meta: { reason: "invalid-answer" } } };
      return { outcome: { outcome: "selected", optionId: normalized === "yes" || normalized === "true" ? "yes" : "no" } };
    }
    const index = options.findIndex(option => option === selected) >= 0 ? options.findIndex(option => option === selected) : Number(selected);
    if (!Number.isSafeInteger(index) || index < 0 || index >= options.length) return { outcome: { outcome: "cancelled", _meta: { reason: "invalid-answer" } } };
    return { outcome: { outcome: "selected", optionId: `choice-${index}` } };
  }

  private resolvePendingQuestions(sessionId: string | undefined, answer: string): void {
    for (const [questionId, pending] of this.pendingQuestions) {
      if (!sessionId || pending.requestId === this.active?.requestId) {
        this.pendingQuestions.delete(questionId);
        pending.resolve(answer);
      }
    }
  }

  private onSessionUpdate(notification: any): void {
    const update = notification?.update;
    if (!update || !this.active) return;
    if (update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") this.active.events.push({ type: "text", text: String(update.content.text), stream: "output" });
    else if (update.sessionUpdate === "agent_thought_chunk" && update.content?.type === "text") this.active.events.push({ type: "text", text: String(update.content.text), stream: "thought" });
    else if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") this.active.events.push({ type: "tool", text: String(update.title ?? update.toolCallId ?? "tool"), ...(update.status ? { status: String(update.status) } : {}) });
  }

  private async terminate(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    try { child.stdin.end(); } catch {}
    const waitForExit = (milliseconds: number) => new Promise<boolean>(resolve => { const timer = setTimeout(() => { cleanup(); resolve(false); }, milliseconds); const onExit = () => { cleanup(); resolve(true); }; const cleanup = () => { clearTimeout(timer); child.off("exit", onExit); }; child.once("exit", onExit); });
    if (await waitForExit(500)) return;
    try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM"); } catch {}
    if (await waitForExit(2_000)) return;
    try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch {}
    await waitForExit(2_000);
  }
}
