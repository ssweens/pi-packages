import {
  type ExtensionAPI,
  type ExtensionContext,
  ModelSelectorComponent,
} from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { type ResolvedConfig, updateAutoModeConfig } from "../config";
import {
  AUTO_MODE_USER_DECISION_ENTRY_TYPE,
  type AutoModeAction,
  type AutoModeUserDecision,
  type AutoModeVerdict,
  classifyAutoModeAction,
  getAutoModeModelLabel,
} from "../lib/auto-mode-classifier";

const SESSION_ENTRY_TYPE = "leash-auto-mode";
const VERDICT_ENTRY_TYPE = "leash-auto-verdict";
const VERDICT_STATUS_KEY = "leash-auto-verdict";
const VERDICT_STATUS_TIMEOUT_MS = 8_000;
const AUTO_BUSY_FRAME_INTERVAL_MS = 180;
const AUTO_BUSY_COLORS = ["accent", "warning", "success"] as const;

type SettingsAction = "toggle" | "select-model" | "close";

type RecordedVerdict = AutoModeVerdict & { timestamp: number };

interface AutoModeAudit {
  allow: number;
  ask: number;
  deny: number;
  last?: RecordedVerdict;
}

export interface AutoModeController {
  isEnabled(): boolean;
  classify(
    action: AutoModeAction,
    ctx: ExtensionContext,
  ): Promise<AutoModeVerdict>;
  recordVerdict(verdict: AutoModeVerdict, ctx: ExtensionContext): void;
  recordUserDecision?(
    decision: Omit<AutoModeUserDecision, "timestamp">,
    ctx: ExtensionContext,
  ): void;
}

function createAutoModeAudit(): AutoModeAudit {
  return { allow: 0, ask: 0, deny: 0 };
}

function readRecordedVerdict(data: unknown): RecordedVerdict | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as {
    decision?: unknown;
    reason?: unknown;
    source?: unknown;
    timestamp?: unknown;
  };
  if (
    (record.decision !== "allow" &&
      record.decision !== "ask" &&
      record.decision !== "deny") ||
    typeof record.reason !== "string" ||
    (record.source !== "classifier" &&
      record.source !== "safety" &&
      record.source !== "fallback") ||
    typeof record.timestamp !== "number"
  ) {
    return undefined;
  }
  return {
    decision: record.decision,
    reason: record.reason,
    source: record.source,
    timestamp: record.timestamp,
  };
}

function compactVerdictReason(reason: string): string {
  return reason.replace(/\s+/g, " ").trim().slice(0, 120);
}

function formatAuditStatus(audit: AutoModeAudit): string {
  const counts = `allow ${audit.allow} · ask ${audit.ask} · deny ${audit.deny}`;
  if (!audit.last)
    return `Leash auto decisions: ${counts}. No gated actions yet.`;
  return `Leash auto decisions: ${counts}. Last: ${audit.last.decision} [${audit.last.source}] — ${compactVerdictReason(audit.last.reason)}`;
}

function configuredClassifierModel(
  ctx: ExtensionContext,
  configured: string | null,
) {
  if (!configured) return ctx.model;

  const separator = configured.indexOf("/");
  if (separator <= 0 || separator === configured.length - 1) {
    return ctx.model;
  }
  return (
    ctx.modelRegistry.find(
      configured.slice(0, separator),
      configured.slice(separator + 1),
    ) ?? ctx.model
  );
}

/**
 * Pi exports its own `/model` selector but does not expose an extension UI
 * method for opening it. Reuse that exported component rather than maintain a
 * near-copy: current Pi exposes its model runtime through the registry facade;
 * older Pi versions pass the registry directly to the same component.
 */
