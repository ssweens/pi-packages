# Architecture and operational contract

## 1. Objective

`pi-strings` gives a Pi parent a stable multi-agent control plane comparable to mature coding-agent teams without coupling orchestration to PTYs, shell text, or one vendor. The public contract is Pi-native; ACP and the concrete Pi adapter are replaceable internals.

## 2. Boundaries

```text
Parent Pi
  └─ strings tool
      └─ Coordinator (policy + state machines + retained results)
          └─ AcpRuntimePort
              └─ exact-pinned acpx/runtime
                  ├─ vendored pi-acp adapter ── pi --mode rpc
                  ├─ Claude Code ACP adapter
                  ├─ Codex ACP adapter
                  └─ any configured ACP executable
```

The current layer composes multi-agent workflows through parent tool calls and keeps one accountable decision-maker. Teams, DAGs, mailboxes, and recursive delegation are not foundational requirements; they remain eligible experimental layers when evidence shows a coordination benefit. The progressive capability contract and promotion criteria are defined in [`2026-08-02-COORDINATION_LAYERS.md`](2026-08-02-COORDINATION_LAYERS.md).

## 3. Stable tool contract

All responses include `ok`, `action`, and structured `details`. Errors include a stable `code`, human message, and retryability. Tool output is bounded; full retained output is stored on disk and referenced by path when necessary.

### `spawn`

Required: `name`, `profile`. Optional: `cwd`, `resumeSessionId`.

Preconditions:

- Name matches `^[a-z][a-z0-9-]{0,47}$` and is unique.
- Profile exists and resolves to an executable ACP agent.
- A writer cwd is a linked worktree, differs from the parent cwd, and is not owned by another writer.
- A read-only Pi profile has no mutation, orchestration, environment-management, or arbitrary integration tools.
- Runtime health probe and session creation complete within their deadlines.

Postcondition: worker is `idle`, or spawn fails without registering a half-created worker.

### `send` and `steer`

Required: `name`, `prompt`. Optional: `timeoutMs`.

- `send` requires `idle` and starts one request.
- `steer` negotiates versioned runtime capabilities and calls only the runtime's acknowledged in-flight operation. Pi workers use a dedicated ACP client and a tagged ACP prompt that the vendored adapter routes to native Pi RPC `steer` on the same active process. Pinned generic acpx 0.13.0 advertises steering false and returns `STEER_UNSUPPORTED` before adapter work. Every capable adapter must return a correlated delivered/failed/terminal-race acknowledgement without starting a second turn.
- The returned request ID is globally unique and used by `wait`, `result`, and diagnostics.
- Output events are consumed immediately into a byte-bounded retained summary and a private normalized NDJSON event log; raw ACP tool payloads are not retained.

### `wait`

Accepts one request ID, selected worker names, or `all: true`, plus an optional wait deadline. It waits for the selected snapshot only. New turns started later do not extend the wait. A wait deadline does not cancel work.

### `result`

Returns the retained terminal record for one request. While running, it returns current status and bounded output. Terminal records are immutable.

### `cancel`

Requires a running request. It sends cooperative ACP cancellation, waits a bounded grace period, then closes the adapter process if cancellation does not settle. The result remains `cancelled`, never `completed`.

### `questions` and `reply`

Question events are correlated to one worker and request, persist as pending records, and make the request visibly `waiting`. Pi extension select/confirm requests are bridged through the same ACP connection as correlated questions. Read-only external ACP adapters may opt into the `piStringsQuestion` permission-request extension; `reply` resolves the provider permission response on the same turn (`approve`/`yes` allows once, other answers reject once). Writers never use this bridge. Generic acpx 0.13.0 does not advertise native question/reply support. Parent loss expires pending questions.

### `close`

Rejects while running unless `force: true`. Forced close first follows the cancellation sequence. `discardPersistentState` is explicit and defaults to false.

## 4. State machines

Worker:

```text
spawning -> idle -> running -> idle
    |         |       |        |
    +------> failed <-+        closing -> closed
```

Request:

```text
created -> running -> waiting -> completed
                  |-> cancelled
                  |-> timed_out
                  |-> failed(provider | transport | policy | internal)
```

Invariants:

- A worker has zero or one active request.
- A request has exactly one terminal transition.
- Terminal status is derived from `AcpRuntimeTurn.result`, never inferred from stream closure.
- Stream loss before a terminal result is transport failure.
- Cancellation intent wins over a late normal stop signal once escalation begins.
- Provider errors and Pi RPC errors retain their original message and diagnostic category.

## 5. Profiles and policy

A profile contains:

- ACP agent name or explicit argv
- role: `read-only` or `writer`
- model and agent-specific session options
- system prompt append/replace controls where supported
- Pi tool allowlist or external-adapter allowed tools
- timeout and cancellation grace
- environment allowlist and overrides
- optional maximum retained output

The coordinator injects a worker contract into every prompt: no recursive orchestration, remain within assigned cwd and role, report evidence and residual risks, and do not commit/push or create/remove worktrees.

