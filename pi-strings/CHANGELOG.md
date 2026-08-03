# Changelog

## Unreleased

- Split the single `strings` action dispatcher into seven strict-schema `op_*` tools (`op_spawn`, `op_send`, `op_wait`, `op_result`, `op_list`, `op_cancel`, `op_close`). `timeoutMs` is split into `requestTimeoutMs` (op_send, default profile `timeoutMs`) and `waitTimeoutMs` (op_wait, default 300000); op_list gains an optional `names` projection; op_send returns the appended prompt decoration as `decoratedPromptSuffix`.

- Route every production worker, including Pi, through the exact-pinned `acpx/runtime` `AcpxRuntimePort`; retain only the vendored Pi adapter command override.
- Remove obsolete steering, question, and reply product paths. Persistent-session continuation is an ordinary later `send` after terminal completion, with one active turn per worker.
- Make state schema strict: legacy `waiting` statuses and `questions` fields now fail as `STATE_CORRUPT` instead of being converted or discarded.
- Move turn deadlines to the coordinator. ACPX receives timeout `0`; coordinator timeouts terminalize requests as `timed_out`, gate late results, clean up within bounded grace, and quarantine the worker until close/replacement.
- Make terminal results authoritative while safely closing event streams, retain transport failure for stream loss before terminal completion, and record close failures as failed workers rather than leaving them `closing`.
- Prevent queued mutating actions from creating workers after shutdown begins; update deterministic lifecycle and policy coverage.
- Use ACPX permission policy `deny-all` for read-only profiles, `approve-reads` for writers, and non-interactive `deny`.
- **Shared writer checkout is now the default.** One live writer per canonical cwd is enforced; a second writer in the same cwd is rejected. Worktree isolation (`isolation: "worktree"`) is opt-in compatibility mode, not a requirement. Future stronger isolation may use CoW temp copies.
- **Add role specialization** via `kind` (oracle, finder, worker, free). The coordinator decorates prompts with per-kind role and acceptance contracts. Oracle, finder, and worker kinds produce fenced `acceptance-report` blocks parsed onto the request.
- **Add bounded retry and model fallback.** Profiles may configure `fallbackModels` and `maxAttempts`. Retryable provider failures retry on the same persistent session with the fallback model, preserving the public request ID. Non-retryable failures, cancellations, and policy violations are never retried.
- **Add usage and cost telemetry.** Terminal results carry token breakdown and cost from ACP `usage_update` events, merged across retry attempts.
- **Add turn budget and stall detection.** `maxTurns` approximates a turn budget by counting tool-call events. Repeated identical tool calls trigger a conservative stall cancellation. Both are non-retryable policy violations.
- **Fix deadline drain hardening.** When the coordinator deadline closes the stream externally, `drainAttempt` now exits promptly instead of hanging on a `turn.result` that will never arrive. Stale terminal signals are cleared between retry attempts.

## 0.1.0

- Add a Pi-native multi-agent coordinator over the public `acpx/runtime` API.
- Add named, persistent workers with explicit turn IDs, reusable names after close, and lifecycle controls.
- Vendor and harden the Pi ACP adapter for bounded RPC, strict framing, durable private state, and honest failure reporting.
- Enforce read-only versus writer worker isolation at startup and route role-correct ACPX permission modes.
- Add an operator guide and Pi skill with orchestration recipes and recovery procedures.
