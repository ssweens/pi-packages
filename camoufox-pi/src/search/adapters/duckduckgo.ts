import type { Page } from "playwright-core";

import type { RawResult, SearchEngineAdapter } from "../types.js";

export const duckduckgoAdapter: SearchEngineAdapter = {
	name: "duckduckgo",

	buildUrl(query: string): string {
		const q = encodeURIComponent(query).replace(/%20/g, "+");
		return `https://html.duckduckgo.com/html/?q=${q}`;
	},

	waitStrategy: { readyState: "domcontentloaded" },

	async parseResults(page: Page, maxResults: number): Promise<RawResult[]> {
		const raw = await page.$$eval(
			"div.result, div.web-result",
			(els, max) => {
				const out: { title: string; url: string; snippet: string }[] = [];
				const limit = Math.max(0, Math.min(50, Number(max) || 10));
				for (const el of els) {
					if (out.length >= limit) break;
					const a = el.querySelector("a.result__a") as unknown as {
						textContent: string | null;
						getAttribute(n: string): string | null;
					} | null;
					if (!a) continue;
					const title = (a.textContent ?? "").trim();
					let url = a.getAttribute("href") ?? "";
					const m = url.match(/[?&]uddg=([^&]+)/);
					if (m?.[1]) {
						try {
							url = decodeURIComponent(m[1]);
						} catch {
							// ignore
						}
					}
					if (url.startsWith("//")) url = `https:${url}`;
					// Defense-in-depth: reject non-http(s) URLs that might surface
					// from adversarial SERPs (javascript:, data:, etc.).
					try {
						const u = new URL(url);
						if (u.protocol !== "http:" && u.protocol !== "https:") continue;
					} catch {
						continue;
					}
					const snippetEl = el.querySelector("a.result__snippet, .result__snippet");
					const snippet = ((snippetEl?.textContent ?? "") as string).trim();
					if (!title || !url) continue;
					out.push({ title, url, snippet });
				}
				return out;
			},
			maxResults,
		);
		return raw.map((r, i) => ({ ...r, rank: i + 1 }));
	},
};
