import assert from "node:assert/strict";
import { test } from "node:test";
import { NOTICE, loadState } from "../src/checkpoint.ts";
import { SidecarStore } from "../src/sidecar.ts";
import { setup, until, input, replacement, isMomRequest, deferred, readSidecar } from "./fixture.ts";

const snapshots = async (h: Awaited<ReturnType<typeof setup>>) => (await readSidecar(h)).filter(r => r.type === "map" && r.data.snapshot);
const momState = (entry: any) => typeof entry.customType === "string" && entry.customType.startsWith("pi-tether.mom.");

test("retry preserves its original coverage revision and processes a newer correction before notices", { timeout: 15000 }, async () => {
	const h = await setup(true), gate = deferred(); let calls = 0;
	try {
		h.api.onUnscripted((request) => {
			if (!isMomRequest(request)) return { text: "Several completed files remain uncommitted while I add more changes." };
			calls++;
			if (calls === 1) return { error: 400 };
			if (calls === 2) {
				const body = input(request), trigger = /\[src:([^\]]+)\] [^\n]+ lead assistant/.exec(body.newEvents)![1];
				assert(!body.newEvents.includes("The changes are now committed"));
				return replacement(request, { note: { text: "Commit the completed changes before more work makes them harder to recover.", riskClass: "uncommitted_work", target: "main", riskRefs: [body.original.ref, trigger], actionRefs: [body.original.ref] } });
			}
			assert.match(input(request).newEvents, /The changes are now committed/);
			return { ...replacement(request), gate };
		});
		// The failed batch must contain both the user hold and the assistant claim.
		await h.command("pause");
		await h.runtime.session.prompt("Commits are allowed. Commit completed changes before adding more work.");
		await h.command("resume");
		await until(() => calls === 1);
		await until(async () => (await readSidecar(h)).some(r => r.type === "usage" && r.data.error));
		await h.command("correct The changes are now committed for this fixture.");
		await until(() => calls === 3, "correction captured after staged retry");
		assert.equal((await snapshots(h)).length, 1);
		assert(!h.runtime.session.sessionManager.getBranch().some((e: any) => e.customType === NOTICE));
		const status = await h.tools.get("mom").execute("status", {}, undefined);
		assert.match(status.content[0].text, /updating|observation pending/);
		gate.resolve(); await until(async () => (await snapshots(h)).length === 2);
		assert(!h.runtime.session.sessionManager.getBranch().some((e: any) => e.customType === NOTICE));
		// Pause/resume, failed usage and maps all went to the sidecar, not the transcript.
		assert(!h.runtime.session.sessionManager.getEntries().some(momState), "Mom writes no state into the session file");
	} finally { gate.resolve(); await h.close(); }
});

test("sidecar append failure publishes nothing; a reopened Mom resumes from durable state", { timeout: 15000 }, async () => {
	const h = await setup(); let fail = false;
	const manager = h.runtime.session.sessionManager;
	const durable = () => new SidecarStore(() => h.parent, manager.getSessionId());
	let mom = h.createMom({ store: {
		load: async () => durable().load(),
		append: async (type, data) => { if (fail) throw new Error("Injected sidecar failure"); return durable().append(type, data); },
	} });
	try {
		await h.runtime.session.prompt("Preserve the goal."); await mom.open(); await mom.update();
		const before = mom.checkpoint;
		await h.runtime.session.prompt("Keep this newer input pending after a storage failure.");
		const entries = manager.getEntries().length;
		fail = true;
		await assert.rejects(() => mom.update(), /Injected sidecar failure/);
		assert.equal(mom.checkpoint, before);
		assert.equal(manager.getEntries().length, entries, "a failed update never touches the session transcript");
		mom.close(); fail = false;
		mom = h.createMom(); await mom.open();
		assert.deepEqual(mom.checkpoint, before);
		const calls = h.requests().length;
		await mom.update();
		assert.equal(h.requests().length, calls + 1);
		assert.match(input(h.requests().at(-1)).newEvents, /Keep this newer input pending/);
		const cold = h.sdk.SessionManager.open(h.parent);
		assert.equal((await loadState(durable(), cold)).checkpoint?.cut.parent, mom.checkpoint?.cut.parent);
		assert(!cold.getEntries().some(momState), "the session file holds no Mom state");
	} finally { mom.close(); await h.close(); }
});
