import type { Cut, SessionReader } from "./feed.ts";
import type { Notice } from "./contract.ts";
import { PROCESS_RISK_CLASSES, processNoticeKey } from "./process-health.ts";
import { isAdvisorRecord, type AdvisorRecord } from "./advisor.ts";
import type { MomStore, SidecarRecord } from "./sidecar.ts";
import { Check } from "typebox/value";
import { checkGraph, normalizeMotherRoot, Unfinished, type WorkGraph, type UnfinishedItems } from "./graph.ts";

export const NOTICE = "pi-tether.mom-notice";
export interface Usage {
	calls: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	nominalCost: number;
	elapsedMs: number;
}
export const emptyUsage = (): Usage => ({ calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, nominalCost: 0, elapsedMs: 0 });
export interface GraphChange {
	before: number | null; after: number;
	created: { id: string; label: string; sources: string[] }[];
	retired: { id: string; label: string; sources: string[] }[];
}
/** Recorded map changes, not a judgment of whether the interpretation was correct. */
export function graphChange(before: { nodes: readonly { id: string; label: string; sources: string[] }[] } | null, after: { nodes: readonly { id: string; label: string; sources: string[] }[] }): GraphChange {
	const oldIds = new Set(before?.nodes.map(n => n.id)), newIds = new Set(after.nodes.map(n => n.id));
	const record = ({ id, label, sources }: { id: string; label: string; sources: string[] }) => ({ id, label, sources: [...sources] });
	return { before: before?.nodes.length ?? null, after: after.nodes.length,
		created: after.nodes.filter(n => !oldIds.has(n.id)).map(record),
		retired: (before?.nodes ?? []).filter(n => !newIds.has(n.id)).map(record) };
}
/** One materialized map. Usage is a separate sidecar concern. */
export interface Checkpoint { sessionId: string; graph: WorkGraph; note: Notice | null; unfinished?: UnfinishedItems; advisor?: AdvisorRecord; cut: Cut; at: number; model: string; change?: GraphChange }

const record = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const integer = (x: unknown) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const hash = (x: unknown) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const usageLike = (x: unknown): x is Usage => record(x) && Object.keys(emptyUsage()).every(k => typeof x[k] === "number" && Number.isFinite(x[k]) && x[k] >= 0);
const cutLike = (x: unknown): x is Cut => {
	if (!record(x) || (x.parent !== null && typeof x.parent !== "string") || !Array.isArray(x.workers)) return false;
	for (const w of x.workers) {
		if (!record(w) || !["key", "file", "sessionId", "actor", "runId", "cwd"].every((k) => typeof w[k] === "string") ||
			w.key !== w.sessionId || !integer(w.offset) || !integer(w.messages) || !integer(w.forkedMessages) ||
			(w.lastId !== null && typeof w.lastId !== "string") || !hash(w.hash) ||
			(w.device !== null && !integer(w.device)) || (w.inode !== null && !integer(w.inode))) return false;
	}
	return true;
};

