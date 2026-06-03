import { describe, expect, it, vi } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import type { BinaryDownloadProgressEvent, BrowserLaunchEvent } from "../../src/client/events.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

describe("CamoufoxClient — launch events", () => {
	it("emits browser_launch once after successful launch with a spanId", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher });
		const seen: BrowserLaunchEvent[] = [];
		client.events.on("browser_launch", (e) => seen.push(e));
		await client.ensureReady();
		expect(seen).toHaveLength(1);
		expect(seen[0]?.browserVersion).toBe("fake-0.0.0");
		expect(seen[0]?.spanId).toMatch(/^[0-9a-f]{16}$/);
		expect(seen[0]?.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("does not re-emit browser_launch on idempotent ensureReady", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher });
		const fn = vi.fn();
		client.events.on("browser_launch", fn);
		await client.ensureReady();
		await client.ensureReady();
		await client.ensureReady();
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("re-emits binary_download_progress events from the launcher in order", async () => {
		const events: BinaryDownloadProgressEvent[] = [
			{ bytesDownloaded: 10, bytesTotal: 100 },
			{ bytesDownloaded: 100, bytesTotal: 100 },
		];
		const launcher = makeFakeLauncher({ progressEvents: events });
		const client = new CamoufoxClient({ launcher });
		const seen: BinaryDownloadProgressEvent[] = [];
		client.events.on("binary_download_progress", (e) => seen.push(e));
		await client.ensureReady();
		expect(seen).toEqual(events);
	});

	it("emits error event before throw on launch failure", async () => {
		const boom = new Error("launch exploded");
		const launcher = makeFakeLauncher({ launchFails: boom });
		const client = new CamoufoxClient({ launcher });
		const errors: Array<{ op: string; type: string }> = [];
		client.events.on("error", (e) => errors.push({ op: e.op, type: e.error.type }));
		await expect(client.ensureReady()).rejects.toThrow();
		expect(errors).toEqual([{ op: "ensureReady", type: "browser_launch_failed" }]);
	});
});

describe("CamoufoxClient — operation events", () => {
	it("emits fetch_url with spanId on success", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ status: 200, html: "<html>ok</html>", finalUrl: "https://x.test/p" }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const events: Array<{ spanId: string; url: string; status: number }> = [];
		client.events.on("fetch_url", (e) =>
			events.push({ spanId: e.spanId, url: e.url, status: e.status }),
		);
		await client.fetchUrl("https://x.test/p", { signal: new AbortController().signal });
		expect(events).toHaveLength(1);
		expect(events[0]?.url).toBe("https://x.test/p");
		expect(events[0]?.status).toBe(200);
		expect(events[0]?.spanId).toMatch(/^[0-9a-f]{16}$/);
	});

	it("emits search with spanId, engine, resultCount", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				finalUrl: "https://html.duckduckgo.com/html/",
				evalResults: {
					"div.result, div.web-result": [
						{ title: "A", url: "https://a.test/", snippet: "s", rank: 1 },
						{ title: "B", url: "https://b.test/", snippet: "s", rank: 2 },
					],
				},
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const seen: Array<{ spanId: string; engine: string; resultCount: number }> = [];
		client.events.on("search", (e) =>
			seen.push({ spanId: e.spanId, engine: e.engine, resultCount: e.resultCount }),
		);
		await client.search("q", {
			signal: new AbortController().signal,
			maxResults: 10,
			engine: "duckduckgo",
		});
		expect(seen).toHaveLength(1);
		expect(seen[0]?.engine).toBe("duckduckgo");
		expect(seen[0]?.resultCount).toBe(2);
	});

	it("emits error BEFORE throw on fetchUrl failure", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ status: 500, finalUrl: "https://x.test/p" }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const order: string[] = [];
		client.events.on("error", (e) => order.push(`event:${e.op}:${e.error.type}`));
		await expect(
			client.fetchUrl("https://x.test/p", { signal: new AbortController().signal }).catch((err) => {
				order.push(`throw:${err?.err?.type}`);
				throw err;
			}),
		).rejects.toThrow();
		expect(order).toEqual(["event:fetchUrl:http", "throw:http"]);
	});

	it("error listener that throws does not mask the CamoufoxErrorBox", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ status: 500, finalUrl: "https://x.test/p" }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		client.events.on("error", () => {
			throw new Error("listener boom");
		});
		await expect(
			client.fetchUrl("https://x.test/p", { signal: new AbortController().signal }),
		).rejects.toMatchObject({ err: { type: "http" } });
		expect(errSpy).toHaveBeenCalled();
		errSpy.mockRestore();
	});
});
