# pi-omp — Design

**Status:** Plan / design document (not yet implemented)
**Home:** `~/src/pi-packages/pi-omp` (installed as `@ssweens/pi-omp`)
**Scope:** One consolidated pi extension that ports the *self-contained* best-of-omp behaviors to stock pi.

Everything here is grounded in the actual oh-my-pi source under `~/src/oh-my-pi/packages/coding-agent`. References below (`src/...`) point at omp files to copy/adapt from — **never import them**; treat them as reference implementations (their code depends on `@oh-my-pi/*` internals).

---

## 1. Consolidation decision

| Item (from earlier triage) | Tier | In pi-omp? | Delivery |
|---|---|---|---|
| Personality presets | 1 | ✅ | extension + bundled `.md` |
| Engineering / tool policy prose | 1 | ✅ | extension (appends) |
| `ultrathink` keyword | 1 | ✅ | extension |
| Model-role presets | 1 | ✅ | extension |
| Agent role prompt pack | 1 | ✅ | skills |
| Phased todo tool | 1 | ✅ | extension |
| Auto-thinking classifier | 2 | ✅ | extension |
| Auto-learn (reduced) | 2 | ✅ | extension |
| AI `/commit` | 2 | ✅ | extension |
| **Goal tool** | 2 | ❌ **skipped** | — |
| **Web search / fallback** | 2 | ❌ **skipped** | — |
| Tier-3 (park/revive, IRC, hub, vibe, `local://`, model-hub catalog, advisor, live) | 3 | ❌ out of scope | — |

Two reasons we can bundle all of this as **one** extension instead of eight:

1. They share one loading surface and one domain model. Each feature is a self-contained module under a single `ExtensionAPI` factory, so there is no packaging cost to co-locate them.
2. Most are *always-on behavioral* features that append to the system prompt / register a tool — they compose cleanly in one startup pass with a single config file.

Per-feature opt-in (config) keeps a given user from paying for features they don't want.

---

## 2. Package layout

```
pi-omp/
├── package.json          # pi.extensions + pi.skills + pi.prompts manifest
├── README.md             # short install/usage
├── DESIGN.md             # this file
├── LICENSE
├── extensions/
│   ├── index.ts          # single ExtensionAPI factory; loads submodules, wires config
│   ├── personality.ts    # personas + before_agent_start injection + /personality
│   ├── engineering.ts    # policy prose + tool-conditional prompt append
│   ├── keywords.ts       # ultrathink prose-aware detection + notice injection
│   ├── roles.ts          # model-role resolution (port of priority.json) + /role
│   ├── todo.ts           # phased todo tool + /todo + completion reminders
│   ├── autothinking.ts   # classifier + clamp + setThinkingLevel
│   ├── autolearn.ts      # agent_end gate → managed skills
│   └── commit.ts         # /commit command (git diff + conventional validation)
├── skills/
│   └── pi-omp/
│       ├── SKILL.md                  # pointer to the bundled role pack below
│       └── agents/
│           ├── scout/SKILL.md
│           ├── reviewer/SKILL.md
│           ├── security-reviewer/SKILL.md
│           ├── librarian/SKILL.md
│           └── designer/SKILL.md
├── prompts/                          # bundled text (loaded by extensions, not applied by pi)
│   ├── personalities/{default,friendly,pragmatic}.md
│   ├── classifiers/{auto-thinking-difficulty, auto-thinking-difficulty-local}.md
│   ├── notices/{ultrathink, engineering-policy}.md
│   └── commit/{system,type-scope,validate}.md
└── src/                              # pure logic (no pi imports) — unit-testable
    ├── todo-markdown.ts              # phasesToMarkdown / markdownToPhases round-trip
    ├── role-resolver.ts              # labeled role → ordered model patterns
    ├── keyword-detect.ts             # prose-aware keyword boundaries
    └── auto-think.ts                 # label parse + effort clamp against model ladder
```

> **Why `prompts/` is declared in `pi.prompts` AND read by extensions:** a few files are genuinely useful as invocable templates (`/review`, `/scout` role one-shots), but the always-on ones (personality, engineering policy) are read as files by `before_agent_start` and appended, so `pi.prompts` gives users the templates and the extension still reads them for injection. Duplicate exposure is intentional and documented.

