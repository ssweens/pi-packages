# pi-atta

**@@ session picker for pi** — Type `@@` in your prompt to browse and reference prior sessions.

Inspired by Amp Code's `@@` shortcut.

## Features

- **`@@` trigger** — Type `@@` anywhere in your prompt to open the session picker
- **Fuzzy filter** — Type to search across session names, IDs, first messages, and paths
- **Rich display** — See session name, truncated ID, message count, and last activity time
- **Keyboard navigation** — Arrow keys, Page Up/Down, Home/End
- **Session references** — Selected sessions are inserted as `@session:<path>` references
- **`/atta` command** — Manual picker trigger
- **`Ctrl+@` shortcut** — Quick access from anywhere

## Installation

```bash
# From the pi-packages directory
pi install ./pi-atta

# Or link globally
cd pi-atta && npm link
```

## Usage

### In your prompt

Just type `@@` where you want to reference a session:

```
Look at what we did in @@ and continue that work
```

The picker opens, you select a session, and it becomes:

```
Look at what we did in @session:/path/to/session.jsonl and continue that work
```

### Commands

| Command | Description |
|---------|-------------|
| `/atta` | Open session picker manually |

### Shortcuts

| Shortcut | Description |
|----------|-------------|
| `Ctrl+@` | Open session picker |

## How It Works

1. When you type `@@`, the extension intercepts the input
2. It loads all sessions (cached for 30 seconds)
3. A picker dialog shows sessions with:
   - Session name (if set via `/name`) or first user message
   - Truncated session ID
   - Message count
   - Last activity time (relative: "5m ago", "2h ago", etc.)
4. Type to filter, arrow keys to navigate, Enter to select
5. The `@@` is replaced with `@session:<path>` in your prompt

## Session Reference Format

Selected sessions are referenced as:

```
@session:/Users/you/.pi/agent/sessions/project/session.jsonl
```

The model can use the `session_query` tool (from pi-huddle or similar) to query these sessions for context.

## Requirements

- pi with extension support
- `@mariozechner/pi-coding-agent` (for SessionManager)
- `@mariozechner/pi-tui` (for UI components)

## License

MIT
