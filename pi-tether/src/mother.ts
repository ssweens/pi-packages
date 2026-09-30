import { randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Message, Model } from "@earendil-works/pi-ai";
import type { MomStore } from "./sidecar.ts";
import type { AdvisorRecord, SessionAdvisor } from "./advisor.ts";
import { branchCheckpoints, emptyUsage, graphChange, loadState, noticeKey, sumUsage, type Checkpoint, type CursorFailure, type SkippedGap, type Usage } from "./checkpoint.ts";
import { LiveFeed, renderEvent, renderEvents, suffix, type Cut, type FeedEvent } from "./feed.ts";
import type { CompactionReview } from "./compaction.ts";
import { acceptGraph, MOM_PROMPT, momTools, validateSearchQuery } from "./contract.ts";
import { emptyGraph, graphSlice } from "./graph.ts";

export const DEFAULT_MODEL = "openai-codex/gpt-5.6-luna";
export const CONTEXT_LIMIT = 90000;
type StagedBatch = Awaited<ReturnType<LiveFeed["capture"]>> & { revision: number; from: Cut; startIndex: number; endIndex: number;
	retryGapId?: string; retryGapRemaining?: string[] };

/** Gap evidence was originally admitted under the same 24k feed budget. Keep
 * recovery bounded too, including for sidecars produced by older/broken builds. */
function boundedGapEvents(events: readonly FeedEvent[], limit = 24000): { events: FeedEvent[]; remaining: string[] } {
	const selected: FeedEvent[] = [];
	for (const event of events) {
		if (renderEvents([...selected, event]).length > limit) break;
		selected.push(event);
	}
	if (!selected.length && events.length) throw new Error("One recorded gap event exceeds Mom's 24,000-character recovery limit; nothing was truncated.");
	return { events: selected, remaining: events.slice(selected.length).map(event => event.ref) };
}

export interface MomHost {
	ctx: ExtensionContext;
	model: string;
	advisor?: SessionAdvisor;
	/** Durable state lives beside the session transcript, never inside it. */
	store: MomStore;
	current(): boolean;
	changed(): void;
}

/** Fresh model context per update. Mom owns the graph; working agents only read it. */
export class Mom {
	readonly feed: LiveFeed;
	checkpoint?: Checkpoint;
	checkpointId?: string;
	private readonly initialGraph = emptyGraph();
	// Cache affinity across bounded updates, not a persistent conversation. Reset with the branch instance.
	private readonly cacheSessionId = randomUUID();
	get graph() { return this.checkpoint?.graph ?? this.initialGraph; }
	enabled = true;
	/** Delivered risks remain unresolved until a sourced resolution record closes them. */
	readonly unresolvedNotices = new Set<string>();
	usage = emptyUsage();
	error?: string;
	busy = false;
	more = false;
	waitingForWorkers = false;
	coveredRevision = -1;
	private disposed = false;
	private controller?: AbortController;
	private committed = 0;
	private checkpoints: { id: string; data: Checkpoint }[] = [];
	failure?: CursorFailure;
	gaps: SkippedGap[] = [];
	private staged?: StagedBatch;
	private queued?: StagedBatch;

	constructor(private host: MomHost) { this.feed = new LiveFeed(host.ctx.sessionManager); }

