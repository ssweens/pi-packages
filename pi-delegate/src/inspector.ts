/**
 * Live surfaces for running children.
 *
 * Rail   — widget pinned above the editor while any child runs; one OMP-style row per run.
 *          The ONLY live-status surface. Off the scroll region, so it cannot scroll away. Gone when idle.
 *          The transcript frame is a static dispatch record while running; it becomes the result when done.
 * Inspector — focused overlay (ctrl+j). Tails one child's live activity: tool calls as they
 *          happen, assistant text as it lands. Keys follow Claude Code's agent view:
 *          ↑↓ scroll · ←→/tab switch child · s steer · c cancel · o session path · q/esc close.
 *
 * Facts only. Every line is the run's recorded state; nothing here summarizes or guesses.
 */
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { formatToolCall, frame, type RunView } from "./render.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DOT = " · ";
const SLOW_TOOL_MS = 5000;
const TICK_MS = 250;

/** What the surfaces need from the host. Kept narrow so render code never touches run internals. */
export interface LiveSource {
	running(): RunView[];
	all(): RunView[];
	/** Live activity of one run: tool calls and assistant text in order, newest last. */
	activity(id: string): ActivityItem[];
	steer(id: string, message: string): Promise<void>;
	cancel(id: string): Promise<void>;
}

export type ActivityItem =
	| { kind: "tool"; name: string; args: Record<string, unknown>; at?: number }
	| { kind: "text"; text: string }
	| { kind: "user"; text: string };

function fmtElapsed(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return `${m}m${String(s % 60).padStart(2, "0")}s`;
}

function firstLine(s: string): string {
	const t = s.trim();
	const i = t.indexOf("\n");
	return i === -1 ? t : t.slice(0, i);
}

function ctxBadge(v: RunView, theme: Theme): string {
	const inner = v.context === "fork" && v.forkedMessages ? `fork ${v.forkedMessages}` : v.context;
	return theme.fg("dim", `⟨${inner}⟩`);
}

/** One OMP-style row: `⠹ id: task ⟨ctx⟩ · Nm · N ⚙ · $cost` with a hook line for the current tool. Rail only. */
export function progressRow(v: RunView, theme: Theme, frame: number, width: number): string[] {
	const running = v.status === "running";
	const nameColor: ThemeColor = running ? "accent" : v.status === "complete" ? "text" : "error";
	const icon = running ? theme.fg("accent", SPINNER[frame % SPINNER.length]) : v.status === "complete" ? theme.fg("success", "✓") : theme.fg("error", "✗");
	const brief = firstLine(v.task);
	let line = `  ${icon} ${theme.fg(nameColor, theme.bold(v.id))}`;
	if (brief) line += `${theme.fg(nameColor, ":")} ${theme.fg("muted", truncateToWidth(brief, Math.max(16, Math.min(56, width - 60)), "…"))}`;
	line += ` ${ctxBadge(v, theme)}`;
	line += `${DOT}${theme.fg("dim", fmtElapsed(v.durationMs))}`;
	if (v.toolCalls.length) line += `${DOT}${theme.fg("dim", `${v.toolCalls.length} ⚙`)}`;
	if (v.cost > 0) line += `${DOT}${theme.fg("warning", `$${v.cost < 0.01 ? v.cost.toFixed(4) : v.cost.toFixed(2)}`)}`;
	const rows = [line];
	if (running) {
		const last = v.toolCalls[v.toolCalls.length - 1];
		if (last) {
			let hook = `    ${theme.fg("dim", "└")} ${formatToolCall(last.name, last.args, theme)}`;
			const at = (last as { at?: number }).at;
			if (at && Date.now() - at > SLOW_TOOL_MS) hook += `${DOT}${theme.fg("warning", fmtElapsed(Date.now() - at))}`;
			rows.push(hook);
		}
	}
	return rows;
}

// ─── Rail ────────────────────────────────────────────────────────────────────

export function railLines(src: LiveSource, theme: Theme, frame: number, width: number, shortcut: string): string[] {
	const running = src.running();
	if (!running.length) return [];
	const head = `${theme.fg("accent", "◆")} ${theme.fg("toolTitle", theme.bold("delegate"))}${theme.fg("muted", ` · ${running.length} running`)}`;
	const hint = theme.fg("dim", `${shortcut} inspect`);
	const gap = Math.max(1, width - visibleWidth(head) - visibleWidth(hint));
	const lines = [`${head}${" ".repeat(gap)}${hint}`];
	for (const v of running) lines.push(...progressRow(v, theme, frame, width));
	return lines;
}

