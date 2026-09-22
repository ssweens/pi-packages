import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { provider, sandbox, type Sandbox } from "./fixture.ts";

async function run(box: Sandbox, mode: string) {
	const child = spawn(process.execPath, ["--import", "tsx", "test/recovery-worker.ts", box.root, mode], { env: box.env, stdio: ["ignore", "pipe", "pipe"], timeout: 30000, killSignal: "SIGKILL" });
	let output = ""; child.stdout.on("data", (s) => output += s); child.stderr.on("data", (s) => output += s);
	const [code, signal] = await once(child, "exit");
	return { code, signal, output };
}
test("SIGKILL before delivery and before receipt persistence recovers once without child execution", { timeout: 45000 }, async () => {
	const api = await provider(), box = sandbox(api.url);
	try {
		const scenarios = ["crash-before-delivery", "crash-receipt"].map((mode) => ({ mode, box: sandbox(api.url, join(box.root, mode)) }));
		api.script("Crash child", { text: "CRASH-RESULT" }, { text: "CRASH-RESULT" });
		const crashes = await Promise.all(scenarios.map(({ box, mode }) => run(box, mode)));
		for (const crash of crashes) assert.equal(crash.signal, "SIGKILL", crash.output);
		assert.equal(api.requests.length, 2);
		// Real lease policy is stale=10s; do not rewrite lock mtimes or mock ownership.
		await sleep(11000);
		api.onUnscripted((request) => {
			assert.match(JSON.stringify(request.messages.at(-1)), /delegate finished.*CRASH-RESULT/s);
			return { text: "RECOVERED-ACK" };
		});
		for (const { box } of scenarios) {
			const recovered = await run(box, "recover"); assert.equal(recovered.code, 0, recovered.output); assert.match(recovered.output, /RECOVERY-PASS/);
			const replayed = await run(box, "reopen"); assert.equal(replayed.code, 0, replayed.output); assert.match(replayed.output, /RECOVERY-PASS/);
		}
		assert.equal(api.requests.length, 4, "two child requests, two parent acknowledgements, no replay");
		assert.deepEqual(api.errors, []);
	} finally { await api.close(); rmSync(box.root, { recursive: true, force: true }); }
});
