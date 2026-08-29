/**
 * pi-atta — @@ session picker for pi
 *
 * Amp-style "Mention Thread" modal: filterable session list with
 * highlighted selection, word-wrapped preview pane with scrollbar.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey, Input, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { execSync } from "node:child_process";
import { statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";

// ── Types ─────────────────────────────────────────────────────────

interface SessionInfo {
	path: string;
	id: string;
	cwd: string;
	timestamp: string;
	name?: string;
	preview?: string;
}

interface PreviewMsg {
	role: string;
	text: string;
}

type PickerResult = SessionInfo | null;

// ── Session cache ─────────────────────────────────────────────────

const SESSIONS_DIR = join(process.env.HOME || "~", ".pi/agent/sessions");
const CACHE_TTL = 60_000;

let cache: SessionInfo[] = [];
let cacheTime = 0;
let loading = false;

function parseSessionFile(file: string): SessionInfo | null {
	try {
		const head = execSync(`head -20 '${file}'`, { encoding: "utf8", timeout: 500 });
		let header: any = null;
		let name: string | undefined;
		let preview: string | undefined;

		for (const line of head.split("\n")) {
			if (!line.trim()) continue;
			try {
				const e = JSON.parse(line);
				if (e.type === "session" && !header) header = e;
				else if (e.type === "session_info" && e.name) name = e.name;
				else if (e.type === "message" && e.message?.role === "user" && !preview) {
					const c = e.message.content;
					if (typeof c === "string") preview = c.slice(0, 100);
					else if (Array.isArray(c)) {
						const tb = c.find((x: any) => x.type === "text");
						if (tb?.text) preview = tb.text.slice(0, 100);
					}
				}
			} catch { /* skip */ }
		}

		if (header?.type !== "session") return null;
		return { path: file, id: header.id || "", cwd: header.cwd || "", timestamp: header.timestamp || "", name, preview };
	} catch { return null; }
}

function warmCache(): void {
	if (loading || (cache.length > 0 && Date.now() - cacheTime < CACHE_TTL)) return;
	loading = true;
	setImmediate(() => {
		try {
			const files = execSync(
				`rg -l '"type":"session"' "${SESSIONS_DIR}" --glob '*.jsonl' 2>/dev/null | head -300`,
				{ encoding: "utf8", timeout: 5_000 }
			).trim().split("\n").filter(Boolean);
			const sessions: SessionInfo[] = [];
			for (const file of files) {
				const s = parseSessionFile(file);
				if (s) sessions.push(s);
			}
			sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
			cache = sessions;
			cacheTime = Date.now();
		} catch { /* ignore */ }
		loading = false;
	});
}

function getSessions(): SessionInfo[] {
	if (cache.length > 0 && Date.now() - cacheTime < CACHE_TTL) return cache;
	try {
		const files = execSync(
			`rg -l '"type":"session"' "${SESSIONS_DIR}" --glob '*.jsonl' 2>/dev/null | head -300`,
			{ encoding: "utf8", timeout: 8_000 }
		).trim().split("\n").filter(Boolean);
		const sessions: SessionInfo[] = [];
		for (const file of files) {
			const s = parseSessionFile(file);
			if (s) sessions.push(s);
		}
		sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
		cache = sessions;
		cacheTime = Date.now();
		return sessions;
	} catch { return []; }
}

/** Load session messages — reads only first 100KB */
function loadPreviewMsgs(session: SessionInfo, maxMsgs = 40): PreviewMsg[] {
	const result: PreviewMsg[] = [];
	try {
		const size = statSync(session.path).size;
		const readSize = Math.min(size, 100 * 1024);
		const fd = openSync(session.path, "r");
		const buf = Buffer.alloc(readSize);
		readSync(fd, buf, 0, readSize, 0);
		closeSync(fd);

		for (const line of buf.toString("utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				const e = JSON.parse(line);
				if (e.type !== "message") continue;
				const msg = e.message;
				let text = "";
				if (typeof msg.content === "string") text = msg.content;
				else if (Array.isArray(msg.content)) {
					for (const c of msg.content) {
						if (c.type === "text") { text = c.text; break; }
					}
				}
				const flat = text.replace(/\s+/g, " ").trim();
				if (flat) {
					result.push({ role: msg.role, text: flat });
					if (result.length >= maxMsgs) break;
				}
			} catch { /* skip */ }
		}
	} catch { /* ignore */ }
	return result;
}

