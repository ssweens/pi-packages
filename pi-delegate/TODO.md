# pi-delegate — running state

Keep this current. It is the handoff between sessions: what exists, what is proven, what is open.

## Why this package exists

Covers the delegation `pi-subagents` (125 schema params, ~14.8k lines, 11 delegation tools per turn) and `pi-strings` were doing, and **coexists with both** — distinct tool names, settings keys, session dirs, logs; verified side-by-side with pi-subagents loaded, no errors. Removing the old stack is a per-machine choice; nothing in this package requires it. Audit evidence from 856 runs in `~/.pi/agent/run-history.jsonl`: `worker` failed 34%, `code-explorer`/`code-architect` 100% (Claude-format tool names, no mapping), 1.26 review runs per implementation run, median 22 min child wall-clock per session, 183 missions with a median of 1 run each. Delegation happened in ~11% of sessions; the schema was paid in 100%.

Design rules that must hold:

- **No hacks, no heuristics.** Tools present facts as recorded. Judgment — what is equivalent, adequate, worth its price — belongs to the agent with the user, in the open. Rules of thumb go in the readable skill, never silently in code.
- **Model offerings are never deduplicated.** The same weights on a subscription, a metered API, a local box, or a free tier are different offerings (marginal cost, speed, quantization, limits).
- **No model names in prose.** Not in the skill, README, role files, or source. Role files and `delegate-models.json` are the only places a model is named.
- **Approval is a conversation.** No dialog, no modal, and no reminder text in results. The agent proposes in its own words; `delegate_ctl approve` records a default only after the user agrees. A tool never nags about a decision it does not own.

## Current state (2026-09-21)

Two tools, ~1.3k lines. In `settings.packages`; `pi-subagents` and `pi-strings` removed, `settings.subagents` overrides dropped (backup: `~/.pi/agent/settings.json.pre-delegate`).

- `delegate({ role, task, model?, reason?, context?, cwd?, timeoutMs?, sync? })` — in-process child via `createAgentSession`, no extensions/skills loaded, built-in tools only. **Background by default**; `sync: true` blocks only when the result is needed inside the turn.
- `delegate_ctl({ action: models|rate|approve|roles|status|result|steer|cancel, ... })`.
- Roles: `scout` (fresh, read-only, low), `worker` (fork, all built-ins, medium), `reviewer` (fresh, read-only, high). All inherit the parent model unless a role file or call names one.
- Discovery, lowest → highest priority: package `roles/` → `~/.pi/agent/agents/` → `~/.agents/agents/` (skips `_*`/`.*`) → `<cwd>/.pi/agents/` when trusted.
- State: `~/.pi/agent/delegate-runs.jsonl` (plaintext task, tokens, cost, duration, changed files), `delegate-models.json` (approved defaults + catalog snapshot), `delegate-ratings.json` (agent-researched ratings, stale after 14 days), child transcripts in `<cwd>/.agents/pi/subsessions/` — with the work, not under `~/.pi`.

## Verified

- [x] Fresh and fork context; fork proven by a child knowing a parent-only codeword with `startIdx` set past the replayed history.
- [x] `steer` on a finished child continues the same session (no new child, no new review); cumulative turns/tokens on one run id.
- [x] Background launch (the default) → `sendMessage(followUp, triggerTurn)` wake; `LAUNCHED` → `WOKEN` verified in RPC and in a real TUI.
- [x] Changed files from a git status/mtime delta per run segment, so `bash >>` edits are caught, not just `edit`/`write`.
- [x] One writer per cwd — a second writing role in a live writer's tree is refused.
- [x] `models`: 967 offerings across 26 providers verbatim; live OpenRouter facts by exact id (current-window price vs registry, long-context tiers, UTC peak/off-peak windows with the active one marked, expiration, Artificial Analysis indices), per-provider endpoints for filtered candidates (discount, quantization, status, uptime, provider-specific off-peak). Spec: <https://openrouter.ai/docs/guides/overview/models#pricing-object>. Overrides with unrecognized condition fields are skipped and counted, per that spec.
- [x] `approve` persists a default; subsequent calls resolve it silently.
- [x] omp-style framed rendering (after `oh-my-pi/packages/coding-agent/src/task/render.ts`): rounded frame, status line, collapsed 3-line output, expanded Task + markdown + session path, live spinner and progress while running, call preview collapses on result. Verified in a real TUI via tmux, not just JSON mode.

