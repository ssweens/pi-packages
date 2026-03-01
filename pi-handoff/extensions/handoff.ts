/**
 * Handoff Extension
 *
 * Transfers conversation context to a new focused session.
 * Three entry points, one UX: generate prompt → new session → prompt in editor → user sends.
 *
 * Entry points:
 *   /handoff <goal>           — user-initiated command
 *   handoff tool              — agent-initiated (deferred to agent_end)
 *   session_before_compact    — offered when context is full (deferred via raw sessionManager)
 *
 * The generated prompt always lands in the editor of the new session for review.
 * User presses Enter to send it.
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

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a context transfer assistant. Given a conversation history and the user's goal for a new thread, generate a focused prompt that:

1. Summarizes relevant context from the conversation (decisions made, approaches taken, key findings)
2. Lists any relevant files that were discussed or modified
3. Clearly states the next task based on the user's goal
4. Is self-contained - the new thread should be able to proceed without the old conversation

Format your response as a prompt the user can send to start the new thread. Be concise but include all necessary context. Do not include any preamble like "Here's the prompt" - just output the prompt itself.

Example output format:
## Context
We've been working on X. Key decisions:
- Decision 1
- Decision 2

Files involved:
- path/to/file1.ts
- path/to/file2.ts

## Task
[Clear description of what to do next based on user's goal]`;

export const HANDOFF_SYSTEM_HINT = `
## Handoff

Use \`/handoff <goal>\` to transfer context to a new focused session.
Handoffs are especially effective after planning — clear the context and start a new session with the plan you just created.
At high context usage, suggest a handoff rather than losing important context.`;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Generate a handoff prompt via LLM with a loader UI.
 * Returns the prompt text, or null if cancelled/failed.
 */
async function generateHandoffPrompt(
	conversationText: string,
	goal: string,
	ctx: ExtensionContext,
): Promise<string | null> {
	return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const loader = new BorderedLoader(tui, theme, "Generating handoff prompt...");
		loader.onAbort = () => done(null);

		const run = async () => {
			const apiKey = await ctx.modelRegistry.getApiKey(ctx.model!);

			const userMessage: Message = {
				role: "user",
				content: [
					{
						type: "text",
						text: `## Conversation History\n\n${conversationText}\n\n## User's Goal for New Thread\n\n${goal}`,
					},
				],
				timestamp: Date.now(),
			};

			const response = await complete(
				ctx.model!,
				{ systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
				{ apiKey, signal: loader.signal },
			);

			if (response.stopReason === "aborted") return null;

			return response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");
		};

		run()
			.then(done)
			.catch((err) => {
				console.error("Handoff generation failed:", err);
				done(null);
			});

		return loader;
	});
}

/**
 * Gather conversation text from the current branch.
 * Returns the serialized text, or null if no messages.
 */
