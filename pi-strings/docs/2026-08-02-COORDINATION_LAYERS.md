# Coordination capability layers

## Purpose

`pi-strings` ships subagent coordination as a sequence of evidence-backed capability layers. The first layer contains coordination practices shared by mature tools. Later layers add broadly adopted, emerging, and experimental behavior. A capability moves inward only after executable tests prove its coordination value without weakening earlier invariants.

This is neither a permanently narrow MVP nor a commitment to copy every feature from another coordinator. Complexity must earn its place through a concrete coordination outcome.

## Evidence sources

The layers were derived from these implementations:

- Grok Build: background task identity, wait-any/all, cancellation, progress, resume validation, and isolation (`../../grok-build/crates/common/xai-tool-types/src/task.rs`, `../../grok-build/docs/20-background-tasks.md`).
- Claude Code: named workers, task ownership, messaging, continuation, shutdown, and worktree behavior (`../../../scratch/claude-code-reverse/extracted/strings-2.1.198.txt`, `../../../scratch/claude-code-reverse/sdk-tools.d.ts`).
- pi-subagents: acknowledged Pi steering, snapshot waits, lifecycle recovery, chains, checkpoints, and supervisor messaging (`~/.pi/agent/npm/node_modules/pi-subagents/src/runs/`). It is a reference, not the architecture to reproduce wholesale.
- ACP SDK and acpx 0.13.0: portable session, prompt, event, result, cancellation, and resume behavior. ACP does not define a universal in-flight message primitive; acpx 0.13.0 accepts a `steer` mode in its type surface but executes it as a normal prompt.
- Current `pi-strings`: worker/request identity, concurrency, terminal states, cancellation escalation, event retention, persistence, Pi policy, and writer isolation.

## Protocol-neutral contract

These requirements belong to the coordinator regardless of adapter:

1. Worker, session, task, and request identities are not conflated.
2. A worker has at most one active request; independent workers can overlap.
3. Wait-one, wait-any, and wait-all operate on a fixed initial snapshot.
4. Completion, cancellation, timeout, provider failure, and transport failure remain distinct.
5. One worker's failure does not erase or cancel healthy siblings unless the parent explicitly requests fail-fast behavior.
6. Cancellation is cooperative first, bounded escalation second, and never becomes success after cancellation intent wins.
7. Progress is inspectable before terminal completion and retained output is bounded.
8. Persistent sessions support sequential follow-up; restart behavior never invents completion.
9. Policy and worktree isolation are enforced below the prompt layer where possible.
10. Unsupported capabilities fail before starting adapter work.
11. The parent remains the authoritative synthesizer and integration decision-maker.

Adapter-specific behavior must be capability-negotiated:

- true in-flight steering or message injection
- session resume and reconnect semantics
- permission enforcement
- model/configuration controls
- activity, usage, and tool telemetry
- child-to-parent questions
- survival of active work after parent exit

## Layer 1: universal coordination baseline

### Capabilities

1. Stable worker, session, and request identity.
2. Single-flight execution per worker and real concurrency across workers.
3. Wait-one, wait-any, and wait-all with bounded timeout and snapshot semantics.
4. Explicit immutable terminal outcomes.
5. Isolation of partial failures.
6. Cooperative cancellation with bounded escalation.
7. Running progress visible before completion.
8. Persistent sequential follow-up on the same worker/session.
9. Honest parent-loss classification on restart.
10. Enforced read-only workers and isolated-worktree writers.
11. Parent-composed parallel research, independent review, writer-to-reviewer, and cancel-to-reassign flows.
12. Flat or strictly bounded delegation.
13. Explicit rejection of steering on adapters without proven in-flight delivery.

### Why this is foundational

Identity, concurrency, synchronization, cancellation, observability, persistence, and failure isolation recur across Grok Build, Claude Code, pi-subagents, and ACP-based systems. They form useful coordination without requiring a workflow engine, team hierarchy, mailbox, or DAG.

### Promotion criteria

Layer 1 is releasable when:

- all deterministic Layer 1 tests pass without timing sleeps;
- real Pi tests prove overlap, progress, cancellation, session continuity, and restart behavior;
- at least one external writer adapter passes the isolated writer flow;
- integration prerequisites produce explicit skips rather than false passes;
- unsupported capabilities start no adapter operation;
- test assertions use protocol state, filesystem markers, and process identity rather than prose quality.

## Layer 2: broadly adopted advanced control

### Capabilities

1. Capability-negotiated, acknowledged in-flight steering.
2. Explicit completed-session resume with provenance validation.
3. Stronger idle-session reconnect and resumable stopped-work recovery.
4. Rich normalized activity, progress, usage, and status projection.
5. First-completion wakeups or completion notifications.
6. Cancel-and-reassign with explicit attempt lineage.