ACP permission requests default to denial. Writer profiles permit declared read/search operations and location-backed edits/writes only when every reported location resolves inside the assigned worktree; execute, delete, move, unknown, locationless, and out-of-worktree requests are denied. Tool identity is normalized from ACP name, raw input, and title fields because heterogeneous adapters report these differently. Codex writers on macOS launch inside `sandbox-exec`: file writes are denied by default and explicitly allowed only for the assigned worktree, provider state, and temporary directories; if the sandbox executable is unavailable, the writer cannot start. Pi's native tools execute in the Pi process, so Pi restrictions are enforced with startup `--tools`; no worker extension is loaded. Shell-capable Pi writers remain a documented trust boundary rather than a filesystem sandbox.

## 6. Writer isolation

`pi-strings` never creates or removes git worktrees implicitly. That is a state-changing git operation requiring explicit operator control. For a writer:

1. `cwd` must exist and be inside a git worktree.
2. `git rev-parse --path-format=absolute --git-common-dir` must differ from `git rev-parse --path-format=absolute --git-dir`, proving it is linked.
3. The resolved cwd must differ from the parent checkout.
4. No other live writer may own the same git directory or cwd.
5. Isolation validation is repeated before every writer turn.

Failure is `WRITER_ISOLATION_REQUIRED`; there is no shared-checkout fallback.

## 7. Persistence

State root: `${PI_AGENT_DIR:-~/.pi/agent}/pi-strings/`.

```text
state.json                    worker registry and bounded request results
state.json.lock/              live coordinator ownership lease
requests/<request-id>.ndjson  normalized complete event stream
acpx/sessions/*.json          acpx runtime session records
```

Rules:

- Directories are mode 0700; files are mode 0600.
- Version 0.1 uses one renewable exclusive lease for the entire state root. A second parent fails with `COORDINATOR_OWNED`; it cannot adopt or mutate individual workers.
- State updates use atomic replacement and are serialized in process.
- JSON is schema-validated. Corrupt state is surfaced as `STATE_CORRUPT`; it is never replaced silently with empty state.
- The coordinator is the only writer of coordinator state. The vendored adapter gets its own locked, atomic, private session map.
- Startup marks requests left running by the prior owner as failed with `PARENT_PROCESS_LOST`; active turns are never inferred complete after restart.

## 8. Pi adapter hardening

The vendored adapter preserves upstream event translation but changes the safety-critical seams:

- Current ACP SDK 1.3.0.
- Strict byte-buffered LF framing; U+2028 and U+2029 remain JSON string content.
- Every Pi RPC request has a deadline and optional AbortSignal.
- Spawn handshake failures are fatal, not best-effort.
- stderr is retained in a bounded ring and included in failures.
- Pending requests reject on timeout, abort, malformed protocol, stdin failure, or child exit.
- Cancellation sends Pi `abort`, waits, then terminates the process group with bounded escalation.
- Multiple sessions may coexist; adapter connection shutdown owns and disposes all of them.
- Session-map writes are locked, atomic, mode-private, and corruption is explicit.
- Notification failures are surfaced to the active turn instead of swallowed.

## 9. acpx boundary

Only the internal `AcpRuntimePort` imports `acpx/runtime`. The rest of the package depends on local handles, events, and terminal results. Version 0.13.0 is exact-pinned. An upgrade requires contract tests for session creation, event normalization, cancellation, reconnect, permission behavior, and state compatibility.

Known limitation: embedded runtime workers share the parent extension process lifetime. Persistent idle session records reconnect after restart; active turns and pending questions become `PARENT_PROCESS_LOST`/expired unless an adapter proves adoption. tmux does not change this and is not used as fake durability.

## 10. Observability

`list` and `result` expose worker/request status, timestamps, agent, cwd, role, session IDs, bounded output, and diagnostics. Raw ACP tool inputs/outputs are omitted by the runtime facade, but agent text can still contain sensitive data; operators must treat retained state as sensitive.

Optional tmux support may print a documented command that tails event/stderr logs in a named window. It cannot send input to workers and is never required for correctness.

## 11. Failure and recovery table

| Failure | Required behavior |
|---|---|
| Agent executable missing | Spawn fails with install/command diagnostic; no worker registered |
| Pi first request hangs | RPC deadline expires; child is disposed; spawn/turn fails |
| Provider error | Request terminal status is failed/provider with original message |
| ACP stream closes early | Failed/transport; never inferred complete |
| Parent exits mid-turn | On restart, request becomes failed/transport unless proven recoverable |
| Cancel ignored | Escalate after grace; terminal status remains cancelled |
| Corrupt state | Quarantine and stop with path; never reset silently |
| Worktree removed or reused | Block next writer turn with isolation error |
| Permission callback unavailable | Deny/fail according to explicit fail-closed policy |
| Output exceeds limit | Continue draining; spill complete events to disk; return bounded summary |

## 12. Source resources

- Pi extension API: installed Pi `docs/extensions.md`
- Pi RPC protocol: installed Pi `docs/rpc.md`
- Pi package format: installed Pi `docs/packages.md`
- acpx runtime contract: `acpx/runtime` and `openclaw/acpx` `src/runtime/public/contract.ts`
- ACP SDK: `@agentclientprotocol/sdk` 1.3.0
- Pi adapter provenance: `NOTICE.md` and `vendor/pi-acp/LICENSE`
- Agent operating procedures: `AGENT_GUIDE.md` and `skills/pi-strings/SKILL.md`
