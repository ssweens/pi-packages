# Stationary Todo Widget

- **Mode:** RESCUE
- **Tier:** flow; **Flagship:** no
- **Flow served:** `flows/todo-widget.feature` — keep the agent's current plan visible without asking the user to open or scan chat history. Friction budget: **0 interactions, 0 decisions, 0 inputs, 0 waits**.
- **N+1 rung:** 2 — reuse Pi's existing `ctx.ui.setWidget` surface above the editor.
- **One delta:** synchronize every todo-state transition to a bounded above-editor widget, restore it for session/branch changes, and collapse transcript results to status-only rows.
- **Acceptance bar:** the three scenarios pass in a live Pi TUI; the widget shows only remaining work, clears when none remains, and no ordinary todo update renders a full task list in transcript scrollback.

## Verification

Author evidence follows; independent verifier verdict remains authoritative.

## Fallback independent verifier evidence — 2026-08-18

**Scope and constraints:** `git` root is `/Users/ssweens/src/pi-packages`; `git status --porcelain` reports `?? pi-omp/`, so `git diff --stat HEAD` cannot derive a bounded changed-surface list. This fallback did **not** launch Pi or another long-lived interactive process, as directed. No real TUI screenshot, theme walk, console/network trace, keyboard/adversarial pass, interaction inventory, or visual rubric score exists.

**Noninteractive contract checks:**

- `bun test && bun run check`: **49 pass, 0 fail**; `tsc --noEmit -p tsconfig.json` exited 0.
- `extensions/todo.ts:97–105` clears `pi-omp.todo` for zero open tasks and otherwise sets a component widget at `aboveEditor`.
- `extensions/todo.ts:140–148` renders compact default result text; the full panel is limited to `options.expanded`.
- `extensions/todo.ts:151–152` subscribes to `session_start` and `session_tree`; installed Pi declarations and docs confirm those cover resume and tree navigation.
- A fake-API lifecycle probe invoked add → session-start → session-tree → done. It observed widget pinning/restoration, clearing, `1 task remaining · pinned above editor`, and `All 1 task complete.`
- A 96-task, 8-phase, long-content renderer probe at width 20 returned 13 lines with max visible width 20, `… more tasks`, and `… more phases`; `src/todo-render.ts` caps active tasks at 5 and subsequent phases at 4.

**Scenario gate:**

| Scenario | Result | Evidence | Friction |
|---|---|---|---|
| Agent updates a task plan while I keep working | FAIL — not live-walked | Static add/pin and compact-result checks only. | Not measurable; required budget 0/0/0/0. |
| Resume work with remaining tasks | FAIL — not live-walked | Static session-start/tree callbacks only. | Not measurable; required budget 0/0/0/0. |
| Finish the plan | FAIL — not live-walked | Static completion clearing only. | Not measurable; required budget 0/0/0/0. |

**Findings:**

| Severity | Surface | What happens | Exact repro steps |
|---|---|---|---|
| 3 | `flows/VERIFICATION.md:4,12` | `Tier: standard` is declared for a new/changed three-scenario flow; prior evidence was only `Pending implementation.` | 1. Read `flows/todo-widget.feature`. 2. Read this file lines 1–12. 3. Observe the tier and missing preexisting evidence. |
| 3 | repository scope | Entire `pi-omp/` is untracked; changed UI surfaces cannot be independently derived from git. | 1. `cd /Users/ssweens/src/pi-packages/pi-omp` 2. Run `git rev-parse --show-toplevel` 3. Run `git status --porcelain` 4. Observe `?? pi-omp/`. |
| 3 | live Pi TUI | No independent real-app flow walk or console/network observation occurred because this task prohibited launching Pi. Parent-provided PTY smoke covers only adding `Widget smoke`. | 1. Compare the three scenarios in `flows/todo-widget.feature` with the static checks above. 2. Confirm no screenshots or console/network logs exist. |

**Rubric:** not scored. The rubric requires a real render; inventing a 10-dimension score without one would be false.

**Residual risks:** actual above-editor placement, editor space recovery, themes, focus, transcript collapse, and runtime console cleanliness remain unobserved; no permanent executable session-resume/tree-navigation binding exists.

VERDICT: FAIL
<!-- ui-verifier-verdict: FAIL date=2026-08-18 scenarios=0/3 findings=3 flagship=no -->

## Author follow-up — 2026-08-18

- Corrected the tier to `flow`.
- Added `test/todo-extension.test.ts`, which executes the registered tool through its extension lifecycle: add → compact/expanded rendering → `session_start` → divergent `session_tree` branches → done. It asserts widget pinning at `aboveEditor`, active-branch restoration, compact default history, expanded inspectability, and final clearing.
- Added bounds regressions for every task status and narrow widget rows.
- `bun test && bun run check`: **53 pass, 0 fail**; `tsc --noEmit -p tsconfig.json` passed.
- A final fresh code review reported **PASS** with no actionable P0–P3 findings.
- A raw-PTY `pi -e extensions/index.ts` process launched, but its synthetic input remained in the editor; it did not produce a valid interactive scenario walk. The earlier parent-provided PTY smoke claim was therefore not sufficient evidence and must not be read as a passed live-TUI flow.

**Open verification limitation:** interactive TUI screenshots, console capture, and a full resume/tree walk remain unavailable from this noninteractive harness. The independent verifier's `FAIL` verdict remains in force.
