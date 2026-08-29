/**
 * Colored todo-panel rendering for the `todo` tool result and the `/todo` widget.
 * Faithful to omp's todo panel: a header status line, roman-numeraled phase
 * headers, checkbox glyphs, and per-status colors (done = strike + success,
 * in-progress = accent, blocked = warning, abandoned = error, pending = dim).
 *
 * Pure and theme-agnostic: takes a minimal {@link TodoStyler} so it is unit-
 * testable with a stub; the real pi `Theme` satisfies it structurally.
 */
import { visibleWidth } from "@mariozechner/pi-tui";
import type { TodoState, TodoItem } from "./todo";

/** Subset of pi's ThemeColor used by the todo panel. */
export type TodoColor =
	| "accent"
	| "success"
	| "error"
	| "warning"
	| "dim"
	| "muted"
	| "text"
	| "borderMuted"
	| "toolTitle";

/** Minimal theming surface the panel needs. pi's Theme implements this. */
export interface TodoStyler {
	fg(color: TodoColor, text: string): string;
	bold(text: string): string;
	strikethrough(text: string): string;
}

export const CHECKED = "☑";
export const UNCHECKED = "☐";

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV"];

export function romanNumeral(oneBased: number): string {
	return ROMAN[oneBased] ?? String(oneBased);
}

/** Truncate a label so its visible width fits `width`, adding an ellipsis. */
function clip(label: string, width: number): string {
	if (width <= 0) return "";
	const w = visibleWidth(label);
	if (w <= width) return label;
	const available = width - 1;
	const chars = [...label];
	let out = "";
	for (const ch of chars) {
		if (visibleWidth(out + ch) > available) break;
		out += ch;
	}
	return out + "…";
}

function phaseDisplayName(name: string, index: number): string {
	return `${romanNumeral(index)}. ${name}`;
}

function countOpen(all: TodoItem[]): number {
	return all.filter((t) => t.status === "pending" || t.status === "in_progress" || t.status === "blocked").length;
}

/** Render the full todo panel to already-colored lines, each clipped to `width`. */
export function renderTodoLines(state: TodoState, theme: TodoStyler, width: number): string[] {
	const allTasks = state.phases.flatMap((p) => p.tasks);
	const open = countOpen(allTasks);
	const done = allTasks.filter((t) => t.status === "completed").length;
	const metaParts = [`${allTasks.length} task${allTasks.length === 1 ? "" : "s"}`];
	if (allTasks.length > 0) metaParts.push(`${open} open`);
	if (done > 0) metaParts.push(`${done} done`);
	const headerText = `Todo · ${metaParts.join(" · ")}`;
	const header =
		visibleWidth(headerText) > width
			? theme.fg("toolTitle", theme.bold(clip(headerText, width)))
			: theme.fg("toolTitle", theme.bold("Todo")) + theme.fg("dim", ` · ${metaParts.join(" · ")}`);

	const body: string[] = [];
	for (let pi = 0; pi < state.phases.length; pi++) {
		const phase = state.phases[pi];
		if (!phase || phase.tasks.length === 0) continue;
		body.push(theme.fg("accent", theme.bold(clip(phaseDisplayName(phase.name, pi + 1), width))));
		for (const task of phase.tasks) {
			body.push(renderTodoTaskLine(task, theme, width));
		}
	}
	return [header, ...body];
}

function renderTodoTaskLine(task: TodoItem, theme: TodoStyler, width: number): string {
	const glyphWidth = 1;
	const spaceWidth = 1;
	const chromeLen = glyphWidth + spaceWidth; // "☐ " prefix
	switch (task.status) {
		case "completed": {
			const label = clip(task.content, width - chromeLen);
			return `${CHECKED} ${theme.fg("success", theme.strikethrough(label))}`;
		}
		case "in_progress": {
			const label = clip(task.content, width - chromeLen);
			return theme.fg("accent", `${UNCHECKED} ${label}`);
		}
		case "blocked": {
			const note = task.blocker ? ` (blocked: ${task.blocker})` : " (blocked)";
			const suffixLen = visibleWidth(note);
			if (suffixLen >= width - chromeLen) {
				return theme.fg("warning", clip(`${UNCHECKED} ${note.trim()}`, width));
			}
			const label = clip(task.content, Math.max(0, width - chromeLen - suffixLen));
			return theme.fg("warning", `${UNCHECKED} ${label}${note}`);
		}
		case "abandoned": {
			const label = clip(task.content, width - chromeLen);
			return theme.fg("error", theme.strikethrough(label));
		}
		case "pending":
		default: {
			const label = clip(task.content, width - chromeLen);
			return theme.fg("dim", `${UNCHECKED} ${label}`);
		}
	}
}

const WIDGET_ACTIVE_TASK_CAP = 5;
const WIDGET_SUBSEQUENT_PHASE_CAP = 4;

function currentPhaseIndex(phases: TodoState["phases"]): number {
	const active = phases.findIndex((phase) =>
		phase.tasks.some(
			(task) => task.status === "pending" || task.status === "in_progress" || task.status === "blocked",
		),
	);
	return active === -1 ? phases.length - 1 : active;
}

