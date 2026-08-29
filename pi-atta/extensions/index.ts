/**
 * pi-atta — @@ session picker for pi
 *
 * Two-pane modal: session list + live preview.
 * Toggle between current workspace and all workspaces.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey, truncateToWidth, Input, wrapTextWithAnsi } from "@mariozechner/pi-tui";
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

function scanSessionsSync(): SessionInfo[] {
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

function getSessions(): SessionInfo[] {
	if (cache.length > 0 && Date.now() - cacheTime < CACHE_TTL) return cache;
	return scanSessionsSync();
}

/** Load session preview content */
function loadSessionPreview(session: SessionInfo, maxLines = 30): string[] {
	try {
		const content = readFileSync(session.path, "utf8");
		const lines = content.split("\n").slice(0, 200); // First 200 lines
		const result: string[] = [];
		let messageCount = 0;

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const e = JSON.parse(line);
				if (e.type === "message") {
					const msg = e.message;
					const role = msg.role;
					let text = "";

					if (typeof msg.content === "string") {
						text = msg.content;
					} else if (Array.isArray(msg.content)) {
						for (const c of msg.content) {
							if (c.type === "text") { text = c.text; break; }
						}
					}

					if (text) {
						const prefix = role === "user" ? "› " : role === "assistant" ? "‹ " : "  ";
						const truncated = text.length > 120 ? text.slice(0, 117) + "..." : text;
						result.push(`${prefix}${truncated}`);
						messageCount++;
						if (messageCount >= maxLines) break;
					}
				}
			} catch { /* skip */ }
		}

		return result.length > 0 ? result : ["(no messages)"];
	} catch {
		return ["(could not load session)"];
	}
}

// ── Format helpers ────────────────────────────────────────────────

function formatTitle(s: SessionInfo): string {
	let title = s.name || s.preview || "";
	if (!title) {
		const parts = s.cwd.split("/");
		title = parts[parts.length - 1] || s.cwd.slice(0, 40);
		if (title.startsWith("--")) title = title.replace(/^--/, "").replace(/--$/, "").replace(/-/g, "/");
	}
	if (title.length > 50) title = title.slice(0, 47) + "...";
	return title;
}

function formatDetail(s: SessionInfo): string {
	const date = s.timestamp.slice(0, 10);
	const time = s.timestamp.slice(11, 16);
	const id = s.id.slice(0, 8);
	return `${date} ${time}  [${id}]`;
}

function matchesFilter(s: SessionInfo, q: string): boolean {
	if (!q) return true;
	const lq = q.toLowerCase();
	return !!(
		s.name?.toLowerCase().includes(lq) ||
		s.preview?.toLowerCase().includes(lq) ||
		s.cwd.toLowerCase().includes(lq) ||
		s.id.toLowerCase().includes(lq)
	);
}

// ── Two-Pane Modal Component ──────────────────────────────────────

const LIST_HEIGHT = 18;
const PREVIEW_HEIGHT = 20;

class SessionPickerModal implements Component {
	private allSessions: SessionInfo[] = [];
	private filtered: SessionInfo[] = [];
	private filterInput: Input;
	private sel = 0;
	private scroll = 0;
	private theme: Theme;
	private cwd: string;
	private loaded = false;
	private tui: TUI;
	private onDone: (r: PickerResult) => void;
	private showAll = false; // Toggle between cwd/all
	private previewLines: string[] = [];
	private previewSessionId: string | null = null;

	constructor(tui: TUI, theme: Theme, cwd: string, onDone: (r: PickerResult) => void) {
		this.tui = tui;
		this.theme = theme;
		this.cwd = cwd;
		this.onDone = onDone;
		this.filterInput = new Input();
		this.loadSessions();
	}

	private async loadSessions() {
		if (cache.length > 0 && Date.now() - cacheTime < CACHE_TTL) {
			this.allSessions = cache;
			this.applyFilter();
			this.loaded = true;
			this.tui.requestRender();
			return;
		}
		setImmediate(() => {
			this.allSessions = getSessions();
			this.applyFilter();
			this.loaded = true;
			this.tui.requestRender();
		});
	}