	async open(): Promise<void> {
		const state = await loadState(this.host.store, this.host.ctx.sessionManager);
		const cutoverCheckpointId = state.cutover ? state.checkpointId : undefined;
		if (state.cutover && state.checkpoint) {
			// One atomic current-format snapshot completes the version-free graph cutover.
			// A failed append leaves the old sidecar untouched and opening fails loudly.
			const checkpoint = { ...state.checkpoint, at: Date.now() };
			const saved = await this.host.store.append("map", { snapshot: checkpoint, ...(state.failure ? { failure: state.failure } : {}) });
			state.checkpoint = checkpoint; state.checkpointId = saved.id; state.coverageCut = checkpoint.cut; delete state.cutover;
		}
		this.checkpoint = state.checkpoint;
		this.checkpointId = state.checkpointId;
		this.enabled = state.enabled;
		this.unresolvedNotices.clear(); for (const key of state.unresolvedNotices) this.unresolvedNotices.add(key);
		this.usage = state.usage ?? emptyUsage();
		this.error = state.error;
		this.failure = state.failure; this.gaps = state.gaps;
		await this.feed.restore(state.failure?.through ?? state.coverageCut ?? this.checkpoint?.cut);
		if (this.checkpoint) for (const item of [...this.checkpoint.graph.nodes, ...this.checkpoint.graph.edges]) for (const ref of item.sources) {
			if (!this.feed.byRef.has(ref)) throw new Error(`Checkpoint cites an unknown or unobserved source: ${ref}`);
		}
		if (state.failure) {
			const events = state.failure.refs.map(ref => this.feed.byRef.get(ref)).filter((event): event is NonNullable<typeof event> => Boolean(event));
			if (events.length !== state.failure.refs.length) throw new Error("Mom cannot restore the evidence range recorded for retry.");
			this.committed = this.feed.events.length - events.length;
			this.staged = { events, cut: state.failure.through, from: state.failure.from, gaps: [], more: false, revision: 0,
				startIndex: this.committed, endIndex: this.feed.events.length };
		} else this.committed = this.feed.events.length;
		this.checkpoints = branchCheckpoints(await this.host.store.load(), new Set(this.host.ctx.sessionManager.getBranch().map(e => e.id)))
			.filter(item => item.id !== cutoverCheckpointId);
	}

	detail() { return { failureState: this.failure, skippedEvidence: this.gaps, sessionUsage: this.usage }; }

	readGraph(options: { nodes?: string[]; depth?: number; checkpoint?: string } = {}) {
		let checkpoint = this.checkpoint, checkpointId = this.checkpointId;
		if (options.checkpoint) {
			const entry = this.checkpoints.find(c => c.id === options.checkpoint);
			if (!entry) throw new Error("Graph checkpoint is unavailable on this session's selected branch.");
			checkpoint = entry.data; checkpointId = entry.id;
		}
		const all = [...this.checkpoints].sort((a, b) => a.data.at - b.data.at);
		const index = all.findIndex(c => c.id === checkpointId);
		const previous = index > 0 ? all[index - 1] : undefined;
		const original = this.feed.events.find(e => e.actor === "lead" && e.kind === "user");
		const historical = Boolean(options.checkpoint && options.checkpoint !== this.checkpointId);
		return { initialized: Boolean(checkpoint), format: "endeavors",
			checkpoint: checkpointId, previousCheckpoint: previous?.id, at: checkpoint?.at,
			change: checkpoint ? checkpoint.change ?? graphChange(previous?.data.graph ?? null, checkpoint.graph) : undefined,
			unfinished: checkpoint?.unfinished, historical,
			original: original ? { ref: original.ref, text: original.text } : null,
			...(checkpoint ? graphSlice(checkpoint.graph, options.nodes, options.depth) : graphSlice(this.initialGraph, options.nodes, options.depth)) };
	}

	private valid(cut: Cut): void {
		if (this.disposed || !this.host.current()) throw new Error("Mom update superseded by a session/branch change.");
		suffix(this.host.ctx.sessionManager, this.host.ctx.sessionManager.getLeafId(), cut.parent);
	}

