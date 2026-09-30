import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { emptyUsage, loadState, isCheckpoint } from "../src/checkpoint.ts";
import type { FeedEvent } from "../src/feed.ts";
import { acceptGraph } from "../src/contract.ts";
import { emptyGraph } from "../src/graph.ts";
import { SidecarStore, type MomStore, type SidecarRecord, type SidecarWriteType } from "../src/sidecar.ts";

const checkpoint = (sessionId: string) => ({ sessionId, graph: emptyGraph(), note: null,
	cut: { parent: null, workers: [] }, at: Date.now(), model: "fixture/fixture" });
const memoryStore = (sessionId: string, records: SidecarRecord[] = []): MomStore => ({
	load: async () => records.filter(r => r.sessionId === sessionId),
	append: async (type: SidecarWriteType, data) => {
		const persisted = type === "control" ? { type: "map" as const, data: { enabled: data.enabled } } : { type, data };
		const record: SidecarRecord = { id: `r${records.length + 1}`, sessionId, ...persisted, at: Date.now() };
		records.push(record); return record;
	},
});
const mapSnapshot = (id: string, sessionId: string, data: unknown, at = Date.now()): SidecarRecord =>
	({ id, sessionId, type: "map", at, data: { snapshot: data } });

test("a session without a persisted transcript has no accidental sidecar path", async () => {
	assert.deepEqual(await new SidecarStore(() => undefined, "memory-only").load(), []);
});

test("map, notice, and usage records restore state; abandoned branches stay invisible", async () => {
	const manager = SessionManager.inMemory("/tmp");
	const sessionId = manager.getSessionId(), current = checkpoint(sessionId);
	const store = memoryStore(sessionId, [
		mapSnapshot("abandoned", sessionId, { ...checkpoint(sessionId), at: 1, cut: { parent: "not-on-branch", workers: [] } }, 1),
		mapSnapshot("keep", sessionId, current),
	]);
	await store.append("control", { enabled: false });
	await store.append("notice", { key: "purpose_drift:main", action: "delivered", parent: null });
	await store.append("usage", { usage: { ...emptyUsage(), calls: 9 }, error: "last failure" });
	assert.deepEqual(await loadState(store, manager), { checkpoint: current, checkpointId: "keep", coverageCut: current.cut, enabled: false, gaps: [],
		unresolvedNotices: ["purpose_drift:main"], usage: { ...emptyUsage(), calls: 9 }, error: "last failure" });
	const gone = memoryStore(sessionId, [mapSnapshot("gone", sessionId, { ...current, cut: { parent: "missing", workers: [] } })]);
	assert.equal((await loadState(gone, manager)).checkpoint, undefined);
});

test("map cursor patches apply only to their base snapshot and selected branch", async () => {
	const manager = SessionManager.inMemory("/tmp"), sessionId = manager.getSessionId();
	const root = manager.appendMessage({ role: "user", content: "root", timestamp: Date.now() });
	const leaf = manager.appendMessage({ role: "user", content: "leaf", timestamp: Date.now() });
	const current = { ...checkpoint(sessionId), cut: { parent: root, workers: [] } };
	const records = [mapSnapshot("keep", sessionId, current)], store = memoryStore(sessionId, records);
	await store.append("map", { base: "other", cut: { parent: leaf, workers: [] } });
	await store.append("map", { base: "keep", cut: { parent: "abandoned", workers: [] } });
	assert.equal((await loadState(store, manager)).checkpoint?.cut.parent, root);
	await store.append("map", { base: "keep", cut: { parent: leaf, workers: [] } });
	assert.equal((await loadState(store, manager)).checkpoint?.cut.parent, leaf);
	const invalid = memoryStore(sessionId); await invalid.append("map", { base: "keep", cut: { parent: leaf } });
	await assert.rejects(() => loadState(invalid, manager), /Invalid Mom map cursor/);
});

