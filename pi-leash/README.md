# Pi Leash

Security hooks for Pi to reduce accidental destructive actions and secret-file access.

Forked from [`@aliou/pi-guardrails`](https://github.com/aliou/pi-guardrails) with added **sudo mode** for secure password handling.

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
    "permissionGate": true
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
    "permissionGate": true
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
  "permissionGate": {
    "patterns": [
      { "pattern": "rm -rf", "description": "recursive force delete" },
      { "pattern": "sudo", "description": "superuser command" }
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

- `rm -rf`
- `sudo`
- `dd if=`
- `mkfs.`
- `chmod -R 777`
- `chown -R`

You can add custom dangerous patterns via `permissionGate.patterns`.

### Explain commands (opt-in)

If enabled, guardrails calls an LLM before showing the confirmation dialog and displays a short explanation.

Config fields:

- `permissionGate.explainCommands` (boolean)
- `permissionGate.explainModel` (`provider/model-id`)
- `permissionGate.explainTimeout` (ms)

Failures/timeouts degrade gracefully: dialog still shows without explanation.

### Sudo mode (opt-in)

When enabled, sudo commands prompt for the sudo password and execute securely using `sudo -S`. The password is masked during input and cleared from memory immediately after execution.

Config fields:

- `permissionGate.sudoMode.enabled` (boolean) - Enable sudo mode
- `permissionGate.sudoMode.timeout` (number, ms) - Command timeout (default: 30000)
- `permissionGate.sudoMode.preserveEnv` (boolean) - Preserve environment with `sudo -E` (default: false)

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
- Failed authentication shows an error notification

## Events

Pi Leash emits events for other extensions:

### `leash:blocked`

```ts
interface LeashBlockedEvent {
  feature: "policies" | "permissionGate";
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
