import type { Page, Response } from "playwright-core";

export type SearchEngineName = "google" | "duckduckgo";
export type SearchEngineChoice = SearchEngineName | "auto";

export interface RawResult {
	readonly title: string;
	readonly url: string;
	readonly snippet: string;
	readonly rank: number;
}

export type BlockSignal =
	| { kind: "http_status"; status: 429 | 503 }
	| { kind: "sorry_interstitial"; url: string }
	| { kind: "consent_drift" }
	| { kind: "empty_results" }
	| { kind: "navigation_failed"; cause: string };

export interface SearchEngineAdapter {
	readonly name: SearchEngineName;
	buildUrl(query: string): string;
	readonly waitStrategy: { readyState: "domcontentloaded" | "load" | "networkidle" };
	parseResults(page: Page, maxResults: number): Promise<RawResult[]>;
	dismissConsent?(page: Page): Promise<"dismissed" | "skip" | "drift">;
	detectBlock?(page: Page, response: Response | null): Promise<BlockSignal | null>;
}
