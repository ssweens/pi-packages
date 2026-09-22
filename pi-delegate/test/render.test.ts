import assert from "node:assert/strict";
import { test } from "node:test";
import { previewLines } from "../src/render.ts";

test("a control report previews its head and says how much it withheld", () => {
	const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
	const preview = previewLines(lines, 8);
	assert.deepEqual(preview.shown, lines.slice(0, 8), "the head is what these reports lead with");
	assert.equal(preview.hidden, 12);
	const short = previewLines(lines.slice(0, 5), 8);
	assert.deepEqual(short, { shown: lines.slice(0, 5), hidden: 0 }, "nothing is clipped, and no hint is owed");
	assert.deepEqual(previewLines([], 8), { shown: [], hidden: 0 });
});