function checkpointValue(x: unknown, allowCutover: boolean): { checkpoint: Checkpoint; cutover: boolean } | undefined {
	if (!record(x) || "version" in x || "usage" in x || typeof x.sessionId !== "string" || !Number.isFinite(x.at) || typeof x.model !== "string" || !record(x.cut)) return undefined;
	let normalized;
	try { normalized = normalizeMotherRoot(x.graph); } catch { return undefined; }
	if (normalized.changed && !allowCutover) return undefined;
	const value = normalized.changed ? { ...x, graph: normalized.graph } : x;
	try { checkGraph(value.graph); } catch { return undefined; }
	if (value.unfinished !== undefined && !Check(Unfinished, value.unfinished)) return undefined;
	if (value.advisor !== undefined && !isAdvisorRecord(value.advisor)) return undefined;
	if (value.change !== undefined) {
		const c = value.change;
		if (!record(c) || (c.before !== null && !integer(c.before)) || c.after !== value.graph.nodes.length ||
			![c.created, c.retired].every(items => Array.isArray(items) && items.every(n => record(n) && typeof n.id === "string" && typeof n.label === "string" && Array.isArray(n.sources) && n.sources.length && n.sources.every((s: unknown) => typeof s === "string")))) return undefined;
		if (c.before !== null && c.after !== c.before + c.created.length - c.retired.length) return undefined;
	}
	if (!cutLike(value.cut)) return undefined;
	if (!(value.note === null || (record(value.note) && typeof value.note.text === "string" && PROCESS_RISK_CLASSES.includes(value.note.riskClass) &&
		typeof value.note.target === "string" && [value.note.riskRefs, value.note.actionRefs].every(refs => Array.isArray(refs) && refs.length && refs.every((ref: unknown) => typeof ref === "string")) &&
		(value.note.nextRequest === undefined || typeof value.note.nextRequest === "boolean")))) return undefined;
	return { checkpoint: value as Checkpoint, cutover: normalized.changed };
}

export function isCheckpoint(x: unknown): x is Checkpoint { return Boolean(checkpointValue(x, false)); }

export interface CursorFailure { key: string; from: Cut; through: Cut; refs: string[]; error: string; failures: number }
export interface SkippedGap extends CursorFailure { id: string }
export interface MomState { checkpoint?: Checkpoint; checkpointId?: string; coverageCut?: Cut; enabled: boolean; unresolvedNotices: string[]; usage?: Usage; error?: string; failure?: CursorFailure; gaps: SkippedGap[]; cutover?: boolean }

const failureLike = (x: unknown): x is CursorFailure => record(x) && typeof x.key === "string" && cutLike(x.from) && cutLike(x.through) &&
	Array.isArray(x.refs) && x.refs.every((ref: unknown) => typeof ref === "string") && typeof x.error === "string" && integer(x.failures);
const mapKeys = new Set(["snapshot", "base", "cut", "enabled", "failure", "gap", "resolvedNotices"]);

/** Full map snapshots valid for the selected branch; map patches never become history handles. */
export function branchCheckpoints(records: readonly SidecarRecord[], branch: ReadonlySet<string>): { id: string; data: Checkpoint }[] {
	const checkpoints: { id: string; data: Checkpoint }[] = [];
	for (const item of records) {
		if (item.type !== "map" || item.data.snapshot === undefined) continue;
		const parsed = checkpointValue(item.data.snapshot, true);
		if (!parsed) throw new Error("Invalid Mom map snapshot in her sidecar; refusing to silently replace it.");
		if (parsed.checkpoint.cut.parent !== null && !branch.has(parsed.checkpoint.cut.parent)) continue;
		checkpoints.push({ id: item.id, data: parsed.checkpoint });
	}
	return checkpoints;
}

