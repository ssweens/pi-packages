# pi-delegate

Install: `pi install npm:@ssweens/pi-delegate`, `pi install git:<repo>`, or `pi install ./pi-delegate`. The two tools, the `delegation` skill, and the default roles all ship in the package — nothing is copied to `~/.agents`.

Minimal delegation for pi. Two tools, role files, fork context, steer, honest run log. Replaces pi-subagents (125 schema params, 14.8k lines, 11 tools in context) and pi-strings for the delegation you actually do.

## Tools

**`delegate({ role, task, model?, reason?, context?, cwd?, timeoutMs?, sync? })`**
Runs `role` on `task` in its own in-process session (`createAgentSession`, no extensions/skills loaded — built-in tools only). Returns final report, changed files, turns, tokens, cost, run id, and the child's session file path. Refuses a second writing child in a `cwd` that already has one running.

- `context: "fork"` (default) — child starts with the parent's conversation so far (`buildSessionContext` of the active branch, trailing unresolved tool call trimmed). No re-acquisition.
- `context: "fresh"` — adversarial/independent review.
- `model: "provider/id[:thinking]"` — tier switch at call time; no new role needed.
- Background by default — returns a run id at once; the parent is woken via `sendMessage(followUp, triggerTurn)` when the child finishes. `sync: true` blocks, for when the result is needed inside the current turn.

**`delegate_ctl({ action: models|rate|roles|status|result|steer|cancel, runId?, message?, ratings? })`**
`models` reports approved defaults per role, DRIFT against the live catalog (default unavailable · price changed · approval >30 days · new offerings · OpenRouter live price or expiration differs), your ratings cache, and the catalog across **all** enabled providers exactly as the registry reports it: one line per offering, `provider/id`, reasoning flag, context window, $/M in/out. Nothing is deduplicated, excluded, scoped, or ranked by price — the same weights on a subscription, a metered API, a local box, and a free tier are different offerings and the agent weighs them in the open.

For OpenRouter offerings it also fetches the public API (no key; 10-minute in-memory cache; 8 s timeout; on failure it says so and shows registry data):

- `GET /api/v1/models` once per call — appended per offering by exact id: live price where it differs from the registry (top-level pricing is what applies **right now** per the spec), every `pricing.overrides` entry rendered as stated — long-context tiers (`>272k prompt $4/15`) and UTC peak/off-peak windows (`mon…fri 06:00–10:00Z $0.3/1.2 ←now`) — with entries carrying unrecognized condition fields skipped and counted, per the spec; `request` cost when non-zero; expiration date; Artificial Analysis intelligence / coding / agentic indices.
- `GET /api/v1/models/{author}/{slug}/endpoints` for filtered OpenRouter candidates (first 12) — one line per provider endpoint: price, promotional `discount` (verified against sibling endpoints that the listed price already includes it; the undiscounted price is shown), quantization, non-zero status, 30-minute uptime, context, and the endpoint's own overrides (provider-specific off-peak).

Models live on OpenRouter but absent from the registry are listed separately (usable after adding to `models.json`). The default view lists offerings that have a rating (yours or AA), ordered by your rating then AA intelligence index; `message=<substring>` searches every offering and every provider of a candidate.

`rate` stores ratings the agent researched, keyed by exact `provider/id` (`[{model, score, source, note?}]`), in `~/.pi/agent/delegate-ratings.json`; reported stale after 14 days. Ratings appear on `models` lines.

## Model approval

A `delegate` call resolves its model as `model:` param → approved default for the role → role file → your current model, and runs. There is no dialog: proposing a non-default model is a conversation — the agent states offering, price, tradeoff, rating, asks, and launches on your answer. `delegate_ctl action=approve role= model= message=` records a default in `~/.pi/agent/delegate-models.json`; the skill forbids calling it without your explicit yes in the conversation. The file also snapshots the catalog so `models` can report drift and new offerings since approval.

## Rendering (transcript frames)

Both tools render their own frame (`renderShell: "self"`), following oh-my-pi's task renderer: rounded border with `◆ delegate: <role>` in the top bar; a status line `✓ <id>: <task first line> ⟨fork N⟩ [done] · N ⚙ · N turns · ctx%/window · $cost · model · duration`; collapsed `Output` shows three dim lines, expanded (ctrl+o) shows `Task`, the report as rendered markdown, and the child session path; `Changed:`, dropped tools, and errors follow. While a child runs the frame shows a spinner and its recent tool calls, and keeps updating from live run state — background launches flip to `[done]` in place; the wake message is a one-line frame that expands to the full result. The call preview collapses once a result exists.

## Watching children

Three surfaces, each with one job and its own shape — nothing is shown twice:

- **Frame** (transcript) is the *record*. While a child runs it is one static dim line: `⋮ id: brief ⟨ctx⟩ · dispatched · model`. No spinner, no progress. When the child finishes it becomes the result frame (status line, output, changed files; expanded: task, markdown, session path).
- **Rail** (pinned above the editor) is the *only live view*. Present while any child runs, gone when none do. One OMP-style row per run — spinner, id, brief, `⟨fork N⟩`, elapsed, tool count, cost — and a hook line with the current tool call (warning-colored past 5 s). Off the scroll region, so it cannot scroll away.
- **Inspector** (`ctrl+j`) is *depth*. Opens straight into one child's transcript tail: the brief `▸`, tool calls `→`, assistant text `▎`, refreshed every 250 ms. One stats line (context, elapsed, tools, cost, model, changed files). `←→`/`tab` switch child (header shows `2/3`); `↑↓` scroll; `s` steer (one line; finished children resume in their own session); `c` cancel; `o` puts `pi --session <path>` in your editor; `q`/`esc` close. Closing never stops the child.

## Run log

`~/.pi/agent/delegate-runs.jsonl` — one line per run: id, role, model, thinking, context, cwd, **task text**, status, tokens, cost, duration, changed files, dropped tools, error, first 2 KB of output. Child transcripts persist in the working directory the child ran in: `<cwd>/.agents/pi/subsessions/` — `tail -f` one to watch a child live. The full path is in every run-log row (`sessionFile`) and in the expanded result frame. The directory gets a self-ignoring `.gitignore` (`*`) on creation, so transcripts never reach `git status` or a child's `git add -A`; it is scoped to that directory, so a repo can still track `.agents/` for agent definitions.

## Not included, on purpose

Missions, lanes, watchdogs, acceptance protocols, preflight/supersession records, councils, schedules, intercom, worktree management. Use a brief, a slash command, or `bash` (`git worktree add`) — none of it belongs in a schema the model reads on every turn.
