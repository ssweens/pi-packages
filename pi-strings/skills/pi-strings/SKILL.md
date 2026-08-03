---
name: pi-strings
description: Coordinate multiple persistent coding-agent workers from Pi through ACP. Use for parallel research, independent review, isolated implementation, heterogeneous-agent comparison, cancellation, and recovery.
---

# Pi Strings

The parent Pi is the sole orchestrator. Workers never invoke `strings` and never coordinate other workers.

Before delegating, read `../../docs/AGENT_GUIDE.md`. For lifecycle, policy, or recovery questions, also read `../../docs/ARCHITECTURE.md`.

## Required operating rules

1. Give each worker one decision-shaped assignment with scope, evidence, constraints, and required output.
2. Use read-only profiles for exploration and review. Use writer profiles only in an existing isolated linked worktree.
3. Never run two writers in the same checkout or worktree.
4. Use `send` for tasks. Use `steer` to redirect an active Pi worker; it returns a correlated acknowledgement. Other acpx agents return `STEER_UNSUPPORTED` unless their runtime advertises genuine in-flight delivery.
5. Correlate all follow-up operations by worker name and request ID.
6. Treat only `status: completed` as success. Report cancellation, timeout, provider failure, and transport failure honestly.
7. Review writer changes from the parent or an independent read-only worker before integration.
8. Use tmux only to watch logs or attach manually. Never automate a worker through tmux.
9. Close workers when their context is no longer valuable; preserve persistent session state only when future follow-up is likely.

## Standard sequence

1. `list` to understand existing workers.
2. `spawn` named workers with explicit profiles and cwd.
3. `send` lane-specific tasks and retain each request ID.
4. `wait` for the workers required for the next decision.
5. `result` to retrieve retained output and terminal metadata.
6. Synthesize in the parent; do not blindly concatenate worker answers.
7. `close` disposable workers.
