import { Key } from "@mariozechner/pi-tui";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { PiOmpConfig } from "../src/config";
import {
	enabledRoleNames,
	isRoleEnabled,
	resolveRoleModel,
	roleThinkingOf,
	type AvailableModel,
} from "../src/roles-config";

export function installRoles(pi: ExtensionAPI, cfg: PiOmpConfig): void {
	async function applyRole(ctx: ExtensionCommandContext, roleName: string): Promise<void> {
		if (!isRoleEnabled(roleName, cfg.roles)) {
			ctx.ui.notify(`@${roleName} is disabled — enable it in /omp`, "warning");
			return;
		}
		const models = ctx.modelRegistry.getAvailable();
		if (models.length === 0) {
			ctx.ui.notify("No models available to assign a role.", "error");
			return;
		}
		const available: AvailableModel[] = models.map((m) => ({
			provider: m.provider,
			id: m.id,
			name: m.name,
		}));
		const resolved = resolveRoleModel(roleName, available, cfg.roles);
		if (!resolved) {
			ctx.ui.notify(`No model matched role @${roleName}.`, "error");
			return;
		}
		const model = models.find((m) => m.provider === resolved.provider && m.id === resolved.id);
		if (!model) return;
		const ok = await pi.setModel(model);
		if (!ok) {
			ctx.ui.notify(`@${roleName} → ${model.name} failed (no API key?).`, "error");
			return;
		}
		const thinking = roleThinkingOf(roleName, cfg.roles);
		if (thinking) pi.setThinkingLevel(thinking);
		ctx.ui.notify(`@${roleName} → ${model.name}`, "info");
	}

	pi.registerCommand("role", {
		description: `Apply a model role preset: ${enabledRoleNames(cfg.roles).map((n) => `@${n}`).join(", ")}`,
		handler: async (args, ctx) => {
			let role = args.trim().replace(/^@/, "");
			if (!role || !enabledRoleNames(cfg.roles).includes(role)) {
				if (!ctx.hasUI) {
					ctx.ui.notify("No role given", "warning");
					return;
				}
				const picked = await ctx.ui.select("Model role:", enabledRoleNames(cfg.roles));
				if (!picked) return;
				role = picked;
			}
			await applyRole(ctx, role);
		},
	});

	pi.registerShortcut(Key.ctrlShift("r"), {
		description: "Cycle pi-omp model role",
		handler: (ctx) => {
			if (!ctx.hasUI) return;
			void (async () => {
				const current = ctx.model;
				if (!current) return;
				const available: AvailableModel[] = ctx.modelRegistry.getAvailable().map((m) => ({
					provider: m.provider,
					id: m.id,
					name: m.name,
				}));
				for (const name of enabledRoleNames(cfg.roles)) {
					const resolved = resolveRoleModel(name, available, cfg.roles);
					if (
						resolved &&
						`${resolved.provider}/${resolved.id}` !== `${current.provider}/${current.id}`
					) {
						await applyRole(ctx as ExtensionCommandContext, name);
						return;
					}
				}
			})();
		},
	});
}
