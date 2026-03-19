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
