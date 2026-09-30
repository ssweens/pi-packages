/** Mom owns the work graph. Working agents read it; they never maintain it. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { SystemOneAdvisor } from "./advisor.ts";
import { NOTICE, noticeKey } from "./checkpoint.ts";
import { CORRECTION } from "./feed.ts";
import { finishCompactionReview, prepareCompactionReview, type PendingCompactionReview } from "./compaction.ts";
import { DEFAULT_MODEL, Mom } from "./mother.ts";
import { SidecarStore } from "./sidecar.ts";
import { FOCUS_KEY, MomPanel, widgetLines, type PanelView } from "./panel.ts";
import { formatElapsed, isStatusPing } from "./status.ts";
import { presentGraph, readText, summaryText, type WorkView } from "./presentation.ts";

export const DELEGATE_MILESTONE_EVENT = "pi-delegate:milestone.v1";
export const LEAD_BEHAVIOR_SECTION = `Mom observes and maps the work; the lead does not maintain her notes.

- The user changes direction quickly and may not announce a pivot. Treat every direction change as an implicit park of interrupted work. Follow the new direction without asking for confirmation, announcing the parking, or slowing the user down. Mom records the abandoned thread silently. Surface parked work only at session start or when current work collides with it.
- Always notice and respect clear, scoped assent such as “yes, note that” or “yes, let's go down that path” for exactly the point or path it addresses; do not generalize it to nearby proposals. Respect that assent while it is current. If later direction appears to conflict, check the recorded session evidence and follow the latest clear direction without asking the user to reconfirm the pivot.`;
const LEAD_BEHAVIOR_SECTION_KEY = "mom_lead_behavior";
const WIDGET = "pi-tether";

export default function piTether(pi: ExtensionAPI) {
	pi.registerFlag("mom-model", { description: "Exact provider/model for Mom; never inherits or silently substitutes the lead model", type: "string", default: DEFAULT_MODEL });
	pi.registerFlag("mom-interval-ms", { description: "Minimum spacing between background Mom updates (milliseconds)", type: "string", default: "15000" });
	pi.registerFlag("mom-advisor-url", { description: "Optional LAN System One endpoint for session-level review; empty disables it", type: "string", default: "" });
	pi.registerFlag("mom-advisor-model", { description: "System One model used to review Mom's proposed account", type: "string", default: "kev-latest" });
	pi.registerFlag("mom-advisor-threshold", { description: "Probability that triggers one deeper Mom reconsideration", type: "string", default: "0.70" });
	pi.registerFlag("mom-advisor-timeout-ms", { description: "Session-level advisor timeout in milliseconds", type: "string", default: "1500" });
	let ctx: ExtensionContext | undefined;
	let mom: Mom | undefined;
	let ready: Promise<void> = Promise.resolve();
	let openingError: string | undefined;
	let readError: string | undefined;
	let savedView: { owner: Mom; checkpoint: Mom["checkpoint"]; complete: boolean; work: WorkView; summary: string } | undefined;
	let epoch = 0;
	let revision = 0;
	let coveredRevision = -1;
	let dirty = false;
	let store: SidecarStore | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let flight: Promise<string | undefined> | undefined;
	let lastStarted = 0;
	let leadTool: string | undefined;
	let pendingCompaction: PendingCompactionReview | undefined;
	let unsubscribe: (() => void) | undefined;
	// Session reload must not overtake a just-published notice's sidecar record.
	let noticePersistence: Promise<void> = Promise.resolve();
	const interval = () => {
		const n = Number(pi.getFlag("mom-interval-ms") ?? 15000);
		return Number.isFinite(n) && n >= 0 ? n : 15000;
	};

	function savedWork(complete: boolean) {
		if (!mom || openingError) return savedView?.owner === mom ? savedView : undefined;
		if (!savedView || savedView.owner !== mom || savedView.checkpoint !== mom.checkpoint || savedView.complete !== complete) {
			const work = presentGraph({ ...mom.readGraph(), coverageComplete: complete });
			savedView = { owner: mom, checkpoint: mom.checkpoint, complete, work, summary: summaryText(work) };
		}
		return savedView;
	}
	function view(): PanelView {
		const m = mom;
		const blocked = Boolean(openingError || m?.error || m?.feed.gaps.size || m?.failure || m?.gaps.length);
		const error = blocked ? "Mom couldn't update her notes. Showing the last saved view; /mom detail has the reason." : undefined;
		const complete = Boolean(m) && !m!.busy && !blocked && !dirty && !m!.more && coveredRevision === revision;
		const freshness = m?.busy ? "updating" : blocked ? "update stopped" : !complete ? "catching up" : "up to date";
		const checked = m?.checkpoint ? `last saved ${formatElapsed(Date.now() - m.checkpoint.at)} ago` : "nothing saved yet";
		const status = `${m?.enabled === false ? "paused" : freshness} · ${checked}${ctx && !ctx.isIdle() ? ` · agent ${leadTool ? `using ${leadTool}` : "working"}` : ""}`;
		const saved = savedWork(complete);
		return { status, complete, work: saved?.work, summary: saved?.summary ?? "", note: complete ? m?.checkpoint?.note?.text : undefined, error };
	}
	function sync() {
		if (!ctx?.hasUI) return;
		ctx.ui.setWidget(WIDGET, (_tui, theme) => ({ render: (width) => widgetLines(view(), theme, width), invalidate() {} }));
	}
	function cached(): string {
		const v = view();
		const u = mom?.usage;
		return `${v.summary || "Mom has not saved a view of this work yet."}\n\n${v.status}${v.error ? `\n${v.error}` : ""}${v.note ? `\n\nNotice: ${v.note}` : ""}${u ? `\n\nMom (session): ${u.calls} model calls · ${u.input + u.cacheRead + u.cacheWrite} input tokens · ${u.output} output tokens · $${u.nominalCost.toFixed(5)} nominal · ${(u.elapsedMs / 1000).toFixed(1)}s cumulative model/update time` : ""}`;
	}
	async function deliver(onNextRequest = false) {
		const m = mom, note = m?.checkpoint?.note;
		const nextRequestNotice = Boolean(onNextRequest && note?.nextRequest);
		if ((onNextRequest && !note?.nextRequest) || (note?.nextRequest && !onNextRequest)) return;
		if (!m || !note || !ctx || !m.enabled || m.busy || m.error || m.failure || m.gaps.length || openingError || m.feed.gaps.size ||
			(!nextRequestNotice && (dirty || m.more || !ctx.isIdle() || ctx.hasPendingMessages() || coveredRevision !== revision))) return;
		const key = noticeKey(note);
		if (m.unresolvedNotices.has(key)) return;
		const destination = store, parent = ctx.sessionManager.getLeafId(), token = epoch;
		if (!destination) return;
		// Reserve durably before publishing. A crash can lose advice, but cannot repeat it.
		noticePersistence = noticePersistence.then(async () => {
			if (token !== epoch || m !== mom || m.unresolvedNotices.has(key)) return;
			await destination.append("notice", { key, action: "delivered", note, parent });
			m.unresolvedNotices.add(key);
			if (token !== epoch || m !== mom) return;
			// No steering, follow-up request, extra lead turn, or internal reference text.
			pi.sendMessage({ customType: NOTICE, content: `Mom: ${note.text}`,
				display: false, details: { key } }, { triggerTurn: false });
		}).catch(error => {
			if (token === epoch && m === mom) { m.error = `Mom could not deliver her advisory: ${String(error)}`; sync(); }
		});
		await noticePersistence;
	}
	async function run(question?: string, signal?: AbortSignal, refresh = false, compactionReview?: ReturnType<typeof finishCompactionReview>): Promise<string | undefined> {
		const requestedEpoch = epoch;
		await ready;
		if (requestedEpoch !== epoch) throw new Error("Mom request superseded by a session/branch change.");
		if (openingError) throw new Error(openingError);
		while (flight) {
			await flight.catch(() => undefined);
			if (requestedEpoch !== epoch) throw new Error("Mom request superseded by a session/branch change.");
			if (!question && !compactionReview) return undefined;
		}
		const mine = mom, token = epoch, observed = revision;
		if (!mine) throw new Error("Mom session is unavailable.");
		if (!mine.enabled) throw new Error("Mom is paused. Use /mom resume.");
		dirty = false; lastStarted = Date.now();
		const work = mine.update(question, signal, observed, refresh, compactionReview);
		flight = work;
		try {
			const answer = await work;
			if (token === epoch && mine === mom) {
				if (!mine.more) coveredRevision = mine.coveredRevision;
				if (coveredRevision !== revision) dirty = true;
				if (!compactionReview) await deliver();
			}
			return answer && (dirty || mine.more || coveredRevision !== revision)
				? `Mom is still catching up. This answer covers only the activity she has read so far.\n\n${answer}` : answer;
		} finally {
			// A superseded job must never clear a newer session's flight or timer.
			if (token === epoch && mine === mom && flight === work) {
				flight = undefined;
				sync();
				if (!mine.error && !mine.waitingForWorkers && (dirty || mine.more)) schedule();
			}
		}
	}
	function schedule() {
		if (!mom?.enabled || openingError || flight || timer) return;
		const token = epoch;
		// This timer only batches recorded activity/backlog. Idleness alone never wakes Mom.
		timer = setTimeout(() => {
			timer = undefined;
			if (token !== epoch || (ctx && !ctx.isIdle())) return;
			void run().catch(() => sync());
		}, Math.max(150, interval() - (Date.now() - lastStarted)));
	}
	function wake() { dirty = true; revision++; sync(); schedule(); }
	function reset(context: ExtensionContext) {
		epoch++;
		if (timer) clearTimeout(timer);
		timer = undefined; flight = undefined;
		mom?.close();
		unsubscribe?.();
		unsubscribe = pi.events.on(DELEGATE_MILESTONE_EVENT, (data: unknown) => {
			if (!data || typeof data !== "object") return;
			const e = data as Record<string, unknown>;
			if (e.version === 1 && typeof e.runId === "string" && e.kind === "settled") wake();
		});
		ctx = context; openingError = undefined; readError = undefined; savedView = undefined; lastStarted = 0;
		revision = 0; coveredRevision = -1; dirty = true; leadTool = undefined; pendingCompaction = undefined;
		const token = epoch, priorNoticePersistence = noticePersistence;
		const advisorUrl = String(pi.getFlag("mom-advisor-url") ?? "").trim();
		const instance: Mom = new Mom({ ctx: context, model: String(pi.getFlag("mom-model") ?? DEFAULT_MODEL),
			...(advisorUrl ? { advisor: new SystemOneAdvisor({ url: advisorUrl, model: String(pi.getFlag("mom-advisor-model") ?? "kev-latest"),
				threshold: Number(pi.getFlag("mom-advisor-threshold") ?? 0.7), timeoutMs: Number(pi.getFlag("mom-advisor-timeout-ms") ?? 1500) }) } : {}),
			// Durable state lives beside the session transcript, never inside it.
			store: store = new SidecarStore(() => context.sessionManager.getSessionFile(), context.sessionManager.getSessionId()),
			current: () => token === epoch && mom === instance && context.sessionManager.getSessionId() === ctx?.sessionManager.getSessionId(),
			changed: () => { if (token === epoch) sync(); },
		});
		mom = instance;
		ready = priorNoticePersistence.then(() => instance.open()).then(() => {
			if (token !== epoch) return;
			savedView = undefined;
			// Opening or changing branches only restores and renders durable state. New
			// inference waits for agent_settled, delegate settled, or an explicit request.
			sync();
		}).catch((error) => { if (token === epoch) { openingError = String(error); sync(); } });
		sync();
	}
	function close() {
		epoch++;
		if (timer) clearTimeout(timer);
		timer = undefined; mom?.close(); flight = undefined;
		unsubscribe?.(); unsubscribe = undefined;
		ctx?.ui.setWidget(WIDGET, undefined);
		mom = undefined; ctx = undefined; savedView = undefined; store = undefined;
	}

	pi.on("session_start", (_event, context) => { reset(context); });
	pi.on("session_tree", (_event, context) => { reset(context); });
	pi.on("session_shutdown", async () => { await noticePersistence; close(); });
	pi.on("session_before_compact", (event, context) => {
		pendingCompaction = prepareCompactionReview(event, context.sessionManager.getSessionId());
	});
	pi.on("session_compact_failed", () => { pendingCompaction = undefined; });
	pi.on("session_compact", async (event, context) => {
		ctx = context;
		const pending = pendingCompaction;
		pendingCompaction = undefined;
		if (!pending || !mom?.enabled || openingError) return;
		if (timer) clearTimeout(timer);
		timer = undefined; dirty = true; revision++; sync();
		const activeRefs = new Set(mom.graph.nodes.filter(node => node.state === "active" || node.state === "parked").flatMap(node => node.sources));
		try { await run(undefined, undefined, false, finishCompactionReview(pending, event, activeRefs)); }
		catch { sync(); }
	});
	pi.on("before_agent_start", async (event) => {
		const token = epoch;
		await ready.catch(() => undefined);
		if (token === epoch) await deliver(true);
		if (token === epoch && mom?.enabled) event.systemPromptOptions.sections[LEAD_BEHAVIOR_SECTION_KEY] = LEAD_BEHAVIOR_SECTION;
		else delete event.systemPromptOptions.sections[LEAD_BEHAVIOR_SECTION_KEY];
	});
	pi.on("agent_start", () => { sync(); });
	pi.on("agent_settled", (_event, context) => { ctx = context; leadTool = undefined; wake(); deliver(); });
	pi.on("tool_execution_start", (event) => { leadTool = event.toolName; sync(); });
	pi.on("tool_execution_end", () => { leadTool = undefined; sync(); });
	pi.on("input", async (event, context) => {
		if (event.source !== "extension") await deliver(true);
		if (event.source === "extension" || !isStatusPing(event.text)) return { action: "continue" as const };
		if (!context.hasUI) return { action: "continue" as const };
		context.ui.notify(cached(), "info");
		return { action: "handled" as const };
	});

	async function show(context: ExtensionContext) {
		if (context.mode !== "tui") { context.ui.notify(cached(), "info"); return; }
		await context.ui.custom<void>((tui, theme, _keys, done) => new MomPanel(view, theme, () => Math.max(5, tui.terminal.rows - 6), () => done()));
	}
	pi.registerShortcut(FOCUS_KEY, { description: "Show Mom's working page", handler: async (context) => { await show(context); } });
	pi.registerTool({ name: "mom", label: "Mom", description: "Find out where you are in the work: the goal, what this is part of, what's unfinished, and where to return after a detour. Default reads return a compact story map: current work, live rules, waiting choices, and folded history. Features, theories, postulates and things being tried form the map; rules, choices and observations are attached to them. Omit arguments or use graph={} for the map; graph.nodes selects full records; source reads original evidence. These reads make no model call. question asks Mom to reason about the history. Read-only: you do not maintain Mom's notes. Choose at most one of graph, source, question.",
		renderCall(args, theme) {
			const action = args.question ? "asking about the work" : args.source ? "reading original evidence" : args.graph?.checkpoint ? "reading earlier work" : args.graph ? "finding our place" : "where we are";
			return new Text(theme.fg("toolTitle", theme.bold("Mom")) + theme.fg("muted", ` · ${action}`), 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			const text = result.content.filter(part => part.type === "text").map(part => part.text).join("\n");
			const details = result.details as { overview?: string; expandable?: boolean } | undefined;
			return new Text(expanded ? text : `${details?.overview ?? text}${details?.expandable ? `\n${theme.fg("dim", "Expand for the selected records and sources.")}` : ""}`, 0, 0);
		},
		parameters: Type.Object({
			question: Type.Optional(Type.String({ description: "A question for Mom's bounded source-backed reasoning; omit for cached reads." })),
			graph: Type.Optional(Type.Object({
				nodes: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 20, description: "IDs of endeavors or attached notes from a previous read. Omit to see the whole map." })),
				depth: Type.Optional(Type.Integer({ minimum: 0, maximum: 3, description: "How much surrounding work to include (0–3, default 1). Even 0 explains the goal, your place in it, and what is outside the view." })),
				checkpoint: Type.Optional(Type.String({ description: "A saved-view ID from history or previousCheckpoint. Omit for the current view. Old records remain readable without reopening their work." })),
			}, { additionalProperties: false })),
			source: Type.Optional(Type.Object({ ref: Type.String({ minLength: 1 }), offset: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false })),
		}, { additionalProperties: false }),
		async execute(_id, args, signal): Promise<{ content: { type: "text"; text: string }[]; details: unknown }> {
			if ([args.graph, args.source, args.question?.trim()].filter(Boolean).length > 1) throw new Error("Choose one of graph, source, or question.");
			const token = epoch;
			await ready;
			if (token !== epoch) throw new Error("The session changed while Mom was reading. Ask again in the current session.");
			try {
				if (openingError || !mom) throw new Error(openingError ?? "Mom session is unavailable.");
				const reader = mom, state = view();
				if (args.graph || args.source) {
					const data = args.source ? { ...await reader.feed.lookup(args.source.ref, args.source.offset ?? 0), pairedRef: reader.feed.pairedSource(args.source.ref) }
						: { status: state.status, error: state.error, ...reader.readGraph(args.graph), coverageComplete: state.complete };
					if (token !== epoch || reader !== mom) throw new Error("The session changed while Mom was reading.");
					const work = args.source ? state.work! : presentGraph(data);
					const selected = Boolean(args.graph?.nodes?.length || args.graph?.checkpoint);
					const overview = args.source ? "Original recorded evidence, not new work or permission to act."
						: summaryText(work);
					const text = args.source ? `${overview}\n\n${JSON.stringify(data, null, 2)}` : readText(work, selected);
					return { content: [{ type: "text", text }], details: { at: reader.checkpoint?.at, overview, expandable: Boolean(args.source || selected), data } };
				}
				if (!args.question?.trim()) {
					const text = cached();
					return { content: [{ type: "text", text }], details: { at: reader.checkpoint?.at, overview: text } };
				}
				const answer = await run(args.question, signal);
				return { content: [{ type: "text", text: answer ?? "Mom returned no answer." }], details: { at: reader.checkpoint?.at } };
			} catch (error) {
				readError = String(error);
				throw new Error(`Mom couldn't ${args.question ? "answer that question" : "read that saved view or source"}. Her last saved notes are unchanged. ${args.question ? "Use /mom detail for the reason." : "Use an ID from a previous Mom read; /mom detail shows the reason."}`);
			}
		},
	});
	pi.registerCommand("mom", { description: "Mom: status · map|graph [endeavor] [depth] · detail · ask <question> · correct <text> · source <id> [offset] · refresh · pause · resume",
		handler: async (args, context) => {
			const [command, ...parts] = args.trim().split(/\s+/);
			const text = parts.join(" ");
			try {
				if (!command) { await show(context); return; }
				if (command === "status") { context.ui.notify(cached(), "info"); return; }
				if (command === "detail") {
					await ready;
					context.ui.notify(JSON.stringify({ error: openingError ?? mom?.error, lastReadError: readError,
						missingSources: mom ? [...mom.feed.gaps.values()] : [], ...mom?.detail(), saved: mom?.readGraph() }, null, 2), "info"); return;
				}
				if (command === "pause" || command === "resume") {
					if (!store) throw new Error("Mom session is unavailable.");
					await store.append("control", { enabled: command === "resume" });
					reset(context);
					if (command === "resume") { await ready; wake(); }
					context.ui.notify(`Mom ${command === "pause" ? "paused" : "resumed"}.`, "info"); return;
				}
				if (command === "correct") {
					if (!text) throw new Error("Use /mom correct <your correction>.");
					pi.sendMessage({ customType: CORRECTION, content: args.slice(args.indexOf(command) + command.length).trim(), display: true,
						details: { origin: "user-command" } }, { triggerTurn: false });
					wake(); return;
				}
				if (command === "graph" || command === "map") {
					await ready;
					if (openingError || !mom) throw new Error(openingError ?? "Mom session is unavailable.");
					context.ui.notify(readText(presentGraph(mom.readGraph({ nodes: parts[0] ? [parts[0]] : undefined, depth: parts[1] ? Number(parts[1]) : undefined })), Boolean(parts[0])), "info"); return;
				}
				if (command === "source") {
					await ready;
					if (!parts[0] || !mom) throw new Error("Use /mom source <source-id> [offset].");
					const source = await mom.feed.lookup(parts[0], Number(parts[1] ?? 0));
					context.ui.notify(`Original recorded evidence, not new work:\n${JSON.stringify(source, null, 2)}`, "info"); return;
				}
				if (command === "refresh") { await run(undefined, undefined, true); context.ui.notify(cached(), "info"); return; }
				if (command === "ask" && text) { const answer = await run(text); context.ui.notify(answer ?? "Mom returned no answer.", "info"); return; }
				throw new Error("Use /mom, status, map, graph, detail, ask, correct, source, refresh, pause, or resume.");
			} catch (error) {
				readError = String(error);
				context.ui.notify("Mom couldn't complete that request. Your last saved view is unchanged. Use /mom detail for the reason and /mom for your place in the work.", "error");
			}
		},
	});
}
