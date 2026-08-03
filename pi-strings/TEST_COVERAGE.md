# Test coverage

The acceptance suite is organized around externally observable contracts rather than implementation classes. This file records current evidence; the complete planned test matrix and layer promotion gates are defined in [`docs/2026-08-02-COORDINATION_LAYERS.md`](docs/2026-08-02-COORDINATION_LAYERS.md).

| Surface | Required evidence |
|---|---|
| Tool protocol | Every action validates input and returns stable structured details |
| Lifecycle | Spawn, send, explicit unsupported-steer rejection, wait, result, list, questions/reply, cancel, close, worker-name reuse, reconnect, and reassignment transitions |
| Concurrency | Different workers overlap; one worker never runs two turns concurrently |
| Terminal results | Completed, cancelled, timed out, provider-failed, and transport-failed remain distinct |
| Pi RPC framing | LF-delimited JSON including U+2028/U+2029 is parsed without record splitting |
| Pi RPC deadlines | Requests time out, reject pending callers, and retain bounded stderr diagnostics |
| Process ownership | Graceful abort precedes process-group termination; all pending calls settle |
| Persistence | Atomic mode-0600 writes, locking, corruption quarantine, and restart recovery |
| Policy | Recursive orchestration denied; read-only tool ceiling enforced; writers require isolated worktrees |
| Permissions | Read-only ACP requests are denied; writer requests are auto-approved only within the profile's declared tool surface |
| Adapter compatibility | Deterministic fake-Pi ACP conformance fixtures plus a real Pi smoke flow |
| Heterogeneous agents | One real non-Pi ACP adapter smoke flow when its executable is available |
| Packaging | Typecheck, tests, build, integration skips, and `npm pack --dry-run` |

Live tests must identify skipped external prerequisites explicitly. A missing executable is not a passing integration test.

## Verified in 0.1.0 development

- Extension typecheck plus a separate vendored-adapter typecheck against ACP SDK 1.3.0.
- Parent tool registration and worker-mode recursive-orchestration suppression.
- Default read-only Pi tool ceiling excludes shell and mutation tools.
- Pi RPC LF framing preserves U+2028/U+2029 and enforces request deadlines.
- Worker startup includes discovery-disable flags and an explicit tool allowlist.
- Adapter session maps and coordinator state use private modes, atomic writes, explicit corruption errors, and exclusive ownership locks.
- Real Pi 0.83 extension load through RPC mode.
- Real Pi-to-Pi ACP flow through `acpx/runtime`: spawn, send, wait, honest provider-failure result, and session close.
- Deterministic coordinator boundary tests: same-worker exclusion, cross-worker overlap, wait-any/mixed wait/snapshot waits, live progress, sibling failure isolation, session continuity/reconnect, steering rejection and capability-negotiated steering terminal races, close-and-respawn name reuse, cancellation escalation, cancel-and-reassign lineage, timeout classification, stream failure, parent-loss recovery, resume identity validation, role-specific ACP permission policy, correlated child questions, pending-question expiry, and bounded output with complete private spill.
- Real Pi writer/reviewer/reassignment/resume, Codex writer/reviewer/reassignment, and OpenCode writer→Pi-reviewer/reassignment flows in an operator-approved linked worktree, including actual write/read verification and clean session close. Codex writers run under an OS-level sandbox that denies writes outside the assigned worktree.
- Real adversarial Pi/Codex read-only flow requested a file write; only read-only probing was available and the forbidden file was verified absent on disk.
- Real heterogeneous OpenCode ACP writer flow using `opencode/north-mini-code-free`; its first marker was wrong, a precise correction turn fixed it, and the final file was verified byte-for-byte.
- Packed tarball installed into an isolated dependency tree and loaded by a real isolated Pi process.

Pi RPC coverage also verifies native steering, oversized complete-record rejection, single-flight termination, and timeout cancellation before successor work. A real child-process SIGKILL test verifies stale-lease takeover, active-session quarantine, idle-session reconnect, retained partial evidence, and pending-question expiry.

## Assertion-level acceptance ledger

A related test is not the same as full evidence. The matrix below distinguishes deterministic contract proof, fixture/process proof, hosted-provider proof, and unrun prerequisites.

