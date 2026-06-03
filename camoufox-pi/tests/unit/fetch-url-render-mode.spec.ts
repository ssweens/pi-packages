import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

describe("CamoufoxClient.fetchUrl renderMode", () => {
	it("defaults to render → waitUntil: 'load'", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ status: 200, html: "<html></html>", finalUrl: "https://x.test/" }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		await client.fetchUrl("https://x.test/", { signal: new AbortController().signal });
		expect(launcher.fake.lastGotoWaitUntil).toBe("load");
		await client.close();
	});

	it("static → waitUntil: 'domcontentloaded'", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ status: 200, html: "<html></html>", finalUrl: "https://x.test/" }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		await client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			renderMode: "static",
		});
		expect(launcher.fake.lastGotoWaitUntil).toBe("domcontentloaded");
		await client.close();
	});

	it("render-and-wait → waitUntil: 'networkidle'", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ status: 200, html: "<html></html>", finalUrl: "https://x.test/" }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		await client.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			renderMode: "render-and-wait",
		});
		expect(launcher.fake.lastGotoWaitUntil).toBe("networkidle");
		await client.close();
	});

	it("emits renderMode in the fetch_url event", async () => {
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
			renderMode: "static",
		});
		expect(captured).toMatchObject({ renderMode: "static" });
		await client.close();
	});
});
