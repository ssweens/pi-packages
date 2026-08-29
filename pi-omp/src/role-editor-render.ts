/**
 * Rendering for the `/omp` role-selector stages: a role list (each role shows its
 * captured model + thinking) and a model picker (auto + available models). Pure and
 * theme-agnostic, mirroring `settings-render.ts`.
 */
import { visibleWidth } from "@mariozechner/pi-tui";
import type { RoleModelConfig, RoleThinking } from "./config";
import {
	BINDABLE_ROLES,
	isRoleEnabled,
	roleBindingOf,
	roleThinkingOf,
	modelLabel,
	type AvailableModel,
} from "./roles-config";
import type { SettingsStyler } from "./settings-render";

const THINKING_ORDER: (RoleThinking | undefined)[] = [undefined, "low", "medium", "high", "xhigh"];

/** Cycle a role's explicit thinking level; `undefined` = auto (role default). */
export function cycleThinking(current?: RoleThinking): RoleThinking | undefined {
	const idx = THINKING_ORDER.indexOf(current);
	return THINKING_ORDER[(idx + 1) % THINKING_ORDER.length];
}

/** Other roles that carry a thinking default, used for display only. */
const ROLE_THINKING_DEFAULT: Record<string, RoleThinking | undefined> = {
	smol: "low",
	slow: "high",
	plan: "high",
	vision: "low",
	commit: "low",
	task: "medium",
};

const selector = (m: AvailableModel): string => `${m.provider}/${m.id}`;
const haystack = (m: AvailableModel): string => `${selector(m)} ${m.name ?? ""}`.toLowerCase();

/** Case-insensitive subsequence match (fuzzy), like the stock pi selector. */
function fuzzyMatches(query: string, text: string): boolean {
	const q = [...query];
	let idx = 0;
	for (const ch of text) {
		if (idx < q.length && ch === q[idx]) idx++;
	}
	return idx === q.length;
}

/**
 * The models shown for a role, in display order: the currently-bound model leads,
 * then the rest — substring matches before pure subsequence matches when searching.
 */
export function orderedModels(
	models: AvailableModel[],
	currentKey: string | undefined,
	query: string,
): AvailableModel[] {
	const q = query.trim().toLowerCase();
	const cur = currentKey ? models.find((m) => selector(m) === currentKey || m.id === currentKey) : undefined;
	const others = models.filter((m) => m !== cur);
	if (!q) return cur ? [cur, ...others] : models;

	const sub = others.filter((m) => haystack(m).includes(q));
	const fuzzy = others.filter((m) => !haystack(m).includes(q) && fuzzyMatches(q, haystack(m)));
	const list = [...sub, ...fuzzy];
	return cur ? [cur, ...list] : list;
}

/**
 * The model at a picker row. Row 0 is "auto" (no model). Rows ≥1 index the
 * ORDERED list — never the raw array, or a typed query shifts the mapping.
 */
export function modelAtRow(ordered: AvailableModel[], row: number): AvailableModel | undefined {
	if (row <= 0) return undefined;
	return ordered[row - 1];
}

/** Number of picker rows (auto + ordered models). */
export function pickerRowCount(ordered: AvailableModel[]): number {
	return ordered.length + 1;
}

function clip(s: string, width: number): string {
	if (width <= 0) return "";
	const w = visibleWidth(s);
	if (w <= width) return s;
	const out: string[] = [];
	for (const ch of [...s]) {
		if (visibleWidth(out.join("") + ch) > width - 1) break;
		out.push(ch);
	}
	return out.join("") + "…";
}

/** Rows for the role selector. */
export interface RoleRow {
	role: string;
	binding: string;
	thinking?: RoleThinking;
	auto: boolean;
	enabled: boolean;
}

function autoLabel(role: string): string {
	return `auto · ${role}`;
}

/** Build the role rows in the editor (role name + current binding summary). */
export function buildRoleRows(roles: Record<string, RoleModelConfig>): RoleRow[] {
	return BINDABLE_ROLES.map((role) => {
		const b = roleBindingOf(role, roles);
		return {
			role,
			binding: b.auto ? autoLabel(role) : b.model ?? autoLabel(role),
			thinking: b.thinking,
			auto: b.auto,
			enabled: isRoleEnabled(role, roles),
		};
	});
}

