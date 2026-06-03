import { type Server, createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHttpFetch } from "../../src/client/http-fetch.js";
import type { LookupFn } from "../../src/security/ssrf.js";

let server: Server;
let port: number;

beforeAll(
	() =>
		new Promise<void>((resolve) => {
			server = createServer((req, res) => {
				if (req.url === "/redir-to-private") {
					res.writeHead(302, { location: "http://127.0.0.1:1/secret" });
					res.end();
					return;
				}
				res.writeHead(200, { "content-type": "text/plain" });
				res.end("ok");
			});
			server.listen(0, "127.0.0.1", () => {
				const addr = server.address();
				if (addr && typeof addr === "object") port = addr.port;
				resolve();
			});
		}),
);

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("httpFetch integration — local http server", () => {
	it("rejects direct 127.0.0.1 requests with ssrf_blocked", async () => {
		const httpFetch = createHttpFetch({});
		await expect(httpFetch(`http://127.0.0.1:${port}/`)).rejects.toMatchObject({
			err: { type: "ssrf_blocked", hop: "initial" },
		});
	});

	it("rejects redirect to 127.0.0.1", async () => {
		// Bypass the initial-hop SSRF by resolving the bound port via a fake
		// public IP; the redirect target is the literal 127.0.0.1, which the
		// per-hop guard must still block.
		const fakeLookup = (async () => [
			{ address: "93.184.216.34", family: 4 },
		]) as unknown as LookupFn;
		const httpFetch = createHttpFetch({
			lookup: fakeLookup,
			fetchImpl: (async (url: string | URL | Request) => {
				// In-test indirection: the first request is directed at the actual
				// bound loopback port; the per-hop guard we're exercising is the
				// one on the *redirect target* (the literal 127.0.0.1 in the
				// Location header, which fails the guard regardless of DNS).
				const u = url
					.toString()
					.replace("https://example.test", `http://127.0.0.1:${port}`)
					.replace("example.test", `127.0.0.1:${port}`);
				return fetch(u, { redirect: "manual" });
			}) as unknown as typeof fetch,
		});
		await expect(httpFetch("https://example.test/redir-to-private")).rejects.toMatchObject({
			err: { type: "ssrf_blocked", hop: "redirect" },
		});
	});
});
