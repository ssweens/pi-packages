# pi-handoff

![pi-handoff command](screenshot.png)

```bash
pi install @ssweens/pi-handoff
```

Context handoff extension for [pi](https://github.com/badlogic/pi-mono). Transfer context to a new session with a structured summary — three entry points, one UX.

## Features

- **`/handoff <goal>`** — User-initiated context transfer to a focused new session
- **Agent-callable tool** — The model can initiate handoffs when explicitly asked
- **Auto-handoff on compaction** — Offered as an alternative when context gets full
- **Parent session query** — `session_query` tool for looking up details from prior sessions
- **Programmatic file tracking** — Read/modified files extracted from tool calls (same as pi's compaction)
- **Structured format** — Aligned with pi's compaction format (Goal, Constraints, Progress, Key Decisions, Next Steps, Critical Context)
- **System prompt hints** — The model knows about handoffs and suggests them proactively

## Installation

```bash
pi install @ssweens/pi-handoff
```

## Usage

### `/handoff <goal>`

```
/handoff now implement this for teams as well
/handoff execute phase one of the plan
/handoff check other places that need this fix
```

**What happens:**
1. LLM generates a structured handoff prompt from your conversation
2. New session opens
3. Prompt appears in the editor for review
4. Press Enter to send — agent starts working

### Agent-Initiated Handoff

Ask the model directly:

```
"Please hand this off to a new session"
```

The agent calls the `handoff` tool. Session switch is deferred until the current turn completes, then the same flow: new session → prompt in editor → press Enter.

### Auto-Handoff on Compaction

When context gets full and auto-compaction triggers, you're offered a choice:

```
Context is 92% full. What would you like to do?
> Handoff to new session
  Compact context
  Continue without either
```

Select "Handoff" → same flow: LLM generates prompt → new session → prompt in editor → press Enter. If you cancel or it fails, compaction proceeds as normal.

### Querying Parent Sessions

Handoff prompts include a parent session reference:

```
/skill:pi-session-query

**Parent session:** `/path/to/old-session.jsonl`

## Goal
...
```

The `session_query` tool lets the model look up details from the parent session without loading the full conversation:

```typescript
session_query("/path/to/session.jsonl", "What files were modified?")
session_query("/path/to/session.jsonl", "What approach was chosen?")
```

## Handoff Format

Aligned with pi's compaction format, with programmatic file tracking appended:

```markdown
## Goal
What the user wants to accomplish.

## Constraints & Preferences
- Requirements or preferences stated

## Progress
### Done
- [x] Completed work

### In Progress
- [ ] Current work

### Blocked
- Open issues

## Key Decisions
- **Decision**: Rationale (path/to/file.ts:42)

## Next Steps
1. What should happen next

## Critical Context
- Data or references needed to continue

<read-files>
src/config.ts
</read-files>

<modified-files>
src/handler.ts
src/auth.ts
</modified-files>
```

## Components

| Component | Type | Description |
|-----------|------|-------------|
| [handoff.ts](extensions/handoff.ts) | Extension | `/handoff` command, `handoff` tool, compact hook, system prompt hints |
| [session-query.ts](extensions/session-query.ts) | Extension | `session_query` tool for querying parent sessions |
| [pi-session-query/](skills/pi-session-query/SKILL.md) | Skill | Instructions for using `session_query` |

## Architecture

Three entry points, one outcome:

| Entry Point | Context Type | Session Creation |
|-------------|-------------|-----------------|
| `/handoff` command | `ExtensionCommandContext` | `ctx.newSession()` (full reset) |
| `handoff` tool | `ExtensionContext` | Deferred to `agent_end` via raw `sessionManager.newSession()` |
| Compact hook | `ExtensionContext` | Raw `sessionManager.newSession()` (no agent loop running) |

All three end the same way: prompt in editor of new session → user presses Enter → agent starts.

## License

MIT
