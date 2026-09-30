import assert from "node:assert/strict";
import { test } from "node:test";
import { loadState } from "../src/checkpoint.ts";
import { SidecarStore } from "../src/sidecar.ts";
import { input, isMomRequest, replacement, setup } from "./fixture.ts";

for (const delivered of [false, true]) test(`risk resolution is atomic with evidence coverage (${delivered ? "delivered" : "pending"} advice)`, async () => {
	const h = await setup(), manager = h.runtime.session.sessionManager;
	const durable = () => new SidecarStore(() => h.parent, manager.getSessionId());
	const key = "uncommitted_work:main";
	let failResolution = false;
	let mom = h.createMom({ store: {
		load: () => durable().load(),
		append: (type, data) => {
			if (type === "map" && data.resolvedNotices && failResolution) throw new Error("Injected resolution write failure");
			assert.notEqual(type, "notice", "resolution must not depend on a second notice write");
			return durable().append(type, data);
		},
	} });
	try {
		h.api.onUnscripted(request => {
			if (!isMomRequest(request)) return { text: "Several completed release files remain uncommitted while more work is added." };
			const body = input(request);
			if (body.newEvents.includes("The release changes are now committed")) {
				assert(body.unresolvedProcessRisks.includes(key));
				const ref = /\[src:([^\]]+)\] [^\n]+ lead user/.exec(body.newEvents)![1];
				return replacement(request, { note: null, resolutions: [{ riskClass: "uncommitted_work", target: "main", resolutionRefs: [ref] }] });
			}
			const ref = /\[src:([^\]]+)\] [^\n]+ lead assistant/.exec(body.newEvents)![1];
			return replacement(request, { note: { text: "Commit the release changes before more work makes them harder to recover.", riskClass: "uncommitted_work", target: "main", riskRefs: [body.original.ref, ref], actionRefs: [body.original.ref] } });
		});
		await h.runtime.session.prompt("Commits are allowed. Commit completed release changes before adding more work.");
		await mom.open(); await mom.update();
		if (delivered) {
			await durable().append("notice", { key, action: "delivered", parent: mom.checkpoint!.cut.parent });
			mom.unresolvedNotices.add(key);
		}
		const before = mom.checkpoint;
		manager.appendMessage({ role: "user", content: "The release changes are now committed and the working tree is clean.", timestamp: Date.now() });
		failResolution = true;
		await assert.rejects(() => mom.update(), /Injected resolution write failure/);
		assert.equal(mom.checkpoint, before);
		const state = await loadState(durable(), manager);
		assert.deepEqual(state.checkpoint, before);
		assert.deepEqual(state.unresolvedNotices, delivered ? [key] : []);
		mom.close(); mom = h.createMom(); await mom.open();
		await mom.update(undefined, undefined, 0, true);
		assert.equal(mom.checkpoint!.note, null, "resolved advice must not survive as a pending notice");
		assert.deepEqual((await loadState(durable(), manager)).unresolvedNotices, []);
		assert((await durable().load()).some(record => record.type === "map" && record.data.resolvedNotices?.includes(key)));
	} finally { mom.close(); await h.close(); }
});
