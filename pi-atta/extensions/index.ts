/**
 * pi-atta — @@ session picker for pi
 *
 * Type "@@" to instantly open a fast, filterable session picker.
 * Pre-warms cache on session_start so @@ is instant.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { Key, matchesKey, truncateToWidth, Input } from "@mariozechner/pi-tui";
import type { Component, Focusable } from "@mariozechner/pi-tui";

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

// ── Session cache with background pre-warm ────────────────────────

const SESSIONS_DIR = join(process.env.HOME || "~", ".pi/agent/sessions");
const CACHE_TTL = 60_000;

let cache: SessionInfo[] = [];
let cacheTime = 0;
let warming = false;

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
					if (typeof c === "string") preview = c.slice(0, 80);
					else if (Array.isArray(c)) {
						const tb = c.find((x: any) => x.type === "text");
						if (tb?.text) preview = tb.text.slice(0, 80);
					}
				}
			} catch { /* skip */ }
		}

		if (header?.type !== "session") return null;
		return { path: file, id: header.id || "", cwd: header.cwd || "", timestamp: header.timestamp || "", name, preview };
	} catch { return null; }
}

function warmCache(): void {
	if (warming || (cache.length > 0 && Date.now() - cacheTime < CACHE_TTL)) return;
	warming = true;
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
		warming = false;
	});
}

function getSessions(): SessionInfo[] {
	if (cache.length > 0 && Date.now() - cacheTime < CACHE_TTL) return cache;
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
		return sessions;
	} catch { return []; }
}

// ── Format helpers ────────────────────────────────────────────────

function formatLabel(s: SessionInfo): string {
	const date = s.timestamp.slice(0, 10);
	const time = s.timestamp.slice(11, 16);
	let desc = s.name || s.preview || "";
	if (!desc) {
		const parts = s.cwd.split("/");
		desc = parts[parts.length - 1] || s.cwd.slice(0, 30);
		if (desc.startsWith("--")) desc = desc.replace(/^--/, "").replace(/--$/, "").replace(/-/g, "/");
	}
	if (desc.length > 40) desc = desc.slice(0, 37) + "...";
	return `${date} ${time}  ${desc}  [${s.id.slice(0, 8)}]`;
}

function matchesFilter(s: SessionInfo, q: string): boolean {
	if (!q) return true;
	const lq = q.toLowerCase();
	return !!(s.name?.toLowerCase().includes(lq) || s.preview?.toLowerCase().includes(lq) || s.cwd.toLowerCase().includes(lq) || s.id.toLowerCase().includes(lq));
}

// ── Custom Picker Component ───────────────────────────────────────

const VISIBLE_ITEMS = 10;

class SessionPicker implements Component, Focusable {
	private all: SessionInfo[];
	private filtered: SessionInfo[];
	private filterInput: Input;
	private sel = 0;
	private scroll = 0;
	private theme: Theme;
	private cwd: string;

	private _focused = false;
	get focused() { return this._focused; }
	set focused(v: boolean) { this._focused = v; }
	onDone?: (r: PickerResult) => void;

	constructor(sessions: SessionInfo[], theme: Theme, cwd: string) {
		this.all = sessions;
		this.filtered = sessions.filter(s => s.cwd.startsWith(cwd));
		this.filterInput = new Input();
		this.theme = theme;
		this.cwd = cwd;
	}

	private applyFilter() {
		const q = this.filterInput.getValue().trim();
		if (!q) this.filtered = this.all.filter(s => s.cwd.startsWith(this.cwd));
		else if (q === "*") this.filtered = this.all;
		else this.filtered = this.all.filter(s => matchesFilter(s, q));
		this.sel = 0;
		this.scroll = 0;
	}

	private ensureVisible() {
		if (this.sel < this.scroll) this.scroll = this.sel;
		else if (this.sel >= this.scroll + VISIBLE_ITEMS) this.scroll = this.sel - VISIBLE_ITEMS + 1;
	}

