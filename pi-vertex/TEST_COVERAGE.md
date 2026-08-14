# Test Coverage

## Current Status
- Automated tests: not yet implemented in this package.
- Lint/type checks: `npm run check` is still a no-op placeholder, but `npx tsc --noEmit` now passes clean as of v1.2.0 (it reported 2 errors before).

## Manual Verification
- Claude 4.6 streaming verified via Anthropic Vertex SDK.
- Mid-session model switching (tool call replay) verified interactively in pi.
- Registry sanity checks verified locally for `claude-opus-4-8` and `grok-4.3` after model additions.
- v1.2.0 catalog checks run against `models/index.ts`: 49 models load, no duplicate ids, the retired `gemini-2.0-*` ids no longer resolve, and the new `gemini-3.7-flash` / `gemini-3.6-flash` / `gemini-3.5-flash-lite` / `claude-opus-5` / `claude-sonnet-5` entries resolve with the expected context, output cap, and pricing.
- v1.2.0 thinking-config routing checked by replaying the `streaming/gemini.ts` predicates over every Gemini entry: all `gemini-3.x` ids (including 3.6 and 3.7) take the `thinkingLevel` path, only `gemini-3.1-pro-preview` matches the Pro floor, and 2.5 ids stay on the `thinkingBudget` path.

## Gaps / Next Steps
- **No live request has been made against `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `claude-opus-5`, or `claude-sonnet-5`.** Catalog metadata and thinking routing are verified statically; end-to-end streaming against these API ids is unverified.
- Promotion of `gemini-3.1-flash-lite` off its `-preview` API id is likewise unverified against a live endpoint.
- Add automated integration tests for Anthropic Vertex streaming and tool replay.
- Add unit tests for message normalization and replay sequencing.
- Add a catalog regression test so retired model ids cannot silently linger in the registry again.