async function pickClassifierModel(
  ctx: ExtensionContext,
  current: string | null,
): Promise<string | undefined> {
  const registryWithRuntime = ctx.modelRegistry as typeof ctx.modelRegistry & {
    runtime?: unknown;
  };
  const modelSource = registryWithRuntime.runtime ?? ctx.modelRegistry;
  const scopedModels = (
    ctx as ExtensionContext & { scopedModels?: readonly unknown[] }
  ).scopedModels;

  return ctx.ui.custom<string | undefined>(
    (tui, _theme, _keybindings, done) => {
      const selector = new ModelSelectorComponent(
        tui,
        configuredClassifierModel(ctx, current),
        // The native selector persists Pi's active model by default. Selecting a
        // classifier model must only update Leash's config, so keep that callback
        // intentionally inert and persist after `done` below.
        { setDefaultModelAndProvider() {} } as never,
        modelSource as never,
        (scopedModels ?? []) as never,
        (model) => done(`${model.provider}/${model.id}`),
        () => done(undefined),
      );
      selector.focused = true;
      return selector;
    },
  );
}

async function showSettingsMenu(
  ctx: ExtensionContext,
  enabled: boolean,
  model: string | null,
): Promise<SettingsAction> {
  return (
    (await ctx.ui.custom<SettingsAction | undefined>(
      (tui, theme, _kb, done) => {
        const entries = [
          `Auto mode: ${enabled ? "on" : "off"}`,
          `Classifier model: ${model ?? "current Pi model"}`,
          "Close",
        ];
        let selected = 0;

        const render = (width: number) => {
          const lines = [
            theme.fg("accent", theme.bold("Pi Leash settings")),
            "",
            theme.fg("dim", "↑↓ select · enter change · esc close"),
            "",
            ...entries.map((entry, index) => {
              const marker =
                index === selected ? theme.fg("accent", "› ") : "  ";
              const text =
                index === selected ? theme.fg("accent", entry) : entry;
              return truncateToWidth(`${marker}${text}`, width);
            }),
          ];
          return lines;
        };

        return {
          render,
          invalidate() {},
          handleInput(data: string) {
            if (matchesKey(data, Key.up)) {
              selected = (selected + entries.length - 1) % entries.length;
            } else if (matchesKey(data, Key.down)) {
              selected = (selected + 1) % entries.length;
            } else if (
              matchesKey(data, Key.escape) ||
              matchesKey(data, Key.ctrl("c"))
            ) {
              done("close");
            } else if (matchesKey(data, Key.enter)) {
              done(
                selected === 0
                  ? "toggle"
                  : selected === 1
                    ? "select-model"
                    : "close",
              );
            }
            tui.requestRender();
          },
        };
      },
    )) ?? "close"
  );
}

async function showAutoModeSettings(
  config: ResolvedConfig,
  ctx: ExtensionContext,
  isEnabled: () => boolean,
  setEnabled: (next: boolean) => boolean,
  updateStatus: () => void,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/leash settings requires Pi's interactive UI.", "warning");
    return;
  }

  let enabled = isEnabled();
  let model = config.permissionGate.autoMode.model;

  while (true) {
    const action = await showSettingsMenu(ctx, enabled, model);
    if (action === "close") return;
    if (action === "toggle") {
      const next = !enabled;
      if (!setEnabled(next)) continue;
      updateAutoModeConfig({ enabled: next });
      config.permissionGate.autoMode.enabled = next;
      enabled = next;
      continue;
    }

    const picked = await pickClassifierModel(ctx, model);
    if (!picked) continue;
    model = picked;

    updateAutoModeConfig({ model });
    config.permissionGate.autoMode.model = model;
    updateStatus();
    ctx.ui.notify(
      `Leash classifier model: ${model ?? "current Pi model"}.`,
      "info",
    );
  }
}

