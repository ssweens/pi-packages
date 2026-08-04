import { randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Profile, RequestRecord, RuntimeHandle, RuntimePort, RuntimeStatus, RuntimeTerminal, RuntimeTurn, StringsResponse, TurnUsage, UsageBreakdown, UsageCost, WorkerKind, WorkerRecord, WorktreeIdentity } from "../domain/types.js";
import { failure, StringsError } from "../domain/errors.js";
import { loadProfiles } from "../domain/config.js";
import { requireCwdUnowned, requireIsolatedWriter, requireWriterUnowned } from "../domain/worktree.js";
import { acceptanceContract, parseAcceptanceReport, roleContract, WORKER_CONTRACT } from "../domain/roles.js";
import { AcpxRuntimePort } from "../runtime/acpx-runtime.js";
import { StateStore, type SessionProvenance, type StoredWorker } from "../persistence/state-store.js";

const NAME = /^[a-z][a-z0-9-]{0,47}$/;
const STALL_THRESHOLD = 4;
const DRAIN_PUMP_TURNS = 2;

interface CoordinatorTerminal {
  status: "failed";
  code: string;
  message: string;
}

type Action = Record<string, unknown> & { action: string };

interface LiveWorker { record: WorkerRecord; runtime: RuntimePort; turn?: RuntimeTurn; deadline?: NodeJS.Timeout }
type RuntimeFactory = (cwd: string, stateDir: string, profile: Profile) => RuntimePort;

export function resumeIdentityMatches(provenance: SessionProvenance, profile: Profile, cwd: string, profileName: string): boolean {
  return provenance.agent === profile.agent && provenance.role === profile.role && provenance.cwd === cwd && provenance.profileName === profileName;
}

export interface CoordinatorOptions {
  stateDir?: string;
  runtimeFactory?: RuntimeFactory;
  profiles?: Record<string, Profile>;
}

export class Coordinator {
  private readonly workers = new Map<string, LiveWorker>();
  private readonly requests = new Map<string, RequestRecord>();
  private readonly sessions = new Map<string, SessionProvenance>();
  private readonly completions = new Map<string, Promise<void>>();
  private readonly terminalSignals = new Set<string>();
  private profiles: Record<string, Profile> | undefined;
  private readonly stateDir: string;
  private readonly stateStore: StateStore;
  private readonly runtimeFactory: RuntimeFactory;
  private initializePromise?: Promise<void>;
  private initialized = false;
  private shuttingDown = false;
  private persistenceEnabled = true;
  private actionTail: Promise<void> = Promise.resolve();

  constructor(private readonly parentCwd: string, options: CoordinatorOptions = {}) {
    this.stateDir = options.stateDir ?? join(process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "pi-strings");
    this.stateStore = new StateStore(this.stateDir);
    this.runtimeFactory = options.runtimeFactory ?? ((cwd, stateDir, profile) => new AcpxRuntimePort(cwd, stateDir, profile));
    this.profiles = options.profiles;
  }

