import type { SourceName } from "./types.js";

export interface SourceItem {
	readonly source: SourceName;
	readonly id: string;
	readonly url: string;
	readonly title: string | null;
	readonly text: string | null;
	readonly author: string | null;
	/** ISO-8601 UTC; required. Adapters that cannot date an item drop it. */
	readonly publishedAt: string;
	readonly engagement: {
		readonly score?: number;
		readonly comments?: number;
		readonly shares?: number;
	};
	/** Per-adapter escape hatch. Stripped from sanitizeForMessage paths. */
	readonly raw?: unknown;
}

/**
 * Newest first. Stable for equal timestamps (items with the same
 * publishedAt keep their input order). Does not mutate input.
 */
export function sortByPublishedDesc(items: readonly SourceItem[]): SourceItem[] {
	// Decorate-sort-undecorate to keep stable ordering even though V8's
	// Array.sort is already stable — this makes the stability contract
	// independent of any future runtime change.
	return items
		.map((item, index) => ({ item, index, ts: Date.parse(item.publishedAt) }))
		.sort((a, b) => {
			if (b.ts !== a.ts) return b.ts - a.ts;
			return a.index - b.index;
		})
		.map((w) => w.item);
}