export function setupAutoMode(
  pi: ExtensionAPI,
  config: ResolvedConfig,
): AutoModeController {
  let enabled = config.permissionGate.autoMode.enabled;
  let audit = createAutoModeAudit();
  let verdictTimer: ReturnType<typeof setTimeout> | undefined;
  let classifierRequests = 0;
  let classifierFrame = 0;
  let classifierTimer: ReturnType<typeof setInterval> | undefined;

  const clearVerdictStatus = (ctx: ExtensionContext) => {
    if (verdictTimer) clearTimeout(verdictTimer);
    verdictTimer = undefined;
    ctx.ui.setStatus(VERDICT_STATUS_KEY, undefined);
  };

  const showVerdictStatus = (
    verdict: RecordedVerdict,
    ctx: ExtensionContext,
  ) => {
    if (!enabled) return;
    if (verdictTimer) clearTimeout(verdictTimer);

    const color =
      verdict.decision === "allow"
        ? "success"
        : verdict.decision === "ask"
          ? "warning"
          : "error";
    ctx.ui.setStatus(
      VERDICT_STATUS_KEY,
      ctx.ui.theme.fg(
        color,
        `⏵⏵ leash ${verdict.decision} [${verdict.source}] · ${compactVerdictReason(verdict.reason)}`,
      ),
    );
    verdictTimer = setTimeout(
      () => ctx.ui.setStatus(VERDICT_STATUS_KEY, undefined),
      VERDICT_STATUS_TIMEOUT_MS,
    );
    verdictTimer.unref?.();
  };

  const recordVerdict = (verdict: AutoModeVerdict, ctx: ExtensionContext) => {
    const recorded: RecordedVerdict = { ...verdict, timestamp: Date.now() };
    if (recorded.decision === "allow") audit.allow += 1;
    if (recorded.decision === "ask") audit.ask += 1;
    if (recorded.decision === "deny") audit.deny += 1;
    audit.last = recorded;
    pi.appendEntry(VERDICT_ENTRY_TYPE, recorded);
    showVerdictStatus(recorded, ctx);
  };

  const recordUserDecision = (
    decision: Omit<AutoModeUserDecision, "timestamp">,
    _ctx: ExtensionContext,
  ) => {
    pi.appendEntry(AUTO_MODE_USER_DECISION_ENTRY_TYPE, {
      ...decision,
      timestamp: Date.now(),
    });
  };

  const renderAutoStatus = (ctx: ExtensionContext) => {
    if (!enabled) {
      ctx.ui.setStatus("leash-auto", undefined);
      return;
    }

    if (classifierRequests === 0) {
      ctx.ui.setStatus(
        "leash-auto",
        ctx.ui.theme.fg("accent", "⏵⏵ leash auto"),
      );
      return;
    }

    const first = AUTO_BUSY_COLORS[classifierFrame % AUTO_BUSY_COLORS.length];
    const second =
      AUTO_BUSY_COLORS[(classifierFrame + 1) % AUTO_BUSY_COLORS.length];
    const marker = `${ctx.ui.theme.fg(first, "⏵")}${ctx.ui.theme.fg(second, "⏵")}`;
    ctx.ui.setStatus(
      "leash-auto",
      `${marker} ${ctx.ui.theme.fg("accent", "leash auto")}`,
    );
  };

  const clearClassifierAnimation = () => {
    if (classifierTimer) clearInterval(classifierTimer);
    classifierTimer = undefined;
    classifierFrame = 0;
  };

  const ensureClassifierAnimation = (ctx: ExtensionContext) => {
    if (classifierRequests === 0 || classifierTimer) return;
    classifierTimer = setInterval(() => {
      classifierFrame = (classifierFrame + 1) % AUTO_BUSY_COLORS.length;
      renderAutoStatus(ctx);
    }, AUTO_BUSY_FRAME_INTERVAL_MS);
    classifierTimer.unref?.();
  };

  const startClassifierAnimation = (ctx: ExtensionContext) => {
    classifierRequests += 1;
    classifierFrame = 0;
    renderAutoStatus(ctx);
    ensureClassifierAnimation(ctx);
  };

  const stopClassifierAnimation = (ctx: ExtensionContext) => {
    classifierRequests = Math.max(0, classifierRequests - 1);
    if (classifierRequests === 0) clearClassifierAnimation();
    renderAutoStatus(ctx);
  };

  const updateStatus = (ctx: ExtensionContext) => {
    if (!enabled) {
      clearClassifierAnimation();
      ctx.ui.setStatus("leash-auto", undefined);
      clearVerdictStatus(ctx);
      return;
    }
    renderAutoStatus(ctx);
    ensureClassifierAnimation(ctx);
  };

  const setEnabled = (next: boolean, ctx: ExtensionContext): boolean => {
    if (next && !config.permissionGate.autoMode.model && !ctx.model) {
      ctx.ui.notify(
        "Leash auto mode needs an active Pi model or a configured classifier model.",
        "warning",
      );
      return false;
    }
    enabled = next;
    pi.appendEntry(SESSION_ENTRY_TYPE, { enabled });
    updateStatus(ctx);
    ctx.ui.notify(
      enabled
        ? "Leash auto mode enabled. Dangerous Bash actions are classifier-gated."
        : "Leash auto mode disabled. Dangerous Bash actions prompt normally.",
      "info",
    );
    return true;
  };

  pi.registerShortcut(Key.ctrlAlt("l"), {
    description: "Toggle Leash auto mode",
    handler: async (ctx) => {
      setEnabled(!enabled, ctx);
    },
  });

  pi.registerCommand("leash", {
    description: "Manage Leash auto mode: auto, manual, settings, status",
    getArgumentCompletions(prefix) {
      return ["auto", "manual", "settings", "status", "toggle"]
        .filter((value) => value.startsWith(prefix.trim().toLowerCase()))
        .map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      const command = args.trim().toLowerCase();
      if (command === "auto" || command === "on") {
        setEnabled(true, ctx);
        return;
      }
      if (command === "manual" || command === "off") {
        setEnabled(false, ctx);
        return;
      }
      if (command === "toggle") {
        setEnabled(!enabled, ctx);
        return;
      }
      if (command === "settings") {
        await showAutoModeSettings(
          config,
          ctx,
          () => enabled,
          (next) => setEnabled(next, ctx),
          () => updateStatus(ctx),
        );
        return;
      }
      if (command === "" || command === "status") {
        ctx.ui.notify(
          `Leash auto: ${enabled ? "on" : "off"}; classifier: ${getAutoModeModelLabel(config.permissionGate.autoMode, ctx)}.\n${formatAuditStatus(audit)}\nCtrl+Alt+L toggles. /leash settings applies and persists auto-mode and classifier changes immediately.`,
          "info",
        );
        return;
      }
      ctx.ui.notify(
        "Usage: /leash [auto|manual|toggle|settings|status]",
        "warning",
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    enabled = config.permissionGate.autoMode.enabled;
    audit = createAutoModeAudit();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom") continue;

      if (entry.customType === SESSION_ENTRY_TYPE) {
        const state = entry.data as { enabled?: unknown } | undefined;
        if (typeof state?.enabled === "boolean") enabled = state.enabled;
        continue;
      }

      if (entry.customType !== VERDICT_ENTRY_TYPE) continue;
      const verdict = readRecordedVerdict(entry.data);
      if (!verdict) continue;
      if (verdict.decision === "allow") audit.allow += 1;
      if (verdict.decision === "ask") audit.ask += 1;
      if (verdict.decision === "deny") audit.deny += 1;
      audit.last = verdict;
    }
    updateStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    classifierRequests = 0;
    clearClassifierAnimation();
    ctx.ui.setStatus("leash-auto", undefined);
    clearVerdictStatus(ctx);
  });

  return {
    isEnabled: () => enabled,
    classify: async (action, ctx) => {
      startClassifierAnimation(ctx);
      try {
        return await classifyAutoModeAction(
          action,
          config.permissionGate.autoMode,
          ctx,
        );
      } finally {
        stopClassifierAnimation(ctx);
      }
    },
    recordVerdict,
    recordUserDecision,
  };
}
