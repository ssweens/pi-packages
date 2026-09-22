import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	type ExtensionAPI,
	type ExtensionContext,
	buildSessionContext,
	convertToLlm,
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { type ActivityItem, AgentHistory, AgentsPanel, ChildView, type LiveSource } from "./inspector.js";
import { empty, framed, resultLines, type RunView } from "./render.js";
import { loadRoles } from "./roles.js";
import { RunCompletion } from "./completion.js";
import { claimOwner, readRecord, storageDir, writeRecord } from "./storage.js";

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const LOG_FILE = join(AGENT_DIR, "delegate-runs.jsonl");
const DEFAULTS_FILE = join(AGENT_DIR, "delegate-models.json");
const RATINGS_FILE = join(AGENT_DIR, "delegate-ratings.json");
const STALE_DAYS = 30;
const RATINGS_STALE_DAYS = 14;
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_TTL_MS = 10 * 60 * 1000;
const OPENROUTER_TIMEOUT_MS = 8000;
const BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
// Only tools whose contract is to mutate files. bash is not one: read-only roles use it for grep/git diff/tests,
// and treating it as a writer made two scouts in one cwd collide. Keeping bash out is a decision, not a guess.
const WRITE_TOOLS = new Set(["edit", "write"]);
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_RETAINED_SESSIONS = 8;
const OUTPUT_CAP = 40_000;

const CONTRACT_FOOTER = `

## Delegated worker contract
You are working inside another agent's task. You are not alone in this repository: preserve unrelated and concurrent edits, do not revert work you do not own, stay within the ownership stated in the brief. Do not commit, push, or launch other agents unless the brief says so. Inspect before editing; verify before claiming. End your final message with:
STATUS: complete | partial | blocked
CHANGES: <files changed, from the actual diff; or none>
VERIFIED: <commands or flows run and their concrete results>
GAPS: <unfinished work or blockers, or none>`;

type Status = RunView["status"];
type RunResult = { content: { type: "text"; text: string }[]; details: RunView; isError: boolean };

interface Run {
	id: string;
	ownerKey: string;
	recordPath: string;
	segment: number;
	stopped: boolean;
	acknowledged: boolean;
	systemPrompt: string;
	contextFiles: { path: string; content: string }[];
	appendSystemPrompt: string[];
	tools: string[];
	timeoutMs: number;
	sessionId: string;
	completion: RunCompletion<RunResult>;
	role: string;
	model: string;
	thinking: string;
	context: "fork" | "fresh";
	cwd: string;
	task: string;
	status: Status;
	startedAt: number;
	endedAt?: number;
	turns: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
	cost: number;
	changedFiles: string[];
	droppedTools: string[];
	output: string;
	error?: string;
	lastTool?: string;
	toolCalls: { name: string; args: Record<string, unknown>; at: number }[];
	activeTools: Map<string, { name: string; args: Record<string, unknown> }>;
	revision: number;
	streamingMessage?: any;
	activityCache?: { revision: number; items: ActivityItem[] };
	contextWindow?: number;
	session?: any;
	ready?: Promise<void>;
	startIdx: number;
	forkedMessages?: number;
	writer: boolean;
	dirtyBefore?: Map<string, number>;
	timer?: ReturnType<typeof setTimeout>;
	sessionFile?: string;
}

interface Owner {
	key: string;
	path: string;
	runPaths: string[];
	queued: Set<string>;
	closed: boolean;
	lost?: Error;
	release: () => Promise<void>;
	binding?: { pi: ExtensionAPI; ctx: ExtensionContext };
}
interface RuntimeState {
	runs: Map<string, Run>;
	owners: Map<string, Owner>;
	listeners: Set<() => void>;
}
// This is the process-owned execution layer. Extension instances are replaceable UI/tool bindings.
// Never persist live session objects; a fresh process reconstructs only inert records from disk.
const runtimeKey = Symbol.for("@ssweens/pi-delegate/runtime/1");
const processState = globalThis as typeof globalThis & { [key: symbol]: RuntimeState };
const state = processState[runtimeKey] ??= { runs: new Map(), owners: new Map(), listeners: new Set() };
const { runs, listeners } = state;
function changed() { for (const listener of listeners) listener(); }
function newId(role: string): string { return `${role}-${randomUUID()}`; }
function ownerPath(ctx: ExtensionContext): string {
	return join(storageDir(ctx.sessionManager.getCwd()), "owners", `${ctx.sessionManager.getSessionId()}.json`);
}
function ownedRuns(owner: Owner): Run[] { return [...runs.values()].filter((r) => r.ownerKey === owner.key); }

type RunRecord = Omit<Run, "completion" | "session" | "timer" | "streamingMessage" | "activeTools" | "activityCache" | "dirtyBefore" | "ready" | "acknowledged"> & { version: 1; savedAt: number };
function saveRun(run: Run): void {
	const owner = state.owners.get(run.ownerKey);
	if (owner?.lost) throw owner.lost;
	const { completion, session, timer, streamingMessage, activeTools, activityCache, dirtyBefore, ready, acknowledged, ...record } = run;
	writeRecord(run.recordPath, { ...record, version: 1, savedAt: Date.now() });
}
function messagesOf(run: Run): any[] {
	if (!run.sessionFile) return [];
	const manager = run.session?.sessionManager ?? openTranscript(run);
	return manager.getEntries().filter((e: any) => e.type === "message").map((e: any) => e.message);
}
function openTranscript(run: Run): SessionManager {
	if (!run.sessionFile || !existsSync(run.sessionFile)) throw new Error(`${run.id}: saved transcript is missing; refusing to start a replacement.`);
	const manager = SessionManager.open(run.sessionFile);
	if (manager.getSessionId() !== run.sessionId) throw new Error(`${run.id}: transcript identity does not match its saved configuration.`);
	return manager;
}
function finalResult(run: Run): RunResult {
	return { content: [{ type: "text", text: resultText(run) }], details: { ...view(run), settled: true, completionReceipt: true, toolCalls: [...run.toolCalls] }, isError: run.status !== "complete" };
}
function restoreRun(path: string, owner: Owner): Run {
	const record = readRecord<RunRecord>(path);
	if (!record || record.version !== 1 || record.ownerKey !== owner.key || typeof record.id !== "string" ||
		typeof record.systemPrompt !== "string" || !Array.isArray(record.contextFiles) || !Array.isArray(record.appendSystemPrompt) || !Array.isArray(record.tools) || typeof record.sessionId !== "string" ||
		!Number.isInteger(record.segment) || typeof record.cwd !== "string" || !Array.isArray(record.toolCalls)) {
		throw new Error(`Cannot restore delegate metadata: ${path}`);
	}
	// Parent message_end hooks run before Pi appends the message. Only its transcript
	// can establish durable delivery after a crash; never trust a saved in-memory acknowledgement.
	const run: Run = { ...record, recordPath: path, acknowledged: false, completion: new RunCompletion(), activeTools: new Map() };
	if (run.status === "running") {
		run.status = "interrupted";
		run.endedAt = record.savedAt;
		run.error = "The previous process ended before this execution settled. Inspect its saved work; send a message to continue.";
	}
	try { harvest(run); }
	catch (error) { run.status = "error"; run.error = String(error); }
	run.completion.settle(finalResult(run));
	return run;
}

function parseModelSpec(spec: string): { provider?: string; id: string; thinking?: string } {
	let thinking: string | undefined;
	let rest = spec;
	const colon = rest.lastIndexOf(":");
	if (colon > 0 && !rest.slice(colon + 1).includes("/")) {
		thinking = rest.slice(colon + 1);
		rest = rest.slice(0, colon);
	}
	const slash = rest.indexOf("/");
	return slash > 0 ? { provider: rest.slice(0, slash), id: rest.slice(slash + 1), thinking } : { id: rest, thinking };
}

