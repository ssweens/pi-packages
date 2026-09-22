import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import delegate from "../src/index.ts";

/** Commands only control the fixture. All rendering and child work are the actual extension. */
export default function (pi: any) {
	const root = process.env.DELEGATE_SMOKE_ROOT!;
	const tools = new Map<string, any>();
	const trace = (event: any) => appendFileSync(join(root, "trace.jsonl"), JSON.stringify(event) + "\n");
	delegate(new Proxy(pi, { get(target, key) {
		if (key === "registerTool") return (tool: any) => { tools.set(tool.name, tool); return target.registerTool(tool); };
		if (key === "sendMessage") return (message: any, options: any) => {
			trace({ event: "complete", details: message.details });
			// This UI-only probe renders/persists real results without an unrelated parent reply.
			// Automatic wake-up is checked separately in lifecycle.test.ts.
			return target.sendMessage(message, { ...options, triggerTurn: false });
		};
		return target[key];
	} }));
	pi.on("session_start", (_event: any, ctx: any) => {
		writeFileSync(join(root, "parent.json"), JSON.stringify({ file: ctx.sessionManager.getSessionFile() }));
		ctx.ui.setStatus("fixture", "FIXTURE-READY");
	});
	pi.registerCommand("fixture-spawn", { handler: async (args: string, ctx: any) => {
		const result = await tools.get("delegate").execute("fixture", { role: "scout", model: "fixture/fixture:off", context: "fresh", cwd: ctx.cwd, task: args || "Native detail" }, undefined, undefined, ctx);
		trace({ event: "launch", details: result.details });
	} });
}
