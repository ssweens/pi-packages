# Pi Account Switcher — Plan & Tech Stack

This repository is intended to be a Pi agent extension that lets users quickly switch between multiple accounts/API keys for the same provider, such as Claude, Codex/OpenAI, Gemini, OpenRouter, etc.

## Goal

Build a Pi extension that allows fast switching between accounts like:

- `claude/work`
- `claude/personal`
- `codex/client-a`
- `codex/client-b`
- `openai/team`
- `gemini/testing`

The extension should make it easy to select the desired account from inside Pi without manually editing environment variables or config files.

## Recommended Tech Stack

### Core

- TypeScript
- Node.js 24+
- Pi Extension API
  - `pi.registerCommand()`
  - `ctx.ui.select()`
  - `ctx.ui.notify()`
  - `ctx.ui.setStatus()`
  - lifecycle hooks like `session_start` and `model_select`

### Runtime Dependencies

- `@earendil-works/pi-coding-agent` — Pi extension types/API
- `typebox` — schema definitions if custom tools are added
- `zod` or `valibot` — config validation
- Node built-ins:
  - `node:fs/promises`
  - `node:path`
  - `node:os`
  - `node:process`

### Optional Dependencies

- `keytar` — store secrets in OS keychain
- `dotenv` — support loading account env files
- `picocolors` — nicer CLI/log output
- `tsx` — local TypeScript execution during development
- `vitest` — tests

## Config Design

Use a user-level config file:

```txt
~/.pi/account-switcher/accounts.json
```

Example:

```json
{
  "accounts": [
    {
      "id": "claude-work",
      "label": "Claude — Work",
      "provider": "anthropic",
      "env": {
        "ANTHROPIC_API_KEY": "op://vault/claude-work/key"
      }
    },
    {
      "id": "codex-personal",
      "label": "Codex — Personal",
      "provider": "openai",
      "env": {
        "OPENAI_API_KEY": "..."
      }
    }
  ]
}
```

Avoid storing raw secrets long-term if possible. Preferred secret storage order:

1. OS keychain
2. 1Password/op CLI references
3. Env file references
4. Raw API key as fallback

## Commands

### `/account`

Open provider/account picker.

Flow:

1. Detect current model/provider.
2. Filter accounts for that provider.
3. Show a picker with `ctx.ui.select()`.
4. Apply the selected account.
5. Persist the selected account.
6. Notify the user.

Example UX:

```txt
/account

Pick account for anthropic:
> Claude — Work
  Claude — Personal
  Claude — Client A
```

### `/accounts`

List configured accounts.

### `/account-add`

Interactive wizard:

1. Pick provider.
2. Enter label.
3. Enter env var/API key source.
4. Save config.

### `/account-current`

Show active account.

### `/account-reload`

Reload config from disk.

## Implementation Plan

### Phase 1 — Minimal Extension

Create:

```txt
.pi/extensions/account-switcher/
  index.ts
  config.ts
  accounts.ts
  package.json
  README.md
```

Implement:

- Load account config.
- Register `/account`.
- Show picker.
- Set `process.env[...]`.
- Show selected account in Pi status bar.

### Phase 2 — Persistence

Persist selected account here:

```txt
~/.pi/account-switcher/state.json
```

Example:

```json
{
  "selected": {
    "anthropic": "claude-work",
    "openai": "codex-personal"
  }
}
```

On `session_start`, restore selected account for each provider.

### Phase 3 — Better UX

Add:

- Searchable account picker if Pi UI supports it.
- Grouping by provider.
- Active account in footer/status.
- Auto-filtering accounts by active model provider.
- Confirmation when switching while an agent is running.

### Phase 4 — Secret Management

Support account value sources:

```ts
type SecretSource =
  | { type: "env"; name: string }
  | { type: "literal"; value: string }
  | { type: "file"; path: string }
  | { type: "command"; command: string }
  | { type: "op"; reference: string };
```

Example:

```json
{
  "provider": "anthropic",
  "env": {
    "ANTHROPIC_API_KEY": {
      "type": "command",
      "command": "op read op://AI/ClaudeWork/api-key"
    }
  }
}
```

### Phase 5 — Safety

Add validation for:

- Missing env vars.
- Empty API keys.
- Duplicate account IDs.
- Unknown providers.
- Unsupported provider env mapping.

Example error:

```txt
Account "claude-work" is missing ANTHROPIC_API_KEY.
```

## Provider/Env Mapping

Start with common providers:

```ts
const PROVIDER_ENV_KEYS = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  xai: ["XAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
};
```

Codex likely maps to OpenAI-compatible credentials, so it can probably use `OPENAI_API_KEY` unless Pi uses a separate provider name.

## Suggested MVP Behavior

The MVP should focus on one command:

```txt
/account
```

Behavior:

1. Detect active provider from current model.
2. Show matching accounts.
3. Apply env vars.
4. Save selected account.
5. Notify user if restart/reload is needed.

## Important Technical Note

Depending on how Pi/provider clients cache API keys, changing `process.env` may or may not affect the next request immediately.

Therefore, the extension should initially support:

```json
{
  "switchMode": "env"
}
```

Later it may support:

```json
{
  "switchMode": "provider-request-patch"
}
```

MVP can use `process.env` and notify:

```txt
Switched to Claude — Work. If the provider already cached credentials, run /reload.
```

## Suggested Package Setup

```json
{
  "name": "pi-account-switcher",
  "type": "module",
  "private": true,
  "dependencies": {
    "@earendil-works/pi-coding-agent": "latest",
    "typebox": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "typescript": "latest",
    "vitest": "latest"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

## Suggested File Structure

```txt
src/
  index.ts          # Pi extension entry
  config.ts         # Load/validate config
  state.ts          # Persist selected accounts
  providers.ts      # Provider env mappings
  secrets.ts        # Resolve key/env/file/command sources
  ui.ts             # Picker helpers
  types.ts
README.md
package.json
tsconfig.json
```

## MVP Milestone Checklist

- [ ] Create extension skeleton.
- [ ] Add `/account`.
- [ ] Load `accounts.json`.
- [ ] Filter by current model provider.
- [ ] Apply env vars.
- [ ] Persist selected account.
- [ ] Restore on startup.
- [ ] Add README with config examples.
- [ ] Add validation/errors.
- [ ] Add basic tests for config/state/secrets logic.
