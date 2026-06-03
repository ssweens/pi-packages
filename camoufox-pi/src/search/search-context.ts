// Dedicated long-lived BrowserContext for SERP queries. Isolated from the
// client's main fetchUrl context so SERP behavioral signals (NID/AEC/SOCS
// cookies, consent state, click history) don't contaminate page-fetch
// traffic and vice versa.
//
// Recycle policy: tear down + rebuild the BrowserContext on first block
// signal from any adapter, OR after 50 successful queries (whichever first).
// Both Google and DDG share the same SearchContext, so the counter is shared.

import type { Browser, BrowserContext, Page } from "playwright-core";

import { type SsrfGuard, attachSsrfGuard } from "../security/redirect-guard.js";
import type { LookupFn } from "../security/ssrf.js";
import type { BlockSignal } from "./types.js";

const RECYCLE_AFTER_N_QUERIES = 50;

export interface SearchContext {
	acquirePage(): Promise<{ page: Page; guard: SsrfGuard }>;
	markBlocked(signal: BlockSignal): void;
	recycle(): Promise<void>;
	queryCount(): number;
}

export function createSearchContext(
	getBrowser: () => Browser,
	opts: { ssrfLookup?: LookupFn } = {},
): SearchContext {
	let context: BrowserContext | null = null;
	let initPromise: Promise<BrowserContext> | null = null;
	let queries = 0;
	let blockedFlag = false;

	const ensureContext = (): Promise<BrowserContext> => {
		if (context !== null) return Promise.resolve(context);
		if (initPromise !== null) return initPromise;
		const browser = getBrowser();
		initPromise = browser.newContext().then((ctx) => {
			context = ctx;
			initPromise = null;
			return ctx;
		});
		return initPromise;
	};

	const doRecycle = async (): Promise<void> => {
		const ctx = context;
		context = null;
		initPromise = null;
		queries = 0;
		blockedFlag = false;
		if (ctx) await ctx.close().catch(() => undefined);
	};

	return {
		async acquirePage() {
			if (blockedFlag || queries >= RECYCLE_AFTER_N_QUERIES) {
				await doRecycle();
			}
			const ctx = await ensureContext();
			const page = await ctx.newPage();
			const guard = await attachSsrfGuard(page, opts.ssrfLookup ? { lookup: opts.ssrfLookup } : {});
			queries += 1;
			return { page, guard };
		},
		markBlocked(_signal: BlockSignal) {
			// Binary flag in v1 — kind of block doesn't change recycle behavior.
			blockedFlag = true;
		},
		async recycle() {
			await doRecycle();
		},
		queryCount() {
			return queries;
		},
	};
}
