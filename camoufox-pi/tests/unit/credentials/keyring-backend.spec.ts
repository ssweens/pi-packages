import { describe, expect, it } from "vitest";

import {
	type KeyringLike,
	createKeyringBackend,
} from "../../../src/credentials/keyring-backend.js";

// In-memory KeyringLike — exercises the backend wrapper without touching
// the OS keychain. Real-keychain smoke runs only when RUN_KEYRING_SMOKE=1.
function makeInMemoryKeyring(): KeyringLike {
	const store = new Map<string, string>();
	const key = (s: string, a: string) => `${s}::${a}`;
	return {
		getPassword: (s, a) => store.get(key(s, a)) ?? null,
		setPassword: (s, a, p) => {
			store.set(key(s, a), p);
		},
		deletePassword: (s, a) => store.delete(key(s, a)),
		findCredentials: (s) =>
			[...store.entries()]
				.filter(([k]) => k.startsWith(`${s}::`))
				.map(([k, password]) => ({ account: k.slice(s.length + 2), password })),
	};
}

describe("KeyringBackend (in-memory adapter)", () => {
	it("round-trips a value through get / set / delete / list", async () => {
		const backend = await createKeyringBackend({ keyring: makeInMemoryKeyring() });
		await backend.set("camoufox-pi:reddit:token", "s3cret");
		expect(await backend.get("camoufox-pi:reddit:token")).toBe("s3cret");
		const keys = await backend.list();
		expect(keys).toContain("camoufox-pi:reddit:token");
		expect(await backend.delete("camoufox-pi:reddit:token")).toBe(true);
		expect(await backend.get("camoufox-pi:reddit:token")).toBeNull();
	});

	it("rejects non-namespaced keys at set", async () => {
		const backend = await createKeyringBackend({ keyring: makeInMemoryKeyring() });
		await expect(backend.set("bare-key", "x")).rejects.toThrow();
	});
});

describe.skipIf(!process.env.RUN_KEYRING_SMOKE)("KeyringBackend (real keychain)", () => {
	it("round-trips against real keychain", async () => {
		const backend = await createKeyringBackend();
		const key = `camoufox-pi:test:smoke-${Date.now()}`;
		await backend.set(key, "smoke-value");
		expect(await backend.get(key)).toBe("smoke-value");
		await backend.delete(key);
	});
});
