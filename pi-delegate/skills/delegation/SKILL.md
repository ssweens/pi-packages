---
name: delegation
description: Decision rules for delegating work to child agents with the delegate tool — when to delegate at all, which tier, when a review is a gate versus ceremony, and how to correct a child without a re-review loop. Use when considering delegate/delegate_ctl, splitting work across agents, or choosing a model tier for a subtask.
---

# Delegation

Default: do the work yourself. Delegate only when one of three things is true — **context isolation** (fresh-eyes review), **parallelism** over disjoint ownership, or a **tier switch** (a cheaper or stronger model than you). If the brief would be longer than the expected diff, it is not a delegation.

## Configuration per task class

| task class | executor | context | review |
|---|---|---|---|
| bounded change, known repo | you | — | none; you smoke-test and show evidence |
| bounded change, parallelizable across disjoint files | `worker` ×N in the background, distinct `cwd` or worktree | fork | none unless a trigger below fires |
| recon in code you have not read | `scout` | fresh | — |
| complex / risky implementation (debugging with uncertain cause, concurrency, migration, wide blast radius) | `worker` with `model: <strong tier>:high` | fork | `reviewer` after your verification |
| architecture, public API, security boundary, migration plan | you decide; `reviewer` (fresh) before committing to it | fresh | required |

Model is chosen per call from `delegate_ctl models` (below), never from memory or a doc. Escalate on evidence (the child returned `blocked`, or the diff shows complexity you did not specify), not pre-emptively because the task feels important.

## Review triggers
Run `reviewer` only when at least one holds: interface or public API change · security or concurrency · migration · more than ~5 files · behavior you could not observe · the change will be hard to reverse. Otherwise your own verification is acceptance. A review that has never changed an outcome is ceremony — stop running it.

## Correcting a child
Bounded fix → `delegate_ctl steer` on the same run. The child keeps its context; no new child, no new review. A tier switch mid-task is the same call with `model:`, which moves that child to another offering from its next segment on. Steering queues a correction or resumes a finished child in the background and returns immediately. Continue independent work; use `wait` when you need the resumed result. New review only for a `rethink`-class change (decomposition or scope moved). Never re-send an unchanged brief.

## Launching
Children run in the background by default. Keep the returned run id and do independent work. When dependent work needs the result, call `delegate_ctl` with `action: "wait"` and that `runId`; do not poll status in a loop, sleep, or relaunch the child. If you yield without joining, completion wakes you automatically.

## While a child runs
You are woken **once**, when the child finishes. There are no mid-run progress pings, by design: an interrupt per tool call would cost a parent turn for information you did not ask for. The human already sees live progress in the pinned Agents frame.

So waiting is never your job:

- Other work available → do it. Completion wakes you.
- Nothing can proceed without the result → `wait`. It blocks without polling and costs nothing while it waits.
- Someone asks how it is going, or you need to decide whether to let it continue → one `status` read. It reports the current tool, tool calls so far, elapsed time and remaining budget. One read is not a poll loop; repeating it on a timer is.

Never promise to sit idle and report back later, and never tell the user that progress is unavailable.

Size `timeoutMs` to the actual work before launching: the default is 15 minutes, and a build, suite, or training run measured in hours is otherwise aborted mid-flight. A timeout leaves its work in place, unrolled back; read the child's report before continuing.

Before buying more time, read what the time was spent on. A report that says `N provider attempts failed and were retried` means requests died and were retried — a stalled stream, a rate limit, a flaky route — not a model that thinks slowly. Minutes of wall clock with near-zero output tokens is the same signal. Fix or change the offering; granting a broken route a larger budget just buys more failures. Extend the budget when the child is actually working: tool calls advancing, tokens accumulating, turns completing.

Distinguish the three in your own words when you report to the user: the child's work, the provider's failures, and your own budget. Never state one as another.

`wait` returns immediately for a finished run. Cancelling it only detaches the waiter; use `cancel` to stop the child. An attached waiter receives the report instead of a redundant completion wake-up. Check the returned terminal status before acting on the report.

`sync: true` remains available when joining at launch is explicitly needed; a dependency discovered later is not a reason to require it upfront. Parallel lanes are several background calls with disjoint `cwd` or ownership — one writer per tree.

If automatic continuation fails, distinguish child completion, notification delivery, and parent continuation using the transcript and runtime errors. Do not claim the cause from configuration alone or work around it by switching every launch to synchronous.

## Execution model and terminal independence
Keep children in the parent Pi process. Here, **background means asynchronous, not a detached worker**. Use `delegate` and `delegate_ctl` for child coordination. The pinned Agents frame shows only live work; finished children leave one expandable transcript line. For human inspection, `/agents` opens finished-child history; Ctrl+J focuses live children or opens history when idle. Opening history or a child transcript does not restart work.

If work must continue after a terminal disconnect, run the **parent Pi inside tmux**. Use one tmux session per independent workstream, not per subagent. Detach from tmux instead of quitting Pi. Keep using the delegation tools; do not orchestrate children through terminal panes. tmux is optional, not a package dependency.

Distinguish the lifetimes: tmux preserves the running Pi process across terminal disconnects; saved sessions recover conversation context after Pi exits or crashes. Neither keeps in-process children executing after Pi dies or the machine shuts down.

Do not add a detached-worker supervisor merely for terminal independence. Revisit that design only when a concrete task requires children to keep executing after the parent Pi process exits, or requires ownership to move between parent processes.

## Reload and revival
`/reload` reconnects to live children; it does not restart them. Reopening the same parent after exit restores saved children without running work. `status`, `result`, `wait`, and the child view are inspection, not revival.