test("failure and skipped-gap state share the map stream and restore without transcript state", async () => {
	const manager = SessionManager.inMemory("/tmp"), sessionId = manager.getSessionId();
	const root = manager.appendMessage({ role: "user", content: "root", timestamp: Date.now() });
	const leaf = manager.appendMessage({ role: "user", content: "leaf", timestamp: Date.now() });
	const current = { ...checkpoint(sessionId), cut: { parent: root, workers: [] } };
	const store = memoryStore(sessionId, [mapSnapshot("keep", sessionId, current, 1)]);
	const from = current.cut, through = { parent: leaf, workers: [] };
	await store.append("map", { failure: { key: "range", from, through, refs: [], error: "rejected", failures: 1 } });
	assert.equal((await loadState(store, manager)).failure?.failures, 1);
	await store.append("map", { base: "keep", cut: through, failure: null,
		gap: { action: "open", id: "gap-one", key: "range", from, through, refs: [], error: "rejected", failures: 2 } });
	const skipped = await loadState(store, manager);
	assert.equal(skipped.failure, undefined); assert.equal(skipped.coverageCut?.parent, leaf); assert.equal(skipped.gaps[0]?.id, "gap-one");
	await store.append("map", { base: "keep", cut: through,
		gap: { action: "open", ...skipped.gaps[0], refs: ["remaining-ref"] } });
	assert.deepEqual((await loadState(store, manager)).gaps[0]?.refs, ["remaining-ref"], "an atomic open record narrows durable remaining-gap coverage");
	await store.append("map", { base: "keep", cut: through, gap: { action: "resolved", id: "gap-one" } });
	assert.deepEqual((await loadState(store, manager)).gaps, []);
});

test("a sibling-branch cursor cannot clear the selected branch's retry failure", async () => {
	const manager = SessionManager.inMemory("/tmp"), sessionId = manager.getSessionId();
	const root = manager.appendMessage({ role: "user", content: "root", timestamp: Date.now() });
	const sibling = manager.appendMessage({ role: "user", content: "sibling", timestamp: Date.now() });
	manager.branch(root);
	const selected = manager.appendMessage({ role: "user", content: "selected", timestamp: Date.now() });
	const rootCut = { parent: root, workers: [] }, selectedCut = { parent: selected, workers: [] };
	const store = memoryStore(sessionId, [mapSnapshot("keep", sessionId, { ...checkpoint(sessionId), cut: rootCut }, 1)]);
	await store.append("map", { base: "keep", cut: selectedCut });
	await store.append("map", { failure: { key: "selected-range", from: rootCut, through: selectedCut, refs: [], error: "retry", failures: 1 } });
	await store.append("map", { base: "keep", cut: { parent: sibling, workers: [] }, failure: null });
	await store.append("map", { base: "other-map", cut: selectedCut, failure: null });
	const restored = await loadState(store, manager);
	assert.equal(restored.coverageCut?.parent, selected, "the selected branch cursor remains consumed");
	assert.equal(restored.failure?.key, "selected-range", "the sibling clear does not erase selected-branch retry state");
});

test("notice delivery and resolution state apply only on their recorded branch", async () => {
	const manager = SessionManager.inMemory("/tmp"), sessionId = manager.getSessionId();
	const root = manager.appendMessage({ role: "user", content: "root", timestamp: Date.now() });
	const sibling = manager.appendMessage({ role: "user", content: "sibling", timestamp: Date.now() });
	manager.branch(root);
	const selected = manager.appendMessage({ role: "user", content: "selected", timestamp: Date.now() });
	const store = memoryStore(sessionId);
	await store.append("notice", { key: "purpose_drift:main", action: "delivered", parent: selected });
	await store.append("notice", { key: "uncommitted_work:main", action: "delivered", parent: sibling });
	assert.deepEqual((await loadState(store, manager)).unresolvedNotices, ["purpose_drift:main"]);
	await store.append("map", { base: null, cut: { parent: sibling, workers: [] }, resolvedNotices: ["purpose_drift:main"] });
	assert.deepEqual((await loadState(store, manager)).unresolvedNotices, ["purpose_drift:main"], "a sibling cannot resolve the selected branch risk");
	await store.append("map", { base: null, cut: { parent: selected, workers: [] }, resolvedNotices: ["purpose_drift:main"] });
	assert.deepEqual((await loadState(store, manager)).unresolvedNotices, [], "an accepted selected-branch map resolves the risk");
});

