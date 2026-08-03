# Architecture and operational contract

## 1. Objective and boundary

`pi-strings` gives a Pi parent a named-worker control plane without PTY scraping or provider-specific orchestration. The production path has exactly one runtime port:

```text
Parent Pi -> strings tool -> Coordinator -> AcpxRuntimePort -> exact-pinned acpx/runtime
                                                        ├─ vendored Pi ACP adapter
                                                        └─ configured ACP agents
```

The coordinator owns worker identity, request state, persistence, worktree admission, bounded evidence, deadlines, and lifecycle actions. ACPX owns ACP process/session handling, normalized events, permissions, cancellation primitives, and close.

## 2. Stable tool contract

The public actions are `spawn`, `send`, `wait`, `result`, `list`, `cancel`, and `close`. Responses include `ok`, `action`, and structured details; errors include a stable code, message, and retryability.

### `spawn`

`name` and `profile` are required; `cwd` and `resumeSessionId` are optional. Names are unique and validated. Writers default to shared isolation (one live writer per canonical cwd); `isolation: "worktree"` is opt-in and requires a linked worktree distinct from the parent. A failed spawn registers no half-created worker.

### `send`

`name` and `prompt` are required. It is accepted only for an idle worker and starts exactly one normal prompt turn. A later `send` after terminal completion continues the same persistent session. A second prompt is never submitted while a handle is active; there is no steering or in-flight injection operation.

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

A profile contains agent, role, kind (oracle/finder/worker/free), model/options, tools, deadline, cancellation grace, output bound, isolation mode, maxTurns, fallbackModels, and maxAttempts. The coordinator appends a worker contract prohibiting recursive orchestration, unsafe git operations, package installation, and shared-environment changes. Role contracts and acceptance contracts are appended based on `kind`.

The only production permission policy is:

- read-only profile: ACPX `deny-all`
- writer profile: ACPX `approve-reads`
- non-interactive permission requests: ACPX `deny`

Pi uses only the vendored adapter command override. Codex role routing uses ACPX `setMode` (`read-only` or `agent`). Profile tool lists and ACPX `cwd` are not claimed as universal enforcement for arbitrary provider-native tools; claims are limited to the layer that actually enforces them.

### Turn budget and stall detection

`maxTurns` (default: none) approximates a turn budget by counting tool-call events. A worker exceeding its budget is cancelled and terminalized as `failed` with code `TURN_BUDGET_EXCEEDED`. A worker repeating an identical tool call `STALL_THRESHOLD` (4) times is cancelled and terminalized as `failed` with code `STALLED`. Both are non-retryable policy violations.

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

Directories are mode 0700 and files mode 0600. State is atomically replaced, locked, and strictly schema-validated. The current version deliberately does not accept legacy `waiting` statuses or `questions`; such state returns `STATE_CORRUPT` rather than silently discarding authority data. Requests left running after parent loss become `PARENT_PROCESS_LOST`; idle persistent sessions may reconnect with identity validation.

Shutdown rejects new work, lets an already-running action tail finish, and prevents queued mutating actions from creating untracked workers before runtime cleanup.

## 7. ACPX boundary

Only `extensions/pi-strings/runtime/acpx-runtime.ts` imports `acpx/runtime`, pinned at version `0.13.0`. The port normalizes ACPX events into local types and passes `timeoutMs: 0` both at runtime construction and turn start. Any ACPX upgrade requires contract tests for session continuity, event/result ordering, cancellation, close, permissions, and state compatibility.

The vendored Pi adapter remains an ACP executable adapter, not a second runtime implementation. Embedded workers share the parent extension process lifetime; active work is not claimed durable across parent loss.

## 8. Observability and failure table

`list` and `result` expose worker/request status, IDs, timestamps, bounded output, event paths, and diagnostics. Raw ACP tool payloads are not retained by the runtime facade. tmux is optional human observation only.

| Failure | Required behavior |
|---|---|
| Missing agent | Spawn fails without registering a worker |
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
