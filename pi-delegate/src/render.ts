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

/** Artificial Analysis indices as OpenRouter lists them; an absent index stays absent. */
export interface AAIndices { intel?: number; coding?: number; agentic?: number }

/** OpenRouter's current word on one registry offering. `notes` is the report's own wording. */
export interface LiveFacts {
	listed: boolean;
	notes: string[];
	tiered: boolean;
	livePrice?: string;
	expires?: string;
	aa?: AAIndices;
	endpoints?: string[];
	endpointsError?: string;
}

export interface ModelRow {
	key: string;
	current: boolean;
	reasoning: boolean;
	contextWindow?: number;
	cost?: { input: number; output: number };
	live?: LiveFacts;
	rating?: { score: number; source: string; note?: string };
}

/** The facts behind a models report, so a human gets a table instead of the model's text. */
export interface ModelsDetails {
	kind: "models";
	filter: string;
	total: number;
	providers: [string, number][];
	matched: number;
	unratedHidden: number;
	endpointCap?: number;
	rows: ModelRow[];
	defaults: { approved: { role: string; spec: string; ageDays: number; reason?: string }[]; drift: string[] };
	ratings: string;
	openrouter: { summary: string; error: boolean };
	liveOnly: { count: number; rows: { id: string; price: string; aa?: AAIndices }[] };
}

const isStrings = (v: any) => Array.isArray(v) && v.every((s) => typeof s === "string");

const isModelRow = (r: any) => Boolean(r) && typeof r === "object"
	&& typeof r.key === "string" && typeof r.current === "boolean" && typeof r.reasoning === "boolean"
	&& (r.contextWindow === undefined || typeof r.contextWindow === "number")
	&& (r.cost === undefined || (typeof r.cost?.input === "number" && typeof r.cost?.output === "number"))
	&& (r.rating === undefined || (typeof r.rating?.score === "number" && typeof r.rating?.source === "string"))
	&& (r.live === undefined || (typeof r.live?.listed === "boolean" && isStrings(r.live.notes)
		&& (r.live.endpoints === undefined || isStrings(r.live.endpoints))));

const isModelsDetails = (d: any): d is ModelsDetails => d?.kind === "models"
	&& Array.isArray(d.rows) && d.rows.every(isModelRow)
	&& typeof d.filter === "string" && typeof d.total === "number" && typeof d.matched === "number" && typeof d.unratedHidden === "number"
	&& Array.isArray(d.providers) && d.providers.every((p: any) => Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "number")
	&& Array.isArray(d.defaults?.approved) && isStrings(d.defaults.drift)
	&& d.defaults.approved.every((a: any) => typeof a?.role === "string" && typeof a?.spec === "string" && typeof a?.ageDays === "number")
	&& typeof d.ratings === "string" && typeof d.openrouter?.summary === "string"
	&& typeof d.liveOnly?.count === "number" && Array.isArray(d.liveOnly.rows)
	&& d.liveOnly.rows.every((r: any) => typeof r?.id === "string" && typeof r?.price === "string");

const MODEL_PREVIEW_ROWS = 6;
const FIELD_LABEL = 13;

/** Exceptions only: a column of "reasoning yes" would be noise, a missing one is a fact. */
function modelNotes(r: ModelRow, theme: Theme): string {
	const l = r.live;
	const n = l?.endpoints?.length ?? 0;
	return [
		r.current ? theme.fg("accent", "current") : "",
		r.reasoning ? "" : theme.fg("muted", "no reasoning"),
		l && !l.listed ? theme.fg("warning", "not listed on OpenRouter now") : "",
		l?.livePrice ? theme.fg("warning", `live ${l.livePrice}`) : "",
		l?.tiered ? theme.fg("dim", "tiered pricing") : "",
		l?.expires ? theme.fg("warning", `expires ${l.expires}`) : "",
		n ? theme.fg("dim", `${n} endpoint${n === 1 ? "" : "s"}`) : "",
		l?.endpointsError ? theme.fg("warning", "endpoints unavailable") : "",
	].filter(Boolean).join(theme.fg("dim", " \u00b7 "));
}

/** Wrapped text whose continuation lines keep the indent of the first. */
function indented(text: string, indent: number, width: number): string[] {
	return wrapTextWithAnsi(text, Math.max(1, width - indent)).map((l) => " ".repeat(indent) + l);
}

