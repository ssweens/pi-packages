# Footer classifier activity

- **Mode:** EXTEND
- **Tier:** micro
- **Flagship:** no
- **Flow served:** When a dangerous Bash action is awaiting the auto-mode classifier, the user can see that evaluation is active without adding an interaction, decision, input, or wait.
- **Scenario:** Given auto mode is enabled, when Leash calls the classifier, then the two `⏵` markers rotate theme colors while the `leash auto` label and footer width remain fixed; when the verdict returns, the static indicator is restored.
- **N+1 rung:** existing footer status surface
- **Delta:** Animate only the existing two-marker auto indicator during a classifier request.
- **Acceptance bar:** The controller test proves the first and next animation frames while pending and the static indicator after resolution; the extension loads in Pi.

## Evidence

- `pnpm typecheck` passed.
- `pnpm test` passed: 8 files, 193 tests. The controller test verifies the initial busy frame, the next color frame, and restoration of the static marker after the classifier resolves. Classifier tests cover sanitized provider errors and configured-timeout reporting.
- `pnpm exec biome check src/hooks/auto-mode.ts src/hooks/auto-mode.test.ts` passed.
- `pi --no-extensions --extension ./src/index.ts --print '/leash status'` exited successfully, exercising extension load and command registration.
