# pi-omp

Consolidated pi extension that ports omp's best **self-contained** behaviors to stock pi, as a single package.

> **Status:** implemented. Install, then open the settings view with **`/omp`** to toggle each feature on/off.

## What it bundles

Each feature is opt-in and toggled in the settings view:

| Feature | What it gives you | Default |
|---|---|---|
| **Personas** | omp's terse evidence-first `default` voice, plus `friendly` / `pragmatic` — `/personality` | on |
| **Engineering policy** | omp's tool-policy / verification / "never yield incomplete" prose | on |
| **Model roles** | labeled presets (`@smol`, `@slow`, `@plan`, `@vision`, `@commit`, `@task`) — `/role`, `ctrl+shift+r` | on |
| **Phased todos** | omp-style phased `todo` tool + `/todo`, bounded above-editor task widget, `TODO.md` round-trip, and bounded reminders | on |
| **`ultrathink`** | standalone prose keyword that injects a reasoning notice | on |
| **Agent role pack** | `scout`, `reviewer`, `security-reviewer`, `librarian`, `designer` skills | on |
| **Auto-thinking** | classify the prompt with a cheap model, then set thinking level before the turn | off |
| **Auto-learn** | `agent_end` gate that offers to capture lessons | off |
| **AI `/commit`** | conventional-commit analysis + validation (dry-run by default) | off |

**Settings view:** `/omp` opens a toggle panel — ↑/↓ move, `space` toggle, `enter` save + reload, `esc` cancel.

## Install

From a local checkout:

```bash
pi install /Users/ssweens/src/pi-packages/pi-omp
```

Or once published:

```bash
pi install @ssweens/pi-omp
```

## Configure

`~/src/pi-packages/pi-omp/DESIGN.md` §3 defines `~/.pi/agent/pi-omp.json` (global) and `.pi/pi-omp.json` (project). Example:

```jsonc
{
  "persona": "default",
  "engineeringPrompt": true,
  "todo": { "enabled": true, "file": "TODO.md", "reminders": true },
  "ultrathink": true,
  "autoThinking": { "enabled": false }
}
```

## Development

```bash
cd /Users/ssweens/src/pi-packages/pi-omp
bun install
bun test          # pure-logic tests (todo-markdown, role-resolver, keyword-detect, auto-think)
pi -e extensions/index.ts   # quick smoke against a live session
```
