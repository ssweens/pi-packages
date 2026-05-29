# Tasks

## Current Task: pi-account-switcher add hotkey for account selector
- [x] Clone `hieplp/pi-account-switcher` fork into workspace
- [x] Add `Ctrl+Shift+C` shortcut to open account selector
- [x] Update README/USAGE docs to include the new shortcut
- [x] Run available quality gates for the fork
- [x] Update this task review section

### Review (pi-account-switcher shortcut)
- Cloned `pi-account-switcher` into `/Users/ssweens/src/pi-packages/pi-account-switcher`.
- Added `pi.registerShortcut("ctrl+shift+c", ...)` in `src/index.ts`.
- Shortcut opens the interactive account picker and activates the selected account (same behavior as `/accounts:list`).
- Updated docs:
  - `pi-account-switcher/README.md`
  - `pi-account-switcher/USAGE.md`
- Quality gates (in `pi-account-switcher`):
  - `npm run typecheck` ✅
  - `npm test` ✅

## Current Task: pi-huddle switch toggle shortcut from Alt+H to Ctrl+H
- [x] Change huddle shortcut registration to `Ctrl+H`
- [x] Update huddle docs/skill text to reflect `Ctrl+H`
- [x] Bump `pi-huddle` version and changelog for the shortcut change
- [x] Run available quality gate(s) for `pi-huddle`
- [x] Update this task review section

### Review (pi-huddle Ctrl+H shortcut)
- Updated runtime shortcut binding in `pi-huddle/extensions/index.ts` from `alt+h` to `ctrl+h`.
- Fixed stale extension header comment typo (`Alt+P`) and aligned it to `Ctrl+H`.
- Updated user-facing docs and skill references:
  - `pi-huddle/README.md`
  - `pi-huddle/skills/huddle/SKILL.md`
- Bumped package version:
  - `pi-huddle/package.json`: `1.5.0` → `1.5.1`
- Updated `pi-huddle/CHANGELOG.md` with a new `1.5.1` entry describing the shortcut change.
- Quality gate:
  - `npm pack --dry-run` in `pi-huddle` ✅ (package metadata and contents validated)

## Current Task: pi-leash dangerous command trust windows + heredoc/pipeline detection
- [x] Add dangerous-command prompt options for temporary/session trust windows (`w` 5 minutes, `s` session)
- [x] Restrict trust-window bypass to non-evil allowlisted categories only
- [x] Parse dangerous content across complex commands (pipelines and shell heredoc scripts) for matching and bypass eligibility
- [x] Update README and CHANGELOG for the new permission-gate options and semantics
- [x] Run pi-leash quality gates (typecheck/lint/tests) and record environment constraints
- [x] Update this task review section

### Review (pi-leash trust windows + complex shell parsing)
- Added new dangerous-command prompt options in `pi-leash/src/hooks/permission-gate.ts`:
  - `w`: allow eligible dangerous commands for 5 minutes
  - `s`: allow eligible dangerous commands for the current session
- Added in-memory trust state:
  - `allowEligibleDangerousUntil` (5-minute TTL window)
  - `allowEligibleDangerousForSession` (session-long)
- Restricted bypass eligibility to a non-evil allowlist only:
  - `recursive force delete` (`rm -rf`)
  - `insecure recursive permissions` (`chmod -R ...` world-writable)
  - `recursive ownership change` (`chown -R`)
- Preserved strict exclusions from trust bypass:
  - privilege escalation (`sudo`/`doas`/`pkexec`)
  - disk/filesystem/partition tools
  - `shred`
  - container-escape patterns
- Replaced single-match dangerous detection with multi-match collection:
  - `findDangerousMatches(...)` now collects all matching dangerous signals
  - recursive structural analysis of shell heredoc payloads for shell interpreters (`sh`, `bash`, etc.) with bounded depth
- Extended cwd-scope detection (`isCwdScopedFileOperation`) to account for:
  - pipelines
  - shell heredoc script bodies (recursive)
  - bare `.` target handling
- Docs updated:
  - `pi-leash/README.md`: new `w`/`s` options + eligibility/exclusion semantics + complex shell parsing note
  - `pi-leash/CHANGELOG.md`: added `1.2.1` entry
- Dangerous-command prompt transparency improved:
  - now shows **Reason**, **Source**, and **Trigger** so users can see exactly what matched (`rm -rf`, custom regex, or parse-fallback pattern)
- Tests updated:
  - `pi-leash/src/hooks/permission-gate.test.ts` now covers pipeline + heredoc cwd-scope cases
- Quality gates (environment baseline in this checkout):
  - `pnpm typecheck` ❌ (pre-existing missing vitest/types + existing unrelated type issues)
  - `pnpm lint` ❌ (pre-existing baseline lint issues in vendored/untouched files; touched file still includes existing vendored-import extension warning)
  - `pnpm test` ❌ (`vitest` not installed in current environment)

