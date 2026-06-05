# Test Coverage

## Current Status
- Automated tests: not yet implemented in this package.
- Lint/type checks: `npm run check` (currently a no-op placeholder).

## Manual Verification
- Claude 4.6 streaming verified via Anthropic Vertex SDK.
- Mid-session model switching (tool call replay) verified interactively in pi.
- Registry sanity checks verified locally for `claude-opus-4-8` and `grok-4.3` after model additions.

## Gaps / Next Steps
- Add automated integration tests for Anthropic Vertex streaming and tool replay.
- Add unit tests for message normalization and replay sequencing.
