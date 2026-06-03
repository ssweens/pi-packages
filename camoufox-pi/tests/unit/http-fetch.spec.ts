import type { LookupAddress } from "node:dns";
import { describe, expect, it } from "vitest";

import { createHttpFetch } from "../../src/client/http-fetch.js";
import { CamoufoxErrorBox } from "../../src/errors.js";
import type { LookupFn } from "../../src/security/ssrf.js";

describe("httpFetch — scheme allow-list", () => {
	it("rejects file:// URLs with ssrf_blocked", async () => {
		const httpFetch = createHttpFetch({});
		await expect(httpFetch("file:///etc/passwd")).rejects.toMatchObject({
			err: { type: "ssrf_blocked", hop: "initial" },
		});
	});

	it("rejects javascript: URLs", async () => {
		const httpFetch = createHttpFetch({});
		await expect(httpFetch("javascript:alert(1)")).rejects.toBeInstanceOf(CamoufoxErrorBox);
	});

	it("rejects data: URLs", async () => {
		const httpFetch = createHttpFetch({});
		await expect(httpFetch("data:text/plain,hi")).rejects.toBeInstanceOf(CamoufoxErrorBox);
	});
});

describe("httpFetch — SSRF", () => {
	it("blocks 127.0.0.1 with ssrf_blocked", async () => {
		const httpFetch = createHttpFetch({});
		await expect(httpFetch("http://127.0.0.1/")).rejects.toMatchObject({
			err: { type: "ssrf_blocked", hop: "initial" },
		});
	});

	it("blocks hostnames resolving to private IPs", async () => {
		const httpFetch = createHttpFetch({
			lookup: (async () =>
				[{ address: "10.0.0.5", family: 4 }] as unknown as LookupAddress[]) as unknown as LookupFn,
		});
		await expect(httpFetch("http://evil.test/")).rejects.toMatchObject({
			err: { type: "ssrf_blocked" },
		});
	});
});

describe("httpFetch — redirects", () => {
	it("follows 301 redirect and validates new URL", async () => {
		let calls = 0;
		const fetchImpl = (async (url: string | URL | Request) => {
			calls++;
			const u = url.toString();
			if (u.endsWith("/start")) {
				return new Response(null, {
					status: 301,
					headers: { location: "https://example.test/end" },
				});
			}
			return new Response("final", { status: 200, headers: { "content-type": "text/plain" } });
		}) as unknown as typeof fetch;
		const httpFetch = createHttpFetch({
			fetchImpl,
			lookup: (async () =>
				[
					{ address: "93.184.216.34", family: 4 },
				] as unknown as LookupAddress[]) as unknown as LookupFn,
		});
		const res = await httpFetch("https://example.test/start");
		expect(res.body).toBe("final");
		expect(res.url).toBe("https://example.test/end");
		expect(calls).toBe(2);
	});

	it("re-validates redirect target against SSRF and rejects private IP", async () => {
		let calls = 0;
		const fetchImpl = (async (_url: string | URL | Request) => {
			calls++;
			return new Response(null, {
				status: 302,
				headers: { location: "http://127.0.0.1/admin" },
			});
		}) as unknown as typeof fetch;
		const httpFetch = createHttpFetch({
			fetchImpl,
			lookup: (async () =>
				[
					{ address: "93.184.216.34", family: 4 },
				] as unknown as LookupAddress[]) as unknown as LookupFn,
		});
		await expect(httpFetch("https://example.test/redir")).rejects.toMatchObject({
			err: { type: "ssrf_blocked", hop: "redirect" },
		});
		expect(calls).toBe(1);
	});

	it("downgrades POST to GET with no body on 303 See Other", async () => {
		const seen: Array<{ url: string; method: string | undefined; body: unknown }> = [];
		const fetchImpl = (async (
			url: string | URL | Request,
			init?: { method?: string; body?: unknown },
		) => {
			const u = url.toString();
			seen.push({ url: u, method: init?.method, body: init?.body });
			if (u.endsWith("/submit")) {
				return new Response(null, {
					status: 303,
					headers: { location: "https://example.test/done" },
				});
			}
			return new Response("ok", { status: 200 });
		}) as unknown as typeof fetch;
		const httpFetch = createHttpFetch({
			fetchImpl,
			lookup: (async () =>
				[
					{ address: "93.184.216.34", family: 4 },
				] as unknown as LookupAddress[]) as unknown as LookupFn,
		});
		await httpFetch("https://example.test/submit", { method: "POST", body: "payload" });
		expect(seen).toHaveLength(2);
		expect(seen[0]?.method).toBe("POST");
		expect(seen[0]?.body).toBe("payload");
		expect(seen[1]?.method).toBe("GET");
		expect(seen[1]?.body).toBeUndefined();
	});

	it("rejects after more than 10 redirect hops", async () => {
		let calls = 0;
		const fetchImpl = (async (url: string | URL | Request) => {
			calls++;
			const u = new URL(url.toString());
			const n = Number(u.searchParams.get("n") ?? "0") + 1;
			return new Response(null, {
				status: 302,
				headers: { location: `https://example.test/r?n=${n}` },
			});
		}) as unknown as typeof fetch;
		const httpFetch = createHttpFetch({
			fetchImpl,
			lookup: (async () =>
				[
					{ address: "93.184.216.34", family: 4 },
				] as unknown as LookupAddress[]) as unknown as LookupFn,
		});
		await expect(httpFetch("https://example.test/r?n=0")).rejects.toMatchObject({
			err: { type: "network" },
		});
		expect(calls).toBeLessThanOrEqual(11);
	});
});

describe("httpFetch — maxBytes + timeout", () => {
	it("truncates body at maxBytes", async () => {
		const big = "x".repeat(10_000);
		const fetchImpl = (async () => new Response(big, { status: 200 })) as unknown as typeof fetch;
		const httpFetch = createHttpFetch({
			fetchImpl,
			lookup: (async () =>
				[
					{ address: "93.184.216.34", family: 4 },
				] as unknown as LookupAddress[]) as unknown as LookupFn,
		});
		const res = await httpFetch("https://example.test/", { maxBytes: 100 });
		expect(res.body.length).toBe(100);
	});

	it("rejects with timeout error when timeoutMs elapses", async () => {
		const fetchImpl = (async (_u: unknown, init?: { signal?: AbortSignal }) =>
			await new Promise<Response>((_, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(new DOMException("aborted", "AbortError")),
				);
			})) as unknown as typeof fetch;
		const httpFetch = createHttpFetch({
			fetchImpl,
			lookup: (async () =>
				[
					{ address: "93.184.216.34", family: 4 },
				] as unknown as LookupAddress[]) as unknown as LookupFn,
		});
		await expect(httpFetch("https://example.test/", { timeoutMs: 10 })).rejects.toMatchObject({
			err: { type: "timeout" },
		});
	});
});