function resolveModel(spec: string | undefined, ctx: ExtensionContext) {
	if (!spec) return { model: ctx.model, thinking: undefined as string | undefined };
	const p = parseModelSpec(spec);
	const reg: any = ctx.modelRegistry;
	let model = p.provider ? reg.find(p.provider, p.id) : undefined;
	if (!model) model = reg.getAll().find((m: any) => m.id === p.id || `${m.provider}/${m.id}` === spec.split(":")[0]);
	if (!model) throw new Error(`model not found: ${spec}`);
	return { model, thinking: p.thinking };
}

/** Dirty paths (tracked+untracked) → mtime, or undefined when cwd is not a git work tree. */
function snapshotDirty(cwd: string): Map<string, number> | undefined {
	let out: string;
	try {
		out = execFileSync("git", ["status", "--porcelain", "-uall", "-z"], { cwd, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] });
	} catch {
		return undefined;
	}
	const m = new Map<string, number>();
	for (const rec of out.split("\0")) {
		if (rec.length < 4) continue;
		const p = rec.slice(3);
		let mtime = 0;
		try {
			mtime = statSync(join(cwd, p)).mtimeMs;
		} catch {
			/* deleted */
		}
		m.set(p, mtime);
	}
	return m;
}

function dirtyDelta(before: Map<string, number> | undefined, cwd: string): string[] | undefined {
	if (!before) return undefined;
	const after = snapshotDirty(cwd);
	if (!after) return undefined;
	const changed: string[] = [];
	for (const [p, mt] of after) if (!before.has(p) || before.get(p) !== mt) changed.push(p);
	for (const p of before.keys()) if (!after.has(p)) changed.push(p);
	return changed;
}

/** Drop a trailing assistant message whose tool calls have no results yet (the call to `delegate` itself). */
function trimDangling(messages: any[]): any[] {
	const out = messages.slice();
	while (out.length) {
		const last = out[out.length - 1];
		if (last?.role === "assistant" && Array.isArray(last.content) && last.content.some((b: any) => b?.type === "toolCall")) {
			out.pop();
			continue;
		}
		break;
	}
	return out;
}

function harvest(run: Run) {
	const msgs = messagesOf(run);
	let turns = 0;
	const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	let cost = 0;
	const changed = new Set<string>(dirtyDelta(run.dirtyBefore, run.cwd) ?? []);
	const gitBacked = run.dirtyBefore !== undefined;
	let output = "";
	for (let i = run.startIdx; i < msgs.length; i++) {
		const m = msgs[i];
		if (m?.role !== "assistant") continue;
		turns += 1;
		const u = m.usage;
		if (u) {
			tokens.input += u.input ?? 0;
			tokens.output += u.output ?? 0;
			tokens.cacheRead += u.cacheRead ?? 0;
			tokens.cacheWrite += u.cacheWrite ?? 0;
			cost += u.cost?.total ?? 0;
		}
		let text = "";
		for (const b of m.content ?? []) {
			if (b?.type === "text") text += b.text;
			if (!gitBacked && b?.type === "toolCall" && (b.name === "edit" || b.name === "write")) {
				const p = b.arguments?.path ?? b.arguments?.file_path;
				if (typeof p === "string") changed.add(p);
			}
		}
		if (text.trim()) output = text;
	}
	run.turns = turns;
	run.tokens = tokens;
	run.cost = cost;
	run.changedFiles = [...changed].sort();
	run.output = output.length > OUTPUT_CAP ? `${output.slice(0, OUTPUT_CAP)}\n…[truncated ${output.length - OUTPUT_CAP} chars]` : output;
}

interface ApprovedModel {
	spec: string; // provider/id:thinking
	reason?: string;
	approvedAt: number;
	cost?: { input: number; output: number };
}
interface Defaults {
	approved: Record<string, ApprovedModel>;
	catalogAtApproval: string[];
}

function loadDefaults(): Defaults {
	try {
		const d = JSON.parse(readFileSync(DEFAULTS_FILE, "utf8"));
		return { approved: d.approved ?? {}, catalogAtApproval: d.catalogAtApproval ?? [] };
	} catch {
		return { approved: {}, catalogAtApproval: [] };
	}
}

/** Written by delegate_ctl approve after the user agreed in conversation, or by the user's editor. Snapshot is the full catalog. */
function saveDefault(role: string, entry: ApprovedModel, available: any[]) {
	const d = loadDefaults();
	d.approved[role] = entry;
	d.catalogAtApproval = available.map(modelKey).sort();
	mkdirSync(dirname(DEFAULTS_FILE), { recursive: true });
	writeFileSync(DEFAULTS_FILE, `${JSON.stringify(d, null, 2)}\n`);
}

function modelKey(m: any): string {
	return `${m.provider}/${m.id}`;
}

interface Rating {
	score: number;
	source: string;
	note?: string;
}
interface Ratings {
	updatedAt: number;
	entries: Record<string, Rating>;
}

function loadRatings(): Ratings {
	try {
		const d = JSON.parse(readFileSync(RATINGS_FILE, "utf8"));
		return { updatedAt: d.updatedAt ?? 0, entries: d.entries ?? {} };
	} catch {
		return { updatedAt: 0, entries: {} };
	}
}

function saveRatings(items: { model: string; score: number; source: string; note?: string }[]): Ratings {
	const r = loadRatings();
	for (const it of items) r.entries[it.model] = { score: it.score, source: it.source, note: it.note };
	r.updatedAt = Date.now();
	mkdirSync(dirname(RATINGS_FILE), { recursive: true });
	writeFileSync(RATINGS_FILE, `${JSON.stringify(r, null, 2)}\n`);
	return r;
}

/** Live OpenRouter catalog: per-token pricing, tiered overrides, expiration, Artificial Analysis indices. Public endpoint, no key. */
interface LiveOR {
	at: number;
	byId: Map<string, any>;
	error?: string;
}
let liveOR: LiveOR | undefined;

async function fetchOpenRouter(): Promise<LiveOR> {
	if (liveOR && !liveOR.error && Date.now() - liveOR.at < OPENROUTER_TTL_MS) return liveOR;
	try {
		const res = await fetch(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS) });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = (await res.json())?.data;
		if (!Array.isArray(data)) throw new Error("unexpected payload");
		liveOR = { at: Date.now(), byId: new Map(data.map((m: any) => [m.id, m])) };
	} catch (e: any) {
		liveOR = { at: Date.now(), byId: liveOR?.byId ?? new Map(), error: String(e?.message ?? e) };
	}
	return liveOR;
}

function perM(v: unknown): number | undefined {
	if (v === undefined || v === null || v === "") return undefined;
	const n = Number(v);
	return Number.isFinite(n) ? Math.round(n * 1e6 * 1e4) / 1e4 : undefined;
}

function livePriceStr(l: any): string {
	const p = perM(l?.pricing?.prompt);
	const c = perM(l?.pricing?.completion);
	if (p === undefined || c === undefined) return "";
	const req = Number(l?.pricing?.request);
	return `$${p}/${c}/M${Number.isFinite(req) && req > 0 ? ` +$${req}/req` : ""}`;
}

// Pricing overrides per https://openrouter.ai/docs/guides/overview/models#pricing-object
const OVERRIDE_PRICE_KEYS = new Set(["prompt", "completion", "request", "image", "image_output", "web_search", "internal_reasoning", "input_cache_read", "input_cache_write", "input_cache_write_1h", "audio", "audio_output", "input_audio_cache"]);
const OVERRIDE_COND_KEYS = new Set(["min_prompt_tokens", "utc_start", "utc_end", "utc_days"]);
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function hhmm(v: number): string {
	const n = Number(v);
	return `${String(Math.floor(n / 100)).padStart(2, "0")}:${String(n % 100).padStart(2, "0")}`;
}

