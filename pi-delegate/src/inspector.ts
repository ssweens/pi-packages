/** Live work stays pinned; history is on demand. Both open the same child conversation. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { type Component, Editor, type Focusable, Markdown, matchesKey, SelectList, type TUI, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { elapsed, formatToolCall, frame, runTitle, type RunView } from "./render.js";

export interface LiveSource {
	all(): RunView[];
	activity(id: string): ActivityItem[];
	subscribe(listener: () => void): () => void;
	steer(id: string, message: string): Promise<void>;
	cancel(id: string): Promise<void>;
}

export type ActivityItem =
	| { kind: "tool"; name: string; args: Record<string, unknown> }
	| { kind: "result"; text: string; isError: boolean }
	| { kind: "text"; text: string }
	| { kind: "user"; text: string };

const TICK_MS = 250;
const LIST_ROWS = 4;

function icon(v: RunView, theme: Theme): string {
	if (v.status === "running") return theme.fg("accent", "●");
	if (v.status === "complete") return theme.fg("success", "✓");
	return theme.fg(v.status === "error" ? "error" : "warning", v.status === "error" ? "✗" : "⊘");
}

function pad(text: string, width: number): string {
	const clipped = truncateToWidth(text, Math.max(0, width), "…");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/** Replace the frame's bottom border with its navigation legend. */
function withLegend(lines: string[], legend: string, theme: Theme, width: number): string[] {
	if (width < 8) return lines;
	const label = truncateToWidth(` ${legend} `, width - 4, "…");
	lines[lines.length - 1] = theme.fg("borderMuted", "╰─") + theme.fg("dim", label) + theme.fg("borderMuted", "─".repeat(Math.max(0, width - 3 - visibleWidth(label))) + "╯");
	return lines;
}

/** Only live executions stay pinned. Selection stays on its child while that child remains active. */
export class AgentsPanel implements Component, Focusable {
	focused = false;
	private selectedId?: string;
	private offset = 0;
	private previousFocus: Component | null = null;
	private timer?: ReturnType<typeof setInterval>;
	private unsubscribe: () => void;
	private removeInputListener: () => void;
	private opening = false;

	constructor(private src: LiveSource, private theme: Theme, private tui: TUI, private openChild: (id: string) => Promise<void>) {
		this.unsubscribe = src.subscribe(() => this.update());
		// Fullscreen transcript navigation runs before focused-component input. Consume list
		// navigation here so Home/PageDown cannot move the parent transcript behind the list.
		this.removeInputListener = tui.addInputListener((data) => {
			if (!this.focused || tui.hasOverlay()) return;
			this.handleInput(data);
			return { consume: true };
		});
		this.update();
	}

	private rows(): RunView[] {
		return this.src.all().filter((r) => !r.settled);
	}

	focus() {
		if (this.opening || this.tui.hasOverlay()) return;
		if (this.focused) { this.release(); return; }
		if (!this.rows().length) return;
		// Both Pi renderers expose this public TuiBase method; the TUI interface omits it.
		this.previousFocus = (this.tui as TUI & { getFocusedComponent(): Component | null }).getFocusedComponent();
		this.tui.setFocus(this);
		this.tui.requestRender();
	}

	private release() {
		this.tui.setFocus(this.previousFocus);
		this.tui.requestRender();
	}

	private update() {
		const active = this.src.all().some((v) => !v.settled);
		if (active && !this.timer) this.timer = setInterval(() => this.tui.requestRender(), TICK_MS);
		if (!active && this.timer) { clearInterval(this.timer); this.timer = undefined; }
		if (!active && this.focused && !this.opening) this.release();
		this.tui.requestRender();
	}

