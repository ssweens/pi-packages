import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme, keyHint } from "@earendil-works/pi-coding-agent";
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
	return String(v.task ?? "").trim().split("\n", 1)[0] || v.role || "(untitled)";
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
		theme.fg("muted", v.role ?? ""),
		dim(elapsed(v.durationMs ?? 0)),
		v.turns ? dim(`${v.turns} turn${v.turns === 1 ? "" : "s"}`) : "",
		v.cost ? theme.fg("muted", `$${(v.cost ?? 0).toFixed(4)}`) : "",
		v.failedAttempts ? theme.fg("warning", `${v.failedAttempts} failed`) : "",
		v.changedFiles?.length ? theme.fg("success", `${v.changedFiles.length} changed`) : "",
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
	const outputText = typeof v.output === "string" ? v.output : "";
	if (outputText.trim()) {
		const output = new Markdown(outputText.trim(), 0, 0, getMarkdownTheme()).render(Math.max(1, width - 2));
		lines.push(...output.map((l) => `  ${l}`));
	}
	if (v.failedAttempts) lines.push(theme.fg("warning", `${v.failedAttempts} failed provider attempt${v.failedAttempts === 1 ? "" : "s"} before this (last: ${v.lastAttemptError})`));
	if (v.error) lines.push(...wrapTextWithAnsi(theme.fg("error", String(v.error)), Math.max(1, width)));
	lines.push(theme.fg("dim", "id ") + theme.fg("muted", v.id) + theme.fg("dim", "  model ") + theme.fg("muted", `${v.model ?? ""}${v.thinking ? `:${v.thinking}` : ""}`) + theme.fg("dim", `  ${v.context ?? ""}`));
	if (v.changedFiles?.length) lines.push(theme.fg("dim", "changed ") + theme.fg("success", v.changedFiles.join(", ")));
	if (v.sessionFile) lines.push(theme.fg("dim", `session ${v.sessionFile}`));
	if (v.droppedTools?.length) lines.push(theme.fg("warning", `Unavailable tools: ${v.droppedTools.join(", ")}`));
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


/**
 * Tool results are foreign input. This transcript holds records written by earlier versions of
 * this extension, and every one of them is re-rendered after /reload — so a renderer that trusts
 * today's `details` shape crashes the whole app on last week's record. Anything shape-dependent
 * checks its shape first and otherwise falls back to the text path, which is complete by
 * construction: the text the model gets is the text a human gets.
 */
export interface ControlResultLike {
	content?: { type: string; text?: string }[];
	details?: any;
	isError?: boolean;
}

const CONTROL_PREVIEW_LINES = 8;

const isRoleRow = (r: any) => Boolean(r) && typeof r === "object"
	&& typeof r.name === "string" && typeof r.mode === "string" && typeof r.model === "string"
	&& typeof r.description === "string" && typeof r.source === "string"
	&& Array.isArray(r.tools) && r.tools.every((t: any) => typeof t === "string");

const isRunRow = (r: any) => Boolean(r) && typeof r === "object"
	&& typeof r.id === "string" && typeof r.status === "string" && typeof r.task === "string";

export function resultView(
	title: string,
	action: string | undefined,
	subject: string,
	result: ControlResultLike,
	opts: { expanded?: boolean },
	theme: Theme,
	width: number,
): string[] {
	const inner = Math.max(1, width);
	const v = result.details as RunView | undefined;
	const single = v && typeof (v as any).id === "string" ? v : undefined;
	if (single) {
		// Async launch stays invisible in chat; its completion message is the one outcome record.
		if ((title === "delegate" || action === "wait") && single.status === "running") return [];
		return resultLines(single, Boolean(opts.expanded), theme, inner);
	}

	const rows = result.details?.rows;
	if (result.details?.kind === "runs" && Array.isArray(rows) && rows.every(isRunRow)) {
		const running = rows.filter((r) => r.status === "running").length;
		return [
			theme.fg("toolTitle", theme.bold(title)) + ` ${theme.fg("accent", "status")}`
				+ theme.fg("muted", ` ${rows.length} child${rows.length === 1 ? "" : "ren"}`)
				+ (running ? theme.fg("accent", ` · ${running} running`) : ""),
			...rows.map((r) => `  ${runLine(r, theme, inner - 2)}`),
		];
	}

	if (result.details?.kind === "roles" && Array.isArray(rows) && rows.every(isRoleRow)) {
		const pad = (value: string, to: number) => value.padEnd(to);
		const nameWidth = Math.max(...rows.map((r) => r.name.length), 4);
		const modeWidth = Math.max(...rows.map((r) => r.mode.length), 4);
		const modelWidth = Math.max(...rows.map((r) => r.model.length), 5);
		// What a role does to your tree and what it costs to run it are the facts you pick by.
		// Its prose is written for the model and does not survive a column, so it waits for the expand.
		return [
			theme.fg("toolTitle", theme.bold(title)) + ` ${theme.fg("accent", "roles")}` + theme.fg("muted", ` ${rows.length}`),
			...rows.map((r) => truncateToWidth("  "
				+ theme.fg("text", pad(r.name, nameWidth)) + "  "
				+ theme.fg("muted", pad(r.mode, modeWidth)) + "  "
				+ theme.fg(r.approved === true ? "dim" : "warning", pad(r.model, modelWidth)) + "  "
				+ theme.fg(r.writes === true ? "warning" : "success", r.writes === true ? "writes" : "read-only")
				+ theme.fg("dim", ` · ${r.tools.length} tools`)
				+ (r.timeoutMs ? theme.fg("dim", ` · ${Math.round(r.timeoutMs / 60000)}m`) : "")
				+ ((r.dropped?.length ?? 0) ? theme.fg("warning", ` · ${r.dropped.length} unavailable`) : ""),
				inner, "\u2026")),
			...(opts.expanded
				? rows.flatMap((r) => [
					"",
					theme.fg("text", `  ${r.name}`) + theme.fg("dim", `  ${r.tools.join(" ")}`),
					...wrapTextWithAnsi(theme.fg("dim", `  ${r.description}`), inner),
					theme.fg("dim", `  ${r.source}`),
				])
				: [theme.fg("muted", "  ") + keyHint("app.tools.expand", "what each role is for, and where it comes from")]),
		];
	}

	const blocks = Array.isArray(result.content) ? result.content : [];
	const text = blocks.filter((b) => b?.type === "text").map((b) => String(b.text ?? "")).join("\n").trim();
	const header = theme.fg("toolTitle", theme.bold(title))
		+ (action ? ` ${theme.fg("accent", action)}` : "")
		+ (subject ? theme.fg("muted", ` ${subject}`) : "");
	const styled = text.split("\n").map((line) => theme.fg(result.isError ? "error" : "toolOutput", line)).join("\n");
	const all = text ? wrapTextWithAnsi(styled, inner) : [];
	if (opts.expanded) return [header, ...all];
	const { shown, hidden } = previewLines(all, CONTROL_PREVIEW_LINES);
	return [header, ...shown, ...(hidden
		? [theme.fg("muted", `\u2026 ${hidden} more line${hidden === 1 ? "" : "s"},`) + ` ${keyHint("app.tools.expand", "to expand")}`]
		: [])];
}

export function framed(build: (width: number) => string[]): Component {
	return { render: build, invalidate() {} };
}
