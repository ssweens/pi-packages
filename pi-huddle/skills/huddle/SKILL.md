---
name: huddle
description: Use this skill when working in pi's Huddle Mode. Huddle Mode is a safe exploration mode where read operations are always allowed, write operations require user permission, and the gather_input tool enables structured multi-question elicitation with a rich TUI dialog.
---

# Huddle Mode Skill

## Overview

Huddle Mode is a safety feature that allows free read-only exploration while requiring user approval for any file modifications. It also provides the `gather_input` tool for structured elicitation — gathering requirements, clarifying ambiguity, and getting decisions from the user via a rich multi-question TUI dialog.

## When to Use

- **Initial code exploration** - Understanding a new codebase safely
- **Complex refactoring** - Planning multi-step changes before executing
- **Requirements gathering** - Using `gather_input` to clarify intent before acting
- **Safety-critical changes** - When you want explicit approval for each modification

## Commands

| Command | Description |
|---------|-------------|
| `/huddle` | Toggle huddle mode on/off (primary) |
| `/holup` | Toggle huddle mode on/off (alias) |
| `/plan` | Toggle huddle mode on/off (alias) |
| `--huddle` | CLI flag to start pi in huddle mode |
| `--plan` | CLI flag alias (backward compat) |
| `Alt+H` (Option+H on Mac) | Keyboard shortcut to toggle |

## Workflow

### 1. Enter Huddle Mode

```
/huddle      # or /holup, /plan, Alt+H
```

### 2. Just Act — The System Will Ask

**NEVER tell the user to exit huddle mode.** That defeats the purpose.

In huddle mode, you have full access to all tools. The difference is that write operations trigger an inline permission dialog for the user instead of executing immediately. This is a feature, not a restriction.

**When you need to make a change:**
1. Just use `edit` or `write` as you normally would
2. The permission gate will automatically show the user an `[Allow] / [Deny]` prompt
3. The user approves or denies inline — no mode switching required
4. If approved, the operation executes. If denied, you get feedback.

**When you need to run a non-allowlisted bash command:**
1. Just run it (e.g., `npm install`, `git commit`)
2. The user gets a prompt to approve or deny
3. Proceed based on their response

**The user is IN huddle mode because they WANT to be asked before every change.** Do not apologize for this. Do not suggest exiting. Just do the work and let the permission gates handle the asking.

### 3. Permission Gates

**Always Allowed (no prompt):**
- `read`, `grep`, `find`, `ls` - Read and search operations
- `bash` - Allowlisted safe commands (cat, grep, ls, git status, etc.)
- `gather_input` - Structured user elicitation

**Requires Permission (inline prompt):**
- `edit` - File modifications
- `write` - File creation
- Non-allowlisted bash commands (npm install, git commit, etc.)

## gather_input Tool

The `gather_input` tool is available in **both huddle mode and normal mode**. It presents a rich TUI dialog with tabs for each question, multiple-choice options, freeform text input, and a submit/review view.

### When to Use

- Gather user preferences or requirements before acting
- Clarify ambiguous instructions
- Get decisions on implementation choices
- Offer architectural choices with descriptions and code previews

**Huddle mode:** Use `gather_input` to clarify requirements BEFORE finalizing your plan. Do NOT ask "Is my plan ready?" — present your plan and let the permission gates ask the user to approve each step.

### Tool Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `questions` | array | 1–4 questions to ask |
| `questions[].question` | string | Full question text (should end with ?) |
| `questions[].header` | string | Short tab label (max 12 chars). E.g. "Auth method", "Library" |
| `questions[].options` | array | 2–4 options per question |
| `questions[].options[].label` | string | Display text (1–5 words) |
| `questions[].options[].description` | string | Trade-off explanation shown below label |
| `questions[].options[].markdown` | string | Optional code/ASCII preview shown when focused |
| `questions[].multiSelect` | boolean | Allow multiple selections (default: false) |
| `metadata` | object | Optional `{ source }` for tracking |

### UX Behaviour

- **Tab bar** at top — one tab per question + Submit tab; `←`/`→` or `Tab`/`Shift+Tab` navigate
- **Numbered options** — `↑`/`↓` to move, `Enter` to select
- **Freeform field** — navigate to it and start typing immediately; `Enter` confirms the typed answer
- **Chat about this** — last row on each question; returns a "discuss" signal to the agent
- **Submit view** — recap of all answers with `● Question → Answer` format
- **Esc** to cancel at any time

### Example

```json
{
  "questions": [
    {
      "question": "Which approach should I use for error handling?",
      "header": "Errors",
      "options": [
        {
          "label": "Return early (Recommended)",
          "description": "Exit on first error, simplest code path",
          "markdown": "if (err) return { error: err };"
        },
        {
          "label": "Collect errors",
          "description": "Gather all errors, report at end"
        }
      ],
      "multiSelect": false
    },
    {
      "question": "Which features do you want to enable?",
      "header": "Features",
      "options": [
        { "label": "Logging", "description": "Structured JSON logs" },
        { "label": "Metrics", "description": "Prometheus endpoint" },
        { "label": "Tracing", "description": "OpenTelemetry spans" },
        { "label": "Alerts", "description": "PagerDuty integration" }
      ],
      "multiSelect": true
    }
  ]
}
```

### Return Value

```json
{
  "answers": {
    "Which approach should I use for error handling?": "Return early (Recommended)",
    "Which features do you want to enable?": "Logging, Tracing"
  },
  "annotations": {},
  "metadata": {}
}
```

## Allowed Bash Commands (No Prompt)

- File inspection: `cat`, `head`, `tail`, `less`, `more`
- Search: `grep`, `find`, `rg`, `fd`
- Directory: `ls`, `pwd`, `tree`
- Git read: `git status`, `git log`, `git diff`, `git branch`
- Package info: `npm list`, `npm outdated`, `yarn info`
- Utilities: `curl`, `jq`, `uname`, `whoami`, `date`

## Blocked Bash Commands (Prompt Required)

- File mutation: `rm`, `mv`, `cp`, `mkdir`, `touch`
- Git writes: `git add`, `git commit`, `git push`
- Package installs: `npm install`, `yarn add`, `pip install`
- System: `sudo`, `kill`, `reboot`
- Redirections: `>`, `>>` (except benign output suppression like `2>/dev/null` or `2>&1`)

## Tips

1. **Use `gather_input` early** — clarify intent before exploring, not after
2. **Up to 4 questions per call** — batch related questions together
3. **Use `markdown` field** for code previews in option descriptions
4. **multiSelect** for feature flags, configuration choices, etc.
5. **Just do the work** — don't wait for permission. The permission gates exist so the user can approve inline.
