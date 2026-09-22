import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, deferred, type Sandbox } from "./fixture.ts";
const [root, mode] = process.argv.slice(2);
const box = { root, cwd: join(root, "project"), agentDir: join(root, "agent"), env: process.env } as Sandbox;
const manifestPath = join(root, "manifest.json");
if (mode.startsWith("crash")) {
	let h: Awaited<ReturnType<typeof harness>>;
	h = await harness(box, undefined, {
		beforeNotice(message) {
			writeFileSync(manifestPath, JSON.stringify({ parent: h.parent, id: message.details.id }));
			if (mode === "crash-before-delivery") process.kill(process.pid, "SIGKILL");
		},
		register(pi) {
			pi.on("message_end", (event: any) => {
				if (mode === "crash-receipt" && event.message.role === "custom" && event.message.customType === "delegate") {
					assert(h.state().runs.get(event.message.details.id).acknowledged);
					assert(!h.runtime.session.sessionManager.getEntries().some((entry: any) => entry.type === "custom_message" && entry.details?.id === event.message.details.id));
					process.kill(process.pid, "SIGKILL");
				}
			});
		},
	});
	await h.launch("Crash child");
} else {
	const { parent, id } = JSON.parse(readFileSync(manifestPath, "utf8"));
	const delivered = deferred();
	const h = await harness(box, parent, { register(pi) {
		pi.on("message_end", (event: any) => { if (event.message.role === "assistant") delivered.resolve(); });
	} });
	try {
		if (mode === "recover") await delivered.promise;
		await h.runtime.session.agent.waitForIdle();
		const run = h.state().runs.get(id);
		assert.equal(run.session, undefined, "recovery must not execute child");
		assert.equal(run.status, "complete"); assert.equal(run.output, "CRASH-RESULT");
		assert.equal(h.notices.length, mode === "recover" ? 1 : 0);
		const receipts = h.runtime.session.sessionManager.getEntries().filter((entry: any) => entry.type === "custom_message" && entry.details?.id === id);
		assert.equal(receipts.length, 1);
		console.log("RECOVERY-PASS");
	} finally { await h.runtime.dispose(); }
}
