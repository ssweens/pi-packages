import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

describe("CamoufoxClient.checkHealth — snapshot mode", () => {
	it("reports launching before launch resolves", async () => {
		const launcher = makeFakeLauncher({ launchDelayMs: 50 });
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const inflight = client.ensureReady();
		const h = await client.checkHealth();
		expect(h.status).toBe("launching");
		expect(h.browserConnected).toBe(false);
		expect(h.browserVersion).toBeNull();
		expect(h.launchedAt).toBeNull();
		expect(h.uptimeMs).toBeNull();
		expect(h.lastError).toBeNull();
		expect(h.probe).toBeUndefined();
		await inflight;
	});

	it("reports ready after successful launch", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		await client.ensureReady();
		const h = await client.checkHealth();
		expect(h.status).toBe("ready");
		expect(h.browserConnected).toBe(true);
		expect(h.browserVersion).toBe("fake-0.0.0");
		expect(h.launchedAt).toBeGreaterThan(0);
		expect(h.uptimeMs).toBeGreaterThanOrEqual(0);
		expect(h.lastError).toBeNull();
		expect(h.probe).toBeUndefined();
	});

	it("reports failed with lastError when launch fails", async () => {
		const boom = new Error("no binary");
		const launcher = makeFakeLauncher({ launchFails: boom });
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		await expect(client.ensureReady()).rejects.toThrow();
		const h = await client.checkHealth();
		expect(h.status).toBe("failed");
		expect(h.lastError).toEqual({ type: "browser_launch_failed", stderr: "no binary" });
		expect(h.browserConnected).toBe(false);
	});

	it("reports closed after close()", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		await client.ensureReady();
		await client.close();
		const h = await client.checkHealth();
		expect(h.status).toBe("closed");
		expect(h.browserConnected).toBe(false);
	});

	it("reports browserConnected=false when browser disconnects while status is ready", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		await client.ensureReady();
		launcher.fake.setConnected(false);
		const h = await client.checkHealth();
		expect(h.status).toBe("ready");
		expect(h.browserConnected).toBe(false);
	});
});

describe("CamoufoxClient.checkHealth — probe mode", () => {
	it("returns probe.ok=true and roundTripMs when about:blank succeeds", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: (url) => {
				if (url === "about:blank") return { status: 200 };
				return { status: 200 };
			},
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		await client.ensureReady();
		const h = await client.checkHealth({ probe: true });
		expect(h.probe).toBeDefined();
		expect(h.probe?.ok).toBe(true);
		expect(h.probe?.error).toBeNull();
		expect(h.probe?.roundTripMs).toBeGreaterThanOrEqual(0);
	});

	it("returns probe.ok=false without mutating status when probe fails", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ gotoError: new Error("net::ERR_CONNECTION_REFUSED") }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		await client.ensureReady();
		const h = await client.checkHealth({ probe: true });
		expect(h.status).toBe("ready");
		expect(h.probe?.ok).toBe(false);
		expect(h.probe?.error?.type).toBe("network");
	});

	it("returns probe with playwright_disconnected when client is not ready", async () => {
		const launcher = makeFakeLauncher({ launchFails: new Error("x") });
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		await expect(client.ensureReady()).rejects.toThrow();
		const h = await client.checkHealth({ probe: true });
		expect(h.status).toBe("failed");
		expect(h.probe?.ok).toBe(false);
		expect(h.probe?.error?.type).toBe("playwright_disconnected");
	});
});
