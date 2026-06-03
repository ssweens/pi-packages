import TurndownService from "turndown";
import { describe, expect, it, vi } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

describe("CamoufoxClient.fetchUrl format: markdown", () => {
	it("returns markdown when format: markdown", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html><body><h1>Hello</h1></body></html>",
				finalUrl: "https://x.test/",
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const res = await client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			format: "markdown",
		});
		expect(res.markdown).toContain("# Hello");
		expect(res.html).toBeTypeOf("string"); // still present at client layer
		await client.close();
	});

	it("bytes/truncated describe the markdown body when format: markdown", async () => {
		const big = `<html><body>${"<p>hi</p>".repeat(2000)}</body></html>`;
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ status: 200, html: big, finalUrl: "https://x.test/" }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const res = await client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			format: "markdown",
			maxBytes: 1024,
		});
		expect(res.truncated).toBe(true);
		expect(res.bytes).toBeLessThanOrEqual(1024);
		// markdown body is what was capped
		expect(res.markdown).toBeDefined();
		expect((res.markdown as string).length).toBeLessThanOrEqual(1024);
		await client.close();
	});

	it("resolves relative links against final response URL", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: '<html><body><a href="/foo">go</a></body></html>',
				finalUrl: "https://redirected.test/path/",
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const res = await client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			format: "markdown",
		});
		expect(res.markdown).toContain("[go](https://redirected.test/foo)");
		await client.close();
	});

	it("sets format in event payload", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ status: 200, html: "<html></html>", finalUrl: "https://x.test/" }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		let captured: unknown = null;
		client.events.on("fetch_url", (e) => {
			captured = e;
		});
		await client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			format: "markdown",
		});
		expect(captured).toMatchObject({ format: "markdown" });
		await client.close();
	});

	it("maps turndown failures to config_invalid via the outer wrapper", async () => {
		const spy = vi.spyOn(TurndownService.prototype, "turndown").mockImplementation(() => {
			throw new Error("simulated turndown failure");
		});
		try {
			const launcher = makeFakeLauncher({
				pageBehavior: () => ({
					status: 200,
					html: "<p>x</p>",
					finalUrl: "https://x.test/",
				}),
			});
			const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
			const p = client.fetchUrl("https://x.test/", {
				signal: new AbortController().signal,
				format: "markdown",
			});
			await expect(p).rejects.toMatchObject({
				err: {
					type: "config_invalid",
					field: "markdown",
					reason: expect.stringContaining("markdown conversion failed"),
				},
			});
			await client.close();
		} finally {
			spy.mockRestore();
		}
	});
});
