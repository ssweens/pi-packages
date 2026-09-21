/**
 * Live surfaces for running children.
 *
 * Rail   — widget pinned above the editor while any child runs; one OMP-style row per run.
 *          Off the scroll region, so it cannot scroll away. Gone when nothing is running.
 * Inspector — focused overlay (ctrl+j). Tails one child's live activity: tool calls as they
 *          happen, assistant text as it lands. Keys follow Claude Code's agent view:
 *          ↑↓ move/scroll · space peek · enter open · s steer · c cancel · o session path · q/esc close.
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

/**
 * One OMP-style row: `● id: task ⟨ctx⟩ · Nm · $cost` with a hook line for the current tool.
 * `frozen` renders dim (used for non-selected rows in the inspector list).
 */
export function progressRow(v: RunView, theme: Theme, frame: number, width: number, opts: { selected?: boolean; frozen?: boolean; hook?: boolean } = {}): string[] {
	const running = v.status === "running";
	const nameColor: ThemeColor = opts.frozen ? "dim" : running ? "accent" : v.status === "complete" ? "text" : "error";
	const icon = running ? theme.fg(opts.frozen ? "dim" : "accent", SPINNER[frame % SPINNER.length]) : v.status === "complete" ? theme.fg("success", "✓") : theme.fg("error", "✗");
	const brief = firstLine(v.task);
	let line = `${opts.selected ? theme.fg("accent", "▸") : " "} ${icon} ${theme.fg(nameColor, theme.bold(v.id))}`;
	if (brief) line += `${theme.fg(nameColor, ":")} ${theme.fg(opts.frozen ? "dim" : "muted", truncateToWidth(brief, Math.max(16, Math.min(56, width - 60)), "…"))}`;
	line += ` ${ctxBadge(v, theme)}`;
	line += `${DOT}${theme.fg("dim", fmtElapsed(v.durationMs))}`;
	if (v.toolCalls.length) line += `${DOT}${theme.fg("dim", `${v.toolCalls.length} ⚙`)}`;
	if (v.cost > 0) line += `${DOT}${theme.fg("warning", `$${v.cost < 0.01 ? v.cost.toFixed(4) : v.cost.toFixed(2)}`)}`;
	const rows = [line];
	if (opts.hook !== false && running) {
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

type Mode = "list" | "detail" | "steer";

export class Inspector implements Component {
	private mode: Mode;
	private selected = 0;
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
		this.mode = this.ids.length === 1 ? "detail" : "list";
		this.timer = setInterval(() => {
			this.frame++;
			this.refreshIds();
			this.requestRender();
		}, TICK_MS);
	}

	dispose() {
		clearInterval(this.timer);
	}

	private refreshIds() {
		const running = this.src.running();
		const finished = this.src.all().filter((v) => v.status !== "running").slice(-5);
		this.ids = [...running, ...finished].map((v) => v.id);
		if (this.selected >= this.ids.length) this.selected = Math.max(0, this.ids.length - 1);
	}

	private current(): RunView | undefined {
		const id = this.ids[this.selected];
		return id ? this.src.all().find((v) => v.id === id) : undefined;
	}

	handleInput(data: string): void {
		if (this.mode === "steer") {
			if (matchesKey(data, "escape")) {
				this.mode = "detail";
				this.steerText = "";
			} else if (matchesKey(data, "enter")) {
				const v = this.current();
				const msg = this.steerText.trim();
				this.mode = "detail";
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
		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			if (this.mode === "detail" && this.ids.length > 1) {
				this.mode = "list";
				this.scrollFromTail = 0;
			} else this.done(undefined);
		} else if (matchesKey(data, "up")) {
			if (this.mode === "list") this.selected = Math.max(0, this.selected - 1);
			else this.scrollFromTail++;
		} else if (matchesKey(data, "down")) {
			if (this.mode === "list") this.selected = Math.min(this.ids.length - 1, this.selected + 1);
			else this.scrollFromTail = Math.max(0, this.scrollFromTail - 1);
		} else if (matchesKey(data, "enter") || matchesKey(data, "space")) {
			if (this.mode === "list" && this.ids.length) {
				this.mode = "detail";
				this.scrollFromTail = 0;
			}
		} else if (matchesKey(data, "s")) {
			const v = this.current();
			if (v && v.status !== "running" && !this.src.all().some((r) => r.id === v.id)) return;
			if (v) {
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
				this.notice = `pi --session ${v.sessionFile.replace(process.env.HOME ?? "", "~")}  (copied to editor)`;
			}
		}
		this.requestRender();
	}

	invalidate() {}

	render(width: number): string[] {
		// The overlay hands us its own width; fill it exactly so nothing beneath shows through.
		const w = Math.max(40, width);
		const inner = w - 4;
		if (this.mode === "list") return this.renderList(w, inner);
		return this.renderDetail(w, inner);
	}

	private renderList(w: number, inner: number): string[] {
		const all = this.src.all();
		const body: string[] = [];
		const running = this.ids.filter((id) => all.find((v) => v.id === id)?.status === "running");
		const done = this.ids.filter((id) => !running.includes(id));
		if (!this.ids.length) body.push(theme(this.theme, "dim", "no runs this session"));
		if (running.length) body.push(theme(this.theme, "dim", "running"));
		for (const id of running) {
			const v = all.find((x) => x.id === id)!;
			body.push(...progressRow(v, this.theme, this.frame, inner, { selected: this.ids[this.selected] === id }));
		}
		if (done.length) body.push(theme(this.theme, "dim", "recent"));
		for (const id of done) {
			const v = all.find((x) => x.id === id)!;
			body.push(...progressRow(v, this.theme, this.frame, inner, { selected: this.ids[this.selected] === id, frozen: true, hook: false }));
		}
		body.push("", this.keys(["↑↓ move", "enter/space open", "s steer", "c cancel", "o session", "q close"]));
		const header = `${this.theme.fg("accent", "◆")} ${this.theme.fg("toolTitle", this.theme.bold("delegate"))}${this.theme.fg("muted", ` · ${running.length} running · ${done.length} recent`)}`;
		return frame(header, body, "border", this.theme, w);
	}

	private renderDetail(w: number, inner: number): string[] {
		const v = this.current();
		if (!v) return frame(`${this.theme.fg("accent", "◆")} delegate`, [theme(this.theme, "dim", "run gone")], "border", this.theme, w);
		const items = this.src.activity(v.id);
		const lines: string[] = [];
		for (const it of items) {
			if (it.kind === "tool") lines.push(`${this.theme.fg("muted", "→ ")}${formatToolCall(it.name, it.args, this.theme)}`);
			else if (it.kind === "user") for (const l of wrapTextWithAnsi(this.theme.fg("dim", `▸ ${firstLine(it.text)}`), inner)) lines.push(l);
			else for (const l of wrapTextWithAnsi(`${this.theme.fg("accent", "▎")} ${this.theme.fg("toolOutput", it.text.trim())}`, inner)) lines.push(l);
		}
		const maxRows = Math.max(6, Math.min(30, lines.length));
		const end = Math.max(0, lines.length - this.scrollFromTail);
		const start = Math.max(0, end - maxRows);
		const visible = lines.slice(start, end);
		if (start > 0) visible.unshift(this.theme.fg("dim", `… ${start} earlier`));
		if (!visible.length) visible.push(this.theme.fg("dim", v.status === "running" ? "waiting for first tool call…" : "(no activity recorded)"));

		const body: string[] = [];
		body.push(...progressRow(v, this.theme, this.frame, inner, { hook: false }));
		body.push(this.theme.fg("dim", `${v.model}${v.thinking ? `:${v.thinking}` : ""}${v.changedFiles.length ? `  changed: ${v.changedFiles.join(", ")}` : ""}`));
		body.push(this.theme.fg("border", "─".repeat(inner)));
		body.push(...visible);
		const live = v.status === "running" ? this.theme.fg("accent", `${SPINNER[this.frame % SPINNER.length]} live`) : this.theme.fg("dim", v.status);
		const tail = this.scrollFromTail ? this.theme.fg("warning", `  ↓ ${this.scrollFromTail} below`) : "";
		body.push(`${" ".repeat(Math.max(0, inner - visibleWidth(live) - visibleWidth(tail)))}${live}${tail}`);
		body.push(this.theme.fg("border", "─".repeat(inner)));
		if (this.mode === "steer") {
			body.push(`${this.theme.fg("accent", "steer ▸ ")}${this.steerText}${this.theme.fg("dim", "▏")}`);
			body.push(this.theme.fg("dim", "enter send · esc cancel"));
		} else {
			if (this.notice) body.push(this.theme.fg("warning", truncateToWidth(this.notice, inner, "…")));
			body.push(this.keys(["↑↓ scroll", "s steer", v.status === "running" ? "c cancel" : "", "o session", this.ids.length > 1 ? "q back" : "q close"].filter(Boolean)));
		}
		const header = `${this.theme.fg("accent", "◆")} ${this.theme.fg("toolTitle", this.theme.bold(v.id))}${this.theme.fg("muted", `: ${truncateToWidth(firstLine(v.task), 50, "…")}`)}`;
		return frame(header, body, v.status === "running" ? "border" : v.status === "complete" ? "border" : "error", this.theme, w);
	}

	private keys(items: string[]): string {
		return this.theme.fg("dim", items.join("   "));
	}
}

function theme(t: Theme, color: ThemeColor, s: string): string {
	return t.fg(color, s);
}
