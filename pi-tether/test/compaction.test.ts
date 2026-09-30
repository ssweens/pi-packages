import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { NOTICE } from "../src/checkpoint.ts";
import { prepareCompaction } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js";
import { finishCompactionReview, prepareCompactionReview } from "../src/compaction.ts";
import { input, isMomRequest, replacement, setup, until } from "./fixture.ts";

function beforeEvent(branchEntries: any[], firstKeptEntryId: string) {
	return { type: "session_before_compact", branchEntries, reason: "manual", willRetry: false, signal: new AbortController().signal,
		preparation: { firstKeptEntryId, messagesToSummarize: [], turnPrefixMessages: [], isSplitTurn: false, tokensBefore: 100,
			fileOps: { read: [], modified: [] }, settings: { enabled: true, reserveTokens: 1000, keepRecentTokens: 1000 } } } as any;
}

async function compact(h: Awaited<ReturnType<typeof setup>>, summary: string) {
	const manager = h.runtime.session.sessionManager;
	const branch = manager.getBranch();
	const firstKept = branch.findLast((entry: any) => entry.type === "message" && entry.message.role === "assistant")!;
	await h.emitExtension("session_before_compact", beforeEvent(branch, firstKept.id));
	const id = manager.appendCompaction(summary, firstKept.id, 100);
	const compactionEntry = manager.getEntry(id);
	await h.emitExtension("session_compact", { type: "session_compact", compactionEntry, fromExtension: false, reason: "manual", willRetry: false });
}

test("compaction review captures the raw replaced entries, including for an empty provider summary", () => {
	const entries = [
		{ id: "u", parentId: null, type: "message", timestamp: new Date().toISOString(), message: { role: "user", content: "Keep KEEP.txt unchanged." } },
		{ id: "a", parentId: "u", type: "message", timestamp: new Date().toISOString(), message: { role: "assistant", content: "Understood." } },
	];
	const pending = prepareCompactionReview(beforeEvent(entries, "a"), "session");
	const review = finishCompactionReview(pending, { compactionEntry: { firstKeptEntryId: "a", summary: "" } } as any);
	assert.match(review.rawReplacedEvents, /Keep KEEP\.txt unchanged/);
	assert.equal(review.summary, "");
	assert.equal(review.rawEntryCount, 1);
});

test("repeated compaction starts at the previous first-kept entry and retains its active hold", () => {
	const at = new Date().toISOString();
	const entries = [
		{ id: "old", parentId: null, type: "message", timestamp: at, message: { role: "user", content: "Already replaced." } },
		{ id: "hold", parentId: "old", type: "message", timestamp: at, message: { role: "user", content: "Do not modify KEEP.txt." } },
		{ id: "work", parentId: "hold", type: "message", timestamp: at, message: { role: "assistant", content: "Starting the authorized migration." } },
		{ id: "prior-compact", parentId: "work", type: "compaction", timestamp: at, summary: "Migration only.", firstKeptEntryId: "hold", tokensBefore: 100 },
		{ id: "newer", parentId: "prior-compact", type: "message", timestamp: at, message: { role: "assistant", content: "Migration continued." } },
		{ id: "next-kept", parentId: "newer", type: "message", timestamp: at, message: { role: "assistant", content: "Recent work remains." } },
	];
	const pending = prepareCompactionReview(beforeEvent(entries, "next-kept"), "session");
	assert.deepEqual(pending.rawEntries.map(entry => entry.id), ["hold", "work", "prior-compact", "newer"]);
	const review = finishCompactionReview(pending, { compactionEntry: { id: "next-compact", timestamp: at, firstKeptEntryId: "next-kept", summary: "Migration continued." } } as any,
		new Set(["session:hold"]));
	assert.match(review.rawReplacedEvents, /Do not modify KEEP\.txt/);
	assert.doesNotMatch(review.rawReplacedEvents, /Already replaced/);
});

