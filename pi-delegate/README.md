# pi-delegate

Install: `pi install npm:@ssweens/pi-delegate`, `pi install git:<repo>`, or `pi install ./pi-delegate`. The two tools, the `delegation` skill, and the default roles all ship in the package — nothing is copied to `~/.agents`.

Requires Pi 0.86.1 or newer. Minimal delegation for pi. Two tools, role files, fork context, steer, honest run log. Replaces pi-subagents (125 schema params, 14.8k lines, 11 tools in context) and pi-strings for the delegation you actually do.

## Tools

**`delegate({ role, task, model?, reason?, context?, cwd?, timeoutMs?, sync? })`**
Runs `role` on `task` in its own in-process session (`createAgentSession`, no extensions/skills loaded — built-in tools only). Returns final report, changed files, turns, tokens, cost, run id, and the child's session file path. Refuses a second writing child in a `cwd` that already has one running.

- `context: "fork"` (default) — child starts with the parent's conversation so far (`buildSessionContext` of the active branch, trailing unresolved tool call trimmed). No re-acquisition. Delegation records are left out of that inheritance — `delegate`/`delegate_ctl` calls, their results, and completion notices — so a child inherits the work rather than a pattern of handing it off; children have no delegation tools, and copies of those calls only produced confident re-delegation attempts and false "extension not loaded" diagnoses.
- `context: "fresh"` — adversarial/independent review.
- `model: "provider/id[:thinking]"` — tier switch at call time; no new role needed.
- Background by default — returns a run id at once. Do independent work, then use `delegate_ctl wait` when a dependency needs the result. Unjoined completion wakes the parent via `sendMessage(followUp, triggerTurn)`. `sync: true` remains an explicit option to join at launch.

**`delegate_ctl({ action: models|rate|approve|roles|status|result|wait|steer|cancel, runId?, message?, model?, restart?, ratings? })`**
`models` reports approved defaults per role, DRIFT against the live catalog (default unavailable · price changed · approval >30 days · new offerings · OpenRouter live price or expiration differs), your ratings cache, and the catalog across **all** enabled providers exactly as the registry reports it: one line per offering, `provider/id`, reasoning flag, context window, $/M in/out. Nothing is deduplicated, excluded, scoped, or ranked by price — the same weights on a subscription, a metered API, a local box, and a free tier are different offerings and the agent weighs them in the open.

For OpenRouter offerings it also fetches the public API (no key; 10-minute in-memory cache; 8 s timeout; on failure it says so and shows registry data):

- `GET /api/v1/models` once per call — appended per offering by exact id: live price where it differs from the registry (top-level pricing is what applies **right now** per the spec), every `pricing.overrides` entry rendered as stated — long-context tiers (`>272k prompt $4/15`) and UTC peak/off-peak windows (`mon…fri 06:00–10:00Z $0.3/1.2 ←now`) — with entries carrying unrecognized condition fields skipped and counted, per the spec; `request` cost when non-zero; expiration date; Artificial Analysis intelligence / coding / agentic indices.
- `GET /api/v1/models/{author}/{slug}/endpoints` for filtered OpenRouter candidates (first 12) — one line per provider endpoint: price, promotional `discount` (verified against sibling endpoints that the listed price already includes it; the undiscounted price is shown), quantization, non-zero status, 30-minute uptime, context, and the endpoint's own overrides (provider-specific off-peak).

Models live on OpenRouter but absent from the registry are listed separately (usable after adding to `models.json`). The default view lists offerings that have a rating (yours or AA), ordered by your rating then AA intelligence index; `message=<substring>` searches every offering and every provider of a candidate.

`rate` stores ratings the agent researched, keyed by exact `provider/id` (`[{model, score, source, note?}]`), in `~/.pi/agent/delegate-ratings.json`; reported stale after 14 days. Ratings appear on `models` lines.

## Waiting for an existing child

```json
{"action":"wait","runId":"<id returned by delegate>"}
```

