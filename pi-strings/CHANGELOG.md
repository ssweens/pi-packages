# Changelog

## Unreleased

- Split the single `strings` action dispatcher into eight strict-schema `op_*` tools (`op_spawn`, `op_status`, `op_send`, `op_wait`, `op_result`, `op_list`, `op_cancel`, `op_close`). `op_spawn` can directly create an ACP worker (`agent` defaults to `pi`) without a profile; profiles remain optional policy bundles. `op_status` exposes ACPX model discovery, and `op_send` can select a model before a turn while retaining `requestedModel` provenance. `timeoutMs` is split into `requestTimeoutMs` (op_send, default profile `timeoutMs`) and `waitTimeoutMs` (op_wait, default 300000); op_list gains an optional `names` projection; op_send returns the appended prompt decoration as `decoratedPromptSuffix`.

- Route every production worker, including Pi, through the vendored ACPX `0.13.0` runtime snapshot at upstream PR #468; retain only the vendored Pi adapter command override.
- Remove obsolete steering, question, and reply product paths. Persistent-session continuation is an ordinary later `send` after terminal completion, with one active turn per worker.
- Make state schema strict: legacy `waiting` statuses and `questions` fields now fail as `STATE_CORRUPT` instead of being converted or discarded.
- Move turn deadlines to the coordinator. ACPX receives timeout `0`; coordinator timeouts terminalize requests as `timed_out`, gate late results, clean up within bounded grace, and quarantine the worker until close/replacement.
- Make terminal results authoritative while safely closing event streams, retain transport failure for stream loss before terminal completion, and record close failures as failed workers rather than leaving them `closing`.
- Prevent queued mutating actions from creating workers after shutdown begins; update deterministic lifecycle and policy coverage.
- Use ACPX-native permission routing for every role: `approve-reads` remains the base mode, read-only workers auto-approve reads/searches and deny other requests through ACPX's native policy, and writers auto-approve explicit mutations without waiting on an unanswered prompt. Remove provider-specific permission callbacks and custom matching logic from pi-strings.
- Fix live-turn deadlocks caused by ACPX's interactive mutation prompt: native permission requests now settle in Pi's noninteractive worker runtime, with deterministic ACPX contract coverage for read approval and mutation denial. Vendor the upstream PR #468 runtime forwarding change until it is released.
- Fix retry provenance when no primary model is selected: attempt one is not attributed to `fallbackModels[0]`, and retry indexing selects fallback zero on attempt two.
- **Shared writer checkout is now the default.** One live writer per canonical cwd is enforced; a second writer in the same cwd is rejected. Worktree isolation (`isolation: "worktree"`) is opt-in compatibility mode, not a requirement. Future stronger isolation may use CoW temp copies.
- **Add role specialization** via `kind` (oracle, finder, worker, free). The coordinator decorates prompts with per-kind role and acceptance contracts. Oracle, finder, and worker kinds produce fenced `acceptance-report` blocks parsed onto the request.
- **Add bounded retry and model fallback.** Profiles may configure `fallbackModels` and `maxAttempts`. Retryable provider failures retry on the same persistent session with the fallback model, preserving the public request ID. Non-retryable failures, cancellations, and policy violations are never retried.
- **Add first-class model control.** `op_status` reads `currentModelId` and `availableModelIds` from ACPX `getStatus`; spawn/send model requests validate discovery and selection explicitly, and request records retain `requestedModel` provenance. Unsupported or unavailable model choices never silently fall back.
- **Add usage and cost telemetry.** Terminal results carry token breakdown and cost from ACP `usage_update` events, merged across retry attempts.
- **Add turn budget and stall detection.** `maxTurns` approximates a turn budget by counting distinct tool calls. Repeated identical completed calls trigger a conservative stall cancellation using ACPX tool identity and stable final input; provisional parallel updates are not compared. ACPX streaming updates for one `toolCallId` count once, preventing false `STALLED` failures. Both policy violations are non-retryable.
- **Preserve direct worker policy across restart.** Direct workers persist their validated tools and creation-time model, restoring the exact effective policy rather than broadening to defaults.
- **Fix deadline drain hardening.** When the coordinator deadline closes the stream externally, `drainAttempt` now exits promptly instead of hanging on a `turn.result` that will never arrive. Stale terminal signals are cleared between retry attempts.

## 0.1.0

- Add a Pi-native multi-agent coordinator over the public `acpx/runtime` API.
- Add named, persistent workers with explicit turn IDs, reusable names after close, and lifecycle controls.
- Vendor and harden the Pi ACP adapter for bounded RPC, strict framing, durable private state, and honest failure reporting.
- Enforce read-only versus writer worker isolation at startup and route role-correct ACPX permission modes.
- Add an operator guide and Pi skill with orchestration recipes and recovery procedures.
