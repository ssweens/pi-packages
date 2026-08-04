# pi-strings hybrid: lifecycle rigor + Amp distillation

## Regression: streamed tool updates falsely trigger STALLED
- [x] Preserve ACPX `toolCallId` during event normalization
- [x] Count each identified tool invocation once for stall and turn-budget policy
- [x] Add normalization and coordinator regression tests
- [x] Run typecheck, tests, build, and a real reloaded `op_*` smoke test

### Review
- Root cause: ACPX emits progressive `pending`/`in_progress`/`completed` updates for one invocation. The coordinator discarded `toolCallId`, then counted each update as a new identical call.
- Verification: `npm run typecheck`; `npm test` (101 tests, 87 passed, 14 opt-in skipped); live reloaded `op_spawn` → `op_send` → `op_wait` → `op_result` completed request `req_dade434c-751c-4944-bd4f-d553b9ea24ff`; worker closed successfully.

## Regression: parallel calls share provisional display text
- [x] Derive stable tool fingerprints from ACPX title and final input
- [x] Evaluate stalls only after identified calls complete
- [x] Cover legitimate parallel same-tool calls and true repeated calls
- [ ] Reload and repeat the monitored deep audit

### Review
- Tool normalization derives a fingerprint from ACPX `title` plus a SHA-256 digest of stable final `rawInput`; raw inputs do not cross into coordinator events or logs. Stall detection compares completed-call fingerprints while ignoring provisional updates.
- Direct workers persist their validated tool list in state and restore the exact list, including restricted writers; model and agent continuity are covered by restart regression tests.


## Permission layer cleanup
- [x] Remove provider-specific permission callbacks and custom policy logic
- [x] Route all roles through ACPX native `approve-reads`
- [x] Keep ACPX `nonInteractivePermissions: "deny"` for unpromptable mutation requests
- [x] Remove OpenCode-specific permission fixtures, config exceptions, and documentation

### Review
- ACPX permissions documentation and pinned runtime source reviewed.
- `approve-reads` auto-approves reads/searches; non-interactive writes follow ACPX's `deny` policy.
- Verification: `npm run typecheck`; `npm test` (109 tests, 95 passed, 14 opt-in skipped); `git diff --check`.

## Regression: native ACPX permission prompt deadlock
- [x] Pass only ACPX-native permission options so live Pi cannot block on an unanswered write prompt
- [x] Add a contract test proving native read approval and mutation denial settle the request
- [x] Re-run a reloaded live `op_*` native-write probe

### Review
- Root cause: ACPX `approve-reads` prompts for mutations whenever the host has a TTY; the Pi extension has no permission UI, so the prompt left the turn running until the coordinator deadline.
- Fix: pass ACPX-native `permissionPolicy`; read-only workers auto-approve read/search and default-deny other permission requests, while writers default-approve explicit mutations.
- Verification: vendored ACPX PR #468 source snapshot; `npm run typecheck`; `npm test` (110 tests, 96 passed, 14 opt-in skipped); `git diff --check`; fresh-process OpenCode native-write probe completed with no file created. Reloaded live probe `req_78273f80-dc6b-4b08-acff-6bd88683f0df` completed in 5.9s: native OpenCode `write` was explicitly rejected, the request terminalized, and the probe file was absent.

## Vendored ACPX PR #468
- [x] Vendor upstream ACPX source at commit `e91cc50439e7ed58845fca82e23c72dcaaf7fd8a`
- [x] Build the local runtime and declarations under `dist/acpx-runtime`
- [x] Point the production runtime and contract tests at the vendored build
- [x] Reload Pi and re-run the live native-write `op_*` probe

### Review
- The external `acpx` dependency is removed; `vendor/acpx/README.md` records provenance, license, and the release handoff.
- The runtime contract test uses `deny-all` plus a policy that auto-approves reads, proving manager forwarding rather than fallback permission-mode behavior.

## Goal
Make pi-strings a complete subagent product: keep the lifecycle core, add role-specialized distillation (Amp), loosen writer isolation (shared default, worktree opt-in), add production resilience (retry/fallback, telemetry), and harden the drain race.

## Scope (agreed: full hybrid, ignore Claude Code)

### 1. Drain hardening
- [x] Add async-arrival drain test (events arrive in a later macrotask than result) with clearOnClose=true
- [x] Make drain explicit: pump iterator to idle before closeStream, don't rely on single setImmediate
- [x] Fix external-terminal exit: when the deadline closes the stream, drainAttempt exits promptly instead of hanging on turn.result

