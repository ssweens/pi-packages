# pi-recap

Away recap extension for [pi](https://github.com/badlogic/pi-mono). Shows a compact recap line when the user returns from idle — like Claude Code's "away summary" feature.

## How it works

1. After each agent completion, pi-recap starts an idle timer (default: 3 min)
2. If the user types before the timer fires → timer is cancelled (no recap)
3. If the timer fires → a side LLM call generates a compact recap of the conversation
4. The recap appears as an ephemeral widget above the editor — never written to transcript
5. The recap is auto-cleared on the user's next input

**Gating** (prevents spam):
- Requires ≥3 user turns in the session
- Requires ≥2 new messages since the last recap
- Skips if there's draft text in the editor
- Skips if the model or API key isn't available

## Installation

```bash
pi install @ssweens/pi-recap
```

Or from a local checkout:

```bash
pi install /path/to/pi-recaps
```

## Usage

Once installed, the recap runs automatically. No action needed.

```text
# After 3+ minutes idle, you'll see when you start typing:
※ recap: Refactoring the auth module's token refresh logic. Next: write unit tests for the new refresh handler.
```

### Commands

| Command | Description |
|---------|-------------|
| `/recap on` | Enable recap |
| `/recap off` | Disable recap |
| `/recap 5m` | Set idle threshold to 5 minutes |
| `/recap 30s` | Set idle threshold to 30 seconds |
| `/recap status` | Show current settings |

### Configuration

- **Default threshold:** 3 minutes
- **First 3 recaps** include a `(disable recaps in /config)` hint
- Recap count persists across session reloads

## How it differs from Claude Code

| Aspect | Claude Code | pi-recap |
|--------|-------------|----------|
| **Trigger** | Window blur → timer → pre-generate | Agent end → timer → generate on fire |
| **Generation** | Pre-generated while away | Generated on idle expiry |
| **Detection** | Platform focus/blur events | Idle timer after agent completion |
| **Cost** | ~free (warm cache) | ~free (warm cache, no tools) |

The idle-timer approach means the recap is generated when the timer fires (while user is still away). On first keystroke after return, the recap is already visible.

## License

MIT
