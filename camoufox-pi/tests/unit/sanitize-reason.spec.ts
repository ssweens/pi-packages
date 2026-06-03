import { describe, expect, it } from "vitest";

import { sanitizeReason } from "../../src/errors.js";

describe("sanitizeReason", () => {
	it("strips unix absolute paths", () => {
		const out = sanitizeReason(
			"markdown conversion failed at /Users/alice/node_modules/turndown/src/index.js:42",
		);
		expect(out).not.toContain("/Users/alice");
		expect(out).not.toContain("/node_modules/turndown/src/index.js");
		expect(out).toContain("[path]");
	});

	it("strips file:// URIs", () => {
		const out = sanitizeReason("error from file:///home/user/secret.txt during parse");
		expect(out).not.toContain("file://");
		expect(out).not.toContain("/home/user/secret.txt");
		expect(out).toContain("[file]");
	});

	it("strips windows paths", () => {
		const out = sanitizeReason("failed at C:\\Users\\alice\\Projects\\secret\\file.ts");
		expect(out).not.toContain("C:\\Users\\alice");
		expect(out).toContain("[path]");
	});

	it("truncates long messages", () => {
		const input = `failure ${"x".repeat(500)} at end`;
		const out = sanitizeReason(input, 50);
		expect(out.length).toBeLessThanOrEqual(51); // +1 for ellipsis
		expect(out.endsWith("…")).toBe(true);
	});

	it("leaves short non-path messages untouched", () => {
		expect(sanitizeReason("simple error")).toBe("simple error");
	});

	it("does not strip package names like @scope/pkg", () => {
		expect(sanitizeReason("load failed for @mariozechner/pi-ai")).toContain("@mariozechner/pi-ai");
	});
});
