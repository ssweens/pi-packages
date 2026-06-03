// Central search orchestrator. Picks adapters based on opts.engine, runs each
// in order (auto-mode tries google then duckduckgo), falls back to the next
// adapter on any block signal, and throws search_all_engines_blocked only
// after every adapter in the resolved list has been exhausted.

import type { Page, Response } from "playwright-core";

import { CamoufoxErrorBox, mapPlaywrightError, sanitizeReason } from "../errors.js";
import type { SsrfGuard } from "../security/redirect-guard.js";
import { type LookupFn, assertSafeTarget } from "../security/ssrf.js";
import type { SearchContext } from "./search-context.js";
import type {
	BlockSignal,
	RawResult,
	SearchEngineAdapter,
	SearchEngineChoice,
	SearchEngineName,
} from "./types.js";

export interface SearchEventPayload {
	readonly engine: SearchEngineName;
	readonly query: string;
	readonly maxResults: number;
	readonly durationMs: number;
	readonly resultCount: number;
	readonly atLimit: boolean;
	readonly fallback_reason?: BlockSignal["kind"];
}

export interface RunSearchOpts {
	readonly maxResults: number;
	readonly engine: SearchEngineChoice;
	readonly signal: AbortSignal;
	readonly adapters: ReadonlyArray<SearchEngineAdapter>;
	readonly context: Pick<SearchContext, "acquirePage" | "markBlocked">;
	readonly emitSearchEvent: (payload: SearchEventPayload) => void;
	readonly timeoutMs?: number;
	readonly ssrfLookup?: LookupFn;
}

function resolveAdapters(
	choice: SearchEngineChoice,
	all: ReadonlyArray<SearchEngineAdapter>,
): SearchEngineAdapter[] {
	if (choice === "auto") {
		const google = all.find((a) => a.name === "google");
		const ddg = all.find((a) => a.name === "duckduckgo");
		return [google, ddg].filter((a): a is SearchEngineAdapter => a !== undefined);
	}
	const one = all.find((a) => a.name === choice);
	return one ? [one] : [];
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) {
		throw new CamoufoxErrorBox({ type: "aborted" });
	}
}

export async function runSearch(
	query: string,
	opts: RunSearchOpts,
): Promise<{ results: RawResult[]; engine: SearchEngineName; query: string }> {
	const started = Date.now();
	throwIfAborted(opts.signal);
	const selected = resolveAdapters(opts.engine, opts.adapters);
	if (selected.length === 0) {
		throw new CamoufoxErrorBox({
			type: "config_invalid",
			field: "engine",
			reason: `no adapter registered for engine: ${opts.engine}`,
		});
	}

	let lastSignal: BlockSignal | null = null;
	let firstAdapter = true;

	for (const adapter of selected) {
		throwIfAborted(opts.signal);

		const url = adapter.buildUrl(query);
		try {
			await assertSafeTarget(url, opts.ssrfLookup ? { lookup: opts.ssrfLookup } : {});
		} catch (err) {
			throw new CamoufoxErrorBox({
				type: "ssrf_blocked",
				hop: "initial",
				url,
				reason: sanitizeReason(err instanceof Error ? err.message : String(err)),
			});
		}

		let page: Page | null = null;
		let guard: SsrfGuard | null = null;
		try {
			const acquired = await opts.context.acquirePage();
			page = acquired.page;
			guard = acquired.guard;

			let response: Response | null;
			try {
				response = await page.goto(url, {
					waitUntil: adapter.waitStrategy.readyState,
					...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
				});
			} catch (err) {
				guard.assertNotBlocked();
				lastSignal = {
					kind: "navigation_failed",
					cause: sanitizeReason(err instanceof Error ? err.message : String(err)),
				};
				opts.context.markBlocked(lastSignal);
				firstAdapter = false;
				continue;
			}
			guard.assertNotBlocked();

			throwIfAborted(opts.signal);

			if (adapter.dismissConsent) {
				const outcome = await adapter.dismissConsent(page);
				if (outcome === "drift") {
					lastSignal = { kind: "consent_drift" };
					opts.context.markBlocked(lastSignal);
					firstAdapter = false;
					continue;
				}
				throwIfAborted(opts.signal);
			}

			if (adapter.detectBlock) {
				const sig = await adapter.detectBlock(page, response ?? null);
				if (sig) {
					lastSignal = sig;
					opts.context.markBlocked(sig);
					firstAdapter = false;
					continue;
				}
			}

			const results = await adapter.parseResults(page, opts.maxResults);

			if (results.length === 0 && adapter.detectBlock) {
				lastSignal = { kind: "empty_results" };
				opts.context.markBlocked(lastSignal);
				firstAdapter = false;
				continue;
			}

			guard.assertNotBlocked();

			const payload: SearchEventPayload = {
				engine: adapter.name,
				query,
				maxResults: opts.maxResults,
				durationMs: Date.now() - started,
				resultCount: results.length,
				atLimit: results.length === opts.maxResults,
				...(firstAdapter ? {} : { fallback_reason: lastSignal?.kind ?? "empty_results" }),
			};
			opts.emitSearchEvent(payload);
			return { results, engine: adapter.name, query };
		} catch (err) {
			if (err instanceof CamoufoxErrorBox) {
				if (err.err.type === "ssrf_blocked" || err.err.type === "aborted") throw err;
			}
			const mapped = mapPlaywrightError(err, {
				url,
				phase: "nav",
				elapsedMs: Date.now() - started,
				signal: opts.signal,
			});
			if (mapped.type === "aborted") {
				throw new CamoufoxErrorBox(mapped);
			}
			lastSignal = {
				kind: "navigation_failed",
				cause: mapped.type === "network" ? mapped.cause : `${mapped.type}`,
			};
			opts.context.markBlocked(lastSignal);
			firstAdapter = false;
		} finally {
			if (guard) await guard.detach().catch(() => undefined);
			if (page) await page.close().catch(() => undefined);
		}
	}

	throw new CamoufoxErrorBox({
		type: "search_all_engines_blocked",
		lastSignal: lastSignal?.kind ?? "navigation_failed",
	});
}
