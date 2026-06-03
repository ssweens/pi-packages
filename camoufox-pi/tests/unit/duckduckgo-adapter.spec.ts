import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { duckduckgoAdapter } from "../../src/search/adapters/duckduckgo.js";
import { parseDuckDuckGoFixture } from "./_ddg-fixture-parser.js";

const fixturePath = fileURLToPath(new URL("../fixtures/duckduckgo-results.html", import.meta.url));
const fixtureHtml = readFileSync(fixturePath, "utf8");

describe("duckduckgoAdapter.parseResults", () => {
	it("extracts well-formed results from the fixture", async () => {
		const fakePage = {
			async $$eval(
				selector: string,
				evaluator: (els: unknown[], maxResults: number) => unknown,
				maxResults: number,
			) {
				const elements = parseDuckDuckGoFixture(fixtureHtml, selector);
				return evaluator(elements as unknown[], maxResults);
			},
		};
		// biome-ignore lint/suspicious/noExplicitAny: deliberately narrow
		const results = await duckduckgoAdapter.parseResults(fakePage as any, 10);
		expect(results.length).toBeGreaterThan(0);
		expect(results.length).toBeLessThanOrEqual(10);
		for (const [i, r] of results.entries()) {
			expect(r.title).toBeTypeOf("string");
			expect(r.title.length).toBeGreaterThan(0);
			expect(r.url).toMatch(/^https?:\/\//);
			expect(r.snippet).toBeTypeOf("string");
			expect(r.rank).toBe(i + 1);
		}
		expect(results.length).toBeGreaterThanOrEqual(5);
		expect(results.some((r) => r.snippet.length > 0)).toBe(true);
	});

	it("respects maxResults", async () => {
		const fakePage = {
			async $$eval(
				selector: string,
				evaluator: (els: unknown[], maxResults: number) => unknown,
				maxResults: number,
			) {
				const elements = parseDuckDuckGoFixture(fixtureHtml, selector);
				return evaluator(elements as unknown[], maxResults);
			},
		};
		// biome-ignore lint/suspicious/noExplicitAny: deliberately narrow
		const results = await duckduckgoAdapter.parseResults(fakePage as any, 3);
		expect(results.length).toBeLessThanOrEqual(3);
	});

	it("builds the expected URL", () => {
		expect(duckduckgoAdapter.buildUrl("claude code")).toBe(
			"https://html.duckduckgo.com/html/?q=claude+code",
		);
		expect(duckduckgoAdapter.buildUrl("a&b c")).toBe("https://html.duckduckgo.com/html/?q=a%26b+c");
	});
});