## Current Task: pi-leash dangerous-command gate add cwd file-ops session allowance
- [x] Add a new dangerous-command prompt option that allows any cwd-scoped file operation for the current session only
- [x] Implement conservative safety checks so this bypass only applies when extracted file targets are all inside `cwd`
- [x] Update `pi-leash` README to document the new option
- [x] Run `pi-leash` quality gates (typecheck, lint, tests)
- [x] Update this task review with verification notes

### Review (pi-leash cwd file-ops session allowance)
- Added a new dangerous-command approval choice in `src/hooks/permission-gate.ts`:
  - `c`: **Allow cwd file ops this session**.
- Implemented `isCwdScopedFileOperation(command, cwd)` to conservatively gate this behavior:
  - Command must have extracted file targets.
  - Every extracted target must be inside `cwd`.
- Added session-scoped bypass flag for dangerous-command prompts:
  - When enabled via `c`, future dangerous `bash` commands are auto-allowed only if they satisfy the same cwd-scoped file-operation check.
- Updated docs in `pi-leash/README.md` under **Permission gate** to describe `y/a/c/n` options and semantics.
- Added tests in `src/hooks/permission-gate.test.ts` for cwd-scoped detection helper.
- Quality gate status in this checkout:
  - `pnpm typecheck` ❌ (pre-existing environment/baseline issues: missing dev deps/types + existing typing issues)
  - `pnpm lint` ❌ (pre-existing baseline/vendor formatting/import-extension issues; no new functional errors tied to this feature)
  - `pnpm test` ❌ (`vitest` not found in current environment)

## Current Task: fully rename `pi-claude-marketplace` extension to `pi-plugins`
- [x] Rename package directory and extension directory to `pi-plugins`
- [x] Replace externally visible names: package name, state directory, tool names, generated agent prefixes/markers, docs/tests
- [x] Keep unrelated Claude plugin marketplace concepts/command behavior intact unless they specifically use the old extension name
- [x] Run typecheck, lint, format, and tests
- [x] Update task review with verification notes

### Review (pi-plugins full rename)
- Renamed package root from `pi-claude-marketplace/` to `pi-plugins/`.
- Renamed extension path from `extensions/pi-claude-marketplace/` to `extensions/pi-plugins/`.
- Updated package metadata to `@ssweens/pi-plugins`, with repository metadata pointing at `ssweens/pi-packages`.
- Updated externally visible runtime names:
  - state/storage dir now uses `pi-plugins`
  - LLM tools are now `pi_plugins_list` and `pi_plugins_plugin_list`
  - generated agent prefix/marker now use `pi-plugins`
  - MCP ownership marker key is now `_piPlugins`
  - E2E ref env var is now `PI_PLUGINS_E2E_REF`
- Preserved the existing `/claude:plugin` command behavior and Claude plugin marketplace terminology where it describes the upstream ecosystem rather than this extension's package name.
- Verification:
  - `npm run typecheck` ✅
  - `npm run lint` ✅
  - `npm run format:check` ✅
  - `NODE_OPTIONS=--experimental-strip-types npm test` ✅ (1037 pass)

## Current Task: add `pi-claude-marketplace` and enable SSH git repo URLs
- [x] Fork/add `pi-claude-marketplace` into this `pi-packages` workspace
- [x] Locate and update git repository URL validation/parsing to accept SSH forms (e.g. `git@github.com:owner/repo.git`, `ssh://git@...`)
- [x] Add/adjust tests covering both HTTPS and SSH git URL cases
- [x] Run quality gates for the package (tests/lint/typecheck/build as available)
- [x] Update package docs (README and any relevant docs) to document SSH support
- [x] Update `tasks/todo.md` review section with outcome and verification notes

### Review (pi-claude-marketplace SSH git repo support)
- Added `pi-claude-marketplace` from `https://github.com/acolomba/pi-claude-marketplace.git` into this workspace as a source directory (nested `.git` metadata removed so it can be tracked by `pi-packages`). It was later fully renamed to `pi-plugins`.
- Updated `domain/source.ts` to accept GitHub SSH marketplace sources:
  - `git@github.com:<owner>/<repo>[.git][#<ref>]`
  - `ssh://git@github.com/<owner>/<repo>[.git][#<ref>]`
- Preserved SSH clone URLs on parsed GitHub sources via `cloneUrl`, while HTTPS and `owner/repo` continue to use canonical HTTPS clone URLs.
- Updated `marketplace add` to clone with `source.cloneUrl` when present.
- Added native `git` fallback in `platform/git.ts` for SSH clone/fetch only; HTTPS remains on `isomorphic-git`.
- Updated the shell-out architecture test so `child_process` is allowed only inside `platform/git.ts` for SSH transport.
- Updated README docs and added `pi-plugins/TEST_COVERAGE.md`.
- Verification:
  - `npm run typecheck` ✅
  - `npm run lint` ✅
  - `npm run format:check` ✅
  - `node --experimental-strip-types --test tests/domain/source.test.ts tests/orchestrators/marketplace/add.test.ts tests/architecture/no-shell-out.test.ts` ✅ (54 tests)
  - `NODE_OPTIONS=--experimental-strip-types npm test` ✅ (1037 pass)

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
