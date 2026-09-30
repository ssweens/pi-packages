// Explicit opt-in: a controlled transcript, real Mom model, and production notice delivery.
// Never opens or writes the user's session. At most two real provider calls; no fallback.
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { findPackageJSON } from "node:module";
import { pathToFileURL } from "node:url";
import { provider, sandbox, harness } from "../../pi-delegate/test/fixture.ts";
import piTether from "../src/index.ts";
import { DEFAULT_MODEL } from "../src/mother.ts";
import { NOTICE } from "../src/checkpoint.ts";
import { SidecarStore } from "../src/sidecar.ts";
import { until } from "../test/fixture.ts";

// The SDK can own a nested pi-ai installation with its own connection pool.
const sdkApiPackage = findPackageJSON("@earendil-works/pi-ai", import.meta.resolve("@earendil-works/pi-coding-agent"))!;
const { closeOpenAICodexWebSocketSessions } = await import(new URL("./dist/api/openai-codex-responses.js", pathToFileURL(sdkApiPackage)).href);
const modelRuntime = await ModelRuntime.create();
const [providerId, ...modelId] = DEFAULT_MODEL.split("/");
const model = modelRuntime.getModel(providerId, modelId.join("/"));
assert(model && model.api === "openai-codex-responses", `Unavailable exact Mom model: ${DEFAULT_MODEL}`);
const api = await provider(), box = sandbox(api.url);
const evidenceDir = resolve(import.meta.dirname, "evidence/todo-011");
const deadline = AbortSignal.timeout(120000);
let calls = 0, leadCalls = 0, context: any;
const cacheSessions = new Set<string>();
const replies: any[] = [], handlers = new Map<string, any>(), commands = new Map<string, any>(), tools = new Map<string, any>();
const registry = {
	find: () => model,
	complete: async (selected: any, request: any, options: any) => {
		assert(++calls <= 2, "Real-provider call ceiling exceeded");
		cacheSessions.add(options.sessionId);
		const response = await modelRuntime.complete(selected, request, { ...options, signal: AbortSignal.any([deadline, options.signal]) });
		replies.push({ stopReason: response.stopReason, usage: response.usage, operations: response.content.filter(block => block.type === "toolCall") });
		return response;
	},
};
api.onUnscripted(() => ({ text: ++leadCalls === 1
	? "I increased the network timeout to fix the release upload. The release upload still fails with the same authorization error; this timeout change did not fix it."
	: "I increased the same network timeout again. The release upload still fails with the identical authorization error. The same fix has now failed twice, and the release remains blocked." }));
const h = await harness(box, undefined, { register(pi) {
	piTether(new Proxy(pi, { get(target, key) {
		if (key === "getFlag") return (name: string) => name === "mom-model" ? DEFAULT_MODEL : name === "mom-interval-ms" ? "0" : target.getFlag(name);
		if (key === "on") return (name: string, handler: any) => {
			const wrapped = (event: any, ctx: any) => {
				context = Object.create(ctx, { modelRegistry: { value: registry } });
				return handler(event, context);
			};
			handlers.set(name, wrapped); target.on(name, wrapped);
		};
		if (key === "registerTool") return (tool: any) => { tools.set(tool.name, tool); target.registerTool(tool); };
		if (key === "registerCommand") return (name: string, value: any) => { commands.set(name, value); target.registerCommand(name, value); };
		return target[key];
	} }));
} });
try {
	assert.deepEqual(h.errors, [], "extension startup must succeed");
	await commands.get("mom").handler("pause", context);
	await h.runtime.session.prompt("Fix the release upload. Diagnose the actual failing path before repeating speculative changes; the release cannot proceed while uploads fail.");
	await h.runtime.session.prompt("Try the timeout change once more and report the result.");
	await commands.get("mom").handler("resume", context);
	const store = () => new SidecarStore(() => h.parent, h.runtime.session.sessionManager.getSessionId());
	await until(async () => (await store().load()).some(record => record.type === "map" && record.data.snapshot?.note), "real Mom advisory", 125000);
	await until(async () => !/updating|catching up/.test((await tools.get("mom").execute("settled", {}, undefined)).content[0].text), "advisory acceptance settlement");
	const maps = (await store().load()).filter(record => record.type === "map" && record.data.snapshot);
	const note = maps.at(-1)!.data.snapshot.note;
	assert.equal(note.riskClass, "repeated_fix_failure");
	assert.equal(h.runtime.session.sessionManager.getBranch().filter((entry: any) => entry.customType === NOTICE).length, 0);
	await handlers.get("input")({ type: "input", text: "Continue", source: "interactive" }, h.ctx());
	await until(() => h.runtime.session.sessionManager.getBranch().filter((entry: any) => entry.customType === NOTICE).length === 1, "production notice delivery");
	await h.runtime.session.reload();
	await handlers.get("input")({ type: "input", text: "Continue after reload", source: "interactive" }, h.ctx());
	const messages = h.runtime.session.sessionManager.getBranch().filter((entry: any) => entry.customType === NOTICE);
	assert.equal(messages.length, 1);
	assert.equal(leadCalls, 2, "delivery and reload must not create a lead turn");
	assert(calls <= 2);
	await mkdir(evidenceDir, { recursive: true });
	const result = { scenario: "Controlled release-upload transcript; lead replies scripted, Mom advisory generated by the real provider.", model: DEFAULT_MODEL, calls, leadCalls, noticeCountAfterReload: messages.length, note, replies };
	await writeFile(resolve(evidenceDir, "real-advisory.json"), JSON.stringify(result, null, 2) + "\n");
	console.log(JSON.stringify({ model: DEFAULT_MODEL, calls, leadCalls, noticeCountAfterReload: messages.length, text: note.text, evidenceDir }, null, 2));
} finally {
	for (const id of cacheSessions) closeOpenAICodexWebSocketSessions(id);
	await h.runtime.dispose(); await api.close(); await rm(box.root, { recursive: true, force: true });
}
