import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import type { FetchUrlEvent } from "../../src/client/events.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

describe("FetchUrlEvent payload extensions", () => {
	it("includes renderMode, usedWaitForSelector, usedSelector, format, screenshotBytes", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ status: 200, html: "<html></html>", finalUrl: "https://x.test/" }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const events: FetchUrlEvent[] = [];
		client.events.on("fetch_url", (e) => events.push(e));
		await client.fetchUrl("https://x.test/", { signal: new AbortController().signal });
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			renderMode: "render",
			usedWaitForSelector: false,
			usedSelector: false,
			format: "html",
			screenshotBytes: null,
		});
		await client.close();
	});
});
