# Lessons Learned

## NEVER commit before verifying + NEVER commit without explicit user permission
- **Verify first, always.** Run the actual command/behavior. Tests passing ≠ behavior correct.
- **Then ask**: "May I commit?" Do not auto-commit.
- AGENTS.md is explicit: "Suggest git add and git commit commands — Then ask user permission."
- Violation of this is not a minor slip. It wastes the user's time and forces rollbacks.

## Trace the layer the user pointed at before going lower
When the user points to an extension/package, inspect that package’s code path first. Don’t jump to core runtime behavior until you’ve proven the extension delegates there; otherwise you waste time diagnosing the wrong layer and miss the actual bug in the extension itself.


## Alphabetizing Model Lists
When a package provides a large number of models (like `pi-vertex` with 40+ models), it is better for UX to sort them alphabetically by their display name rather than by provider/category or registration order. This makes it easier for users to find specific models in lists.

## Pi tool_call vs tool_result behavior
Do not assume mutating `event.output` in a `tool_call` hook will override tool results. In pi, `tool_call` can only block/allow; to replace output you must either:
- alter tool input before execution, and/or
- capture data and inject it in a `tool_result` hook.

For sudo interception specifically: execute sudo in extension code, replace the original bash command with a noop, then inject captured stdout/stderr/exit in `tool_result` keyed by `toolCallId`.

## Node child_process caveat for sudo
`child_process.exec()` does not support an `input` option for stdin. If you need to feed a sudo password to `sudo -S`, use `spawn()` and write to `child.stdin`, then close stdin. Also pass `sudo -p ''` to suppress terminal password prompt text leaking into tool output.

## TUI key handling robustness
Do not rely only on `matchesKey(data, Key.enter)` for Enter in custom dialogs. Some terminals/sessions deliver raw `\r` or `\n`, and some deliver combined `\r\n`. Add fallback checks for all forms so Enter consistently works in approval/password prompts.

## Cross-dialog key bleed
When one dialog closes and another opens immediately, the confirming Enter can bleed into the next dialog. Mitigation that is safe: never accept empty Enter submit in password dialogs. Time-based Enter debouncing can degrade approval UX and should be avoided unless proven necessary with instrumentation.

## Prefer keybinding manager over raw key matching in custom dialogs
For confirm/cancel in `ctx.ui.custom` dialogs, use the provided `keybindings` manager (`kb.matches(data, "selectConfirm")` / `"selectCancel"`) and keep raw Enter/Escape only as fallback. Raw-only handling can diverge across terminals and regress UX.

## NEVER commit visual changes without running pi and screenshotting first
**Violation incident (commits `e3f3606`, `cc10fd0`):** Added `{ overlay: true }` to `ctx.ui.custom()` calls in pi-huddle and pi-leash to “preserve scrollback,” typechecked clean, and pushed without ever running pi to look at the result. That option doesn’t just preserve scrollback — it switches pi-tui from inline rendering (full-width dialog at the bottom of chat) to a floating centered modal, which is a completely different look-and-feel that the user never approved.

**Rule:** ANY change to a dialog’s `ctx.ui.custom()` options, an overlay’s positioning/sizing, or a rendered component’s layout is a visual change. Visual changes are NOT verified by `pnpm typecheck`. They require:
  1. Running pi locally and exercising the changed surface.
  2. Looking at it (or screenshotting it) before committing.
  3. If the work cannot be tested locally (e.g., agent runtime), surface the visual implication explicitly to the user and propose options BEFORE committing, not after.

**Specific pi-tui knowledge:**
  - `ctx.ui.custom(factory)` (no options) → inline rendering at the bottom of the chat buffer. Looks like part of chat. Eats scrollback on re-render.
  - `ctx.ui.custom(factory, { overlay: true })` → floating modal compositing over scrollback. Default anchor is `“center”` so the dialog renders in the middle of the screen with chat visible on the sides. Different look entirely.
  - `overlayOptions: { anchor: “bottom-left”, col: 0, width: “100%” }` *might* visually approximate the inline rendering while still compositing — unverified, must be screenshotted before shipping.