test("SDK preparation can put the new boundary before the latest prior compaction record", () => {
	const at = new Date().toISOString();
	const user = (id: string, parentId: string | null, content: string) =>
		({ id, parentId, type: "message", timestamp: at, message: { role: "user", content, timestamp: Date.now() } });
	const entries = [
		user("old", null, "Already replaced before the prior boundary."),
		user("hold", "old", "Do not modify KEEP.txt."),
		user("middle", "hold", "m".repeat(8000)),
		{ id: "prior-compact", parentId: "middle", type: "compaction", timestamp: at, summary: "Migration only.", firstKeptEntryId: "hold", tokensBefore: 100 },
		user("newer", "prior-compact", "n".repeat(8000)),
		user("tail", "newer", "t".repeat(8000)),
	] as any[];
	const preparation = prepareCompaction(entries as any, { enabled: true, reserveTokens: 1000, keepRecentTokens: 5000 });
	assert(preparation);
	assert.equal(preparation.firstKeptEntryId, "middle");
	assert(entries.findIndex(entry => entry.id === preparation.firstKeptEntryId) < entries.findIndex(entry => entry.type === "compaction"),
		"Pi validly selected a new boundary before the latest prior compaction record");
	const pending = prepareCompactionReview({ ...beforeEvent(entries, preparation.firstKeptEntryId), preparation }, "session");
	assert.deepEqual(pending.rawEntries.map(entry => entry.id), ["hold"]);
	assert.match(finishCompactionReview(pending, { compactionEntry: { id: "next", timestamp: at, firstKeptEntryId: "middle", summary: "" } } as any,
		new Set(["session:hold"])).rawReplacedEvents, /Do not modify KEEP\.txt/);
});

test("a compaction that drops an active decision causes one deferred process advisory and no lead call", { timeout: 15000 }, async () => {
	const h = await setup(true);
	try {
		await h.runtime.session.prompt("Record the decision to keep KEEP.txt unchanged before continuing the migration.");
		await until(() => h.requests().length === 1);
		const leadCalls = h.api.requests.filter((request: any) => !isMomRequest(request)).length;
		h.api.onUnscripted((request) => {
			if (!isMomRequest(request)) return { text: "Lead continued." };
			const body = input(request);
			const trigger = body.compactionReview.triggerRef;
			return replacement(request, { note: { text: "Record the KEEP decision now before its instruction is lost.", riskClass: "compaction_decisions", target: "main", riskRefs: [body.original.ref, trigger], actionRefs: [body.original.ref] } });
		});
		await compact(h, "Migration work continues.");
		assert.equal(h.requests().length, 2, "one Mom update for the compaction");
		assert.equal(h.runtime.session.sessionManager.getBranch().filter((entry: any) => entry.customType === NOTICE).length, 0, "notice waits for the next request");
		await h.emitExtension("input", { type: "input", text: "Continue", source: "interactive" });
		await until(() => h.runtime.session.sessionManager.getBranch().some((entry: any) => entry.customType === NOTICE));
		assert.equal(h.api.requests.filter((request: any) => !isMomRequest(request)).length, leadCalls, "notice starts no lead turn");
		const review = input(h.requests()[1]).compactionReview;
		assert.match(review.rawReplacedEvents, /keep KEEP\.txt unchanged/);
		assert.equal(review.summary, "Migration work continues.");
		const notices = h.runtime.session.sessionManager.getBranch().filter((entry: any) => entry.customType === NOTICE);
		assert.equal(notices.length, 1);
		await h.runtime.session.reload();
		assert.equal(h.runtime.session.sessionManager.getBranch().filter((entry: any) => entry.customType === NOTICE).length, 1, "delivery is deduplicated");
		const transcript = await readFile(h.parent, "utf8");
		assert(!transcript.includes('"type":"map"'));
		assert(!transcript.includes("pi-tether.mom-checkpoint"));
	} finally { await h.close(); }
});

test("a compaction retaining active material produces no notice", { timeout: 15000 }, async () => {
	const h = await setup(true);
	try {
		await h.runtime.session.prompt("Keep KEEP.txt unchanged while doing the migration.");
		await until(() => h.requests().length === 1);
		await compact(h, "The migration continues. KEEP.txt must remain unchanged.");
		assert.equal(h.requests().length, 2);
		assert.equal(input(h.requests()[1]).compactionReview.summary, "The migration continues. KEEP.txt must remain unchanged.");
		assert.equal(h.runtime.session.sessionManager.getBranch().filter((entry: any) => entry.customType === NOTICE).length, 0);
	} finally { await h.close(); }
});
