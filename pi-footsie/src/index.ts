import os from "node:os";
import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const VULGARITY_REGEX = /\b(fuck|fucking|fucked|shit|shitty|damn|bitch|asshole|wtf|bullshit|crap|dick|piss|motherfucker)\b/gi;

function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (!iface.internal && iface.family === "IPv4") {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join(" ");
}

function countVulgarityUsage(ctx: any): number {
  let count = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    if (entry.message.role !== "user") continue;
    const text = extractText(entry.message.content);
    const matches = text.match(VULGARITY_REGEX);
    count += matches?.length ?? 0;
  }
  return count;
}

let cachedPiVersion: string | null = null;

function getPiVersion(): string {
  if (cachedPiVersion !== null) return cachedPiVersion;
  try {
    // Try the full path from `which pi`
    const out = execSync("/Users/ssweens/.bun/bin/pi --version", { timeout: 5000, encoding: "utf8" }).trim();
    cachedPiVersion = out || "unknown";
  } catch {
    cachedPiVersion = "unknown";
  }
  return cachedPiVersion;
}

function compactHost(hostname: string): string {
  return hostname.split(".")[0] || hostname;
}

export default function (pi: ExtensionAPI) {
  let enabled = true;

  function renderStatus(ctx: any) {
    if (!enabled) {
      ctx.ui.setStatus("footsie", undefined);
      return;
    }

    const host = compactHost(os.hostname());
    const ip = getLocalIpAddress();
    const piVersion = getPiVersion();
    const vulgarityCount = countVulgarityUsage(ctx);
    const jarAmount = vulgarityCount * 0.25;
    const jarColor = vulgarityCount >= 5 ? "error" : vulgarityCount > 0 ? "warning" : "muted";

    const text =
      `${ctx.ui.theme.fg("text", `${host}@${ip}`)}` +
      `${ctx.ui.theme.fg("dim", " • ")}${ctx.ui.theme.fg("muted", `pi ${piVersion}`)}` +
      `${ctx.ui.theme.fg("dim", " • ")}${ctx.ui.theme.fg("muted", "swear jar:")}${ctx.ui.theme.fg(jarColor, `$${jarAmount.toFixed(2)}`)}`;

    ctx.ui.setStatus("footsie", text);
  }

  function clearStatus(ctx: any) {
    ctx.ui.setStatus("footsie", undefined);
  }

  pi.on("session_start", async (_event, ctx) => {
    if (enabled) renderStatus(ctx);
  });

  pi.on("input", async (_event, ctx) => {
    if (enabled) renderStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    clearStatus(ctx);
  });

  pi.registerCommand("sysinfo", {
    description: "Toggle system info footer status (on/off)",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();

      if (arg === "on" || (arg === "" && !enabled)) {
        enabled = true;
        renderStatus(ctx);
        ctx.ui.notify("System info footer enabled", "info");
      } else if (arg === "off" || (arg === "" && enabled)) {
        enabled = false;
        clearStatus(ctx);
        ctx.ui.notify("System info footer disabled", "info");
      } else {
        ctx.ui.notify("Unknown argument. Use '/sysinfo on' or '/sysinfo off'.", "error");
      }
    },
  });
}
