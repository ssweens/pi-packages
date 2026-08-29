/**
 * pi-atta — @@ session picker for pi
 *
 * Two-pane modal: session list + live preview.
 * Toggle between current workspace and all workspaces.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey, truncateToWidth, Input } from "@earendil-works/pi-tui";
import { execSync, readFileSync } from "node:child_process";
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

/** Load session preview content — reads only first 100KB */
function loadSessionPreview(session: SessionInfo, maxLines = 25): string[] {
	try {
		// Read only first 100KB to avoid loading huge session files
		const { openSync, readSync, closeSync, statSync } = require("fs");
		const size = statSync(session.path).size;
		const readSize = Math.min(size, 100 * 1024);
		const fd = openSync(session.path, "r");
		const buf = Buffer.alloc(readSize);
		readSync(fd, buf, 0, readSize, 0);
		closeSync(fd);
		const content = buf.toString("utf8");
		const lines = content.split("\n").slice(0, 200);
		const result: string[] = [];
		let count = 0;

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const e = JSON.parse(line);
				if (e.type === "message") {
					const msg = e.message;
					let text = "";
					if (typeof msg.content === "string") text = msg.content;
					else if (Array.isArray(msg.content)) {
						for (const c of msg.content) {
							if (c.type === "text") { text = c.text; break; }
						}
					}
					if (text) {
						const prefix = msg.role === "user" ? ">" : msg.role === "assistant" ? "<" : "-";
						const truncated = text.length > 100 ? text.slice(0, 97) + "..." : text;
						// Replace newlines with spaces for single-line display
						const flat = truncated.replace(/\n/g, " ").replace(/\s+/g, " ");
						result.push(`${prefix} ${flat}`);
						count++;
						if (count >= maxLines) break;
					}
				}
			} catch { /* skip */ }
		}

		return result.length > 0 ? result : ["(no messages)"];
	} catch {
		return ["(could not load)"];
	}
}

// ── Format helpers ────────────────────────────────────────────────

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
		if (width + cw > w - 3) break;
		result += char;
		width += cw;
	}
	return result + "...";
}

function formatTitle(s: SessionInfo): string {
	let title = s.name || s.preview || "";
	if (!title) {
		const parts = s.cwd.split("/");
		title = parts[parts.length - 1] || s.cwd.slice(0, 40);
		if (title.startsWith("--")) title = title.replace(/^--/, "").replace(/--$/, "").replace(/-/g, "/");
	}
	return title;
}

function matchesFilter(s: SessionInfo, q: string): boolean {
	if (!q) return true;
	const lq = q.toLowerCase();
	return !!(s.name?.toLowerCase().includes(lq) || s.preview?.toLowerCase().includes(lq) || s.cwd.toLowerCase().includes(lq) || s.id.toLowerCase().includes(lq));
}

// ── Modal Component ───────────────────────────────────────────────

