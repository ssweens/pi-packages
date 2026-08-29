import { Key, matchesKey } from "@mariozechner/pi-tui";
import type { Component } from "@mariozechner/pi-tui";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { type PersonaName, type PiOmpConfig, type RoleModelConfig } from "../src/config";
import { loadConfig, saveConfig } from "../src/config";
import {
	buildRows,
	renderSettingsLines,
	type SettingsStyler,
} from "../src/settings-render";
import {
	buildRoleRows,
	cycleThinking,
	modelAtRow,
	orderedModels,
	pickerRowCount,
	renderModelPicker,
	renderRoleSelector,
} from "../src/role-editor-render";
import { BINDABLE_ROLES, isRoleEnabled, type AvailableModel } from "../src/roles-config";

const PERSONAS: PersonaName[] = ["default", "friendly", "pragmatic"];
/** Max panel rows shown; scrolls when descriptions push it taller. */
const VIEWPORT = 16;

export interface SettingsResult {
	saved: boolean;
	features: PiOmpConfig["features"];
	persona: PersonaName;
	roles: Record<string, RoleModelConfig>;
}

type Stage = "features" | "roles" | "model";

/** True for a single typed printable character (letters, digits, space, …). */
function isPrintable(data: string): boolean {
	if (data.length !== 1) return false;
	const c = data.charCodeAt(0);
	return c >= 0x20 && c !== 0x7f;
}

class SettingsComponent implements Component {
	private stage: Stage = "features";
	private cursor = 0;
	private scroll = 0;
	private readonly features: PiOmpConfig["features"];
	private persona: PersonaName;
	private roles: Record<string, RoleModelConfig>;
	private activeRole = "smol";
	private query = "";
	private lines: string[] = [];
	private rowStart: number[] = [];

	constructor(
		private readonly done: (r: SettingsResult) => void,
		private readonly theme: SettingsStyler,
		private readonly models: AvailableModel[],
		cfg: PiOmpConfig,
	) {
		this.features = { ...cfg.features };
		this.persona = cfg.persona;
		this.roles = Object.fromEntries(BINDABLE_ROLES.map((r) => [r, { ...(cfg.roles[r] ?? {}) }]));
	}

	private currentModelKey(): string | undefined {
		return this.roles[this.activeRole]?.model;
	}

	private orderedModelList(): AvailableModel[] {
		return orderedModels(this.models, this.currentModelKey(), this.query);
	}

	private rowCount(): number {
		switch (this.stage) {
			case "features":
				return buildRows().length;
			case "roles":
				return buildRoleRows(this.roles).length;
			case "model":
				return pickerRowCount(this.orderedModelList());
		}
	}

	private rebuild(width: number): void {
		if (this.stage === "features") {
			const rendered = renderSettingsLines(
				{ persona: this.persona, features: this.features },
				buildRows(),
				this.cursor,
				this.theme,
				width,
			);
			this.lines = rendered.lines;
			this.rowStart = rendered.rowStart;
		} else if (this.stage === "roles") {
			const rendered = renderRoleSelector(this.roles, this.cursor, this.theme, width);
			this.lines = rendered.lines;
			this.rowStart = rendered.rowStart;
		} else {
			const rendered = renderModelPicker(
				this.models,
				this.roles,
				this.activeRole,
				this.cursor,
				this.query,
				this.theme,
				width,
			);
			this.lines = rendered.lines;
			this.rowStart = rendered.rowStart;
		}
	}