/** Widget component: re-renders on a timer only while something runs; disposes its timer when removed. */
export function railComponent(src: LiveSource, theme: Theme, requestRender: () => void, shortcut: string): Component & { dispose(): void } {
	let frame = 0;
	let timer: ReturnType<typeof setInterval> | undefined;
	const arm = () => {
		if (!timer) timer = setInterval(() => {
			frame++;
			if (!src.running().length) {
				clearInterval(timer);
				timer = undefined;
			}
			requestRender();
		}, TICK_MS);
	};
	return {
		render(width: number) {
			if (src.running().length) arm();
			return railLines(src, theme, frame, width, shortcut);
		},
		invalidate() {},
		dispose() {
			if (timer) clearInterval(timer);
		},
	};
}

// ─── Inspector ───────────────────────────────────────────────────────────────
//
// Depth, not status: the rail already says what is running. This shows one child's transcript
// tail and gives you controls. ←→/tab switch child; no list view, because a list would be the rail again.

type Mode = "tail" | "steer";

export class Inspector implements Component {
	private mode: Mode = "tail";
	private index = 0;
	private scrollFromTail = 0;
	private frame = 0;
	private timer: ReturnType<typeof setInterval>;
	private steerText = "";
	private notice = "";
	private ids: string[] = [];

	constructor(
		private src: LiveSource,
		private theme: Theme,
		private requestRender: () => void,
		private done: (result: undefined) => void,
		private openSession: (path: string) => void,
	) {
		this.refreshIds();
		this.timer = setInterval(() => {
			this.frame++;
			this.refreshIds();
			this.requestRender();
		}, TICK_MS);
	}

	dispose() {
		clearInterval(this.timer);
	}

	/** Running first (dispatch order), then the last five finished. Selection is by id so rows moving does not change what you look at. */
	private refreshIds() {
		const cur = this.ids[this.index];
		const running = this.src.running().map((v) => v.id);
		const finished = this.src.all().filter((v) => v.status !== "running").slice(-5).map((v) => v.id);
		this.ids = [...running, ...finished];
		const keep = cur ? this.ids.indexOf(cur) : -1;
		this.index = keep >= 0 ? keep : Math.min(this.index, Math.max(0, this.ids.length - 1));
	}

	private current(): RunView | undefined {
		const id = this.ids[this.index];
		return id ? this.src.all().find((v) => v.id === id) : undefined;
	}

	private switchChild(dir: 1 | -1) {
		if (this.ids.length < 2) return;
		this.index = (this.index + dir + this.ids.length) % this.ids.length;
		this.scrollFromTail = 0;
		this.notice = "";
	}

	handleInput(data: string): void {
		if (this.mode === "steer") {
			if (matchesKey(data, "escape")) {
				this.mode = "tail";
				this.steerText = "";
			} else if (matchesKey(data, "enter")) {
				const v = this.current();
				const msg = this.steerText.trim();
				this.mode = "tail";
				this.steerText = "";
				if (v && msg) {
					this.notice = `steer sent to ${v.id}`;
					void this.src.steer(v.id, msg).catch((e) => (this.notice = `steer failed: ${String(e?.message ?? e)}`));
				}
			} else if (matchesKey(data, "backspace")) {
				this.steerText = this.steerText.slice(0, -1);
			} else if (data.length && !data.startsWith("\x1b") && data >= " ") {
				this.steerText += data;
			}
			this.requestRender();
			return;
		}
		if (matchesKey(data, "escape") || matchesKey(data, "q")) this.done(undefined);
		else if (matchesKey(data, "up")) this.scrollFromTail++;
		else if (matchesKey(data, "down")) this.scrollFromTail = Math.max(0, this.scrollFromTail - 1);
		else if (matchesKey(data, "right") || matchesKey(data, "tab")) this.switchChild(1);
		else if (matchesKey(data, "left") || matchesKey(data, "shift+tab")) this.switchChild(-1);
		else if (matchesKey(data, "s")) {
			if (this.current()) {
				this.mode = "steer";
				this.steerText = "";
			}
		} else if (matchesKey(data, "c")) {
			const v = this.current();
			if (v?.status === "running") {
				this.notice = `cancelling ${v.id}`;
				void this.src.cancel(v.id);
			}
		} else if (matchesKey(data, "o")) {
			const v = this.current();
			if (v?.sessionFile) {
				this.openSession(v.sessionFile);
				this.notice = `pi --session … placed in your editor`;
			}
		}
		this.requestRender();
	}