	async update(question?: string, signal?: AbortSignal, revision = 0, refresh = false, compactionReview?: CompactionReview): Promise<string | undefined> {
		if (this.busy) throw new Error("Mom already has an update in flight.");
		if (this.disposed) throw new Error("Mom session is closed.");
		this.busy = true;
		this.controller = new AbortController();
		const started = performance.now();
		let attempt = emptyUsage();
		let advisor: AdvisorRecord | undefined;
		this.host.changed();
		try {
			let newer: StagedBatch | undefined;
			if (!this.staged) {
				const from = this.checkpoint?.cut ?? this.feed.cut(), startIndex = this.feed.events.length;
				const captured = await this.feed.capture(24000, true);
				this.staged = { ...captured, revision, from, startIndex, endIndex: this.feed.events.length };
			} else if (this.waitingForWorkers) {
				const used = renderEvents(this.staged.events).length;
				const next = await this.feed.capture(24000 - used, true);
				this.staged = { ...this.staged, events: [...this.staged.events, ...next.events], cut: next.cut,
					gaps: [...new Set([...this.staged.gaps, ...next.gaps])], more: this.staged.more || next.more, revision,
					endIndex: this.feed.events.length };
			} else if (!question && this.failure) {
				const startIndex = this.feed.events.length, next = await this.feed.capture(24000, true);
				if (next.events.length) {
					this.queued = this.queued ? { ...this.queued, events: [...this.queued.events, ...next.events], cut: next.cut,
						gaps: [...new Set([...this.queued.gaps, ...next.gaps])], more: this.queued.more || next.more, revision,
						endIndex: this.feed.events.length }
						: { ...next, revision, from: this.staged.cut, startIndex, endIndex: this.feed.events.length };
				}
				newer = this.queued;
				if (!newer && !refresh) return undefined;
			}
			if (refresh && this.gaps.length) {
				const gap = this.gaps[0], pending = this.staged!;
				const old = gap.refs.map(ref => this.feed.byRef.get(ref)).filter((event): event is NonNullable<typeof event> => Boolean(event));
				if (old.length !== gap.refs.length) throw new Error("Mom cannot retry a skipped range because its recorded sources are unreadable.");
				const chunk = boundedGapEvents(old);
				// A durable gap is retried alone. Pending later evidence remains staged in
				// source order and cannot inflate recovery past the context ceiling or be
				// accidentally covered by the retry's cursor record.
				newer = pending.events.length ? pending : undefined;
				this.queued = newer;
				const gapStart = this.feed.events.findIndex(event => event.ref === chunk.events[0]?.ref);
				if (gapStart < 0) throw new Error("Mom cannot locate the recorded gap boundary in the restored evidence stream.");
				this.staged = { events: chunk.events, cut: this.checkpoint?.cut ?? gap.through, from: gap.from,
					gaps: [], more: chunk.remaining.length > 0, revision, startIndex: gapStart, endIndex: this.committed,
					retryGapId: gap.id, retryGapRemaining: chunk.remaining };
			}
			const batch = this.staged;
			this.valid(batch.cut);
			this.more = batch.more;
			if (!question && this.feed.hasRunningWorkers) {
				// Keep the whole settled lead batch pending. The delegate-settled event retries it
				// with the worker's complete transcript; no inference observes a partial run.
				this.waitingForWorkers = true;
				return undefined;
			}
			this.waitingForWorkers = false;
			if (!batch.events.length && !question && !compactionReview) { this.coveredRevision = batch.revision; this.staged = undefined; return undefined; }
			this.error = undefined;
			const [provider, ...id] = this.host.model.split("/");
			const model = this.host.ctx.modelRegistry.find(provider, id.join("/"));
			if (!model) throw new Error(`Mom model unavailable: ${this.host.model}. No fallback selected.`);
			const newRefs = new Set(batch.events.map((e) => e.ref));
			const known = compactionReview ? new Map(this.feed.byRef).set(compactionReview.triggerRef, compactionReview.triggerEvent) : this.feed.byRef;
			if (compactionReview) newRefs.add(compactionReview.triggerRef);
			const inspected = new Set<string>();
			let readPages = question ? 2 : 0, searches = question ? 2 : 0;
			let emptySearch: string | undefined;
			let searchRetryOnly = false;
			const original = this.feed.events.find((e) => e.actor === "lead" && e.kind === "user");
			// The map is current state; the session log is history. Include only one boundary
			// event so a short assent can resolve the preceding proposal, then use evidence tools.
			const prior = this.feed.events.slice(0, batch.startIndex).findLast((e) => e.actor === "lead" && Boolean(e.text) && ["assistant", "tool_call"].includes(e.kind));
			const unresolved = new Set(this.unresolvedNotices);
			if (this.checkpoint?.note) unresolved.add(noticeKey(this.checkpoint.note));
			const messages: Message[] = [{ role: "user", timestamp: Date.now(), content: JSON.stringify({
				original: original ? { ref: original.ref, text: original.text } : null,
				graph: this.graph, contextBeforeBatch: prior ? renderEvent(prior) : null,
				newEvents: renderEvents(batch.events), gaps: batch.gaps, pendingMore: batch.more,
				compactionReview: compactionReview ?? null,
				unresolvedProcessRisks: [...unresolved],
				question: question ?? null, evidencePagesRemaining: readPages, metadataSearchesRemaining: searches,
			}) }];
			let mustInspect = false;
			const read = async (ref: string, offset: number, limit: number) => {
				try { const result = await this.feed.lookup(ref, offset, limit); inspected.add(ref); return result; }
				catch (error) { return { ref, error: String(error) }; }
			};
			const maxCalls = question ? 5 : 2;
			let deterministicFailure: Error | undefined;
			for (let round = 0; round < maxCalls; round++) {
				this.valid(batch.cut);
				if (MOM_PROMPT.length + JSON.stringify(messages).length > CONTEXT_LIMIT) throw new Error("Mom context exceeds 90,000 characters. Last checkpoint retained; no silent truncation.");
				const availableSearches = question && readPages === 0 ? 0 : searches;
				const context = { systemPrompt: MOM_PROMPT, messages, tools: question
					? momTools(readPages, availableSearches, mustInspect, searchRetryOnly)
					: momTools(0, 0, false, false) };
				const options = { maxTokens: 6000, sessionId: this.cacheSessionId,
					signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(120000), ...(signal ? [signal] : [])]), maxRetryDelayMs: 1000 };
				const reply = model.api === "openai-codex-responses"
					? await this.host.ctx.modelRegistry.complete(model as Model<"openai-codex-responses">, context, { ...options, reasoningEffort: "low", toolChoice: "required",
						// The SDK defaults to parallel calls; this protocol accepts one operation.
						onPayload: (payload) => { (payload as { parallel_tool_calls: boolean }).parallel_tool_calls = false; },
					})
					: await this.host.ctx.modelRegistry.streamSimple(model, context, { ...options, reasoning: "low" }).result();
				attempt = sumUsage(attempt, { calls: 1, input: reply.usage.input, output: reply.usage.output,
					cacheRead: reply.usage.cacheRead, cacheWrite: reply.usage.cacheWrite, nominalCost: reply.usage.cost.total, elapsedMs: 0 });
				this.valid(batch.cut);
				const operations = reply.content.filter((b) => b.type === "toolCall");
				const callsRemaining = maxCalls - round - 1;
				// Provider/API failures are transient transport outcomes, not deterministic model-output defects.
				if (reply.stopReason === "error") throw new Error(reply.errorMessage ?? "Mom provider failed.");
				if (reply.stopReason !== "toolUse" || operations.length !== 1) {
					const invalid = new Error(reply.errorMessage ?? `Mom returned ${reply.stopReason}; expected one operation.`);
					if (question || callsRemaining === 0) { deterministicFailure = invalid; break; }
					messages.push(reply, { role: "user", content: `The proposal was not a single commit_graph operation. ${invalid.message} One repair call remains; return commit_graph only.`, timestamp: Date.now() });
					continue;
				}
				const operation = operations[0];
				const args = operation.arguments;
				if (operation.name === "commit_graph") {
					if (searchRetryOnly) throw new Error("Retry the zero-result search with a shorter literal phrase before any other operation.");
					if (mustInspect) throw new Error("Inspect an original source from the search before answering.");
					let next;
					try { next = acceptGraph(args, this.graph, this.checkpointId, known, newRefs, inspected, question, Boolean(compactionReview), unresolved); }
					catch (error) {
						if (callsRemaining === 0) {
							if (question) throw error;
							deterministicFailure = error instanceof Error ? error : new Error(String(error)); break;
						}
						messages.push(reply, { role: "toolResult", toolCallId: operation.id, toolName: operation.name, isError: true,
							content: [{ type: "text", text: `Graph transaction rejected; last checkpoint unchanged. ${String(error)} Correct all reported defects and resubmit once. ${callsRemaining} model call remains in this background update.` }], timestamp: Date.now() });
						continue;
					}
					this.valid(batch.cut);
					if (!question && this.host.advisor && !advisor) {
						const reviewStarted = performance.now();
						try {
							const review = await this.host.advisor.review({ current: this.graph, proposed: next.graph,
								newEvidence: renderEvents(batch.events), pendingMore: batch.more },
								AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]));
							const reexamined = review.action !== "accept" || review.needsReanalysis >= this.host.advisor.threshold;
							advisor = { ...review, reexamined };
							if (reexamined) {
								if (callsRemaining === 0) throw new Error("Mom's advisor requested reconsideration, but the five-call update budget is exhausted.");
								messages.push(reply, { role: "toolResult", toolCallId: operation.id, toolName: operation.name, isError: true,
									content: [{ type: "text", text: `Candidate not saved. A probabilistic session-level advisor requested one deeper reconsideration (p=${review.needsReanalysis.toFixed(3)}; likely action=${review.action}; action probabilities=${JSON.stringify(review.probabilities)}). Review the whole account for material expansion, contraction, path change, or reorganization. This is advice, not a gate or per-message checklist. ${callsRemaining} model call${callsRemaining === 1 ? "" : "s"} remain; keep the candidate unchanged if the session evidence still supports it.` }], timestamp: Date.now() });
								continue;
							}
						} catch (error) {
							if (this.controller.signal.aborted || signal?.aborted) throw error;
							advisor = { status: "unavailable", model: this.host.advisor.model, error: String(error),
								latencyMs: Math.round(performance.now() - reviewStarted), reexamined: false };
						}
					}
					this.valid(batch.cut);
					attempt.elapsedMs = Math.round(performance.now() - started);
					const acceptedAt = Date.now(), acceptedUsage = sumUsage(this.usage, attempt);
					// A graph-identical acceptance still advances durable evidence coverage. Keep
					// that compact by layering a cursor record over the latest full checkpoint.
					const resolutionKeys = new Set(next.resolutions.map(item => `${item.riskClass}:${item.target}`));
					const pendingNotice = this.checkpoint?.note?.nextRequest && !this.unresolvedNotices.has(noticeKey(this.checkpoint.note)) && !resolutionKeys.has(noticeKey(this.checkpoint.note)) ? this.checkpoint.note : null;
					// All process advice reuses 005's next-request path; no notice is injected into a settled lead turn.
					const proposedNotice = next.note ? { ...next.note, nextRequest: true } : null;
					const effectiveNote = proposedNotice ?? pendingNotice;
					const material = !this.checkpoint
						|| JSON.stringify(next.graph) !== JSON.stringify(this.graph)
						|| JSON.stringify(effectiveNote) !== JSON.stringify(this.checkpoint.note ?? null)
						|| JSON.stringify(next.unfinished) !== JSON.stringify(this.checkpoint.unfinished ?? []);
					const retriedGap = batch.retryGapId ? this.gaps.find(gap => gap.id === batch.retryGapId) : undefined;
					const gapUpdate = !batch.retryGapId ? {} : batch.retryGapRemaining?.length && retriedGap
						? { gap: { action: "open", ...retriedGap, refs: batch.retryGapRemaining } }
						: { gap: { action: "resolved", id: batch.retryGapId } };
					const resolutionUpdate = resolutionKeys.size ? { resolvedNotices: [...resolutionKeys] } : {};
					if (material) {
						const checkpoint: Checkpoint = { sessionId: this.host.ctx.sessionManager.getSessionId(),
							graph: next.graph, change: graphChange(this.checkpoint?.graph ?? this.initialGraph, next.graph),
							note: effectiveNote, unfinished: next.unfinished, cut: batch.cut, at: acceptedAt, model: this.host.model,
							...(advisor ? { advisor } : {}) };
						let record;
						try { record = await this.host.store.append("map", { snapshot: checkpoint, failure: null, ...gapUpdate, ...resolutionUpdate }); }
						catch (error) { throw new Error(`Mom could not write her state beside the session: ${String(error)}`); }
						this.checkpoint = checkpoint; this.checkpointId = record.id;
						this.checkpoints.push({ id: record.id, data: checkpoint });
					} else {
						if (!this.checkpointId) throw new Error("Mom cannot advance evidence coverage without a saved sidecar checkpoint.");
						try { await this.host.store.append("map", { base: this.checkpointId, cut: batch.cut, failure: null, ...gapUpdate, ...resolutionUpdate }); }
						catch (error) { throw new Error(`Mom could not advance her state beside the session: ${String(error)}`); }
						this.checkpoint = { ...this.checkpoint!, cut: batch.cut, at: acceptedAt };
					}
					// Risk resolutions and their consumed evidence commit in the same map record.
					for (const key of resolutionKeys) this.unresolvedNotices.delete(key);
					this.usage = acceptedUsage;
					if (batch.retryGapId) {
						if (batch.retryGapRemaining?.length && retriedGap) this.gaps = this.gaps.map(gap => gap.id === batch.retryGapId
							? { ...retriedGap, refs: batch.retryGapRemaining! } : gap);
						else this.gaps = this.gaps.filter(gap => gap.id !== batch.retryGapId);
					}
					// Usage is its own compact stream; a failed write never invalidates an accepted map.
					try { await this.host.store.append("usage", { usage: this.usage, error: null }); } catch { /* usage bookkeeping is best-effort */ }
					this.failure = undefined;
					this.coveredRevision = batch.revision;
					this.committed = batch.endIndex; this.staged = newer; this.queued = undefined;
					return next.answer;
				}
				if (!question) {
					const invalid = new Error(`Background Mom may call commit_graph only, not ${operation.name}.`);
					if (callsRemaining === 0) { deterministicFailure = invalid; break; }
					messages.push(reply, { role: "toolResult", toolCallId: operation.id, toolName: operation.name, isError: true,
						content: [{ type: "text", text: `${invalid.message} No retrieval is available in background updates. One repair call remains.` }], timestamp: Date.now() });
					continue;
				}
				let result: unknown;
				if (operation.name === "inspect_evidence" && readPages > 0 && !searchRetryOnly) {
					if (typeof args.ref !== "string" || typeof args.offset !== "number" || typeof args.limit !== "number" || !Number.isSafeInteger(args.offset) || args.offset < 0 || !Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 4000) throw new Error("Invalid evidence request.");
					readPages--;
					const paired = this.feed.pairedSource(args.ref);
					// Either entry point supplies the pair within one page's character budget.
					const companion = paired && !inspected.has(paired) && args.limit > 1 ? await read(paired, 0, Math.floor(args.limit / 2)) : undefined;
					const available = args.limit - (companion && "text" in companion ? companion.text.length : 0);
					const results = [await read(args.ref, args.offset, available)];
					if (companion) results.push(companion);
					mustInspect = false;
					result = { results, evidencePagesRemaining: readPages, metadataSearchesRemaining: searches };
				} else if (operation.name === "search_history" && searches > 0 && !mustInspect && (!question || readPages > 0)) {
					let query: string;
					try { query = validateSearchQuery(args.query, searchRetryOnly ? emptySearch : undefined); }
					catch (error) {
						if (callsRemaining === 0) throw error;
						messages.push(reply, { role: "toolResult", toolCallId: operation.id, toolName: operation.name, isError: true,
							content: [{ type: "text", text: `${String(error)} No metadata search was consumed; ${searches} remain. ${callsRemaining} model call${callsRemaining === 1 ? "" : "s"} remain in this update.${searchRetryOnly ? " Retry now with a shorter literal phrase; no other operation is available." : ""}` }], timestamp: Date.now() });
						continue;
					}
					searches--;
					const found = await this.feed.search(query, AbortSignal.any([this.controller.signal, AbortSignal.timeout(120000), ...(signal ? [signal] : [])]), question ?? query);
					mustInspect = Boolean(question && found.matches.length && readPages > 0);
					if (!found.matches.length && emptySearch === undefined && searches > 0) { emptySearch = query; searchRetryOnly = true; }
					else searchRetryOnly = false;
					result = { ...found, limit: 5, evidencePagesRemaining: readPages, metadataSearchesRemaining: searches,
						shorterLiteralRetryRequired: searchRetryOnly, originalSourceReadRequired: mustInspect };
				} else throw new Error(`Unavailable Mom operation: ${operation.name}`);
				messages.push(reply, { role: "toolResult", toolCallId: operation.id, toolName: operation.name, isError: false,
					content: [{ type: "text", text: JSON.stringify(result) }], timestamp: Date.now() });
			}
			if (question) throw deterministicFailure ?? new Error("Mom did not produce an accepted graph transaction within five calls. Last checkpoint retained.");
			const failureError = deterministicFailure ?? new Error("Mom did not produce an accepted background graph transaction within two calls.");
			if (batch.gaps.length) throw new Error(`Mom evidence remained unreadable; cursor retained and no skipped gap recorded. ${batch.gaps.join("; ")}`);
			if (batch.retryGapId) {
				// The existing durable gap remains authoritative. A failed refresh neither
				// advances coverage nor manufactures a duplicate skipped range.
				this.staged = this.queued; this.queued = undefined;
				throw failureError;
			}
			const refs = batch.events.map(event => event.ref);
			const key = JSON.stringify({ from: batch.from, through: batch.cut, refs });
			const failures = this.failure?.key === key ? this.failure.failures + 1 : 1;
			const failure: CursorFailure = { key, from: batch.from, through: batch.cut, refs, error: String(failureError), failures };
			if (failures < 2) {
				await this.host.store.append("map", { failure });
				this.failure = failure;
			} else {
				const gap: SkippedGap = { ...failure, id: randomUUID() };
				// One map record both exposes the gap and advances coverage. A failed append skips nothing.
				await this.host.store.append("map", { base: this.checkpointId ?? null, cut: gap.through, failure: null,
					gap: { action: "open", ...gap } });
				this.gaps.push(gap); this.failure = undefined;
				if (this.checkpoint) this.checkpoint = { ...this.checkpoint, cut: batch.cut, at: Date.now() };
				this.committed = batch.endIndex; this.staged = newer; this.queued = undefined;
			}
			throw failureError;
		} catch (error) {
			if (!this.disposed && this.host.current()) {
				this.error = String(error);
				if (attempt.calls) {
					attempt.elapsedMs = Math.round(performance.now() - started);
					this.usage = sumUsage(this.usage, attempt);
					try { await this.host.store.append("usage", { usage: this.usage, error: this.error }); }
					catch { /* The original failure remains visible; no map was published. */ }
				}
			}
			throw error;
		} finally {
			this.busy = false;
			this.controller = undefined;
			if (!this.disposed && this.host.current()) this.host.changed();
		}
	}

	close(): void { this.disposed = true; this.controller?.abort(); }
}