---

## 3. Configuration

Single object in `~/.pi/agent/pi-omp.json` merged with `.pi/pi-omp.json` (project wins). The `index.ts` loads it once at factory time and reads values during `session_start`.

```jsonc
{
  "persona": "default",               // default | friendly | pragmatic
  "personas": {                       // overridable per-persona text
    "default": "./prompts/personalities/default.md",
    "friendly": "./prompts/personalities/friendly.md",
    "pragmatic": "./prompts/personalities/pragmatic.md"
  },
  "engineeringPrompt": true,          // append engineering-policy block
  "todo": {
    "enabled": true,
    "file": "TODO.md",                // export/import path
    "defaultPhase": "Tasks",
    "reminders": true
  },
  "roles": {                          // port of omp priority.json, order = preference
    "smol":  ["provider/model*…"],
    "slow":  ["provider/model*…"],
    "plan":  ["…"],
    "vision": ["…"],
    "designer": ["…"],
    "commit": ["…"],
    "task": ["…"]
  },
  "ultrathink": true,
  "autoThinking": {
    "enabled": false,                 // opt-in (nested model calls)
    "classifierModel": "@smol",
    "localLabels": false,             // use -local classifier prompt
    "timeoutMs": 4000
  },
  "autoLearn": { "enabled": false },
  "commit": { "dryRun": true }
}
```

---

## 4. Feature specs

### 4.1 Personality (`extensions/personality.ts`)

**Port from:** `src/prompts/system/personalities/{default,friendly,pragmatic}.md` (pure prose, verified zero omp deps).

- `session_start` → read active persona file into memory.
- `before_agent_start` → `return { systemPrompt: event.systemPrompt + "\n\n" + personaText }`.
- `registerCommand("personality", …)` → `ctx.ui.select` among personas + persist choice to `pi-omp.json`.
- Config key `persona` is the default.

**pi API:** `before_agent_start`, `registerCommand`, `ctx.ui.select`, fs read.

### 4.2 Engineering / tool policy (`extensions/engineering.ts`)

**Port from:** selected sections of `src/prompts/system/system-prompt.md` (Engineering Principles, Tool Policy, Research Before Editing, Verification, Delivery/Completeness, "NEVER yield while actionable work remains"). Strip omp tool names and `agent://`/`xd://` protocols; keep only real stock-pi tools.

- `before_agent_start` appends the static policy block.
- The *tool-conditional* fragment is parameterized via `event.systemPromptOptions.selectedTools` so it advertises only tools pi actually exposes (e.g. only mention `lsp` if present).

**pi API:** `before_agent_start`, `event.systemPromptOptions.selectedTools`.

### 4.3 `ultrathink` keyword (`extensions/keywords.ts`)

**Port from:** `src/modes/ultrathink.ts` + its detection + notice prompt.

- `input` event → run `src/keyword-detect.ts` (case-sensitive, prose boundaries only: no inline/fenced code, no XML/HTML). Store flag in extension state.
- `before_agent_start` → if flag set, append compiled `<system-notice>` block; clear flag.
- Additional keywords (e.g. a configurable `workflowz` that injects a "decompose + parallelize" notice) follow the same path and are gated behind config.

**pi API:** `input` (return `{ action: "continue" }`), `before_agent_start`.

### 4.4 Model-role presets (`extensions/roles.ts`)

**Port from:** `src/priority.json`, `src/config/model-roles.ts`, `src/config/model-resolver.ts` (concept only — the resolver is too omp-coupled; reimplement the pattern matching).

- `src/role-resolver.ts`: given a role name + `ctx.modelRegistry.getAvailable()`, walk the ordered model-pattern list and return the first matching model. Patterns support `provider/model`, bare `model`, wildcard, and `:thinkingSuffix`.
- `registerCommand("role", …)` → `ctx.ui.select` among roles → `pi.setModel()` + `pi.setThinkingLevel()`.
- `registerShortcut` for quick cycling.
- Optionally emit a status line via `ctx.ui.setStatus`.

