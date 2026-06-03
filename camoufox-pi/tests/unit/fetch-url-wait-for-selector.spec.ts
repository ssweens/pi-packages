import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

describe("CamoufoxClient.fetchUrl waitForSelector", () => {
	it("resolves when selector appears (render-and-wait + selector)", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html></html>",
				finalUrl: "https://x.test/",
				waitForSelectorBehavior: "resolve",
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const res = await client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			renderMode: "render-and-wait",
			waitForSelector: ".ready",
		});
		expect(res.status).toBe(200);
		await client.close();
	});

	it("rejects waitForSelector passed with renderMode='static'", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const p = client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			renderMode: "static",
			waitForSelector: ".ready",
		});
		await expect(p).rejects.toMatchObject({
			err: { type: "config_invalid", field: "waitForSelector" },
		});
		await client.close();
	});

	it("rejects waitForSelector passed with default renderMode (render)", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const p = client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			waitForSelector: ".ready",
		});
		await expect(p).rejects.toMatchObject({
			err: { type: "config_invalid", field: "waitForSelector" },
		});
		await client.close();
	});

	it("times out with phase: wait_for_selector when selector never visible", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html></html>",
				finalUrl: "https://x.test/",
				waitForSelectorBehavior: "never",
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const p = client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			timeoutMs: 1_000,
			renderMode: "render-and-wait",
			waitForSelector: ".never",
		});
		await expect(p).rejects.toMatchObject({
			err: { type: "timeout", phase: "wait_for_selector" },
		});
		await client.close();
	});

	it("sets usedWaitForSelector: true in the event", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html></html>",
				finalUrl: "https://x.test/",
				waitForSelectorBehavior: "resolve",
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		let captured: unknown = null;
		client.events.on("fetch_url", (e) => {
			captured = e;
		});
		await client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			renderMode: "render-and-wait",
			waitForSelector: ".ready",
		});
		expect(captured).toMatchObject({ usedWaitForSelector: true });
		await client.close();
	});
});
