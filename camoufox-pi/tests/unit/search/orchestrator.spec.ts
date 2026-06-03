import { describe, expect, it, vi } from "vitest";

import { runSearch } from "../../../src/search/orchestrator.js";
import type {
	BlockSignal,
	RawResult,
	SearchEngineAdapter,
	SearchEngineName,
} from "../../../src/search/types.js";
import type { LookupFn } from "../../../src/security/ssrf.js";

type FakeAdapterOutcome =
	| { kind: "results"; results: RawResult[] }
	| { kind: "block"; signal: BlockSignal }
	| { kind: "consent_drift" };

function fakeAdapter(name: SearchEngineName, outcome: FakeAdapterOutcome): SearchEngineAdapter {
	return {
		name,
		buildUrl: (q) => `https://${name}.test/?q=${encodeURIComponent(q)}`,
		waitStrategy: { readyState: "domcontentloaded" },
		async parseResults() {
			if (outcome.kind === "results") return outcome.results;
			return [];
		},
		async dismissConsent() {
			if (outcome.kind === "consent_drift") return "drift";
			return "skip";
		},
		async detectBlock() {
			if (outcome.kind === "block") return outcome.signal;
			return null;
		},
	};
}

// Minimal fake SearchContext satisfying Pick<SearchContext, "acquirePage"|"markBlocked">.
function makeFakeContext() {
	const state = { acquireCalls: 0, markedBlocks: [] as BlockSignal[] };
	return {
		state,
		ctx: {
			async acquirePage() {
				state.acquireCalls += 1;
				return {
					page: {
						async goto() {
							return { status: () => 200, url: () => "https://x.test/search?q=x" };
						},
						url: () => "https://x.test/search?q=x",
						async close() {},
					},
					guard: {
						async detach() {},
						getBlockedHop: () => null,
						assertNotBlocked: () => {},
					},
				} as never;
			},
			markBlocked(signal: BlockSignal) {
				state.markedBlocks.push(signal);
			},
		},
	};
}

const newSignal = () => new AbortController().signal;

const publicLookup = (async () => [{ address: "93.184.216.34", family: 4 }]) as unknown as LookupFn;

