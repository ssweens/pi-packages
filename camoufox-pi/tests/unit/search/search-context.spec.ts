import type { Browser, BrowserContext, Page } from "playwright-core";
import { describe, expect, it } from "vitest";

import { createSearchContext } from "../../../src/search/search-context.js";

// Minimal BrowserContext/Page fakes sufficient for counter + recycle tests.
// attachSsrfGuard will be called on each acquired page; the fake Page provides
// the narrow methods that guard uses (on, off, route, unroute, mainFrame, url).
function makeFakeBrowser(): {
	browser: Browser;
	state: {
		contextsCreated: number;
		pagesCreated: number;
		contextsClosed: number;
		lastContext: BrowserContext | null;
	};
} {
	const state = {
		contextsCreated: 0,
		pagesCreated: 0,
		contextsClosed: 0,
		lastContext: null as BrowserContext | null,
	};
	const browser = {
		async newContext() {
			state.contextsCreated += 1;
			const ctx: Partial<BrowserContext> = {
				async newPage() {
					state.pagesCreated += 1;
					const page: Partial<Page> = {
						async close() {},
						url: () => "about:blank",
						on: (() => page as Page) as Page["on"],
						off: (() => page as Page) as Page["off"],
						route: (async () => {}) as unknown as Page["route"],
						unroute: (async () => {}) as unknown as Page["unroute"],
						mainFrame: () => ({}) as unknown as ReturnType<Page["mainFrame"]>,
					};
					return page as Page;
				},
				async close() {
					state.contextsClosed += 1;
				},
			};
			state.lastContext = ctx as BrowserContext;
			return ctx as BrowserContext;
		},
	} as unknown as Browser;
	return { browser, state };
}

describe("createSearchContext", () => {
	it("lazy-creates a BrowserContext on first acquirePage", async () => {
		const fake = makeFakeBrowser();
		const ctx = createSearchContext(() => fake.browser);
		expect(fake.state.contextsCreated).toBe(0);
		await ctx.acquirePage();
		expect(fake.state.contextsCreated).toBe(1);
	});

	it("reuses the same BrowserContext across multiple pages", async () => {
		const fake = makeFakeBrowser();
		const ctx = createSearchContext(() => fake.browser);
		await ctx.acquirePage();
		await ctx.acquirePage();
		await ctx.acquirePage();
		expect(fake.state.contextsCreated).toBe(1);
		expect(fake.state.pagesCreated).toBe(3);
	});

	it("queryCount increments on each acquirePage", async () => {
		const fake = makeFakeBrowser();
		const ctx = createSearchContext(() => fake.browser);
		expect(ctx.queryCount()).toBe(0);
		await ctx.acquirePage();
		expect(ctx.queryCount()).toBe(1);
		await ctx.acquirePage();
		expect(ctx.queryCount()).toBe(2);
	});

	it("markBlocked causes next acquirePage to recycle the context", async () => {
		const fake = makeFakeBrowser();
		const ctx = createSearchContext(() => fake.browser);
		await ctx.acquirePage();
		expect(fake.state.contextsCreated).toBe(1);
		ctx.markBlocked({ kind: "sorry_interstitial", url: "x" });
		await ctx.acquirePage();
		expect(fake.state.contextsCreated).toBe(2);
		expect(fake.state.contextsClosed).toBe(1);
		expect(ctx.queryCount()).toBe(1);
	});

	it("recycles after 50 queries", async () => {
		const fake = makeFakeBrowser();
		const ctx = createSearchContext(() => fake.browser);
		for (let i = 0; i < 50; i += 1) {
			await ctx.acquirePage();
		}
		expect(fake.state.contextsCreated).toBe(1);
		await ctx.acquirePage();
		expect(fake.state.contextsCreated).toBe(2);
	});

	it("recycle() tears down and next acquire builds fresh", async () => {
		const fake = makeFakeBrowser();
		const ctx = createSearchContext(() => fake.browser);
		await ctx.acquirePage();
		await ctx.recycle();
		expect(fake.state.contextsClosed).toBe(1);
		await ctx.acquirePage();
		expect(fake.state.contextsCreated).toBe(2);
		expect(ctx.queryCount()).toBe(1);
	});

	it("clearBlocked flag is reset after recycle (subsequent acquire does not re-recycle)", async () => {
		const fake = makeFakeBrowser();
		const ctx = createSearchContext(() => fake.browser);
		await ctx.acquirePage();
		ctx.markBlocked({ kind: "empty_results" });
		await ctx.acquirePage(); // triggers recycle, contextsCreated = 2
		await ctx.acquirePage(); // should NOT recycle again
		expect(fake.state.contextsCreated).toBe(2);
	});

	it("concurrent acquirePage calls do not double-create the BrowserContext", async () => {
		const fake = makeFakeBrowser();
		const ctx = createSearchContext(() => fake.browser);
		const [a, b, c] = await Promise.all([ctx.acquirePage(), ctx.acquirePage(), ctx.acquirePage()]);
		expect(fake.state.contextsCreated).toBe(1);
		expect(fake.state.pagesCreated).toBe(3);
		// Make sure all returned valid pages.
		expect(a.page).toBeTruthy();
		expect(b.page).toBeTruthy();
		expect(c.page).toBeTruthy();
	});

	it("attaches an SSRF guard on each acquirePage (returns guard)", async () => {
		const fake = makeFakeBrowser();
		const ctx = createSearchContext(() => fake.browser);
		const { guard } = await ctx.acquirePage();
		expect(typeof guard.detach).toBe("function");
		expect(typeof guard.assertNotBlocked).toBe("function");
		expect(typeof guard.getBlockedHop).toBe("function");
		expect(guard.getBlockedHop()).toBeNull();
	});
});
