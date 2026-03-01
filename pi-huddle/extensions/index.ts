/**
 * Huddle Extension
 *
 * Safe exploration mode with permission gates for file modifications.
 * Read-only by default; writes require user approval.
 *
 * Features:
 * - /huddle, /holup, or /plan commands to toggle
 * - Alt+P shortcut to toggle
 * - Bash restricted to allowlisted commands (others prompt for permission)
 * - edit/write tools prompt for permission during huddle mode
 * - ask_user tool for structured elicitation during planning
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { AskUserDialog, type AskUserDialogResult } from "./lib/ask-user-dialog.js";
import { isSafeCommand } from "./lib/utils.js";

// Tools
const HUDDLE_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "ask_user"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write", "ask_user"];

export default function huddleExtension(pi: ExtensionAPI): void {
	let huddleEnabled = false;

	pi.registerFlag("plan", {
		description: "Start in huddle mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		if (huddleEnabled) {
			ctx.ui.setStatus("huddle", ctx.ui.theme.fg("warning", "⏸ huddle"));
		} else {
			ctx.ui.setStatus("huddle", undefined);
		}
		ctx.ui.setWidget("plan-todos", undefined);
	}

	function toggleHuddle(ctx: ExtensionContext): void {
		huddleEnabled = !huddleEnabled;

		if (huddleEnabled) {
			pi.setActiveTools(HUDDLE_MODE_TOOLS);
			ctx.ui.notify(`Huddle mode enabled. Tools: ${HUDDLE_MODE_TOOLS.join(", ")}. Safe: cd, rg, fd, cat, git status/log/diff`);
		} else {
			pi.setActiveTools(NORMAL_MODE_TOOLS);
			ctx.ui.notify("Huddle mode disabled. Full access restored.");
		}
		updateStatus(ctx);
	}

	// Primary command
	pi.registerCommand("huddle", {
		description: "Toggle huddle mode (read-only exploration + structured elicitation)",
		handler: async (_args, ctx) => toggleHuddle(ctx),
	});

	// Aliases
	pi.registerCommand("holup", {
		description: "Toggle huddle mode (alias for /huddle)",
		handler: async (_args, ctx) => toggleHuddle(ctx),
	});

	pi.registerCommand("plan", {
		description: "Toggle huddle mode (alias for /huddle)",
		handler: async (_args, ctx) => toggleHuddle(ctx),
	});

	pi.registerShortcut("alt+h", {
		description: "Toggle huddle mode",
		handler: async (ctx) => toggleHuddle(ctx),
	});

	// Ask User Question tool - structured elicitation
	pi.registerTool({
		name: "ask_user",
		label: "Ask User Question",
		description: `Use this tool when you need to ask the user questions during execution. This allows you to:
- Gather user preferences or requirements
- Clarify ambiguous instructions
- Get decisions on implementation choices as you work
- Offer choices to the user about what direction to take

Usage notes:
- Users will always be able to type a custom answer in the freeform field
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Huddle mode note: In huddle mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" - use ExitHuddleMode for plan approval. IMPORTANT: Do not reference "the plan" in your questions (e.g. "Do you have feedback about the plan?", "Does the plan look good?") because the user cannot see the plan in the UI until you call ExitHuddleMode. If you need plan approval, use ExitHuddleMode instead.`,
		parameters: Type.Object({
			questions: Type.Array(
				Type.Object({
					question: Type.String({
						description: "The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: 'Which library should we use for date formatting?' If multiSelect is true, phrase it accordingly, e.g. 'Which features do you want to enable?'",
					}),
					header: Type.String({
						description: "Very short label displayed as a chip/tag (max 12 chars). Examples: 'Auth method', 'Library', 'Approach'.",
					}),
					options: Type.Array(
						Type.Object({
							label: Type.String({
								description: "The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice.",
							}),
							description: Type.String({
								description: "Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications.",
							}),
							markdown: Type.Optional(Type.String({
								description: "Optional preview content shown in a monospace box when this option is focused. Use for ASCII mockups, code snippets, or diagrams that help users visually compare options. Supports multi-line text with newlines.",
							})),
						}),
						{
							minItems: 2,
							maxItems: 4,
						}
					),
					multiSelect: Type.Boolean({
						default: false,
						description: "Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.",
					}),
				}),
				{
					minItems: 1,
					maxItems: 4,
					description: "Questions to ask the user (1-4 questions)",
				}
			),
			metadata: Type.Optional(Type.Object({
				source: Type.Optional(Type.String({
					description: "Optional identifier for the source of this question (e.g., 'remember' for /remember command). Used for analytics tracking.",
				})),
			}, {
				description: "Optional metadata for tracking and analytics purposes. Not displayed to user.",
			})),
		}),
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
			const { questions, metadata } = params;

			const result = await ctx.ui.custom<AskUserDialogResult>(
				(tui, theme, _kb, done) => {
					const dialog = new AskUserDialog(questions, theme);
					dialog.onDone = (r) => done(r);
					return {
						get focused() { return dialog.focused; },
						set focused(v: boolean) { dialog.focused = v; },
						render: (w: number) => dialog.render(w),
						invalidate: () => dialog.invalidate(),
						handleInput: (data: string) => {
							dialog.handleInput(data);
							tui.requestRender();
						},
					};
				},
			);

			// Cancelled (Esc)
			if (!result) {
				return {
					content: [{ type: "text", text: "User cancelled the question." }],
					details: { answers: {}, annotations: {}, metadata },
				};
			}

			// "Chat about this"
			if ("chatMode" in result) {
				return {
					content: [{ type: "text", text: "The user selected 'Chat about this'. They want to discuss the options before deciding. Respond conversationally." }],
					details: { chatMode: true, metadata },
				};
			}

			// Normal submission
			const summary = Object.entries(result.answers)
				.map(([q, a]) => `- ${q}\n  → ${a}`)
				.join("\n");

			return {
				content: [{ type: "text", text: `User answers:\n${summary}` }],
				details: { ...result, metadata },
			};
		},
	});

	// Permission gate for blocked operations in huddle mode
	pi.on("tool_call", async (event, ctx) => {
		if (!huddleEnabled) return;

		const toolName = event.toolName;

		if (toolName === "write" || toolName === "edit") {
			const path = event.input.path || event.input.file || "unknown";
			const theme = ctx.ui.theme;
			const title = `${theme.fg("warning", theme.bold("⚠ Huddle Mode"))} — ${theme.fg("accent", toolName)}: ${theme.fg("accent", path)}`;
			const choice = await ctx.ui.select(title, [
				"Allow",
				"Deny",
				"Deny with feedback",
			]);

			if (choice === "Allow") return;

			let reason = `User denied ${toolName} permission in huddle mode`;
			if (choice === "Deny with feedback") {
				const feedback = await ctx.ui.input("Why? (feedback sent to agent):");
				if (feedback) reason = feedback;
			}

			return { block: true, reason };
		}

		if (toolName === "bash") {
			const command = event.input.command as string;
			if (!isSafeCommand(command)) {
				const theme = ctx.ui.theme;
				const title = `${theme.fg("warning", theme.bold("⚠ Huddle Mode"))} — ${theme.fg("accent", command)}`;
				const choice = await ctx.ui.select(title, [
					"Allow",
					"Deny",
					"Deny with feedback",
				]);

				if (choice === "Allow") return;

				let reason = `User denied bash command in huddle mode: ${command}`;
				if (choice === "Deny with feedback") {
					const feedback = await ctx.ui.input("Why? (feedback sent to agent):");
					if (feedback) reason = feedback;
				}

				return { block: true, reason };
			}
		}
	});

	// Filter out stale huddle context when not in huddle mode
	pi.on("context", async (event) => {
		if (huddleEnabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "huddle-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[HUDDLE MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[HUDDLE MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// Inject huddle context before agent starts
	pi.on("before_agent_start", async () => {
		if (huddleEnabled) {
			return {
				message: {
					customType: "huddle-context",
					content: `[HUDDLE MODE ACTIVE]
You are in huddle mode - a read-only exploration mode for safe code analysis and structured elicitation.

IMPORTANT: Do NOT attempt to use edit or write tools while huddle mode is active. They are disabled. If you believe a file change is needed, tell the user and ask them to exit huddle mode first (via /huddle, /holup, /plan, or Alt+P).

Available Tools:
- read, bash, grep, find, ls, ask_user (always allowed)

Safe Bash Commands (always allowed):
cat, cd, rg, fd, grep, head, tail, ls, find, git status/log/diff/branch, npm list

Other bash commands will prompt for permission.

Use the ask_user tool for structured elicitation — gathering requirements, clarifying ambiguity, and getting decisions from the user before acting.

Create a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT execute the plan. Only plan and analyze. When you are ready to execute, ask the user to exit huddle mode.`,
					display: false,
				},
			};
		}
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) {
			huddleEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();

		const huddleEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "huddle")
			.pop() as { data?: { enabled: boolean } } | undefined;

		if (huddleEntry?.data) {
			huddleEnabled = huddleEntry.data.enabled ?? huddleEnabled;
		}

		if (huddleEnabled) {
			pi.setActiveTools(HUDDLE_MODE_TOOLS);
		}
		updateStatus(ctx);
	});
}
