import os from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

// Helper to resolve the primary local non-internal IPv4 address
function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      // Skip loopback/internal and IPv6 for the primary address
      if (!iface.internal && iface.family === "IPv4") {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

// Format CPU load average (1 minute)
function formatLoad(): string {
  const load = os.loadavg()[0];
  return load !== undefined ? load.toFixed(2) : "0.00";
}

// Get free memory percentage
function getFreeMemoryPercent(): number {
  const total = os.totalmem();
  const free = os.freemem();
  if (total === 0) return 0;
  return Math.round((free / total) * 100);
}

// Format system uptime into days, hours, minutes
function formatUptime(): string {
  const uptime = os.uptime();
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (parts.length < 2) parts.push(`${minutes}m`);

  return parts.join(" ");
}

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function registerFooter(ctx: any) {
    ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
      // Re-render when git branch changes
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      // Periodically refresh system metrics (every 5 seconds)
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => {
        tui.requestRender();
      }, 5000);

      // Unref the timer so it doesn't prevent Node from exiting
      if (typeof intervalId.unref === "function") {
        intervalId.unref();
      }

      return {
        dispose: () => {
          unsub();
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        },
        invalidate() {},
        render(width: number): string[] {
          // System specs
          const host = os.hostname();
          const ip = getLocalIpAddress();
          const platform = os.platform();
          const freeMem = getFreeMemoryPercent();
          const load = formatLoad();
          const up = formatUptime();

          // Left side: sysinfo segments
          const hostSegment = theme.fg("accent", "sys:") + theme.fg("text", host);
          const ipSegment = theme.fg("dim", " • ") + theme.fg("muted", "ip:") + theme.fg("text", ip);
          const osSegment = theme.fg("dim", " • ") + theme.fg("muted", "os:") + theme.fg("text", platform);
          const memSegment = theme.fg("dim", " • ") + theme.fg("muted", "mem:") + theme.fg(freeMem < 15 ? "warning" : "text", `${freeMem}% free`);
          const loadSegment = theme.fg("dim", " • ") + theme.fg("muted", "load:") + theme.fg("text", load);
          const upSegment = theme.fg("dim", " • ") + theme.fg("muted", "up:") + theme.fg("text", up);

          const left = hostSegment + ipSegment + osSegment + memSegment + loadSegment + upSegment;

          // Right side: Active model and git branch
          const branch = footerData.getGitBranch();
          const branchStr = branch ? ` (${branch})` : "";
          const right = theme.fg("dim", `${ctx.model?.id || "no-model"}${branchStr}`);

          // Padding and truncate
          const padWidth = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
          const pad = " ".repeat(padWidth);

          return [truncateToWidth(left + pad + right, width)];
        },
      };
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    if (enabled) {
      registerFooter(ctx);
    }
  });

  pi.on("session_shutdown", async () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  });

  pi.registerCommand("sysinfo", {
    description: "Toggle custom system info footer (on/off)",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();

      if (arg === "on" || (arg === "" && !enabled)) {
        enabled = true;
        registerFooter(ctx);
        ctx.ui.notify("System info footer enabled", "info");
      } else if (arg === "off" || (arg === "" && enabled)) {
        enabled = false;
        ctx.ui.setFooter(undefined);
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        ctx.ui.notify("Default footer restored", "info");
      } else {
        ctx.ui.notify("Unknown argument. Use '/sysinfo on' or '/sysinfo off'.", "error");
      }
    },
  });
}
