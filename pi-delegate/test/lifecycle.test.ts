import assert from "node:assert/strict";
import { test } from "node:test";
import { rmSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
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
		});
		await t.test("reload retains live execution and attached wait; fork prefix is durable", async () => {
			h.runtime.session.sessionManager.appendMessage({ role: "user", content: "parent-only-marker", timestamp: Date.now() });
			const gate = deferred();
			const arrived = api.script("Reload work", { text: "RELOAD-OK", gate });
			const launch = await h.launch("Reload work", { context: "fork" });
			const id = launch.details.id, run = state().runs.get(id);
			const request = await arrived;
			assert.match(JSON.stringify(request.messages), /parent-only-marker/);
			const wait = h.ctl("wait", id);
			const child = run.session, file = run.sessionFile;
			await h.runtime.session.reload();
			assert.equal(state().runs.get(id).session, child);
			gate.resolve();
			const result = await wait;
			assert.equal(result.details.status, "complete");
			assert.equal(result.details.output, "RELOAD-OK");
			assert.equal(result.details.sessionFile, file);
			assert.equal(h.notices.length, 0);
			assert.match(readFileSync(file, "utf8"), /parent-only-marker/);
			assert.equal((readFileSync(file, "utf8").match(/Reload work/g) ?? []).length, 1);
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
		await t.test("timeout and provider failure preserve terminal status", async () => {
			api.script("Timeout work", { text: "Waiting", gate: deferred() });
			const timeout = await h.launch("Timeout work", { timeoutMs: 200, sync: true });
			assert.equal(timeout.details.status, "timeout");
			api.script("Provider failure", { error: 400 });
			const failure = await h.launch("Provider failure", { sync: true });
			assert.equal(failure.details.status, "error");
			assert.match(failure.details.error, /Fixture provider failure/);
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
