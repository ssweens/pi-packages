/**
 * Plan Mode Extension
 *
 * Safe exploration mode with permission gates for file modifications.
 * Read-only by default; writes require user approval.
 *
 * Features:
 * - /plan command or Alt+P to toggle
 * - Bash restricted to allowlisted commands (others prompt for permission)
 * - edit/write tools prompt for permission during plan mode
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isSafeCommand } from "./lib/utils.js";

// Tools
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		// Footer status
		if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		// Clear widget
		ctx.ui.setWidget("plan-todos", undefined);
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		planModeEnabled = !planModeEnabled;

		if (planModeEnabled) {
			pi.setActiveTools(PLAN_MODE_TOOLS);
			ctx.ui.notify(`Plan mode enabled. Tools: ${PLAN_MODE_TOOLS.join(", ")}. Safe: cd, rg, fd, cat, git status/log/diff`);
		} else {
			pi.setActiveTools(NORMAL_MODE_TOOLS);
			ctx.ui.notify("Plan mode disabled. Full access restored.");
		}
		updateStatus(ctx);
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
		});
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerShortcut("alt+p", {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	// Permission gate for blocked operations in plan mode
	pi.on("tool_call", async (event, ctx) => {
		if (!planModeEnabled) return;

		const toolName = event.toolName;

		// Block write/edit tools - ask for permission
		if (toolName === "write" || toolName === "edit") {
			const path = event.input.path || event.input.file || "unknown";
			const theme = ctx.ui.theme;
			const title = `${theme.fg("warning", theme.bold("⚠ Plan Mode"))} — ${theme.fg("accent", toolName)}: ${theme.fg("accent", path)}`;
			const choice = await ctx.ui.select(title, [
				"Allow",
				"Deny",
				"Deny with feedback",
			]);

			if (choice === "Allow") return;

			let reason = `User denied ${toolName} permission in plan mode`;
			if (choice === "Deny with feedback") {
				const feedback = await ctx.ui.input("Why? (feedback sent to agent):");
				if (feedback) reason = feedback;
			}

			return { block: true, reason };
		}

		// For bash commands, check if safe
		if (toolName === "bash") {
			const command = event.input.command as string;
			if (!isSafeCommand(command)) {
				const theme = ctx.ui.theme;
				const title = `${theme.fg("warning", theme.bold("⚠ Plan Mode"))} — ${theme.fg("accent", command)}`;
				const choice = await ctx.ui.select(title, [
					"Allow",
					"Deny",
					"Deny with feedback",
				]);

				if (choice === "Allow") return;

				let reason = `User denied bash command in plan mode: ${command}`;
				if (choice === "Deny with feedback") {
					const feedback = await ctx.ui.input("Why? (feedback sent to agent):");
					if (feedback) reason = feedback;
				}

				return { block: true, reason };
			}
		}
	});

	// Filter out stale plan mode context when not in plan mode
	pi.on("context", async (event) => {
		if (planModeEnabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan/execution context before agent starts
	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

IMPORTANT: Do NOT attempt to use edit or write tools while plan mode is active. They are disabled. If you believe a file change is needed, tell the user and ask them to exit plan mode first (via /plan or Alt+P).

Available Tools:
- read, bash, grep, find, ls, questionnaire (always allowed)

Safe Bash Commands (always allowed):
cat, cd, rg, fd, grep, head, tail, ls, find, git status/log/diff/branch, npm list

Other bash commands will prompt for permission.

Ask clarifying questions using the questionnaire tool.
Use web research when needed to inform the plan.

Create a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT execute the plan. Only plan and analyze. When you are ready to execute, ask the user to exit plan mode.`,
					display: false,
				},
			};
		}
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();

		// Restore persisted state
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: { enabled: boolean } } | undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
		}

		if (planModeEnabled) {
			pi.setActiveTools(PLAN_MODE_TOOLS);
		}
		updateStatus(ctx);
	});
}