const ROWS = 16;

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
	private previewLines: string[] = [];
	private previewId: string | null = null;

	constructor(tui: TUI, theme: Theme, cwd: string, onDone: (r: PickerResult) => void) {
		this.tui = tui;
		this.theme = theme;
		this.cwd = cwd;
		this.onDone = onDone;
		this.filterInput = new Input();
		this.startLoad();
	}

	private startLoad() {
		if (cache.length > 0 && Date.now() - cacheTime < CACHE_TTL) {
			this.all = cache;
			this.applyFilter();
			this.loaded = true;
			this.tui.requestRender();
			return;
		}
		setImmediate(() => {
			this.all = getSessions();
			this.applyFilter();
			this.loaded = true;
			this.tui.requestRender();
		});
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
		if (!s) { this.previewLines = []; this.previewId = null; return; }
		if (s.id === this.previewId) return;
		this.previewId = s.id;
		try {
			this.previewLines = loadSessionPreview(s, ROWS);
			if (this.previewLines.length === 0) this.previewLines = ['(empty session)'];
		} catch (err: any) {
			this.previewLines = [`Error: ${err?.message || String(err)}`];
		}
	}

	private ensureVisible() {
		if (this.sel < this.scroll) this.scroll = this.sel;
		else if (this.sel >= this.scroll + ROWS) this.scroll = this.sel - ROWS + 1;
	}

	handleInput(data: string) {
		if (matchesKey(data, Key.escape)) { this.onDone(null); return; }
		if (matchesKey(data, Key.enter)) { this.onDone(this.filtered[this.sel] ?? null); return; }
		if (matchesKey(data, Key.tab)) { this.showAll = !this.showAll; this.applyFilter(); return; }
		if (matchesKey(data, Key.up) && this.sel > 0) { this.sel--; this.ensureVisible(); this.loadPreview(); return; }
		if (matchesKey(data, Key.down) && this.sel < this.filtered.length - 1) { this.sel++; this.ensureVisible(); this.loadPreview(); return; }
		if (matchesKey(data, Key.pageUp)) { this.sel = Math.max(0, this.sel - ROWS); this.ensureVisible(); this.loadPreview(); return; }
		if (matchesKey(data, Key.pageDown)) { this.sel = Math.min(this.filtered.length - 1, this.sel + ROWS); this.ensureVisible(); this.loadPreview(); return; }
		this.filterInput.handleInput(data);
		this.applyFilter();
	}

	invalidate() { this.filterInput.invalidate?.(); }

	render(width: number): string[] {
		const t = this.theme;
		const W = Math.min(width - 2, 108);
		const LW = 44; // list width
		const PW = W - LW - 1; // preview width
		const lines: string[] = [];

		// ── Top border ──────────────────────────────────────────
		lines.push("┌" + "─".repeat(LW) + "┬" + "─".repeat(PW) + "┐");

		// ── Header ──────────────────────────────────────────────
		const mode = this.showAll ? "All Workspaces" : "This Workspace";
		lines.push("│" + pad(t.bold(" Session History"), LW) + "│" + pad(` ${t.fg("accent", mode)} `, PW) + "│");

		// ── Search ──────────────────────────────────────────────
		const fv = this.filterInput.getValue();
		const search = fv ? `Search: ${t.fg("accent", fv)}` : `Search: ${t.fg("dim", "...")}`;
		lines.push("│ " + pad(search, LW - 1) + "│" + pad(" Preview", PW) + "│");

		// ── Separator ───────────────────────────────────────────
		lines.push("├" + "─".repeat(LW) + "┼" + "─".repeat(PW) + "┤");

		// ── Content rows ────────────────────────────────────────
		for (let i = 0; i < ROWS; i++) {
			const idx = this.scroll + i;
			let left: string;
			let right: string;

			// Left: session list
			if (!this.loaded) {
				left = i === 0 ? " Loading..." : "";
			} else if (idx >= this.filtered.length) {
				left = "";
			} else {
				const s = this.filtered[idx];
				const isSel = idx === this.sel;
				const cursor = isSel ? t.fg("accent", "▸") : " ";
				const title = trunc(formatTitle(s), LW - 8);
				const date = s.timestamp.slice(0, 10);
				if (isSel) {
					left = `${cursor}${t.bold(title)}`;
				} else {
					left = `${cursor} ${title}`;
				}
			}

			// Right: preview
			if (!this.loaded) {
				right = i === 0 ? " Loading..." : "";
			} else if (i < this.previewLines.length) {
				const line = this.previewLines[i];
				const isUser = line.startsWith(">");
				const isAsst = line.startsWith("<");
				const prefix = isUser ? t.fg("accent", ">") : isAsst ? t.fg("dim", "<") : "-";
				const content = line.slice(2);
				right = `${prefix} ${trunc(content, PW - 3)}`;
			} else {
				right = "";
			}

			lines.push("│" + pad(left, LW) + "│" + pad(right, PW) + "│");
		}

		// ── Separator ───────────────────────────────────────────
		lines.push("├" + "─".repeat(LW) + "┼" + "─".repeat(PW) + "┤");

		// ── Footer ──────────────────────────────────────────────
		const count = this.loaded ? `${this.filtered.length} sessions` : "...";
		const help = "↑↓ nav  Tab workspace  Enter select  Esc cancel";
		lines.push("│" + pad(` ${t.fg("dim", count)}  ${t.fg("dim", help)}`, LW + PW + 1) + "│");

		// ── Bottom border ───────────────────────────────────────
		lines.push("└" + "─".repeat(LW) + "┴" + "─".repeat(PW) + "┘");

		return lines;
	}
}

// ── Extension ─────────────────────────────────────────────────────

export default function attaExtension(pi: ExtensionAPI): void {
	let pickerActive = false;
	let lastTui: any = null;

	async function showPicker(ctx: ExtensionContext): Promise<PickerResult> {
		if (pickerActive) return null;
		pickerActive = true;
		try {
			return await ctx.ui.custom<PickerResult | undefined>(
				(tui, theme, _kb, done) => {
					lastTui = tui;
					return new SessionPickerModal(tui, theme, ctx.cwd, (r) => done(r));
				},
				{ overlay: true, overlayOptions: { anchor: "center", width: 110, maxHeight: 24 } }
			) ?? null;
		} finally { pickerActive = false; }
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
				// Remove trailing @ chars
				const current = ctx.ui.getEditorText();
				ctx.ui.setEditorText(current.replace(/@+$/, ""));

				showPicker(ctx).then(session => {
					if (session) {
						const text = ctx.ui.getEditorText();
						ctx.ui.setEditorText(text + `@session:${session.path} `);
						if (lastTui) lastTui.requestRender(true);
					}
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
			const session = await showPicker(ctx);
			if (session) {
				const current = ctx.ui.getEditorText();
				ctx.ui.setEditorText(current + `@session:${session.path} `);
				if (lastTui) lastTui.requestRender(true);
			}
		},
	});
}
