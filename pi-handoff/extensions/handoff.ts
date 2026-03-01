/**
 * Handoff Extension
 *
 * Transfers conversation context to a new focused session via:
 * - /handoff <goal> command
 * - Agent-callable handoff tool
 * - Auto-handoff option when Pi triggers compaction
 *
 * The compaction hook uses Pi's preparation data (messagesToSummarize,
 * previousSummary) instead of the full conversation, so the summary
 * generation won't overflow the context window.
 *
 * Usage:
 *   /handoff now implement this for teams as well
 *   /handoff execute phase one of the plan
 *   /handoff check other places that need this fix
 *
 * The generated prompt appears as a draft in the editor for review/editing.
 * The agent can also invoke the handoff tool when the user explicitly requests it.
 */

import { complete, type Message } from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	SessionEntry,
} from "@mariozechner/pi-coding-agent";
import { BorderedLoader, convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// Store pending handoff text to be set in new session after switch
// Key: parent session file path, Value: handoff text to set in editor
const pendingHandoffText = new Map<string, string>();

/** @internal Test-only: clear all pending handoff state between tests. */
export function __clearPendingHandoffText(): void {
	pendingHandoffText.clear();
}

// Handoff generation system prompt.
//
// Combines Pi's structured compaction format (Goal, Progress, Decisions,
// Constraints) with handoff-specific goal filtering, code pointers from
// mina, and an explicit Task section.
//
// Key differences from Pi compaction:
// - Goal-directed: everything is filtered through the user's stated goal
// - Code pointers: path:line and path#Symbol references in context
// - Task section: actionable next steps framed by the goal
// - Anti-continuation guard: prevent the summarizer from responding to the history
const SYSTEM_PROMPT = `You are a context transfer assistant. Read the conversation and produce a structured handoff summary for the stated goal. The new thread must be able to proceed without the old conversation.

Do NOT continue the conversation. Do NOT respond to any questions in the history. ONLY output the structured summary.

Use this EXACT format:

## Goal
[The user's goal for the new thread — what they want to accomplish.]

## Key Decisions
- **[Decision]**: [Brief rationale]
- Use code pointers (path/to/file.ts:42 or path/to/file.ts#functionName) where relevant

## Constraints & Preferences
- [Any requirements, constraints, or preferences the user stated]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed work relevant to the goal]

### In Progress
- [ ] [Partially completed work]

### Blocked
- [Open issues or blockers, if any]

## Files
- path/to/file1.ts (modified)
- path/to/file2.ts (read)

## Task
[Clear, actionable description of what to do next based on the goal. Ordered steps if appropriate.]

Rules:
- Be concise. Every bullet earns its place.
- Preserve exact file paths, function names, and error messages.
- Only include information relevant to the stated goal — discard unrelated context.
- Output the formatted content only. No preamble, no filler.`;

// System prompt fragment injected via before_agent_start.
// Teaches the model about handoffs so it can suggest them proactively.
export const HANDOFF_SYSTEM_HINT = `
## Handoff

Use \`/handoff <goal>\` to transfer context to a new focused session.
Handoffs are especially effective after planning — clear the context and start a new session with the plan you just created.
At high context usage, suggest a handoff rather than losing important context.`;

/**
 * Generate a session name from the goal (slug format).
 * Exported for testing.
 */
export function goalToSessionName(goal: string): string {
	return goal
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.trim()
		.replace(/\s+/g, "-")
		.slice(0, 50);
}

/**
 * Build the full handoff prompt from goal, session file, and generated summary.
 * Includes parent session reference and skill prefix when applicable.
 * Exported for testing.
 */
export function buildFullPrompt(
	goal: string,
	currentSessionFile: string | null,
	summary: string,
): string {
	let fullPrompt = `# ${goal}\n\n`;

	if (currentSessionFile) {
		fullPrompt += `**Parent session:** \`${currentSessionFile}\`\n\n`;
	}

	fullPrompt += summary;

	// Prepend session-query skill if parent session present
	return /\*\*Parent session:\*\*/.test(fullPrompt)
		? `/skill:pi-session-query ${fullPrompt}`
		: fullPrompt;
}

/**
 * Handoff modes:
 * - "command": User-initiated via /handoff
 * - "tool": Agent-initiated via handoff tool
 * - "compactHook": Triggered from session_before_compact
 *
 * Command mode has ExtensionCommandContext (with newSession).
 * Tool and compactHook modes have ExtensionContext (ReadonlySessionManager, no newSession).
 */
type HandoffMode = "command" | "tool" | "compactHook";

/**
 * Core handoff logic shared by the /handoff command, the handoff tool,
 * and the auto-handoff compaction hook.
 *
 * Returns an error string on failure, or undefined on success.
 *
 * Session creation behavior:
 * - "command" mode: ctx has newSession() — creates new session immediately.
 * - "tool"/"compactHook" mode: ctx is ReadonlySessionManager — cannot create
 *   sessions. Instead, pre-fills the editor with the generated prompt and notifies
 *   the user. The session_switch handler picks up pendingHandoffText when they
 *   manually start a new session.
 */
async function performHandoff(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	goal: string,
	mode: HandoffMode = "command",
	preBuiltContext?: string,
): Promise<string | undefined> {
	if (!ctx.hasUI) {
		return "Handoff requires interactive mode.";
	}

	if (!ctx.model) {
		return "No model selected.";
	}

	let conversationText: string;

	if (preBuiltContext) {
		// compactHook: context already built from preparation data
		conversationText = preBuiltContext;
	} else {
		// command/tool: gather full conversation (context isn't full yet)
		const branch = ctx.sessionManager.getBranch();
		const messages = branch
			.filter((entry): entry is SessionEntry & { type: "message" } => entry.type === "message")
			.map((entry) => entry.message);

		if (messages.length === 0) {
			return "No conversation to hand off.";
		}

		conversationText = serializeConversation(convertToLlm(messages));
	}

	const currentSessionFile = ctx.sessionManager.getSessionFile();

	// Generate the handoff prompt with loader UI
	const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const loader = new BorderedLoader(tui, theme, `Generating handoff summary...`);
		loader.onAbort = () => done(null);

		const doGenerate = async () => {
			const apiKey = await ctx.modelRegistry.getApiKey(ctx.model!);

			const userMessage: Message = {
				role: "user",
				content: [
					{
						type: "text",
						text: `## Conversation History\n\n${conversationText}\n\n## Goal for New Thread\n\n${goal}`,
					},
				],
				timestamp: Date.now(),
			};

			const response = await complete(
				ctx.model!,
				{ systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
				{ apiKey, signal: loader.signal },
			);

			if (response.stopReason === "aborted") {
				return null;
			}

			return response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");
		};

		doGenerate()
			.then(done)
			.catch((err) => {
				console.error("Handoff generation failed:", err);
				done(null);
			});

		return loader;
	});

	if (result === null) {
		return "Handoff cancelled.";
	}

	const messageToSend = buildFullPrompt(goal, currentSessionFile ?? null, result);

	// Store the handoff text for the session_switch event to pick up.
	// Key: parent session file (passed to newSession as parentSession).
	if (currentSessionFile) {
		pendingHandoffText.set(currentSessionFile, messageToSend);
	}

	// Session creation: only possible with ExtensionCommandContext (command mode).
	// Hook and tool modes have ReadonlySessionManager — newSession() does not exist.
	// In those modes, pre-fill the editor so the user can start a new session manually.
	const hasNewSession =
		"newSession" in ctx && typeof (ctx as ExtensionCommandContext).newSession === "function";

	if (hasNewSession) {
		const cmdCtx = ctx as ExtensionCommandContext;
		const newSessionResult = await cmdCtx.newSession({
			parentSession: currentSessionFile ?? undefined,
		});

		if (newSessionResult.cancelled) {
			// Clean up pending text if session creation was cancelled
			if (currentSessionFile) {
				pendingHandoffText.delete(currentSessionFile);
			}
			return "New session cancelled.";
		}

		pi.setSessionName(goalToSessionName(goal));
	} else {
		// Hook / tool mode: set editor text so the user can see the generated prompt.
		// The session_switch handler will auto-set it in the new session when they
		// start one (Ctrl+N or equivalent).
		ctx.ui.setEditorText(messageToSend);
		ctx.ui.notify(
			"Handoff ready! Start a new session to automatically send the generated prompt.",
			"info",
		);
	}

	return undefined;
}

