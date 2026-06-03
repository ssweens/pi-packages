import { describe, expect, it } from "vitest";

import type { CamoufoxClient } from "../../src/client/camoufox-client.js";
import type { SourceItem } from "../../src/sources/source-item.js";
import { createFetchSourcesTool } from "../../src/tools/fetch-sources.js";

const fakeClient = (items: SourceItem[]) =>
	({
		async fetchSources() {
			return {
				items,
				errors: [],
				stats: [
					{
						source: "reddit",
						itemCount: items.length,
						durationMs: 10,
						tier: 0 as const,
					},
				],
			};
		},
	}) as unknown as CamoufoxClient;

describe("tff-fetch_sources tool", () => {
	it("returns text summary and detail rows", async () => {
		const items: SourceItem[] = [
			{
				source: "reddit",
				id: "r1",
				url: "https://reddit.com/r/rust/comments/r1",
				title: "Rust thing",
				text: "body",
				author: "alice",
				publishedAt: "2026-04-10T00:00:00Z",
				engagement: { score: 42, comments: 3 },
			},
		];
		const tool = createFetchSourcesTool(fakeClient(items));
		const result = await tool.execute(
			"tc-1",
			{ query: "rust async", sources: ["reddit"] },
			new AbortController().signal,
		);
		expect(result.content[0]?.text).toContain("reddit");
		expect(result.content[0]?.text).toContain("1 item");
		expect(result.details.items).toHaveLength(1);
	});

	it("rejects when sources is empty (TypeBox validation)", async () => {
		const tool = createFetchSourcesTool(fakeClient([]));
		const { Value } = await import("@sinclair/typebox/value");
		expect(Value.Check(tool.parameters, { query: "q", sources: [] })).toBe(false);
	});
});
