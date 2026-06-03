import type { Page, Response } from "playwright-core";

import type { BlockSignal, RawResult, SearchEngineAdapter } from "../types.js";

const CONSENT_HOST_RE = /(?:^|\.)consent\.google\.com$/i;

const SORRY_URL_RE = /\/sorry\//;

const REJECT_SELECTORS = [
	'button[jsname="tWT92d"]',
	'button[aria-label*="Reject" i]',
	'form[action*="consent"] button[type="submit"]:nth-of-type(1)',
] as const;

async function hasConsentForm(page: Page): Promise<boolean> {
	try {
		const host = new URL(page.url()).hostname;
		if (CONSENT_HOST_RE.test(host)) return true;
	} catch {
		// unparseable URL — fall through to DOM check
	}
	const match = await page.$('form[action*="consent"]');
	return match !== null;
}

async function dismissConsent(page: Page): Promise<"dismissed" | "skip" | "drift"> {
	if (!(await hasConsentForm(page))) return "skip";
	for (const sel of REJECT_SELECTORS) {
		const handle = await page.$(sel);
		if (handle) {
			try {
				await handle.click({ timeout: 2_000 });
				return "dismissed";
			} catch {
				// selector found but click failed (e.g. element not interactable).
				// Try next selector rather than giving up.
			}
		}
	}
	return "drift";
}

async function parseResults(page: Page, maxResults: number): Promise<RawResult[]> {
	const raw = await page.$$eval(
		"div#search div[data-sokoban-container]",
		(els, max) => {
			const out: { title: string; url: string; snippet: string }[] = [];
			const limit = Math.max(0, Math.min(50, Number(max) || 10));
			for (const el of els) {
				if (out.length >= limit) break;
				const h3 = el.querySelector("h3") as unknown as {
					textContent: string | null;
				} | null;
				const a = el.querySelector("a[jsname]") as unknown as {
					getAttribute(n: string): string | null;
				} | null;
				const snip =
					el.querySelector("div[data-sncf] span") ??
					el.querySelector('div[style*="-webkit-line-clamp"]');
				if (!h3 || !a) continue;
				const title = (h3.textContent ?? "").trim();
				const url = a.getAttribute("href") ?? "";
				if (!title || !url) continue;
				try {
					const u = new URL(url);
					if (u.protocol !== "http:" && u.protocol !== "https:") continue;
				} catch {
					continue;
				}
				const snippet = ((snip?.textContent ?? "") as string).trim();
				out.push({ title, url, snippet });
			}
			return out;
		},
		maxResults,
	);
	return raw.map((r, i) => ({ ...r, rank: i + 1 }));
}

async function detectBlock(page: Page, response: Response | null): Promise<BlockSignal | null> {
	if (response) {
		const status = response.status();
		if (status === 429 || status === 503) {
			return { kind: "http_status", status };
		}
	}
	const url = page.url();
	if (SORRY_URL_RE.test(url)) {
		return { kind: "sorry_interstitial", url };
	}
	return null;
}

export const googleAdapter: SearchEngineAdapter = {
	name: "google",
	buildUrl(query: string): string {
		return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
	},
	waitStrategy: { readyState: "domcontentloaded" },
	parseResults,
	dismissConsent,
	detectBlock,
};