/** A list wraps between its entries, never inside one like "anthropic 15". */
function packed(entries: string[], width: number, theme: Theme): string[] {
	const lines: string[] = [];
	let line = "";
	entries.forEach((raw, i) => {
		// A line that continues ends in " ·", two columns it must leave free; only the last may fill.
		const room = i === entries.length - 1 ? width : width - 2;
		const entry = truncateToWidth(raw, Math.max(1, width - 2), "\u2026");
		const next = line ? `${line}${theme.fg("dim", " \u00b7 ")}${entry}` : entry;
		if (line && visibleWidth(next) > room) { lines.push(line + theme.fg("dim", " \u00b7")); line = entry; } else line = next;
	});
	return line ? [...lines, line] : lines;
}

function modelTable(rows: ModelRow[], expanded: boolean, theme: Theme, width: number): string[] {
	const num = (v: unknown) => (v == null ? "" : String(v));
	const cols: { head: string; right?: true; cell: (r: ModelRow) => [string, ThemeColor] }[] = [
		{ head: "ctx", right: true, cell: (r) => [r.contextWindow ? `${Math.round(r.contextWindow / 1000)}k` : "?", "muted"] },
		{ head: "$/M in/out", cell: (r) => [r.cost ? `$${r.cost.input}/${r.cost.output}` : "$?", "text"] },
	];
	const has = (pick: (r: ModelRow) => unknown) => rows.some((r) => pick(r) != null);
	if (has((r) => r.live?.aa?.intel)) cols.push({ head: "intel", right: true, cell: (r) => [num(r.live?.aa?.intel), "text"] });
	if (has((r) => r.live?.aa?.coding)) cols.push({ head: "coding", right: true, cell: (r) => [num(r.live?.aa?.coding), "muted"] });
	if (has((r) => r.live?.aa?.agentic)) cols.push({ head: "agentic", right: true, cell: (r) => [num(r.live?.aa?.agentic), "muted"] });
	if (has((r) => r.rating)) cols.push({ head: "rated", right: true, cell: (r) => [num(r.rating?.score), "accent"] });
	const cells = rows.map((r) => cols.map((c) => c.cell(r)));
	const widths = cols.map((c, i) => Math.max(visibleWidth(c.head), ...cells.map((row) => visibleWidth(row[i][0]))));
	// The id is what you choose by: scores give way from the right before it is cut, and notes
	// only get what is left. Context and price always stay.
	const keyNeed = Math.max(8, ...rows.map((r) => visibleWidth(r.key)));
	const span = (n: number) => widths.slice(0, n).reduce((sum, w) => sum + w + 2, 2);
	let keep = cols.length;
	while (keep > 2 && keyNeed + span(keep) > width) keep--;
	cols.length = keep;
	const keyWidth = Math.max(12, Math.min(keyNeed, width - span(keep)));
	const fit = (text: string, w: number, right?: true) => {
		const t = truncateToWidth(text, w, "\u2026");
		const gap = " ".repeat(Math.max(0, w - visibleWidth(t)));
		return right ? gap + t : t + gap;
	};
	// Notes take only what the columns leave; a clipped row must never cut into a price.
	const line = (key: string, rest: string, notes: string) => {
		const base = `  ${key}${rest}`;
		const room = width - visibleWidth(base) - 2;
		return truncateToWidth(notes && room >= 4 ? `${base}  ${truncateToWidth(notes, room, "\u2026")}` : base, width, "\u2026");
	};
	const out = [line(theme.fg("dim", fit("offering", keyWidth)), cols.map((c, i) => `  ${theme.fg("dim", fit(c.head, widths[i], c.right))}`).join(""), "")];
	rows.forEach((r, n) => {
		const key = fit(r.key, keyWidth);
		out.push(line(r.current ? theme.bold(theme.fg("accent", key)) : theme.fg("text", key),
			cols.map((c, i) => `  ${theme.fg(cells[n][i][1], fit(cells[n][i][0], widths[i], c.right))}`).join(""), modelNotes(r, theme)));
		if (!expanded) return;
		const l = r.live;
		const detail = [
			...(l?.notes ?? []).map((note) => theme.fg("dim", note)),
			...(r.rating ? [theme.fg("accent", `rated ${r.rating.score}`) + theme.fg("dim", ` \u2014 ${r.rating.source}${r.rating.note ? ` \u2014 ${r.rating.note}` : ""}`)] : []),
			...(l?.endpointsError ? [theme.fg("warning", `endpoints: fetch failed (${l.endpointsError})`)] : []),
			...(l?.endpoints ?? []).map((e) => theme.fg("dim", `\u21b3 ${e}`)),
		];
		for (const d of detail) out.push(...indented(d, 4, width));
	});
	return out;
}

