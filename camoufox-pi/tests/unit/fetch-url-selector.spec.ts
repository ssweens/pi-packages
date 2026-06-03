import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

describe("CamoufoxClient.fetchUrl selector", () => {
	it("returns full document when selector is omitted", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html><body><article>A</article><p>outside</p></body></html>",
				finalUrl: "https://x.test/",
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const res = await client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
		});
		expect(res.html).toContain("<article>A</article>");
		expect(res.html).toContain("outside");
		await client.close();
	});

	it("returns only the sliced outerHTML when selector matches", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html></html>",
				finalUrl: "https://x.test/",
				selectorMatchHtml: { article: "<article>A</article>" },
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const res = await client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			selector: "article",
		});
		expect(res.html).toBe("<article>A</article>");
		await client.close();
	});

	it("throws config_invalid when selector matches nothing", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html></html>",
				finalUrl: "https://x.test/",
				selectorMatchHtml: { ".none": null },
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const p = client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			selector: ".none",
		});
		await expect(p).rejects.toMatchObject({
			err: { type: "config_invalid", field: "selector", reason: "no element matched" },
		});
		await client.close();
	});

	it("sets usedSelector: true in the event on match", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html></html>",
				finalUrl: "https://x.test/",
				selectorMatchHtml: { article: "<article>X</article>" },
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		let captured: unknown = null;
		client.events.on("fetch_url", (e) => {
			captured = e;
		});
		await client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			selector: "article",
		});
		expect(captured).toMatchObject({ usedSelector: true });
		await client.close();
	});
});
