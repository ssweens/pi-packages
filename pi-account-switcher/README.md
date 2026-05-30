# Pi Account Switcher

> Switch between multiple API keys and accounts — per provider — inside Pi. No more manual env-var juggling.

```
claude/work  ·  claude/personal  ·  openai/team  ·  gemini/testing
```

---

## Install

**From npm (recommended)**

```bash
pi install npm:@ssweens/pi-account-switcher
```

**Project-local install** (writes to `.pi/settings.json`)

```bash
pi install -l npm:@ssweens/pi-account-switcher
```

**Source repository**

This package lives in the [`ssweens/pi-packages`](https://github.com/ssweens/pi-packages/tree/main/pi-account-switcher) monorepo.

**Run from a local checkout**

```bash
npm install
pi -e ./src/extension.ts
```

After installing, reload Pi and add your first account:

```
/reload
/accounts:add
```

### Local development command prefix

If you have the npm package installed and also run a local checkout, set `PI_ACCOUNT_SWITCHER_COMMAND_PREFIX` before launching Pi to avoid command-name collisions:

```bash
PI_ACCOUNT_SWITCHER_COMMAND_PREFIX=dev pi -e ./src/extension.ts
```

The local commands will be registered as `/dev:accounts:list`, `/dev:accounts:add`, etc. The prefix may include the trailing colon (`dev:`) or omit it (`dev`).

---

## Commands

### Accounts

| Command            | Description                                                     |
| ------------------ | --------------------------------------------------------------- |
| `/accounts:add`    | Add a new account interactively                                 |
| `/accounts:list`   | List all accounts and activate the selected one                 |
| `/accounts:switch` | Switch to another account within the current provider           |
| `/accounts:edit`   | Edit label, provider, id, or credential source                  |
| `/accounts:remove` | Delete an account                                               |
| `/accounts:oauth`  | Import the current Pi `/login` OAuth session as a named account |

### Providers

| Command             | Description                      |
| ------------------- | -------------------------------- |
| `/providers:add`    | Add a reusable custom provider   |
| `/providers:list`   | List custom providers            |
| `/providers:edit`   | Edit a custom provider           |
| `/providers:remove` | Remove an unused custom provider |

### Models

| Command          | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `/models:list`   | List all available models and switch to the selected one |
| `/models:add`    | Add a custom model config to the current provider        |
| `/models:remove` | Remove a custom model config                             |

### System

| Command          | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `/system:reset`  | Delete all accounts, providers, and state                |
| `/system:export` | Export all accounts, providers, and state to a JSON file |
| `/system:import` | Import accounts, providers, and state from a JSON file   |

### Keyboard Shortcut

| Shortcut       | Action                |
| -------------- | --------------------- |
| `Ctrl+Shift+C` | Open account selector |

---

## Adding Accounts

Run `/accounts:add` and the wizard will ask for:

1. **Provider** — pick a built-in or custom provider
2. **Label** — a friendly display name (e.g. `Claude — Work`)
3. **Account ID** — a unique slug (e.g. `claude-work`)
4. **Credential env var** — e.g. `ANTHROPIC_API_KEY`
5. **Secret source** — one of:
   - Pasted API key (stored in plaintext — prefer the options below)
   - Existing environment variable
   - File path
   - Shell command
   - 1Password `op://` reference

If the account ID already exists, Pi will ask whether to replace it, enter a new ID, or cancel.

---

## OAuth Accounts (Claude, Codex, etc.)

For subscription providers, use Pi's built-in login first, then import it as a named account:

```
/login
```

Complete browser/device login, then:

```
/accounts:oauth
```

Give it a label like `Claude — Work`. Repeat for as many accounts as you need — each gets its own saved credentials. Switch between them any time with `/accounts:list`.

OAuth credentials are read from `~/.pi/agent/auth.json` and written back to Pi's live auth storage on switch.

---

## Custom Providers

Define a provider once, reuse it across accounts:

```
/providers:add
```

Custom providers are stored at `~/.pi/account-switcher/providers.json` and support all Pi model-provider fields:

```json
{
  "providers": {
    "acme": {
      "name": "Acme AI",
      "baseUrl": "https://api.acme.test/v1",
      "api": "openai-completions",
      "apiKey": "ACME_API_KEY",
      "envKeys": ["ACME_API_KEY"],
      "aliases": ["acme-ai"],
      "models": [{ "id": "acme-coder", "name": "Acme Coder" }]
    }
  }
}
```

> Removing a provider is blocked while any account uses it — edit or remove those accounts first.

---

## Export / Import

Back up or migrate your full configuration with two commands:

```
/system:export          # prompts for a path, defaults to ~/pi-account-switcher-export.json
/system:export ~/backup.json  # export to a specific path
```

The export file contains all accounts, providers, and active-selection state as a single JSON bundle. To restore on another machine (or after a reset):

```
/system:import          # prompts for a path, defaults to ~/pi-account-switcher-export.json
/system:import ~/backup.json  # import from a specific path
```

> **Warning:** import replaces all existing data. A confirmation prompt is shown before anything is written.

---

## Config Reference

### Accounts — `~/.pi/account-switcher/accounts.json`

```json
{
  "switchMode": "env",
  "accounts": [
    {
      "id": "claude-work",
      "label": "Claude — Work",
      "provider": "anthropic",
      "env": {
        "ANTHROPIC_API_KEY": { "type": "env", "name": "ANTHROPIC_WORK_API_KEY" }
      }
    },
    {
      "id": "openai-personal",
      "label": "OpenAI — Personal",
      "provider": "openai",
      "env": {
        "OPENAI_API_KEY": { "type": "file", "path": "~/.keys/openai-personal.txt" }
      }
    }
  ]
}
```

### Secret Sources

```json
{ "type": "literal", "value": "sk-..." }
{ "type": "env",     "name": "MY_API_KEY" }
{ "type": "file",    "path": "~/.keys/key.txt" }
{ "type": "command", "command": "op read op://AI/Claude/api-key" }
{ "type": "op",      "reference": "op://AI/Claude/api-key" }
```

A plain string is treated as a literal; strings starting with `op://` are resolved via `op read`.

### State — `~/.pi/account-switcher/state.json`

Tracks the selected account and model across sessions. Restored automatically on `session_start`.

---

## Credential Caching

On switch, the extension updates `process.env`, Pi's live API-key overrides, and Pi's OAuth auth storage. If a provider still uses old credentials, run `/reload` or restart Pi.

---

## License

MIT — see [LICENSE](./LICENSE).
