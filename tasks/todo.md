# Tasks

- [x] Alphabetize models in `pi-vertex` <!-- id: 0 -->
- [x] Verify usage of `ALL_MODELS` in `pi-vertex/index.ts` <!-- id: 1 -->

## Review
The `ALL_MODELS` array in `pi-vertex/models/index.ts` is now sorted alphabetically by the `name` property. This ensures that any UI or command listing models (like `/model`) will display them in alphabetical order.

## Current Task: Ensure huddle safe bash list includes rg/head/tail and related
- [x] Verify command allowlist patterns in `pi-huddle/extensions/lib/utils.ts` include rg/head/tail and related read-only commands <!-- id: huddle-safe-1 -->
- [x] Align user-facing safe-command messaging with the actual allowlist <!-- id: huddle-safe-2 -->
- [x] Run package quality gate(s) and confirm no regressions <!-- id: huddle-safe-3 -->

### Review (huddle safe command update)
- Confirmed `rg`, `head`, `tail`, `fd`, `grep`, and `find` are allowlisted.
- Fixed false denials for benign output suppression redirections by allowing `2>/dev/null`, `2>>/dev/null`, `2>&1`, and similar FD-only suppression forms.
- Kept file-writing redirections blocked (`> file`, `>> file`).
- Updated user-facing huddle docs to reflect safe suppression redirection behavior.
- Verified with runtime checks and `npm pack --dry-run` in `pi-huddle`.

## Current Task: make pi-leash self-contained and remove pi-guardrails
- [x] Remove `npm:@aliou/pi-guardrails` from `~/.pi/agent/settings.json` <!-- id: leash-self-1 -->
- [x] Vendor `@aliou/sh` parser into `pi-leash` source tree <!-- id: leash-self-2 -->
- [x] Replace `@aliou/sh` imports with local vendored imports <!-- id: leash-self-3 -->
- [x] Run `pi-leash` quality gates (`typecheck`, `lint`) and verify no external parser dependency remains <!-- id: leash-self-4 -->

### Review (pi-leash self-contained parser)
- Removed `npm:@aliou/pi-guardrails` from `~/.pi/agent/settings.json`.
- Vendored `@aliou/sh@0.1.0` parser files into `pi-leash/src/vendor/aliou-sh`.
- Repointed parser imports in:
  - `pi-leash/src/hooks/permission-gate.ts`
  - `pi-leash/src/hooks/policies.ts`
  - `pi-leash/src/utils/shell-utils.ts`
- Removed `@aliou/sh` from `pi-leash/package.json` runtime dependencies.
- Verification:
  - `rg` confirms no source imports from external `@aliou/sh` remain.
  - `pnpm typecheck` / `pnpm lint` were attempted but cannot run in this checkout because `node_modules` is absent (`tsc`/`biome` not found).

## Current Task: fix sudo flow/output injection bug in pi-leash
- [x] Investigate why sudo executes but builtin bash still runs and fails with TTY/password error <!-- id: leash-sudo-1 -->
- [x] Replace invalid `tool_call` output injection approach with `tool_result` override flow keyed by `toolCallId` <!-- id: leash-sudo-2 -->
- [x] Preserve sudo output/error/exit code for the model and UI while preventing second sudo execution <!-- id: leash-sudo-3 -->
- [x] Verify interactively in pi with a sudo command and confirm password prompt + output behavior <!-- id: leash-sudo-4 -->
- [x] Replace `exec(..., { input })` with `spawn()` + stdin write for actual sudo password delivery <!-- id: leash-sudo-5 -->
- [x] Suppress sudo terminal prompt noise with `-p ''` so prompt area does not get polluted <!-- id: leash-sudo-6 -->
- [x] Handle compound commands with multiple `sudo` invocations by wrapping shell `sudo()` and feeding stdin for each prompt <!-- id: leash-sudo-7 -->

## Current Task: fix Enter key behavior in permission approval dialog
- [x] Reproduce/inspect why Enter is ignored in dangerous-command approval UI <!-- id: leash-enter-1 -->
- [x] Add robust Enter detection (`Key.enter`, `\r`, `\n`) for approval and password dialogs <!-- id: leash-enter-2 -->
- [ ] Verify interactively that Enter now confirms approval without requiring `y` <!-- id: leash-enter-3 -->
- [x] Switch confirm/cancel handlers to use `keybindings.matches(selectConfirm/selectCancel)` with raw-key fallback <!-- id: leash-enter-7 -->
- [x] Handle combined CRLF Enter payloads (`"\r\n"`) in dialog key handlers <!-- id: leash-enter-4 -->
- [x] Prevent empty Enter submit in sudo password dialog to avoid cross-dialog Enter bleed <!-- id: leash-enter-5 -->
- [ ] Add short Enter debounce window on sudo password dialog open to absorb carry-over Enter from approval dialog <!-- id: leash-enter-6 --> (reverted: interfered with approval UX)
