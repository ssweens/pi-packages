import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { join } from "node:path";
import { harness, type Sandbox } from "./fixture.ts";
const [root, parent, mode] = process.argv.slice(2);
const box = { root, cwd: join(root, "project"), agentDir: join(root, "agent"), env: process.env } as Sandbox;
const h = await harness(box, parent);
try {
	if (mode === "locked") {
		await assert.rejects(h.launch("Must not start"), /owned by another|already|another Pi/);
		console.log("LEASE-REFUSED");
	} else {
		const runs = [...h.state().runs.values()] as any[];
		assert(runs.length > 0);
		for (const run of runs) {
			const before = statSync(run.sessionFile).size;
			await h.ctl("status", run.id); await h.ctl("result", run.id); await h.ctl("wait", run.id);
			assert.equal(statSync(run.sessionFile).size, before); assert.equal(run.session, undefined);
			if (run.stopped) await assert.rejects(h.ctl("steer", run.id, { message: "Do not revive" }), /explicitly stopped/);
		}
		assert.equal(h.notices.length, 0);
		console.log("COLD-READ-ONLY");
	}
} finally { await h.runtime.dispose(); }
