import type { Page } from "playwright-core";
import { describe, expect, it } from "vitest";

import { waitForSelectorOrThrow } from "../../src/client/fetch-pipeline.js";
import { CamoufoxErrorBox } from "../../src/errors.js";

type LocBehavior = "resolve" | "timeout" | "invalid";

function makeStubPage(behavior: LocBehavior): Page {
	return {
		locator(_sel: string) {
			return {
				first() {
					return {
						async waitFor(opts?: { state?: string; timeout?: number }): Promise<void> {
							if (behavior === "resolve") return;
							if (behavior === "invalid") {
								throw new Error("Unknown engine 'bogus'");
							}
							const timeout = opts?.timeout ?? 30_000;
							await new Promise((r) => setTimeout(r, Math.min(timeout, 20)));
							const err = new Error(`Timeout ${timeout}ms`);
							err.name = "TimeoutError";
							throw err;
						},
					};
				},
			};
		},
	} as unknown as Page;
}

describe("waitForSelectorOrThrow", () => {
	it("resolves when the selector becomes visible", async () => {
		const page = makeStubPage("resolve");
		await expect(waitForSelectorOrThrow(page, ".ready", 1_000)).resolves.toBeUndefined();
	});

	it("throws timeout with phase: wait_for_selector on Playwright TimeoutError", async () => {
		const page = makeStubPage("timeout");
		const p = waitForSelectorOrThrow(page, ".never", 20);
		await expect(p).rejects.toBeInstanceOf(CamoufoxErrorBox);
		await expect(p).rejects.toMatchObject({
			err: { type: "timeout", phase: "wait_for_selector" },
		});
	});

	it("throws config_invalid when the selector syntax is invalid", async () => {
		const page = makeStubPage("invalid");
		const p = waitForSelectorOrThrow(page, "::bogus", 1_000);
		await expect(p).rejects.toMatchObject({
			err: { type: "config_invalid", field: "waitForSelector" },
		});
	});

	it("throws timeout immediately when budget is ≤ 0", async () => {
		const page = makeStubPage("resolve");
		const p = waitForSelectorOrThrow(page, ".x", 0);
		await expect(p).rejects.toMatchObject({
			err: { type: "timeout", phase: "wait_for_selector", elapsedMs: 0 },
		});
	});
});
