# Changelog

## [1.3.2] - 2026-07-18

- Fixed ChatGPT Codex subscription login by preserving Pi's browser/device-code selection prompt through the OAuth compatibility adapter.
- Cancelling that selector now terminates the login cleanly instead of passing an empty login method to the OAuth flow.

## [1.3.1] - 2026-07-18

- Vendored `pi-multi-pass@1.3.0` into the `@ssweens` Pi package collection.
- Migrated authentication checks for Pi 0.80.8+ from the removed `ModelRegistry.authStorage` API to `getProviderAuthStatus()`.
- Preserved lock-aware, live-session OAuth logout through Pi's canonical `ModelRuntime.logout()` bridge rather than rewriting `auth.json` directly.
- Vendored the maintained Anthropic, ChatGPT Codex, and GitHub Copilot OAuth flows and adapt them through Pi's public extension callback API.
- Removed unavailable Gemini CLI and Antigravity OAuth templates from the current-Pi provider selector.
- Added compatibility coverage for legacy and current Pi authentication facades plus OAuth callback adaptation.
