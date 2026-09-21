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
Bounded fix → `delegate_ctl steer` on the same run. The child keeps its context; no new child, no new review. New review only for a `rethink`-class change (decomposition or scope moved). Never re-send an unchanged brief.

## Launching
Children run in the background by default: the call returns a run id, you keep working or yield, and Pi wakes you with the result. Pass `sync: true` only when you cannot finish the turn without the result. Parallel lanes are several background calls with disjoint `cwd` or ownership — one writer per tree.

## The brief
```
OBJECTIVE      observable outcome + acceptance evidence
OWNERSHIP      files/modules owned; explicit exclusions; "not alone in the repo"
INTERFACES     settled signatures, constraints, non-goals
VERIFICATION   exact commands or flows and what success looks like
RETURN         STATUS / CHANGES / VERIFIED / GAPS
```
Omit nothing above; add nothing else.

## Your job after the child returns
Treat the report as a claim. Read the diff (`changed:` in the result), rerun the named verification, observe the behavior when tests alone do not prove it. Then accept, steer, or escalate.

## Model per role — research, then the user approves
Before the first `delegate` of a session run `delegate_ctl action=models`. It reports approved defaults per role, DRIFT (default gone, price changed, approval >30 days, new models, OpenRouter live price or expiration differing from the approval), your own ratings cache, and the catalog across **every** enabled provider verbatim from the registry: one line per offering (`provider/id`, reasoning, context, $/M). OpenRouter offerings additionally carry live facts fetched at call time from OpenRouter's public API: the price that applies **right now** where it differs from the registry, every pricing override — long-context tiers (a fork can cross the threshold) and peak/off-peak windows in UTC with the active one marked `←now` — expiration dates, and Artificial Analysis intelligence/coding/agentic indices. For filtered candidates it also fetches per-provider **endpoints**: each provider's price, promotional discount (the listed price already includes it; the undiscounted price is shown), quantization (fp4/fp8), status and 30-minute uptime, and provider-specific off-peak schedules. Nothing is collapsed or excluded; the default view lists rated offerings ordered by your rating then AA intelligence index, with coding and agentic alongside.

1. **Defaults exist, no DRIFT** → delegate without `model:`.
2. **Ground the choice.** AA indices arrive live on OpenRouter offerings; they attach by exact OpenRouter id only. Whether `some-provider/x` is the same weights as `openrouter/vendor/x` is your judgment — say so. When AA is absent for a candidate, the live fetch failed, or you have evidence beyond AA (observed runs here, other evals, an offering's serving quality), research and store it with `action=rate` per exact offering.
3. **Propose in conversation, in your own words.** One or two sentences: the offering, its price and serving tradeoff (subscription / metered / local / free / peak window), its rating, the alternative you rejected and why. Ask. Use `ask_user` only when the choice is a genuine multi-way fork the user should pick from; otherwise plain prose. Do not launch until they answer.
4. **They agree** → `delegate` with `model:` + `reason:`. If they want it kept, `delegate_ctl action=approve role= model= message=<reason>`. Never call `approve` without their explicit yes in this conversation, and never remind them it is unrecorded.
5. **DRIFT** → before delegating, state what changed and propose a specific replacement with its rating and price; on agreement, `approve` the new one.
6. **They decline** → they will say what to use; retry with it.

Never carry a model name from memory, a doc, or a prior session into a call. Ratings live in `~/.pi/agent/delegate-ratings.json` (yours to refresh); approved defaults in `~/.pi/agent/delegate-models.json` (written by `approve` after the user's yes, or by their editor).
