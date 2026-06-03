import type { LookupFn } from "../../src/security/ssrf.js";

/**
 * Test-only DNS lookup stub: every hostname resolves to a public IPv4
 * (1.1.1.1) so SSRF checks pass without real network calls.
 */
export const safeLookup = (async () => [
	{ address: "1.1.1.1", family: 4 as const },
]) as unknown as LookupFn;
