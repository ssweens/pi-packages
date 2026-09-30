import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptGraph } from "../src/contract.ts";
import type { FeedEvent } from "../src/feed.ts";
import type { WorkGraph } from "../src/graph.ts";

const purpose: FeedEvent = { ref: "s:goal", at: "", actor: "lead", kind: "user", text: "Build the release safely. Return to the release goal and compare current work with this request." };
const graph: WorkGraph = { revision: 1, motherThread: "main", purpose: "main", focus: "main", edges: [], nodes: [{ id: "main", kind: "try", parent: null, state: "active", label: "Safe release", intent: "Build the release safely.", observed: "Work is active.", actor: "lead", sources: [purpose.ref], purposeSource: purpose.ref }] };
const base = { revision: 1, purpose: "main", focus: "main", unfinished: [], upsertNodes: [], upsertEdges: [], removeEdges: [], merges: [], folds: [], removeNodes: [], supersessions: [], resolutions: [] };
const event = (ref: string, kind: FeedEvent["kind"], text?: string, actor = "lead"): FeedEvent => ({ ref, at: "", actor, kind, ...(text ? { text } : {}) });
function accept(note: Record<string, unknown> | null, events: FeedEvent[], fresh: string[], compaction = false, unresolved = new Set<string>()) {
	const known = new Map([purpose, ...events].map(item => [item.ref, item]));
	return acceptGraph({ ...base, note }, graph, "saved", known, new Set(fresh), new Set(), undefined, compaction, unresolved);
}

const cases = [
	{
		name: "compaction with unrecorded decisions", klass: "compaction_decisions", text: "Record the release decision now before its instruction is lost.",
		events: [event("s:decision", "user", "The release decision must be recorded. Write it into the plan now."), event("s:compact", "compaction")], fresh: ["s:compact"], risk: ["s:decision", "s:compact"], action: ["s:decision"], compaction: true,
	},
	{
		name: "material uncommitted work with permission", klass: "uncommitted_work", text: "Commit the release changes before more work makes them harder to recover.",
		events: [event("s:permission", "user", "Commits are allowed. Commit the completed release changes now."), event("s:pile", "assistant", "Several completed release files remain uncommitted while more changes are being added.")], fresh: ["s:pile"], risk: ["s:permission", "s:pile"], action: ["s:permission"],
	},
	{
		name: "consequential purpose drift", klass: "purpose_drift", text: "Return to the release goal and compare the current work with the request.",
		events: [event("s:drift", "assistant", "I am replacing the release work with unrelated dashboard styling.")], fresh: ["s:drift"], risk: ["s:goal", "s:drift"], action: ["s:goal"],
	},
	{
		name: "the same fix repeatedly failing", klass: "repeated_fix_failure", text: "Inspect why the release test keeps failing before trying another fix.",
		events: [event("s:fail1", "assistant", "The release fix failed; inspect the parser before trying again."), event("s:fail2", "assistant", "The same release fix failed again with the same error.")], fresh: ["s:fail2"], risk: ["s:fail1", "s:fail2"], action: ["s:fail1"],
	},
] as const;

for (const item of cases) {
	test(`${item.name}: supported advisory is accepted`, () => {
		const note = { text: item.text, riskClass: item.klass, target: "main", riskRefs: [...item.risk], actionRefs: [...item.action] };
		assert.deepEqual(accept(note, [...item.events], [...item.fresh], "compaction" in item ? item.compaction : false).note, note);
	});
	test(`${item.name}: evidence missing the class prerequisite is rejected`, () => {
		const note = { text: item.text, riskClass: item.klass, target: "main", riskRefs: [...item.risk] as string[], actionRefs: [...item.action] as string[] };
		let expected: RegExp;
		if (item.klass === "uncommitted_work") { note.actionRefs = ["s:pile"]; expected = /user authority/; }
		else if (item.klass === "purpose_drift") { note.riskRefs = ["s:other", "s:drift"]; expected = /current grounded purpose/; }
		else if (item.klass === "repeated_fix_failure") { note.riskRefs = ["s:goal", "s:fail2"]; expected = /two distinct observed attempts/; }
		else expected = /current compaction/;
		assert.throws(() => accept(note, [...item.events, event("s:other", "assistant", "Other current work.")], [...item.fresh]), expected);
	});
}

test("notice protocol rejects jargon, unknown references and stale risk evidence", () => {
	const events = [event("s:permission", "user", "Commits are allowed. Commit the completed changes now."), event("s:pile", "assistant", "Many completed files remain uncommitted.")];
	const make = (text: string, actionRefs = ["s:permission"]) => ({ text, riskClass: "uncommitted_work", target: "main", riskRefs: ["s:permission", "s:pile"], actionRefs });
	assert.throws(() => accept(make("Commit the release changes before more work makes them harder to recover."), events, []), /new evidence/);
	assert.throws(() => accept(make("Commit the sidecar checkpoint before more work changes the files."), events, ["s:pile"]), /plain English/);
	assert.throws(() => accept(make("Commit the release changes before more work makes them harder to recover.", ["s:nope"]), events, ["s:pile"]), /visible current evidence/);
});

test("strict provider null resolutions mean no resolutions", () => {
	assert.deepEqual(acceptGraph({ ...base, resolutions: null, note: null }, graph, "saved", new Map([[purpose.ref, purpose]]), new Set(), new Set()).resolutions, []);
});

test("resolution is explicit and a later recurrence requires genuinely new evidence", () => {
	const unresolved = new Set(["uncommitted_work:main"]);
	const resolved = event("s:done", "assistant", "The release changes are committed; the commit was created successfully.");
	const known = new Map([purpose, resolved].map(item => [item.ref, item]));
	const transaction = { ...base, note: null, resolutions: [{ riskClass: "uncommitted_work", target: "main", resolutionRefs: [resolved.ref] }] };
	assert.equal(acceptGraph(transaction, graph, "saved", known, new Set([resolved.ref]), new Set(), undefined, false, unresolved).resolutions.length, 1);
	assert.throws(() => acceptGraph(transaction, graph, "saved", known, new Set(), new Set(), undefined, false, unresolved), /new current evidence/);
	const recur = [event("s:allowed2", "user", "Commits remain allowed. Commit this new completed release work now."), event("s:pile2", "assistant", "A later set of completed release files is again uncommitted.")];
	const note = { text: "Commit the new release changes before more work makes them harder to recover.", riskClass: "uncommitted_work", target: "main", riskRefs: recur.map(x => x.ref), actionRefs: [recur[0].ref] };
	assert.deepEqual(accept(note, recur, ["s:pile2"]).note, note);
});
