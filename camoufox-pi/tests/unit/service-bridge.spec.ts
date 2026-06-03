import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { CamoufoxService, type PiAttachable } from "../../src/services/camoufox-service.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

function makeStubPi() {
	const bus = new EventEmitter();
	const piEmit = vi.fn((event: string, payload: unknown) => {
		bus.emit(event, payload);
		return true;
	});
	const onSession: Record<string, (e: unknown, ctx: unknown) => unknown | Promise<unknown>> = {};
	const setStatus = vi.fn();
	const notify = vi.fn();
	const pi: PiAttachable = {
		on(event, handler) {
			onSession[event] = handler;
		},
		events: { emit: piEmit },
		ui: { setStatus, notify },
		cwd: "/tmp/pi-test",
	};
	return { pi, bus, piEmit, setStatus, notify, onSession };
}

describe("CamoufoxService.attach — event bridge", () => {
	it("forwards all 5 client events to pi.events with camoufox: prefix", async () => {
		const { pi, piEmit } = makeStubPi();
		const service = new CamoufoxService({
			launcher: makeFakeLauncher({
				pageBehavior: () => ({ status: 200, html: "<html></html>", finalUrl: "https://x.test/" }),
			}),
			ssrfLookup: safeLookup,
		});
		service.attach(pi);
		// Manually emit binary_download_progress — attach wires listeners synchronously,
		// so any event emitted after attach() is forwarded regardless of launch timing.
		service.client.events.emit("binary_download_progress", { bytesDownloaded: 1, bytesTotal: 2 });
		await service.client.ensureReady();
		await service.client.fetchUrl("https://x.test/", { signal: new AbortController().signal });
		const calledEvents = piEmit.mock.calls.map((c) => c[0]);
		expect(calledEvents).toContain("camoufox:browser_launch");
		expect(calledEvents).toContain("camoufox:fetch_url");
		expect(calledEvents).toContain("camoufox:binary_download_progress");
		// Emit search + error directly to trigger their forwarders without
		// re-triggering full op paths.
		service.client.events.emit("search", {
			spanId: "00000000",
			engine: "duckduckgo",
			query: "q",
			maxResults: 10,
			durationMs: 0,
			resultCount: 0,
			atLimit: false,
		});
		service.client.events.emit("error", {
			spanId: "00000000",
			op: "fetchUrl",
			error: { type: "aborted" },
		});
		const allEvents = piEmit.mock.calls.map((c) => c[0]);
		expect(allEvents).toContain("camoufox:search");
		expect(allEvents).toContain("camoufox:error");
	});

	it("forwards error event on op failure", async () => {
		const { pi, piEmit } = makeStubPi();
		const service = new CamoufoxService({
			launcher: makeFakeLauncher({
				pageBehavior: () => ({ status: 500, finalUrl: "https://x.test/" }),
			}),
			ssrfLookup: safeLookup,
		});
		service.attach(pi);
		await expect(
			service.client.fetchUrl("https://x.test/", { signal: new AbortController().signal }),
		).rejects.toThrow();
		const names = piEmit.mock.calls.map((c) => c[0]);
		expect(names).toContain("camoufox:error");
	});

	it("shutdown() detaches bridges — events after shutdown not forwarded", async () => {
		const { pi, piEmit } = makeStubPi();
		const service = new CamoufoxService({ launcher: makeFakeLauncher() });
		service.attach(pi);
		await service.client.ensureReady();
		await service.shutdown();
		piEmit.mockClear();
		// Directly emit on the client's emitter. Listeners removed by
		// shutdown → no pi.emit.
		service.client.events.emit("fetch_url", {
			spanId: "00000000",
			url: "https://x.test/",
			finalUrl: "https://x.test/",
			status: 200,
			bytes: 0,
			truncated: false,
			isolate: false,
			durationMs: 0,
			renderMode: "render",
			usedWaitForSelector: false,
			usedSelector: false,
			format: "html",
			screenshotBytes: null,
		});
		expect(piEmit).not.toHaveBeenCalled();
	});
});

describe("CamoufoxService.attach — binary download UI status", () => {
	it("sets pi.ui.setStatus on progress and clears it on browser_launch", async () => {
		const { pi, setStatus } = makeStubPi();
		const service = new CamoufoxService({ launcher: makeFakeLauncher() });
		service.attach(pi);
		// Emit progress events directly after attach — listeners are now wired.
		service.client.events.emit("binary_download_progress", {
			bytesDownloaded: 10,
			bytesTotal: 100,
		});
		service.client.events.emit("binary_download_progress", {
			bytesDownloaded: 100,
			bytesTotal: 100,
		});
		// Emit browser_launch to verify the status is cleared.
		service.client.events.emit("browser_launch", {
			spanId: "00000000",
			browserVersion: "fake-0.0.0",
			durationMs: 0,
		});
		const calls = setStatus.mock.calls;
		expect(calls.some((c) => c[0] === "camoufox:binary" && typeof c[1] === "string")).toBe(true);
		const clearedCall = calls.find((c) => c[0] === "camoufox:binary" && c[1] === null);
		expect(clearedCall).toBeDefined();
	});

	it("uses byte-count string when bytesTotal is null", async () => {
		const { pi, setStatus } = makeStubPi();
		const service = new CamoufoxService({ launcher: makeFakeLauncher() });
		service.attach(pi);
		// Emit a progress event with no bytesTotal after attach — listeners are wired.
		service.client.events.emit("binary_download_progress", {
			bytesDownloaded: 2_097_152,
			bytesTotal: null,
		});
		const progressCall = setStatus.mock.calls.find(
			(c) =>
				c[0] === "camoufox:binary" && typeof c[1] === "string" && (c[1] as string).includes("MiB"),
		);
		expect(progressCall).toBeDefined();
	});
});

describe("CamoufoxService.attach — session hooks", () => {
	it("binds session_start → initialize(cwd) and session_shutdown → shutdown()", async () => {
		const { pi, onSession } = makeStubPi();
		const service = new CamoufoxService({ launcher: makeFakeLauncher() });
		service.attach(pi);
		const startHandler = onSession.session_start;
		const shutdownHandler = onSession.session_shutdown;
		expect(startHandler).toBeDefined();
		expect(shutdownHandler).toBeDefined();
		await startHandler?.({}, { cwd: "/some/path" });
		expect(service.getBasePath()).toBe("/some/path");
		await shutdownHandler?.({}, {});
		expect(service.getBasePath()).toBeNull();
	});
});
