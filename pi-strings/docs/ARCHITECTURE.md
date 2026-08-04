# Architecture and operational contract

## 1. Objective and boundary

`pi-strings` gives a Pi parent a named-worker control plane without PTY scraping or provider-specific orchestration. The production path has exactly one runtime port:

```text
Parent Pi -> op_* tools -> Coordinator -> AcpxRuntimePort -> vendored ACPX runtime
                                                        ├─ vendored Pi ACP adapter
                                                        └─ configured ACP agents
```

The coordinator owns worker identity, request state, persistence, worktree admission, bounded evidence, deadlines, and lifecycle actions. ACPX owns ACP process/session handling, normalized events, permissions, cancellation primitives, and close.

## 2. Stable tool contract

The public actions are `spawn`, `status`, `send`, `wait`, `result`, `list`, `cancel`, and `close`. Responses include `ok`, `action`, and structured details; errors include a stable code, message, and retryability.

### `spawn`

`name` is required; `profile` is optional for reusable policy bundles, and `agent` is optional (default `pi`). Without a profile, direct workers use safe read-only defaults (`read`, `grep`, `find`, `ls`); `role: "writer"` selects the explicit writer tool default, or callers may provide `tools`. `cwd`, `model`, and `resumeSessionId` are optional. Names are unique and validated. Writers default to shared isolation (one live writer per canonical cwd); `isolation: "worktree"` remains a profile policy and requires a linked worktree distinct from the parent. A failed spawn registers no half-created worker.

### `status`

`name` is required. The coordinator exposes ACPX `getStatus` model discovery as `currentModelId` and `availableModelIds` for a live worker. If the runtime does not advertise discovery, the operation fails explicitly with `MODEL_DISCOVERY_UNSUPPORTED` (or a discovery failure code).

### `send`

`name` and `prompt` are required. An optional `model` is checked against live discovery and selected before the turn; unavailable IDs and unsupported discovery/selection fail explicitly. The selected `requestedModel` is retained in request provenance. It is accepted only for an idle worker and starts exactly one normal prompt turn. A later `send` after terminal completion continues the same persistent session. A second prompt is never submitted while a handle is active; there is no steering or in-flight injection operation.

The coordinator starts ACPX turns with timeout `0` and runs the profile deadline itself. On deadline it records `timed_out`, gates late output/results, attempts cooperative cancellation, closes the stream/runtime within bounded grace, and marks the worker failed and unusable until explicitly closed or replaced.

The prompt is decorated with the worker's role contract and acceptance contract based on `kind` (oracle, finder, worker, free). Oracle, finder, and worker kinds are expected to produce a fenced `acceptance-report` block in their output; the coordinator parses it onto the request.

For profiles with `fallbackModels` and `maxAttempts > 1`, a retryable provider failure triggers a bounded retry on the same persistent session with the fallback model. The public request ID is stable across retries. Non-retryable failures, cancellations, and policy violations (stall, turn budget) are never retried.

### `wait` and `result`

`wait` selects a request, worker names, or a fixed `all` snapshot. Its own wait deadline returns control without cancelling work. `result` returns bounded progress or the authoritative terminal record. Terminal completion closes/drains the event stream so an iterator that never ends cannot strand a request. Stream loss before the terminal result is transport failure.

### `cancel` and `close`

Cancel is cooperative first and escalates after bounded grace; cancellation intent wins over a late normal result. Close may force cancellation, records cleanup failure as a failed unusable worker, and removes the worker only after successful cleanup. Repeated close attempts after a failure can retry cleanup.

## 3. State machines and invariants

Worker:

```text
spawning -> idle -> running -> idle
    |         |       |        |
    +------> failed <-+        closing -> closed
```

A timed-out or failed worker does not become idle automatically. Request:

```text
created -> running -> completed
                  |-> cancelled
                  |-> timed_out
                  |-> failed
```

Each worker has zero or one active request. Each request has one terminal transition. Terminal status comes from the ACPX turn result, except coordinator-owned deadline/cancellation/transport transitions. Late events may be logged but cannot alter terminal output or status.

## 4. Profiles and permissions

