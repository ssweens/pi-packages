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
 *
 * Gating (matches Claude Code's away-summary approach):
 * - ≥3 user turns in the session
 * - ≥2 new user messages since the last recap
 * - No draft text in the editor
 * - Model is available
 * - Recap is enabled
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
  let isGenerating = false; // guard against concurrent generation
  let lastRecapTime = 0;

  // ── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Cancel the pending idle timer (if any).
   */
  function cancelTimer() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  /**
   * Clear any visible recap widget.
   */
  function clearRecapWidget(ctx: any) {
    ctx.ui.setWidget(WIDGET_NAME, undefined);
  }

  /**
   * Count user messages in the current branch (for reconstruction).
   */
  function countUserTurns(ctx: any): number {
    let count = 0;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message?.role === "user") {
        count++;
      }
    }
    return count;
  }

  /**
   * Restore recap count from custom entries in the session.
   */
  function restoreRecapCount(ctx: any): number {
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === RECAP_CUSTOM_TYPE) {
        return (entry as any).data?.count ?? 0;
      }
    }
    return 0;
  }

  /**
   * Check all gates to decide whether we should generate a recap.
   */
  function shouldGenerate(ctx: any): boolean {
    if (!enabled) return false;
    if (userTurnCount < MIN_USER_TURNS) return false;
    if (messagesSinceLastRecap < MIN_MESSAGES_SINCE_RECAP) return false;
    if (!ctx.model) return false;
    if (isGenerating) return false;

    // Check for draft text — if user is mid-composition, don't interrupt
    try {
      const draft = ctx.ui.getEditorText();
      if (draft && draft.trim().length > 0) return false;
    } catch {
      // In non-TUI modes, getEditorText may not be available
    }

    return true;
  }

  /**
   * Generate a recap via side LLM call.
   */
  async function generateRecap(ctx: any) {
    if (!shouldGenerate(ctx)) return;

    isGenerating = true;
    try {
      // Build conversation context
      const branch = ctx.sessionManager.getBranch();
      const leafId = ctx.sessionManager.getLeafId();
      const { messages } = buildSessionContext(branch, leafId);
      const llmMessages = convertToLlm(messages);

      if (llmMessages.length === 0) return;

      // Get API key
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
      if (!auth.ok) return;
      const apiKey = auth.apiKey;

      // Make the side LLM call (no tools)
      const response = await complete(
        ctx.model,
        {
          systemPrompt: RECAP_PROMPT,
          messages: llmMessages as Message[],
        },
        { apiKey, signal: ctx.signal },
      );

      if (response.stopReason === "error" || response.stopReason === "aborted") return;

      // Extract text from response
      const text = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();

      if (!text) return;

      // Format recap line
      const suffix = recapCount < DISABLE_HINT_LIMIT ? " (disable recaps in /config)" : "";
      const recapLine = `※ recap: ${text}${suffix}`;

      // Show via widget (ephemeral — never written to transcript)
      ctx.ui.setWidget(WIDGET_NAME, [recapLine]);

      // Update counters
      recapCount++;
      messagesSinceLastRecap = 0;
      lastRecapTime = Date.now();

      // Persist recap count (survives session reload)
      pi.appendEntry(RECAP_CUSTOM_TYPE, { count: recapCount });
    } finally {
      isGenerating = false;
    }
  }

  /**
   * Start the idle timer after agent completion.
   */
  function startIdleTimer(ctx: any) {
    if (!shouldGenerate(ctx)) return;

    cancelTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      generateRecap(ctx);
    }, idleThresholdMs);
  }

  // ── Event handlers ──────────────────────────────────────────────────────

  // Reconstruct state on session start
  pi.on("session_start", async (_event, ctx) => {
    userTurnCount = countUserTurns(ctx);
    recapCount = restoreRecapCount(ctx);
    messagesSinceLastRecap = 0;
    lastRecapTime = 0;
    cancelTimer();
    clearRecapWidget(ctx);
  });

  // On user input: cancel timer, clear recap, track turns
  pi.on("input", async (event, ctx) => {
    if (event.source !== "interactive") return;

    cancelTimer();
    clearRecapWidget(ctx);

    userTurnCount++;
    messagesSinceLastRecap++;
  });

  // After agent completion: start idle timer
  pi.on("agent_end", async (_event, ctx) => {
    startIdleTimer(ctx);
  });

  // Cleanup on shutdown
  pi.on("session_shutdown", async (_event, _ctx) => {
    cancelTimer();
  });

  // ── Commands ────────────────────────────────────────────────────────────

  pi.registerCommand("recap", {
    description: "Toggle away recap or set idle threshold",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();

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
        "Usage: /recap [on|off|status|<threshold>]  e.g. /recap 3m, /recap 30s",
        "error",
      );
    },
  });
}