### 2. Isolation loosening (shared default, worktree opt-in)
- [x] types.ts: add `IsolationMode = "shared" | "worktree"`; Profile.isolation
- [x] config.ts: parse isolation, default "shared" for writers
- [x] worktree.ts: add requireCwdUnowned (one live writer per canonical cwd) for shared mode
- [x] coordinator.ts spawn/send: branch on isolation; shared = cwd-ownership only, worktree = current strict checks
- [x] tests: two writers same cwd rejected; writer in parent cwd allowed (shared); worktree mode still strict
- [x] docs: update isolation contract (shared default, worktree opt-in, CoW-to-temp noted as future)

### 3. Role-specialized profiles + fixed output formats
- [x] types.ts: add `WorkerKind = "oracle" | "finder" | "worker" | "free"`; Profile.kind
- [x] roles.ts (NEW): per-kind contract preamble + acceptance contract
- [x] config.ts: parse kind; DEFAULTS add pi-oracle, pi-finder, keep pi-reviewer/pi-writer
- [x] coordinator.ts send: append role contract by kind via decoratePrompt
- [x] tests: role contract appears in prompt; kind validation

### 4. Turn budgets (coordinator-enforced)
- [x] types.ts: Profile.maxTurns?
- [x] coordinator.ts drain: count tool events; on exceed, cancel + terminalize as `failed` (code TURN_BUDGET_EXCEEDED)
- [x] tests: worker exceeding maxTurns is cancelled and failed

### 5. Retry / model fallback on transient provider failure
- [x] types.ts: Profile.fallbackModels?, Profile.maxAttempts?; RequestRecord.attemptModels, RequestRecord.attempts
- [x] runtime port: expose setConfigOption passthrough
- [x] coordinator.ts: attempt loop — on retryable `failed` + attempts remaining, setConfigOption(fallbackModel) then re-startTurn; total deadline across attempts; cancel stops the loop
- [x] Clear stale terminal signals between retry attempts
- [x] state-store schema: attemptModels, attempts (additive optional)
- [x] tests: retryable failure retries on fallback; non-retryable does not; deadline bounds total

### 6. Usage/cost telemetry
- [x] types.ts: NormalizedEvent usage on status; RuntimeTerminal.usage?; RequestRecord.usage?
- [x] runtime port: capture usage from status events (breakdown/cost), attach to wrapped turn.result
- [x] coordinator.ts: attach usage to request record; merge across attempts; surface in result/list
- [x] state-store schema: usage (additive optional)
- [x] tests: normalize extracts usage from status events; coordinator surfaces usage on request

### 7. Structured acceptance contracts
- [x] roles.ts: per-kind acceptance-report fenced-JSON contract
- [x] coordinator.ts: append acceptance contract to prompt by kind (free = none); parse fenced `acceptance-report` block from output → request.acceptance
- [x] tests: oracle/worker output with acceptance block is parsed; missing block → acceptance.parsed=false

### 8. Stall detection
- [x] coordinator.ts drain: track consecutive identical tool_call text; on threshold (4) cancel + terminalize as `failed` (code STALLED)
- [x] tests: worker repeating identical tool calls is cancelled

### 9. Skill + docs
- [x] SKILL.md: per-role playbooks, shared isolation note
- [x] AGENT_GUIDE.md: new profiles, shared isolation, retry behavior, acceptance contracts
- [x] ARCHITECTURE.md: update §2 (retry/telemetry/decoration), §4-5 (isolation, turn budget, stall), §8 (failure table)
- [x] TEST_COVERAGE.md: new gates and acceptance ledger rows
- [x] README.md: new profiles, isolation default, retry/telemetry
- [x] CHANGELOG.md: Unreleased entries

## Done when
- [x] `npm run typecheck` clean
- [x] `npm test` green (99 tests, 85 pass, 14 E2E-skipped, 0 fail)
- [x] `npm run build` clean
- [x] `npm pack --dry-run` clean (21 files)
- [x] No public action removed; existing tests updated for shared-default isolation

## Review notes
- `runRequest`/`drainAttempt` reviewed for: deadline cannot be overwritten by late terminal results; retry only for explicit `failure.retryable`; no retry on cancellation/policy/arbitrary failure; worker/request state reset between attempts; terminal signal handling across attempts; usage not double-counted; acceptance parsing only after final output; stream failure handling compatible with previous tests.
- `maxTurns` approximates turns by tool events (documented in ARCHITECTURE.md).
- Repeated-tool stall detection is conservative (threshold 4) and non-retryable.
- Public request ID is stable across retries; retries stay on the same persistent session.
- `requireIsolatedWriter` (worktree mode) is only called for explicit `isolation: "worktree"`, never for shared writers.

## Out of scope (deferred)
- CoW-to-temp-dir isolation (future option per user)
- acpx exec/compare/sessions history/prune surfacing
- pi-subagents is retired leftover work; not involved