A profile contains agent, role, kind (oracle/finder/worker/free), model/options, tools, deadline, cancellation grace, output bound, isolation mode, maxTurns, fallbackModels, and maxAttempts. Profiles are optional policy bundles; direct workers resolve the same domain profile shape from `agent` (default `pi`), role, and tools. The coordinator appends a worker contract prohibiting recursive orchestration, unsafe git operations, package installation, and shared-environment changes. Role contracts and acceptance contracts are appended based on `kind`.

Permission enforcement is entirely native to ACPX:

- Every role uses ACPX `approve-reads` as its base mode.
- Read-only workers pass ACPX's native policy with `autoApprove: ["read", "search"]` and `defaultAction: "deny"`; writers pass native `defaultAction: "approve"` so explicit writer turns do not wait for an unavailable permission UI.
- pi-strings sets ACPX `nonInteractivePermissions: "deny"` as the fallback for unpromptable requests.
- Pi additionally receives its validated `allowedTools` list through the vendored adapter command override.
- pi-strings does not implement provider-specific permission callbacks or custom permission matching.

`permissionMode` and `permissionPolicy` are ACPX choices, not a pi-strings reimplementation. Profile tool lists, ACPX `cwd`, and provider-native sandbox behavior are not claimed as universal enforcement for arbitrary provider-native tools.

Provider-native write scoping is provider-specific and is **not enforced by ACPX params**:

- **Codex**: escapes via `codex-acp`, which hardcodes `projects.<cwd>.trust_level = "trusted"` (`CodexAcpClient.ts:498`); Codex's Guardian Review can then auto-approve an out-of-worktree `apply_patch` despite the forwarded workspace-write sandbox. Fix requires changing `codex-acp` (vendor plan: `vendor/codex-acp/README.md`).
- **Amp**: by default it can also write outside the worktree, but it **is** confinable via its permission plugin: the loose builtin rule is `allow apply_patch` (rule 121), and a higher-precedence user rule `reject …` overrides it. Precise "allow in-worktree / reject outside" is fragile because Amp's `apply_patch` emits absolute paths and the match condition is the free-text `diff` arg (`edit_file --path` scopes cleanly but Amp prefers `apply_patch`). `amp-acp` does not currently forward per-session permission rules.
- **OpenCode**: confined by its own `permission` config (e.g. `{ edit: "allow", external_directory: "deny" }`), which the boundary test injects.
- **Claude Code**: supported via ACPX's built-in `claude` registry entry (`npx @agentclientprotocol/claude-agent-acp@^0.64.2`); `agent: "claude"` resolves natively (no override needed). Requires Claude Code subscription access (org-enabled) or an `ANTHROPIC_API_KEY`.

  **Deep-dive (why Claude escapes, and why it is the one that is *ACP-confinable*):** Claude's native `Write`/`Edit` route through the SDK's `canUseTool` hook (`claude-agent-acp/src/acp-agent.ts`), which forwards a real ACP `session/request_permission` to the host in the default (non-bypass) mode. So unlike Codex (Guardian Review) and Amp (`apply_patch`), Claude's write **goes through the ACP permission layer** — ACPX sees it and resolves it via its `permissionPolicy`. The escape happens only because pi-strings gives writers `permissionPolicy: { defaultAction: "approve" }`, and ACPX's `permissionPolicy` shapes (`defaultAction`/`autoApprove`) match by tool kind/name, **not by path** (`vendor/acpx/src/permissions.ts`). The worktree path is never examined.

  **Implication:** a **path-aware ACPX permission decision** (approve writes only within the worker `cwd`) would confine Claude without forking the provider — the only one of the three native writers where that's true. That would require path-based permission matching at the ACPX host layer (a deliberate step against the thin-proxy "no custom permission matching" stance), or a cwd-scoped policy. Currently not done; Claude's `real … permission boundary` E2E fails on the default approve policy.

`agent: "amp"` is supported via the `amp` registry override (`npx -y amp-acp`); see `tasks/todo.md` and `vendor/codex-acp/README.md`.

### Turn budget and stall detection

`maxTurns` (default: none) approximates a turn budget by counting distinct tool invocations. ACPX can emit many lifecycle and input-streaming updates for one invocation; updates sharing a `toolCallId` count once. A worker exceeding its budget is cancelled and terminalized as `failed` with code `TURN_BUDGET_EXCEEDED`. Stall detection evaluates identified calls only when their completed update arrives, fingerprinting ACPX tool identity (`title`) plus a SHA-256 digest of stable final `rawInput` when available rather than provisional display text. Raw tool inputs do not cross the normalization boundary or enter request event logs. A worker issuing an identical completed call `STALL_THRESHOLD` (4) times under distinct call IDs is cancelled and terminalized as `failed` with code `STALLED`. Both are non-retryable policy violations.