  execute(input: Action): Promise<StringsResponse> {
    if (this.shuttingDown) return Promise.resolve(failure(input.action, new StringsError("COORDINATOR_SHUTTING_DOWN", "The coordinator is shutting down.")));
    if (input.action === "wait" || input.action === "list" || input.action === "result") {
      return this.executeAction(input);
    }
    const result = this.actionTail.then(() => {
      if (this.shuttingDown) return failure(input.action, new StringsError("COORDINATOR_SHUTTING_DOWN", "The coordinator is shutting down."));
      return this.executeAction(input);
    });
    this.actionTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async executeAction(input: Action): Promise<StringsResponse> {
    try {
      await this.initialize();
      switch (input.action) {
        case "list": return this.list(input);
        case "status": return await this.status(input);
        case "spawn": return await this.spawn(input);
        case "send": return await this.send(input);
        case "wait": return await this.wait(input);
        case "result": return this.result(input);
        case "cancel": return await this.cancel(input);
        case "close": return await this.close(input);
        default: throw new StringsError("ACTION_INVALID", `Unknown strings action: ${input.action}`);
      }
    } catch (error) { return failure(input.action, error); }
  }

  private async getProfiles(): Promise<Record<string, Profile>> { return this.profiles ??= await loadProfiles(this.parentCwd); }

  private async admitWriter(profile: Profile, cwd: string): Promise<WorktreeIdentity | undefined> {
    if (profile.role !== "writer") return undefined;
    const isolation = profile.isolation ?? "shared";
    const peers = [...this.workers.values()].map(worker => worker.record);
    if (isolation === "worktree") {
      const worktree = await requireIsolatedWriter(cwd, this.parentCwd);
      requireWriterUnowned(peers, worktree);
      return worktree;
    }
    requireCwdUnowned(peers, cwd);
    return undefined;
  }

  private decoratePrompt(profile: Profile, prompt: string): string {
    const kind: WorkerKind = profile.kind ?? "free";
    return prompt + WORKER_CONTRACT + roleContract(kind) + acceptanceContract(kind);
  }

  private initialize(): Promise<void> {
    return this.initializePromise ??= this.initializeState();
  }

  private async initializeState(): Promise<void> {
    await this.stateStore.acquire();
    const [state, profiles] = await Promise.all([this.stateStore.load(), this.getProfiles()]);
    for (const session of state.sessions ?? []) this.sessions.set(session.sessionId, session);
    for (const request of state.requests) {
      if (request.status === "running") {
        request.status = "failed";
        request.finishedAt = new Date().toISOString();
        request.failure = { code: "PARENT_PROCESS_LOST", message: "The owning Pi process exited before this request reached a terminal result.", retryable: true };
      }
      this.requests.set(request.id, request);
    }
    for (const stored of state.workers) {
      const configuredProfile = profiles[stored.profileName];
      const direct = stored.profileName.startsWith("direct:") && stored.handle.agent ? directProfile(stored.handle.agent, stored.role, stored.tools) : undefined;
      const baseProfile = configuredProfile ?? direct ?? { agent: stored.handle.agent ?? "unavailable", role: stored.role, tools: [], timeoutMs: 900_000, cancellationGraceMs: 5_000, maxOutputBytes: 256_000 };
      const restoredProfile: Profile = stored.handle.agent && stored.handle.agent !== baseProfile.agent ? { ...baseProfile, agent: stored.handle.agent } : baseProfile;
      const profile: Profile = stored.model ? { ...restoredProfile, model: stored.model } : restoredProfile;
      const wasActive = stored.status === "running" || stored.status === "spawning" || stored.status === "closing" || stored.activeRequestId !== undefined;
      const status = wasActive ? "failed" : stored.status;
      const record: WorkerRecord = { ...stored, profile, role: profile.role, status };
      delete record.activeRequestId;
      if (record.role === "writer") {
        if (record.worktree) requireWriterUnowned([...this.workers.values()].map(worker => worker.record), record.worktree);
        else requireCwdUnowned([...this.workers.values()].map(worker => worker.record), record.cwd);
      }
      const runtime = this.runtimeFactory(record.cwd, this.stateDir, profile);
      if (!configuredProfile && !direct) {
        record.status = "failed";
      } else if (!wasActive && (record.status === "idle" || record.status === "failed")) {
        const resumeSessionId = record.handle.backendSessionId ?? record.handle.agentSessionId;
        if (resumeSessionId) {
          try {
            const reconnected = await runtime.ensureSession({ name: record.name, agent: profile.agent, cwd: record.cwd, profile, resumeSessionId });
            const oldSession = record.handle.backendSessionId ?? record.handle.agentSessionId;
            const newSession = reconnected.backendSessionId ?? reconnected.agentSessionId;
            if (oldSession && newSession && oldSession !== newSession) throw new StringsError("SESSION_IDENTITY_CHANGED", `Worker ${record.name} resumed with a different session identity.`);
            record.handle = { ...record.handle, ...reconnected, agent: profile.agent, role: profile.role, profileName: record.profileName, cwd: record.cwd };
            record.status = "idle";
          } catch { record.status = "failed"; }
        }
      }
      const sessionId = record.handle.backendSessionId ?? record.handle.agentSessionId;
      if (sessionId && !this.sessions.has(sessionId)) this.sessions.set(sessionId, { sessionId, agent: profile.agent, profileName: record.profileName, role: profile.role, cwd: record.cwd });
      this.workers.set(record.name, { record, runtime });
    }
    await this.persist();
    this.initialized = true;
  }

  private persist(): Promise<void> {
    if (!this.persistenceEnabled) return Promise.resolve();
    const workers: StoredWorker[] = [...this.workers.values()].map(({ record }) => {
      const { profile: _profile, ...stored } = record;
      return record.profileName.startsWith("direct:") ? { ...stored, tools: [...record.profile.tools] } : stored;
    });
    return this.stateStore.save(workers, [...this.requests.values()], [...this.sessions.values()]);
  }

  async shutdown(): Promise<void> {
    if (!this.initializePromise || this.shuttingDown) return;
    this.shuttingDown = true;
    const actionTail = this.actionTail;
    await actionTail.catch(() => undefined);
    await this.initializePromise.catch(() => undefined);
    if (this.initialized) {
      for (const worker of this.workers.values()) {
        if (worker.turn) {
          try { await this.cancelWorker(worker, "coordinator shutdown", false); } catch { /* terminal state is persisted below */ }
        }
        const closed = await settlesWithin(worker.runtime.close(worker.record.handle, "coordinator shutdown", false), worker.record.profile.cancellationGraceMs).catch(() => false);
        if (!closed) worker.record.status = "failed";
      }
      await this.persist();
    }
    this.persistenceEnabled = false;
    await this.stateStore.close();
  }

  private list(input: Action): StringsResponse {
    let records = [...this.workers.values()].map(({ record }) => record);
    let requests = [...this.requests.values()];
    if (Array.isArray(input.names)) {
      const names = input.names.map((name) => String(name));
      for (const name of names) {
        if (!this.workers.has(name)) throw new StringsError("WORKER_NOT_FOUND", `Unknown worker: ${name}`);
      }
      const selected = new Set(names);
      records = records.filter(record => selected.has(record.name));
      requests = requests.filter(request => selected.has(request.workerName));
    }
    return { ok: true, action: "list", details: { workers: records.map(record => this.publicWorker(record)), requests: requests.map((r) => ({ ...r })) } };
  }

  private async spawn(input: Action): Promise<StringsResponse> {
    const name = requiredString(input.name, "name");
    const profileNameInput = optionalString(input.profile);
    const agentInput = optionalString(input.agent);
    if (!NAME.test(name)) throw new StringsError("WORKER_NAME_INVALID", `Invalid worker name: ${name}`);
    if (this.workers.has(name)) throw new StringsError("WORKER_EXISTS", `Worker ${name} already exists.`);
    const profiles = await this.getProfiles();
    let profileName: string;
    let configuredProfile: Profile | undefined;
    if (profileNameInput) {
      configuredProfile = profiles[profileNameInput];
      if (!configuredProfile) throw new StringsError("PROFILE_NOT_FOUND", `Unknown profile: ${profileNameInput}`);
      if (agentInput) configuredProfile = { ...configuredProfile, agent: agentInput };
      profileName = profileNameInput;
    } else {
      const agent = agentInput ?? "pi";
      profileName = `direct:${agent}`;
      configuredProfile = directProfile(agent, input.role, input.tools);
    }
    if (!configuredProfile) throw new StringsError("PROFILE_INVALID", `Worker ${name} has no resolved profile.`);
    const requestedModel = optionalModel(input.model);
    const profile: Profile = requestedModel === undefined ? configuredProfile : { ...configuredProfile, model: requestedModel };
    const cwd = await realpath(typeof input.cwd === "string" ? input.cwd : this.parentCwd);
    const worktree = await this.admitWriter(profile, cwd);
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    const runtime = this.runtimeFactory(cwd, this.stateDir, profile);
    const resumeSessionId = typeof input.resumeSessionId === "string" ? input.resumeSessionId : undefined;
    if (resumeSessionId) {
      const provenance = this.sessions.get(resumeSessionId);
      if (!provenance) throw new StringsError("RESUME_PROVENANCE_UNKNOWN", "Resume requires coordinator-owned session provenance.");
      const owner = [...this.workers.values()].find(candidate => candidate.record.handle.backendSessionId === resumeSessionId || candidate.record.handle.agentSessionId === resumeSessionId);
      if (owner) throw new StringsError("SESSION_IN_USE", `Session ${resumeSessionId} is already owned by worker ${owner.record.name}.`);
      if (!resumeIdentityMatches(provenance, profile, cwd, profileName)) throw new StringsError("RESUME_IDENTITY_MISMATCH", "Resume requires the original agent, role, profile, and cwd.");
    }
    let handle: RuntimeHandle | undefined;
    try {
      handle = await runtime.ensureSession({ name, agent: profile.agent, cwd, profile, ...(resumeSessionId ? { resumeSessionId } : {}) });
      if (profile.model) await this.requireSelectedModel(runtime, handle, profile.model);
    } catch (error) {
      if (handle) await runtime.close(handle, "model selection failed", true).catch(() => undefined);
      if (profile.model && isRequestedModelUnsupported(error)) {
        throw new StringsError("MODEL_UNAVAILABLE", `Requested model ${profile.model} is not available for this worker.`);
      }
      throw error;
    }
    if (!handle) throw new StringsError("SESSION_INIT_FAILED", `Worker ${name} did not return a runtime session handle.`);
    const now = new Date().toISOString();
    const record: WorkerRecord = { name, profileName, profile, role: profile.role, ...(profile.model ? { model: profile.model } : {}), status: "idle", cwd, ...(worktree ? { worktree } : {}), handle: { ...handle, agent: profile.agent, profileName, role: profile.role, cwd }, createdAt: now, updatedAt: now };
    const sessionId = record.handle.backendSessionId ?? record.handle.agentSessionId;
    if (sessionId) this.sessions.set(sessionId, { sessionId, agent: profile.agent, profileName, role: profile.role, cwd });
    this.workers.set(name, { record, runtime });
    await this.persist();
    return { ok: true, action: "spawn", details: this.publicWorker(record) };
  }

  private async send(input: Action): Promise<StringsResponse> {
    const worker = this.getWorker(requiredString(input.name, "name"));
    if (worker.record.status !== "idle") throw new StringsError("WORKER_BUSY", `Worker ${worker.record.name} is ${worker.record.status}.`);
    if (worker.record.role === "writer") this.revalidateWriter(worker);
    const prompt = requiredString(input.prompt, "prompt");
    const requestedModel = input.model === undefined ? worker.record.profile.model : optionalModel(input.model);
    if (requestedModel) await this.requireSelectedModel(worker.runtime, worker.record.handle, requestedModel);
    const timeoutMs = optionalPositive(input.requestTimeoutMs, worker.record.profile.timeoutMs);
    const requestId = `req_${randomUUID()}`;
    const requestDir = join(this.stateDir, "requests");
    await mkdir(requestDir, { recursive: true, mode: 0o700 });
    await chmod(requestDir, 0o700);
    const eventPath = join(requestDir, `${requestId}.ndjson`);
    const predecessorRequestId = typeof input.predecessorRequestId === "string" ? input.predecessorRequestId : undefined;
    const predecessor = predecessorRequestId ? this.requests.get(predecessorRequestId) : undefined;
    if (predecessorRequestId && !predecessor) throw new StringsError("REQUEST_NOT_FOUND", `Unknown predecessor request: ${predecessorRequestId}`);
    if (predecessor && predecessor.status !== "cancelled" && predecessor.status !== "failed" && predecessor.status !== "timed_out") throw new StringsError("REASSIGNMENT_INVALID", "Only cancelled, failed, or timed-out work can be reassigned.");
    if (predecessor?.supersededBy) throw new StringsError("REASSIGNMENT_INVALID", `Request ${predecessor.id} already has successor ${predecessor.supersededBy}.`);
    if (predecessor && this.workers.has(predecessor.workerName)) throw new StringsError("REASSIGNMENT_INVALID", "Close the predecessor worker before reassigning its work.");
    const lineageId = predecessor?.lineageId ?? `lineage_${randomUUID()}`;
    const attempt = [...this.requests.values()].filter(candidate => candidate.lineageId === lineageId).reduce((highest, candidate) => Math.max(highest, candidate.attempt ?? 0), 0) + 1;
    const record: RequestRecord = { id: requestId, workerName: worker.record.name, status: "running", startedAt: new Date().toISOString(), output: "", truncated: false, eventPath, lineageId, attempt, ...(requestedModel ? { requestedModel } : {}), ...(predecessorRequestId ? { predecessorRequestId } : {}) };
    if (predecessor) predecessor.supersededBy = requestId;
    this.requests.set(requestId, record);
    worker.record.status = "running";
    worker.record.activeRequestId = requestId;
    worker.record.updatedAt = new Date().toISOString();
    const decorated = this.decoratePrompt(worker.record.profile, prompt);
    let turn: RuntimeTurn;
    try {
      turn = worker.runtime.startTurn({ handle: worker.record.handle, prompt: decorated, requestId, timeoutMs });
    } catch (error) {
      record.status = "failed";
      record.finishedAt = new Date().toISOString();
      record.failure = { code: "TURN_START_FAILED", message: error instanceof Error ? error.message : String(error), retryable: false };
      worker.record.status = "idle";
      delete worker.record.activeRequestId;
      await this.persist();
      throw error;
    }
    worker.turn = turn;
    void turn.result.then(() => this.terminalSignals.add(requestId), () => this.terminalSignals.add(requestId));
    const completion = this.runRequest(worker, record, turn, prompt, timeoutMs, requestedModel);
    this.completions.set(requestId, completion);
    await this.persist();
    return { ok: true, action: "send", details: { requestId, worker: worker.record.name, status: "running", lineageId, attempt, ...(requestedModel ? { requestedModel } : {}), session: worker.record.handle.backendSessionId ?? worker.record.handle.agentSessionId, decoratedPromptSuffix: decorated.slice(prompt.length) } };
  }

  private revalidateWriter(worker: LiveWorker): void {
    const isolation = worker.record.profile.isolation ?? "shared";
    const peers = [...this.workers.values()].map(candidate => candidate.record);
    if (isolation === "worktree") {
      const current = worker.record.worktree;
      if (!current) throw new StringsError("WRITER_ISOLATION_CHANGED", "Writer was spawned without a worktree identity.");
      requireWriterUnowned(peers, current, worker.record.name);
    } else {
      requireCwdUnowned(peers, worker.record.cwd, worker.record.name);
    }
  }

  private async runRequest(worker: LiveWorker, request: RequestRecord, firstTurn: RuntimeTurn, prompt: string, timeoutMs: number, requestedModel?: string): Promise<void> {
    const profile = worker.record.profile;
    const maxAttempts = profile.maxAttempts ?? 1;
    const fallback = profile.fallbackModels ?? [];
    const retryEnabled = maxAttempts > 1 || fallback.length > 0;
    const deadline = Date.now() + timeoutMs;
    const onDeadline = async (): Promise<void> => {
      if (this.terminalSignals.has(request.id) || request.status !== "running") return;
      const turn = worker.turn;
      request.status = "timed_out";
      request.finishedAt = new Date().toISOString();
      request.stopReason = "timed_out";
      request.failure = { code: "TURN_TIMEOUT", message: `Coordinator deadline exceeded after ${timeoutMs}ms.`, retryable: true };
      worker.record.status = "failed";
      await this.persist();
      if (turn) {
        const grace = worker.record.profile.cancellationGraceMs;
        await settlesWithin(turn.cancel("coordinator deadline"), grace).catch(() => false);
        await resultWithin(Promise.allSettled([
          turn.closeStream("coordinator deadline exceeded"),
          worker.runtime.close(worker.record.handle, "coordinator deadline exceeded", false),
        ]), grace);
      }
      worker.record.status = "failed";
      worker.record.updatedAt = new Date().toISOString();
      await this.persist();
    };
    worker.deadline = setTimeout(() => { void onDeadline(); }, timeoutMs);
    worker.deadline.unref?.();
    request.attemptModels = [];
    let attempts = 0;
    try {
      let turn = firstTurn;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (Date.now() >= deadline) {
          if (request.status === "running") {
            request.status = "timed_out";
            request.finishedAt = new Date().toISOString();
            request.stopReason = "timed_out";
            request.failure = { code: "TURN_TIMEOUT", message: `Coordinator deadline exceeded after ${timeoutMs}ms.`, retryable: true };
            worker.record.status = "failed";
          }
          break;
        }
        attempts = attempt;
        // Attempt one uses the already selected primary/profile model, if any.
        // Fallback index zero belongs to retry attempt two, never attempt one.
        const model = attempt === 1 ? requestedModel : fallback[attempt - 2];
        if (model) request.attemptModels.push(model);
        if (attempt > 1 && !model) break;
        if (attempt > 1 && model) {
          try {
            await this.requireSelectedModel(worker.runtime, worker.record.handle, model);
          } catch (error) {
            if (request.status === "running") {
              request.status = "failed";
              request.finishedAt = new Date().toISOString();
              request.failure = { code: error instanceof StringsError ? error.code : "MODEL_SELECTION_FAILED", message: error instanceof Error ? error.message : String(error), retryable: false };
              worker.record.status = "failed";
            }
            break;
          }
        }
        worker.turn = turn;
        const coordinatorTerminal = await this.drainAttempt(worker, request, turn);
        if (coordinatorTerminal) { this.applyCoordinatorTerminal(worker, request, coordinatorTerminal); break; }
        if (request.status === "completed" || request.status === "cancelled" || request.status === "timed_out") break;
        // request.status === "failed": retry only on a retryable provider failure with a fallback model remaining.
        if (!retryEnabled) break;
        const failure = request.failure;
        if (!failure?.retryable) break;
        if (attempt >= maxAttempts) break;
        // Re-arm for the next attempt on the same persistent session.
        worker.record.status = "running";
        request.status = "running";
        delete request.finishedAt;
        delete request.failure;
        // The prior attempt's terminal signal is stale for the new turn; clear it
        // so the deadline handler can still fire if the new turn gets stuck.
        this.terminalSignals.delete(request.id);
        const remaining = deadline - Date.now();
        try {
          turn = worker.runtime.startTurn({ handle: worker.record.handle, prompt: this.decoratePrompt(profile, prompt), requestId: request.id, timeoutMs: remaining });
          void turn.result.then(() => this.terminalSignals.add(request.id), () => this.terminalSignals.add(request.id));
        } catch (error) {
          if (request.status === "running") {
            request.status = "failed";
            request.finishedAt = new Date().toISOString();
            request.failure = { code: "TURN_START_FAILED", message: error instanceof Error ? error.message : String(error), retryable: false };
            worker.record.status = "failed";
          }
          break;
        }
      }
      request.attempts = attempts;
    } finally {
      if (worker.deadline) { clearTimeout(worker.deadline); delete worker.deadline; }
      delete worker.record.activeRequestId;
      worker.record.updatedAt = new Date().toISOString();
      delete worker.turn;
      this.completions.delete(request.id);
      await this.persist();
    }
  }