export default function (pi: ExtensionAPI) {
	// --- Session switch handler ---
	// When switching to a new session (e.g., after handoff), check if there's
	// pending handoff text to set in the editor.
	pi.on("session_switch", async (event, ctx) => {
		if (event.reason !== "new" || !ctx.hasUI) return;

		// Get the parent session from the session header
		const header = ctx.sessionManager.getHeader();
		const parentSession = header?.parentSession;
		if (!parentSession) return;

		// Check if there's pending handoff text for this parent session
		const text = pendingHandoffText.get(parentSession);
		if (text) {
			ctx.ui.setEditorText(text);
			ctx.ui.notify("Handoff ready - edit if needed and press Enter to send", "info");
			pendingHandoffText.delete(parentSession);
		}
	});

	// --- System prompt hint ---
	// Inject handoff awareness into the system prompt so the model
	// can proactively suggest handoffs at high context usage.
	pi.on("before_agent_start", async (event, _ctx) => {
		return {
			systemPrompt: event.systemPrompt + HANDOFF_SYSTEM_HINT,
		};
	});

	// --- Auto-handoff on compaction ---
	// When auto-compaction triggers, offer handoff as an alternative.
	// Uses event.preparation (messagesToSummarize, previousSummary) — the
	// manageable subset Pi already prepared — instead of re-gathering the
	// full conversation that caused the compaction in the first place.
	pi.on("session_before_compact", async (event, ctx) => {
		if (!ctx.hasUI || !ctx.model) return;

		// Skip if a handoff was just initiated - the new session is already being created
		const currentSessionFile = ctx.sessionManager.getSessionFile();
		if (currentSessionFile && pendingHandoffText.has(currentSessionFile)) {
			return;
		}

		const usage = ctx.getContextUsage();
		const pctStr = usage?.percent != null ? `${Math.round(usage.percent)}%` : "high";

		const choice = await ctx.ui.select(
			`Context is ${pctStr} full. What would you like to do?`,
			["Handoff to new session", "Compact context", "Continue without either"],
		);

		if (choice === "Compact context" || choice === undefined) return;
		if (choice === "Continue without either") return { cancel: true };

		// Build context from preparation data — already the right subset
		const { preparation } = event;
		const conversationText = serializeConversation(
			convertToLlm(preparation.messagesToSummarize),
		);

		let contextForHandoff = "";
		if (preparation.previousSummary) {
			contextForHandoff += `## Previous Context\n\n${preparation.previousSummary}\n\n`;
		}
		contextForHandoff += `## Recent Conversation\n\n${conversationText}`;

		try {
			const error = await performHandoff(
				pi,
				ctx,
				"Continue current work",
				"compactHook",
				contextForHandoff,
			);
			if (error) {
				ctx.ui.notify(`Handoff failed: ${error}. Compacting instead.`, "warning");
				return;
			}
		} catch (err) {
			ctx.ui.notify(
				`Handoff error: ${err instanceof Error ? err.message : String(err)}. Compacting instead.`,
				"warning",
			);
			return;
		}

		return { cancel: true };
	});

	// --- /handoff command ---
	pi.registerCommand("handoff", {
		description: "Transfer context to a new focused session",
		handler: async (args, ctx) => {
			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify("Usage: /handoff <goal for new thread>", "error");
				return;
			}

			const error = await performHandoff(pi, ctx, goal);
			if (error) {
				ctx.ui.notify(error, "error");
			}
		},
	});

	// --- handoff tool (agent-callable) ---
	pi.registerTool({
		name: "handoff",
		label: "Handoff",
		description:
			"Transfer context to a new focused session. ONLY use this when the user explicitly asks for a handoff. Provide a goal describing what the new session should focus on.",
		parameters: Type.Object({
			goal: Type.String({ description: "The goal/task for the new session" }),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const error = await performHandoff(pi, ctx, params.goal, "tool");
			return {
				content: [
					{
						type: "text" as const,
						text:
							error ??
							"Handoff queued. The generated prompt has been placed in the editor — start a new session to send it.",
					},
				],
			};
		},
	});
}
