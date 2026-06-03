import { describe, expect, it, vi } from "vitest";

import type { BinaryDownloadProgressEvent } from "../../src/client/events.js";
import { RealLauncher } from "../../src/client/launcher.js";
import { CamoufoxErrorBox } from "../../src/errors.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";

describe("fake launcher onProgress plumbing", () => {
	it("fires provided progress events before launch resolves", async () => {
		const events: BinaryDownloadProgressEvent[] = [
			{ bytesDownloaded: 100, bytesTotal: 1000 },
			{ bytesDownloaded: 500, bytesTotal: 1000 },
			{ bytesDownloaded: 1000, bytesTotal: 1000 },
		];
		const launcher = makeFakeLauncher({ progressEvents: events });
		const onProgress = vi.fn();
		const result = await launcher.launch({ onProgress });
		expect(onProgress).toHaveBeenCalledTimes(3);
		expect(onProgress.mock.calls.map((c) => c[0])).toEqual(events);
		expect(result.version).toBe("fake-0.0.0");
	});

	it("skips onProgress when none provided", async () => {
		const launcher = makeFakeLauncher();
		const onProgress = vi.fn();
		await launcher.launch({ onProgress });
		expect(onProgress).not.toHaveBeenCalled();
	});

	it("launch() still works without any opts arg (back-compat)", async () => {
		const launcher = makeFakeLauncher();
		const result = await launcher.launch();
		expect(result.version).toBe("fake-0.0.0");
	});

	it("propagates launchFails even when onProgress is provided", async () => {
		const boom = new Error("boom");
		const launcher = makeFakeLauncher({ launchFails: boom });
		await expect(launcher.launch({ onProgress: () => undefined })).rejects.toBe(boom);
	});
});

describe("RealLauncher — binaryPath validation", () => {
	it("accepts absolute path", () => {
		expect(() => new RealLauncher({ binaryPath: "/tmp/camoufox" })).not.toThrow();
	});
	it("rejects relative path with config_invalid", () => {
		expect(() => new RealLauncher({ binaryPath: "./camoufox" })).toThrow(CamoufoxErrorBox);
	});
	it("rejects bare name with config_invalid", () => {
		expect(() => new RealLauncher({ binaryPath: "camoufox" })).toThrow(CamoufoxErrorBox);
	});
});
