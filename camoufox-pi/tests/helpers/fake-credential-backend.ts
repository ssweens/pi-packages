import type { CredentialBackend } from "../../src/credentials/backend.js";
import { CREDENTIAL_SERVICE_NAME } from "../../src/credentials/types.js";

export function createFakeCredentialBackend(
	initial: Record<string, string> = {},
): CredentialBackend & { readonly _store: Map<string, string> } {
	const store = new Map<string, string>(Object.entries(initial));
	return {
		_store: store,
		async get(key) {
			return store.get(key) ?? null;
		},
		async set(key, value) {
			store.set(key, value);
		},
		async delete(key) {
			return store.delete(key);
		},
		async list() {
			const prefix = `${CREDENTIAL_SERVICE_NAME}:`;
			return [...store.keys()].filter((k) => k.startsWith(prefix));
		},
	};
}
