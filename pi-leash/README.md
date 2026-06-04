# Pi Leash

Security hooks for Pi to reduce accidental destructive actions and secret-file access.

Forked from [`@aliou/pi-guardrails`](https://github.com/aliou/pi-guardrails) (MIT) with added **sudo mode** for secure password handling and an opt-in in-memory password cache. See [Credits & Attribution](#credits--attribution) below for details.

## Install

```bash
pi install npm:@ssweens/pi-leash
```

Or from git:

```bash
pi install git:github.com/ssweens/pi-leash
```

## What it does

- **policies**: named file-protection rules with per-rule protection levels.
- **permission-gate**: detects dangerous bash commands and asks for confirmation.
- **path-access** (opt-in): restricts tool access to the current working directory with allow/ask/block modes.
- **optional command explainer**: can call a small LLM to explain a dangerous command inline in the confirmation dialog.
- **sudo mode** (opt-in): securely handles sudo commands by prompting for passwords and executing with `sudo -S`.

## Configuration

Pi Leash reads from:

**`~/.pi/agent/settings/pi-leash.json`**

Create this file to customize settings. All fields are optional — sensible defaults are used when not specified.

### Example config

```json
{
  "enabled": true,
  "features": {
    "policies": true,
    "permissionGate": true,
    "pathAccess": true
  },
  "pathAccess": {
    "mode": "ask",
    "allowedPaths": ["~/shared-libs/"]
  },
  "permissionGate": {
    "sudoMode": {
      "enabled": true,
      "timeout": 30000,
      "preserveEnv": false
    }
  }
}
```

## Current schema

```json
{
  "enabled": true,
  "features": {
    "policies": true,
    "permissionGate": true,
    "pathAccess": false
  },
  "policies": {
    "rules": [
      {
        "id": "secret-files",
        "description": "Files containing secrets",
        "patterns": [
          { "pattern": ".env" },
          { "pattern": ".env.local" },
          { "pattern": ".env.production" },
          { "pattern": ".env.prod" },
          { "pattern": ".dev.vars" }
        ],
        "allowedPatterns": [
          { "pattern": ".env.example" },
          { "pattern": ".env.sample" },
          { "pattern": ".env.test" },
          { "pattern": "*.example.env" },
          { "pattern": "*.sample.env" },
          { "pattern": "*.test.env" }
        ],
        "protection": "noAccess",
        "onlyIfExists": true
      }
    ]
  },
  "pathAccess": {
    "mode": "ask",
    "allowedPaths": []
  },
  "permissionGate": {
    "patterns": [
      { "pattern": "rm -rf", "description": "recursive force delete" },
      { "pattern": "sudo", "description": "superuser command" },
      { "pattern": "git checkout", "description": "branch switch or discard uncommitted changes" }
    ],
    "requireConfirmation": true,
    "allowedPatterns": [],
    "autoDenyPatterns": [],
    "explainCommands": false,
    "explainModel": null,
    "explainTimeout": 5000,
    "sudoMode": {
      "enabled": false,
      "timeout": 30000,
      "preserveEnv": false
    }
  }
}
```

All fields optional. Missing fields use defaults.

## Policies

Each rule has:

- `id`: stable identifier
- `patterns`: files to match (glob by default, regex if `regex: true`). Patterns with `/` match full path; patterns without `/` match basename only.
- `allowedPatterns`: exceptions
- `protection`:
  - `noAccess`: block `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`
  - `readOnly`: block `write`, `edit`, `bash`
  - `none`: no protection
- `onlyIfExists` (default true)
- `blockMessage` with `{file}` placeholder
- `enabled` (default true)

When multiple rules match, strongest protection wins: `noAccess > readOnly > none`.

## Permission gate

Detects dangerous bash commands and prompts user confirmation.

Built-in dangerous patterns are matched structurally (AST-based):

- `rm -rf` (recursive force delete)
- `sudo`, `doas`, `pkexec` (privilege escalation)
- `dd of=` (disk write operation)
- `mkfs`, `mkfs.*` (filesystem format)
- `shred` (secure file overwrite)
- `wipefs` (filesystem signature wipe)
- `blkdiscard` (block device discard)
- `fdisk`, `sfdisk`, `cfdisk`, `parted`, `sgdisk` (disk partitioning)
- `chmod -R 777` / `0777` / `a+rwx` / `ugo+rwx` (insecure recursive permissions)
- `chown -R` (recursive ownership change)
- `docker`/`podman run --privileged`, `--pid=host`, socket mounts, root mounts (container escapes)
- `git checkout` (branch switch or discard uncommitted changes)

You can add custom dangerous patterns via `permissionGate.patterns`.

When prompted, you can choose:
- **Allow** (`y` / Enter) — allow this command now
- **Allow for session** (`a`) — allow this exact command string for the current session
- **Allow cwd file ops this session** (`c`) — shown only for cwd-scoped, allowlisted file operations; allows future dangerous file-based commands in the current `cwd` for this session
- **Allow eligible cmds for 5 min** (`w`) — shown only for cwd-scoped, allowlisted operations; temporarily bypasses prompts for similar eligible dangerous commands
- **Allow eligible cmds for session** (`s`) — same as above, but until session end
- **View full command** (`v`) — opens a stable-height, scrollable full-command view so you can inspect the entire dangerous command before deciding
- **Deny** (`n` / Esc)

`w`/`s`/`c` are intentionally restricted to non-evil categories only:
- `rm -rf`
- `chmod -R ...` (world-writable patterns)
- `chown -R ...`

They do **not** bypass for privilege escalation, disk/filesystem tools (`sudo`, `dd`, `mkfs`, `wipefs`, partitioning, etc.), `shred`, or dangerous container flags.

Danger detection and cwd-scope checks parse full shell structure (AST), including pipelines and shell heredoc payloads (e.g. `bash <<'EOF' ... EOF`).

The approval prompt now shows:
- **Reason** (danger category)
- **Source** (`built-in structural`, `custom pattern`, or `fallback substring (parse failed)`)
- **Trigger** (exact token/pattern that matched, e.g. `rm -rf`)

For very long commands or explanations, the inline prompt clamps itself to a stable height so it stays within the terminal. The compact view may elide the middle of the preview, but the action choices remain visible and `v` opens a scrollable full-command view.

### Explain commands (opt-in)

If enabled, guardrails calls an LLM before showing the confirmation dialog and displays a short explanation.

Config fields:

- `permissionGate.explainCommands` (boolean)
- `permissionGate.explainModel` (`provider/model-id`)
- `permissionGate.explainTimeout` (ms)

Failures/timeouts degrade gracefully: dialog still shows without explanation.

### Sudo mode (opt-in)

When enabled, sudo commands prompt for the sudo password and execute securely using `sudo -S`. The password is masked during input and cleared from memory immediately after execution. Long sudo commands use the same stable-height inline dialog behavior as the dangerous-command prompt.

Config fields:

- `permissionGate.sudoMode.enabled` (boolean) - Enable sudo mode
- `permissionGate.sudoMode.timeout` (number, ms) - Command timeout (default: 30000)
- `permissionGate.sudoMode.preserveEnv` (boolean) - Preserve environment with `sudo -E` (default: false)
- `permissionGate.sudoMode.maxRetries` (number) - Maximum password attempts before failing (default: 3). Mirrors real `sudo` behavior — on a mistyped password the dialog re-appears with an error message and remaining-attempt count.

**Example config:**
```json
{
  "permissionGate": {
    "sudoMode": {
      "enabled": true,
      "timeout": 60000,
      "preserveEnv": false
    }
  }
}
```

**Security notes:**
- Passwords are never logged or stored to disk
- Password input is masked (••••)
- Password buffer is overwritten with asterisks after use
- Uses `sudo -S` for secure stdin-based password delivery
- Failed authentication re-prompts up to `maxRetries` times before failing

## Path access (opt-in)

Restricts tool access to the current working directory. When enabled, any tool call targeting a path outside `cwd` is checked against the configured mode:

- **allow**: no restrictions
- **ask**: prompt with options to grant access (file or directory, for session or always)
- **block**: deny all outside access

```json
{
  "features": { "pathAccess": true },
  "pathAccess": {
    "mode": "ask",
    "allowedPaths": ["~/code/shared-libs/", "~/.config/myapp"]
  }
}
```

When prompted, the user can choose:
- **Allow once** — this invocation only
- **Allow file/dir this session** — in-memory, gone on restart
- **Allow file/dir always** — persisted to `pi-leash.json`

Entries in `allowedPaths` use trailing `/` for directory grants and exact paths for file grants.

**Limitations:**
- Symlinks are not resolved (lexical path comparison only).
- Bash path extraction is best-effort (AST-based heuristics).
- In non-interactive mode, `ask` mode degrades to `block`.

## Events

Pi Leash emits events for other extensions:

### `leash:blocked`

```ts
interface LeashBlockedEvent {
  feature: "policies" | "permissionGate" | "pathAccess";
  toolName: string;
  input: Record<string, unknown>;
  reason: string;
  userDenied?: boolean;
}
```

### `leash:dangerous`

```ts
interface LeashDangerousEvent {
  command: string;
  description: string;
  pattern: string;
}
```

## Credits & Attribution

Pi Leash is a fork of [`@aliou/pi-guardrails`](https://github.com/aliou/pi-guardrails) by [@aliou](https://github.com/aliou), used under the terms of the MIT License. The original package provided the file-protection policy engine, the dangerous-command permission gate, and the optional command-explainer integration that this fork inherits.

This fork adds:
- **Path access control**: opt-in CWD boundary enforcement with allow/ask/block modes and session or persistent grants.
- **Expanded dangerous command matchers**: `shred`, `doas`, `pkexec`, `wipefs`, `blkdiscard`, `fdisk`/`sfdisk`/`cfdisk`, `parted`/`sgdisk`, and Docker/Podman container escape detection.
- **Secure sudo mode** with masked password input and `sudo -S` execution.
- **Opt-in in-memory sudo password caching** with a per-prompt `Remember for N min` toggle.
- Self-contained shell parser: the `@aliou/sh` parser used by structural command matching is vendored into `src/vendor/aliou-sh` (also MIT, see [`NOTICE.md`](src/vendor/aliou-sh/NOTICE.md)) so local path installs do not depend on external module resolution.
- **Comprehensive test suite** for dangerous command matchers, path utilities, path access decisions, command argument classification, and bash path extraction.
- Various stability fixes to the sudo approval flow, dialog key handling, and dangerous-pattern detection.

Both pi-leash and the upstream `@aliou/pi-guardrails` are MIT-licensed. See [`LICENSE`](LICENSE) for the full text.