Use `steer` to revive an inactive child under the same ID, transcript, and saved execution configuration. Do not relaunch just to recover a report. A completed result awaiting delivery is not interrupted execution.

If the child is `interrupted`, inspect its saved work before continuing; tool side effects are not rolled back. If it was explicitly stopped, use `restart: true` only after the user requests a restart. Missing history requires a decision, not a silent replacement.

When the saved offering is gone, rate-limited, or wrong for the remaining work, pass `model:` to that same `steer`. The child continues under its own ID, transcript, tools, and instructions on the offering you name, and later segments keep it; earlier segments keep what they ran on. Choose it like any other model decision — read `models`, propose the offering with its price and serving tradeoff, act on the user's answer. Never relaunch a fresh child to escape an exhausted subscription, and never pick the replacement yourself. A running child refuses the switch: wait for its turn or `cancel` it first.

## The brief
Start with a short task title on its own line. It labels the child in the Agents frame; the UI does not guess a summary.

```
<short task title>
OBJECTIVE      observable outcome + acceptance evidence
OWNERSHIP      files/modules owned; explicit exclusions; "not alone in the repo"
INTERFACES     settled signatures, constraints, non-goals
VERIFICATION   exact commands or flows and what success looks like
RETURN         STATUS / CHANGES / VERIFIED / GAPS
```
Omit nothing above; add nothing else.

## Your job after the child returns

Check `turns`, `failedAttempts` and cost against what you asked for. Three turns and ten minutes for a one-line answer is not a diligent child; it is a provider that failed twice before answering, and the report says so on its own line. The child's words arrive quoted between `----- <id> reported, verbatim -----` and `----- end of report -----`. Everything above that marker is this tool describing the run; everything inside it is the child. A report that reads like your own message is inherited context showing through, not a rendering bug — read the child's `session:` file to settle it.
Treat the report as a claim. Read the diff (`changed:` in the result), rerun the named verification, observe the behavior when tests alone do not prove it. Then accept, steer, or escalate.

## Model per role — research, then the user approves
Before the first `delegate` of a session run `delegate_ctl action=models`. The output is facts only; how to read them:

- **DEFAULTS** — approved `role → provider/id[:thinking]`, age, the reason recorded. **DRIFT** lines mean the approval no longer matches reality (default gone, price changed, older than 30 days, live OpenRouter price or expiration differs, new offerings since approval) — propose a specific update to the user before delegating on that role.
- **RATINGS** — count and age of ratings you stored with `action=rate`; stale past 14 days.
- **OPENROUTER** — live fetch status. When it succeeded, OpenRouter offerings carry live facts by exact id.
- **OFFERINGS** — one line per offering, verbatim from the registry: `provider/id  reasoning|no-reasoning  ctx  $in/$out per M`, then for OpenRouter ids: the price that applies *right now* where it differs from the registry, every pricing override — long-context tiers (`>272k prompt $4/15`) and UTC peak/off-peak windows with the active one marked `←now` — expiration, and Artificial Analysis `AA[intel coding agentic]`. Filtered candidates also list per-provider **endpoints**: price, promotional discount (already included in the listed price; undiscounted shown), quantization, status, 30-min uptime, provider-specific off-peak. Without a filter only rated offerings show (yours first, then AA intelligence); `message=<substring>` searches every offering and every provider of a candidate.

How to weigh what you see — this is your judgment, the tool does not pre-digest it:

- **The same weights on different providers are different offerings.** A subscription is flat-rate (marginal $0, plan limits); a metered API bills per token; a local model may be quantized and slower; a free tier is rate-limited; a `:batch` endpoint is asynchronous and cannot serve a live child. Never treat these as one thing.
- **$0 means the registry reports no marginal cost**, not that the offering is free of limits or quotas.
- **AA indices attach to OpenRouter ids only.** Whether `some-provider/x` is the same weights as `openrouter/vendor/x` is your inference — say so in `reason:`.
- **Timing is a variable.** If a candidate is in a peak window and the task is not urgent, say when it halves.
- **A fork carries the parent's history.** Check `ctx` and long-context tiers against what the child will actually carry. Your delegation tool calls, their results, and completion notices are stripped from it — the child inherits the work, not your orchestration of it.
- **A named provider is the choice.** `provider/id` resolves to that provider only; an unavailable one is reported rather than served by another route.

1. **Defaults exist, no DRIFT** → delegate without `model:`.
2. **Ground the choice.** AA indices arrive live on OpenRouter offerings; they attach by exact OpenRouter id only. Whether `some-provider/x` is the same weights as `openrouter/vendor/x` is your judgment — say so. When AA is absent for a candidate, the live fetch failed, or you have evidence beyond AA (observed runs here, other evals, an offering's serving quality), research and store it with `action=rate` per exact offering.
3. **Propose in conversation, in your own words.** One or two sentences: the offering, its price and serving tradeoff (subscription / metered / local / free / peak window), its rating, the alternative you rejected and why. Ask. Use `ask_user` only when the choice is a genuine multi-way fork the user should pick from; otherwise plain prose. Do not launch until they answer.
4. **They agree** → `delegate` with `model:` + `reason:`. If they want it kept, `delegate_ctl action=approve role= model= message=<reason>`. Never call `approve` without their explicit yes in this conversation, and never remind them it is unrecorded.
5. **DRIFT** → before delegating, state what changed and propose a specific replacement with its rating and price; on agreement, `approve` the new one.
6. **They decline** → they will say what to use; retry with it.

Never carry a model name from memory, a doc, or a prior session into a call. Ratings live in `~/.pi/agent/delegate-ratings.json` (yours to refresh); approved defaults in `~/.pi/agent/delegate-models.json` (written by `approve` after the user's yes, or by their editor).