	invalidate() {}

	render(width: number): string[] {
		// The overlay hands us its own width; fill it exactly so nothing beneath shows through.
		const w = Math.max(40, width);
		const inner = w - 4;
		const v = this.current();
		if (!v) return frame(`${this.theme.fg("accent", "◆")} ${this.theme.fg("toolTitle", this.theme.bold("delegate"))}`, [this.theme.fg("dim", "no runs this session")], "border", this.theme, w);

		const running = v.status === "running";
		const icon = running ? this.theme.fg("accent", SPINNER[this.frame % SPINNER.length]) : v.status === "complete" ? this.theme.fg("success", "✓") : this.theme.fg("error", "✗");
		const pos = this.ids.length > 1 ? this.theme.fg("dim", `  ${this.index + 1}/${this.ids.length}  ←→`) : "";
		const header = `${icon} ${this.theme.fg(running ? "accent" : "text", this.theme.bold(v.id))}${this.theme.fg("muted", `: ${truncateToWidth(firstLine(v.task), Math.max(20, inner - 40), "…")}`)}${pos}`;

		// One stats line — facts the rail does not carry (model, changed files), plus the running ones for orientation.
		const stats: string[] = [ctxBadge(v, this.theme), this.theme.fg("dim", fmtElapsed(v.durationMs))];
		if (v.toolCalls.length) stats.push(this.theme.fg("dim", `${v.toolCalls.length} ⚙`));
		if (v.cost > 0) stats.push(this.theme.fg("warning", `$${v.cost < 0.01 ? v.cost.toFixed(4) : v.cost.toFixed(2)}`));
		stats.push(this.theme.fg("dim", `${v.model}${v.thinking ? `:${v.thinking}` : ""}`));
		if (v.changedFiles.length) stats.push(this.theme.fg("dim", `changed: ${v.changedFiles.join(", ")}`));

		const items = this.src.activity(v.id);
		const lines: string[] = [];
		for (const it of items) {
			if (it.kind === "tool") lines.push(`${this.theme.fg("muted", "→ ")}${formatToolCall(it.name, it.args, this.theme)}`);
			else if (it.kind === "user") lines.push(...wrapTextWithAnsi(this.theme.fg("dim", `▸ ${firstLine(it.text)}`), inner));
			else lines.push(...wrapTextWithAnsi(`${this.theme.fg("accent", "▎")} ${this.theme.fg("toolOutput", it.text.trim())}`, inner));
		}
		const maxRows = Math.max(6, Math.min(30, lines.length));
		const end = Math.max(0, lines.length - this.scrollFromTail);
		const start = Math.max(0, end - maxRows);
		const visible = lines.slice(start, end);
		if (start > 0) visible.unshift(this.theme.fg("dim", `… ${start} earlier`));
		if (!visible.length) visible.push(this.theme.fg("dim", running ? "waiting for first tool call…" : "(no activity recorded)"));

		const body: string[] = [stats.join(DOT), this.theme.fg("border", "─".repeat(inner)), ...visible];
		const live = running ? this.theme.fg("accent", `${SPINNER[this.frame % SPINNER.length]} live`) : this.theme.fg("dim", v.status);
		const below = this.scrollFromTail ? this.theme.fg("warning", `  ↓ ${this.scrollFromTail} below`) : "";
		body.push(`${" ".repeat(Math.max(0, inner - visibleWidth(live) - visibleWidth(below)))}${live}${below}`);
		body.push(this.theme.fg("border", "─".repeat(inner)));
		if (this.mode === "steer") {
			body.push(`${this.theme.fg("accent", "steer ▸ ")}${this.steerText}${this.theme.fg("dim", "▏")}`);
			body.push(this.theme.fg("dim", "enter send · esc cancel"));
		} else {
			if (this.notice) body.push(this.theme.fg("warning", truncateToWidth(this.notice, inner, "…")));
			body.push(this.theme.fg("dim", ["↑↓ scroll", this.ids.length > 1 ? "←→ child" : "", "s steer", running ? "c cancel" : "", "o session", "q close"].filter(Boolean).join("   ")));
		}
		return frame(header, body, running || v.status === "complete" ? "border" : "error", this.theme, w);
	}
}
