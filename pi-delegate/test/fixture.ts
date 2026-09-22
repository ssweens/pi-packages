/** Real Pi transport, sessions, tools, and extension. Only the remote model is scripted. */
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

export function deferred<T = void>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}
export interface Reply {
	text?: string;
	after?: string;
	tool?: { name: string; arguments: Record<string, unknown> };
	gate?: ReturnType<typeof deferred<void>>;
	error?: number;
}
export async function provider() {
	const scripts = new Map<string, Reply[]>();
	const arrivals = new Map<string, ReturnType<typeof deferred<any>>>();
	const requests: any[] = [];
	let onUnscripted: ((request: any) => Reply) | undefined;
	const errors: string[] = [];
	const sockets = new Set<ServerResponse>();
	const server = createServer(async (req, res) => {
		sockets.add(res); res.on("close", () => sockets.delete(res));
		try {
			assert.equal(req.url, "/v1/chat/completions");
			let body = "";
			for await (const chunk of req) body += chunk;
			const request = JSON.parse(body); requests.push(request);
			const user = request.messages.findLast((m: any) => m.role === "user");
			const text = typeof user?.content === "string" ? user.content : user?.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
			const reply = scripts.get(text)?.shift() ?? onUnscripted?.(request);
			assert(reply, `Unscripted model request: ${text}`);
			arrivals.get(text)?.resolve(request);
			if (reply.error) { res.writeHead(reply.error); res.end(JSON.stringify({ error: { message: "Fixture provider failure" } })); return; }
			res.writeHead(200, { "content-type": "text/event-stream" });
			const chunk = (delta: object, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
			chunk({ role: "assistant", content: reply.text ?? "" });
			if (reply.gate) await Promise.race([reply.gate.promise, once(res, "close")]);
			if (res.destroyed) return;
			if (reply.after) chunk({ content: reply.after });
			if (reply.tool) chunk({ tool_calls: [{ index: 0, id: `call-${requests.length}`, type: "function", function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.arguments) } }] });
			chunk({}, reply.tool ? "tool_calls" : "stop");
			res.end("data: [DONE]\n\n");
		} catch (error) { errors.push(String(error)); res.writeHead(500); res.end(String(error)); }
	});
	server.listen(0, "127.0.0.1"); await once(server, "listening");
	const address = server.address(); assert(address && typeof address !== "string");
	return {
		url: `http://127.0.0.1:${address.port}/v1`, requests, errors,
		onUnscripted(handler?: (request: any) => Reply) { onUnscripted = handler; },
		script(text: string, ...replies: Reply[]) { scripts.set(text, replies); const arrival = deferred<any>(); arrivals.set(text, arrival); return arrival.promise; },
		async close() { for (const res of sockets) res.destroy(); server.close(); await once(server, "close"); },
	};
}
export function sandbox(url: string, root = mkdtempSync(join(tmpdir(), "pi-delegate-qc-"))) {
	const cwd = join(root, "project"), agentDir = join(root, "agent");
	mkdirSync(cwd, { recursive: true }); mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: url, apiKey: "loopback-only", models: [{ id: "fixture", name: "Deterministic fixture", reasoning: false, input: ["text"], contextWindow: 32768, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "fixture", defaultModel: "fixture", defaultThinkingLevel: "off", retry: { enabled: false }, compaction: { enabled: false }, defaultProjectTrust: "full", quietStartup: true, hideThinkingBlock: true }));
	return { root, cwd, agentDir, env: { ...process.env, HOME: root, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_TELEMETRY: "0", DO_NOT_TRACK: "1" } };
}
export type Sandbox = ReturnType<typeof sandbox>;

export async function harness(box: Sandbox, parent?: string, hooks: { beforeNotice?: (message: any) => void; register?: (pi: any) => void } = {}) {
	// Import after isolation: Pi and the extension resolve configuration paths on first load.
	process.env.HOME = box.root;
	process.env.PI_CODING_AGENT_DIR = box.agentDir;
	process.env.PI_OFFLINE = "1";
	process.env.DO_NOT_TRACK = "1";
	process.env.PI_TELEMETRY = "0";
	const sdk = await import("@earendil-works/pi-coding-agent");
	const { default: extension } = await import("../src/index.ts");
	const tools = new Map<string, any>();
	let ctx: any;
	const notices: any[] = [], errors: any[] = [];
	const notice = deferred<any>();
	const factory = (pi: any) => {
		extension(new Proxy(pi, { get(target, key) {
			if (key === "registerTool") return (tool: any) => { tools.set(tool.name, tool); target.registerTool(tool); };
			if (key === "sendMessage") return (message: any, options: any) => { hooks.beforeNotice?.(message); notices.push(message); notice.resolve(message); return target.sendMessage(message, options); };
			return target[key];
		} }));
		pi.on("session_start", (_event: any, context: any) => { ctx = context; });
		hooks.register?.(pi);
	};
	let manager = parent ? sdk.SessionManager.open(parent) : sdk.SessionManager.create(box.cwd, join(box.root, "parents"));
	if (!parent) {
		mkdirSync(join(box.root, "parents"), { recursive: true });
		writeFileSync(manager.getSessionFile()!, JSON.stringify(manager.getHeader()) + "\n");
		manager = sdk.SessionManager.open(manager.getSessionFile()!);
	}
	const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(box.agentDir, "auth.json"), modelsPath: join(box.agentDir, "models.json"), allowModelNetwork: false, refreshOnCreate: false });
	const model = modelRuntime.getModel("fixture", "fixture"); assert(model);
	const runtime = await sdk.createAgentSessionRuntime(async (options) => {
		const services = await sdk.createAgentSessionServices({ cwd: options.cwd, agentDir: box.agentDir, modelRuntime, resourceLoaderOptions: {
			noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			systemPrompt: "Deterministic verification parent.", extensionFactories: [factory],
		} });
		const result = await sdk.createAgentSessionFromServices({ services, sessionManager: options.sessionManager, sessionStartEvent: options.sessionStartEvent, model, thinkingLevel: "off", tools: ["delegate", "delegate_ctl"] });
		return { ...result, services, diagnostics: services.diagnostics };
	}, { cwd: box.cwd, agentDir: box.agentDir, sessionManager: manager });
	await runtime.session.bindExtensions({ onError: (error) => errors.push(error) });
	const raw = async (name: string, args: any, signal?: AbortSignal) => {
		const result = await tools.get(name).execute("fixture", args, signal, undefined, ctx);
		// Direct test calls bypass the parent's agent loop. Seed its durable receipt at
		// the return boundary; async sendMessage delivery itself remains unmodified.
		if (result.details?.completionReceipt) runtime.session.sessionManager.appendCustomMessageEntry("delegate", result.content[0].text, true, result.details);
		return result;
	};
	const ctl = (action: string, runId?: string, extra: any = {}, signal?: AbortSignal) => raw("delegate_ctl", { action, runId, ...extra }, signal);
	return { sdk, runtime, errors, notices, notice, parent: manager.getSessionFile()!, ctl,
		launch: (task: string, extra: any = {}) => raw("delegate", { role: "scout", context: "fresh", task, cwd: box.cwd, model: "fixture/fixture:off", ...extra }),
		state: () => (globalThis as any)[Symbol.for("@ssweens/pi-delegate/runtime/1")],
	};
}
