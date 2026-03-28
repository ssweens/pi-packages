/**
 * Quick Question Extension (Strict Spec Compliant)
 *
 * Ask a quick side question (via /qq) about the current coding session.
 * The answer is ephemeral: shown inline and NEVER added to history.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import type { Message } from "@mariozechner/pi-ai";
import {
	buildSessionContext,
	convertToLlm,
	type Theme,
} from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { wrapTextWithAnsi, Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

const QQ_CUSTOM_TYPE = "qq";
const QQ_SYSTEM_PROMPT_SUFFIX = `
[SIDE QUESTION MODE]
You are answering a quick side question about the current coding session. 
- You have NO tool access (read, bash, etc. are disabled).
- Answer only using the information already provided in the conversation context.
- Be concise (1-3 sentences).
- If you don't know based on the context, say so.`;

const MAX_VIEWPORT_HEIGHT = 4;

/**
 * Renders the Quick Question box with a right-rail scrollbar.
 */
function renderQqBox(
	width: number, 
	theme: Theme, 
	question: string, 
	answer: string, 
	isStreaming: boolean,
	scrollOffset: number = 0
) {
	const borderStyle = (s: string) => theme.fg("border", s);
	const accentStyle = (s: string) => theme.fg("accent", s);
	const dimStyle = (s: string) => theme.fg("dim", s);
	const thumbStyle = (s: string) => theme.fg("accent", s);

	// Account for left border (1 char) + "   " (3 chars) + right border (1 char)
	// But we also add "  " before right border, so: 1 + 3 + content + 2 + 1 = width
	const leftPrefixWidth = 4; // "│   "
	const rightSuffixWidth = 3; // "  │" or "  ┃"
	const contentWidth = Math.max(1, width - leftPrefixWidth - rightSuffixWidth);
	
	const out: string[] = [];

	// Widget mode: add breathing room above
	out.push(""); 

	// Header line (full width, no right border)
	const headerText = `${borderStyle("╭─")} ${accentStyle("Quick Question:")} ${question}`;
	out.push(truncateToWidth(headerText, width));
	out.push(borderStyle("│")); // Top Spacer

	// Body text
	const displayText = answer || (isStreaming ? dimStyle("Thinking...") : "");
	const bodyLines = wrapTextWithAnsi(displayText.trim(), contentWidth);
	
	const totalLines = bodyLines.length;
	const currentHeight = Math.min(totalLines, MAX_VIEWPORT_HEIGHT);
	const viewStart = Math.max(0, Math.min(scrollOffset, totalLines - currentHeight));
	const viewEnd = Math.min(totalLines, viewStart + currentHeight);
	const visibleLines = bodyLines.slice(viewStart, viewEnd);

	// Scrollbar logic
	let thumbStart = -1;
	let thumbEnd = -1;
	if (totalLines > MAX_VIEWPORT_HEIGHT) {
		const ratio = MAX_VIEWPORT_HEIGHT / totalLines;
		const thumbSize = Math.max(1, Math.round(MAX_VIEWPORT_HEIGHT * ratio));
		thumbStart = Math.round((viewStart / totalLines) * MAX_VIEWPORT_HEIGHT);
		thumbEnd = thumbStart + thumbSize;
	}

	for (let i = 0; i < visibleLines.length; i++) {
		const line = visibleLines[i];
		const truncatedLine = truncateToWidth(line, contentWidth);
		
		// Right border is either track │ or thumb ┃
		let rightBorder = borderStyle("│");
		if (totalLines > MAX_VIEWPORT_HEIGHT && i >= thumbStart && i < thumbEnd) {
			rightBorder = thumbStyle("┃");
		}

		// Build line: left prefix + content + right suffix
		const leftPrefix = borderStyle("│") + "   ";
		const rightSuffix = "  " + rightBorder;
		out.push(leftPrefix + truncatedLine + rightSuffix);
	}

	out.push(borderStyle("│")); // Bottom Spacer

	// Footer line
	let scrollInfo = "";
	if (totalLines > MAX_VIEWPORT_HEIGHT) {
		scrollInfo = dimStyle(` [Line ${viewStart + 1}-${viewEnd} of ${totalLines}]`);
	}

	const hint = isStreaming 
		? dimStyle("(Esc to cancel)") 
		: dimStyle("(Space/Enter/Esc to dismiss)");
	
	const footerText = borderStyle("╰─") + scrollInfo + " " + hint;
	out.push(truncateToWidth(footerText, width));

	return out;
}

