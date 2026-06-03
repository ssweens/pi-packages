import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import { createClient } from "../../src/client/create-client.js";
import { DEFAULT_CONFIG } from "../../src/types.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";

describe("createClient", () => {
	it("returns a CamoufoxClient synchronously", () => {
		const launcher = makeFakeLauncher();
		const c = createClient({ launcher });
		expect(c).toBeInstanceOf(CamoufoxClient);
	});

	it("kicks off ensureReady in the background", async () => {
		const launcher = makeFakeLauncher();
		const c = createClient({ launcher });
		// launchCount increments inside launcher.launch(); by the time an
		// ensureReady await resolves, it must be exactly 1 — proving the
		// factory already kicked off a single launch.
		await c.ensureReady();
		expect(launcher.fake.launchCount).toBe(1);
	});

	it("swallows background ensureReady failure (factory does not throw)", async () => {
		const launcher = makeFakeLauncher({ launchFails: new Error("boom") });
		// Factory returns synchronously; background rejection must be caught.
		expect(() => createClient({ launcher })).not.toThrow();
		// Allow microtasks to settle.
		await new Promise((r) => setTimeout(r, 10));
	});

	it("shallow-merges config opts over DEFAULT_CONFIG", () => {
		const launcher = makeFakeLauncher();
		const c = createClient({ launcher, config: { timeoutMs: 5_000 } });
		expect(c.config).toMatchObject({ ...DEFAULT_CONFIG, timeoutMs: 5_000 });
	});
});
