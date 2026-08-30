import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig, isFeatureEnabled, type PiOmpConfig } from "../src/config";
import { installPersona } from "./personality";
import { installEngineering } from "./engineering";
import { installKeywords } from "./keywords";
import { installRoles } from "./roles";
import { installTodo, todoReminderText } from "./todo";
import { installAutoThinking } from "./autothinking";
import { installAutoLearn } from "./autolearn";
import { installCommit } from "./commit";
import { installSettings } from "./settings";

export default async function (pi: ExtensionAPI): Promise<void> {
	const config = await loadConfig(process.cwd());
	wire(pi, config);
}

/**
 * Pulled out so it can be re-run after a settings save without re-reading the
 * factory (kept simple: index re-loads config on the next process/reload).
 */
export function wire(pi: ExtensionAPI, cfg: PiOmpConfig): void {
	if (isFeatureEnabled(cfg, "persona")) installPersona(pi, cfg);
	if (isFeatureEnabled(cfg, "engineering")) installEngineering(pi, cfg);
	if (isFeatureEnabled(cfg, "keywords")) installKeywords(pi, cfg);
	if (isFeatureEnabled(cfg, "roles")) installRoles(pi, cfg);
	if (isFeatureEnabled(cfg, "todo")) {
		installTodo(pi, cfg);
		wireTodoReminder(pi, cfg);
	}
	if (isFeatureEnabled(cfg, "autoThinking")) installAutoThinking(pi, cfg);
	if (isFeatureEnabled(cfg, "autoLearn")) installAutoLearn(pi, cfg);
	if (isFeatureEnabled(cfg, "commit")) installCommit(pi, cfg);
	installSettings(pi); // settings view is always available so features can be re-enabled
}

/** Bounded, non-spammy incomplete-todo reminder. */
function wireTodoReminder(pi: ExtensionAPI, cfg: PiOmpConfig): void {
	let remindersSent = 0;

	pi.on("agent_end", (event, ctx) => {
		if (!cfg.todo.reminders || remindersSent >= cfg.todo.maxReminders) return;
		// A deliberate abort (Escape) settles the turn — don't auto-restart it with a
		// reminder. Mirrors omp's agent-session, which returns early on
		// `stopReason === "aborted"` before its todo checkCompletion ever runs.
		const lastAssistant = [...event.messages].reverse().find(
			(m) => "role" in m && m.role === "assistant",
		);
		if (lastAssistant && "stopReason" in lastAssistant && lastAssistant.stopReason === "aborted") {
			return;
		}
		// Final assistant message: if it's a question, wait — the model wants input.
		if (lastAssistant && "content" in lastAssistant) {
			const pieces = (lastAssistant.content as Array<{ type: string; text?: string }>).filter(
				(c) => c.type === "text" && c.text,
			);
			const text = pieces.map((c) => c.text ?? "").join(" ");
			if (text.trim().endsWith("?")) return;
		}
		const text = todoReminderText(ctx.sessionManager);
		if (!text) return;
		remindersSent += 1;
		pi.sendUserMessage(text, { deliverAs: "followUp" });
	});
}
