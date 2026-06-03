import TurndownService from "turndown";
import { describe, expect, it, vi } from "vitest";

import { MAX_MARKDOWN_INPUT_BYTES, htmlToMarkdown } from "../../src/client/fetch-pipeline.js";

const BASE = "https://example.test/docs/";

describe("htmlToMarkdown", () => {
	it("returns empty string for empty input", () => {
		expect(htmlToMarkdown("", BASE)).toBe("");
	});

	it("converts headings", () => {
		const md = htmlToMarkdown("<h1>Title</h1><h2>Sub</h2>", BASE);
		expect(md).toContain("# Title");
		expect(md).toContain("## Sub");
	});

	it("converts unordered and ordered lists", () => {
		const md = htmlToMarkdown("<ul><li>a</li><li>b</li></ul><ol><li>x</li><li>y</li></ol>", BASE);
		expect(md).toMatch(/[-*]\s+a/);
		expect(md).toMatch(/[-*]\s+b/);
		expect(md).toMatch(/1\.\s+x/);
		expect(md).toMatch(/2\.\s+y/);
	});

	it("resolves relative links to absolute using baseUrl", () => {
		const md = htmlToMarkdown('<a href="/foo">foo</a>', BASE);
		expect(md).toContain("[foo](https://example.test/foo)");
	});

	it("resolves dot-relative links against baseUrl path", () => {
		const md = htmlToMarkdown('<a href="./bar">bar</a>', BASE);
		expect(md).toContain("[bar](https://example.test/docs/bar)");
	});

	it("leaves absolute links untouched", () => {
		const md = htmlToMarkdown('<a href="https://other.test/x?q=1">x</a>', BASE);
		expect(md).toContain("[x](https://other.test/x?q=1)");
	});

	it("resolves relative image src", () => {
		const md = htmlToMarkdown('<img src="/img.png" alt="pic">', BASE);
		expect(md).toContain("![pic](https://example.test/img.png)");
	});

	it("strips <script> blocks", () => {
		const md = htmlToMarkdown("<p>hi</p><script>alert(1)</script>", BASE);
		expect(md).not.toContain("alert");
		expect(md).toContain("hi");
	});

	it("strips <style> blocks", () => {
		const md = htmlToMarkdown("<style>.x{}</style><p>body</p>", BASE);
		expect(md).not.toContain(".x{}");
		expect(md).toContain("body");
	});

	it("strips <noscript>, <svg>, <iframe>", () => {
		const html = "<p>ok</p><noscript>ns</noscript><svg><rect/></svg><iframe src='x'></iframe>";
		const md = htmlToMarkdown(html, BASE);
		expect(md).toContain("ok");
		expect(md).not.toContain("ns");
		expect(md).not.toContain("<svg");
		expect(md).not.toContain("<iframe");
	});

	it("strips HTML comments", () => {
		const md = htmlToMarkdown("<p>keep</p><!-- secret -->", BASE);
		expect(md).toContain("keep");
		expect(md).not.toContain("secret");
	});

	it("preserves fenced code blocks", () => {
		const md = htmlToMarkdown("<pre><code>x = 1</code></pre>", BASE);
		expect(md).toContain("x = 1");
	});

	it("preserves inline code", () => {
		const md = htmlToMarkdown("<p>Use <code>fetch()</code></p>", BASE);
		expect(md).toContain("`fetch()`");
	});

	it("converts simple tables", () => {
		const html = "<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>";
		const md = htmlToMarkdown(html, BASE);
		expect(md).toContain("a");
		expect(md).toContain("1");
		expect(md).toContain("2");
	});

	it("handles malformed HTML without throwing", () => {
		expect(() => htmlToMarkdown("<p>unclosed", BASE)).not.toThrow();
	});

	it("preserves query strings when absolutizing", () => {
		const md = htmlToMarkdown('<a href="/x?y=1&z=2">L</a>', BASE);
		expect(md).toContain("[L](https://example.test/x?y=1&z=2)");
	});

	it("truncates input exceeding MAX_MARKDOWN_INPUT_BYTES before passing to turndown", () => {
		// Verify via a turndown spy so we don't have to run the real parser on
		// a 16+ MiB blob (slow). The spy captures the truncated string handed
		// to turndown and the test asserts its byte length stays under the cap.
		let receivedByteLength = -1;
		const spy = vi
			.spyOn(TurndownService.prototype, "turndown")
			.mockImplementation((input: string): string => {
				receivedByteLength = Buffer.byteLength(input, "utf8");
				return "mock-md";
			});
		try {
			const huge = "x".repeat(MAX_MARKDOWN_INPUT_BYTES + 100);
			htmlToMarkdown(huge, BASE);
			expect(receivedByteLength).toBeGreaterThan(0);
			expect(receivedByteLength).toBeLessThanOrEqual(MAX_MARKDOWN_INPUT_BYTES);
		} finally {
			spy.mockRestore();
		}
	});
});
