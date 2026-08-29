/**
 * Role → model binding resolution + display helpers.
 * A configured `cfg.roles[role]` captures an explicit model (and optional thinking)
 * that overrides the hardcoded pattern-based role presets in `roles.ts`.
 */
import { DEFAULT_ROLES, resolveRole } from "./roles";
import type { RoleModelConfig, RoleThinking } from "./config";

/** A role's `enabled` flag, defaulting to true. */
export function isRoleEnabled(roleName: string, roles: Record<string, RoleModelConfig>): boolean {
	return roles[roleName]?.enabled ?? true;
}

/** Role names that are enabled, in canonical order. */
export function enabledRoleNames(roles: Record<string, RoleModelConfig>): string[] {
	return BINDABLE_ROLES.filter((r) => isRoleEnabled(r, roles));
}

/** The built-in role names that can be bound to a model. */
export const BINDABLE_ROLES = ["smol", "slow", "plan", "vision", "task", "commit", "default"] as const;
export type BindableRole = (typeof BINDABLE_ROLES)[number];

/** An available model as surfaced to the settings editor. */
export interface AvailableModel {
	provider: string;
	id: string;
	name?: string;
}

/** Resolve the model a role should use: explicit binding first, else pattern match. */
export function resolveRoleModel(
	roleName: string,
	available: AvailableModel[],
	roles: Record<string, RoleModelConfig>,
): AvailableModel | undefined {
	const binding = roles[roleName];
	// An explicit binding is authoritative: if the pinned model is unavailable,
	// do NOT silently fall back to a different pattern match — report no match.
	if (binding?.model) {
		const q = binding.model.toLowerCase();
		return available.find((m) =>
			q.includes("/") ? `${m.provider}/${m.id}`.toLowerCase() === q : m.id.toLowerCase() === q,
		);
	}
	const resolved = resolveRole(
		roleName,
		available.map((m) => ({ provider: m.provider, id: m.id, reasoning: true })),
		DEFAULT_ROLES,
	);
	if (!resolved) return undefined;
	return available.find((m) => m.provider === resolved.model.provider && m.id === resolved.model.id);
}

/** Effective thinking level for a role: explicit binding, else the role's default. */
export function roleThinkingOf(
	roleName: string,
	roles: Record<string, RoleModelConfig>,
): RoleThinking | undefined {
	const binding = roles[roleName];
	if (binding?.thinking) return binding.thinking;
	return DEFAULT_ROLES[roleName]?.thinking;
}

/** The role's effective `{ model, thinking }` for `/role` application. */
export function roleBindingOf(
	roleName: string,
	roles: Record<string, RoleModelConfig>,
): { model?: string; thinking?: RoleThinking; auto: boolean } {
	const binding = roles[roleName];
	return {
		model: binding?.model,
		thinking: roleThinkingOf(roleName, roles),
		auto: !binding?.model,
	};
}

/** Human label for a model selector line. */
export function modelLabel(m: AvailableModel): string {
	const name = m.name && m.name.trim() ? ` (${m.name.trim()})` : "";
	return `${m.provider}/${m.id}${name}`;
}
