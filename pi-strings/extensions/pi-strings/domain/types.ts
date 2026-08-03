export type WorkerRole = "read-only" | "writer";
export type WorkerStatus = "spawning" | "idle" | "running" | "waiting" | "failed" | "closing" | "closed";
export type RequestStatus = "running" | "waiting" | "completed" | "cancelled" | "timed_out" | "failed";

export interface RuntimeCapabilities {
  version: 1;
  steering: boolean;
  resume: boolean;
  permissions: boolean;
  questions: boolean;
}

export type SteeringAcknowledgement =
  | { status: "delivered"; steerId: string; requestId: string }
  | { status: "failed"; steerId: string; requestId: string; message: string }
  | { status: "terminal-race"; steerId: string; requestId: string; message: string };

export interface WorktreeIdentity {
  worktreeRoot: string;
  gitDir: string;
  commonDir: string;
}

export interface Profile {
  agent: string;
  role: WorkerRole;
  model?: string;
  thinking?: string;
  tools: string[];
  timeoutMs: number;
  cancellationGraceMs: number;
  maxOutputBytes: number;
}

export interface RuntimeHandle {
  sessionKey: string;
  backend: string;
  runtimeSessionName: string;
  agent?: string;
  profileName?: string;
  role?: WorkerRole;
  cwd?: string;
  acpxRecordId?: string;
  backendSessionId?: string;
  agentSessionId?: string;
}

export type NormalizedEvent =
  | { type: "text"; text: string; stream: "output" | "thought" }
  | { type: "status"; text: string }
  | { type: "tool"; text: string; status?: string }
  | { type: "question"; questionId: string; text: string; expiresAt?: string };

export type RuntimeTerminal =
  | { status: "completed"; stopReason?: string }
  | { status: "cancelled"; stopReason?: string }
  | { status: "failed"; error: { message: string; code?: string; detailCode?: string; retryable?: boolean } };

export interface RuntimeTurn {
  requestId: string;
  events: AsyncIterable<NormalizedEvent>;
  result: Promise<RuntimeTerminal>;
  cancel(reason?: string): Promise<void>;
  closeStream(reason?: string): Promise<void>;
}

export interface RuntimePort {
  capabilities?: RuntimeCapabilities;
  getCapabilities?(): RuntimeCapabilities;
  ensureSession(input: { name: string; agent: string; cwd: string; profile: Profile; resumeSessionId?: string }): Promise<RuntimeHandle>;
  startTurn(input: { handle: RuntimeHandle; prompt: string; requestId: string; timeoutMs: number; mode: "prompt" | "steer" }): RuntimeTurn;
  steer?(input: { handle: RuntimeHandle; requestId: string; steerId: string; prompt: string }): Promise<SteeringAcknowledgement>;
  reply?(input: { handle: RuntimeHandle; requestId: string; questionId: string; answer: string }): Promise<void>;
  cancel(handle: RuntimeHandle, reason?: string): Promise<void>;
  close(handle: RuntimeHandle, reason: string, discardPersistentState: boolean): Promise<void>;
}

export interface QuestionRecord {
  id: string;
  adapterQuestionId: string;
  workerName: string;
  requestId: string;
  text: string;
  status: "pending" | "answered" | "expired";
  askedAt: string;
  expiresAt?: string;
  answeredAt?: string;
}

export interface RequestRecord {
  id: string;
  workerName: string;
  status: RequestStatus;
  startedAt: string;
  finishedAt?: string;
  output: string;
  truncated: boolean;
  eventPath: string;
  failure?: { code: string; message: string; retryable: boolean; detailCode?: string };
  stopReason?: string;
  cancellationRequestedAt?: string;
  lineageId?: string;
  attempt?: number;
  supersededBy?: string;
  predecessorRequestId?: string;
}

export interface WorkerRecord {
  name: string;
  profileName: string;
  profile: Profile;
  role: WorkerRole;
  status: WorkerStatus;
  cwd: string;
  worktree?: WorktreeIdentity;
  handle: RuntimeHandle;
  activeRequestId?: string;
  createdAt: string;
  updatedAt: string;
  lineageId?: string;
}

export type StringsResponse =
  | { ok: true; action: string; details: Record<string, unknown> }
  | { ok: false; action: string; error: { code: string; message: string; retryable: boolean } };
