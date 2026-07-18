# Test coverage

## Automated checks

- Existing upstream regression checks cover pool editing, project restrictions, subscription switching, quota parsing, and runtime failover.
- `tests/auth-compat-check.mjs` verifies both Pi auth facades:
  - legacy `ModelRegistry.authStorage`
  - Pi 0.80.8+ configured-auth status and live `ModelRuntime.logout()` bridge
  - non-stored credentials are never falsely reported as logged out
  - browser-auth and device-code notifications, text prompts, and token refresh through the OAuth adapter
- `tests/oauth-adapter-check.mjs` verifies ChatGPT Codex browser and device-code selection IDs are passed through Pi's selector callback, while a cancelled selection stops login cleanly.

## Manual verification

In a Pi 0.80.10+ session with `pi-multi-pass` loaded:

1. Run `/subs add` and verify it offers Anthropic, ChatGPT Codex, and GitHub Copilot only.
2. Run `/subs status` and verify configured subscriptions appear without an extension error.
3. Run `/subs switch` and confirm only authenticated subscriptions are selectable.
4. Run `/subs logout`, then verify the selected OAuth subscription is unavailable without restarting Pi.
5. Exercise a configured non-stored credential and verify logout reports that it must be removed at its source.
