/**
 * pi-recap: Away recap extension
 *
 * Shows a compact "※ recap: ..." line when the user returns from idle.
 *
 * How it works:
 * 1. After each agent completion (agent_end), start an idle timer
 * 2. On any user input, cancel the timer and clear any visible recap
 * 3. If the timer fires, generate a recap via a side LLM call
 * 4. Show the recap as an ephemeral widget above the editor
 */

import { complete, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildSessionContext, convertToLlm } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECAP_PROMPT =
  "The user stepped away and is coming back. Recap in under 40 words, 1-2 plain sentences, no markdown. Lead with the overall goal and current task, then the one next action. Skip root-cause narrative, fix internals, secondary to-dos, and em-dash tangents.";

const DEFAULT_IDLE_MS = 3 * 60 * 1000; // 3 minutes
const MIN_USER_TURNS = 3;
const MIN_MESSAGES_SINCE_RECAP = 2;
const DISABLE_HINT_LIMIT = 3;
const RECAP_CUSTOM_TYPE = "pi-recap";
const WIDGET_NAME = "pi-recap";

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function piRecap(pi: ExtensionAPI) {
  // ── Config ──────────────────────────────────────────────────────────────
  let enabled = true;
  let idleThresholdMs = DEFAULT_IDLE_MS;

  // ── Runtime state ───────────────────────────────────────────────────────
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let userTurnCount = 0;
  let messagesSinceLastRecap = 0;
  let recapCount = 0;
  let isGenerating = false;
  let agentEndCount = 0; // track how many agent_end events we receive

  // ── Helpers ─────────────────────────────────────────────────────────────

  function cancelTimer() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function clearRecapWidget(ctx: any) {
    try {
      ctx.ui.setWidget(WIDGET_NAME, undefined);
    } catch {
      // ignore — may not be available in all modes
    }
  }

  function countUserTurns(ctx: any): number {
    let count = 0;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message?.role === "user") {
        count++;
      }
    }
    return count;
  }

  function restoreRecapCount(ctx: any): number {
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === RECAP_CUSTOM_TYPE) {
        return (entry as any).data?.count ?? 0;
      }
    }
    return 0;
  }

  /**
   * Check all gates. Returns a string describing the failure reason,
   * or null if all gates pass.
   */
  function checkGates(ctx: any): string | null {
    if (!enabled) return "recap is disabled";
    if (userTurnCount < MIN_USER_TURNS) return `userTurnCount (${userTurnCount}) < ${MIN_USER_TURNS}`;
    if (messagesSinceLastRecap < MIN_MESSAGES_SINCE_RECAP) return `messagesSinceLastRecap (${messagesSinceLastRecap}) < ${MIN_MESSAGES_SINCE_RECAP}`;
    if (!ctx.model) return "ctx.model is null/undefined";
    if (isGenerating) return "already generating";
    return null;
  }

  /**
   * Generate a recap via side LLM call.
   * Returns the recap text on success, or a description of what failed.
   */
  async function generateRecap(ctx: any): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    const gateFailure = checkGates(ctx);
    if (gateFailure) return { ok: false, error: `Gate failed: ${gateFailure}` };

    isGenerating = true;
    try {
      // Build conversation context
      const branch = ctx.sessionManager.getBranch();
      const leafId = ctx.sessionManager.getLeafId();
      const { messages } = buildSessionContext(branch, leafId);
      const llmMessages = convertToLlm(messages);

      if (llmMessages.length === 0) {
        return { ok: false, error: `convertToLlm returned 0 messages (branch has ${branch.length} entries)` };
      }

      // Get API key
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
      if (!auth.ok) {
        return { ok: false, error: `API key retrieval failed: ${auth.error}` };
      }
      const apiKey = auth.apiKey;
      if (!apiKey) {
        return { ok: false, error: "API key is empty" };
      }

      // Make the side LLM call (no tools)
      const response = await complete(
        ctx.model,
        {
          systemPrompt: RECAP_PROMPT,
          messages: llmMessages as Message[],
        },
        { apiKey },
      );

      if (response.stopReason === "error") {
        return { ok: false, error: `LLM error: ${(response as any).errorMessage ?? "unknown"}` };
      }
      if (response.stopReason === "aborted") {
        return { ok: false, error: "LLM call was aborted" };
      }

      // Extract text from response
      const text = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();

      if (!text) {
        return { ok: false, error: `LLM returned empty text. stopReason=${response.stopReason}, content types=[${response.content.map(c => c.type).join(",")}]` };
      }

      // Format and show recap
      const suffix = recapCount < DISABLE_HINT_LIMIT ? " (disable recaps in /config)" : "";
      const recapLine = `※ recap: ${text}${suffix}`;

      ctx.ui.setWidget(WIDGET_NAME, [recapLine]);

      // Update counters
      recapCount++;
      messagesSinceLastRecap = 0;

      // Persist recap count
      pi.appendEntry(RECAP_CUSTOM_TYPE, { count: recapCount });

      return { ok: true, text };
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      return { ok: false, error: `Exception: ${msg}` };
    } finally {
      isGenerating = false;
    }
  }

  /**
   * Start the idle timer after agent completion.
   */
  function startIdleTimer(ctx: any) {
    const gateFailure = checkGates(ctx);
    if (gateFailure) return; // silently skip — normal case for first few turns

    cancelTimer();
    idleTimer = setTimeout(async () => {
      idleTimer = null;
      const result = await generateRecap(ctx);
      if (!result.ok) {
        // Fire-and-forget notify — user can see why recap failed
        try {
          ctx.ui.notify(`[pi-recap] ${result.error}`, "warning");
        } catch {
          // swallow — non-TUI mode
        }
      }
    }, idleThresholdMs);
  }

  // ── Event handlers ──────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    userTurnCount = countUserTurns(ctx);
    recapCount = restoreRecapCount(ctx);
    messagesSinceLastRecap = 0;
    agentEndCount = 0;
    cancelTimer();
    clearRecapWidget(ctx);
  });

  pi.on("input", async (event, ctx) => {
    if (event.source !== "interactive") return;

    cancelTimer();
    clearRecapWidget(ctx);

    userTurnCount++;
    messagesSinceLastRecap++;
  });

  pi.on("agent_end", async (_event, ctx) => {
    agentEndCount++;
    startIdleTimer(ctx);
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    cancelTimer();
  });

  // ── Commands ────────────────────────────────────────────────────────────

  pi.registerCommand("recap", {
    description: "Toggle away recap, set threshold, or test",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();

      if (arg === "test") {
        // Force-generate a recap right now, bypassing all gates
        ctx.ui.notify("[pi-recap] Force-testing recap generation...", "info");

        isGenerating = false; // reset guard
        const savedEnabled = enabled;
        const savedTurns = userTurnCount;
        const savedMsgs = messagesSinceLastRecap;

        // Temporarily relax gates
        enabled = true;
        userTurnCount = 999;
        messagesSinceLastRecap = 999;

        const result = await generateRecap(ctx);

        // Restore original state
        enabled = savedEnabled;
        userTurnCount = savedTurns;
        messagesSinceLastRecap = savedMsgs;

        if (result.ok) {
          ctx.ui.notify(`[pi-recap] Success! Recap shown above editor.`, "info");
        } else {
          ctx.ui.notify(`[pi-recap] FAILED: ${result.error}`, "error");
        }
        return;
      }

      if (arg === "debug") {
        const gateFailure = checkGates(ctx);
        const thresholdSec = Math.round(idleThresholdMs / 1000);
        const lines = [
          `enabled: ${enabled}`,
          `threshold: ${thresholdSec}s`,
          `userTurnCount: ${userTurnCount} (need >= ${MIN_USER_TURNS})`,
          `messagesSinceLastRecap: ${messagesSinceLastRecap} (need >= ${MIN_MESSAGES_SINCE_RECAP})`,
          `recapCount: ${recapCount}`,
          `isGenerating: ${isGenerating}`,
          `agentEndCount: ${agentEndCount}`,
          `timer active: ${idleTimer !== null}`,
          `model: ${ctx.model ? `${(ctx.model as any).provider}/${(ctx.model as any).id}` : "null"}`,
          `gates: ${gateFailure ?? "ALL PASS"}`,
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (!arg || arg === "on") {
        if (!enabled) {
          enabled = true;
          ctx.ui.notify("Recap enabled", "info");
        } else {
          ctx.ui.notify("Recap is already enabled", "info");
        }
        return;
      }

      if (arg === "off") {
        if (enabled) {
          enabled = false;
          cancelTimer();
          clearRecapWidget(ctx);
          ctx.ui.notify("Recap disabled", "info");
        } else {
          ctx.ui.notify("Recap is already disabled", "info");
        }
        return;
      }

      if (arg === "status") {
        const thresholdMin = (idleThresholdMs / 1000 / 60).toFixed(1);
        ctx.ui.notify(
          `Recap: ${enabled ? "on" : "off"} | threshold: ${thresholdMin}m | recaps shown: ${recapCount}`,
          "info",
        );
        return;
      }

      // Try parsing as threshold: e.g. "/recap 5m", "/recap 30s"
      const match = arg.match(/^(\d+)\s*(m|s|min|sec)?$/);
      if (match) {
        const value = parseInt(match[1], 10);
        const unit = match[2] || "m";
        const isSeconds = unit === "s" || unit === "sec";
        idleThresholdMs = (isSeconds ? value : value * 60) * 1000;

        const label = isSeconds ? `${value}s` : `${value}m`;
        ctx.ui.notify(`Recap idle threshold set to ${label}`, "info");
        return;
      }

      ctx.ui.notify(
        "Usage: /recap [on|off|status|debug|test|<threshold>]\n  e.g. /recap test, /recap debug, /recap 3m, /recap 30s",
        "error",
      );
    },
  });
}
