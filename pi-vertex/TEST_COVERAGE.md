# Test Coverage

## Current Status
- Automated tests: not yet implemented in this package.
- Lint/type checks: `npm run check` is still a no-op placeholder, but `npx tsc --noEmit` now passes clean as of v1.2.0 (it reported 2 errors before).

## Manual Verification
- Claude 4.6 streaming verified via Anthropic Vertex SDK.
- Mid-session model switching (tool call replay) verified interactively in pi.
- Registry sanity checks verified locally for `claude-opus-4-8` and `grok-4.3` after model additions.
- v1.2.1 catalog checks run against `models/index.ts`: 50 models load, no duplicate ids, the retired `gemini-2.0-*` ids no longer resolve, and `gemini-3.8-flash` resolves with the expected API id, context, output cap, and pricing.
- v1.2.1 streaming source check confirms Gemini 3.8 uses the Gemini 3 `thinkingLevel` path and floors unsupported `minimal` effort to `low`.
- `bun build index.ts --outdir /tmp/pi-vertex-build --target node` completes successfully.

## Gaps / Next Steps
- **No live request has been made against `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `claude-opus-5`, or `claude-sonnet-5`.** Catalog metadata and thinking routing are verified statically; end-to-end streaming against these API ids is unverified.
- Promotion of `gemini-3.1-flash-lite` off its `-preview` API id is likewise unverified against a live endpoint.
- Add automated integration tests for Anthropic Vertex streaming and tool replay.
- Add unit tests for message normalization and replay sequencing.
- Add a catalog regression test so retired model ids cannot silently linger in the registry again.