**pi API:** `ctx.modelRegistry.getAvailable()/find()`, `pi.setModel()`, `pi.setThinkingLevel()`, `registerCommand`, `registerShortcut`, `ctx.ui`.

> pi already ships a `preset.ts` example — reuse its config/persistence shape rather than reinventing. pi-omp's roles generalize it with the labeled role table.

### 4.5 Agent role prompt pack (`skills/pi-omp/agents/*`)

**Port from:** `src/prompts/agents/{scout,reviewer,security-reviewer,librarian,designer}.md`. These are Markdown role bodies (role + tool restrictions + output contract) exported from YAML frontmatter.

Shipped as **skills** (each role = one `SKILL.md`), because skills are the pi-native, on-demand capability mechanism and carry the tool/grounding rules in the body. `skills/pi-omp/SKILL.md` describes the pack; `skills/pi-omp/agents/*/SKILL.md` are indvidual roles. A role can be forced with `/skill:scout`.

Optional: mirror the one-shot review entrypoint as a `prompts/review.md` **template** → `/review`.

**pi API:** none at runtime — pure content via `pi.skills`; optional `prompts/*` template.

### 4.6 Phased todo tool (`extensions/todo.ts`)

**Port from:** `src/tools/todo.ts` (schema + ops + `phasesToMarkdown`/`markdownToPhases`), `src/session/todo-tracker.ts` (reminder behavior only).

- `registerTool("todo", …)` with sub-ops `init|start|done|drop|block|unblock|rm|append|view`. Tasks addressed by content string; one `in_progress`; completing auto-promotes the next open task.
- Persistence via `pi.appendEntry()`/`ctx.sessionManager` rebuild from last successful result (omp-style), **plus** optional `TODO.md` export/import through pure functions in `src/todo-markdown.ts`.
- `registerCommand("todo", …)` with `edit|copy|export|import|append|start|done|drop|rm` subcommands.
- Reminders: `agent_end` detects unfinished items → `ctx.sendUserMessage()` bounded nag; suppress while asking a question, and cap reminder count (port the *rules*, not the async-toggle internals).
- A bounded `ctx.ui.setWidget` todo panel above the editor, synchronized after every state transition and restored on session/branch navigation.

**pi API:** `registerTool`, `registerCommand`, `pi.appendEntry`, `ctx.sessionManager`, `agent_end`, `before_agent_start`, `ctx.sendUserMessage`, `ctx.ui`.

### 4.7 Auto-thinking (`extensions/autothinking.ts`)

**Port from:** `src/auto-thinking/classifier.ts` (prompts + control flow), `src/thinking.ts` (clamping). Opt-in.

- `before_agent_start`, when `autoThinking.enabled` and active model is a reasoning model:
  1. classify `event.prompt` with `completeSimple` against `classifierModel`.
  2. parse label (`low|medium|high|xhigh`, or local `trivial|moderate|hard`).
  3. clamp via model ladder (`ctx.model` supported efforts).
  4. `pi.setThinkingLevel(level)`.
  5. Guard: `ctx.signal` abort, 4s timeout, keep prior level on failure, skip if prompt-generation changed (`turn_start` version counter).
- `ultrathink` bypasses classification → highest supported level.

**pi API:** `before_agent_start` (`event.prompt`, `ctx.model`), `completeSimple` (from `@mariozechner/pi-ai`), `pi.setThinkingLevel`, `ctx.signal`, `thinking_level_select` (status display).

> Stock pi tops out at `xhigh`; omp's `max` tier is dropped (documented).

### 4.8 Auto-learn (`extensions/autolearn.ts`)

**Port from:** `src/autolearn/controller.ts` (gate) + `src/autolearn/managed-skills.ts` (secure manager). Opt-in.

