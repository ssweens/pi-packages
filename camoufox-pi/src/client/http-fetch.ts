import { CamoufoxErrorBox } from "../errors.js";
import type { LookupFn } from "../security/ssrf.js";
import { assertSafeTarget } from "../security/ssrf.js";
import type { HttpFetchEvent } from "./events.js";

export interface HttpFetchInit {
	readonly method?: "GET" | "POST";
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: string;
	readonly signal?: AbortSignal;
	readonly maxBytes?: number;
	readonly timeoutMs?: number;
}

export interface HttpResponse {
	readonly status: number;
	/** Lowercased header names. HTTP headers are case-insensitive; this
	 * normalization is stable so adapters can look up e.g. "retry-after". */
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string;
	readonly url: string;
}

export type HttpFetch = (url: string, init?: HttpFetchInit) => Promise<HttpResponse>;

export interface CreateHttpFetchOptions {
	readonly lookup?: LookupFn;
	readonly fetchImpl?: typeof fetch;
	readonly emit?: (e: HttpFetchEvent) => void;
	readonly spanIdFor?: () => string;
	readonly source?: string;
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export function createHttpFetch(opts: CreateHttpFetchOptions): HttpFetch {
	const fetchImpl = opts.fetchImpl ?? fetch;
	const MAX_REDIRECTS = 10;

	return async (url: string, init: HttpFetchInit = {}): Promise<HttpResponse> => {
		const maxBytes = init.maxBytes ?? DEFAULT_MAX_BYTES;
		const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const combinedSignal = init.signal
			? AbortSignal.any([init.signal, controller.signal])
			: controller.signal;
		const start = Date.now();
		let currentUrl = url;
		let hopKind: "initial" | "redirect" = "initial";
		// Mutable effective init so redirect downgrade (303, POST→301/302) can
		// change method/body without mutating the caller-supplied object.
		let effectiveInit = init;

		try {
			// hop 0 is the initial request; hops 1..MAX_REDIRECTS are redirects. The
			// throw below fires when the loop exits without a non-3xx response — i.e.
			// after the request that WOULD be redirect #MAX_REDIRECTS + 1.
			for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
				try {
					await assertSafeTarget(currentUrl, opts.lookup ? { lookup: opts.lookup } : {});
				} catch (err) {
					throw new CamoufoxErrorBox({
						type: "ssrf_blocked",
						hop: hopKind,
						url: currentUrl,
						reason: err instanceof Error ? err.message : String(err),
					});
				}
				// TODO(SEC): strip Authorization + Cookie headers on cross-origin redirect
				// before any adapter starts sending auth via httpFetch.
				const res = await fetchImpl(currentUrl, {
					method: effectiveInit.method ?? "GET",
					...(effectiveInit.headers !== undefined ? { headers: effectiveInit.headers } : {}),
					...(effectiveInit.body !== undefined ? { body: effectiveInit.body } : {}),
					signal: combinedSignal,
					redirect: "manual",
				});
				if (isRedirectStatus(res.status)) {
					const loc = res.headers.get("location");
					if (!loc) {
						// Malformed redirect — treat as final response.
						const body = await readBodyLimited(res, maxBytes);
						return finalize(res, body, currentUrl, opts, url, start);
					}
					const next = new URL(loc, currentUrl).toString();
					// RFC 7231 §6.4.4: 303 always downgrades to GET with no body.
					// 301/302 de-facto downgrade POST→GET per all major browsers.
					if (
						res.status === 303 ||
						((res.status === 301 || res.status === 302) &&
							(effectiveInit.method ?? "GET") === "POST")
					) {
						const { body: _dropped, ...rest } = effectiveInit;
						effectiveInit = { ...rest, method: "GET" };
					}
					currentUrl = next;
					hopKind = "redirect";
					continue;
				}
				const body = await readBodyLimited(res, maxBytes);
				return finalize(res, body, currentUrl, opts, url, start);
			}
			throw new CamoufoxErrorBox({
				type: "network",
				cause: `exceeded ${MAX_REDIRECTS} redirect hops`,
				url: currentUrl,
			});
		} catch (err) {
			if (err instanceof CamoufoxErrorBox) throw err;
			// Tie-break: if both the internal timer and external signal fired, the
			// external cancellation wins (aborted) — checked via init.signal.aborted.
			if (combinedSignal.aborted && !init.signal?.aborted) {
				throw new CamoufoxErrorBox({
					type: "timeout",
					phase: "nav",
					elapsedMs: Date.now() - start,
				});
			}
			if (init.signal?.aborted) {
				throw new CamoufoxErrorBox({ type: "aborted" });
			}
			throw new CamoufoxErrorBox({
				type: "network",
				cause: err instanceof Error ? err.message : String(err),
				url: currentUrl,
			});
		} finally {
			clearTimeout(timer);
		}
	};
}

function isRedirectStatus(status: number): boolean {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function finalize(
	res: Response,
	body: string,
	finalUrl: string,
	opts: CreateHttpFetchOptions,
	originalUrl: string,
	start: number,
): HttpResponse {
	const response: HttpResponse = {
		status: res.status,
		headers: headersToRecord(res.headers),
		body,
		url: finalUrl,
	};
	opts.emit?.({
		spanId: opts.spanIdFor?.() ?? "",
		...(opts.source !== undefined ? { source: opts.source } : {}),
		url: originalUrl,
		status: res.status,
		durationMs: Date.now() - start,
	});
	return response;
}

async function readBodyLimited(res: Response, maxBytes: number): Promise<string> {
	const reader = res.body?.getReader();
	if (!reader) return "";
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (total < maxBytes) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		const remaining = maxBytes - total;
		if (value.byteLength > remaining) {
			chunks.push(value.subarray(0, remaining));
			total += remaining;
			await reader.cancel().catch(() => undefined);
			break;
		}
		chunks.push(value);
		total += value.byteLength;
	}
	// Concatenate, then UTF-8 decode. `fatal: false` means invalid sequences
	// become U+FFFD — safer than throwing at an arbitrary byte boundary.
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		merged.set(c, offset);
		offset += c.byteLength;
	}
	return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

function headersToRecord(h: Headers): Record<string, string> {
	const out: Record<string, string> = {};
	h.forEach((v, k) => {
		out[k.toLowerCase()] = v;
	});
	return out;
}