  private async drainAttempt(worker: LiveWorker, request: RequestRecord, turn: RuntimeTurn): Promise<CoordinatorTerminal | undefined> {
    const profile = worker.record.profile;
    const maxTurns = profile.maxTurns;
    let toolCount = 0;
    let lastToolFingerprint = "";
    let stallCount = 0;
    const seenToolCallIds = new Set<string>();
    const completedToolCallIds = new Set<string>();
    const toolCallFingerprints = new Map<string, string>();
    let coordinatorTerminal: CoordinatorTerminal | undefined;
    try {
      let streamFailure: unknown;
      let appendTail = Promise.resolve();
      const eventDrain = (async () => {
        try {
          for await (const event of turn.events) {
            if (event.type === "tool") {
              const isNewCall = !event.toolCallId || !seenToolCallIds.has(event.toolCallId);
              if (event.toolCallId) {
                seenToolCallIds.add(event.toolCallId);
                if (event.toolFingerprint) toolCallFingerprints.set(event.toolCallId, event.toolFingerprint);
              }
              if (isNewCall) {
                toolCount += 1;
                if (maxTurns !== undefined && toolCount >= maxTurns) {
                  coordinatorTerminal = { status: "failed", code: "TURN_BUDGET_EXCEEDED", message: `Worker exceeded its turn budget of ${maxTurns} tool calls.` };
                  void turn.cancel("turn budget exceeded");
                  break;
                }
              }
              const completed = isCompletedToolEvent(event.status);
              const alreadyCompleted = event.toolCallId !== undefined && completedToolCallIds.has(event.toolCallId);
              if (completed && !alreadyCompleted) {
                if (event.toolCallId) completedToolCallIds.add(event.toolCallId);
                const fingerprint = event.toolFingerprint ?? (event.toolCallId ? toolCallFingerprints.get(event.toolCallId) : undefined) ?? event.text;
                if (fingerprint === lastToolFingerprint) stallCount += 1; else { stallCount = 1; lastToolFingerprint = fingerprint; }
                if (stallCount >= STALL_THRESHOLD) {
                  coordinatorTerminal = { status: "failed", code: "STALLED", message: `Worker repeated an identical tool call ${STALL_THRESHOLD} times.` };
                  void turn.cancel("stall detected");
                  break;
                }
              }
            }
            appendTail = appendTail.then(() => this.append(request, event.type === "text" ? event.text : `\n[${event.type}] ${event.text}\n`, profile.maxOutputBytes, event));
          }
        } catch (error) {
          streamFailure = error;
          throw error;
        }
      })();
      // A broken stream before the terminal result is a transport failure. Once
      // the result wins, record that fact before cleanup so its deadline cannot
      // replace it; drain already queued events before committing the record.
      // When the deadline handler closes the stream from outside, the request is
      // already terminal — exit without waiting for a result that won't arrive.
      let externalTerminal = false;
      const terminal = await Promise.race([
        turn.result,
        eventDrain.then(
          () => {
            if (request.status !== "running") {
              externalTerminal = true;
              return;
            }
            return new Promise<never>(() => undefined);
          },
          error => Promise.reject(error),
        ),
      ]);
      if (streamFailure) throw streamFailure;
      if (externalTerminal) return undefined;
      this.terminalSignals.add(request.id);
      // Give the event drain a bounded number of macrotasks to pull any events
      // the runtime already emitted before ACPX clears its queue on close.
      for (let i = 0; i < DRAIN_PUMP_TURNS; i += 1) await new Promise<void>(resolve => setImmediate(resolve));
      const closeSettled = await settlesWithin(turn.closeStream("terminal result"), profile.cancellationGraceMs).catch(() => false);
      const streamSettled = await settlesWithin(Promise.all([eventDrain, appendTail]).then(() => undefined), profile.cancellationGraceMs).catch(() => false);
      if (coordinatorTerminal) return coordinatorTerminal;
      // terminal came from turn.result (the eventDrain guard hangs when the
      // request is still running), so it is defined here.
      this.applyTerminal(worker, request, terminal as RuntimeTerminal);
      const usage = mergeUsage(request.usage, (terminal as RuntimeTerminal).usage);
      if (usage) request.usage = usage;
      request.acceptance = parseAcceptanceReport(request.output);
      if (!closeSettled || !streamSettled) worker.record.status = "failed";
      return undefined;
    } catch (error) {
      if (request.status === "running") {
        request.status = "failed";
        request.finishedAt = new Date().toISOString();
        request.failure = { code: "TRANSPORT_FAILED", message: error instanceof Error ? error.message : String(error), retryable: true };
        worker.record.status = "failed";
      }
      return undefined;
    }
  }

