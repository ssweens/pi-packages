---
name: plan-mode
description: Use this skill when working in pi's Plan Mode. Plan Mode is a safe exploration mode where read operations are always allowed but write operations require user permission. The agent can analyze code freely and request permission for individual edits when needed.
---

# Plan Mode Skill

## Overview

Plan Mode is a safety feature that allows free read-only exploration while requiring user approval for any file modifications.

## When to Use

- **Initial code exploration** - Understanding a new codebase safely
- **Complex refactoring** - Planning multi-step changes before executing
- **Safety-critical changes** - When you want explicit approval for each modification
- **Learning** - Understanding how something works with the option to make small fixes

## Workflow

### 1. Enter Plan Mode

Use one of these methods:
- Type `/plan` command
- Press `Alt+P` (Option+P on Mac)
- Start pi with `--plan` flag

### 2. Permission Gates

Tools operate in three modes during plan mode:

**Always Allowed:**
- `read`, `grep`, `find`, `ls` - Read and search operations
- `bash` - Allowlisted safe commands (cat, grep, ls, git status, etc.)
- `questionnaire` - Ask clarifying questions

**Requires Permission:**
- `edit` - File modifications (user must approve each edit)
- `write` - File creation (user must approve each write)
- Non-allowlisted bash commands (npm install, git commit, etc.)

### 3. Requesting Permission

If you need to make a small edit during exploration:
1. Attempt the `edit` or `write` tool
2. The user will see a permission dialog
3. If approved, the operation proceeds
4. If denied, you'll need to continue in read-only mode

**Important:** Even if a permission is denied, you remain in plan mode. You can continue exploring.

### 4. Exit Plan Mode

When ready to execute changes:
- User toggles off plan mode with `/plan` or `Alt+P`
- Full tool access restored
- No more permission prompts

## Permission Dialogs

The user will see prompts like:

**For write operations:**
```
Plan Mode: Write Permission Required
Allow edit operation on:
/path/to/file.ts

This will modify files outside of plan mode.
[Allow] [Deny]
```

**For bash commands:**
```
Plan Mode: Bash Permission Required
Allow potentially destructive bash command:
npm install lodash

This command is not in the allowlist.
[Allow] [Deny]
```

## Allowed Bash Commands (No Prompt)

- File inspection: `cat`, `head`, `tail`, `less`, `more`
- Search: `grep`, `find`, `rg`, `fd`
- Directory: `ls`, `pwd`, `tree`
- Git read: `git status`, `git log`, `git diff`, `git branch`
- Package info: `npm list`, `npm outdated`, `yarn info`
- System info: `uname`, `whoami`, `date`, `uptime`
- Network: `curl`, `wget -O -`
- JSON: `jq`

## Blocked Bash Commands (Will Prompt)

- File modification: `rm`, `mv`, `cp`, `mkdir`, `touch`
- Git write: `git add`, `git commit`, `git push`
- Package install: `npm install`, `yarn add`, `pip install`
- System: `sudo`, `kill`, `reboot`
- Redirections: `>`, `>>`

## Commands

| Command | Description |
|---------|-------------|
| `/plan` | Toggle plan mode on/off |
| `Alt+P` (Option+P on Mac) | Keyboard shortcut to toggle |

## Tips

1. **Start with broad exploration** - Use read-only tools to understand the codebase
2. **Request permission for small fixes** - If you spot a typo, you can request to fix it immediately
3. **Don't abuse permissions** - If the user denies an edit, respect that and continue planning
4. **Be specific in requests** - "Analyze the auth system" vs "Look at the code"
5. **Exit when ready** - User controls when to leave plan mode and execute changes