	private applyFilter() {
		const q = this.filterInput.getValue().trim();
		let filtered = this.allSessions;

		if (!this.showAll) {
			filtered = filtered.filter(s => s.cwd.startsWith(this.cwd));
		}
		if (q) {
			filtered = filtered.filter(s => matchesFilter(s, q));
		}

		this.filtered = filtered;
		this.sel = 0;
		this.scroll = 0;
		this.updatePreview();
	}

	private updatePreview() {
		const session = this.filtered[this.sel];
		if (!session) {
			this.previewLines = [];
			this.previewSessionId = null;
			return;
		}
		if (session.id === this.previewSessionId) return;

		this.previewSessionId = session.id;
		// Load preview async to avoid blocking
		setImmediate(() => {
			this.previewLines = loadSessionPreview(session, PREVIEW_HEIGHT);
			this.tui.requestRender();
		});
	}

	private ensureVisible() {
		if (this.sel < this.scroll) this.scroll = this.sel;
		else if (this.sel >= this.scroll + LIST_HEIGHT) this.scroll = this.sel - LIST_HEIGHT + 1;
	}

	handleInput(data: string) {
		if (matchesKey(data, Key.escape)) { this.onDone(null); return; }
		if (matchesKey(data, Key.enter)) {
			this.onDone(this.filtered[this.sel] ?? null);
			return;
		}
		// Tab toggles between cwd/all
		if (matchesKey(data, Key.tab)) {
			this.showAll = !this.showAll;
			this.applyFilter();
			return;
		}
		if (matchesKey(data, Key.up) && this.sel > 0) { this.sel--; this.ensureVisible(); this.updatePreview(); return; }
		if (matchesKey(data, Key.down) && this.sel < this.filtered.length - 1) { this.sel++; this.ensureVisible(); this.updatePreview(); return; }
		if (matchesKey(data, Key.pageUp)) { this.sel = Math.max(0, this.sel - LIST_HEIGHT); this.ensureVisible(); this.updatePreview(); return; }
		if (matchesKey(data, Key.pageDown)) { this.sel = Math.min(this.filtered.length - 1, this.sel + LIST_HEIGHT); this.ensureVisible(); this.updatePreview(); return; }
		if (matchesKey(data, Key.home)) { this.sel = 0; this.scroll = 0; this.updatePreview(); return; }
		if (matchesKey(data, Key.end)) { this.sel = this.filtered.length - 1; this.ensureVisible(); this.updatePreview(); return; }

		this.filterInput.handleInput(data);
		this.applyFilter();
	}

	invalidate() { this.filterInput.invalidate?.(); }

	render(width: number): string[] {
		const t = this.theme;
		const lines: string[] = [];
		const totalW = Math.min(width - 4, 110);
		const listW = 45;
		const previewW = totalW - listW - 3;

		// ── Top border ──────────────────────────────────────────
		lines.push(truncateToWidth(`╭${"─".repeat(listW)}┬${"─".repeat(previewW)}╮`, totalW));

		// ── Header row ──────────────────────────────────────────
		const mode = this.showAll ? "All Workspaces" : "This Workspace";
		const headerLeft = ` Session History `;
		const headerRight = ` ${t.fg("accent", `[${mode}]`)} `;
		const headerPadL = Math.max(0, listW - headerLeft.length);
		const headerPadR = Math.max(0, previewW - headerRight.length - 1);
		lines.push(truncateToWidth(`│${t.bold(headerLeft)}${" ".repeat(headerPadL)}│${headerRight}${" ".repeat(headerPadR)}│`, totalW));

		// ── Search + preview header ─────────────────────────────
		const fv = this.filterInput.getValue();
		const searchLabel = fv
			? `🔍 ${t.fg("accent", fv)}▋`
			: `🔍 ${t.fg("dim", "Search...")}▋`;
		const searchPad = Math.max(0, listW - 1 - visibleWidth(searchLabel));
		const previewHeader = ` Preview `;
		const previewHeaderPad = Math.max(0, previewW - previewHeader.length - 1);
		lines.push(truncateToWidth(`│ ${searchLabel}${" ".repeat(searchPad)}│${t.bold(previewHeader)}${" ".repeat(previewHeaderPad)}│`, totalW));

		// ── Separator ───────────────────────────────────────────
		lines.push(truncateToWidth(`├${"─".repeat(listW)}┼${"─".repeat(previewW)}┤`, totalW));

		// ── Content rows ────────────────────────────────────────
		const contentRows = Math.max(LIST_HEIGHT, PREVIEW_HEIGHT);

		for (let row = 0; row < contentRows; row++) {
			const listIdx = this.scroll + row;
			const listLine = this.renderListRow(listIdx, listW, t);
			const previewLine = this.renderPreviewRow(row, previewW, t);
			lines.push(truncateToWidth(`│${listLine}│${previewLine}│`, totalW));
		}

		// ── Separator ───────────────────────────────────────────
		lines.push(truncateToWidth(`├${"─".repeat(listW)}┼${"─".repeat(previewW)}┤`, totalW));

		// ── Footer ──────────────────────────────────────────────
		const count = this.loaded ? `${this.filtered.length} sessions` : "loading...";
		const help = "↑↓ navigate • Tab workspace • Enter select • Esc cancel";
		const footer = ` ${t.fg("dim", count)}  ${t.fg("dim", help)}`;
		const footerPad = Math.max(0, totalW - 2 - visibleWidth(footer));
		lines.push(truncateToWidth(`│${footer}${" ".repeat(footerPad)}│`, totalW));

		// ── Bottom border ───────────────────────────────────────
		lines.push(truncateToWidth(`╰${"─".repeat(listW)}┴${"─".repeat(previewW)}╯`, totalW));

		return lines;
	}

