# Pi Account Switcher — Install & Usage

This guide explains how to install, run, and use this extension in Pi.

## 1. Install Dependencies

From this repository:

```bash
npm install
```

Optional sanity check:

```bash
npm run typecheck
```

## 2. Run Temporarily for Testing

The fastest way to test the extension is with Pi's `-e` / `--extension` flag:

```bash
pi -e ./src/extension.ts
```

Then, inside Pi, add your first account:

```txt
/accounts:add
```

To reload after manually editing the config file, use Pi's built-in:

```txt
/reload
```

## 3. Install as a Project-local Pi Extension

To make the extension auto-load for this project, place it under `.pi/extensions/` or configure it as a package.

Recommended project-local setup:

```bash
mkdir -p .pi/extensions/account-switcher
cp -R src package.json package-lock.json tsconfig.json .pi/extensions/account-switcher/
```

Then start Pi from the project directory:

```bash
pi
```

If Pi is already running, use:

```txt
/reload
```

Pi auto-discovers extensions from:

```txt
.pi/extensions/*.ts
.pi/extensions/*/index.ts
~/.pi/agent/extensions/*.ts
~/.pi/agent/extensions/*/index.ts
```

The easiest dev command is:

```bash
pi -e ./src/extension.ts
```

## 4. Install Globally for All Pi Projects

To use the extension globally:

```bash
mkdir -p ~/.pi/agent/extensions/account-switcher
cp -R src package.json package-lock.json tsconfig.json ~/.pi/agent/extensions/account-switcher/
```

Then start Pi anywhere:

```bash
pi
```

Or reload an existing Pi session:

```txt
/reload
```

## 5. OAuth Login Like Pi `/login`

For subscription/OAuth providers, use Pi's built-in login first, then import that login as a named switchable account.

```txt
/login
/accounts:oauth
```

To add another OAuth account for the same provider, run `/login` again with the other browser account, then run `/accounts:oauth` again with a different label.

Switch OAuth accounts with:

```txt
/accounts:list
```

Or use the keyboard shortcut:

```txt
Ctrl+Shift+C
```

OAuth credentials are captured from Pi's auth file:

```txt
~/.pi/agent/auth.json
```

When switching OAuth accounts, this extension applies the stored credentials to Pi's live auth storage and clears cached provider sessions when Pi exposes cleanup hooks.

## 6. Configure API-key Accounts from Inside Pi

You can add API-key accounts directly from Pi without hand-writing JSON.

### Add an account

```txt
/accounts:add
```

This opens a wizard for provider, label, id, credential env var, and secret source, then optionally activates the new account. If the id already exists, choose replace, enter a new id, or cancel. For custom model providers, choose a default model, then paste an account API key override or leave it blank to use the provider-level `apiKey`. Switching to that account re-registers the provider key and switches Pi to the account model. If you enter a free-text custom provider, Pi can save it as a reusable provider.

The wizard supports secret sources from pasted API key, env var, file, shell command, or 1Password `op://` reference.

Warning: if you choose `Paste API key now`, the key is written as plain text to:

```txt
~/.pi/account-switcher/accounts.json
```

Prefer env vars, files with restricted permissions, or 1Password references.

### Manage custom providers

```txt
/providers:list
/providers:add
/providers:edit
/providers:remove
```

Custom providers are stored separately from accounts:

```txt
~/.pi/account-switcher/providers.json
```

Built-in providers are read-only. Removing a custom provider is blocked while accounts still use it. Provider entries may also include Pi model-provider fields like `baseUrl`, `api`, `apiKey`, `compat`, and `models`; account-switcher registers those providers with Pi.

`apiKey` can be an env var name, shell command (`!op read ...`), or raw key. Raw keys work, but they are stored in plaintext in `providers.json`; prefer env/file/1Password when possible.

Example provider config:

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

## 7. Configure Accounts Manually

Account config lives at:

```txt
~/.pi/account-switcher/accounts.json
```

