import type { HttpFetch, HttpResponse } from "../../src/client/http-fetch.js";

export interface FakeRoute {
	readonly status?: number;
	readonly body?: string;
	readonly headers?: Record<string, string>;
	readonly delayMs?: number;
	readonly throws?: Error;
	readonly assert?: (url: string, init?: Parameters<HttpFetch>[1]) => void;
}

export function createFakeHttpFetch(routes: Record<string, FakeRoute | FakeRoute[]>): HttpFetch {
	const indexByUrl = new Map<string, number>();
	return async (url, init) => {
		const entry = findMatch(routes, url);
		if (!entry) throw new Error(`fake-http-fetch: no route matched ${url}`);
		const route = resolveNext(entry, url, indexByUrl);
		if (route.assert) route.assert(url, init);
		if (route.delayMs) await new Promise((r) => setTimeout(r, route.delayMs));
		if (route.throws) throw route.throws;
		const response: HttpResponse = {
			status: route.status ?? 200,
			headers: route.headers ?? {},
			body: route.body ?? "",
			url,
		};
		return response;
	};
}

function findMatch(
	routes: Record<string, FakeRoute | FakeRoute[]>,
	url: string,
): FakeRoute | FakeRoute[] | null {
	for (const pattern of Object.keys(routes)) {
		if (url.startsWith(pattern)) return routes[pattern] ?? null;
	}
	return null;
}

function resolveNext(
	entry: FakeRoute | FakeRoute[],
	key: string,
	counters: Map<string, number>,
): FakeRoute {
	if (!Array.isArray(entry)) return entry;
	const idx = counters.get(key) ?? 0;
	counters.set(key, idx + 1);
	return entry[Math.min(idx, entry.length - 1)] ?? entry[0] ?? {};
}