describe("runSearch", () => {
	it("auto: returns google results without fallback when google succeeds", async () => {
		const google = fakeAdapter("google", {
			kind: "results",
			results: [{ title: "t", url: "https://x", snippet: "s", rank: 1 }],
		});
		const ddg = fakeAdapter("duckduckgo", { kind: "results", results: [] });
		const { ctx, state } = makeFakeContext();
		const emit = vi.fn();

		const out = await runSearch("q", {
			maxResults: 10,
			engine: "auto",
			signal: newSignal(),
			adapters: [google, ddg],
			context: ctx,
			emitSearchEvent: emit,
			ssrfLookup: publicLookup,
		});

		expect(out.engine).toBe("google");
		expect(out.results).toHaveLength(1);
		expect(state.acquireCalls).toBe(1);
		expect(emit).toHaveBeenCalledTimes(1);
		expect(emit.mock.calls[0]?.[0]).toMatchObject({ engine: "google" });
		expect(emit.mock.calls[0]?.[0]).not.toHaveProperty("fallback_reason");
	});

	it("auto: falls back to ddg on google block signal; carries fallback_reason in event", async () => {
		const google = fakeAdapter("google", {
			kind: "block",
			signal: { kind: "http_status", status: 429 },
		});
		const ddg = fakeAdapter("duckduckgo", {
			kind: "results",
			results: [{ title: "t", url: "https://y", snippet: "s", rank: 1 }],
		});
		const { ctx, state } = makeFakeContext();
		const emit = vi.fn();

		const out = await runSearch("q", {
			maxResults: 10,
			engine: "auto",
			signal: newSignal(),
			adapters: [google, ddg],
			context: ctx,
			emitSearchEvent: emit,
			ssrfLookup: publicLookup,
		});

		expect(out.engine).toBe("duckduckgo");
		expect(state.markedBlocks).toHaveLength(1);
		expect(state.markedBlocks[0]).toEqual({ kind: "http_status", status: 429 });
		expect(emit).toHaveBeenCalledTimes(1);
		expect(emit.mock.calls[0]?.[0]).toMatchObject({
			engine: "duckduckgo",
			fallback_reason: "http_status",
		});
	});

	it("auto: falls back on google consent drift", async () => {
		const google = fakeAdapter("google", { kind: "consent_drift" });
		const ddg = fakeAdapter("duckduckgo", {
			kind: "results",
			results: [{ title: "t", url: "https://y", snippet: "s", rank: 1 }],
		});
		const { ctx } = makeFakeContext();
		const out = await runSearch("q", {
			maxResults: 10,
			engine: "auto",
			signal: newSignal(),
			adapters: [google, ddg],
			context: ctx,
			emitSearchEvent: vi.fn(),
			ssrfLookup: publicLookup,
		});
		expect(out.engine).toBe("duckduckgo");
	});

	it("auto: falls back on google empty-results (treated as block via detectBlock presence)", async () => {
		const google = fakeAdapter("google", { kind: "results", results: [] });
		const ddg = fakeAdapter("duckduckgo", {
			kind: "results",
			results: [{ title: "t", url: "https://y", snippet: "s", rank: 1 }],
		});
		const { ctx, state } = makeFakeContext();
		const out = await runSearch("q", {
			maxResults: 10,
			engine: "auto",
			signal: newSignal(),
			adapters: [google, ddg],
			context: ctx,
			emitSearchEvent: vi.fn(),
			ssrfLookup: publicLookup,
		});
		expect(out.engine).toBe("duckduckgo");
		expect(state.markedBlocks[0]?.kind).toBe("empty_results");
	});

	it("ddg has no detectBlock — empty-results from DDG is legitimate, not a block", async () => {
		const google = fakeAdapter("google", { kind: "results", results: [] }); // empty-results ⇒ block
		const ddgNoDetect: SearchEngineAdapter = {
			name: "duckduckgo",
			buildUrl: (q) => `https://duckduckgo.test/?q=${q}`,
			waitStrategy: { readyState: "domcontentloaded" },
			async parseResults() {
				return [];
			},
			// NO detectBlock — empty results is legitimate
		};
		const { ctx } = makeFakeContext();
		const emit = vi.fn();
		const out = await runSearch("q", {
			maxResults: 10,
			engine: "auto",
			signal: newSignal(),
			adapters: [google, ddgNoDetect],
			context: ctx,
			emitSearchEvent: emit,
			ssrfLookup: publicLookup,
		});
		expect(out.engine).toBe("duckduckgo");
		expect(out.results).toEqual([]);
		// Empty array IS the legitimate result; orchestrator returns it.
	});

	it("auto: all adapters fail → throws search_all_engines_blocked with last signal", async () => {
		const google = fakeAdapter("google", {
			kind: "block",
			signal: { kind: "sorry_interstitial", url: "x" },
		});
		const ddgThrows: SearchEngineAdapter = {
			name: "duckduckgo",
			buildUrl: (q) => `https://d.test/?q=${q}`,
			waitStrategy: { readyState: "domcontentloaded" },
			async parseResults() {
				throw new Error("net::ERR_CONNECTION_REFUSED");
			},
		};
		const { ctx } = makeFakeContext();
		await expect(
			runSearch("q", {
				maxResults: 10,
				engine: "auto",
				signal: newSignal(),
				adapters: [google, ddgThrows],
				context: ctx,
				emitSearchEvent: vi.fn(),
				ssrfLookup: publicLookup,
			}),
		).rejects.toMatchObject({
			err: { type: "search_all_engines_blocked", lastSignal: "navigation_failed" },
		});
	});

	it('explicit engine "duckduckgo" skips google entirely', async () => {
		const ddg = fakeAdapter("duckduckgo", {
			kind: "results",
			results: [{ title: "t", url: "https://y", snippet: "s", rank: 1 }],
		});
		const google = fakeAdapter("google", {
			kind: "block",
			signal: { kind: "sorry_interstitial", url: "x" },
		});
		const { ctx, state } = makeFakeContext();
		const out = await runSearch("q", {
			maxResults: 10,
			engine: "duckduckgo",
			signal: newSignal(),
			adapters: [google, ddg],
			context: ctx,
			emitSearchEvent: vi.fn(),
			ssrfLookup: publicLookup,
		});
		expect(out.engine).toBe("duckduckgo");
		expect(state.acquireCalls).toBe(1);
	});

	it("honors AbortSignal: aborting before run throws aborted immediately", async () => {
		const google = fakeAdapter("google", {
			kind: "results",
			results: [{ title: "t", url: "x", snippet: "s", rank: 1 }],
		});
		const { ctx } = makeFakeContext();
		const ac = new AbortController();
		ac.abort();
		await expect(
			runSearch("q", {
				maxResults: 10,
				engine: "auto",
				signal: ac.signal,
				adapters: [google],
				context: ctx,
				emitSearchEvent: vi.fn(),
				ssrfLookup: publicLookup,
			}),
		).rejects.toMatchObject({ err: { type: "aborted" } });
	});

	it("pre-flight assertSafeTarget refuses adapter URLs resolving to private IPs (hard fail, no fallback)", async () => {
		const privateLookup = (async () => [{ address: "10.0.0.1", family: 4 }]) as unknown as LookupFn;
		const google = fakeAdapter("google", {
			kind: "results",
			results: [{ title: "t", url: "https://x", snippet: "s", rank: 1 }],
		});
		const ddg = fakeAdapter("duckduckgo", {
			kind: "results",
			results: [{ title: "t", url: "https://y", snippet: "s", rank: 1 }],
		});
		const { ctx, state } = makeFakeContext();
		await expect(
			runSearch("q", {
				maxResults: 10,
				engine: "auto",
				signal: newSignal(),
				adapters: [google, ddg],
				context: ctx,
				emitSearchEvent: vi.fn(),
				ssrfLookup: privateLookup,
			}),
		).rejects.toMatchObject({
			err: { type: "ssrf_blocked", hop: "initial" },
		});
		// No fallback occurred — neither adapter acquired.
		expect(state.acquireCalls).toBe(0);
		expect(state.markedBlocks).toEqual([]);
	});

	it("aborts mid-loop: aborting from inside the first adapter's parse aborts before second adapter starts", async () => {
		const ac = new AbortController();
		// First adapter aborts the signal during parseResults, then returns 0 results
		// (which would normally trigger empty_results → fall back).
		const google: SearchEngineAdapter = {
			name: "google",
			buildUrl: (q) => `https://google.test/?q=${q}`,
			waitStrategy: { readyState: "domcontentloaded" },
			async parseResults() {
				ac.abort();
				return [];
			},
			async detectBlock() {
				return null;
			},
		};
		const ddg = fakeAdapter("duckduckgo", {
			kind: "results",
			results: [{ title: "should-not-reach", url: "https://x", snippet: "s", rank: 1 }],
		});
		const { ctx, state } = makeFakeContext();
		await expect(
			runSearch("q", {
				maxResults: 10,
				engine: "auto",
				signal: ac.signal,
				adapters: [google, ddg],
				context: ctx,
				emitSearchEvent: vi.fn(),
				ssrfLookup: publicLookup,
			}),
		).rejects.toMatchObject({ err: { type: "aborted" } });
		// Confirm only google was attempted; ddg never acquired.
		expect(state.acquireCalls).toBe(1);
	});

	it("unknown engine name → throws config_invalid", async () => {
		const ddg = fakeAdapter("duckduckgo", { kind: "results", results: [] });
		const { ctx } = makeFakeContext();
		await expect(
			runSearch("q", {
				maxResults: 10,
				engine: "google" as never, // pretending google adapter not in list
				signal: newSignal(),
				adapters: [ddg], // only ddg
				context: ctx,
				emitSearchEvent: vi.fn(),
				ssrfLookup: publicLookup,
			}),
		).rejects.toMatchObject({
			err: { type: "config_invalid", field: "engine" },
		});
	});
});