function widgetTaskPreview(tasks: TodoItem[]): { tasks: TodoItem[]; hidden: number } {
	const open = tasks.filter(
		(task) => task.status === "pending" || task.status === "in_progress" || task.status === "blocked",
	);
	if (open.length <= WIDGET_ACTIVE_TASK_CAP) return { tasks: open, hidden: 0 };

	const active = open.filter((task) => task.status === "in_progress");
	if (active.length >= WIDGET_ACTIVE_TASK_CAP) {
		return { tasks: active.slice(0, WIDGET_ACTIVE_TASK_CAP), hidden: open.length - WIDGET_ACTIVE_TASK_CAP };
	}

	const preview = [...active];
	const start = active.length > 0 ? open.indexOf(active[0]!) : 0;
	for (let index = start; index < open.length && preview.length < WIDGET_ACTIVE_TASK_CAP; index++) {
		const task = open[index]!;
		if (!preview.includes(task)) preview.push(task);
	}
	return { tasks: preview, hidden: open.length - preview.length };
}

function widgetHeader(
	theme: TodoStyler,
	width: number,
	activePhase: number,
	phaseCount: number,
	open: number,
	blocked: number,
): string {
	const meta = [
		phaseCount > 1 ? `${activePhase + 1}/${phaseCount}` : undefined,
		`${open} remaining`,
		blocked > 0 ? `${blocked} blocked` : undefined,
	]
		.filter((part): part is string => part !== undefined)
		.join(" · ");
	const raw = `Todos · ${meta}`;
	if (visibleWidth(raw) > width) return theme.fg("accent", theme.bold(clip(raw, width)));
	return theme.fg("accent", theme.bold("Todos")) + theme.fg("dim", ` · ${meta}`);
}

function widgetPhaseLine(
	phase: TodoState["phases"][number],
	index: number,
	multiPhase: boolean,
	active: boolean,
	theme: TodoStyler,
	width: number,
): string {
	const label = multiPhase ? phaseDisplayName(phase.name, index + 1) : phase.name;
	const done = phase.tasks.filter((task) => task.status === "completed").length;
	const progress = ` · ${done}/${phase.tasks.length}`;
	const raw = `${label}${progress}`;
	if (visibleWidth(raw) > width) {
		return theme.fg(active ? "accent" : "muted", active ? theme.bold(clip(raw, width)) : clip(raw, width));
	}
	const color: TodoColor = active ? "accent" : "muted";
	return theme.fg(color, active ? theme.bold(label) : label) + theme.fg("dim", progress);
}

/** Render the bounded above-editor widget: active phase detail plus future-phase progress. */
export function renderTodoWidgetLines(state: TodoState, theme: TodoStyler, width: number): string[] {
	const phases = state.phases.filter((phase) => phase.tasks.length > 0);
	const allTasks = phases.flatMap((phase) => phase.tasks);
	const open = countOpen(allTasks);
	if (open === 0) return [];

	const activeIndex = currentPhaseIndex(phases);
	const multiPhase = phases.length > 1;
	const end = Math.min(phases.length, activeIndex + 1 + WIDGET_SUBSEQUENT_PHASE_CAP);
	const blocked = allTasks.filter((task) => task.status === "blocked").length;
	const lines = [widgetHeader(theme, width, activeIndex, phases.length, open, blocked)];

	for (let index = activeIndex; index < end; index++) {
		const phase = phases[index]!;
		const active = index === activeIndex;
		lines.push(widgetPhaseLine(phase, index, multiPhase, active, theme, width));
		if (!active) continue;

		const preview = widgetTaskPreview(phase.tasks);
		for (const task of preview.tasks) {
			lines.push(`  ${renderTodoTaskLine(task, theme, Math.max(2, width - 2))}`);
		}
		if (preview.hidden > 0) {
			lines.push(
				theme.fg("dim", clip(`  … ${preview.hidden} more task${preview.hidden === 1 ? "" : "s"}`, width)),
			);
		}
	}
	if (end < phases.length) {
		const hidden = phases.length - end;
		lines.push(theme.fg("dim", clip(`… ${hidden} more phase${hidden === 1 ? "" : "s"}`, width)));
	}
	return lines;
}

/** Full historical panel used only when a todo tool result is expanded. */
export function todoPanelComponent(
	state: TodoState,
	theme: TodoStyler,
): { render(width: number): string[]; invalidate(): void } {
	return {
		render(width) {
			return renderTodoLines(state, theme, Math.max(4, width));
		},
		invalidate() {
			// No cached state; nothing to invalidate.
		},
	};
}

/** Bounded persistent widget kept above the editor while work remains. */
export function todoWidgetComponent(
	state: TodoState,
	theme: TodoStyler,
): { render(width: number): string[]; invalidate(): void } {
	return {
		render(width) {
			return renderTodoWidgetLines(state, theme, Math.max(4, width));
		},
		invalidate() {
			// No cached state; nothing to invalidate.
		},
	};
}
