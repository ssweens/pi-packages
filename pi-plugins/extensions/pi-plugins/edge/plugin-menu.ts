// edge/plugin-menu.ts
//
// TUI navigation menus for `/plugin` command when run without arguments.
// Menus should never route users into raw usage output: selected actions either
// execute directly, open a submenu, or the router prompts for required args.

import type { ExtensionCommandContext } from "../platform/pi-api.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";

interface MenuItem {
  label: string;
  description: string;
  action: string;
}

const TOP_LEVEL_MENU_ITEMS: MenuItem[] = [
  {
    label: "bootstrap",
    description: "Add the official marketplace and enable autoupdate",
    action: "bootstrap",
  },
  {
    label: "install",
    description: "Prompt for <plugin>@<marketplace>, then install it",
    action: "install",
  },
  {
    label: "uninstall",
    description: "Prompt for <plugin>@<marketplace>, then remove it",
    action: "uninstall",
  },
  {
    label: "update",
    description: "Update all installed plugins",
    action: "update",
  },
  {
    label: "reinstall",
    description: "Reinstall all installed plugins",
    action: "reinstall",
  },
  {
    label: "list",
    description: "List installed and available plugins",
    action: "list",
  },
  {
    label: "import",
    description: "Import plugin settings from Claude Code",
    action: "import",
  },
  {
    label: "marketplace",
    description: "Open marketplace actions",
    action: "marketplace",
  },
];

const MARKETPLACE_MENU_ITEMS: MenuItem[] = [
  {
    label: "add",
    description: "Prompt for a source, then add a marketplace",
    action: "add",
  },
  {
    label: "remove",
    description: "Prompt for a marketplace name, then remove it",
    action: "remove",
  },
  {
    label: "list",
    description: "List configured marketplaces",
    action: "list",
  },
  {
    label: "update",
    description: "Update all configured marketplaces",
    action: "update",
  },
  {
    label: "autoupdate",
    description: "Enable autoupdate for configured marketplaces",
    action: "autoupdate",
  },
  {
    label: "noautoupdate",
    description: "Disable autoupdate for configured marketplaces",
    action: "noautoupdate",
  },
];

class PluginMenuComponent implements Component {
  private selected = 0;
  private disposed = false;
  private theme: Theme;
  private done: (action: string | undefined) => void;
  private title: string;
  private subtitle: string;
  private items: readonly MenuItem[];

  constructor(
    theme: Theme,
    title: string,
    subtitle: string,
    items: readonly MenuItem[],
    done: (action: string | undefined) => void,
  ) {
    this.theme = theme;
    this.title = title;
    this.subtitle = subtitle;
    this.items = items;
    this.done = done;
  }

  handleInput(data: string): void {
    if (this.disposed) return;

    if (matchesKey(data, "escape")) {
      this.done(undefined);
      return;
    }

    if (matchesKey(data, "return") || data === "\r" || data === "\n") {
      this.done(this.items[this.selected]?.action);
      return;
    }

    if (matchesKey(data, "up") || data === "k") {
      this.selected = Math.max(0, this.selected - 1);
    } else if (matchesKey(data, "down") || data === "j") {
      this.selected = Math.min(this.items.length - 1, this.selected + 1);
    }
  }

  render(width: number): string[] {
    const w = Math.max(48, Math.min(width - 4, 76));
    const th = this.theme;
    const innerW = w - 2;
    const lines: string[] = [];

    const pad = (s: string, len: number) => {
      const vis = visibleWidth(s);
      return s + " ".repeat(Math.max(0, len - vis));
    };

    const row = (content: string) =>
      th.fg("border", "│") + pad(content, innerW) + th.fg("border", "│");

    lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
    lines.push(row(` ${th.fg("accent", this.title)}`));
    lines.push(row(""));
    lines.push(row(` ${th.fg("dim", this.subtitle)}`));
    lines.push(row(""));

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!;
      const isSelected = i === this.selected;
      const prefix = isSelected ? th.fg("accent", " ▶ ") : "   ";
      const label = isSelected
        ? th.fg("accent", item.label.padEnd(13))
        : th.fg("text", item.label.padEnd(13));
      const desc = th.fg("dim", item.description);

      lines.push(row(`${prefix}${label} ${desc}`));
    }

    lines.push(row(""));
    lines.push(row(` ${th.fg("dim", "↑↓/jk navigate • Enter select • Esc cancel")}`));
    lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));

    return lines;
  }

  invalidate(): void {}

  dispose(): void {
    this.disposed = true;
  }
}

async function showMenu(
  ctx: ExtensionCommandContext,
  title: string,
  subtitle: string,
  items: readonly MenuItem[],
): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>(
    (_tui, theme, _keybindings, done) =>
      new PluginMenuComponent(theme, title, subtitle, items, done),
    { overlay: true },
  );
}

export async function showPluginMenu(
  ctx: ExtensionCommandContext,
): Promise<string | undefined> {
  return showMenu(ctx, "🔌 Plugin Manager", "Select an action:", TOP_LEVEL_MENU_ITEMS);
}

export async function showMarketplaceMenu(
  ctx: ExtensionCommandContext,
): Promise<string | undefined> {
  return showMenu(
    ctx,
    "🔌 Marketplace Manager",
    "Select a marketplace action:",
    MARKETPLACE_MENU_ITEMS,
  );
}