`wait` joins that execution segment without polling, relaunching, or changing the child. It returns the final report and terminal status (`complete`, `error`, `timeout`, `cancelled`, or `interrupted`). Already finished? It returns the stored result immediately. `result` remains a nonblocking read of the current report.

- Cancelling a wait detaches only that waiter. The child keeps running and can still wake the parent. Use `cancel` to stop the child itself.
- Waiters attached at completion receive the result instead of a separate completion wake-up. Multiple waiters receive the same result. A late wait does not retract an earlier notification or send another one.
- `steer` always returns without waiting for the child to finish: it queues a correction on a running child or resumes a saved inactive child in the background. Use `wait` to join resumed work; otherwise completion wakes the parent. Cancelling the parent tool does not cancel the background child.
- A finished child resumed with `steer` gets a new completion; earlier returned results do not change. A child still stopping cannot resume until its execution settles.
- Run IDs belong to their parent session. Reloading or reopening that same parent restores access to its children. `wait` joins a live child or returns its saved result; it never restarts work.

## While a child runs

The parent is woken **once**, when a child finishes. There are deliberately no mid-run progress pings: an interrupt per tool call would spend a parent turn on information nobody asked for, and the human already watches live progress in the pinned Agents frame. Waiting is not the parent's work — it does other work, or `wait`s (blocking without polling), or takes a single `status` read:

```
running · worker-791ede7d · role worker · model … · 3 turns in 41s · tokens in 6, out 1.5k
session: …
now: bash · 12 tool calls so far · 47 min of its budget left
```

`timeoutMs` is that budget, 15 minutes by default, and it belongs to the current run segment. A child that needs hours must be launched with hours, or it is aborted mid-flight; a timeout says so, names the budget, and leaves the work in place — nothing is rolled back. `{"action":"steer","runId":"<id>","message":"…","timeoutMs":3600000}` re-arms a running child's budget immediately and persists it for later segments; a budget already spent is refused rather than applied as an instant kill.

A missing automatic continuation is a delivery problem to investigate, not a reason to make all launches synchronous. Check the parent transcript and Pi's `send_message` extension errors to distinguish child completion, notification delivery, and parent continuation.

## Reload and recovery

Children run inside Pi, not in detached runners. `/reload` replaces the extension binding and reconnects the Agents frame to the same live sessions. It does not restart or cancel their work.

Closing Pi or switching parent sessions interrupts active children. Reopening the same parent restores saved children without running them. After a crash, an unfinished child appears as `interrupted`; inspecting its transcript, reading its result, or waiting does not resume it. Inspect interrupted tool work before continuing: interruption does not undo side effects.

Send a message with `steer` to resume an inactive child under the same run ID and transcript. Revival uses the saved model, reasoning level, tool list, role instructions, project instructions, working directory, and timeout—not current role files or model defaults. Missing history is an error, not permission to start a replacement. Finished sessions evicted from memory can also revive this way.

An unavailable or exhausted saved model is also an error, and the choice of replacement is yours: `{"action":"steer","runId":"<id>","message":"...","model":"provider/id[:thinking]"}` revives that child on the offering you name, keeping its ID, transcript, tools, and instructions. The new offering applies from that segment on and is persisted, so later revivals use it; earlier segments keep the model they actually ran on, and the omitted reasoning level stays as saved. A running child refuses the switch—its turn is already bound to its model, so wait or `cancel` first. The agent proposes the replacement in conversation before calling this; nothing substitutes an offering on its own.

A model spec naming a provider resolves to that provider only. `openai-codex/x` never falls back to `openrouter/x`: same weights on another route differ in cost, limits, and serving, so an unavailable one is reported, not silently swapped.

An explicit `cancel` remains stopped across reloads and process restarts. The agent must have your request before using `steer` with `restart: true`. Typing a message in a stopped child's **Restart** editor is your direct restart request.

Completed results and interrupted executions are separate states. On reopen, an undelivered result is reported without rerunning the child. Delivery receipts in the parent transcript prevent replay of results already recorded there. A receipt establishes delivery, not that the parent finished acting on it.

