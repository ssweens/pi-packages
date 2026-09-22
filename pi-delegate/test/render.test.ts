import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// keyHint resolves real keybindings on first use; keep that away from this machine's config.
process.env.HOME = mkdtempSync(join(tmpdir(), "pi-delegate-render-"));
process.env.PI_CODING_AGENT_DIR = join(process.env.HOME, "agent");
// keyHint styles through the real theme singleton, which the app initializes at startup.
const { initTheme } = await import("@earendil-works/pi-coding-agent");
initTheme();
const { previewLines, resultView } = await import("../src/render.ts");

const theme: any = { fg: (_color: string, text: string) => text, bold: (text: string) => text, italic: (text: string) => text, bg: (_color: string, text: string) => text };
// Flattened, since assertions about phrases must survive ordinary line wrapping.
const render = (result: any, opts: { expanded?: boolean } = {}, action?: string) =>
	resultView("delegate_ctl", action, "scout", result, opts, theme, 80).join(" ").replace(/\s+/g, " ");

test("a control report previews its head and says how much it withheld", () => {
	const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
	const preview = previewLines(lines, 8);
	assert.deepEqual(preview.shown, lines.slice(0, 8), "the head is what these reports lead with");
	assert.equal(preview.hidden, 12);
	const short = previewLines(lines.slice(0, 5), 8);
	assert.deepEqual(short, { shown: lines.slice(0, 5), hidden: 0 }, "nothing is clipped, and no hint is owed");
	assert.deepEqual(previewLines([], 8), { shown: [], hidden: 0 });
});

// A crash reproduced from a live session: /reload re-renders records written by earlier versions,
// and a renderer that trusts today's details shape takes the whole app down on them.
test("a roles record written before the tools column still renders, from its text", () => {
	const legacy = {
		content: [{ type: "text", text: "scout  [fresh:low]  default: none — needs approval  Read-only recon of code the parent has not seen.  (~/roles/scout.md)" }],
		details: { kind: "roles", rows: [{ name: "scout", mode: "fresh:low", model: "needs approval", description: "Read-only recon of code the parent has not seen.", source: "~/roles/scout.md" }] },
	};
	const collapsed = render(legacy);
	assert.match(collapsed, /Read-only recon of code the parent has not seen/, "the text path is complete by construction");
	assert.match(render(legacy, { expanded: true }), /Read-only recon of code/);

	for (const rows of [[{}], "oops", [null], [{ name: "scout" }], undefined]) {
		const lines = render({ content: [{ type: "text", text: "unchanged text" }], details: { kind: "roles", rows } });
		assert.match(lines, /unchanged text/, `unusable rows (${JSON.stringify(rows)}) fall back to the text`);
	}
});

test("a current roles record renders as a table, with the prose behind the expand", () => {
	const current = {
		content: [{ type: "text", text: "scout  [fresh:low]  no default: needs approval  Read-only recon" }],
		details: { kind: "roles", rows: [
			{ name: "scout", mode: "fresh:low", model: "needs approval", approved: false, writes: false, tools: ["read", "grep", "find", "ls", "bash"], dropped: [], timeoutMs: undefined, description: "Read-only recon of code the parent has not seen.", source: "~/roles/scout.md" },
			{ name: "worker", mode: "fork:medium", model: "needs approval", approved: false, writes: true, tools: ["read", "bash", "edit", "write", "grep", "find", "ls"], dropped: ["playwright"], timeoutMs: 1800000, description: "Implements a bounded change.", source: "~/roles/worker.md" },
		] },
	};
	const collapsed = render(current);
	assert.match(collapsed, /scout\s+fresh:low\s+needs approval\s+read-only · 5 tools/);
	assert.match(collapsed, /worker\s+fork:medium\s+needs approval\s+writes · 7 tools · 30m · 1 unavailable/);
	assert.doesNotMatch(collapsed, /Read-only recon of code/, "no row ends mid-sentence");
	assert.match(collapsed, /what each role is for, and where it comes from/);

	const expanded = render(current, { expanded: true });
	assert.match(expanded, /Read-only recon of code the parent has not seen\./);
	assert.match(expanded, /scout\s+read grep find ls bash/);
	assert.match(expanded, /~\/roles\/scout\.md/);
});

test("child rows tolerate records missing later fields", () => {
	const runs = {
		content: [{ type: "text", text: "stored text" }],
		details: { kind: "runs", rows: [{ id: "worker-1", status: "complete", task: "Migrate schema", role: "worker" }] },
	};
	assert.match(render(runs), /Migrate schema/, "rows without cost, files or attempt counts still render");

	const outcome = {
		content: [{ type: "text", text: "report text" }],
		details: { id: "worker-2", status: "complete", task: "Fix loader", role: "worker", model: "vendor/x", output: "report text", turns: 2, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: undefined, durationMs: 1000, revision: 1 },
	};
	assert.match(render(outcome), /Fix loader/);
	const expanded = render(outcome, { expanded: true });
	assert.match(expanded, /report text/);
	assert.match(expanded, /worker-2/);
});
