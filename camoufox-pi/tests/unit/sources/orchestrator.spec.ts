import { describe, expect, it, vi } from "vitest";

import { CamoufoxErrorBox } from "../../../src/errors.js";
import { fetchSources } from "../../../src/sources/orchestrator.js";
import type { SourceItem } from "../../../src/sources/source-item.js";
import type { SourceAdapter } from "../../../src/sources/types.js";
import { createFakeCredentialBackend } from "../../helpers/fake-credential-backend.js";
import { createFakeHttpFetch } from "../../helpers/fake-http-fetch.js";

const emit = () => undefined;
const credBackend = createFakeCredentialBackend();
const httpFetch = createFakeHttpFetch({});

const item = (over: Partial<SourceItem> = {}): SourceItem => ({
	source: "reddit",
	id: "x",
	url: "https://x",
	title: null,
	text: null,
	author: null,
	publishedAt: "2026-04-10T00:00:00Z",
	engagement: {},
	...over,
});

const fakeAdapter = (overrides: Partial<SourceAdapter>): SourceAdapter => ({
	name: "reddit",
	tier: 0,
	requiredCredentials: [],
	fetch: async () => [],
	...overrides,
});

describe("fetchSources orchestrator", () => {
	it("throws config_invalid when sources is empty", async () => {
		await expect(
			fetchSources("q", {
				sources: [],
				lookbackDays: 30,
				perSourceLimit: 10,
				adapters: [],
				credentialBackend: credBackend,
				httpFetch,
				emit,
			}),
		).rejects.toMatchObject({ err: { type: "config_invalid" } });
	});

	it("merges items across sources and sorts by publishedAt desc", async () => {
		const a = fakeAdapter({
			name: "reddit",
			fetch: async () => [
				item({ source: "reddit", id: "r1", publishedAt: "2026-04-05T00:00:00Z" }),
			],
		});
		const b = fakeAdapter({
			name: "hn",
			fetch: async () => [item({ source: "hn", id: "h1", publishedAt: "2026-04-10T00:00:00Z" })],
		});
		const res = await fetchSources("q", {
			sources: ["reddit", "hn"],
			lookbackDays: 30,
			perSourceLimit: 10,
			adapters: [a, b],
			credentialBackend: credBackend,
			httpFetch,
			emit,
		});
		expect(res.items.map((i) => i.id)).toEqual(["h1", "r1"]);
		expect(res.errors).toEqual([]);
		expect(res.stats.map((s) => s.source).sort()).toEqual(["hn", "reddit"]);
	});

	it("records per-source error but returns other sources' items (partial success)", async () => {
		const good = fakeAdapter({
			name: "reddit",
			fetch: async () => [item({ source: "reddit", id: "r1" })],
		});
		const bad = fakeAdapter({
			name: "hn",
			fetch: async () => {
				throw new CamoufoxErrorBox({ type: "source_rate_limited", source: "hn" });
			},
		});
		const res = await fetchSources("q", {
			sources: ["reddit", "hn"],
			lookbackDays: 30,
			perSourceLimit: 10,
			adapters: [good, bad],
			credentialBackend: credBackend,
			httpFetch,
			emit,
		});
		expect(res.items.map((i) => i.id)).toEqual(["r1"]);
		expect(res.errors).toHaveLength(1);
		expect(res.errors[0]?.source).toBe("hn");
	});

	it("throws all_sources_failed when every source errors", async () => {
		const bad1 = fakeAdapter({
			name: "reddit",
			fetch: async () => {
				throw new CamoufoxErrorBox({ type: "source_unavailable", source: "reddit" });
			},
		});
		const bad2 = fakeAdapter({
			name: "hn",
			fetch: async () => {
				throw new CamoufoxErrorBox({ type: "source_rate_limited", source: "hn" });
			},
		});
		await expect(
			fetchSources("q", {
				sources: ["reddit", "hn"],
				lookbackDays: 30,
				perSourceLimit: 10,
				adapters: [bad1, bad2],
				credentialBackend: credBackend,
				httpFetch,
				emit,
			}),
		).rejects.toMatchObject({ err: { type: "all_sources_failed" } });
	});

	it("emits one source_fetch event per requested source", async () => {
		const a = fakeAdapter({
			name: "reddit",
			fetch: async () => [item({ id: "a" })],
		});
		const events: unknown[] = [];
		await fetchSources("q", {
			sources: ["reddit"],
			lookbackDays: 30,
			perSourceLimit: 10,
			adapters: [a],
			credentialBackend: credBackend,
			httpFetch,
			emit: (e) => {
				events.push(e);
			},
		});
		expect(events).toHaveLength(1);
		expect((events[0] as { source: string }).source).toBe("reddit");
		expect((events[0] as { outcome: string }).outcome).toBe("ok");
	});

	it("rejects unknown source name with config_invalid", async () => {
		await expect(
			fetchSources("q", {
				sources: ["does-not-exist"],
				lookbackDays: 30,
				perSourceLimit: 10,
				adapters: [],
				credentialBackend: credBackend,
				httpFetch,
				emit,
			}),
		).rejects.toMatchObject({ err: { type: "config_invalid" } });
	});

	it("propagates abort into adapter contexts", async () => {
		const aborted = vi.fn();
		const controller = new AbortController();
		const a = fakeAdapter({
			async fetch(_q, opts) {
				opts.signal?.addEventListener("abort", aborted);
				controller.abort();
				// Give the event loop a tick so the listener fires before return.
				await new Promise((r) => setTimeout(r, 0));
				return [];
			},
		});
		await fetchSources("q", {
			sources: ["reddit"],
			lookbackDays: 30,
			perSourceLimit: 10,
			adapters: [a],
			credentialBackend: credBackend,
			httpFetch,
			emit,
			signal: controller.signal,
		}).catch(() => undefined);
		expect(aborted).toHaveBeenCalled();
	});
});
