import { describe, expect, it } from "vitest";

import { googleAdapter } from "../../../src/search/adapters/google.js";

function mockPage(url: string): { url(): string } {
	return { url: () => url };
}

function mockResponse(status: number): { status(): number; url(): string } {
	return { status: () => status, url: () => "" };
}

describe("googleAdapter.detectBlock", () => {
	it("returns null for 200 response on normal SERP URL", async () => {
		const signal = await googleAdapter.detectBlock?.(
			mockPage("https://www.google.com/search?q=x") as never,
			mockResponse(200) as never,
		);
		expect(signal).toBeNull();
	});

	it("returns http_status for 429", async () => {
		const signal = await googleAdapter.detectBlock?.(
			mockPage("https://www.google.com/search?q=x") as never,
			mockResponse(429) as never,
		);
		expect(signal).toEqual({ kind: "http_status", status: 429 });
	});

	it("returns http_status for 503", async () => {
		const signal = await googleAdapter.detectBlock?.(
			mockPage("https://www.google.com/search?q=x") as never,
			mockResponse(503) as never,
		);
		expect(signal).toEqual({ kind: "http_status", status: 503 });
	});

	it("returns sorry_interstitial when URL matches /sorry/", async () => {
		const sorryUrl = "https://www.google.com/sorry/index?continue=https://www.google.com/search";
		const signal = await googleAdapter.detectBlock?.(
			mockPage(sorryUrl) as never,
			mockResponse(200) as never,
		);
		expect(signal).toEqual({ kind: "sorry_interstitial", url: sorryUrl });
	});

	it("returns null when response is null and URL is normal", async () => {
		const signal = await googleAdapter.detectBlock?.(
			mockPage("https://www.google.com/search?q=x") as never,
			null,
		);
		expect(signal).toBeNull();
	});

	it("returns sorry_interstitial even when response is null (URL-based detection)", async () => {
		const sorryUrl = "https://www.google.com/sorry/?foo=bar";
		const signal = await googleAdapter.detectBlock?.(mockPage(sorryUrl) as never, null);
		expect(signal).toEqual({ kind: "sorry_interstitial", url: sorryUrl });
	});
});
