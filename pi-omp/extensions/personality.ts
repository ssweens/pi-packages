import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PiOmpConfig, PersonaName } from "../src/config";
import { PERSONAS } from "../src/prompts";
import { loadConfig, saveConfig } from "../src/config";

export function installPersona(pi: ExtensionAPI, cfg: PiOmpConfig): void {
	let active: PersonaName = cfg.persona in PERSONAS ? (cfg.persona as PersonaName) : "default";

	pi.on("before_agent_start", (event) => {
		const text = PERSONAS[active];
		if (!text) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${text}` };
	});

	pi.registerCommand("personality", {
		description: "Switch pi-omp persona (default / friendly / pragmatic)",
		handler: async (args, ctx) => {
			const names = Object.keys(PERSONAS);
			let choice = args.trim();
			if (!names.includes(choice)) {
				if (!ctx.hasUI) {
					ctx.ui.notify("No persona given", "warning");
					return;
				}
				const picked = await ctx.ui.select("Persona:", names);
				if (!picked) return;
				choice = picked;
			}
			const next = choice as PersonaName;
			active = next;
			const config = await loadConfig(ctx.cwd);
			config.persona = next;
			const target = await saveConfig(ctx.cwd, config);
			ctx.ui.notify(`Persona → ${next} (saved to ${target})`, "info");
		},
	});
}
