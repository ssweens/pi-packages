# @ssweens/pi-sysinfo-footer

A Pi extension that replaces the default terminal TUI footer with a rich, real-time system information dashboard. 

![pi-sysinfo-footer banner](https://raw.githubusercontent.com/ssweens/pi-packages/main/pi-sysinfo-footer/banner.png)

## Features

- **Hostname & Active IP** — Instantly see what machine and IP address your Pi session is running on (perfect for local development, VMs, SSH sessions, or remote containers).
- **Free Memory Tracker** — Real-time memory capacity percentage remaining (color-warned when low).
- **Load Average** — Standard 1-minute system CPU load average.
- **System Uptime** — Real-time uptime counter (formatted as `d h m`).
- **Dynamic Refresh** — Metric stats automatically refresh every **5 seconds** without waiting for keystrokes or prompts.
- **Git & Model Retained** — Keeps your current Git branch and active model on the right-hand side exactly like the default footer.
- **On/Off Toggle** — Turn it off or on at any time using the `/sysinfo` slash command.

## Installation

Add it to your global settings file (`~/.pi/agent/settings.json`):

```json
{
  "packages": [
    "npm:@ssweens/pi-sysinfo-footer"
  ]
}
```

Or install it from source by checking out the monorepo:

```bash
cd ~/.pi/agent/extensions/
ln -s /path/to/pi-packages/pi-sysinfo-footer .
```

## Usage

Once installed, the rich footer is enabled **automatically** on startup.

### Command

Toggle the footer dynamically inside any active session:

```bash
/sysinfo off       # Restores the default Pi TUI footer
/sysinfo on        # Enters sysinfo custom footer mode
/sysinfo           # Toggles between on and off
```

## Customization

Metrics are colored dynamically according to your active TUI theme. Memory indicators turn warning-colored when available RAM drops below 15% to help prevent out-of-memory crashes on heavy compile steps.

## License

MIT