	handleInput(data: string) {
		if (matchesKey(data, Key.escape)) { this.onDone?.(null); return; }
		if (matchesKey(data, Key.enter)) { this.onDone?.(this.filtered[this.sel] ?? null); return; }
		if (matchesKey(data, Key.up) && this.sel > 0) { this.sel--; this.ensureVisible(); return; }
		if (matchesKey(data, Key.down) && this.sel < this.filtered.length - 1) { this.sel++; this.ensureVisible(); return; }
		if (matchesKey(data, Key.pageUp)) { this.sel = Math.max(0, this.sel - VISIBLE_ITEMS); this.ensureVisible(); return; }
		if (matchesKey(data, Key.pageDown)) { this.sel = Math.min(this.filtered.length - 1, this.sel + VISIBLE_ITEMS); this.ensureVisible(); return; }
		this.filterInput.handleInput(data);
		this.applyFilter();
	}

	invalidate() { this.filterInput.invalidate?.(); }

	render(width: number) {
		const t = this.theme;
		const lines: string[] = [];
		lines.push(truncateToWidth(t.bold("  ⚡ Session Picker"), width));
		lines.push(truncateToWidth(t.fg("dim", "  type to filter • * = all projects • ↑↓ • enter select • esc cancel"), width));
		lines.push(truncateToWidth(t.fg("dim", "  ─".repeat(Math.floor((width - 2) / 2))), width));
		const fv = this.filterInput.getValue();
		lines.push(truncateToWidth(fv ? `  filter: ${t.fg("accent", fv)}▋` : `  filter: ${t.fg("dim", "type to search...")}▋`, width));
		lines.push(truncateToWidth(t.fg("dim", "  ─".repeat(Math.floor((width - 2) / 2))), width));
		if (this.filtered.length === 0) {
			lines.push(truncateToWidth(t.fg("muted", "  no matches"), width));
		} else {
			const end = Math.min(this.scroll + VISIBLE_ITEMS, this.filtered.length);
			for (let i = this.scroll; i < end; i++) {
				const s = this.filtered[i];
				const sel = i === this.sel;
				const cursor = sel ? t.fg("accent", "▸ ") : "  ";
				lines.push(truncateToWidth(`${cursor}${sel ? t.bold(formatLabel(s)) : formatLabel(s)}`, width));
			}
			if (this.filtered.length > VISIBLE_ITEMS)
				lines.push(truncateToWidth(t.fg("dim", `  ${this.scroll + 1}-${end} of ${this.filtered.length}`), width));
		}
		return lines.map(l => truncateToWidth(l, width));
	}
}

// ── Extension ─────────────────────────────────────────────────────

export default function attaExtension(pi: ExtensionAPI): void {
	let pickerActive = false;
	let lastTui: any = null; // Capture tui for requestRender

	async function showPicker(ctx: ExtensionContext): Promise<PickerResult> {
		if (pickerActive) return null;
		pickerActive = true;
		try {
			const sessions = getSessions();
			if (sessions.length === 0) { ctx.ui.notify("No sessions found", "info"); return null; }
			return await ctx.ui.custom<PickerResult | undefined>((tui, theme, _kb, done) => {
				lastTui = tui; // Capture for requestRender
				const picker = new SessionPicker(sessions, theme, ctx.cwd);
				picker.onDone = (r) => done(r);
				return {
					get focused() { return picker.focused; },
					set focused(v: boolean) { picker.focused = v; },
					render: (w: number) => picker.render(w),
					invalidate: () => picker.invalidate(),
					handleInput: (data: string) => { picker.handleInput(data); tui.requestRender(); },
				};
			}) ?? null;
		} finally { pickerActive = false; }
	}

	// Pre-warm cache on session start
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.hasUI) warmCache();
	});

	// Keystroke detection: @@ triggers picker instantly
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
						// Append session ref to editor
						const text = ctx.ui.getEditorText();
						ctx.ui.setEditorText(text + `@session:${session.path} `);
						// Force a render
						if (lastTui) lastTui.requestRender(true);
					}
				}).catch(() => {});
				return;
			}
			recentAt = now;
		});
	});

	// /atta command
	pi.registerCommand("atta", {
		description: "Open session picker",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) { ctx.ui.notify("Requires interactive mode", "error"); return; }
			const session = await showPicker(ctx);
			if (session) {
				ctx.ui.setEditorText(` @session:${session.path} `);
			}
		},
	});
}
