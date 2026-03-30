# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-03-30
### Added
- Non-modal permission dialog for huddle mode gates — replaces modal `ctx.ui.select()` with an inline `ctx.ui.custom()` component, allowing the user to scroll back and review context before deciding.

### Fixed
- Multi-line wrapping for freeform text input in the `ask_user` dialog. Long answers now wrap across multiple lines instead of being truncated.

## [1.0.1] - 2026-03-15
### Fixed
- Benign stderr redirections (`2>/dev/null`, `2>&1`) no longer trigger huddle permission prompts.
- Long question text in `ask_user` dialog now wraps correctly.
- Deny feedback is correctly surfaced to the agent with full context.

## [1.0.0] - 2026-03-01
### Added
- Initial release with huddle mode, permission gates, and `ask_user` tool.
