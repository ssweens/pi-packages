/**
 * Settings-panel model + line rendering for the `/omp` command.
 * Pure and theme-agnostic (see {@link SettingsStyler}) so the layout, per-feature
 * descriptions, and ON/OFF rendering are unit-testable without a TUI.
 */
import { visibleWidth } from "@mariozechner/pi-tui";
import { FEATURE_KEYS, type FeatureKey, type PersonaName } from "./config";

export type SettingsColor = "accent" | "success" | "error" | "dim" | "muted" | "toolTitle" | "text";

export interface SettingsStyler {
	fg(color: SettingsColor, text: string): string;
	bold(text: string): string;
}

export type SettingsRow =
	| { kind: "persona"; label: string; description: string }
	| { kind: "feature"; key: FeatureKey; label: string; description: string }
	| { kind: "roles"; label: string; description: string };

/** Short on-row label per feature. */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
	persona: "Persona presets",
	engineering: "Engineering policy",
	keywords: "Reasoning keywords",
	roles: "Model roles",
	todo: "Phased todos",
	autoThinking: "Auto-thinking",
	autoLearn: "Auto-learn",
	commit: "AI commit",
};

/** Thorough description of what enabling the feature does. */
export const FEATURE_DESCRIPTIONS: Record<FeatureKey, string> = {
	persona:
		"Applies a system-prompt personality every turn: 'default' is a terse, evidence-first engineer; 'friendly' is a warm collaborator; 'pragmatic' is a focused senior. Space cycles between them. Enable to control the agent's voice and tone for the whole session.",
	engineering:
		"Appends omp's engineering policy to the system prompt: Tool Policy, Execution Workflow, Delivery Contract, Completeness and Evidence rules. Enable to make the agent verify real behavior, never stub or shrink scope, cut over cleanly, and back every claim with evidence.",
	keywords:
		"Scans your message for trigger words — 'ultrathink' by default — and injects an omp-style <system-notice> telling the agent to reason carefully. Enable to force deeper multi-step reasoning on a single message by typing the keyword.",
	roles:
		"Activates model-role presets (@smol, @slow, @plan, @vision, @task, commit) and the ctrl+shift+r shortcut. Each role pins a model and a thinking level for that turn. Enable to switch model + reasoning per request instead of changing it manually.",
	todo:
		"Adds the 'todo' tool and /todo commands. The agent can plan phased tasks, mark work in-progress, auto-promote the next task on completion, render the colored todo panel, and export/import TODO.md. Also enables the bounded incomplete-work reminder when the agent stops.",
	autoThinking:
		"Classifies each prompt's difficulty (low→xhigh) and automatically sets the thinking level before the turn, so trivial requests don't overspend on reasoning and hard ones get the depth they need. Enable to stop tuning thinking level by hand.",
	autoLearn:
		"After a turn that heavily mutates the repo, offers to capture a reusable lesson into memory so future work benefits from what was just learned. Enable to accumulate project knowledge without being asked.",
	commit:
		"Adds the /commit command: it reads the current diff, generates an omp-style conventional commit message (type(scope): desc), and commits — or pushes — only after you confirm. Enable to get consistent, on-message git commits.",
};

export function buildRows(): SettingsRow[] {
	return [
		{ kind: "roles", label: "Model roles", description: ROLES_DESCRIPTION },
		{ kind: "persona", label: FEATURE_LABELS.persona, description: FEATURE_DESCRIPTIONS.persona },
		...FEATURE_KEYS.filter((k) => k !== "persona").map((key) => ({
			kind: "feature" as const,
			key,
			label: FEATURE_LABELS[key] ?? key,
			description: FEATURE_DESCRIPTIONS[key] ?? "",
		})),
	];
}

export const ROLES_DESCRIPTION =
	"Bind a model to each role (@smol, @slow, @plan, …). Press enter to open the role selector and assign a model + thinking; \"auto\" leaves the model to pattern matching. Overrides the hardcoded role presets.";

export interface SettingsRenderState {
	persona: PersonaName;
	features: Record<FeatureKey, boolean>;
}

function clip(label: string, width: number): string {
	if (width <= 0) return "";
	if (visibleWidth(label) <= width) return label;
	const out: string[] = [];
	for (const ch of [...label]) {
		if (visibleWidth(out.join("") + ch) > width - 1) break;
		out.push(ch);
	}
	return out.join("") + "…";
}

/** Word-wrap plain text to `width` visible columns; returns wrapped lines. */
export function wrapText(text: string, width: number): string[] {
	if (width <= 0) return [""];
	const words = text.split(/\s+/).filter((w) => w.length > 0);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		if (current === "") {
			current = word;
			continue;
		}
		if (visibleWidth(current + " " + word) <= width) {
			current += " " + word;
		} else {
			lines.push(current);
			current = word;
		}
	}
	if (current !== "") lines.push(current);
	return lines;
}

/**
 * Render the settings panel to colored lines. `width` is the full available
 * width; the surrounding Box adds padding/background. Every feature carries its full
 * (wrapped) description — never clipped.
 */
/**
 * Render the settings panel to colored lines. Returns the lines plus the index of
 * each row's label line within them, so a scrolled viewport can keep the cursor
 * row visible. Every description is fully wrapped — never clipped.
 */
export function renderSettingsLines(
	state: SettingsRenderState,
	rows: SettingsRow[],
	cursor: number,
	theme: SettingsStyler,
	width: number,
): { lines: string[]; rowStart: number[] } {
	const title = theme.fg("toolTitle", theme.bold("pi-omp settings")) + theme.fg("dim", " — pi → omp feature switchboard");
	const hint = theme.fg("dim", "↑/↓ move · space/←→ toggle · enter open · esc close — changes save on close");
	const rule = theme.fg("dim", "─".repeat(Math.max(0, width)));

	const labelWidth = Math.min(22, rows.reduce((m, r) => Math.max(m, visibleWidth(r.label)), 0) + 2);
	const descW = Math.max(0, width - 4);
	const indent = "    ";

	const lines: string[] = [title, "", hint, "", rule, ""];
	const rowStart: number[] = [];

	rows.forEach((row, i) => {
		const selected = i === cursor;
		const cursorMark = selected ? theme.fg("accent", "› ") : "  ";
		const labelPadded = clip(row.label.padEnd(labelWidth, " "), labelWidth);

		let rowLine: string;
		if (row.kind === "roles") {
			const valueLabel = theme.fg("accent", `[ select ]`);
			const labelPart = selected ? theme.fg("accent", theme.bold(labelPadded)) : labelPadded;
			rowLine = `${cursorMark}${labelPart}${valueLabel}`;
		} else if (row.kind === "persona") {
			const valueLabel = theme.fg("accent", `[ ${state.persona} ]`);
			const labelPart = selected ? theme.fg("accent", theme.bold(labelPadded)) : labelPadded;
			rowLine = `${cursorMark}${labelPart}${valueLabel}`;
		} else {
			const featureEnabled = state.features[row.key] === true;
			const valueLabel = featureEnabled ? theme.fg("success", theme.bold("ON ")) : theme.fg("dim", "off");
			const labelPart = selected ? theme.fg("accent", theme.bold(labelPadded)) : labelPadded;
			rowLine = `${cursorMark}${labelPart}${valueLabel}`;
		}
		rowStart.push(lines.length);
		lines.push(rowLine);

		const descColor: SettingsColor = selected ? "muted" : "dim";
		for (const wrapped of wrapText(row.description, descW)) {
			lines.push(indent + theme.fg(descColor, wrapped));
		}
	});

	lines.push("", rule);
	return { lines, rowStart };
}