One filesystem lease owns each parent's children. Opening the same parent in another Pi process cannot start a second child writer. After an abrupt crash, the lease expires within 10 seconds; retry opening the parent after that. Different parent sessions remain independent.

Recovery metadata is recorded for children launched by this version. Older transcript files remain readable but have no saved parent/runtime contract to revive.

## Which offerings a child can use

A child runs on the parent's catalog, including providers that extensions register at runtime — account switchers, gateways, subscription pools. Those registrations are mirrored into the child runtime each time a child session opens, so launch order does not decide what a child can run, and a provider registered after the first child still works. A provider the parent drops stops serving children that have to reopen their session; a session already in memory keeps the model it was built with. Nothing about those providers is copied into a child's saved record beyond the `provider/id` it ran on, so credentials stay with the parent's runtime.

## Model approval

A `delegate` call resolves its model as `model:` param → approved default for the role → role file → your current model, and runs. There is no dialog: proposing a non-default model is a conversation — the agent states offering, price, tradeoff, rating, asks, and launches on your answer. `delegate_ctl action=approve role= model= message=` records a default in `~/.pi/agent/delegate-models.json`; the skill forbids calling it without your explicit yes in the conversation. The file also snapshots the catalog so `models` can report drift and new offerings since approval.

## Watching children

One OMP-style **Agents** frame above the parent editor shows only running or stopping children. Each row shows the task title, role, current tool, and elapsed time. When a child settles, its row leaves the frame; when none remain active, the frame disappears. Finished rows do not return on reload. Put a short title on the first line of the delegation brief; the UI displays it without generating a summary.

- **Ctrl+J** focuses the active list, or opens finished-child history when no children are active. It never chooses a child for you. This binding replaces Pi's Ctrl+J newline; Shift+Enter still inserts a newline.
- **↑↓** selects an active child; **Home/End** and **PgUp/PgDn** navigate longer lists. The frame shows at most four rows, scrolling internally. Active rows stay in dispatch order; selection stays on its child while that child remains active. If the last active row finishes while the list has focus, focus returns to the parent editor.
- **Enter** opens the selected child's conversation across the whole viewport. The parent display is hidden, not repeated behind a floating inspector.
- In the child view, type a message and press **Enter**. Running children receive a queued steer; saved inactive children resume in the same session. A stopped child shows **Restart**. **PgUp/PgDn** scrolls the conversation; **Ctrl+End** follows the latest output; **Ctrl+X** stops that child.
- **Esc** returns to the parent editor without stopping the child. Parent and child drafts are separate; returning preserves the parent draft and list selection.
- **`/agents`** opens an on-demand list of finished children, including failures, cancellations, and interrupted runs. Select a row with **↑↓**, then **Enter** to inspect it; **Esc** closes the list. History remains available while other children run. Removing a row from the pinned frame does not delete its session or prevent revival.

The child transcript uses Pi's own assistant/user message, built-in tool, and editor components—not a second text/JSON renderer. It opens at the newest output and follows streaming text and tool output. **PgUp** pauses following; **Ctrl+End** or paging back to the bottom resumes it. Tools start collapsed; Pi's **Ctrl+O** action expands/collapses them, and its thinking-toggle binding controls reasoning display. Markdown, code highlighting, errors, and tool results use the active Pi theme. Fullscreen mode also supports Pi's native click-to-expand tool results and mouse-wheel scrolling; regular mode leaves mouse handling to the terminal emulator. It does not launch a second writer against the child's session file. Opening a saved child reads its transcript without reviving it; sending a message revives it.

## Reading a result

Every returned report is a run description followed by the child's own words, fenced so the two cannot be confused:

```
complete · worker-791ede7d · role worker · model anthropic/claude-sonnet-5:medium · context forked from 215 parent messages · 3 turns in 25s · tokens in 6, out 1.5k, cached 639.2k · $0.9446
session: /…/.agents/pi/subsessions/….jsonl
changed: src/thing.ts

----- worker-791ede7d reported, verbatim -----
STATUS: complete
…
----- end of report -----
```