/** Wrap-aware window test from the spec: t >= start || t < end when end is not after start. */
function inWindow(o: any, now: Date): boolean {
	if (o.utc_days && !o.utc_days.includes(DAY_NAMES[now.getUTCDay()])) return false;
	if (o.utc_start === undefined && o.utc_end === undefined) return true;
	const t = now.getUTCHours() * 100 + now.getUTCMinutes();
	const s = Number(o.utc_start ?? 0);
	const e = Number(o.utc_end ?? 0);
	return e > s ? t >= s && t < e : t >= s || t < e;
}

/** Render every override as the API states it; skip entries with condition fields the spec does not define. */
function overridesStr(pricing: any, now: Date): { text: string; skipped: number } {
	const out: string[] = [];
	let skipped = 0;
	for (const o of pricing?.overrides ?? []) {
		const unknown = Object.keys(o).filter((k) => !OVERRIDE_PRICE_KEYS.has(k) && !OVERRIDE_COND_KEYS.has(k));
		if (unknown.length) {
			skipped++;
			continue;
		}
		const price = `$${perM(o.prompt) ?? perM(pricing.prompt)}/${perM(o.completion) ?? perM(pricing.completion)}`;
		const cond: string[] = [];
		if (o.min_prompt_tokens !== undefined) cond.push(`>${Math.round(Number(o.min_prompt_tokens) / 1000)}k prompt`);
		if (o.utc_days) cond.push(o.utc_days.map((d: string) => d.slice(0, 3)).join(","));
		if (o.utc_start !== undefined || o.utc_end !== undefined) {
			const e = Number(o.utc_end ?? 0);
			cond.push(`${hhmm(Number(o.utc_start ?? 0))}\u2013${e === 0 ? "24:00" : hhmm(e)}Z`);
		}
		const timed = o.utc_days || o.utc_start !== undefined || o.utc_end !== undefined;
		const active = timed && o.min_prompt_tokens === undefined && inWindow(o, now);
		out.push(`${cond.join(" ") || "always"} ${price}${active ? " \u2190now" : ""}`);
	}
	return { text: out.join("; "), skipped };
}

/** Per-provider endpoints for one OpenRouter model: discount, quantization, status, uptime, own overrides. */
interface LiveEndpoints {
	at: number;
	endpoints: any[];
	error?: string;
}
const liveEP = new Map<string, LiveEndpoints>();

async function fetchEndpoints(id: string): Promise<LiveEndpoints> {
	const c = liveEP.get(id);
	if (c && !c.error && Date.now() - c.at < OPENROUTER_TTL_MS) return c;
	let r: LiveEndpoints;
	try {
		const res = await fetch(`https://openrouter.ai/api/v1/models/${id}/endpoints`, { signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS) });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const eps = (await res.json())?.data?.endpoints;
		if (!Array.isArray(eps)) throw new Error("unexpected payload");
		r = { at: Date.now(), endpoints: eps };
	} catch (e: any) {
		r = { at: Date.now(), endpoints: c?.endpoints ?? [], error: String(e?.message ?? e) };
	}
	liveEP.set(id, r);
	return r;
}

function aaStr(l: any): string {
	const aa = l?.benchmarks?.artificial_analysis;
	if (!aa) return "";
	const parts: string[] = [];
	if (aa.intelligence_index != null) parts.push(`intel ${aa.intelligence_index}`);
	if (aa.coding_index != null) parts.push(`coding ${aa.coding_index}`);
	if (aa.agentic_index != null) parts.push(`agentic ${aa.agentic_index}`);
	return parts.length ? `  AA[${parts.join(" ")}]` : "";
}

function endpointLine(e: any, now: Date): string {
	const p = e.pricing ?? {};
	const parts: string[] = [`${e.provider_name}${e.tag && e.tag !== e.provider_name?.toLowerCase() ? ` [${e.tag}]` : ""}`, livePriceStr(e)];
	const d = Number(p.discount);
	if (Number.isFinite(d) && d > 0) {
		const lp = perM(p.prompt);
		const lc = perM(p.completion);
		const undisc = lp !== undefined && lc !== undefined && d < 1 ? ` (listed price includes it; undiscounted $${Math.round((lp / (1 - d)) * 1e4) / 1e4}/${Math.round((lc / (1 - d)) * 1e4) / 1e4})` : "";
		parts.push(`${Math.round(d * 100)}% off${undisc}`);
	}
	if (e.quantization && e.quantization !== "unknown") parts.push(e.quantization);
	if (e.status !== undefined && e.status !== 0) parts.push(`status ${e.status}`);
	if (e.uptime_last_30m !== undefined && e.uptime_last_30m !== null) parts.push(`up ${Math.round(e.uptime_last_30m)}%`);
	if (e.context_length) parts.push(`ctx ${Math.round(e.context_length / 1000)}k`);
	const ov = overridesStr(p, now);
	if (ov.text) parts.push(`overrides: ${ov.text}`);
	if (ov.skipped) parts.push(`${ov.skipped} override(s) with unrecognized conditions skipped`);
	return parts.join("  ");
}

function endpointsStr(id: string, now: Date): string {
	const c = liveEP.get(id);
	if (!c) return "";
	if (c.error && !c.endpoints.length) return `\n      endpoints: fetch failed (${c.error})`;
	return `\n      endpoints (${c.endpoints.length}):\n${c.endpoints.map((e) => `        ${endpointLine(e, now)}`).join("\n")}`;
}

function liveStr(m: any, live: LiveOR | undefined): string {
	if (m.provider !== "openrouter" || !live) return "";
	const l = live.byId.get(m.id);
	if (!l) return "  live: not listed on OpenRouter now";
	const out: string[] = [];
	const now = new Date();
	const lp = perM(l.pricing?.prompt);
	const lc = perM(l.pricing?.completion);
	const rp = Math.round((m.cost?.input ?? 0) * 1e4) / 1e4;
	const rc = Math.round((m.cost?.output ?? 0) * 1e4) / 1e4;
	if (lp !== undefined && lc !== undefined && (lp !== rp || lc !== rc)) out.push(`live now ${livePriceStr(l)} (registry differs)`);
	else {
		const req = Number(l.pricing?.request);
		if (Number.isFinite(req) && req > 0) out.push(`+$${req}/req`);
	}
	const ov = overridesStr(l.pricing, now);
	if (ov.text) out.push(`top provider overrides: ${ov.text}`);
	if (ov.skipped) out.push(`${ov.skipped} override(s) with unrecognized conditions skipped`);
	if (l.expiration_date) out.push(`expires ${l.expiration_date}`);
	const aa = aaStr(l);
	return (out.length ? `  ${out.join("; ")}` : "") + aa + endpointsStr(m.id, now);
}

function liveStatus(live: LiveOR | undefined): string {
	if (!live) return "OPENROUTER: not fetched";
	const age = Math.round((Date.now() - live.at) / 1000);
	const aaCount = [...live.byId.values()].filter((l) => l.benchmarks?.artificial_analysis).length;
	if (live.error) return `OPENROUTER: fetch failed (${live.error})${live.byId.size ? `, data from ${age}s ago` : ""}`;
	return `OPENROUTER: ${live.byId.size} live, ${aaCount} with AA, fetched ${age}s ago (${new Date().toISOString().slice(11, 16)}Z)`;
}

function ratingStr(r: Ratings, name: string): string {
	const e = r.entries[name];
	if (!e) return "";
	const note = e.note ? ` ${e.note.length > 60 ? `${e.note.slice(0, 60)}\u2026` : e.note}` : "";
	return `  rated ${e.score} (${e.source.length > 40 ? `${e.source.slice(0, 40)}\u2026` : e.source})${note}`;
}

