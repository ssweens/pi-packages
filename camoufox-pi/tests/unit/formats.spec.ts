import "../../src/tools/formats.js";
import { FormatRegistry } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

describe("uri format", () => {
	const check = (v: unknown): boolean => FormatRegistry.Get("uri")?.(v as string) ?? false;

	it("accepts http and https URLs", () => {
		expect(check("https://example.com")).toBe(true);
		expect(check("http://example.com/path?q=1")).toBe(true);
		expect(check("https://example.com:8443/a/b?x=y#z")).toBe(true);
	});

	it("rejects non-http(s) schemes", () => {
		expect(check("file:///etc/passwd")).toBe(false);
		expect(check("javascript:alert(1)")).toBe(false);
		expect(check("data:text/html,<script>")).toBe(false);
		expect(check("chrome://settings")).toBe(false);
		expect(check("ftp://x.test")).toBe(false);
	});

	it("rejects bare strings and malformed URLs", () => {
		expect(check("not-a-url")).toBe(false);
		expect(check("")).toBe(false);
		expect(check("http//missing-colon.example")).toBe(false);
	});
});