	private renderListRow(idx: number, width: number, t: Theme): string {
		if (!this.loaded) {
			const text = idx === 0 ? " Loading..." : "";
			return ` ${text}${" ".repeat(Math.max(0, width - 2 - text.length))}`;
		}
		if (idx >= this.filtered.length) {
			return " ".repeat(width);
		}

		const s = this.filtered[idx];
		const isSel = idx === this.sel;
		const cursor = isSel ? t.fg("accent", "▸") : " ";
		const title = formatTitle(s);
		const detail = formatDetail(s);

		if (isSel) {
			// Selected: show title + detail on two lines
			const titleLine = `${cursor} ${t.bold(title)}`;
			const detailLine = `  ${t.fg("dim", detail)}`;
			const pad1 = Math.max(0, width - 1 - visibleWidth(titleLine));
			const pad2 = Math.max(0, width - 1 - visibleWidth(detailLine));
			return `${titleLine}${" ".repeat(pad1)}\n│${detailLine}${" ".repeat(pad2)}`;
		}

		// Not selected: single line
		const text = `${cursor} ${title}`;
		const pad = Math.max(0, width - 1 - visibleWidth(text));
		return `${text}${" ".repeat(pad)}`;
	}

	private renderPreviewRow(row: number, width: number, t: Theme): string {
		if (!this.loaded || this.previewLines.length === 0) {
			const text = row === 0 ? " Select a session to preview" : "";
			return ` ${t.fg("dim", text)}${" ".repeat(Math.max(0, width - 2 - visibleWidth(text)))}`;
		}

		if (row >= this.previewLines.length) {
			return " ".repeat(width);
		}

		const line = this.previewLines[row];
		const isUser = line.startsWith("› ");
		const isAssistant = line.startsWith("‹ ");
		const prefix = isUser ? t.fg("accent", "› ") : isAssistant ? t.fg("success", "‹ ") : "  ";
		const content = line.slice(2);
		const truncated = content.length > width - 4 ? content.slice(0, width - 7) + "..." : content;
		const colored = isUser ? truncated : isAssistant ? t.fg("toolOutput", truncated) : truncated;
		const pad = Math.max(0, width - 3 - visibleWidth(colored));
		return ` ${prefix}${colored}${" ".repeat(pad)}`;
	}
}

// Helper for visible width (strips ANSI)
function visibleWidth(s: string): number {
	// eslint-disable-next-line no-control-regex
	return s.replace(/\x1b\[[0-9;]*m/g, "").length;
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
				{
					overlay: true,
					overlayOptions: { anchor: "center", width: 114, maxHeight: 28 },
				}
			) ?? null;
		} finally {
			pickerActive = false;
		}
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
				// Remove all trailing @ chars (the two @ that triggered this)
				const current = ctx.ui.getEditorText();
				ctx.ui.setEditorText(current.replace(/@{1,2}$/, ""));

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
