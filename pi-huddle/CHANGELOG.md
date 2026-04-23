# Changelog

All notable changes to this project will be documented in this file.

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
