# Process advisory capture

`real-advisory.json` captures a real `openai-codex/gpt-5.6-luna` response through the production Mom prompt, reducer, sidecar, and next-request delivery. The release-upload transcript and two lead replies are controlled fixtures, not observations of the user's project.

Mom used two calls: an initial proposal and a repair of its purpose pointer. The accepted warning was:

> The same timeout fix failed twice; diagnose the actual authorization-failing path before making another change.

Delivery produced one notice, including after reload and another input event. No extra lead turn occurred. This is one real-model positive case, not evidence of general semantic precision or recall. Class-specific positive and negative protocol cases are covered by `test/process-health.test.ts`.

## Capture shutdown

Both live runs saved their receipts and passed the delivery assertions, then exceeded the shell's 145-second process deadline. `real-advisory-before-socket-cleanup.json` preserves the first run. The second run is `real-advisory.json`; neither is claimed as a clean process-exit pass.

The capture initially closed the top-level pi-ai connection pool, but ModelRuntime used a separate nested pi-ai installation. The script now resolves the SDK's own dependency before closing its sessions. A recorded-response diagnostic then exercised delivery, reload, and shutdown with no further provider calls; it exited successfully with no remaining server/socket/timer resources reported. The corrected socket cleanup has not been rerun against a live provider.

To make a new opt-in capture:

```sh
npx tsx experiments/process-notice-live.ts
```

The script runs in an isolated temporary session, limits Mom to two provider calls, and never opens the user's session or sidecar.