  private applyTerminal(worker: LiveWorker, request: RequestRecord, terminal: RuntimeTerminal): void {
    if (request.status !== "running") return;
    request.finishedAt = new Date().toISOString();
    if (terminal.status === "completed" && request.cancellationRequestedAt) {
      request.status = "cancelled";
      request.stopReason = "cancelled";
    } else if (terminal.status === "completed" || terminal.status === "cancelled") {
      request.status = terminal.status;
      if (terminal.stopReason !== undefined) request.stopReason = terminal.stopReason;
    } else {
      const isTimeout = terminal.error.code === "TIMEOUT" || terminal.error.detailCode?.toLowerCase().includes("timeout") === true;
      request.status = isTimeout ? "timed_out" : "failed";
      request.failure = {
        code: terminal.error.code ?? (isTimeout ? "TURN_TIMEOUT" : "RUNTIME_FAILED"),
        message: terminal.error.message,
        retryable: terminal.error.retryable ?? isTimeout,
        ...(terminal.error.detailCode ? { detailCode: terminal.error.detailCode } : {}),
      };
    }
    if (worker.record.status !== "closing" && worker.record.status !== "closed") {
      worker.record.status = request.status === "completed" || request.status === "cancelled" ? "idle" : "failed";
    }
  }

  private applyCoordinatorTerminal(worker: LiveWorker, request: RequestRecord, terminal: CoordinatorTerminal): void {
    request.status = "failed";
    request.finishedAt = new Date().toISOString();
    request.stopReason = terminal.code.toLowerCase();
    request.failure = { code: terminal.code, message: terminal.message, retryable: false };
    request.acceptance = parseAcceptanceReport(request.output);
    if (worker.record.status !== "closing" && worker.record.status !== "closed") worker.record.status = "failed";
  }

