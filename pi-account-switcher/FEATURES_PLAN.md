# Pi Account Switcher — Feature Plan

This document captures suggested next features for `pi-account-switcher`, grouped by priority and implementation risk.

## Goals

- Reduce manual JSON editing.
- Improve safety around secrets and OAuth credentials.
- Make account switching faster for multi-project and multi-client workflows.
- Keep secrets out of logs, status text, and shareable config.

## Priority 1 — Daily UX Improvements

### 1. `/account-edit`

Add an interactive command to edit an existing account.

Suggested flow:

1. Select account.
2. Edit label, provider, id, credential type, and secret source.
3. Validate resulting config.
4. Save config.
5. Reload runtime config.

Notes:

- Warn if changing an account id that is currently selected in state.
- Preserve existing fields when user leaves input blank.
- Never display literal secret values by default.

### 2. `/account-remove`

Add an interactive command to delete an account.

Suggested flow:

1. Select account.
2. Show account summary without secrets.
3. Confirm deletion.
4. Remove from config.
5. Remove stale state selection if needed.

### 3. Duplicate-safe add flow

Improve `addAccount()` so duplicate ids are handled gracefully.

Behavior options:

- If id does not exist: append account.
- If id exists: prompt user to replace, cancel, or enter a new id.

This prevents accidental config validation failures after `/account-add` or `/account-oauth-import`.

### 4. `/account-test`

Add a command to validate that configured credentials resolve correctly.

Checks:

- `literal`: non-empty.
- `env`: referenced environment variable exists.
- `file`: file exists and contains a value.
- `command`: command exits successfully and returns non-empty output.
- `op`: `op` command exists and can resolve the reference.
- `piAuth`: auth entry is structurally present.

Output should redact secret values.

## Priority 2 — Safety and Secret Management

### 5. OS keychain backend

Support storing API keys in the system keychain via `keytar` or another optional backend.

Example secret source:

```json
{
  "type": "keychain",
  "service": "pi-account-switcher",
  "account": "claude-work"
}
```

Design notes:

- Keep `keytar` optional to avoid install friction.
- Fall back with a clear message when unavailable.
- Add migration command later if needed.

### 6. Sanitized import/export

Add commands for sharing account templates safely.

Commands:

- `/account-export-template`
- `/account-import-template`

Export should include ids, labels, providers, and credential variable names, but never raw values.

### 7. Config backup before mutation

Before edit/remove/import operations, write a timestamped backup of `accounts.json`.

Example path:

```txt
~/.pi/account-switcher/backups/accounts-2026-05-05T12-00-00.json
```

## Priority 3 — Workflow Automation

### 8. Project-specific defaults

Allow a project directory to automatically select default accounts.

Example config idea:

```json
{
  "projectDefaults": {
    "/home/user/work/client-a": {
      "anthropic": "claude-client-a",
      "openai": "openai-client-a"
    }
  }
}
```

Behavior:

- On `session_start`, detect current working directory.
- Apply the most specific matching project path.
- Notify user which defaults were restored.

### 9. Account profiles

Support switching multiple providers together.

Example:

```json
{
  "profiles": {
    "work": {
      "anthropic": "claude-work",
      "openai": "openai-team"
    },
    "personal": {
      "anthropic": "claude-personal",
      "google": "gemini-personal"
    }
  }
}
```

Command:

```txt
/account-profile work
```

### 10. Favorites and recent accounts

Improve picker sorting:

1. Active account.
2. Favorites.
3. Recently used.
4. Remaining accounts alphabetically.

Potential commands:

- `/account-favorite`
- `/account-recent`

## Priority 4 — OAuth Improvements

### 11. OAuth health warnings

Detect stale or suspicious OAuth entries before switching.

Possible checks:

- Missing expected token fields.
- Expiry timestamp already passed, if present.
- Provider id mismatch.

The extension should not expose token values.

### 12. OAuth refresh guidance

Add a command or warning that explains how to refresh credentials:

```txt
/login
/account-oauth-import
```

This can be a lightweight helper rather than implementing provider-specific refresh logic.

## Priority 5 — Debugging and Observability

### 13. `/account-history`

Record recent account switches without secrets.

Example entry:

```json
{
  "timestamp": "2026-05-05T12:00:00.000Z",
  "provider": "anthropic",
  "accountId": "claude-work",
  "label": "Claude — Work",
  "credentialKind": "piAuth"
}
```

Use cases:

- Debug accidental account usage.
- Confirm which account was active before a request.

### 14. Improved `/account-debug`

Enhance debug output with:

- Current provider.
- Active account id and label.
- Credential kind only, not values.
- Config path.
- State path.
- Pi auth path.
- Number of configured accounts by provider.

## Suggested Implementation Order

1. Duplicate-safe add flow.
2. `/account-remove`.
3. `/account-edit`.
4. `/account-test`.
5. Config backup before mutation.
6. Project-specific defaults.
7. Account profiles.
8. Sanitized import/export.
9. Keychain backend.
10. History/debug improvements.
11. OAuth health warnings.

## Acceptance Criteria

For every new command:

- TypeScript typecheck passes.
- Secrets are never printed in notifications, status, or debug output.
- Invalid config is rejected before writing.
- Existing config format remains backwards compatible.
- README and USAGE are updated with examples.
