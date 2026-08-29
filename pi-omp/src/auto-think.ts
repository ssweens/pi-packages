/**
 * Auto-thinking pure logic: parse a classifier label, then clamp it against a
 * model's supported thinking ladder. Port of omp's `thinking.ts` clamping and
 * `auto-thinking/classifier.ts` label mapping.
 */

export type ThinkLevel = "minimal" | "low" | "medium" | "high" | "xhigh";

/** Ascending ladder of pi thinking levels. */
export const LEVEL_ORDER: readonly ThinkLevel[] = ["minimal", "low", "medium", "high", "xhigh"];

const ONLINE_LABELS: Partial<Record<string, ThinkLevel>> = {
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "xhigh",
};

const LOCAL_LABELS: Partial<Record<string, ThinkLevel>> = {
	trivial: "low",
	moderate: "high",
	hard: "xhigh",
};

/** Map a raw classifier label to a requested level (online or local vocabulary). */
export function mapLabel(raw: string, local: boolean): ThinkLevel | undefined {
	const normalized = raw.trim().toLowerCase();
	return (local ? LOCAL_LABELS : ONLINE_LABELS)[normalized];
}

/**
 * Clamp a requested level to the highest supported level <= request.
 * Returns undefined when the model supports no applicable level.
 */
export function clampToLadder(
	requested: ThinkLevel | undefined,
	supported: readonly ThinkLevel[],
): ThinkLevel | undefined {
	if (!requested) return undefined;
	const supportedSet = new Set(supported);
	for (let i = LEVEL_ORDER.indexOf(requested); i >= 0; i--) {
		const level = LEVEL_ORDER[i]!;
		if (supportedSet.has(level)) return level;
	}
	return undefined;
}

/** Full pipeline: label -> requested -> clamped. */
export function resolveThinking(
	rawLabel: string,
	local: boolean,
	supported: readonly ThinkLevel[],
): ThinkLevel | undefined {
	return clampToLadder(mapLabel(rawLabel, local), supported);
}
