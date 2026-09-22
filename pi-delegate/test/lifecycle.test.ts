import assert from "node:assert/strict";
import { test } from "node:test";
import { rmSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { deferred, provider, sandbox, harness } from "./fixture.ts";

test("real SDK delegation lifecycle (loopback provider, no credentials)", { timeout: 60000 }, async (t) => {
	const api = await provider();
	const box = sandbox(api.url);
	const h = await harness(box);
	const state = h.state;
	try {
		await t.test("extension-registered providers are available to children without config-file aliases", async () => {
			h.runtime.session.modelRuntime.registerProvider("fixture-alias", {
				api: "openai-completions", baseUrl: api.url, apiKey: "loopback-only",
				models: [{ id: "fixture", name: "Runtime-only alias", reasoning: false, input: ["text"], contextWindow: 32768, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
			});
			const native = h.runtime.session.modelRuntime.getProvider("fixture")!;
			h.runtime.session.modelRuntime.registerNativeProvider({ ...native, id: "fixture-native", getModels: () => native.getModels().map((model) => ({ ...model, provider: "fixture-native" })) });
			api.script("Alias work", { text: "ALIAS-OK" });
			const result = await h.launch("Alias work", { model: "fixture-alias/fixture:off", sync: true });
			assert.equal(result.details.status, "complete", result.content[0].text);
			assert.equal(result.details.output, "ALIAS-OK");
			assert.equal(result.details.model, "fixture-alias/fixture");
			api.script("Native provider work", { text: "NATIVE-PROVIDER-OK" });
			const fromNative = await h.launch("Native provider work", { model: "fixture-native/fixture:off", sync: true });
			assert.equal(fromNative.details.status, "complete", fromNative.content[0].text);
			assert.equal(fromNative.details.output, "NATIVE-PROVIDER-OK");
			assert.equal(fromNative.details.model, "fixture-native/fixture");
			// Registration order must not decide what a child can run: providers appear at any time.
			h.runtime.session.modelRuntime.registerProvider("fixture-late", {
				api: "openai-completions", baseUrl: api.url, apiKey: "loopback-only",
				models: [{ id: "fixture", name: "Registered after the first child", reasoning: false, input: ["text"], contextWindow: 32768, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
			});
			api.script("Late provider work", { text: "LATE-PROVIDER-OK" });
			const late = await h.launch("Late provider work", { model: "fixture-late/fixture:off", sync: true });
			assert.equal(late.details.status, "complete", late.content[0].text);
			assert.equal(late.details.output, "LATE-PROVIDER-OK");
			// A provider the parent drops stops serving children that must reopen their session;
			// a session already in memory keeps the model it was built with.
			h.runtime.session.modelRuntime.unregisterProvider("fixture-late");
			const evicted = state().runs.get(late.details.id);
			evicted.session.dispose(); evicted.session = undefined; // what retirement and a cold reopen leave behind
			api.onUnscripted(() => ({ text: "ACK" })); // this revival fails faster than a waiter can attach, so it wakes the parent
			const gone = await h.ctl("steer", late.details.id, { message: "Should not run" });
			assert.equal(gone.details.status, "running");
			const settled = await h.ctl("wait", late.details.id);
			assert.equal(settled.details.status, "error");
			assert.match(settled.details.error, /Saved model is unavailable: fixture-late\/fixture/);
			await h.runtime.session.agent.waitForIdle();
			api.onUnscripted();
		});
		await t.test("reload retains live execution and attached wait; fork prefix is durable", async () => {
			h.runtime.session.sessionManager.appendMessage({ role: "user", content: "parent-only-marker", timestamp: Date.now() });
			const notices = h.notices.length;
			const gate = deferred();
			const arrived = api.script("Reload work", { text: "RELOAD-OK", gate });
			const launch = await h.launch("Reload work", { context: "fork" });
			const id = launch.details.id, run = state().runs.get(id);
			const request = await arrived;
			assert.match(JSON.stringify(request.messages), /parent-only-marker/);
			assert.match(JSON.stringify(request.messages), /no delegation tools and cannot start another agent/);
			const wait = h.ctl("wait", id);
			const child = run.session, file = run.sessionFile;
			await h.runtime.session.reload();
			assert.equal(state().runs.get(id).session, child);
			gate.resolve();
			const result = await wait;
			assert.equal(result.details.status, "complete");
			assert.equal(result.details.output, "RELOAD-OK");
			assert.equal(result.details.sessionFile, file);
			assert.equal(h.notices.length, notices, "an attached waiter takes the result instead of waking the parent");
			assert.match(readFileSync(file, "utf8"), /parent-only-marker/);
			assert.equal((readFileSync(file, "utf8").match(/Reload work/g) ?? []).length, 1);
		});
		await t.test("a fork inherits the parent's work, not its delegation records", async () => {
			const manager = h.runtime.session.sessionManager;
			const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
			const assistant = (content: any[]) => manager.appendMessage({ role: "assistant", content, api: "openai-completions", provider: "fixture", model: "fixture", usage, stopReason: "toolUse", timestamp: Date.now() } as any);
			const toolResult = (id: string, name: string, text: string) => manager.appendMessage({ role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text }], isError: false, timestamp: Date.now() } as any);
			assistant([
				{ type: "text", text: "ORDINARY-PARENT-TEXT" },
				{ type: "toolCall", id: "call-read", name: "read", arguments: { path: "KEPT-TOOL-ARGUMENT" } },
			]);
			toolResult("call-read", "read", "KEPT-TOOL-RESULT");
			assistant([{ type: "toolCall", id: "call-delegation", name: "delegate", arguments: { role: "worker", task: "INHERITED-ORCHESTRATION" } }]);
			toolResult("call-delegation", "delegate", "DELEGATE-TOOL-RESULT");
			assistant([{ type: "text", text: "KEPT-TEXT-BESIDE-CONTROL" }, { type: "toolCall", id: "call-control", name: "delegate_ctl", arguments: { action: "wait", runId: "CONTROL-ARGUMENT" } }]);
			toolResult("call-control", "delegate_ctl", "CONTROL-TOOL-RESULT");
			manager.appendCustomMessageEntry("delegate", "DELEGATE-COMPLETION-NOTICE", true, { id: "noise" });
			manager.appendCustomMessageEntry("other-extension", "KEPT-CUSTOM-MESSAGE", true, undefined);
			const arrived = api.script("Clean fork", { text: "CLEAN-FORK-OK" });
			await h.launch("Clean fork", { context: "fork", sync: true });
			const inherited = JSON.stringify((await arrived).messages);
			// The parent's own work survives: only this package's orchestration records are dropped.
			for (const kept of [/ORDINARY-PARENT-TEXT/, /KEPT-TOOL-ARGUMENT/, /KEPT-TOOL-RESULT/, /KEPT-TEXT-BESIDE-CONTROL/, /KEPT-CUSTOM-MESSAGE/, /"name":"read"/]) assert.match(inherited, kept);
			for (const noise of [/INHERITED-ORCHESTRATION/, /DELEGATE-TOOL-RESULT/, /CONTROL-ARGUMENT/, /CONTROL-TOOL-RESULT/, /DELEGATE-COMPLETION-NOTICE/, /"name":"delegate/]) assert.doesNotMatch(inherited, noise);
			// A message whose only content was a delegation call leaves no empty turn behind.
			assert(!(await arrived).messages.some((m: any) => Array.isArray(m.content) && m.content.length === 0));
			// And the child is told whose conversation it is reading, so it does not adopt the supervising voice.
			const system = (await arrived).messages.find((m: any) => m.role === "system").content;
			assert.match(system, /It belongs to the agent that delegated to you/);
			assert.match(system, /you are the worker it hired/);
		});
		await t.test("the child's report is quoted, never blended into this tool's own reporting", async () => {
			api.script("Quoted report", { text: "CHILD-WORDS" });
			const result = await h.launch("Quoted report", { sync: true });
			assert.equal(result.details.joinedWaiters, 0);
			const [summary, report] = result.content[0].text.split(/^----- \S+ reported, verbatim -----$/m);
			assert.match(summary, /^complete \u00b7 scout-[\w-]+ \u00b7 role scout \u00b7 model fixture\/fixture:off \u00b7 context fresh \u00b7 1 turn in \d+s \u00b7 tokens in \d/);
			// Progress is a read the parent can take at any time, not something it must wait for.
			const gate = deferred(), arrived = api.script("Progress read", { text: "WORKING", gate });
			const { details: { id } } = await h.launch("Progress read", { timeoutMs: 600000 });
			await arrived;
			const status = await h.ctl("status", id);
			assert.match(status.content[0].text, /^running \u00b7 /);
			assert.match(status.content[0].text, /\nnow: thinking \u00b7 0 tool calls so far \u00b7 10 min of its budget left$/);
			// A blocked parent turn is visible while it lasts, so a queued prompt is explicable.
			assert.equal(state().runs.get(id).completion.waiting, 0);
			const wait = h.ctl("wait", id);
			await sleep(10);
			assert.equal(state().runs.get(id).completion.waiting, 1);
			assert.equal((await h.ctl("status", id)).details.joinedWaiters, 1);
			gate.resolve(); await wait;
			assert.equal(state().runs.get(id).completion.waiting, 0);
			assert.match(summary, new RegExp(`\nsession: ${result.details.sessionFile}`));
			assert.doesNotMatch(summary, /CHILD-WORDS/);
			assert.doesNotMatch(summary, /error:|changed:|could not have/);
			assert.equal(report.trim(), "CHILD-WORDS\n----- end of report -----");
		});
		await t.test("wait abort detaches; explicit cancel stops; async steer reuses identity", async () => {
			const gate = deferred(), arrived = api.script("Stop work", { text: "PARTIAL", gate });
			const { details: { id } } = await h.launch("Stop work");
			await arrived;
			const controller = new AbortController();
			const detached = h.ctl("wait", id, {}, controller.signal);
			controller.abort();
			await assert.rejects(detached, /Wait cancelled/);
			assert.equal(state().runs.get(id).status, "running");
			const joined = h.ctl("wait", id);
			await h.ctl("cancel", id);
			assert.equal((await joined).details.status, "cancelled");
			await assert.rejects(h.ctl("steer", id, { message: "Resume work" }), /explicitly stopped/);
			const file = state().runs.get(id).sessionFile;
			const resumeGate = deferred(), resume = api.script("Resume work", { text: "RESUMED", gate: resumeGate });
			assert.equal((await h.ctl("steer", id, { message: "Resume work", restart: true })).details.status, "running");
			const wait = h.ctl("wait", id); await resume; resumeGate.resolve();
			assert.equal((await wait).details.output, "RESUMED");
			assert.equal(state().runs.get(id).sessionFile, file);
			assert.equal(state().runs.get(id).segment, 2);
		});
		await t.test("reviving on another offering applies from the next segment and persists", async () => {
			api.script("Switch work", { text: "FIRST-MODEL" });
			const { details: { id } } = await h.launch("Switch work", { sync: true });
			const run = state().runs.get(id), file = run.sessionFile, segment = run.segment;
			// A named provider is the choice; it never resolves to the same id on another provider.
			await assert.rejects(h.ctl("steer", id, { message: "Nope", model: "fixture-typo/fixture" }), /model not found: fixture-typo\/fixture/);
			await assert.rejects(h.ctl("steer", id, { message: "Nope", model: "fixture/absent" }), /model not found: fixture\/absent/);
			assert.equal(run.segment, segment); assert.equal(run.model, "fixture/fixture");
			api.script("Second model work", { text: "SECOND-MODEL" });
			const resumed = await h.ctl("steer", id, { message: "Second model work", model: "fixture-alias/fixture:medium" });
			assert.match(resumed.content[0].text, /Model changed from fixture\/fixture:off to fixture-alias\/fixture:medium/);
			const done = await h.ctl("wait", id);
			assert.equal(done.details.status, "complete", done.content[0].text);
			assert.equal(done.details.output, "SECOND-MODEL");
			assert.equal(done.details.model, "fixture-alias/fixture");
			assert.equal(done.details.thinking, "medium");
			assert.equal(done.details.sessionFile, file);
			assert.equal(JSON.parse(readFileSync(run.recordPath, "utf8")).model, "fixture-alias/fixture");
			// A saved child keeps the replacement without restating it.
			api.script("Third work", { text: "STILL-SECOND-MODEL" });
			await h.ctl("steer", id, { message: "Third work" });
			const again = await h.ctl("wait", id);
			assert.equal(again.details.model, "fixture-alias/fixture");
			assert.equal(again.details.output, "STILL-SECOND-MODEL");
			// A live turn is bound to the model it started on.
			const gate = deferred(), arrived = api.script("Live turn", { text: "LIVE", gate });
			await h.ctl("steer", id, { message: "Live turn" }); await arrived;
			await assert.rejects(h.ctl("steer", id, { message: "Swap now", model: "fixture/fixture" }), /applies to its next segment/);
			assert.equal(state().runs.get(id).model, "fixture-alias/fixture");
			gate.resolve(); await h.ctl("wait", id);
		});
		await t.test("cancel during real SDK preflight never dispatches a model request", async () => {
			api.script("Preflight seed", { text: "SEED" });
			const { details: { id } } = await h.launch("Preflight seed", { sync: true });
			const run = state().runs.get(id), child = run.session;
			const entered = deferred(), release = deferred();
			const original = child.extensionRunner.emitBeforeAgentStart.bind(child.extensionRunner);
			child.extensionRunner.emitBeforeAgentStart = async (...args: any[]) => { const result = await original(...args); entered.resolve(); await release.promise; return result; };
			const count = api.requests.length;
			await h.ctl("steer", id, { message: "Must not dispatch" });
			await entered.promise;
			const wait = h.ctl("wait", id);
			const cancel = h.ctl("cancel", id); release.resolve(); await cancel;
			assert.equal((await wait).details.status, "cancelled");
			assert.equal(api.requests.length, count);
		});
		await t.test("a running child's time budget can be extended, and a spent one is refused", async () => {
			const gate = deferred(), arrived = api.script("Budget work", { text: "WORKING", gate });
			api.script("Keep going", { text: "FINISHED-WITH-MORE-TIME" });
			const { details: { id } } = await h.launch("Budget work", { timeoutMs: 1500 });
			await arrived;
			const extended = await h.ctl("steer", id, { message: "Keep going", timeoutMs: 60000 });
			assert.match(extended.content[0].text, /Budget now 1 min for this and later segments/);
			assert.equal(JSON.parse(readFileSync(state().runs.get(id).recordPath, "utf8")).timeoutMs, 60000);
			await assert.rejects(h.ctl("steer", id, { message: "Too little", timeoutMs: 1 }), /budget is already spent/);
			assert.equal(state().runs.get(id).timeoutMs, 60000, "a refused budget leaves the working one armed");
			const wait = h.ctl("wait", id);
			// Past the original 1.5s budget: without the extension this child would already be dead.
			await sleep(1800);
			assert.equal(state().runs.get(id).status, "running");
			gate.resolve();
			const done = await wait;
			assert.equal(done.details.status, "complete", done.content[0].text);
			assert.equal(done.details.output, "FINISHED-WITH-MORE-TIME");
		});
		await t.test("timeout and provider failure preserve terminal status", async () => {
			api.script("Timeout work", { text: "Waiting", gate: deferred() });
			const timeout = await h.launch("Timeout work", { timeoutMs: 200, sync: true });
			assert.equal(timeout.details.status, "timeout");
			assert.match(timeout.details.error, /Stopped after its 0 min budget \(timeoutMs, default 15 min\)\. Its work up to that point stands/);

			assert.match(timeout.details.error, /Give it a larger timeoutMs only if the work genuinely needs longer/);
			api.script("Provider failure", { error: 400 });
			const failure = await h.launch("Provider failure", { sync: true });
			assert.equal(failure.details.status, "error");
			assert.match(failure.details.error, /Fixture provider failure/);
		});
		await t.test("a failed provider attempt is reported as an attempt, not as a turn of work", async () => {
			api.script("Stalled provider", { error: 503 });
			const failed = await h.launch("Stalled provider", { sync: true });
			const id = failed.details.id;
			assert.equal(failed.details.status, "error");
			assert.equal(failed.details.failedAttempts, 1);
			assert.equal(failed.details.turns, 0, "a failed request is not a turn");
			// The same child then succeeds: the report must still surface the attempt that burned time.
			api.script("Retry by hand", { text: "EVENTUALLY-OK" });
			await h.ctl("steer", id, { message: "Retry by hand" });
			const done = await h.ctl("wait", id);
			assert.equal(done.details.status, "complete");
			assert.equal(done.details.turns, 1);
			assert.equal(done.details.failedAttempts, 1);
			assert.match(done.content[0].text, /1 provider attempt failed and were retried before this \(last: [^)]*Fixture provider failure/);
			// And a timeout whose budget went to failed attempts points at the provider, not at the budget.
			api.script("Stall then hang", { error: 503 }, { text: "Waiting", gate: deferred() });
			const hung = await h.launch("Stall then hang", { sync: true, timeoutMs: 400 });
			assert.equal(hung.details.status, "error");
			api.onUnscripted(() => ({ text: "Waiting", gate: deferred() }));
			await h.ctl("steer", hung.details.id, { message: "Hang now", timeoutMs: 600 });
			const timedOut = await h.ctl("wait", hung.details.id);
			api.onUnscripted();
			assert.equal(timedOut.details.status, "timeout");
			assert.match(timedOut.details.error, /Most of that budget went to 1 failed provider attempt and retries \(last: [^)]*Fixture provider failure[^)]*\), not to the work/);
			assert.doesNotMatch(timedOut.details.error, /Give it a larger timeoutMs only/);
		});
		await t.test("missing transcript and failed snapshot leave the previous segment intact", async () => {
			api.script("Transactional seed", { text: "SAVED" });
			const { details: { id } } = await h.launch("Transactional seed", { sync: true });
			const run = state().runs.get(id), completion = run.completion, segment = run.segment;
			renameSync(run.sessionFile, run.sessionFile + ".held");
			try { await assert.rejects(h.ctl("steer", id, { message: "No history" }), /missing/); }
			finally { renameSync(run.sessionFile + ".held", run.sessionFile); }
			const path = run.recordPath; run.recordPath = join(run.sessionFile, "not-a-directory");
			try { await assert.rejects(h.ctl("steer", id, { message: "Cannot save" })); }
			finally { run.recordPath = path; }
			assert.equal(run.segment, segment); assert.equal(run.completion, completion);
		});
		await t.test("unjoined completion wakes idle and busy parents exactly once", async () => {
			for (const busy of [false, true]) {
				const title = busy ? "Busy wake child" : "Idle wake child";
				const gate = deferred(), arrived = api.script(title, { text: "WAKE-OK", gate });
				const startNotices = h.notices.length;
				const { details: { id } } = await h.launch(title); await arrived;
				const parentDone = deferred();
				const unsubscribe = h.runtime.session.subscribe((event) => {
					if (event.type === "message_end" && event.message.role === "assistant" && JSON.stringify(event.message.content).includes("PARENT-WOKE")) parentDone.resolve();
				});
				api.onUnscripted((request) => {
					assert.match(JSON.stringify(request.messages), new RegExp(id));
					return { text: "PARENT-WOKE" };
				});
				const busyGate = deferred();
				let parentWork: Promise<void> | undefined;
				if (busy) {
					const parentArrived = api.script("Busy parent", { text: "BUSY", gate: busyGate });
					parentWork = h.runtime.session.prompt("Busy parent"); await parentArrived;
				}
				gate.resolve();
				// Observe settlement without claiming delivery as a tool waiter would.
				const settled = deferred();
				const onChange = () => { if (state().runs.get(id).completion.settled) settled.resolve(); };
				state().listeners.add(onChange); onChange(); await settled.promise; state().listeners.delete(onChange);
				busyGate.resolve(); await parentWork;
				let timer: ReturnType<typeof setTimeout>;
				try { await Promise.race([parentDone.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(JSON.stringify({ busy, notices: h.notices, errors: h.errors, providerErrors: api.errors, requests: api.requests.slice(-2) }))), 5000); })]); }
				finally { clearTimeout(timer!); }
				await h.runtime.session.agent.waitForIdle();
				unsubscribe(); api.onUnscripted();
				assert.equal(h.notices.length, startNotices + 1);
				const receipts = h.runtime.session.sessionManager.getEntries().filter((entry: any) => entry.type === "custom_message" && entry.details?.id === id);
				assert.equal(receipts.length, 1);
			}
		});
		await t.test("completion in detached reload interval is delivered once on reattach", async () => {
			const gate = deferred(), arrived = api.script("Reload gap child", { text: "GAP-OK", gate });
			const { details: { id } } = await h.launch("Reload gap child"); await arrived;
			const before = h.notices.length;
			api.onUnscripted((request) => { assert.match(JSON.stringify(request.messages), new RegExp(id)); return { text: "GAP-ACK" }; });
			await h.runtime.session.reload({ beforeSessionStart: async () => {
				const settled = deferred();
				const listener = () => { if (state().runs.get(id).completion.settled) settled.resolve(); };
				state().listeners.add(listener); gate.resolve(); listener(); await settled.promise; state().listeners.delete(listener);
				assert.equal(h.notices.length, before);
			} });
			await h.runtime.session.agent.waitForIdle();
			assert.equal(h.notices.length, before + 1);
			await h.runtime.session.reload();
			assert.equal(h.notices.length, before + 1);
			api.onUnscripted();
		});
		await t.test("separate process cannot acquire a live parent's lease", async () => {
			const child = spawn(process.execPath, ["--import", "tsx", "test/reopen.ts", box.root, h.parent, "locked"], { env: box.env, stdio: ["ignore", "pipe", "pipe"] });
			let output = ""; child.stdout.on("data", (s) => output += s); child.stderr.on("data", (s) => output += s);
			const [code] = await once(child, "exit"); assert.equal(code, 0, output); assert.match(output, /LEASE-REFUSED/);
		});
		await t.test("cold reopen is read-only; stopped and completed records stay inert", async () => {
			const parent = h.parent;
			await h.runtime.dispose();
			const count = api.requests.length;
			const child = spawn(process.execPath, ["--import", "tsx", "test/reopen.ts", box.root, parent, "cold"], { env: box.env, stdio: ["ignore", "pipe", "pipe"] });
			let output = ""; child.stdout.on("data", (s) => output += s); child.stderr.on("data", (s) => output += s);
			const [code] = await once(child, "exit"); assert.equal(code, 0, output); assert.match(output, /COLD-READ-ONLY/);
			assert.equal(api.requests.length, count);
		});
		assert.deepEqual(h.errors, []); assert.deepEqual(api.errors, []);
	} finally { await h.runtime.dispose(); await api.close(); rmSync(box.root, { recursive: true, force: true }); }
});