The `session:` path is the child's full transcript; read it when a report looks wrong rather than guessing whether the wrapper is stale.

## Transcript records

Async launches have no duplicate status card or dispatch frame in the conversation. Each completed run segment produces one compact line: status glyph, task title, role, and elapsed time. Non-success statuses and unavailable-tool warnings stay visible on that line. **Ctrl+O** expands the full report, error, model, changed files, and session path. Joined waits and sync calls render their outcome directly rather than adding a completion message. Control-tool queries remain ordinary transcript records, not live dashboards.

## Run log

`~/.pi/agent/delegate-runs.jsonl` — one line per run: id, role, model, thinking, context, cwd, **task text**, status, tokens, cost, duration, changed files, dropped tools, error, first 2 KB of output. Child transcripts persist in the working directory the child ran in: `<cwd>/.agents/pi/subsessions/` — `tail -f` one to watch a child live. The full path is in every run-log row (`sessionFile`) and in the expanded outcome record. Each child also has an atomic JSON snapshot of its identity, runtime inputs, stop state, and result. Parent indexes and ownership leases live in the parent's working directory under `.agents/pi/subsessions/owners/`. The directory gets a self-ignoring `.gitignore` (`*`) on creation, so transcripts never reach `git status` or a child's `git add -A`; it is scoped to that directory, so a repo can still track `.agents/` for agent definitions.

## Verification

From this package directory, use Node.js 22.19 or newer:

```sh
npm install
npm run check
```

`check` runs package-local strict TypeScript and `node:test` through `tsx`. No global SDK paths, model accounts, or credentials. Lifecycle tests use the actual Pi SDK and extension against a scripted loopback HTTP provider; only model responses are fixtures. They exercise runtime-only provider inheritance, live reload, fork persistence, wait/cancel/async revival, cancellation during SDK preflight, provider failures/timeouts, automatic idle/busy-parent wake-up, reload-gap delivery, ownership contention, cold inspection, and SIGKILL receipt recovery. Direct tool calls seed parent receipts at the return boundary; automatic notifications use Pi's real delivery path. Crash checks wait for the real 10-second ownership lease to expire.

Run the additional check when its boundary changes:

| Change | Check |
|---|---|
| Manifest, resources, dependencies, install layout | `npm run check:install` |
| Rendering, navigation, input, streaming, focus | `npm run smoke:tui` (requires tmux; regular and fullscreen Pi) |
| Completion, cancellation, delivery, persistence—or their assertions | Scoped mutation of the affected production behavior, after its baseline passes |
| Docs only | Check examples/resource paths; no terminal or model run required |

`check:install` packs the candidate, installs dependencies in an isolated extracted directory, runs the real `pi install`, and checks both tools, packaged roles, and the delegation skill. Pi links local directories without installing dependencies: run `npm install` in a local checkout first. npm/Git installs manage dependencies themselves. To check a published npm or Git source explicitly: `npm run check:install -- npm:@ssweens/pi-delegate@<version>` or `npm run check:install -- git:<repo>@<ref>`; that checks the named source, not uncommitted local changes.

`smoke:tui` runs actual Pi and actual built-in tools with the loopback provider in a private tmux server. It checks native tool disclosure, streaming/follow vs paused scrolling, narrow resize, separate drafts, history, same-ID revival, and finished-frame removal. It prints the temporary evidence directory containing text/ANSI terminal captures, traces, and sessions; it stops only its own tmux server. Parent model wake-up is disabled in this UI fixture and verified separately by lifecycle tests.

For independent review, give the reviewer these runnable commands and the affected contract. They execute the relevant checks rather than accepting an implementer's pass banner. Scope mutation to changed semantics and changed assertions; report survivors/timeouts/uncovered sites separately. No arbitrary score threshold, new role pipeline, or mandatory UI/install run on every edit.

## Not included, on purpose

Missions, lanes, watchdogs, acceptance protocols, preflight/supersession records, councils, schedules, intercom, worktree management. Use a brief, a slash command, or `bash` (`git worktree add`) — none of it belongs in a schema the model reads on every turn.