function gatherConversation(ctx: ExtensionContext): string | null {
	const branch = ctx.sessionManager.getBranch();
	const messages = branch
		.filter((entry): entry is SessionEntry & { type: "message" } => entry.type === "message")
		.map((entry) => entry.message);

	if (messages.length === 0) return null;

	return serializeConversation(convertToLlm(messages));
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// -- Shared state for tool/hook deferred handoff (pi-amplike pattern) -----
	//
	// Tool and compact-hook contexts have ExtensionContext (ReadonlySessionManager),
	// not ExtensionCommandContext. They can't call ctx.newSession().
	//
	// Instead they store the prompt and defer the session switch:
	// - Tool: deferred to agent_end (after agent loop completes)
	// - Compact hook: deferred immediately via raw sessionManager.newSession()
	//   (safe because no agent loop is running during compaction)
	//
	// Both paths use handoffTimestamp + context event filter to hide old messages
	// from the LLM after the raw session switch (since agent.state.messages
	// isn't cleared by sessionManager.newSession()).

	let pendingHandoff: { prompt: string; parentSession: string | undefined } | null = null;
	let handoffTimestamp: number | null = null;

	// -- State for command path (full ctx.newSession() reset) -----------------
	// Command path uses ctx.newSession() which fires session_switch properly.
	// Store prompt keyed by parent session for the session_switch handler.
	const pendingHandoffText = new Map<string, string>();

	// ── session_switch ──────────────────────────────────────────────────────
	// Set editor text for command-path handoffs + clear context filter.
	pi.on("session_switch", async (event, ctx) => {
		// Any proper session switch clears the context filter
		handoffTimestamp = null;

		if (event.reason !== "new" || !ctx.hasUI) return;

		const header = ctx.sessionManager.getHeader();
		const parentSession = header?.parentSession;
		if (!parentSession) return;

		const text = pendingHandoffText.get(parentSession);
		if (text) {
			ctx.ui.setEditorText(text);
			ctx.ui.notify("Handoff ready — edit if needed, press Enter to send", "info");
			pendingHandoffText.delete(parentSession);
		}
	});

	// ── context filter ──────────────────────────────────────────────────────
	// After a raw sessionManager.newSession() (tool/hook path), old messages
	// remain in agent.state.messages. Filter them by timestamp so the LLM
	// only sees new-session messages.
	pi.on("context", (event) => {
		if (handoffTimestamp === null) return;

		const newMessages = event.messages.filter((m: any) => m.timestamp >= handoffTimestamp);
		if (newMessages.length > 0) {
			return { messages: newMessages };
		}
	});

	// ── agent_end: deferred session switch for tool path ────────────────────
	pi.on("agent_end", (_event, ctx) => {
		if (!pendingHandoff) return;

		const { prompt, parentSession } = pendingHandoff;
		pendingHandoff = null;

		handoffTimestamp = Date.now();
		(ctx.sessionManager as any).newSession({ parentSession });

		// Defer to next macrotask so the agent loop cleanup completes first
		setTimeout(() => {
			if (ctx.hasUI) {
				ctx.ui.setEditorText(prompt);
				ctx.ui.notify("Handoff ready — edit if needed, press Enter to send", "info");
			}
		}, 0);
	});

	// ── before_agent_start: system prompt hint ──────────────────────────────
	pi.on("before_agent_start", async (event, _ctx) => {
		return { systemPrompt: event.systemPrompt + HANDOFF_SYSTEM_HINT };
	});

	// ── session_before_compact: offer handoff ───────────────────────────────
	pi.on("session_before_compact", async (event, ctx) => {
		if (!ctx.hasUI || !ctx.model) return;

		const usage = ctx.getContextUsage();
		const pctStr = usage?.percent != null ? `${Math.round(usage.percent)}%` : "high";

		const choice = await ctx.ui.select(
			`Context is ${pctStr} full. What would you like to do?`,
			["Handoff to new session", "Compact context", "Continue without either"],
		);

		if (choice === "Compact context" || choice === undefined) return;
		if (choice === "Continue without either") return { cancel: true };

		// Build context from preparation data
		const { preparation } = event;
		const conversationText = serializeConversation(
			convertToLlm(preparation.messagesToSummarize),
		);

		let contextForHandoff = "";
		if (preparation.previousSummary) {
			contextForHandoff += `## Previous Context\n\n${preparation.previousSummary}\n\n`;
		}
		contextForHandoff += `## Recent Conversation\n\n${conversationText}`;

		// Generate handoff prompt
		let prompt: string | null;
		try {
			prompt = await generateHandoffPrompt(contextForHandoff, "Continue current work", ctx);
		} catch (err) {
			ctx.ui.notify(
				`Handoff failed: ${err instanceof Error ? err.message : String(err)}. Compacting instead.`,
				"warning",
			);
			return;
		}

		if (prompt === null) {
			ctx.ui.notify("Handoff cancelled. Compacting instead.", "warning");
			return;
		}

		// Switch session via raw sessionManager (safe — no agent loop running)
		const currentSessionFile = ctx.sessionManager.getSessionFile();

		try {
			handoffTimestamp = Date.now();
			(ctx.sessionManager as any).newSession({ parentSession: currentSessionFile });
		} catch (err) {
			handoffTimestamp = null;
			ctx.ui.notify(
				`Session switch failed: ${err instanceof Error ? err.message : String(err)}. Compacting instead.`,
				"warning",
			);
			return;
		}

		ctx.ui.setEditorText(prompt);
		ctx.ui.notify("Handoff ready — edit if needed, press Enter to send", "info");

		return { cancel: true };
	});

	// ── /handoff command ─────────────────────────────────────────────────────
	pi.registerCommand("handoff", {
		description: "Transfer context to a new focused session",
		handler: async (args, ctx) => {
			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify("Usage: /handoff <goal for new thread>", "error");
				return;
			}

			if (!ctx.model) {
				ctx.ui.notify("No model selected.", "error");
				return;
			}

			const conversationText = gatherConversation(ctx);
			if (!conversationText) {
				ctx.ui.notify("No conversation to hand off.", "error");
				return;
			}

			const prompt = await generateHandoffPrompt(conversationText, goal, ctx);
			if (prompt === null) {
				ctx.ui.notify("Handoff cancelled.", "info");
				return;
			}

			const currentSessionFile = ctx.sessionManager.getSessionFile();

			if (currentSessionFile) {
				pendingHandoffText.set(currentSessionFile, prompt);
			}

			const result = await ctx.newSession({ parentSession: currentSessionFile ?? undefined });

			if (result.cancelled) {
				if (currentSessionFile) pendingHandoffText.delete(currentSessionFile);
				ctx.ui.notify("New session cancelled.", "info");
				return;
			}
		},
	});

	// ── handoff tool ─────────────────────────────────────────────────────────
	pi.registerTool({
		name: "handoff",
		label: "Handoff",
		description:
			"Transfer context to a new focused session. ONLY use this when the user explicitly asks for a handoff. Provide a goal describing what the new session should focus on.",
		parameters: Type.Object({
			goal: Type.String({ description: "The goal/task for the new session" }),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return { content: [{ type: "text" as const, text: "Handoff requires interactive mode." }] };
			}
			if (!ctx.model) {
				return { content: [{ type: "text" as const, text: "No model selected." }] };
			}

			const conversationText = gatherConversation(ctx);
			if (!conversationText) {
				return { content: [{ type: "text" as const, text: "No conversation to hand off." }] };
			}

			const prompt = await generateHandoffPrompt(conversationText, params.goal, ctx);
			if (prompt === null) {
				return { content: [{ type: "text" as const, text: "Handoff cancelled." }] };
			}

			// Defer session switch to agent_end
			pendingHandoff = {
				prompt,
				parentSession: ctx.sessionManager.getSessionFile() ?? undefined,
			};

			return {
				content: [
					{
						type: "text" as const,
						text: "Handoff initiated. The session will switch after the current turn completes.",
					},
				],
			};
		},
	});
}