**Tripwire:** If a code change touches `ctx.ui.custom()` options, overlay anchors/sizes, theme calls, ANSI color choices, layout indents, wrapping, or anything that affects what pixels appear on screen — do NOT commit it from a non-interactive agent run. Either run pi or hand the change to the user with a “please verify visually before commit” gate.

## Overlay mode is the wrong tool for tool UIs in pi
**Investigation summary (do not re-litigate without new evidence):** Tried `ctx.ui.custom({ overlay: true })` with multiple `overlayOptions` configurations (default center-anchored, `anchor: “bottom-left”` + `width: “100%”`, plus `margin: { bottom: 6 }`, plus a hand-rolled `gather_input` header line styled with `theme.bg(“toolPendingBg”, theme.fg(“toolTitle”, ...))` to mimic pi’s inline tool-call header).

**Result:** Every configuration was rejected by the user as visually wrong. Specific failure modes:
  - Default centered overlay = floating modal in the middle with chat content peeking on the sides. Not the inline look at all.
  - `bottom-left` + `width: “100%”` + no margin = full-width strip at the bottom but **covers pi’s footer** (cwd, stats, input prompt). Footer is a regular pi child component, not a separate layer, so the overlay composites over it.
  - `bottom-left` + `margin: { bottom: 6 }` = footer visible, but for tall content (long dialogs with 2+ questions and 4+ options with long descriptions) the dialog overflows the available height and gets clamped by pi-tui to start at `row = marginTop`, **covering the spot in chat where pi rendered the tool-call header**. So the “gather_input” label disappears.
  - Same + manually rendered header line inside the overlay = closer to target, but “needs more space and covers up content” per the user. The overlay still occupies a big block at the bottom that doesn’t feel like part of the chat flow.

**Why inline is the right model for tool UIs:** pi’s tool execution component (`pi-coding-agent/dist/modes/interactive/components/tool-execution.js`) renders the tool-call header and the tool’s UI together as part of the chat stream. Scrollback shows them as a coherent unit. Overlay mode breaks this contract by lifting the UI out of the chat stream and floating it independently — there’s no clean way to also surface the chat-stream header above it without duplicating or hacking.

**The original scrollback complaint (“I can’t scroll back through prior content while answering a gather_input question”) is a separate, upstream pi-tui issue.** It probably manifests when the dialog’s line count grows (e.g., freeform text wraps and adds rows) and the terminal interprets the growth as new output worth scrolling for. Don’t try to fix it with overlay mode — file/track upstream instead.

**Action when this comes up again:** Default to inline rendering for any tool UI in pi. Only consider overlay mode for:
  - True modal flows (e.g., a one-off /command dialog that’s not part of a tool call)
  - Persistent side panels (with `nonCapturing: true`)
  - Things explicitly designed to float (DOOM-overlay example)

Do not try to make overlay mode look like inline mode. They’re different rendering models with different visual contracts.

## Footer extension rule: add, don’t replace
When a user asks for "extra footer info", default to `ctx.ui.setStatus()` (additive) instead of `ctx.ui.setFooter()` (replacement). Replacing the footer hides built-in token/model/status rows and is usually a UX regression.

Also: when Pi reports a width crash, check `~/.pi/agent/pi-crash.log` line indices before assuming your component caused it — the offending line may come from another extension/log renderer.

## Never capture extension ctx in long-lived async callbacks
In Pi extensions, a `ctx` becomes stale after reload/session replacement. Do not retain command/session `ctx` inside `setInterval`, delayed promises, or other long-lived callbacks. Prefer event-driven updates (`session_start`, `input`, etc.) using fresh callback ctx, or stop timers before any reload/session replacement path.

## Dangerous-command prompts must preserve access to the full command
If a permission dialog truncates or elides a potentially dangerous command to fit the screen, the user still needs a way to inspect the entire command before approving it. Stable-height rendering is good, but not if it hides critical command content with no recovery path. Any over-height fix for dangerous-command prompts must pair clamping with an explicit full-command inspection affordance (for example: scrollable preview, pager view, expand toggle, or secondary detail view).
