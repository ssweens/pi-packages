import assert from "node:assert/strict";
import { test } from "node:test";
import { NOTICE } from "../src/checkpoint.ts";
import { setup, until, replacement, input, isMomRequest, deferred, readSidecar } from "./fixture.ts";

const snapshots = async (h: Awaited<ReturnType<typeof setup>>) => (await readSidecar(h)).filter(r => r.type === "map" && r.data.snapshot)
	.map(record => ({ ...record, data: record.data.snapshot }));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("normal parent narrative updates Mom without bookkeeping; cached status and idle time are free", { timeout: 15000 }, async () => {
	const h = await setup(true);
	try {
		assert(h.tools.has("mom")); assert(!h.tools.has("tether"));
		await h.runtime.session.prompt("Keep the original goal while I investigate a tangent.");
		const manager = h.runtime.session.sessionManager;
		const lastLead = manager.getBranch().findLast((e: any) => e.type === "message" && e.message.role === "assistant")!;
		await until(async () => {
			const branch = manager.getBranch(), cp = (await snapshots(h)).at(-1) as any;
			return cp && branch.findIndex((e) => e.id === cp.data.cut.parent) >= branch.findIndex((e) => e.id === lastLead.id);
		}, "automatic observation through the lead's final message");
		const calls = h.api.requests.length, momCalls = h.requests().length;
		for (let i = 0; i < 3; i++) {
			const status = await h.tools.get("mom").execute("status", {}, undefined);
			assert.match(status.content[0].text, /Keep the original goal/);
			await h.command("status");
		}
		await pause(400);
		assert.equal(h.api.requests.length, calls, "cached reads and idle time do not call a model");
		assert.equal(h.requests().length, momCalls);
		await h.runtime.session.reload(); await pause(300);
		assert.equal(h.requests().length, momCalls, "reload reconstructs source indexes without inference");
		assert.deepEqual(h.errors, []); assert.deepEqual(h.api.errors, []);
	} finally { await h.close(); }
});

test("/mom map is a cached alias for the graph command", { timeout: 15000 }, async () => {
	const h = await setup(true);
	try {
		await h.runtime.session.prompt("Keep the live terminal map current.");
		await until(async () => (await snapshots(h)).length === 1);
		const notices: Array<{ text: string; level: string }> = [];
		const ui = new Proxy(h.context.ui, { get(target, key, receiver) {
			if (key === "notify") return (text: string, level: string) => notices.push({ text, level });
			return Reflect.get(target, key, receiver);
		} });
		const context = new Proxy(h.context, { get(target, key, receiver) {
			if (key === "ui") return ui;
			return Reflect.get(target, key, receiver);
		} });
		const calls = h.requests().length;
		await h.command("map", context);
		assert.equal(h.requests().length, calls, "cached map reads make no model call");
		assert.equal(notices.length, 1);
		assert.equal(notices[0].level, "info");
		assert.match(notices[0].text, /Main purpose/);
		assert.deepEqual(h.errors, []); assert.deepEqual(h.api.errors, []);
	} finally { await h.close(); }
});

test("startup and reload render saved state without inferring over pending transcript evidence", { timeout: 15000 }, async () => {
	const h = await setup(true);
	try {
		await h.runtime.session.prompt("Preserve the saved map before reload.");
		await until(async () => (await snapshots(h)).length === 1);
		const calls = h.requests().length;
		h.runtime.session.sessionManager.appendMessage({ role: "user", content: "Pending evidence must wait for an allowed boundary.", timestamp: Date.now() });
		await h.runtime.session.reload(); await pause(300);
		assert.equal(h.requests().length, calls, "session reset must not schedule inference");
		const saved = await h.tools.get("mom").execute("saved", {}, undefined);
		assert.match(saved.content[0].text, /Preserve the saved map before reload/, "the loaded checkpoint renders immediately");
		await h.command("refresh");
		await until(() => h.requests().length === calls + 1, "explicit refresh");
		assert.match(input(h.requests().at(-1)).newEvents, /Pending evidence must wait for an allowed boundary/);
		assert.deepEqual(h.errors, []); assert.deepEqual(h.api.errors, []);
	} finally { await h.close(); }
});

test("automatic reads mark the saved map partial while Mom catches up and restore current orientation after acceptance", { timeout: 15000 }, async () => {
	const h = await setup(true), gate = deferred(), arrived = deferred();
	try {
		await h.runtime.session.prompt("Preserve the initial map.");
		await until(async () => (await snapshots(h)).length === 1);
		h.api.onUnscripted((request) => {
			if (!isMomRequest(request)) return { text: "Lead continued with newer evidence." };
			arrived.resolve(); return { ...replacement(request), gate };
		});
		await h.runtime.session.prompt("Add newer evidence while Mom catches up.");
		await arrived.promise;
		const partial = await h.tools.get("mom").execute("partial", {}, undefined);
		assert.match(partial.content[0].text, /partial last-saved snapshot/);
		assert.doesNotMatch(partial.content[0].text, /\bCurrent\b|· current|you are here/);
		gate.resolve();
		await until(async () => (await snapshots(h)).length === 2);
		const complete = await h.tools.get("mom").execute("complete", {}, undefined);
		assert.doesNotMatch(complete.content[0].text, /partial last-saved snapshot/);
		assert.match(complete.content[0].text, /Current|· current/);
	} finally { gate.resolve(); await h.close(); }
});

