# @ssweens/pi-footsie

A Pi extension that adds compact host/IP and a vulgarity-based swear jar meter to Pi's existing footer status area (without replacing the default footer).

![pi-footsie banner](https://raw.githubusercontent.com/ssweens/pi-packages/main/pi-footsie/banner.png)

## Features

- **Compact Host/IP** — Condensed `<host>@<ip>` indicator for fast environment awareness.
- **Swear Jar Meter** — `swear jar:$X.XX`, increasing by **$0.25** per vulgarity occurrence found in user messages for the current session.
- **Live Refresh** — Status refreshes on new input/session events.
- **Default Footer Preserved** — Keeps Pi's built-in footer (tokens/model/statuses) and adds footsie as an extra status entry.
- **On/Off Toggle** — Turn it off or on at any time using the `/sysinfo` slash command.

## Installation

Add it to your global settings file (`~/.pi/agent/settings.json`):

```json
{
  "packages": [
    "npm:@ssweens/pi-footsie"
  ]
}
```

Or install it from source by checking out the monorepo:

```bash
cd ~/.pi/agent/extensions/
ln -s /path/to/pi-packages/pi-footsie .
```

## Usage

Once installed, the system info status is enabled **automatically** on startup.

### Command

Toggle the system info status dynamically inside any active session:

```bash
/sysinfo off       # Hides system info status
/sysinfo on        # Shows system info status
/sysinfo           # Toggles between on and off
```

## Customization

The swear jar meter is color-coded by vulgarity count:
- `0` → muted
- `1-4` → warning
- `5+` → error

## License

MIT
