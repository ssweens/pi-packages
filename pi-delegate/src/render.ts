import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { type Component, Markdown, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export interface RunView {
	id: string;
	segment: number;
	completionReceipt?: true;
	stopped: boolean;
	settled: boolean;
	role: string;
	model: string;
	cwd: string;
	thinking: string;
	context: "fork" | "fresh";
	forkedMessages?: number;
	contextWindow?: number;
	status: "running" | "complete" | "error" | "cancelled" | "timeout" | "interrupted";
	task: string;
	output: string;
	turns: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
	cost: number;
	durationMs: number;
	changedFiles: string[];
	droppedTools: string[];
	failedAttempts?: number;
	lastAttemptError?: string;
	toolCalls: { name: string; args: Record<string, unknown>; at?: number }[];
	activeTool?: { name: string; args: Record<string, unknown> };
	joinedWaiters?: number;
	revision: number;
	lastTool?: string;
	error?: string;
	sessionFile?: string;
}

/** A supplied title, not a guessed summary of the brief. */
export function runTitle(v: Pick<RunView, "task" | "role">): string {
	return v.task.trim().split("\n", 1)[0] || v.role;
}

export function elapsed(ms: number): string {
	const s = Math.floor(ms / 1000);
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

/** The durable outcome. No live status, frame, or duplicate dispatch record. */
/** Status colour and glyph, shared by every surface that shows a child. */
export function statusMark(v: Pick<RunView, "status">): { color: ThemeColor; glyph: string } {
	if (v.status === "running") return { color: "accent", glyph: "●" };
	if (v.status === "complete") return { color: "success", glyph: "✓" };
	if (v.status === "error") return { color: "error", glyph: "✗" };
	return { color: "warning", glyph: "⊘" };
}

/**
 * One child on one line: glyph and title carry the state, the facts behind it are dimmed so the
 * eye lands on what changed rather than on punctuation.
 */
export function runLine(v: RunView, theme: Theme, width: number, now = Date.now()): string {
	const { color, glyph } = statusMark(v);
	const dim = (text: string) => theme.fg("dim", text);
	const facts = [
		// The glyph already says "complete"; only a status worth reacting to earns a word.
		v.status === "running" ? theme.fg("accent", v.activeTool?.name ?? v.lastTool ?? "thinking") : v.status === "complete" ? "" : theme.fg(color, v.status),
		theme.fg("muted", v.role),
		dim(elapsed(v.durationMs)),
		v.turns ? dim(`${v.turns} turn${v.turns === 1 ? "" : "s"}`) : "",
		v.cost ? theme.fg("muted", `$${v.cost.toFixed(4)}`) : "",
		v.failedAttempts ? theme.fg("warning", `${v.failedAttempts} failed`) : "",
		v.changedFiles.length ? theme.fg("success", `${v.changedFiles.length} changed`) : "",
	].filter(Boolean);
	const suffix = dim("  ") + facts.join(dim(" · "));
	const title = truncateToWidth(runTitle(v), Math.max(4, width - 2 - visibleWidth(suffix)), "…");
	void now;
	return truncateToWidth(`${theme.fg(color, glyph)} ${theme.bold(title)}${suffix}`, width, "…");
}

export function resultLines(v: RunView, expanded: boolean, theme: Theme, width: number): string[] {
	const color = v.status === "complete" ? "success" : v.status === "error" ? "error" : "warning";
	const lines = [runLine(v, theme, width)];
	if (!expanded) return lines;
	if (v.output.trim()) {
		const output = new Markdown(v.output.trim(), 0, 0, getMarkdownTheme()).render(Math.max(1, width - 2));
		lines.push(...output.map((l) => `  ${l}`));
	}
	if (v.failedAttempts) lines.push(theme.fg("warning", `${v.failedAttempts} failed provider attempt${v.failedAttempts === 1 ? "" : "s"} before this (last: ${v.lastAttemptError})`));
	if (v.error) lines.push(...wrapTextWithAnsi(theme.fg("error", v.error), Math.max(1, width)));
	lines.push(theme.fg("dim", "id ") + theme.fg("muted", v.id) + theme.fg("dim", "  model ") + theme.fg("muted", `${v.model}${v.thinking ? `:${v.thinking}` : ""}`) + theme.fg("dim", `  ${v.context}`));
	if (v.changedFiles.length) lines.push(theme.fg("dim", "changed ") + theme.fg("success", v.changedFiles.join(", ")));
	if (v.sessionFile) lines.push(theme.fg("dim", `session ${v.sessionFile}`));
	if (v.droppedTools.length) lines.push(theme.fg("warning", `Unavailable tools: ${v.droppedTools.join(", ")}`));
	return lines.flatMap((l) => wrapTextWithAnsi(l, Math.max(1, width)));
}

export function formatToolCall(name: string, args: Record<string, unknown>, theme: Theme): string {
	const home = process.env.HOME ?? "";
	const short = (p: unknown) => (typeof p === "string" && home && p.startsWith(home) ? `~${p.slice(home.length)}` : String(p ?? "…"));
	switch (name) {
		case "bash":
			return theme.fg("muted", "$ ") + theme.fg("toolOutput", String(args.command ?? "…").replace(/\s+/g, " "));
		case "read": case "edit": case "write":
			return theme.fg("muted", `${name} `) + theme.fg("accent", short(args.path ?? args.file_path));
		case "ls":
			return theme.fg("muted", "ls ") + theme.fg("accent", short(args.path ?? "."));
		case "find": case "grep":
			return theme.fg("muted", `${name} `) + theme.fg("accent", String(args.pattern ?? "")) + theme.fg("dim", ` in ${short(args.path ?? ".")}`);
		default:
			return theme.fg("accent", name);
	}
}

/** Rounded OMP-style frame, including terminals narrower than the usual layout. */
export function frame(header: string, body: string[], border: ThemeColor, theme: Theme, width: number): string[] {
	if (width < 6) return [header, ...body].map((l) => truncateToWidth(l, Math.max(0, width), ""));
	const b = (s: string) => theme.fg(border, s);
	const inner = width - 4;
	const label = truncateToWidth(` ${header} `, width - 4, "…");
	const top = b("╭─") + label + b("─".repeat(Math.max(0, width - 3 - visibleWidth(label))) + "╮");
	const rows = [top];
	for (const line of body) {
		for (const wrapped of wrapTextWithAnsi(line, inner)) {
			rows.push(`${b("│")} ${wrapped}${" ".repeat(Math.max(0, inner - visibleWidth(wrapped)))} ${b("│")}`);
		}
	}
	rows.push(b(`╰${"─".repeat(width - 2)}╯`));
	return rows;
}

export function empty(): Component {
	return { render: () => [], invalidate() {} };
}

/**
 * Control reports lead with what matters — defaults, drift, counts — so a preview keeps the
 * head, unlike a command whose tail is the interesting part. Returns the lines to show and how
 * many were withheld.
 */
export function previewLines(lines: string[], max: number): { shown: string[]; hidden: number } {
	if (lines.length <= max) return { shown: lines, hidden: 0 };
	return { shown: lines.slice(0, max), hidden: lines.length - max };
}

export function framed(build: (width: number) => string[]): Component {
	return { render: build, invalidate() {} };
}
