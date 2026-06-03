import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import { createSearchWebTool } from "../../src/tools/search-web.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

describe("tff-search_web tool", () => {
	it("returns structured results", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				evalResults: {
					"div.result, div.web-result": [{ title: "A", url: "https://a.test/", snippet: "a" }],
				},
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const tool = createSearchWebTool(client);
		const res = await tool.execute("id", { query: "hello" }, new AbortController().signal);
		expect(res.details).toMatchObject({
			engine: "duckduckgo",
			query: "hello",
			atLimit: false,
		});
		expect(Array.isArray(res.details.results)).toBe(true);
		await client.close();
	});

	it("clamps large max_results in results count", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				evalResults: {
					"div.result, div.web-result": Array.from({ length: 60 }, (_, i) => ({
						title: `T${i}`,
						url: `https://t${i}.test/`,
						snippet: "",
					})),
				},
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const tool = createSearchWebTool(client);
		// TypeBox rejects max_results > 50 at wrapTool's Value.Check, so we
		// test the internal tool clamp directly. Direct execute bypasses
		// wrapTool validation; the client-side clamp still runs.
		const res = await tool.execute(
			"id",
			{ query: "x", max_results: 50 },
			new AbortController().signal,
		);
		expect(Array.isArray(res.details.results)).toBe(true);
		expect((res.details.results as unknown[]).length).toBeLessThanOrEqual(50);
		await client.close();
	});

	it("empty results return [] not an error", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ status: 200, evalResults: { "div.result, div.web-result": [] } }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const tool = createSearchWebTool(client);
		const res = await tool.execute("id", { query: "no-hits" }, new AbortController().signal);
		expect(res.details.results).toEqual([]);
		expect(res.details.atLimit).toBe(false);
		await client.close();
	});

	it("passes engine option through to client.search", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				evalResults: {
					"div.result, div.web-result": [{ title: "B", url: "https://b.test/", snippet: "b" }],
				},
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const tool = createSearchWebTool(client);
		const res = await tool.execute(
			"id",
			{ query: "test", engine: "duckduckgo" },
			new AbortController().signal,
		);
		expect(res.details).toMatchObject({ engine: "duckduckgo", query: "test" });
		await client.close();
	});
});