function ratingsStatus(r: Ratings): string {
	const n = Object.keys(r.entries).length;
	if (!n) return "RATINGS: none";
	const age = ageDays(r.updatedAt);
	return `RATINGS: ${n}, ${age}d old${age > RATINGS_STALE_DAYS ? " (stale)" : ""}`;
}

function costStr(m: any): string {
	return m?.cost ? `$${m.cost.input ?? 0}/${m.cost.output ?? 0}/M` : "$?";
}

function ageDays(ts: number): number {
	return Math.floor((Date.now() - ts) / 86_400_000);
}

/** Approved defaults + drift against the live catalog. Empty string when nothing to report. */
function defaultsReport(ctx: ExtensionContext): string {
	const d = loadDefaults();
	const reg: any = ctx.modelRegistry;
	const avail: any[] = reg.getAvailable();
	const byKey = new Map(avail.map((m) => [modelKey(m), m]));
	const lines: string[] = [];
	const drift: string[] = [];
	for (const [role, a] of Object.entries(d.approved)) {
		const base = a.spec.split(":")[0];
		const m = byKey.get(base);
		lines.push(`  ${role}: ${a.spec}  approved ${ageDays(a.approvedAt)}d ago${a.reason ? ` \u2014 ${a.reason}` : ""}`);
		if (!m) drift.push(`${role}: ${base} is no longer available`);
		else if (a.cost && m.cost && (a.cost.input !== m.cost.input || a.cost.output !== m.cost.output))
			drift.push(`${role}: price changed $${a.cost.input}/${a.cost.output} \u2192 $${m.cost.input}/${m.cost.output}/M`);
		if (m && m.provider === "openrouter" && liveOR && !liveOR.error) {
			const l = liveOR.byId.get(m.id);
			if (!l) drift.push(`${role}: ${base} not listed on OpenRouter right now`);
			else {
				const lp = perM(l.pricing?.prompt);
				const lc = perM(l.pricing?.completion);
				if (lp !== undefined && lc !== undefined && a.cost && (lp !== a.cost.input || lc !== a.cost.output))
					drift.push(`${role}: OpenRouter live price $${lp}/${lc}/M vs approved $${a.cost.input}/${a.cost.output}/M`);
				if (l.expiration_date) drift.push(`${role}: OpenRouter lists expiration ${l.expiration_date}`);
			}
		}
		if (ageDays(a.approvedAt) > STALE_DAYS) drift.push(`${role}: approval is ${ageDays(a.approvedAt)}d old \u2014 re-verify`);
	}
	if (d.catalogAtApproval.length) {
		const snap = new Set(d.catalogAtApproval);
		const added = avail.map(modelKey).filter((k) => !snap.has(k));
		if (added.length) drift.push(`${added.length} new since approval${added.length <= 8 ? `: ${added.join(", ")}` : " (message=<substring> to list)"}`);
	}
	if (!lines.length) return "DEFAULTS: none";
	let out = `DEFAULTS (approved by user)\n${lines.join("\n")}`;
	if (drift.length) out += `\nDRIFT:\n  ${drift.join("\n  ")}`;
	return out;
}

