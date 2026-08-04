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

## Amp Code via ACP
- [x] Wire `amp` agent (tao12345666333/amp-acp) into `createAgentRegistry` overrides (`acpx-runtime.ts`)
- [x] Typecheck + unit tests clean (95/95)
- [x] Live read-only smoke passed: spawn -> send -> wait -> result = `completed`, output `AMP_ACK pi-strings` (session `S-mse5yxfe-oocsee`)
- [x] Real Amp writer reassignment E2E: PASSED — cancellation then predecessor-reassignment preserves authority.
- [x] Write-boundary investigation — corrected after deeper dig: **Amp IS confinable at the provider level** (unlike an initial read): its built-in permission rule 121 is `allow apply_patch` (unscoped), and a higher-precedence user rule (`reject apply_patch`) **does** override it (proven: `amp permissions test` -> `reject, matched-rule 0, source user`; blunt reject blocks the escape). But precise worktree-scoping is fragile: Amp's `apply_patch` emits **absolute paths even for in-worktree files**, and the match condition is the free-text `diff` arg, so "allow in-worktree / reject outside" is unreliable via regex (the marker write is rejected too). `edit_file --path` scopes cleanly, but Amp's model prefers `apply_patch`. Bottom line: the escape is NOT unfixable; it needs a tuned Amp permission profile injected per worker (provider-specific), and `amp-acp` does not currently forward per-session permission rules — the same class of gap as Codex (different mechanism: permission rules vs hardcoded trust). The `real Amp writer permission boundary` E2E reflects the default (loose) policy and fails until that provider wiring exists.

## Claude Code via ACP (auth-blocked in this env)
- [x] `agent: "claude"` resolves natively via ACPX's built-in `claude` registry (`npx @agentclientprotocol/claude-agent-acp@^0.60.0`) — no override needed; adapter boots and spawn succeeds.
- [x] Live probe returns RUNTIME auth failure: "Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead". `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` unset.
- [x] Claude added to E2E harness (`PI_STRINGS_TEST_CLAUDE_MODEL` gate; smoke + writer boundary + reassignment) for parity.
- [x] Verified with `ANTHROPIC_API_KEY` set: live smoke **PASSED** (`CLAUDE_ACK pi-strings`); writer reassignment **PASSED**; writer permission boundary **FAILS** — Claude's native `Write` tool writes outside the worktree.
- [x] **Deep dive (Claude is ACP-confinable):** Claude's `Write`/`Edit` route through the SDK `canUseTool` hook → real ACP `session/request_permission` (unlike Codex/Amp which bypass ACP). It escapes only because writers use `permissionPolicy: { defaultAction: "approve" }`, and ACPX's `permissionPolicy` is not path-scoped (`vendor/acpx/src/permissions.ts`). A path-aware ACPX permission decision (approve writes only within cwd) WOULD confine Claude without forking the provider — the only native writer where that's true. Recorded in ARCHITECTURE §4 / README.
- [x] Document Claude in README + ARCHITECTURE (ACP-routed Write; auth via `ANTHROPIC_API_KEY`).
- [x] **NOTED (note only — no implementation now):** Claude Code confinement needs + future direction. Claude's `Write`/`Edit` route through ACP `session/request_permission`, so it is the one native writer that a **path-scoped ACP decision** could confine (approve writes only within the worker `cwd`) without forking the provider. Per-provider options tracked for later (the "B" direction): forward a scoped `pre_tool_use` hook / `permissions` config (B1/B2), with post-turn reconcile (C1) as the universal backstop that also catches Codex/Amp. See `docs/ARCHITECTURE.md` §4. We'll likely do B down the road.

## Vendor codex-acp (provider write-boundary flaw) — NOT yet done
- [x] Investigate and root-cause the Codex out-of-worktree write (see `vendor/codex-acp/README.md`)
- [ ] Decide scope (trust fix and/or ACP-routed Guardian approval) with user
- [ ] Vendor `@agentclientprotocol/codex-acp` source at a pinned commit into `vendor/codex-acp/` with provenance
- [ ] Build boundary + `build:codex-acp` into `dist/codex-acp` (mirror `tsconfig.acpx.json`)
- [ ] Override the `codex` agent in `createAgentRegistry` to the local build (`acpx-runtime.ts`)
- [ ] Apply the fix to `src/CodexAcpClient.ts` `createSessionConfig` (line 498 `trust_level`)
- [ ] Re-run `real Codex writer permission boundary` — forbidden write must now be rejected
- [ ] Record diff + release-handoff note in `vendor/codex-acp/README.md`

