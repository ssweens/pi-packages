import type { Page } from "playwright-core";
import { describe, expect, it } from "vitest";

import { capturePageScreenshot } from "../../src/client/fetch-pipeline.js";

interface StubControls {
	last?: unknown;
	dimensions?: { width: number; height: number };
}

function makeStubPage(buf: Buffer, captureOpts: StubControls = {}): Page {
	return {
		async screenshot(opts: unknown): Promise<Buffer> {
			captureOpts.last = opts;
			return buf;
		},
		async evaluate<T>(): Promise<T> {
			// Default small dimensions so full_page doesn't hit the cap.
			return (captureOpts.dimensions ?? { width: 1024, height: 768 }) as unknown as T;
		},
	} as unknown as Page;
}

describe("capturePageScreenshot", () => {
	it("returns base64, bytes, mimeType for PNG default", async () => {
		const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
		const page = makeStubPage(buf);
		const res = await capturePageScreenshot(page, {});
		expect(res.mimeType).toBe("image/png");
		expect(res.bytes).toBe(4);
		expect(res.data).toBe(buf.toString("base64"));
	});

	it("encodes JPEG with image/jpeg mime when format=jpeg", async () => {
		const buf = Buffer.from([0xff, 0xd8, 0xff]);
		const page = makeStubPage(buf);
		const res = await capturePageScreenshot(page, { format: "jpeg", quality: 70 });
		expect(res.mimeType).toBe("image/jpeg");
	});

	it("passes fullPage through to page.screenshot", async () => {
		const captured: { last?: unknown } = {};
		const page = makeStubPage(Buffer.from("x"), captured);
		await capturePageScreenshot(page, { fullPage: true });
		expect(captured.last).toMatchObject({ fullPage: true, type: "png" });
	});

	it("passes quality only with jpeg", async () => {
		const captured: { last?: unknown } = {};
		const page = makeStubPage(Buffer.from("x"), captured);
		await capturePageScreenshot(page, { format: "jpeg", quality: 55 });
		expect(captured.last).toMatchObject({ type: "jpeg", quality: 55 });
	});
});
