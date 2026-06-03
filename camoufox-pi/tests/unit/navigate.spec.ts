import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import { CamoufoxErrorBox } from "../../src/errors.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

describe("CamoufoxClient.fetchUrl", () => {
	it("returns { html, status, finalUrl } on 200", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html><body>hi</body></html>",
				finalUrl: "https://example.test/final",
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const result = await client.fetchUrl("https://example.test/", {
			signal: new AbortController().signal,
		});
		expect(result.status).toBe(200);
		expect(result.html).toContain("hi");
		expect(result.finalUrl).toBe("https://example.test/final");
		expect(launcher.fake.pagesOpened).toBe(1);
		expect(launcher.fake.pagesClosed).toBe(1);
		await client.close();
	});

	it("throws http for 4xx/5xx", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ status: 404, finalUrl: "https://x.test/" }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const p = client.fetchUrl("https://x.test/", { signal: new AbortController().signal });
		await expect(p).rejects.toMatchObject({
			err: { type: "http", status: 404, url: "https://x.test/" },
		});
		expect(launcher.fake.pagesClosed).toBe(1);
		await client.close();
	});

	it("throws network on net:: errors", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ gotoError: new Error("net::ERR_NAME_NOT_RESOLVED") }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const p = client.fetchUrl("https://nope.test/", { signal: new AbortController().signal });
		await expect(p).rejects.toMatchObject({
			err: { type: "network", url: "https://nope.test/" },
		});
		expect(launcher.fake.pagesClosed).toBe(1);
		await client.close();
	});

	it("throws network on null response from goto", async () => {
		const launcher = makeFakeLauncher({ pageBehavior: () => ({ nullResponse: true }) });
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const p = client.fetchUrl("https://x.test/", { signal: new AbortController().signal });
		await expect(p).rejects.toMatchObject({ err: { type: "network" } });
		expect(launcher.fake.pagesClosed).toBe(1);
		await client.close();
	});

	it("throws timeout when Playwright TimeoutError fires", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				gotoError: Object.assign(new Error("Timeout 100ms exceeded"), {
					name: "TimeoutError",
				}),
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const p = client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			timeoutMs: 1_000,
		});
		await expect(p).rejects.toMatchObject({ err: { type: "timeout", phase: "nav" } });
		expect(launcher.fake.pagesClosed).toBe(1);
		await client.close();
	});

	it("throws aborted when the external signal aborts mid-goto", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ gotoDelayMs: 100, status: 200, html: "<html></html>" }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const ctrl = new AbortController();
		const p = client.fetchUrl("https://x.test/", { signal: ctrl.signal });
		ctrl.abort();
		await expect(p).rejects.toMatchObject({ err: { type: "aborted" } });
		await client.close();
	});

	it("throws playwright_disconnected when browser is gone before the call", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		await client.ensureReady();
		launcher.fake.setConnected(false);
		const p = client.fetchUrl("https://x.test/", { signal: new AbortController().signal });
		await expect(p).rejects.toBeInstanceOf(CamoufoxErrorBox);
		await expect(p).rejects.toMatchObject({ err: { type: "playwright_disconnected" } });
		await client.close();
	});

	it("maps abort during page.content() to aborted (post-goto abort)", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				finalUrl: "https://x.test/",
				html: "<html></html>",
				contentDelayMs: 50,
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const ctrl = new AbortController();
		const p = client.fetchUrl("https://x.test/", { signal: ctrl.signal });
		// Abort after goto has resolved but while content() is still pending.
		setTimeout(() => ctrl.abort(), 10);
		await expect(p).rejects.toBeInstanceOf(CamoufoxErrorBox);
		await expect(p).rejects.toMatchObject({ err: { type: "aborted" } });
		await client.close();
	});

	it("closes the page on both success and failure paths", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ status: 500, finalUrl: "https://x.test/" }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		await client
			.fetchUrl("https://x.test/", { signal: new AbortController().signal })
			.catch(() => undefined);
		expect(launcher.fake.pagesOpened).toBe(1);
		expect(launcher.fake.pagesClosed).toBe(1);
		await client.close();
	});
});