	handleInput(data: string) {
		const rows = this.rows();
		let index = Math.max(0, rows.findIndex((r) => r.id === this.selectedId));
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+j")) { this.release(); return; }
		if (matchesKey(data, "up")) index--;
		else if (matchesKey(data, "down")) index++;
		else if (matchesKey(data, "pageUp")) index -= LIST_ROWS;
		else if (matchesKey(data, "pageDown")) index += LIST_ROWS;
		else if (matchesKey(data, "home")) index = 0;
		else if (matchesKey(data, "end")) index = rows.length - 1;
		else if (matchesKey(data, "enter") && rows[index] && !this.opening) {
			this.selectedId = rows[index].id;
			this.opening = true;
			void this.openChild(this.selectedId).finally(() => {
				this.opening = false;
				this.release();
			});
			return;
		}
		this.selectedId = rows[Math.max(0, Math.min(rows.length - 1, index))]?.id;
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const rows = this.rows();
		if (!rows.length) return [];
		const index = Math.max(0, rows.findIndex((r) => r.id === this.selectedId));
		this.selectedId = rows[index].id;
		const count = Math.min(LIST_ROWS, Math.max(1, this.tui.terminal.rows - 10), rows.length);
		this.offset = Math.max(0, Math.min(this.offset, index, rows.length - count));
		if (index >= this.offset + count) this.offset = index - count + 1;
		const inner = Math.max(1, width - 4);
		const body = rows.slice(this.offset, this.offset + count).map((v) => {
			const selected = this.focused && v.id === this.selectedId;
			const prefix = `${selected ? this.theme.fg("accent", "›") : " "} ${icon(v, this.theme)} `;
			const time = elapsed(v.durationMs);
			const title = this.theme.fg(selected ? "accent" : "text", runTitle(v));
			if (inner < 65) return pad(`${prefix}${title}`, Math.max(1, inner - time.length - 1)) + ` ${time}`;
			const roleWidth = 12;
			const titleWidth = Math.min(36, Math.floor(inner * 0.38));
			const activityWidth = Math.max(1, inner - 4 - titleWidth - roleWidth - time.length - 3);
			const activity = v.status === "running"
				? v.activeTool ? formatToolCall(v.activeTool.name, v.activeTool.args, this.theme) : this.theme.fg("dim", "Thinking…")
				: this.theme.fg("warning", "Stopping…");
			return prefix + pad(title, titleWidth) + " " + pad(this.theme.fg("muted", v.role), roleWidth) + " " + pad(activity, activityWidth) + " " + this.theme.fg("dim", time);
		});
		const range = rows.length > count ? ` · ${this.offset + 1}–${this.offset + count}/${rows.length}` : "";
		const header = this.theme.bold("Agents") + this.theme.fg("muted", ` · ${rows.length} active${range}`);
		const hint = this.focused ? "↑↓ select · Enter open · Esc editor" : "Ctrl+J focus agents · /agents history";
		return withLegend(frame(header, body.map((l) => truncateToWidth(l, inner, "…")), this.focused ? "borderAccent" : "borderMuted", this.theme, width), hint, this.theme, width);
	}

	invalidate() {}
	dispose() {
		if (this.focused) this.release();
		if (this.timer) clearInterval(this.timer);
		this.unsubscribe();
		this.removeInputListener();
	}
}

/** A snapshot picker, not another persistent dashboard. Selecting a row only opens its transcript. */
export class AgentHistory implements Component {
	private list: SelectList;

	constructor(runs: RunView[], private theme: Theme, private tui: TUI, done: (id?: string) => void) {
		this.list = new SelectList(runs.map((v) => ({
			value: v.id,
			label: `${icon(v, theme)} ${runTitle(v)}`,
			description: `${v.role} · ${v.status} · ${elapsed(v.durationMs)}`,
		})), Math.max(1, Math.min(8, tui.terminal.rows - 6)), {
			selectedPrefix: (s) => theme.fg("accent", s),
			selectedText: (s) => theme.fg("accent", s),
			description: (s) => theme.fg("muted", s),
			scrollInfo: (s) => theme.fg("dim", s),
			noMatch: (s) => theme.fg("dim", s),
		});
		this.list.onSelect = (item) => done(item.value);
		this.list.onCancel = () => done();
	}

	handleInput(data: string) { this.list.handleInput(data); this.tui.requestRender(); }
	render(width: number): string[] {
		return withLegend(frame(this.theme.bold("Finished agents"), this.list.render(Math.max(1, width - 4)), "borderAccent", this.theme, width), "↑↓ select · Enter open · Esc back", this.theme, width);
	}
	invalidate() { this.list.invalidate(); }
}

/** Full-viewport detail. The parent's editor instance, draft, and cursor are never replaced. */
export class ChildView implements Component, Focusable {
	private editor: Editor;
	private top: number | undefined;
	private pageRows = 1;
	private notice = "";
	private sending = false;
	private cache?: { revision: number; width: number; lines: string[] };
	private unsubscribe: () => void;
	private timer: ReturnType<typeof setInterval>;

	get focused() { return this.editor.focused; }
	set focused(value: boolean) { this.editor.focused = value; }

	constructor(private id: string, private src: LiveSource, private theme: Theme, private tui: TUI, private done: () => void, draft: string, private saveDraft: (text: string) => void) {
		this.editor = new Editor(tui, {
			borderColor: (s) => theme.fg("borderMuted", s),
			selectList: {
				selectedPrefix: (s) => theme.fg("accent", s), selectedText: (s) => theme.fg("accent", s),
				description: (s) => theme.fg("muted", s), scrollInfo: (s) => theme.fg("dim", s), noMatch: (s) => theme.fg("dim", s),
			},
		});
		this.editor.setText(draft);
		this.editor.onSubmit = (text) => { void this.send(text); };
		this.unsubscribe = src.subscribe(() => tui.requestRender());
		this.timer = setInterval(() => { if (this.current()?.status === "running") tui.requestRender(); }, TICK_MS);
	}

