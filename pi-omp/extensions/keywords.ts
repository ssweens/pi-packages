import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PiOmpConfig } from "../src/config";
import { containsProseKeyword } from "../src/keywords";
import { ULTRATHINK_NOTICE } from "../src/prompts";

const KEYWORDS: Record<string, string> = {
	ultrathink: ULTRATHINK_NOTICE,
};

export function installKeywords(pi: ExtensionAPI, _cfg: PiOmpConfig): void {
	let pending: string[] = [];

	pi.on("input", (event) => {
		for (const kw of Object.keys(KEYWORDS)) {
			if (containsProseKeyword(event.text, kw) && !pending.includes(kw)) {
				pending.push(kw);
			}
		}
		return { action: "continue" };
	});

	pi.on("before_agent_start", (event) => {
		if (pending.length === 0) return;
		const notices = pending.map((k) => KEYWORDS[k]).filter(Boolean);
		pending = [];
		if (notices.length === 0) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${notices.join("\n\n")}` };
	});
}
