# Changelog

All notable changes to this project will be documented in this file.

## [1.2.1] - 2026-05-28
### Added
- **Dangerous-command trust windows** in the permission prompt:
  - `w`: allow eligible dangerous commands for 5 minutes
  - `s`: allow eligible dangerous commands for the current session
- **Eligible-category guardrails** for trust windows and cwd session bypass. These bypasses now apply only to non-evil, cwd-scoped file-operation categories (`rm -rf`, recursive insecure `chmod`, recursive `chown`). Privilege escalation, disk/filesystem tooling, `shred`, and dangerous container flags are never included.
- **Heredoc-aware dangerous matching** for shell invokers (`sh`, `bash`, etc.) using heredoc scripts.

### Changed
- Dangerous-command analysis now searches complex shell structures more consistently (including pipelines and shell heredoc script payloads) before deciding bypass eligibility.
- Dangerous-command approval UI now includes explicit **Reason**, **Source**, and **Trigger** fields so users can see exactly what matched and why.

## [1.2.0] - 2026-05-19
### Added
- **Sudo password retries** — mistyped passwords no longer cause immediate execution failure. Added a password retry loop that matches native `sudo` behavior (3 attempts by default). On a failed password:
  - The masked password prompt is re-rendered with a clear error indication: `✗ Incorrect password, please try again`.
  - It displays the remaining attempt count: `2 attempts remaining`.
  - The in-memory cache is automatically invalidated if it rejected a cached password, then re-prompts the user cleanly.
  - Users can press `Esc` at any retry to cancel the operation.
- **`maxRetries` configuration option** — under `permissionGate.sudoMode`, sets the maximum number of password attempts before giving up (default: `3`). Documented in the README.

## [0.12.0] - 2026-05-14
### Added
- Sudo password caching (opt-in, in-memory, 5-minute TTL by default). The sudo password dialog now renders a Tab-toggleable `[ ] Remember password for N min (in-memory only)` checkbox. When checked, the password is cached in module memory for `sudoMode.cacheTtl` (default 300_000 ms) so consecutive sudo invocations skip the password re-entry step. The approval dialog (allow/deny) still runs every time — only the password step is bypassed when the cache is warm.
- New config under `permissionGate.sudoMode`:
  - `cacheEnabled` (default `true`) — when `false` the checkbox is hidden and the cache lookup short-circuits.
  - `cacheTtl` (default `300000` ms) — how long a remembered password lives in memory.
- Cache is cleared on TTL expiry (timer is `unref()`'d so it never keeps the loop alive), on `incorrect password` stderr (with an explicit notification that the cached password was rejected), on `session_shutdown`, and on process `exit` / `SIGINT` / `SIGTERM`. Passwords are never written to disk, logs, or telemetry.

### Changed
- Dropped `@changesets/cli` workflow in favor of manual version + CHANGELOG management to match the rest of the @ssweens pi-packages repo. The `changeset` / `version` scripts are gone; `release` is now a plain `npm publish` shortcut.

### Notes
- First public npm release. Prior 0.1.0–0.11.0 versions existed only in the source repo and were not published.
