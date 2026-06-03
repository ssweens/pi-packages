import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { googleAdapter } from "../../../src/search/adapters/google.js";
import { parseGoogleFixture } from "./_google-fixture-parser.js";

const typicalPath = fileURLToPath(
	new URL("../../fixtures/google-serp/typical.html", import.meta.url),
);
const zeroPath = fileURLToPath(
	new URL("../../fixtures/google-serp/zero-results.html", import.meta.url),
);
const clampPath = fileURLToPath(
	new URL("../../fixtures/google-serp/clamp-snippet.html", import.meta.url),
);
const typicalHtml = readFileSync(typicalPath, "utf8");
const zeroHtml = readFileSync(zeroPath, "utf8");
const clampHtml = readFileSync(clampPath, "utf8");

function fakePage(html: string) {
	return {
		async $$eval(
			selector: string,
			evaluator: (els: unknown[], maxResults: number) => unknown,
			maxResults: number,
		) {
			const elements = parseGoogleFixture(html, selector);
			return evaluator(elements as unknown[], maxResults);
		},
	};
}

describe("googleAdapter.parseResults", () => {
	it("parses typical SERP into 3 ranked RawResults", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: narrow stub
		const results = await googleAdapter.parseResults(fakePage(typicalHtml) as any, 10);
		expect(results).toHaveLength(3);
		expect(results[0]).toEqual({
			title: "Example A",
			url: "https://example.com/a",
			snippet: "Snippet about example A with some text.",
			rank: 1,
		});
		expect(results[2]?.rank).toBe(3);
	});

	it("respects maxResults cap", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: narrow stub
		const results = await googleAdapter.parseResults(fakePage(typicalHtml) as any, 2);
		expect(results).toHaveLength(2);
	});

	it("returns empty array for zero-results SERP", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: narrow stub
		const results = await googleAdapter.parseResults(fakePage(zeroHtml) as any, 10);
		expect(results).toEqual([]);
	});

	it("rejects non-http(s) URLs (defense-in-depth)", async () => {
		const adversarialHtml = `
<div id="search">
  <div>
    <div data-sokoban-container="r1">
      <div><a jsname="a1" href="javascript:alert(1)"><h3>bad</h3></a></div>
      <div data-sncf="1"><span>x</span></div>
    </div>
    <div data-sokoban-container="r2">
      <div><a jsname="a2" href="https://ok.example/p"><h3>good</h3></a></div>
      <div data-sncf="1"><span>y</span></div>
    </div>
  </div>
</div>`;
		// biome-ignore lint/suspicious/noExplicitAny: narrow stub
		const results = await googleAdapter.parseResults(fakePage(adversarialHtml) as any, 10);
		expect(results).toHaveLength(1);
		expect(results[0]?.url).toBe("https://ok.example/p");
	});

	it("falls back to -webkit-line-clamp snippet when data-sncf absent", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: narrow stub
		const results = await googleAdapter.parseResults(fakePage(clampHtml) as any, 10);
		expect(results).toHaveLength(2);
		expect(results[0]).toEqual({
			title: "Clamp A",
			url: "https://clamp.example/a",
			snippet: "Clamped snippet body A.",
			rank: 1,
		});
		expect(results[1]).toEqual({
			title: "Clamp B",
			url: "https://clamp.example/b",
			snippet: "Clamped snippet body B.",
			rank: 2,
		});
	});

	it("buildUrl encodes query properly with no extra params", () => {
		expect(googleAdapter.buildUrl("claude code")).toBe(
			"https://www.google.com/search?q=claude%20code",
		);
		expect(googleAdapter.buildUrl("a&b c")).toBe("https://www.google.com/search?q=a%26b%20c");
	});
});