	private cursorEndLine(): number {
		const start = this.rowStart[this.cursor];
		if (start === undefined) return 0;
		const next = this.rowStart[this.cursor + 1];
		return next !== undefined ? next - 1 : this.lines.length - 1;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			if (this.stage === "features") {
				// Save on close: editing is write-through to the returned config, so any exit
				// that lands on the features screen persists (this is the user-visible contract).
				this.done({ saved: true, features: this.features, persona: this.persona, roles: this.roles });
			} else if (this.stage === "roles") {
				this.stage = "features";
				this.cursor = 0;
				this.scroll = 0;
			} else {
				this.stage = "roles";
				this.query = "";
				this.cursor = BINDABLE_ROLES.indexOf(this.activeRole as (typeof BINDABLE_ROLES)[number]);
				this.scroll = 0;
			}
			return;
		}
		// Type-to-search in the model picker: backspace edits the query; printable
		// chars append; both reset the cursor to the top row.
		if (this.stage === "model") {
			if (matchesKey(data, Key.backspace)) {
				this.query = this.query.slice(0, -1);
				this.cursor = 0;
				this.scroll = 0;
				return;
			}
			if (isPrintable(data)) {
				this.query += data;
				this.cursor = 0;
				this.scroll = 0;
				return;
			}
		}
		if (this.stage === "model") {
			if (matchesKey(data, Key.left) || matchesKey(data, Key.right) || matchesKey(data, Key.space)) {
				this.cycleModelThinking();
				return;
			}
		}
		if (this.stage === "roles") {
			const role = BINDABLE_ROLES[this.cursor];
			if (!role) {
				// no-op
			} else if (matchesKey(data, Key.space)) {
				this.toggleRoleEnabled(role);
				return;
			} else if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
				this.cycleRoleThinking(role);
				return;
			}
		}
		if (matchesKey(data, Key.up)) {
			this.cursor = (this.cursor - 1 + this.rowCount()) % this.rowCount();
		} else if (matchesKey(data, Key.down)) {
			this.cursor = (this.cursor + 1) % this.rowCount();
		} else if (matchesKey(data, Key.return) || matchesKey(data, Key.enter) || matchesKey(data, Key.right)) {
			this.enter();
		} else if (matchesKey(data, Key.space) || matchesKey(data, Key.left)) {
			this.toggle();
		}
	}

	private enter(): void {
		if (this.stage === "features") {
			const row = buildRows()[this.cursor];
			if (row?.kind === "roles") {
				this.stage = "roles";
				this.cursor = 0;
				this.scroll = 0;
			} else if (row?.kind === "persona") {
				const idx = PERSONAS.indexOf(this.persona);
				this.persona = PERSONAS[(idx + 1) % PERSONAS.length]!;
			} else {
				// Done: save.
				this.done({ saved: true, features: this.features, persona: this.persona, roles: this.roles });
			}
		} else if (this.stage === "roles") {
			const role = BINDABLE_ROLES[this.cursor];
			if (!role) return;
			this.activeRole = role;
			this.stage = "model";
			this.query = "";
			this.cursor = 0;
			this.scroll = 0;
		} else {
			// model picker: row 0 = auto, else bind to the selected model.
			const role = this.activeRole;
			const existing = this.roles[role] ?? {};
			if (this.cursor === 0) {
				// auto → clear explicit model.
				const next: RoleModelConfig = {};
				if (existing.thinking) next.thinking = existing.thinking;
				if (existing.model) this.roles[role] = next;
				else delete this.roles[role];
			} else {
			const ordered = this.orderedModelList();
			const m = modelAtRow(ordered, this.cursor);
			if (m) this.roles[role] = { ...existing, model: `${m.provider}/${m.id}` };
		}
			this.stage = "roles";
			this.cursor = BINDABLE_ROLES.indexOf(role as (typeof BINDABLE_ROLES)[number]);
			this.scroll = 0;
		}
	}

	private toggleRoleEnabled(role: string): void {
		const existing = this.roles[role] ?? {};
		const enabled = !isRoleEnabled(role, this.roles);
		if (!enabled && !existing.model && !existing.thinking) {
			delete this.roles[role];
			return;
		}
		this.roles[role] = { ...existing, enabled };
	}

	private cycleModelThinking(): void {
		this.cycleRoleThinking(this.activeRole);
	}

	private cycleRoleThinking(role: string): void {
		const existing = this.roles[role] ?? {};
		const next = cycleThinking(existing?.thinking);
		if (next) {
			this.roles[role] = { ...existing, thinking: next };
		} else {
			// back to auto → drop thinking (keep model, if any).
			const c: RoleModelConfig = {};
			if (existing.model) c.model = existing.model;
			if (Object.keys(c).length > 0) this.roles[role] = c;
			else delete this.roles[role];
		}
	}

	private toggle(): void {
		if (this.stage !== "features") return;
		const row = buildRows()[this.cursor];
		if (!row) return;
		if (row.kind === "roles") {
			this.stage = "roles";
			this.cursor = 0;
			this.scroll = 0;
		} else if (row.kind === "persona") {
			const idx = PERSONAS.indexOf(this.persona);
			this.persona = PERSONAS[(idx + 1) % PERSONAS.length]!;
		} else if (row.key) {
			this.features[row.key] = !this.features[row.key]!;
		}
	}

	render(width: number): string[] {
		this.rebuild(width);
		const curLine = this.rowStart[this.cursor] ?? 0;
		const curEnd = this.cursorEndLine();
		if (curLine < this.scroll) this.scroll = curLine;
		if (curEnd >= this.scroll + VIEWPORT) this.scroll = curEnd - VIEWPORT + 1;
		this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.lines.length - VIEWPORT)));
		return this.lines.slice(this.scroll, this.scroll + VIEWPORT);
	}

	invalidate(): void {
		// No long-lived cache; rendering is stateless.
	}
}

export function installSettings(pi: ExtensionAPI): void {
	pi.registerCommand("omp", {
		description: "Open the pi-omp settings view (toggle features, bind model roles)",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("pi-omp settings require interactive mode.", "warning");
				return;
			}
			const cfg = await loadConfig(ctx.cwd);
			const models: AvailableModel[] = ctx.modelRegistry.getAvailable().map((m) => ({
				provider: m.provider,
				id: m.id,
				name: m.name,
			}));
			const result = await ctx.ui.custom<SettingsResult>(
				(_tui, theme, _kb, done) => new SettingsComponent(done, theme, models, cfg),
				{
					overlay: true,
					overlayOptions: {
						anchor: "bottom-left",
						width: "97%",
						margin: { left: 1, right: 1, bottom: 1 },
					},
					onHandle: (handle) => handle.focus(),
				},
			);
			if (!result?.saved) {
				ctx.ui.notify("pi-omp settings — no changes applied.", "info");
				return;
			}
			const next = await loadConfig(ctx.cwd);
			next.features = { ...result.features };
			next.persona = result.persona;
			// Defensive: if result.roles is absent (older/other build), keep current roles.
			if (result.roles) next.roles = { ...result.roles };
			else if (!next.roles) next.roles = {};
			const target = await saveConfig(ctx.cwd, next);
			ctx.ui.notify(`pi-omp settings saved to ${target}. Reloading…`, "info");
			await ctx.reload();
		},
	});
}