export default function qqExtension(pi: ExtensionAPI): void {
	// Filter qq messages from LLM context
	pi.on("context", (event) => {
		const filtered = event.messages.filter((m) => {
			const msg = m as AgentMessage & { customType?: string };
			return msg.customType !== QQ_CUSTOM_TYPE;
		});
		if (filtered.length !== event.messages.length) return { messages: filtered };
	});

	// Unified handler for /qq and /btw
	const qqHandler = async (args: string, ctx: any) => {
		const question = args.trim();
		if (!question) {
			ctx.ui.notify("Usage: /qq <question>", "error");
			return;
		}
		if (!ctx.model) {
			ctx.ui.notify("No model available for quick question", "error");
			return;
		}

		const branch = ctx.sessionManager.getBranch();
		const leafId = ctx.sessionManager.getLeafId();
		const { messages } = buildSessionContext(branch, leafId);
		const llmMessages = convertToLlm(messages);

		const contextMessages: Message[] = [
			...llmMessages,
			{ role: "user" as const, content: [{ type: "text" as const, text: question }], timestamp: Date.now() },
		];

		let qqModel = ctx.model!;
		let auth = await ctx.modelRegistry.getApiKeyAndHeaders(qqModel);
		if (!auth.ok) {
			// Current model doesn't have a usable API key — try other available models
			const fallback = ctx.modelRegistry.getAvailable().find((m: any) => m !== qqModel);
			if (fallback) {
				auth = await ctx.modelRegistry.getApiKeyAndHeaders(fallback);
				if (auth.ok) qqModel = fallback;
			}
			if (!auth.ok) {
				ctx.ui.notify("Could not retrieve API key for quick question", "error");
				return;
			}
		}
		const apiKey = auth.apiKey ?? "";
		const extraHeaders = auth.ok && auth.headers ? auth.headers : undefined;

		// Disable thinking for quick questions — fast and concise
		const thinkingLevel = undefined;
		const abortController = new AbortController();
		let accumulated = "";
		let streamDone = false;
		let scrollOffset = 0;

		const systemPrompt = ctx.getSystemPrompt() + QQ_SYSTEM_PROMPT_SUFFIX;

		// Helper to update the inline widget
		const updateWidget = () => {
			ctx.ui.setWidget("qq", (_tui, theme) => ({
				render: (w) => renderQqBox(w, theme, question, accumulated, !streamDone, scrollOffset),
				invalidate: () => {},
			}), { placement: "aboveEditor" });
		};

		// Initial display
		updateWidget();

		// Start streaming in background
		const streamPromise = (async () => {
			try {
				const eventStream = streamSimple(
					qqModel,
					{ systemPrompt, messages: contextMessages },
					{ 
						apiKey, 
						signal: abortController.signal, 
						reasoning: thinkingLevel,
						tools: [],
						...(extraHeaders ? { headers: extraHeaders } : {}),
					},
				);
				for await (const event of eventStream) {
					if (abortController.signal.aborted) break;
					if (event.type === "text_delta") {
						accumulated += event.delta;
						updateWidget();
					} else if (event.type === "done") {
						// Extract text from the final message if streaming missed it
						if (!accumulated && event.message?.content) {
							for (const part of event.message.content) {
								if (part.type === "text") accumulated += part.text;
							}
						}
						if (!accumulated) accumulated = "(No response text received)";
						streamDone = true;
						updateWidget();
					}
				}
				if (!streamDone) {
					streamDone = true;
					updateWidget();
				}
			} catch (err) {
				accumulated = accumulated || `Error: ${err instanceof Error ? err.message : String(err)}`;
				streamDone = true;
				updateWidget();
			}
		})();

		// Ghost interactive modal
		const startTime = Date.now();
		await ctx.ui.custom((tui, _theme, _kb, done) => ({
			render: () => [], 
			handleInput: (data) => {
				// 1. Navigation Keys
				if (matchesKey(data, Key.up)) {
					scrollOffset = Math.max(0, scrollOffset - 1);
					updateWidget();
					tui.requestRender();
					return;
				}
				if (matchesKey(data, Key.down)) {
					scrollOffset++;
					updateWidget();
					tui.requestRender();
					return;
				}

				// 2. Escape (Instant cancel)
				if (data === "\x1b") {
					abortController.abort();
					done(null);
					return;
				}

				// 3. Dismissal keys (with safety)
				if (data === " " || data === "\r" || data === "\n") {
					if (Date.now() - startTime >= 500) {
						done(null);
					}
					return;
				}
			},
			invalidate: () => {},
		}), { 
			overlay: true,
			overlayOptions: { anchor: "top-left", width: 0, height: 0 }
		});

		ctx.ui.setWidget("qq", undefined);
		await streamPromise;
	};

	pi.registerCommand("qq", {
		description: "Ask a quick question about your current work (ephemeral, no history)",
		handler: qqHandler,
	});
	pi.registerCommand("btw", {
		description: "Ask a quick side question (alias for /qq)",
		handler: qqHandler,
	});
}