### Why this is the next layer

Addressable steering and continuation appear in mature Pi and Claude implementations, while resume and richer progress appear in Grok Build. Their exact transport differs, so they require the Layer 1 identity and lifecycle foundation plus adapter capability negotiation.

### Promotion criteria

- Runtime capabilities are explicit and versioned.
- Steering returns a correlated `delivered`, `failed`, or `terminal-race` acknowledgement.
- Steering never creates a second active prompt/client for the session.
- Broad steering claims require two adapters with the same observable semantics.
- Resume rejects agent, role, profile, cwd, or source-session mismatch.
- Reconnect preserves identity without translating unknown work into success.

acpx 0.13.0 steering must remain disabled because its implementation does not branch on turn mode.

## Layer 3: emerging coordination practices

### Capabilities

1. Correlated child-to-parent questions.
2. Replies scoped to the exact worker and request.
3. Visible pause/detach while awaiting a decision, followed by same-request continuation.
4. Structured input/output contracts and optional review evidence gates.
5. Checkpointed pause/resume when the adapter can prove it.

### Why this is emerging

Supervisor questions and named messaging exist in pi-subagents and Claude Code, but are not universal in Grok Build or ACP. They add value for ambiguous long-running work but create deadlock, authority, and recovery risks.

### Promotion criteria

- Questions carry worker ID, request ID, expiry, and exactly-once reply correlation.
- Awaiting a reply has a visible non-running state.
- Parent loss explicitly expires or preserves the question.
- Messages cannot grant permissions or override user authority.
- Pi and one heterogeneous adapter pass real question/reply/resume tests.

## Layer 4: experimental workflows

Candidates:

- shared task boards, claiming, and dependency graphs;
- dynamic fan-out and DAG execution;
- best-of-N tournaments;
- automated reviewer/fixer loops;
- peer reassignment;
- scope watchdogs;
- active-turn adoption across coordinator processes.

These are useful in some systems but are not a universal coordination baseline. Promote one only after an experiment demonstrates a measurable outcome such as better defect detection, lower elapsed time, or recoverable long-running work without weakening earlier invariants.

## Acceptance-test harness

### Deterministic runtime

Use a pushable event queue, deferred terminal results, a fake monotonic clock, and recorded `startTurn`, `cancel`, and `close` calls. Do not use wall-clock sleeps to establish ordering.

### Adapter integration

Run real `acpx/runtime` against deterministic ACP fixture executables and fake Pi RPC processes. This verifies the boundary without model variability.

### Real-adapter end-to-end tests

Make these opt-in and prerequisite-gated. Assert marker files, session IDs, process state, worktree state, and structured terminal results. Configure models through:

- `PI_STRINGS_TEST_PI_MODEL`
- `PI_STRINGS_TEST_CODEX_MODEL`
- `PI_STRINGS_TEST_CLAUDE_MODEL`
- `PI_STRINGS_TEST_OPENCODE_MODEL`

Use OpenCode free models by default when available; do not use Gemini.

## Layer 1 acceptance cases

### 1. `wait_any_returns_first_without_cancelling_siblings`

- **Setup:** Spawn A and B; send one request to each.
- **Actions:** Start `wait` over A/B with `mode: "any"`; complete B first.
- **Assertions:** Wait returns B; A remains running and was not cancelled; a later wait-all returns both.
- **Covers:** accidental wait-all, wrong winner, sibling cancellation.
- **Level:** deterministic runtime.

### 2. `wait_all_returns_mixed_terminal_results`

- **Setup:** Run A, B, and C.
- **Actions:** Complete A, provider-fail B, and time out C in controlled order.
- **Assertions:** All IDs return with distinct statuses; the aggregate is not represented as success.
- **Covers:** partial-failure collapse, lost result, accidental fail-fast.
- **Level:** deterministic runtime.

### 3. `wait_snapshot_excludes_later_turns`

- **Setup:** Begin wait-all on A/B.
- **Actions:** Start C after the wait snapshot is captured; settle A/B.
- **Assertions:** Wait returns A/B only; C remains independent.
- **Covers:** moving-target waits and starvation.
- **Level:** deterministic runtime.

### 4. `running_result_exposes_progress_before_terminal`

- **Setup:** Start a request whose terminal promise remains unresolved.
- **Actions:** Push text, status, and tool events; call `result`.
- **Assertions:** Status is still running; output includes emitted progress; event log is private and complete; retained output remains bounded.
- **Covers:** completion-only visibility, drain lag, false terminal inference.
- **Level:** deterministic runtime with pushable events.

### 5. `parallel_partial_failure_preserves_healthy_worker`

