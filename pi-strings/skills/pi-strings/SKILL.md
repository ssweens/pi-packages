---
name: pi-strings
description: Coordinate persistent coding-agent workers from Pi through the vendored ACPX runtime. Use for parallel research, independent review, isolated implementation, heterogeneous-agent comparison, cancellation, and recovery.
---

# Pi Strings

The parent Pi is the sole orchestrator. Workers never invoke the `op_*` tools or coordinate other workers.

Before delegating, read `../../docs/AGENT_GUIDE.md`. For lifecycle, policy, or recovery questions, also read `../../docs/ARCHITECTURE.md`.

## Required operating rules

1. Give each worker one decision-shaped assignment with scope, evidence, constraints, and required output.
2. Spawn directly from an ACP agent when a reusable policy is unnecessary (`agent` defaults to `pi`); direct workers are safe read-only by default. Use optional read-only/writer profiles when their policy bundle is needed, with shared checkout by default or a linked worktree (`isolation: "worktree"`).
3. Never run two writers in the same canonical cwd. One live writer per cwd is enforced.
4. Use `send` for normal turns. Never submit a second prompt while a worker turn is active.
5. Continue a persistent session only with an ordinary later `send` after terminal completion; there is no in-flight steering, question, or reply surface.
6. Treat only `status: completed` as success. Report cancellation, timeout, provider failure, and transport failure honestly.
7. A timed-out worker is failed and unusable until explicitly closed; close it before replacement.
8. Review writer changes from the parent or an independent read-only worker before integration.
9. Use tmux only to watch logs or attach manually. Never automate a worker through tmux.
10. Close workers when their context is no longer valuable; preserve persistent state only when future follow-up is likely.

## Role specialization

Choose profiles by `kind`:

- `pi-oracle` (oracle) — read-only advisor for hard judgment calls. Produces an acceptance report.
- `pi-finder` (finder) — read-only scout with a turn budget (`maxTurns`). Produces an acceptance report.
- `pi-writer` (worker) — writer. Produces an acceptance report describing changed files.
- `pi-reviewer` (free) — read-only reviewer. No acceptance report required.

The coordinator decorates prompts with per-kind role and acceptance contracts. Acceptance reports are parsed from fenced `acceptance-report` blocks.

## Standard sequence

1. `op_list` to understand existing workers.
2. `op_spawn` named workers with an optional profile or direct `agent`/role/tools and cwd.
3. `op_status` when model discovery or a model choice is needed.
4. `op_send` lane-specific tasks, optionally selecting a discovered model, and retain each request ID.
4. `op_wait` for workers required for the next decision.
5. `op_result` to retrieve retained output and terminal metadata.
6. Synthesize in the parent; do not blindly concatenate worker answers.
7. `op_close` disposable workers.
