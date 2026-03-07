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