- `agent_end` → if the turn had enough mutating tool activity, queue a *visible* follow-up prompt to offer capturing the lesson.
- Capture produces a managed skill under a dedicated skills dir, retaining omp's name/size/delimiter/symlink/hardlink protections (port from `managed-skills.ts`).
- **No hidden synthetic turns** (differs from omp — pi's prompt caching / session semantics make hidden messages risky).

**pi API:** `agent_end`, `ctx.sendUserMessage`, `pi.appendEntry`, fs + managed-skill helpers.

### 4.9 `/commit` (`extensions/commit.ts`)

**Port from:** `src/commit/pipeline.ts` + `src/commit/prompts/` (concept). Opt-in / command-driven.

- `registerCommand("commit", …)`:
  1. inspect staged diff via git helpers.
  2. map-reduce large diffs (type/scope/details analysis).
  3. validate conventional-commit format; retry invalid messages.
  4. dry-run by default (config `commit.dryRun`); only commit on explicit `--push`/confirm.
- Reuse pi's own `utils/git` if exposed, else spawn `git` via Bun shell.

**pi API:** `registerCommand`, `ctx.ui.confirm`, Bun shell, bundled prompts read from `prompts/commit/*.md`.

---

## 5. Single wiring point (`extensions/index.ts`)

The factory is deliberately thin — it loads config, then calls each feature module's `install(pi, cfg)` so the whole thing stays one extension while each module remains independently removable:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PiOmpConfig } from "../src/config";
import { installPersonality } from "./personality";
import { installEngineering } from "./engineering";
// …installKeywords, installRoles, installTodo, installAutoThinking,
//   installAutoLearn, installCommit

export default function (pi: ExtensionAPI) {
  const cfg = loadConfig();                 // merge global + project pi-omp.json
  installPersonality(pi, cfg);
  installEngineering(pi, cfg);
  installKeywords(pi, cfg);
  installRoles(pi, cfg);
  installTodo(pi, cfg);
  if (cfg.autoThinking.enabled) installAutoThinking(pi, cfg);
  if (cfg.autoLearn.enabled) installAutoLearn(pi, cfg);
  if (cfg.commit.enabled) installCommit(pi, cfg);
}
```

---

## 6. Commands, tools, events — total surface

- **Commands:** `/personality`, `/role`, `/todo`, `/commit` (+ optional `/review` template)
- **Tools:** `todo`, (optional `role`), (optional learn/commit helpers)
- **Events used:** `session_start`, `before_agent_start`, `input`, `agent_end`, `turn_start`
- **UI:** `ctx.ui.select/confirm`, `ctx.ui.setStatus`, `ctx.ui.setWidget` (sticky todo widget)
- **Model:** `pi.setModel`, `pi.setThinkingLevel`; read `ctx.modelRegistry`, `ctx.model`

---

## 7. Ordering of implementation (each module independently shippable)

1. **personality** — smallest, highest immediate fidelity (~15 min).
2. **engineering** — static append reusing #1's hook.
3. **keywords (ultrathink)** — standalone detection + injection.
4. **todo** — highest daily value; the biggest single module.
5. **roles** — on top of pi's `preset.ts` shape.
6. **skills role pack** — pure content, no code.
7. **autothinking** — needs #5's resolver + classifier model; opt-in.
8. **autolearn** — opt-in.
9. **commit** — opt-in.

---

## 8. Verification

- Each module ships a `bun test` for its `src/` pure logic: `todo-markdown.ts` round-trip, `role-resolver.ts` pattern matching, `keyword-detect.ts` boundary cases, `auto-think.ts` clamp.
- Behavioral validation in a live pi session: `/personality friendly` then confirm the system prompt changes; run `todo` ops and confirm persistence across `/new`; `/role @smol` then confirm `model_select`; `ultrathink` prompt → confirm notice present; `agent_end` reminder fires once with unfinished todos.
- UI changes are screenshotted per `pi-packages/README.md` capture flow.

---

## 9. Rejected / deferred (recorded so we don't relitigate)

- **Full plan mode** — pi's own `plan-mode` example covers the common 80%; a faithful port needs write-gating across every mutation tool.
- **Subagent park/revive, IRC peer messaging, `hub` supervision, vibe/director** — no child-session API in stock pi; not "easy extensions."
- **`local://`/`agent://` artifact protocols** — pi has no internal-URL concept.
- **Full model hub / catalog auto-derivation** — needs model-metadata overlay hooks pi doesn't expose.
- **`advisor`** — second-agent orchestration.
- **Local `memories/`** — SQLite lease lifecycle is omp-coupled.
- **`live` voice** — native audio + Codex Bidi.
