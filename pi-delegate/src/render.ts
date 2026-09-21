/**
 * omp-style framed rendering for delegate results.
 *
 * Shape (after oh-my-pi's task renderer):
 *
 *   ╭─ ◆ delegate: scout ────────────────────────────────╮
 *   │ ✓ scout-abc: first line of task ⟨fork⟩ [done] · 4 ⚙ · 9.3%/272k · $0.01 · 31s
 *   │ Task            (expanded only)
 *   │   …
 *   │ Output
 *   │   3 dim lines collapsed / markdown expanded
 *   │ Changed: a.ts, b.ts
 *   ╰────────────────────────────────────────────────────╯
 */
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { type Component, Markdown, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export interface RunView {
	id: string;
	role: string;
	model: string;
	thinking: string;
	context: "fork" | "fresh";
	forkedMessages?: number;
	contextWindow?: number;
	status: "running" | "complete" | "error" | "cancelled" | "timeout";
	task: string;
	output: string;
	turns: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
	cost: number;
	durationMs: number;
	changedFiles: string[];
	droppedTools: string[];
	toolCalls: { name: string; args: Record<string, unknown>; at?: number }[];
	lastTool?: string;
	error?: string;
	modelNote?: string;
	sessionFile?: string;
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DOT = " · ";
const COLLAPSED_OUTPUT_LINES = 3;
const EXPANDED_TASK_LINES = 20;
const INSET = 1;

function firstLine(s: string): string {
	const t = s.trim();
	const i = t.indexOf("\n");
	return i === -1 ? t : t.slice(0, i);
}

function fmtDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
	const m = Math.floor(s / 60);
	return `${m}m${Math.round(s - m * 60)}s`;
}

function fmtNum(n: number): string {
	if (n < 1000) return String(n);
	if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

function fmtWindow(n: number): string {
	return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : `${Math.round(n / 1000)}k`;
}

function statusGlyph(v: RunView, theme: Theme, frame: number): { icon: string; color: ThemeColor; label: string } {
	switch (v.status) {
		case "running":
			return { icon: theme.fg("accent", SPINNER[frame % SPINNER.length]), color: "accent", label: v.lastTool ? v.lastTool : "running" };
		case "complete":
			return { icon: theme.fg("success", "✓"), color: "success", label: "done" };
		case "cancelled":
			return { icon: theme.fg("warning", "⊘"), color: "warning", label: "cancelled" };
		case "timeout":
			return { icon: theme.fg("warning", "⧖"), color: "warning", label: "timeout" };
		default:
			return { icon: theme.fg("error", "✗"), color: "error", label: "failed" };
	}
}

function badge(text: string, color: ThemeColor, theme: Theme): string {
	return theme.fg(color, `[${text}]`);
}

function ctxBadge(v: RunView, theme: Theme): string {
	const inner = v.context === "fork" && v.forkedMessages ? `fork ${v.forkedMessages}` : v.context;
	return ` ${theme.fg("dim", `⟨${inner}⟩`)}`;
}

function statusLine(v: RunView, theme: Theme, frame: number): string {
	const g = statusGlyph(v, theme, frame);
	const brief = firstLine(v.task);
	const title = `${theme.bold(v.id)}${brief ? `: ${truncateToWidth(brief, 64, "…")}` : ""}`;
	let line = `${g.icon} ${theme.fg(v.status === "complete" ? "text" : "accent", title)}${ctxBadge(v, theme)} ${badge(g.label, g.color, theme)}`;
	if (v.toolCalls.length) line += `${DOT}${theme.fg("dim", `${fmtNum(v.toolCalls.length)} ⚙`)}`;
	if (v.turns) line += `${DOT}${theme.fg("dim", `${v.turns} turn${v.turns === 1 ? "" : "s"}`)}`;
	const ctxTokens = v.tokens.input + v.tokens.cacheRead;
	if (ctxTokens > 0) {
		line += `${DOT}${theme.fg("dim", v.contextWindow ? `${((ctxTokens / v.contextWindow) * 100).toFixed(1)}%/${fmtWindow(v.contextWindow)}` : fmtNum(ctxTokens))}`;
	}
	if (v.cost > 0) line += `${DOT}${theme.fg("warning", `$${v.cost < 0.01 ? v.cost.toFixed(4) : v.cost.toFixed(2)}`)}`;
	line += `${DOT}${theme.fg("dim", `${v.model}${v.thinking ? `:${v.thinking}` : ""}`)}`;
	line += `${DOT}${theme.fg("dim", fmtDuration(v.durationMs))}`;
	return line;
}

function section(label: string, body: string[], theme: Theme): string[] {
	return [theme.fg("dim", label), ...body.map((l) => `  ${l}`)];
}

function dimLines(text: string, max: number, theme: Theme, width: number): string[] {
	const lines = text.trimEnd().split("\n");
	const out = lines.slice(0, max).map((l) => theme.fg("dim", truncateToWidth(l.replace(/\t/g, "  "), Math.max(10, width - 2), "…")));
	if (lines.length > max) out.push(theme.fg("dim", `… ${lines.length - max} more line${lines.length - max === 1 ? "" : "s"}`));
	return out;
}

/** Body rows for the result frame. */
export function resultLines(v: RunView, expanded: boolean, theme: Theme, width: number, frame: number): string[] {
	const lines: string[] = [statusLine(v, theme, frame)];
	if (expanded && v.task.trim()) lines.push(...section("Task", dimLines(v.task, EXPANDED_TASK_LINES, theme, width), theme));
	if (v.status === "running") {
		const recent = v.toolCalls.slice(-(expanded ? 12 : 3));
		if (recent.length) lines.push(...section("Progress", recent.map((t) => theme.fg("muted", "→ ") + formatToolCall(t.name, t.args, theme)), theme));
	} else if (v.output.trim()) {
		if (expanded) {
			const md = new Markdown(v.output.trim(), 0, 0, getMarkdownTheme()).render(Math.max(20, width - 2));
			lines.push(...section("Output", md, theme));
		} else {
			lines.push(...section("Output", dimLines(v.output, COLLAPSED_OUTPUT_LINES, theme, width), theme));
		}
	}
	if (v.changedFiles.length) lines.push(theme.fg("dim", `Changed: ${v.changedFiles.join(", ")}`));
	if (v.droppedTools.length) lines.push(theme.fg("warning", `Dropped tools: ${v.droppedTools.join(", ")}`));
	if (v.error) lines.push(theme.fg("error", truncateToWidth(v.error.replace(/\s+/g, " "), Math.max(10, width - 2), "…")));
	if (v.modelNote) lines.push(theme.fg("warning", truncateToWidth(v.modelNote, Math.max(10, width - 2), "…")));
	if (expanded && v.sessionFile) lines.push(theme.fg("dim", `Session: ${v.sessionFile.replace(process.env.HOME ?? "", "~")}`));
	return lines;
}

/** Call preview rows (before any result exists). */
export function callLines(args: { role?: string; task?: string; context?: string; model?: string }, theme: Theme): string[] {
	const brief = args.task ? firstLine(args.task) : "";
	let line = `${theme.fg("dim", "•")} ${theme.fg("accent", theme.bold(args.role ?? "…"))}`;
	if (brief) line += `: ${theme.fg("muted", truncateToWidth(brief, 64, "…"))}`;
	if (args.context) line += ` ${theme.fg("dim", `⟨${args.context}⟩`)}`;
	if (args.model) line += ` ${theme.fg("dim", args.model)}`;
	return [line];
}

export function formatToolCall(name: string, args: Record<string, unknown>, theme: Theme): string {
	const home = process.env.HOME ?? "";
	const short = (p: unknown) => (typeof p === "string" && home && p.startsWith(home) ? `~${p.slice(home.length)}` : String(p ?? "…"));
	switch (name) {
		case "bash": {
			const c = String(args.command ?? "…");
			return theme.fg("muted", "$ ") + theme.fg("toolOutput", truncateToWidth(c.replace(/\s+/g, " "), 60, "…"));
		}
		case "read":
			return theme.fg("muted", "read ") + theme.fg("accent", short(args.path ?? args.file_path));
		case "edit":
			return theme.fg("muted", "edit ") + theme.fg("accent", short(args.path ?? args.file_path));
		case "write":
			return theme.fg("muted", "write ") + theme.fg("accent", short(args.path ?? args.file_path));
		case "ls":
			return theme.fg("muted", "ls ") + theme.fg("accent", short(args.path ?? "."));
		case "find":
			return theme.fg("muted", "find ") + theme.fg("accent", String(args.pattern ?? "*")) + theme.fg("dim", ` in ${short(args.path ?? ".")}`);
		case "grep":
			return theme.fg("muted", "grep ") + theme.fg("accent", `/${String(args.pattern ?? "")}/`) + theme.fg("dim", ` in ${short(args.path ?? ".")}`);
		default:
			return theme.fg("accent", name) + theme.fg("dim", ` ${truncateToWidth(JSON.stringify(args), 50, "…")}`);
	}
}

/** Rounded frame with a labeled top bar; wraps body rows to width. */
export function frame(header: string, body: string[], border: ThemeColor, theme: Theme, width: number): string[] {
	const w = Math.max(24, width);
	const b = (s: string) => theme.fg(border, s);
	const pad = " ".repeat(INSET);
	const inner = w - 2 - INSET * 2;
	const label = ` ${header} `;
	const labelW = Math.min(visibleWidth(label), w - 4);
	const top = `${b("╭─")}${truncateToWidth(label, labelW, "…")}${b("─".repeat(Math.max(0, w - 3 - labelW)))}${b("╮")}`;
	const rows: string[] = [top];
	for (const line of body) {
		for (const wrapped of wrapTextWithAnsi(line, inner)) {
			const fill = " ".repeat(Math.max(0, inner - visibleWidth(wrapped)));
			rows.push(`${b("│")}${pad}${wrapped}${fill}${pad}${b("│")}`);
		}
	}
	rows.push(`${b("╰")}${b("─".repeat(w - 2))}${b("╯")}`);
	return rows;
}

export function borderFor(v: RunView | undefined): ThemeColor {
	if (!v) return "borderMuted";
	switch (v.status) {
		case "running":
			return "borderMuted";
		case "complete":
			return "border";
		case "cancelled":
		case "timeout":
			return "warning";
		default:
			return "error";
	}
}

export function empty(): Component {
	return { render: () => [], invalidate: () => {} } as unknown as Component;
}

export function framed(build: (width: number) => string[]): Component {
	return { render: (width: number) => build(width), invalidate: () => {} } as unknown as Component;
}
