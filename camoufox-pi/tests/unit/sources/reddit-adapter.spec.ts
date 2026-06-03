import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createCredentialReader } from "../../../src/credentials/reader.js";
import { redditAdapter } from "../../../src/sources/adapters/reddit.js";
import type { AdapterContext } from "../../../src/sources/types.js";
import { createFakeCredentialBackend } from "../../helpers/fake-credential-backend.js";

const FIXTURE = JSON.parse(
	readFileSync(resolve(__dirname, "../../fixtures/reddit-search.json"), "utf8"),
);

const makeCtx = (overrides: Partial<AdapterContext> = {}): AdapterContext => ({
	httpFetch: async () => ({
		status: 200,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(FIXTURE),
		url: "https://www.reddit.com/search.json",
	}),
	credentials: createCredentialReader(createFakeCredentialBackend(), "reddit"),
	emit: () => undefined,
	...overrides,
});

describe("redditAdapter", () => {
	it("parses fixture into SourceItems", async () => {
		const adapter = redditAdapter();
		const items = await adapter.fetch(
			"rust async",
			{ lookbackDays: 365 * 10, limit: 10 },
			makeCtx(),
		);
		expect(items).toHaveLength(3);
		expect(items[0]).toMatchObject({
			source: "reddit",
			id: "t3_abc123",
			url: "https://reddit.com/r/rust/comments/abc123/rust_async_in_2026/",
			title: "Rust async in 2026",
			author: "alice",
			engagement: { score: 542, comments: 87 },
		});
	});

	it("normalizes [deleted] author to null", async () => {
		const adapter = redditAdapter();
		const items = await adapter.fetch("x", { lookbackDays: 365 * 10, limit: 10 }, makeCtx());
		const deleted = items.find((i) => i.id === "t3_def456");
		expect(deleted?.author).toBeNull();
	});

	it("drops items outside the lookback window", async () => {
		const adapter = redditAdapter();
		const items = await adapter.fetch("x", { lookbackDays: 30, limit: 10 }, makeCtx());
		expect(items.find((i) => i.id === "t3_old789")).toBeUndefined();
	});

	it("respects limit", async () => {
		const adapter = redditAdapter();
		const items = await adapter.fetch("x", { lookbackDays: 365 * 10, limit: 2 }, makeCtx());
		expect(items).toHaveLength(2);
	});

	it("sends expected query parameters", async () => {
		const adapter = redditAdapter();
		const httpFetch = vi.fn(async () => ({
			status: 200,
			headers: {},
			body: JSON.stringify({ data: { children: [] } }),
			url: "https://www.reddit.com/search.json",
		}));
		await adapter.fetch("rust", { lookbackDays: 30, limit: 15 }, makeCtx({ httpFetch }));
		expect(httpFetch).toHaveBeenCalledOnce();
		const calledUrl = (httpFetch.mock.calls[0] as unknown as [string])[0];
		expect(calledUrl).toContain("q=rust");
		expect(calledUrl).toContain("t=month");
		expect(calledUrl).toContain("limit=15");
	});

	it("maps 429 to source_rate_limited with Retry-After", async () => {
		const adapter = redditAdapter();
		const ctx = makeCtx({
			httpFetch: async () => ({
				status: 429,
				headers: { "retry-after": "60" },
				body: "",
				url: "https://www.reddit.com/search.json",
			}),
		});
		await expect(adapter.fetch("x", { lookbackDays: 30, limit: 10 }, ctx)).rejects.toMatchObject({
			err: { type: "source_rate_limited", source: "reddit", retryAfterSec: 60 },
		});
	});

	it("maps 5xx to source_unavailable", async () => {
		const adapter = redditAdapter();
		const ctx = makeCtx({
			httpFetch: async () => ({
				status: 503,
				headers: {},
				body: "",
				url: "https://www.reddit.com/search.json",
			}),
		});
		await expect(adapter.fetch("x", { lookbackDays: 30, limit: 10 }, ctx)).rejects.toMatchObject({
			err: { type: "source_unavailable", source: "reddit" },
		});
	});

	it("maps 429 without Retry-After to source_rate_limited without retryAfterSec", async () => {
		const adapter = redditAdapter();
		const ctx = makeCtx({
			httpFetch: async () => ({
				status: 429,
				headers: {},
				body: "",
				url: "https://www.reddit.com/search.json",
			}),
		});
		try {
			await adapter.fetch("x", { lookbackDays: 30, limit: 10 }, ctx);
			throw new Error("expected throw");
		} catch (err) {
			const e = err as import("../../../src/errors.js").CamoufoxErrorBox;
			expect(e.err).toEqual({ type: "source_rate_limited", source: "reddit" });
		}
	});

	it("maps 403 to source_unavailable", async () => {
		const adapter = redditAdapter();
		const ctx = makeCtx({
			httpFetch: async () => ({
				status: 403,
				headers: {},
				body: "",
				url: "https://www.reddit.com/search.json",
			}),
		});
		await expect(adapter.fetch("x", { lookbackDays: 30, limit: 10 }, ctx)).rejects.toMatchObject({
			err: { type: "source_unavailable", source: "reddit", cause: "HTTP 403" },
		});
	});
});
