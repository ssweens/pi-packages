/**
 * Enhanced Handoff Extension
 *
 * Combines the best of pi-amplike and mina approaches:
 * - User preview/editing of handoff draft (from pi example)
 * - Context monitoring with warnings (from mina)
 * - Structured bullet format with code pointers (from mina)
 * - Parent session linking for session_query tool (from pi-amplike)
 * - Agent-callable handoff tool (from pi-amplike)
 * - Auto-inject session-query skill when parent session detected
 * - System prompt hints for handoff awareness
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
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import { BorderedLoader, convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// Context warning threshold (from mina)
const CONTEXT_WARNING_THRESHOLD = 0.8; // 80%

let handoffPending = false;


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
const HANDOFF_SYSTEM_HINT = `
## Handoff

Use \`/handoff <goal>\` to transfer context to a new focused session.
Handoffs are especially effective after planning — clear the context and start a new session with the plan you just created.
At high context usage, suggest a handoff rather than losing important context.`;

/**
 * Check context usage and warn if approaching limits
 */
function checkContextUsage(ctx: ExtensionContext): { tokens: number; limit: number; percent: number } | null {
	const usage = ctx.getContextUsage();
	if (!usage) return null;

	const percent = usage.tokens / usage.contextWindow;
	return {
		tokens: usage.tokens,
		limit: usage.contextWindow,
		percent,
	};
}

/**
 * Generate a session name from the goal (slug format)
 */
function goalToSessionName(goal: string): string {
	return goal
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.trim()
		.replace(/\s+/g, "-")
		.slice(0, 50);
}

/**
 * Handoff modes:
 * - "command": User-initiated via /handoff
 * - "tool": Agent-initiated via handoff tool
 * - "compactHook": Triggered from session_before_compact
 *
 * All modes follow the same flow: generate summary → editor review → new session → input box → user sends
 */
type HandoffMode = "command" | "tool" | "compactHook";

/**
 * Core handoff logic shared by the /handoff command, the handoff tool,
 * and the auto-handoff compaction hook.
 *
 * Returns an error string on failure, or undefined on success.
 */
async function performHandoff(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	goal: string,
	mode: HandoffMode = "command",
): Promise<string | undefined> {
	if (!ctx.hasUI) {
		return "Handoff requires interactive mode.";
	}

	if (!ctx.model) {
		return "No model selected.";
	}

	// Gather conversation context from current branch
	const branch = ctx.sessionManager.getBranch();
	const messages = branch
		.filter((entry): entry is SessionEntry & { type: "message" } => entry.type === "message")
		.map((entry) => entry.message);

	if (messages.length === 0) {
		return "No conversation to hand off.";
	}

	// Show context usage info
	const usage = checkContextUsage(ctx);
	if (usage) {
		const pct = Math.round(usage.percent * 100);
		ctx.ui.notify(
			`Context: ${pct}% (${Math.round(usage.tokens / 1000)}k tokens)`,
			usage.percent >= CONTEXT_WARNING_THRESHOLD ? "warning" : "info",
		);
	}

	// Convert to LLM format and serialize
	const llmMessages = convertToLlm(messages);
	const conversationText = serializeConversation(llmMessages);
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

	// Build the full prompt with parent reference
	let fullPrompt = `# ${goal}\n\n`;

	if (currentSessionFile) {
		fullPrompt += `**Parent session:** \`${currentSessionFile}\`\n\n`;
	}

	fullPrompt += result;

	// Create new session immediately
	// Use ctx.newSession if available (command mode), otherwise use sessionManager directly
	if ("newSession" in ctx && typeof ctx.newSession === "function") {
		const newSessionResult = await ctx.newSession({
			parentSession: currentSessionFile,
		});

		if (newSessionResult.cancelled) {
			return "New session cancelled.";
		}
	} else {
		// Tool/hook contexts: create session directly via session manager
		const sessionManager = ctx.sessionManager as any;
		sessionManager.newSession({ parentSession: currentSessionFile });
	}

	pi.setSessionName(goalToSessionName(goal));
	ctx.ui.setStatus("handoff-warning", undefined);

	// Prepend session-query skill if parent session present
	const messageToSend = /\*\*Parent session:\*\*/.test(fullPrompt)
		? `/skill:pi-session-query ${fullPrompt}`
		: fullPrompt;

	// Place in input box - user can edit and press Enter once to send
	ctx.ui.setEditorText(messageToSend);
	ctx.ui.notify("Handoff ready - edit if needed and press Enter to send", "info");

	return undefined;
}