// ── Helpers ───────────────────────────────────────────────────────

function vw(s: string): number {
	return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function pad(s: string, w: number): string {
	const diff = w - vw(s);
	return diff > 0 ? s + " ".repeat(diff) : s;
}

function trunc(s: string, w: number): string {
	if (vw(s) <= w) return s;
	let result = "";
	let width = 0;
	for (const char of s) {
		const cw = char.charCodeAt(0) > 255 ? 2 : 1;
		if (width + cw > w - 1) break;
		result += char;
		width += cw;
	}
	return result + "…";
}

function relTime(timestamp: string): string {
	const diffMs = Date.now() - new Date(timestamp).getTime();
	const mins = Math.floor(diffMs / 60000);
	if (mins < 1) return "now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	const weeks = Math.floor(days / 7);
	if (weeks < 5) return `${weeks}w ago`;
	return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function sessionTitle(s: SessionInfo): string {
	if (s.name) return s.name;
	if (s.preview) return s.preview;
	const parts = s.cwd.split("/");
	let dir = parts[parts.length - 1] || s.cwd;
	if (dir.startsWith("--")) dir = dir.replace(/^--/, "").replace(/--$/, "").replace(/-/g, "/");
	return dir;
}

function matchesFilter(s: SessionInfo, q: string): boolean {
	if (!q) return true;
	const lq = q.toLowerCase();
	return !!(s.name?.toLowerCase().includes(lq) || s.preview?.toLowerCase().includes(lq) || s.cwd.toLowerCase().includes(lq) || s.id.toLowerCase().includes(lq));
}

// ── Modal Component ───────────────────────────────────────────────

class SessionPickerModal implements Component {
	private all: SessionInfo[] = [];
	private filtered: SessionInfo[] = [];
	private filterInput: Input;
	private sel = 0;
	private scroll = 0;
	private theme: Theme;
	private cwd: string;
	private loaded = false;
	private tui: TUI;
	private onDone: (r: PickerResult) => void;
	private showAll = false;

	private previewMsgs: PreviewMsg[] = [];
	private previewScroll = 0;
	private previewId: string | null = null;

	/** Keys the overlay stole from the prompt while open */
	leftover = "";

	constructor(tui: TUI, theme: Theme, cwd: string, onDone: (r: PickerResult) => void) {
		this.tui = tui;
		this.theme = theme;
		this.cwd = cwd;
		this.onDone = onDone;
		this.filterInput = new Input();
		this.startLoad();
	}

	private startLoad() {
		const apply = () => {
			this.applyFilter();
			this.loaded = true;
			this.tui.requestRender();
		};
		if (cache.length > 0 && Date.now() - cacheTime < CACHE_TTL) {
			this.all = cache;
			apply();
			return;
		}
		setImmediate(() => { this.all = getSessions(); apply(); });
	}

	private applyFilter() {
		let list = this.all;
		if (!this.showAll) list = list.filter(s => s.cwd.startsWith(this.cwd));
		const q = this.filterInput.getValue().trim();
		if (q) list = list.filter(s => matchesFilter(s, q));
		this.filtered = list;
		this.sel = 0;
		this.scroll = 0;
		this.loadPreview();
	}

	private loadPreview() {
		const s = this.filtered[this.sel];
		if (!s) { this.previewMsgs = []; this.previewRendered = []; this.previewId = null; this.previewScroll = 0; return; }
		if (s.id === this.previewId) return;
		this.previewId = s.id;
		// -1 = sentinel: pin to latest (bottom) on next render
		this.previewScroll = -1;
		this.previewMsgs = loadPreviewMsgs(s);
	}

	/** Wrap + color messages into renderable preview lines at exact pane width */
	private buildPreviewLines(wrapW: number): string[] {
		const t = this.theme;
		const out: string[] = [];
		const w = Math.max(20, wrapW);
		for (const m of this.previewMsgs) {
			if (m.role === "user") {
				// Green left bar; continuations align under the bar text
				const bar = t.fg("success", "▎");
				for (const wl of wrapTextWithAnsi(t.fg("success", m.text), w - 2)) {
					out.push(`${bar} ${wl}`);
				}
			} else if (m.role === "assistant") {
				// Flush left, full width
				for (const wl of wrapTextWithAnsi(m.text, w)) {
					out.push(wl);
				}
			} else {
				for (const wl of wrapTextWithAnsi(t.fg("dim", m.text), w)) {
					out.push(wl);
				}
			}
			out.push("");
		}
		return out;
	}

	/** Visible list rows sized to the terminal, leaving margin */
	private listRows(): number {
		const rows = this.tui.terminal?.rows ?? 24;
		return Math.max(8, Math.min(24, rows - 16));
	}

	private ensureVisible() {
		const lr = this.listRows();
		if (this.sel < this.scroll) this.scroll = this.sel;
		else if (this.sel >= this.scroll + lr) this.scroll = this.sel - lr + 1;
	}

	handleInput(data: string) {
		if (matchesKey(data, Key.escape)) { this.onDone(null); return; }
		if (matchesKey(data, Key.enter)) { this.onDone(this.filtered[this.sel] ?? null); return; }
		if (matchesKey(data, Key.tab)) { this.showAll = !this.showAll; this.applyFilter(); return; }
		if (matchesKey(data, Key.up) && this.sel > 0) { this.sel--; this.ensureVisible(); this.loadPreview(); return; }
		if (matchesKey(data, Key.down) && this.sel < this.filtered.length - 1) { this.sel++; this.ensureVisible(); this.loadPreview(); return; }
		const lr = this.listRows();
		const maxScroll = Math.max(0, this.buildPreviewLines(60).length - lr);
		if (this.previewScroll < 0) this.previewScroll = maxScroll;
		if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.shift("up"))) {
			this.previewScroll = Math.max(0, this.previewScroll - lr);
			return;
		}
		if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.shift("down"))) {
			this.previewScroll = Math.min(maxScroll, this.previewScroll + lr);
			return;
		}
		this.filterInput.handleInput(data);
		this.leftover = this.filterInput.getValue();
		this.applyFilter();
	}

	invalidate() { this.filterInput.invalidate?.(); }

	render(width: number): string[] {
		const t = this.theme;
		const dim = (s: string) => t.fg("dim", s);
		// Exact geometry: every row is exactly W visible chars, fixed cap so
		// the overlay reservation and the render always agree
		const W = Math.min(width - 2, 140);
		const PW = Math.max(50, Math.floor(W * 0.58)); // right box outer width
		const LW = W - PW - 1;                          // left cell width incl. its border
		const LIST_ROWS = this.listRows();
		// Raw structural chars — theme-independent so compositing never breaks
		const border = (s: string) => s;
		// Theme-independent inverse video for the selected row
		const invert = (s: string) => `\x1b[7m${s}\x1b[27m`;

		// Cell builders — always exactly LW / PW visible wide
		const leftCell = (content: string) => border("│") + pad(trunc(content, LW - 1), LW - 1);
		const rightCell = (inner: string, bc = "│") => border("│") + pad(trunc(inner, PW - 2), PW - 2) + border(bc);

		const lines: string[] = [];

		// ── Top border with embedded title + count ──────────────
		const title = ` ${t.fg("accent", t.bold("Session History"))} `;
		const countStr = this.loaded ? dim(`(${this.filtered.length}) `) : "";
		const topUsed = 1 + vw(title) + vw(countStr);
		lines.push(border("╭") + title + countStr + border("─".repeat(Math.max(0, W - topUsed - 1)) + "╮"));

		// ── Search row ──────────────────────────────────────────
		const fv = this.filterInput.getValue();
		const search = ` ${t.fg("accent", ">")} ${fv ? t.fg("accent", fv) : dim("")}▋`;
		lines.push(leftCell(search) + " " + rightCell(""));

		// ── Preview header row ──────────────────────────────────
		const prevHeader = dim("Session Preview");
		const phPad = Math.max(0, Math.floor((PW - 2 - vw(prevHeader)) / 2));
		lines.push(leftCell("") + " " + rightCell(" ".repeat(phPad) + prevHeader));

		// Build wrapped preview lines at exact inner width
		const rendered = this.buildPreviewLines(PW - 2);

		// Resolve "pin to latest" sentinel now that we know the wrapped length
		if (this.previewScroll < 0) this.previewScroll = Math.max(0, rendered.length - LIST_ROWS);

		// Scrollbar math
		const totalP = rendered.length;
		const thumbSize = totalP > LIST_ROWS ? Math.max(1, Math.round((LIST_ROWS * LIST_ROWS) / totalP)) : 0;
		const thumbStart = totalP > LIST_ROWS ? Math.round((this.previewScroll / totalP) * LIST_ROWS) : -1;

		for (let i = 0; i < LIST_ROWS; i++) {
			// Left: list row
			let left: string;
			const idx = this.scroll + i;
			if (!this.loaded) {
				left = i === 0 ? ` ${dim("Loading…")}` : "";
			} else if (idx < this.filtered.length) {
				const s = this.filtered[idx];
				const isSel = idx === this.sel;
				const time = relTime(s.timestamp);
				const titleW = LW - 2 - vw(time) - 1;
				const titleTxt = trunc(sessionTitle(s), Math.max(10, titleW));
				const row = ` ${titleTxt} ${dim(time)}`;
				// Selected: full-width inverse-video bar; unselected: border + content. Both exactly LW wide.
				left = isSel
					? invert(pad(row, LW))
					: border("│") + pad(row, LW - 1);
			} else {
				left = leftCell("");
			}

			// Right: preview row
			const inner = this.loaded ? (rendered[this.previewScroll + i] ?? "") : (i === 0 ? dim(" Loading…") : "");
			const inThumb = thumbStart >= 0 && i >= thumbStart && i < thumbStart + thumbSize;
			lines.push(left + " " + rightCell(inner, inThumb ? "┃" : "│"));
		}

		// ── Preview box bottom ──────────────────────────────────
		lines.push(leftCell("") + " " + border("╰") + border("─".repeat(PW - 2)) + border("╯"));

		// ── Bottom border with key hints ────────────────────────
		const hints = ` ${t.fg("accent", "Tab")}${dim(" workspaces")} · ${t.fg("accent", "PgUp/PgDn")}${dim(" scroll preview")} · ${t.fg("accent", "Esc")}${dim(" close")} `;
		const botDash = Math.max(0, W - vw(hints) - 1);
		lines.push(border("╰" + "─".repeat(botDash) + hints + "╯"));

		return lines;
	}
}

