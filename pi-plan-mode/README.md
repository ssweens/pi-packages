# pi-plan-mode

A pi package that provides Plan Mode - a safe exploration mode with permission gates for file modifications, similar to Claude Code's Plan mode.

## Features

- **Permission-gated exploration** - Read-only by default, writes require approval
- **Just-in-time permissions** - Approve individual edit/write operations during plan mode
- **Bash allowlist** - Safe commands execute freely, others prompt for permission
- **Simple toggle** - Enter/exit plan mode with `/plan` or `Alt+P`
- **Session persistence** - Plan mode state survives session resume
- **Keyboard shortcut** - Quick toggle with `Alt+P` (Option+P on Mac)

## Installation

### Method 1: Local Path (Recommended for development)

```bash
# Clone or copy this package to a directory, then:
pi install /path/to/pi-plan-mode

# Or for project-local installation:
pi install -l /path/to/pi-plan-mode
```

### Method 2: From Git (if published)

```bash
pi install git:github.com/yourusername/pi-plan-mode
```

## Usage

### Toggle Plan Mode

```bash
/plan                    # Toggle plan mode on/off
Alt+P (Option+P on Mac) # Keyboard shortcut
```

### Start in Plan Mode

```bash
pi --plan               # Start pi directly in plan mode
```

### Workflow

1. **Enter Plan Mode** - Use `/plan` or `Alt+P` (Option+P on Mac)
2. **Explore safely** - Read tools work freely; writes prompt for permission
3. **Exit when ready** - Toggle off plan mode (`/plan` or `Alt+P`) to execute changes

## Permission Gates

During plan mode, operations fall into three categories:

### Always Allowed
- `read` - Read file contents
- `grep` - Search within files
- `find` - Find files
- `ls` - List directories
- `bash` - Allowlisted safe commands
- `questionnaire` - Ask clarifying questions

### Requires Permission
These operations prompt you for approval:
- `edit` - File modifications
- `write` - File creation/overwriting
- **Non-allowlisted bash commands** - Any command outside the safe list

### Permission Dialog

When a gated operation is attempted, you'll see:

```
┌─────────────────────────────────────────┐
│ Plan Mode: Write Permission Required    │
├─────────────────────────────────────────┤
│ Allow edit operation on:                │
│ /path/to/file.ts                        │
│                                         │
│ This will modify files outside of plan  │
│ mode.                                   │
├─────────────────────────────────────────┤
│  [Allow]        [Deny]                  │
└─────────────────────────────────────────┘
```

## Bash Command Categories

### Safe Commands (No Prompt)
- `cat`, `head`, `tail`, `less`, `more`
- `grep`, `find`, `rg`, `fd`
- `ls`, `pwd`, `tree`
- `git status`, `git log`, `git diff`, `git branch`
- `npm list`, `npm outdated`
- `curl`, `jq`, `uname`, `whoami`

### Require Permission Prompt
- `rm`, `mv`, `cp`, `mkdir`, `touch`
- `git add`, `git commit`, `git push`
- `npm install`, `yarn add`, `pip install`
- `sudo`, `kill`, `reboot`
- `>`, `>>` (redirections)
- Any command not in the safe list

## Architecture

```
pi-plan-mode/
├── package.json          # Package manifest with pi configuration
├── extensions/
│   ├── index.ts         # Main extension logic
│   └── lib/
│       └── utils.ts     # Bash command filtering utilities
├── skills/
│   └── plan-mode/
│       └── SKILL.md     # Skill documentation for the agent
└── README.md
```

The package provides:
- **Extension** - Core functionality, permission gates
- **Skill** - Documentation that helps the agent understand plan mode

## Configuration

After installation, your pi settings will include:

```json
{
  "packages": [
    "/path/to/pi-plan-mode"
  ]
}
```

## Development

To modify or extend:

1. Edit files in the package directory
2. Run `/reload` in pi to hot-reload the extension
3. Test with `/plan` command

## License

MIT