/** Mom state comes only from map/notice/usage records in her sidecar. */
export async function loadState(store: MomStore, manager: SessionReader): Promise<MomState> {
	const state: MomState = { enabled: true, gaps: [], unresolvedNotices: [] };
	const records = await store.load(), branch = new Set(manager.getBranch().map(e => e.id));
	const gaps = new Map<string, SkippedGap>(), unresolvedNotices = new Set<string>();
	let coverageAt = 0;
	for (const item of records) {
		if (item.type === "notice") {
			if (typeof item.data.key !== "string" || item.data.action !== "delivered" || (item.data.parent !== null && typeof item.data.parent !== "string")) throw new Error("Invalid Mom notice state in her sidecar.");
			if (item.data.parent !== null && !branch.has(item.data.parent)) continue;
			unresolvedNotices.add(item.data.key);
			continue;
		}
		if (item.type === "usage") {
			if (!usageLike(item.data.usage) || (item.data.error !== undefined && item.data.error !== null && typeof item.data.error !== "string")) {
				throw new Error("Invalid Mom usage state in her sidecar.");
			}
			state.usage = item.data.usage;
			state.error = typeof item.data.error === "string" ? item.data.error : undefined;
			continue;
		}
		if (Object.keys(item.data).some(key => !mapKeys.has(key)) || !Object.keys(item.data).length) throw new Error("Invalid Mom map state in her sidecar.");
		let branchAnchor = false, applies = false;
		if (item.data.snapshot !== undefined) {
			branchAnchor = true;
			const parsed = checkpointValue(item.data.snapshot, true);
			if (!parsed) throw new Error("Invalid Mom map snapshot in her sidecar; refusing to silently replace it.");
			if (parsed.checkpoint.cut.parent === null || branch.has(parsed.checkpoint.cut.parent)) {
				applies = true;
				state.checkpoint = parsed.checkpoint; state.checkpointId = item.id; state.coverageCut = parsed.checkpoint.cut;
				if (parsed.cutover) state.cutover = true; else delete state.cutover;
				coverageAt = item.at; delete state.failure;
			}
		}
		if (item.data.enabled !== undefined) {
			if (typeof item.data.enabled !== "boolean") throw new Error("Invalid Mom enabled state in her sidecar.");
			state.enabled = item.data.enabled;
		}
		if (item.data.cut !== undefined) {
			branchAnchor = true;
			if ((item.data.base !== null && typeof item.data.base !== "string") || !cutLike(item.data.cut)) throw new Error("Invalid Mom map cursor in her sidecar.");
			const sameMap = item.data.base === state.checkpointId || (!state.checkpointId && item.data.base === null);
			if (sameMap && item.at >= coverageAt && (item.data.cut.parent === null || branch.has(item.data.cut.parent))) {
				applies = true;
				state.coverageCut = item.data.cut; coverageAt = item.at; delete state.failure;
				if (state.checkpoint) state.checkpoint = { ...state.checkpoint, cut: item.data.cut, at: item.at };
			}
		}
		if (item.data.failure !== undefined) {
			if (item.data.failure === null) {
				if (!branchAnchor) throw new Error("Invalid Mom failure clearing state in her sidecar.");
				if (applies) delete state.failure;
			} else {
				if (!failureLike(item.data.failure)) throw new Error("Invalid Mom failure state in her sidecar.");
				if (item.at >= coverageAt && (item.data.failure.through.parent === null || branch.has(item.data.failure.through.parent))) state.failure = item.data.failure;
			}
		}
		if (item.data.gap !== undefined) {
			const gapData = item.data.gap;
			if (!record(gapData) || typeof gapData.id !== "string" || !["open", "resolved"].includes(gapData.action)) throw new Error("Invalid Mom skipped-gap state in her sidecar.");
			if (gapData.action === "resolved") {
				if (!branchAnchor) throw new Error("Invalid Mom skipped-gap resolution in her sidecar.");
				if (applies) gaps.delete(gapData.id);
			} else {
				const id = gapData.id;
				if (!failureLike(gapData)) throw new Error("Invalid Mom skipped-gap state in her sidecar.");
				if (gapData.through.parent === null || branch.has(gapData.through.parent)) gaps.set(id, { ...gapData, id });
			}
		}
		if (item.data.resolvedNotices !== undefined) {
			if (!branchAnchor || !Array.isArray(item.data.resolvedNotices) || !item.data.resolvedNotices.every((key: unknown) => typeof key === "string")) throw new Error("Invalid Mom process-risk resolution in her sidecar.");
			if (applies) for (const key of item.data.resolvedNotices) unresolvedNotices.delete(key);
		}
	}
	state.gaps = [...gaps.values()]; state.unresolvedNotices = [...unresolvedNotices];
	return state;
}

export const noticeKey = (note: Notice) => processNoticeKey(note);
export function sumUsage(a: Usage, b: Usage): Usage {
	const sum = emptyUsage();
	for (const key of Object.keys(sum) as (keyof Usage)[]) sum[key] = a[key] + b[key];
	return sum;
}
