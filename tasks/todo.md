# Tasks

## Current Task: add prior-session retrieval workflow to pi-huddle
- [x] Add `session_query` tool to `pi-huddle` extension set
- [x] Add explicit huddle system-guidance for prior-session retrieval (`session_query` + `fd/rg/fzf/bat` over `~/.pi/agent/sessions`)
- [x] Expand huddle docs/skills with a concrete search-then-query workflow
- [x] Allow `fzf` as a safe bash command in huddle mode
- [ ] User validate in-session: agent uses `fd/rg` discovery + `session_query` retrieval path when asked about prior sessions

### Review (pi-huddle prior sessions)
- Added `pi-huddle/extensions/session-query.ts` registering the `session_query` tool (same behavior as handoff/compaxxt).
- Updated huddle injected context (`before_agent_start`) with explicit guidance:
  - use `session_query` when session path is known
  - otherwise search `~/.pi/agent/sessions` with `fd`/`rg`, optionally narrow via `fzf` and inspect with `bat/head/tail`.
- Updated `skills/huddle/SKILL.md` and `skills/pi-session-query/SKILL.md` with the search-then-query workflow.
- Updated README to document `session_query`, safe `fzf` usage, and the prior-session research workflow.

## Current Task: fix pi-footsie footer behavior and width safety
- [x] Investigate crash report and identify whether pi-footsie caused the over-width render
- [x] Preserve default footer info by switching from `setFooter()` replacement to additive `setStatus()`
- [x] Remove custom line rendering path that can violate width constraints
- [x] Update package imports/metadata/docs to match current Pi namespace and behavior
- [ ] User validate in-session: default footer stats remain visible and `footsie` status appears/updates
- [x] Fix stale extension context crash by removing interval-based captured ctx usage in `pi-footsie`

### Review (pi-footsie footer fix)
- Crash line in `pi-crash.log` was from a long `pi-dynamic-models` log line, not `pi-footsie` footer rendering.
- `pi-footsie` was still UX-regressive because it replaced Pi's default footer (`setFooter`), hiding built-in token/model/status rows.
- Reworked `pi-footsie/src/index.ts` to use `ctx.ui.setStatus("footsie", ...)` with periodic refresh instead of `setFooter`.
- Result: default footer remains intact; host/IP appears as an extra status entry.
- Updated per user request to reduce crowding: dropped os/mem/load/up and condensed host/IP.
- Added frustration meter (`fr:<count>`) based on vulgarity usage in user messages.
- Fixed stale ctx crash: removed 5s interval retaining old ctx; status now updates on `session_start` and `input` events with fresh ctx.
- Updated imports to `@earendil-works/pi-coding-agent` and updated README/package description accordingly.


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

## Current Task: pi-huddle exclusion list + pi-leash sudo password cache
- [x] pi-huddle: replace `HUDDLE_MODE_TOOLS`/`NORMAL_MODE_TOOLS` allowlists with `HUDDLE_EXCLUDED_TOOLS` exclusion model (default empty) <!-- id: huddle-excl-1 -->
- [x] pi-huddle: snapshot prior active tools on enter, restore on exit, no-op when exclusion list is empty (preserves web_search etc. registered by other extensions) <!-- id: huddle-excl-2 -->
- [x] pi-huddle: update before_agent_start system prompt to stop enumerating a hard-coded tool list <!-- id: huddle-excl-3 -->
- [x] pi-leash: add `sudoMode.cacheEnabled` (default true) and `sudoMode.cacheTtl` (default 300_000ms) config fields <!-- id: leash-cache-1 -->
- [x] pi-leash: add module-scoped in-memory password cache with TTL timer, auto-clear on expiry / process exit / session_shutdown <!-- id: leash-cache-2 -->
- [x] pi-leash: render Tab-toggleable `[ ] Remember password for N min` checkbox in sudo password dialog (default OFF — explicit per-prompt opt-in) <!-- id: leash-cache-3 -->
- [x] pi-leash: skip password dialog when cache is warm; approval dialog still runs every time <!-- id: leash-cache-4 -->
- [x] pi-leash: clear cache on "incorrect password" stderr; notify user that cached password was rejected <!-- id: leash-cache-5 -->
- [x] Quality gates: confirm no new typecheck errors introduced in either package <!-- id: huddle-leash-qg-1 -->
- [ ] Visually verify in running pi: huddle toggle preserves web_search; sudo cache toggle appears and works across two consecutive sudo commands <!-- id: huddle-leash-verify -->
- [x] ~~Fix dialogs eating terminal scrollback by opting into `ctx.ui.custom({ overlay: true })`~~ — reverted (`1816f69`). Overlay mode changes the look-and-feel in ways the user rejected; inline rendering is the right model for tool UIs. See `tasks/lessons.md` “Overlay mode is the wrong tool for tool UIs in pi.” <!-- id: dialog-overlay-1 -->
- [ ] Fix scrollback in long-content gather_input dialogs WITHIN pi-huddle (not upstream). Likely caused by dialog height growth when freeform text wraps, which triggers terminal auto-scroll-on-output. Candidate approach: stable-height rendering — reserve a fixed N rows for the freeform input area and scroll within those rows rather than growing the dialog vertically. Entry point: `gather-input-dialog.ts` `render()`. <!-- id: dialog-scrollback-fix-local -->

