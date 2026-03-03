# pi-compaxxt

```bash
pi install @ssweens/pi-compaxxt
```

Enhanced compaction for [pi](https://github.com/badlogic/pi-mono). Two improvements to every compaction, zero extra LLM calls.

## Features

### Session Context

Every compaction summary is prepended with the current session file path and thread ID:

```markdown
## Session Context
**Session:** `/Users/you/.pi/agent/sessions/abc123/session.jsonl`
**Thread ID:** `e7f2a3c1-...`

Use the `session_query` tool to retrieve specific context from messages that were summarized away.

---

## Goal
...
```

After compaction, the LLM knows exactly where to look if it needs older context that was summarized away. The bundled `session_query` tool makes this retrieval cheap — it doesn't load the full session, just answers a targeted question from it.

### LLM-Judged Important Files

The compaction prompt is augmented to ask the LLM to identify the most goal-relevant files as part of generating the summary. The file sections are restructured:

```xml
<important-files>
src/core/compaction.ts
extensions/handoff.ts
</important-files>

<modified-files>
src/core/compaction.ts
extensions/handoff.ts
src/utils.ts
</modified-files>

<other-read-files>
package.json
docs/api.md
</other-read-files>
```

Files are selected using these criteria:
- Directly related to accomplishing the goal
- Contain reference code or patterns to follow
- Will need to be read, edited, or created
- Provide important context or constraints

`<modified-files>` is left untouched (intentional overlap with important-files is fine). `<read-files>` becomes `<other-read-files>` with the important ones pruned out.

If the LLM doesn't output a parseable `## Most Important Files` section, the extension falls back to the default `<read-files>`/`<modified-files>` format silently.

## Components

| Component | Type | Description |
|-----------|------|-------------|
| [compaction.ts](extensions/compaction.ts) | Extension | `session_before_compact` hook — session context + file restructuring |
| [session-query.ts](extensions/session-query.ts) | Extension | `session_query` tool for querying session history |
| [pi-session-query/](skills/pi-session-query/SKILL.md) | Skill | Instructions for using `session_query` |

## Notes

- If you also have `@ssweens/pi-handoff` installed, both packages register the `session_query` tool. Pi will warn about the duplicate — it's harmless, one will shadow the other.
- Works with `/compact [instructions]` — user instructions are preserved and the file importance prompt is appended after them.
- On any compaction error, falls back to pi's default compaction silently (with a warning notification).

## License

MIT