## 5. Writer isolation

`pi-strings` never creates or removes worktrees implicitly. The default isolation mode is `shared`: the writer runs in the given `cwd` and one live writer per canonical cwd is enforced. A second writer in the same cwd is rejected with `WRITER_CWD_OWNED`.

`isolation: "worktree"` is opt-in compatibility mode. In that mode, `cwd` must be an existing linked worktree, differ from the parent checkout, and remain unowned by another live writer. Isolation is revalidated before each turn.

Future stronger isolation may use CoW (copy-on-write) temp copies of the repo rather than worktrees.

## 6. Persistence and recovery

State root: `${PI_AGENT_DIR:-~/.pi/agent}/pi-strings/`.

```text
state.json                    worker registry and bounded request results
state.json.lock/              coordinator ownership lease
requests/<request-id>.ndjson  normalized event log
acpx/                         ACPX session records
```

Directories are mode 0700 and files mode 0600. State is atomically replaced, locked, and strictly schema-validated. Direct workers persist their validated tool list (and selected creation-time model) so restart reconstruction cannot broaden policy. The current version deliberately does not accept legacy `waiting` statuses or `questions`; such state returns `STATE_CORRUPT` rather than silently discarding authority data. Requests left running after parent loss become `PARENT_PROCESS_LOST`; idle persistent sessions may reconnect with identity validation.

Shutdown rejects new work, lets an already-running action tail finish, and prevents queued mutating actions from creating untracked workers before runtime cleanup.

## 7. ACPX boundary

`vendor/acpx/` contains the auditable ACPX `0.13.0` source snapshot at commit `e91cc504` (PR #468). `npm run build` emits the runtime and declarations under `dist/acpx-runtime`; `extensions/pi-strings/runtime/acpx-runtime.ts` imports that generated local module. The port normalizes ACPX events into local types, exposes `getStatus().models.currentModelId`/`availableModelIds`, and passes `timeoutMs: 0` both at runtime construction and turn start. Any ACPX upgrade requires contract tests for session continuity, model discovery/selection, event/result ordering, cancellation, close, permissions, and state compatibility.

The vendored Pi adapter remains an ACP executable adapter, not a second runtime implementation. Embedded workers share the parent extension process lifetime; active work is not claimed durable across parent loss.

## 8. Observability and failure table

`status` exposes live model discovery (`currentModelId`, `availableModelIds`); `list` and `result` expose worker/request status, IDs, timestamps, bounded output, event paths, model provenance, and diagnostics. Raw ACP tool payloads are not retained by the runtime facade. tmux is optional human observation only.

| Failure | Required behavior |
|---|---|
| Missing/invalid agent | Spawn fails without registering a worker |
| Model discovery unsupported | `op_status` or a requested model fails explicitly with `MODEL_DISCOVERY_UNSUPPORTED` |
| Model unavailable | Spawn/send fails explicitly with `MODEL_UNAVAILABLE`; no turn starts |
| Model selection unsupported/fails | Requested spawn/send fails explicitly with `MODEL_SELECTION_UNSUPPORTED` or `MODEL_SELECTION_FAILED` |
| Provider error (retryable) | Request retries on fallback model if configured; otherwise `failed` with provider diagnostic |
| Provider error (non-retryable) | Request is `failed`; no retry |
| Stream loss before result | Request is `failed` transport; never inferred complete |
| Coordinator deadline | Request is `timed_out`; runtime cleanup is bounded; worker remains failed |
| Turn budget exceeded | Request is `failed` with `TURN_BUDGET_EXCEEDED`; no retry |
| Repeated identical tool call | Request is `failed` with `STALLED`; no retry |
| Ignored cancel | Escalate; request remains `cancelled` |
| Close rejection/timeout | Worker remains persisted as `failed`, never `closing` indefinitely |
| Parent loss | Active requests become `PARENT_PROCESS_LOST` on restart |
| Corrupt state | Return `STATE_CORRUPT`; do not reset silently |
| Output exceeds bound | Continue draining to private log; retain bounded summary |
