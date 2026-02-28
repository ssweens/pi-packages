# pi-file-todos

A [pi](https://github.com/mariozechner/pi-coding-agent) skill package that gives your coding agent a **file-based todo tracking system** — structured markdown files in a `todos/` directory with YAML frontmatter, lifecycle management, dependency tracking, and triage workflows.

No database. No external service. Just markdown files that live in your repo, tracked by git, readable by humans and agents alike.

## Why file-based todos?

- **Version controlled** — todos live in your repo, reviewed in PRs, tracked in git history
- **Agent-native** — coding agents can create, triage, and complete todos without leaving the terminal
- **Human-readable** — every todo is a well-structured markdown file you can read in any editor
- **Zero dependencies** — no SaaS, no database, no API keys — just files
- **Composable** — integrates with code review, PR workflows, and slash commands

## What the skill provides

The `file-todos` skill teaches your agent how to:

- **Create todos** from code review findings, PR comments, or feature requests
- **Name files consistently** using `{id}-{status}-{priority}-{description}.md` conventions
- **Track lifecycle** through `pending → ready → complete` status transitions
- **Manage dependencies** between todos with blocking/unblocking checks
- **Triage pending items** with an interactive approval workflow
- **Maintain work logs** with chronological session records
- **Query and filter** by status, priority, tags, or dependencies

Each todo includes structured sections: Problem Statement, Findings, Proposed Solutions, Acceptance Criteria, and a Work Log — plus a ready-to-use markdown template.

## Installation

```bash
pi install @ssweens/pi-file-todos
```

Or install from a local path:

```bash
pi install /path/to/pi-file-todos
```

## Example workflow

```
You: "Create a todo for the N+1 query in UserService"

Agent: Creates todos/004-pending-p1-fix-n-plus-1-user-service.md
       with problem statement, proposed solutions, and acceptance criteria.

You: "/triage"

Agent: Reviews pending todos, approves 004, renames to
       004-ready-p1-fix-n-plus-1-user-service.md,
       fills in recommended action.

You: "Work on the highest priority todo"

Agent: Finds 004, implements the fix, updates the work log,
       checks acceptance criteria, marks complete.
```

## Quick reference

```bash
# List ready work by priority
ls todos/*-ready-p1-*.md

# List items needing triage
ls todos/*-pending-*.md

# Count by status
for s in pending ready complete; do
  echo "$s: $(ls -1 todos/*-$s-*.md 2>/dev/null | wc -l)"
done

# Find what blocks a todo
grep "^dependencies:" todos/003-*.md

# Search by tag
grep -l "tags:.*performance" todos/*.md
```

## Package structure

```
pi-file-todos/
├── package.json
├── README.md
├── LICENSE
└── skills/
    └── file-todos/
        ├── SKILL.md              # Full skill instructions
        └── assets/
            └── todo-template.md  # Starter template for new todos
```

## License

MIT