| Case | Concrete evidence | Current verdict | Remaining gap |
|---:|---|---|---|
| 1 | `coordinator.test.ts`: wait-any test; later named wait-all returns both IDs | **Proven** | None for the stated deterministic level |
| 2 | `coordinator.test.ts`: mixed completed/provider-failed/timeout statuses and no aggregate success status | **Proven** | None for the stated deterministic level |
| 3 | `coordinator.test.ts`: all-wait snapshot excludes C and C remains running independently | **Proven** | None for the stated deterministic level |
| 4 | `coordinator.test.ts`: live running result, text/status/tool progress, complete private NDJSON, mode 0600; spill test bounds retained output | **Proven** | None for the stated deterministic level |
| 5 | `coordinator.test.ts`: A stream failure, B completion, B cancel/close flags remain false | **Proven** | None for the stated deterministic level |
| 6 | `acpx-contract.test.ts` proves nonce continuity across turns and reconnect; hosted Pi continuity test passes with `PI_STRINGS_E2E=1` | **Proven for ACP fixture and current Pi model** | Other hosted agents are not run |
| 7 | `acpx-contract.test.ts` and hosted Pi restart test preserve session/context; coordinator reconnect quarantine is deterministic | **Proven for ACP fixture and current Pi model** | Other hosted agents are not run |
| 8 | Coordinator restart plus hosted live-Pi parent SIGKILL preserve `PARENT_PROCESS_LOST`, reconstructed partial output, and event-file evidence | **Proven** | None for the stated process-loss policy |
| 9 | Hosted Pi test uses two workers, waits for distinct `READY_*` markers before releasing a shared barrier, then asserts both complete | **Proven for current Pi model** | Not Codex/OpenCode; hosted test is opt-in |
| 10 | Fixture cancellation test proves cooperative no-close and ignored escalation; hosted Pi cancellation test passes without escalation | **Proven for fixture and current Pi model** | No real Codex/OpenCode cooperative gate |
| 11 | Deterministic reassignment plus hosted Pi, Codex, and OpenCode linked-writer tests prove partial disk evidence, cancel→close→new session, attempt 2, predecessor authority, and final marker | **Proven for current hosted models** | Other provider versions remain opt-in |
| 12 | Hosted Pi, Codex, and OpenCode writer→fresh Pi reviewer flows verify disk marker, parent-checkout, result, and reviewer role | **Proven for current hosted models** | Other provider versions remain opt-in |
| 13 | Coordinator spy rejects unsupported steering; acpx capability test verifies no genuine `session/steer`; original turn remains unchanged | **Proven** | No second hosted acpx provider needed because the protocol capability is absent |
| 14 | Deterministic capable runtime and production Pi ACP/fake-Pi path prove same request, acknowledgement, changed output, and one turn; hosted Pi steering gate passes | **Proven for fixture and current Pi model** | No real Codex/OpenCode steering adapter claim |
| 15 | Deterministic controlled race proves terminal-race/delivered outcomes, one terminal request, and no replacement turn | **Proven deterministic** | No hosted-provider race gate |
| 16 | Real fork/SIGKILL plus hosted live-Pi parent-kill tests prove stale lease takeover, active quarantine, idle resume, reconstructed evidence, and question expiry; Pi RPC process tests prove framing/termination | **Proven** | None for the stated process-level policy |
| 17 | Policy unit tests cover declared tool/cwd and live/dangling/intermediate symlink escapes; hosted Pi/OpenCode boundaries and OS-sandboxed Codex boundary all reject the parent checkout | **Proven for current hosted models** | Other provider versions remain opt-in |
| 18 | Deterministic resume tests plus hosted Pi linked-worktree writer resume cover agent/profile/role/cwd provenance and matching session continuation | **Proven** | None for the stated resume policy |
| 19 | Deterministic bridge, production Pi ACP fixture, and external ACP permission-question fixture prove visible waiting, scoped IDs, duplicate suppression, correlated reply, provider response, and same-request completion | **Proven for Pi and external ACP bridge** | Providers must opt into the documented external question extension |
| 20 | Deterministic restart plus real SIGKILL test explicitly expires pending questions | **Proven** | None for the stated process-level terminal policy |

## Remaining prerequisites and honest boundaries

1. `bun run test:integration` reports explicit skips unless `PI_STRINGS_E2E=1` and configured model/executable prerequisites are present.
2. The final hosted run passed all 15 gates: Pi spawn/send/wait, hosted-Pi parent kill, Codex/OpenCode smoke, two-Pi barrier overlap, Pi cooperative cancellation, Pi restart continuity, Pi native steering, Pi writer/reviewer/reassignment/resume, Codex writer boundary/reassignment, and OpenCode writer boundary/reassignment. External ACP question/reply is separately proven by the adapter fixture.
3. Generic acpx 0.13.0 does not advertise native steering or questions. Pi native steering/question delivery and the external ACP permission-question bridge are implemented and proven; generic acpx still cannot claim native in-flight steering.
4. Case 19 is proven through the external ACP permission-question extension: an adapter request becomes a persisted coordinator question, parent reply returns to the adapter, and the same turn completes.
5. Codex writer execution is confined by macOS `sandbox-exec`: the assigned linked worktree and provider state/temp directories are writable, while the parent checkout is denied. The Pi/Codex/OpenCode writer gates used the approved temporary linked worktree and were cleaned up afterward.

Task boards, DAGs, dynamic fan-out, and autonomous reviewer loops remain experimental Layer 4 candidates rather than unearned baseline complexity.
