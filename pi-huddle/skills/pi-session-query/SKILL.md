---
name: pi-session-query
description: Query previous pi sessions to retrieve context, decisions, code changes, or other information. Use when you need to look up what happened in a parent session or any other session file.
disable-model-invocation: true
---

# Pi Session Query

Query pi session files to retrieve context from past conversations.

This skill is automatically invoked whenever you need to look up details from prior sessions (handoff parent sessions or general historical runs).

## When to Use

- When the handoff summary references a "Parent session" or "Ancestor sessions" path
- When you need specific details not included in the handoff summary
- When you need to verify a decision or approach from the parent or an ancestor session
- When you need file paths or code snippets from earlier work
- When the user asks "what did we do before?" and you need to mine `~/.pi/agent/sessions`

## Usage

### Step 1: Find candidate sessions (if path is unknown)

Use safe shell search over `~/.pi/agent/sessions`:

```bash
fd session.jsonl ~/.pi/agent/sessions
rg -n "oauth|timeout|pi-footsie" ~/.pi/agent/sessions
```

Optionally narrow interactively with `fzf` and inspect with `bat`, `head`, or `tail`.

### Step 2: Ask targeted questions with `session_query`

```ts
session_query(sessionPath, question)
```

**Parameters:**
- `sessionPath`: Full path to the session file (provided in the "Parent session:" line or discovered via `fd`/`rg`)
- `question`: Specific question about that session

## Examples

```typescript
// Find what files were changed
session_query("/path/to/session.jsonl", "What files were modified?")

// Get approach details
session_query("/path/to/session.jsonl", "What approach was chosen for authentication?")

// Get specific code decisions
session_query("/path/to/session.jsonl", "What error handling pattern was used?")

// Summarize key decisions
session_query("/path/to/session.jsonl", "Summarize the key decisions made")
```

## Best Practices

1. **Be specific** - Ask targeted questions for better results
2. **Reference code** - Ask about specific files or functions when relevant
3. **Verify before assuming** - If the handoff summary seems incomplete, query for details
4. **Don't over-query** - Query only what you need; avoid broad "summarize everything" asks
5. **Check ancestors** - If the parent session doesn't have the info, try ancestor sessions listed in the handoff
6. **Search first, query second** - Use `fd`/`rg` to locate likely sessions, then `session_query` for precise retrieval

## How It Works

The tool loads the referenced session file, extracts the conversation history, and uses the LLM to answer your question based on its contents. This allows context retrieval without loading the full parent session into your context window.