Example config:

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
      "id": "claude-personal",
      "label": "Claude — Personal",
      "provider": "anthropic",
      "env": {
        "ANTHROPIC_API_KEY": { "type": "file", "path": "~/.keys/claude-personal.txt" }
      }
    },
    {
      "id": "codex-client-a",
      "label": "Codex — Client A",
      "provider": "openai",
      "env": {
        "OPENAI_API_KEY": { "type": "op", "reference": "op://AI/CodexClientA/api-key" }
      }
    }
  ]
}
```

## 8. Supported Secret Sources

### Literal value

```json
{
  "OPENAI_API_KEY": { "type": "literal", "value": "sk-..." }
}
```

### Existing environment variable

```json
{
  "ANTHROPIC_API_KEY": { "type": "env", "name": "ANTHROPIC_WORK_API_KEY" }
}
```

### File

```json
{
  "ANTHROPIC_API_KEY": { "type": "file", "path": "~/.keys/claude-work.txt" }
}
```

### Shell command

```json
{
  "ANTHROPIC_API_KEY": {
    "type": "command",
    "command": "op read op://AI/ClaudeWork/api-key"
  }
}
```

### 1Password reference

```json
{
  "OPENAI_API_KEY": {
    "type": "op",
    "reference": "op://AI/CodexClientA/api-key"
  }
}
```

A plain string is treated as a literal value, except strings beginning with `op://` are resolved using `op read`.

## 9. Commands

### Pick account for current provider

```txt
/accounts:list
```

The extension tries to detect the current model provider and shows matching accounts.

### Pick account for a specific provider

```txt
/accounts:list
```

Useful if Pi cannot detect the active provider.

### List accounts

```txt
/accounts:list
```

### Import current Pi OAuth login

```txt
/accounts:oauth
```

Use this after Pi's built-in `/login`.

### Add account interactively

```txt
/accounts:add
```

### Login/add account and activate it

```txt
/accounts:add
```

### Edit account

```txt
/accounts:edit
```

Edit label, provider, id, and env credential source. Blank text input keeps the existing value. Literal secret values are not displayed by default.

### Remove account

```txt
/accounts:remove
```

Shows a non-secret summary, asks for confirmation, deletes the account, and clears stale saved selections.

### Manage custom providers

```txt
/providers:list
/providers:add
/providers:edit
/providers:remove
```

## 10. Switching Flow

Typical usage:

1. Start Pi:

   ```bash
   pi -e ./src/extension.ts
   ```

2. For OAuth/subscription accounts, login with Pi and import it:

   ```txt
   /login
   /accounts:oauth
   ```

   For API-key accounts, add and activate an account:

   ```txt
   /accounts:add
   ```

3. Later, switch accounts:

   ```txt
   /accounts:list
   ```

Alternative manual config flow: edit `~/.pi/account-switcher/accounts.json` directly, then reload Pi:

6. If needed, reload Pi runtime:

   ```txt
   /reload
   ```

## 11. State Persistence

Selected accounts are saved at:

```txt
~/.pi/account-switcher/state.json
```

Example:

```json
{
  "activeAccountId": "claude-work",
  "activeModelId": "claude-sonnet-4",
  "activeModelProvider": "anthropic"
}
```

On Pi session start, the extension restores the saved active account and model state.

## 12. Important Note About Credential Caching

The extension updates `process.env`, Pi's live runtime API-key overrides, and Pi's live OAuth auth storage when those hooks are available.

If a provider still keeps old credentials cached, run `/reload` or restart Pi.

## 13. Troubleshooting

### No accounts configured

Run `/accounts:add` to create one interactively, or create `~/.pi/account-switcher/accounts.json` manually.

### No accounts for provider

Run explicitly:

```txt
/accounts:list
```

Also check that account `provider` values match supported providers:

- `anthropic` / `claude`
- `openai`
- `openai-codex` / `codex`
- `google` / `gemini`
- `xai`
- `openrouter`

### Secret resolves empty

Check the configured secret source:

- env var exists
- file exists and contains the key
- command works manually
- `op` CLI is signed in

### Changes do not apply

Switch the account again. If the provider still keeps old credentials cached, run:

```txt
/reload
```

If it still uses the old account, restart Pi.
