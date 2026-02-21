---
name: pi-session-query
description: Query previous pi sessions to retrieve context, decisions, code changes, or other information. Use when you need to look up what happened in a parent session or any other session file.
disable-model-invocation: true
---

# Pi Session Query

Query pi session files to retrieve context from past conversations.

This skill is automatically invoked in handed-off sessions when you need to look up details from the parent session.

## When to Use

- When the handoff summary references a "Parent session" path
- When you need specific details not included in the handoff summary
- When you need to verify a decision or approach from the parent session
- When you need file paths or code snippets from earlier work

## Usage

Use the `session_query` tool:

```
session_query(sessionPath, question)
```

**Parameters:**
- `sessionPath`: Full path to the session file (provided in the "Parent session:" line)
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
4. **Don't over-query** - The handoff summary should have most context; query only when needed

## How It Works

The tool loads the referenced session file, extracts the conversation history, and uses the LLM to answer your question based on its contents. This allows context retrieval without loading the full parent session into your context window.
