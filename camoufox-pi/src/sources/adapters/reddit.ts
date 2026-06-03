import { CamoufoxErrorBox } from "../../errors.js";
import type { SourceItem } from "../source-item.js";
import type { SourceAdapter, SourceFetchOptions } from "../types.js";

interface RedditChild {
	readonly kind: string;
	readonly data: {
		readonly id: string;
		readonly title: string;
		readonly selftext: string | null;
		readonly author: string;
		readonly permalink: string;
		readonly created_utc: number;
		readonly score: number;
		readonly num_comments: number;
	};
}

interface RedditListing {
	readonly data: { readonly children: RedditChild[] };
}

const USER_AGENT_PREFIX = "camoufox-pi";

export function redditAdapter(): SourceAdapter {
	return {
		name: "reddit",
		tier: 0,
		requiredCredentials: [],
		async fetch(query, opts, ctx) {
			const url = buildUrl(query, opts);
			const res = await ctx.httpFetch(url, {
				headers: {
					"user-agent": `${USER_AGENT_PREFIX} (+https://github.com/MonsieurBarti/camoufox-pi)`,
					accept: "application/json",
				},
				...(opts.signal !== undefined ? { signal: opts.signal } : {}),
			});
			if (res.status === 429) {
				const retryAfter = res.headers["retry-after"];
				const parsed = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;
				throw new CamoufoxErrorBox({
					type: "source_rate_limited",
					source: "reddit",
					...(Number.isFinite(parsed) ? { retryAfterSec: parsed } : {}),
				});
			}
			if (res.status !== 200) {
				throw new CamoufoxErrorBox({
					type: "source_unavailable",
					source: "reddit",
					cause: `HTTP ${res.status}`,
				});
			}
			let listing: RedditListing;
			try {
				listing = JSON.parse(res.body) as RedditListing;
			} catch {
				throw new CamoufoxErrorBox({
					type: "source_unavailable",
					source: "reddit",
					cause: "malformed JSON",
				});
			}
			const cutoff = Date.now() - opts.lookbackDays * 86_400_000;
			const items: SourceItem[] = [];
			for (const child of listing.data.children) {
				if (child.kind !== "t3") continue;
				const item = toSourceItem(child);
				if (Date.parse(item.publishedAt) < cutoff) continue;
				items.push(item);
				if (items.length >= opts.limit) break;
			}
			return items;
		},
	};
}

function buildUrl(query: string, opts: SourceFetchOptions): string {
	const params = new URLSearchParams({
		q: query,
		t: "month",
		sort: "relevance",
		limit: String(opts.limit),
	});
	return `https://www.reddit.com/search.json?${params.toString()}`;
}

function toSourceItem(child: RedditChild): SourceItem {
	const d = child.data;
	const author = d.author === "[deleted]" ? null : d.author;
	return {
		source: "reddit",
		id: `t3_${d.id}`,
		url: `https://reddit.com${d.permalink}`,
		title: d.title,
		text: d.selftext ? d.selftext : null,
		author,
		publishedAt: new Date(d.created_utc * 1000).toISOString(),
		engagement: {
			score: d.score,
			comments: d.num_comments,
		},
	};
}
