# Changelog

All notable changes to this project will be documented in this file.

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
