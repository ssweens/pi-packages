import { completeSimple } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PiOmpConfig } from "../src/config";
import { resolveThinking, LEVEL_ORDER, type ThinkLevel } from "../src/auto-think";
import { DEFAULT_ROLES, resolveRole } from "../src/roles";
import { AUTO_THINKING_CLASSIFIER, AUTO_THINKING_CLASSIFIER_LOCAL } from "../src/prompts";

/** Levels the model supports (absent thinkingLevelMap keys are supported by default; null = unsupported). */
export function supportedLevels(model: { reasoning: boolean; thinkingLevelMap?: Record<string, string | null> }): ThinkLevel[] {
	if (!model.reasoning) return [];
	const map = model.thinkingLevelMap;
	return LEVEL_ORDER.filter((l) => map?.[l] !== null);
}

function resolveClassifierModel(
	ctx: ExtensionContext,
	cfg: PiOmpConfig,
): ReturnType<ExtensionContext["modelRegistry"]["getAvailable"]>[number] | undefined {
	const want = cfg.autoThinking.classifierModel;
	const available = ctx.modelRegistry.getAvailable();
	if (want.startsWith("@")) {
		const r = resolveRole(
			want.slice(1),
			available.map((m) => ({ provider: m.provider, id: m.id, reasoning: m.reasoning })),
			DEFAULT_ROLES,
		);
		return r ? available.find((m) => m.provider === r.model.provider && m.id === r.model.id) : undefined;
	}
	const slash = want.indexOf("/");
	if (slash !== -1) {
		const prov = want.slice(0, slash);
		const id = want.slice(slash + 1);
		return (
			available.find((m) => m.provider === prov && m.id === id) ??
			available.find((m) => m.id === want)
		);
	}
	return available.find((m) => m.id === want);
}

async function classify(prompt: string, ctx: ExtensionContext, cfg: PiOmpConfig): Promise<string | undefined> {
	const model = resolveClassifierModel(ctx, cfg);
	if (!model) {
		// No dedicated classifier; bail so the primary model isn't charged for it.
		return undefined;
	}
	try {
		const system = cfg.autoThinking.localLabels ? AUTO_THINKING_CLASSIFIER_LOCAL : AUTO_THINKING_CLASSIFIER;
		const result = await completeSimple(model, {
			systemPrompt: system,
			messages: [
				{
					role: "user",
					content: prompt,
					timestamp: Date.now(),
				},
			],
		}, {
			timeoutMs: cfg.autoThinking.timeoutMs,
			signal: AbortSignal.timeout(cfg.autoThinking.timeoutMs),
			maxTokens: 32,
		});
		return result.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text.trim())
			.filter(Boolean)
			.join(" ")
			.split(/\s+/)[0];
	} catch {
		return undefined;
	}
}

export function installAutoThinking(pi: ExtensionAPI, cfg: PiOmpConfig): void {
	pi.on("before_agent_start", async (event, ctx) => {
		if (!ctx.model) return;
		const supported = supportedLevels(ctx.model);
		if (supported.length === 0) return;
		const label = await classify(event.prompt, ctx, cfg);
		if (!label) return; // keep prior level on failure
		const level = resolveThinking(label, cfg.autoThinking.localLabels, supported);
		if (level) pi.setThinkingLevel(level);
	});
}