### Review (dialog scrollback fix via overlay mode)
- **Root cause**: `ctx.ui.custom()` defaults to *inline* rendering, which appends dialog output to the chat buffer on every render. Each keystroke triggers a re-render that grows/shrinks the buffer at the bottom, causing the terminal to scroll-snap to the cursor and making prior scrollback unreachable while a dialog is open.
- **Fix**: pi-coding-agent 0.x exposes `{ overlay: true }` on `ctx.ui.custom()` (CHANGELOG line 2380 in the global install: "floating modal components that composite over existing content without clearing the screen"). With overlay mode, the dialog composites over the chat buffer instead of growing it, so scrollback stays intact and the viewport doesn't snap.
- **Files**:
  - `pi-huddle/extensions/index.ts`: opted-in for all three custom() call sites (gather_input dialog, edit/write permission dialog, bash permission dialog).
  - `pi-leash/src/hooks/permission-gate.ts`: opted-in for the sudo password dialog and the dangerous-command approval dialog.
- **Compatibility**: `overlay?: boolean` is already in the 0.52.7 `ExtensionUIContext.custom()` type signature, so the change is backward-compatible with every supported pi version.
- **Quality gate**: `pnpm typecheck` still shows only the 4 pre-existing `selectConfirm`/`selectCancel` errors.

### Review (pi-huddle exclusion list + pi-leash sudo cache)
- **pi-huddle/extensions/index.ts**: removed allowlist constants; introduced `HUDDLE_EXCLUDED_TOOLS: string[] = []` plus `applyHuddleTools()` / `restoreNormalTools()` helpers that snapshot `pi.getActiveTools()` only when there's something to exclude. Result: toggling huddle no longer clobbers dynamically-registered tools (web_search, web_fetch, image_gen, etc.).
- **pi-leash/src/config.ts**: extended `sudoMode` interface and `ResolvedConfig` with `cacheEnabled` (default true) and `cacheTtl` (default 300000ms).
- **pi-leash/src/hooks/permission-gate.ts**:
  - Added module-scoped `PasswordCache` with `setPasswordCache`/`getCachedPassword`/`clearPasswordCache` helpers. Timer is `unref()`'d so it doesn't keep the process alive. `installProcessExitHook()` clears the cache on `exit`/`SIGINT`/`SIGTERM`.
  - `promptForSudoPassword` now takes `cacheEnabled` and `cacheTtl` parameters and renders a Tab-toggleable `[ ] Remember password for N min (in-memory only)` checkbox. Returns `{ password, remember }`.
  - `setupPermissionGateHook` registers a `session_shutdown` listener that clears the cache, and the sudo flow tries the cache before showing the password dialog. The approval dialog (allow/deny) still runs for every sudo invocation — only the password step is bypassed.
  - On `incorrect password` stderr with a cache hit, the cache is invalidated and the user is notified explicitly. Local `password` reference is dropped after execution.
- **Quality gates**: `pnpm typecheck` and `pnpm lint` in pi-leash show only the same 4 pre-existing `selectConfirm`/`selectCancel` typing errors and the same 2 pre-existing `.js` extension lint errors that existed before these edits. pi-huddle has no configured build/lint scripts; ad-hoc tsc shows the same 5 pre-existing errors as on `main`.
- **Not done**: live visual verification in pi (requires the user to run the agent and exercise both flows).

## Earlier task: fix Enter key behavior in permission approval dialog
- [x] Reproduce/inspect why Enter is ignored in dangerous-command approval UI <!-- id: leash-enter-1 -->
- [x] Add robust Enter detection (`Key.enter`, `\r`, `\n`) for approval and password dialogs <!-- id: leash-enter-2 -->
- [ ] Verify interactively that Enter now confirms approval without requiring `y` <!-- id: leash-enter-3 -->
- [x] Switch confirm/cancel handlers to use `keybindings.matches(selectConfirm/selectCancel)` with raw-key fallback <!-- id: leash-enter-7 -->
- [x] Handle combined CRLF Enter payloads (`"\r\n"`) in dialog key handlers <!-- id: leash-enter-4 -->
- [x] Prevent empty Enter submit in sudo password dialog to avoid cross-dialog Enter bleed <!-- id: leash-enter-5 -->
- [ ] Add short Enter debounce window on sudo password dialog open to absorb carry-over Enter from approval dialog <!-- id: leash-enter-6 --> (reverted: interfered with approval UX)
