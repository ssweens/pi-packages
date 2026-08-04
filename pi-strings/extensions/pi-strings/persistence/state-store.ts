import { chmod, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";
import type { RequestRecord, RuntimeHandle, WorkerRole, WorkerStatus, WorktreeIdentity } from "../domain/types.js";
import { StringsError } from "../domain/errors.js";

export interface SessionProvenance {
  sessionId: string;
  agent: string;
  profileName: string;
  role: WorkerRole;
  cwd: string;
}

export interface StoredWorker {
  name: string;
  profileName: string;
  role: WorkerRole;
  model?: string;
  tools?: string[];
  status: WorkerStatus;
  cwd: string;
  worktree?: WorktreeIdentity;
  handle: RuntimeHandle;
  activeRequestId?: string;
  createdAt: string;
  updatedAt: string;
}

interface StateFile {
  version: 1;
  workers: StoredWorker[];
  requests: RequestRecord[];
  sessions?: SessionProvenance[];
}

const HandleSchema = z.object({
  sessionKey: z.string().min(1), backend: z.string().min(1), runtimeSessionName: z.string().min(1),
  cwd: z.string().optional(), agent: z.string().optional(), profileName: z.string().optional(), role: z.enum(["read-only", "writer"]).optional(), acpxRecordId: z.string().optional(), backendSessionId: z.string().optional(), agentSessionId: z.string().optional(),
}).strict();
const WorktreeSchema = z.object({ worktreeRoot: z.string().min(1), gitDir: z.string().min(1), commonDir: z.string().min(1) }).strict();
const WorkerSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), profileName: z.string().min(1), role: z.enum(["read-only", "writer"]), model: z.string().min(1).optional(), tools: z.array(z.string().min(1)).min(1).optional(),
  status: z.enum(["spawning", "idle", "running", "failed", "closing", "closed"]), cwd: z.string().min(1), worktree: WorktreeSchema.optional(),
  handle: HandleSchema, activeRequestId: z.string().optional(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
const FailureSchema = z.object({ code: z.string().min(1), message: z.string(), retryable: z.boolean(), detailCode: z.string().optional() }).strict();
const UsageBreakdownSchema = z.object({
  inputTokens: z.number().optional(), outputTokens: z.number().optional(), cachedReadTokens: z.number().optional(),
  cachedWriteTokens: z.number().optional(), thoughtTokens: z.number().optional(), totalTokens: z.number().optional(),
}).strict();
const UsageCostSchema = z.object({ amount: z.number().optional(), currency: z.string().optional() }).strict();
const UsageSchema = z.object({ breakdown: UsageBreakdownSchema.optional(), cost: UsageCostSchema.optional() }).strict();
const AcceptanceSchema = z.object({ parsed: z.boolean(), report: z.unknown().optional() }).strict();
const RequestSchema = z.object({
  id: z.string().min(1), workerName: z.string().min(1), status: z.enum(["running", "completed", "cancelled", "timed_out", "failed"]),
  startedAt: z.iso.datetime(), finishedAt: z.iso.datetime().optional(), output: z.string(), truncated: z.boolean(), eventPath: z.string().optional(),
  failure: FailureSchema.optional(), stopReason: z.string().optional(), cancellationRequestedAt: z.iso.datetime().optional(), lineageId: z.string().optional(), attempt: z.number().int().positive().optional(), supersededBy: z.string().optional(), predecessorRequestId: z.string().optional(),
  usage: UsageSchema.optional(), acceptance: AcceptanceSchema.optional(), requestedModel: z.string().min(1).optional(), attemptModels: z.array(z.string()).optional(), attempts: z.number().int().positive().optional(),
}).strict();
const SessionSchema = z.object({ sessionId: z.string().min(1), agent: z.string().min(1), profileName: z.string().min(1), role: z.enum(["read-only", "writer"]), cwd: z.string().min(1) }).strict();
const StateSchema = z.object({ version: z.literal(1), workers: z.array(WorkerSchema), requests: z.array(RequestSchema), sessions: z.array(SessionSchema).optional() }).strict();

export class StateStore {
  private readonly statePath: string;
  private releaseLease?: () => Promise<void>;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(private readonly root: string) {
    this.statePath = join(root, "state.json");
  }

  async acquire(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
    try {
      this.releaseLease = await lockfile.lock(this.root, {
        realpath: false,
        stale: 30_000,
        update: 10_000,
        retries: 0,
        onCompromised: (error) => { throw error; },
      });
    } catch (error) {
      throw new StringsError("COORDINATOR_OWNED", `Another Pi process owns ${this.root}: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }

  async load(): Promise<StateFile> {
    try {
      const parsed = StateSchema.parse(JSON.parse(await readFile(this.statePath, "utf8")));
      const requestDir = join(this.root, "requests");
      await mkdir(requestDir, { recursive: true, mode: 0o700 });
      await chmod(requestDir, 0o700);
      const requests: RequestRecord[] = [];
      for (const request of parsed.requests) {
        const eventPath = request.eventPath ?? join(requestDir, `${request.id}.ndjson`);
        if (!request.eventPath) {
          await writeFileAtomic(eventPath, `${JSON.stringify({ observedAt: request.finishedAt ?? request.startedAt, event: { type: "legacy_output", text: request.output } })}\n`, { encoding: "utf8", mode: 0o600 });
          await chmod(eventPath, 0o600);
        }
        requests.push({ ...request, eventPath } as RequestRecord);
      }
      const requestIds = new Set(requests.map(request => request.id));
      for (const worker of parsed.workers) {
        if (worker.activeRequestId && !requestIds.has(worker.activeRequestId)) throw new Error(`worker ${worker.name} references an unknown request`);
      }
      return { version: 1, workers: parsed.workers as StoredWorker[], requests, sessions: parsed.sessions ?? [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, workers: [], requests: [], sessions: [] };
      throw new StringsError("STATE_CORRUPT", `Cannot load ${this.statePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  save(workers: StoredWorker[], requests: RequestRecord[], sessions: SessionProvenance[] = []): Promise<void> {
    const payload: StateFile = { version: 1, workers, requests, sessions };
    const write = this.writeTail.then(async () => {
      await writeFileAtomic(this.statePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await chmod(this.statePath, 0o600);
    });
    this.writeTail = write.catch(() => undefined);
    return write;
  }

  async close(): Promise<void> {
    await this.writeTail;
    const release = this.releaseLease;
    delete this.releaseLease;
    if (release) await release();
  }
}
