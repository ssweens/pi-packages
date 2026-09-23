import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";

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

const modelRow = (key: string, extra: any = {}) => ({ key, current: false, reasoning: true, contextWindow: 262144, cost: { input: 0.1, output: 0.3 }, ...extra });
const models = (rows: any[], extra: any = {}) => ({
	content: [{ type: "text", text: "DEFAULTS (approved by user)\nOPENROUTER: 454 live\n\nCATALOG: 998 offerings\n\nOFFERINGS model text" }],
	details: {
		kind: "models", filter: "step", total: 998, matched: rows.length, unratedHidden: 0, rows,
		// The catalog from the terminal that crashed at 40 columns.
		providers: Object.entries({ openrouter: 387, "local-llm": 139, huggingface: 76, opencode: 73, vertex: 52, "local-dgx": 31, "opencode-go": 30, clinepass: 25, omlx: 24, "github-copilot": 22, "qwen-token-plan": 20, anthropic: 15, "anthropic-2": 15, "google-vertex": 14, "corral-local": 14, "qwen-token-plan-individual": 9, "openai-codex": 8, zai: 7 }),
		defaults: { approved: [{ role: "scout", spec: "vendor/luna", ageDays: 1, reason: "flat-rate recon" }], drift: ["scout: price changed $1/2 → $2/4/M"] },
		ratings: "none", openrouter: { summary: "454 live, 188 with AA, fetched 0s ago (06:53Z)", error: false },
		liveOnly: { count: 1, rows: [{ id: "stepfun/step-5-preview", price: "$0.3/1.2/M" }] },
		...extra,
	},
});
const modelLines = (result: any, expanded = false, width = 110) => resultView("delegate_ctl", "models", '"step"', result, { expanded }, theme, width);

// Field report: the collapsed report was eight lines of preamble, and not one offering.
test("a models report previews offerings as an aligned table, not the model's text", () => {
	const rows = [
		modelRow("local-llm/stepfun-ai/Step-3.7-Flash-IQ3_XS", { reasoning: false, cost: { input: 0, output: 0 } }),
		modelRow("openrouter/stepfun/step-3.7-flash", { current: true, live: { listed: true, tiered: false, notes: ["live now $0.16/0.92/M (registry differs)"], livePrice: "$0.16/0.92/M", aa: { coding: 39.6 }, endpoints: ["SiliconFlow [siliconflow/fp8]  $0.1/0.3/M  fp8"] } }),
		...Array.from({ length: 6 }, (_, i) => modelRow(`vendor/step-${i}`)),
	];
	const lines = modelLines(models(rows));
	const flat = lines.join("\n");
	assert.match(lines[0], /delegate_ctl models "step"\s+8 of 998 offerings/);
	assert.match(flat, /defaults scout → vendor\/luna · 1 change since approval/);
	assert.doesNotMatch(flat, /DEFAULTS|OPENROUTER|CATALOG/, "the model's text is not the human's view");
	assert.match(flat, /local-llm\/stepfun-ai\/Step-3\.7-Flash-IQ3_XS\s+262k\s+\$0\/0\s+no reasoning/);
	assert.match(flat, /openrouter\/stepfun\/step-3\.7-flash\s+262k\s+\$0\.1\/0\.3\s+39\.6\s+current · live \$0\.16\/0\.92\/M/, "exceptions are named on the row");
	assert.match(flat, /vendor\/step-3/);
	assert.doesNotMatch(flat, /vendor\/step-4/, "six rows in the preview");
	assert.match(flat, /… 2 more · 1 on OpenRouter but not in your registry,/);
	assert.doesNotMatch(flat, /SiliconFlow/, "endpoints wait for the expand");
	const table = lines.filter((l) => /\d+k /.test(l));
	assert.equal(new Set(table.map((l) => l.indexOf("262k"))).size, 1, "columns line up");

	const expanded = modelLines(models(rows), true);
	const all = expanded.join("\n");
	assert.match(all, /vendor\/step-5/);
	assert.match(all, /↳ SiliconFlow \[siliconflow\/fp8\]/);
	assert.match(all, /live now \$0\.16\/0\.92\/M \(registry differs\)/);
	assert.match(all, /drift\s+scout: price changed/);
	assert.match(all, /flat-rate recon/);
	assert.match(all, /stepfun\/step-5-preview\s+\$0\.3\/1\.2\/M/);
	for (const line of expanded.filter((l) => /anthropic|qwen/.test(l))) {
		assert.doesNotMatch(line, /(anthropic|qwen-token-plan-individual)(\s·)?$/, `a provider keeps its count on its line: ${line}`);
	}
	// Pi exits on a line wider than the terminal; the providers list once overflowed at 40.
	for (const width of [110, 54, 40]) {
		for (const view of [modelLines(models(rows), false, width), modelLines(models(rows), true, width)]) {
			for (const line of view) assert.ok(visibleWidth(line) <= width, `overflows ${width} columns: ${JSON.stringify(line)}`);
		}
		// The clamp keeps Pi alive; the list must still fit on its own, breaking only between entries.
		const view = modelLines(models(rows), true, width);
		const providers = view.slice(view.findIndex((l) => /^\s+providers/.test(l)));
		for (const line of providers.slice(0, -1)) assert.match(line, / ·$/, `providers break between entries at ${width}: ${JSON.stringify(line)}`);
	}
});

test("a models record without usable details renders its text", () => {
	const text = { content: [{ type: "text", text: "OFFERINGS legacy text" }] };
	for (const details of [undefined, { kind: "models" }, { kind: "models", rows: [{}] }, models([modelRow("a/b", { live: { listed: true, notes: "oops" } })]).details]) {
		assert.match(modelLines({ ...text, details }).join(" "), /OFFERINGS legacy text/, `falls back for ${JSON.stringify(details)?.slice(0, 60)}`);
	}
	assert.match(modelLines(models([])).join(" "), /no registry offering matches "step"/);
});
