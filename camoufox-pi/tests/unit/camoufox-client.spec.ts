import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import { CamoufoxErrorBox } from "../../src/errors.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

describe("CamoufoxClient lifecycle", () => {
	it("starts not-alive, becomes alive after ensureReady", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher });
		expect(client.isAlive()).toBe(false);
		await client.ensureReady();
		expect(client.isAlive()).toBe(true);
		await client.close();
	});

	it("is idempotent: N concurrent ensureReady calls produce one launch", async () => {
		const launcher = makeFakeLauncher({ launchDelayMs: 20 });
		const client = new CamoufoxClient({ launcher });
		await Promise.all([client.ensureReady(), client.ensureReady(), client.ensureReady()]);
		expect(launcher.fake.launchCount).toBe(1);
		await client.close();
	});

	it("ensureReady after success resolves instantly without relaunching", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher });
		await client.ensureReady();
		await client.ensureReady();
		expect(launcher.fake.launchCount).toBe(1);
		await client.close();
	});

	it("close() twice is safe", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher });
		await client.ensureReady();
		await client.close();
		await client.close();
		expect(client.isAlive()).toBe(false);
	});

	it("isAlive() returns false after the browser disconnects", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher });
		await client.ensureReady();
		expect(client.isAlive()).toBe(true);
		launcher.fake.setConnected(false);
		expect(client.isAlive()).toBe(false);
		await client.close();
	});

	it("wraps a launch failure as browser_launch_failed (sticky)", async () => {
		const launcher = makeFakeLauncher({ launchFails: new Error("boot kaboom") });
		const client = new CamoufoxClient({ launcher });
		let first: unknown;
		try {
			await client.ensureReady();
		} catch (err) {
			first = err;
		}
		expect(first).toBeInstanceOf(CamoufoxErrorBox);
		const boxed = first as CamoufoxErrorBox;
		expect(boxed.err).toEqual({ type: "browser_launch_failed", stderr: "boot kaboom" });
		await expect(client.ensureReady()).rejects.toBeInstanceOf(CamoufoxErrorBox);
		expect(launcher.fake.launchCount).toBe(1);
	});

	it("aborted ensureReady signal rejects with aborted", async () => {
		const launcher = makeFakeLauncher({ launchDelayMs: 50 });
		const client = new CamoufoxClient({ launcher });
		const ctrl = new AbortController();
		const p = client.ensureReady(ctrl.signal);
		ctrl.abort();
		await expect(p).rejects.toMatchObject({ err: { type: "aborted" } });
	});

	it("close() during launching closes the freshly-launched browser", async () => {
		const launcher = makeFakeLauncher({ launchDelayMs: 30 });
		const client = new CamoufoxClient({ launcher });
		const readyPromise = client.ensureReady();
		await client.close();
		// ensureReady will resolve since close() did not abort it, but the state
		// stays "closed" and the freshly-launched browser is cleaned up.
		await readyPromise.catch(() => undefined);
		expect(client.isAlive()).toBe(false);
		// launchCount is 1 (the one we started). The fresh browser's close
		// registered on fake controls via browser.close() → controls.connected = false.
		expect(launcher.fake.launchCount).toBe(1);
		expect(launcher.fake.connected).toBe(false);
	});
});

describe("CamoufoxClient — span IDs", () => {
	it("mints a distinct spanId per fetchUrl op", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ status: 200, html: "<html></html>", finalUrl: "https://x.test/" }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const ids: string[] = [];
		client.events.on("fetch_url", (e) => ids.push(e.spanId));
		await client.fetchUrl("https://x.test/", { signal: new AbortController().signal });
		await client.fetchUrl("https://x.test/", { signal: new AbortController().signal });
		expect(ids).toHaveLength(2);
		expect(ids[0]).not.toBe(ids[1]);
	});

	it("browser_launch fires exactly once with a valid spanId across multiple ensureReady calls", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher });
		const launches: string[] = [];
		client.events.on("browser_launch", (e) => launches.push(e.spanId));
		await client.ensureReady();
		await client.ensureReady();
		await client.ensureReady();
		expect(launches).toHaveLength(1);
		expect(launches[0]).toMatch(/^[0-9a-f]{16}$/);
	});
});
