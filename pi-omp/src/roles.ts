/**
 * Model-role resolution. Port of omp's `priority.json` + `model-resolver`
 * concept (pure logic, no pi imports). A role maps to an ordered list of
 * model patterns; the first available model matching any pattern wins.
 */

export interface ModelLike {
	provider: string;
	id: string;
	reasoning: boolean;
}

export interface RoleSpec {
	/** Ordered model patterns. A pattern with `/` matches `provider/id`; without, matches id (with `*` globs). */
	patterns: string[];
	/** Suggested thinking level for the role. */
	thinking?: "low" | "medium" | "high" | "xhigh";
}

/** Curated defaults (override via config `roles`). */
export const DEFAULT_ROLES: Record<string, RoleSpec> = {
	smol: {
		patterns: ["groq/*", "cerebras/*", "xai/*", "openai/gpt-5.2-nano", "google/*flash*"],
		thinking: "low",
	},
	slow: {
		patterns: ["anthropic/*opus*", "openai/*", "google/*pro*"],
		thinking: "high",
	},
	plan: {
		patterns: ["anthropic/*", "openai/*"],
		thinking: "high",
	},
	vision: {
		patterns: ["google/*", "openrouter/*gemini*"],
		thinking: "low",
	},
	commit: {
		patterns: ["*flash*", "groq/*"],
		thinking: "low",
	},
	task: {
		patterns: ["anthropic/*", "openai/*"],
		thinking: "medium",
	},
	default: {
		patterns: ["*"],
		thinking: undefined,
	},
};

/** Convert a glob (only `*` supported) to a case-insensitive RegExp. */
export function globToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`, "i");
}

/** Whether a model matches a single pattern. */
export function matchPattern(pattern: string, model: ModelLike): boolean {
	const target = pattern.includes("/") ? `${model.provider}/${model.id}` : model.id;
	return globToRegExp(pattern).test(target);
}

/** Return the first pattern that matches an available model, and the model. */
export function resolveRole(
	roleName: string,
	available: ModelLike[],
	roles: Record<string, RoleSpec> = DEFAULT_ROLES,
): { pattern: string; model: ModelLike; spec: RoleSpec } | undefined {
	const spec = roles[roleName];
	if (!spec) return undefined;
	for (const pattern of spec.patterns) {
		// "#" pattern no longer used; a bare role name can reference another role's patterns later.
		for (const model of available) {
			if (matchPattern(pattern, model)) {
				return { pattern, model, spec };
			}
		}
	}
	return undefined;
}

/** List role names sorted for display. */
export function roleNames(roles: Record<string, RoleSpec> = DEFAULT_ROLES): string[] {
	return Object.keys(roles);
}
