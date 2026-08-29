import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PiOmpConfig } from "../src/config";
import { ENGINEERING_POLICY } from "../src/prompts";

export function installEngineering(pi: ExtensionAPI, _cfg: PiOmpConfig): void {
	pi.on("before_agent_start", (event) => {
		// Port the tool policy that references pi's real tools (bash/read/edit/grep/glob).
		return { systemPrompt: `${event.systemPrompt}\n\n${ENGINEERING_POLICY}` };
	});
}