export default function (pi: ExtensionAPI) {
	// --- System prompt hint ---
	// Inject handoff awareness into the system prompt so the model
	// can proactively suggest handoffs at high context usage.
	pi.on("before_agent_start", async (event, _ctx) => {
		return {
			systemPrompt: event.systemPrompt + HANDOFF_SYSTEM_HINT,
		};
	});

	// --- Auto-inject session-query skill ---
	// Note: skill is now prepended in setEditorText before user sends,
	// not via input transform hook (which caused double-enter issues).


	// --- Context monitoring ---
	pi.on("turn_end", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		const usage = checkContextUsage(ctx);
		if (!usage) return;

		if (usage.percent >= CONTEXT_WARNING_THRESHOLD) {
			const pct = Math.round(usage.percent * 100);
			ctx.ui.setStatus(
				"handoff-warning",
				`⚠️ Context ${pct}% full (${Math.round(usage.tokens / 1000)}k/${Math.round(usage.limit / 1000)}k) - consider /handoff`,
			);
		} else {
			ctx.ui.setStatus("handoff-warning", undefined);
		}
	});

	// --- Auto-handoff on compaction ---
	// When auto-compaction triggers, offer handoff as an alternative.
	// Requires compaction.enabled = true in settings (otherwise this hook
	// never fires). Users who disable auto-compaction can still use
	// /handoff manually.
	//
	// Guard: after we cancel compaction, pi may retry it immediately
	// (context is still full). The flag prevents the confirm dialog from
	// appearing a second time while a deferred synthetic handoff is pending.

	pi.on("session_before_compact", async (event, ctx) => {
		// Skip if we already handled this (deferred handoff in flight)
		if (handoffPending) return { cancel: true };

		if (!ctx.hasUI || !ctx.model) return;

		const usage = checkContextUsage(ctx);
		const pctStr = usage ? `${Math.round(usage.percent * 100)}%` : "high";

		const choice = await ctx.ui.select(
			`Context is ${pctStr} full. What would you like to do?`,
			["Handoff to new session", "Compact context", "Continue without either"],
		);

		if (choice === "Compact context" || choice === undefined) return; // fall through to normal compaction
		if (choice === "Continue without either") return { cancel: true };

		handoffPending = true;
		const error = await performHandoff(pi, ctx, "Continue current work", "compactHook");
		if (error) {
			handoffPending = false;
			ctx.ui.notify(`Handoff failed: ${error}. Compacting instead.`, "warning");
			return; // fall through to normal compaction
		}

		return { cancel: true };
	});

	// Clear guard when a real session switch occurs.
	pi.on("session_switch", async (_event, ctx) => {
		handoffPending = false;
		if (ctx.hasUI) {
			ctx.ui.setStatus("handoff-warning", undefined);
		}
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
						text: error ?? "Handoff queued. Switching to a new session with the generated prompt.",
					},
				],
			};
		},
	});

	// --- /context command ---
	pi.registerCommand("context", {
		description: "Show current context usage",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;

			const usage = checkContextUsage(ctx);
			if (!usage) {
				ctx.ui.notify("Context usage unavailable", "warning");
				return;
			}

			const pct = Math.round(usage.percent * 100);
			const tokensK = Math.round(usage.tokens / 1000);
			const limitK = Math.round(usage.limit / 1000);

			let message = `Context: ${pct}% (${tokensK}k / ${limitK}k tokens)`;
			if (usage.percent >= CONTEXT_WARNING_THRESHOLD) {
				message += " - consider /handoff";
			}

			ctx.ui.notify(message, usage.percent >= CONTEXT_WARNING_THRESHOLD ? "warning" : "info");
		},
	});
}