test("a sibling-branch cursor cannot resolve the selected branch's skipped gap", async () => {
	const manager = SessionManager.inMemory("/tmp"), sessionId = manager.getSessionId();
	const root = manager.appendMessage({ role: "user", content: "root", timestamp: Date.now() });
	const sibling = manager.appendMessage({ role: "user", content: "sibling", timestamp: Date.now() });
	manager.branch(root);
	const selected = manager.appendMessage({ role: "user", content: "selected", timestamp: Date.now() });
	const rootCut = { parent: root, workers: [] }, selectedCut = { parent: selected, workers: [] };
	const store = memoryStore(sessionId, [mapSnapshot("keep", sessionId, { ...checkpoint(sessionId), cut: rootCut }, 1)]);
	await store.append("map", { base: "keep", cut: selectedCut,
		gap: { action: "open", id: "selected-gap", key: "selected-range", from: rootCut, through: selectedCut, refs: [], error: "rejected", failures: 2 } });
	await store.append("map", { base: "keep", cut: { parent: sibling, workers: [] }, gap: { action: "resolved", id: "selected-gap" } });
	await store.append("map", { base: "other-map", cut: selectedCut, gap: { action: "resolved", id: "selected-gap" } });
	const restored = await loadState(store, manager);
	assert.equal(restored.coverageCut?.parent, selected, "the selected branch cursor remains consumed");
	assert.equal(restored.gaps[0]?.id, "selected-gap", "the sibling resolution does not erase the selected-branch gap");
});

test("the session transcript is never a Mom state source; only sidecar map records load", async () => {
	const manager = SessionManager.inMemory("/tmp"), store = memoryStore(manager.getSessionId());
	const current = checkpoint(manager.getSessionId());
	manager.appendCustomEntry("pi-tether.mom.v4", current);
	manager.appendCustomEntry("pi-tether.mom-control", { sessionId: manager.getSessionId(), enabled: false });
	assert.deepEqual(await loadState(store, manager), { enabled: true, gaps: [], unresolvedNotices: [] });
	await store.append("map", { snapshot: current });
	assert.equal((await loadState(store, manager)).checkpoint, current); assert(isCheckpoint(current));
	assert.equal(isCheckpoint({ ...current, version: 4, usage: emptyUsage() }), false, "legacy versioned snapshot layouts are not accepted");
	const bad = memoryStore(manager.getSessionId(), [mapSnapshot("bad", manager.getSessionId(), { ...current, graph: null })]);
	await assert.rejects(() => loadState(bad, manager), /Invalid Mom map snapshot/);
});

test("source validator rejects invented citations and malformed process notices", () => {
	const events: FeedEvent[] = [
		{ ref: "s:u", at: "", actor: "lead", kind: "user", text: "Do not delete." },
		{ ref: "s:a", at: "", actor: "lead", kind: "assistant", text: "I will delete it." },
		{ ref: "s:r", at: "", actor: "lead", kind: "tool_result", name: "bash" },
	];
	const known = new Map(events.map((e) => [e.ref, e])), fresh = new Set(events.map((e) => e.ref)), inspected = new Set<string>();
	const node = { id: "main", kind: "try", parent: null, state: "active", label: "Purpose", intent: "Do not delete.", observed: "", actor: "lead", sources: ["s:u"], purposeSource: "s:u" };
	const base = { revision: 0, purpose: "main", focus: "main", upsertNodes: [node], unfinished: [], upsertEdges: [], removeEdges: [], merges: [], folds: [], removeNodes: [], supersessions: [], note: null };
	const accept = (value: unknown, refs = fresh, question?: string) => acceptGraph(value, emptyGraph(), undefined, known, refs, inspected, question);
	assert.equal(accept(base).note, null);
	assert.throws(() => accept({ ...base, upsertNodes: [{ ...node, sources: ["s:nope"] }] }), /Unknown/);
	assert.throws(() => accept({ ...base, upsertNodes: [{ ...node, sources: ["s:u", "s:u"] }] }), /Duplicate/);
	assert.throws(() => accept({ ...base, note: { text: "Check it", riskClass: "purpose_drift", target: "main", riskRefs: ["s:u"], actionRefs: ["s:r"] } }), /shape|visible/);
	assert.throws(() => accept(base, fresh, "Why?"), /explicit question/);
});
