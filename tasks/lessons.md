# Lessons Learned

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