- **Setup:** Run A and B concurrently.
- **Actions:** Fail A's event stream; continue and complete B.
- **Assertions:** A is transport-failed; B completes; B is never cancelled or closed.
- **Covers:** shared failure domains and sibling teardown.
- **Level:** deterministic runtime.

### 6. `worker_session_identity_survives_sequential_turns`

- **Setup:** Spawn A and record its session identity.
- **Actions:** Send two sequential prompts; the first establishes a nonce and the second retrieves it.
- **Assertions:** Request IDs differ; session identity is unchanged; context survives.
- **Covers:** new session per request and request/session conflation.
- **Level:** ACP fixture integration, then real Pi.

### 7. `idle_worker_reconnects_after_coordinator_restart`

- **Setup:** Complete one turn and shut down the coordinator cleanly.
- **Actions:** Start another coordinator over the same state and send a follow-up.
- **Assertions:** Session identity and context remain; no duplicate worker appears.
- **Covers:** handle deserialization and accidental fresh sessions.
- **Level:** ACP integration and real Pi.

### 8. `lost_active_turn_is_never_completed_after_restart`

- **Setup:** Persist partial progress for an active request.
- **Actions:** Simulate parent loss and restart.
- **Assertions:** Request is failed with `PARENT_PROCESS_LOST`; partial evidence remains; no completion is invented.
- **Covers:** false success and lost partial evidence.
- **Level:** deterministic runtime; later real-process E2E.

### 9. `real_pi_workers_overlap`

- **Setup:** Spawn two real Pi reviewers that wait on a fixture barrier.
- **Actions:** Start both, confirm both reached the barrier, then release it.
- **Assertions:** Both were active simultaneously; identities are unique; wait-all returns both completed.
- **Covers:** serialized pseudo-parallelism and session collisions.
- **Level:** real Pi with an inexpensive configured model.

### 10. `cancel_cooperative_and_escalated_are_terminally_cancelled`

- **Setup:** One cooperative fixture and one cancel-ignoring fixture.
- **Actions:** Cancel each.
- **Assertions:** Cooperative cancellation does not escalate; ignored cancellation closes after grace; both remain cancelled.
- **Covers:** late completion winning, hanging cancellation, cleanup reclassification.
- **Level:** ACP fixture; repeat cooperative path with real Pi.

### 11. `cancel_then_reassign_preserves_authority`

- **Setup:** Start assignment on A.
- **Actions:** Cancel and close A; start B with remaining work and retained evidence.
- **Assertions:** A cannot produce accepted late mutations; B has a new request/session; attempt lineage identifies reassignment.
- **Covers:** zombie writers, hidden continuation, identity reuse.
- **Level:** deterministic runtime, then writer integration.

### 12. `writer_then_fresh_reviewer_isolated_flow`

- **Setup:** Use an operator-created linked worktree.
- **Actions:** Writer changes a marker; a fresh read-only reviewer inspects it.
- **Assertions:** Parent checkout is unchanged; worktree changed; reviewer lacks mutation tools; parent receives both results and retains integration authority.
- **Covers:** shared-checkout writes, reviewer mutation, trusting summaries instead of disk.
- **Level:** real Pi writer/reviewer, then Codex or OpenCode writer plus Pi reviewer.

### 13. `steer_unsupported_starts_no_second_turn`

- **Setup:** Keep a worker busy through acpx 0.13.0.
- **Actions:** Request steering.
- **Assertions:** `STEER_UNSUPPORTED`; one runtime turn/client; original request is unchanged.
- **Covers:** normal prompt masquerading as steering and concurrent session access.
- **Level:** deterministic spy and acpx fixture.

## Layer 2 acceptance cases

### 14. `steer_supported_is_acknowledged_and_changes_active_work`

- **Setup:** A capability-advertising adapter runs a phased task.
- **Actions:** Steer before phase two.
- **Assertions:** Same request/session; correlated delivery acknowledgement; phase two follows the new direction; no second turn starts.
- **Covers:** queued-not-delivered messages, wrong targets, follow-up prompts masquerading as steering.
- **Level:** deterministic capable adapter, then each real steering-capable adapter.

### 15. `steer_terminal_race_has_single_outcome`

- **Setup:** Completion and steering acknowledgement race.
- **Actions:** Resolve both in controlled orders.
- **Assertions:** Steering reports delivered or terminal-race failure; no replacement work starts; the request has exactly one terminal state.
- **Covers:** stale acknowledgements, double execution, resurrection.
- **Level:** deterministic capable adapter, then real adapter.

### 16. `actual_parent_kill_recovery`

