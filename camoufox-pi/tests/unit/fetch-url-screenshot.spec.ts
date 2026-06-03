import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

describe("CamoufoxClient.fetchUrl screenshot", () => {
	it("returns screenshot with default png + viewport when screenshot:{}", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html></html>",
				finalUrl: "https://x.test/",
				screenshotBytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const res = await client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			screenshot: {},
		});
		expect(res.screenshot).toBeDefined();
		expect(res.screenshot?.mimeType).toBe("image/png");
		expect(res.screenshot?.bytes).toBe(4);
		await client.close();
	});

	it("returns jpeg when screenshot.format=jpeg", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html></html>",
				finalUrl: "https://x.test/",
				screenshotBytes: Buffer.from([0xff, 0xd8, 0xff]),
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const res = await client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			screenshot: { format: "jpeg", quality: 70 },
		});
		expect(res.screenshot?.mimeType).toBe("image/jpeg");
		await client.close();
	});

	it("rejects quality when format is png", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const p = client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			screenshot: { format: "png", quality: 80 },
		});
		await expect(p).rejects.toMatchObject({
			err: { type: "config_invalid", field: "screenshot.quality" },
		});
		await client.close();
	});

	it("rejects screenshot > 10 MiB decoded", async () => {
		const huge = Buffer.alloc(11 * 1024 * 1024);
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html></html>",
				finalUrl: "https://x.test/",
				screenshotBytes: huge,
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const p = client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			screenshot: { fullPage: true },
		});
		await expect(p).rejects.toMatchObject({
			err: {
				type: "config_invalid",
				field: "screenshot",
				reason: expect.stringContaining("10 MiB"),
			},
		});
		await client.close();
	});

	it("omits screenshot field when not requested", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ status: 200, html: "<html></html>", finalUrl: "https://x.test/" }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const res = await client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
		});
		expect(res.screenshot).toBeUndefined();
		await client.close();
	});

	it("sets screenshotBytes in the event", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html></html>",
				finalUrl: "https://x.test/",
				screenshotBytes: Buffer.from([1, 2, 3, 4, 5]),
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		let captured: unknown = null;
		client.events.on("fetch_url", (e) => {
			captured = e;
		});
		await client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			screenshot: {},
		});
		expect(captured).toMatchObject({ screenshotBytes: 5 });
		await client.close();
	});

	it("rejects full_page capture when document dimensions exceed caps", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html></html>",
				finalUrl: "https://x.test/",
				documentDimensions: { width: 2000, height: 40_000 }, // total > 50M pixels? 80M — yes
				screenshotBytes: Buffer.from("unused"),
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const p = client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			screenshot: { fullPage: true },
		});
		await expect(p).rejects.toMatchObject({
			err: {
				type: "config_invalid",
				field: "screenshot",
				reason: expect.stringContaining("exceed caps"),
			},
		});
		await client.close();
	});

	it("rejects full_page capture when a single axis exceeds cap", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html></html>",
				finalUrl: "https://x.test/",
				documentDimensions: { width: 20_000, height: 500 },
				screenshotBytes: Buffer.from("unused"),
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const p = client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			screenshot: { fullPage: true },
		});
		await expect(p).rejects.toMatchObject({
			err: { type: "config_invalid", field: "screenshot" },
		});
		await client.close();
	});

	it("maps raw Playwright TimeoutError from screenshot to timeout with phase: screenshot", async () => {
		const pwTimeout = Object.assign(new Error("Timeout 30000ms exceeded"), {
			name: "TimeoutError",
		});
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html></html>",
				finalUrl: "https://x.test/",
				screenshotBytes: pwTimeout,
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const p = client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			screenshot: {},
		});
		await expect(p).rejects.toMatchObject({
			err: { type: "timeout", phase: "screenshot" },
		});
		await client.close();
	});
});
