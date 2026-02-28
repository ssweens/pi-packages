# pi-packages

> **Work in progress.** These packages are under active development. Configs, APIs, and formats may change at any time without backward compatibility or deprecation notices.

Extension packages for [pi](https://github.com/badlogic/pi-mono).

## Packages

| Package | Description |
|---------|-------------|
| **pi-vertex** | Google Vertex AI provider — Gemini, Claude, and all MaaS models |
| **pi-handoff** | Context management for agentic coding workflows |
| **pi-image-gen** | Provider-agnostic image generation |
| **pi-dynamic-models** | Dynamic model discovery from any configured API server at startup |
| **pi-plan-mode** | Plan mode — read-only exploration before execution |
| **pi-file-todos** | File-based todo tracking skill |

## Installation

```bash
pi install @ssweens/pi-vertex
pi install @ssweens/pi-handoff
pi install @ssweens/pi-image-gen
pi install @ssweens/pi-dynamic-models
pi install @ssweens/pi-plan-mode
pi install @ssweens/pi-file-todos
```

Or from a local checkout:

```bash
pi install /path/to/pi-packages/pi-vertex
```

## Screenshots

Each package with a TUI component includes a `screenshot.png` captured from a live pi session. To regenerate:

```bash
# All packages
./scripts/capture-all.sh

# Single package
./scripts/capture-all.sh pi-vertex
```

### Requirements

- **iTerm2** — screenshots are captured as native window captures via `screencapture -l`
- **Google Cloud credentials** — needed for pi-vertex models to appear in the selector

### Configuration

Set these environment variables (or edit the defaults in `scripts/capture-screenshot.sh`):

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
export GOOGLE_CLOUD_PROJECT=your-project-id
export GOOGLE_CLOUD_LOCATION=global
```

### Adding a screenshot for a new package

1. Create a keystroke file at `scripts/keystrokes/<package-name-without-pi-prefix>.sh`
2. The script receives `$WID` (iTerm window ID) and should send keystrokes to reach the desired TUI state
3. Run `./scripts/capture-all.sh pi-<name>`

Example keystroke file (`scripts/keystrokes/vertex.sh`):

```bash
# Open model selector (Ctrl+L), filter to vertex models
osascript -e "tell application \"iTerm2\" to tell current session of window id ${WID} to write text (ASCII character 12)"
sleep 3
osascript -e "tell application \"iTerm2\" to tell current session of window id ${WID} to write text \"ver\" without newline"
sleep 2
```

### How it works

1. Opens a new iTerm2 window
2. Launches `pi --no-session --model k2p5`
3. Sends "Hello!" and waits for a response (conversation context)
4. Runs the keystroke file to navigate to the target TUI state
5. Captures the window with `screencapture -l <window-id>`
6. Closes the window

## License

MIT