test("automatic inference waits for a lead tool stream to settle and then checkpoints its complete batch", { timeout: 15000 }, async () => {
	const h = await setup(true), gate = deferred();
	try {
		const prompt = "Inspect the active runs, then preserve this request.";
		h.api.script(prompt,
			{ text: "Checking the active runs.", tool: { name: "delegate_ctl", arguments: { action: "list" } } },
			{ text: "The check is complete and the request remains active.", gate });
		const turn = h.runtime.session.prompt(prompt);
		await until(() => h.api.requests.filter((r: any) => !isMomRequest(r)).length === 2, "lead tool result round");
		await pause(250);
		assert.equal(h.requests().length, 0, "no Mom request while the lead turn is still streaming");
		gate.resolve(); await turn;
		await until(async () => (await snapshots(h)).length === 1, "first sidecar checkpoint after settlement");
		const body = input(h.requests()[0]);
		assert.match(body.newEvents, /Inspect the active runs, then preserve this request/);
		assert.match(body.newEvents, /lead tool_call delegate_ctl/);
		assert.match(body.newEvents, /lead tool_result delegate_ctl/);
		assert.match(body.newEvents, /The check is complete and the request remains active/);
		const saved = await h.tools.get("mom").execute("saved", {}, undefined);
		assert.match(saved.content[0].text, /Inspect the active runs, then preserve this request/, "the first sidecar checkpoint is immediately usable by the terminal view");
		assert(!h.runtime.session.sessionManager.getEntries().some((e: any) => typeof e.customType === "string" && e.customType.startsWith("pi-tether.mom.")));
		assert.deepEqual(h.errors, []); assert.deepEqual(h.api.errors, []);
	} finally { gate.resolve(); await h.close(); }
});

test("pause/resume preserves pending direction and user corrections without an extra lead turn", { timeout: 15000 }, async () => {
	const h = await setup(true);
	try {
		await h.runtime.session.prompt("Keep recall and reminders."); await until(async () => (await snapshots(h)).length === 1);
		await h.command("pause");
		await h.runtime.session.prompt("Change only the notification presentation.");
		const parentCalls = h.api.requests.filter((r) => !isMomRequest(r)).length;
		await h.command("correct Keep  recall\nand reminders; only presentation changed.");
		await pause(250); assert.equal(h.requests().length, 1);
		assert.equal(h.api.requests.filter((r) => !isMomRequest(r)).length, parentCalls);
		await h.command("resume"); await until(async () => (await snapshots(h)).length === 2);
		assert.match(input(h.requests()[1]).newEvents, /Keep  recall\nand reminders; only presentation changed/);
		assert.equal(input(h.requests()[1]).userHistory, undefined);
		assert.deepEqual(h.errors, []);
	} finally { await h.close(); }
});

test("a sourced notice is appended once at a breakpoint without generating a lead turn", { timeout: 15000 }, async () => {
	const h = await setup(true);
	try {
		h.api.onUnscripted((request) => {
			if (!isMomRequest(request)) return { text: "Several completed files remain uncommitted while I add more changes." };
			const body = input(request);
			const trigger = /\[src:([^\]]+)\] [^\n]+ lead assistant/.exec(body.newEvents)?.[1];
			if (!trigger) return replacement(request);
			return replacement(request, { note: { text: "Commit the completed changes before more work makes them harder to recover.", riskClass: "uncommitted_work", target: "main", riskRefs: [body.original.ref, trigger], actionRefs: [body.original.ref] } });
		});
		await h.runtime.session.prompt("Commits are allowed. Commit completed changes before adding more work.");
		assert.equal(h.runtime.session.sessionManager.getBranch().filter((e: any) => e.customType === NOTICE).length, 0, "advice waits for the next request");
		await until(async () => Boolean((await snapshots(h)).at(-1)?.data.note), "saved process advice");
		const momCalls = h.requests().length;
		await h.emitExtension("input", { type: "input", text: "Continue", source: "interactive" });
		await until(() => h.runtime.session.sessionManager.getBranch().some((e: any) => e.customType === NOTICE), "notice delivery");
		const calls = h.api.requests.length;
		assert.equal(h.requests().length, momCalls, "notice delivery makes no extra Mom call");
		assert.equal(h.api.requests.filter((r) => !isMomRequest(r)).length, 1);
		assert.equal(h.runtime.session.isStreaming, false);
		await h.runtime.session.reload(); await pause(300);
		assert.equal(h.api.requests.length, calls);
		assert.equal(h.runtime.session.sessionManager.getBranch().filter((e: any) => e.customType === NOTICE).length, 1);
	} finally { await h.close(); }
});

