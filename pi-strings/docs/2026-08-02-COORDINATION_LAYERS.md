# Coordination capability layers

## Purpose

`pi-strings` uses evidence-backed coordination layers. The shipped baseline is intentionally a routing and lifecycle coordinator, not a general task graph or interactive messaging system. New behavior must preserve one active turn per worker, explicit terminal results, honest persistence, and parent authority.

## Reference boundary

The only production runtime is `AcpxRuntimePort` over exact-pinned `acpx/runtime`. ACPX owns process launch, persistent sessions, normalized events, cancellation primitives, permissions, mode controls, and close. The vendored Pi adapter is an ACP executable command override, not a second runtime.

ACPX's `steer` mode is not an in-flight delivery primitive in this version; it is treated as a normal prompt by the runtime. `pi-strings` therefore exposes no steer, question, or reply action. Portable continuation is an ordinary later `send` after terminal completion on the same persistent session.

## Layer 1: shipped baseline

- Named worker and request identity.
- One active turn per worker; independent workers may overlap.
- Spawn, ordinary send, fixed-snapshot wait, result, list, cancel, and close.
- Sequential same-session continuation only after terminal completion.
- Distinct completed, cancelled, timed_out, failed, and transport-failed outcomes.
- Coordinator-owned deadlines, bounded cancel/close cleanup, and failed-worker quarantine after timeout or cleanup failure.
- Atomic private state, strict schema validation, lease ownership, restart classification, and session provenance.
- Byte-bounded retained output plus private normalized event logs.
- Linked-worktree admission and writer ownership checks.
- ACPX policy routing: read-only `deny-all`, writer `approve-reads`, non-interactive `deny`.

### Promotion criteria for baseline changes

A change needs deterministic tests for state transitions, late-event behavior, action serialization, cleanup bounds, and restart consequences. Provider-specific behavior must not be presented as a universal ACP guarantee. Existing behavior remains complete only when terminal status and authority data are preserved across failure paths.

## Layer 2: deliberately excluded controls

The following are not current product capabilities:

- in-flight steering or message injection;
- child-to-parent questions, elicitation, or reply records;
- a second prompt on an active session;
- autonomous task boards, DAGs, mailboxes, or recursive delegation;
- provider-native sandbox claims beyond the layer that actually enforces them.

These exclusions are safety boundaries, not hidden capability gaps. If a future protocol provides a portable control, it must first prove one-turn serialization, correlation, terminal races, cancellation, and parent-loss behavior across more than one adapter.

## Layer 3: possible future work

Potential future work includes standard ACP elicitation if ACPX exposes it portably, richer progress/usage telemetry, and resumable stopped work. None is represented in the current public schema or state file. A future addition must not revive the removed question schema or silently migrate obsolete authority data.

## Current implementation evidence

| Capability | Evidence |
|---|---|
| Single-flight workers and concurrency | `tests/coordinator.test.ts` |
| Sequential continuation and reconnect | coordinator and `tests/acpx-contract.test.ts` |
| Deadline quarantine and late-result gating | coordinator deadline regression |
| Terminal result against non-ending stream | coordinator terminal-stream regression |
| Cooperative cancel and bounded escalation | coordinator cancellation regressions; ACPX fixture |
| Close failure and retry | coordinator close regression |
| Shutdown action-tail ordering | coordinator shutdown regression |
| Strict state corruption handling | `tests/state-store.test.ts` legacy waiting/questions regressions |
| Permission routing | `tests/extension.test.ts` and ACPX contract configuration |
| Pi through common runtime | `tests/pi-acp-runtime.test.ts` |

## Acceptance ledger

The current acceptance ledger is maintained in [`../TEST_COVERAGE.md`](../TEST_COVERAGE.md). Retired steering and question cases are marked not applicable there; no obsolete capability is counted as covered.