	private current() { return this.src.all().find((v) => v.id === this.id); }

	private async send(text: string) {
		if (!text.trim() || this.sending) return;
		this.sending = true;
		this.editor.disableSubmit = true;
		const running = this.current()?.status === "running";
		this.notice = "Sending…";
		this.tui.requestRender();
		try {
			await this.src.steer(this.id, text);
			this.notice = running ? "Message queued for the child's next turn." : "Child resumed in the same session.";
			this.top = undefined;
		} catch (e) {
			this.editor.setText(text);
			this.notice = `Message not sent: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			this.sending = false;
			this.editor.disableSubmit = false;
			this.tui.requestRender();
		}
	}

	handleInput(data: string) {
		if (matchesKey(data, "escape")) { this.done(); return; }
		if (matchesKey(data, "pageUp")) this.top = Math.max(0, (this.top ?? Math.max(0, (this.cache?.lines.length ?? 0) - this.pageRows)) - this.pageRows);
		else if (matchesKey(data, "pageDown")) {
			const next = (this.top ?? 0) + this.pageRows;
			this.top = next >= (this.cache?.lines.length ?? 0) - this.pageRows ? undefined : next;
		} else if (matchesKey(data, "ctrl+end")) this.top = undefined;
		else if (matchesKey(data, "ctrl+x")) {
			if (this.current()?.status === "running") {
				this.notice = "Stopping this child…";
				void this.src.cancel(this.id).then(() => { this.notice = "Child stopped."; this.tui.requestRender(); }).catch((e) => { this.notice = String(e); this.tui.requestRender(); });
			}
		} else this.editor.handleInput(data);
		this.tui.requestRender();
	}

	private activityLines(v: RunView, width: number): string[] {
		if (this.cache?.revision === v.revision && this.cache.width === width) return this.cache.lines;
		const lines: string[] = [];
		for (const item of this.src.activity(this.id)) {
			if (item.kind === "tool") {
				lines.push(this.theme.fg("accent", `→ ${item.name}`));
				lines.push(...wrapTextWithAnsi(this.theme.fg("muted", JSON.stringify(item.args, null, 2)), width));
			} else if (item.kind === "text") {
				lines.push(...new Markdown(item.text, 0, 0, getMarkdownTheme()).render(width));
			} else {
				const color = item.kind === "user" ? "userMessageText" : item.isError ? "error" : "toolOutput";
				const text = item.kind === "user" ? `▸ ${item.text}` : item.text;
				lines.push(...wrapTextWithAnsi(this.theme.fg(color, text), width));
			}
			lines.push("");
		}
		this.cache = { revision: v.revision ?? 0, width, lines };
		return lines;
	}

	render(width: number): string[] {
		const height = Math.max(1, this.tui.terminal.rows);
		const v = this.current();
		if (!v) return [pad("Child unavailable · Esc parent", width), ...Array(Math.max(0, height - 1)).fill(" ".repeat(width))];
		const inner = Math.max(1, width - 4);
		const header = `${icon(v, this.theme)} ${this.theme.bold(runTitle(v))}${this.theme.fg("muted", ` · ${v.role}`)}`;
		const meta = `${v.status} · ${elapsed(v.durationMs)} · ${v.model}${v.thinking ? `:${v.thinking}` : ""}`;
		const head = frame(header, [truncateToWidth(meta, inner, "…")], "borderMuted", this.theme, width);
		const editor = this.editor.render(width);
		const footer = [
			...(this.notice ? [this.theme.fg("dim", this.notice)] : []),
			this.theme.fg("dim", "Esc parent · PgUp/PgDn scroll · Ctrl+X stop · Ctrl+End latest"),
			this.theme.fg("accent", `${v.stopped ? "Restart" : "Message"} ${v.role} · ${runTitle(v)}`),
			...editor,
		];
		this.pageRows = Math.max(1, height - head.length - footer.length);
		const lines = this.activityLines(v, Math.max(1, width - 2));
		const start = this.top === undefined ? Math.max(0, lines.length - this.pageRows) : Math.min(this.top, Math.max(0, lines.length - this.pageRows));
		const visible = lines.slice(start, start + this.pageRows).map((l) => ` ${l}`);
		while (visible.length < this.pageRows) visible.push("");
		// Every cell is covered: neither the parent transcript nor its agents frame shows through.
		return [...head, ...visible, ...footer].slice(-height).map((l) => pad(l, width));
	}

	invalidate() { this.cache = undefined; this.editor.invalidate(); }
	dispose() {
		this.saveDraft(this.editor.getExpandedText());
		clearInterval(this.timer);
		this.unsubscribe();
	}
}
