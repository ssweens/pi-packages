# pi-recap: Away recap extension

## Architecture

**Trigger model** (simpler, no focus/blur needed):
- After each `agent_end` → start an idle timer (configurable, default 3 min)
- On any user `input` → cancel pending timer, clear any visible recap
- If timer fires → generate recap via side LLM call → show as widget

**Gates** (matches Claude Code's gating):
- ≥3 user turns in session
- ≥2 new messages since last recap
- No draft text in editor (`ctx.ui.getEditorText()` length check)
- Model must be available

**Generation** (matches Claude Code's recap prompt):
- Single `complete()` call with conversation context
- No tools (omitted from Context)
- Never written to transcript (uses `setWidget()` only)
- Skip cache write (not configurable in options, but the call is fire-and-forget)

**Delivery**:
- `※ recap: <text>` shown via `ctx.ui.setWidget("pi-recap", [...])` above editor
- First 3 recaps include `(disable recaps in /config)` suffix
- Auto-invalidated on next user input (clears widget)

**Config**:
- `/recap on|off` — toggle
- `/recap <N>m` — set idle threshold in minutes
- Persist recap count via `pi.appendEntry("pi-recap", { count: N })`
