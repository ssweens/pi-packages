import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import type { LookupFn } from "../../src/security/ssrf.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

describe("CamoufoxClient.search", () => {
	it("returns structured results from the DDG adapter", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				finalUrl: "https://html.duckduckgo.com/html/?q=foo",
				evalResults: {
					"div.result, div.web-result": [
						{ title: "First", url: "https://one.test/", snippet: "the first" },
						{ title: "Second", url: "https://two.test/", snippet: "the second" },
					],
				},
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const res = await client.search("foo", {
			signal: new AbortController().signal,
			engine: "duckduckgo",
		});
		expect(res.engine).toBe("duckduckgo");
		expect(res.query).toBe("foo");
		expect(res.results).toEqual([
			{ title: "First", url: "https://one.test/", snippet: "the first", rank: 1 },
			{ title: "Second", url: "https://two.test/", snippet: "the second", rank: 2 },
		]);
		await client.close();
	});

	it("empty results returns { results: [] }, not an error", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				evalResults: { "div.result, div.web-result": [] },
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const res = await client.search("nothing", {
			signal: new AbortController().signal,
			engine: "duckduckgo",
		});
		expect(res.results).toEqual([]);
		await client.close();
	});

	it("rejects out-of-range maxResults as config_invalid", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const p = client.search("x", {
			signal: new AbortController().signal,
			maxResults: 0,
			engine: "duckduckgo",
		});
		await expect(p).rejects.toMatchObject({
			err: { type: "config_invalid", field: "maxResults" },
		});
		await client.close();
	});

	it("respects maxResults", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				evalResults: {
					"div.result, div.web-result": Array.from({ length: 5 }, (_, i) => ({
						title: `T${i}`,
						url: `https://t${i}.test/`,
						snippet: `s${i}`,
					})),
				},
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const res = await client.search("x", {
			signal: new AbortController().signal,
			maxResults: 2,
			engine: "duckduckgo",
		});
		expect(res.results.length).toBe(2);
		await client.close();
	});

	it("rejects isolate=true with config_invalid (per-call isolation no longer supported)", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const opts = {
			signal: new AbortController().signal,
			isolate: true,
		};
		// biome-ignore lint/suspicious/noExplicitAny: deliberately bypass type to test runtime guard
		const p = client.search("x", opts as any);
		await expect(p).rejects.toMatchObject({
			err: { type: "config_invalid", field: "isolate" },
		});
		await client.close();
	});

	it("rejects search URL that resolves to a private IP (SSRF)", async () => {
		const privateLookup = (async () => [{ address: "10.0.0.1", family: 4 }]) as unknown as LookupFn;
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher, ssrfLookup: privateLookup });
		await client.ensureReady();
		await expect(
			client.search("test", { signal: new AbortController().signal }),
		).rejects.toMatchObject({ err: { type: "ssrf_blocked", hop: "initial" } });
		await client.close();
	});
});
