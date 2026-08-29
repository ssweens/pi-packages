import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PiOmpConfig } from "../src/config";

const WRITE_TOOLS = new Set(["write", "edit", "bash", "code", "apply_patch"]);

/**
 * Optionally offer to capture a lesson as a managed skill after a heavily
 * mutating turn (ported from omp's autolearn gate). Cooldown-gated to avoid
 * nagging.
 */
export function installAutoLearn(pi: ExtensionAPI, cfg: PiOmpConfig): void {
	const cooldownTurns = 8;
	let lastOfferTurn = -cooldownTurns;

	pi.on("agent_end", (event) => {
		const mutations = event.messages.filter(
			(m) =>
				"role" in m &&
				m.role === "toolResult" &&
				"toolName" in m &&
				typeof m.toolName === "string" &&
				WRITE_TOOLS.has(m.toolName),
		).length;

		if (mutations < cfg.autoLearn.minToolActivity) return;
		if (event.messages.length - lastOfferTurn < cooldownTurns) return;
		lastOfferTurn = event.messages.length;

		pi.sendUserMessage(
			"This turn made several tool edits. If a reusable pattern emerged, tell me and I'll capture it as a managed skill under the pi-omp learned-skills dir. Otherwise ignore this.",
			{ deliverAs: "followUp" },
		);
	});
}