test("an unresolved process risk stays quiet, then a sourced resolution permits one genuine recurrence", { timeout: 20000 }, async () => {
	const h = await setup(true);
	try {
		h.api.onUnscripted((request) => {
			if (!isMomRequest(request)) {
				const latest = JSON.stringify(request.messages.findLast((message: any) => message.role === "user"));
				if (latest.includes("Resolve the release risk")) return { text: "The release changes are committed; the commit was created successfully." };
				if (latest.includes("Start later release work")) return { text: "A later set of completed release files is again uncommitted while more work is added." };
				return { text: "Several completed release files remain uncommitted while more work is added." };
			}
			const body = input(request);
			const assistant = [...body.newEvents.matchAll(/\[src:([^\]]+)\] [^\n]+ lead assistant/g)].at(-1)?.[1];
			if (!assistant) return replacement(request);
			if (body.newEvents.includes("commit was created successfully")) return replacement(request, { note: null, resolutions: [{ riskClass: "uncommitted_work", target: "main", resolutionRefs: [assistant] }] });
			return replacement(request, { note: { text: "Commit the release changes before more work makes them harder to recover.", riskClass: "uncommitted_work", target: "main", riskRefs: [body.original.ref, assistant], actionRefs: [body.original.ref] } });
		});
		await h.runtime.session.prompt("Commits are allowed. Commit completed release changes before adding more work.");
		await until(async () => Boolean((await snapshots(h)).at(-1)?.data.note));
		await h.emitExtension("input", { type: "input", text: "Continue", source: "interactive" });
		await until(() => h.runtime.session.sessionManager.getBranch().filter((e: any) => e.customType === NOTICE).length === 1);
		const beforeRepeat = h.requests().length;
		await h.runtime.session.prompt("Continue with the same unresolved release risk.");
		await until(() => h.requests().length > beforeRepeat, "repeat risk update");
		await h.emitExtension("input", { type: "input", text: "Continue unchanged", source: "interactive" });
		assert.equal(h.runtime.session.sessionManager.getBranch().filter((e: any) => e.customType === NOTICE).length, 1, "unchanged risk across updates does not nag");

		await h.runtime.session.prompt("Resolve the release risk now.");
		await until(async () => (await readSidecar(h)).some((r: any) => r.type === "map" && r.data.resolvedNotices?.includes("uncommitted_work:main")));
		await h.runtime.session.prompt("Start later release work with commits still allowed.");
		await until(async () => { const saved = await snapshots(h); const firstTrigger = saved[0]?.data.note?.riskRefs?.at(-1); return saved.at(-1)?.data.note?.riskRefs.some((ref: string) => ref !== firstTrigger); });
		await until(async () => !/updating|catching up/.test((await h.tools.get("mom").execute("settled", {}, undefined)).content[0].text), "recurred risk checkpoint settlement");
		await h.emitExtension("input", { type: "input", text: "Continue later work", source: "interactive" });
		await until(() => h.runtime.session.sessionManager.getBranch().filter((e: any) => e.customType === NOTICE).length === 2);
		await h.runtime.session.reload(); await pause(300);
		await h.emitExtension("input", { type: "input", text: "Continue after reload", source: "interactive" });
		assert.equal(h.runtime.session.sessionManager.getBranch().filter((e: any) => e.customType === NOTICE).length, 2, "reload preserves and suppresses the unresolved second occurrence");
	} finally { await h.close(); }
});

test("tree navigation cancels stale inference and rebuilds only the selected branch", { timeout: 15000 }, async () => {
	const h = await setup(true), gate = deferred(), arrived = deferred(); let first = true;
	try {
		h.api.onUnscripted((request) => {
			if (!isMomRequest(request)) return { text: "Lead continued." };
			if (first) { first = false; arrived.resolve(); return { ...replacement(request), gate }; }
			return replacement(request);
		});
		await h.runtime.session.prompt("Abandoned branch request."); await arrived.promise;
		const user = h.runtime.session.getUserMessagesForForking()[0]; assert(user);
		await h.runtime.session.navigateTree(user.entryId, { summarize: false });
		await h.runtime.session.prompt("Selected branch request."); gate.resolve();
		await until(async () => (await snapshots(h)).length === 1, "new branch checkpoint");
		const body = input(h.requests().at(-1));
		assert.match(body.newEvents, /Selected branch request/);
		assert(!body.newEvents.includes("Abandoned branch request"));
		assert.equal(body.userHistory, undefined);
		assert.deepEqual(h.errors, []);
	} finally { gate.resolve(); await h.close(); }
});
