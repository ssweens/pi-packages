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
export function resultLines(v: RunView, expanded: boolean, theme: Theme, width: number): string[] {
	const color = v.status === "complete" ? "success" : v.status === "error" ? "error" : "warning";
	const glyph = v.status === "complete" ? "✓" : v.status === "error" ? "✗" : "⊘";
	const status = v.status === "complete" ? "" : ` · ${v.status}`;
	const suffix = theme.fg(color, status) + theme.fg("dim", ` · ${v.role} · ${elapsed(v.durationMs)}`)
		+ (v.droppedTools.length ? theme.fg("warning", " · tools unavailable") : "");
	const title = truncateToWidth(runTitle(v), Math.max(0, width - 2 - visibleWidth(suffix)), "…");
	const lines = [truncateToWidth(`${theme.fg(color, glyph)} ${theme.bold(title)}${suffix}`, width, "…")];
	if (!expanded) return lines;
	if (v.output.trim()) {
		const output = new Markdown(v.output.trim(), 0, 0, getMarkdownTheme()).render(Math.max(1, width - 2));
		lines.push(...output.map((l) => `  ${l}`));
	}
	if (v.failedAttempts) lines.push(theme.fg("warning", `${v.failedAttempts} failed provider attempt${v.failedAttempts === 1 ? "" : "s"} before this (last: ${v.lastAttemptError})`));
	if (v.error) lines.push(...wrapTextWithAnsi(theme.fg("error", v.error), Math.max(1, width)));
	lines.push(theme.fg("dim", `${v.id} · ${v.model} · ${v.context} · ${v.turns} turns · $${v.cost.toFixed(4)}`));
	if (v.changedFiles.length) lines.push(theme.fg("dim", `Changed: ${v.changedFiles.join(", ")}`));
	if (v.sessionFile) lines.push(theme.fg("dim", `Session: ${v.sessionFile}`));
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

export function framed(build: (width: number) => string[]): Component {
	return { render: build, invalidate() {} };
}
