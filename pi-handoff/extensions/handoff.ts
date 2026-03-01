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

const SYSTEM_PROMPT = `You are a context transfer assistant. Read the conversation and produce a structured handoff summary for the stated goal. The new thread must be able to proceed without the old conversation.

Do NOT continue the conversation. Do NOT respond to any questions in the history. ONLY output the structured summary.

Use this EXACT format:

## Goal
[The user's goal for the new thread — what they want to accomplish.]

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

## Key Decisions
- **[Decision]**: [Brief rationale]
- Use code pointers (path/to/file.ts:42 or path/to/file.ts#functionName) where relevant

## Next Steps
1. [Ordered list of what should happen next, filtered by the stated goal]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Rules:
- Be concise. Every bullet earns its place.
- Preserve exact file paths, function names, and error messages.
- Only include information relevant to the stated goal — discard unrelated context.
- Output the formatted content only. No preamble, no filler.`;

export const HANDOFF_SYSTEM_HINT = `
## Handoff

Use \`/handoff <goal>\` to transfer context to a new focused session.
Handoffs are especially effective after planning — clear the context and start a new session with the plan you just created.
At high context usage, suggest a handoff rather than losing important context.`;

// ---------------------------------------------------------------------------
// File operation tracking (mirrors pi's compaction/utils.ts approach)
// ---------------------------------------------------------------------------

interface FileOps {
	read: Set<string>;
	written: Set<string>;
	edited: Set<string>;
}

function createFileOps(): FileOps {
	return { read: new Set(), written: new Set(), edited: new Set() };
}

/** Extract file paths from tool calls in assistant messages. */
function extractFileOpsFromMessage(message: any, fileOps: FileOps): void {
	if (message.role !== "assistant") return;
	if (!Array.isArray(message.content)) return;

	for (const block of message.content) {
		if (block?.type !== "toolCall" || !block.arguments || !block.name) continue;
		const path = typeof block.arguments.path === "string" ? block.arguments.path : undefined;
		if (!path) continue;

		switch (block.name) {
			case "read":
				fileOps.read.add(path);
				break;
			case "write":
				fileOps.written.add(path);
				break;
			case "edit":
				fileOps.edited.add(path);
				break;
		}
	}
}

/** Compute read-only and modified file lists, append to summary as XML tags. */
function appendFileOperations(summary: string, messages: any[]): string {
	const fileOps = createFileOps();
	for (const msg of messages) extractFileOpsFromMessage(msg, fileOps);

	const modified = new Set([...fileOps.edited, ...fileOps.written]);
	const readFiles = [...fileOps.read].filter((f) => !modified.has(f)).sort();
	const modifiedFiles = [...modified].sort();

	const sections: string[] = [];
	if (readFiles.length > 0) {
		sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
	}
	if (modifiedFiles.length > 0) {
		sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
	}

	return sections.length > 0 ? `${summary}\n\n${sections.join("\n\n")}` : summary;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type HandoffResult = { type: "prompt"; text: string } | { type: "error"; message: string } | null;

/**
 * Generate a handoff prompt via LLM with a loader UI.
 * Returns { type: "prompt", text } on success, { type: "error", message } on failure, or null if user cancelled.
 */
async function generateHandoffPrompt(
	conversationText: string,
	goal: string,
	ctx: ExtensionContext,
): Promise<HandoffResult> {
	return ctx.ui.custom<HandoffResult>((tui, theme, _kb, done) => {
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
			if (response.stopReason === "error") {
				const msg =
					"errorMessage" in response && typeof (response as any).errorMessage === "string"
						? (response as any).errorMessage
						: "LLM request failed";
				return { type: "error" as const, message: msg };
			}

			const text = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n")
				.trim();

			return text.length > 0 ? { type: "prompt" as const, text } : { type: "error" as const, message: "LLM returned empty response" };
		};

		run()
			.then(done)
			.catch((err) => {
				const message = err instanceof Error ? err.message : String(err);
				done({ type: "error" as const, message });
			});

		return loader;
	});
}

/**
 * Gather conversation from the current branch.
 * Returns serialized text + raw messages (for file op extraction), or null if empty.
 */
function gatherConversation(ctx: ExtensionContext): { text: string; messages: any[] } | null {
	const branch = ctx.sessionManager.getBranch();
	const messages = branch
		.filter((entry): entry is SessionEntry & { type: "message" } => entry.type === "message")
		.map((entry) => entry.message);

	if (messages.length === 0) return null;

	return { text: serializeConversation(convertToLlm(messages)), messages };
}

/**
 * Wrap a handoff prompt with the parent session reference and session-query skill.
 * Enables the new session to query the old one for details not in the summary.
 */
function wrapWithParentSession(prompt: string, parentSessionFile: string | null): string {
	if (!parentSessionFile) return prompt;

	return `/skill:pi-session-query\n\n**Parent session:** \`${parentSessionFile}\`\n\n${prompt}`;
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
		const handoffResult = await generateHandoffPrompt(contextForHandoff, "Continue current work", ctx);

		if (!handoffResult) {
			ctx.ui.notify("Handoff cancelled. Compacting instead.", "warning");
			return;
		}
		if (handoffResult.type === "error") {
			ctx.ui.notify(`Handoff failed: ${handoffResult.message}. Compacting instead.`, "warning");
			return;
		}

		// Append programmatic file tracking from the messages being summarized
		let prompt = appendFileOperations(handoffResult.text, preparation.messagesToSummarize);

		// Switch session via raw sessionManager (safe — no agent loop running)
		const currentSessionFile = ctx.sessionManager.getSessionFile();

		// Wrap with parent session reference + session-query skill
		prompt = wrapWithParentSession(prompt, currentSessionFile ?? null);

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

			const conv = gatherConversation(ctx);
			if (!conv) {
				ctx.ui.notify("No conversation to hand off.", "error");
				return;
			}

			const result = await generateHandoffPrompt(conv.text, goal, ctx);
			if (!result) {
				ctx.ui.notify("Handoff cancelled.", "info");
				return;
			}
			if (result.type === "error") {
				ctx.ui.notify(`Handoff failed: ${result.message}`, "error");
				return;
			}

			// Append programmatic file tracking (read/modified from tool calls)
			let prompt = appendFileOperations(result.text, conv.messages);

			const currentSessionFile = ctx.sessionManager.getSessionFile();

			// Wrap with parent session reference + session-query skill
			prompt = wrapWithParentSession(prompt, currentSessionFile ?? null);

			if (currentSessionFile) {
				pendingHandoffText.set(currentSessionFile, prompt);
			}

			const sessionResult = await ctx.newSession({ parentSession: currentSessionFile ?? undefined });

			if (sessionResult.cancelled) {
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

			const conv = gatherConversation(ctx);
			if (!conv) {
				return { content: [{ type: "text" as const, text: "No conversation to hand off." }] };
			}

			const result = await generateHandoffPrompt(conv.text, params.goal, ctx);
			if (!result) {
				return { content: [{ type: "text" as const, text: "Handoff cancelled." }] };
			}
			if (result.type === "error") {
				return { content: [{ type: "text" as const, text: `Handoff failed: ${result.message}` }] };
			}

			let prompt = appendFileOperations(result.text, conv.messages);

			const currentSessionFile = ctx.sessionManager.getSessionFile();
			prompt = wrapWithParentSession(prompt, currentSessionFile ?? null);

			// Defer session switch to agent_end
			pendingHandoff = {
				prompt,
				parentSession: currentSessionFile ?? undefined,
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