/** Render the role-selector stage. `←/→/space` cycles thinking of the focused role. */
export function renderRoleSelector(
	roles: Record<string, RoleModelConfig>,
	cursor: number,
	theme: SettingsStyler,
	width: number,
): { lines: string[]; rowStart: number[] } {
	const header =
		theme.fg("toolTitle", theme.bold("model roles")) + theme.fg("dim", " — bind a model to each role (enter to assign)");
	const hint = theme.fg("dim", "↑/↓ select · space on/off · ←/→ thinking · enter edit model · esc back");
	const rule = theme.fg("dim", "─".repeat(Math.max(0, width)));

	const lines: string[] = [header, "", hint, "", rule, ""];
	const rowStart: number[] = [];
	const rows = buildRoleRows(roles);

	rows.forEach((row, i) => {
		const selected = i === cursor;
		const cursorMark = selected ? theme.fg("accent", "› ") : "  ";
		const namePart = selected ? theme.fg("accent", theme.bold(row.role.padEnd(9, " "))) : theme.fg(row.enabled ? "text" : "dim", row.role.padEnd(9, " "));
		const stateMark = row.enabled ? theme.fg("success", "on ") : theme.fg("dim", "off");
		const label = row.enabled ? (selected ? theme.fg("text", row.binding) : theme.fg("dim", row.binding)) : theme.fg("dim", row.binding);
		const think = row.thinking ? theme.fg("accent", theme.bold(`  ·  ${row.thinking}`)) : "";
		rowStart.push(lines.length);
		lines.push(`${cursorMark}${namePart} ${stateMark} ${label}${think}`);
	});

	lines.push("", rule);
	return { lines, rowStart };
}

/** Render the model-picker stage for one role, with fuzzy type-to-search. */
export function renderModelPicker(
	models: AvailableModel[],
	roles: Record<string, RoleModelConfig>,
	roleName: string,
	cursor: number,
	query: string,
	theme: SettingsStyler,
	width: number,
): { lines: string[]; rowStart: number[] } {
	const current = roleBindingOf(roleName, roles).model;
	const ordered = orderedModels(models, current, query);
	const explicit = roles[roleName]?.thinking;
	const effective = roleThinkingOf(roleName, roles);
	const header =
		theme.fg("toolTitle", theme.bold(`model · @${roleName}`)) +
		theme.fg("dim", current ? `  currently ${current}` : "  auto (pattern match)");
	const countInfo = query.trim() ? theme.fg("dim", ordered.length === 0 ? "" : `  ·  ${ordered.length} match${ordered.length === 1 ? "" : "es"}`) : "";
	const searchLine = theme.fg("accent", `⌕ `) + (query ? theme.fg("text", `${query}▌`) : theme.fg("dim", "type to search…")) + countInfo;
	const thinkingValue = explicit ? theme.fg("accent", theme.bold(explicit)) : theme.fg("dim", "auto");
	const thinkingNote = explicit ? "  (pinned)" : effective ? `  (role default: ${ROLE_THINKING_DEFAULT[roleName] ?? effective})` : "  (no default)";
	const thinkingLine = `  thinking  ${thinkingValue}` + theme.fg("dim", thinkingNote);
	const hint = theme.fg("dim", "↑/↓ pick · type to filter · ←/→/space thinking · enter assign · esc back");
	const rule = theme.fg("dim", "─".repeat(Math.max(0, width)));

	const labelW = Math.max(0, width - 4);
	const lines: string[] = [header, searchLine, thinkingLine, hint, "", rule, ""];
	const rowStart: number[] = [];

	// Row 0 = auto (clear explicit binding).
	const autoSelected = current === undefined;
	rowStart.push(lines.length);
	lines.push(
		(cursor === 0 ? theme.fg("accent", "› ") : "  ") +
			(autoSelected ? theme.fg("success", "● auto") : "  auto") +
			theme.fg("dim", "  (pattern match)"),
	);

	if (ordered.length === 0 && query.trim()) {
		rowStart.push(lines.length);
		lines.push("  " + theme.fg("dim", `no models match “${query.trim()}”`));
	}
	ordered.forEach((m, i) => {
		const rowIdx = i + 1;
		const label = modelLabel(m);
		const isCurrent = current !== undefined && (selector(m) === current || m.id === current);
		const prefix = cursor === rowIdx ? theme.fg("accent", "› ") : "  ";
		const mark = isCurrent ? theme.fg("success", "● ") : "  ";
		const namePart = clip(label, labelW);
		rowStart.push(lines.length);
		lines.push(`${prefix}${mark}${isCurrent ? theme.fg("text", namePart) : theme.fg("dim", namePart)}`);
	});
	lines.push("", rule);
	return { lines, rowStart };
}
