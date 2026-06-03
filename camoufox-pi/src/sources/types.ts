// Canonical source identifier. Open-ended string union so consumers can
// register custom adapters; known values are enumerated for type narrowing.
export type KnownSourceName =
	| "reddit"
	| "hn"
	| "x"
	| "linkedin"
	| "github"
	| "polymarket"
	| "bluesky"
	| "scrapecreators";

export type SourceName = KnownSourceName | (string & {});

import type { SourceFetchEvent } from "../client/events.js";
import type { HttpFetch } from "../client/http-fetch.js";
import type { CredentialReader } from "../credentials/reader.js";
import type { CredentialSpec } from "../credentials/types.js";
import type { SourceItem } from "./source-item.js";

export interface SourceFetchOptions {
	readonly lookbackDays: number;
	readonly limit: number;
	readonly signal?: AbortSignal;
}

export interface BrowserSession {
	/** Reserved for milestone 6 — see design §3.1. */
	readonly __reserved: true;
}

export interface AdapterContext {
	readonly httpFetch: HttpFetch;
	readonly browser?: BrowserSession;
	readonly credentials: CredentialReader;
	readonly emit: (event: SourceFetchEvent) => void;
}

export interface SourceAdapter {
	readonly name: SourceName;
	readonly tier: 0 | 1 | 2 | 4;
	readonly requiredCredentials: CredentialSpec[];
	fetch(query: string, opts: SourceFetchOptions, ctx: AdapterContext): Promise<SourceItem[]>;
	validateCredential?(
		credentialKey: string,
		value: string,
		ctx: AdapterContext,
	): Promise<{ ok: true } | { ok: false; reason: string }>;
}

export interface FetchSourcesResult {
	readonly items: SourceItem[];
	readonly errors: Array<{
		readonly source: SourceName;
		readonly error: import("../errors.js").CamoufoxError;
	}>;
	readonly stats: Array<{
		readonly source: SourceName;
		readonly itemCount: number;
		readonly durationMs: number;
		readonly tier: 0 | 1 | 2 | 4;
	}>;
}
