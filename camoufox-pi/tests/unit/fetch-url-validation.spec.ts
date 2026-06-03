import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

describe("CamoufoxClient.fetchUrl validation", () => {
	const launcher = () => makeFakeLauncher();
	const client = () => new CamoufoxClient({ launcher: launcher(), ssrfLookup: safeLookup });

	it("rejects empty selector string", async () => {
		const c = client();
		const p = c.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			selector: "",
		});
		await expect(p).rejects.toMatchObject({
			err: { type: "config_invalid", field: "selector" },
		});
		await c.close();
	});

	it("rejects selector exceeding 512 chars", async () => {
		const c = client();
		const p = c.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			selector: "a".repeat(513),
		});
		await expect(p).rejects.toMatchObject({
			err: { type: "config_invalid", field: "selector" },
		});
		await c.close();
	});

	it("rejects empty waitForSelector string", async () => {
		const c = client();
		const p = c.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			renderMode: "render-and-wait",
			waitForSelector: "",
		});
		await expect(p).rejects.toMatchObject({
			err: { type: "config_invalid", field: "waitForSelector" },
		});
		await c.close();
	});

	it("rejects screenshot.quality out of [1,100]", async () => {
		const c = client();
		const p = c.fetchUrl("https://x.test/", {
			signal: new AbortController().signal,
			screenshot: { format: "jpeg", quality: 0 },
		});
		await expect(p).rejects.toMatchObject({
			err: { type: "config_invalid", field: "screenshot.quality" },
		});
		await c.close();
	});
});
