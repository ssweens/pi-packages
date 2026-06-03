import { describe, expect, it } from "vitest";

import { sortByPublishedDesc } from "../../../src/sources/source-item.js";
import type { SourceItem } from "../../../src/sources/source-item.js";

const make = (overrides: Partial<SourceItem> = {}): SourceItem => ({
	source: "reddit",
	id: "t3_a",
	url: "https://reddit.com/r/x/comments/a",
	title: "t",
	text: null,
	author: "u",
	publishedAt: "2026-04-01T00:00:00.000Z",
	engagement: {},
	...overrides,
});

describe("sortByPublishedDesc", () => {
	it("sorts newest first and is stable for equal timestamps", () => {
		const a = make({ id: "a", publishedAt: "2026-04-10T00:00:00.000Z" });
		const b = make({ id: "b", publishedAt: "2026-04-05T00:00:00.000Z" });
		const c = make({ id: "c", publishedAt: "2026-04-10T00:00:00.000Z" });
		const out = sortByPublishedDesc([a, b, c]);
		expect(out.map((i) => i.id)).toEqual(["a", "c", "b"]);
	});

	it("does not mutate input", () => {
		const a = make({ id: "a", publishedAt: "2026-04-01T00:00:00.000Z" });
		const b = make({ id: "b", publishedAt: "2026-04-02T00:00:00.000Z" });
		const input = [a, b];
		sortByPublishedDesc(input);
		expect(input.map((i) => i.id)).toEqual(["a", "b"]);
	});

	it("returns an empty array for empty input", () => {
		expect(sortByPublishedDesc([])).toEqual([]);
	});
});