- **Setup:** Start a child coordinator process and long-running fixture turn.
- **Actions:** Kill the parent externally and start a replacement coordinator.
- **Assertions:** Lease handling follows policy; active request becomes parent-lost unless adoption is proven; state and event files remain valid; safe idle sessions remain reusable.
- **Covers:** stale locks, partial atomic writes, real process death.
- **Level:** process integration, then Pi fixture.

### 17. `heterogeneous_writer_permission_boundary`

- **Setup:** External writer in a linked worktree.
- **Actions:** Perform one declared write and separately request an undeclared or out-of-worktree mutation.
- **Assertions:** Declared operation succeeds; forbidden operation fails; parent checkout remains unchanged.
- **Covers:** `approve-all` exceeding declared tool or cwd scope.
- **Level:** Codex first, OpenCode second.

### 18. `resume_rejects_identity_mismatch`

- **Setup:** Complete a resumable session.
- **Actions:** Attempt resume under a different agent, role, profile, or cwd.
- **Assertions:** Stable mismatch error; no new session; original remains intact.
- **Covers:** cross-role escalation and wrong-session continuation.
- **Level:** deterministic runtime and acpx integration.

## Layer 3 acceptance cases

### 19. `child_question_blocks_without_guessing`

- **Setup:** Child encounters a required product decision.
- **Actions:** Send a correlated question and reply from the parent.
- **Assertions:** Child pauses visibly; exactly one parent receives it; the reply resumes the same request; no duplicate question appears.
- **Covers:** wrong parent, lost reply, and invisible deadlock.
- **Level:** deterministic bridge, then Pi plus one messaging-capable adapter.

### 20. `question_parent_loss_is_recoverable_or_terminal`

- **Setup:** Leave a question pending.
- **Actions:** Terminate and restart the parent.
- **Assertions:** Question is explicitly expired, terminalized, or safely recoverable; child is never shown running forever.
- **Covers:** orphaned authority and stale questions.
- **Level:** process integration.

## Current implementation status

| Capability | Status |
|---|---|
| Worker/request identity | Implemented; deterministic sequential session-continuity and attempt-lineage tests pass |
| Same-worker single-flight | Tested |
| Multiple workers | Deterministic overlap tested; hosted Pi barrier overlap passed with the configured model, still opt-in for other agents |
| Wait-one | Tested |
| Wait-all | Tested with mixed terminal results and fixed snapshots |
| Wait-any | Tested with sibling preservation |
| Partial-failure isolation | Concurrent sibling survival tested deterministically |
| Cancellation escalation | Strong deterministic cooperative/escalated fixture coverage plus hosted Pi cooperative cancellation; other hosted agents remain opt-in |
| Cancel/reassign | Deterministic lineage plus hosted Pi, Codex, and OpenCode linked-writer cancel→close→reassign and final marker verification passed |
| Running progress | Live pre-terminal progress and bounded retention tested |
| Restart classification | Deterministic coverage plus real OS-process kill, stale-lease takeover, active-session quarantine, idle reconnect, and pending-question expiry |
| Idle reconnect/session continuity | Pinned-acpx fixture and hosted Pi coordinator-restart continuity passed; other hosted adapter gates remain opt-in |
| Writer/reviewer flow | Hosted Pi, Codex, and OpenCode writer→fresh Pi reviewer flows passed in an approved temporary linked worktree; Codex writes are OS-confined to the assigned worktree |
| Steering | Production Pi ACP runtime delivers correlated native Pi steering on the active connection; generic acpx remains explicitly unsupported; terminal races and mismatched acknowledgements are tested |
| Heterogeneous adapters | Explicit prerequisite-gated integration/E2E scripts for Pi, Codex, and OpenCode |
| Child-parent questions | Deterministic bridge, production Pi ACP fixture, and external ACP permission-question fixture prove correlated pause/reply and same-turn completion |

## Strict implementation order

1. Cases 1–20 have deterministic, fixture, process, or hosted evidence at the levels stated in the acceptance ledger; provider-specific claims remain limited to the hosted models actually exercised.
2. Keep case 13 as the acpx steering safety gate; only capability-advertising adapters may use acknowledged steering.
3. Cases 6–7, 9–12, 14, and 17 have hosted gates that passed with configured models and the approved temporary linked worktree. Hosted Pi parent-kill, Pi writer resume, Codex/OpenCode writer boundaries, and Codex/OpenCode reassignment all passed. Codex writers are confined with macOS `sandbox-exec`.
4. Pi steering/question-reply and the external ACP permission-question bridge are production-supported at their respective adapter contracts. Generic acpx still does not advertise native in-flight steering; external providers must opt into the documented question extension.
5. Evaluate Layer 4 only after the remaining real-adapter gates demonstrate measurable coordination value.
