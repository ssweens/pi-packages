import { describe, expect, it } from "vitest";

import { googleAdapter } from "../../../src/search/adapters/google.js";

interface StubHandle {
	click(opts?: { timeout?: number }): Promise<void>;
}

interface StubPage {
	url(): string;
	$(selector: string): Promise<StubHandle | null>;
}

/**
 * Build a stub page where:
 *   - url() returns the provided string
 *   - $(selector) resolves to a stub handle for each selector in `selectors`
 *     (or a null-returning handle if the selector is not in the set)
 */
function makeStubPage(opts: {
	url: string;
	selectors: ReadonlyArray<string>;
	clickImpl?: () => Promise<void>;
}): StubPage {
	const clickedSelectors: string[] = [];
	const set = new Set(opts.selectors);
	return {
		url: () => opts.url,
		async $(selector: string): Promise<StubHandle | null> {
			if (!set.has(selector)) return null;
			return {
				async click() {
					clickedSelectors.push(selector);
					if (opts.clickImpl) await opts.clickImpl();
				},
			};
		},
	};
}

describe("googleAdapter.dismissConsent", () => {
	it('returns "skip" when no consent form is present (normal SERP URL, no form selector matches)', async () => {
		const page = makeStubPage({
			url: "https://www.google.com/search?q=x",
			selectors: [],
		});
		const outcome = await googleAdapter.dismissConsent?.(page as never);
		expect(outcome).toBe("skip");
	});

	it('returns "dismissed" when consent host + reject-all structural selector matches', async () => {
		const page = makeStubPage({
			url: "https://consent.google.com/m?continue=...",
			selectors: ['button[jsname="tWT92d"]'],
		});
		const outcome = await googleAdapter.dismissConsent?.(page as never);
		expect(outcome).toBe("dismissed");
	});

	it('returns "dismissed" when consent form detected on SERP URL and aria-label selector matches', async () => {
		const page = makeStubPage({
			url: "https://www.google.com/search?q=x",
			selectors: ['form[action*="consent"]', 'button[aria-label*="Reject" i]'],
		});
		const outcome = await googleAdapter.dismissConsent?.(page as never);
		expect(outcome).toBe("dismissed");
	});

	it('returns "drift" when consent form present but no reject-button selector matches', async () => {
		const page = makeStubPage({
			url: "https://consent.google.com/m?continue=...",
			selectors: [], // no buttons at all
		});
		const outcome = await googleAdapter.dismissConsent?.(page as never);
		expect(outcome).toBe("drift");
	});

	it('returns "drift" when consent form present via form selector but no reject-button matches', async () => {
		const page = makeStubPage({
			url: "https://www.google.com/search?q=x",
			selectors: ['form[action*="consent"]'],
		});
		const outcome = await googleAdapter.dismissConsent?.(page as never);
		expect(outcome).toBe("drift");
	});
});
