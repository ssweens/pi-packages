import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	type ExtensionAPI,
	type ExtensionContext,
	buildSessionContext,
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { borderFor, callLines, empty, frame, framed, resultLines, type RunView } from "./render.js";
import { loadRoles, type Role } from "./roles.js";

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const LOG_FILE = join(AGENT_DIR, "delegate-runs.jsonl");
const DEFAULTS_FILE = join(AGENT_DIR, "delegate-models.json");
/** Child transcripts live with the work: <cwd>/.agents/pi/subsessions. */
const SUBSESSION_DIR = join(".agents", "pi", "subsessions");
const RATINGS_FILE = join(AGENT_DIR, "delegate-ratings.json");
const STALE_DAYS = 30;
const RATINGS_STALE_DAYS = 14;
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_TTL_MS = 10 * 60 * 1000;
const OPENROUTER_TIMEOUT_MS = 8000;
const BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const WRITE_TOOLS = new Set(["bash", "edit", "write"]);
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

type Status = "running" | "complete" | "error" | "cancelled" | "timeout";

interface Run {
	id: string;
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
	toolCalls: { name: string; args: Record<string, unknown> }[];
	contextWindow?: number;
	session?: any;
	startIdx: number;
	forkedMessages?: number;
	writer: boolean;
	dirtyBefore?: Map<string, number>;
	timer?: ReturnType<typeof setTimeout>;
	sessionFile?: string;
}

const runs = new Map<string, Run>();
let seq = 0;

function newId(role: string): string {
	seq += 1;
	return `${role}-${Date.now().toString(36)}-${seq}`;
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
	const msgs: any[] = run.session?.messages ?? [];
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
	if (!live) return "OPENROUTER LIVE: not fetched";
	const age = Math.round((Date.now() - live.at) / 1000);
	const aaCount = [...live.byId.values()].filter((l) => l.benchmarks?.artificial_analysis).length;
	if (live.error) return `OPENROUTER LIVE: fetch failed (${live.error})${live.byId.size ? `; showing data from ${age}s ago` : "; registry prices only"}`;
	return `OPENROUTER LIVE: ${live.byId.size} models, fetched ${age}s ago (${new Date().toISOString().slice(11, 16)}Z). Top-level prices are what applies right now; overrides list every long-context tier and peak/off-peak window (\u2190now marks the active one). Artificial Analysis indices on ${aaCount}. Per-provider endpoints (discounts, quantization, status, uptime, provider-specific off-peak) are fetched for filtered candidates.`;
}

function ratingStr(r: Ratings, name: string): string {
	const e = r.entries[name];
	return e ? `  rated ${e.score} (${e.source})${e.note ? ` ${e.note}` : ""}` : "";
}

function ratingsStatus(r: Ratings): string {
	const n = Object.keys(r.entries).length;
	if (!n) return "YOUR RATINGS: none \u2014 add with action=rate when you have evidence beyond the live indices (observed runs here, other evals, serving quality of a specific offering).";
	const age = ageDays(r.updatedAt);
	return `YOUR RATINGS: ${n} offerings, updated ${age}d ago${age > RATINGS_STALE_DAYS ? " \u2014 STALE, re-verify before relying on them" : ""}`;
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
		if (added.length) drift.push(`new since approval (${added.length}): ${added.slice(0, 30).join(", ")}${added.length > 30 ? ", \u2026" : ""}`);
	}
	if (!lines.length) return "DEFAULTS: none approved yet. Propose per role in conversation; after the user agrees, delegate with model: and record with action=approve if they want it kept.";
	let out = `DEFAULTS (approved by user)\n${lines.join("\n")}`;
	if (drift.length) out += `\nDRIFT \u2014 propose an update to the user before delegating:\n  ${drift.join("\n  ")}`;
	return out;
}