  private async append(request: RequestRecord, text: string, max: number, event: unknown): Promise<void> {
    await appendFile(request.eventPath, `${JSON.stringify({ observedAt: new Date().toISOString(), event })}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(request.eventPath, 0o600);
    if (request.status !== "running") return;
    const remaining = max - Buffer.byteLength(request.output);
    if (remaining <= 0) { request.truncated = true; return; }
    const chunk = Buffer.from(text);
    const retained = safeUtf8Prefix(chunk, remaining);
    request.output += retained.toString("utf8");
    if (chunk.length > retained.length) request.truncated = true;
  }

  private async status(input: Action): Promise<StringsResponse> {
    const worker = this.getWorker(requiredString(input.name, "name"));
    const status = await this.readModelStatus(worker.runtime, worker.record.handle);
    return {
      ok: true,
      action: "status",
      details: {
        worker: worker.record.name,
        currentModelId: status.currentModelId,
        availableModelIds: [...status.availableModelIds],
      },
    };
  }

  private async readModelStatus(runtime: RuntimePort, handle: RuntimeHandle): Promise<RuntimeStatus> {
    if (!runtime.getStatus) throw new StringsError("MODEL_DISCOVERY_UNSUPPORTED", "The worker runtime does not support model discovery.");
    try {
      const status = await runtime.getStatus(handle);
      if (!status.modelDiscoverySupported) throw new StringsError("MODEL_DISCOVERY_UNSUPPORTED", "The worker runtime did not advertise model discovery.");
      return status;
    } catch (error) {
      if (error instanceof StringsError) throw error;
      throw new StringsError("MODEL_DISCOVERY_FAILED", `Model discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async requireSelectedModel(runtime: RuntimePort, handle: RuntimeHandle, model: string): Promise<void> {
    let status = await this.readModelStatus(runtime, handle);
    if (!status.availableModelIds.includes(model)) {
      throw new StringsError("MODEL_UNAVAILABLE", `Requested model ${model} is not available for this worker. Available models: ${status.availableModelIds.join(", ") || "none advertised"}.`);
    }
    if (status.currentModelId === model) return;
    if (!runtime.setConfigOption) throw new StringsError("MODEL_SELECTION_UNSUPPORTED", "The worker runtime does not support model selection.");
    try {
      await runtime.setConfigOption({ handle, key: "model", value: model });
      status = await this.readModelStatus(runtime, handle);
    } catch (error) {
      if (error instanceof StringsError) throw error;
      throw new StringsError("MODEL_SELECTION_FAILED", `Model selection failed for ${model}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (status.currentModelId !== model) throw new StringsError("MODEL_SELECTION_FAILED", `The worker runtime did not select requested model ${model}.`);
  }

  private async wait(input: Action): Promise<StringsResponse> {
    const ids = this.selectedRequestIds(input);
    const mode = input.mode === undefined ? "all" : input.mode;
    if (mode !== "any" && mode !== "all") throw new StringsError("INPUT_INVALID", "wait mode must be any or all.");
    const pending = ids.map((id) => this.completions.get(id)).filter((p): p is Promise<void> => p !== undefined);
    const timeoutMs = optionalPositive(input.waitTimeoutMs, 300_000);
    const target = mode === "any" ? Promise.race(pending) : Promise.allSettled(pending).then(() => undefined);
    const timedOut = pending.length > 0 && !(await settlesWithin(target, timeoutMs));
    const selected = ids.map((id) => this.requests.get(id)).filter((request): request is RequestRecord => request !== undefined);
    const requests = mode === "any" && !timedOut ? selected.filter(request => isTerminal(request.status)) : selected;
    return { ok: true, action: "wait", details: { mode, timedOut, requests: requests.map(request => ({ ...request })) } };
  }

  private result(input: Action): StringsResponse {
    const id = requiredString(input.requestId, "requestId");
    const request = this.requests.get(id);
    if (!request) throw new StringsError("REQUEST_NOT_FOUND", `Unknown request: ${id}`);
    return { ok: true, action: "result", details: { ...request } };
  }

  private async cancel(input: Action): Promise<StringsResponse> {
    const worker = this.getWorker(requiredString(input.name, "name"));
    const { requestId, escalated } = await this.cancelWorker(worker, typeof input.reason === "string" ? input.reason : "cancel requested", false);
    if (escalated) throw new StringsError("CANCEL_ESCALATED", `Worker ${worker.record.name} did not settle after cancellation; its runtime was closed and the request was terminalized as cancelled.`, true);
    return { ok: true, action: "cancel", details: { worker: worker.record.name, requestId, status: this.requests.get(requestId)?.status ?? "cancelled" } };
  }

  private async cancelWorker(worker: LiveWorker, reason: string, discardPersistentState: boolean): Promise<{ requestId: string; escalated: boolean }> {
    if (!worker.turn || !worker.record.activeRequestId) throw new StringsError("WORKER_NOT_RUNNING", `Worker ${worker.record.name} has no active turn.`);
    const requestId = worker.record.activeRequestId;
    const turn = worker.turn;
    const request = this.requests.get(requestId);
    if (request) request.cancellationRequestedAt = new Date().toISOString();
    await this.persist();
    const cancelAcknowledged = await settlesWithin(turn.cancel(reason), worker.record.profile.cancellationGraceMs).catch(() => false);
    const completion = this.completions.get(requestId);
    const settled = cancelAcknowledged && (!completion || await settlesWithin(completion, worker.record.profile.cancellationGraceMs));
    if (!settled) {
      if (request?.status === "running") {
        request.status = "cancelled";
        request.finishedAt = new Date().toISOString();
        request.stopReason = "cancelled";
      }
      delete worker.record.activeRequestId;
      delete worker.turn;
      this.completions.delete(requestId);
      await this.persist();
      const cleanup = await resultWithin(Promise.allSettled([
        turn.closeStream("cancellation grace expired"),
        worker.runtime.close(worker.record.handle, "cancellation grace expired", discardPersistentState),
      ]), worker.record.profile.cancellationGraceMs);
      if (!cleanup) {
        worker.record.status = "failed";
        await this.persist();
        throw new StringsError("CANCEL_CLEANUP_TIMEOUT", `Request ${requestId} was cancelled, but runtime cleanup exceeded ${worker.record.profile.cancellationGraceMs}ms.`, true);
      }
      const cleanupFailure = cleanup.find(result => result.status === "rejected");
      worker.record.status = cleanupFailure ? "failed" : "closed";
      await this.persist();
      if (cleanupFailure?.status === "rejected") {
        throw new StringsError("CANCEL_CLEANUP_FAILED", `Request ${requestId} was cancelled, but runtime cleanup failed: ${cleanupFailure.reason instanceof Error ? cleanupFailure.reason.message : String(cleanupFailure.reason)}`, true);
      }
      return { requestId, escalated: true };
    }
    await this.persist();
    return { requestId, escalated: false };
  }

  private async close(input: Action): Promise<StringsResponse> {
    const worker = this.getWorker(requiredString(input.name, "name"));
    if (worker.record.status === "running" && input.force !== true) throw new StringsError("WORKER_BUSY", "Use force=true to close an active worker.");
    let alreadyClosed = false;
    if (worker.turn) {
      const cancelled = await this.cancelWorker(worker, "worker close", input.discardPersistentState === true);
      alreadyClosed = cancelled.escalated;
    }
    worker.record.status = "closing";
    worker.record.updatedAt = new Date().toISOString();
    await this.persist();
    try {
      if (!alreadyClosed) {
        const closed = await settlesWithin(worker.runtime.close(worker.record.handle, "pi-strings close", input.discardPersistentState === true), worker.record.profile.cancellationGraceMs).catch(() => false);
        if (!closed) throw new Error(`cleanup exceeded ${worker.record.profile.cancellationGraceMs}ms`);
      }
    } catch (error) {
      worker.record.status = "failed";
      worker.record.updatedAt = new Date().toISOString();
      await this.persist();
      throw new StringsError("CLOSE_FAILED", `Worker ${worker.record.name} cleanup failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
    worker.record.status = "closed";
    worker.record.updatedAt = new Date().toISOString();
    const details = this.publicWorker(worker.record);
    this.workers.delete(worker.record.name);
    await this.persist();
    return { ok: true, action: "close", details };
  }

  private selectedRequestIds(input: Action): string[] {
    if (typeof input.requestId === "string") {
      if (!this.requests.has(input.requestId)) throw new StringsError("REQUEST_NOT_FOUND", `Unknown request: ${input.requestId}`);
      return [input.requestId];
    }
    if (Array.isArray(input.names)) return input.names.flatMap((name) => {
      const workerName = String(name);
      const worker = this.workers.get(workerName);
      if (!worker) throw new StringsError("WORKER_NOT_FOUND", `Unknown worker: ${workerName}`);
      if (worker.record.activeRequestId) return [worker.record.activeRequestId];
      const latest = [...this.requests.values()].reverse().find(request => request.workerName === workerName);
      return latest ? [latest.id] : [];
    });
    if (input.all === true) return [...this.completions.keys()];
    throw new StringsError("WAIT_SELECTOR_REQUIRED", "wait requires requestId, names, or all=true.");
  }

  private getWorker(name: string): LiveWorker { const worker = this.workers.get(name); if (!worker) throw new StringsError("WORKER_NOT_FOUND", `Unknown worker: ${name}`); return worker; }
  private publicWorker(record: WorkerRecord): Record<string, unknown> { return { name: record.name, profile: record.profileName, agent: record.profile.agent, role: record.role, ...(record.model ? { model: record.model } : {}), status: record.status, cwd: record.cwd, activeRequestId: record.activeRequestId, session: record.handle.backendSessionId ?? record.handle.agentSessionId }; }
}

const DIRECT_READ_TOOLS = ["read", "grep", "find", "ls"];
const DIRECT_WRITE_TOOLS = [...DIRECT_READ_TOOLS, "bash", "edit", "write"];
function directProfile(agent: string, rawRole: unknown, rawTools: unknown): Profile {
  const role = rawRole === undefined ? "read-only" : rawRole;
  if (role !== "read-only" && role !== "writer") throw new StringsError("INPUT_INVALID", "role must be read-only or writer.");
  const tools = rawTools === undefined ? (role === "writer" ? DIRECT_WRITE_TOOLS : DIRECT_READ_TOOLS) : rawTools;
  if (!Array.isArray(tools) || tools.length === 0 || !tools.every((tool): tool is string => typeof tool === "string" && tool.trim() !== "")) {
    throw new StringsError("INPUT_INVALID", "tools must be a non-empty string array when provided.");
  }
  if (role === "read-only" && tools.some(tool => !DIRECT_READ_TOOLS.includes(tool))) {
    throw new StringsError("POLICY_UNENFORCEABLE", "Read-only workers may only use read, grep, find, and ls.");
  }
  return { agent, role, tools: [...tools], timeoutMs: 900_000, cancellationGraceMs: 5_000, maxOutputBytes: 256_000 };
}
function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw new StringsError("INPUT_INVALID", "String values must be non-empty when provided.");
  return value.trim();
}

function isCompletedToolEvent(status: string | undefined): boolean {
  return status === undefined || status === "completed" || status === "done";
}

function safeUtf8Prefix(chunk: Buffer, maxBytes: number): Buffer {
  if (chunk.length <= maxBytes) return chunk;
  let end = maxBytes;
  while (end > 0) {
    try { new TextDecoder("utf-8", { fatal: true }).decode(chunk.subarray(0, end)); return chunk.subarray(0, end); }
    catch { end -= 1; }
  }
  return chunk.subarray(0, 0);
}
function isTerminal(status: RequestRecord["status"]): boolean { return status === "completed" || status === "cancelled" || status === "timed_out" || status === "failed"; }
function requiredString(value: unknown, name: string): string { if (typeof value !== "string" || value.trim() === "") throw new StringsError("INPUT_INVALID", `${name} is required.`); return value.trim(); }
function optionalPositive(value: unknown, fallback: number): number { if (value === undefined) return fallback; if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new StringsError("INPUT_INVALID", "timeoutMs must be positive."); return value; }
function isRequestedModelUnsupported(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "ACP_MODEL_UNSUPPORTED" || code === "MODEL_UNAVAILABLE";
}
function optionalModel(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw new StringsError("INPUT_INVALID", "model must be a non-empty string when provided.");
  return value.trim();
}

const USAGE_TOKEN_KEYS = ["inputTokens", "outputTokens", "cachedReadTokens", "cachedWriteTokens", "thoughtTokens", "totalTokens"] as const;
function mergeUsage(prev: TurnUsage | undefined, next: TurnUsage | undefined): TurnUsage | undefined {
  if (!prev) return next;
  if (!next) return prev;
  const a = prev.breakdown ?? {};
  const b = next.breakdown ?? {};
  const breakdown: UsageBreakdown = {};
  for (const key of USAGE_TOKEN_KEYS) {
    const x = a[key]; const y = b[key];
    if (typeof x === "number" || typeof y === "number") breakdown[key] = (x ?? 0) + (y ?? 0);
  }
  const ca = prev.cost; const cb = next.cost;
  let cost: UsageCost | undefined;
  if (ca || cb) {
    cost = {};
    if (typeof ca?.amount === "number" || typeof cb?.amount === "number") cost.amount = (ca?.amount ?? 0) + (cb?.amount ?? 0);
    if (typeof cb?.currency === "string") cost.currency = cb.currency;
    else if (typeof ca?.currency === "string") cost.currency = ca.currency;
  }
  return { breakdown, ...(cost ? { cost } : {}) };
}

async function resultWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function settlesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
