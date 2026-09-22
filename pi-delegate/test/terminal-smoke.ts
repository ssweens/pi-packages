import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { provider, sandbox, deferred } from "./fixture.ts";

const api = await provider(), box = sandbox(api.url);
const socket = `delegate-qc-${process.pid}`;
const cli = join(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "bundle/cli.js");
const fixture = resolve(import.meta.dirname, "terminal-fixture.ts");
const tmux = (...args: string[]) => execFileSync("tmux", ["-L", socket, ...args], { encoding: "utf8", timeout: 10000 });
const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
const capture = () => tmux("capture-pane", "-p", "-t", "pi");
const save = (name: string) => {
	const file = join(box.root, `${name}.txt`);
	writeFileSync(file, capture());
	writeFileSync(join(box.root, `${name}.ansi`), tmux("capture-pane", "-e", "-p", "-t", "pi"));
};
async function expect(pattern: RegExp, absent = false) {
	const deadline = Date.now() + 15000;
	let screen = "";
	while (Date.now() < deadline) {
		screen = capture();
		if (pattern.test(screen) !== absent) return screen;
		await sleep(50);
	}
	throw new Error(`Terminal ${absent ? "still contains" : "missing"} ${pattern}\n${screen}`);
}
const key = (...keys: string[]) => tmux("send-keys", "-t", "pi", ...keys);
const text = (value: string) => tmux("send-keys", "-t", "pi", "-l", value);
const mouse = (button: number, row: number) => text(`\x1b[<${button};3;${row}M${button === 0 ? `\x1b[<0;3;${row}m` : ""}`);
async function command(value: string) { text(value); key("Enter"); }
try {
	writeFileSync(join(box.cwd, "sample.ts"), Array.from({ length: 36 }, (_, i) => `export const line${i + 1} = ${i + 1};`).join("\n"));
	for (const mode of ["regular", "fullscreen"]) {
		const release = join(box.root, `${mode}.release`);
		const finalGate = deferred();
		api.script("Native detail", {
			text: "# Inspecting the child\n\n**Native formatting** with `inline code`.\n\n```ts\nconst answer = 42;\n```",
			tool: { name: "read", arguments: { path: "sample.ts" } },
		}, {
			tool: { name: "bash", arguments: { command: `printf '%s\\n' ${Array.from({ length: 30 }, (_, i) => `'OUTPUT-${i + 1}'`).join(" ")}; while [ ! -f ${quote(release)} ]; do sleep 0.05; done; printf 'TOOL-LIVE-END\\n'` } },
		}, { text: Array.from({ length: 35 }, (_, i) => `Streaming line ${i + 1}`).join("\n"), gate: finalGate, after: "\n\n**LATEST-END**" });
		const args = [process.execPath, cli, "--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--extension", fixture, "--model", "fixture/fixture", "--thinking", "off", "--tui-mode", mode, "--session-dir", join(box.root, `parents-${mode}`)];
		const launch = join(box.root, `launch-${mode}.sh`);
		// Only environment overrides; avoid recording inherited credentials in the launcher.
		writeFileSync(launch, `#!/bin/sh\ncd ${quote(box.cwd)}\nexec env HOME=${quote(box.root)} PI_CODING_AGENT_DIR=${quote(box.agentDir)} PI_OFFLINE=1 PI_TELEMETRY=0 DELEGATE_SMOKE_ROOT=${quote(box.root)} ${args.map(quote).join(" ")}\n`, { mode: 0o700 });
		tmux("new-session", "-d", "-s", "pi", "-x", "110", "-y", "36", `sh ${quote(launch)}`);
		await expect(/FIXTURE-READY/);
		await command("/fixture-spawn Native detail");
		await expect(/Agents.*1 active/);
		text("PARENT-DRAFT"); key("C-j"); key("Enter");
		await expect(/^\s+OUTPUT-30\s*$/m); save(`${mode}-collapsed-live`);
		assert.doesNotMatch(capture(), /"command":|"path":/);
		assert.match(capture(), /earlier lines|more lines/);
		// Like Pi itself, regular mode leaves mouse handling to the terminal emulator.
		if (mode === "fullscreen") {
			mouse(0, capture().split("\n").findIndex((line) => /^\s+OUTPUT-30\s*$/.test(line)) + 1);
			await expect(/earlier lines/, true); save(`${mode}-mouse-expanded`);
		}
		key("C-o"); key("PPage"); await expect(/^\s+OUTPUT-(?:1|2)\s*$/m); save(`${mode}-expanded`);
		key("C-o"); key("C-End");
		text("CHILD-DRAFT"); key("Escape"); await expect(/PARENT-DRAFT/);
		key("C-j"); key("Enter"); await expect(/CHILD-DRAFT/); key("C-u");
		writeFileSync(release, "release");
		await expect(/Streaming line 35/); save(`${mode}-streaming-latest`);
		key("PPage"); await expect(/scroll paused/);
		finalGate.resolve(); await expect(/complete ·/);
		assert.doesNotMatch(capture(), /LATEST-END/); save(`${mode}-paused-after-complete`);
		key("C-End"); await expect(/LATEST-END/); save(`${mode}-latest`);
		key("NPage"); assert.match(capture(), /LATEST-END/);
		if (mode === "fullscreen") { mouse(64, 6); await expect(/scroll paused/); key("C-End"); }
		tmux("resize-window", "-t", "pi", "-x", "54", "-y", "20");
		await expect(/LATEST-END/); save(`${mode}-narrow`);
		key("Escape"); await expect(/PARENT-DRAFT/); await expect(/Agents.*active/, true);
		// A blocking join must be visible in the transcript, not a silently frozen parent.
		tmux("resize-window", "-t", "pi", "-x", "110", "-y", "36");
		const joinGate = deferred();
		api.script("Join a child", { tool: { name: "delegate", arguments: { role: "scout", context: "fresh", sync: true, model: "fixture/fixture:off", cwd: box.cwd, task: "Joined child\nReply JOINED-DONE." } } }, { text: "PARENT-SAW-RESULT" });
		api.script("Joined child\nReply JOINED-DONE.", { text: "JOINED-DONE", gate: joinGate });
		key("C-u"); await command("Join a child");
		await expect(/Waiting for a new scout/); await expect(/abort to stop waiting/);
		await expect(/parent blocked in wait/); save(`${mode}-waiting`);
		joinGate.resolve(); await expect(/PARENT-SAW-RESULT/);
		await expect(/Waiting for a new scout/, true); save(`${mode}-joined`);
		assert.equal(capture().match(/Joined child · scout/g)?.length, 1, "the outcome is recorded once, not reprinted");
		key("C-u"); await command("/agents"); await expect(/Finished agents/); key("Enter"); await expect(/LATEST-END/);
		api.script("Resume detail", { text: "**RESUMED-SAME-CHILD**" });
		await command("Resume detail"); await expect(/RESUMED-SAME-CHILD/); save(`${mode}-resumed`);
		api.script("Stop detail", { text: "STOP-LIVE", gate: deferred() });
		await command("Stop detail"); await expect(/STOP-LIVE/); key("C-x"); await expect(/Enter restart/);
		api.script("Restart detail", { text: "RESTARTED-SAME-CHILD" });
		await command("Restart detail"); await expect(/RESTARTED-SAME-CHILD/); save(`${mode}-restarted`);
		key("Escape"); await expect(/FIXTURE-READY/);
		await command("/reload"); await expect(/FIXTURE-READY/); await expect(/Agents.*active/, true);
		tmux("kill-session", "-t", "pi");
	}
	const events = readFileSync(join(box.root, "trace.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
	for (const launch of events.filter((e) => e.event === "launch")) {
		const outcomes = events.filter((e) => e.event === "complete" && e.details.id === launch.details.id);
		assert.deepEqual(outcomes.map((e) => e.details.segment), [1, 2, 3, 4]);
		assert.deepEqual(outcomes.map((e) => e.details.status), ["complete", "complete", "cancelled", "complete"]);
		assert.equal(new Set(outcomes.map((e) => e.details.sessionFile)).size, 1);
	}
	assert.deepEqual(api.errors, []);
	console.log(`PASS real Pi regular/fullscreen: native collapsed/expanded tools, streaming latest, paused scrolling, narrow resize, drafts, same-ID revival, hidden finished frame.\nEvidence: ${box.root}`);
} catch (error) {
	try { save("failure"); } catch { /* process may already have exited */ }
	console.error(`Evidence: ${box.root}`); throw error;
} finally {
	try { execFileSync("tmux", ["-L", socket, "kill-server"], { stdio: "ignore", timeout: 10000 }); } catch { /* no remaining fixture */ }
	await api.close();
}