## Vendored ACPX PR #468
- [x] Vendor upstream ACPX source at commit `e91cc50439e7ed58845fca82e23c72dcaaf7fd8a`
- [x] Build the local runtime and declarations under `dist/acpx-runtime`
- [x] Point the production runtime and contract tests at the vendored build
- [x] Reload Pi and re-run the live native-write `op_*` probe

### Review
- The external `acpx` dependency is removed; `vendor/acpx/README.md` records provenance, license, and the release handoff.
- The runtime contract test uses `deny-all` plus a policy that auto-approves reads, proving manager forwarding rather than fallback permission-mode behavior.

## Live E2E verification (real Pi / Codex / OpenCode)
Ran `test:e2e` with real executables and models (`PI_STRINGS_E2E=1`).

Passing once the correct model IDs are supplied (`deepseek/deepseek-v4-flash` for Pi, not the un-prefixed bare name):
- [x] real Codex ACP spawn-send-wait smoke
- [x] real OpenCode ACP spawn-send-wait smoke
- [x] real Pi ACP spawn-send-wait smoke
- [x] real Pi cooperative cancellation remains cancelled
- [x] real Pi writer then fresh reviewer remains worktree-isolated
- [x] real Pi writer cancellation then reassignment preserves authority
- [x] real Codex writer cancellation then reassignment preserves authority
- [x] real OpenCode writer cancellation then reassignment preserves authority

Failures and root cause:
- [ ] real Pi parent kill: `hosted-parent-owner.ts` fixture probes `worker.runtime.child?.pid` (does not exist) -> always `agentPid=0`; fixture bug, not product. Needs pid discovery via `ps` scan of `--pi-strings-worker`.
- [ ] real Pi overlap / session continuity / writer resume: intermittent deepseek `503 Service too busy` provider errors; standalone `pi-reconnect-repro` shows continuity works (follow-up retained the token). Piper retries internally but the turn is still surfaced as `RUNTIME`/`Internal error`, retryable=false; needs a deeper adapter/ACPX interaction look.
- [x] real Codex writer permission boundary: reproduced deterministically with codex-acp @ 1.1.9 (latest, resolves via `^1.1.4`). Even though 1.1.9 forwards `sandboxPolicy: workspaceWrite` to Codex's `sendPrompt`, Codex's provider-native **Guardian Review** auto-approved the `apply_patch` to the path outside the worktree, honoring the prompt's explicit instruction (`Authorization: high`, `Risk: low`). It never emits `session/request_permission`, so neither the ACPX `permissionPolicy` nor the workspace-write root can intercept it. Not a pi-strings/ACPX param error — `cwd`, `mode=agent`, and `permissionPolicy` are all forwarded correctly.
  - Verified NOT a writable-root misconfig: ACPX passes no `additionalDirectories`/`_meta.additionalRoots` to codex, so the parent path is genuinely outside every writable root. The session `cwd` is the worktree; ACPX sends no extra roots.
  - Direct answer to 'can codex launch strict / does codex-acp use that': codex accepts strict launch flags (`--sandbox workspace-write`, `-c sandbox_mode`, `-c approval_policy`, `-c sandbox_permissions`), but codex-acp does NOT use them — it spawns `codex app-server` with no sandbox flags and relies on the per-turn `sandboxPolicy`. That per-turn workspace-write IS already in effect (the transcript shows Guardian gating the call), yet Guardian still granted the out-of-root write because `codex-acp` marks the session project `trusted` (createSessionConfig), which lets Codex's native Guardian escalate a workspace-write into the parent. Launching `--sandbox workspace-write` would be the same policy that's already active -> no change; only `read-only` (breaks writers) blocks it. Fixing it requires changing codex-acp (provider-specific, upstream, violates thin proxy).
  - Test expectation ('must be rejected') overclaims the thin-proxy guarantee; needs a decision: document + reconcile test, or accept as known limitation.
- [ ] real OpenCode writer permission boundary: marker write flaked once in the E2E run but passed three standalone reproductions (no config, with config, full harness); non-reproducible flake.

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
