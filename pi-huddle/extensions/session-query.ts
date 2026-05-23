/**
 * Session Query Extension - Query previous pi sessions
 *
 * Provides a tool the model can use to query past sessions for context,
 * decisions, code changes, or other information.
 */

import { complete, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";
import {
	SessionManager,
	convertToLlm,
	serializeConversation,
	getMarkdownTheme,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";

const MAX_SESSION_CHARS = 100_000;

const QUERY_SYSTEM_PROMPT = `Extract information relevant to the question from the session history.
Return a concise answer using bullet points where appropriate.
Use code pointers (path/to/file.ts:42 or path/to/file.ts#functionName) when referencing specific code.
If the information is not in the session, say so clearly.`;

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "session_query",
		label: (params) => `Query Session: ${params.question}`,
		description:
			"Query a previous pi session file for context, decisions, or information. Use when you need to look up what happened in a parent session or any other session. The sessionPath should be the full path to a .jsonl session file.",

		parameters: Type.Object({
			sessionPath: Type.String({
				description:
					"Full path to the session file (e.g., /home/user/.pi/agent/sessions/.../session.jsonl)",
			}),
			question: Type.String({
				description:
					"What you want to know about that session (e.g., 'What files were modified?' or 'What approach was chosen?')",
			}),
		}),

		renderResult(result, _options, theme) {
			const container = new Container();

			if (result.content && result.content[0]?.text) {
				const text = result.content[0].text;

				if (result.details?.error) {
					container.addChild(new Text(theme.fg("error", text), 0, 0));
					return container;
				}

				const match = text.match(/\*\*Query:\*\* (.+?)\n\n---\n\n([\s\S]+)/);

				if (match) {
					const [, query, answer] = match;
					container.addChild(new Text(theme.bold("Query: ") + theme.fg("accent", query), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(
						new Markdown(answer.trim(), 0, 0, getMarkdownTheme(), {
							color: (s: string) => theme.fg("toolOutput", s),
						}),
					);
				} else {
					container.addChild(new Text(theme.fg("toolOutput", text), 0, 0));
				}

				if (result.details?.messageCount) {
					const truncNote = result.details.truncated ? ", truncated" : "";
					container.addChild(new Spacer(1));
					container.addChild(
						new Text(
							theme.fg("dim", `(${result.details.messageCount} messages in session${truncNote})`),
							0,
							0,
						),
					);
				}
			}

			return container;
		},

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const { sessionPath, question } = params;

			const errorResult = (text: string) => ({
				content: [{ type: "text" as const, text }],
				details: { error: true },
			});

			if (!sessionPath.endsWith(".jsonl")) {
				return errorResult(`Error: Invalid session path. Expected a .jsonl file, got: ${sessionPath}`);
			}
			if (!fs.existsSync(sessionPath)) {
				return errorResult(`Error: Session file not found: ${sessionPath}`);
			}

			onUpdate?.({
				content: [{ type: "text", text: `Querying session: ${question}` }],
				details: { status: "loading", question },
			});

			let sessionManager: SessionManager;
			try {
				sessionManager = SessionManager.open(sessionPath);
			} catch (err) {
				return errorResult(`Error loading session: ${err}`);
			}

			const branch = sessionManager.getBranch();
			const messages = branch
				.filter((entry): entry is SessionEntry & { type: "message" } => entry.type === "message")
				.map((entry) => entry.message);

			if (messages.length === 0) {
				return {
					content: [{ type: "text" as const, text: "Session is empty - no messages found." }],
					details: { empty: true },
				};
			}

			const llmMessages = convertToLlm(messages);
			let conversationText = serializeConversation(llmMessages);
			let truncated = false;

			if (conversationText.length > MAX_SESSION_CHARS) {
				conversationText = "…[earlier messages truncated]…\n\n" + conversationText.slice(-MAX_SESSION_CHARS);
				truncated = true;
			}

			if (!ctx.model) {
				return errorResult("Error: No model available to analyze the session.");
			}

			try {
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
				if (!auth.ok) return errorResult(`Auth error: ${auth.error}`);

				const userMessage: Message = {
					role: "user",
					content: [
						{
							type: "text",
							text: `## Session Conversation\n\n${conversationText}\n\n## Question\n\n${question}`,
						},
					],
					timestamp: Date.now(),
				};

				const response = await complete(
					ctx.model,
					{ systemPrompt: QUERY_SYSTEM_PROMPT, messages: [userMessage] },
					{ apiKey: auth.apiKey, signal },
				);

				if (response.stopReason === "aborted") {
					return {
						content: [{ type: "text" as const, text: "Query was cancelled." }],
						details: { cancelled: true },
					};
				}

				const answer = response.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n");

				return {
					content: [{ type: "text" as const, text: `**Query:** ${question}\n\n---\n\n${answer}` }],
					details: {
						sessionPath,
						question,
						messageCount: messages.length,
						truncated,
					},
				};
			} catch (err) {
				return errorResult(`Error querying session: ${err}`);
			}
		},
	});
}
