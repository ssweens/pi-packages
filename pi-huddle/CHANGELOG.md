# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
### Added
- Added RPC-safe fallbacks for `gather_input` and huddle permission prompts. Rich `ctx.ui.custom()` dialogs remain unchanged in the pi TUI, while RPC hosts such as Minars can now answer via supported `select` and `input` dialogs instead of receiving an immediate cancelled result.

## [1.5.1] - 2026-05-28
### Changed
- Switched the huddle keyboard toggle shortcut from `Alt+H` to `Ctrl+H` to align with the app's Ctrl-based hotkey conventions.
- Updated extension comments/docs/skills so shortcut guidance is consistent (`README.md`, `skills/huddle/SKILL.md`, and `extensions/index.ts`).

## [1.5.0] - 2026-05-22
### Added
- `session_query` tool in `pi-huddle/extensions/session-query.ts` for targeted retrieval from prior `.jsonl` sessions (same workflow used in `pi-handoff` and `pi-compaxxt`).
- Explicit prior-session retrieval guidance in huddle's injected context: use `session_query` when path is known; otherwise discover sessions via `fd`/`rg` in `~/.pi/agent/sessions`, optionally narrow with `fzf` and inspect with `bat/head/tail`.

### Changed
- Expanded `skills/huddle/SKILL.md` and `skills/pi-session-query/SKILL.md` with a concrete search-then-query workflow for historical context lookup.
- Added `fzf` to huddle's safe read-only bash allowlist.

## [1.4.0] - 2026-05-14
### Added
- Exclusion-list tool filtering for huddle mode. The previous `HUDDLE_MODE_TOOLS` / `NORMAL_MODE_TOOLS` allowlists wiped out any tools registered by other extensions (web_search, web_fetch, image-gen, etc.) whenever the user toggled huddle. Replaced with `HUDDLE_EXCLUDED_TOOLS` (empty by default) plus snapshot/restore of `pi.getActiveTools()`. With an empty exclusion list, huddle no longer touches the active tool set at all — permission gates already cover edit/write/bash via inline dialogs.

### Fixed
- `gather_input` no longer truncates long option labels, option descriptions, or submit-view answer recaps on the right edge. Each field now wraps with continuation indents that align under the first character of the labeled text, preserving ANSI color across line breaks. Fixes unreadable descriptions on narrower terminals.
- `gather_input` freeform input now responds to standard text-editor key combos. Previously the outer `handleInput` intercepted Left/Right as inter-question navigation, blocking every editor key pi-tui's `Input` component handles natively. The freeform row now forwards Left, Right, Home, End, Ctrl+A, Ctrl+E, Alt+Left/Right (word jump), Ctrl+W / Alt+Backspace (word delete), Ctrl+U / Ctrl+K (kill to start/end), Ctrl+Z (undo), and all printable keys to the `Input`. Tab / Shift+Tab remain the canonical "leave this field" keys.
- `gather_input` freeform cursor block now reflects the `Input`'s actual cursor position. Previously it was pinned to the end of the line, so the cursor never visibly moved even when the underlying offset changed. The render path now splices an inverse-video character into the value at `freeformInput.cursor`, matching pi-tui `Input.render`'s own cursor-placement logic.

## [1.3.1] - 2026-05-06
### Fixed
- `gather_input` description no longer references a non-existent `ExitHuddleMode` tool. Three stale mentions and the entire "Huddle mode note" paragraph are removed; the equivalent guidance lives in `skills/huddle/SKILL.md` and the injected `[HUDDLE MODE ACTIVE]` context message.
- Description shrunk from ~1.2 KB to ~540 chars. Long, deeply-quoted tool descriptions caused small/quantized DSML-format models (observed with DeepSeek-V4-Flash IQ2_XS via llama.cpp) to drift off the required tool-call format and emit malformed tags or refuse to call the tool at all. The remaining text covers actual usage without contradicting the package's own "never tell the user to exit huddle mode" design.

## [1.3.0] - 2026-05-02
### Fixed
- Huddle mode no longer tells the model to ask users to exit. Instead, the model is instructed to just use `edit`/`write` tools normally — the permission gate will prompt the user inline. This fixes the long-standing issue where models would refuse to make changes and repeatedly ask the user to toggle huddle mode off.
- `edit` and `write` tools are now included in `HUDDLE_MODE_TOOLS`, making them available to the model during huddle mode (they were previously excluded, rendering the permission gate dead code).
- Updated both the extension's injected context message and the `huddle` skill instructions to be clear: the user is in huddle mode because they want per-change approval, not because the model should stop working.

## [1.2.0] - 2026-04-22
### Changed
- Renamed `ask_user` tool to `gather_input` for clearer naming. The tool presents a structured multi-question dialog for gathering user input during planning and execution.

## [1.1.0] - 2026-03-30
### Added
- Non-modal permission dialog for huddle mode gates — replaces modal `ctx.ui.select()` with an inline `ctx.ui.custom()` component, allowing the user to scroll back and review context before deciding.

### Fixed
- Multi-line wrapping for freeform text input in the `gather_input` dialog. Long answers now wrap across multiple lines instead of being truncated.

## [1.0.1] - 2026-03-15
### Fixed
- Benign stderr redirections (`2>/dev/null`, `2>&1`) no longer trigger huddle permission prompts.
- Long question text in `gather_input` dialog now wraps correctly.
- Deny feedback is correctly surfaced to the agent with full context.

## [1.0.0] - 2026-03-01
### Added
- Initial release with huddle mode, permission gates, and `gather_input` tool.