function modelsView(title: string, subject: string, d: ModelsDetails, expanded: boolean, theme: Theme, width: number): string[] {
	const dim = (s: string) => theme.fg("dim", s);
	const sep = dim(" \u00b7 ");
	const { approved, drift } = d.defaults;
	const shown = expanded ? d.rows : d.rows.slice(0, MODEL_PREVIEW_ROWS);
	const out = [truncateToWidth(theme.fg("toolTitle", theme.bold(title)) + ` ${theme.fg("accent", "models")}` + (subject ? theme.fg("muted", ` ${subject}`) : "")
		+ theme.fg("muted", `  ${d.matched}${d.filter ? "" : " rated"} of ${d.total} offerings`), width, "\u2026")];
	// Collapsed, one line says what the defaults are and whether anything needs attention; the
	// expand spells each of those out below the table instead.
	if (!expanded) out.push(truncateToWidth("  " + dim("defaults ")
		+ (approved.length ? approved.map((a) => theme.fg("text", a.role) + dim(" \u2192 ") + theme.fg("muted", a.spec)).join(sep) : dim("none approved"))
		+ (drift.length ? sep + theme.fg("warning", `${drift.length} change${drift.length === 1 ? "" : "s"} since approval`) : "")
		+ (d.openrouter.error ? sep + theme.fg("warning", `OpenRouter ${d.openrouter.summary}`) : ""), width, "\u2026"));
	if (shown.length) out.push(...modelTable(shown, expanded, theme, width));
	else out.push("  " + theme.fg("muted", d.filter ? `no registry offering matches "${d.filter}"` : "no rated offerings yet"));
	if (!expanded) {
		const hidden = d.matched - shown.length;
		const withheld = [
			hidden > 0 ? `\u2026 ${hidden} more` : "",
			d.filter && d.liveOnly.count ? `${d.liveOnly.count} on OpenRouter but not in your registry` : "",
		].filter(Boolean).join(" \u00b7 ");
		out.push(...indented(withheld ? `${dim(`${withheld},`)} ${keyHint("app.tools.expand", "to expand")}` : keyHint("app.tools.expand", "for pricing detail and providers"), 2, width));
		return out;
	}
	const valueWidth = Math.max(1, width - FIELD_LABEL - 2);
	const field = (label: string, value: string | string[]) => {
		const lines = typeof value === "string" ? wrapTextWithAnsi(value, valueWidth) : value;
		lines.forEach((l, i) => out.push((i ? " ".repeat(FIELD_LABEL + 2) : `  ${dim(label.padEnd(FIELD_LABEL))}`) + l));
	};
	if (d.matched > d.rows.length) out.push("  " + dim(`\u2026 ${d.matched - d.rows.length} more beyond the first ${d.rows.length}; a filter narrows them`));
	out.push("");
	if (!approved.length) field("defaults", dim("none approved"));
	for (const a of approved) {
		field(a === approved[0] ? "defaults" : "", theme.fg("text", a.role) + dim(" \u2192 ") + theme.fg("muted", a.spec) + dim(` \u00b7 approved ${a.ageDays}d ago`));
		if (a.reason) field("", dim(a.reason));
	}
	drift.forEach((x, i) => field(i ? "" : "drift", theme.fg("warning", x)));
	field("OpenRouter", theme.fg(d.openrouter.error ? "warning" : "muted", d.openrouter.summary)
		+ (d.endpointCap ? dim(` \u00b7 endpoints for the first ${d.endpointCap} matches only`) : ""));
	field("ratings", theme.fg("muted", d.ratings));
	if (d.unratedHidden) field("unrated", dim(`${d.unratedHidden} offerings without a rating or AA index are not listed`));
	if (d.liveOnly.count) {
		field("unregistered", dim(`${d.liveOnly.count} on OpenRouter, not in your registry \u2014 add to ~/.pi/agent/models.json to use`));
		for (const r of d.liveOnly.rows) {
			const aa = [r.aa?.intel != null ? `intel ${r.aa.intel}` : "", r.aa?.coding != null ? `coding ${r.aa.coding}` : "", r.aa?.agentic != null ? `agentic ${r.aa.agentic}` : ""].filter(Boolean).join(" ");
			field("", theme.fg("text", r.id) + theme.fg("muted", `  ${r.price}`) + (aa ? dim(`  ${aa}`) : ""));
		}
	}
	field("providers", packed(d.providers.map(([name, n]) => theme.fg("muted", name) + dim(` ${n}`)), valueWidth, theme));
	return out;
}

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

	// Pi exits on any line wider than the terminal, and this record is re-rendered at whatever width
	// the terminal has after a reload. The view wraps to fit; the clamp makes that a guarantee.
	if (action === "models" && isModelsDetails(result.details)) {
		return modelsView(title, subject, result.details, Boolean(opts.expanded), theme, inner).map((l) => truncateToWidth(l, inner, "\u2026"));
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