function fmtTokens(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

const MAX_TOOL_CALLS = 200;

function view(run: Run): RunView {
	return {
		id: run.id,
		segment: run.segment,
		stopped: run.stopped,
		settled: run.completion.settled,
		role: run.role,
		model: run.model,
		thinking: run.thinking,
		context: run.context,
		forkedMessages: run.forkedMessages,
		contextWindow: run.contextWindow,
		status: run.status,
		task: run.task,
		output: run.output,
		turns: run.turns,
		tokens: run.tokens,
		cost: run.cost,
		durationMs: (run.endedAt ?? Date.now()) - run.startedAt,
		changedFiles: run.changedFiles,
		droppedTools: run.droppedTools,
		toolCalls: run.toolCalls,
		activeTool: run.activeTools.values().next().value,
		revision: run.revision,
		lastTool: run.lastTool,
		error: run.error,
		sessionFile: run.sessionFile,
	};
}

function summary(run: Run): string {
	const dur = ((run.endedAt ?? Date.now()) - run.startedAt) / 1000;
	const parts = [
		`[${run.status}] ${run.id}`,
		`role=${run.role}`,
		`model=${run.model}${run.thinking ? `:${run.thinking}` : ""}`,
		`ctx=${run.context}${run.forkedMessages ? `(${run.forkedMessages} msgs)` : ""}`,
		`${run.turns} turn${run.turns === 1 ? "" : "s"}`,
		`↑${fmtTokens(run.tokens.input)} ↓${fmtTokens(run.tokens.output)}` +
			(run.tokens.cacheRead ? ` R${fmtTokens(run.tokens.cacheRead)}` : ""),
		run.cost ? `$${run.cost.toFixed(4)}` : "",
		`${dur.toFixed(0)}s`,
	].filter(Boolean);
	let s = parts.join("  ");
	if (run.sessionFile) s += `\nsession: ${run.sessionFile}`;
	if (run.droppedTools.length) s += `\ndropped tools (not available to children): ${run.droppedTools.join(", ")}`;
	if (run.changedFiles.length) s += `\nchanged: ${run.changedFiles.join(", ")}`;
	if (run.error) s += `\nerror: ${run.error}`;
	return s;
}

function resultText(run: Run): string {
	return `${summary(run)}\n\n${run.output || "(no final text)"}`;
}

function log(run: Run) {
	try {
		mkdirSync(dirname(LOG_FILE), { recursive: true });
		const { session: _s, timer: _t, activityCache: _a, streamingMessage: _m, activeTools: _tools, completion: _completion, ready: _ready, systemPrompt: _prompt, contextFiles: _context, appendSystemPrompt: _append, ...rest } = run;
		appendFileSync(LOG_FILE, `${JSON.stringify({ ...rest, output: run.output.slice(0, 2000), ts: Date.now() })}\n`);
	} catch {
		/* logging must never fail the run */
	}
}

function retire(keep: Run) {
	const finished = [...runs.values()].filter((r) => r.ownerKey === keep.ownerKey && r !== keep && r.session && r.completion.settled);
	finished.sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
	while (finished.length > MAX_RETAINED_SESSIONS - 1) {
		const r = finished.shift()!;
		r.activityCache = { revision: r.revision, items: activityOf(r) };
		try {
			r.session.dispose();
		} catch {
			/* ignore */
		}
		r.session = undefined;
	}
}

function finish(run: Run, status: Status, error?: string) {
	if (run.timer) clearTimeout(run.timer);
	run.timer = undefined;
	run.endedAt = Date.now();
	run.status = status;
	if (error) run.error = error;
	try { if (run.session) harvest(run); }
	catch (e) { run.status = "error"; run.error = `Cannot read child transcript: ${String(e)}`; }
	run.activeTools.clear();
	run.streamingMessage = undefined;
	run.revision++;
	try { saveRun(run); }
	catch (e) { run.status = "error"; run.error = `Could not persist completion: ${String(e)}`; }
	log(run);
	retire(run);
	run.completion.settle(finalResult(run));
	changed();
}

async function cancelRun(run: Run) {
	run.stopped = true;
	if (run.status === "running") run.status = "cancelled";
	try { saveRun(run); }
	finally { changed(); await run.session?.abort(); }
}

function publish(completion: RunCompletion<RunResult>) {
	if (completion.claimed) return;
	const result = completion.result;
	const run = runs.get(result.details.id);
	if (!run || run.segment !== result.details.segment || run.acknowledged) return;
	const owner = state.owners.get(run.ownerKey);
	if (!owner?.binding || owner.closed || owner.lost) return;
	const key = `${run.id}:${run.segment}`;
	if (owner.queued.has(key)) return;
	owner.queued.add(key);
	try {
		owner.binding.pi.sendMessage(
			{ customType: "delegate", content: `delegate finished\n${result.content[0].text}`, display: true, details: result.details },
			{ deliverAs: "followUp", triggerTurn: true },
		);
	} catch (error) { owner.queued.delete(key); throw error; }
}

function acknowledge(owner: Owner, details: any) {
	const run = details?.id ? runs.get(details.id) : undefined;
	if (!run || !details.completionReceipt || run.ownerKey !== owner.key || details.status === "running" || details.segment !== run.segment || run.acknowledged) return;
	run.acknowledged = true;
	owner.queued.delete(`${run.id}:${run.segment}`);
}

async function closeOwner(owner: Owner) {
	owner.binding = undefined;
	owner.closed = true;
	await Promise.all(ownedRuns(owner).map(async (run) => {
		if (!run.completion.settled) {
			if (run.status === "running") run.status = "interrupted";
			await run.session?.abort();
			await run.completion.wait();
		}
		run.session?.dispose();
		runs.delete(run.id);
	}));
	try { await owner.release(); } finally { state.owners.delete(owner.key); }
}

/** Reserve a segment before awaiting setup: concurrent steers cannot create duplicate sessions. */
function beginResume(run: Run, restart: boolean) {
	if (!run.completion.settled) throw new Error(`${run.id} is still stopping; wait for completion before resuming.`);
	if (run.stopped && !restart) throw new Error(`${run.id} was explicitly stopped. Restart only at the user's request (steer with restart: true).`);
	if (run.writer) {
		const clash = [...runs.values()].find((r) => r !== run && !r.completion.settled && r.writer && r.cwd === run.cwd);
		if (clash) throw new Error(`${clash.id} is already writing in ${run.cwd}; wait before resuming this child.`);
	}
	openTranscript(run); // Missing history is an error, never permission to start over.
	const next: Run = { ...run, segment: run.segment + 1, stopped: false, acknowledged: false,
		status: "running", endedAt: undefined, error: undefined, revision: run.revision + 1,
		completion: new RunCompletion<RunResult>() };
	saveRun(next);
	Object.assign(run, next);
	changed();
}

/** Actual conversation after the inherited prefix, including streamed text and tool results. */
function activityOf(run: Run): ActivityItem[] {
	if (run.activityCache?.revision === run.revision) return run.activityCache.items;
	const out: ActivityItem[] = [];
	const textOf = (content: any) => typeof content === "string" ? content : (content ?? []).map((b: any) => b.type === "text" ? b.text : b.type === "image" ? "[image attachment]" : "").join("\n");
	const append = (m: any) => {
		if (m?.role === "user") out.push({ kind: "user", text: textOf(m.content) });
		else if (m?.role === "toolResult") out.push({ kind: "result", text: textOf(m.content), isError: Boolean(m.isError) });
		else if (m?.role === "assistant") for (const b of m.content ?? []) {
			if (b.type === "text" && b.text) out.push({ kind: "text", text: b.text });
			if (b.type === "toolCall") out.push({ kind: "tool", name: b.name, args: b.arguments ?? {} });
		}
	};
	let msgs: any[];
	try { msgs = messagesOf(run); }
	catch (error) { return [{ kind: "result", text: String(error), isError: true }]; }
	for (let i = run.startIdx; i < msgs.length; i++) append(msgs[i]);
	if (run.streamingMessage && !msgs.includes(run.streamingMessage)) append(run.streamingMessage);
	run.activityCache = { revision: run.revision, items: out };
	return out;
}

export default function (pi: ExtensionAPI) {
	// Reload refreshes configuration for future session opens. Live children retain the
	// runtime they already own; replacing a binding must not mutate their provider state.
	let modelRuntime: Promise<ModelRuntime> | undefined;
	const getRuntime = () => modelRuntime ??= ModelRuntime.create();
	let owner: Owner | undefined;
	let attachError: string | undefined;
	function requireOwner(): Owner {
		if (!owner || owner.closed || owner.lost || owner.binding?.pi !== pi) throw new Error(attachError ?? owner?.lost?.message ?? "Delegate runtime is not attached to this parent.");
		return owner;
	}
	async function attach(ctx: ExtensionContext) {
		const path = ownerPath(ctx);
		let existing = state.owners.get(path);
		if (existing?.binding && existing.binding.pi !== pi) throw new Error("This parent already has an attached delegate runtime.");
		if (!existing) {
			const created: Owner = { key: path, path, runPaths: [], queued: new Set(), closed: false, release: async () => {} };
			created.release = await claimOwner(path, (error) => {
				created.lost = error;
				created.binding?.ctx.ui.notify(`Delegate ownership lost: ${error.message}`, "error");
				void closeOwner(created).catch(() => {});
			});
			state.owners.set(path, created);
			try {
				const index = readRecord<{ version: number; runs: string[] }>(path);
				if (index && (index.version !== 1 || !Array.isArray(index.runs) || index.runs.some((p) => typeof p !== "string"))) throw new Error(`Invalid delegate index: ${path}`);
				created.runPaths = index?.runs ?? [];
				for (const recordPath of created.runPaths) {
					const run = restoreRun(recordPath, created);
					runs.set(run.id, run);
				}
			} catch (error) { await closeOwner(created); throw error; }
			existing = created;
		}
		owner = existing;
		owner.binding = { pi, ctx };
		attachError = undefined;
		// The parent's persisted receipt is the durable delivery acknowledgement.
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom_message" && entry.customType === "delegate") acknowledge(owner, entry.details);
			if (entry.type === "message" && entry.message.role === "toolResult") acknowledge(owner, entry.message.details);
		}
		for (const run of ownedRuns(owner)) if (run.completion.settled) publish(run.completion);
	}
	async function steer(run: Run, message: string, restart = false) {
		requireOwner();
		if (run.status === "running") {
			await run.ready;
			if (run.status === "running") { await run.session.steer(message); return; }
		}
		beginResume(run, restart);
		const completion = run.completion;
		void launch(run, message).then(() => publish(completion));
	}
	const liveSource: LiveSource = {
		all: () => owner ? ownedRuns(owner).map(view) : [],
		activity: (id) => { const r = runs.get(id); return r && r.ownerKey === owner?.key ? activityOf(r) : []; },
		subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
		steer: async (id, message) => {
			const r = runs.get(id);
			if (!r || r.ownerKey !== requireOwner().key) throw new Error(`${id}: child is not owned by this parent`);
			await steer(r, message, true); // A message typed directly by the human is an explicit restart request.
		},
		cancel: async (id) => { const r = runs.get(id); if (r?.ownerKey === requireOwner().key) await cancelRun(r); },
	};
	pi.on("message_end", (event) => {
		if (!owner?.binding || owner.binding.pi !== pi) return;
		const message = event.message;
		if ((message.role === "custom" && message.customType === "delegate") || message.role === "toolResult") acknowledge(owner, message.details);
	});

	async function openSession(run: Run, onUpdate?: (u: any) => void, preparedLoader?: DefaultResourceLoader) {
		if (run.session) return;
		if (!statSync(run.cwd).isDirectory()) throw new Error(`Saved working directory is unavailable: ${run.cwd}`);
		const runtime = await getRuntime();
		const slash = run.model.indexOf("/");
		const model = runtime.getModel(run.model.slice(0, slash), run.model.slice(slash + 1));
		if (!model) throw new Error(`Saved model is unavailable: ${run.model}. No fallback was selected.`);
		const loader = preparedLoader ?? new DefaultResourceLoader({
			cwd: run.cwd, agentDir: AGENT_DIR,
			noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			systemPrompt: run.systemPrompt,
			agentsFilesOverride: () => ({ agentsFiles: run.contextFiles }),
			appendSystemPromptOverride: () => run.appendSystemPrompt,
		});
		if (!preparedLoader) await loader.reload();
		const manager = openTranscript(run);
		// A crash may have happened before the first prompt was appended. Preserve the original
		// brief before the explicit revival message rather than silently discarding the task.
		if (run.segment > 1 && !messagesOf(run).some((message, index) => index >= run.startIdx && message.role === "user")) {
			manager.appendMessage({ role: "user", content: [{ type: "text", text: run.task }], timestamp: run.startedAt });
		}
		const { session } = await createAgentSession({
			cwd: run.cwd, model, thinkingLevel: run.thinking as any,
			tools: run.tools, resourceLoader: loader,
			sessionManager: manager, modelRuntime: runtime,
		} as any);
		run.session = session;
		saveRun(run);

		session.subscribe((ev: any) => {
			if (ev.type === "message_start" || ev.type === "message_update") {
				if (ev.message?.role === "assistant") run.streamingMessage = ev.message;
			}
			if (ev.type === "message_end") run.streamingMessage = undefined;
			if (ev.type === "tool_execution_start") {
				run.lastTool = ev.toolName;
				run.activeTools.set(ev.toolCallId, { name: ev.toolName, args: ev.args ?? {} });
				if (run.toolCalls.length < MAX_TOOL_CALLS) run.toolCalls.push({ name: ev.toolName, args: (ev.args ?? {}) as Record<string, unknown>, at: Date.now() });
				if (state.owners.get(run.ownerKey)?.binding?.pi === pi) onUpdate?.({ content: [{ type: "text", text: `${run.id}: ${ev.toolName}` }], details: view(run) });
			}
			if (ev.type === "tool_execution_end") run.activeTools.delete(ev.toolCallId);
			run.revision++;
			if (ev.type === "message_end") {
				try { saveRun(run); }
				catch (error) { run.status = "error"; run.error = `Cannot save child state: ${String(error)}`; void session.abort(); }
			}
			changed();
		});
	}

	async function launch(run: Run, task: string, signal?: AbortSignal, onUpdate?: (u: any) => void, preparedLoader?: DefaultResourceLoader) {
		const abort = () => { if (run.status === "running") { run.status = "cancelled"; run.stopped = true; void run.session?.abort(); } };
		signal?.addEventListener("abort", abort, { once: true });
		try {
			if (signal?.aborted) abort();
			run.ready = openSession(run, onUpdate, preparedLoader);
			await run.ready;
			if (run.status === "running") {
				run.dirtyBefore = snapshotDirty(run.cwd);
				run.timer = setTimeout(() => { run.status = "timeout"; void run.session.abort(); }, run.timeoutMs);
				await run.session.prompt(task, { preflightResult: (accepted: boolean) => {
					// Pi abort() cannot cancel prompt preflight while its agent is still idle.
					// Recheck at the SDK's dispatch boundary, before it starts the agent loop.
					if (accepted && run.status !== "running") throw new Error("Child stopped before prompt dispatch.");
				} });
			}
			finish(run, run.status === "running" ? "complete" : run.status);
		} catch (e: any) {
			finish(run, run.status === "running" ? "error" : run.status, String(e?.message ?? e));
		} finally { signal?.removeEventListener("abort", abort); run.ready = undefined; }
	}

	const resultRenderer = (title: string) => (result: any, opts: any, theme: any, ctx: any) => {
		const v = result.details as RunView | undefined;
		// Async launch stays invisible in chat; its completion message is the one outcome record.
		if ((title === "delegate" || ctx.args?.action === "wait") && v?.id) {
			if (v.status === "running") return empty();
			return framed((width) => resultLines(v, opts.expanded, theme, width));
		}
		const text = result.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") ?? "";
		const lines = text.split("\n");
		const body = opts.expanded ? lines : lines.slice(0, 12);
		if (!opts.expanded && lines.length > 12) body.push("… Ctrl+O expand");
		return framed((width) => [theme.fg(result.isError ? "error" : "dim", `${title}${ctx.args?.action ? ` · ${ctx.args.action}` : ""}`), ...body.flatMap((line: string) => wrapTextWithAnsi(line, Math.max(1, width)))]);
	};

	pi.registerTool({
		name: "delegate",
		renderShell: "self",
		renderCall: empty,
		renderResult: resultRenderer("delegate"),
		label: "Delegate",
		description:
			"Run a role on a task in its own session; returns its final report, changed files, tokens, cost, and a runId. Load the delegation skill for when to delegate, review triggers, and the model-proposal procedure. " +
			"Delegate only for context isolation, parallelism, or a model-tier switch — if the brief would be longer than the expected diff, do the work yourself. " +
			"Start the brief with a short task title on its own line, then objective, ownership, interfaces/constraints, verification, return shape. " +
			'context "fork" (default) hands the child your conversation so far; "fresh" is for adversarial review. ' +
			"Runs in the background by default \u2014 the call returns a run id at once and you are woken when the child finishes. When later work depends on it, use delegate_ctl wait with that runId rather than polling or relaunching. sync:true joins at launch when explicitly needed. Children have built-in tools only. Model: run delegate_ctl models first; a role's approved default is used when model: is omitted. Proposing a model that is not the approved default is a conversation with the user, not a tool step: state the offering, price, rating and tradeoff, get their answer, then call delegate; if they want it kept, delegate_ctl action=approve. Use delegate_ctl to list roles, wait, check status, steer, or cancel.",
		parameters: Type.Object({
			role: Type.String({ description: "role name (delegate_ctl action=roles lists them)" }),
			task: Type.String({ description: "the brief" }),
			model: Type.Optional(Type.String({ description: "override: provider/id[:thinking]" })),
			context: Type.Optional(StringEnum(["fork", "fresh"] as const)),
			cwd: Type.Optional(Type.String()),
			timeoutMs: Type.Optional(Type.Number()),
			sync: Type.Optional(Type.Boolean({ description: "block until the child finishes. Default false: the call returns at once and you are woken with the result" })),
			reason: Type.Optional(Type.String({ description: "one line: why this model for this role; recorded in the run log" })),
		}),
		async execute(_id, p, signal, onUpdate, ctx) {
			const owner = requireOwner();
			const cwd = realpathSync(p.cwd ?? ctx.cwd);
			const roles = loadRoles(cwd, ctx.isProjectTrusted());
			const role = roles.get(p.role);
			if (!role) {
				return {
					content: [{ type: "text", text: `unknown role "${p.role}". available: ${[...roles.keys()].sort().join(", ")}` }],
					isError: true, details: undefined,
				};
			}
			// Model: explicit param, else the role's approved default, else the role file, else the parent's.
			const approved = loadDefaults().approved[role.name];
			const { model, thinking: specThinking } = resolveModel(p.model ?? approved?.spec ?? role.model, ctx);
			if (!model) return { content: [{ type: "text", text: "no model available for child" }], isError: true, details: undefined };
			const thinking = String(specThinking ?? (p.model ? undefined : approved?.spec.split(":")[1]) ?? role.thinking ?? ctx.thinkingLevel ?? "");
			const timeoutMs = p.timeoutMs ?? role.timeoutMs ?? DEFAULT_TIMEOUT_MS;
			const wantedTools = role.tools ?? BUILTIN_TOOLS;
			const isWriter = wantedTools.some((t) => WRITE_TOOLS.has(t));
			const tools = wantedTools.filter((t) => BUILTIN_TOOLS.includes(t));
			if (!tools.length) tools.push("read");
			const systemPrompt = role.systemPrompt + (role.systemPrompt.includes("STATUS:") ? "" : CONTRACT_FOOTER);
			const loader = new DefaultResourceLoader({ cwd, agentDir: AGENT_DIR, systemPrompt,
				noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true });
			await loader.reload();
			requireOwner(); // Setup may have yielded through a parent session replacement.
			if (isWriter) {
				const clash = [...runs.values()].find((r) => !r.completion.settled && r.writer && r.cwd === cwd);
				if (clash) return { content: [{ type: "text", text: `refused: ${clash.id} (${clash.role}) is already writing in ${cwd}. One writer per tree — wait, cancel it, or give this child its own cwd/worktree.` }], isError: true, details: undefined };
			}
			// Freeze the runtime inputs before advertising a run, including project instructions.
			const dir = storageDir(cwd);
			const created = SessionManager.create(cwd, dir);
			const sessionFile = created.getSessionFile()!;
			// Pi normally defers the first disk write until an assistant replies. Establish its own
			// header now so a crash before the first response still leaves a resumable identity.
			writeFileSync(sessionFile, `${JSON.stringify(created.getHeader())}\n`, { flag: "wx", mode: 0o600 });
			const manager = SessionManager.open(sessionFile);
			const context = p.context ?? role.context ?? "fork";
			const inherited = context === "fork" ? convertToLlm(trimDangling(buildSessionContext(ctx.sessionManager.buildContextEntries()).messages)) : [];
			for (const message of inherited) manager.appendMessage(message);
			const id = newId(role.name);
			const run: Run = {
				id, ownerKey: owner.key, recordPath: join(dir, `${encodeURIComponent(id)}.json`),
				segment: 1, stopped: false, acknowledged: false,
				systemPrompt, contextFiles: loader.getAgentsFiles().agentsFiles, appendSystemPrompt: loader.getAppendSystemPrompt(),
				tools, timeoutMs,
				sessionFile, sessionId: manager.getSessionId(),
				completion: new RunCompletion<RunResult>(),
				role: role.name,
				model: modelKey(model),
				thinking,
				context,
				cwd,
				task: p.task,
				status: "running",
				startedAt: Date.now(),
				turns: 0,
				tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				cost: 0,
				changedFiles: [],
				droppedTools: wantedTools.filter((t) => !BUILTIN_TOOLS.includes(t)),
				output: "",
				startIdx: inherited.length,
				forkedMessages: context === "fork" ? inherited.length : undefined,
				writer: isWriter,
				toolCalls: [],
				activeTools: new Map(),
				revision: 0,
				contextWindow: model.contextWindow,
			};
			saveRun(run);
			const paths = [...owner.runPaths, run.recordPath];
			writeRecord(owner.path, { version: 1, runs: paths });
			owner.runPaths = paths;
			runs.set(run.id, run);
			changed();
			const completion = run.completion;
			const work = launch(run, p.task, p.sync ? signal : undefined, onUpdate, loader);

			if (!p.sync) {
				void work.then(() => publish(completion));
				return { content: [{ type: "text", text: `${run.id} running (${run.context}, ${run.model}). Completion will wake you; use delegate_ctl wait with this runId when dependent work needs the result.` }], details: view(run) };
			}

			await work;
			return completion.result;
		},
	});

	pi.registerTool({
		name: "delegate_ctl",
		renderShell: "self",
		renderCall: empty,
		renderResult: resultRenderer("delegate_ctl"),
		label: "Delegate control",
		description:
			"See the delegation skill for the full procedure. models: every offering across all enabled providers, verbatim from the registry (provider/id, reasoning, context, $/M), plus live OpenRouter pricing, tiered rates, expirations and Artificial Analysis indices, your cached ratings, approved defaults and drift \u2014 call before the first delegate of a session. " +
			"rate: store quality ratings you researched, per exact offering (provider/id), so choices are grounded; stale after 14 days. approve: record a role's default model after the user agreed in conversation. " +
			"roles: list roles. status: one run or all. result: current report without waiting. wait: join an existing runId without polling; returns its final report, immediately if finished. Cancelling wait only detaches; the child keeps running. An attached waiter receives completion instead of a separate wake-up. steer: queue a correction or resume a finished child in the background, keeping its context; returns immediately. Use wait to join the resumed work. Saved children are restored on parent reopen without running; steer revives them with their original configuration. Explicitly stopped children require restart:true and the user's request. cancel: stop the child and prevent automatic revival.",
		parameters: Type.Object({
			action: StringEnum(["models", "rate", "approve", "roles", "status", "result", "wait", "steer", "cancel"] as const),
			role: Type.Optional(Type.String({ description: "approve: role name" })),
			model: Type.Optional(Type.String({ description: "approve: provider/id[:thinking] the user agreed to" })),
			runId: Type.Optional(Type.String()),
			restart: Type.Optional(Type.Boolean({ description: "steer only: restart an explicitly stopped child, only when the user requested it" })),
			message: Type.Optional(Type.String({ description: "steer: the correction. models: substring filter. approve: one-line reason the user agreed to" })),
			ratings: Type.Optional(
				Type.Array(
					Type.Object({
						model: Type.String({ description: "exact provider/id as listed by models; rate each offering you judged, separately" }),
						score: Type.Number({ description: "index score from the cited source" }),
						source: Type.String({ description: "where the score came from, with date" }),
						note: Type.Optional(Type.String()),
					}),
					{ description: "rate: ratings to store" },
				),
			),
		}),
		async execute(_id, p, signal, onUpdate, ctx) {
			if (p.action === "approve") {
				if (!p.role || !p.model) return { content: [{ type: "text", text: "approve requires role and model" }], isError: true, details: undefined };
				const { model, thinking } = resolveModel(p.model, ctx);
				if (!model) return { content: [{ type: "text", text: `model not found: ${p.model}` }], isError: true, details: undefined };
				const spec = `${modelKey(model)}${thinking ? `:${thinking}` : ""}`;
				saveDefault(p.role, { spec, reason: p.message, approvedAt: Date.now(), cost: model.cost ? { input: model.cost.input, output: model.cost.output } : undefined }, (ctx.modelRegistry as any).getAvailable());
				return { content: [{ type: "text", text: `${p.role} \u2192 ${spec} saved as default (${DEFAULTS_FILE.replace(homedir(), "~")}). Only call this after the user has agreed in conversation.` }], details: undefined };
			}
			if (p.action === "rate") {
				if (!p.ratings?.length) return { content: [{ type: "text", text: "rate requires ratings: [{model, score, source, note?}]" }], isError: true, details: undefined };
				const r = saveRatings(p.ratings);
				return { content: [{ type: "text", text: `stored ${p.ratings.length}; ${Object.keys(r.entries).length} rated in total. Run models to see them applied.` }], details: undefined };
			}
			if (p.action === "models") {
				const all: any[] = (ctx.modelRegistry as any).getAvailable();
				const cur = ctx.model ? modelKey(ctx.model) : "";
				const f = (p.message ?? "").toLowerCase();
				const ratings = loadRatings();
				const live = await fetchOpenRouter();
				const aaOf = (m: any) => (m.provider === "openrouter" ? live.byId.get(m.id)?.benchmarks?.artificial_analysis : undefined);
				let offers: any[];
				let scope: string;
				let order: string;
				if (f) {
					offers = all.filter((m) => modelKey(m).toLowerCase().includes(f));
					scope = `matching "${p.message}"`;
					order = "";
					const orIds = offers.filter((m) => m.provider === "openrouter" && live.byId.has(m.id)).map((m) => m.id);
					const EP_CAP = 12;
					await Promise.all(orIds.slice(0, EP_CAP).map(fetchEndpoints));
					if (orIds.length > EP_CAP) scope += ` (endpoints fetched for the first ${EP_CAP} OpenRouter matches; narrow the filter for the rest)`;
				} else {
					offers = all.filter((m) => ratings.entries[modelKey(m)] || aaOf(m)?.intelligence_index != null);
					scope = `rated; ${all.length - offers.length} unrated hidden (message=<substring>)`;
					order = "";
				}
				const score = (m: any) => {
					const mine = ratings.entries[modelKey(m)]?.score;
					if (mine != null) return [1, mine];
					const aa = aaOf(m)?.intelligence_index;
					return aa != null ? [0, aa] : [-1, 0];
				};
				offers.sort((a, b) => {
					const [ta, sa] = score(a);
					const [tb, sb] = score(b);
					return tb - ta || sb - sa || modelKey(a).localeCompare(modelKey(b));
				});
				const CAP = 120;
				const lines = offers.slice(0, CAP).map((m) => {
					const ctxk = m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k` : "?";
					return `${modelKey(m) === cur ? "* " : "  "}${modelKey(m)}  ${m.reasoning ? "reasoning" : "no-reasoning"}  ctx=${ctxk}  ${costStr(m)}${liveStr(m, live)}${ratingStr(ratings, modelKey(m))}`;
				});
				const provs = new Map<string, number>();
				for (const m of all) provs.set(m.provider, (provs.get(m.provider) ?? 0) + 1);
				const provLine = [...provs.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
				const more = offers.length > CAP ? `\n  \u2026${offers.length - CAP} more` : "";
				// live on OpenRouter but absent from the registry: usable only after adding to models.json
				const registryOR = new Set(all.filter((m) => m.provider === "openrouter").map((m) => m.id));
				const liveOnly = [...live.byId.keys()].filter((id) => !registryOR.has(id) && (!f || id.toLowerCase().includes(f)));
				const liveOnlyStr = !liveOnly.length
					? ""
					: f
						? `\n\nON OPENROUTER BUT NOT IN YOUR REGISTRY (${liveOnly.length}) \u2014 add to ~/.pi/agent/models.json to make usable:\n${liveOnly.slice(0, 20).map((id) => `  ${id}  ${livePriceStr(live.byId.get(id))}${aaStr(live.byId.get(id))}`).join("\n")}${liveOnly.length > 20 ? "\n  \u2026" : ""}`
						: `\n\nON OPENROUTER BUT NOT IN YOUR REGISTRY: ${liveOnly.length} models; message=<substring> lists matches.`;
				const head = `CATALOG: ${all.length} offerings, ${provs.size} providers`;
				const body = offers.length
					? `\n\nOFFERINGS ${offers.length} ${scope}${order}. * = current.\n${lines.join("\n")}${more}`
					: f
						? `\n\nno registry offering matches "${p.message}"`
						: "\n\nno rated offerings; message=<substring> to search, action=rate to add";
				return { content: [{ type: "text", text: `${defaultsReport(ctx)}\n${ratingsStatus(ratings)}\n${liveStatus(live)}\n\n${head}${body}${liveOnlyStr}\n\nproviders: ${provLine}` }], details: undefined };
			}
			if (p.action === "roles") {
				const roles = [...loadRoles(ctx.cwd, ctx.isProjectTrusted()).values()].sort((a, b) => a.name.localeCompare(b.name));
				const approved = loadDefaults().approved;
				const lines = roles.map(
					(r) => `${r.name}  [${r.context ?? "fork"}${r.model ? `, ${r.model}` : ""}${r.thinking ? `:${r.thinking}` : ""}]  default: ${approved[r.name]?.spec ?? "none \u2014 needs approval"}  ${r.description}  (${r.source})`,
				);
				return { content: [{ type: "text", text: lines.join("\n") || "no roles found" }], details: undefined };
			}
			const owner = requireOwner();
			if (p.action === "status" && !p.runId) {
				const lines = ownedRuns(owner).map((r) => `${summary(r).split("\n")[0]}${r.status === "running" && r.lastTool ? `  last: ${r.lastTool}` : ""}`);
				return { content: [{ type: "text", text: lines.join("\n") || "no runs" }], details: undefined };
			}
			const run = p.runId ? runs.get(p.runId) : undefined;
			if (!run || run.ownerKey !== owner.key) throw new Error(`unknown runId ${p.runId ?? "(none)"}; known: ${ownedRuns(owner).map((r) => r.id).join(", ") || "none"}`);

			switch (p.action) {
				case "wait":
					return await run.completion.wait(signal);
				case "status":
					if (run.session && run.status === "running") harvest(run);
					return { content: [{ type: "text", text: `${summary(run)}${run.status === "running" && run.lastTool ? `\nlast tool: ${run.lastTool}` : ""}` }], details: view(run) };
				case "result":
					return run.completion.settled ? finalResult(run) : { content: [{ type: "text", text: resultText(run) }], details: view(run) };
				case "cancel":
					await cancelRun(run);
					return { content: [{ type: "text", text: `${run.id} stopped; automatic revival is disabled.` }], details: view(run) };
				case "steer": {
					if (!p.message) throw new Error("steer requires message");
					const running = run.status === "running";
					await steer(run, p.message, p.restart);
					return { content: [{ type: "text", text: `${run.id}: ${running ? "steer queued" : "resumed in the background"}. Completion will wake you; use wait to join.` }], details: view(run) };
				}
			}
			return { content: [{ type: "text", text: "unreachable" }], isError: true, details: undefined };
		},
	});

	pi.registerMessageRenderer("delegate", (message: any, { expanded }: any, theme: any) => {
		const v = message.details as RunView | undefined;
		if (!v || typeof v !== "object" || !("id" in v)) return undefined;
		return framed((width) => resultLines(v, expanded, theme, width));
	});

	let panel: AgentsPanel | undefined;
	let navigationOpen = false;
	const childDrafts = new Map<string, string>();
	async function openChild(ctx: ExtensionContext, id: string) {
		if (navigationOpen) return;
		navigationOpen = true;
		try {
			await ctx.ui.custom<undefined>(
				(childTui, childTheme, _kb, done) => new ChildView(id, liveSource, childTheme, childTui, () => done(undefined), childDrafts.get(id) ?? "", (draft) => { childDrafts.set(id, draft); }),
				{ overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left", margin: 0 } },
			);
		} catch (e) { ctx.ui.notify(`Cannot open child: ${String(e)}`, "error"); }
		finally { navigationOpen = false; }
	}
	async function openHistory(ctx: ExtensionContext) {
		if (navigationOpen || ctx.mode !== "tui") return;
		const finished = liveSource.all().filter((r) => r.settled);
		if (!finished.length) { ctx.ui.notify("No finished agents.", "info"); return; }
		navigationOpen = true;
		let id: string | undefined;
		try {
			id = await ctx.ui.custom<string | undefined>(
				(tui, theme, _kb, done) => new AgentHistory(finished, theme, tui, done),
				{ overlay: true, overlayOptions: { width: "90%", maxHeight: "100%", anchor: "center", margin: 1 } },
			);
		} catch (e) { ctx.ui.notify(`Cannot open agent history: ${String(e)}`, "error"); }
		finally { navigationOpen = false; }
		if (id) await openChild(ctx, id);
	}
	pi.on("session_start", async (_ev, ctx) => {
		try { await attach(ctx); }
		catch (error) { attachError = String(error); ctx.ui.notify(attachError, "error"); return; }
		if (ctx.mode !== "tui") return;
		ctx.ui.setWidget("delegate-agents", (tui, theme) => {
			panel = new AgentsPanel(liveSource, theme, tui, (id) => openChild(ctx, id));
			return panel;
		});
	});
	pi.registerCommand("agents", {
		description: "Open finished delegate history without restarting children",
		handler: async (_args, ctx) => { await openHistory(ctx); },
	});
	pi.registerShortcut("ctrl+j", {
		description: "Focus active delegates, or open finished history when idle",
		handler: async (ctx) => {
			if (navigationOpen) return;
			if (liveSource.all().some((r) => !r.settled)) panel?.focus();
			else await openHistory(ctx);
		},
	});

	pi.on("session_shutdown", async (event) => {
		panel?.dispose();
		panel = undefined;
		const previous = owner;
		owner = undefined;
		if (!previous || previous.binding?.pi !== pi) return;
		previous.binding = undefined;
		// A reload replaces only the binding. Actual exit/session replacement settles and parks children.
		if (event.reason !== "reload") await closeOwner(previous);
	});
}