function fmtTokens(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

const MAX_TOOL_CALLS = 200;

function view(run: Run): RunView {
	return {
		id: run.id,
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
		const { session: _s, timer: _t, ...rest } = run;
		appendFileSync(LOG_FILE, `${JSON.stringify({ ...rest, output: run.output.slice(0, 2000), ts: Date.now() })}\n`);
	} catch {
		/* logging must never fail the run */
	}
}

function retire(keep: Run) {
	const finished = [...runs.values()].filter((r) => r !== keep && r.session && r.status !== "running");
	finished.sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
	while (finished.length > MAX_RETAINED_SESSIONS - 1) {
		const r = finished.shift()!;
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
	if (run.session) harvest(run);
	log(run);
	retire(run);
}

export default function (pi: ExtensionAPI) {
	let runtime: ModelRuntime | undefined;
	const getRuntime = async () => (runtime ??= await ModelRuntime.create());

	async function launch(
		run: Run,
		role: Role,
		model: any,
		thinking: string,
		tools: string[],
		task: string,
		timeoutMs: number,
		ctx: ExtensionContext,
		signal: AbortSignal | undefined,
		onUpdate?: (u: any) => void,
	) {
		const loader = new DefaultResourceLoader({
			cwd: run.cwd,
			agentDir: AGENT_DIR,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			systemPrompt: role.systemPrompt + (role.systemPrompt.includes("STATUS:") ? "" : CONTRACT_FOOTER),
		} as any);
		await loader.reload();

		const subsessionDir = join(run.cwd, SUBSESSION_DIR);
		mkdirSync(subsessionDir, { recursive: true });
		// Self-ignoring: transcripts stay out of git status and out of any `git add -A` a child runs.
		// Scoped to this directory so a repo can still track .agents/ for agent definitions.
		try {
			const ignore = join(subsessionDir, ".gitignore");
			if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
		} catch {
			/* never fail a run over housekeeping */
		}
		const { session } = await createAgentSession({
			cwd: run.cwd,
			model,
			thinkingLevel: thinking as any,
			tools,
			resourceLoader: loader,
			sessionManager: SessionManager.create(run.cwd, subsessionDir),
			modelRuntime: await getRuntime(),
		} as any);
		run.session = session;
		run.sessionFile = session.sessionFile;
		run.dirtyBefore = snapshotDirty(run.cwd);

		if (run.context === "fork") {
			const parent = buildSessionContext(ctx.sessionManager.buildContextEntries());
			const forked = trimDangling(parent.messages);
			session.agent.state.messages = forked;
			run.startIdx = forked.length;
			run.forkedMessages = forked.length;
		}

		session.subscribe((ev: any) => {
			if (ev.type === "tool_execution_start") {
				run.lastTool = ev.toolName;
				if (run.toolCalls.length < MAX_TOOL_CALLS) run.toolCalls.push({ name: ev.toolName, args: (ev.args ?? {}) as Record<string, unknown> });
				onUpdate?.({ content: [{ type: "text", text: `${run.id}: ${ev.toolName}` }], details: view(run) });
			}
		});

		run.timer = setTimeout(() => {
			run.status = "timeout";
			session.abort().catch(() => {});
		}, timeoutMs);
		signal?.addEventListener(
			"abort",
			() => {
				if (run.status === "running") {
					run.status = "cancelled";
					session.abort().catch(() => {});
				}
			},
			{ once: true },
		);

		try {
			await session.prompt(task);
			finish(run, run.status === "running" ? "complete" : run.status);
		} catch (e: any) {
			finish(run, run.status === "running" ? "error" : run.status, String(e?.message ?? e));
		}
	}

	/** omp-style frame. Call preview owns the frame until a result exists; then the result owns it. */
	const callRenderer = (title: string) => (args: any, theme: any, ctx: any) => {
		if (ctx.state?.hasResult) return empty();
		const sub = args?.role ?? args?.action;
		const header = `${theme.fg("accent", "\u25c6")} ${theme.fg("toolTitle", theme.bold(title))}${sub ? theme.fg("muted", `: ${sub}`) : ""}`;
		const body = args?.role || args?.task ? callLines(args, theme) : args?.runId || args?.message ? [theme.fg("dim", [args.runId, args.message ? `"${String(args.message).slice(0, 60)}"` : ""].filter(Boolean).join("  "))] : [];
		return framed((width) => frame(header, body, "borderMuted", theme, width));
	};
	const resultRenderer = (title: string) => (result: any, opts: any, theme: any, ctx: any) => {
		// Collapse the call preview on the next tick. Invalidating synchronously re-enters updateDisplay
		// from inside it and duplicates children.
		if (ctx.state && !ctx.state.hasResult) {
			ctx.state.hasResult = true;
			setTimeout(() => ctx.invalidate?.(), 0);
		}
		const sub = ctx.args?.role ?? ctx.args?.action;
		const header = `${theme.fg("accent", "◆")} ${theme.fg("toolTitle", theme.bold(title))}${sub ? theme.fg("muted", `: ${sub}`) : ""}`;
		const snap = result.details as RunView | undefined;
		// Prefer live state: async runs return a "running" snapshot and finish later; the spinner tick re-renders until done.
		const liveRun = snap && typeof snap === "object" && "id" in snap ? runs.get(snap.id) : undefined;
		const v = liveRun ? view(liveRun) : snap;
		if (!v || typeof v !== "object" || !("id" in v)) {
			const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
			const all = text.split("\n");
			const body = opts.expanded || all.length <= 12 ? all : all.slice(0, 12).concat(theme.fg("dim", `… ${all.length - 12} more lines (ctrl+o)`));
			return framed((width) => frame(header, body, result.isError ? "error" : "border", theme, width));
		}
		if (v.status === "running") {
			ctx.state.frame = (ctx.state.frame ?? 0) + 1;
			if (!ctx.state.tick) ctx.state.tick = setTimeout(() => { ctx.state.tick = undefined; ctx.invalidate?.(); }, 120);
		}
		return framed((width) => frame(header, resultLines(v, opts.expanded, theme, width - 4, ctx.state?.frame ?? 0), borderFor(v), theme, width));
	};

	pi.registerTool({
		name: "delegate",
		renderShell: "self",
		renderCall: callRenderer("delegate"),
		renderResult: resultRenderer("delegate"),
		label: "Delegate",
		description:
			"Run a role on a task in its own session; returns its final report, changed files, tokens, cost, and a runId. " +
			"Delegate only for context isolation, parallelism, or a model-tier switch — if the brief would be longer than the expected diff, do the work yourself. " +
			"Brief = objective, ownership, interfaces/constraints, verification, return shape. " +
			'context "fork" (default) hands the child your conversation so far; "fresh" is for adversarial review. ' +
			"Runs in the background by default \u2014 the call returns a run id at once and you are woken when the child finishes; pass sync:true only when you must have the result inside this turn. Children have built-in tools only. Model: run delegate_ctl models first; a role's approved default is used when model: is omitted. Proposing a model that is not the approved default is a conversation with the user, not a tool step: state the offering, price, rating and tradeoff, get their answer, then call delegate; if they want it kept, delegate_ctl action=approve. Use delegate_ctl to list roles, check status, steer, or cancel.",
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
			const cwd = p.cwd ?? ctx.cwd;
			const roles = loadRoles(cwd, ctx.isProjectTrusted());
			const role = roles.get(p.role);
			if (!role) {
				return {
					content: [{ type: "text", text: `unknown role "${p.role}". available: ${[...roles.keys()].sort().join(", ")}` }],
					isError: true,
				};
			}
			// Model: explicit param, else the role's approved default, else the role file, else the parent's.
			const approved = loadDefaults().approved[role.name];
			const { model, thinking: specThinking } = resolveModel(p.model ?? approved?.spec ?? role.model, ctx);
			if (!model) return { content: [{ type: "text", text: "no model available for child" }], isError: true };
			const thinking = String(specThinking ?? (p.model ? undefined : approved?.spec.split(":")[1]) ?? role.thinking ?? ctx.thinkingLevel ?? "");
			const timeoutMs = p.timeoutMs ?? role.timeoutMs ?? DEFAULT_TIMEOUT_MS;
			const wantedTools = role.tools ?? BUILTIN_TOOLS;
			const isWriter = wantedTools.some((t) => WRITE_TOOLS.has(t));
			if (isWriter) {
				const clash = [...runs.values()].find((r) => r.status === "running" && r.writer && r.cwd === cwd);
				if (clash) {
					return {
						content: [{ type: "text", text: `refused: ${clash.id} (${clash.role}) is already writing in ${cwd}. One writer per tree \u2014 wait, cancel it, or give this child its own cwd/worktree.` }],
						isError: true,
					};
				}
			}
			const run: Run = {
				id: newId(role.name),
				role: role.name,
				model: "",
				thinking: "",
				context: p.context ?? role.context ?? "fork",
				cwd,
				task: p.task,
				status: "running",
				startedAt: Date.now(),
				turns: 0,
				tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				cost: 0,
				changedFiles: [],
				droppedTools: [],
				output: "",
				startIdx: 0,
				writer: isWriter,
				toolCalls: [],
				contextWindow: model.contextWindow,
			};
			runs.set(run.id, run);

			run.model = modelKey(model);
			run.thinking = thinking;
			const tools = wantedTools.filter((t) => BUILTIN_TOOLS.includes(t));
			run.droppedTools = wantedTools.filter((t) => !BUILTIN_TOOLS.includes(t));
			if (!tools.length) tools.push("read");
			const work = launch(run, role, model, run.thinking, tools, p.task, timeoutMs, ctx, p.sync ? signal : undefined, onUpdate);

			if (!p.sync) {
				work.then(() => {
					pi.sendMessage(
						{ customType: "delegate", content: `delegate finished\n${resultText(run)}`, display: true, details: view(run) },
						{ deliverAs: "followUp", triggerTurn: true },
					);
				});
				return { content: [{ type: "text", text: `${run.id} running (${run.context}, ${run.model}). You will be woken with the result; delegate_ctl status/steer/cancel meanwhile.` }], details: view(run) };
			}

			await work;
			return { content: [{ type: "text", text: resultText(run) }], details: view(run), isError: run.status !== "complete" };
		},
	});

	pi.registerTool({
		name: "delegate_ctl",
		renderShell: "self",
		renderCall: callRenderer("delegate_ctl"),
		renderResult: resultRenderer("delegate_ctl"),
		label: "Delegate control",
		description:
			"models: every offering across all enabled providers, verbatim from the registry (provider/id, reasoning, context, $/M), plus live OpenRouter pricing, tiered rates, expirations and Artificial Analysis indices, your cached ratings, approved defaults and drift \u2014 call before the first delegate of a session. " +
			"rate: store quality ratings you researched, per exact offering (provider/id), so choices are grounded; stale after 14 days. approve: record a role's default model after the user agreed in conversation. " +
			"roles: list roles. status: one run or all. result: full report. steer: correct a running or finished child (keeps its context). cancel: abort.",
		parameters: Type.Object({
			action: StringEnum(["models", "rate", "approve", "roles", "status", "result", "steer", "cancel"] as const),
			role: Type.Optional(Type.String({ description: "approve: role name" })),
			model: Type.Optional(Type.String({ description: "approve: provider/id[:thinking] the user agreed to" })),
			runId: Type.Optional(Type.String()),
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
				if (!p.role || !p.model) return { content: [{ type: "text", text: "approve requires role and model" }], isError: true };
				const { model, thinking } = resolveModel(p.model, ctx);
				if (!model) return { content: [{ type: "text", text: `model not found: ${p.model}` }], isError: true };
				const spec = `${modelKey(model)}${thinking ? `:${thinking}` : ""}`;
				saveDefault(p.role, { spec, reason: p.message, approvedAt: Date.now(), cost: model.cost ? { input: model.cost.input, output: model.cost.output } : undefined }, (ctx.modelRegistry as any).getAvailable());
				return { content: [{ type: "text", text: `${p.role} \u2192 ${spec} saved as default (${DEFAULTS_FILE.replace(homedir(), "~")}). Only call this after the user has agreed in conversation.` }] };
			}
			if (p.action === "rate") {
				if (!p.ratings?.length) return { content: [{ type: "text", text: "rate requires ratings: [{model, score, source, note?}]" }], isError: true };
				const r = saveRatings(p.ratings);
				return { content: [{ type: "text", text: `stored ${p.ratings.length}; ${Object.keys(r.entries).length} rated in total. Run models to see them applied.` }] };
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
					order = "your rating, then AA intelligence index, then name";
					const orIds = offers.filter((m) => m.provider === "openrouter" && live.byId.has(m.id)).map((m) => m.id);
					const EP_CAP = 12;
					await Promise.all(orIds.slice(0, EP_CAP).map(fetchEndpoints));
					if (orIds.length > EP_CAP) scope += ` (endpoints fetched for the first ${EP_CAP} OpenRouter matches; narrow the filter for the rest)`;
				} else {
					offers = all.filter((m) => ratings.entries[modelKey(m)] || aaOf(m)?.intelligence_index != null);
					scope = `with a rating (yours or Artificial Analysis via OpenRouter); ${all.length - offers.length} unrated offerings not shown \u2014 message=<substring> to see any offering, and every provider's offering of a candidate`;
					order = "your rating, then AA intelligence index (coding and agentic shown alongside)";
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
				const more = offers.length > CAP ? `\n  \u2026${offers.length - CAP} more; narrow with message=` : "";
				// live on OpenRouter but absent from the registry: usable only after adding to models.json
				const registryOR = new Set(all.filter((m) => m.provider === "openrouter").map((m) => m.id));
				const liveOnly = [...live.byId.keys()].filter((id) => !registryOR.has(id) && (!f || id.toLowerCase().includes(f)));
				const liveOnlyStr = !liveOnly.length
					? ""
					: f
						? `\n\nON OPENROUTER BUT NOT IN YOUR REGISTRY (${liveOnly.length}) \u2014 add to ~/.pi/agent/models.json to make usable:\n${liveOnly.slice(0, 20).map((id) => `  ${id}  ${livePriceStr(live.byId.get(id))}${aaStr(live.byId.get(id))}`).join("\n")}${liveOnly.length > 20 ? "\n  \u2026" : ""}`
						: `\n\nON OPENROUTER BUT NOT IN YOUR REGISTRY: ${liveOnly.length} models; message=<substring> lists matches.`;
				const head = `CATALOG ${all.length} offerings across ${provs.size} enabled providers, listed as the registry reports them. The same weights on different providers are different offerings \u2014 subscription (flat-rate), metered API, local, free tier differ in marginal cost, speed, quantization, and limits; weigh each. Prices are the registry's per-M-token figures; $0 means the registry reports no marginal cost, not that it is free of limits. AA indices attach only to OpenRouter offerings by exact id; whether another provider's offering is the same weights is your judgment to state in reason:.`;
				const body = offers.length
					? `\n\nOFFERINGS ${offers.length} ${scope}. Order: ${order}. * = your current. Pass model: exactly as listed.\n${lines.join("\n")}${more}`
					: f
						? `\n\nno registry offering matches "${p.message}"`
						: "\n\nNo ratings available (OpenRouter fetch failed and nothing cached): research which models currently lead for this role's work, then message=<name> to see every offering of each candidate, judge the serving tradeoffs, and action=rate the offerings you would actually use.";
				return { content: [{ type: "text", text: `${defaultsReport(ctx)}\n${ratingsStatus(ratings)}\n${liveStatus(live)}\n\n${head}${body}${liveOnlyStr}\n\nproviders: ${provLine}` }] };
			}
			if (p.action === "roles") {
				const roles = [...loadRoles(ctx.cwd, ctx.isProjectTrusted()).values()].sort((a, b) => a.name.localeCompare(b.name));
				const approved = loadDefaults().approved;
				const lines = roles.map(
					(r) => `${r.name}  [${r.context ?? "fork"}${r.model ? `, ${r.model}` : ""}${r.thinking ? `:${r.thinking}` : ""}]  default: ${approved[r.name]?.spec ?? "none \u2014 needs approval"}  ${r.description}  (${r.source})`,
				);
				return { content: [{ type: "text", text: lines.join("\n") || "no roles found" }] };
			}
			if (p.action === "status" && !p.runId) {
				const lines = [...runs.values()].map((r) => `${summary(r).split("\n")[0]}${r.status === "running" && r.lastTool ? `  last: ${r.lastTool}` : ""}`);
				return { content: [{ type: "text", text: lines.join("\n") || "no runs" }] };
			}
			const run = p.runId ? runs.get(p.runId) : undefined;
			if (!run) return { content: [{ type: "text", text: `unknown runId ${p.runId ?? "(none)"}; known: ${[...runs.keys()].join(", ") || "none"}` }], isError: true };

			switch (p.action) {
				case "status":
					if (run.session && run.status === "running") harvest(run);
					return { content: [{ type: "text", text: `${summary(run)}${run.status === "running" && run.lastTool ? `\nlast tool: ${run.lastTool}` : ""}` }], details: view(run) };
				case "result":
					return { content: [{ type: "text", text: resultText(run) }], details: view(run) };
				case "cancel":
					if (run.status !== "running") return { content: [{ type: "text", text: `${run.id} already ${run.status}` }] };
					run.status = "cancelled";
					await run.session?.abort();
					return { content: [{ type: "text", text: `${run.id} cancelled` }] };
				case "steer": {
					if (!p.message) return { content: [{ type: "text", text: "steer requires message" }], isError: true };
					if (!run.session) return { content: [{ type: "text", text: `${run.id} has no retained session (retired); start a new delegate with context fork` }], isError: true };
					if (run.status === "running") {
						await run.session.steer(p.message);
						return { content: [{ type: "text", text: `${run.id}: steer queued` }] };
					}
					run.status = "running";
					run.endedAt = undefined;
					run.error = undefined;
					run.dirtyBefore = snapshotDirty(run.cwd);
					const timeoutMs = DEFAULT_TIMEOUT_MS;
					run.timer = setTimeout(() => {
						run.status = "timeout";
						run.session.abort().catch(() => {});
					}, timeoutMs);
					const onAbort = () => {
						if (run.status === "running") {
							run.status = "cancelled";
							run.session.abort().catch(() => {});
						}
					};
					signal?.addEventListener("abort", onAbort, { once: true });
					try {
						await run.session.prompt(p.message);
						finish(run, run.status === "running" ? "complete" : run.status);
					} catch (e: any) {
						finish(run, run.status === "running" ? "error" : run.status, String(e?.message ?? e));
					}
					return { content: [{ type: "text", text: resultText(run) }], details: view(run), isError: run.status !== "complete" };
				}
			}
			return { content: [{ type: "text", text: "unreachable" }], isError: true };
		},
	});

	pi.registerMessageRenderer("delegate", (message: any, { expanded }: any, theme: any) => {
		const v = message.details as RunView | undefined;
		if (!v || typeof v !== "object" || !("id" in v)) return undefined;
		const header = `${theme.fg("accent", "◆")} ${theme.fg("toolTitle", theme.bold("delegate"))}${theme.fg("muted", `: ${v.role}`)} ${theme.fg("dim", "finished")}`;
		// The tool frame above is live and already shows the full result; the wake is a one-line notice unless expanded.
		return framed((width) => frame(header, expanded ? resultLines(v, true, theme, width - 4, 0) : resultLines(v, false, theme, width - 4, 0).slice(0, 1), borderFor(v), theme, width));
	});

	pi.on("session_shutdown", async () => {
		for (const r of runs.values()) {
			try {
				r.session?.dispose();
			} catch {
				/* ignore */
			}
		}
	});
}
