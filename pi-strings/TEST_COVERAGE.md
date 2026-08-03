# Test coverage

## Current gates

| Area | Evidence |
|---|---|
| Tool/lifecycle | `tests/coordinator.test.ts` covers spawn, one active turn per worker, wait snapshots, result, list, cancel, close, worker-name reuse, timeout quarantine, close retry, and shutdown action-tail ordering. |
| Terminal semantics | Coordinator tests cover completed, cancelled, timed-out, provider-failed, transport-failed, late-result gating, terminal-result closure of a non-ending event iterator, and external-terminal exit when the deadline closes the stream. |
| Role specialization | `tests/roles.test.ts` covers role contracts, acceptance contracts, and acceptance-report parsing. Coordinator tests cover per-kind prompt decoration and acceptance-report extraction from output. |
| Retry/fallback | Coordinator tests cover retryable failure retry on fallback model, non-retryable exclusion, whole-window deadline bounding, attempt count/model provenance, and usage merging across attempts. |
| Stall/turn budget | Coordinator tests cover repeated-identical-tool stall cancellation and max-turn budget cancellation. |
| Shared/worktree isolation | `tests/worktree.test.ts` covers `requireCwdUnowned` (shared default) and `requireWriterUnowned` (worktree opt-in). Coordinator tests cover shared writer in parent checkout, duplicate cwd rejection, and worktree admission. |
| Persistence | `tests/state-store.test.ts` covers atomic private state, schema corruption, strict rejection of legacy `waiting` and `questions`, lease ownership, and usage/acceptance/attempt round-trip. |
| Runtime contract | `tests/acpx-contract.test.ts` covers pinned ACPX session continuity/reconnect, cancellation, lack of native steering, and `normalize` usage extraction from status events. `tests/pi-acp-runtime.test.ts` covers Pi through `AcpxRuntimePort` and session continuity. |
| Policy | `tests/extension.test.ts` covers read-only `deny-all` and writer `approve-reads`; production config uses ACPX non-interactive `deny`. |
| Integration | `tests/integration/*.test.ts` remains prerequisite-gated for configured Pi/Codex/OpenCode executables and models. Skips are reported explicitly. |

## Assertion-level acceptance ledger

This ledger describes the current implementation, not the retired interaction design.

| Case | Current evidence | Status | Boundary |
|---:|---|---|---|
| 1 | Wait-any returns first terminal request; later wait-all returns the fixed selection. | Proven | Deterministic coordinator test |
| 2 | Mixed completed/provider-failed/timed-out requests retain distinct statuses. | Proven | Deterministic coordinator test |
| 3 | Wait-all snapshot excludes a turn started later. | Proven | Deterministic coordinator test |
| 4 | Running result exposes progress; output is byte-bounded while event log remains complete. | Proven | Deterministic coordinator tests |
| 5 | Failure in one worker does not cancel a healthy sibling. | Proven | Deterministic coordinator test |
| 6 | Sequential sends use distinct requests and preserve the worker session. | Proven | Deterministic coordinator and ACPX fixture tests |
| 7 | Idle session reconnect preserves session identity after coordinator restart. | Proven | Deterministic coordinator and ACPX fixture tests |
| 8 | Parent-loss recovery marks interrupted work failed rather than successful. | Proven | Coordinator restart/process tests |
| 9 | Cooperative cancel and bounded escalation remain terminally cancelled. | Proven | Deterministic coordinator and ACPX fixture tests |
| 10 | Deadline terminalizes as `timed_out`, cleans up, and quarantines the worker; close can replace it. | Proven | Deterministic coordinator test |
| 11 | Cancel-close-reassign creates a new request attempt and lineage. | Proven | Deterministic coordinator/integration tests |
| 12 | Shared writer isolation enforces one live writer per canonical cwd; worktree mode rechecks ownership. | Proven | Worktree/coordinator tests |
| 13 | In-flight steering is not a product action; no second prompt is submitted. | Not applicable | Retired surface; sequential `send` is the portable continuation |
| 14 | Capability-negotiated steering delivery. | Not applicable | Retired surface; no production steering port |
| 15 | Steering terminal race. | Not applicable | Retired surface; no production steering port |
| 16 | Process framing, stale lease, and restart classification. | Proven | Existing adapter/process tests; hosted execution is opt-in |
| 17 | Role permission routing is exact: read-only `deny-all`, writer `approve-reads`, non-interactive `deny`. | Proven | Extension and ACPX contract tests; provider-native boundaries are not generalized |
| 18 | Resume rejects agent, role, profile, or cwd mismatch and accepts matching provenance. | Proven | Coordinator resume tests |
| 19 | Child question/reply interaction. | Not applicable | Questions/replies are removed from the product and state schema |
| 20 | Pending-question expiry after parent loss. | Not applicable | Legacy question state is rejected as `STATE_CORRUPT` |

## Explicit boundaries

1. Run `npm run check` for the package typecheck, build, and default test suite. Run `npm run test:integration` for prerequisite reporting; provider/model gates are not assumed available.
2. ACPX is the only production runtime. The port passes timeout `0`; coordinator deadlines own `timed_out` transitions and worker quarantine.
3. ACPX permission policy is authoritative at the configured layer. Profile tool lists, cwd, and provider-native sandbox behavior are not universal guarantees.
4. Event results are authoritative after terminal completion; stream loss before terminal remains transport failure.
5. State version 1 is intentionally strict and does not accept obsolete waiting/question authority data.