// ── Extension ─────────────────────────────────────────────────────

export default function attaExtension(pi: ExtensionAPI): void {
	let pickerActive = false;
	let lastTui: any = null;

	async function showPicker(ctx: ExtensionContext): Promise<{ session: SessionInfo; leftover: string } | null> {
		if (pickerActive) return null;
		pickerActive = true;
		try {
			let modal: SessionPickerModal | null = null;
			const session = await ctx.ui.custom<PickerResult | undefined>(
				(tui, theme, _kb, done) => {
					lastTui = tui;
					modal = new SessionPickerModal(tui, theme, ctx.cwd, (r) => done(r));
					return modal;
				},
				{ overlay: true, overlayOptions: { anchor: "center", width: 142, maxHeight: (process.stdout.rows || 40) - 6 } }
			) ?? null;
			if (!session) return null;
			return { session, leftover: modal?.leftover ?? "" };
		} finally { pickerActive = false; }
	}

	function insertRef(ctx: ExtensionContext, session: SessionInfo, leftover: string) {
		const ref = `@session:${session.path}`;
		let next = ctx.ui.getEditorText();
		if (next.includes("@@")) next = next.replace("@@", ref);
		else if (next.includes("@")) next = next.replace("@", ref);
		else next = `${next}${ref}`;
		// Re-append keystrokes the overlay stole into its filter box
		const lo = leftover.trim();
		if (lo && !next.includes(lo)) next = `${next} ${lo}`;
		ctx.ui.setEditorText(next);
		if (lastTui) lastTui.requestRender(true);
	}

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.hasUI) warmCache();
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		let recentAt = 0;

		ctx.ui.onTerminalInput((data) => {
			if (data !== "@") return;
			const now = Date.now();
			if (now - recentAt < 500) {
				recentAt = 0;
				showPicker(ctx).then(({ session, leftover }) => {
					if (session) insertRef(ctx, session, leftover);
				}).catch(() => {});
				return;
			}
			recentAt = now;
		});
	});

	pi.registerCommand("atta", {
		description: "Open session picker",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) { ctx.ui.notify("Requires interactive mode", "error"); return; }
			const result = await showPicker(ctx);
			if (result) insertRef(ctx, result.session, "");
		},
	});
}