## Fleet notes

- Machines still on pi-subagents: a newer pi-subagents rejects the removed `fallbackModels` field in `settings.subagents.agentOverrides.*`. Fix on the affected machine:
  `python3 -c "import json;p='$HOME/.pi/agent/settings.json'.replace('$HOME',__import__('os').path.expanduser('~'));d=json.load(open(p));[ov.pop('fallbackModels',None) for ov in d.get('subagents',{}).get('agentOverrides',{}).values()];json.dump(d,open(p,'w'),indent=2)"`
  Reproduced and verified here: error appears with the field, gone without it, both stacks then load together.
- Nothing under `~/.agents` or `~/.pi/agent` syncs between machines (no symlinks/git/syncthing found). This repo and playbook are the only shared vehicles; keep machine-local migration steps out of them.

## Open

- [ ] **Use it on real work.** 22 logged runs, 21 of them `/tmp` scratch. Nothing here is proven on an actual multi-file change.
- [ ] Approved defaults exist only for `scout`. `worker`, `reviewer`, `ui-verifier`, `ui-panelist` need a proposal → agreement → `approve` each.
- [ ] `catalogAtApproval` for `scout` is empty (file was hand-written); the next real `approve` populates it and "new since approval" drift starts working.
- [ ] Ratings cache empty. AA arrives live, so this is only for evidence beyond AA (observed runs here, other evals, an offering's serving quality).
- [ ] No typecheck in the loop — jiti loads the TS at runtime; everything so far is runtime-verified only.

## Known gaps, deferred on purpose

- **Children get built-in tools only.** Not fixable from an extension: `pi.getAllTools()` returns `ToolInfo` (name/description/parameters, no `execute`). Options if a research/web role is ever needed: role frontmatter naming extension paths for the child loader (unverified against `noExtensions: true`), or an upstream request for `ToolDefinition` access. `droppedTools` reports the loss on every run, so it never fails silently.
- **`steer` after retirement** (>8 retained sessions) needs a new fork. Raise the cap when the log shows it happening.
- No missions, lanes, watchdogs, acceptance protocols, councils, schedules, or intercom. A brief, a slash command, or `git worktree add` covers those; none belong in a schema read every turn.

## Metrics to move

Baseline from the old stack; re-audit at 20 real (non-scratch) runs in `delegate-runs.jsonl`.

| metric | baseline | target | now |
|---|---|---|---|
| review runs per implementation run | 1.26 | <0.5 | — |
| failed runs | 34% | <10% | 0/22 (scratch) |
| delegation tools in context | 11 | 2 | 2 |
| schema params | ~125 | ~10 | 10 |
| median child wall-clock per session | 22 min | <8 min | — |

Guardrail: rework (steers per run) must not rise as review falls.

## Related

- Skill: ships in the package (`skills/delegation/SKILL.md`) — when to delegate, review triggers, model research and proposal procedure. Install via `pi install npm:@ssweens/pi-delegate | git:… | ./dir`; extensions, skill, and roles all travel together. No copies in `~/.agents`.
- Method that produced this design: `friction-audit` skill (`~/src/playbook/skills/friction-audit/`).
- Retired: `~/.agents/agents/_retired-stage0/` (dead Claude-format roles, sol-advisor trio), `~/.pi/agent/_retired-stage0/` (missions, pi-strings state). `run-history.jsonl` kept as the re-audit baseline.
